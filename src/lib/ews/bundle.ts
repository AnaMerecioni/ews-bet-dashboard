import Papa from "papaparse";
import { parseCsv, parseDate } from "./parse";
import { analyzeNotebook, type NotebookSummary } from "./notebook";
import { isExtensionCsv } from "./extension";
import type { FileKind, PredRow } from "./types";

/**
 * Încărcarea „notebook + output”: primește tot ce a produs o rulare Kaggle (notebook-ul .ipynb, CSV-urile din Output
 * sau arhiva .zip) și construiește setul complet de date pentru dashboard, fără ca utilizatorul să aleagă fișier cu fișier.
 *
 * Reguli:
 * - predicțiile vin din predictions.csv (are și istoricul OOF) sau, dacă lipsește, din submission.csv;
 * - risk_monitoring.csv (Date, stress_probability_20d, alert, risk_level) dă pragul „ridicat” (prima probabilitate
 *   clasificată „Ridicat”) și, dacă lipsește submisia, și predicțiile (pragul de alertă = cea mai mică probabilitate cu alert = 1);
 * - drivers.csv, outcomes.csv, sensitivity.csv sunt folosite dacă există (le scrie celula de export din notebook).
 */

export type InputFile = { name: string; text: string };
export type Role = FileKind | "submission" | "risk_monitoring" | "notebook" | "extension" | "ignored";

export interface BundleReport { name: string; role: Role; ok: boolean; detail: string }
export interface Bundle {
  data: Partial<Record<FileKind, unknown[]>>;
  names: Partial<Record<FileKind, string>>;
  notebook: NotebookSummary | null;
  extension: InputFile[];
  report: BundleReport[];
  highThreshold: number | null;
}

export const ROLE_LABEL: Record<Role, string> = {
  predictions: "Predicții (cu istoric)",
  submission: "Predicții (submisia Kaggle)",
  risk_monitoring: "Niveluri de risc",
  drivers: "Factori SHAP",
  outcomes: "Rezultate reale",
  sensitivity: "Sensibilitate",
  notebook: "Notebook",
  extension: "Date externe (extensie)",
  ignored: "Nefolosit",
};

const TEXT_EXT = /\.(csv|tsv|ipynb)$/i;
const base = (p: string) => p.split("/").pop() ?? p;

/** Despachetează arhivele .zip și citește fișierele text. */
export async function readInputs(files: File[]): Promise<{ inputs: InputFile[]; skipped: string[] }> {
  const inputs: InputFile[] = [];
  const skipped: string[] = [];
  for (const f of files) {
    if (/\.zip$/i.test(f.name)) {
      const { default: JSZip } = await import("jszip");
      const zip = await JSZip.loadAsync(f);
      let n = 0;
      for (const e of Object.values(zip.files)) {
        if (e.dir || /(^|\/)(__MACOSX|\.)/.test(e.name) || !TEXT_EXT.test(e.name)) continue;
        inputs.push({ name: base(e.name), text: await e.async("string") });
        n++;
      }
      if (!n) skipped.push(f.name);
    } else if (TEXT_EXT.test(f.name)) {
      inputs.push({ name: f.name, text: await f.text() });
    } else skipped.push(f.name);
  }
  return { inputs, skipped };
}

const headerOf = (text: string) => {
  const first = text.replace(/^﻿/, "").split(/\r?\n/, 1)[0] ?? "";
  return first.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
};

export function roleOf(name: string, text: string): Role {
  if (/\.ipynb$/i.test(name)) return "notebook";
  const cols = headerOf(text);
  const l = new Set(cols.map((c) => c.toLowerCase()));
  if (l.has("stress_probability_20d")) {
    if (l.has("stress_threshold")) return /^predictions/i.test(name) ? "predictions" : "submission";
    return "risk_monitoring";
  }
  if (l.has("stress_event_20d") && !l.has("feature")) {
    // train.csv sau un train îmbogățit au și stress_event_20d, dar au zeci de coloane: nu sunt outcomes
    if (isExtensionCsv(cols)) return "extension";
    return cols.length > 6 ? "ignored" : "outcomes";
  }
  if (l.has("feature") && l.has("contribution")) return "drivers";
  if (l.has("shift_sigma")) return "sensitivity";
  if (isExtensionCsv(cols)) return "extension";
  return "ignored";
}

const num = (v: unknown) => {
  const t = String(v ?? "").trim();
  return t ? Number(t.replace(",", ".")) : NaN;
};

