-- ===========================================================================
-- MULTI-USER MODE — two private accounts, each sees only their own expenses.
-- ===========================================================================
-- Moves the app from single-owner to per-user. Each expense is owned by the
-- user who created it (user_id = auth.uid()); RLS lets each person read/write
-- only their own rows. The passcode store becomes one row per user.
--
-- Allowed users (edit here + in the OWNER_USERS function secret + the app's
-- EXPO_PUBLIC_APP_USERS env to add/remove people):
--   donaldtlui@gmail.com   (Donald)   id 80194d8b-ad9a-404e-a4e8-5f183006d867
--   grantiana.ko@gmail.com (Grantiana)
-- ===========================================================================

-- --- expenses: add per-row ownership ---------------------------------------
alter table public.expenses
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

-- Backfill existing rows to Donald (the only user until now).
update public.expenses
  set user_id = '80194d8b-ad9a-404e-a4e8-5f183006d867'
  where user_id is null;

alter table public.expenses alter column user_id set default auth.uid();
alter table public.expenses alter column user_id set not null;

create index if not exists expenses_user_idx on public.expenses (user_id, date desc);

-- --- expenses RLS: each user sees only their own ---------------------------
alter table public.expenses enable row level security;

drop policy if exists "owner read expenses"   on public.expenses;
drop policy if exists "owner insert expenses" on public.expenses;
drop policy if exists "owner update expenses" on public.expenses;
drop policy if exists "owner delete expenses" on public.expenses;
drop policy if exists "open read expenses"    on public.expenses;
drop policy if exists "open insert expenses"  on public.expenses;
drop policy if exists "open update expenses"  on public.expenses;
drop policy if exists "open delete expenses"  on public.expenses;
drop policy if exists "own read expenses"     on public.expenses;
drop policy if exists "own insert expenses"   on public.expenses;
drop policy if exists "own update expenses"   on public.expenses;
drop policy if exists "own delete expenses"   on public.expenses;

create policy "own read expenses"
  on public.expenses for select to authenticated using (user_id = auth.uid());
create policy "own insert expenses"
  on public.expenses for insert to authenticated with check (user_id = auth.uid());
create policy "own update expenses"
  on public.expenses for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own delete expenses"
  on public.expenses for delete to authenticated using (user_id = auth.uid());

-- --- receipt photos: both users may write (read stays public) --------------
drop policy if exists "owner insert receipt photos" on storage.objects;
drop policy if exists "owner update receipt photos" on storage.objects;
drop policy if exists "owner delete receipt photos" on storage.objects;
drop policy if exists "open insert receipt photos"  on storage.objects;
drop policy if exists "open update receipt photos"  on storage.objects;
drop policy if exists "open delete receipt photos"  on storage.objects;
drop policy if exists "users insert receipt photos" on storage.objects;
drop policy if exists "users update receipt photos" on storage.objects;
drop policy if exists "users delete receipt photos" on storage.objects;

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

-- --- per-user passcode store ------------------------------------------------
create table if not exists public.user_passcode (
  email           text primary key,
  passcode_hash   text,
  salt            text,
  iterations      integer not null default 200000,
  failed_attempts integer not null default 0,
  locked_until    timestamptz,
  updated_at      timestamptz not null default now()
);

-- Migrate Donald's existing passcode from the old single-row app_lock.
insert into public.user_passcode (email, passcode_hash, salt, iterations)
select 'donaldtlui@gmail.com', passcode_hash, salt, coalesce(iterations, 200000)
from public.app_lock
where id = 'expense' and passcode_hash is not null
on conflict (email) do update
  set passcode_hash = excluded.passcode_hash,
      salt = excluded.salt,
      iterations = excluded.iterations;

-- Grantiana has no passcode yet (she'll set one on first run).
insert into public.user_passcode (email) values ('grantiana.ko@gmail.com')
on conflict (email) do nothing;

alter table public.user_passcode enable row level security;
-- (no policies: only the passcode Edge Function, via service role, touches it)

drop table if exists public.app_lock;
