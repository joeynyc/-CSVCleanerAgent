#!/usr/bin/env bun
// csvclean — CLI for the CSV → Shopify pipeline.
//
// Subcommands:
//   profile  <input>                      Sampling-based column profile
//   map      <input>                      Map input headers → Shopify columns
//   clean    <input> -o <out>             Map + deterministic clean (streaming)
//   validate <input>                      Local Shopify schema validation
//   import   <input> [--dry-run|--confirm]  Push cleaned CSV to Shopify Admin API
//   run      <input> -o <out> [--dry-run|--confirm]  Full pipeline

import { profile } from "./csv/profile";
import { mapHeaders } from "./mapping/map";
import { cleanFile, run } from "./pipeline";
import { validate } from "./shopify/validate";
import { importCsv } from "./shopify/import";

interface ParsedArgs {
  positional: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === undefined) continue;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    } else if (a.startsWith("-")) {
      const key = a.slice(1);
      const next = argv[i + 1];
      flags[key] = next && !next.startsWith("-") ? (i++, next) : true;
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function usage(): string {
  return `csvclean <command> <input.csv> [options]

Commands:
  profile  <input>                          Profile column types and samples
  map      <input> [--no-llm]               Map headers to Shopify schema
  clean    <input> -o <out> [--no-llm]      Map + clean, write to <out>
  validate <input>                          Validate against Shopify schema
  import   <input> [--dry-run | --confirm]  Upload to Shopify
  run      <input> -o <out> [--dry-run | --confirm] [--no-llm]   Full pipeline

Env:
  ANTHROPIC_API_KEY    Required only for LLM-assisted column mapping
  SHOPIFY_STORE        Required for --confirm
  SHOPIFY_ACCESS_TOKEN Required for --confirm`;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    console.log(usage());
    return;
  }

  const command = argv[0];
  const { positional, flags } = parseArgs(argv.slice(1));
  const input = positional[0];
  if (!input) {
    console.error("Missing input CSV path.\n");
    console.error(usage());
    process.exit(1);
  }

  const out = (flags["o"] as string | undefined) ?? (flags["output"] as string | undefined);
  const useLLM = !flags["no-llm"];

  switch (command) {
    case "profile": {
      const result = await profile(input);
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    case "map": {
      const fileProfile = await profile(input);
      const result = await mapHeaders(fileProfile.columns, { useLLM });
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    case "clean": {
      if (!out) throw new Error("clean requires -o <output.csv>");
      const result = await cleanFile(input, { outputPath: out, useLLM });
      console.log(`Wrote ${result.outputPath} — ${result.rowCount} rows, ${result.cleanedCellCount} cells normalized.`);
      if (result.mapping.unmapped.length > 0) {
        console.log(`Unmapped headers: ${result.mapping.unmapped.join(", ")}`);
      }
      if (result.cleanerErrors.length > 0) {
        console.log(`Cleaner warnings: ${result.cleanerErrors.length} (showing first 5)`);
        for (const e of result.cleanerErrors.slice(0, 5)) {
          console.log(`  row ${e.row} ${e.column}: ${e.error} (value: ${e.value})`);
        }
      }
      return;
    }
    case "validate": {
      const report = await validate(input);
      console.log(`Validated ${report.rowCount} rows`);
      if (report.unknownHeaders.length > 0) {
        console.log(`Unknown headers: ${report.unknownHeaders.join(", ")}`);
      }
      if (report.errors.length === 0) {
        console.log("No errors.");
      } else {
        console.log(`${report.errors.length} errors (showing first 10):`);
        for (const e of report.errors.slice(0, 10)) {
          console.log(`  row ${e.row} ${e.column}: ${e.message} (value: ${e.value})`);
        }
        process.exitCode = 1;
      }
      return;
    }
    case "import": {
      const dryRun = !!flags["dry-run"];
      const confirm = !!flags["confirm"];
      if (dryRun === confirm) throw new Error("import requires exactly one of --dry-run or --confirm");
      const result = await importCsv(input, {
        dryRun,
        onProgress: (e) => {
          if (e.type === "product") {
            const tag = e.status === "ok" ? "ok" : e.status === "skipped" ? "skip" : "err";
            console.log(`[${tag}] ${e.handle}${e.message ? ` — ${e.message}` : ""}`);
          } else {
            console.log(`Done. total=${e.total} ok=${e.ok} errors=${e.errors}`);
          }
        },
      });
      if (result.errors.length > 0) process.exitCode = 1;
      return;
    }
    case "run": {
      if (!out) throw new Error("run requires -o <output.csv>");
      const dryRun = !!flags["dry-run"];
      const confirm = !!flags["confirm"];
      const importMode: "skip" | "dry-run" | "confirm" = confirm ? "confirm" : dryRun ? "dry-run" : "skip";
      const report = await run(input, {
        outputPath: out,
        useLLM,
        importMode,
        onProgress: (e) => {
          if (e.type === "product") {
            const tag = e.status === "ok" ? "ok" : e.status === "skipped" ? "skip" : "err";
            console.log(`[${tag}] ${e.handle}${e.message ? ` — ${e.message}` : ""}`);
          }
        },
      });
      console.log("\nSummary");
      console.log(`  Input rows:       ${report.clean.rowCount}`);
      console.log(`  Cells normalized: ${report.clean.cleanedCellCount}`);
      console.log(`  Cleaner warnings: ${report.clean.cleanerErrors.length}`);
      console.log(`  Validation errors:${report.validation.errors.length}`);
      console.log(`  Unmapped headers: ${report.clean.mapping.unmapped.length}`);
      if (report.import) {
        console.log(`  Import (${report.import.dryRun ? "dry-run" : "confirm"}): ok=${report.import.ok} errors=${report.import.errors.length}`);
      }
      if (report.validation.errors.length > 0 || report.import?.errors.length) process.exitCode = 1;
      return;
    }
    default:
      console.error(`Unknown command: ${command}\n`);
      console.error(usage());
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
