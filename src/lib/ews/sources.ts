import Papa from "papaparse";
import type { FeatureTable } from "./extension";

/**
 * Sursele extensiei care ÎMBOGĂȚESC datele DataSprint: doar informație care nu există deja în train/test
 * (DataSprint are deja BET, indicii mari, VIX/MOVE/VSTOXX, cursurile RON, ROBOR/ROBID, Brent, aur, cupru,
 * riscul geopolitic, GDELT, inflația, șomajul, PIB-ul, comerțul exterior, datoria publică și prețurile caselor).
 *
 * Toate sursele de aici permit acces din browser (CORS). Fiecare valoare e pusă la data la care era deja
 * PUBLICATĂ (decalaj de publicare), ca modelul să nu vadă viitorul:
 *   - zilnic (piețe, indici, atenție online): disponibil a doua zi;
 *   - lunar: disponibil de la 1 a lunii m+L, unde L ține cont de întârzierea reală a publicării.
 */

export interface ColMeta { name: string; category: string; source: string; freq: "zilnic" | "lunar"; available: string; desc: string }
/** O serie gata de pus pe calendar: punctele sunt deja la data disponibilității. */
export interface ExtSeries { meta: ColMeta; points: [string, number][]; fill: "daily" | "monthly" | "none" }
export interface SourceCtx { start: string; end: string; signal?: AbortSignal; progress: (msg: string) => void }
export interface SourceDef { id: string; label: string; detail: string; category: string; run: (ctx: SourceCtx) => Promise<ExtSeries[]> }

/** Coloanele DataSprint originale: extensia nu trebuie să le dubleze. */
export const DATASPRINT_COLUMNS = [
  "Date", "stress_event_20d", "BET_Close_RON", "EUROSTOXX_Close", "STOXX600_Close", "DAX_Close", "SP500_Close", "NASDAQ100_Close", "MSCI_EM_Close",
  "VIX_Close", "MOVE_Close", "VSTOXX_Close", "FX_RON_EUR", "FX_RON_USD", "FX_USD_EUR", "ROBID_ON", "ROBID_TMW", "ROBID_1W", "ROBID_1M", "ROBID_3M",
  "ROBID_6M", "ROBID_12M", "ROBOR_ON", "ROBOR_TMW", "ROBOR_1W", "ROBOR_1M", "ROBOR_3M", "ROBOR_6M", "ROBOR_12M", "DCOILBRENTEU", "Gold_Close",
  "Copper_Close", "GPRD", "GPRD_ACT", "GPRD_THREAT", "GPRD_MA30", "GPRD_MA7", "GPR_Event", "GDELT_Conflict_Event_Count", "GDELT_Avg_Tone",
  "GDELT_Goldstein_Scale", "CPI_102A", "CPI_102E", "GSCPI", "HICP_EU_MOM", "HICP_EU_YOY", "Unemp_RO", "Unemp_EU", "RO_EXPORTS_TOTAL_EUR",
  "RO_IMPORTS_TOTAL_EUR", "GDP_RO_QoQ", "GDP_RO_YoY", "GOV_Debt_RO", "HPI_YoY", "HPI_QoQ",
];
/** Prefixele DataSprint (pentru verificarea că nicio coloană nouă nu intră în categoriile existente). */
export const DATASPRINT_PREFIXES = ["BET_", "EUROSTOXX", "STOXX600", "DAX", "SP500", "NASDAQ100", "MSCI_EM", "VIX", "VSTOXX", "MOVE", "FX_", "ROBOR", "ROBID",
  "DCOILBRENTEU", "Gold", "Copper", "GPR", "GDELT", "CPI_", "HICP", "GSCPI", "Unemp", "RO_EXPORTS", "RO_IMPORTS", "GDP", "GOV_Debt", "HPI"];

/** Categoriile noi, după prefix (pentru REGULI_CATEGORIE din notebook și pentru drivers.csv). */
export const EXT_CATEGORIES: [string, string][] = [
  ["CRYPTO_", "Crypto"],
  ["CYBER_", "Cyber"],
  ["STRESS_", "Stres financiar sistemic"],
  ["RATES_", "Randamente suverane"],
  ["CEEFX_", "Valute regionale (ECE)"],
  ["MACRO_", "Sentiment și ciclu economic"],
  ["ATTN_", "Atenție publică online"],
];
export const categoryOf = (name: string) => EXT_CATEGORIES.find(([p]) => name.startsWith(p))?.[1] ?? "Altele";

