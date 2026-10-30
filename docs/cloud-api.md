# Videmak Cloud API

One key for scholarly papers, full text, research tools, AI, peer review and document conversion. Base URL `https://new.videmak.net/v1`. Every request sends the key as a Bearer token:

```
Authorization: Bearer vm_live_…
```

Create keys and buy credits at [videmak.net/developers/keys](https://videmak.net/developers/keys). A self-hosted Videmak runs the same gateway at `<your PUBLIC_URL>/v1`.

## Credits

| | |
| --- | --- |
| **One credit** | One paper or file request, the same credit as CitedEvidence Scholar |
| **Free every day** | 1,000 credits for papers, full text, research tools and reference checks, reset at midnight UTC |
| **Starter** | 100 credits, once, on your first key |
| **Packs** | 2,000 $29.90 · 10,000 $119 · 100,000 $790 · 1,000,000 $4,990 (credits you buy don't expire) |

Free credits are used first, then your balance. Free and starter credits need a confirmed email. Prices per service are in the table below and at `GET /api/cloud/prices` (no key needed).

Every charged response carries:

| Header | Meaning |
| --- | --- |
| `X-Credits-Charged` | What this call cost |
| `X-Credits-Balance` | Your paid balance after it |

`GET /v1/credits` returns `{ balance, free_per_day, free_used, free_left, resets_at, email_confirmed }`.

## Errors

Errors are JSON: `{ "error": { "message": "…", "code": "…" } }`.

| Status | When |
| --- | --- |
| `401` | Missing, made-up or revoked key |
| `402` | Out of credits. `code` is `no_credits`, `confirm_email` (free credits need a confirmed email) or `key_cap` (the key reached the monthly cap you set) |
| `404` | Unknown path or tool |
| `422` | The request body is wrong; the message says how |
| `429` | Too fast: up to 50 requests a second per key, 4 research tool calls at once. Respect `Retry-After` |
| `503` | A service is busy or not available on this gateway; retry after `Retry-After` |

You are charged only for successful calls.

## Papers: `GET /v1/oa/…`

Scholarly metadata in the [OpenAlex](https://docs.openalex.org) shape, from CitedEvidence Scholar: works, authors, sources (journals), institutions, topics, publishers and funders, with OpenAlex's filters, sorting, paging and `cursor`. **1 credit per request, free daily.**

```bash
curl -H "Authorization: Bearer $VIDEMAK_API_KEY" \
  "https://new.videmak.net/v1/oa/works?search=sleep%20memory&filter=publication_year:>2015&per_page=5"

curl -H "Authorization: Bearer $VIDEMAK_API_KEY" "https://new.videmak.net/v1/oa/works/doi:10.1038/nrn2762"
```

`POST /v1/oa/works/bulk` with `{"ids": ["W2741809807", "doi:10.7717/peerj.4375"]}` looks up several works in one request.

## Full text and PDFs: `GET /v1/files/…`

Papers with archived full text, XML, a stored PDF or a ranked PDF link (CitedEvidence's CEDOA collection). **1 credit per request, free daily.**

| Path | Returns |
| --- | --- |
| `/v1/files/search?q=…&limit=…` | Papers that have content, matching a query |
| `/v1/files/list?has_fulltext=true&limit=…` | A feed of content-backed papers (filters: `has_fulltext`, `has_xml`, `has_pdf`, `from_year`, `to_year`, `license`) |
| `/v1/files/manifest/{id}` | Every source for a paper: format, provider, licence, checksums |
| `/v1/files/text/{id}` | Full text as `text/plain` |
| `/v1/files/texts/{id,id,…}` | Up to 100 texts at once |
| `/v1/files/xml/{id}` | Archived XML |
| `/v1/files/pdf/{id}` | The stored PDF, or a `307` redirect to the best external PDF link |

`{id}` is an OpenAlex work ID such as `W2741809807`. A content source is not a licence to redistribute: check the manifest's licence.

## Research tools: `/v1/research/tools` and `/v1/mcp`

Fourteen tools for literature work, as JSON or over MCP. **1 credit per call, free daily**; `validate_citations` costs 1 credit per identifier.

| Tool | What it does |
| --- | --- |
| `smart_search` | Search Scholar, CEDOA and external providers at once, deduplicated, with provenance |
| `search_papers` | Search one source (Scholar, CEDOA, Semantic Scholar, Crossref, PubMed, arXiv, …) |
| `find_paper` | Resolve a DOI, PMID or other identifier to full metadata |
| `batch_get_papers` | Up to 500 papers in one call |
| `get_paper_network` | Papers citing, or cited by, a paper |
| `recommend_papers` | Related papers |
| `validate_citations` | Do these DOIs and PubMed IDs exist? |
| `open_access` | Legal open-access PDFs for DOIs |
| `preprints` | Browse medRxiv and bioRxiv |
| `search_authors`, `get_author`, `get_author_works`, `get_author_funding` | Researchers, their work and ORCID funding |
| `get_institution` | Institution details |

`GET /v1/research/tools` returns each tool's input schema. Call a tool with its arguments as the JSON body:

```bash
curl -X POST -H "Authorization: Bearer $VIDEMAK_API_KEY" -H "Content-Type: application/json" \
  -d '{"identifiers": ["10.1038/nrn2762", "PMID:23589831"]}' \
  "https://new.videmak.net/v1/research/tools/validate_citations"
```

The answer has `content`, often `structuredContent`, and `isError`: check `isError` even on HTTP 200.

**MCP.** `POST /v1/mcp` is a stateless Streamable HTTP server with the same tools. In Claude, Cursor or any MCP client:

```json
{
  "mcpServers": {
    "videmak-research": {
      "url": "https://new.videmak.net/v1/mcp",
      "headers": { "Authorization": "Bearer YOUR_VIDEMAK_API_KEY" }
    }
  }
}
```

Systematic-review tools that keep state per account (reviews, screening, PRISMA counts) are not offered through Videmak Cloud. Use a CitedEvidence Scholar key directly for those.

## AI: `POST /v1/chat/completions`

OpenAI-compatible chat completions on DeepSeek, streaming included. Models: `deepseek-chat` (default) and `deepseek-reasoner`. Any OpenAI SDK works:

```python
from openai import OpenAI

client = OpenAI(base_url="https://new.videmak.net/v1", api_key=VIDEMAK_API_KEY)
reply = client.chat.completions.create(model="deepseek-chat", messages=[{"role": "user", "content": "Hello"}])
```

**Credits per 1M tokens:** 78 input, 1.56 cached input, 312 output. `GET /v1/models` lists the models.

## Peer review: `POST /v1/review`

The editor's reviewer: strengths, problems by severity, and a recommendation (Accept, Minor revision, Major revision or Reject).

```json
{ "text": "the manuscript…", "title": "optional", "field": "optional", "language": "optional, e.g. en" }
```

Returns `{ report, recommendation, reviewed_words, truncated }`. The first 90,000 characters are reviewed. **10 credits per 1,000 words.**

## Documents: `POST /v1/convert`

Turns an editor document (the block JSON `@videmak/editor` produces) into a file:

```json
{ "title": "My paper", "format": "docx", "blocks": [ … ], "settings": { } }
```

`format` is `docx`, `pdf` or `latex` (a zipped project). The response is the file. **1 credit per file.**

## Limits for your own keys

On the keys page you can set a **monthly cap per key** (in credits) and turn on **automatic top-up**: when the balance falls below a threshold, the card you last paid with buys the pack you chose, up to a monthly dollar limit. If a top-up fails it switches itself off and emails you.
