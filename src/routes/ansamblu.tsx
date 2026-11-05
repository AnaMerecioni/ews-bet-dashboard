import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowDownRight, ArrowRight, ArrowUpRight, BellRing, X } from "lucide-react";
import { useEws } from "@/lib/ews/store";
import { byCategory, topDrivers } from "@/lib/ews/compute";
import { days, fmtContrib, fmtDate, fmtMonth, pct, pp } from "@/lib/ews/format";
import { Card, ChartCard, CausalityNote, DivergingBars, InfoTip, LEVELS, LevelBadge } from "@/components/ews/ui";
import { ProbabilityChart } from "@/components/ews/ProbabilityChart";
import { QuickQuestions } from "@/components/ews/Ask";
import { usePresentation } from "@/components/ews/Presentation";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/ansamblu")({
  head: () => ({
    meta: [
      { title: "Privire de ansamblu · Sistem de avertizare timpurie" },
      { name: "description", content: "Starea de risc de azi pentru BET: probabilitate de stres pe 20 de zile, nivel, alerte și factori principali." },
      { property: "og:title", content: "Privire de ansamblu · Sistem de avertizare timpurie" },
      { property: "og:description", content: "Probabilitatea unui episod de stres al BET, nivelul de risc și factorii principali, pe un singur ecran." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Overview,
});

// Culorile categoriilor vin din tema KPMG (src/styles.css: --cat-1 … --cat-8)
const CAT_COLORS = Array.from({ length: 8 }, (_, i) => `var(--cat-${i + 1})`);

function Overview() {
  const ews = useEws();
  const { fullSeries, series, thr, alerts, selectedDate, setSelectedDate, driversFor, settings, lastDate, indexOf } = ews;
  const [catView, setCatView] = useState<"day" | "time">("day");

  const idx = indexOf(selectedDate);
  const day = fullSeries[idx];
  const prev = fullSeries[Math.max(0, idx - 5)];
  const activeAlert = alerts.find((a) => a.startIdx <= idx && a.endIdx >= idx);
  const drivers = driversFor(selectedDate);
  const top5 = topDrivers(drivers, 5);
  const cats = byCategory(drivers);

  const catSeries = useMemo(() => {
    if (catView !== "time") return [];
    return series.map((d) => {
      const row: Record<string, number | string> = { date: d.date };
      for (const c of byCategory(ews.driversFor(d.date))) row[c.category] = c.value;
      return row;
    });
  }, [catView, series, ews]);

  if (!day) return <div className="h-96 animate-pulse rounded-xl bg-muted" aria-label="Se încarcă" />;
  const L = LEVELS[day.level];
  const delta = day.p - prev.p;
  const recent = [...alerts].reverse().slice(0, 5);

  return (
    <div className="space-y-6">
      <div aria-live="polite" className="sr-only">
        Ziua selectată {fmtDate(day.date)}: risc {L.label}, probabilitate {pct(day.p)}.
      </div>
      <h1 className="sr-only">Privire de ansamblu</h1>
      <QuickQuestions ids={["today", "alert", "week", "why", "action", "lastAlert"]} />

      <div className="grid gap-6 xl:grid-cols-12">
        <Card className="xl:col-span-4" id="tour-status" aria-labelledby="status-h">
          <div className="flex items-center justify-between gap-2">
            <h2 id="status-h" className="text-sm font-semibold text-muted-foreground">
              {day.date === lastDate ? "Starea de azi" : "Ziua selectată"} · {fmtDate(day.date)}
            </h2>
            {day.date !== lastDate && (
              <button onClick={() => setSelectedDate(null)} className="min-h-11 rounded-md px-2 text-sm font-medium text-brand-accent hover:underline dark:text-primary">
                Înapoi la azi
              </button>
            )}
          </div>
          <div className="mt-4 flex flex-wrap items-end gap-4">
            <LevelBadge level={day.level} size="lg" />
          </div>
          <p className="text-gradient mt-4 inline-block pb-1 font-display text-7xl font-bold leading-none tabular-nums tracking-tight">{pct(day.p, 1)}</p>
          <p className="mt-3 text-[15px] leading-relaxed">
            <strong>Risc {L.upper}:</strong> probabilitate de {pct(day.p, 1)} ca BET să scadă cu cel puțin 5% în următoarele 20 de zile de tranzacționare.
          </p>
          <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg bg-muted p-3">
              <dt className="text-muted-foreground">Față de acum 5 zile</dt>
              <dd className={cn("mt-1 flex items-center gap-1 text-base font-semibold", delta > 0 ? "text-risk-up-text" : "text-risk-down-text")}>
                {delta >= 0 ? <ArrowUpRight aria-hidden className="size-4" /> : <ArrowDownRight aria-hidden className="size-4" />}
                {pp(delta)}
              </dd>
            </div>
            <div className="rounded-lg bg-muted p-3">
              <dt className="text-muted-foreground">Alertă EWS</dt>
              <dd className="mt-1 text-base font-semibold">
                {activeAlert ? (
                  <span className="flex items-center gap-1 text-risk-up-text"><BellRing aria-hidden className="size-4" /> Activă din {fmtDate(activeAlert.start)}</span>
                ) : "Nicio alertă activă"}
              </dd>
            </div>
          </dl>
        </Card>

        <ChartCard
          id="tour-chart"
          className="xl:col-span-8"
          title="Probabilitatea de stres în timp"
          info={<>Probabilitatea estimată de model ca BET să scadă cu ≥5% în următoarele 20 de zile de tranzacționare. Fă clic pe o zi pentru a o selecta.</>}
          summary={`Între ${fmtDate(series[0]?.date)} și ${fmtDate(series.at(-1)?.date ?? "")} probabilitatea a variat între ${pct(Math.min(...series.map((d) => d.p)))} și ${pct(Math.max(...series.map((d) => d.p)))}. ${alerts.length} alerte în total.`}
          table={{
            headers: ["Data", "Probabilitate", "Nivel"],
            rows: [...series].reverse().map((d) => [fmtDate(d.date), pct(d.p), LEVELS[d.level].label]),
          }}
        >
          <ProbabilityChart
            data={series}
            alert={thr.alert}
            high={thr.high}
            alerts={alerts}
            selected={selectedDate}
            onSelect={setSelectedDate}
            driversFor={driversFor}
            unit={settings.shapUnit}
          />
        </ChartCard>
      </div>

      <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
        <ChartCard
          id="tour-drivers"
          title="Ce împinge riscul azi"
          info={<>Contribuțiile SHAP: cât adaugă (roșu ▲) sau scade (albastru ▼) fiecare variabilă din probabilitatea zilei {fmtDate(selectedDate)}.</>}
          summary={top5.map((t) => `${t.label ?? t.feature}: ${fmtContrib(t.contribution, settings.shapUnit)}`).join("; ")}
          table={{ headers: ["Factor", "Categorie", "Contribuție"], rows: top5.map((t) => [t.label ?? t.feature, t.category, fmtContrib(t.contribution, settings.shapUnit)]) }}
        >
          <DivergingBars unit={settings.shapUnit} items={top5.map((t) => ({ key: t.feature, label: t.label ?? t.feature, sub: t.category, value: t.contribution }))} />
          <div className="mt-4"><CausalityNote /></div>
        </ChartCard>

        <ChartCard
          id="tour-cats"
          title="Pe categorii de risc"
          info="Suma contribuțiilor variabilelor din fiecare categorie."
          summary={cats.map((c) => `${c.category}: ${fmtContrib(c.value, settings.shapUnit)}`).join("; ")}
          table={{ headers: ["Categorie", "Contribuție"], rows: cats.map((c) => [c.category, fmtContrib(c.value, settings.shapUnit)]) }}
          actions={
            <div role="group" aria-label="Vizualizare categorii" className="flex rounded-md border p-0.5">
              {(["day", "time"] as const).map((v) => (
                <button key={v} aria-pressed={catView === v} onClick={() => setCatView(v)}
                  className={cn("min-h-10 rounded px-2.5 text-sm", catView === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}>
                  {v === "day" ? "Ziua" : "În timp"}
                </button>
              ))}
            </div>
          }
        >
          {catView === "day" ? (
            <DivergingBars unit={settings.shapUnit} items={cats.map((c) => ({ key: c.category, label: c.category, value: c.value }))} />
          ) : (
            <div className="h-72">
              <ResponsiveContainer>
                <AreaChart data={catSeries} stackOffset="sign" margin={{ left: 0, right: 8, top: 4 }}>
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="date" tickFormatter={fmtMonth} minTickGap={40} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                  <YAxis tickFormatter={(v) => (settings.shapUnit === "pp" ? pct(v, 0) : String(v))} width={44} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                  <Tooltip
                    labelFormatter={(l) => fmtDate(String(l))}
                    formatter={(v: number, n) => [fmtContrib(v, settings.shapUnit), n]}
                    contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                  />
                  {ews.categories.map((c, i) => (
                    <Area key={c} dataKey={c} stackId="1" stroke={CAT_COLORS[i % 8]} fill={CAT_COLORS[i % 8]} fillOpacity={0.55} isAnimationActive={false} />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </ChartCard>

        <Card id="tour-alerts" className="lg:col-span-2 xl:col-span-1" aria-labelledby="recent-h">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-1">
              <h2 id="recent-h" className="text-base font-semibold">Alerte recente</h2>
              <InfoTip term="Alertă EWS">
                Se declanșează când probabilitatea depășește pragul de alertă ({pct(thr.alert, 0)}) {settings.confirmDays} zile consecutive.
              </InfoTip>
            </div>
            <Link to="/alerte" search={{ id: undefined }} className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-brand-accent hover:underline dark:text-primary">
              Toate <ArrowRight aria-hidden className="size-4" />
            </Link>
          </div>
          {recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nicio alertă în perioada analizată.</p>
          ) : (
            <ul className="divide-y">
              {recent.map((a) => {
                const c = byCategory(driversFor(a.peakDate)).filter((x) => x.value > 0).slice(0, 2);
                return (
                  <li key={a.id}>
                    <Link to="/alerte" search={{ id: a.id }} className="flex items-center gap-3 rounded-md py-3 hover:bg-muted/60">
                      <LevelBadge level={a.level} />
                      <div className="min-w-0 flex-1 text-sm">
                        <p className="font-medium">
                          {fmtDate(a.start)} · {days(a.duration)} {a.active && <span className="text-risk-up-text">(activă)</span>}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">Vârf {pct(a.peak)} · {c.map((x) => x.category).join(", ") || "—"}</p>
                      </div>
                      <ArrowRight aria-hidden className="size-4 text-muted-foreground" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
      <Tour />
    </div>
  );
}

const STEPS = [
  { id: "tour-status", title: "1. Starea de azi", text: "Nivelul de risc, probabilitatea și dacă există o alertă activă — totul dintr-o privire." },
  { id: "tour-chart", title: "2. Graficul", text: "Evoluția probabilității cu benzile Scăzut / Moderat / Ridicat. Fă clic pe o zi pentru a o analiza." },
  { id: "tour-drivers", title: "3. Factorii", text: "Ce variabile cresc (roșu) sau scad (albastru) riscul în ziua selectată." },
];

function Tour() {
  const { settings, updateSettings, hydrated } = useEws();
  const [step, setStep] = useState(0);
  const { active } = usePresentation();
  const open = hydrated && !settings.tourDone && !active;
  useEffect(() => {
    if (!open) return;
    const el = document.getElementById(STEPS[step].id);
    el?.setAttribute("data-tour-active", "true");
    el?.scrollIntoView({ block: "center", behavior: settings.reduceMotion ? "auto" : "smooth" });
    return () => el?.removeAttribute("data-tour-active");
  }, [open, step, settings.reduceMotion]);
  if (!open) return null;
  const s = STEPS[step];
  const close = () => updateSettings({ tourDone: true });
  return (
    <div role="dialog" aria-labelledby="tour-t" className="card-surface fixed bottom-20 right-4 z-50 w-[min(360px,calc(100vw-2rem))] p-5 md:bottom-6">
      <div className="flex items-start justify-between gap-2">
        <h2 id="tour-t" className="font-semibold">{s.title}</h2>
        <button onClick={close} aria-label="Închide turul" className="-m-2 flex size-11 items-center justify-center rounded-md hover:bg-muted">
          <X aria-hidden className="size-4" />
        </button>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{s.text}</p>
      <div className="mt-4 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Pasul {step + 1} din 3</span>
        <button
          onClick={() => (step < 2 ? setStep(step + 1) : close())}
          className="min-h-11 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground"
          autoFocus
        >
          {step < 2 ? "Înainte" : "Am înțeles"}
        </button>
      </div>
    </div>
  );
}
