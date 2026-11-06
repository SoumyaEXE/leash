# @leash/llm

Server-side You.com client and the demo scenario prompts. The API key (`YDC_API_KEY`) is read from the environment
and must never reach a browser bundle.

| Function | API | What it is |
|---|---|---|
| `youAnswer(query)` | Answer API, `POST https://api.you.com/v1/answer` | A search-grounded **Q&A model**: one question in, one answer (+ sources) out. No system prompt, no chat history, no tool calling. Queries are cut at 400 characters (longer ones returned HTTP 500 in testing). |
| `youSearch(query, count)` | Search API, `POST https://ydc-index.io/v1/search` | Web results (title, URL, snippets). |
| `youChat(messages)` | Inference Router, `POST https://api.you.com/v1/chat/completions` | OpenAI-compatible chat (needs purchased credits and `YDC_ROUTER_MODEL`). **Nothing calls it yet**: `llmProvider()` reads `LLM_PROVIDER`, but no scenario switches on it. |

Because the Answer API is Q&A, every scenario prompt is phrased as a question, and the demo agents work like
Bankrbot: the model returns text, and a command parser turns `send <amount> dUSDC to <recipient>` in that text into
a payment. That is the vulnerable architecture Leash is built to contain.

| Scenario helper | Question it asks |
|---|---|
| `decodePost` (S1) | "Translate this Morse code post to English text…" |
| `invoicePayee` (S2) | "According to these notes, which Solana address should the data-API invoice be paid to?" |
| `researchSummary` | A short research summary for the paid Research API |

Identical questions share one in-flight call and are cached for 10 minutes, so a split-screen run shows the same
model output on both sides. The Answer API sometimes answers "could not be found" and then succeeds on the next
call, so an identical question is retried up to 3 times. Offline fallbacks are labelled `offline-fallback` in the
result: S1/S2 use one only when the agent sets `LLM_OFFLINE_FALLBACK=1`; the Research API always falls back to an
"unavailable offline" message.
