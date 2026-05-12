import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { validate } from "../src/shopify/validate";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "csvclean-"));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(name: string, content: string): string {
  const p = join(dir, name);
  writeFileSync(p, content);
  return p;
}

describe("validate", () => {
  test("clean file produces zero errors", async () => {
    const path = write(
      "ok.csv",
      "Handle,Title,Variant Price,Published\n" +
        "red-shirt,Red Shirt,19.99,TRUE\n" +
        "blue-shirt,Blue Shirt,24.50,FALSE\n",
    );
    const report = await validate(path);
    expect(report.errors).toHaveLength(0);
    expect(report.rowCount).toBe(2);
  });

  test("missing handle flagged", async () => {
    const path = write(
      "no-handle.csv",
      "Handle,Title\n,Orphan\n",
    );
    const report = await validate(path);
    expect(report.errors.some((e) => e.column === "Handle")).toBe(true);
  });

  test("bad price flagged", async () => {
    const path = write(
      "bad-price.csv",
      "Handle,Title,Variant Price\nx,X,19\n",
    );
    const report = await validate(path);
    expect(report.errors.some((e) => e.column === "Variant Price")).toBe(true);
  });

  test("unknown headers reported", async () => {
    const path = write(
      "unknown.csv",
      "Handle,Title,Mystery Column\nx,X,foo\n",
    );
    const report = await validate(path);
    expect(report.unknownHeaders).toContain("Mystery Column");
  });

  test("enum violation flagged", async () => {
    const path = write(
      "bad-status.csv",
      "Handle,Title,Status\nx,X,published\n",
    );
    const report = await validate(path);
    expect(report.errors.some((e) => e.column === "Status")).toBe(true);
  });
});
