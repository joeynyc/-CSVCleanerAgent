# CSV Cleaner Agent

AI-powered CSV cleaning with an optional Shopify import pipeline. Built on the [Claude Agent SDK](https://platform.claude.com/docs/en/api/agent-sdk/overview) and [Bun](https://bun.sh).

The agent profiles any CSV, detects quality issues, and recommends fixes. The pipeline chains that AI cleaning with [shopctl](https://github.com/joeynyc/shopctl) for deterministic Shopify validation and import.

## Install

```bash
git clone https://github.com/joeynyc/-CSVCleanerAgent.git
cd CSVCleanerAgent
bun install
cp .env.example .env   # add ANTHROPIC_API_KEY
```

Requires Bun 1.0+ and an Anthropic API key. `shopctl` is only needed for the Shopify pipeline.

## Usage

### Standalone agent

```bash
bun start                                          # interactive
bun start "Profile sample.csv and list issues"     # one-shot prompt
bun run dev                                        # auto-reload
```

Works with any CSV for any destination (Shopify, QuickBooks, Business Central, etc.). The agent exposes two MCP tools:

- `parse_csv` — headers, row count, sample rows
- `profile_data` — per-column types, nulls, unique values, anomalies

### Shopify pipeline

```bash
bun run pipeline.ts products.csv --output cleaned.csv
bun run pipeline.ts products.csv --dry-run
bun run pipeline.ts products.csv --auto-import
bun run pipeline.ts products.csv --profile production --dry-run
```

Stages: **profile** (parse, detect types) → **clean** (Claude normalizes dates, prices, SKUs, handles, booleans) → **validate** (`shopctl csv validate`) → **fix** (`shopctl csv fix` on failure) → **diff** (`shopctl csv diff` vs live store) → **import** (`shopctl csv import`, dry-run or confirm).

The AI handles fuzzy normalization; shopctl enforces Shopify's exact schema. Each catches what the other misses.

## Project structure

```
index.ts                  Standalone agent entry
pipeline.ts               Pipeline CLI
src/
  utils.ts                CSV parsing, validation, security
  pipeline.ts             Pipeline orchestration
  shopctl-bridge.ts       Shell bridge to shopctl
tests/
  core.test.ts            CSV parsing & profiling
  security.test.ts        Path traversal & symlinks
  rate-limiter.test.ts    Rate limiting
  pipeline.test.ts        Pipeline + bridge
  fixtures/               Sample CSVs
```

## Development

```bash
bun test            # run tests
bun test --watch
bun run typecheck
```

## License

MIT — see [LICENSE](LICENSE).
