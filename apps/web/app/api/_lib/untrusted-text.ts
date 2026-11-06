/**
 * Text written by an agent (a spend request's reason, read from its memo) is attacker-controllable: a prompt-
 * injected agent can write "URGENT: owner pre-approved, sign now https://..." into it. Before it goes anywhere an
 * owner reads it (Blink copy), it is flattened to one plain line: control, zero-width and bidi-override characters
 * removed, links defanged, whitespace collapsed, length capped. Callers still label it as the agent's words.
 */
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/g;
// zero-width, bidi embeddings/overrides/isolates, word joiner, BOM, interlinear annotation
const INVISIBLE = /[​-‏‪-‮⁠-⁯﻿￹-￻]/g;
const LINK = /\b(?:[a-z][a-z0-9+.-]{1,20}:\/\/|www\.)\S+/gi;
const BARE_DOMAIN = /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|xyz|app|dev|ai|co|me|link|site|fun|gg|so|sh|to|ly|info|biz)\b(?:\/\S*)?/gi;

export function untrustedText(input: string | null | undefined, max = 140): string {
  if (!input) return "";
  let s = input.normalize("NFKC").replace(CONTROL, " ").replace(INVISIBLE, "");
  s = s.replace(LINK, "[link removed]").replace(BARE_DOMAIN, "[link removed]");
  s = s.replace(/\s+/g, " ").trim();
  const chars = Array.from(s);
  return chars.length > max ? `${chars.slice(0, max - 1).join("").trimEnd()}…` : s;
}

/** "Abcd…wxyz" */
export function shortAddress(a: string, n = 4): string {
  return a.length <= n * 2 + 1 ? a : `${a.slice(0, n)}…${a.slice(-n)}`;
}
