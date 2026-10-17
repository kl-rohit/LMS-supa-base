-- Per-charge collection tracking on additional fees.
--
-- Adds three columns to additionalfees:
--   collected    — 0/1, whether this specific charge has been collected
--   collected_at — when it was marked collected
--   program_id   — links a charge created by a Program's "Bill participants" to
--                  that program, so collection can be toggled per student/program
--                  and shown in the Programs roster, the Fees section and the
--                  parent portal from one source of truth.
--
-- schema.sql already defines these for FRESH installs. This file adds them to an
-- EXISTING Supabase database. Run once in the Supabase SQL editor (or psql):
--
--   (Supabase dashboard) → SQL Editor → paste → Run
--
-- Safe to re-run: every statement uses IF NOT EXISTS.

alter table additionalfees add column if not exists collected    integer default 0;
alter table additionalfees add column if not exists collected_at  timestamptz;
alter table additionalfees add column if not exists program_id    bigint;
create index if not exists idx_addfees_program on additionalfees (program_id);
