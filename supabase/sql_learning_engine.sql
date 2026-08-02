-- ==========================================================
-- BRAWL ANALYTICS — LEARNING ENGINE
-- Due tabelle:
-- 1) prediction_log: ogni analisi fatta (in attesa di conferma)
-- 2) calibration_stats: errori aggregati per dimensione, usati
--    per correggere i pesi futuri. Nessun training ML: solo
--    medie/statistiche aggiornate incrementalmente.
-- ==========================================================

create table if not exists public.prediction_log (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    video_title text not null,
    format text not null,
    predicted_baseline numeric not null,
    predicted_min numeric not null,
    predicted_max numeric not null,
    virality_score int not null,
    confidence int not null,
    features jsonb not null default '{}'::jsonb,
    actual_views numeric,
    resolved boolean not null default false,
    error_ratio numeric,
    created_at timestamptz not null default now(),
    resolved_at timestamptz
);

create index if not exists idx_prediction_log_user_unresolved
    on public.prediction_log(user_id, resolved)
    where resolved = false;

create table if not exists public.calibration_stats (
    user_id uuid not null references auth.users(id) on delete cascade,
    dimension_type text not null,   -- 'format' | 'global' | 'duration_bucket'
    dimension_key text not null,    -- es. 'Trickshot', 'global', 'short_15s'
    sample_count int not null default 0,
    mean_error numeric not null default 0,
    mean_abs_error numeric not null default 0,
    updated_at timestamptz not null default now(),
    primary key (user_id, dimension_type, dimension_key)
);

alter table public.prediction_log enable row level security;
alter table public.calibration_stats enable row level security;

create policy "prediction_log_all_own" on public.prediction_log
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "calibration_stats_all_own" on public.calibration_stats
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete on public.prediction_log to authenticated;
grant select, insert, update, delete on public.calibration_stats to authenticated;