// ------------------------------------------------------------------------------------------- utilitare
export const addDays = (iso: string, n: number) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** Prima zi a lunii m+L pentru o observație lunară „AAAA-LL”. */
export const monthAvailable = (ym: string, lagMonths: number) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + lagMonths, 1)).toISOString().slice(0, 10);
};
const ymMinus = (ym: string, n: number) => monthAvailable(ym, -n).slice(0, 7);

async function fetchText(url: string, ctx: SourceCtx, ok: (t: string) => boolean = () => true, tries = 4): Promise<string> {
  let last: unknown = null;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { signal: ctx.signal });
      const t = await r.text();
      if (r.ok && ok(t)) return t;
      last = new Error(`HTTP ${r.status}`);
    } catch (e) {
      if (ctx.signal?.aborted) throw e;
      last = e;
    }
    if (i < tries - 1) await new Promise((res) => setTimeout(res, 1200 * 2 ** i));
  }
  throw last instanceof Error ? last : new Error("cerere eșuată");
}

const daily = (pts: [string, number][], lagDays = 1): [string, number][] => pts.map(([d, v]) => [addDays(d, lagDays), v]);
const monthly = (pts: [string, number][], lag: number): [string, number][] => pts.map(([m, v]) => [monthAvailable(m, lag), v]);
const changeN = (pts: [string, number][], n: number): [string, number][] => pts.slice(n).map(([d, v], i) => [d, v - pts[i][1]]);
const logRet = (pts: [string, number][]): [string, number][] => pts.slice(1).map(([d, v], i) => [d, Math.log(v / pts[i][1])]);
function rollStd(pts: [string, number][], w: number, min: number): [string, number][] {
  const out: [string, number][] = [];
  for (let i = 0; i < pts.length; i++) {
    const win = pts.slice(Math.max(0, i - w + 1), i + 1).map((p) => p[1]);
    if (win.length < min) continue;
    const m = win.reduce((s, x) => s + x, 0) / win.length;
    out.push([pts[i][0], Math.sqrt(win.reduce((s, x) => s + (x - m) ** 2, 0) / (win.length - 1))]);
  }
  return out;
}
function yoy(pts: [string, number][]): [string, number][] {
  const m = new Map(pts);
  return pts.flatMap(([ym, v]) => { const p = m.get(ymMinus(ym, 12)); return p ? [[ym, v / p - 1] as [string, number]] : []; });
}
/** Unește serii pe aceeași dată cu o funcție (ex. diferență, medie). */
function combine(series: [string, number][][], f: (xs: number[]) => number, need = series.length): [string, number][] {
  const m = new Map<string, number[]>();
  for (const s of series) for (const [d, v] of s) (m.get(d) ?? m.set(d, []).get(d)!).push(v);
  return [...m].filter(([, xs]) => xs.length >= need).map(([d, xs]) => [d, f(xs)] as [string, number]).sort((a, b) => a[0].localeCompare(b[0]));
}
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const meta = (name: string, source: string, freq: ColMeta["freq"], available: string, desc: string): ColMeta =>
  ({ name, category: categoryOf(name), source, freq, available, desc });

// ------------------------------------------------------------------------------------------- clienți API
async function ecb(flowKey: string, start: string, ctx: SourceCtx) {
  const t = await fetchText(`https://data-api.ecb.europa.eu/service/data/${flowKey}?format=csvdata&detail=dataonly&startPeriod=${start}`, ctx, (s) => s.startsWith("KEY,"));
  const out = new Map<string, [string, number][]>();
  for (const r of Papa.parse<Record<string, string>>(t, { header: true, skipEmptyLines: true }).data) {
    const v = Number(r.OBS_VALUE);
    if (!r.TIME_PERIOD || r.OBS_VALUE === "" || !Number.isFinite(v)) continue;
    (out.get(r.KEY) ?? out.set(r.KEY, []).get(r.KEY)!).push([r.TIME_PERIOD, v]);
  }
  for (const a of out.values()) a.sort((x, y) => x[0].localeCompare(y[0]));
  return out;
}
const ecbOne = async (flowKey: string, start: string, ctx: SourceCtx) => [...(await ecb(flowKey, start, ctx)).values()][0] ?? [];

