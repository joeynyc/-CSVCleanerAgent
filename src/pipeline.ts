import { randomUUID } from "node:crypto";
import { basename, dirname, extname, join, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { EMAIL_REGEX, isValidDate, parseCsvFile } from "./utils";
import {
  createShopctlBridge,
  type ShopctlBridge,
  type ShopctlCommandResult,
  type ShopctlDiffRow,
  type ShopctlFixReport,
  type ShopctlImportResult,
  type ShopctlValidationResult,
} from "./shopctl-bridge";

export interface CsvParseSummary {
  headers: string[];
  rowCount: number;
  sample: Record<string, string>[];
}

export interface CsvColumnProfile {
  column: string;
  type: "string" | "number" | "date" | "email";
  totalRows: number;
  nullCount: number;
  nullPercentage: string;
  uniqueValues: number;
  sampleValues: string[];
}

export interface CsvProfilingResult {
  parse: CsvParseSummary;
  profile: CsvColumnProfile[];
}

export const CLEANING_OPERATIONS = [
  "trim",
  "normalize_whitespace",
  "normalize_date_iso",
  "normalize_boolean",
  "normalize_price",
  "normalize_integer",
  "lowercase",
  "uppercase",
  "titlecase",
  "remove_non_ascii",
  "normalize_handle",
  "normalize_sku",
  "fill_missing",
] as const;

export type CleaningOperation = (typeof CLEANING_OPERATIONS)[number];

export interface CleaningRule {
  column: string;
  operations: CleaningOperation[];
  fillValue: string | null;
  notes: string;
}

export interface CleaningPlan {
  summary: string;
  columnRules: CleaningRule[];
}

export interface PipelineLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface PipelineOptions {
  profile?: string;
  dryRun?: boolean;
  autoImport?: boolean;
  outputPath?: string;
  tempDir?: string;
  shopctlPath?: string;
  logger?: PipelineLogger;
}

export interface PipelineDependencies {
  profileCsv?: (filePath: string) => Promise<CsvProfilingResult>;
  generateCleaningPlan?: (profile: CsvProfilingResult, context: { profile?: string }) => Promise<CleaningPlan>;
  bridge?: ShopctlBridge;
}

export interface PipelineResult {
  inputPath: string;
  cleanedTempPath: string;
  finalCsvPath: string;
  profileResult: CsvProfilingResult;
  cleaningPlan: CleaningPlan;
  validationResult: ShopctlValidationResult;
  fixResult?: ShopctlCommandResult<ShopctlFixReport>;
  diffResult?: ShopctlCommandResult<ShopctlDiffRow[]>;
  importResult?: ShopctlCommandResult<ShopctlImportResult>;
}

const DEFAULT_LOGGER: PipelineLogger = {
  info: (message: string) => console.log(message),
  warn: (message: string) => console.warn(message),
  error: (message: string) => console.error(message),
};

function detectColumnType(values: string[]): CsvColumnProfile["type"] {
  if (values.length === 0) {
    return "string";
  }

  if (values.every((value) => !Number.isNaN(Number(value)) && value !== "")) {
    return "number";
  }

  if (values.every((value) => isValidDate(value))) {
    return "date";
  }

  if (values.every((value) => EMAIL_REGEX.test(value))) {
    return "email";
  }

  return "string";
}

const profilingFilePathSchema = z.string().min(1, "filePath is required");

const parseCsvTool = tool(
  "parse_csv",
  "Parse a CSV file and return headers, row count, and sample rows.",
  {
    filePath: profilingFilePathSchema,
  },
  async (args) => {
    const { headers, rows } = parseCsvFile(args.filePath);
    const payload: CsvParseSummary = {
      headers,
      rowCount: rows.length,
      sample: rows.slice(0, 5),
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(payload),
        },
      ],
    };
  },
);

const profileDataTool = tool(
  "profile_data",
  "Profile CSV columns for type detection, nulls, and sample values.",
  {
    filePath: profilingFilePathSchema,
  },
  async (args) => {
    const localProfile = createLocalProfile(args.filePath);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(localProfile.profile),
        },
      ],
    };
  },
);

