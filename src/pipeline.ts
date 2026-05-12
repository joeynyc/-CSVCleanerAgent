// Orchestrates: profile → map → clean (streaming) → validate → import.

import { profile, type FileProfile } from "./csv/profile";
import { readRows, writeRows, type Row } from "./csv/stream";
import { clean } from "./csv/clean";
import { mapHeaders, type MappingResult } from "./mapping/map";
import { findColumn, canonicalHeaders } from "./shopify/schema";
import { validate, type ValidationReport } from "./shopify/validate";
import { importCsv, type ImportResult, type ImportEvent } from "./shopify/import";

export interface CleanOptions {
  outputPath: string;
  useLLM?: boolean;
  mapping?: MappingResult; // skip auto-mapping if provided
}

export interface CleanReport {
  profile: FileProfile;
  mapping: MappingResult;
  outputPath: string;
  rowCount: number;
  cleanedCellCount: number;
  cleanerErrors: { row: number; column: string; value: string; error: string }[];
}

export async function cleanFile(input: string, opts: CleanOptions): Promise<CleanReport> {
  const fileProfile = await profile(input);
  const mapping = opts.mapping ?? (await mapHeaders(fileProfile.columns, { useLLM: opts.useLLM }));

  const inputToShopify = new Map<string, string>();
  for (const m of mapping.mappings) {
    if (m.shopifyColumn) inputToShopify.set(m.inputHeader, m.shopifyColumn);
  }

  const cleanerErrors: CleanReport["cleanerErrors"] = [];
  let rowCount = 0;
  let cleanedCellCount = 0;

  async function* transform(): AsyncIterable<Row> {
    for await (const inputRow of readRows(input)) {
      rowCount++;
      const out: Row = {};
      for (const [inputHeader, value] of Object.entries(inputRow)) {
        const shopifyCol = inputToShopify.get(inputHeader);
        if (!shopifyCol) continue;
        const spec = findColumn(shopifyCol);
        if (!spec) {
          out[shopifyCol] = value;
          continue;
        }
        const profile = fileProfile.columns.find((c) => c.name === inputHeader);
        const result = clean(spec.cleaner, value, {
          dateFormat: spec.dateFormat ?? profile?.dateFormat,
        });
        if (result.error) {
          cleanerErrors.push({ row: rowCount, column: shopifyCol, value, error: result.error });
        }
        if (result.value !== null && result.value !== value) cleanedCellCount++;
        out[shopifyCol] = result.value ?? "";
      }
      yield out;
    }
  }

  const outputColumns = canonicalHeaders().filter((h) =>
    mapping.mappings.some((m) => m.shopifyColumn === h),
  );
  await writeRows(opts.outputPath, outputColumns, transform());

  return {
    profile: fileProfile,
    mapping,
    outputPath: opts.outputPath,
    rowCount,
    cleanedCellCount,
    cleanerErrors,
  };
}

export interface RunOptions {
  outputPath: string;
  useLLM?: boolean;
  importMode?: "skip" | "dry-run" | "confirm";
  onProgress?: (event: ImportEvent) => void;
}

export interface RunReport {
  clean: CleanReport;
  validation: ValidationReport;
  import?: ImportResult;
}

export async function run(input: string, opts: RunOptions): Promise<RunReport> {
  const cleanReport = await cleanFile(input, { outputPath: opts.outputPath, useLLM: opts.useLLM });
  const validation = await validate(opts.outputPath);
  let importResult: ImportResult | undefined;
  if (opts.importMode === "dry-run" || opts.importMode === "confirm") {
    importResult = await importCsv(opts.outputPath, {
      dryRun: opts.importMode === "dry-run",
      onProgress: opts.onProgress,
    });
  }
  return { clean: cleanReport, validation, import: importResult };
}
