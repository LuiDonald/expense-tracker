-- ===========================================================================
-- OPEN MODE (TEMPORARY, FOR TESTING) — expense tracker
-- ===========================================================================
-- This replaces the owner-only Row Level Security on the `expenses` table and
-- the receipt-photos bucket with PERMISSIVE policies so the app works without
-- anyone logging in. While this is applied, ANYONE with the anon key / app URL
-- can read, add, edit, and delete expenses and upload/delete receipt photos.
--
-- To RE-LOCK later: run supabase/schema.sql again (it drops these policies and
-- re-creates the owner-only ones). See README "Locking it back down".
-- ===========================================================================

alter table public.expenses enable row level security;

-- Drop the owner-only policies (if present)...
drop policy if exists "owner read expenses"   on public.expenses;
drop policy if exists "owner insert expenses" on public.expenses;
drop policy if exists "owner update expenses" on public.expenses;
drop policy if exists "owner delete expenses" on public.expenses;
-- ...and any previous open policies, so this script is idempotent.
drop policy if exists "open read expenses"   on public.expenses;
drop policy if exists "open insert expenses" on public.expenses;
drop policy if exists "open update expenses" on public.expenses;
drop policy if exists "open delete expenses" on public.expenses;

create policy "open read expenses"
  on public.expenses for select to anon, authenticated using (true);
create policy "open insert expenses"
  on public.expenses for insert to anon, authenticated with check (true);
create policy "open update expenses"
  on public.expenses for update to anon, authenticated using (true) with check (true);
create policy "open delete expenses"
  on public.expenses for delete to anon, authenticated using (true);

-- Receipt-photos bucket: read is already public; open up writes for testing.
drop policy if exists "owner insert receipt photos" on storage.objects;
drop policy if exists "owner update receipt photos" on storage.objects;
drop policy if exists "owner delete receipt photos" on storage.objects;
drop policy if exists "open insert receipt photos" on storage.objects;
drop policy if exists "open update receipt photos" on storage.objects;
drop policy if exists "open delete receipt photos" on storage.objects;

create policy "open insert receipt photos"
  on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'receipt-photos');
create policy "open update receipt photos"
  on storage.objects for update to anon, authenticated
  using (bucket_id = 'receipt-photos');
create policy "open delete receipt photos"
  on storage.objects for delete to anon, authenticated
  using (bucket_id = 'receipt-photos');
