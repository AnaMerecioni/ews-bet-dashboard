import type { Alert, Day, DriverRow, Episode, Level } from "./types";

export function levelOf(p: number, alert: number, high: number): Level {
  if (p >= high) return "high";
  if (p >= alert) return "moderate";
  return "low";
}

/** Alert = probability >= alert threshold for `confirm` consecutive trading days.
 *  Start = FIRST day above threshold, so duration is never shorter than `confirm`. Outcome is set by pairAlertsEpisodes. */
export function buildAlerts(series: Day[], alert: number, high: number, confirm: number): Alert[] {
  const out: Alert[] = [];
  let i = 0;
  while (i < series.length) {
    if (series[i].p < alert) { i++; continue; }
    let j = i;
    while (j + 1 < series.length && series[j + 1].p >= alert) j++;
    if (j - i + 1 >= confirm) {
      let peak = -1, peakIdx = i;
      for (let k = i; k <= j; k++) if (series[k].p > peak) { peak = series[k].p; peakIdx = k; }
      out.push({
        id: series[i].date, start: series[i].date, end: series[j].date, startIdx: i, endIdx: j, firstAboveIdx: i,
        duration: j - i + 1, peak, peakDate: series[peakIdx].date, level: levelOf(peak, alert, high),
        active: j === series.length - 1, confirmed: null, warningDays: null, episodeOnset: null,
      });
    }
    i = j + 1;
  }
  return out;
}

/** Actual stress episodes from label runs; onset = first day BET is ≥5% below run start (or run end + 1). Unpaired. */
export function buildEpisodes(series: Day[]): Episode[] {
  const eps: Episode[] = [];
  let i = 0;
  while (i < series.length) {
    if (series[i].y !== 1) { i++; continue; }
    let j = i;
    // merge label runs separated by short calm gaps (≤10 trading days) into one episode
    for (;;) {
      while (j + 1 < series.length && series[j + 1].y === 1) j++;
      let k = j + 1;
      while (k < series.length && k - j <= 10 && series[k].y !== 1) k++;
      if (k < series.length && k - j <= 10 && series[k].y === 1) j = k; else break;
    }
    let onsetIdx = Math.min(j + 1, series.length - 1);
    const b0 = series[i].bet;
    if (b0 !== undefined) {
      for (let k = i + 1; k <= Math.min(series.length - 1, j + 20); k++) {
        const b = series[k].bet;
        if (b !== undefined && b <= b0 * 0.95) { onsetIdx = k; break; }
      }
    }
    eps.push({ onset: series[onsetIdx].date, onsetIdx, labelStart: series[i].date, labelEnd: series[j].date, warned: false, warningDays: null, alertId: null });
    i = j + 1;
  }
  return eps;
}

const dayDiff = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

/** Single source of truth for alert outcome + episode pairing (used by Alerte and Backtest).
 *  Confirmed: an episode onset falls in [alert start, start + windowDays calendar days], or the alert overlaps days with
 *  stress_event_20d = 1. Ongoing alerts are "în desfășurare" (null). Avans = onset − start (calendar days), confirmed only.
 *  An episode is "anticipat" iff paired with a confirmed alert. */
export function pairAlertsEpisodes(series: Day[], rawAlerts: Alert[], rawEpisodes: Episode[], windowDays = 30) {
  const episodes = rawEpisodes.map((e) => ({ ...e, warned: false, warningDays: null as number | null, alertId: null as string | null }));
  const hasY = series.some((d) => d.y !== null);
  const alerts = rawAlerts.map((a) => {
    const r: Alert = { ...a, confirmed: null, warningDays: null, episodeOnset: null };
    if (!hasY || a.active) return r;
    const inWindow = episodes.filter((e) => { const d = dayDiff(a.start, e.onset); return d >= 0 && d <= windowDays; });
    const overlapEp = episodes.find((e) => e.labelStart <= a.end && e.labelEnd >= a.start);
    const overlapY = series.slice(a.startIdx, a.endIdx + 1).some((d) => d.y === 1);
    const ep = inWindow[0] ?? overlapEp;
    if (ep || overlapY) {
      r.confirmed = true;
      if (ep) {
        r.episodeOnset = ep.onset;
        r.warningDays = Math.max(0, dayDiff(a.start, ep.onset));
      }
    } else {
      const known = series.slice(a.startIdx, a.endIdx + 1).some((d) => d.y !== null);
      r.confirmed = known ? false : null;
    }
    return r;
  });
  for (const a of alerts) {
    if (a.confirmed !== true || !a.episodeOnset) continue;
    const e = episodes.find((x) => x.onset === a.episodeOnset);
    if (e && !e.warned) { e.warned = true; e.alertId = a.id; e.warningDays = a.warningDays; }
  }
  return { alerts, episodes };
}

