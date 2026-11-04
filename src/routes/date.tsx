import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { AlertCircle, CheckCircle2, ClipboardCopy, Download, FileUp, Link2, Loader2, RefreshCw, Trash2, Unplug, Upload } from "lucide-react";
import { decodeConfig, encodeConfig, type RefreshMinutes } from "@/lib/ews/remote";
import { toast } from "sonner";
import { useEws } from "@/lib/ews/store";
import { FILE_LABELS, parseCsv, REQUIRED, TEMPLATES, type ParseResult } from "@/lib/ews/parse";
import type { FileKind } from "@/lib/ews/types";
import { fmtDate, num } from "@/lib/ews/format";
import { Card, PageHeader } from "@/components/ews/ui";
import { cn } from "@/lib/utils";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/date")({
  head: () => ({
    meta: [
      { title: "Date · Sistem de avertizare timpurie" },
      { name: "description", content: "Încarcă predicțiile, factorii SHAP și rezultatele reale ca fișiere CSV, direct în browser." },
      { property: "og:title", content: "Date · Sistem de avertizare timpurie" },
      { property: "og:description", content: "Încărcare și validare CSV pentru sistemul de avertizare BET." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DataPage,
});

const KINDS: FileKind[] = ["predictions", "drivers", "outcomes", "sensitivity"];

function DataPage() {
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
  return (
    <div className="space-y-6">
      <PageHeader
        title="Date"
        desc="Fișierele se citesc doar în browserul tău și se păstrează local. Nimic nu este trimis pe un server."
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
                <AlertDialogAction onClick={() => { ews.clearData(); toast.success("Datele au fost șterse."); }}>Șterge</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        }
      />
      <Card aria-labelledby="cov-h">
        <h2 id="cov-h" className="text-base font-semibold">Acoperirea datelor {ews.isDemo && <span className="font-normal text-muted-foreground">(demonstrative)</span>}</h2>
        <dl className="mt-3 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-5">
          {[
            ["Perioadă", `${fmtDate(s[0]?.date ?? "")} – ${fmtDate(ews.lastDate)}`],
            ["Zile de predicție", num(s.length)],
            ["Active", ews.assets.filter(Boolean).join(", ") || "BET (implicit)"],
            ["Goluri în serie", num(missing)],
            ["Fișiere opționale", [ews.hasDrivers && "factori", ews.hasOutcomes && "rezultate", ews.sensitivity && "sensibilitate"].filter(Boolean).join(", ") || "niciunul"],
          ].map(([k, v]) => (
            <div key={k} className="rounded-lg bg-muted p-3"><dt className="text-muted-foreground">{k}</dt><dd className="mt-1 font-semibold">{v}</dd></div>
          ))}
        </dl>
      </Card>
      <LinkConfig />
      <p className="sr-only" aria-live="polite" key={ews.remoteStatus.n}>{ews.remoteStatus.text}</p>
      <div className="grid gap-6 lg:grid-cols-2">
        {KINDS.map((k) => <DropZone key={k} kind={k} />)}
      </div>
    </div>
  );
}

function DropZone({ kind }: { kind: FileKind }) {
  const ews = useEws();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [res, setRes] = useState<(ParseResult & { name: string }) | null>(null);
  const meta = FILE_LABELS[kind];
  const loaded = !ews.isDemo ? ews.files.names?.[kind] : undefined;

  const handle = async (file: File) => {
    const text = await file.text();
    const r = parseCsv(kind, text);
    setRes({ ...r, name: file.name });
    if (!r.errors.length) {
      ews.setFile(kind, r.rows, file.name);
      toast.success(`${file.name}: ${num(r.rows.length)} rânduri încărcate.`);
      if (kind !== "predictions" && ews.isDemo) toast.info("Încarcă și predictions.csv pentru a înlocui datele demonstrative.");
    } else {
      toast.error(`${file.name} nu a putut fi încărcat. Vezi detaliile.`);
    }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([TEMPLATES[kind]], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${kind}_sablon.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <Card aria-labelledby={`dz-${kind}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id={`dz-${kind}`} className="text-base font-semibold">
            {meta.title} {meta.required ? <span className="ml-1 rounded bg-accent px-1.5 py-0.5 text-xs text-accent-foreground">obligatoriu</span> : <span className="ml-1 text-xs font-normal text-muted-foreground">opțional</span>}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{meta.desc}</p>
          <p className="mt-1 text-xs text-muted-foreground">Coloane: <code>{REQUIRED[kind].join(", ")}</code></p>
        </div>
        <button onClick={download} className="inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-medium text-brand-accent hover:bg-muted dark:text-primary">
          <Download aria-hidden className="size-4" /> Descarcă șablon
        </button>
      </div>
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) void handle(f); }}
        className={cn("mt-4 flex w-full flex-col items-center gap-2 rounded-lg border-2 border-dashed p-6 text-sm transition-colors", over ? "border-brand-accent bg-accent" : "hover:bg-muted")}
      >
        <FileUp aria-hidden className="size-6 text-muted-foreground" />
        <span><strong>Trage fișierul aici</strong> sau apasă pentru a-l alege</span>
        {loaded && <span className="text-xs text-risk-low">Încărcat: {loaded}</span>}
      </button>
      <input ref={input} type="file" accept=".csv,text/csv" className="sr-only" aria-label={`Alege ${meta.title}`}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void handle(f); e.target.value = ""; }} />
      <RemoteBox kind={kind} />
      {res && (
        <div className="mt-4 space-y-2" role="status">
          {res.errors.length === 0 ? (
            <p className="flex items-center gap-2 text-sm font-medium text-risk-low"><CheckCircle2 aria-hidden className="size-4" /> {res.name}: {num(res.rows.length)} rânduri valide.</p>
          ) : (
            <ul className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
              {res.errors.map((e) => <li key={e} className="flex gap-2"><AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" /> {e}</li>)}
            </ul>
          )}
          {res.warnings.map((w) => <p key={w} className="text-sm text-risk-moderate">⚠ {w}</p>)}
          {res.preview.length > 0 && (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-xs">
                <caption className="sr-only">Primele rânduri din {res.name}</caption>
                <thead className="bg-muted"><tr>{res.columns.map((c) => <th key={c} scope="col" className="px-2 py-1 text-left">{c}</th>)}</tr></thead>
                <tbody>{res.preview.map((r, i) => <tr key={i} className="border-t">{res.columns.map((c) => <td key={c} className="px-2 py-1">{r[c]}</td>)}</tr>)}</tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

const fmtDateTime = (iso?: string) => {
  if (!iso) return "—";
  const d = new Date(iso);
  const z = (n: number) => String(n).padStart(2, "0");
  return `${z(d.getDate())}.${z(d.getMonth() + 1)}.${d.getFullYear()} ${z(d.getHours())}:${z(d.getMinutes())}`;
};

function RemoteBox({ kind }: { kind: FileKind }) {
  const ews = useEws();
  const src = ews.sources[kind];
  const [url, setUrl] = useState(src?.url ?? "");
  const [busy, setBusy] = useState(false);
  const id = `url-${kind}`;
  const connect = async () => {
    setBusy(true);
    const ok = await ews.connectSource(kind, url);
    setBusy(false);
    if (ok) toast.success(`${FILE_LABELS[kind].title}: conectat prin link.`);
  };
  const chip = !src ? null : src.status === "loading"
    ? <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium"><Loader2 aria-hidden className="size-3 animate-spin" /> Se încarcă</span>
    : src.status === "ok"
      ? <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-risk-low"><CheckCircle2 aria-hidden className="size-3" /> Conectat</span>
      : <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive"><AlertCircle aria-hidden className="size-3" /> Eroare</span>;
  return (
    <div className="mt-4 rounded-lg border p-3">
      <label htmlFor={id} className="flex items-center gap-2 text-sm font-medium"><Link2 aria-hidden className="size-4" /> Încarcă din link</label>
      <p id={`${id}-h`} className="mt-1 text-xs text-muted-foreground">Link public https: GitHub (blob sau raw), Google Sheets sau orice fișier CSV.</p>
      <form className="mt-2 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); void connect(); }}>
        <input id={id} type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/…/predictions.csv"
          aria-describedby={`${id}-h`} className="min-h-11 min-w-0 flex-1 rounded-md border bg-card px-3 text-sm" />
        <button type="submit" disabled={busy || !url.trim()} className="inline-flex min-h-11 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60">
          {busy && <Loader2 aria-hidden className="size-4 animate-spin" />} Conectează
        </button>
      </form>
      {src && (
        <div className="mt-3 space-y-2 text-sm">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {chip}
            <span className="text-muted-foreground">Ultima actualizare: <strong className="text-foreground">{fmtDateTime(src.lastOk)}</strong></span>
            {src.rows !== undefined && <span className="text-muted-foreground">{num(src.rows)} rânduri{src.latestDate && <> · ultima dată {fmtDate(src.latestDate)}</>}</span>}
          </div>
          <p className="break-all text-xs text-muted-foreground">Sursă: {src.url}</p>
          {src.status === "error" && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2">
              <p className="font-medium">{src.error}</p>
              {src.hint && <p className="mt-1 text-xs">Sugestie: {src.hint}</p>}
              {src.lastOk && <p className="mt-1 text-xs text-muted-foreground">Se afișează în continuare ultimele date valide ({fmtDateTime(src.lastOk)}).</p>}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button onClick={() => void ews.refreshSources()} className="inline-flex min-h-11 items-center gap-2 rounded-md border px-3 text-sm hover:bg-muted"><RefreshCw aria-hidden className="size-4" /> Reîmprospătează acum</button>
            <button onClick={() => { ews.disconnectSource(kind); setUrl(""); }} className="inline-flex min-h-11 items-center gap-2 rounded-md border px-3 text-sm hover:bg-muted"><Unplug aria-hidden className="size-4" /> Deconectează</button>
          </div>
        </div>
      )}
    </div>
  );
}

function LinkConfig() {
  const ews = useEws();
  const [text, setText] = useState("");
  const links = Object.fromEntries(Object.entries(ews.sources).map(([k, v]) => [k, v!.url]));
  const has = Object.keys(links).length > 0;
  const copy = async (kind: "json" | "url") => {
    const enc = encodeConfig({ links, refresh: ews.refreshMinutes });
    const out = kind === "json" ? JSON.stringify({ links, refresh: ews.refreshMinutes }) : `${window.location.origin}${import.meta.env.BASE_URL}date?src=${enc}`;
    try { await navigator.clipboard.writeText(out); toast.success(kind === "json" ? "Configurația a fost copiată." : "Linkul de partajare a fost copiat."); }
    catch { toast.error("Nu am putut copia în clipboard."); }
  };
  const doImport = () => {
    const c = decodeConfig(text);
    if (!c) { toast.error("Configurația nu este validă. Lipește JSON-ul sau linkul cu ?src= primit de la coleg."); return; }
    ews.importConfig(c);
    setText("");
    toast.success("Configurația a fost importată. Se încarcă fișierele…");
  };
  return (
    <Card aria-labelledby="lnk-h">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-xl">
          <h2 id="lnk-h" className="text-base font-semibold">Surse din link și reîmprospătare</h2>
          <p className="mt-1 text-sm text-muted-foreground">Fișierele conectate prin link se reîncarcă la fiecare deschidere a aplicației și, opțional, periodic cât timp fila este deschisă și vizibilă. Notificările apar dacă datele noi diferă.</p>
        </div>
        <div className="flex flex-col gap-1">
          <span id="rf-l" className="text-sm font-medium">Reîmprospătare automată</span>
          <div role="radiogroup" aria-labelledby="rf-l" className="inline-flex rounded-lg border p-0.5">
            {([[0, "Oprit"], [5, "5 min"], [15, "15 min"], [60, "1 h"]] as [RefreshMinutes, string][]).map(([v, l]) => (
              <button key={v} role="radio" aria-checked={ews.refreshMinutes === v} onClick={() => ews.setRefreshMinutes(v)}
                className={cn("min-h-11 rounded-md px-3 text-sm font-medium", ews.refreshMinutes === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}>{l}</button>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button disabled={!has} onClick={() => void ews.refreshSources()} className="inline-flex min-h-11 items-center gap-2 rounded-md border px-3 text-sm hover:bg-muted disabled:opacity-50"><RefreshCw aria-hidden className="size-4" /> Reîmprospătează acum</button>
        <button disabled={!has} onClick={() => void copy("json")} className="inline-flex min-h-11 items-center gap-2 rounded-md border px-3 text-sm hover:bg-muted disabled:opacity-50"><ClipboardCopy aria-hidden className="size-4" /> Copiază configurația</button>
        <button disabled={!has} onClick={() => void copy("url")} className="inline-flex min-h-11 items-center gap-2 rounded-md border px-3 text-sm hover:bg-muted disabled:opacity-50"><Link2 aria-hidden className="size-4" /> Copiază link de partajare</button>
      </div>
      <form className="mt-3 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); doImport(); }}>
        <label htmlFor="cfg-in" className="sr-only">Importă configurația (JSON sau link cu ?src=)</label>
        <input id="cfg-in" value={text} onChange={(e) => setText(e.target.value)} placeholder="Lipește configurația JSON sau linkul ?src=…" className="min-h-11 min-w-0 flex-1 rounded-md border bg-card px-3 text-sm" />
        <button type="submit" disabled={!text.trim()} className="inline-flex min-h-11 items-center gap-2 rounded-md border px-3 text-sm hover:bg-muted disabled:opacity-50"><Upload aria-hidden className="size-4" /> Importă configurația</button>
      </form>
    </Card>
  );
}
