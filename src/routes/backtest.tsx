import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { CartesianGrid, ReferenceLine, ScatterChart, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from "recharts";
import { CheckCircle2, FlaskConical, XCircle } from "lucide-react";
import { useEws } from "@/lib/ews/store";
import { calibration, median, metrics } from "@/lib/ews/compute";
import { days, fmtDate, num, pct } from "@/lib/ews/format";
import { Card, ChartCard, EmptyState, InfoTip, PageHeader } from "@/components/ews/ui";

export const Route = createFileRoute("/backtest")({
  head: () => ({
    meta: [
      { title: "Backtest · Sistem de avertizare timpurie" },
      { name: "description", content: "Performanța istorică a sistemului de avertizare BET: F2, AUC, Brier Skill Score, episoade anticipate." },
      { property: "og:title", content: "Backtest · Sistem de avertizare timpurie" },
      { property: "og:description", content: "Cât de bine a anticipat modelul episoadele reale de stres ale BET." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Backtest,
});

function Backtest() {
  const ews = useEws();
  const m = useMemo(() => metrics(ews.fullSeries, ews.thr.alert), [ews.fullSeries, ews.thr.alert]);
  const cal = useMemo(() => calibration(ews.fullSeries), [ews.fullSeries]);

  if (!ews.hasOutcomes) {
    return (
      <div>
        <PageHeader title="Backtest" />
        <EmptyState icon={FlaskConical} title="Încarcă rezultatele reale">
          Pentru backtest avem nevoie de <strong>outcomes.csv</strong> cu coloanele <code>Date, stress_event_20d</code> (și opțional <code>BET</code>).{" "}
          <Link to="/date" className="font-semibold text-brand-accent underline dark:text-primary">Mergi la Date</Link>
        </EmptyState>
      </div>
    );
  }
  const eps = ews.episodes;
  const warned = eps.filter((e) => e.warned);
  const med = median(warned.map((e) => e.warningDays!));
  const cards = [
    { k: "F2", v: num(m.f2, 2), t: "F2", d: "Combină recall și precizie, cu accent dublu pe a nu rata episoadele." },
    { k: "ROC-AUC", v: num(m.auc, 2), t: "ROC-AUC", d: "Probabilitatea ca o zi de stres să primească scor mai mare decât una calmă (0,5 = aleator)." },
    { k: "Brier Skill Score", v: num(m.bss, 2), t: "BSS", d: "Cât de bune sunt probabilitățile față de a ghici mereu rata medie (>0 = mai bun)." },
    { k: "Recall", v: pct(m.recall, 0), t: "Recall", d: "Din zilele urmate de stres, câte au fost semnalate." },
    { k: "Precizie", v: pct(m.precision, 0), t: "Precizie", d: "Din zilele semnalate, câte au fost urmate de stres." },
    { k: "Alerte", v: String(ews.alerts.length), t: "Alerte", d: `Episoade de alertă cu regula de ${days(ews.settings.confirmDays)} consecutive.` },
  ];
  return (
    <div className="space-y-6">
      <PageHeader title="Backtest" desc={`${num(m.n)} zile cu rezultat cunoscut · rata de bază a stresului: ${pct(m.base)} · prag de alertă ${pct(ews.thr.alert, 0)}.`} />
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {cards.map((c) => (
          <li key={c.k} className="card-surface p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-muted-foreground">{c.k}</p>
              <InfoTip term={c.t}>{c.d}</InfoTip>
            </div>
            <p className="mt-1 text-3xl font-bold tabular-nums">{c.v}</p>
            <p className="mt-1 text-xs text-muted-foreground">{c.d}</p>
          </li>
        ))}
      </ul>

      <Card aria-labelledby="eps-h">
        <h2 id="eps-h" className="text-base font-semibold">Episoade reale de stres</h2>
        <p className="mt-1 text-lg">
          <strong>{warned.length} din {eps.length}</strong> episoade anticipate{med !== null && <>, avans median <strong>{days(Math.round(med))}</strong></>}.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="border-b text-left text-muted-foreground">
              <tr><th scope="col" className="py-2">Declanșare scădere</th><th scope="col">Avertizat în 30 de zile înainte?</th><th scope="col">Avans</th></tr>
            </thead>
            <tbody>
              {eps.map((e, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="py-2 font-medium tabular-nums">{fmtDate(e.onset)}</td>
                  <td>{e.warned ? <span className="inline-flex items-center gap-1 text-risk-low"><CheckCircle2 aria-hidden className="size-4" /> Da</span> : <span className="inline-flex items-center gap-1 text-risk-high"><XCircle aria-hidden className="size-4" /> Nu — ratat</span>}</td>
                  <td className="tabular-nums">{e.warningDays !== null ? days(e.warningDays) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard
          title="Calibrare pe decile"
          info="Fiecare punct grupează 10% din zile după probabilitatea prezisă. Ideal, punctele stau pe diagonală: 20% prezis ≈ 20% observat."
          summary={cal.map((c) => `Decila ${c.bin}: prezis ${pct(c.pred)}, observat ${pct(c.obs)}`).join("; ")}
          table={{ headers: ["Decilă", "Prezis", "Observat", "Zile"], rows: cal.map((c) => [c.bin, pct(c.pred), pct(c.obs), c.n]) }}
        >
          <div className="h-72">
            <ResponsiveContainer>
              <ScatterChart margin={{ left: 0, right: 16, top: 8, bottom: 16 }}>
                <CartesianGrid stroke="var(--border)" />
                <XAxis type="number" dataKey="pred" domain={[0, 1]} tickFormatter={(v) => pct(v, 0)} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  label={{ value: "Prezis", position: "insideBottom", offset: -10, fill: "var(--muted-foreground)", fontSize: 12 }} />
                <YAxis type="number" dataKey="obs" domain={[0, 1]} tickFormatter={(v) => pct(v, 0)} width={44} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 1, y: 1 }]} stroke="var(--muted-foreground)" strokeDasharray="4 4" />
                <Scatter data={cal} fill="var(--brand)" isAnimationActive={false} />
                <Tooltip formatter={(v: number) => pct(v)} contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8 }} />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <Card aria-labelledby="cm-h">
          <div className="flex items-center gap-1">
            <h2 id="cm-h" className="text-base font-semibold">Matricea de confuzie la prag</h2>
            <InfoTip term="Matricea de confuzie">Zile clasificate după semnal (p ≥ {pct(ews.thr.alert, 0)}) și ce s-a întâmplat de fapt.</InfoTip>
          </div>
          <table className="mt-4 w-full text-center text-sm">
            <thead>
              <tr><td /><th scope="col" className="pb-2">Stres real</th><th scope="col" className="pb-2">Fără stres</th></tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row" className="pr-3 text-right">Semnal</th>
                <td className="rounded-tl-lg bg-risk-low/15 p-5"><p className="text-2xl font-bold">{num(m.tp)}</p><p className="text-xs">Corect anticipate</p></td>
                <td className="rounded-tr-lg bg-muted p-5"><p className="text-2xl font-bold">{num(m.fp)}</p><p className="text-xs">Alarme false</p></td>
              </tr>
              <tr>
                <th scope="row" className="pr-3 text-right">Fără semnal</th>
                <td className="rounded-bl-lg bg-risk-high/15 p-5"><p className="text-2xl font-bold">{num(m.fn)}</p><p className="text-xs">Ratate</p></td>
                <td className="rounded-br-lg bg-muted p-5"><p className="text-2xl font-bold">{num(m.tn)}</p><p className="text-xs">Corect liniștite</p></td>
              </tr>
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
