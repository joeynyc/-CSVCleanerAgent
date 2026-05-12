import { test, expect, describe } from "bun:test";
import { mapHeaders } from "../src/mapping/map";
import type { ColumnProfile } from "../src/csv/profile";

const profile = (name: string, type: ColumnProfile["detectedType"] = "string"): ColumnProfile => ({
  name,
  totalCount: 10,
  nullCount: 0,
  uniqueSampleCount: 5,
  samples: [],
  detectedType: type,
});

describe("mapHeaders heuristic-only", () => {
  test("exact match", async () => {
    const result = await mapHeaders([profile("Handle"), profile("Title")], { useLLM: false });
    expect(result.usedLLM).toBe(false);
    expect(result.mappings.find((m) => m.inputHeader === "Handle")?.shopifyColumn).toBe("Handle");
    expect(result.mappings.find((m) => m.inputHeader === "Title")?.shopifyColumn).toBe("Title");
  });

  test("normalized match (case/punct insensitive)", async () => {
    const result = await mapHeaders([profile("body_html"), profile("seo title")], { useLLM: false });
    expect(result.mappings.find((m) => m.inputHeader === "body_html")?.shopifyColumn).toBe("Body (HTML)");
    expect(result.mappings.find((m) => m.inputHeader === "seo title")?.shopifyColumn).toBe("SEO Title");
  });

  test("alias match", async () => {
    const result = await mapHeaders([profile("sku"), profile("brand"), profile("price")], { useLLM: false });
    const m = (h: string): string | null =>
      result.mappings.find((x) => x.inputHeader === h)?.shopifyColumn ?? null;
    expect(m("sku")).toBe("Variant SKU");
    expect(m("brand")).toBe("Vendor");
    expect(m("price")).toBe("Variant Price");
  });

  test("fuzzy match", async () => {
    const result = await mapHeaders([profile("Product Title")], { useLLM: false });
    expect(result.mappings[0]?.shopifyColumn).toBe("Title");
  });

  test("unknown header reported as unmapped", async () => {
    const result = await mapHeaders([profile("xyz_irrelevant_column")], { useLLM: false });
    expect(result.unmapped).toContain("xyz_irrelevant_column");
  });

  test("collision: highest confidence wins", async () => {
    const result = await mapHeaders(
      [profile("Title"), profile("Product Title")],
      { useLLM: false },
    );
    const titleWinner = result.mappings.find((m) => m.shopifyColumn === "Title");
    expect(titleWinner?.inputHeader).toBe("Title");
    const loser = result.mappings.find((m) => m.inputHeader === "Product Title");
    expect(loser?.shopifyColumn).toBeNull();
  });
});
