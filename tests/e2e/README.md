# Browser tests

Playwright scripts that drive a running Videmak like a person would: sign up, write, cite, export, pay with Stripe's test cards, and so on. Each prints `PASS` / `FAIL` lines and a total, and most save screenshots to `/shots`.

Run them in Playwright's image on the same Docker network as your stack (here the self-host compose project, whose router is `router:8080`):

```bash
docker run --rm --network videmak_default -v "$PWD/tests/e2e":/e2e -v /tmp/shots:/shots -w /e2e \
  mcr.microsoft.com/playwright:v1.56.1-jammy sh -c '
    npm i -g playwright@1.56.1 pg >/dev/null 2>&1; export NODE_PATH=$(npm root -g)
    (node localproxy.cjs router:8080 &); sleep 1
    BASE=http://localhost:8080 node editor-smoke.cjs'
```

`localproxy.cjs` serves the stack on `localhost`, so pages are a secure context (clipboard, passkeys) as on HTTPS.

Some scripts need more:

- `DATABASE_URL` for scripts that set up state directly (billing, credits).
- `E2E_EMAIL` with an existing account when sign-ups are rate limited.
- A Stripe **test** key saved in Admin › Billing for `billing-*.cjs` and `cloud-credits.cjs`.
- AI and papers keys for the AI scripts (`editor-ai-flows.cjs`, `editor-review-checks.cjs`).

Good first runs: `editor-smoke.cjs` (create, type, live sync, reload) and `selfhost-smoke.cjs` (a fresh install with no keys).
