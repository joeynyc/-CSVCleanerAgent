<div align="center">

# CSV Cleaner Agent

**AI-powered CSV cleaning and validation with Shopify import pipeline**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-1.2-black)](https://bun.sh)
[![Claude Agent SDK](https://img.shields.io/badge/Claude%20Agent%20SDK-0.1.76-orange)](https://platform.claude.com/docs/en/api/agent-sdk/overview)

[Features](#features) • [Quick Start](#quick-start) • [Pipeline](#shopify-pipeline) • [Architecture](#architecture) • [Contributing](#contributing)

</div>

---

## Overview

Transform messy, inconsistent CSV files into clean, import-ready data with the power of AI. CSV Cleaner Agent analyzes your data, detects quality issues, and provides intelligent cleaning recommendations — all powered by Claude's Agent SDK.

**New:** The **shopctl integration pipeline** chains AI-powered profiling with deterministic Shopify validation for a complete clean → validate → import workflow.

Perfect for preparing data imports for **Shopify**, **QuickBooks**, **Business Central**, and more.

## Features

| Feature | Description |
|---------|-------------|
| **Smart CSV Parsing** | Automatic header detection, encoding handling, structure analysis |
| **Data Profiling** | Detect column types, null values, anomalies, and format inconsistencies |
| **AI-Powered Cleaning** | Claude analyzes your data and applies intelligent fixes (dates, prices, SKUs, handles) |
| **Shopify Pipeline** | End-to-end: profile → clean → validate → fix → diff → import |
| **shopctl Bridge** | Shell integration with [shopctl](https://github.com/joeynyc/shopctl) for Shopify-specific validation |
| **Security First** | Path traversal protection, symlink validation, rate limiting, input sanitization |
| **Fast** | Built on Bun for lightning-fast processing |

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) 1.0+
- [Anthropic API Key](https://console.anthropic.com/)
- [shopctl](https://github.com/joeynyc/shopctl) (optional, for Shopify pipeline)

### Installation

```bash
git clone https://github.com/joeynyc/-CSVCleanerAgent.git
cd CSVCleanerAgent
bun install

# Set up your API key
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY
```

### Basic Usage

**Interactive mode** — ask the agent to analyze any CSV:

```bash
bun start
```

**Analyze a specific file:**

```bash
bun start "Profile the data in sample.csv and identify all issues"
```

**Development mode (auto-reload):**

```bash
bun run dev
```

The agent will parse the CSV, profile every column, detect issues (missing values, inconsistent formats, duplicates), and recommend cleaning strategies.

---

## Shopify Pipeline

The pipeline chains AI cleaning with deterministic Shopify validation. Two tools working together — the AI handles the fuzzy stuff, shopctl handles the precise stuff.

### How It Works

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  1. Profile  │ ──▶ │  2. AI Clean │ ──▶ │  3. Validate │ ──▶ │  4. Import   │
│  Parse CSV,  │     │  Normalize   │     │  shopctl     │     │  Dry-run or  │
│  detect types│     │  dates, SKUs,│     │  checks      │     │  confirm     │
│  & anomalies │     │  prices, etc │     │  Shopify     │     │              │
└──────────────┘     └──────────────┘     │  schema      │     └──────────────┘
                                          └──────────────┘
```

### Pipeline Usage

```bash
# Basic: profile and clean, output to file
bun run pipeline.ts products.csv --output cleaned.csv

# Dry run: clean and validate against Shopify, but don't import
bun run pipeline.ts products.csv --dry-run

# Full send: clean, validate, and import to your store
bun run pipeline.ts products.csv --auto-import

# Use a specific Shopify store profile
bun run pipeline.ts products.csv --profile production --dry-run
```

### Pipeline Steps

| Step | What Happens |
|------|-------------|
| **Profile** | Parses CSV, detects column types (string, number, date, email), counts nulls, finds anomalies |
| **AI Clean** | Claude analyzes the profile and applies smart fixes: date normalization, price formatting, SKU standardization, handle generation, boolean normalization |
| **Validate** | `shopctl csv validate` checks against Shopify's exact CSV schema — catches errors the AI might miss |
| **Fix** | If validation fails, `shopctl csv fix` auto-repairs Shopify-specific issues (encoding, missing fields, handle dedup) |
| **Diff** | `shopctl csv diff` shows exactly what would change vs your live store |
| **Import** | `shopctl csv import --dry-run` for rehearsal, or `--confirm` to push to Shopify |

### Why Two Tools?

| | CSV Cleaner Agent | shopctl |
|---|---|---|
| **Approach** | AI reasoning | Deterministic rules |
| **Scope** | Any CSV, any platform | Shopify-specific |
| **Strength** | Finds unexpected issues | Knows exact Shopify requirements |
| **Output** | Cleaned CSV + recommendations | Validation errors + auto-fixes + API operations |
| **Runtime** | Needs Claude API key | Just needs Shopify token |

The AI catches the stuff rules can't anticipate. The rules catch the stuff the AI might overlook. Together, they cover everything.

---

## Standalone Agent

Don't need Shopify? The core agent works with any CSV for any platform:

```bash
# Profile any CSV
bun start "Analyze customers.csv and suggest cleaning steps for QuickBooks import"

# Business Central prep
bun start "Profile inventory.csv and recommend fixes for Business Central"
```

### MCP Tools

The agent exposes two tools via the Model Context Protocol:

- **`parse_csv`** — Parse a CSV file, return headers, row count, and sample rows
- **`profile_data`** — Analyze every column: detect types, null counts, unique values, anomalies

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  Pipeline (pipeline.ts)                  │
│         CLI entry point + orchestration                  │
└──────────────────────┬──────────────────────────────────┘
                       │
          ┌────────────┴────────────┐
          ▼                         ▼
┌──────────────────────┐  ┌────────────────────────────┐
│  Claude Agent SDK    │  │  shopctl Bridge            │
│  (AI profiling +     │  │  (src/shopctl-bridge.ts)   │
│   cleaning)          │  │                            │
│                      │  │  validateCsv()             │
│  MCP Server:         │  │  fixCsv()                  │
│  ├─ parse_csv        │  │  diffCsv()                 │
│  └─ profile_data     │  │  importCsv()               │
└──────────────────────┘  └────────────────────────────┘
          │                         │
          ▼                         ▼
┌──────────────────────┐  ┌────────────────────────────┐
│  Your CSV Files      │  │  Shopify Admin API         │
│                      │  │  (via shopctl CLI)         │
└──────────────────────┘  └────────────────────────────┘
```

### Tech Stack

- **[Claude Agent SDK](https://platform.claude.com/docs/en/api/agent-sdk/overview)** — Autonomous agent framework
- **[Bun](https://bun.sh)** — Fast JavaScript runtime
- **[TypeScript](https://www.typescriptlang.org/)** — Type-safe development
- **[MCP](https://modelcontextprotocol.io/)** — Model Context Protocol for custom tools
- **[shopctl](https://github.com/joeynyc/shopctl)** — Shopify store management CLI

## Project Structure

```
CSVCleanerAgent/
├── index.ts                # Standalone agent (AI profiling + recommendations)
├── pipeline.ts             # Pipeline CLI entry point
├── src/
│   ├── utils.ts            # CSV parsing, validation, security utilities
│   ├── pipeline.ts         # Pipeline orchestration (profile → clean → import)
│   └── shopctl-bridge.ts   # Shell bridge to shopctl commands
├── tests/
│   ├── utils.test.ts       # Core utility tests
│   └── pipeline.test.ts    # Pipeline + bridge tests
├── sample.csv              # Example data with quality issues
├── package.json
├── tsconfig.json
└── .env.example
```

## Testing

```bash
# Run all tests
bun test

# Watch mode
bun test --watch

# Type checking
bun run typecheck
```

## Contributing

Contributions are welcome! Here's how:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/your-feature`)
3. Commit your changes (`git commit -m 'Add your feature'`)
4. Push to the branch (`git push origin feature/your-feature`)
5. Open a Pull Request

## License

MIT — see [LICENSE](LICENSE) for details.

---

<div align="center">

**Built with [Claude Agent SDK](https://platform.claude.com/docs/en/api/agent-sdk/overview) + [shopctl](https://github.com/joeynyc/shopctl)**

</div>
