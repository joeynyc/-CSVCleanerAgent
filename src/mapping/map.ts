// Map input CSV headers to canonical Shopify schema columns.
//
// Strategy (cheapest match wins):
//   1. exact      — header == canonical name
//   2. normalized — header == canonical (lowercase, strip punctuation/spaces)
//   3. alias      — header matches a known alias for a canonical column
//   4. fuzzy      — small edit-distance / token-overlap against canonical + aliases
//   5. llm        — Claude maps remaining unmatched headers, using column samples
//
// Each step only runs on headers the previous steps didn't resolve.

import { SHOPIFY_PRODUCT_COLUMNS, type ColumnSpec } from "../shopify/schema";
import { completeJSON } from "../llm/anthropic";
import type { ColumnProfile } from "../csv/profile";

export type MappingSource = "exact" | "normalized" | "alias" | "fuzzy" | "llm" | "unmapped";

export interface ColumnMapping {
  inputHeader: string;
  shopifyColumn: string | null;
  source: MappingSource;
  confidence: number; // 0..1
}

export interface MappingResult {
  mappings: ColumnMapping[];
  unmapped: string[];
  usedLLM: boolean;
}

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

interface CandidateIndex {
  byNorm: Map<string, ColumnSpec>;
  byAlias: Map<string, ColumnSpec>;
}

function buildIndex(): CandidateIndex {
  const byNorm = new Map<string, ColumnSpec>();
  const byAlias = new Map<string, ColumnSpec>();
  for (const spec of SHOPIFY_PRODUCT_COLUMNS) {
    byNorm.set(norm(spec.name), spec);
    for (const alias of spec.aliases ?? []) byAlias.set(norm(alias), spec);
  }
  return { byNorm, byAlias };
}

export async function mapHeaders(
  profiles: ColumnProfile[],
  options: { useLLM?: boolean } = {},
): Promise<MappingResult> {
  const index = buildIndex();
  const mappings: ColumnMapping[] = [];
  const remaining: ColumnProfile[] = [];

  for (const p of profiles) {
    const header = p.name;
    const n = norm(header);

    if (index.byNorm.has(header.toLowerCase()) || index.byNorm.has(n)) {
      const spec = index.byNorm.get(header.toLowerCase()) ?? index.byNorm.get(n)!;
      const source: MappingSource = spec.name === header ? "exact" : "normalized";
      mappings.push({ inputHeader: header, shopifyColumn: spec.name, source, confidence: 1 });
      continue;
    }
    if (index.byAlias.has(n)) {
      mappings.push({
        inputHeader: header,
        shopifyColumn: index.byAlias.get(n)!.name,
        source: "alias",
        confidence: 0.9,
      });
      continue;
    }

    const fuzzy = bestFuzzy(header, index);
    if (fuzzy && fuzzy.score >= 0.8) {
      mappings.push({
        inputHeader: header,
        shopifyColumn: fuzzy.spec.name,
        source: "fuzzy",
        confidence: fuzzy.score,
      });
      continue;
    }

    remaining.push(p);
  }

  let usedLLM = false;
  if (remaining.length > 0 && options.useLLM !== false) {
    usedLLM = true;
    const llmMatches = await llmMap(remaining);
    for (const p of remaining) {
      const match = llmMatches[p.name];
      if (match && match.shopifyColumn) {
        mappings.push({
          inputHeader: p.name,
          shopifyColumn: match.shopifyColumn,
          source: "llm",
          confidence: match.confidence ?? 0.7,
        });
      } else {
        mappings.push({ inputHeader: p.name, shopifyColumn: null, source: "unmapped", confidence: 0 });
      }
    }
  } else {
    for (const p of remaining) {
      mappings.push({ inputHeader: p.name, shopifyColumn: null, source: "unmapped", confidence: 0 });
    }
  }

  // Resolve collisions: if two inputs map to the same Shopify column, keep highest confidence.
  const claimed = new Map<string, ColumnMapping>();
  for (const m of mappings) {
    if (!m.shopifyColumn) continue;
    const prior = claimed.get(m.shopifyColumn);
    if (!prior || m.confidence > prior.confidence) {
      if (prior) {
        prior.shopifyColumn = null;
        prior.source = "unmapped";
        prior.confidence = 0;
      }
      claimed.set(m.shopifyColumn, m);
    } else {
      m.shopifyColumn = null;
      m.source = "unmapped";
      m.confidence = 0;
    }
  }

  return {
    mappings,
    unmapped: mappings.filter((m) => !m.shopifyColumn).map((m) => m.inputHeader),
    usedLLM,
  };
}

interface FuzzyHit {
  spec: ColumnSpec;
  score: number;
}

function bestFuzzy(header: string, _index: CandidateIndex): FuzzyHit | null {
  const n = norm(header);
  let best: FuzzyHit | null = null;
  const consider = (name: string, spec: ColumnSpec): void => {
    const score = similarity(n, norm(name));
    if (!best || score > best.score) best = { spec, score };
  };
  for (const spec of SHOPIFY_PRODUCT_COLUMNS) {
    consider(spec.name, spec);
    for (const alias of spec.aliases ?? []) consider(alias, spec);
  }
  return best;
}

// Dice coefficient on character bigrams. Cheap and good enough for short headers.
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const bigrams = (s: string): Map<string, number> => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };
  const A = bigrams(a);
  const B = bigrams(b);
  let inter = 0;
  for (const [g, count] of A) inter += Math.min(count, B.get(g) ?? 0);
  return (2 * inter) / (a.length + b.length - 2);
}

interface LLMMatch {
  shopifyColumn: string | null;
  confidence?: number;
}

async function llmMap(profiles: ColumnProfile[]): Promise<Record<string, LLMMatch>> {
  const candidates = SHOPIFY_PRODUCT_COLUMNS.map((c) => c.name);
  const samples = profiles.map((p) => ({
    header: p.name,
    detectedType: p.detectedType,
    samples: p.samples.slice(0, 5),
  }));
  const prompt = `Map each input CSV header to the most likely Shopify product CSV column, or null if no good match exists.

Shopify columns:
${candidates.map((c) => `- ${c}`).join("\n")}

Input headers with sample values:
${JSON.stringify(samples, null, 2)}

Respond with JSON only, in this exact shape (no prose, no markdown):
{
  "<input header>": { "shopifyColumn": "<canonical name>" | null, "confidence": 0.0-1.0 }
}`;

  return completeJSON<Record<string, LLMMatch>>(prompt, {
    system: "You map data columns. Be conservative: prefer null over a wrong match.",
    maxTokens: 1500,
  });
}
