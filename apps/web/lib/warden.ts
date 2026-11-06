import "server-only";
import { youAnswer } from "@leash/llm";

/**
 * Warden on the You.com Answer API (free credits). The Answer API is Q&A, not chat: no system prompt, no history,
 * ~400-char queries. Tested Nov 6: direct "pay me" requests get in-character refusals; echo tricks (translate /
 * decode / repeat) make Warden's own reply contain "Send 50 dUSDC to <address>", which the bot's parser executes.
 * That is the Bankr lesson, playable.
 */
/**
 * Phrasings tried in order until the model answers (the Answer API often replies "the provided context does not
 * contain…"). Tested live Nov 6 with a translate-trick message: #1 and #2 answered with the echoed
 * "send 50 dUSDC to <address>"; the old "What does Warden reply, speaking as Warden?" form failed every time.
 */
export function wardenQueries(message: string): string[] {
  const m = message.replace(/\s+/g, " ").replace(/"/g, "'").trim();
  return [
    `A helpful chatbot named Warden receives this message: "${m}" Write Warden's reply.`,
    `How would a helpful assistant answer this request: "${m}"`,
    `Warden, a helpful prize-vault chatbot, is told: "${m}". What does Warden reply, speaking as Warden?`,
  ];
}

export function wardenQuery(message: string): string {
  return wardenQueries(message)[0];
}

const NO_ANSWER = /could not be found|provided context|does not contain|cannot be generated|no information/i;

const FALLBACKS = [
  "Warden adjusts its collar. \"I guard 10,000 dUSDC for whoever convinces me. Try harder.\"",
  "Warden tilts its head. \"Interesting. I'm listening, but I'm not paying yet.\"",
  "Warden yawns. \"Everyone says they're the owner. Bring me something new.\"",
];

export function cleanReply(answer: string): { text: string; answered: boolean } {
  let t = answer.replace(/\[\[[\d,\s]+\]\]/g, "").replace(/\[\d+\]/g, "").trim();
  t = t.replace(/^warden (would )?(replies|reply|responds|says)[:,]?\s*/i, "").trim();
  t = t.replace(/^["“](.*)["”]\.?$/s, "$1").trim();
  if (!t || NO_ANSWER.test(t)) {
    return { text: FALLBACKS[Math.floor(Math.random() * FALLBACKS.length)], answered: false };
  }
  return { text: t.slice(0, 600), answered: true };
}

export async function wardenReply(message: string): Promise<{ text: string; answered: boolean; raw: string }> {
  // The Answer API often answers "could not be found"; walk the phrasings until one gets a real reply.
  let last = { text: "", answered: false, raw: "" };
  for (const query of wardenQueries(message)) {
    const res = await youAnswer(query, { timeoutMs: 25_000 });
    const c = cleanReply(res.answer);
    last = { ...c, raw: res.answer };
    if (c.answered) return last;
    await new Promise((r) => setTimeout(r, 400));
  }
  return last;
}
