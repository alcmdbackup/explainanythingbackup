-- Prod schema_migrations cleanup: remove duplicate migration entries.
-- Run this manually via Supabase SQL Editor on prod (qbxhivoezkfbjbsctdzo)
-- AFTER the 20260322 migrations have been deployed.
--
-- These are duplicate entries created during a botched manual migration repair.
-- They do not correspond to actual migration files and are purely cosmetic clutter.

DELETE FROM supabase_migrations.schema_migrations
WHERE version IN (
  -- Duplicates of 20260224-20260304 (renumbered as 20260304000004-18)
  '20260304000004',
  '20260304000005',
  '20260304000006',
  '20260304000007',
  '20260304000008',
  '20260304000009',
  '20260304000010',
  '20260304000011',
  '20260304000012',
  '20260304000013',
  '20260304000014',
  '20260304000015',
  '20260304000016',
  '20260304000017',
  '20260304000018',
  -- Duplicates of 20260306-20260309 migrations
  '20260306000003',
  '20260306000004',
  '20260307000002',
  '20260307000003',
  '20260307000004',
  '20260309000003',
  '20260309000004',
  '20260309000005',
  '20260309000006',
  '20260309000007'
);

-- Verify: should show no duplicates
SELECT version, name, count(*) FROM supabase_migrations.schema_migrations
GROUP BY version, name HAVING count(*) > 1;
