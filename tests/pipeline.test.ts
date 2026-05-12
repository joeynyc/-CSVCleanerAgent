import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { cleanFile } from "../src/pipeline";
import { readRows } from "../src/csv/stream";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "csvclean-pipeline-"));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("cleanFile (end-to-end without LLM)", () => {
  test("renames and cleans a supplier CSV", async () => {
    const input = join(dir, "in.csv");
    const output = join(dir, "out.csv");
    writeFileSync(
      input,
      "slug,name,sku,price,active,brand\n" +
        "Red T-Shirt,Red T-Shirt,abc-123,$19.99,yes,Acme\n" +
        "blue tee,Blue Tee,xyz 456,1234.56,no,Acme\n",
    );

    const report = await cleanFile(input, { outputPath: output, useLLM: false });

    expect(report.mapping.unmapped).toHaveLength(0);
    expect(report.rowCount).toBe(2);

    const rows: Record<string, string>[] = [];
    for await (const r of readRows(output)) rows.push(r);

    expect(rows[0]?.["Handle"]).toBe("red-t-shirt");
    expect(rows[0]?.["Title"]).toBe("Red T-Shirt");
    expect(rows[0]?.["Variant SKU"]).toBe("abc-123");
    expect(rows[0]?.["Variant Price"]).toBe("19.99");
    expect(rows[0]?.["Published"]).toBe("TRUE");
    expect(rows[0]?.["Vendor"]).toBe("Acme");
    expect(rows[1]?.["Handle"]).toBe("blue-tee");
    expect(rows[1]?.["Variant Price"]).toBe("1234.56");
    expect(rows[1]?.["Published"]).toBe("FALSE");
  });
});
