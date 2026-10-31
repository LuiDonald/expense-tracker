-- ===========================================================================
-- PASSCODE MODE — re-lock the app to owner-only + add the passcode store.
-- ===========================================================================
-- Run this to move from "open mode" back to a secured app. The app is unlocked
-- by a passcode, which mints a real owner session, so the data is protected by
-- owner-only Row Level Security again. The passcode itself lives in app_lock,
-- which ONLY the edge function (service role) can touch.
-- ===========================================================================

-- --- expenses: drop the open policies, restore owner-only -------------------
alter table public.expenses enable row level security;

drop policy if exists "open read expenses"   on public.expenses;
drop policy if exists "open insert expenses" on public.expenses;
drop policy if exists "open update expenses" on public.expenses;
drop policy if exists "open delete expenses" on public.expenses;

drop policy if exists "owner read expenses"   on public.expenses;
drop policy if exists "owner insert expenses" on public.expenses;
drop policy if exists "owner update expenses" on public.expenses;
drop policy if exists "owner delete expenses" on public.expenses;

create policy "owner read expenses"
  on public.expenses for select to authenticated
  using (lower(auth.jwt() ->> 'email') = 'donaldtlui@gmail.com');
create policy "owner insert expenses"
  on public.expenses for insert to authenticated
  with check (lower(auth.jwt() ->> 'email') = 'donaldtlui@gmail.com');
create policy "owner update expenses"
  on public.expenses for update to authenticated
  using (lower(auth.jwt() ->> 'email') = 'donaldtlui@gmail.com')
  with check (lower(auth.jwt() ->> 'email') = 'donaldtlui@gmail.com');
create policy "owner delete expenses"
  on public.expenses for delete to authenticated
  using (lower(auth.jwt() ->> 'email') = 'donaldtlui@gmail.com');

-- --- receipt photos: drop open write policies, restore owner-only -----------
drop policy if exists "open insert receipt photos" on storage.objects;
drop policy if exists "open update receipt photos" on storage.objects;
drop policy if exists "open delete receipt photos" on storage.objects;

drop policy if exists "owner insert receipt photos" on storage.objects;
drop policy if exists "owner update receipt photos" on storage.objects;
drop policy if exists "owner delete receipt photos" on storage.objects;

create policy "owner insert receipt photos"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'receipt-photos'
    and lower(auth.jwt() ->> 'email') = 'donaldtlui@gmail.com');
create policy "owner update receipt photos"
  on storage.objects for update to authenticated
  using (bucket_id = 'receipt-photos'
    and lower(auth.jwt() ->> 'email') = 'donaldtlui@gmail.com');
create policy "owner delete receipt photos"
  on storage.objects for delete to authenticated
  using (bucket_id = 'receipt-photos'
    and lower(auth.jwt() ->> 'email') = 'donaldtlui@gmail.com');

-- --- app_lock: the passcode store -------------------------------------------
-- One row. RLS is ON with NO policies, so neither anon nor authenticated users
-- can read or write it from the client — only the `passcode` edge function
-- (service role, which bypasses RLS) ever touches it. The hash is never
-- exposed to the browser.
create table if not exists public.app_lock (
  id              text primary key default 'expense',
  passcode_hash   text,                         -- PBKDF2-SHA256 hex, null until set
  salt            text,                         -- per-record salt (hex)
  iterations      integer not null default 200000,
  failed_attempts integer not null default 0,
  locked_until    timestamptz,                  -- brute-force lockout window
  updated_at      timestamptz not null default now()
);

insert into public.app_lock (id) values ('expense') on conflict (id) do nothing;

alter table public.app_lock enable row level security;
-- (intentionally no policies — client roles get zero access)
