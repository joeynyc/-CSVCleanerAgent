# csvclean

Clean any CSV into Shopify-ready import data, then push it to the store. Streaming, deterministic where it can be, AI-assisted where it can't.

- **Streaming.** Files are read row-by-row; memory is bounded regardless of file size.
- **Deterministic cleaning.** Dates, prices, handles, booleans, SKUs are normalized by code, not by an LLM.
- **AI for column mapping.** Headers that don't match the Shopify schema by name, alias, or fuzzy similarity are mapped by Claude with sample values for context.
- **Direct Shopify Admin API.** Imports go through GraphQL `productSet` with cost-aware throttling. No shell-outs.

## Install

```bash
bun install
cp .env.example .env
```

Required env:

- `ANTHROPIC_API_KEY` — only when LLM-assisted column mapping is needed (use `--no-llm` to skip).
- `SHOPIFY_STORE`, `SHOPIFY_ACCESS_TOKEN` — only for `import --confirm`.

## CLI

```
csvclean profile  <input>                          Column types and samples
csvclean map      <input> [--no-llm]               Map headers → Shopify schema
csvclean clean    <input> -o <out> [--no-llm]      Map + clean, write to <out>
csvclean validate <input>                          Validate against Shopify schema
csvclean import   <input> --dry-run | --confirm    Upload to Shopify Admin API
csvclean run      <input> -o <out> [--dry-run|--confirm] [--no-llm]
```

`run` is the full pipeline: profile → map → clean → validate → (optional) import.

### Example

```bash
bun run src/cli.ts run samples/messy-products.csv -o cleaned.csv --dry-run
```

A supplier CSV like:

```csv
slug,name,sku,price,active,brand
Red T-Shirt,Red T-Shirt,abc-123,$19.99,yes,Acme
```

becomes:

```csv
Handle,Title,Variant SKU,Variant Price,Published,Vendor
red-t-shirt,Red T-Shirt,abc-123,19.99,TRUE,Acme
```

## How it works

```
input.csv
   │
   ▼
profile   one streaming pass: detect column types + sample 200 values each
   │
   ▼
map       input header → Shopify column
            exact → normalized → alias → fuzzy → LLM (only if needed)
   │
   ▼
clean     streaming transform; per-column deterministic cleaner
   │      (date / price / handle / boolean / sku / string)
   ▼
output.csv
   │
   ▼
validate  local schema check: required fields, enums, formats
   │
   ▼
import    GraphQL productSet, grouped by Handle, throttle-aware
```

## Project layout

```
src/
  cli.ts             CLI entry
  pipeline.ts        Orchestrator
  csv/
    stream.ts        csv-parse / csv-stringify streaming wrappers
    profile.ts       Sampling profiler
    clean.ts         Deterministic cell cleaners
  mapping/
    map.ts           Heuristic + LLM column mapper
  shopify/
    schema.ts        Canonical Shopify product columns
    validate.ts      Local schema validation
    client.ts        Admin GraphQL client
    import.ts        productSet upserts grouped by Handle
  llm/
    anthropic.ts     Minimal Claude wrapper (column mapping only)
tests/
samples/
```

## Development

```bash
bun test
bun run typecheck
```

## License

MIT.
