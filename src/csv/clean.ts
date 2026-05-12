// Deterministic cell-value cleaners. Pure functions, no I/O.
//
// Each cleaner takes a raw string and returns { value, error? }.
// - value: cleaned string, or null when the input is empty
// - error: present iff the value could not be coerced; the caller decides
//   whether that's a hard failure (validation) or a soft warning (cleaning).

export interface CleanResult {
  value: string | null;
  error?: string;
}

export type DateFormat = "iso" | "us" | "eu" | "auto";

const EMPTY = (): CleanResult => ({ value: null });

function nullish(v: string): boolean {
  const t = v.trim().toLowerCase();
  return t === "" || t === "null" || t === "n/a" || t === "na" || t === "none";
}

// ---- strings ----

export function cleanString(v: string): CleanResult {
  if (nullish(v)) return EMPTY();
  return { value: v.trim().replace(/\s+/g, " ") };
}

// ---- SKUs ----

export function cleanSku(v: string): CleanResult {
  if (nullish(v)) return EMPTY();
  const trimmed = v.trim().replace(/\s+/g, "");
  if (trimmed.length === 0) return EMPTY();
  return { value: trimmed };
}

// ---- handles (slugs) ----

export function cleanHandle(v: string): CleanResult {
  if (nullish(v)) return EMPTY();
  const slug = v
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  if (slug.length === 0) return { value: null, error: "handle is empty after slugify" };
  return { value: slug };
}

// ---- booleans ----

const TRUTHY = new Set(["true", "t", "yes", "y", "1"]);
const FALSY = new Set(["false", "f", "no", "n", "0"]);

export function cleanBoolean(v: string): CleanResult {
  if (nullish(v)) return EMPTY();
  const t = v.trim().toLowerCase();
  if (TRUTHY.has(t)) return { value: "TRUE" };
  if (FALSY.has(t)) return { value: "FALSE" };
  return { value: v, error: `unrecognized boolean: ${v}` };
}

// ---- prices ----

// Accepts: "$19.99", "19,99", "1,234.56", "(12.50)" (negative accounting), "USD 9.95"
export function cleanPrice(v: string): CleanResult {
  if (nullish(v)) return EMPTY();
  let s = v.trim();
  const negative = /^\(.+\)$/.test(s);
  s = s.replace(/[()]/g, "");
  s = s.replace(/[A-Za-z$€£¥₹\s]/g, "");
  // Heuristic: if there's both "," and ".", assume comma is thousands sep.
  // If only ",", assume European decimal separator.
  if (s.includes(",") && s.includes(".")) {
    s = s.replace(/,/g, "");
  } else if (s.includes(",") && !s.includes(".")) {
    s = s.replace(/,/g, ".");
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) {
    return { value: v, error: `unrecognized price: ${v}` };
  }
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return { value: v, error: `unrecognized price: ${v}` };
  const signed = negative ? -n : n;
  return { value: signed.toFixed(2) };
}

// ---- dates ----

// Returns YYYY-MM-DD. The `format` hint resolves MM/DD vs DD/MM ambiguity.
export function cleanDate(v: string, format: DateFormat = "auto"): CleanResult {
  if (nullish(v)) return EMPTY();
  const s = v.trim();

  // Excel serial (days since 1899-12-30, ignoring 1900 leap-year bug for typical ranges).
  if (/^\d{1,5}(\.\d+)?$/.test(s)) {
    const days = parseFloat(s);
    if (days > 0 && days < 100000) {
      const epoch = Date.UTC(1899, 11, 30);
      const ms = epoch + days * 86400000;
      return formatIso(new Date(ms));
    }
  }

  // ISO 8601 (already correct or near-correct).
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/.exec(s);
  if (iso && iso[1] && iso[2] && iso[3]) {
    return formatIso(new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3])));
  }

  // Slash- or dash-separated numeric: MM/DD/YYYY, DD/MM/YYYY, YYYY/MM/DD.
  const numeric = /^(\d{1,4})[/\-.](\d{1,2})[/\-.](\d{1,4})$/.exec(s);
  if (numeric && numeric[1] && numeric[2] && numeric[3]) {
    const a = parseInt(numeric[1], 10);
    const b = parseInt(numeric[2], 10);
    const c = parseInt(numeric[3], 10);
    let year: number, month: number, day: number;
    if (a > 31) {
      year = a; month = b; day = c;
    } else if (c > 31) {
      year = c;
      if (format === "us") { month = a; day = b; }
      else if (format === "eu") { day = a; month = b; }
      else if (a > 12) { day = a; month = b; }
      else if (b > 12) { month = a; day = b; }
      else { month = a; day = b; }
    } else {
      return { value: v, error: `ambiguous date: ${v}` };
    }
    if (month < 1 || month > 12 || day < 1 || day > 31) {
      return { value: v, error: `invalid date: ${v}` };
    }
    return formatIso(new Date(Date.UTC(year, month - 1, day)));
  }

  // Fallback: let Date try (handles "Jan 5, 2024", "5 Jan 2024", RFC 2822, etc.).
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return formatIso(new Date(t));

  return { value: v, error: `unrecognized date: ${v}` };
}

function formatIso(d: Date): CleanResult {
  if (Number.isNaN(d.getTime())) return { value: null, error: "invalid date" };
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return { value: `${y}-${m}-${day}` };
}

// ---- registry ----

export type CleanerName = "string" | "sku" | "handle" | "boolean" | "price" | "date";

export function clean(name: CleanerName, value: string, opts?: { dateFormat?: DateFormat }): CleanResult {
  switch (name) {
    case "string": return cleanString(value);
    case "sku": return cleanSku(value);
    case "handle": return cleanHandle(value);
    case "boolean": return cleanBoolean(value);
    case "price": return cleanPrice(value);
    case "date": return cleanDate(value, opts?.dateFormat);
  }
}
