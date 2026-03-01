import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  runShopifyCsvPipeline,
  type CleaningPlan,
  type CsvProfilingResult,
  type PipelineLogger,
} from "../src/pipeline";
import {
  createShopctlBridge,
  type ShopctlBridge,
  type ShopctlCommandResult,
  type ShopctlDiffRow,
  type ShopctlFixReport,
  type ShopctlImportResult,
  type ShopctlValidationResult,
} from "../src/shopctl-bridge";

const TEST_TMP_DIR = resolve("./tests/.tmp");

const SILENT_LOGGER: PipelineLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

function makeProfilingResult(): CsvProfilingResult {
  return {
    parse: {
      headers: ["Handle", "Title", "Variant SKU", "Variant Price"],
      rowCount: 1,
      sample: [
        {
          Handle: "my-product",
          Title: "My Product",
          "Variant SKU": "sku-1",
          "Variant Price": "10",
        },
      ],
    },
    profile: [
      {
        column: "Handle",
        type: "string",
        totalRows: 1,
        nullCount: 0,
        nullPercentage: "0.0%",
        uniqueValues: 1,
        sampleValues: ["my-product"],
      },
      {
        column: "Title",
        type: "string",
        totalRows: 1,
        nullCount: 0,
        nullPercentage: "0.0%",
        uniqueValues: 1,
        sampleValues: ["My Product"],
      },
      {
        column: "Variant SKU",
        type: "string",
        totalRows: 1,
        nullCount: 0,
        nullPercentage: "0.0%",
        uniqueValues: 1,
        sampleValues: ["sku-1"],
      },
      {
        column: "Variant Price",
        type: "number",
        totalRows: 1,
        nullCount: 0,
        nullPercentage: "0.0%",
        uniqueValues: 1,
        sampleValues: ["10"],
      },
    ],
  };
}

function makeCleaningPlan(): CleaningPlan {
  return {
    summary: "Normalize Shopify pricing and SKU formatting.",
    columnRules: [
      {
        column: "Variant Price",
        operations: ["trim", "normalize_price"],
        fillValue: null,
        notes: "Standardize prices to 2 decimals.",
      },
      {
        column: "Variant SKU",
        operations: ["trim", "normalize_sku"],
        fillValue: null,
        notes: "Uppercase SKUs.",
      },
    ],
  };
}

function makeValidationResult(overrides: Partial<ShopctlValidationResult> = {}): ShopctlValidationResult {
  return {
    command: "shopctl --json csv validate file.csv",
    success: true,
    exitCode: 0,
    output: "ok",
    errors: [],
    hasValidationErrors: false,
    parsed: {
      filePath: "file.csv",
      headers: ["Handle", "Title", "Variant SKU", "Variant Price"],
      rowCount: 1,
      errors: [],
      warnings: [],
      valid: true,
    },
    ...overrides,
  };
}

function makeCommandResult<TParsed>(overrides: Partial<ShopctlCommandResult<TParsed>> = {}): ShopctlCommandResult<TParsed> {
  return {
    command: "shopctl --json csv command",
    success: true,
    exitCode: 0,
    output: "ok",
    errors: [],
    ...overrides,
  };
}

describe("shopctl bridge", () => {
  it("parses successful validate output and keeps command metadata", async () => {
    const calls: string[] = [];
    const bridge = createShopctlBridge({
      profile: "default",
      exec: async (command) => {
        calls.push(command);
        return {
          exitCode: 0,
          stderr: "",
          stdout: JSON.stringify({
            filePath: "cleaned.csv",
            headers: ["Handle"],
            rowCount: 1,
            errors: [],
            warnings: [],
            valid: true,
          }),
        };
      },
    });

    const result = await bridge.validateCsv("cleaned.csv");

    expect(result.success).toBe(true);
    expect(result.hasValidationErrors).toBe(false);
    expect(result.parsed?.valid).toBe(true);
    expect(calls[0]).toContain("shopctl");
    expect(calls[0]).toContain("--profile");
    expect(calls[0]).toContain("csv");
    expect(calls[0]).toContain("validate");
  });

  it("treats validation report errors as pipeline failures", async () => {
    const bridge = createShopctlBridge({
      exec: async () => ({
        exitCode: 0,
        stderr: "",
        stdout: JSON.stringify({
          filePath: "cleaned.csv",
          headers: ["Handle"],
          rowCount: 1,
          errors: [{ line: 2, column: "Handle", code: "missing", message: "Missing Handle" }],
          warnings: [],
          valid: false,
        }),
      }),
    });

    const result = await bridge.validateCsv("cleaned.csv");

    expect(result.success).toBe(false);
    expect(result.hasValidationErrors).toBe(true);
    expect(result.errors.join(" ")).toContain("Missing Handle");
  });
});

