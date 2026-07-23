-- ==========================================================
-- BRAWL ANALYTICS — STORAGE SU SUPABASE (sostituisce localStorage)
-- Esegui dopo sql_subscription_schema.sql e sql_auth_setup.sql
-- ==========================================================

create table if not exists public.channel_data (
    user_id uuid primary key references auth.users(id) on delete cascade,
    videos jsonb not null default '[]'::jsonb,
    custom_formats jsonb not null default '[]'::jsonb,
    channel_profile jsonb,
    updated_at timestamptz not null default now()
);

create table if not exists public.generated_ideas (
    user_id uuid not null references auth.users(id) on delete cascade,
    idea_date date not null default current_date,
    ideas jsonb not null default '[]'::jsonb,
    top_format text,
    updated_at timestamptz not null default now(),
    primary key (user_id, idea_date)
);

alter table public.channel_data enable row level security;
alter table public.generated_ideas enable row level security;

create policy "channel_data_all_own" on public.channel_data
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "generated_ideas_all_own" on public.generated_ideas
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete on public.channel_data to authenticated;
grant select, insert, update, delete on public.generated_ideas to authenticated;