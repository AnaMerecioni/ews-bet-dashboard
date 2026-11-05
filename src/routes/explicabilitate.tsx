import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Lightbulb } from "lucide-react";
import { useEws } from "@/lib/ews/store";
import { baseValue, levelOf, whatIf } from "@/lib/ews/compute";
import { fmtContrib, fmtDate, fmtMonth, num, pct } from "@/lib/ews/format";
import { Card, CausalityNote, ChartCard, EmptyState, LEVELS, LevelBadge, PageHeader } from "@/components/ews/ui";
import { Slider } from "@/components/ui/slider";
import { ErrorSection } from "@/components/ews/ErrorSection";
import { ExternalContext } from "@/components/ews/ExternalContext";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/explicabilitate")({
  validateSearch: (s: Record<string, unknown>) => ({ cat: typeof s.cat === "string" ? s.cat : undefined }),
  head: () => ({
    meta: [
      { title: "Explicabilitate · Sistem de avertizare timpurie" },
      { name: "description", content: "Contribuții SHAP, importanța categoriilor de risc și scenarii „ce-ar fi dacă” pentru BET." },
      { property: "og:title", content: "Explicabilitate · Sistem de avertizare timpurie" },
      { property: "og:description", content: "De ce spune modelul ce spune: factori, sensibilitate și scenarii." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Explain,
});

function Explain() {
  const ews = useEws();
  const { selectedDate, setSelectedDate, driversFor, settings, fullSeries, indexOf, hasDrivers, series } = ews;
  const unit = settings.shapUnit;
  const day = fullSeries[indexOf(selectedDate)];
  const rows = driversFor(selectedDate);

  const importance = useMemo(() => {
    const m = new Map<string, number>();
    let n = 0;
    for (const d of series) {
      const r = ews.driverMap.get(d.date);
      if (!r) continue;
      n++;
      const cat = new Map<string, number>();
      for (const x of r) cat.set(x.category, (cat.get(x.category) ?? 0) + x.contribution);
      for (const [c, v] of cat) m.set(c, (m.get(c) ?? 0) + Math.abs(v));
    }
    return [...m.entries()].map(([category, v]) => ({ category, value: n ? v / n : 0 })).sort((a, b) => b.value - a.value);
  }, [series, ews.driverMap]);

  if (!hasDrivers) {
    return (
      <div>
        <PageHeader eyebrow="04 — De ce?" title="Explicabilitate" />
        <EmptyState icon={Lightbulb} title="Lipsesc factorii SHAP">
          Încarcă fișierul <strong>drivers.csv</strong> pe pagina Date pentru a vedea ce împinge riscul, pe variabile și categorii.
        </EmptyState>
        <div className="mt-12 space-y-12">
          <ErrorSection />
          <ExternalContext />
        </div>
      </div>
    );
  }

  const onPick = (v: string) => {
    const cand = fullSeries.find((d) => d.date >= v) ?? fullSeries.at(-1);
    if (cand) setSelectedDate(cand.date);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="04 — De ce?"
        title="Explicabilitate"
        desc="Cum ajunge modelul la probabilitatea zilei: de la valoarea de bază, prin contribuția fiecărei variabile."
        actions={
          <label className="flex items-center gap-2 text-sm font-medium">
            Ziua analizată
            <input type="date" value={selectedDate} min={fullSeries[0]?.date} max={ews.lastDate} onChange={(e) => onPick(e.target.value)}
              className="min-h-11 rounded-md border bg-card px-2" />
          </label>
        }
      />
      <CausalityNote />
      <div className="grid gap-6 xl:grid-cols-2">
        {day && <Waterfall p={day.p} rows={rows} unit={unit} date={selectedDate} />}
        <ChartCard
          title="Importanța categoriilor"
          info="Media contribuției absolute pe categorie în intervalul selectat — cât de mult mișcă de obicei fiecare categorie probabilitatea."
          summary={importance.map((i) => `${i.category}: ${fmtContrib(i.value, unit).replace("+", "")}`).join("; ")}
          table={{ headers: ["Categorie", "Contribuție medie absolută"], rows: importance.map((i) => [i.category, fmtContrib(i.value, unit).replace("+", "")]) }}
        >
          <div style={{ height: Math.max(220, importance.length * 38) }}>
            <ResponsiveContainer>
              <BarChart data={importance} layout="vertical" margin={{ left: 8, right: 40 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="category" width={150} tick={{ fontSize: 12, fill: "var(--foreground)" }} axisLine={false} tickLine={false} />
                <Tooltip formatter={(v: number) => fmtContrib(v, unit).replace("+", "")} contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8 }} />
                <Bar dataKey="value" fill="var(--brand-accent)" radius={[0, 4, 4, 0]} isAnimationActive={false}
                  label={{ position: "right", formatter: (v: number) => fmtContrib(v, unit).replace("+", ""), fontSize: 11, fill: "var(--muted-foreground)" }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      </div>
      <div className="py-6"><ErrorSection /></div>
      <FeatureOverTime />
      {ews.sensitivity && <SensitivityTool />}
      {day && <ScenarioTool p={day.p} />}
      <div className="pt-6"><ExternalContext /></div>
    </div>
  );
}

function Waterfall({ p, rows, unit, date }: { p: number; rows: ReturnType<ReturnType<typeof useEws>["driversFor"]>; unit: "pp" | "logit"; date: string }) {
  const base = baseValue(p, rows, unit);
  const sorted = [...rows].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  const top = sorted.slice(0, 10);
  const rest = sorted.slice(10).reduce((s, r) => s + r.contribution, 0);
  const items = [...top.map((r) => ({ key: r.feature, label: r.label ?? r.feature, v: r.contribution })), ...(sorted.length > 10 ? [{ key: "_rest", label: `Alte ${sorted.length - 10} variabile`, v: rest }] : [])];
  const final = unit === "pp" ? p : Math.log(p / (1 - p));
  let cum = base;
  const steps = items.map((it) => { const s = cum; cum += it.v; return { ...it, s, e: cum }; });
  const vals = [base, final, ...steps.flatMap((s) => [s.s, s.e])];
  const lo = Math.min(0, ...vals), hi = Math.max(...vals);
  const x = (v: number) => ((v - lo) / (hi - lo || 1)) * 100;
  const fmtV = (v: number) => (unit === "pp" ? pct(v) : num(v, 2));
  return (
    <ChartCard
      title={`Cascadă SHAP · ${fmtDate(date)}`}
      info={<>Pornește de la valoarea de bază a modelului (media), adaugă contribuția fiecărei variabile și ajunge la probabilitatea zilei. Unitate: {unit === "pp" ? "procente din probabilitate" : "log-odds"}.</>}
      summary={`Valoare de bază ${fmtV(base)}, probabilitate finală ${pct(p)}.`}
      table={{ headers: ["Pas", "Contribuție", "Cumulat"], rows: [["Valoare de bază", "", fmtV(base)], ...steps.map((s) => [s.label, fmtContrib(s.v, unit), fmtV(s.e)]), ["Final", "", fmtV(final)]] }}
    >
      <ul className="space-y-1.5 text-sm">
        {[{ key: "_b", label: "Valoare de bază", s: lo, e: base, v: 0, kind: "total" }, ...steps.map((s) => ({ ...s, kind: "step" })), { key: "_f", label: "Probabilitate finală", s: lo, e: final, v: 0, kind: "total" }].map((s) => {
          const a = Math.min(x(s.s), x(s.e)), w = Math.abs(x(s.e) - x(s.s));
          return (
            <li key={s.key} className="grid grid-cols-[minmax(0,10rem)_1fr_5.5rem] items-center gap-3">
              <span className={cn("truncate", s.kind === "total" && "font-semibold")} title={s.label}>{s.label}</span>
              <div className="relative h-5 rounded-sm bg-muted/60" aria-hidden>
                <div className={cn("absolute inset-y-0.5 rounded-sm", s.kind === "total" ? "bg-brand" : s.v >= 0 ? "bg-risk-up" : "bg-risk-down")}
                  style={{ left: `${a}%`, width: `${Math.max(w, 0.6)}%` }} />
              </div>
              <span className={cn("text-right tabular-nums", s.kind === "total" ? "font-bold" : s.v >= 0 ? "text-risk-up-text" : "text-risk-down-text")}>
                {s.kind === "total" ? fmtV(s.e) : fmtContrib(s.v, unit)}
              </span>
            </li>
          );
        })}
      </ul>
    </ChartCard>
  );
}

function FeatureOverTime() {
  const ews = useEws();
  const [f, setF] = useState(ews.features[0]?.feature ?? "");
  const data = useMemo(() => ews.series.map((d) => {
    const r = ews.driverMap.get(d.date)?.find((x) => x.feature === f);
    return { date: d.date, c: r?.contribution ?? null, v: r?.value ?? null };
  }), [ews.series, ews.driverMap, f]);
  const meta = ews.features.find((x) => x.feature === f);
  return (
    <ChartCard
      title="O variabilă în timp"
      info="Contribuția SHAP a variabilei alese, zi de zi. Peste zero împinge riscul în sus."
      summary={`Contribuția variabilei ${meta?.label ?? f} în intervalul selectat.`}
      table={{ headers: ["Data", "Contribuție", "Valoare"], rows: [...data].reverse().map((d) => [fmtDate(d.date), d.c === null ? "—" : fmtContrib(d.c, ews.settings.shapUnit), d.v === null ? "—" : num(d.v, 2)]) }}
      actions={
        <label className="flex items-center gap-2 text-sm">
          <span className="sr-only">Variabila</span>
          <select value={f} onChange={(e) => setF(e.target.value)} className="min-h-11 max-w-64 rounded-md border bg-card px-2">
            {ews.categories.map((c) => (
              <optgroup key={c} label={c}>
                {ews.features.filter((x) => x.category === c).map((x) => <option key={x.feature} value={x.feature}>{x.label}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
      }
    >
      <div className="h-64">
        <ResponsiveContainer>
          <LineChart data={data} margin={{ left: 0, right: 12, top: 8 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="date" tickFormatter={fmtMonth} minTickGap={40} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
            <YAxis tickFormatter={(v) => (ews.settings.shapUnit === "pp" ? pct(v, 0) : num(v, 1))} width={48} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
            <ReferenceLine y={0} stroke="var(--muted-foreground)" />
            <ReferenceLine x={ews.selectedDate} stroke="var(--brand-accent)" />
            <Tooltip labelFormatter={(l) => fmtDate(String(l))} formatter={(v: number) => [fmtContrib(v, ews.settings.shapUnit), "Contribuție"]}
              contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8 }} />
            <Line dataKey="c" stroke="var(--brand-violet)" dot={false} strokeWidth={1.8} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

function SensitivityTool() {
  const ews = useEws();
  const sens = ews.sensitivity!;
  const feats = [...new Set(sens.map((s) => s.feature))];
  const [f, setF] = useState(feats[0]);
  const curve = sens.filter((s) => s.feature === f).sort((a, b) => a.shift - b.shift);
  const [shift, setShift] = useState(0);
  const interp = (x: number) => {
    if (!curve.length) return 0;
    if (x <= curve[0].shift) return curve[0].p;
    for (let i = 1; i < curve.length; i++) if (x <= curve[i].shift) {
      const a = curve[i - 1], b = curve[i];
      return a.p + ((x - a.shift) / (b.shift - a.shift)) * (b.p - a.p);
    }
    return curve.at(-1)!.p;
  };
  const p = interp(shift);
  const lvl = levelOf(p, ews.thr.alert, ews.thr.high);
  const lo = curve[0]?.shift ?? -2, hi = curve.at(-1)?.shift ?? 2;
  return (
    <ChartCard
      title="Sensibilitate (din model)"
      info="Curbe calculate de echipă rerulând modelul: cum se schimbă probabilitatea dacă o variabilă se mută cu un număr de deviații standard."
      summary={`Pentru ${f}, la o deplasare de ${num(shift, 1)}σ probabilitatea este ${pct(p)}.`}
      table={{ headers: ["Deplasare (σ)", "Probabilitate"], rows: curve.map((c) => [num(c.shift, 1), pct(c.p)]) }}
      actions={
        <select value={f} onChange={(e) => { setF(e.target.value); setShift(0); }} aria-label="Variabila" className="min-h-11 rounded-md border bg-card px-2 text-sm">
          {feats.map((x) => <option key={x} value={x}>{ews.features.find((y) => y.feature === x)?.label ?? x}</option>)}
        </select>
      }
    >
      <div className="grid gap-6 md:grid-cols-[1fr_16rem]">
        <div className="h-56">
          <ResponsiveContainer>
            <LineChart data={curve} margin={{ left: 0, right: 12, top: 8 }}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="shift" type="number" domain={[lo, hi]} tickFormatter={(v) => `${num(v, 1)}σ`} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
              <YAxis tickFormatter={(v) => pct(v, 0)} width={44} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
              <ReferenceLine y={ews.thr.alert} stroke="var(--risk-moderate)" strokeDasharray="6 4" />
              <ReferenceLine x={shift} stroke="var(--brand-accent)" />
              <Line dataKey="p" stroke="var(--brand)" strokeWidth={2} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="space-y-3">
          <label className="block text-sm font-medium" htmlFor="sens-s">Deplasare: {num(shift, 1)}σ</label>
          <Slider id="sens-s" min={lo} max={hi} step={0.1} value={[shift]} onValueChange={([v]) => setShift(v)} aria-label="Deplasare în deviații standard" />
          <p className="text-3xl font-bold tabular-nums">{pct(p)}</p>
          <LevelBadge level={lvl} />
        </div>
      </div>
    </ChartCard>
  );
}

function ScenarioTool({ p }: { p: number }) {
  const ews = useEws();
  const rows = ews.driversFor(ews.selectedDate);
  const { cat } = Route.useSearch();
  const [factors, setFactors] = useState<Record<string, number>>(() => (cat ? { [cat]: 1.5 } : {}));
  useEffect(() => {
    let raf = 0;
    const h = (e: Event) => {
      const { cat: c, to, instant } = (e as CustomEvent<{ cat: string; to: number; instant: boolean }>).detail;
      cancelAnimationFrame(raf);
      if (instant) { setFactors({ [c]: to }); return; }
      const t0 = performance.now();
      const tick = (t: number) => {
        const k = Math.min(1, (t - t0) / 1800);
        setFactors({ [c]: 1 + (to - 1) * k });
        if (k < 1) raf = requestAnimationFrame(tick);
      };
      setFactors({ [c]: 1 });
      raf = requestAnimationFrame(tick);
    };
    window.addEventListener("ews-whatif", h);
    return () => { window.removeEventListener("ews-whatif", h); cancelAnimationFrame(raf); };
  }, []);
  useEffect(() => { if (cat) document.getElementById("wi-h")?.scrollIntoView({ block: "start" }); }, [cat]);
  const cats = ews.categories;
  const newP = whatIf(p, rows, factors, ews.settings.shapUnit);
  const lvl = levelOf(newP, ews.thr.alert, ews.thr.high);
  const catVal = (c: string) => rows.filter((r) => r.category === c).reduce((s, r) => s + r.contribution, 0);
  return (
    <Card id="tour-whatif" aria-labelledby="wi-h">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="wi-h" className="text-base font-semibold">Scenariu „ce-ar fi dacă” · {fmtDate(ews.selectedDate)}</h2>
          <p className="mt-1 text-xs font-medium text-risk-moderate">Aproximare pe baza contribuțiilor SHAP, nu rerulează modelul.</p>
        </div>
        <button onClick={() => setFactors({})} className="min-h-11 rounded-md border px-3 text-sm hover:bg-muted">Resetează</button>
      </div>
      <div className="mt-5 grid gap-8 lg:grid-cols-[1fr_18rem]">
        <ul className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
          {cats.map((c) => {
            const f = factors[c] ?? 1;
            const id = `wi-${c.replace(/\W/g, "")}`;
            return (
              <li key={c}>
                <div className="flex justify-between text-sm">
                  <label htmlFor={id} className="font-medium">{c}</label>
                  <span className="tabular-nums text-muted-foreground">{Math.round(f * 100)}% · {fmtContrib(catVal(c) * f, ews.settings.shapUnit)}</span>
                </div>
                <Slider id={id} className="mt-3" min={0} max={2} step={0.05} value={[f]} onValueChange={([v]) => setFactors((s) => ({ ...s, [c]: v }))}
                  aria-label={`${c}: procent din contribuția actuală`} aria-valuetext={`${Math.round(f * 100)}%`} />
              </li>
            );
          })}
        </ul>
        <div className="rounded-xl bg-muted p-5" aria-live="polite">
          <p className="text-sm text-muted-foreground">Probabilitate actuală</p>
          <p className="text-xl font-semibold tabular-nums">{pct(p)}</p>
          <p className="mt-3 text-sm text-muted-foreground">Probabilitate în scenariu</p>
          <p className={cn("text-4xl font-extrabold tabular-nums", LEVELS[lvl].text)}>{pct(newP)}</p>
          <div className="mt-2"><LevelBadge level={lvl} /></div>
        </div>
      </div>
    </Card>
  );
}
