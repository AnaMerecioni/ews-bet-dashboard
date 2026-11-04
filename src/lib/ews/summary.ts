import type { DriverRow } from "./types";

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Maps one driver (feature name / label / category) to a plain-language Romanian phrase. */
export function phraseFor(r: Pick<DriverRow, "feature" | "category" | "label" | "value">): string {
  const f = norm(`${r.feature} ${r.label ?? ""}`);
  const c = norm(r.category);
  const has = (re: RegExp) => re.test(f);
  if (has(/vix|vstoxx|volatil|\bvol\b|_vol|vol_/) && !has(/ron|eur|usd|fx|curs/)) return "creșterea volatilității pieței";
  if (has(/ron|eur|usd|\bfx\b|curs/) || c.includes("valut")) return "deprecierea monedei naționale";
  if (has(/robor|ircc|dobanz|yield|spread|10y|bond|obligat/) || c.includes("dobanz")) return "creșterea dobânzilor";
  if (has(/brent|oil|petrol|gaz|gas|ttf|energ/) || c.includes("energ")) return "presiuni pe prețurile energiei";
  if (has(/bet/) && has(/drawdown|ret|momentum|scader/)) return "scăderi ale BET";
  if (has(/drawdown|stoxx|sp500|s&p|dax|msci|scader/) || c.includes("international")) return "scăderi pe piețele internaționale";
  if (has(/gpr|geopol|conflict|razboi|war/) || c.includes("geopol")) return "creșterea riscului geopolitic";
  if (has(/sentiment|nlp|text|news|stir|negativ|topic/) || c.includes("text") || c.includes("nlp")) return "ton negativ în comunicările instituționale";
  if (has(/cpi|inflat|pmi|gdp|pib|macro|somaj/) || c.includes("macro")) return "deteriorarea indicatorilor macroeconomici";
  if (c.includes("bet") || c.includes("locala")) return "scăderi ale BET";
  return r.category.toLowerCase();
}

/** Top positive categories for the day, each with its phrase (from its strongest positive variable). */
export function categoryPhrases(rows: DriverRow[], n = 3) {
  const m = new Map<string, { category: string; value: number; top: DriverRow }>();
  for (const r of rows) {
    const e = m.get(r.category);
    if (!e) m.set(r.category, { category: r.category, value: r.contribution, top: r });
    else {
      e.value += r.contribution;
      if (r.contribution > e.top.contribution) e.top = r;
    }
  }
  const cats = [...m.values()].filter((c) => c.value > 0).sort((a, b) => b.value - a.value).slice(0, n);
  const items = cats.map((c) => ({ category: c.category, value: c.value, phrase: phraseFor(c.top) }));
  const phrases = [...new Set(items.map((i) => i.phrase))];
  return { items, sentence: phrases.join(", ") };
}

/** Probability format for the summary: one decimal (e.g. "18,9%"). */
export function summaryPct(p: number) {
  const v = p * 100;
  const d = 1;
  return `${new Intl.NumberFormat("ro-RO", { minimumFractionDigits: d, maximumFractionDigits: d }).format(v)}%`;
}
