# Videmak

**The open-source AI editor for academic writing.** Autocomplete that cites real papers, @-cite from 250M+ scholarly works, chat with your PDFs, a careful AI reviewer, and Word, LaTeX and PDF in and out. MIT licensed.

![The Videmak editor](docs/images/editor.png)

- **Use it:** [videmak.net](https://videmak.net), free to start.
- **Host it yourself:** one `docker compose up`, on your laptop or your university's servers.
- **Build on it:** the editor is a React package, and one [Videmak Cloud](#videmak-cloud) key gives your app papers, full text, research tools and AI.

---

## What's in the editor

| | |
| --- | --- |
| **Autocomplete with citations** | Suggests your next sentence and cites the papers it draws on. Accept, refine or ask it to conclude a section. |
| **Find papers and @-cite** | Search scholarly works without leaving the page; type `@` to cite one. 10,000+ citation styles. |
| **Library and chat with PDFs** | Upload or import papers, ask questions and get answers with page numbers. |
| **AI review** | Peer review, claim checks, source quality (retracted, preprint, wrong DOI), proofreading and tone, as comments in your text. |
| **Write with others** | Real-time editing, comments, suggestions (tracked changes) and version history. |
| **Word and LaTeX** | Open `.docx` files and keep their styles; export Word, PDF or a LaTeX project. |
| **On your phone** | A full editor, not a viewer. |

## Three ways to use Videmak

| | Who it is for | What it costs |
| --- | --- | --- |
| **[videmak.net](https://videmak.net)** | Students and researchers who just want to write | Free plan; paid plans on [videmak.net/pricing](https://videmak.net/pricing) |
| **Self-hosted** (this repo) | Anyone with a server: labs, departments, companies | Free (MIT). Pay only for the services you choose to use, e.g. a Videmak Cloud key or your own AI provider |
| **Videmak Cloud API** | Developers adding scholarly search, full text, reference checks or AI to their own app | Pay as you go in credits, 1,000 free credits a day |

---

## Self-host in five minutes

You need Docker with Compose v2 and about 4 GB of RAM.

```bash
git clone https://github.com/Videmak/videmak.git
cd videmak
bash deploy/setup.sh      # writes .env with fresh secrets
# edit .env: PUBLIC_URL, ADMIN_EMAILS, and VIDEMAK_API_KEY (or your own providers, below)
docker compose up -d      # first build takes a few minutes
```

Open http://localhost:3000 and create your account with an address from `ADMIN_EMAILS`. Admins get **Admin** in the menu, where every setting below can be changed without a restart.

> **No email set up?** Admin rights need a confirmed email. Without email, sign up and then run
> `docker compose exec server node dist/cli/admin-grant.js you@example.com`.

**HTTPS on your own domain.** Point the domain's DNS at the server, set `SITE_ADDRESS=write.example.edu` and `PUBLIC_URL=https://write.example.edu` in `.env`, then:

```bash
docker compose -f docker-compose.yml -f deploy/compose.https.yml up -d
```

Caddy gets and renews the certificate. Already have a proxy (nginx, Traefik, a load balancer)? Keep the default and point it at port 3000.

**What runs:** `web` (Next.js), `server` (API, real-time sync, the Cloud gateway), `convert` (Word/PDF/LaTeX, LibreOffice), `db` (PostgreSQL 17 with pgvector), `valkey` and `router` (Caddy). Data lives in the `db` and `files` volumes.

**Back up** the database and files:

```bash
docker compose exec -T db pg_dump -U videmak videmak | gzip > videmak-$(date +%F).sql.gz
docker run --rm -v videmak_files:/files -v "$PWD":/backup alpine tar czf /backup/files-$(date +%F).tgz -C /files .
```

Or store files on Wasabi or any S3-compatible bucket (below) and back up the database only.

**Upgrade:** `git pull && docker compose up -d --build`. Database migrations run on start.

### Connect services

Each service is a slot. Fill one key and everything works, or choose a provider per slot. Set them in `.env` or in **Admin** (the admin page wins).

| Slot | Options | Settings |
| --- | --- | --- |
| **Everything** | A [Videmak Cloud](#videmak-cloud) key | `VIDEMAK_API_KEY` |
| **AI** | DeepSeek (default), OpenAI, Anthropic, OpenRouter, Ollama, Videmak | `LLM_PROVIDER`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_REVIEW_MODEL`, `LLM_BASE_URL` |
| **Papers** | [CitedEvidence Scholar](#papers-from-scholar) (default), Videmak, OpenAlex | `PAPERS_PROVIDER`, `SCHOLAR_API_KEY`, `OPENALEX_EMAIL` |
| **Files** | This server (default), Wasabi, any S3-compatible (AWS S3, Cloudflare R2, Backblaze B2, MinIO) | `STORAGE_PROVIDER`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT`, `S3_URL_STYLE`, `S3_PREFIX` |
| **Email** | SMTP or Resend (password reset, email confirmation) | `MAIL_PROVIDER`, `MAIL_FROM`, `SMTP_*`, `RESEND_API_KEY` |
| **Newsletter** | MailCheap (keeps a list in step with confirmed accounts) | `NEWSLETTER_PROVIDER`, `MAILCHEAP_API_KEY` |
| **Payments** | Stripe, if you sell plans or credits yourself | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `BILLING_LIVE=1` for live keys |
| **Sign-in** | Email and password, passkeys, Google, Microsoft, Apple, Cloudflare Turnstile | Admin › Sign-in |

[`.env.example`](.env.example) lists every setting with a short note. Files saved before you switch to a bucket stay readable; **Admin › Storage › Copy to bucket** moves them over.

### Papers from Scholar

Papers come from [CitedEvidence Scholar](https://scholar.citedevidence.com): 250M+ scholarly works with authors, journals and citations, plus full text and PDFs where a copy is available. It works without a key at low limits. A **free key** adds full text and research tools and comes with **1,000 free credits a day**:

1. Sign in at [scholar.citedevidence.com](https://scholar.citedevidence.com/account/api-keys) and open **API keys**.
2. Turn on **Metadata**, **Files** and **Research** for your key.
3. Paste it in **Admin › Papers** (or `SCHOLAR_API_KEY`). **Test** shows what the key reaches.

If Scholar is busy, searches fall back to [OpenAlex](https://openalex.org) automatically.

---

## Videmak Cloud

One key for the services Videmak itself runs on. Use it in a self-hosted Videmak (`VIDEMAK_API_KEY`) or call it from your own app. Get a key at [videmak.net/developers](https://videmak.net/developers).

| Service | Endpoint | Credits |
| --- | --- | --- |
| Paper search and lookups (works, authors, journals…) | `GET /v1/oa/…` | 1 per request · free daily |
| Full text and PDFs | `GET /v1/files/…` | 1 per request · free daily |
| Research tools: multi-source search, citation networks, recommendations | `POST /v1/research/tools/{name}`, `POST /v1/mcp` | 1 per call · free daily |
| Reference checks (do these DOIs and PubMed IDs exist?) | `validate_citations` | 1 per reference · free daily |
| AI (OpenAI-compatible, DeepSeek) | `POST /v1/chat/completions` | 78 input / 312 output per 1M tokens |
| AI peer review of a manuscript | `POST /v1/review` | 10 per 1,000 words |
| Word, PDF or LaTeX from editor documents | `POST /v1/convert` | 1 per file |

- **1,000 free credits every day** for the services marked *free daily*. They reset at midnight UTC.
- **100 credits to start** on your first key, to try AI, reviews and exports. Both need a confirmed email.
- **Credit packs:** 2,000 for $29.90 · 10,000 for $119 · 100,000 for $790 · 1,000,000 for $4,990. One credit is one paper or file request, the same credit as CitedEvidence Scholar. Credits you buy don't expire.
- Optional automatic top-up with a monthly limit, and a monthly cap per key.

```bash
curl -H "Authorization: Bearer $VIDEMAK_API_KEY" \
  "https://new.videmak.net/v1/oa/works?search=sleep%20memory&per_page=5"
```

Every response reports `X-Credits-Charged` and `X-Credits-Balance`; out of credits is `402`. Research tools work in any MCP client (Claude, Cursor…) with `https://new.videmak.net/v1/mcp` and the key as a Bearer header. Full reference: [docs/cloud-api.md](docs/cloud-api.md).

## For universities and research groups

Videmak for a department or a whole university: hosted by us or on your own servers, set up with you, paid by invoice, with a support agreement. Ask us about single sign-on and links to your course system: [admin@videmak.org](mailto:admin@videmak.org?subject=Videmak%20for%20our%20institution).

---

## Develop

```bash
pnpm install
pnpm --filter @videmak/server dev     # needs DATABASE_URL and JWT_SECRET (32+ characters)
pnpm --filter @videmak/web dev        # http://localhost:3000; /api is proxied to :4000
```

Real-time sync uses WebSockets at `/collab` and `/api/ai-editor/documents/:id/ws`, so put a proxy in front that sends `/api/*`, `/collab` and `/v1/*` to the server and everything else to the web app ([deploy/Caddyfile](deploy/Caddyfile) does exactly that).

Tests: `pnpm --filter @videmak/server test` (Vitest), `pytest` in `workers/convert`, and browser tests in [`tests/e2e`](tests/e2e) (Playwright, run against a running copy).

| Folder | What it is |
| --- | --- |
| `packages/editor` | `@videmak/editor`, the editor as a React package (BlockNote + Yjs). Host apps connect it with `<VidemakEditorProvider config={…}>`. |
| `apps/server` | API and real-time server: Node, Hono, PostgreSQL, Hocuspocus. Accounts, documents, sharing, versions, Library, plans, the AI and papers slots, and the Videmak Cloud gateway. |
| `apps/web` | The web app: Next.js 15, React 19, Tailwind 4. |
| `workers/convert` | Word, LaTeX and PDF converter (FastAPI, LibreOffice, pypdfium2). |
| `deploy` | Dockerfiles, the Caddy router and setup script used by `docker-compose.yml`. |

See [CONTRIBUTING.md](CONTRIBUTING.md) to send a change and [SECURITY.md](SECURITY.md) to report a vulnerability.

## Licence

MIT, see [LICENSE](LICENSE). Third-party licences are listed in [NOTICE](NOTICE). The Videmak name and logo are trademarks and are not covered by the MIT licence: forks are welcome under their own name.
