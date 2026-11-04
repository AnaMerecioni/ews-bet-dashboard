import type { DriverRow, OutcomeRow, PredRow } from "./types";

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const DEMO_FEATURES: { feature: string; label: string; category: string; w: number }[] = [
  { feature: "brent_ret_20d", label: "Brent, randament 20 zile", category: "Energie și mărfuri", w: 0.6 },
  { feature: "ttf_gas_vol", label: "Volatilitate gaz TTF", category: "Energie și mărfuri", w: 0.4 },
  { feature: "eurron_vol", label: "Volatilitate EUR/RON", category: "Curs valutar", w: 0.55 },
  { feature: "usdron_ret", label: "USD/RON, variație", category: "Curs valutar", w: 0.45 },
  { feature: "robor_3m_chg", label: "ROBOR 3L, variație", category: "Dobânzi", w: 0.5 },
  { feature: "ro10y_spread", label: "Spread obligațiuni RO 10A", category: "Dobânzi", w: 0.5 },
  { feature: "vix_level", label: "Indicele VIX", category: "Piețe internaționale", w: 0.6 },
  { feature: "stoxx_drawdown", label: "Scădere STOXX 600", category: "Piețe internaționale", w: 0.4 },
  { feature: "bet_vol_20d", label: "Volatilitate BET 20 zile", category: "Piața locală BET", w: 0.6 },
  { feature: "bet_momentum", label: "Momentum BET", category: "Piața locală BET", w: 0.4 },
  { feature: "cpi_surprise", label: "Surpriză inflație RO", category: "Macroeconomie", w: 0.5 },
  { feature: "pmi_ez", label: "PMI zona euro", category: "Macroeconomie", w: 0.5 },
  { feature: "gpr_index", label: "Indice risc geopolitic", category: "Geopolitică", w: 0.6 },
  { feature: "regional_conflict", label: "Știri conflict regional", category: "Geopolitică", w: 0.4 },
  { feature: "news_sentiment", label: "Sentiment știri financiare", category: "Text / NLP", w: 0.55 },
  { feature: "risk_topic_share", label: "Pondere teme de risc (NLP)", category: "Text / NLP", w: 0.45 },
];
const CATS = [...new Set(DEMO_FEATURES.map((f) => f.category))];

interface Shock { at: number; len: number; mag: number; cats: Record<string, number>; crash: number }

function businessDays(from: string, to: string) {
  const out: string[] = [];
  const d = new Date(from + "T00:00:00Z");
  const end = new Date(to + "T00:00:00Z");
  while (d <= end) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export const DEMO_THRESHOLD = 0.22;

export function generateDemo() {
  const rnd = mulberry32(20260918);
  const gauss = () => {
    const u = Math.max(1e-9, rnd());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
  };
  const dates = businessDays("2024-01-01", "2026-09-18");
  const N = dates.length;
  const shocks: Shock[] = [
    { at: 85, len: 22, mag: 2.1, cats: { "Energie și mărfuri": 1.4, "Piețe internaționale": 1, "Geopolitică": 0.6 }, crash: -0.075 },
    { at: 222, len: 30, mag: 2.6, cats: { "Geopolitică": 1.5, "Text / NLP": 1.2, "Piața locală BET": 1, "Curs valutar": 0.8 }, crash: -0.11 },
    { at: 318, len: 20, mag: 2.4, cats: { "Piețe internaționale": 1.6, "Macroeconomie": 0.9, "Text / NLP": 0.6 }, crash: -0.09 },
    { at: 430, len: 18, mag: 1.9, cats: { "Dobânzi": 1.5, "Curs valutar": 1.2 }, crash: 0 },
    { at: 525, len: 6, mag: 0.6, cats: { "Macroeconomie": 1 }, crash: -0.07 },
    { at: 610, len: 16, mag: 1.7, cats: { "Energie și mărfuri": 1.2, "Dobânzi": 0.8, "Macroeconomie": 0.7 }, crash: 0 },
    { at: N - 5, len: 30, mag: 1.9, cats: { "Geopolitică": 1.2, "Energie și mărfuri": 1, "Text / NLP": 0.7 }, crash: 0 },
  ];
  const lat: Record<string, number> = Object.fromEntries(CATS.map((c) => [c, 0]));
  const base = -2.45;
  const preds: PredRow[] = [];
  const drivers: DriverRow[] = [];
  const betRet: number[] = [];
  for (let t = 0; t < N; t++) {
    for (const c of CATS) lat[c] = 0.94 * lat[c] + 0.09 * gauss();
    const shockAdd: Record<string, number> = {};
    for (const s of shocks) {
      const k = t - s.at;
      if (k >= -6 && k < s.len) {
        const ramp = k < 0 ? (k + 7) / 7 : Math.exp(-k / (s.len / 1.6));
        for (const [c, w] of Object.entries(s.cats)) shockAdd[c] = (shockAdd[c] ?? 0) + s.mag * w * ramp / 2.2;
      }
    }
    const feat = DEMO_FEATURES.map((f) => {
      const v = (lat[f.category] + (shockAdd[f.category] ?? 0)) * f.w + 0.025 * gauss();
      return { f, logit: v };
    });
    const sumL = feat.reduce((s, x) => s + x.logit, 0);
    const p = 1 / (1 + Math.exp(-(base + sumL)));
    const b = 1 / (1 + Math.exp(-base));
    const scale = Math.abs(sumL) > 1e-6 ? (p - b) / sumL : b * (1 - b);
    preds.push({ date: dates[t], asset: "", p: Math.round(p * 10000) / 10000, thr: DEMO_THRESHOLD });
    for (const x of feat) {
      drivers.push({
        date: dates[t],
        asset: "",
        feature: x.f.feature,
        category: x.f.category,
        contribution: Math.round(x.logit * scale * 100000) / 100000,
        value: Math.round((x.logit / x.f.w) * 100) / 100,
        label: x.f.label,
      });
    }
    let r = 0.00045 + 0.0075 * gauss();
    for (const s of shocks) {
      const k = t - s.at;
      if (s.crash && k >= 6 && k < 16) r += s.crash / 10;
      if (s.crash && k >= 16 && k < 40) r += -s.crash / 40;
    }
    betRet.push(r);
  }
  let bet = 16400;
  const levels = betRet.map((r) => (bet = bet * (1 + r)));
  const outcomes: OutcomeRow[] = dates.map((date, t) => {
    if (t + 20 >= N) return { date, asset: "", y: null, bet: Math.round(levels[t]) };
    let min = Infinity;
    for (let k = 1; k <= 20; k++) min = Math.min(min, levels[t + k]);
    return { date, asset: "", y: min / levels[t] - 1 <= -0.05 ? 1 : 0, bet: Math.round(levels[t]) };
  });
  return { predictions: preds, drivers, outcomes, sensitivity: undefined };
}
