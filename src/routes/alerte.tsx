import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowUpDown, CheckCircle2, Download, Printer, UserRound, XCircle } from "lucide-react";
import { useEws, DEFAULT_PLAYBOOK } from "@/lib/ews/store";
import { byCategory, topDrivers } from "@/lib/ews/compute";
import { days, fmtContrib, fmtDate, pct } from "@/lib/ews/format";
import type { Alert, Level } from "@/lib/ews/types";
import { Card, CausalityNote, DivergingBars, InfoTip, LEVELS, LevelBadge, PageHeader } from "@/components/ews/ui";
import { ProbabilityChart } from "@/components/ews/ProbabilityChart";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { MailtoButton } from "@/components/ews/NotificationCenter";
import type { NotifEvent } from "@/lib/ews/notify";

export const Route = createFileRoute("/alerte")({
  validateSearch: (s: Record<string, unknown>) => ({ id: typeof s.id === "string" ? s.id : undefined }),
  head: () => ({
    meta: [
      { title: "Alerte și acțiuni · Sistem de avertizare timpurie" },
      { name: "description", content: "Episoadele de alertă Gama pentru BET, cine decide și ce acțiune urmează." },
      { property: "og:title", content: "Alerte și acțiuni · Sistem de avertizare timpurie" },
      { property: "og:description", content: "De la alertă la decizie: episoade, factori, responsabili și acțiuni." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AlertsPage,
});

type SortKey = "start" | "duration" | "peak" | "warning";

function AlertsPage() {
  const ews = useEws();
  const { alerts, hasOutcomes, settings, driversFor } = ews;
  const { id } = Route.useSearch();
  const navigate = useNavigate({ from: "/alerte" });
  const [filter, setFilter] = useState<Level | "all">("all");
  const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 }>({ k: "start", dir: -1 });
  const [report, setReport] = useState(false);

  const warnFor = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of alerts) if (a.confirmed === true && a.warningDays !== null) m.set(a.id, a.warningDays);
    return m;
  }, [alerts]);

  const rows = useMemo(() => {
    const r = alerts.filter((a) => filter === "all" || a.level === filter);
    const val = (a: Alert) => (sort.k === "start" ? a.startIdx : sort.k === "duration" ? a.duration : sort.k === "peak" ? a.peak : warnFor.get(a.id) ?? -1);
    return [...r].sort((a, b) => (val(a) - val(b)) * sort.dir);
  }, [alerts, filter, sort, warnFor]);

  const selected = alerts.find((a) => a.id === id);
  const trueEx = [...alerts].reverse().find((a) => a.confirmed === true);
  const falseEx = [...alerts].reverse().find((a) => a.confirmed === false);

  const topNames = (a: Alert) => topDrivers(driversFor(a.peakDate), 3).filter((d) => d.contribution > 0).map((d) => d.label ?? d.feature);

  const exportCsv = () => {
    const head = ["start", "end", "duration_days", "peak_probability", "level", "top_drivers", ...(hasOutcomes ? ["outcome", "warning_days"] : [])];
    const lines = alerts.map((a) => [a.start, a.end, a.duration, a.peak.toFixed(4), LEVELS[a.level].label, `"${topNames(a).join("; ")}"`,
      ...(hasOutcomes ? [a.confirmed === null ? (a.active ? "in_desfasurare" : "") : a.confirmed ? "confirmata" : "alarma_falsa", warnFor.get(a.id) ?? ""] : [])].join(","));
    const blob = new Blob([[head.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "alerte_ews_bet.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  const SortBtn = ({ k, children }: { k: SortKey; children: string }) => (
    <button
      onClick={() => setSort((s) => ({ k, dir: s.k === k ? ((-s.dir) as 1 | -1) : -1 }))}
      className="inline-flex min-h-9 items-center gap-1 font-semibold hover:underline"
      aria-label={`Sortează după ${children}`}
    >
      {children} <ArrowUpDown aria-hidden className="size-3.5" />
    </button>
  );
  const ariaSort = (k: SortKey) => (sort.k === k ? (sort.dir === 1 ? "ascending" : "descending") : "none");

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="03 — Alerte"
        title="Alerte și acțiuni"
        desc={`O alertă pornește când probabilitatea stă peste pragul de ${pct(ews.thr.alert, 0)} timp de ${days(settings.confirmDays)} de tranzacționare consecutive.`}
        actions={
          <div className="flex flex-wrap gap-2">
            <button onClick={exportCsv} className="inline-flex min-h-11 items-center gap-2 rounded-md border bg-card px-4 text-sm font-medium hover:bg-muted">
              <Download aria-hidden className="size-4" /> Exportă CSV
            </button>
            <button onClick={() => setReport(true)} className="inline-flex min-h-11 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground">
              <Printer aria-hidden className="size-4" /> Raport de risc
            </button>
          </div>
        }
      />

      <Card aria-labelledby="ep-h">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 id="ep-h" className="text-base font-semibold">Episoade de alertă ({rows.length})</h2>
          <label className="flex items-center gap-2 text-sm">
            Nivel
            <select value={filter} onChange={(e) => setFilter(e.target.value as Level | "all")} className="min-h-11 rounded-md border bg-card px-2">
              <option value="all">Toate</option>
              <option value="moderate">Moderat</option>
              <option value="high">Ridicat</option>
            </select>
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b text-left text-muted-foreground">
              <tr>
                <th scope="col" aria-sort={ariaSort("start")} className="py-2 pr-3"><SortBtn k="start">Început</SortBtn></th>
                <th scope="col" className="py-2 pr-3">Sfârșit</th>
                <th scope="col" aria-sort={ariaSort("duration")} className="py-2 pr-3"><SortBtn k="duration">Durată</SortBtn></th>
                <th scope="col" aria-sort={ariaSort("peak")} className="py-2 pr-3"><SortBtn k="peak">Vârf</SortBtn></th>
                <th scope="col" className="py-2 pr-3">Nivel</th>
                <th scope="col" className="py-2 pr-3">Factori principali</th>
                {hasOutcomes && <th scope="col" className="py-2 pr-3">Rezultat</th>}
                {hasOutcomes && <th scope="col" aria-sort={ariaSort("warning")} className="py-2 pr-3"><SortBtn k="warning">Avans</SortBtn></th>}
                <th scope="col"><span className="sr-only">Detalii</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className="border-b last:border-0">
                  <td className="py-2 pr-3 font-medium tabular-nums">{fmtDate(a.start)}</td>
                  <td className="py-2 pr-3 tabular-nums">{a.active ? "în desfășurare" : fmtDate(a.end)}</td>
                  <td className="py-2 pr-3">{days(a.duration)}</td>
                  <td className="py-2 pr-3 font-semibold tabular-nums">{pct(a.peak)}</td>
                  <td className="py-2 pr-3"><LevelBadge level={a.level} /></td>
                  <td className="max-w-64 truncate py-2 pr-3 text-muted-foreground">{topNames(a).join(", ") || "—"}</td>
                  {hasOutcomes && <td className="py-2 pr-3"><Outcome a={a} /></td>}
                  {hasOutcomes && <td className="py-2 pr-3 tabular-nums">{warnFor.has(a.id) ? days(warnFor.get(a.id)!) : "—"}</td>}
                  <td className="py-2 text-right">
                    <button onClick={() => navigate({ search: { id: a.id } })} className="min-h-11 rounded-md px-3 font-medium text-brand-accent hover:bg-muted dark:text-primary">
                      Detalii<span className="sr-only"> alertă {fmtDate(a.start)}</span>
                    </button>
                  </td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={9} className="py-8 text-center text-muted-foreground">Nicio alertă pentru filtrul ales.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {hasOutcomes && (trueEx || falseEx) && (
        <section aria-labelledby="ex-h">
          <h2 id="ex-h" className="mb-3 text-lg font-semibold">Exemple pentru demo</h2>
          <div className="grid gap-6 lg:grid-cols-2">
            {trueEx && <Example a={trueEx} kind="true" onOpen={() => navigate({ search: { id: trueEx.id } })} />}
            {falseEx && <Example a={falseEx} kind="false" onOpen={() => navigate({ search: { id: falseEx.id } })} />}
          </div>
        </section>
      )}

      <PlaybookEditor />

      <Sheet open={!!selected} onOpenChange={(o) => !o && navigate({ search: { id: undefined } })}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          {selected && <AlertDetail a={selected} />}
        </SheetContent>
      </Sheet>

      <Dialog open={report} onOpenChange={setReport}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader><DialogTitle>Raport de risc</DialogTitle></DialogHeader>
          <RiskReport />
          <button onClick={() => window.print()} className="mt-2 inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground">
            <Printer aria-hidden className="size-4" /> Tipărește / salvează PDF
          </button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Outcome({ a }: { a: Alert }) {
  if (a.confirmed === null) return <span className="text-muted-foreground">{a.active ? "În desfășurare" : "În așteptare"}</span>;
  return a.confirmed ? (
    <span className="inline-flex items-center gap-1 font-medium text-risk-low"><CheckCircle2 aria-hidden className="size-4" /> Confirmată</span>
  ) : (
    <span className="inline-flex items-center gap-1 font-medium text-muted-foreground"><XCircle aria-hidden className="size-4" /> Alarmă falsă</span>
  );
}

function Decision({ a }: { a: Alert }) {
  const { settings } = useEws();
  const pb = settings.playbook[a.level] ?? DEFAULT_PLAYBOOK[a.level];
  return (
    <div className="rounded-lg border-l-4 bg-muted p-4" style={{ borderColor: LEVELS[a.level].color }}>
      <p className="flex items-center gap-2 text-sm font-semibold"><UserRound aria-hidden className="size-4" /> Decide: {pb.owner}</p>
      <p className="mt-1 text-sm">{pb.action}</p>
    </div>
  );
}

function Example({ a, kind, onOpen }: { a: Alert; kind: "true" | "false"; onOpen: () => void }) {
  const ews = useEws();
  const top = topDrivers(ews.driversFor(a.peakDate), 4);
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={cn("text-sm font-bold uppercase tracking-wide", kind === "true" ? "text-risk-low" : "text-muted-foreground")}>
          {kind === "true" ? "✓ Alertă adevărată" : "✗ Alarmă falsă"}
        </p>
        <LevelBadge level={a.level} />
      </div>
      <p className="mt-2 text-sm">
        {fmtDate(a.start)} – {fmtDate(a.end)} · vârf <strong>{pct(a.peak)}</strong> · {days(a.duration)}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        {kind === "true" ? "BET a scăzut cu cel puțin 5% în cele 20 de zile de după alertă." : "BET nu a scăzut cu 5% în cele 20 de zile de după alertă — costul a fost doar unul de prudență."}
      </p>
      <div className="mt-4"><DivergingBars unit={ews.settings.shapUnit} items={top.map((t) => ({ key: t.feature, label: t.label ?? t.feature, sub: t.category, value: t.contribution }))} /></div>
      <div className="mt-4"><Decision a={a} /></div>
      <MailtoButton className="-ml-3" events={[alertToEvent(a, ews)]} />
      <button onClick={onOpen} className="mt-3 min-h-11 text-sm font-medium text-brand-accent hover:underline dark:text-primary">Vezi detaliile alertei</button>
    </Card>
  );
}

function AlertDetail({ a }: { a: Alert }) {
  const ews = useEws();
  const from = Math.max(0, a.firstAboveIdx - 30);
  const to = Math.min(ews.fullSeries.length - 1, a.endIdx + 25);
  const path = ews.fullSeries.slice(from, to + 1);
  const drivers = ews.driversFor(a.peakDate);
  const cats = byCategory(drivers);
  return (
    <div className="space-y-5">
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2">Alertă din {fmtDate(a.start)} <LevelBadge level={a.level} /></SheetTitle>
        <SheetDescription>
          {a.active ? "În desfășurare" : `Până la ${fmtDate(a.end)}`} · {days(a.duration)} · vârf {pct(a.peak)} pe {fmtDate(a.peakDate)}
        </SheetDescription>
      </SheetHeader>
      {ews.hasOutcomes && <Outcome a={a} />}
      <div>
        <h3 className="mb-2 text-sm font-semibold">Traiectoria probabilității</h3>
        <ProbabilityChart data={path} alert={ews.thr.alert} high={ews.thr.high} alerts={[a]} height={200} showBet={false} driversFor={ews.driversFor} unit={ews.settings.shapUnit} selected={a.peakDate} />
      </div>
      <div>
        <h3 className="mb-2 text-sm font-semibold">Factori la vârf (SHAP)</h3>
        <DivergingBars unit={ews.settings.shapUnit} items={topDrivers(drivers, 6).map((t) => ({ key: t.feature, label: t.label ?? t.feature, sub: t.category, value: t.contribution }))} />
      </div>
      <div>
        <h3 className="mb-2 text-sm font-semibold">Pe categorii</h3>
        <ul className="space-y-1 text-sm">
          {cats.slice(0, 5).map((c) => (
            <li key={c.category} className="flex justify-between"><span>{c.category}</span>
              <span className={c.value >= 0 ? "font-semibold text-risk-up-text" : "font-semibold text-risk-down-text"}>{fmtContrib(c.value, ews.settings.shapUnit)}</span></li>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="mb-2 text-sm font-semibold">Acțiune recomandată</h3>
        <Decision a={a} />
        <MailtoButton className="mt-2 -ml-3" events={[alertToEvent(a, ews)]} />
      </div>
      <CausalityNote />
    </div>
  );
}

function PlaybookEditor() {
  const { settings, updateSettings } = useEws();
  const set = (l: Level, k: "action" | "owner", v: string) =>
    updateSettings({ playbook: { ...settings.playbook, [l]: { ...settings.playbook[l], [k]: v } } });
  return (
    <Card aria-labelledby="pb-h">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <h2 id="pb-h" className="text-base font-semibold">Plan de acțiune pe niveluri</h2>
          <InfoTip term="Plan de acțiune">Cine decide și ce face pentru fiecare nivel de risc. Modificările se salvează automat în acest browser.</InfoTip>
        </div>
        <button onClick={() => updateSettings({ playbook: DEFAULT_PLAYBOOK })} className="min-h-11 rounded-md px-3 text-sm text-muted-foreground hover:bg-muted">
          Revino la implicit
        </button>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        {(["low", "moderate", "high"] as Level[]).map((l) => (
          <div key={l} className="rounded-lg border p-4">
            <LevelBadge level={l} />
            <label className="mt-3 block text-sm font-medium">
              Responsabil
              <input value={settings.playbook[l].owner} onChange={(e) => set(l, "owner", e.target.value)} className="mt-1 block min-h-11 w-full rounded-md border bg-card px-3" />
            </label>
            <label className="mt-3 block text-sm font-medium">
              Acțiune
              <textarea value={settings.playbook[l].action} onChange={(e) => set(l, "action", e.target.value)} rows={4} className="mt-1 block w-full rounded-md border bg-card px-3 py-2" />
            </label>
          </div>
        ))}
      </div>
    </Card>
  );
}

function RiskReport() {
  const ews = useEws();
  const d = ews.fullSeries.at(-1);
  if (!d) return null;
  const top = topDrivers(ews.driversFor(d.date), 5);
  const pb = ews.settings.playbook[d.level];
  return (
    <div id="raport" className="space-y-4 text-sm">
      <h1 className="text-xl font-bold">Raport de risc · {fmtDate(d.date)}</h1>
      <p><strong>Nivel: {LEVELS[d.level].label}</strong> — probabilitate de {pct(d.p)} ca BET să scadă cu ≥5% în următoarele 20 de zile de tranzacționare.</p>
      <p>Praguri: alertă {pct(ews.thr.alert)}, ridicat {pct(ews.thr.high)}.</p>
      <div><strong>Factori principali:</strong>
        <ul className="list-disc pl-5">{top.map((t) => <li key={t.feature}>{t.label ?? t.feature} ({t.category}): {fmtContrib(t.contribution, ews.settings.shapUnit)}</li>)}</ul>
      </div>
      <p><strong>Decide:</strong> {pb.owner}. <strong>Acțiune:</strong> {pb.action}</p>
      <div><strong>Ultimele alerte:</strong>
        <ul className="list-disc pl-5">{[...ews.alerts].reverse().slice(0, 8).map((a) => <li key={a.id}>{fmtDate(a.start)} – {a.active ? "în curs" : fmtDate(a.end)}, vârf {pct(a.peak)}, {LEVELS[a.level].label}</li>)}</ul>
      </div>
      <p className="text-xs">Explicația arată contribuții, nu cauzalitate. {ews.isDemo && "Raport generat pe date demonstrative."}</p>
    </div>
  );
}

function alertToEvent(a: Alert, ews: ReturnType<typeof useEws>): NotifEvent {
  const pb = ews.settings.playbook[a.level];
  return {
    id: a.id, createdAt: "", date: a.start, asset: ews.asset, type: "alertStart", severity: a.level === "high" ? "critic" : "avertizare",
    title: `Alertă Gama din ${fmtDate(a.start)} (vârf ${pct(a.peak)})`, from: "fără alertă", to: a.active ? "alertă activă" : `încheiată ${fmtDate(a.end)}`,
    level: a.level, p: a.peak,
    drivers: topDrivers(ews.driversFor(a.peakDate), 3).map((d) => `${d.label ?? d.feature} (${fmtContrib(d.contribution, ews.settings.shapUnit)})`),
    action: pb.action, owner: pb.owner, read: true,
  };
}
