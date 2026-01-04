import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { readFileSync, statSync, existsSync } from "fs";
import { resolve, normalize } from "path";
import { parse } from "csv-parse/sync";

// Configuration constants
const CONFIG = {
  MAX_FILE_SIZE: 50 * 1024 * 1024, // 50MB
  MAX_PROMPT_LENGTH: 10000,
  SAMPLE_ROW_COUNT: 5,
  SAMPLE_VALUE_COUNT: 3,
  RATE_LIMIT_MAX_CALLS: 100, // Max tool calls per minute
  RATE_LIMIT_WINDOW_MS: 60000, // 1 minute window
} as const;

// Type definitions
interface ToolResponse {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

interface CsvData {
  headers: string[];
  rows: Record<string, string>[];
}

// Email validation (RFC 5322 simplified)
const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

// Structured logging interface
interface AuditLog {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  action: string;
  filePath?: string;
  success: boolean;
  error?: string;
  details?: Record<string, unknown>;
}

// Structured logging helper
function logAudit(log: Omit<AuditLog, 'timestamp'>): void {
  const auditEntry: AuditLog = {
    ...log,
    timestamp: new Date().toISOString(),
  };

  // Log to stderr as JSON for monitoring/parsing
  console.error(JSON.stringify(auditEntry));
}

// Rate limiting class to prevent abuse
class RateLimiter {
  private calls: number = 0;
  private resetTime: number = Date.now() + CONFIG.RATE_LIMIT_WINDOW_MS;

  async checkLimit(limit: number = CONFIG.RATE_LIMIT_MAX_CALLS): Promise<void> {
    const now = Date.now();

    // Reset counter if window has passed
    if (now > this.resetTime) {
      this.calls = 0;
      this.resetTime = now + CONFIG.RATE_LIMIT_WINDOW_MS;
    }

    this.calls++;

    if (this.calls > limit) {
      const resetIn = Math.ceil((this.resetTime - now) / 1000);
      throw new Error(
        `Rate limit exceeded. Maximum ${limit} tool calls per minute. Reset in ${resetIn} seconds.`
      );
    }
  }

