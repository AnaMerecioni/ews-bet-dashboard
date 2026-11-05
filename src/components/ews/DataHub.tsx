import { useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Copy, Download, FileSpreadsheet, FileUp, Loader2, NotebookPen, Play, Puzzle, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { useEws } from "@/lib/ews/store";
import { parseCsv } from "@/lib/ews/parse";
import type { FileKind } from "@/lib/ews/types";
import { fmtDate, num } from "@/lib/ews/format";
import {
  ALL_SOURCE_IDS, BASE_SOURCES, collectLive, combineDataSprint, coverage, DEFAULT_FEATURE_OPTIONS, extensionStore, featureTableToCsv, isExtensionCsv, mergeRows,
  parseDataSprint, parseExtensionCsv, qualityFlags, today, TRAIN_START, useExtension, type DsFile, type FeatureOptions, type FeatureTable, type SourceState,
} from "@/lib/ews/extension";
import { COMBINED_FILE, DATASPRINT_COLUMNS, DATASPRINT_PREFIXES, EXT_CATEGORIES, metadataCsv, notebookSnippet, SOURCES, type ColMeta } from "@/lib/ews/sources";
import { analyzeNotebook, notebookStore, useNotebook } from "@/lib/ews/notebook";
import { Card } from "./ui";
import { cn } from "@/lib/utils";

const headerOf = (text: string) => {
  const first = text.slice(0, Math.max(0, text.indexOf("\n")) || text.length).replace(/^﻿/, "");
  return first.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
};

/** Ce fel de fișier e un CSV, după coloane (un fișier poate fi și rezultat, și extensie — ex. train_augmented.csv). */
function detectKinds(cols: string[]): (FileKind | "extension")[] {
  const l = new Set(cols.map((c) => c.toLowerCase()));
  const out: (FileKind | "extension")[] = [];
  if (l.has("stress_probability_20d")) out.push("predictions");
  else if (l.has("stress_event_20d")) out.push("outcomes");
  if (l.has("feature") && l.has("contribution")) out.push("drivers");
  if (l.has("shift_sigma")) out.push("sensitivity");
  if (isExtensionCsv(cols)) out.push("extension");
  return out;
}

const KIND_LABEL: Record<FileKind | "extension" | "notebook", string> = {
  predictions: "Predicții", drivers: "Factori SHAP", outcomes: "Rezultate reale", sensitivity: "Sensibilitate", extension: "Extensie (date externe)", notebook: "Notebook",
};

function SectionHead({ eyebrow, title, accent, children }: { eyebrow: string; title: string; accent: string; children?: ReactNode }) {
  return (
    <div className="mb-5">
      <p className="eyebrow mb-2">{eyebrow}</p>
      <h2 className="font-display text-2xl font-bold tracking-tight md:text-3xl">{title} <span className="text-gradient">{accent}</span></h2>
      {children && <div className="mt-2 max-w-3xl text-sm text-muted-foreground">{children}</div>}
    </div>
  );
}

function Drop({ accept, multiple, label, hint, onFiles, icon: Icon = Upload }: {
  accept: string; multiple?: boolean; label: string; hint: string; onFiles: (f: File[]) => void; icon?: typeof Upload;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); if (e.dataTransfer.files.length) onFiles(Array.from(e.dataTransfer.files)); }}
        className={cn("flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed p-8 text-sm transition-colors",
          over ? "border-primary bg-primary/10" : "hover:border-primary/60 hover:bg-muted/60")}
      >
        <Icon aria-hidden className="size-7 text-primary" />
        <span className="font-semibold">{label}</span>
        <span className="text-muted-foreground">{hint}</span>
      </button>
      <input ref={input} type="file" accept={accept} multiple={multiple} className="sr-only" tabIndex={-1} aria-hidden
        onChange={(e) => { if (e.target.files?.length) onFiles(Array.from(e.target.files)); e.target.value = ""; }} />
    </>
  );
}

function Check({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      {ok ? <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-risk-low" /> : <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-risk-moderate" />}
      <span className="min-w-0 [overflow-wrap:anywhere]"><span className="sr-only">{ok ? "În regulă: " : "Atenție: "}</span>{children}</span>
    </li>
  );
}