/** risk_monitoring.csv → probabilități, alertă, nivel de risc. */
function parseRiskMonitoring(text: string) {
  const res = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim() });
  const cols = res.meta.fields ?? [];
  const col = (n: string) => cols.find((c) => c.toLowerCase() === n.toLowerCase());
  const cDate = col("Date"), cP = col("stress_probability_20d"), cA = col("alert"), cR = col("risk_level");
  const rows: { date: string; p: number; alert: boolean | null; risk: string | null }[] = [];
  if (!cDate || !cP) return rows;
  for (const r of res.data) {
    const date = parseDate(r[cDate]);
    const p = num(r[cP]);
    if (!date || !Number.isFinite(p)) continue;
    const a = cA ? String(r[cA] ?? "").trim().toLowerCase() : "";
    rows.push({ date, p, alert: cA ? ["1", "1.0", "true", "da", "yes"].includes(a) : null, risk: cR ? (String(r[cR] ?? "").trim() || null) : null });
  }
  return rows.sort((a, b) => (a.date < b.date ? -1 : 1));
}

export function buildBundle(inputs: InputFile[]): Bundle {
  const report: BundleReport[] = [];
  const data: Bundle["data"] = {};
  const names: Bundle["names"] = {};
  const extension: InputFile[] = [];
  let notebook: NotebookSummary | null = null;
  const byRole = new Map<Role, InputFile[]>();
  for (const f of inputs) {
    const role = roleOf(f.name, f.text);
    byRole.set(role, [...(byRole.get(role) ?? []), f]);
  }
  const take = (role: Role) => byRole.get(role) ?? [];

  for (const f of take("notebook")) {
    try {
      notebook = analyzeNotebook(f.text, f.name);
      report.push({ name: f.name, role: "notebook", ok: true, detail: `${notebook.cells.code} celule de cod, ${notebook.executed} rulate` });
    } catch (e) { report.push({ name: f.name, role: "notebook", ok: false, detail: e instanceof Error ? e.message : String(e) }); }
  }

  // predicții: predictions.csv (istoric + test) are prioritate față de submission.csv (doar test)
  const predCandidates = [...take("predictions"), ...take("submission")];
  for (const f of predCandidates) {
    const role = roleOf(f.name, f.text);
    if (data.predictions) { report.push({ name: f.name, role, ok: true, detail: `nu mai e nevoie: predicțiile vin din ${names.predictions}` }); continue; }
    const r = parseCsv("predictions", f.text);
    if (r.errors.length) { report.push({ name: f.name, role, ok: false, detail: r.errors[0] }); continue; }
    data.predictions = r.rows;
    names.predictions = f.name;
    const rows = r.rows as PredRow[];
    report.push({ name: f.name, role, ok: true, detail: `${rows.length} zile, ${rows[0].date} – ${rows[rows.length - 1].date}` });
  }

  let highThreshold: number | null = null;
  for (const f of take("risk_monitoring")) {
    const rm = parseRiskMonitoring(f.text);
    if (!rm.length) { report.push({ name: f.name, role: "risk_monitoring", ok: false, detail: "nu are coloanele Date și stress_probability_20d" }); continue; }
    const ridicat = rm.filter((r) => r.risk && /ridicat|high/i.test(r.risk)).map((r) => r.p);
    if (ridicat.length) highThreshold = Math.min(...ridicat);
    if (!data.predictions) {
      const alerted = rm.filter((r) => r.alert).map((r) => r.p);
      const thr = alerted.length ? Math.min(...alerted) : 0.5;
      data.predictions = rm.map((r) => ({ date: r.date, asset: "", p: r.p, thr } satisfies PredRow));
      names.predictions = f.name;
      report.push({ name: f.name, role: "risk_monitoring", ok: true, detail: `${rm.length} zile; prag de alertă dedus din coloana alert` });
    } else {
      report.push({ name: f.name, role: "risk_monitoring", ok: true, detail: highThreshold != null ? "pragul pentru risc ridicat" : "fără nivel „Ridicat”" });
    }
  }
  if (highThreshold != null && data.predictions) {
    const thr = (data.predictions as PredRow[])[0].thr;
    if (highThreshold > thr) data.predictions = (data.predictions as PredRow[]).map((r) => ({ ...r, high: highThreshold! }));
    else highThreshold = null;
  }

  for (const kind of ["drivers", "outcomes", "sensitivity"] as const) {
    for (const f of take(kind)) {
      if (data[kind]) { report.push({ name: f.name, role: kind, ok: true, detail: "dublură, ignorat" }); continue; }
      const r = parseCsv(kind, f.text);
      if (r.errors.length) { report.push({ name: f.name, role: kind, ok: false, detail: r.errors[0] }); continue; }
      data[kind] = r.rows;
      names[kind] = f.name;
      report.push({ name: f.name, role: kind, ok: true, detail: `${r.rows.length} rânduri` });
    }
  }

  for (const f of take("extension")) { extension.push(f); report.push({ name: f.name, role: "extension", ok: true, detail: "date externe pentru extensie" }); }
  for (const f of take("ignored")) report.push({ name: f.name, role: "ignored", ok: false, detail: "coloane necunoscute, nu e un output al notebook-ului" });

  return { data, names, notebook, extension, report, highThreshold };
}
