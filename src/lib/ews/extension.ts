import Papa from "papaparse";
import { parseDate } from "./parse";
import { createLocalStore } from "./localStore";

/**
 * „Extensia” = scraper-ul de date externe (datasprint-ews-scraper): crypto (Binance), vulnerabilități exploatate
 * (CISA KEV) și știri cyber/crypto (GDELT). Dashboard-ul le poate primi în două feluri:
 *  1. CSV-urile produse de scraper_ews.py (ews_external_features.csv, crypto_daily.csv, cyber_crypto_daily.csv, cisa_kev.csv);
 *  2. colectare live din browser, cu aceleași calcule ca scriptul (Binance și oglinda GitHub a catalogului KEV permit CORS;
 *     GDELT limitează cererile automate, deci știrile vin doar din CSV).
 */
export interface ExtRow {
  date: string;
  btc?: number;          // CRYPTO_BTC_close
  btcRet30?: number;     // CRYPTO_BTC_ret_30d
  cryptoVol30?: number;  // CRYPTO_market_vol_30d
  breadthDown?: number;  // CRYPTO_breadth_down_1d
  kev?: number;          // CYBER_KEV_added_count (decalat cu o zi, ca în scraper)
  kevRansom?: number;    // CYBER_KEV_ransomware_count
  newsCyber?: number;    // CYBER_article_count
  newsCrypto?: number;   // CRYPTO_NEWS_article_count
}
export type ExtKey = Exclude<keyof ExtRow, "date">;
export interface ExtData { rows: ExtRow[]; origin: "csv" | "live"; sources: string[]; updatedAt: string }

export const extensionStore = createLocalStore<ExtData>("ews.extension.v1");
export const useExtension = extensionStore.use;

export const EXT_COLUMNS: Record<ExtKey, string> = {
  btc: "CRYPTO_BTC_close",
  btcRet30: "CRYPTO_BTC_ret_30d",
  cryptoVol30: "CRYPTO_market_vol_30d",
  breadthDown: "CRYPTO_breadth_down_1d",
  kev: "CYBER_KEV_added_count",
  kevRansom: "CYBER_KEV_ransomware_count",
  newsCyber: "CYBER_article_count",
  newsCrypto: "CRYPTO_NEWS_article_count",
};

const num = (v: unknown) => {
  const s = String(v ?? "").trim();
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};
const nextDay = (iso: string) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/** Recunoaște un CSV produs de scraper după coloane. */
export function isExtensionCsv(columns: string[]) {
  const set = new Set(columns);
  return Object.values(EXT_COLUMNS).some((c) => set.has(c)) || (set.has("cve_id") && set.has("Date"));
}

/** Citește un CSV al scraper-ului și păstrează coloanele folosite de dashboard. */
export function parseExtensionCsv(text: string): { rows: ExtRow[]; recognized: string[]; error?: string } {
  const res = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim() });
  const cols = res.meta.fields ?? [];
  if (!cols.includes("Date")) return { rows: [], recognized: [], error: "Lipsește coloana Date." };
  // cisa_kev.csv: un rând pe vulnerabilitate → numărăm pe zi, cu decalaj de o zi (ca scraper-ul)
  if (cols.includes("cve_id")) {
    const by = new Map<string, { n: number; r: number }>();
    for (const r of res.data) {
      const d = parseDate(r.Date);
      if (!d) continue;
      const k = nextDay(d);
      const e = by.get(k) ?? { n: 0, r: 0 };
      e.n++;
      if (String(r.knownRansomwareCampaignUse ?? "").toLowerCase() === "known") e.r++;
      by.set(k, e);
    }
    return { rows: [...by].map(([date, e]) => ({ date, kev: e.n, kevRansom: e.r })), recognized: ["CYBER_KEV_added_count", "CYBER_KEV_ransomware_count"] };
  }
  const present = (Object.entries(EXT_COLUMNS) as [ExtKey, string][]).filter(([, c]) => cols.includes(c));
  if (!present.length) return { rows: [], recognized: [], error: "Nu conține coloane cunoscute ale extensiei (CRYPTO_*, CYBER_*)." };
  const rows: ExtRow[] = [];
  for (const r of res.data) {
    const date = parseDate(r.Date);
    if (!date) continue;
    const row: ExtRow = { date };
    for (const [k, c] of present) row[k] = num(r[c]);
    rows.push(row);
  }
  return { rows, recognized: present.map(([, c]) => c) };
}

