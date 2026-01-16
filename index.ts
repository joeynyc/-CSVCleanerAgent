import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
  CONFIG,
  isValidDate,
  parseCsvFile,
  EMAIL_REGEX,
  RateLimiter,
} from "./src/utils";
import packageJson from "./package.json";

// Type definitions
interface ToolResponse {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

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

// Global rate limiter instance
const rateLimiter = new RateLimiter();

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
      rateLimiter.checkLimit();

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
      rateLimiter.checkLimit();

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
          nullPercentage: values.length > 0
            ? ((nullCount / values.length) * 100).toFixed(1) + "%"
            : "0.0%",
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
  version: packageJson.version,
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
