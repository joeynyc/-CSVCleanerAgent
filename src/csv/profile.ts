// Sampling-based profiler. One streaming pass; bounded memory regardless of file size.

import { readRows } from "./stream";

export interface ColumnProfile {
  name: string;
  totalCount: number;
  nullCount: number;
  uniqueSampleCount: number;
  samples: string[];
  detectedType: "string" | "number" | "boolean" | "date" | "price" | "email" | "url" | "handle";
  dateFormat?: "us" | "eu" | "iso";
}

export interface FileProfile {
  path: string;
  rowCount: number;
  headers: string[];
  columns: ColumnProfile[];
}

const SAMPLE_LIMIT = 200;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL = /^https?:\/\//i;
const HANDLE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const NUMBER = /^-?\d+(\.\d+)?$/;
const PRICE = /^[$€£¥]?\s*-?\d{1,3}(,\d{3})*(\.\d+)?$|^-?\d+(\.\d+)?\s*(USD|EUR|GBP)?$/i;
const BOOL = /^(true|false|yes|no|y|n|t|f|1|0)$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;
const NUMERIC_DATE = /^(\d{1,4})[/\-.](\d{1,2})[/\-.](\d{1,4})$/;

export async function profile(path: string): Promise<FileProfile> {
  let rowCount = 0;
  let headers: string[] = [];
  const samples = new Map<string, string[]>();
  const uniqueSamples = new Map<string, Set<string>>();
  const nullCounts = new Map<string, number>();

  for await (const row of readRows(path)) {
    if (headers.length === 0) {
      headers = Object.keys(row);
      for (const h of headers) {
        samples.set(h, []);
        uniqueSamples.set(h, new Set());
        nullCounts.set(h, 0);
      }
    }
    rowCount++;
    for (const h of headers) {
      const v = row[h] ?? "";
      if (v === "") {
        nullCounts.set(h, (nullCounts.get(h) ?? 0) + 1);
        continue;
      }
      const bucket = samples.get(h)!;
      if (bucket.length < SAMPLE_LIMIT) bucket.push(v);
      uniqueSamples.get(h)!.add(v);
    }
  }

  const columns: ColumnProfile[] = headers.map((name) => {
    const colSamples = samples.get(name) ?? [];
    const detectedType = detectType(colSamples);
    const profile: ColumnProfile = {
      name,
      totalCount: rowCount,
      nullCount: nullCounts.get(name) ?? 0,
      uniqueSampleCount: uniqueSamples.get(name)?.size ?? 0,
      samples: colSamples.slice(0, 10),
      detectedType,
    };
    if (detectedType === "date") profile.dateFormat = detectDateFormat(colSamples);
    return profile;
  });

  return { path, rowCount, headers, columns };
}

function detectType(samples: string[]): ColumnProfile["detectedType"] {
  if (samples.length === 0) return "string";
  const checks = {
    email: 0,
    url: 0,
    handle: 0,
    price: 0,
    number: 0,
    boolean: 0,
    date: 0,
  };
  for (const v of samples) {
    if (EMAIL.test(v)) checks.email++;
    if (URL.test(v)) checks.url++;
    if (HANDLE.test(v)) checks.handle++;
    if (BOOL.test(v)) checks.boolean++;
    if (NUMBER.test(v)) checks.number++;
    if (PRICE.test(v)) checks.price++;
    if (ISO_DATE.test(v) || NUMERIC_DATE.test(v) || !Number.isNaN(Date.parse(v))) checks.date++;
  }
  const n = samples.length;
  const threshold = Math.max(1, Math.floor(n * 0.9));
  if (checks.email >= threshold) return "email";
  if (checks.url >= threshold) return "url";
  if (checks.boolean >= threshold) return "boolean";
  if (checks.number >= threshold) return "number";
  if (checks.price >= threshold) return "price";
  if (checks.date >= threshold) return "date";
  if (checks.handle >= threshold) return "handle";
  return "string";
}

function detectDateFormat(samples: string[]): "us" | "eu" | "iso" {
  let us = 0;
  let eu = 0;
  let iso = 0;
  for (const v of samples) {
    if (ISO_DATE.test(v)) {
      iso++;
      continue;
    }
    const m = NUMERIC_DATE.exec(v);
    if (!m || !m[1] || !m[2]) continue;
    const a = parseInt(m[1], 10);
    const b = parseInt(m[2], 10);
    if (a > 12) eu++;
    else if (b > 12) us++;
  }
  if (iso >= us && iso >= eu) return "iso";
  return us >= eu ? "us" : "eu";
}
