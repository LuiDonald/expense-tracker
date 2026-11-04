-- ===========================================================================
-- FRESH PROJECT SCHEMA — a dedicated Supabase project for the Expense app.
-- ===========================================================================
-- Builds the final multi-user state in a single run (skips the historical
-- app_lock step). Structure only — expense rows, passcodes, and auth users are
-- migrated in separately AFTER this runs, so no data is lost from the old
-- (shared) project, which is left completely untouched as a backup.
--
-- Allowed users (keep in sync with OWNER_USERS secret + EXPO_PUBLIC_APP_USERS):
--   donaldtlui@gmail.com   (Donald)
--   grantiana.ko@gmail.com (Grantiana)
-- ===========================================================================

create extension if not exists "pgcrypto";

-- --- expenses (owned per-user) ---------------------------------------------
create table if not exists public.expenses (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  merchant    text not null default '',
  amount      numeric(12,2) not null default 0,
  category    text not null default '',
  date        date not null default (now() at time zone 'utc')::date,
  note        text not null default '',
  photo_url   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists expenses_user_idx     on public.expenses (user_id, date desc);
create index if not exists expenses_date_idx      on public.expenses (date desc);
create index if not exists expenses_category_idx  on public.expenses (category);

alter table public.expenses enable row level security;

create policy "own read expenses"
  on public.expenses for select to authenticated using (user_id = auth.uid());
create policy "own insert expenses"
  on public.expenses for insert to authenticated with check (user_id = auth.uid());
create policy "own update expenses"
  on public.expenses for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own delete expenses"
  on public.expenses for delete to authenticated using (user_id = auth.uid());

create or replace function public.expenses_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists expenses_touch_updated_at on public.expenses;
create trigger expenses_touch_updated_at
  before update on public.expenses
  for each row execute function public.expenses_set_updated_at();

-- --- receipt photos bucket (public read, both users may write) -------------
insert into storage.buckets (id, name, public)
  values ('receipt-photos', 'receipt-photos', true)
  on conflict (id) do nothing;

create policy "public read receipt photos"
  on storage.objects for select using (bucket_id = 'receipt-photos');
create policy "users insert receipt photos"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'receipt-photos'
    and lower(auth.jwt() ->> 'email') in ('donaldtlui@gmail.com','grantiana.ko@gmail.com'));
create policy "users update receipt photos"
  on storage.objects for update to authenticated
  using (bucket_id = 'receipt-photos'
    and lower(auth.jwt() ->> 'email') in ('donaldtlui@gmail.com','grantiana.ko@gmail.com'));
create policy "users delete receipt photos"
  on storage.objects for delete to authenticated
  using (bucket_id = 'receipt-photos'
    and lower(auth.jwt() ->> 'email') in ('donaldtlui@gmail.com','grantiana.ko@gmail.com'));

-- --- per-user passcode store (service-role only) ---------------------------
create table if not exists public.user_passcode (
  email           text primary key,
  passcode_hash   text,
  salt            text,
  iterations      integer not null default 200000,
  failed_attempts integer not null default 0,
  locked_until    timestamptz,
  updated_at      timestamptz not null default now()
);
alter table public.user_passcode enable row level security;
-- (no policies — only the passcode Edge Function, via service role, touches it)
