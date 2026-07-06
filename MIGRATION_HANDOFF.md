# VidyaSetu — Supabase Migration: Handover & Operations Runbook

The app (multi-tenant academy SaaS) has moved its **database, auth, and file
storage to Supabase**, frontend to **Netlify**, with the **backend still running
on Catalyst** (Advanced I/O function, talking to Supabase via a rewritten
`db/catalystDb.js`). This doc is the single source of truth for the current
state and how to operate / cut a real academy over.

## Architecture (current)

| Layer | Where | Notes |
|---|---|---|
| Frontend (React SPA) | **Netlify** | `academy-management.netlify.app`; builds from git `main` (`base=client`, `build:netlify`) |
| Backend (Node/Express) | **Catalyst** Advanced I/O | deploy with `./deploy.sh`; Netlify proxies `/api/*` here |
| Database | **Supabase Postgres** | `db/schema.sql` (30 tables); bigint PKs, `org_id`, `source_id` |
| Auth | **Supabase Auth** (ES256 JWT) | `lib/supabaseAuth.js`; verified via Supabase JWKS |
| File storage | **Supabase Storage** | `lib/supabaseStorage.js`; photos resized to 512px / q72 |

## Migration status

- ✅ Phases 0–4, 6 (setup, schema, data-access, auth, storage, Netlify) — done.
- ✅ Phase 7 mechanics — Export / Import / Purge / Photos built, fixed, verified
  (a dry-run academy migrated cleanly; row counts matched, photos confirmed).
- ⏳ Phase 5 — schedule the 4 cron jobs (below). Handlers exist; only the
  external schedule is outstanding.
- 🅿️ Parked by choice — Cloud Run (staying on Catalyst), custom domain, and the
  fire-and-forget job queue.

## Cron setup (Supabase Cron — 4 jobs)

Handlers live in `routes/internal.js`, secured by the `X-Cron-Secret` header
(value is `CRON_SECRET` in `functions/api/catalyst-config.json` — never commit
it). Schedule them in **Supabase Dashboard → Integrations → Cron**, or paste the
SQL below into the SQL editor. Substitute the real secret for `<CRON_SECRET>`.
Cron times are **UTC**; the comments show the IST intent.

```sql
-- Fee reminder — daily 08:00 IST (self-checks each academy's reminder day)
select cron.schedule('fee-reminder', '30 2 * * *', $$
  select net.http_get(
    url := 'https://academy-management.netlify.app/api/internal/cron-fee-reminder',
    headers := '{"X-Cron-Secret":"<CRON_SECRET>"}'::jsonb) $$);

-- Morning class digest — daily 06:30 IST
select cron.schedule('morning-digest', '0 1 * * *', $$
  select net.http_get(
    url := 'https://academy-management.netlify.app/api/internal/cron-morning-digest',
    headers := '{"X-Cron-Secret":"<CRON_SECRET>"}'::jsonb) $$);

-- Notification cleanup — weekly, Sunday 07:00 IST
select cron.schedule('cleanup-notifications', '30 1 * * 0', $$
  select net.http_get(
    url := 'https://academy-management.netlify.app/api/internal/cron-cleanup-notifications',
    headers := '{"X-Cron-Secret":"<CRON_SECRET>"}'::jsonb) $$);

-- Per-org backup — weekly, Sunday 06:00 IST (your real safety net on the Free
-- tier, which has no self-serve restore; drop once on Pro's 7-day backups)
select cron.schedule('backup', '30 0 * * 0', $$
  select net.http_get(
    url := 'https://academy-management.netlify.app/api/internal/cron-backup',
    headers := '{"X-Cron-Secret":"<CRON_SECRET>"}'::jsonb) $$);
```

Dropped on purpose: `cron-weekly-digest` (low value; re-enable later if wanted).
Requires the `pg_cron` and `pg_net` extensions (enable once in the dashboard).
`net.http_get` fires async and doesn't block on the response — expected.

## Cutover runbook (flip a real academy)

1. **Export from the source** (old Catalyst app): Settings → Backup & migrate →
   **Export everything** → save the JSON bundle (includes base64 photos).
2. **Prep the destination org** on the Supabase stack (fresh org via signup, or
   an existing empty one). If it has partial/old data: **Delete all data**
   (now deletes from Supabase correctly) or clear it in the SQL editor.
3. **Import everything** → pick the bundle. Runs module-by-module with a live
   progress bar; photos upload last; a completion popup summarizes the run.
4. **Verify**: row counts vs the source; open a few students (photos load);
   attendance / fees look right. Re-export and compare counts if you want proof.
5. **Relink parent logins** (auth doesn't migrate — see below): Settings →
   Parent Logins. For each migrated student that had a login, its old Catalyst
   `login_user_id` is stale, so: **unlink** it, then **create** a fresh login →
   share the returned temp password with the parent (e.g. WhatsApp). No email
   needed, so deliverability/domain is not a blocker here.
6. **Owner/admin**: already has a Supabase account from signup — no action.

## Gotchas (read before editing/deploying)

- **`functions/api/config.js` is GENERATED** from `config.master.js` — edit the
  master, not the generated file (a deploy will overwrite hand edits).
- **Deploy with `./deploy.sh`** (foreground). It builds the client, regenerates
  configs, stamps the git SHA into `/api/health`, and runs `catalyst deploy`.
  Verify with `curl .../api/health` — the `commit` should match.
- **Netlify frontend builds from git push**, NOT from `./deploy.sh`. Backend and
  frontend deploy by different paths: `./deploy.sh` updates the Catalyst-hosted
  copy + backend; a `git push` to `main` rebuilds the Netlify frontend.
- **Secrets** live only in `functions/api/catalyst-config.json` (gitignored);
  `catalyst deploy` wipes any Console-set env vars not in that file.
- **17-digit IDs are strings** — never `Number()` a ROWID / `source_id` (use
  `safeId`). `org_id` is the exception: it stays a small JS number, and the
  importer re-stamps it — relationships survive via `source_id`, not `org_id`.
- **Auth users are NOT migrated** (Organizations/OrgMemberships excluded by
  design) — hence the relink step above.

## Backups

Supabase **Free tier has no self-serve restore**; managed daily backups (7-day
retention) start at **Pro** ($25/mo), longer/point-in-time is a paid add-on.
Until then the `cron-backup` job (per-org JSON to Storage) is the safety net.
Also: **Free projects pause after ~7 days idle** — the daily crons hitting the
DB keep it active.
