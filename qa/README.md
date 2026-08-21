# QA — test before you deploy

Three layers, fastest first. Run them **before `./deploy.sh`**.

| Layer | What it checks | Command | Needs |
|-------|----------------|---------|-------|
| **Unit** | Pure logic — money formatting, template substitution (the `e+23` class of bug) | `cd functions/api && npm test` | nothing |
| **API smoke** | Backend guards — fee caps reject garbage, no bad values in data | `X_AUTH_TOKEN=… node qa/api-smoke.mjs` | a session token |
| **Browser e2e** | Every module loads, no horizontal scroll (mobile), no bad text | `cd qa && npx playwright test` | one throwaway login |

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
