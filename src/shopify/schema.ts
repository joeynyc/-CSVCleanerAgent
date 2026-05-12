// Shopify product CSV schema. Subset of columns we care about for import.
// Mirrors the columns Shopify exposes in its product import/export CSV.

import type { CleanerName, DateFormat } from "../csv/clean";

export interface ColumnSpec {
  name: string;        // canonical Shopify header
  cleaner: CleanerName;
  required?: boolean;  // must be present on at least the first row of a product group
  perVariant?: boolean; // duplicated per-variant row
  aliases?: string[];  // synonyms we'll auto-match before invoking the LLM
  dateFormat?: DateFormat;
  enum?: string[];     // if set, value must be one of these (post-clean)
}

// Columns are listed in the order Shopify expects in its product CSV export.
export const SHOPIFY_PRODUCT_COLUMNS: ColumnSpec[] = [
  { name: "Handle", cleaner: "handle", required: true, aliases: ["slug", "url-handle", "permalink"] },
  { name: "Title", cleaner: "string", aliases: ["name", "product name", "product title"] },
  { name: "Body (HTML)", cleaner: "string", aliases: ["description", "body", "long description", "details"] },
  { name: "Vendor", cleaner: "string", aliases: ["brand", "manufacturer", "supplier"] },
  { name: "Product Category", cleaner: "string", aliases: ["category", "google product category"] },
  { name: "Type", cleaner: "string", aliases: ["product type", "category2"] },
  { name: "Tags", cleaner: "string", aliases: ["labels", "keywords"] },
  { name: "Published", cleaner: "boolean", aliases: ["active", "status", "is published", "visible"] },
  { name: "Option1 Name", cleaner: "string", aliases: ["option 1", "variant option 1 name"] },
  { name: "Option1 Value", cleaner: "string", perVariant: true, aliases: ["option 1 value"] },
  { name: "Option2 Name", cleaner: "string" },
  { name: "Option2 Value", cleaner: "string", perVariant: true },
  { name: "Option3 Name", cleaner: "string" },
  { name: "Option3 Value", cleaner: "string", perVariant: true },
  { name: "Variant SKU", cleaner: "sku", perVariant: true, aliases: ["sku", "item code", "item_code", "product code"] },
  { name: "Variant Grams", cleaner: "string", perVariant: true, aliases: ["weight grams", "weight_g"] },
  { name: "Variant Inventory Tracker", cleaner: "string", perVariant: true, enum: ["", "shopify"] },
  { name: "Variant Inventory Qty", cleaner: "string", perVariant: true, aliases: ["qty", "quantity", "stock", "inventory"] },
  { name: "Variant Inventory Policy", cleaner: "string", perVariant: true, enum: ["deny", "continue"] },
  { name: "Variant Fulfillment Service", cleaner: "string", perVariant: true, enum: ["manual"] },
  { name: "Variant Price", cleaner: "price", perVariant: true, aliases: ["price", "retail price", "msrp", "list price"] },
  { name: "Variant Compare At Price", cleaner: "price", perVariant: true, aliases: ["compare price", "compare_at_price", "was price"] },
  { name: "Variant Requires Shipping", cleaner: "boolean", perVariant: true, aliases: ["requires shipping", "shippable"] },
  { name: "Variant Taxable", cleaner: "boolean", perVariant: true, aliases: ["taxable"] },
  { name: "Variant Barcode", cleaner: "sku", perVariant: true, aliases: ["barcode", "upc", "ean", "gtin"] },
  { name: "Image Src", cleaner: "string", aliases: ["image", "image url", "photo", "picture"] },
  { name: "Image Position", cleaner: "string" },
  { name: "Image Alt Text", cleaner: "string", aliases: ["alt text", "image alt"] },
  { name: "Gift Card", cleaner: "boolean" },
  { name: "SEO Title", cleaner: "string", aliases: ["meta title", "seo_title"] },
  { name: "SEO Description", cleaner: "string", aliases: ["meta description", "seo_description"] },
  { name: "Variant Weight Unit", cleaner: "string", perVariant: true, enum: ["g", "kg", "oz", "lb"] },
  { name: "Cost per item", cleaner: "price", perVariant: true, aliases: ["cost", "unit cost", "cogs"] },
  { name: "Status", cleaner: "string", aliases: ["product status"], enum: ["active", "draft", "archived"] },
];

export function findColumn(name: string): ColumnSpec | undefined {
  return SHOPIFY_PRODUCT_COLUMNS.find((c) => c.name === name);
}

export function canonicalHeaders(): string[] {
  return SHOPIFY_PRODUCT_COLUMNS.map((c) => c.name);
}