// ------------------------------------------------------------------------------------------- 1. Rezultatele din Kaggle
export function KaggleBundle() {
  const ews = useEws();
  const [res, setRes] = useState<{ name: string; kinds: string[]; ok: boolean; detail: string }[]>([]);

  const handle = async (files: File[]) => {
    const out: typeof res = [];
    for (const f of files) {
      const text = await f.text();
      if (f.name.toLowerCase().endsWith(".ipynb")) {
        try {
          notebookStore.set(analyzeNotebook(text, f.name));
          out.push({ name: f.name, kinds: [KIND_LABEL.notebook], ok: true, detail: "rezumatul e în secțiunea Notebook" });
        } catch (e) { out.push({ name: f.name, kinds: [KIND_LABEL.notebook], ok: false, detail: e instanceof Error ? e.message : String(e) }); }
        continue;
      }
      const kinds = detectKinds(headerOf(text));
      if (!kinds.length) { out.push({ name: f.name, kinds: [], ok: false, detail: "Coloane necunoscute — nu e un export al notebook-ului sau al extensiei." }); continue; }
      const notes: string[] = [];
      let ok = true;
      for (const k of kinds) {
        if (k === "extension") {
          const r = parseExtensionCsv(text);
          if (r.error) { ok = false; notes.push(r.error); continue; }
          const prev = extensionStore.get();
          extensionStore.set({
            rows: mergeRows(prev?.rows ?? [], r.rows), origin: "csv",
            sources: [...new Set([...(prev?.sources ?? []), f.name])], updatedAt: new Date().toISOString(),
          });
          notes.push(`${num(r.rows.length)} zile de date externe`);
        } else {
          const r = parseCsv(k, text);
          if (r.errors.length) { ok = false; notes.push(r.errors[0]); continue; }
          ews.setFile(k, r.rows, f.name);
          notes.push(`${num(r.rows.length)} rânduri`);
        }
      }
      out.push({ name: f.name, kinds: kinds.map((k) => KIND_LABEL[k]), ok, detail: notes.join(" · ") });
    }
    setRes(out);
    const good = out.filter((r) => r.ok).length;
    if (good) toast.success(`${good} din ${out.length} fișiere încărcate.`);
    if (good < out.length) toast.error("Unele fișiere nu au putut fi încărcate. Vezi detaliile.");
  };

  return (
    <section aria-label="Rezultatele din Kaggle">
      <SectionHead eyebrow="06.1 — Kaggle" title="Rezultatele" accent="din Kaggle">
        Din Kaggle: deschide versiunea rulată a notebook-ului → <strong>Output</strong> → descarcă fișierele și trage-le aici <strong>toate odată</strong>
        (<code>predictions.csv</code> sau <code>submission.csv</code>, <code>drivers.csv</code>, <code>outcomes.csv</code>, <code>sensitivity.csv</code>,
        chiar și notebook-ul sau CSV-urile extensiei). Fiecare fișier e recunoscut după coloane și ajunge unde trebuie.
      </SectionHead>
      <Card>
        <Drop accept=".csv,text/csv,.ipynb" multiple icon={FileUp} label="Trage aici fișierele din Kaggle sau alege-le"
          hint="CSV-uri cu rezultate, notebook (.ipynb), CSV-urile extensiei" onFiles={(f) => void handle(f)} />
        {res.length > 0 && (
          <ul className="mt-4 divide-y" aria-live="polite">
            {res.map((r) => (
              <li key={r.name} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm">
                {r.ok ? <CheckCircle2 aria-hidden className="size-4 text-risk-low" /> : <AlertTriangle aria-hidden className="size-4 text-risk-moderate" />}
                <span className="font-medium">{r.name}</span>
                {r.kinds.map((k) => <span key={k} className="rounded-full bg-primary/15 px-2 py-0.5 text-xs text-primary">{k}</span>)}
                <span className="text-muted-foreground">{r.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}

// ------------------------------------------------------------------------------------------- 2. Notebook-ul modelului
export function NotebookSection() {
  const nb = useNotebook();
  const handle = async (files: File[]) => {
    const f = files[0];
    try {
      notebookStore.set(analyzeNotebook(await f.text(), f.name));
      toast.success(`${f.name}: notebook analizat.`);
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
  };
  const missing = nb ? (["predictions", "drivers", "outcomes", "sensitivity"] as const).filter((k) => !nb.exports[k]) : [];
  return (
    <section aria-label="Notebook-ul modelului">
      <SectionHead eyebrow="06.2 — Model" title="Notebook-ul" accent="cu modelul">
        Încarcă fișierul <code>.ipynb</code> (din Kaggle: <strong>File → Download notebook</strong>, după „Save &amp; Run All”). Se citește doar în browser;
        păstrăm rezumatul: parametrii, metricile, erorile și dacă exportă tot ce are nevoie dashboard-ul.
      </SectionHead>
      <div className="grid gap-6 lg:grid-cols-3 [&>*]:min-w-0">
        <Card className="lg:col-span-1">
          <Drop accept=".ipynb,application/x-ipynb+json,application/json" icon={NotebookPen} label={nb ? "Înlocuiește notebook-ul" : "Încarcă notebook-ul (.ipynb)"}
            hint="un singur fișier" onFiles={(f) => void handle(f)} />
          {nb && (
            <div className="mt-4 space-y-1 text-sm">
              <p className="break-words font-semibold">{(nb.title ?? nb.name).replace(/<[^>]+>/g, "")}</p>
              <p className="text-muted-foreground">{nb.name} · {nb.language ?? "python"} · {num(nb.cells.code)} celule de cod, {num(nb.cells.markdown)} de text</p>
              <p className="text-muted-foreground">Încărcat {fmtDate(nb.loadedAt.slice(0, 10))}</p>
              <button onClick={() => notebookStore.set(null)} className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-md px-2 text-sm text-destructive hover:bg-muted">
                <Trash2 aria-hidden className="size-4" /> Elimină
              </button>
            </div>
          )}
        </Card>
        {nb ? (
          <Card className="lg:col-span-2" aria-labelledby="nb-chk">
            <h3 id="nb-chk" className="font-display text-lg font-semibold">Verificări</h3>
            <ul className="mt-3 space-y-2">
              <Check ok={nb.executed > 0 && nb.errors.length === 0}>
                {nb.executed === 0 ? "Notebook nerulat: nu are output-uri. Rulează „Save & Run All” în Kaggle și descarcă din nou."
                  : `${num(nb.executed)} din ${num(nb.cells.code)} celule de cod au rulat${nb.errors.length ? `, dar ${nb.errors.length} au eroare` : ", fără erori"}.`}
              </Check>
              {nb.errors.slice(0, 4).map((e) => <Check key={e.cell} ok={false}>Celula {e.cell}: <code>{e.ename}</code> {e.evalue}</Check>)}
              <Check ok={missing.length === 0}>
                {missing.length === 0 ? "Exportă toate cele 4 fișiere pentru dashboard (predictions, drivers, outcomes, sensitivity)."
                  : <>Nu găsesc exportul pentru: {missing.map((m) => <code key={m} className="mr-1">{m}.csv</code>)}— secțiunile respective vor rămâne goale.</>}
              </Check>
              <Check ok={nb.extension.uses}>
                {nb.extension.uses ? <>Folosește datele extensiei ({nb.extension.hits.map((h) => <code key={h} className="mr-1">{h}</code>)}).</>
                  : <>Nu folosește datele extensiei. Pentru crypto/cyber: încarcă <code>train_augmented.csv</code> / <code>test_augmented.csv</code> sau <code>ews_external_features.csv</code>.</>}
              </Check>
              {nb.extension.uses && (
                <Check ok={nb.extension.category}>
                  {nb.extension.category ? "Variabilele extensiei au o categorie proprie (crypto/cyber) în descompunerea pe categorii."
                    : <>Variabilele <code>CRYPTO_*</code> / <code>CYBER_*</code> nu au categorie în <code>REGULI_CATEGORIE</code> / <code>CATEGORII</code>: ajung la „Altele” sau lipsesc din Shapley.</>}
                </Check>
              )}
            </ul>
            <div className="mt-6 grid gap-6 md:grid-cols-2 [&>*]:min-w-0">
              {nb.params.length > 0 && (
                <div>
                  <h4 className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Parametri</h4>
                  <dl className="mt-2 max-h-64 space-y-1 overflow-auto pr-2 text-sm">
                    {nb.params.map((p) => (
                      <div key={p.name} className="flex justify-between gap-3 border-b border-border/60 py-1">
                        <dt><code>{p.name}</code></dt><dd className="truncate text-right font-mono text-xs" title={p.value}>{p.value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}
              {nb.metrics.length > 0 && (
                <div>
                  <h4 className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Rezultate raportate în notebook</h4>
                  <ul className="mt-2 max-h-64 space-y-1 overflow-auto pr-2 font-mono text-xs leading-relaxed">
                    {nb.metrics.map((m) => <li key={m} className="border-b border-border/60 py-1">{m}</li>)}
                  </ul>
                </div>
              )}
              {nb.outline.length > 0 && (
                <div>
                  <h4 className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Cuprins</h4>
                  <ol className="mt-2 max-h-64 list-decimal space-y-0.5 overflow-auto pl-5 pr-2 text-sm">{nb.outline.map((h, i) => <li key={i}>{h}</li>)}</ol>
                </div>
              )}
              {nb.inputs.length > 0 && (
                <div>
                  <h4 className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Fișiere folosite</h4>
                  <p className="mt-2 flex flex-wrap gap-1.5">{nb.inputs.map((f) => <code key={f} className="rounded-full bg-muted px-2 py-0.5 text-xs">{f}</code>)}</p>
                </div>
              )}
            </div>
          </Card>
        ) : (
          <Card className="flex items-center justify-center text-center text-sm text-muted-foreground lg:col-span-2">
            <p>După încărcare apar aici: dacă notebook-ul a rulat fără erori, ce fișiere exportă pentru dashboard,<br className="hidden md:inline" /> dacă folosește extensia, parametrii modelului și metricile raportate.</p>
          </Card>
        )}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------------------------------- 3. Extensia (scraper-ul)
/** Rulează extensia (colectare + calcul) și pune rezultatul în dashboard; întoarce și tabelul complet pentru Kaggle. */
export function useLiveCollect() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [status, setStatus] = useState<Record<string, SourceState>>({});
  const run = async (opts?: FeatureOptions, selected = ALL_SOURCE_IDS): Promise<{ table: FeatureTable; metas: ColMeta[] } | null> => {
    setBusy(true);
    setStatus(Object.fromEntries(selected.map((id) => [id, { state: "wait" } as SourceState])));
    try {
      const { data, table, metas } = await collectLive(setMsg, opts, selected, (id, s) => setStatus((p) => ({ ...p, [id]: s })));
      const prev = extensionStore.get();
      // știrile vin doar din CSV-ul scraper-ului; le păstrăm dacă existau
      const news = (prev?.rows ?? []).filter((r) => r.newsCyber !== undefined || r.newsCrypto !== undefined)
        .map((r) => ({ date: r.date, newsCyber: r.newsCyber, newsCrypto: r.newsCrypto }));
      extensionStore.set({ ...data, rows: mergeRows(news, data.rows), sources: [...new Set([...(prev?.sources ?? []), ...data.sources])] });
      toast.success(`Extensia a adus ${table.columns.length} variabile noi pe ${num(table.dates.length)} zile.`);
      return { table, metas };
    } catch (e) {
      toast.error(`Extensia s-a oprit: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    } finally { setBusy(false); setMsg(""); }
  };
  return { busy, msg, status, run };
}

const download = (name: string, text: string, type = "text/csv;charset=utf-8") => {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
const mb = (s: string) => `${num(new Blob([s]).size / 1048576, 1)} MB`;

const KAGGLE_METADATA = () => JSON.stringify({
  title: "Gama - DataSprint 2026 enriched",
  id: "REPLACE_WITH_KAGGLE_USERNAME/gama-datasprint-enriched",
  licenses: [],
  description: "datasprint_gama_enriched.csv: the DataSprint 2026 train and test rows (column split) with every original column unchanged, plus variables that enrich them (no overlap): ECB systemic stress (CISS, CLIFS Romania/CEE), euro and Romanian sovereign yields, CEE currencies, Romanian sentiment and activity (Eurostat), OECD leading indicators, crypto (Binance, stablecoins, Fear & Greed), cyber (CISA KEV, DeFi hacks) and Wikipedia attention. Each external value is placed on the date it was already published. Contains competition data: keep this dataset PRIVATE. Replace the Kaggle username before upload.",
}, null, 2) + "\n";

const SOURCE_LIST = [...BASE_SOURCES, ...SOURCES].map(({ id, label, detail, category }) => ({ id, label, detail, category }));

function SourceStatus({ s }: { s?: SourceState }) {
  if (!s) return null;
  if (s.state === "wait") return <span className="text-xs text-muted-foreground">în așteptare</span>;
  if (s.state === "run") return <span className="inline-flex items-center gap-1 text-xs text-primary"><Loader2 aria-hidden className="size-3 animate-spin" /> lucrează</span>;
  if (s.state === "ok") return <span className="inline-flex items-center gap-1 text-xs text-risk-low"><CheckCircle2 aria-hidden className="size-3" /> {s.cols} col.</span>;
  return <span className="inline-flex items-center gap-1 text-xs text-risk-moderate" title={s.error}><AlertTriangle aria-hidden className="size-3" /> eșuat</span>;
}

/** Secțiunea care pornește extensia și dă UN SINGUR CSV: DataSprint (train + test) îmbogățit cu datele extensiei. */
function ExtensionRunner() {
  const live = useLiveCollect();
  const [opts, setOpts] = useState<FeatureOptions>(DEFAULT_FEATURE_OPTIONS);
  const [sel, setSel] = useState<string[]>(ALL_SOURCE_IDS);
  const [out, setOut] = useState<{ table: FeatureTable; metas: ColMeta[] } | null>(null);
  const [ds, setDs] = useState<DsFile[]>([]);

  const start = async () => {
    const r = await live.run(opts, sel);
    if (r) setOut(r);
  };
  const addDs = async (files: File[]) => {
    const next = [...ds];
    for (const f of files) {
      try {
        const d = parseDataSprint(await f.text(), f.name);
        const i = next.findIndex((x) => x.kind === d.kind);
        if (i >= 0) next[i] = d; else next.push(d);
        toast.success(`${f.name}: ${num(d.rows.length)} rânduri (${d.kind}).`);
      } catch (e) { toast.error(`${f.name}: ${e instanceof Error ? e.message : String(e)}`); }
    }
    setDs(next);
    // perioada extensiei acoperă tot ce e în DataSprint
    if (next.length) {
      const from = next.map((d) => d.from).sort()[0];
      if (from < opts.start) setOpts((o) => ({ ...o, start: from }));
    }
  };
  // fișierul unic se reface singur dacă adaugi DataSprint după rulare
  const combined = useMemo(() => (out && ds.length ? combineDataSprint(ds, out.table) : null), [out, ds]);
  const featuresCsv = useMemo(() => (out ? featureTableToCsv(out.table) : ""), [out]);
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const overlap = out ? out.table.columns.filter((c) => DATASPRINT_COLUMNS.includes(c) || DATASPRINT_PREFIXES.some((p) => c.startsWith(p))) : [];
  const usedCats = out ? EXT_CATEGORIES.filter(([p]) => out.table.columns.some((c) => c.startsWith(p))) : EXT_CATEGORIES;
  const snippet = notebookSnippet(undefined, usedCats, ds.length > 0);
  const train = ds.find((d) => d.kind === "train");
  const copy = async () => {
    try { await navigator.clipboard.writeText(snippet); toast.success("Codul a fost copiat."); } catch { toast.error("Nu am putut copia; selectează textul manual."); }
  };
  const opt = (k: "lagCrypto" | "kevBlankBeforeCatalog", label: string, hint: string) => (
    <label className="flex items-start gap-3 text-sm">
      <input type="checkbox" checked={opts[k]} onChange={(e) => setOpts({ ...opts, [k]: e.target.checked })} className="mt-1 size-4 accent-[var(--primary)]" />
      <span><span className="font-medium">{label}</span><span className="block text-xs text-muted-foreground">{hint}</span></span>
    </label>
  );
  const step = (n: number, t: string) => <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{n} · {t}</p>;

  return (
    <Card className="bg-hero lg:col-span-3" aria-labelledby="run-h">
      <div className="grid gap-8 lg:grid-cols-2">
        <div className="space-y-5">
          <div>
            <h3 id="run-h" className="font-display text-xl font-semibold">Pornește extensia → un singur CSV</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Rezultatul e <strong>un singur fișier</strong>: datele DataSprint (train + test), neschimbate, plus tot ce aduce extensia de pe net —
              stres financiar, prima de risc a României, valute din regiune, sentiment economic, ciclu global, crypto, atacuri cibernetice, atenție publică —
              lipite pe fiecare zi. Fiecare valoare externă apare doar de la data la care era deja publicată.
            </p>
          </div>

          <div>
            {step(1, "Datele DataSprint")}
            <Drop accept=".csv,text/csv" multiple icon={Upload} label={ds.length ? "Înlocuiește train.csv / test.csv" : "Adaugă train.csv și test.csv"}
              hint="rămân doar în browserul tău" onFiles={(f) => void addDs(f)} />
            {ds.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-2">
                {ds.map((d) => (
                  <li key={d.kind} className="inline-flex items-center gap-2 rounded-full border bg-card/70 px-3 py-1 text-xs">
                    <CheckCircle2 aria-hidden className="size-3.5 text-risk-low" />
                    <span className="font-mono">{d.name}</span>
                    <span className="text-muted-foreground">{d.kind} · {num(d.rows.length)} rânduri · {d.from.slice(0, 4)}–{d.to.slice(0, 4)}</span>
                    <button type="button" onClick={() => setDs(ds.filter((x) => x !== d))} aria-label={`Elimină ${d.name}`} className="-mr-1 rounded-full px-1 text-muted-foreground hover:text-foreground">×</button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <fieldset>
            <legend className="mb-2 flex w-full items-center justify-between font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              2 · Surse de pe net
              <span className="normal-case tracking-normal">
                <button type="button" onClick={() => setSel(ALL_SOURCE_IDS)} className="min-h-8 px-1 text-xs text-primary hover:underline">toate</button> ·{" "}
                <button type="button" onClick={() => setSel([])} className="min-h-8 px-1 text-xs text-primary hover:underline">niciuna</button>
              </span>
            </legend>
            <ul className="max-h-[22rem] space-y-1.5 overflow-auto pr-1">
              {SOURCE_LIST.map((s) => (
                <li key={s.id}>
                  <label className={cn("flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm transition-colors", sel.includes(s.id) ? "border-primary/40 bg-primary/5" : "bg-card/40 opacity-75")}>
                    <input type="checkbox" checked={sel.includes(s.id)} onChange={() => toggle(s.id)} disabled={live.busy} className="mt-0.5 size-4 accent-[var(--primary)]" />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">{s.label}</span>
                        <SourceStatus s={live.status[s.id]} />
                      </span>
                      <span className="block text-xs text-muted-foreground">{s.detail}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>

          <div>
            {step(3, "Perioadă și corecții")}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                <span className="text-xs text-muted-foreground">De la</span>
                <input type="date" value={opts.start} min="2000-01-01" max={opts.end} onChange={(e) => setOpts({ ...opts, start: e.target.value || TRAIN_START })}
                  className="mt-1 block min-h-11 w-full rounded-lg border border-input bg-card px-2" />
              </label>
              <label className="text-sm">
                <span className="text-xs text-muted-foreground">Până la</span>
                <input type="date" value={opts.end} min={opts.start} max={today()} onChange={(e) => setOpts({ ...opts, end: e.target.value || today() })}
                  className="mt-1 block min-h-11 w-full rounded-lg border border-input bg-card px-2" />
              </label>
            </div>
            <div className="mt-3 space-y-2">
              {opt("lagCrypto", "Decalează crypto cu o zi (recomandat)", "Închiderea zilnică Binance (00:00 UTC) vine după închiderea BET; fără decalaj modelul ar vedea câteva ore din viitor.")}
              {opt("kevBlankBeforeCatalog", "KEV gol înainte de noiembrie 2021 (recomandat)", "Catalogul nu exista; 0 ar spune greșit „nicio vulnerabilitate”.")}
            </div>
          </div>

          <button onClick={() => void start()} disabled={live.busy || !sel.length}
            className="glow-primary inline-flex min-h-12 items-center gap-2 rounded-full bg-primary px-6 font-display font-semibold text-primary-foreground disabled:opacity-60">
            {live.busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Play aria-hidden className="size-4" />}
            {live.busy ? "Extensia lucrează…" : out ? "Rulează din nou" : "Pornește extensia"}
          </button>
          <p className="min-h-5 font-mono text-xs text-muted-foreground" aria-live="polite">{live.msg}</p>
        </div>

        <div className="space-y-4">
          {!out ? (
            <div className="flex h-full min-h-64 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
              <FileSpreadsheet aria-hidden className="size-8 text-primary" />
              <p>După rulare primești aici <code>{COMBINED_FILE}</code>: un singur fișier cu tot.</p>
              <p className="text-xs">Nu dublează nimic din DataSprint: indicii, VIX, cursul RON, ROBOR, petrolul, aurul, riscul geopolitic, inflația, PIB-ul sunt deja acolo.</p>
            </div>
          ) : (
            <>
              <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-2xl border bg-border">
                {(combined
                  ? [["rânduri", num(combined.rows)], ["coloane", `${num(combined.dsColumns)} + ${num(combined.extColumns)}`], ["train / test", `${num(combined.train)} / ${num(combined.test)}`]]
                  : [["zile", num(out.table.dates.length)], ["variabile noi", num(out.table.columns.length)], ["perioadă", `${out.table.dates[0]?.slice(0, 4)}–${out.table.dates.at(-1)?.slice(0, 4)}`]]
                ).map(([k, v]) => (
                  <div key={k} className="flex flex-col-reverse bg-card px-4 py-3">
                    <dt className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{k}</dt>
                    <dd className="font-display text-2xl font-bold tabular-nums">{v}</dd>
                  </div>
                ))}
              </dl>
              <ul className="space-y-1.5">
                <Check ok={overlap.length === 0}>
                  {overlap.length === 0 ? "Doar îmbogățire: nicio variabilă nouă nu dublează coloanele sau categoriile DataSprint." : <>Se suprapun cu DataSprint: {overlap.join(", ")}.</>}
                </Check>
                {combined && train && (
                  <Check ok={combined.targets === train.rows.filter((r) => (r[train.header.indexOf("stress_event_20d")] ?? "").trim() !== "").length}>
                    Ținta <code>stress_event_20d</code> e neschimbată ({num(combined.targets)} valori în train); la test e goală, ca în concurs.
                  </Check>
                )}
                {combined && (
                  <Check ok={combined.matched === combined.rows}>
                    {num(combined.matched)} din {num(combined.rows)} zile au primit datele extensiei
                    {combined.matched < combined.rows ? " (restul sunt în afara perioadei alese)" : ""}.
                  </Check>
                )}
                <Check ok>Fiecare valoare externă apare de la data publicării (zilnic: a doua zi; lunar: după întârzierea reală).</Check>
              </ul>

              {combined ? (
                <div className="rounded-2xl border border-primary/50 bg-primary/10 p-4">
                  <p className="font-mono text-sm">{COMBINED_FILE}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    DataSprint (train + test, coloana <code>split</code>) + {num(combined.extColumns)} variabile noi · {mb(combined.csv)}
                  </p>
                  <button onClick={() => download(COMBINED_FILE, combined.csv)}
                    className="glow-primary mt-3 inline-flex min-h-12 items-center gap-2 rounded-full bg-primary px-6 font-display font-semibold text-primary-foreground">
                    <Download aria-hidden className="size-4" /> Descarcă CSV-ul complet
                  </button>
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed p-4 text-sm">
                  <p className="font-medium">Adaugă <code>train.csv</code> și <code>test.csv</code> (pasul 1) ca să primești fișierul unic.</p>
                  <p className="mt-1 text-xs text-muted-foreground">Se face pe loc, fără să rulezi extensia din nou.</p>
                </div>
              )}

              <details className="rounded-2xl border bg-card/60 p-4 text-sm">
                <summary className="cursor-pointer font-medium">Alte fișiere (opțional)</summary>
                <ul className="mt-3 space-y-2">
                  <DownloadRow name="ews_external_metadata.csv" note="ce înseamnă fiecare variabilă nouă, sursa și de când e disponibilă" onClick={() => download("ews_external_metadata.csv", metadataCsv(out.metas))} />
                  <DownloadRow name="ews_external_features.csv" note={`doar variabilele noi · ${mb(featuresCsv)}`} onClick={() => download("ews_external_features.csv", featuresCsv)} />
                  <DownloadRow name="dataset-metadata.json" note="pentru kaggle datasets create (schimbă usernameul)" onClick={() => download("dataset-metadata.json", KAGGLE_METADATA(), "application/json")} />
                </ul>
              </details>
              <p className="text-xs text-muted-foreground">
                În Kaggle: <strong>Datasets → New Dataset</strong>, încarci fișierul și îl adaugi ca input în notebook. Pentru că fișierul unic conține datele
                concursului (inclusiv ținta), dataset-ul trebuie să fie <strong>privat</strong>.
              </p>
            </>
          )}
          <details className="rounded-2xl border bg-card/60 p-4 text-sm" open={!!out}>
            <summary className="cursor-pointer font-medium">Cod de lipit în notebook (încărcare + categorii)</summary>
            <pre className="mt-3 max-h-64 overflow-auto rounded-lg bg-background/80 p-3 font-mono text-xs leading-relaxed">{snippet}</pre>
            <button type="button" onClick={() => void copy()} className="mt-2 inline-flex min-h-10 items-center gap-2 rounded-full border border-primary/60 px-4 text-sm font-semibold text-primary hover:bg-primary/10">
              <Copy aria-hidden className="size-4" /> Copiază codul
            </button>
          </details>
        </div>
      </div>
    </Card>
  );
}

function DownloadRow({ name, note, onClick }: { name: string; note: string; onClick: () => void }) {
  return (
    <li className="flex items-center justify-between gap-3 rounded-xl border bg-card/70 px-4 py-3">
      <span className="min-w-0">
        <span className="block truncate font-mono text-sm">{name}</span>
        <span className="block text-xs text-muted-foreground">{note}</span>
      </span>
      <button onClick={onClick} className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full border border-primary/60 px-4 text-sm font-semibold text-primary hover:bg-primary/10">
        <Download aria-hidden className="size-4" /> Descarcă
      </button>
    </li>
  );
}

export function ExtensionSection() {
  const ews = useEws();
  const ext = useExtension();
  const handle = async (files: File[]) => {
    let rows = extensionStore.get()?.rows ?? [];
    const names: string[] = [];
    for (const f of files) {
      const r = parseExtensionCsv(await f.text());
      if (r.error) { toast.error(`${f.name}: ${r.error}`); continue; }
      rows = mergeRows(rows, r.rows);
      names.push(f.name);
    }
    if (!names.length) return;
    const prev = extensionStore.get();
    extensionStore.set({ rows, origin: "csv", sources: [...new Set([...(prev?.sources ?? []), ...names])], updatedAt: new Date().toISOString() });
    toast.success(`Extensia: ${names.join(", ")} încărcate.`);
  };
  const flags = ext ? qualityFlags(ext.rows, ews.fullSeries[0]?.date, ews.lastDate, ext.origin) : [];
  const cov = ext ? ([
    ["Stres sistemic (CISS)", coverage(ext.rows, "stressEA")],
    ["Stres România (CLIFS)", coverage(ext.rows, "stressRO")],
    ["Prima de risc RO", coverage(ext.rows, "roSpread")],
    ["Valute regionale", coverage(ext.rows, "ceeVol")],
    ["Crypto", coverage(ext.rows, "btc")],
    ["Vulnerabilități KEV", coverage(ext.rows, "kev", true)],
    ["Atenție publică", coverage(ext.rows, "attnFear")],
    ["Știri (scraper)", coverage(ext.rows, "newsCyber", true) ?? coverage(ext.rows, "newsCrypto", true)],
  ] as const) : [];

  return (
    <section aria-label="Extensia: date externe">
      <SectionHead eyebrow="06.3 — Extensia" title="Date care îmbogățesc" accent="DataSprint">
        Extensia (urmașa scraper-ului <code>scraper_ews.py</code>) rulează direct în browser și adaugă doar informație nouă față de DataSprint:
        stres financiar sistemic (ECB), randamentele și prima de risc a României, valutele din regiune, încrederea economică și producția
        (Eurostat), ciclul global (OECD), crypto, atacuri cibernetice și atenția publică (Wikipedia). Primește și CSV-urile scraper-ului.
        Rezultatul apare în Explicabilitate → „Context extern” și se descarcă pentru Kaggle.
      </SectionHead>
      <div className="grid gap-6 lg:grid-cols-3 [&>*]:min-w-0">
        <ExtensionRunner />
        <Card className="space-y-3">
          <h3 className="font-display text-lg font-semibold">Ai rulat scraper-ul local?</h3>
          <p className="text-sm text-muted-foreground">Încarcă CSV-urile lui (cu știri și piețe incluse); se adaugă peste ce a colectat extensia.</p>
          <a href={import.meta.env.BASE_URL + "scraper_ews.py"} download="scraper_ews.py"
            className="inline-flex min-h-10 items-center gap-2 rounded-full border border-primary/60 px-4 text-sm font-semibold text-primary hover:bg-primary/10">
            <Download aria-hidden className="size-4" /> Descarcă scraperul Python
          </a>
          <p className="text-xs text-muted-foreground">Script local, separat de extensia live; necesită Python, pandas și requests.</p>
          <Drop accept=".csv,text/csv" multiple icon={Puzzle} label="Încarcă CSV-urile scraper-ului" hint="din folderul kaggle_upload" onFiles={(f) => void handle(f)} />
          {ext && (
            <button onClick={() => extensionStore.set(null)} className="inline-flex min-h-11 items-center gap-2 rounded-md px-2 text-sm text-destructive hover:bg-muted">
              <Trash2 aria-hidden className="size-4" /> Șterge datele extensiei
            </button>
          )}
        </Card>
        <Card className="lg:col-span-2" aria-labelledby="ext-st">
          <h3 id="ext-st" className="font-display text-lg font-semibold">Ce a adus extensia</h3>
          {!ext ? (
            <p className="mt-2 text-sm text-muted-foreground">Încă nimic. Apasă „Colectează live acum” sau încarcă CSV-urile scraper-ului.</p>
          ) : (
            <>
              <p className="mt-1 text-sm text-muted-foreground">
                {ext.origin === "live" ? "Colectat live" : "Din CSV"} · {num(ext.rows.length)} zile · actualizat {fmtDate(ext.updatedAt.slice(0, 10))} · surse: {ext.sources.join(", ")}
              </p>
              <dl className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {cov.map(([k, c]) => (
                  <div key={k} className="rounded-xl border bg-card/60 p-3">
                    <dt className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">{k}</dt>
                    <dd className="mt-1 text-sm font-semibold tabular-nums">{c ? `${fmtDate(c.from)} – ${fmtDate(c.to)}` : "lipsește"}</dd>
                  </div>
                ))}
              </dl>
              <h4 className="mt-5 font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Calitatea datelor externe</h4>
              <ul className="mt-2 space-y-2">{flags.map((f) => <Check key={f.text} ok={f.level === "ok"}>{f.text}</Check>)}</ul>
            </>
          )}
        </Card>
      </div>
    </section>
  );
}
