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
-- ==========================================================

create table if not exists public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    plan text not null default 'free' check (plan in ('free', 'pro')),
    created_at timestamptz not null default now()
);

create table if not exists public.daily_usage (
    user_id uuid not null references auth.users(id) on delete cascade,
    usage_date date not null default current_date,
    video_analysis_used int not null default 0,
    idea_generation_used int not null default 0,
    primary key (user_id, usage_date)
);

alter table public.profiles enable row level security;
alter table public.daily_usage enable row level security;

-- Il client può leggere solo la propria riga. Nessuna policy di
-- insert/update diretta: piano e contatori si modificano SOLO
-- tramite le funzioni "security definer" qui sotto (o dal Dashboard
-- Supabase / da un futuro webhook Stripe per il campo "plan").
create policy "profiles_select_own" on public.profiles
    for select using (auth.uid() = id);

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

    select p.plan into v_plan from profiles p where p.id = v_uid;

    select d.video_analysis_used, d.idea_generation_used
        into v_video_used, v_idea_used
        from daily_usage d
        where d.user_id = v_uid and d.usage_date = v_today;

    if v_plan = 'pro' then
        return query select v_plan, -1, -1;
        return;
    end if;

    return query select
        v_plan,
        greatest(0, 1 - coalesce(v_video_used, 0)),
        greatest(0, 3 - coalesce(v_idea_used, 0));
end;
$$;

grant execute on function public.get_usage_status() to authenticated;

-- ==========================================================
-- try_consume_usage(p_kind)
-- Verifica E incrementa in un'unica transazione atomica: è
-- l'UNICO punto che decide se una chiamata AI può partire.
-- p_kind: 'video_analysis' | 'idea_generation'
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

    select p.plan into v_plan from profiles p where p.id = v_uid;

    insert into daily_usage(user_id, usage_date) values (v_uid, v_today)
    on conflict (user_id, usage_date) do nothing;

    -- Piano Pro: nessun limite, incrementa solo per statistiche.
    if v_plan = 'pro' then

        if p_kind = 'video_analysis' then
            update daily_usage set video_analysis_used = video_analysis_used + 1
                where user_id = v_uid and usage_date = v_today;
        else
            update daily_usage set idea_generation_used = idea_generation_used + 1
                where user_id = v_uid and usage_date = v_today;
        end if;

        return query select true, -1, v_plan;
        return;

    end if;

    v_limit := case when p_kind = 'video_analysis' then 1 else 3 end;

    if p_kind = 'video_analysis' then
        select d.video_analysis_used into v_used
            from daily_usage d where d.user_id = v_uid and d.usage_date = v_today;
    else
        select d.idea_generation_used into v_used
            from daily_usage d where d.user_id = v_uid and d.usage_date = v_today;
    end if;

    if coalesce(v_used, 0) >= v_limit then
        return query select false, 0, v_plan;
        return;
    end if;

    if p_kind = 'video_analysis' then
        update daily_usage set video_analysis_used = video_analysis_used + 1
            where user_id = v_uid and usage_date = v_today;
    else
        update daily_usage set idea_generation_used = idea_generation_used + 1
            where user_id = v_uid and usage_date = v_today;
    end if;

    return query select true, (v_limit - coalesce(v_used, 0) - 1), v_plan;
end;
$$;

grant execute on function public.try_consume_usage(text) to authenticated;