  getStatus(): { calls: number; limit: number; resetsIn: number } {
    const now = Date.now();
    return {
      calls: this.calls,
      limit: CONFIG.RATE_LIMIT_MAX_CALLS,
      resetsIn: Math.ceil((this.resetTime - now) / 1000),
    };
  }
}

// Global rate limiter instance
const rateLimiter = new RateLimiter();

// Security: Validate file path to prevent path traversal
function validateFilePath(filePath: string): string {
  const workingDir = process.cwd();
  const resolvedPath = resolve(normalize(filePath));

  // Ensure path is within working directory
  if (!resolvedPath.startsWith(workingDir)) {
    throw new Error("Access denied: File path must be within the current working directory");
  }

  // Only allow .csv files
  if (!resolvedPath.toLowerCase().endsWith('.csv')) {
    throw new Error("Invalid file type: Only CSV files are allowed");
  }

  return resolvedPath;
}

// Security: Validate file size to prevent DoS
function validateFileSize(filePath: string): void {
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const stats = statSync(filePath);
  if (stats.size > CONFIG.MAX_FILE_SIZE) {
    throw new Error(
      `File too large: ${(stats.size / 1024 / 1024).toFixed(2)}MB (maximum ${CONFIG.MAX_FILE_SIZE / 1024 / 1024}MB)`
    );
  }

  if (stats.size === 0) {
    throw new Error("File is empty");
  }
}

// Security: Sanitize CSV values to prevent formula injection
function sanitizeCsvValue(value: string): string {
  const trimmed = value.trim();

  // Check for formula injection patterns
  if (trimmed.length > 0 && /^[=@+\-\|%]/.test(trimmed)) {
    // Prefix with single quote to neutralize formula
    return `'${trimmed}`;
  }

  return trimmed;
}

// Security: Validate date format
function isValidDate(str: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(str);
  if (!match) return false;

  const date = new Date(str);
  return date instanceof Date && !isNaN(date.getTime());
}

// Encoding: Read file with intelligent encoding detection
function readFileWithEncoding(filePath: string): string {
  try {
    // Try UTF-8 first (most common encoding)
    const content = readFileSync(filePath, "utf-8");

    // Check for UTF-8 decoding errors (replacement characters)
    if (content.includes('\uFFFD')) {
      // UTF-8 decoding failed, try Latin1
      return readFileSync(filePath, "latin1");
    }

    return content;
  } catch (error) {
    // If UTF-8 fails entirely, fallback to Latin1 (compatible with Windows-1252, ISO-8859-1)
    try {
      return readFileSync(filePath, "latin1");
    } catch (fallbackError) {
      throw new Error(
        `Unable to read file with supported encodings (UTF-8, Latin1): ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
}

// Shared CSV parsing logic with security measures
function parseCsvFile(filePath: string): CsvData {
  // Security validations
  const validatedPath = validateFilePath(filePath);
  validateFileSize(validatedPath);

  // Read file content with intelligent encoding detection
  const content = readFileWithEncoding(validatedPath);

  // Parse CSV using proper library (handles quotes, escapes, multiline)
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_quotes: true,
    escape: '"',
    quote: '"',
  }) as Record<string, string>[];

  if (records.length === 0) {
    throw new Error("CSV file contains no data rows");
  }

  // Get headers from first record
  const headers = Object.keys(records[0] ?? {});

  // Sanitize all values to prevent CSV injection
  const sanitizedRows = records.map(row => {
    const sanitized: Record<string, string> = {};
    for (const [key, value] of Object.entries(row)) {
      sanitized[key] = sanitizeCsvValue(value ?? "");
    }
    return sanitized;
  });

  return {
    headers,
    rows: sanitizedRows,
  };
}

// Consistent error response helper
function createErrorResponse(error: unknown, action: string, filePath?: string): ToolResponse {
  const message = error instanceof Error
    ? error.message
    : "An unknown error occurred";

  // Structured logging for errors
  logAudit({
    level: 'error',
    action,
    filePath,
    success: false,
    error: message,
  });

  return {
    content: [{
      type: "text",
      text: `Error: ${message}`
    }],
    isError: true,
  };
}

// Zod schema with validation refinements
const filePathSchema = z.string()
  .min(1, "File path cannot be empty")
  .max(1000, "File path too long")
  .refine(
    (path) => !path.includes('..'),
    "Path traversal (..) not allowed"
  )
  .describe("Path to the CSV file (must be .csv in current directory)");

// Tool 1: Parse CSV file
const parseCsv = tool(
  "parse_csv",
  `Parse a CSV file and return headers and row data.

Example usage:
- parse_csv({ filePath: "./data/customers.csv" })
- parse_csv({ filePath: "sample.csv" })

Returns:
- headers: Array of column names
- rowCount: Total number of data rows
- sample: First ${CONFIG.SAMPLE_ROW_COUNT} rows as JSON objects

Security: Only CSV files in the current working directory are allowed.`,
  {
    filePath: filePathSchema,
  },
  async (args): Promise<ToolResponse> => {
    try {
      // Rate limiting check
      await rateLimiter.checkLimit();

      const { headers, rows } = parseCsvFile(args.filePath);

      const result = {
        headers,
        rowCount: rows.length,
        sample: rows.slice(0, CONFIG.SAMPLE_ROW_COUNT),
      };

      // Audit log for successful parse
      logAudit({
        level: 'info',
        action: 'parse_csv',
        filePath: args.filePath,
        success: true,
        details: { rowCount: rows.length, headerCount: headers.length },
      });

      return {
        content: [
          {
            type: "text",
            text: `Parsed CSV successfully:\n${JSON.stringify(result, null, 2)}`,
          },
        ],
      };
    } catch (error) {
      return createErrorResponse(error, 'parse_csv', args.filePath);
    }
  }
);

// Tool 2: Profile CSV data to detect types and issues
const profileData = tool(
  "profile_data",
  `Analyze CSV data to detect column types, null values, and anomalies.

Example usage:
- profile_data({ filePath: "./data/customers.csv" })
- profile_data({ filePath: "sample.csv" })

Returns:
- column: Column name
- type: Detected type (string, number, date, email)
- totalRows: Total number of rows
- nullCount: Number of empty/null values
- nullPercentage: Percentage of null values
- uniqueValues: Count of unique values
- sampleValues: First ${CONFIG.SAMPLE_VALUE_COUNT} non-empty values

Security: Only CSV files in the current working directory are allowed.`,
  {
    filePath: filePathSchema,
  },
  async (args): Promise<ToolResponse> => {
    try {
      // Rate limiting check
      await rateLimiter.checkLimit();

      const { headers, rows } = parseCsvFile(args.filePath);

      const profile = headers.map((header) => {
        const values = rows.map(row => row[header] ?? "");
        const nonEmpty = values.filter(v => v !== "");
        const nullCount = values.length - nonEmpty.length;
        const unique = new Set(nonEmpty).size;

        // Detect type with improved validation
        let type = "string";
        if (nonEmpty.every(v => !isNaN(Number(v)) && v !== "")) {
          type = "number";
        } else if (nonEmpty.every(v => isValidDate(v))) {
          type = "date";
        } else if (nonEmpty.every(v => EMAIL_REGEX.test(v))) {
          type = "email";
        }

        return {
          column: header,
          type,
          totalRows: values.length,
          nullCount,
          nullPercentage: ((nullCount / values.length) * 100).toFixed(1) + "%",
          uniqueValues: unique,
          sampleValues: nonEmpty.slice(0, CONFIG.SAMPLE_VALUE_COUNT),
        };
      });

      // Audit log for successful profiling
      logAudit({
        level: 'info',
        action: 'profile_data',
        filePath: args.filePath,
        success: true,
        details: { columnCount: headers.length, rowCount: rows.length },
      });

      return {
        content: [
          {
            type: "text",
            text: `Data Profile:\n${JSON.stringify(profile, null, 2)}`,
          },
        ],
      };
    } catch (error) {
      return createErrorResponse(error, 'profile_data', args.filePath);
    }
  }
);

// Create MCP server with CSV tools
const csvCleanerServer = createSdkMcpServer({
  name: "csv-cleaner",
  version: "0.1.0",
  tools: [parseCsv, profileData],
});

// Type guard for text content
function isTextContent(c: unknown): c is { type: "text"; text: string } {
  return (
    typeof c === "object" &&
    c !== null &&
    "type" in c &&
    c.type === "text" &&
    "text" in c &&
    typeof c.text === "string"
  );
}

// Main function to run the agent
async function main(): Promise<void> {
  console.log("CSV Cleaner Agent Starting...\n");

  const prompt = process.argv[2] || "Hello! I'm the CSV Cleaner Agent. What CSV file would you like me to help you clean?";

  // Validate prompt length
  if (prompt.length > CONFIG.MAX_PROMPT_LENGTH) {
    console.error(`Error: Prompt too long (max ${CONFIG.MAX_PROMPT_LENGTH} characters)`);
    process.exitCode = 1;
    return;
  }

  // Warn about suspicious patterns
  if (prompt.includes("ANTHROPIC_API_KEY") || prompt.includes(".env")) {
    console.warn("Warning: Prompt contains sensitive keywords");
  }

  try {
    for await (const message of query({
      prompt,
      options: {
        mcpServers: {
          "csv-cleaner": csvCleanerServer,
        },
        allowedTools: ["Read", "Write"],
        systemPrompt: `You are a CSV cleaning assistant. You help users clean and validate CSV files.

SECURITY GUIDELINES:
- Only access CSV files in the current working directory
- Never attempt to read system files or sensitive data
- All file paths are validated and restricted for security

Your capabilities:
- Parse CSV files to understand their structure (using secure parsing)
- Profile data to detect types, null values, and anomalies
- Suggest cleaning strategies based on target formats (Shopify, QuickBooks, etc.)

WORKFLOW:
1. When a user provides a CSV file path, first verify it's a .csv file
2. Use parse_csv to analyze structure
3. Use profile_data to detect quality issues
4. Provide actionable cleaning recommendations with specific examples

ERROR HANDLING:
- If file access fails, explain the security restrictions clearly
- If data is malformed, suggest specific fixes
- Always validate before suggesting destructive operations`,
      },
    })) {
      if ("result" in message) {
        console.log("\nResult:", message.result);
      } else if (message.type === "assistant") {
        // Show assistant thinking
        const textContent = message.message.content.find(isTextContent);
        if (textContent) {
          console.log("Agent:", textContent.text);
        }
      }
    }
  } catch (error) {
    console.error("Fatal Error:", error);
    // Ensure logs are flushed
    await new Promise(resolve => setTimeout(resolve, 100));
    process.exitCode = 1;
  }
}

main();
