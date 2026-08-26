-- ==========================================================
-- BRAWL ANALYTICS
-- SUBSCRIPTION SCHEMA (Supabase / Postgres)
--
-- Da eseguire una sola volta nel SQL Editor di Supabase.
--
-- Il reset giornaliero NON usa cron: ogni RPC lavora sempre su
-- current_date, quindi una nuova riga per "oggi" parte sempre
-- da zero. Le righe dei giorni passati restano (utile per
-- storico/analytics) ma non influenzano i limiti correnti.
--
-- NOVITÀ: try_consume_usage() ora incrementa anche i contatori
-- reali in public.public_stats (total_videos_analyzed /
-- total_ideas_generated) ad ogni consumo effettivamente concesso
-- (allowed = true), sia Free che Pro. Questo sostituisce il
-- vecchio approccio che ricalcolava le stats dal contenuto di
-- channel_data/generated_ideas (vedi sql_public_stats.sql v2).
-- Richiede che public.public_stats esista già (eseguire questo
-- file DOPO sql_public_stats.sql).
-- ==========================================================

create table if not exists public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    plan text not null default 'free' check (plan in ('free', 'pro_m', 'pro_a')),
    created_at timestamptz not null default now()
);

-- The legacy check on existing databases only allows ('free','pro'), so the
-- migration below MUST drop it before writing 'pro_m'. Order matters: drop →
-- migrate → re-add with the new values, otherwise the UPDATE fails with 23514
-- (violates profiles_plan_check).
alter table public.profiles drop constraint if exists profiles_plan_check;

update public.profiles set plan = 'pro_m' where plan = 'pro';

alter table public.profiles add constraint profiles_plan_check
    check (plan in ('free', 'pro_m', 'pro_a'));

-- Billing fields are kept server-managed; clients only receive read access.
alter table public.profiles
    add column if not exists stripe_customer_id text,
    add column if not exists stripe_subscription_id text,
    add column if not exists subscription_status text,
    add column if not exists current_period_end timestamptz,
    add column if not exists pro_started_at timestamptz,
    add column if not exists total_ideas_generated int not null default 0,
    add column if not exists total_videos_analyzed int not null default 0,
    add column if not exists onboarding_checklist_dismissed_at timestamptz;

-- Stamp the first moment a profile becomes Pro. Existing Pro users are
-- backfilled below with the requested launch date.
create or replace function public.set_pro_started_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if new.plan in ('pro_m', 'pro_a') and (old.plan is distinct from new.plan) and new.pro_started_at is null then
        new.pro_started_at := now();
    end if;
    return new;
end;
$$;

drop trigger if exists profiles_set_pro_started_at on public.profiles;
create trigger profiles_set_pro_started_at
    before update on public.profiles
    for each row execute function public.set_pro_started_at();

-- Existing Pro profiles did not have a start date in the old schema.
update public.profiles
set pro_started_at = timestamptz '2026-08-25 00:00:00+00'
where plan in ('pro', 'pro_m', 'pro_a') and pro_started_at is null;

create table if not exists public.daily_usage (
    user_id uuid not null references auth.users(id) on delete cascade,
    usage_date date not null default current_date,
    video_analysis_used int not null default 0,
    idea_generation_used int not null default 0,
    primary key (user_id, usage_date)
);

-- Backfill personal counters from the authoritative usage history.
update public.profiles p
set total_ideas_generated = coalesce(u.idea_total, 0),
    total_videos_analyzed = coalesce(u.video_total, 0)
from (
    select user_id,
           sum(idea_generation_used)::int as idea_total,
           sum(video_analysis_used)::int as video_total
    from public.daily_usage
    group by user_id
) u
where p.id = u.user_id;

alter table public.profiles enable row level security;
alter table public.daily_usage enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
    for select using (auth.uid() = id);

drop policy if exists "usage_select_own" on public.daily_usage;
create policy "usage_select_own" on public.daily_usage
    for select using (auth.uid() = user_id);

grant select on public.profiles to authenticated;
grant select on public.daily_usage to authenticated;

-- ==========================================================
-- get_usage_status()
-- Sola lettura: piano + utilizzi rimanenti oggi. Crea il profilo
-- (piano "free") al primo accesso se non esiste ancora.
-- ==========================================================
create or replace function public.get_usage_status()
returns table(plan text, video_remaining int, idea_remaining int)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_uid uuid := auth.uid();
    v_plan text;
    v_today date := current_date;
    v_video_used int := 0;
    v_idea_used int := 0;
begin
    if v_uid is null then
        raise exception 'Not authenticated';
    end if;

    insert into profiles(id, plan) values (v_uid, 'free')
    on conflict (id) do nothing;

    -- Hard-expire: as soon as the paid period ends, flip the stored plan to
    -- 'free' so the database itself (not just this read) drops Pro access.
    -- NB: "plan" is an output column of RETURNS TABLE, i.e. a PL/pgSQL
    -- variable: every reference must be qualified or Postgres raises 42702
    -- (column reference "plan" is ambiguous).
    update profiles p
       set plan = 'free'
     where p.id = v_uid
       and p.plan in ('pro_m', 'pro_a')
       and p.current_period_end is not null
       and p.current_period_end <= now();

    select case
        when p.plan in ('pro_m', 'pro_a')
             and p.current_period_end is not null
             and p.current_period_end <= now()
        then 'free'
        else p.plan
    end into v_plan
    from profiles p where p.id = v_uid;

    select d.video_analysis_used, d.idea_generation_used
        into v_video_used, v_idea_used
        from daily_usage d
        where d.user_id = v_uid and d.usage_date = v_today;

    if v_plan in ('pro_m', 'pro_a') then
        return query select v_plan, -1, -1;
        return;
    end if;

    return query select
        v_plan,
        greatest(0, 1 - coalesce(v_video_used, 0)),
        greatest(0, 3 - coalesce(v_idea_used, 0));
