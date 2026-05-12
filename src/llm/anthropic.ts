// Thin wrapper around the Anthropic Messages API. Only used for column mapping.

import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;

export function getClient(): Anthropic {
  if (client) return client;
  const key = process.env["ANTHROPIC_API_KEY"];
  if (!key) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Required for LLM-assisted column mapping; not required for deterministic cleaning, validation, or import.",
    );
  }
  client = new Anthropic({ apiKey: key });
  return client;
}

export async function completeJSON<T>(
  prompt: string,
  options: { model?: string; maxTokens?: number; system?: string } = {},
): Promise<T> {
  const c = getClient();
  const response = await c.messages.create({
    model: options.model ?? "claude-haiku-4-5-20251001",
    max_tokens: options.maxTokens ?? 2000,
    system: options.system,
    messages: [{ role: "user", content: prompt }],
  });
  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") throw new Error("No text response from Claude");
  const text = (block as { type: "text"; text: string }).text;
  return parseJSON<T>(text);
}

function parseJSON<T>(text: string): T {
  const fenced = /```(?:json)?\s*([\s\S]+?)\s*```/.exec(text);
  const payload = fenced && fenced[1] ? fenced[1] : text;
  return JSON.parse(payload) as T;
}