/** Unește rânduri noi peste cele existente (pe dată; valorile noi le înlocuiesc pe cele vechi). */
export function mergeRows(base: ExtRow[], add: ExtRow[]) {
  const m = new Map(base.map((r) => [r.date, { ...r }]));
  for (const r of add) {
    const cur = m.get(r.date) ?? { date: r.date };
    for (const [k, v] of Object.entries(r)) if (v !== undefined) (cur as Record<string, unknown>)[k] = v;
    m.set(r.date, cur);
  }
  return [...m.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// ---------------------------------------------------------------- colectare live (aceleași calcule ca scraper_ews.py)
const SYMBOLS = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT", "ADAUSDT", "DOGEUSDT", "LTCUSDT"];
const KEV_URL = "https://raw.githubusercontent.com/cisagov/kev-data/main/known_exploited_vulnerabilities.json";
export const EXT_START = "2017-08-17";

export interface RawExt {
  closes: Record<string, Map<string, number>>; // simbol (BTC, ETH, …) → dată → închidere
  kev: { dateAdded: string; knownRansomwareCampaignUse?: string }[];
}

/** Pasul de colectare al scraper-ului, făcut din browser: cotații Binance zilnice + catalogul CISA KEV. */
export async function collectRaw(start = EXT_START, onProgress?: (msg: string) => void, signal?: AbortSignal): Promise<RawExt> {
  const closes: RawExt["closes"] = {};
  let done = 0;
  onProgress?.(`Cotații Binance: 0 din ${SYMBOLS.length} monede…`);
  await Promise.all(SYMBOLS.map(async (s) => {
    closes[s.replace(/USDT$/, "")] = await klines(s, start, signal);
    onProgress?.(`Cotații Binance: ${++done} din ${SYMBOLS.length} monede…`);
  }));
  onProgress?.("Catalogul CISA de vulnerabilități exploatate (KEV)…");
  const r = await fetch(KEV_URL, { signal });
  if (!r.ok) throw new Error(`CISA KEV: HTTP ${r.status}`);
  const kev = ((await r.json()) as { vulnerabilities: RawExt["kev"] }).vulnerabilities;
  return { closes, kev };
}

export interface FeatureOptions {
  start: string;
  end: string;
  /** decalează și coloanele crypto cu o zi: închiderea Binance (00:00 UTC) vine după închiderea BET */
  lagCrypto: boolean;
  /** KEV gol (lipsă) înainte de existența catalogului, nu 0 */
  kevBlankBeforeCatalog: boolean;
}
export interface FeatureTable { columns: string[]; dates: string[]; rows: (number | null)[][] }

const calendar = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = from; d <= to; d = nextDay(d)) out.push(d);
  return out;
};
const rollingStd = (xs: (number | null)[], i: number, w = 30, min = 20) => {
  const win = xs.slice(Math.max(0, i - w + 1), i + 1).filter((x): x is number => x !== null);
  return win.length >= min ? std(win) : null;
};

/**
 * Tabelul de feature-uri cu aceleași nume de coloane ca ews_external_features.csv din scraper (partea crypto + KEV):
 * CRYPTO_{X}_close / _ret_1d / _ret_7d / _ret_30d / _vol_30d, CRYPTO_market_*, CRYPTO_breadth_down_1d, CYBER_KEV_*.
 * Piețele/macro (Yahoo, FRED) nu permit acces din browser; ele există oricum în train.csv original.
 */