end;
$$;

revoke all on function public.get_usage_status() from public;
grant execute on function public.get_usage_status() to authenticated;

-- ==========================================================
-- try_consume_usage(p_kind)
-- Verifica E incrementa in un'unica transazione atomica: è
-- l'UNICO punto che decide se una chiamata AI può partire.
-- p_kind: 'video_analysis' | 'idea_generation'
--
-- Ad ogni consumo REALMENTE concesso (allowed = true, incluso il
-- caso Pro senza limiti) incrementa anche il contatore pubblico
-- corrispondente in public_stats: è la fonte di verità per la
-- homepage, non più derivata da altre tabelle.
-- ==========================================================
create or replace function public.try_consume_usage(p_kind text)
returns table(allowed boolean, remaining int, plan text)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_uid uuid := auth.uid();
    v_plan text;
    v_today date := current_date;
    v_used int;
    v_limit int;
begin
    if v_uid is null then
        raise exception 'Not authenticated';
    end if;

    if p_kind not in ('video_analysis', 'idea_generation') then
        raise exception 'Invalid kind: %', p_kind;
    end if;

    insert into profiles(id, plan) values (v_uid, 'free')
    on conflict (id) do nothing;

    -- Hard-expire: as soon as the paid period ends, flip the stored plan to
    -- 'free' so the database itself (not just this read) drops Pro access.
    -- NB: "plan" is an output column of RETURNS TABLE, i.e. a PL/pgSQL
    -- variable: every reference must be qualified or Postgres raises 42702
    -- (column reference "plan" is ambiguous).
    update profiles p
       set plan = 'free'
     where p.id = v_uid
       and p.plan in ('pro_m', 'pro_a')
       and p.current_period_end is not null
       and p.current_period_end <= now();

    select case
        when p.plan in ('pro_m', 'pro_a')
             and p.current_period_end is not null
             and p.current_period_end <= now()
        then 'free'
        else p.plan
    end into v_plan
    from profiles p where p.id = v_uid;

    insert into daily_usage(user_id, usage_date) values (v_uid, v_today)
    on conflict (user_id, usage_date) do nothing;

    -- Piano Pro: nessun limite, incrementa solo per statistiche.
    if v_plan in ('pro_m', 'pro_a') then

        if p_kind = 'video_analysis' then
            update daily_usage set video_analysis_used = video_analysis_used + 1
                where user_id = v_uid and usage_date = v_today;
            update public.profiles
                set total_videos_analyzed = total_videos_analyzed + 1
                where id = v_uid;

            update public.public_stats
                set total_videos_analyzed = total_videos_analyzed + 1,
                    updated_at = now()
                where id = 1;
        else
            update daily_usage set idea_generation_used = idea_generation_used + 1
                where user_id = v_uid and usage_date = v_today;
            update public.profiles
                set total_ideas_generated = total_ideas_generated + 1
                where id = v_uid;

            update public.public_stats
                set total_ideas_generated = total_ideas_generated + 1,
                    updated_at = now()
                where id = 1;
        end if;

        return query select true, -1, v_plan;
        return;

    end if;

    v_limit := case when p_kind = 'video_analysis' then 1 else 3 end;

    -- L'UPDATE condizionale acquisisce il lock della riga e decide la
    -- concessione in modo atomico: due richieste concorrenti non possono
    -- entrambe passare leggendo lo stesso contatore.
    if p_kind = 'video_analysis' then
        update daily_usage
           set video_analysis_used = video_analysis_used + 1
         where user_id = v_uid
           and usage_date = v_today
           and video_analysis_used < v_limit
        returning video_analysis_used into v_used;

        if not found then
            return query select false, 0, v_plan;
            return;
        end if;

        update public.profiles
           set total_videos_analyzed = total_videos_analyzed + 1
         where id = v_uid;

        update public.public_stats
           set total_videos_analyzed = total_videos_analyzed + 1,
               updated_at = now()
         where id = 1;
    else
        update daily_usage
           set idea_generation_used = idea_generation_used + 1
         where user_id = v_uid
           and usage_date = v_today
           and idea_generation_used < v_limit
        returning idea_generation_used into v_used;

        if not found then
            return query select false, 0, v_plan;
            return;
        end if;

        update public.profiles
           set total_ideas_generated = total_ideas_generated + 1
         where id = v_uid;

        update public.public_stats
           set total_ideas_generated = total_ideas_generated + 1,
               updated_at = now()
         where id = 1;
    end if;

    return query select true, (v_limit - v_used), v_plan;
end;
$$;

revoke all on function public.try_consume_usage(text) from public;
grant execute on function public.try_consume_usage(text) to authenticated;