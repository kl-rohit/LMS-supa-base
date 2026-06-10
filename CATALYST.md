# Veena on Catalyst by Zoho

Scaffold for deploying Veena to Zoho Catalyst.

## Architecture

| Layer    | Catalyst Service          | Source                    |
|----------|---------------------------|---------------------------|
| API      | AdvancedIO Function `api` | `functions/api/`          |
| Database | Data Store                | tables created via script |
| Frontend | Web Client Hosting        | `client/dist/`            |

## One-time setup

### 1. Install Catalyst CLI

```bash
npm install -g zcatalyst-cli
catalyst -v
```

### 2. Login

```bash
catalyst login
```

This opens your browser. Sign in with the Zoho account that owns the project.

### 3. Create a Catalyst project

In the [Catalyst console](https://console.catalyst.zoho.com), click **Create Project** → choose a name (e.g. `Veena`) → note the **Project ID**.

### 4. Bind this repo to the project

From the repo root:

```bash
catalyst init
```

Answer the prompts:
- **Project**: pick the project you just created.
- **Environment**: `development`.
- **Components**: select `Functions` and `Web Client Hosting`.

This will update `catalyst.json` with the real project id, console domain, and any data center suffix (`.in`, `.eu`, `.com.au`).

### 5. Create the Data Store tables

Your project is configured: **Project ID `34954000000015001`, India DC**.
The scripts default to these values, so you only need to provide the OAuth token.

Get a Self Client OAuth token:
1. Open https://console.catalyst.zoho.in → your project → **Settings** → **API Console**.
2. Click **Self Client** → **Create Self Client** if not already done.
3. **Generate Token** tab → scope: `ZohoCatalyst.tables.CREATE,ZohoCatalyst.tables.row.CREATE,ZohoCatalyst.tables.row.READ`.
4. Set scope's portal/`prefix-name` to your project's portal id. Token lasts ~1 hour.

Then run (IN DC, project id are the defaults — only `ZOHO_OAUTH_TOKEN` is required):

```bash
ZOHO_OAUTH_TOKEN="1000.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.yyyyyyyyy" \
node scripts/create-catalyst-tables.js
```

This creates 9 tables: Students, Groups, GroupStudents, Classes, ClassStudents, Attendance, AdditionalFees, Messages, Settings.

### 6. Migrate existing SQLite data (optional)

```bash
ZOHO_OAUTH_TOKEN="1000.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.yyyyyyyyy" \
node scripts/migrate-sqlite-to-catalyst.js
```

After migration, the `legacy_id` columns let you fix foreign keys (one-time pass).

## Develop locally against Catalyst

```bash
catalyst serve
```

This boots the function on `http://localhost:3000` and proxies the client.

## Deploy

```bash
# Build the React client
npm run build --prefix client

# Deploy everything (function + client)
catalyst deploy
```

Once deployed, Catalyst gives you a URL like `https://veena-<id>.development.catalystserverless.com/`.

## Required code changes (NOT yet done)

The scaffold is ready, but the Express routes still use SQLite. You need to port each route file from `db.prepare(SQL).run/get/all` to the Catalyst Data Store helpers in `functions/api/db/catalystDb.js`. Per the SDK:

```js
// Before (SQLite)
const student = db.prepare('SELECT * FROM students WHERE id = ?').get(id);

// After (Catalyst)
const { getById } = require('../db/catalystDb');
const student = await getById('Students', id, req.catalystApp);
```

Routes that JOIN tables (e.g. `attendance` joining `classes` and `students`) must be split into multiple fetches and stitched in JS, since Data Store has no SQL JOINs. For aggregation (SUM, GROUP BY), use ZCQL via `catalystDb.zcql(query)`.

## Known limitations of this scaffold

1. **SQLite is not durable on Catalyst.** The current `functions/api/db/schema.js` opens a SQLite file. On Catalyst this writes to `/tmp` which is wiped on cold starts. You MUST migrate to Data Store before running in production.
2. **No transactions.** Data Store does not support multi-row transactions. Routes that wrap inserts in `db.transaction(...)` will need to handle partial failures explicitly.
3. **`legacy_id` foreign keys.** The migration preserves old SQLite ids in `legacy_*` columns. After data migration, write a one-time fixup script to map `legacy_student_id` → the new Catalyst ROWID for every Attendance / AdditionalFees / Messages row. Alternatively, keep using the `legacy_id` columns as the join key and skip the fixup.
4. **No file/email sending.** If routes need to send SMS/email, switch to Catalyst's Mail / Push services or external APIs.
