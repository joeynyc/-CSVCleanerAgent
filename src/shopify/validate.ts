// Local validation of a cleaned CSV against the Shopify schema. No network calls.

import { readRows } from "../csv/stream";
import { SHOPIFY_PRODUCT_COLUMNS, findColumn } from "./schema";

export interface ValidationError {
  row: number;
  column: string;
  value: string;
  message: string;
}

export interface ValidationReport {
  rowCount: number;
  errors: ValidationError[];
  unknownHeaders: string[];
}

export async function validate(path: string): Promise<ValidationReport> {
  const errors: ValidationError[] = [];
  const unknownHeaders = new Set<string>();
  let rowCount = 0;
  let headers: string[] = [];
  let firstHandleByGroup: string | null = null;

  for await (const row of readRows(path)) {
    rowCount++;
    if (headers.length === 0) {
      headers = Object.keys(row);
      for (const h of headers) {
        if (!findColumn(h)) unknownHeaders.add(h);
      }
    }

    const handle = (row["Handle"] ?? "").trim();
    if (!handle) {
      errors.push({ row: rowCount, column: "Handle", value: "", message: "Handle is required" });
    }

    // First row of a product group needs Title (subsequent variant rows can repeat Handle only).
    if (handle && handle !== firstHandleByGroup) {
      firstHandleByGroup = handle;
      const title = (row["Title"] ?? "").trim();
      if (!title) {
        errors.push({ row: rowCount, column: "Title", value: "", message: "Title required on first row of product" });
      }
    }

    for (const spec of SHOPIFY_PRODUCT_COLUMNS) {
      const v = row[spec.name];
      if (v === undefined) continue;
      if (spec.enum && v !== "" && !spec.enum.includes(v)) {
        errors.push({
          row: rowCount,
          column: spec.name,
          value: v,
          message: `must be one of: ${spec.enum.join(", ")}`,
        });
      }
      if (spec.cleaner === "price" && v !== "" && !/^-?\d+\.\d{2}$/.test(v)) {
        errors.push({ row: rowCount, column: spec.name, value: v, message: "not a 2-decimal price" });
      }
      if (spec.cleaner === "boolean" && v !== "" && v !== "TRUE" && v !== "FALSE") {
        errors.push({ row: rowCount, column: spec.name, value: v, message: "must be TRUE or FALSE" });
      }
      if (spec.cleaner === "handle" && v !== "" && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v)) {
        errors.push({ row: rowCount, column: spec.name, value: v, message: "not a valid handle slug" });
      }
    }
  }

  return { rowCount, errors, unknownHeaders: [...unknownHeaders] };
}
