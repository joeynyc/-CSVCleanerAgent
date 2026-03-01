import { $ } from "bun";

export interface ShopctlIssue {
  line?: number;
  column?: string;
  code?: string;
  message: string;
}

export interface ShopctlValidationReport {
  filePath: string;
  headers: string[];
  rowCount: number;
  errors: ShopctlIssue[];
  warnings: ShopctlIssue[];
  valid: boolean;
}

export interface ShopctlFixReport {
  inputPath: string;
  outputPath: string;
  rowCount: number;
  fixes: Array<{ line: number; field: string; action: string }>;
}

export interface ShopctlDiffRow {
  handle: string;
  title: string;
  action: string;
  changed_fields: string;
}

export interface ShopctlImportResult {
  summary?: {
    created: number;
    updated: number;
    skipped: number;
    failed: number;
    dry_run: boolean;
  };
  results?: Array<{
    handle: string;
    action: string;
    status: string;
    detail?: string;
  }>;
}

export interface ShopctlCommandResult<TParsed = unknown> {
  command: string;
  success: boolean;
  exitCode: number;
  output: string;
  errors: string[];
  parsed?: TParsed;
}

export interface ShopctlValidationResult extends ShopctlCommandResult<ShopctlValidationReport> {
  hasValidationErrors: boolean;
}

export interface ShopctlExecOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type ShopctlExecutor = (command: string, cwd?: string) => Promise<ShopctlExecOutput>;

export interface ShopctlBridgeOptions {
  profile?: string;
  shopctlPath?: string;
  cwd?: string;
  exec?: ShopctlExecutor;
}

export interface ImportCsvOptions {
  dryRun?: boolean;
  overwrite?: boolean;
}

export interface ShopctlBridge {
  validateCsv(filePath: string): Promise<ShopctlValidationResult>;
  fixCsv(inputPath: string, outputPath: string): Promise<ShopctlCommandResult<ShopctlFixReport>>;
  diffCsv(filePath: string): Promise<ShopctlCommandResult<ShopctlDiffRow[]>>;
  importCsv(filePath: string, options?: ImportCsvOptions): Promise<ShopctlCommandResult<ShopctlImportResult>>;
}

const defaultExecutor: ShopctlExecutor = async (command, cwd) => {
  const shell = cwd ? $.cwd(cwd) : $;
  const result = await shell`${{ raw: command }}`.quiet().nothrow();

  return {
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    exitCode: result.exitCode,
  };
};

function buildCommand(binary: string, args: string[]): string {
  return [binary, ...args].map((part) => $.escape(part)).join(" ");
}

function extractOutput(stdout: string, stderr: string): string {
  const cleanedStdout = stdout.trim();
  const cleanedStderr = stderr.trim();
  return [cleanedStdout, cleanedStderr].filter(Boolean).join("\n");
}

function parseJsonFromOutput<T>(output: string): T | undefined {
  const trimmed = output.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const objectStart = trimmed.indexOf("{");
    const arrayStart = trimmed.indexOf("[");
    const starts = [objectStart, arrayStart].filter((index) => index >= 0);

    if (!starts.length) {
      return undefined;
    }

    const start = Math.min(...starts);
    const end = Math.max(trimmed.lastIndexOf("}"), trimmed.lastIndexOf("]"));

    if (end <= start) {
      return undefined;
    }

    try {
      return JSON.parse(trimmed.slice(start, end + 1)) as T;
    } catch {
      return undefined;
    }
  }
}

function collectStdErrErrors(stderr: string): string[] {
  return stderr
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function issueToText(issue: ShopctlIssue): string {
  const location = [issue.line, issue.column].filter(Boolean).join(":");
  const prefix = location ? `[${location}] ` : "";
  const code = issue.code ? `${issue.code}: ` : "";
  return `${prefix}${code}${issue.message}`;
}

function collectImportErrors(parsed?: ShopctlImportResult): string[] {
  if (!parsed?.results) {
    return [];
  }

  return parsed.results
    .filter((row) => row.status === "failed")
    .map((row) => `${row.handle}: ${row.detail ?? "Import failed"}`);
}

export function createShopctlBridge(options: ShopctlBridgeOptions = {}): ShopctlBridge {
  const shopctlPath = options.shopctlPath ?? "shopctl";
  const profile = options.profile;
  const cwd = options.cwd;
  const exec = options.exec ?? defaultExecutor;

  const runCommand = async <TParsed>(args: string[]): Promise<ShopctlCommandResult<TParsed>> => {
    const fullArgs: string[] = [];

    if (profile) {
      fullArgs.push("--profile", profile);
    }

    fullArgs.push("--json", ...args);

    const command = buildCommand(shopctlPath, fullArgs);
    const execution = await exec(command, cwd);
    const output = extractOutput(execution.stdout, execution.stderr);
    const parsed = parseJsonFromOutput<TParsed>(execution.stdout);
    const stderrErrors = collectStdErrErrors(execution.stderr);

    const errors = [...stderrErrors];
    if (execution.exitCode !== 0 && errors.length === 0) {
      errors.push(`Command failed with exit code ${execution.exitCode}`);
    }

    return {
      command,
      success: execution.exitCode === 0,
      exitCode: execution.exitCode,
      output,
      errors: dedupe(errors),
      parsed,
    };
  };

  return {
    async validateCsv(filePath: string): Promise<ShopctlValidationResult> {
      const base = await runCommand<ShopctlValidationReport>(["csv", "validate", filePath]);
      const validationErrors = base.parsed?.errors ?? [];
      const hasValidationErrors = validationErrors.length > 0 || base.parsed?.valid === false;

      return {
        ...base,
        success: base.exitCode === 0 && !hasValidationErrors,
        hasValidationErrors,
        errors: dedupe([...base.errors, ...validationErrors.map(issueToText)]),
      };
    },

    async fixCsv(inputPath: string, outputPath: string): Promise<ShopctlCommandResult<ShopctlFixReport>> {
      const base = await runCommand<ShopctlFixReport>(["csv", "fix", inputPath, "-o", outputPath]);
      return {
        ...base,
        success: base.exitCode === 0,
      };
    },

    async diffCsv(filePath: string): Promise<ShopctlCommandResult<ShopctlDiffRow[]>> {
      const base = await runCommand<ShopctlDiffRow[]>(["csv", "diff", filePath]);
      return {
        ...base,
        success: base.exitCode === 0,
      };
    },

    async importCsv(
      filePath: string,
      importOptions: ImportCsvOptions = {},
    ): Promise<ShopctlCommandResult<ShopctlImportResult>> {
      const args = ["csv", "import", filePath];
      if (importOptions.dryRun) {
        args.push("--dry-run");
      }
      if (importOptions.overwrite) {
        args.push("--overwrite");
      }

      const base = await runCommand<ShopctlImportResult>(args);
      const importErrors = collectImportErrors(base.parsed);
      const failed = base.parsed?.summary?.failed ?? 0;

      return {
        ...base,
        success: base.exitCode === 0 && failed === 0,
        errors: dedupe([...base.errors, ...importErrors]),
      };
    },
  };
}