export function median(xs: number[]) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function metrics(series: Day[], alert: number) {
  const rows = series.filter((d) => d.y !== null) as (Day & { y: number })[];
  let tp = 0, fp = 0, fn = 0, tn = 0, brier = 0;
  for (const r of rows) {
    const pred = r.p >= alert;
    if (pred && r.y === 1) tp++;
    else if (pred) fp++;
    else if (r.y === 1) fn++;
    else tn++;
    brier += (r.p - r.y) ** 2;
  }
  const n = rows.length;
  const base = n ? rows.filter((r) => r.y === 1).length / n : 0;
  brier = n ? brier / n : 0;
  const brierRef = base * (1 - base);
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  const f2 = precision + recall ? (5 * precision * recall) / (4 * precision + recall) : 0;
  return { n, tp, fp, fn, tn, base, brier, bss: brierRef ? 1 - brier / brierRef : 0, precision, recall, f2, auc: auc(rows) };
}

export function auc(rows: { p: number; y: number }[]) {
  const sorted = [...rows].sort((a, b) => a.p - b.p);
  const ranks = new Array(sorted.length);
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1].p === sorted[i].p) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[k] = r;
    i = j + 1;
  }
  let pos = 0, sumR = 0;
  sorted.forEach((r, i) => { if (r.y === 1) { pos++; sumR += ranks[i]; } });
  const neg = sorted.length - pos;
  if (!pos || !neg) return 0.5;
  return (sumR - (pos * (pos + 1)) / 2) / (pos * neg);
}

export function calibration(series: Day[], bins = 10) {
  const rows = series.filter((d) => d.y !== null).sort((a, b) => a.p - b.p);
  const out: { bin: number; pred: number; obs: number; n: number }[] = [];
  if (!rows.length) return out;
  const size = Math.ceil(rows.length / bins);
  for (let b = 0; b < bins; b++) {
    const chunk = rows.slice(b * size, (b + 1) * size);
    if (!chunk.length) continue;
    out.push({
      bin: b + 1,
      pred: chunk.reduce((s, r) => s + r.p, 0) / chunk.length,
      obs: chunk.reduce((s, r) => s + (r.y as number), 0) / chunk.length,
      n: chunk.length,
    });
  }
  return out;
}

export function byCategory(rows: DriverRow[]) {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.category, (m.get(r.category) ?? 0) + r.contribution);
  return [...m.entries()].map(([category, value]) => ({ category, value })).sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
}

export function topDrivers(rows: DriverRow[], n = 5) {
  return [...rows].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)).slice(0, n);
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const logit = (p: number) => Math.log(Math.max(1e-6, p) / Math.max(1e-6, 1 - p));

export const WHATIF_MIN = 0.005;
export const WHATIF_MAX = 0.995;

/** Recompute probability with category contributions scaled by factors (approximation).
 *  Clamped to [0,5%; 99,5%] so an approximate scenario never claims certainty (0% / 100%). */
export function whatIf(p: number, rows: DriverRow[], factors: Record<string, number>, unit: "pp" | "logit") {
  const sum = rows.reduce((s, r) => s + r.contribution, 0);
  const scaled = rows.reduce((s, r) => s + r.contribution * (factors[r.category] ?? 1), 0);
  const raw = unit === "pp" ? p - sum + scaled : sigmoid(logit(p) - sum + scaled);
  return Math.min(WHATIF_MAX, Math.max(WHATIF_MIN, raw));
}

/** Presentation scenario: on high-probability days (p ≥ 60%) show the top category falling 50%, otherwise rising 50%. */
export const scenarioFactor = (p: number) => (p >= 0.6 ? 0.5 : 1.5);

export function baseValue(p: number, rows: DriverRow[], unit: "pp" | "logit") {
  const sum = rows.reduce((s, r) => s + r.contribution, 0);
  return unit === "pp" ? p - sum : logit(p) - sum;
}

export function levelRates(series: Day[], alert: number, high: number) {
  const rows = series.filter((d) => d.y !== null);
  const calc = (f: (p: number) => boolean) => {
    const r = rows.filter((d) => f(d.p));
    return { n: r.length, rate: r.length ? r.filter((d) => d.y === 1).length / r.length : 0 };
  };
  return {
    base: calc(() => true),
    low: calc((p) => p < alert),
    moderate: calc((p) => p >= alert && p < high),
    high: calc((p) => p >= high),
  };
}
