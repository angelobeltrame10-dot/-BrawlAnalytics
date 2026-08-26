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
    dimension_type text not null,   -- 'format' | 'global' | 'duration_bucket' | 'feature'
    dimension_key text not null,    -- es. 'Trickshot', 'global', 'short_15s'
    sample_count int not null default 0,
    mean_error numeric not null default 0,
    mean_abs_error numeric not null default 0,
    updated_at timestamptz not null default now(),
    primary key (user_id, dimension_type, dimension_key)
);

alter table public.prediction_log enable row level security;
alter table public.calibration_stats enable row level security;

drop policy if exists "prediction_log_all_own" on public.prediction_log;
drop policy if exists "prediction_log_select_own" on public.prediction_log;
drop policy if exists "prediction_log_insert_own" on public.prediction_log;
drop policy if exists "prediction_log_delete_own" on public.prediction_log;
create policy "prediction_log_select_own" on public.prediction_log
    for select using (auth.uid() = user_id);
create policy "prediction_log_insert_own" on public.prediction_log
    for insert with check (auth.uid() = user_id);
create policy "prediction_log_delete_own" on public.prediction_log
    for delete using (auth.uid() = user_id);

-- Calibration outcomes are server-owned. The browser may read them, but
-- cannot forge actual views or calibration weights through PostgREST.
drop policy if exists "calibration_stats_all_own" on public.calibration_stats;
drop policy if exists "calibration_stats_select_own" on public.calibration_stats;
create policy "calibration_stats_select_own" on public.calibration_stats
    for select using (auth.uid() = user_id);

revoke all on public.prediction_log from authenticated;
grant select, insert, delete on public.prediction_log to authenticated;
revoke all on public.calibration_stats from authenticated;
grant select on public.calibration_stats to authenticated;

drop function if exists public.resolve_prediction(uuid, numeric, numeric);

create or replace function public.resolve_prediction(
    p_id uuid,
    p_actual_views numeric
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_uid uuid := auth.uid();
    v_baseline numeric;
    v_format text;
    v_features jsonb;
    v_feature_name text;
    v_feature_value numeric;
    v_feature_bucket text;
    v_actual numeric := greatest(0, coalesce(p_actual_views, 0));
    v_error numeric;
    v_resolved boolean := false;
begin
    if v_uid is null then raise exception 'Not authenticated'; end if;

    select predicted_baseline, format, features
      into v_baseline, v_format, v_features
      from public.prediction_log
     where id = p_id and user_id = v_uid and resolved = false
     for update;

    if not found or coalesce(v_baseline, 0) <= 0 then
        return false;
    end if;

    v_error := greatest(-10, least(10, (v_actual - v_baseline) / v_baseline));

    update public.prediction_log
       set actual_views = v_actual,
           resolved = true,
           error_ratio = v_error,
           resolved_at = now()
     where id = p_id and user_id = v_uid and resolved = false;

    v_resolved := found;
    if not v_resolved then return false; end if;

    insert into public.calibration_stats(
        user_id, dimension_type, dimension_key, sample_count,
        mean_error, mean_abs_error, updated_at
    ) values (
        v_uid, 'global', 'global', 1, v_error, abs(v_error), now()
    ) on conflict (user_id, dimension_type, dimension_key)
    do update set
        mean_error = (public.calibration_stats.mean_error * public.calibration_stats.sample_count + excluded.mean_error)
            / (public.calibration_stats.sample_count + 1),
        mean_abs_error = (public.calibration_stats.mean_abs_error * public.calibration_stats.sample_count + excluded.mean_abs_error)
            / (public.calibration_stats.sample_count + 1),
        sample_count = public.calibration_stats.sample_count + 1,
        updated_at = now();

    insert into public.calibration_stats(
        user_id, dimension_type, dimension_key, sample_count,
        mean_error, mean_abs_error, updated_at
    ) values (
        v_uid, 'format', left(coalesce(v_format, 'unknown'), 120), 1, v_error, abs(v_error), now()
    ) on conflict (user_id, dimension_type, dimension_key)
    do update set
        mean_error = (public.calibration_stats.mean_error * public.calibration_stats.sample_count + excluded.mean_error)
            / (public.calibration_stats.sample_count + 1),
        mean_abs_error = (public.calibration_stats.mean_abs_error * public.calibration_stats.sample_count + excluded.mean_abs_error)
            / (public.calibration_stats.sample_count + 1),
        sample_count = public.calibration_stats.sample_count + 1,
        updated_at = now();

    -- Keep outcome error by feature bucket as well. The buckets are
    -- deliberately coarse (high/low) and are consumed with sample
    -- shrinkage by js_dynamic_weights.js, preventing one outcome from
    -- rewriting contextual weights.
    foreach v_feature_name in array array[
        'trendAlignment',
        'semanticTrendSimilarity',
        'formatStrength',
        'retentionSignal',
        'videoOriginality',
        'competition',
        'creatorTrendsOverlap'
    ] loop
        if jsonb_typeof(v_features -> v_feature_name) = 'number' then
            v_feature_value := (v_features ->> v_feature_name)::numeric;
            v_feature_bucket := case when v_feature_value >= 0.67 then 'high' else 'low' end;

            insert into public.calibration_stats(
                user_id, dimension_type, dimension_key, sample_count,
                mean_error, mean_abs_error, updated_at
            ) values (
                v_uid, 'feature', left(v_feature_name || ':' || v_feature_bucket, 120),
                1, v_error, abs(v_error), now()
            ) on conflict (user_id, dimension_type, dimension_key)
            do update set
                mean_error = (public.calibration_stats.mean_error * public.calibration_stats.sample_count + excluded.mean_error)
                    / (public.calibration_stats.sample_count + 1),
                mean_abs_error = (public.calibration_stats.mean_abs_error * public.calibration_stats.sample_count + excluded.mean_abs_error)
                    / (public.calibration_stats.sample_count + 1),
                sample_count = public.calibration_stats.sample_count + 1,
                updated_at = now();
        end if;
    end loop;

    return true;
end;
$$;

create or replace function public.upsert_calibration_stat(
    p_dimension_type text,
    p_dimension_key text,
    p_sample_count int,
    p_mean_error numeric,
    p_mean_abs_error numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if auth.uid() is null then raise exception 'Not authenticated'; end if;
    if p_dimension_type not in ('global', 'format', 'duration_bucket', 'feature') then
        raise exception 'Invalid dimension type';
    end if;
    insert into public.calibration_stats(
        user_id, dimension_type, dimension_key, sample_count,
        mean_error, mean_abs_error, updated_at
    ) values (
        auth.uid(), p_dimension_type, left(p_dimension_key, 120),
        greatest(0, p_sample_count), p_mean_error, p_mean_abs_error, now()
    )
    on conflict (user_id, dimension_type, dimension_key)
    do update set sample_count = excluded.sample_count,
                  mean_error = excluded.mean_error,
                  mean_abs_error = excluded.mean_abs_error,
                  updated_at = now();
end;
$$;

revoke all on function public.resolve_prediction(uuid, numeric) from public;
revoke all on function public.upsert_calibration_stat(text, text, int, numeric, numeric) from public;
revoke execute on function public.upsert_calibration_stat(text, text, int, numeric, numeric) from authenticated;
grant execute on function public.resolve_prediction(uuid, numeric) to authenticated;