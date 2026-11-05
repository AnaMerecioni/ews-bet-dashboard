import { createLocalStore } from "./localStore";

/**
 * Rezumatul unui notebook Jupyter (.ipynb) cu modelul: citit integral în browser, se păstrează doar rezumatul.
 * Verifică și legătura cu dashboard-ul (exportul celor 4 CSV-uri) și cu extensia (datele externe ale scraper-ului).
 */
export interface NotebookSummary {
  name: string;
  loadedAt: string;
  title: string | null;
  language: string | null;
  cells: { code: number; markdown: number };
  executed: number;
  errors: { cell: number; ename: string; evalue: string }[];
  outline: string[];
  params: { name: string; value: string }[];
  metrics: string[];
  inputs: string[];
  exports: Record<"predictions" | "drivers" | "outcomes" | "sensitivity" | "submission", boolean>;
  extension: { uses: boolean; hits: string[]; category: boolean };
}

export const notebookStore = createLocalStore<NotebookSummary>("ews.notebook.v1");
export const useNotebook = notebookStore.use;

type Cell = { cell_type: string; source: string | string[]; execution_count?: number | null; outputs?: Output[] };
type Output = { output_type: string; text?: string | string[]; data?: Record<string, string | string[]>; ename?: string; evalue?: string };

const join = (s: string | string[] | undefined) => (Array.isArray(s) ? s.join("") : s ?? "");
// codurile ANSI din mesajele de eroare (culori din traceback)
const ESC = String.fromCharCode(27);
const stripAnsi = (s: string) => s.split(ESC).map((part, i) => (i ? part.replace(/^\[[0-9;]*m/, "") : part)).join("");

const EXT_MARKERS = ["ews_external_features", "_augmented.csv", "cyber_crypto_daily", "crypto_daily", "cisa_kev", "CRYPTO_", "CYBER_"];
const METRIC_RE = /(scor|score|\bF2\b|AUC|BSS|Brier|recall|precizi|prag|threshold)/i;

export function analyzeNotebook(text: string, name: string): NotebookSummary {
  let nb: { cells?: Cell[]; metadata?: { kernelspec?: { language?: string; display_name?: string }; language_info?: { name?: string } } };
  try { nb = JSON.parse(text); } catch { throw new Error("Fișierul nu este un notebook valid (JSON)."); }
  if (!Array.isArray(nb.cells)) throw new Error("Fișierul nu conține celule de notebook.");
  const cells = nb.cells;
  const code = cells.filter((c) => c.cell_type === "code");
  const md = cells.filter((c) => c.cell_type === "markdown");
  const codeText = code.map((c) => join(c.source)).join("\n");

  const outline: string[] = [];
  let title: string | null = null;
  for (const c of md) {
    for (const line of join(c.source).split("\n")) {
      const m = line.match(/^(#{1,2})\s+(.+)/);
      if (!m) continue;
      const h = m[2].replace(/<[^>]+>/g, "").replace(/[*_`]/g, "").trim();
      if (!title && m[1] === "#") title = h;
      if (outline.length < 40) outline.push(h);
    }
  }

  const params: NotebookSummary["params"] = [];
  const seen = new Set<string>();
  for (const line of codeText.split("\n")) {
    const m = line.match(/^([A-Z][A-Z0-9_]{2,})\s*=\s*([^#\n]{1,90})/);
    if (!m || seen.has(m[1])) continue;
    const value = m[2].trim();
    if (!value || /^[([{]$/.test(value)) continue;
    seen.add(m[1]);
    params.push({ name: m[1], value: value.length > 60 ? value.slice(0, 57) + "…" : value });
    if (params.length >= 30) break;
  }

  const metrics: string[] = [];
  const errors: NotebookSummary["errors"] = [];
  cells.forEach((c, i) => {
    for (const o of c.outputs ?? []) {
      if (o.output_type === "error") errors.push({ cell: i + 1, ename: o.ename ?? "Eroare", evalue: stripAnsi(o.evalue ?? "").slice(0, 200) });
      const t = o.output_type === "stream" ? join(o.text) : join(o.data?.["text/plain"]);
      for (const line of t.split("\n")) {
        const l = line.trim();
        if (l && l.length < 220 && METRIC_RE.test(l) && /\d/.test(l) && !metrics.includes(l) && metrics.length < 18) metrics.push(l);
      }
    }
  });

  const inputs = new Set<string>();
  // doar căi/nume de fișier (fără spații), nu mesaje print care se termină cu „.csv”
  for (const m of codeText.matchAll(/['"]([^'"\s]+\.(?:csv|parquet|xlsx))['"]/g)) inputs.add(m[1].split("/").pop()!);

  const has = (f: string) => codeText.includes(f);
  const hits = EXT_MARKERS.filter((k) => codeText.includes(k));
  // o categorie pentru variabilele extensiei: în REGULI_CATEGORIE / CATEGORII apare crypto sau cyber
  const catBlock = [...codeText.matchAll(/(REGULI_CATEGORIE|CATEGORII)\s*=\s*\[[\s\S]*?\n\]/g)].map((m) => m[0]).join("\n")
    + "\n" + (codeText.match(/CATEGORII\s*=\s*\[[^\]]*\]/)?.[0] ?? "");
  const category = /crypto|cyber/i.test(catBlock);

  return {
    name,
    loadedAt: new Date().toISOString(),
    title,
    language: nb.metadata?.language_info?.name ?? nb.metadata?.kernelspec?.language ?? null,
    cells: { code: code.length, markdown: md.length },
    executed: code.filter((c) => c.execution_count != null).length,
    errors,
    outline,
    params,
    metrics,
    inputs: [...inputs].slice(0, 25),
    exports: {
      // submission.csv are exact formatul predictions.csv (Date, stress_probability_20d, stress_threshold)
      predictions: has("predictions.csv") || has("submission.csv"),
      drivers: has("drivers.csv"),
      outcomes: has("outcomes.csv"),
      sensitivity: has("sensitivity.csv"),
      submission: has("submission.csv"),
    },
    extension: { uses: hits.length > 0, hits, category },
  };
}