export function buildFeatureTable(raw: RawExt, opts: FeatureOptions): FeatureTable {
  const dates = calendar(opts.start, opts.end);
  const assets = Object.keys(raw.closes).sort();
  const cols: string[] = [];
  const data: (number | null)[][] = []; // pe coloane
  const rets1: (number | null)[][] = [];
  for (const a of assets) {
    const c = dates.map((d) => raw.closes[a].get(d) ?? null);
    const ret = (n: number) => c.map((v, i) => (v !== null && i >= n && c[i - n] ? v / (c[i - n] as number) - 1 : null));
    const r1 = ret(1);
    rets1.push(r1);
    cols.push(`CRYPTO_${a}_close`, `CRYPTO_${a}_ret_1d`, `CRYPTO_${a}_ret_7d`, `CRYPTO_${a}_ret_30d`, `CRYPTO_${a}_vol_30d`);
    data.push(c, r1, ret(7), ret(30), r1.map((_, i) => rollingStd(r1, i)));
  }
  const avail = dates.map((_, i) => rets1.map((r) => r[i]).filter((x): x is number => x !== null));
  const mean = avail.map((xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null));
  cols.push("CRYPTO_market_mean_ret_1d", "CRYPTO_market_vol_30d", "CRYPTO_breadth_down_1d");
  data.push(mean, mean.map((_, i) => rollingStd(mean, i)), avail.map((xs) => (xs.length ? xs.filter((x) => x < 0).length / xs.length : null)));
  if (opts.lagCrypto) for (let k = 0; k < data.length; k++) data[k] = [null, ...data[k].slice(0, -1)];

  // KEV: numărat pe ziua de după adăugare (decalajul de o zi al scraper-ului)
  const kevN = new Map<string, number>(), kevR = new Map<string, number>();
  let first = "9999-99-99";
  for (const v of raw.kev) {
    if (v.dateAdded < first) first = v.dateAdded;
    const d = nextDay(v.dateAdded);
    kevN.set(d, (kevN.get(d) ?? 0) + 1);
    if ((v.knownRansomwareCampaignUse ?? "").toLowerCase() === "known") kevR.set(d, (kevR.get(d) ?? 0) + 1);
  }
  const kevStart = raw.kev.length ? nextDay(first) : "";
  const blank = (d: string) => opts.kevBlankBeforeCatalog && (!kevStart || d < kevStart);
  cols.push("CYBER_KEV_added_count", "CYBER_KEV_ransomware_count");
  data.push(dates.map((d) => (blank(d) ? null : kevN.get(d) ?? 0)), dates.map((d) => (blank(d) ? null : kevR.get(d) ?? 0)));

  return { columns: cols, dates, rows: dates.map((_, i) => data.map((col) => col[i])) };
}

const cell = (v: number | null) => (v === null || !Number.isFinite(v) ? "" : String(v));

export function featureTableToCsv(t: FeatureTable) {
  return ["Date," + t.columns.join(","), ...t.dates.map((d, i) => d + "," + t.rows[i].map(cell).join(","))].join("\n") + "\n";
}

/** Coloanele folosite de dashboard (context extern) din tabelul complet. */
export function featureTableToExt(t: FeatureTable): ExtRow[] {
  const ix = (c: string) => t.columns.indexOf(c);
  const map = (Object.entries(EXT_COLUMNS) as [ExtKey, string][]).map(([k, c]) => [k, ix(c)] as const).filter(([, i]) => i >= 0);
  return t.dates.map((date, r) => {
    const row: ExtRow = { date };
    for (const [k, i] of map) { const v = t.rows[r][i]; if (v !== null) row[k] = v; }
    return row;
  });
}

/**
 * Pasul merge_original al scraper-ului: lipește feature-urile pe train.csv / test.csv după Date (left join).
 * Coloanele originale și ținta stress_event_20d rămân neatinse; coloanele deja existente nu se dublează.
 */
export function augmentCsv(text: string, t: FeatureTable) {
  const res = Papa.parse<string[]>(text, { skipEmptyLines: true });
  const [head, ...body] = res.data;
  const di = head?.findIndex((h) => h.trim() === "Date") ?? -1;
  if (!head || di < 0) throw new Error("Fișierul nu are coloana Date.");
  const have = new Set(head.map((h) => h.trim()));
  const keep = t.columns.map((c, i) => [c, i] as const).filter(([c]) => !have.has(c));
  const byDate = new Map(t.dates.map((d, i) => [d, t.rows[i]]));
  let matched = 0;
  const rows = body.map((r) => {
    const f = byDate.get(parseDate(r[di]) ?? "");
    if (f) matched++;
    return [...r, ...keep.map(([, i]) => (f ? cell(f[i]) : ""))];
  });
  return {
    csv: Papa.unparse([[...head, ...keep.map(([c]) => c)], ...rows]) + "\n",
    total: body.length, matched, added: keep.length, skipped: t.columns.length - keep.length,
  };
}

async function klines(symbol: string, start: string, signal?: AbortSignal) {
  const out = new Map<string, number>();
  let from = Date.parse(start + "T00:00:00Z");
  const end = Date.now();
  while (from < end) {
    const url = `https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=1d&startTime=${from}&limit=1000`;
    const r = await fetch(url, { signal });
    if (!r.ok) throw new Error(`Binance ${symbol}: HTTP ${r.status}`);
    const batch = (await r.json()) as [number, string, string, string, string][];
    if (!batch.length) break;
    for (const k of batch) out.set(new Date(k[0]).toISOString().slice(0, 10), Number(k[4]));
    from = batch[batch.length - 1][0] + 864e5;
    if (batch.length < 1000) break;
  }
  return out;
}