describe("shopify pipeline", () => {
  let inputPath = "";

  beforeEach(() => {
    mkdirSync(TEST_TMP_DIR, { recursive: true });
    inputPath = join(TEST_TMP_DIR, `input-${Date.now()}.csv`);
    writeFileSync(
      inputPath,
      "Handle,Title,Variant SKU,Variant Price\nmy-product,My Product,sku-1,10\n",
      "utf8",
    );
  });

  afterEach(() => {
    if (inputPath) {
      try {
        unlinkSync(inputPath);
      } catch {
        // ignore cleanup errors
      }
    }

    try {
      rmSync(TEST_TMP_DIR, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it("runs validate -> fix -> diff -> import when validation fails and auto-import is enabled", async () => {
    const callOrder: string[] = [];
    const observed: { fixInput?: string; fixOutput?: string; importFile?: string } = {};

    const bridge: ShopctlBridge = {
      validateCsv: async () => {
        callOrder.push("validate");
        return makeValidationResult({
          success: false,
          hasValidationErrors: true,
          parsed: {
            filePath: "temp.csv",
            headers: ["Handle"],
            rowCount: 1,
            errors: [{ message: "Bad row" }],
            warnings: [],
            valid: false,
          },
        });
      },
      fixCsv: async (input, output): Promise<ShopctlCommandResult<ShopctlFixReport>> => {
        callOrder.push("fix");
        observed.fixInput = input;
        observed.fixOutput = output;
        return makeCommandResult<ShopctlFixReport>({
          parsed: {
            inputPath: input,
            outputPath: output,
            rowCount: 1,
            fixes: [],
          },
        });
      },
      diffCsv: async (): Promise<ShopctlCommandResult<ShopctlDiffRow[]>> => {
        callOrder.push("diff");
        return makeCommandResult<ShopctlDiffRow[]>({ parsed: [] });
      },
      importCsv: async (file, _options): Promise<ShopctlCommandResult<ShopctlImportResult>> => {
        callOrder.push("import");
        observed.importFile = file;
        return makeCommandResult<ShopctlImportResult>({
          parsed: {
            summary: {
              created: 0,
              updated: 0,
              skipped: 1,
              failed: 0,
              dry_run: true,
            },
            results: [],
          },
        });
      },
    };

    const finalOutput = join(TEST_TMP_DIR, "final-output.csv");

    const result = await runShopifyCsvPipeline(
      inputPath,
      {
        profile: "default",
        autoImport: true,
        dryRun: true,
        outputPath: finalOutput,
        tempDir: TEST_TMP_DIR,
        logger: SILENT_LOGGER,
      },
      {
        profileCsv: async () => makeProfilingResult(),
        generateCleaningPlan: async () => makeCleaningPlan(),
        bridge,
      },
    );

    expect(callOrder).toEqual(["validate", "fix", "diff", "import"]);
    expect(observed.fixInput).toBe(result.cleanedTempPath);
    expect(observed.fixOutput).toBe(finalOutput);
    expect(observed.importFile).toBe(finalOutput);
    expect(result.finalCsvPath).toBe(finalOutput);
  });

  it("skips fix, diff, and import when validation passes and no profile is configured", async () => {
    const callOrder: string[] = [];

    const bridge: ShopctlBridge = {
      validateCsv: async () => {
        callOrder.push("validate");
        return makeValidationResult();
      },
      fixCsv: async () => {
        callOrder.push("fix");
        return makeCommandResult<ShopctlFixReport>();
      },
      diffCsv: async () => {
        callOrder.push("diff");
        return makeCommandResult<ShopctlDiffRow[]>();
      },
      importCsv: async () => {
        callOrder.push("import");
        return makeCommandResult<ShopctlImportResult>();
      },
    };

    const result = await runShopifyCsvPipeline(
      inputPath,
      {
        profile: undefined,
        autoImport: false,
        tempDir: TEST_TMP_DIR,
        logger: SILENT_LOGGER,
      },
      {
        profileCsv: async () => makeProfilingResult(),
        generateCleaningPlan: async () => makeCleaningPlan(),
        bridge,
      },
    );

    expect(callOrder).toEqual(["validate"]);
    expect(result.fixResult).toBeUndefined();
    expect(result.diffResult).toBeUndefined();
    expect(result.importResult).toBeUndefined();
  });
});
