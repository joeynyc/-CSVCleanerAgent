import { describe, it, expect } from "bun:test";
import { parseCsvFile, isValidDate } from "../src/utils";
import { writeFileSync, unlinkSync } from "fs";

describe("Core Functionality Tests", () => {
  describe("isValidDate", () => {
    it("should accept valid ISO dates", () => {
      expect(isValidDate("2024-01-15")).toBe(true);
      expect(isValidDate("2024-12-31")).toBe(true);
      expect(isValidDate("2000-06-15")).toBe(true);
    });

    it("should accept valid dates with time", () => {
      expect(isValidDate("2024-01-15T10:30:00")).toBe(true);
      expect(isValidDate("2024-01-15 10:30:00")).toBe(true);
    });

    it("should reject invalid date formats", () => {
      expect(isValidDate("01/15/2024")).toBe(false);
      expect(isValidDate("15-01-2024")).toBe(false);
      expect(isValidDate("2024/01/15")).toBe(false);
    });

    it("should reject invalid dates", () => {
      expect(isValidDate("2024-13-01")).toBe(false); // Invalid month
      expect(isValidDate("2024-02-30")).toBe(false); // Invalid day
      expect(isValidDate("9999-99-99")).toBe(false); // Invalid date
    });

    it("should reject non-date strings", () => {
      expect(isValidDate("not a date")).toBe(false);
      expect(isValidDate("")).toBe(false);
      expect(isValidDate("abc-def-ghi")).toBe(false);
    });

    it("should reject partial dates", () => {
      expect(isValidDate("2024")).toBe(false);
      expect(isValidDate("2024-01")).toBe(false);
    });
  });

  describe("parseCsvFile", () => {
    it("should parse valid CSV file", () => {
      const result = parseCsvFile("./tests/fixtures/valid.csv");

      expect(result.headers).toEqual(["Name", "Email", "Age"]);
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0]).toEqual({
        Name: "John Doe",
        Email: "john@example.com",
        Age: "30",
      });
    });

    it("should handle quoted fields with commas", () => {
      const result = parseCsvFile("./tests/fixtures/quoted.csv");

      expect(result.headers).toEqual(["Name", "Address", "City"]);
      expect(result.rows[0]?.["Name"]).toBe("Smith, John");
      expect(result.rows[0]?.["Address"]).toBe("123 Main St, Apt 4");
    });

    it("should handle escaped quotes", () => {
      const result = parseCsvFile("./tests/fixtures/quoted.csv");

      expect(result.rows[1]?.["Address"]).toBe("456 \"Oak\" Ave");
    });

    it("should sanitize formula injection in data", () => {
      const result = parseCsvFile("./tests/fixtures/injection.csv");

      // Check that formulas are sanitized
      expect(result.rows[0]?.["Formula"]).toBe("'=SUM(1+1)");
      expect(result.rows[1]?.["Formula"]).toBe("'=cmd|'/c calc'");
      expect(result.rows[2]?.["Name"]).toBe("'@Attack");
      expect(result.rows[3]?.["Name"]).toBe("'+Attack");
    });

    it("should throw error for empty CSV", () => {
      expect(() => {
        parseCsvFile("./tests/fixtures/empty.csv");
      }).toThrow("File is empty");
    });

    it("should throw error for non-existent file", () => {
      expect(() => {
        parseCsvFile("./tests/fixtures/nonexistent.csv");
      }).toThrow("File not found");
    });

    it("should throw error for path traversal", () => {
      expect(() => {
        parseCsvFile("../../../etc/passwd");
      }).toThrow("Access denied");
    });

    it("should throw error for non-CSV file", () => {
      expect(() => {
        parseCsvFile("./package.json");
      }).toThrow("Invalid file type");
    });

    it("should handle files with only headers", () => {
      // Create a temporary CSV with only headers
      const tempPath = "./tests/fixtures/headers-only.csv";
      writeFileSync(tempPath, "Name,Email,Age\n");

      try {
        expect(() => {
          parseCsvFile(tempPath);
        }).toThrow("CSV file contains no data rows");
      } finally {
        unlinkSync(tempPath);
      }
    });

    it("should handle large files within size limit", () => {
      // Create a CSV with many rows (but under 50MB)
      const tempPath = "./tests/fixtures/large.csv";
      let content = "Name,Email,Age\n";
      for (let i = 0; i < 1000; i++) {
        content += `User${i},user${i}@example.com,${20 + i}\n`;
      }
      writeFileSync(tempPath, content);

      try {
        const result = parseCsvFile(tempPath);
        expect(result.rows).toHaveLength(1000);
      } finally {
        unlinkSync(tempPath);
      }
    });
  });
});