const profilingMcpServer = createSdkMcpServer({
  name: "csv-cleaner-pipeline",
  version: "0.1.0",
  tools: [parseCsvTool, profileDataTool],
});

function createLocalProfile(filePath: string): CsvProfilingResult {
  const { headers, rows } = parseCsvFile(filePath);
  const profile: CsvColumnProfile[] = headers.map((header) => {
    const values = rows.map((row) => row[header] ?? "");
    const nonEmpty = values.filter((value) => value !== "");
    const nullCount = values.length - nonEmpty.length;

    return {
      column: header,
      type: detectColumnType(nonEmpty),
      totalRows: values.length,
      nullCount,
      nullPercentage: values.length > 0 ? `${((nullCount / values.length) * 100).toFixed(1)}%` : "0.0%",
      uniqueValues: new Set(nonEmpty).size,
      sampleValues: nonEmpty.slice(0, 3),
    };
  });

  return {
    parse: {
      headers,
      rowCount: rows.length,
      sample: rows.slice(0, 5),
    },
    profile,
  };
}

function isProfileType(value: unknown): value is CsvColumnProfile["type"] {
  return value === "string" || value === "number" || value === "date" || value === "email";
}

function isCsvProfilingResult(value: unknown): value is CsvProfilingResult {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  const parse = candidate["parse"] as Record<string, unknown> | undefined;
  const profile = candidate["profile"];

  if (
    !parse ||
    !Array.isArray(parse["headers"]) ||
    typeof parse["rowCount"] !== "number" ||
    !Array.isArray(parse["sample"])
  ) {
    return false;
  }

  if (!Array.isArray(profile)) {
    return false;
  }

  return profile.every((column) => {
    if (!column || typeof column !== "object") {
      return false;
    }
    const row = column as Record<string, unknown>;
    return (
      typeof row["column"] === "string" &&
      isProfileType(row["type"]) &&
      typeof row["totalRows"] === "number" &&
      typeof row["nullCount"] === "number" &&
      typeof row["nullPercentage"] === "string" &&
      typeof row["uniqueValues"] === "number" &&
      Array.isArray(row["sampleValues"])
    );
  });
}

function isCleaningPlan(value: unknown): value is CleaningPlan {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  if (typeof candidate["summary"] !== "string" || !Array.isArray(candidate["columnRules"])) {
    return false;
  }

  return candidate["columnRules"].every((rule) => {
    if (!rule || typeof rule !== "object") {
      return false;
    }
    const entry = rule as Record<string, unknown>;

    return (
      typeof entry["column"] === "string" &&
      Array.isArray(entry["operations"]) &&
      entry["operations"].every((operation) =>
        typeof operation === "string" && (CLEANING_OPERATIONS as readonly string[]).includes(operation),
      ) &&
      (typeof entry["fillValue"] === "string" || entry["fillValue"] === null) &&
      typeof entry["notes"] === "string"
    );
  });
}

async function runStructuredQuery<T>(
  prompt: string,
  schema: Record<string, unknown>,
  systemPrompt: string,
): Promise<T | undefined> {
  let structuredOutput: unknown;

  for await (const message of query({
    prompt,
    options: {
      systemPrompt,
      maxTurns: 8,
      outputFormat: {
        type: "json_schema",
        schema,
      },
    },
  })) {
    if (message.type === "result") {
      if (message.is_error) {
        const details = "errors" in message ? message.errors.join("; ") : message.result;
        throw new Error(`Agent query failed: ${details}`);
      }

      if ("structured_output" in message) {
        structuredOutput = message.structured_output;
      }
    }
  }

  return structuredOutput as T | undefined;
}

