-- Per-student itinerary notes on a program's roster.
--
-- Adds programstudents.notes — a short note the academy writes for one student
-- in one program (e.g. "song: Vatapi Ganapatim", "arrive 30 min early",
-- "slot 3"). Shown to that student's parent in the portal Programs tab.
--
-- schema.sql already defines this for FRESH installs. This file adds it to an
-- EXISTING Supabase database. Run once in the Supabase SQL editor (or psql):
--
--   (Supabase dashboard) → SQL Editor → paste → Run
--
-- Safe to re-run: the statement uses IF NOT EXISTS.

alter table programstudents add column if not exists notes text default '';
