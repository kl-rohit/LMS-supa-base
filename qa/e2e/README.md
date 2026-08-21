# e2e tests (Playwright)

Browser tests that exercise the live app across every module. The headline
check is **no horizontal scroll** on mobile — the automated version of the
manual PWA sweep — plus a guard that no rupee value ever renders in scientific
notation.

## First-time setup

```bash
cd qa
npm i -D @playwright/test
npx playwright install chromium
node create-auth.js          # opens a browser; log in once → saves .auth/state.json
```

`.auth/state.json` holds your logged-in session (gitignored). Regenerate it with
`node create-auth.js` whenever it expires (a test failure saying "session
expired" is the signal).

> ⚠️ **Always create a dedicated session with `create-auth.js`. Do NOT export /
> copy the token from a browser you're actively using.** Supabase rotates refresh
> tokens, so two clients sharing one session invalidate each other — running the
> suite against a copied live token will log you out of that live browser. A
> throwaway login via `create-auth.js` avoids this entirely.

## Run

```bash
npx playwright test                     # mobile (Pixel 5), serial — the default
PW_DESKTOP=1 npx playwright test        # desktop viewport instead (run separately)
PLAYWRIGHT_BASE_URL=http://localhost:8080 npx playwright test   # against a local build
```

The suite runs **serial (1 worker), one viewport per invocation** on purpose:
all specs share one Supabase session, and parallel contexts rotate/invalidate
each other's token (→ bounce to landing). Run mobile and desktop as separate
commands, never together.

## What's covered
- Every module route loads without erroring or bouncing to login.
- No page scrolls horizontally (mobile + desktop).
- No money value leaks scientific notation on Messages.

Rules these tests assert against live in [`../module-rules.md`](../module-rules.md).
Add a test whenever you add a rule.

## Not covered yet (follow-ups)
- Client-side validators (needs a Vitest/babel setup because `validation.js` is ESM/JSX-adjacent).
- Write flows (create/edit) — kept read-only for now so tests don't mutate live data.