export async function profileCsvWithAgent(filePath: string): Promise<CsvProfilingResult> {
  const localProfile = createLocalProfile(filePath);

  const schema: Record<string, unknown> = {
    type: "object",
    additionalProperties: false,
    required: ["parse", "profile"],
    properties: {
      parse: {
        type: "object",
        additionalProperties: false,
        required: ["headers", "rowCount", "sample"],
        properties: {
          headers: {
            type: "array",
            items: { type: "string" },
          },
          rowCount: { type: "number" },
          sample: {
            type: "array",
            items: { type: "object" },
          },
        },
      },
      profile: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["column", "type", "totalRows", "nullCount", "nullPercentage", "uniqueValues", "sampleValues"],
          properties: {
            column: { type: "string" },
            type: { type: "string", enum: ["string", "number", "date", "email"] },
            totalRows: { type: "number" },
            nullCount: { type: "number" },
            nullPercentage: { type: "string" },
            uniqueValues: { type: "number" },
            sampleValues: {
              type: "array",
              items: { type: "string" },
            },
          },
        },
      },
    },
  };

  const prompt = [
    "Profile this CSV using the available MCP tools.",
    `CSV path: ${filePath}`,
    "Call parse_csv and profile_data, then return structured profiling JSON.",
  ].join("\n\n");

  try {
    let structured: unknown;

    for await (const message of query({
      prompt,
      options: {
        systemPrompt:
          "You work on CSV quality profiling. Always call parse_csv and profile_data before returning output.",
        maxTurns: 8,
        outputFormat: {
          type: "json_schema",
          schema,
        },
        mcpServers: {
          "csv-cleaner-pipeline": profilingMcpServer,
        },
      },
    })) {
      if (message.type === "result") {
        if (message.is_error) {
          const details = "errors" in message ? message.errors.join("; ") : message.result;
          throw new Error(`Agent query failed: ${details}`);
        }
        if ("structured_output" in message) {
          structured = message.structured_output;
        }
      }
    }

    if (structured && isCsvProfilingResult(structured)) {
      return structured;
    }

    return localProfile;
  } catch {
    return localProfile;
  }
}

function buildDefaultPlan(profile: CsvProfilingResult): CleaningPlan {
  const rules: CleaningRule[] = profile.profile.map((columnProfile) => {
    const operations: CleaningOperation[] = ["trim", "normalize_whitespace", "remove_non_ascii"];

    if (columnProfile.type === "date") {
      operations.push("normalize_date_iso");
    }

    if (columnProfile.type === "number") {
      operations.push("normalize_integer");
    }

    const lowerName = columnProfile.column.toLowerCase();

    if (lowerName.includes("email")) {
      operations.push("lowercase");
    }

    if (columnProfile.column === "Variant Price") {
      operations.push("normalize_price");
    }

    if (columnProfile.column === "Variant SKU") {
      operations.push("normalize_sku");
    }

    if (columnProfile.column === "Handle") {
      operations.push("normalize_handle");
    }

    if (columnProfile.column === "Published") {
      operations.push("normalize_boolean");
    }

    return {
      column: columnProfile.column,
      operations,
      fillValue: columnProfile.column === "Option1 Value" ? "Default Title" : null,
      notes: `Default cleanup for ${columnProfile.column}`,
    };
  });

  if (!rules.some((rule) => rule.column === "Option1 Name")) {
    rules.push({
      column: "Option1 Name",
      operations: ["trim", "fill_missing"],
      fillValue: "Title",
      notes: "Ensure Shopify option name exists.",
    });
  }

  if (!rules.some((rule) => rule.column === "Option1 Value")) {
    rules.push({
      column: "Option1 Value",
      operations: ["trim", "fill_missing"],
      fillValue: "Default Title",
      notes: "Ensure Shopify option value exists.",
    });
  }

  return {
    summary: "Default cleanup plan with Shopify normalization for common fields.",
    columnRules: rules,
  };
}