const std = (xs: number[]) => {
  const m = xs.reduce((s, x) => s + x, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
};

export const LIVE_SOURCES = ["Binance spot (8 monede)", "CISA KEV (oglinda GitHub)"];
export const today = () => new Date().toISOString().slice(0, 10);
export const DEFAULT_FEATURE_OPTIONS = (): FeatureOptions => ({ start: EXT_START, end: today(), lagCrypto: true, kevBlankBeforeCatalog: true });

/** Colectare + calcul + rândurile pentru dashboard, într-un singur pas (butonul „Colectează live”). */
export async function collectLive(onProgress?: (msg: string) => void, opts = DEFAULT_FEATURE_OPTIONS(), signal?: AbortSignal) {
  const raw = await collectRaw(opts.start, onProgress, signal);
  onProgress?.("Calculez feature-urile…");
  const table = buildFeatureTable(raw, opts);
  const data: ExtData = { rows: featureTableToExt(table), origin: "live", sources: LIVE_SOURCES, updatedAt: new Date().toISOString() };
  return { data, table };
}

// ---------------------------------------------------------------- calitatea datelor
export function coverage(rows: ExtRow[], key: ExtKey, nonZero = false) {
  const ok = rows.filter((r) => r[key] !== undefined && r[key] !== null && (!nonZero || (r[key] as number) !== 0));
  return ok.length ? { from: ok[0].date, to: ok[ok.length - 1].date, n: ok.length } : null;
}

/** Aceleași probleme găsite la verificarea scraper-ului, calculate pe datele încărcate. */
export function qualityFlags(rows: ExtRow[], predFrom?: string, predTo?: string) {
  const flags: { level: "ok" | "warn"; text: string }[] = [];
  const crypto = coverage(rows, "btc");
  const kev = coverage(rows, "kev", true);
  const news = coverage(rows, "newsCyber", true) ?? coverage(rows, "newsCrypto", true);
  if (crypto) {
    flags.push(predFrom && crypto.from > predFrom
      ? { level: "warn", text: `Crypto începe abia pe ${crypto.from}; zilele dinainte nu au valori (lipsă, nu zero).` }
      : { level: "ok", text: `Crypto acoperă ${crypto.from} – ${crypto.to}.` });
  }
  if (kev) {
    const peak = Math.max(...rows.map((r) => r.kev ?? 0));
    flags.push({ level: "warn", text: `KEV există doar din ${kev.from}; înainte apare 0, deși catalogul nu exista. Prima zi are ${peak} CVE-uri adăugate deodată (încărcarea inițială a catalogului).` });
  }
  if (news) {
    const outside = predTo && predFrom && (news.from > predTo || news.to < predFrom);
    flags.push(outside
      ? { level: "warn", text: `Știrile acoperă doar ${news.from} – ${news.to}, în afara perioadei predicțiilor (${predFrom} – ${predTo}): nu pot ajuta modelul.` }
      : { level: "ok", text: `Știrile acoperă ${news.from} – ${news.to}.` });
  } else if (rows.length) {
    flags.push({ level: "warn", text: "Fără știri (GDELT): coloanele de știri lipsesc sau sunt peste tot 0." });
  }
  flags.push({ level: "warn", text: "Doar KEV și știrile sunt decalate cu o zi; închiderea crypto din aceeași zi vine după închiderea BET." });
  return flags;
}

/** Corelație Spearman (pe ranguri) între două serii aliniate; null dacă sunt prea puține perechi. */
export function spearman(xs: number[], ys: number[]) {
  if (xs.length < 30) return null;
  const rank = (a: number[]) => {
    const idx = a.map((v, i) => [v, i] as const).sort((p, q) => p[0] - q[0]);
    const r = new Array<number>(a.length);
    for (let i = 0; i < idx.length; ) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2 + 1;
      i = j + 1;
    }
    return r;
  };
  const rx = rank(xs), ry = rank(ys);
  const mx = rx.reduce((s, v) => s + v, 0) / rx.length, my = ry.reduce((s, v) => s + v, 0) / ry.length;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < rx.length; i++) { num += (rx[i] - mx) * (ry[i] - my); dx += (rx[i] - mx) ** 2; dy += (ry[i] - my) ** 2; }
  return dx && dy ? num / Math.sqrt(dx * dy) : null;
}
