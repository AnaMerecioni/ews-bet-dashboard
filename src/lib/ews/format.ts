const cache = new Map<number, Intl.NumberFormat>();
const nf = (d: number) => {
  let f = cache.get(d);
  if (!f) {
    f = new Intl.NumberFormat("ro-RO", { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: true });
    cache.set(d, f);
  }
  return f;
};
const minus = (x: number) => (x < 0 ? "−" : "");

export const pct = (p: number, d = 1) => `${minus(p)}${nf(d).format(Math.abs(p * 100))}%`;
export const num = (x: number, d = 0) => `${minus(x)}${nf(d).format(Math.abs(x))}`;
/** Variația probabilității, afișată în procente ("−2,7%"), nu în „p.p.”. */
export const pp = (x: number, d = 1) => `${x > 0 ? "+" : minus(x)}${nf(d).format(Math.abs(x * 100))}%`;
/** Contribuția unui factor: în procente simple ("+9,2%"), nu în „p.p.”, ca să fie ușor de citit de management. */
export const fmtContrib = (x: number, unit: "pp" | "logit") =>
  unit === "pp"
    ? `${x > 0 ? "+" : minus(x)}${nf(1).format(Math.abs(x * 100))}%`
    : `${x > 0 ? "+" : minus(x)}${nf(2).format(Math.abs(x))}`;

export const fmtDate = (iso: string) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "—");
const MONTHS = ["ian", "feb", "mar", "apr", "mai", "iun", "iul", "aug", "sep", "oct", "noi", "dec"];
export const fmtMonth = (iso: string) => `${MONTHS[+iso.slice(5, 7) - 1]} ${iso.slice(2, 4)}`;

export const days = (n: number) => (n === 1 ? "1 zi" : `${n} zile`);
