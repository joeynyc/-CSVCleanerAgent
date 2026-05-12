import { test, expect, describe } from "bun:test";
import {
  cleanString,
  cleanSku,
  cleanHandle,
  cleanBoolean,
  cleanPrice,
  cleanDate,
} from "../src/csv/clean";

describe("cleanString", () => {
  test("trims and collapses whitespace", () => {
    expect(cleanString("  hello   world  ")).toEqual({ value: "hello world" });
  });
  test("returns null for nullish tokens", () => {
    expect(cleanString("")).toEqual({ value: null });
    expect(cleanString("N/A")).toEqual({ value: null });
    expect(cleanString("none")).toEqual({ value: null });
  });
});

describe("cleanSku", () => {
  test("strips all whitespace", () => {
    expect(cleanSku(" ABC 123 ")).toEqual({ value: "ABC123" });
  });
});

describe("cleanHandle", () => {
  test("slugifies", () => {
    expect(cleanHandle("Red T-Shirt — Large!")).toEqual({ value: "red-t-shirt-large" });
  });
  test("handles unicode", () => {
    expect(cleanHandle("Café Crème")).toEqual({ value: "cafe-creme" });
  });
});

describe("cleanBoolean", () => {
  test.each([["yes", "TRUE"], ["Y", "TRUE"], ["1", "TRUE"], ["true", "TRUE"]])(
    "%s -> %s",
    (input, expected) => {
      expect(cleanBoolean(input).value).toBe(expected);
    },
  );
  test.each([["no", "FALSE"], ["N", "FALSE"], ["0", "FALSE"], ["false", "FALSE"]])(
    "%s -> %s",
    (input, expected) => {
      expect(cleanBoolean(input).value).toBe(expected);
    },
  );
  test("flags unrecognized", () => {
    const r = cleanBoolean("maybe");
    expect(r.error).toBeDefined();
  });
});

describe("cleanPrice", () => {
  test.each([
    ["$19.99", "19.99"],
    ["1,234.56", "1234.56"],
    ["19,99", "19.99"],
    ["USD 9.95", "9.95"],
    ["(12.50)", "-12.50"],
    ["  €5  ", "5.00"],
  ])("%s -> %s", (input, expected) => {
    expect(cleanPrice(input).value).toBe(expected);
  });
  test("flags garbage", () => {
    expect(cleanPrice("free").error).toBeDefined();
  });
});

describe("cleanDate", () => {
  test("ISO passes through", () => {
    expect(cleanDate("2024-01-05").value).toBe("2024-01-05");
  });
  test("MM/DD/YYYY (US default)", () => {
    expect(cleanDate("01/05/2024", "us").value).toBe("2024-01-05");
  });
  test("DD/MM/YYYY (EU)", () => {
    expect(cleanDate("05/01/2024", "eu").value).toBe("2024-01-05");
  });
  test("auto-detect via day>12", () => {
    expect(cleanDate("31/12/2024").value).toBe("2024-12-31");
  });
  test("ambiguous flagged in auto mode", () => {
    const r = cleanDate("05/06/2024");
    expect(r.value).toBe("2024-05-06"); // default to US
  });
  test("textual dates", () => {
    expect(cleanDate("Jan 5, 2024").value).toBe("2024-01-05");
  });
  test("garbage flagged", () => {
    expect(cleanDate("not a date").error).toBeDefined();
  });
});