export async function generateCleaningPlanWithAgent(
  profile: CsvProfilingResult,
  context: { profile?: string },
): Promise<CleaningPlan> {
  const schema: Record<string, unknown> = {
    type: "object",
    additionalProperties: false,
    required: ["summary", "columnRules"],
    properties: {
      summary: { type: "string" },
      columnRules: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["column", "operations", "fillValue", "notes"],
          properties: {
            column: { type: "string" },
            operations: {
              type: "array",
              items: {
                type: "string",
                enum: [...CLEANING_OPERATIONS],
              },
            },
            fillValue: {
              type: ["string", "null"],
            },
            notes: { type: "string" },
          },
        },
      },
    },
  };

  const prompt = [
    "Create a deterministic CSV cleaning plan for Shopify product import readiness.",
    "Focus on normalizing dates, encoding artifacts, missing obvious values, and format consistency.",
    "Do not invent new columns.",
    `Store profile: ${context.profile ?? "not configured"}`,
    `Data profile:\n${JSON.stringify(profile, null, 2)}`,
  ].join("\n\n");

  try {
    const structured = await runStructuredQuery<CleaningPlan>(
      prompt,
      schema,
      "You are a senior data quality engineer. Return only actionable cleaning rules.",
    );

    if (structured && isCleaningPlan(structured)) {
      return structured;
    }

    return buildDefaultPlan(profile);
  } catch {
    return buildDefaultPlan(profile);
  }
}

function normalizeDateIso(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return trimmed;
  }

  if (isValidDate(trimmed)) {
    return trimmed.slice(0, 10);
  }

  const ymd = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(trimmed);
  if (ymd) {
    const year = ymd[1] ?? "";
    const month = (ymd[2] ?? "").padStart(2, "0");
    const day = (ymd[3] ?? "").padStart(2, "0");
    const normalized = `${year}-${month}-${day}`;
    return isValidDate(normalized) ? normalized : trimmed;
  }

  const mdyOrDmy = /^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/.exec(trimmed);
  if (mdyOrDmy) {
    const leftPart = mdyOrDmy[1] ?? "";
    const middlePart = mdyOrDmy[2] ?? "";
    const yearPart = mdyOrDmy[3] ?? "";
    const left = Number(leftPart);
    const middle = Number(middlePart);
    const year = yearPart.length === 2 ? `20${yearPart}` : yearPart;

    const month = left > 12 ? middle : left;
    const day = left > 12 ? left : middle;

    const normalized = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return isValidDate(normalized) ? normalized : trimmed;
  }

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    const year = parsed.getUTCFullYear();
    const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
    const day = String(parsed.getUTCDate()).padStart(2, "0");
    const normalized = `${year}-${month}-${day}`;
    return isValidDate(normalized) ? normalized : trimmed;
  }

  return trimmed;
}

function normalizeBoolean(value: string): string {
  const normalized = value.trim().toLowerCase();

  if (["true", "1", "yes", "y", "published", "active"].includes(normalized)) {
    return "TRUE";
  }

  if (["false", "0", "no", "n", "draft", "unpublished", "archived"].includes(normalized)) {
    return "FALSE";
  }

  return value.trim();
}

function normalizePrice(value: string): string {
  if (!value.trim()) {
    return "0.00";
  }

  const n = Number(value);
  if (Number.isNaN(n)) {
    return value.trim();
  }

  return n.toFixed(2);
}

function normalizeInteger(value: string): string {
  if (!value.trim()) {
    return "";
  }

  const n = Number(value);
  if (Number.isNaN(n)) {
    return value.trim();
  }

  return String(Math.round(n));
}

function toTitleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/\s+/)
    .map((word) => (word ? word.charAt(0).toUpperCase() + word.slice(1) : ""))
    .join(" ")
    .trim();
}

function normalizeHandle(value: string): string {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return slug || value.trim();
}

function normalizeSku(value: string): string {
  return value.trim().replace(/\s+/g, "-").toUpperCase();
}

function removeNonAscii(value: string): string {
  return value.replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "");
}

