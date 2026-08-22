# QA — test before you deploy

## Strategy (what we automate, and why)
At pilot scale the goal is **maximum safety per unit of maintenance**:

- **Automated (run every deploy):** unit tests · **API CRUD for all modules**
  (the real safety net — data, validation, business rules) · UI **smoke** sweep
  (loads, no horizontal scroll, no bad values) · **one** UI CRUD canary
  (Students) proving the screens genuinely work end to end.
- **Manual (pre-deploy checklist):** per-screen create/edit/delete for the other
  modules — see the `[manual]` scenarios in `e2e-scenarios.md` (~3 min).

Full UI CRUD for every module is **intentionally not automated**: UI specs are
brittle (labels, breakpoints, dual table/card renders, validation) and cost far
more to maintain than they catch once the API layer already covers the logic.
Automate another UI flow only if a specific screen keeps regressing.

---

Three layers, fastest first. Run them **before `./deploy.sh`**.

| Layer | What it checks | Command | Needs |
|-------|----------------|---------|-------|
| **Unit** | Pure logic — money formatting, template substitution (the `e+23` class of bug) | `cd functions/api && npm test` | nothing |
| **API smoke** | Backend guards — fee caps reject garbage, no bad values in data | `X_AUTH_TOKEN=… npm run smoke:api` | a session token |
| **API CRUD** | **Full create→read→update→delete across every module** (self-cleaning) | `X_AUTH_TOKEN=… npm run crud:api` | a session token, **TEST org** |
| **Browser e2e** | Every module loads, no horizontal scroll (mobile), no bad text | `npm run e2e` | one throwaway login |
| **Browser CRUD** | Screen-level create/edit/delete for the critical modules | `npm run e2e -- crud.spec.js` | throwaway login, **TEST org** |

> API/Browser **CRUD write and delete real data** — run them against a TEST org
> only. They tag every record and tear it down, but don't point them at prod.
> `npm run …` commands are defined in `qa/package.json`; run from `qa/`.

- **Scenario catalog + pre-deploy checklist:** [`e2e-scenarios.md`](./e2e-scenarios.md) — the authoritative list, incl. the `[manual]` smoke steps and a table mapping every past bug to the scenario that catches a relapse.
- **Playwright setup (throwaway login):** [`e2e/README.md`](./e2e/README.md). Do **not** reuse a live session.

## Getting a token for `api-smoke.mjs`
In the app, DevTools → Console:
```js
JSON.parse(localStorage.veena_auth).access_token
```
Copy it into `X_AUTH_TOKEN`. Tokens last ~1 hour.

## Suggested pre-deploy one-liner
```bash
(cd functions/api && npm test) && (cd qa && npx playwright test) && echo "GATES GREEN — safe to deploy"
```
Then run the `[manual]` smoke scenarios and record a line in the "Sample run log"
in `e2e-scenarios.md`.