/** Eurostat JSON-stat, cu filtre care aleg o singură categorie pe fiecare dimensiune în afară de timp. */
async function eurostat(dataset: string, params: Record<string, string>, since: string, ctx: SourceCtx): Promise<[string, number][]> {
  const q = new URLSearchParams({ ...params, sinceTimePeriod: since });
  const t = await fetchText(`https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/${dataset}?${q}`, ctx, (s) => s.startsWith("{"));
  const d = JSON.parse(t) as { id: string[]; size: number[]; value: Record<string, number>; dimension: Record<string, { category: { index: Record<string, number> } }> };
  const ti = d.id.indexOf("time");
  let stride = 1;
  for (let k = d.id.length - 1; k > ti; k--) stride *= d.size[k];
  return Object.entries(d.dimension.time.category.index)
    .flatMap(([per, pos]) => { const v = d.value[String(pos * stride)]; return typeof v === "number" ? [[per, v] as [string, number]] : []; })
    .sort((a, b) => a[0].localeCompare(b[0]));
}

async function oecdCli(areas: string[], start: string, ctx: SourceCtx) {
  const url = `https://sdmx.oecd.org/public/rest/data/OECD.SDD.STES,DSD_STES@DF_CLI,4.1/${areas.join("+")}.M.LI...AA...H?startPeriod=${start}&dimensionAtObservation=AllDimensions&format=csvfile`;
  const t = await fetchText(url, ctx, (s) => s.startsWith("DATAFLOW"));
  const out = new Map<string, [string, number][]>();
  for (const r of Papa.parse<Record<string, string>>(t, { header: true, skipEmptyLines: true }).data) {
    const v = Number(r.OBS_VALUE);
    if (!Number.isFinite(v) || !r.TIME_PERIOD) continue;
    (out.get(r.REF_AREA) ?? out.set(r.REF_AREA, []).get(r.REF_AREA)!).push([r.TIME_PERIOD, v]);
  }
  for (const a of out.values()) a.sort((x, y) => x[0].localeCompare(y[0]));
  return out;
}