function applyOperation(value: string, operation: CleaningOperation, fillValue: string | null): string {
  switch (operation) {
    case "trim":
      return value.trim();
    case "normalize_whitespace":
      return value.replace(/\s+/g, " ").trim();
    case "normalize_date_iso":
      return normalizeDateIso(value);
    case "normalize_boolean":
      return normalizeBoolean(value);
    case "normalize_price":
      return normalizePrice(value);
    case "normalize_integer":
      return normalizeInteger(value);
    case "lowercase":
      return value.toLowerCase();
    case "uppercase":
      return value.toUpperCase();
    case "titlecase":
      return toTitleCase(value);
    case "remove_non_ascii":
      return removeNonAscii(value);
    case "normalize_handle":
      return normalizeHandle(value);
    case "normalize_sku":
      return normalizeSku(value);
    case "fill_missing":
      return value.trim() === "" && fillValue !== null ? fillValue : value;
    default:
      return value;
  }
}

function enforceShopifyDefaults(row: Record<string, string>): Record<string, string> {
  const normalized = { ...row };

  if (normalized["Option1 Value"]?.trim() && !normalized["Option1 Name"]?.trim()) {
    normalized["Option1 Name"] = "Title";
  }

  if (!normalized["Option1 Value"]?.trim()) {
    if (Object.hasOwn(normalized, "Option1 Value")) {
      normalized["Option1 Name"] = normalized["Option1 Name"]?.trim() || "Title";
      normalized["Option1 Value"] = "Default Title";
    }
  }

  const variantPrice = normalized["Variant Price"] ?? "";
  if (Object.hasOwn(normalized, "Variant Price") && !variantPrice.trim()) {
    normalized["Variant Price"] = "0.00";
  }

  if (normalized["Published"] && !normalized["Status"]) {
    normalized["Status"] = normalizeBoolean(normalized["Published"]) === "TRUE" ? "active" : "draft";
  }

  if (normalized["Status"] && !normalized["Published"]) {
    const status = normalized["Status"].trim().toLowerCase();
    normalized["Published"] = status === "active" ? "TRUE" : "FALSE";
  }

  return normalized;
}

function applyCleaningPlan(
  rows: Record<string, string>[],
  headers: string[],
  cleaningPlan: CleaningPlan,
): Record<string, string>[] {
  const rulesByColumn = new Map(cleaningPlan.columnRules.map((rule) => [rule.column, rule]));

  return rows.map((row) => {
    const cleaned: Record<string, string> = {};

    for (const header of headers) {
      let value = row[header] ?? "";
      const rule = rulesByColumn.get(header);

      if (rule) {
        for (const operation of rule.operations) {
          value = applyOperation(value, operation, rule.fillValue);
        }
      } else {
        value = value.trim();
      }

      cleaned[header] = value;
    }

    return enforceShopifyDefaults(cleaned);
  });
}

