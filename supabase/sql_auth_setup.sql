-- ==========================================================
-- BRAWL ANALYTICS
-- AUTH SETUP (Supabase)
--
-- Da eseguire UNA VOLTA nel SQL Editor di Supabase, DOPO
-- sql_subscription_schema.sql (la tabella "profiles" deve già
-- esistere). Idempotente: può essere rieseguito senza errori.
-- ==========================================================

-- ----------------------------------------------------------
-- 1. Nuove colonne su "profiles"
-- ----------------------------------------------------------
alter table public.profiles
    add column if not exists email text,
    add column if not exists stripe_customer_id text,
    add column if not exists stripe_subscription_id text,
    add column if not exists subscription_status text,
    add column if not exists current_period_end timestamptz;

-- ----------------------------------------------------------
-- 2. Creazione automatica del profilo alla registrazione.
--    Trigger su auth.users: mai un insert manuale lato client,
--    che verrebbe comunque bloccato dalla RLS (nessuna policy
--    di insert per "authenticated", vedi punto 4).
-- ----------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.profiles(id, email, plan, created_at)
    values (new.id, new.email, 'free', now())
    on conflict (id) do nothing;

    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- ----------------------------------------------------------
-- 3. Tiene "email" sincronizzata se l'utente la cambia da Auth
-- ----------------------------------------------------------
create or replace function public.handle_user_email_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    update public.profiles set email = new.email where id = new.id;
    return new;
end;
$$;

drop trigger if exists on_auth_user_email_updated on auth.users;

create trigger on_auth_user_email_updated
    after update of email on auth.users
    for each row execute function public.handle_user_email_update();

-- ----------------------------------------------------------
-- 4. Row Level Security: ogni utente legge/modifica SOLO la
--    propria riga (auth.uid() = id), mai per email.
-- ----------------------------------------------------------
alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
    for select using (auth.uid() = id);

-- Nessuna policy INSERT/DELETE per "authenticated": la riga
-- nasce solo tramite il trigger e sparisce in cascata con
-- l'utente Auth (on delete cascade, vedi schema base).

-- UPDATE ammesso solo sulla propria riga, e solo sulla colonna
-- "email": revochiamo l'UPDATE generico e concediamo il
-- privilegio a livello di singola colonna, così anche superando
-- la policy RLS un client non può auto-assegnarsi plan="pro" —
-- quei campi restano scrivibili solo dalle funzioni "security definer".
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
    for update using (auth.uid() = id) with check (auth.uid() = id);

revoke update on public.profiles from authenticated;
grant update (email) on public.profiles to authenticated;

grant select on public.profiles to authenticated;