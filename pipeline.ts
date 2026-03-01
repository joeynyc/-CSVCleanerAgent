import { runShopifyCsvPipeline } from "./src/pipeline";

interface CliArgs {
  inputPath: string;
  profile?: string;
  dryRun: boolean;
  autoImport: boolean;
  outputPath?: string;
}

function printUsage(): void {
  console.log("Usage: bun run pipeline.ts <input.csv> [--profile default] [--dry-run] [--auto-import] [--output cleaned.csv]");
}

function parseArgs(argv: string[]): CliArgs {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    printUsage();
    process.exit(0);
  }

  const args = [...argv];
  const inputPath = args.shift();

  if (!inputPath || inputPath.startsWith("--")) {
    throw new Error("Missing required <input.csv> path.");
  }

  let profile: string | undefined = "default";
  let dryRun = false;
  let autoImport = false;
  let outputPath: string | undefined;

  while (args.length > 0) {
    const current = args.shift();

    if (!current) {
      break;
    }

    if (current === "--profile") {
      const value = args.shift();
      if (!value) {
        throw new Error("--profile requires a value");
      }
      profile = value.toLowerCase() === "none" ? undefined : value;
      continue;
    }

    if (current === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (current === "--auto-import") {
      autoImport = true;
      continue;
    }

    if (current === "--output") {
      const value = args.shift();
      if (!value) {
        throw new Error("--output requires a value");
      }
      outputPath = value;
      continue;
    }

    throw new Error(`Unknown argument: ${current}`);
  }

  return {
    inputPath,
    profile,
    dryRun,
    autoImport,
    outputPath,
  };
}

async function main(): Promise<void> {
  try {
    const args = parseArgs(process.argv.slice(2));

    const result = await runShopifyCsvPipeline(args.inputPath, {
      profile: args.profile,
      dryRun: args.dryRun,
      autoImport: args.autoImport,
      outputPath: args.outputPath,
    });

    const validationErrors = result.validationResult.parsed?.errors.length ?? 0;
    const diffCount = result.diffResult?.parsed ? result.diffResult.parsed.length : 0;
    const importMode = args.autoImport ? (args.dryRun ? "dry-run" : "confirm") : "skipped";

    console.log("\nPipeline Summary");
    console.log(`- Input: ${result.inputPath}`);
    console.log(`- Cleaned temp: ${result.cleanedTempPath}`);
    console.log(`- Final output: ${result.finalCsvPath}`);
    console.log(`- Rows profiled: ${result.profileResult.parse.rowCount}`);
    console.log(`- Validation errors: ${validationErrors}`);
    console.log(`- Fix applied: ${result.fixResult ? "yes" : "no"}`);
    console.log(`- Diff rows: ${diffCount}`);
    console.log(`- Import mode: ${importMode}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Pipeline failed: ${message}`);
    printUsage();
    process.exitCode = 1;
  }
}

await main();

