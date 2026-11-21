-- ===========================================================================
-- PRIVATE RECEIPT PHOTOS — run once on the live project (already-set-up DB).
-- ===========================================================================
-- Before: the receipt-photos bucket was public, so anyone with a photo's URL
-- could open the receipt without logging in.
-- After: the bucket is private. A signed-in user can read a photo only if
--   (a) they uploaded it (storage sets owner_id to the uploader), or
--   (b) it is attached to one of their own expenses.
-- The app shows photos through short-lived signed URLs (createSignedUrl).
-- Muse's agent-api uses the service role and is unaffected.
--
-- Safe to re-run. schema-fresh.sql already contains this for new projects.
-- ===========================================================================

update storage.buckets set public = false where id = 'receipt-photos';

drop policy if exists "public read receipt photos"    on storage.objects;
drop policy if exists "users read own receipt photos" on storage.objects;

create policy "users read own receipt photos"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'receipt-photos'
    and (
      owner_id = (select auth.uid())::text
      or exists (
        select 1 from public.expenses e
        where e.user_id = (select auth.uid())
          and right(e.photo_url, length('/receipt-photos/' || objects.name))
              = '/receipt-photos/' || objects.name
      )
    )
  );
