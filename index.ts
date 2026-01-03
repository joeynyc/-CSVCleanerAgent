import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { readFileSync } from "fs";

// Tool 1: Parse CSV file
const parseCsv = tool(
  "parse_csv",
  "Parse a CSV file and return headers and row data",
  {
    filePath: z.string().describe("Path to the CSV file to parse"),
  },
  async (args) => {
    try {
      const content = readFileSync(args.filePath, "utf-8");
      const lines = content.trim().split("\n");

      if (lines.length === 0) {
        return {
          content: [{ type: "text", text: "Error: CSV file is empty" }],
          isError: true,
        };
      }

      const headers = lines[0]?.split(",").map(h => h.trim()) ?? [];
      const rows = lines.slice(1).map(line => {
        const values = line.split(",").map(v => v.trim());
        return Object.fromEntries(
          headers.map((header, i) => [header, values[i] ?? ""])
        );
      });

      const result = {
        headers,
        rowCount: rows.length,
        sample: rows.slice(0, 5), // Show first 5 rows
      };

      return {
        content: [
          {
            type: "text",
            text: `Parsed CSV successfully:\n${JSON.stringify(result, null, 2)}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error parsing CSV: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Tool 2: Profile CSV data to detect types and issues
const profileData = tool(
  "profile_data",
  "Analyze CSV data to detect column types, null values, and anomalies",
  {
    filePath: z.string().describe("Path to the CSV file to profile"),
  },
  async (args) => {
    try {
      const content = readFileSync(args.filePath, "utf-8");
      const lines = content.trim().split("\n");

      if (lines.length === 0) {
        return {
          content: [{ type: "text", text: "Error: CSV file is empty" }],
          isError: true,
        };
      }

      const headers = lines[0]?.split(",").map(h => h.trim()) ?? [];
      const rows = lines.slice(1).map(line =>
        line.split(",").map(v => v.trim())
      );

      const profile = headers.map((header, colIndex) => {
        const values = rows.map(row => row[colIndex] ?? "");
        const nonEmpty = values.filter(v => v !== "");
        const nullCount = values.length - nonEmpty.length;
        const unique = new Set(nonEmpty).size;

        // Detect type
        let type = "string";
        if (nonEmpty.every(v => !isNaN(Number(v)) && v !== "")) {
          type = "number";
        } else if (nonEmpty.every(v => /^\d{4}-\d{2}-\d{2}/.test(v))) {
          type = "date";
        } else if (nonEmpty.every(v => /^[\w\.-]+@[\w\.-]+\.\w+$/.test(v))) {
          type = "email";
        }

        return {
          column: header,
          type,
          totalRows: values.length,
          nullCount,
          nullPercentage: ((nullCount / values.length) * 100).toFixed(1) + "%",
          uniqueValues: unique,
          sampleValues: nonEmpty.slice(0, 3),
        };
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
      return {
        content: [
          {
            type: "text",
            text: `Error profiling data: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Create MCP server with CSV tools
const csvCleanerServer = createSdkMcpServer({
  name: "csv-cleaner",
  version: "0.1.0",
  tools: [parseCsv, profileData],
});

// Main function to run the agent
async function main() {
  console.log("🧹 CSV Cleaner Agent Starting...\n");

  const prompt = process.argv[2] || "Hello! I'm the CSV Cleaner Agent. What CSV file would you like me to help you clean?";

  try {
    for await (const message of query({
      prompt,
      options: {
        mcpServers: {
          "csv-cleaner": csvCleanerServer,
        },
        allowedTools: ["Read", "Write"],
        systemPrompt: `You are a CSV cleaning assistant. You help users clean and validate CSV files.

Your capabilities:
- Parse CSV files to understand their structure
- Profile data to detect types, null values, and anomalies
- Suggest cleaning strategies based on target formats (Shopify, QuickBooks, etc.)

When a user provides a CSV file path, use the parse_csv and profile_data tools to analyze it first.
Then provide insights about data quality issues and suggest cleaning steps.`,
      },
    })) {
      if ("result" in message) {
        console.log("\n✅ Result:", message.result);
      } else if (message.type === "assistant") {
        // Show assistant thinking
        const textContent = message.message.content.find(
          (c: any): c is { type: "text"; text: string } => c.type === "text"
        );
        if (textContent) {
          console.log("🤖 Agent:", textContent.text);
        }
      }
    }
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }
}

main();