async function wikiViews(project: string, article: string, start: string, end: string, ctx: SourceCtx): Promise<[string, number][]> {
  const s = (start < "2015-07-01" ? "2015-07-01" : start).replaceAll("-", "");
  const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/${project}/all-access/user/${encodeURIComponent(article)}/daily/${s}/${end.replaceAll("-", "")}`;
  const t = await fetchText(url, ctx, (x) => x.startsWith("{"));
  const items = (JSON.parse(t) as { items?: { timestamp: string; views: number }[] }).items ?? [];
  return items.map((i) => [`${i.timestamp.slice(0, 4)}-${i.timestamp.slice(4, 6)}-${i.timestamp.slice(6, 8)}`, i.views]);
}
const unixDay = (s: number | string) => new Date(Number(s) * 1000).toISOString().slice(0, 10);
async function json<T>(url: string, ctx: SourceCtx): Promise<T> {
  return JSON.parse(await fetchText(url, ctx, (t) => t.startsWith("{") || t.startsWith("["))) as T;
}

// ------------------------------------------------------------------------------------------- sursele
const warm = (start: string, days: number) => addDays(start, -days);
const warmMonth = (start: string, months: number) => monthAvailable(start.slice(0, 7), -months).slice(0, 7);

export const SOURCES: SourceDef[] = [
  {
    id: "stress", label: "Stres financiar sistemic", category: "Stres financiar sistemic",
    detail: "ECB CISS (zona euro, zilnic) și CLIFS — indicele de stres financiar al României și media Ungaria/Polonia/Cehia (lunar).",
    async run(ctx) {
      ctx.progress("ECB: indicele de stres sistemic CISS…");
      const ciss = await ecbOne("CISS/D.U2.Z0Z.4F.EC.SS_CIN.IDX", warm(ctx.start, 60), ctx);
      ctx.progress("ECB: indicele de stres CLIFS pentru România și regiune…");
      const clifs = await ecb("CLIFS/M.RO+HU+PL+CZ._Z.4F.EC.CLIFS_CI.IDX", warmMonth(ctx.start, 3), ctx);
      const by = (c: string) => [...clifs].find(([k]) => k.includes(`.M.${c}.`))?.[1] ?? [];
      const cee = combine(["HU", "PL", "CZ"].map(by).filter((s) => s.length), mean, 1);
      return [
        { meta: meta("STRESS_CISS_EA", "ECB CISS", "zilnic", "a doua zi", "Indicele compozit de stres sistemic al zonei euro (0–1)."), points: daily(ciss), fill: "daily" },
        { meta: meta("STRESS_CISS_EA_chg20", "ECB CISS", "zilnic", "a doua zi", "Variația CISS pe 20 de zile de tranzacționare."), points: daily(changeN(ciss, 20)), fill: "daily" },
        { meta: meta("STRESS_CLIFS_RO", "ECB CLIFS", "lunar", "1 a lunii m+2", "Indicele de stres financiar al României (piețe de acțiuni, obligațiuni, valută)."), points: monthly(by("RO"), 2), fill: "monthly" },
        { meta: meta("STRESS_CLIFS_CEE", "ECB CLIFS", "lunar", "1 a lunii m+2", "Media indicelui de stres financiar pentru Ungaria, Polonia și Cehia (contagiune regională)."), points: monthly(cee, 2), fill: "monthly" },
      ];
    },
  },
  {
    id: "rates", label: "Randamente suverane", category: "Randamente suverane",
    detail: "Curba zonei euro 2A/10A (ECB, zilnic) și randamentul 10 ani al României și spread-ul față de Germania (Eurostat, lunar).",
    async run(ctx) {
      ctx.progress("ECB: curba randamentelor zonei euro…");
      const yc = await ecb("YC/B.U2.EUR.4F.G_N_A.SV_C_YM.SR_10Y+SR_2Y", warm(ctx.start, 10), ctx);
      const y10 = [...yc].find(([k]) => k.endsWith("SR_10Y"))?.[1] ?? [];
      const y2 = [...yc].find(([k]) => k.endsWith("SR_2Y"))?.[1] ?? [];
      ctx.progress("Eurostat: randamentele pe 10 ani România / Germania…");
      const since = warmMonth(ctx.start, 4);
      const ro = await eurostat("irt_lt_mcby_m", { geo: "RO" }, since, ctx);
      const de = await eurostat("irt_lt_mcby_m", { geo: "DE" }, since, ctx);
      return [
        { meta: meta("RATES_EA_10Y", "ECB YC", "zilnic", "a doua zi", "Randamentul pe 10 ani al curbei AAA a zonei euro (%)."), points: daily(y10), fill: "daily" },
        { meta: meta("RATES_EA_2Y", "ECB YC", "zilnic", "a doua zi", "Randamentul pe 2 ani al curbei AAA a zonei euro (%)."), points: daily(y2), fill: "daily" },
        { meta: meta("RATES_EA_SLOPE_10Y2Y", "ECB YC", "zilnic", "a doua zi", "Panta curbei (10A − 2A); negativă = semnal clasic de recesiune."), points: daily(combine([y10, y2], (x) => x[0] - x[1])), fill: "daily" },
        { meta: meta("RATES_RO_10Y", "Eurostat irt_lt_mcby_m", "lunar", "1 a lunii m+2", "Randamentul obligațiunilor de stat românești pe 10 ani (medie lunară, %)."), points: monthly(ro, 2), fill: "monthly" },
        { meta: meta("RATES_RO_10Y_chg3m", "Eurostat irt_lt_mcby_m", "lunar", "1 a lunii m+2", "Variația pe 3 luni a randamentului românesc pe 10 ani (%)."), points: monthly(changeN(ro, 3), 2), fill: "monthly" },
        { meta: meta("RATES_RO_DE_SPREAD", "Eurostat irt_lt_mcby_m", "lunar", "1 a lunii m+2", "Prima de risc a României: randament RO 10A − DE 10A (%)."), points: monthly(combine([ro, de], (x) => x[0] - x[1]), 2), fill: "monthly" },
      ];
    },
  },
  {
    id: "ceefx", label: "Valute regionale (ECE)", category: "Valute regionale (ECE)",
    detail: "Forint, zlot, coroană cehă și liră turcească față de euro (ECB): variația și volatilitatea pe 20 de zile — contagiune din regiune.",
    async run(ctx) {
      ctx.progress("ECB: cursurile HUF, PLN, CZK, TRY…");
      const fx = await ecb("EXR/D.HUF+PLN+CZK+TRY.EUR.SP00.A", warm(ctx.start, 60), ctx);
      const out: ExtSeries[] = [];
      const vols: [string, number][][] = [];
      for (const c of ["HUF", "PLN", "CZK", "TRY"]) {
        const s = [...fx].find(([k]) => k.includes(`.D.${c}.`))?.[1] ?? [];
        const r = logRet(s);
        const v = rollStd(r, 20, 15);
        vols.push(v);
        out.push(
          { meta: meta(`CEEFX_${c}_chg_20d`, "ECB EXR", "zilnic", "a doua zi", `Variația cursului ${c}/EUR pe 20 de zile (log; pozitiv = moneda se depreciază).`), points: daily(changeN(s.map(([d, x]) => [d, Math.log(x)]), 20)), fill: "daily" },
          { meta: meta(`CEEFX_${c}_vol_20d`, "ECB EXR", "zilnic", "a doua zi", `Volatilitatea zilnică a cursului ${c}/EUR pe 20 de zile.`), points: daily(v), fill: "daily" },
        );
      }
      out.push({ meta: meta("CEEFX_avg_vol_20d", "ECB EXR", "zilnic", "a doua zi", "Media volatilităților HUF, PLN, CZK, TRY: stres valutar în regiune."), points: daily(combine(vols, mean, 3)), fill: "daily" });
      return out;
    },
  },
  {
    id: "macro", label: "Sentiment și ciclu economic", category: "Sentiment și ciclu economic",
    detail: "România: încrederea economică, încrederea consumatorilor, producția industrială, comerțul (Eurostat). Ciclul global: indicatorii avansați OECD (Germania, SUA, China, G20).",
    async run(ctx) {
      const since = warmMonth(ctx.start, 15);
      // Eurostat răspunde cu 500 la cereri simultane: le facem pe rând
      ctx.progress("Eurostat: încrederea economică în România…");
      const esi = await eurostat("ei_bssi_m_r2", { geo: "RO", indic: "BS-ESI-I", s_adj: "SA" }, since, ctx);
      ctx.progress("Eurostat: încrederea consumatorilor…");
      const cons = await eurostat("ei_bssi_m_r2", { geo: "RO", indic: "BS-CSMCI-BAL", s_adj: "SA" }, since, ctx);
      ctx.progress("Eurostat: producția industrială…");
      const ip = await eurostat("sts_inpr_m", { geo: "RO", nace_r2: "B-D", s_adj: "SCA", unit: "I21" }, since, ctx);
      ctx.progress("Eurostat: comerțul cu amănuntul…");
      const retail = await eurostat("sts_trtu_m", { geo: "RO", nace_r2: "G47", s_adj: "SCA", unit: "I21", indic_bt: "VOL_SLS" }, since, ctx);
      ctx.progress("OECD: indicatorii economici avansați…");
      const cli = await oecdCli(["DEU", "USA", "CHN", "G20"], since, ctx);
      const c = (a: string) => cli.get(a) ?? [];
      const rev = " Datele OECD se revizuiesc; folosim ultima versiune.";
      return [
        { meta: meta("MACRO_RO_ESI", "Eurostat ei_bssi_m_r2", "lunar", "1 a lunii m+1", "Indicatorul încrederii economice în România (100 = media pe termen lung)."), points: monthly(esi, 1), fill: "monthly" },
        { meta: meta("MACRO_RO_CONS_CONF", "Eurostat ei_bssi_m_r2", "lunar", "1 a lunii m+1", "Încrederea consumatorilor din România (sold)."), points: monthly(cons, 1), fill: "monthly" },
        { meta: meta("MACRO_RO_IP_yoy", "Eurostat sts_inpr_m", "lunar", "1 a lunii m+3", "Producția industrială a României, variație anuală."), points: monthly(yoy(ip), 3), fill: "monthly" },
        { meta: meta("MACRO_RO_RETAIL_yoy", "Eurostat sts_trtu_m", "lunar", "1 a lunii m+3", "Volumul comerțului cu amănuntul în România, variație anuală."), points: monthly(yoy(retail), 3), fill: "monthly" },
        { meta: meta("MACRO_CLI_DEU", "OECD CLI", "lunar", "1 a lunii m+2", "Indicatorul avansat OECD pentru Germania (100 = trend)." + rev), points: monthly(c("DEU"), 2), fill: "monthly" },
        { meta: meta("MACRO_CLI_USA", "OECD CLI", "lunar", "1 a lunii m+2", "Indicatorul avansat OECD pentru SUA." + rev), points: monthly(c("USA"), 2), fill: "monthly" },
        { meta: meta("MACRO_CLI_CHN", "OECD CLI", "lunar", "1 a lunii m+2", "Indicatorul avansat OECD pentru China." + rev), points: monthly(c("CHN"), 2), fill: "monthly" },
        { meta: meta("MACRO_CLI_G20", "OECD CLI", "lunar", "1 a lunii m+2", "Indicatorul avansat OECD pentru G20." + rev), points: monthly(c("G20"), 2), fill: "monthly" },
        { meta: meta("MACRO_CLI_G20_chg3m", "OECD CLI", "lunar", "1 a lunii m+2", "Variația pe 3 luni a indicatorului avansat G20 (direcția ciclului)." + rev), points: monthly(changeN(c("G20"), 3), 2), fill: "monthly" },
      ];
    },
  },
  {
    id: "cryptosent", label: "Lichiditate și sentiment crypto", category: "Crypto",
    detail: "Capitalizarea totală a stablecoin-urilor (DefiLlama) și indicele Fear & Greed crypto (alternative.me).",
    async run(ctx) {
      ctx.progress("DefiLlama: capitalizarea stablecoin-urilor…");
      const st = await json<{ date: string | number; totalCirculatingUSD: Record<string, number> }[]>("https://stablecoins.llama.fi/stablecoincharts/all", ctx);
      const mcap: [string, number][] = st.map((r) => [unixDay(r.date), Object.values(r.totalCirculatingUSD ?? {}).reduce((s, x) => s + (x || 0), 0)]);
      const m = new Map(mcap);
      const ret30 = mcap.flatMap(([d, v]) => { const p = m.get(addDays(d, -30)); return p ? [[d, v / p - 1] as [string, number]] : []; });
      ctx.progress("alternative.me: indicele Fear & Greed…");
      const fng = await json<{ data: { value: string; timestamp: string }[] }>("https://api.alternative.me/fng/?limit=0&format=json", ctx);
      const f: [string, number][] = fng.data.map((r) => [unixDay(r.timestamp), Number(r.value)] as [string, number]).sort((a, b) => a[0].localeCompare(b[0]));
      return [
        { meta: meta("CRYPTO_STABLE_mcap_ret_30d", "DefiLlama", "zilnic", "a doua zi", "Creșterea pe 30 de zile a capitalizării stablecoin-urilor: lichiditatea care intră/iese din crypto."), points: daily(ret30), fill: "daily" },
        { meta: meta("CRYPTO_FNG", "alternative.me", "zilnic", "a doua zi", "Indicele Fear & Greed crypto (0 = frică extremă, 100 = lăcomie extremă)."), points: daily(f), fill: "daily" },
      ];
    },
  },
  {
    id: "hacks", label: "Atacuri asupra platformelor crypto", category: "Cyber",
    detail: "Istoricul complet al atacurilor DeFi/exchange (DefiLlama, din 2011): numărul și suma furată pe 30 de zile — înlocuiește știrile GDELT, care acoperă doar ultimele luni.",
    async run(ctx) {
      ctx.progress("DefiLlama: istoricul atacurilor crypto…");
      const hacks = await json<{ date: number; amount: number | null }[]>("https://api.llama.fi/hacks", ctx);
      const n = new Map<string, number>(), usd = new Map<string, number>();
      for (const h of hacks) {
        const d = addDays(unixDay(h.date), 1); // disponibil a doua zi
        n.set(d, (n.get(d) ?? 0) + 1);
        usd.set(d, (usd.get(d) ?? 0) + (h.amount ?? 0));
      }
      const cnt: [string, number][] = [], lost: [string, number][] = [];
      let sN = 0, sU = 0;
      const days: string[] = [];
      for (let d = warm(ctx.start, 30); d <= ctx.end; d = addDays(d, 1)) days.push(d);
      days.forEach((d, i) => {
        sN += n.get(d) ?? 0; sU += usd.get(d) ?? 0;
        if (i >= 30) { sN -= n.get(days[i - 30]) ?? 0; sU -= usd.get(days[i - 30]) ?? 0; }
        if (i >= 30) { cnt.push([d, sN]); lost.push([d, Math.log1p(Math.max(0, sU))]); }
      });
      return [
        { meta: meta("CYBER_DEFI_hacks_30d", "DefiLlama hacks", "zilnic", "a doua zi", "Numărul de atacuri asupra platformelor crypto în ultimele 30 de zile."), points: cnt, fill: "none" },
        { meta: meta("CYBER_DEFI_lost_usd_log_30d", "DefiLlama hacks", "zilnic", "a doua zi", "Suma furată în atacurile crypto din ultimele 30 de zile (log(1 + USD))."), points: lost, fill: "none" },
      ];
    },
  },
  {
    id: "attention", label: "Atenție publică online", category: "Atenție publică online",
    detail: "Vizualizări Wikipedia (din 2015) pentru recesiune, prăbușirea bursei, criză financiară, inflație, Bursa București și atacuri cibernetice — vârfurile de atenție față de ultimele 90 de zile.",
    async run(ctx) {
      const basket: [string, [string, string][], string][] = [
        ["ATTN_RECESSION", [["en.wikipedia", "Recession"]], "„Recession”"],
        ["ATTN_MARKET_CRASH", [["en.wikipedia", "Stock_market_crash"]], "„Stock market crash”"],
        ["ATTN_FIN_CRISIS", [["en.wikipedia", "Financial_crisis"]], "„Financial crisis”"],
        ["ATTN_INFLATION", [["en.wikipedia", "Inflation"], ["ro.wikipedia", "Inflație"]], "„Inflation” + „Inflație”"],
        ["ATTN_BVB", [["ro.wikipedia", "Bursa_de_Valori_București"], ["en.wikipedia", "Bucharest_Stock_Exchange"]], "Bursa de Valori București (ro + en)"],
        ["ATTN_CYBER", [["en.wikipedia", "Ransomware"], ["en.wikipedia", "Cyberattack"]], "„Ransomware” + „Cyberattack”"],
      ];
      const from = warm(ctx.start, 120);
      let done = 0;
      const total = basket.reduce((s, b) => s + b[1].length, 0);
      const spikes = await Promise.all(basket.map(async ([name, pages, label]) => {
        const views = await Promise.all(pages.map(async ([p, a]) => {
          const v = await wikiViews(p, a, from, ctx.end, ctx);
          ctx.progress(`Wikipedia: ${++done} din ${total} pagini…`);
          return v;
        }));
        const sum = combine(views, (xs) => xs.reduce((s, x) => s + x, 0), 1);
        // vârf de atenție: log(vizualizări / mediana celor 90 de zile anterioare)
        const spike: [string, number][] = [];
        for (let i = 60; i < sum.length; i++) {
          const prev = sum.slice(Math.max(0, i - 90), i).map((p) => p[1]).sort((a, b) => a - b);
          spike.push([sum[i][0], Math.log((sum[i][1] + 1) / (prev[Math.floor(prev.length / 2)] + 1))]);
        }
        return { meta: meta(name, "Wikimedia pageviews", "zilnic", "a doua zi", `Vârf de atenție pentru ${label}: log(vizualizări / mediana ultimelor 90 de zile).`), points: daily(spike), fill: "daily" as const };
      }));
      const fear = combine(spikes.slice(0, 4).map((s) => s.points), mean, 4);
      return [...spikes, { meta: meta("ATTN_FEAR_INDEX", "Wikimedia pageviews", "zilnic", "a doua zi", "Media vârfurilor de atenție pentru recesiune, prăbușirea bursei, criză financiară și inflație."), points: fear, fill: "daily" }];
    },
  },
];

// ------------------------------------------------------------------------------------------- tabelul final
const FILL_DAYS = { daily: 5, monthly: 100, none: 0 } as const;

/** Pune seriile pe calendarul tabelului (umplere înainte limitată: weekend/sărbători la zilnic, până la următoarea publicare la lunar). */
export function placeOnCalendar(dates: string[], s: ExtSeries): (number | null)[] {
  const pts = [...s.points].sort((a, b) => a[0].localeCompare(b[0]));
  const out: (number | null)[] = [];
  let j = 0, last: number | null = null, lastDate = "";
  const max = FILL_DAYS[s.fill];
  for (const d of dates) {
    while (j < pts.length && pts[j][0] <= d) { last = pts[j][1]; lastDate = pts[j][0]; j++; }
    if (last === null || !Number.isFinite(last)) { out.push(null); continue; }
    const age = Math.round((Date.parse(d) - Date.parse(lastDate)) / 864e5);
    out.push(age <= max ? last : null);
  }
  return out;
}

/** Adaugă coloanele surselor la tabelul crypto/KEV; nu adaugă nimic ce există deja în DataSprint sau în tabel. */
export function extendTable(t: FeatureTable, series: ExtSeries[]): FeatureTable {
  const have = new Set([...t.columns, ...DATASPRINT_COLUMNS]);
  const add = series.filter((s) => !have.has(s.meta.name));
  const cols = add.map((s) => placeOnCalendar(t.dates, s));
  return { columns: [...t.columns, ...add.map((s) => s.meta.name)], dates: t.dates, rows: t.rows.map((r, i) => [...r, ...cols.map((c) => c[i])]) };
}

/** Metadatele coloanelor crypto/KEV calculate de buildFeatureTable. */
export function baseMeta(name: string, lagCrypto: boolean): ColMeta {
  const when = lagCrypto ? "a doua zi" : "aceeași zi (00:00 UTC, după închiderea BET)";
  const m = name.match(/^CRYPTO_([A-Z]+)_(close|ret_1d|ret_7d|ret_30d|vol_30d)$/);
  if (m) {
    const what = { close: "prețul de închidere în USDT", ret_1d: "randamentul pe 1 zi", ret_7d: "randamentul pe 7 zile", ret_30d: "randamentul pe 30 de zile", vol_30d: "volatilitatea randamentelor zilnice pe 30 de zile" }[m[2]];
    return meta(name, "Binance spot", "zilnic", when, `${m[1]}: ${what}.`);
  }
  const d: Record<string, [string, string, string]> = {
    CRYPTO_market_mean_ret_1d: ["Binance spot", when, "Randamentul mediu zilnic al celor 8 monede."],
    CRYPTO_market_vol_30d: ["Binance spot", when, "Volatilitatea pieței crypto (randamentul mediu) pe 30 de zile."],
    CRYPTO_breadth_down_1d: ["Binance spot", when, "Ponderea monedelor (disponibile) care au scăzut în ziua respectivă."],
    CYBER_KEV_added_count: ["CISA KEV", "a doua zi", "Vulnerabilități exploatate adăugate în catalogul CISA."],
    CYBER_KEV_ransomware_count: ["CISA KEV", "a doua zi", "Dintre acestea, cele folosite în campanii ransomware."],
  };
  const x = d[name] ?? ["extensie", "—", ""];
  return meta(name, x[0], "zilnic", x[1], x[2]);
}

const csvCell = (s: string) => (/[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s);
export function metadataCsv(metas: ColMeta[]) {
  const head = ["variabila", "categorie", "sursa", "frecventa", "disponibil_din", "descriere"];
  return [head.join(","), ...metas.map((m) => [m.name, m.category, m.source, m.freq, m.available, m.desc].map(csvCell).join(","))].join("\n") + "\n";
}

/** Codul de lipit în notebook: încărcarea dataset-ului și categoriile noi pentru descompunerea Shapley. */
export function notebookSnippet(datasetSlug = "<username>/datasprint-ews-external-features", used = EXT_CATEGORIES) {
  return [
    "# --- Extensia Gama: date externe care îmbogățesc DataSprint ---",
    `EXT = pd.read_csv('/kaggle/input/${datasetSlug.split("/").pop()}/ews_external_features.csv', parse_dates=['Date'])`,
    "train = train.merge(EXT, on='Date', how='left')   # ținta stress_event_20d rămâne neschimbată",
    "test = test.merge(EXT, on='Date', how='left')",
    "",
    "# categoriile coloanelor extensiei (adaugă aceleași nume și în CATEGORII, pentru grafice și Shapley pe categorii)",
    "REGULI_CATEGORIE += [",
    ...used.map(([p, c]) => `    (('${p}',), '${c}'),`),
    "]",
  ].join("\n");
}
