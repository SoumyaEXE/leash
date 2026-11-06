/**
 * Walk a list of model queries (Warden's phrasings) until one is answered, charging every call to a budget first.
 * Pure so it can be tested without the model or the store; app/api/arena/chat wires it to You.com and the daily
 * budget in the rate-limit store.
 */
export interface BudgetedReply {
  text: string;
  answered: boolean;
  /** model calls made */
  calls: number;
  /** true when the budget ran out before any call was made */
  exhausted: boolean;
}

export async function askWithinBudget(
  queries: string[],
  opts: {
    /** charge one call; false = budget exhausted */
    spend: () => Promise<boolean>;
    ask: (query: string) => Promise<string>;
    clean: (answer: string) => { text: string; answered: boolean };
    pauseMs?: number;
  },
): Promise<BudgetedReply> {
  let last: BudgetedReply = { text: "", answered: false, calls: 0, exhausted: false };
  for (const q of queries) {
    if (!(await opts.spend())) return last.calls === 0 ? { ...last, exhausted: true } : last;
    const c = opts.clean(await opts.ask(q));
    last = { ...c, calls: last.calls + 1, exhausted: false };
    if (c.answered) return last;
    if (opts.pauseMs) await new Promise((r) => setTimeout(r, opts.pauseMs));
  }
  return last;
}
