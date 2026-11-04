import Papa from "papaparse";
import type { DriverRow, FileKind, OutcomeRow, PredRow, SensRow } from "./types";

export function parseDate(s: string): string | null {
  const t = (s ?? "").trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  let y: number, mo: number, d: number;
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else {
    m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return null;
    mo = +m[1]; d = +m[2]; y = +m[3];
  }
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

const toNum = (v: unknown) => {
  if (v === undefined || v === null || String(v).trim() === "") return NaN;
  return Number(String(v).trim().replace(",", "."));
};

export const REQUIRED: Record<FileKind, string[]> = {
  predictions: ["Date", "stress_probability_20d", "stress_threshold"],
  drivers: ["Date", "feature", "category", "contribution"],
  outcomes: ["Date", "stress_event_20d"],
  sensitivity: ["feature", "shift_sigma", "probability"],
};

export const TEMPLATES: Record<FileKind, string> = {
  predictions: "Date,stress_probability_20d,stress_threshold\n2026-09-16,0.184,0.22\n2026-09-17,0.231,0.22\n2026-09-18,0.247,0.22\n",
  drivers: "Date,feature,category,contribution,value,label\n2026-09-18,vix_level,Piețe internaționale,0.031,22.4,Indicele VIX\n2026-09-18,eurron_vol,Curs valutar,-0.008,0.4,Volatilitate EUR/RON\n",
  outcomes: "Date,stress_event_20d,BET\n2026-08-20,0,18450\n2026-08-21,1,18390\n",
  sensitivity: "feature,shift_sigma,probability\nvix_level,-2,0.12\nvix_level,0,0.18\nvix_level,2,0.31\n",
};

export const FILE_LABELS: Record<FileKind, { title: string; desc: string; required: boolean }> = {
  predictions: { title: "Predicții (predictions.csv)", desc: "Probabilitatea zilnică de stres și pragul de alertă — formatul Kaggle.", required: true },
  drivers: { title: "Factori SHAP (drivers.csv)", desc: "Contribuția fiecărei variabile pentru fiecare zi, cu categoria ei.", required: false },
  outcomes: { title: "Rezultate reale (outcomes.csv)", desc: "Etichetele reale de stres și, opțional, nivelul BET. Activează Backtest.", required: false },
  sensitivity: { title: "Sensibilitate (sensitivity.csv)", desc: "Curbe „ce-ar fi dacă” calculate de model pentru fiecare variabilă.", required: false },
};

export interface ParseResult {
  rows: unknown[];
  errors: string[];
  warnings: string[];
  preview: Record<string, string>[];
  columns: string[];
}

export function parseCsv(kind: FileKind, text: string): ParseResult {
  const res = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim() });
  const columns = res.meta.fields ?? [];
  const lower = new Map(columns.map((c) => [c.toLowerCase(), c]));
  const col = (name: string) => lower.get(name.toLowerCase());
  const errors: string[] = [];
  const warnings: string[] = [];
  const missing = REQUIRED[kind].filter((c) => !col(c));
  const preview = res.data.slice(0, 5);
  if (missing.length) {
    errors.push(`Lipsesc coloanele obligatorii: ${missing.join(", ")}. Coloane găsite: ${columns.join(", ") || "niciuna"}.`);
    return { rows: [], errors, warnings, preview, columns };
  }
  if (!res.data.length) errors.push("Fișierul nu conține rânduri de date.");
  const get = (r: Record<string, string>, c: string) => r[col(c) ?? c];
  const badDates: number[] = [];
  const badNums: number[] = [];
  const outOfRange: number[] = [];
  const rows: unknown[] = [];
  const seen = new Set<string>();
  const dups: string[] = [];
  res.data.forEach((r, i) => {
    const line = i + 2;
    const date = kind === "sensitivity" ? "x" : parseDate(get(r, "Date"));
    if (!date) { badDates.push(line); return; }
    const asset = (col("asset") ? get(r, "asset") : "")?.trim() ?? "";
    if (kind === "predictions") {
      const p = toNum(get(r, "stress_probability_20d"));
      const thr = toNum(get(r, "stress_threshold"));
      const high = col("high_threshold") ? toNum(get(r, "high_threshold")) : NaN;
      if (isNaN(p) || isNaN(thr)) { badNums.push(line); return; }
      if (p < 0 || p > 1 || thr < 0 || thr > 1) { outOfRange.push(line); return; }
      const key = asset + "|" + date;
      if (seen.has(key)) dups.push(date); else seen.add(key);
      rows.push({ date, asset, p, thr, high: isNaN(high) ? undefined : high } satisfies PredRow);
    } else if (kind === "drivers") {
      const c = toNum(get(r, "contribution"));
      if (isNaN(c)) { badNums.push(line); return; }
      const v = col("value") ? toNum(get(r, "value")) : NaN;
      rows.push({
        date, asset, feature: get(r, "feature").trim(), category: get(r, "category").trim() || "Altele", contribution: c,
        value: isNaN(v) ? undefined : v, label: col("label") ? get(r, "label")?.trim() || undefined : undefined,
      } satisfies DriverRow);
    } else if (kind === "outcomes") {
      const raw = get(r, "stress_event_20d");
      const y = raw === undefined || String(raw).trim() === "" ? null : toNum(raw);
      if (y !== null && y !== 0 && y !== 1) { badNums.push(line); return; }
      const b = col("BET") ? toNum(get(r, "BET")) : NaN;
      const key = asset + "|" + date;
      if (seen.has(key)) dups.push(date); else seen.add(key);
      rows.push({ date, asset, y, bet: isNaN(b) ? undefined : b } satisfies OutcomeRow);
    } else {
      const shift = toNum(get(r, "shift_sigma"));
      const p = toNum(get(r, "probability"));
      if (isNaN(shift) || isNaN(p)) { badNums.push(line); return; }
      if (p < 0 || p > 1) { outOfRange.push(line); return; }
      rows.push({ feature: get(r, "feature").trim(), shift, p } satisfies SensRow);
    }
  });
  const lines = (a: number[]) => a.slice(0, 5).join(", ") + (a.length > 5 ? ` și încă ${a.length - 5}` : "");
  if (badDates.length) errors.push(`Date invalide pe rândurile ${lines(badDates)}. Folosește formatul AAAA-LL-ZZ sau L/Z/AAAA.`);
  if (badNums.length) errors.push(`Valori numerice invalide pe rândurile ${lines(badNums)}.`);
  if (outOfRange.length) errors.push(`Probabilități în afara intervalului 0–1 pe rândurile ${lines(outOfRange)}.`);
  if (dups.length) errors.push(`Date duplicate: ${dups.slice(0, 5).join(", ")}${dups.length > 5 ? "…" : ""}. Fiecare zi trebuie să apară o singură dată.`);
  if (kind === "predictions" && rows.length) {
    const thrs = new Set((rows as PredRow[]).map((r) => r.asset + r.thr));
    const assets = new Set((rows as PredRow[]).map((r) => r.asset));
    if (thrs.size > assets.size) warnings.push("Pragul stress_threshold nu este constant; se folosește valoarea din primul rând.");
  }
  if (res.errors.length) warnings.push(`${res.errors.length} rânduri au avut probleme de format CSV.`);
  return { rows: errors.length ? [] : rows, errors, warnings, preview, columns };
}
