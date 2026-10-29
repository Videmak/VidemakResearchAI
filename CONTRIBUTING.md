# Contributing

Thanks for helping. Bug reports, fixes and features are welcome.

## Before you start

- **Bugs:** open an issue with what you did, what you expected and what happened. Screenshots help, especially for layout problems on phones.
- **Features:** open an issue first so we can agree on the approach before you write a lot of code.
- **Security problems:** don't open an issue. See [SECURITY.md](SECURITY.md).

## Working on the code

```bash
pnpm install
pnpm --filter @videmak/server dev     # API: needs DATABASE_URL and JWT_SECRET
pnpm --filter @videmak/web dev        # web app on http://localhost:3000
```

Or run everything with `docker compose up -d --build` (see the README).

Before you send a pull request:

```bash
pnpm typecheck
pnpm --filter @videmak/server test
cd workers/convert && pytest
```

Changes to how a page looks should come with a screenshot at desktop and phone width.

## Style

- Match the code around you: names, comment density, how errors are handled.
- Text people see is short and plain. One icon set: `react-icons/lu`.
- New settings go in `apps/server/src/env.ts` and, if an admin should change them in the browser, `apps/server/src/lib/settings.ts`. Document them in `.env.example`.
- Database changes are new files in `apps/server/migrations/`, numbered in order. Never edit a migration that has shipped.

## Sign-off

By sending a pull request you agree that your contribution is licensed under the MIT licence. Please sign off your commits (`git commit -s`): it certifies the [Developer Certificate of Origin](https://developercertificate.org).
