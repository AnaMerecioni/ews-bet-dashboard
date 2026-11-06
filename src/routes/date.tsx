import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, ClipboardCopy, Download, FileUp, Loader2, Trash2, Unplug } from "lucide-react";
import { toast } from "sonner";
import { useEws } from "@/lib/ews/store";
import { fmtDate, num, pct } from "@/lib/ews/format";
import { buildBundle, readInputs, ROLE_LABEL, type BundleReport } from "@/lib/ews/bundle";
import { notebookStore, useNotebook, type NotebookSummary } from "@/lib/ews/notebook";
import { extensionStore, mergeRows, parseExtensionCsv } from "@/lib/ews/extension";
import { EXPORT_CELL, EXPORT_CELL_NAME } from "@/lib/ews/exportCell";
import type { FileKind } from "@/lib/ews/types";
import { Card, PageHeader } from "@/components/ews/ui";
import { ExtensionSection } from "@/components/ews/DataHub";
import { cn } from "@/lib/utils";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/date")({
  head: () => ({
    meta: [
      { title: "Date · Sistem de avertizare timpurie" },
      { name: "description", content: "Încarci notebook-ul și output-ul lui din Kaggle; dashboard-ul pregătește singur toate datele, direct în browser." },
      { property: "og:title", content: "Date · Sistem de avertizare timpurie" },
      { property: "og:description", content: "Notebook-ul și output-ul lui, încărcate o singură dată." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DataPage,
});

function DataPage() {
  const ews = useEws();
  const nb = useNotebook();
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="06 — Surse de date"
        title="Date"
        desc="Încarci notebook-ul și output-ul lui din Kaggle, iar dashboard-ul pregătește singur restul. Fișierele se citesc doar în browserul tău."
        actions={
          <AlertDialog>
            <AlertDialogTrigger className="inline-flex min-h-11 items-center gap-2 rounded-md border bg-card px-4 text-sm font-medium text-destructive hover:bg-muted">
              <Trash2 aria-hidden className="size-4" /> Șterge datele
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Ștergi datele încărcate?</AlertDialogTitle>
                <AlertDialogDescription>Tabloul de bord revine la datele demonstrative. Setările rămân neschimbate.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Renunță</AlertDialogCancel>
                <AlertDialogAction onClick={() => { ews.clearData(); notebookStore.set(null); toast.success("Datele au fost șterse."); }}>Șterge</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        }
      />
      <Upload />
      <ActiveData />
      <Availability nb={nb} />
      {nb && <NotebookCard nb={nb} />}
      <details className="rounded-2xl border bg-card/40 p-5">
        <summary className="cursor-pointer text-sm font-semibold">Opțional: extensia cu date externe (pentru antrenarea modelului)</summary>
        <div className="pt-6"><ExtensionSection /></div>
      </details>
    </div>
  );
}

// ------------------------------------------------------------------------------- încărcarea unică
function Upload() {
  const ews = useEws();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<BundleReport[] | null>(null);

  const handle = async (list: File[]) => {
    if (!list.length) return;
    setBusy(true);
    try {
      const { inputs, skipped } = await readInputs(list);
      const b = buildBundle(inputs);
      for (const s of skipped) b.report.push({ name: s, role: "ignored", ok: false, detail: "format nesuportat: folosește .ipynb, .csv sau .zip" });
      if (b.notebook) notebookStore.set(b.notebook);
      for (const f of b.extension) {
        const r = parseExtensionCsv(f.text);
        if (r.error) continue;
        const prev = extensionStore.get();
        extensionStore.set({ rows: mergeRows(prev?.rows ?? [], r.rows), origin: "csv", sources: [...new Set([...(prev?.sources ?? []), f.name])], updatedAt: new Date().toISOString() });
      }
      if (b.data.predictions) {
        ews.loadBundle(b.data, b.names);
        // celula de export scrie contribuțiile SHAP în log-odds
        if (b.data.drivers) ews.updateSettings({ shapUnit: "logit" });
        const extra = (["drivers", "outcomes", "sensitivity"] as FileKind[]).filter((k) => b.data[k]).length;
        toast.success(`Datele au fost actualizate: ${num(b.data.predictions.length)} zile de predicții${extra ? ` și încă ${extra} fișiere` : ""}.`);
      } else if (b.notebook) {
        toast.info("Am citit notebook-ul. Încarcă și output-ul lui (submission.csv sau arhiva .zip din Kaggle) ca să actualizezi predicțiile.");
      } else {
        toast.error("Nu am găsit predicțiile. Încarcă submission.csv sau arhiva .zip cu output-ul notebook-ului.");
      }
      setReport(b.report);
    } catch (e) {
      toast.error(`Nu am putut citi fișierele: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setBusy(false); }
  };

  return (
    <Card aria-labelledby="up-h">
      <h2 id="up-h" className="font-display text-lg font-semibold">Încarcă notebook-ul și output-ul lui</h2>
      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
        Din Kaggle, după <strong>Save &amp; Run All</strong>: notebook-ul (<code>.ipynb</code>) și fișierele din <strong>Output</strong>
        (<code>submission.csv</code>, <code>risk_monitoring.csv</code>) sau direct arhiva <code>.zip</code> cu tot output-ul. Le tragi pe toate odată;
        datele noi le înlocuiesc complet pe cele vechi.
      </p>
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); void handle(Array.from(e.dataTransfer.files)); }}
        disabled={busy}
        className={cn("mt-4 flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed p-8 text-sm transition-colors",
          over ? "border-primary bg-primary/10" : "hover:border-primary/60 hover:bg-muted/60")}
      >
        {busy ? <Loader2 aria-hidden className="size-7 animate-spin text-primary" /> : <FileUp aria-hidden className="size-7 text-primary" />}
        <span className="font-semibold">{busy ? "Se citesc fișierele…" : "Trage aici notebook-ul și output-ul sau alege-le"}</span>
        <span className="text-muted-foreground">.ipynb, .csv sau .zip</span>
      </button>
      <input ref={input} type="file" accept=".ipynb,.csv,.zip,text/csv,application/zip,application/json" multiple className="sr-only" tabIndex={-1} aria-hidden
        onChange={(e) => { void handle(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
      {report && report.length > 0 && (
        <ul className="mt-4 divide-y" aria-live="polite">
          {report.map((r, i) => (
            <li key={r.name + i} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm">
              {r.ok ? <CheckCircle2 aria-hidden className="size-4 text-risk-low" /> : <AlertTriangle aria-hidden className="size-4 text-risk-moderate" />}
              <span className="font-medium [overflow-wrap:anywhere]">{r.name}</span>
              <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs text-primary">{ROLE_LABEL[r.role]}</span>
              <span className="text-muted-foreground">{r.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------------------- ce date sunt active
const fmtDateTime = (iso?: string) => {
  if (!iso) return "—";
  const d = new Date(iso);
  const z = (n: number) => String(n).padStart(2, "0");
  return `${z(d.getDate())}.${z(d.getMonth() + 1)}.${d.getFullYear()} ${z(d.getHours())}:${z(d.getMinutes())}`;
};

function ActiveData() {
  const ews = useEws();
  const s = ews.fullSeries;
  let missing = 0;
  for (let i = 1; i < s.length; i++) {
    const d = new Date(s[i - 1].date + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + 1);
    while (d.toISOString().slice(0, 10) < s[i].date) {
      const wd = d.getUTCDay();
      if (wd !== 0 && wd !== 6) missing++;
      d.setUTCDate(d.getUTCDate() + 1);
    }
  }
  const linked = Object.keys(ews.sources) as FileKind[];
  const origin = ews.isDemo ? "Date demonstrative" : linked.length ? "Link extern" : ews.files.names?.predictions ?? "Fișierele tale";
  return (
    <Card aria-labelledby="act-h">
      <h2 id="act-h" className="text-base font-semibold">Datele afișate acum</h2>
      {ews.isDemo && <p className="mt-1 text-sm text-muted-foreground">Dashboard-ul arată date demonstrative până încarci output-ul notebook-ului.</p>}
      {!ews.isDemo && !linked.length && <p className="mt-1 text-sm text-muted-foreground">Încărcate {fmtDateTime(ews.files.updatedAt)}.</p>}
      {linked.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-risk-moderate/40 bg-risk-moderate/10 p-3 text-sm">
          <AlertTriangle aria-hidden className="size-4 shrink-0 text-risk-moderate" />
          <span className="min-w-0 flex-1">Datele vin dintr-un link și se reîncarcă la fiecare deschidere ({linked.map((k) => `${k}.csv`).join(", ")}). Când încarci output-ul notebook-ului, linkul se deconectează singur.</span>
          <button onClick={() => { for (const k of linked) ews.disconnectSource(k); toast.success("Linkurile au fost deconectate."); }}
            className="inline-flex min-h-11 items-center gap-2 rounded-md border bg-card px-3 text-sm hover:bg-muted"><Unplug aria-hidden className="size-4" /> Deconectează</button>
        </div>
      )}
      <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-5">
        {[
          ["Sursă", origin],
          ["Perioadă", s.length ? `${fmtDate(s[0].date)} – ${fmtDate(ews.lastDate)}` : "—"],
          ["Zile de predicție", num(s.length)],
          ["Prag de alertă / risc ridicat", `${pct(ews.thr.alert, 1)} / ${pct(ews.thr.high, 1)}`],
          ["Goluri în serie", num(missing)],
        ].map(([k, v]) => (
          <div key={k} className="min-w-0 rounded-lg bg-muted p-3"><dt className="text-muted-foreground">{k}</dt><dd className="mt-1 font-semibold [overflow-wrap:anywhere]">{v}</dd></div>
        ))}
      </dl>
    </Card>
  );
}

// ------------------------------------------------------------------------------- ce poate arăta dashboard-ul
function Row({ ok, title, children }: { ok: boolean; title: string; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3 py-2.5 text-sm">
      {ok ? <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-risk-low" /> : <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-risk-moderate" />}
      <div className="min-w-0"><span className="sr-only">{ok ? "Disponibil: " : "Lipsește: "}</span><strong>{title}</strong> <span className="text-muted-foreground">{children}</span></div>
    </li>
  );
}

function Availability({ nb }: { nb: NotebookSummary | null }) {
  const ews = useEws();
  const real = !ews.isDemo;
  const has = { drivers: real && ews.hasDrivers, outcomes: real && ews.hasOutcomes, sensitivity: real && !!ews.sensitivity };
  const missing = real && (!has.drivers || !has.outcomes || !has.sensitivity);
  const cellInNotebook = !!nb && nb.exports.drivers && nb.exports.outcomes && nb.exports.sensitivity;
  const copy = async () => {
    try { await navigator.clipboard.writeText(EXPORT_CELL); toast.success("Celula a fost copiată. Lipește-o la finalul notebook-ului."); }
    catch { toast.error("Nu am putut copia. Folosește „Descarcă celula”."); }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([EXPORT_CELL], { type: "text/x-python;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = EXPORT_CELL_NAME; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <Card aria-labelledby="av-h">
      <h2 id="av-h" className="text-base font-semibold">Ce arată dashboard-ul cu aceste date</h2>
      <ul className="mt-2 divide-y">
        <Row ok={real} title="Rezumat, Azi, Alerte:">{real ? "probabilitățile zilnice și pragul din output." : "încarcă output-ul notebook-ului."}</Row>
        <Row ok={real && ews.thr.highFromFile} title="Niveluri de risc:">{real && ews.thr.highFromFile ? "pragul pentru risc ridicat vine din risk_monitoring.csv." : "pragul pentru risc ridicat e estimat (1,5 × pragul de alertă); îl iau din risk_monitoring.csv când îl încarci."}</Row>
        <Row ok={has.drivers} title="Factori (SHAP):">{has.drivers ? "contribuțiile pe zile sunt încărcate." : "lipsesc contribuțiile SHAP pe zile."}</Row>
        <Row ok={has.outcomes} title="Backtest și erori:">{has.outcomes ? "etichetele reale sunt încărcate." : "lipsesc etichetele reale din perioada de validare."}</Row>
        <Row ok={has.sensitivity} title="Scenarii „ce-ar fi dacă”:">{has.sensitivity ? "curbele de sensibilitate sunt încărcate." : "lipsesc curbele de sensibilitate."}</Row>
      </ul>
      {missing && (
        <div className="mt-4 rounded-xl border bg-muted/50 p-4 text-sm">
          {cellInNotebook ? (
            <p>Notebook-ul are deja celula de export. Rulează-l din nou în Kaggle (<strong>Save &amp; Run All</strong>) și încarcă aici arhiva <code>.zip</code> cu tot output-ul noii rulări.</p>
          ) : (
            <p>
              Output-ul actual are doar submisia și nivelurile de risc. Ca să apară și factorii, backtest-ul și scenariile, adaugă <strong>o singură dată</strong> celula de mai jos
              la finalul notebook-ului, rulează-l din nou în Kaggle (<strong>Save &amp; Run All</strong>) și încarcă aici arhiva <code>.zip</code> din Output. Celula nu schimbă <code>submission.csv</code>.
            </p>
          )}
          {!cellInNotebook && (
            <>
              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={() => void copy()} className="inline-flex min-h-11 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"><ClipboardCopy aria-hidden className="size-4" /> Copiază celula</button>
                <button onClick={download} className="inline-flex min-h-11 items-center gap-2 rounded-md border bg-card px-4 text-sm hover:bg-muted"><Download aria-hidden className="size-4" /> Descarcă celula (.py)</button>
              </div>
              <details className="mt-3">
                <summary className="cursor-pointer text-sm font-medium">Vezi codul celulei</summary>
                <pre className="mt-2 max-h-80 overflow-auto rounded-lg border bg-card p-3 font-mono text-xs leading-relaxed">{EXPORT_CELL}</pre>
              </details>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------------------- notebook-ul pe scurt
function NotebookCard({ nb }: { nb: NotebookSummary }) {
  const ran = nb.executed > 0;
  const fullyRan = nb.executed >= Math.max(1, Math.ceil(nb.cells.code * 0.8));
  return (
    <Card aria-labelledby="nb-h">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow mb-1">Notebook</p>
          <h2 id="nb-h" className="font-display text-lg font-semibold [overflow-wrap:anywhere]">{(nb.title ?? nb.name).replace(/<[^>]+>/g, "")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{nb.name} · {num(nb.cells.code)} celule de cod · încărcat {fmtDate(nb.loadedAt.slice(0, 10))}</p>
        </div>
        <button onClick={() => notebookStore.set(null)} className="inline-flex min-h-11 items-center gap-2 rounded-md px-2 text-sm text-destructive hover:bg-muted"><Trash2 aria-hidden className="size-4" /> Elimină</button>
      </div>
      <ul className="mt-3 divide-y">
        <Row ok={fullyRan && nb.errors.length === 0} title="Rulare:">
          {!ran ? "fișierul nu are output-uri salvate (descărcat înainte de rulare). Pentru date contează oricum output-ul din Kaggle."
            : !fullyRan ? `doar ${num(nb.executed)} din ${num(nb.cells.code)} celule au output salvat (probabil descărcat înainte de rulare). Pentru date contează output-ul din Kaggle.`
              : `${num(nb.executed)} din ${num(nb.cells.code)} celule au rulat${nb.errors.length ? `, ${nb.errors.length} cu eroare` : ", fără erori"}.`}
        </Row>
        {nb.errors.slice(0, 3).map((e) => <Row key={e.cell} ok={false} title={`Celula ${e.cell}:`}><code>{e.ename}</code> {e.evalue}</Row>)}
      </ul>
      {(nb.outline.length > 0 || nb.metrics.length > 0) && (
        <div className="mt-4 grid gap-6 md:grid-cols-2 [&>*]:min-w-0">
          {nb.outline.length > 0 && (
            <div>
              <h3 className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Cuprins</h3>
              <ol className="mt-2 max-h-64 list-decimal space-y-0.5 overflow-auto pl-5 pr-2 text-sm">{nb.outline.map((h, i) => <li key={i}>{h}</li>)}</ol>
            </div>
          )}
          {nb.metrics.length > 0 && (
            <div>
              <h3 className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Rezultate raportate în notebook</h3>
              <ul className="mt-2 max-h-64 space-y-1 overflow-auto pr-2 font-mono text-xs leading-relaxed">{nb.metrics.map((m) => <li key={m} className="border-b border-border/60 py-1">{m}</li>)}</ul>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
