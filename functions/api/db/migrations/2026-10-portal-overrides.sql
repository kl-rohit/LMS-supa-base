-- Per-student parent-portal visibility overrides.
--
-- Adds students.portal_overrides — a JSON string of { <tab>: 'on'|'off' } that
-- lets an admin show or hide individual portal tabs for one child, overriding
-- the academy-wide portal.* settings. Empty string = inherit the academy
-- defaults (the normal case). See routes/portal.js portalVisible().
--
-- schema.sql already defines this for FRESH installs. This file adds it to an
-- EXISTING Supabase database. Run once in the Supabase SQL editor (or psql):
--
--   (Supabase dashboard) → SQL Editor → paste → Run
--
-- Safe to re-run: the statement uses IF NOT EXISTS.

alter table students add column if not exists portal_overrides text default '';
