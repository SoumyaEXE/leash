/**
 * Thin You.com REST client. Server-side only: the API key must never reach a browser bundle.
 *
 * Verified Nov 6, 2026 against https://you.com/docs (llms.txt, api-reference):
 * - Answer API:  POST https://api.you.com/v1/answer   header X-API-Key   body { query }  -> { answer, citations, results }
 * - Search API:  POST https://ydc-index.io/v1/search   header X-API-Key   body { query, count } -> { results: { web: [...] } }
 * - Inference Router (OpenAI-compatible): POST https://api.you.com/v1/chat/completions  header Authorization: Bearer
 *   -> needs purchased credits (our key returned 402 "requires purchased API credits"), so it is opt-in.
 * Long Answer queries returned HTTP 500 in testing; keep queries short (see MAX_ANSWER_QUERY_CHARS).
 */

export const ANSWER_URL = "https://api.you.com/v1/answer";
export const SEARCH_URL = "https://ydc-index.io/v1/search";
export const ROUTER_URL = "https://api.you.com/v1/chat/completions";

/** Conservative cap; longer queries have failed with HTTP 500. */
export const MAX_ANSWER_QUERY_CHARS = 400;

export class YouComError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = "YouComError";
  }
}

function apiKey(): string {
  const k = process.env.YDC_API_KEY;
  if (!k) throw new YouComError("YDC_API_KEY is not set (put it in .env)");
  return k;
}

async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  { timeoutMs = 30_000, retries = 1 }: { timeoutMs?: number; retries?: number } = {},
): Promise<unknown> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        // 429/5xx are worth one retry; 4xx are not
        if ((res.status === 429 || res.status >= 500) && attempt < retries) {
          const retryAfter = Number(res.headers.get("retry-after")) || 1.5 * (attempt + 1);
          await new Promise((r) => setTimeout(r, retryAfter * 1000));
          lastErr = new YouComError(`You.com HTTP ${res.status}`, res.status, text.slice(0, 500));
          continue;
        }
        throw new YouComError(`You.com HTTP ${res.status}`, res.status, text.slice(0, 500));
      }
      return JSON.parse(text);
    } catch (e) {
      lastErr = e;
      if (e instanceof YouComError) throw e;
      if (attempt >= retries) break;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof Error ? lastErr : new YouComError(String(lastErr));
}

export interface AnswerResult {
  answer: string;
  citations: unknown[];
  sources: { url: string; title?: string }[];
}

/** One-shot question → synthesized answer (You.com Answer API, works on free credits). */
export async function youAnswer(query: string, opts: { timeoutMs?: number } = {}): Promise<AnswerResult> {
  const q = query.length > MAX_ANSWER_QUERY_CHARS ? query.slice(0, MAX_ANSWER_QUERY_CHARS) : query;
  const json = (await postJson(ANSWER_URL, { query: q }, { "X-API-Key": apiKey() }, opts)) as {
    answer?: string;
    citations?: unknown[];
    results?: { web?: { url: string; title?: string }[] };
  };
  return {
    answer: (json.answer ?? "").trim(),
    citations: json.citations ?? [],
    sources: (json.results?.web ?? []).map((w) => ({ url: w.url, title: w.title })),
  };
}

export interface SearchHit {
  url: string;
  title: string;
  description?: string;
  snippets?: string[];
}

/** Web search (You.com Search API, free credits). */
export async function youSearch(query: string, count = 5): Promise<SearchHit[]> {
  const json = (await postJson(SEARCH_URL, { query, count }, { "X-API-Key": apiKey() })) as {
    results?: { web?: SearchHit[] };
  };
  return (json.results?.web ?? []).slice(0, count);
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** OpenAI-compatible chat via the You.com Inference Router. Requires purchased credits (opt-in via LLM_PROVIDER). */
export async function youChat(messages: ChatMessage[], opts: { model?: string; maxTokens?: number } = {}): Promise<string> {
  const model = opts.model ?? process.env.YDC_ROUTER_MODEL;
  if (!model) throw new YouComError("YDC_ROUTER_MODEL is not set");
  const json = (await postJson(
    ROUTER_URL,
    { model, messages, max_tokens: opts.maxTokens ?? 400 },
    { Authorization: `Bearer ${apiKey()}` },
  )) as { choices?: { message?: { content?: string } }[] };
  return (json.choices?.[0]?.message?.content ?? "").trim();
}

export type LlmProvider = "youcom-answer" | "youcom-router";

export function llmProvider(): LlmProvider {
  return process.env.LLM_PROVIDER === "youcom-router" ? "youcom-router" : "youcom-answer";
}
