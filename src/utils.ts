import { readFileSync, statSync, existsSync, realpathSync } from "fs";
import { resolve, normalize, sep } from "path";
import { parse } from "csv-parse/sync";

// Configuration constants
export const CONFIG = {
  MAX_FILE_SIZE: 50 * 1024 * 1024, // 50MB
  MAX_PROMPT_LENGTH: 10000,
  SAMPLE_ROW_COUNT: 5,
  SAMPLE_VALUE_COUNT: 3,
  RATE_LIMIT_MAX_CALLS: 100, // Max tool calls per minute
  RATE_LIMIT_WINDOW_MS: 60000, // 1 minute window
} as const;

// Type definitions
export interface CsvData {
  headers: string[];
  rows: Record<string, string>[];
}

// Email validation (RFC 5322 simplified)
export const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

// Rate limiting class to prevent abuse
export class RateLimiter {
  private calls: number = 0;
  private resetTime: number;

  constructor(private windowMs: number = CONFIG.RATE_LIMIT_WINDOW_MS) {
    this.resetTime = Date.now() + windowMs;
  }

  checkLimit(limit: number = CONFIG.RATE_LIMIT_MAX_CALLS): void {
    const now = Date.now();

    // Reset counter if window has passed
    if (now > this.resetTime) {
      this.calls = 0;
      this.resetTime = now + this.windowMs;
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
      resetsIn: Math.max(0, Math.ceil((this.resetTime - now) / 1000)),
    };
  }

  // For testing: reset internal state
  reset(): void {
    this.calls = 0;
    this.resetTime = Date.now() + this.windowMs;
  }
}

// Security: Validate file path to prevent path traversal
export function validateFilePath(filePath: string): string {
  const workingDir = process.cwd();
  const resolvedPath = resolve(normalize(filePath));

  // Ensure path is within working directory (with proper boundary check)
  // Using workingDir + sep prevents bypass via paths like /app-malicious/file.csv
  // when working dir is /app
  const isWithinWorkingDir =
    resolvedPath === workingDir ||
    resolvedPath.startsWith(workingDir + sep);

  if (!isWithinWorkingDir) {
    throw new Error("Access denied: File path must be within the current working directory");
  }

  // Only allow .csv files
  if (!resolvedPath.toLowerCase().endsWith('.csv')) {
    throw new Error("Invalid file type: Only CSV files are allowed");
  }

  // Security: Resolve symlinks and re-validate to prevent symlink attacks
  // A symlink at ./data.csv could point to /etc/passwd.csv
  if (existsSync(resolvedPath)) {
    const realPath = realpathSync(resolvedPath);
    const realPathWithinWorkingDir =
      realPath === workingDir ||
      realPath.startsWith(workingDir + sep);

    if (!realPathWithinWorkingDir) {
      throw new Error("Access denied: Symlinks to files outside working directory are not allowed");
    }

    // Re-validate extension after symlink resolution
    if (!realPath.toLowerCase().endsWith('.csv')) {
      throw new Error("Invalid file type: Symlink target must be a CSV file");
    }

    return realPath;
  }

  return resolvedPath;
}

// Security: Validate file size to prevent DoS
export function validateFileSize(filePath: string): void {
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
export function sanitizeCsvValue(value: string): string {
  const trimmed = value.trim();

  // Check for formula injection patterns
  if (trimmed.length > 0 && /^[=@+\-\|%]/.test(trimmed)) {
    // Prefix with single quote to neutralize formula
    return `'${trimmed}`;
  }

  return trimmed;
}

// Security: Validate date format
export function isValidDate(str: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(str);
  if (!match) return false;

  const [, year, month, day] = match;
  const date = new Date(str);

  // Check if date is valid AND the date components match what we parsed
  // This prevents dates like 2024-02-30 from being accepted (they get auto-corrected)
  if (isNaN(date.getTime())) return false;

  const actualYear = date.getFullYear().toString().padStart(4, '0');
  const actualMonth = (date.getMonth() + 1).toString().padStart(2, '0');
  const actualDay = date.getDate().toString().padStart(2, '0');

  return year === actualYear && month === actualMonth && day === actualDay;
}

// Encoding: Read file with intelligent encoding detection
export function readFileWithEncoding(filePath: string): string {
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
export function parseCsvFile(filePath: string): CsvData {
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
