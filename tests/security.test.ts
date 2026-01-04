import { describe, it, expect } from "bun:test";
import { validateFilePath, sanitizeCsvValue } from "../src/utils";
import { resolve } from "node:path";

describe("Security Tests", () => {
  describe("validateFilePath", () => {
    it("should accept valid CSV in working directory", () => {
      const validPath = "./sample.csv";
      const result = validateFilePath(validPath);
      expect(result).toBe(resolve(validPath));
    });

    it("should accept CSV in subdirectory", () => {
      const validPath = "./tests/fixtures/valid.csv";
      const result = validateFilePath(validPath);
      expect(result).toBe(resolve(validPath));
    });

    it("should reject path traversal with ..", () => {
      expect(() => {
        validateFilePath("../../../etc/passwd");
      }).toThrow("Access denied");
    });

    it("should reject path traversal with absolute path outside working dir", () => {
      expect(() => {
        validateFilePath("/etc/passwd");
      }).toThrow("Access denied");
    });

    it("should reject non-CSV files", () => {
      expect(() => {
        validateFilePath("./script.sh");
      }).toThrow("Invalid file type");
    });

    it("should reject files without extension", () => {
      expect(() => {
        validateFilePath("./README");
      }).toThrow("Invalid file type");
    });

    it("should handle case-insensitive CSV extension", () => {
      const validPath = "./tests/fixtures/valid.CSV";
      expect(() => {
        validateFilePath(validPath);
      }).not.toThrow();
    });
  });

  describe("sanitizeCsvValue", () => {
    it("should not modify normal text", () => {
      expect(sanitizeCsvValue("Normal Text")).toBe("Normal Text");
      expect(sanitizeCsvValue("john@example.com")).toBe("john@example.com");
      expect(sanitizeCsvValue("123")).toBe("123");
    });

    it("should sanitize formula starting with =", () => {
      expect(sanitizeCsvValue("=SUM(1+1)")).toBe("'=SUM(1+1)");
      expect(sanitizeCsvValue("=cmd|'/c calc'")).toBe("'=cmd|'/c calc'");
    });

    it("should sanitize formula starting with @", () => {
      expect(sanitizeCsvValue("@SUM(A1)")).toBe("'@SUM(A1)");
    });

    it("should sanitize formula starting with +", () => {
      expect(sanitizeCsvValue("+1+1")).toBe("'+1+1");
    });

    it("should sanitize formula starting with -", () => {
      expect(sanitizeCsvValue("-1-1")).toBe("'-1-1");
    });

    it("should sanitize formula starting with |", () => {
      expect(sanitizeCsvValue("|command")).toBe("'|command");
    });

    it("should sanitize formula starting with %", () => {
      expect(sanitizeCsvValue("%variable")).toBe("'%variable");
    });

    it("should trim whitespace before checking", () => {
      expect(sanitizeCsvValue("  =SUM(1+1)  ")).toBe("'=SUM(1+1)");
      expect(sanitizeCsvValue("  Normal  ")).toBe("Normal");
    });

    it("should handle empty strings", () => {
      expect(sanitizeCsvValue("")).toBe("");
      expect(sanitizeCsvValue("   ")).toBe("");
    });

    it("should not sanitize formulas in middle of text", () => {
      expect(sanitizeCsvValue("Total: =SUM(A1)")).toBe("Total: =SUM(A1)");
      expect(sanitizeCsvValue("Email: test@example.com")).toBe("Email: test@example.com");
    });
  });
});
