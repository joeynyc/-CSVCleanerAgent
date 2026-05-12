// Group cleaned CSV rows by Handle and upsert via the productSet mutation.
// productSet is idempotent: matching by handle, it creates or updates.

import { readRows, type Row } from "../csv/stream";
import { ShopifyClient, ShopifyError } from "./client";

export interface ImportOptions {
  dryRun?: boolean;
  client?: ShopifyClient;
  onProgress?: (event: ImportEvent) => void;
}

export type ImportEvent =
  | { type: "product"; handle: string; status: "ok" | "skipped" | "error"; message?: string }
  | { type: "done"; total: number; ok: number; errors: number };

export interface ImportResult {
  total: number;
  ok: number;
  errors: ImportError[];
  dryRun: boolean;
}

export interface ImportError {
  handle: string;
  message: string;
}

interface ProductGroup {
  handle: string;
  rows: Row[];
}

export async function importCsv(path: string, options: ImportOptions = {}): Promise<ImportResult> {
  const groups = await groupByHandle(path);
  const dryRun = options.dryRun ?? false;
  const client = dryRun ? null : (options.client ?? ShopifyClient.fromEnv());
  const errors: ImportError[] = [];
  let ok = 0;

  for (const group of groups) {
    const input = buildProductInput(group);
    if (!input) {
      options.onProgress?.({ type: "product", handle: group.handle, status: "skipped", message: "no usable fields" });
      continue;
    }
    if (dryRun || !client) {
      options.onProgress?.({ type: "product", handle: group.handle, status: "ok", message: "dry-run" });
      ok++;
      continue;
    }
    try {
      const result = await client.query<ProductSetResponse>(PRODUCT_SET, { product: input });
      const userErrors = result.productSet.userErrors ?? [];
      if (userErrors.length > 0) {
        const msg = userErrors.map((e) => `${e.field?.join(".") ?? ""}: ${e.message}`).join("; ");
        errors.push({ handle: group.handle, message: msg });
        options.onProgress?.({ type: "product", handle: group.handle, status: "error", message: msg });
      } else {
        ok++;
        options.onProgress?.({ type: "product", handle: group.handle, status: "ok" });
      }
    } catch (err) {
      const message = err instanceof ShopifyError ? err.message : String(err);
      errors.push({ handle: group.handle, message });
      options.onProgress?.({ type: "product", handle: group.handle, status: "error", message });
    }
  }

  options.onProgress?.({ type: "done", total: groups.length, ok, errors: errors.length });
  return { total: groups.length, ok, errors, dryRun };
}

async function groupByHandle(path: string): Promise<ProductGroup[]> {
  const groups = new Map<string, ProductGroup>();
  for await (const row of readRows(path)) {
    const handle = (row["Handle"] ?? "").trim();
    if (!handle) continue;
    let g = groups.get(handle);
    if (!g) {
      g = { handle, rows: [] };
      groups.set(handle, g);
    }
    g.rows.push(row);
  }
  return [...groups.values()];
}

interface ProductSetInput {
  handle: string;
  title?: string;
  descriptionHtml?: string;
  vendor?: string;
  productType?: string;
  tags?: string[];
  status?: "ACTIVE" | "DRAFT" | "ARCHIVED";
  productOptions?: { name: string; values: { name: string }[] }[];
  variants?: ProductVariantInput[];
}

interface ProductVariantInput {
  sku?: string;
  price?: string;
  compareAtPrice?: string;
  barcode?: string;
  inventoryItem?: { cost?: string };
  optionValues?: { optionName: string; name: string }[];
}

function buildProductInput(group: ProductGroup): ProductSetInput | null {
  const first = group.rows[0];
  if (!first) return null;
  const title = first["Title"]?.trim() || undefined;
  const product: ProductSetInput = { handle: group.handle };
  if (title) product.title = title;
  if (first["Body (HTML)"]) product.descriptionHtml = first["Body (HTML)"];
  if (first["Vendor"]) product.vendor = first["Vendor"];
  if (first["Type"]) product.productType = first["Type"];
  if (first["Tags"]) product.tags = first["Tags"].split(",").map((t) => t.trim()).filter(Boolean);
  const status = first["Status"];
  if (status === "active" || status === "draft" || status === "archived") {
    product.status = status.toUpperCase() as ProductSetInput["status"];
  }

  const optionNames: string[] = [];
  for (const key of ["Option1 Name", "Option2 Name", "Option3 Name"] as const) {
    const v = first[key]?.trim();
    if (v) optionNames.push(v);
  }

  const variants: ProductVariantInput[] = [];
  const optionValueSets: Set<string>[] = optionNames.map(() => new Set());
  for (const row of group.rows) {
    const variant: ProductVariantInput = {};
    const sku = row["Variant SKU"]?.trim();
    const price = row["Variant Price"]?.trim();
    const compare = row["Variant Compare At Price"]?.trim();
    const barcode = row["Variant Barcode"]?.trim();
    const cost = row["Cost per item"]?.trim();
    if (sku) variant.sku = sku;
    if (price) variant.price = price;
    if (compare) variant.compareAtPrice = compare;
    if (barcode) variant.barcode = barcode;
    if (cost) variant.inventoryItem = { cost };

    if (optionNames.length > 0) {
      const optionValues: { optionName: string; name: string }[] = [];
      const valueKeys = ["Option1 Value", "Option2 Value", "Option3 Value"] as const;
      optionNames.forEach((name, i) => {
        const key = valueKeys[i];
        if (!key) return;
        const v = row[key]?.trim();
        const bucket = optionValueSets[i];
        if (v && bucket) {
          optionValues.push({ optionName: name, name: v });
          bucket.add(v);
        }
      });
      if (optionValues.length > 0) variant.optionValues = optionValues;
    }

    if (Object.keys(variant).length > 0) variants.push(variant);
  }

  if (optionNames.length > 0) {
    product.productOptions = optionNames.map((name, i) => ({
      name,
      values: [...(optionValueSets[i] ?? new Set<string>())].map((v) => ({ name: v })),
    }));
  }
  if (variants.length > 0) product.variants = variants;

  return product;
}

const PRODUCT_SET = `#graphql
mutation ProductSet($product: ProductSetInput!) {
  productSet(input: $product) {
    product { id handle }
    userErrors { field message }
  }
}`;

interface ProductSetResponse {
  productSet: {
    product?: { id: string; handle: string } | null;
    userErrors: { field?: string[]; message: string }[];
  };
}
