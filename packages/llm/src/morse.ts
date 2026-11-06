/** International Morse code. Letters are separated by spaces, words by " / ". */
const MORSE: Record<string, string> = {
  A: ".-", B: "-...", C: "-.-.", D: "-..", E: ".", F: "..-.", G: "--.", H: "....", I: "..", J: ".---",
  K: "-.-", L: ".-..", M: "--", N: "-.", O: "---", P: ".--.", Q: "--.-", R: ".-.", S: "...", T: "-",
  U: "..-", V: "...-", W: ".--", X: "-..-", Y: "-.--", Z: "--..",
  "0": "-----", "1": ".----", "2": "..---", "3": "...--", "4": "....-", "5": ".....", "6": "-....",
  "7": "--...", "8": "---..", "9": "----.",
  ".": ".-.-.-", ",": "--..--", "?": "..--..", "@": ".--.-.", "/": "-..-.", "-": "-....-", "!": "-.-.--",
};

const REVERSE: Record<string, string> = Object.fromEntries(Object.entries(MORSE).map(([k, v]) => [v, k]));

export function toMorse(text: string): string {
  return text
    .toUpperCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) =>
      [...word]
        .map((ch) => MORSE[ch])
        .filter(Boolean)
        .join(" "),
    )
    .join(" / ");
}

/** Deterministic local decoder; used in tests and as an offline fallback, never as "the model". */
export function fromMorse(morse: string): string {
  return morse
    .trim()
    .split(/\s*\/\s*/)
    .map((word) =>
      word
        .split(/\s+/)
        .map((code) => REVERSE[code] ?? "")
        .join(""),
    )
    .join(" ");
}
