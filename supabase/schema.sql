-- Expense tracker — Supabase schema
-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor > New query).
--
-- IMPORTANT: this is a PRIVATE app. Replace every occurrence of
-- 'donaldtlui@gmail.com' below with YOUR owner email (lowercase) before
-- running — it is baked into the security policies, which only let that one
-- account read or write anything.

-- Enable UUID generation (pgcrypto ships with Supabase).
create extension if not exists "pgcrypto";

create table if not exists public.expenses (
  id          uuid primary key default gen_random_uuid(),
  merchant    text not null default '',
  amount      numeric(12,2) not null default 0,
  category    text not null default '',
  date        date not null default (now() at time zone 'utc')::date,
  note        text not null default '',
  photo_url   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists expenses_date_idx
  on public.expenses (date desc);

create index if not exists expenses_category_idx
  on public.expenses (category);

-- ---------------------------------------------------------------------------
-- Row Level Security — PRIVATE: only the owner can read OR write.
-- ---------------------------------------------------------------------------
alter table public.expenses enable row level security;

drop policy if exists "owner read expenses" on public.expenses;
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

-- auto-touch updated_at on update (uniquely named so it can safely coexist
-- with other apps/tables in the same Supabase project, e.g. the Recipe app).
create or replace function public.expenses_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists expenses_touch_updated_at on public.expenses;
create trigger expenses_touch_updated_at
  before update on public.expenses
  for each row execute function public.expenses_set_updated_at();

-- ---------------------------------------------------------------------------
-- Storage bucket for receipt photos.
-- ---------------------------------------------------------------------------
-- The bucket is PUBLIC-read so the app can render images via a plain URL, but
-- object names are long random strings, and uploads/edits/deletes are
-- owner-only. The sensitive structured data (amounts, merchants, categories)
-- lives in the `expenses` table above, which is fully locked to the owner.
-- If you want receipts to be unlistable/unguessable too, switch this to a
-- private bucket and use signed URLs (see the README).

insert into storage.buckets (id, name, public)
values ('receipt-photos', 'receipt-photos', true)
on conflict (id) do nothing;

drop policy if exists "public read receipt photos" on storage.objects;
drop policy if exists "owner insert receipt photos" on storage.objects;
drop policy if exists "owner update receipt photos" on storage.objects;
drop policy if exists "owner delete receipt photos" on storage.objects;

create policy "public read receipt photos"
  on storage.objects for select
  using (bucket_id = 'receipt-photos');

create policy "owner insert receipt photos"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'receipt-photos'
    and lower(auth.jwt() ->> 'email') = 'donaldtlui@gmail.com'
  );

create policy "owner update receipt photos"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'receipt-photos'
    and lower(auth.jwt() ->> 'email') = 'donaldtlui@gmail.com'
  );

create policy "owner delete receipt photos"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'receipt-photos'
    and lower(auth.jwt() ->> 'email') = 'donaldtlui@gmail.com'
  );
