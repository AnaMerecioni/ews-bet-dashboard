import { useRef, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, FileUp, Loader2, NotebookPen, Play, Puzzle, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { useEws } from "@/lib/ews/store";
import { parseCsv } from "@/lib/ews/parse";
import type { FileKind } from "@/lib/ews/types";
import { fmtDate, num } from "@/lib/ews/format";
import {
  augmentCsv, collectLive, coverage, DEFAULT_FEATURE_OPTIONS, EXT_START, extensionStore, featureTableToCsv, isExtensionCsv, mergeRows,
  parseExtensionCsv, qualityFlags, today, useExtension, type FeatureOptions, type FeatureTable,
} from "@/lib/ews/extension";
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
      <span><span className="sr-only">{ok ? "În regulă: " : "Atenție: "}</span>{children}</span>
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
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <Drop accept=".ipynb,application/x-ipynb+json,application/json" icon={NotebookPen} label={nb ? "Înlocuiește notebook-ul" : "Încarcă notebook-ul (.ipynb)"}
            hint="un singur fișier" onFiles={(f) => void handle(f)} />
          {nb && (
            <div className="mt-4 space-y-1 text-sm">
              <p className="font-semibold">{nb.title ?? nb.name}</p>
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
            <div className="mt-6 grid gap-6 md:grid-cols-2">
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
  const run = async (opts?: FeatureOptions): Promise<FeatureTable | null> => {
    setBusy(true);
    try {
      const { data, table } = await collectLive(setMsg, opts);
      const prev = extensionStore.get();
      // știrile vin doar din CSV-ul scraper-ului; le păstrăm dacă existau
      const news = (prev?.rows ?? []).filter((r) => r.newsCyber !== undefined || r.newsCrypto !== undefined)
        .map((r) => ({ date: r.date, newsCyber: r.newsCyber, newsCrypto: r.newsCrypto }));
      extensionStore.set({ ...data, rows: mergeRows(news, data.rows), sources: [...new Set([...(prev?.sources ?? []), ...data.sources])] });
      toast.success(`Extensia a colectat ${num(table.dates.length)} zile × ${table.columns.length} coloane.`);
      return table;
    } catch (e) {
      toast.error(`Extensia s-a oprit: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    } finally { setBusy(false); setMsg(""); }
  };
  return { busy, msg, run };
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
  title: "DataSprint EWS external market, crypto and cyber features",
  id: "REPLACE_WITH_KAGGLE_USERNAME/datasprint-ews-external-features",
  licenses: [],
  description: "Crypto (Binance) and CISA KEV features generated by the EWS dashboard extension. Set a license after checking source terms; replace the Kaggle username before upload.",
}, null, 2) + "\n";

/** Secțiunea care pornește extensia și generează fișierele pentru Kaggle. */
function ExtensionRunner() {
  const live = useLiveCollect();
  const [opts, setOpts] = useState<FeatureOptions>(DEFAULT_FEATURE_OPTIONS);
  const [out, setOut] = useState<{ csv: string; table: FeatureTable; at: string } | null>(null);
  const [aug, setAug] = useState<{ name: string; csv: string; note: string }[]>([]);

  const start = async () => {
    setAug([]);
    const table = await live.run(opts);
    if (table) setOut({ csv: featureTableToCsv(table), table, at: new Date().toISOString() });
  };
  const augment = async (files: File[]) => {
    if (!out) return;
    const done: typeof aug = [];
    for (const f of files) {
      try {
        const r = augmentCsv(await f.text(), out.table);
        done.push({ name: f.name.replace(/\.csv$/i, "") + "_augmented.csv", csv: r.csv,
          note: `${num(r.total)} rânduri, ${num(r.matched)} cu date externe, +${r.added} coloane${r.skipped ? ` (${r.skipped} existau deja)` : ""}` });
      } catch (e) { toast.error(`${f.name}: ${e instanceof Error ? e.message : String(e)}`); }
    }
    setAug((a) => [...a.filter((x) => !done.some((d) => d.name === x.name)), ...done]);
  };
  const opt = (k: "lagCrypto" | "kevBlankBeforeCatalog", label: string, hint: string) => (
    <label className="flex items-start gap-3 text-sm">
      <input type="checkbox" checked={opts[k]} onChange={(e) => setOpts({ ...opts, [k]: e.target.checked })} className="mt-1 size-4 accent-[var(--primary)]" />
      <span><span className="font-medium">{label}</span><span className="block text-xs text-muted-foreground">{hint}</span></span>
    </label>
  );

  return (
    <Card className="bg-hero lg:col-span-3" aria-labelledby="run-h">
      <div className="grid gap-8 lg:grid-cols-2">
        <div className="space-y-4">
          <h3 id="run-h" className="font-display text-xl font-semibold">Pornește extensia → CSV pentru Kaggle</h3>
          <p className="text-sm text-muted-foreground">
            Extensia colectează din surse publice (Binance pentru 8 monede, CISA KEV), calculează feature-urile cu aceleași nume ca scraper-ul și
            îți dă <code>ews_external_features.csv</code> gata de încărcat ca dataset Kaggle.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">De la</span>
              <input type="date" value={opts.start} min="2017-01-01" max={opts.end} onChange={(e) => setOpts({ ...opts, start: e.target.value || EXT_START })}
                className="mt-1 block min-h-11 w-full rounded-lg border border-input bg-card px-2" />
            </label>
            <label className="text-sm">
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Până la</span>
              <input type="date" value={opts.end} min={opts.start} max={today()} onChange={(e) => setOpts({ ...opts, end: e.target.value || today() })}
                className="mt-1 block min-h-11 w-full rounded-lg border border-input bg-card px-2" />
            </label>
          </div>
          {opt("lagCrypto", "Decalează crypto cu o zi (recomandat)", "Închiderea zilnică Binance (00:00 UTC) vine după închiderea BET; fără decalaj modelul ar vedea câteva ore din viitor.")}
          {opt("kevBlankBeforeCatalog", "KEV gol înainte de noiembrie 2021 (recomandat)", "Catalogul nu exista; 0 ar spune greșit „nicio vulnerabilitate”.")}
          <button onClick={() => void start()} disabled={live.busy}
            className="glow-primary inline-flex min-h-12 items-center gap-2 rounded-full bg-primary px-6 font-display font-semibold text-primary-foreground disabled:opacity-60">
            {live.busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Play aria-hidden className="size-4" />}
            {live.busy ? "Extensia lucrează…" : out ? "Rulează din nou" : "Pornește extensia"}
          </button>
          <p className="min-h-5 font-mono text-xs text-muted-foreground" aria-live="polite">{live.msg}</p>
        </div>

        <div className="space-y-4">
          {!out ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
              <FileSpreadsheet aria-hidden className="size-8 text-primary" />
              <p>După rulare apar aici fișierele pentru Kaggle.</p>
              <p className="text-xs">Piețele și macro (Yahoo, FRED) și știrile (GDELT) nu permit acces din browser — pentru ele rulează <code>scraper_ews.py</code>; oricum, piețele sunt deja în <code>train.csv</code>.</p>
            </div>
          ) : (
            <>
              <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-2xl border bg-border">
                {[["zile", num(out.table.dates.length)], ["coloane", num(out.table.columns.length + 1)], ["perioadă", `${out.table.dates[0]?.slice(0, 4)}–${out.table.dates.at(-1)?.slice(0, 4)}`]].map(([k, v]) => (
                  <div key={k} className="flex flex-col-reverse bg-card px-4 py-3">
                    <dt className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{k}</dt>
                    <dd className="font-display text-2xl font-bold tabular-nums">{v}</dd>
                  </div>
                ))}
              </dl>
              <ul className="space-y-2">
                <DownloadRow name="ews_external_features.csv" note={`fișierul principal · ${mb(out.csv)}`} onClick={() => download("ews_external_features.csv", out.csv)} />
                <DownloadRow name="dataset-metadata.json" note="pentru kaggle datasets create (schimbă usernameul)" onClick={() => download("dataset-metadata.json", KAGGLE_METADATA(), "application/json")} />
                {aug.map((a) => <DownloadRow key={a.name} name={a.name} note={`${a.note} · ${mb(a.csv)}`} onClick={() => download(a.name, a.csv)} />)}
              </ul>
              <Drop accept=".csv,text/csv" multiple icon={Upload} label="Opțional: adaugă train.csv / test.csv"
                hint="primești train_augmented.csv / test_augmented.csv (ținta rămâne neatinsă)" onFiles={(f) => void augment(f)} />
              <p className="text-xs text-muted-foreground">
                În Kaggle: <strong>Datasets → New Dataset</strong> și încarci fișierele, apoi în notebook le adaugi ca input.
                Fișierele concursului (train/test) țin-le într-un dataset <strong>privat</strong>.
              </p>
            </>
          )}
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
  const flags = ext ? qualityFlags(ext.rows, ews.fullSeries[0]?.date, ews.lastDate) : [];
  const cov = ext ? [
    ["Crypto (BTC + piață)", coverage(ext.rows, "btc")],
    ["Vulnerabilități KEV", coverage(ext.rows, "kev", true)],
    ["Știri cyber", coverage(ext.rows, "newsCyber", true)],
    ["Știri crypto", coverage(ext.rows, "newsCrypto", true)],
  ] as const : [];

  return (
    <section aria-label="Extensia: date externe">
      <SectionHead eyebrow="06.3 — Extensia" title="Date externe:" accent="crypto și cyber">
        Extensia este scraper-ul <code>scraper_ews.py</code>: aduce cotații crypto (Binance), vulnerabilitățile exploatate (CISA KEV) și știri
        cyber/crypto (GDELT). Aici își face treaba direct în browser — colectează live crypto și KEV cu aceleași calcule ca scriptul — sau
        primește CSV-urile lui (<code>ews_external_features.csv</code>, <code>crypto_daily.csv</code>, <code>cyber_crypto_daily.csv</code>, <code>cisa_kev.csv</code>).
        Rezultatul apare în Explicabilitate → „Context extern”.
      </SectionHead>
      <div className="grid gap-6 lg:grid-cols-3">
        <ExtensionRunner />
        <Card className="space-y-3">
          <h3 className="font-display text-lg font-semibold">Ai rulat scraper-ul local?</h3>
          <p className="text-sm text-muted-foreground">Încarcă CSV-urile lui (cu știri și piețe incluse); se adaugă peste ce a colectat extensia.</p>
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