function escapeCsvValue(value: string): string {
  const normalized = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (/[,"\n]/.test(normalized)) {
    return `"${normalized.replace(/"/g, '""')}"`;
  }
  return normalized;
}

function toCsv(headers: string[], rows: Record<string, string>[]): string {
  const lines: string[] = [];
  lines.push(headers.map(escapeCsvValue).join(","));

  for (const row of rows) {
    lines.push(headers.map((header) => escapeCsvValue(row[header] ?? "")).join(","));
  }

  return `${lines.join("\n")}\n`;
}

function deriveOutputPath(inputPath: string, explicitOutputPath?: string): string {
  if (explicitOutputPath) {
    return resolve(explicitOutputPath);
  }

  const directory = dirname(resolve(inputPath));
  const extension = extname(inputPath);
  const base = basename(inputPath, extension);
  return join(directory, `${base}.pipeline.cleaned.csv`);
}

function formatErrors(errors: string[]): string {
  if (!errors.length) {
    return "Unknown shopctl error.";
  }

  return errors.join("; ");
}

export async function runShopifyCsvPipeline(
  inputPath: string,
  options: PipelineOptions = {},
  dependencies: PipelineDependencies = {},
): Promise<PipelineResult> {
  const logger = options.logger ?? DEFAULT_LOGGER;
  const profileName = options.profile;

  logger.info("[pipeline] Step 1/7: Profiling CSV with CSVCleanerAgent parse_csv/profile_data flow");
  const profileCsv = dependencies.profileCsv ?? profileCsvWithAgent;
  const profileResult = await profileCsv(inputPath);

  logger.info("[pipeline] Step 2/7: Generating AI cleaning plan and applying normalization");
  const buildCleaningPlan = dependencies.generateCleaningPlan ?? generateCleaningPlanWithAgent;
  const cleaningPlan = await buildCleaningPlan(profileResult, { profile: profileName });

  const csvData = parseCsvFile(inputPath);
  const cleanedRows = applyCleaningPlan(csvData.rows, csvData.headers, cleaningPlan);
  const cleanedCsv = toCsv(csvData.headers, cleanedRows);

  logger.info("[pipeline] Step 3/7: Writing cleaned CSV to temporary file");
  const tempDirectory = resolve(options.tempDir ?? join(process.cwd(), ".tmp"));
  await mkdir(tempDirectory, { recursive: true });

  const tempName = `${basename(inputPath, extname(inputPath))}.${randomUUID()}.cleaned.tmp.csv`;
  const cleanedTempPath = join(tempDirectory, tempName);
  await Bun.write(cleanedTempPath, cleanedCsv);

  const finalOutputPath = deriveOutputPath(inputPath, options.outputPath);

  const bridge =
    dependencies.bridge ??
    createShopctlBridge({
      profile: profileName,
      shopctlPath: options.shopctlPath,
    });

  logger.info("[pipeline] Step 4/7: Running shopctl csv validate");
  const validationResult = await bridge.validateCsv(cleanedTempPath);

  let finalCsvPath = finalOutputPath;
  let fixResult: ShopctlCommandResult<ShopctlFixReport> | undefined;

  if (validationResult.hasValidationErrors) {
    logger.info("[pipeline] Step 5/7: Validation issues found, running shopctl csv fix");
    fixResult = await bridge.fixCsv(cleanedTempPath, finalOutputPath);

    if (!fixResult.success) {
      throw new Error(`shopctl csv fix failed: ${formatErrors(fixResult.errors)}`);
    }

    finalCsvPath = fixResult.parsed?.outputPath ?? finalOutputPath;
  } else {
    logger.info("[pipeline] Step 5/7: Validation passed, skipping shopctl csv fix");
    if (validationResult.exitCode !== 0) {
      throw new Error(`shopctl csv validate failed: ${formatErrors(validationResult.errors)}`);
    }

    await Bun.write(finalOutputPath, Bun.file(cleanedTempPath));
    finalCsvPath = finalOutputPath;
  }

  let diffResult: ShopctlCommandResult<ShopctlDiffRow[]> | undefined;
  if (profileName) {
    logger.info("[pipeline] Step 6/7: Running shopctl csv diff against store profile");
    diffResult = await bridge.diffCsv(finalCsvPath);
    if (!diffResult.success) {
      logger.warn(`[pipeline] shopctl csv diff did not complete successfully: ${formatErrors(diffResult.errors)}`);
    }
  } else {
    logger.info("[pipeline] Step 6/7: No store profile configured, skipping csv diff");
  }

  let importResult: ShopctlCommandResult<ShopctlImportResult> | undefined;
  if (options.autoImport) {
    const dryRun = Boolean(options.dryRun);
    logger.info(
      `[pipeline] Step 7/7: Running shopctl csv import (${dryRun ? "--dry-run" : "--confirm (apply changes)"})`,
    );

    importResult = await bridge.importCsv(finalCsvPath, {
      dryRun,
    });

    if (!importResult.success) {
      throw new Error(`shopctl csv import failed: ${formatErrors(importResult.errors)}`);
    }
  } else {
    logger.info("[pipeline] Step 7/7: Auto-import disabled, skipping shopctl csv import");
  }

  logger.info("[pipeline] Completed successfully");

  return {
    inputPath: resolve(inputPath),
    cleanedTempPath,
    finalCsvPath,
    profileResult,
    cleaningPlan,
    validationResult,
    fixResult,
    diffResult,
    importResult,
  };
}
