-- Parental / guardian consent columns on students (DPDP).
--
-- schema.sql already defines these for FRESH installs. This file adds them to
-- an EXISTING Supabase database. Run once in the Supabase SQL editor (or psql):
--
--   (Supabase dashboard) → SQL Editor → paste → Run
--
-- Safe to re-run: every statement uses IF NOT EXISTS.

alter table students add column if not exists consent_at      timestamptz;
alter table students add column if not exists consent_source  text default '';
alter table students add column if not exists consent_version text default '';
