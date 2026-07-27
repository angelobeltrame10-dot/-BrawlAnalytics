-- ==========================================================
-- BRAWL ANALYTICS
-- PUBLIC STATS TABLE (v2 — contatori reali, non ricavati)
--
-- total_videos_analyzed e total_ideas_generated NON sono più
-- ricalcolati dal contenuto di channel_data/generated_ideas
-- (quello contava CSV caricati / righe correnti, non azioni AI
-- reali). Ora sono contatori incrementali, aggiornati SOLO da
-- try_consume_usage() in sql_subscription_schema.sql — l'unico
-- punto dove un'analisi o un'idea viene davvero consumata,
-- sia per utenti Free che Pro.
-- ==========================================================

create table if not exists public.public_stats (
    id int primary key default 1,
    total_creators int not null default 0,
    total_videos_analyzed int not null default 0,
    total_ideas_generated int not null default 0,
    positive_feedback_percentage int not null default 98,
    updated_at timestamptz not null default now()
);

insert into public.public_stats (id, total_creators, total_videos_analyzed, total_ideas_generated, positive_feedback_percentage)
values (1, 0, 0, 0, 98)
on conflict (id) do nothing;

alter table public.public_stats enable row level security;

drop policy if exists "public_stats_read_all" on public.public_stats;
create policy "public_stats_read_all" on public.public_stats
    for select using (true);

grant select on public.public_stats to anon;
grant select on public.public_stats to authenticated;

-- ==========================================================
-- TRIGGER: aggiorna il numero di creator alla registrazione
-- (invariato: questo dato è corretto anche se ricalcolato)
-- ==========================================================

create or replace function public.update_creator_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    update public.public_stats
    set total_creators = (select count(*) from auth.users),
        updated_at = now()
    where id = 1;
    return new;
end;
$$;

drop trigger if exists on_user_created on auth.users;

create trigger on_user_created
    after insert on auth.users
    for each row execute function public.update_creator_count();

-- ==========================================================
-- RIMOSSI: i vecchi trigger su channel_data e generated_ideas
-- (ricalcolavano da jsonb_array_length, dato fuorviante).
-- L'incremento di total_videos_analyzed / total_ideas_generated
-- avviene ora dentro try_consume_usage(), vedi
-- sql_subscription_schema.sql.
-- ==========================================================

drop trigger if exists on_channel_data_change on public.channel_data;
drop function if exists public.update_video_count();

drop trigger if exists on_generated_ideas_change on public.generated_ideas;
drop function if exists public.update_ideas_count();