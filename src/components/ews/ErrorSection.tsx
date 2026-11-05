import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { FlaskConical } from "lucide-react";
import { useEws } from "@/lib/ews/store";
import { alertErrorStats, errorStats, localError, thresholdCurve, type Rate } from "@/lib/ews/compute";
import { fmtDate, num, pct } from "@/lib/ews/format";
import { ChartCard, EmptyState, InfoTip } from "./ui";
import { cn } from "@/lib/utils";

const ci = (r: Rate) => (r.lo === null || r.hi === null ? "—" : `${pct(r.lo, 1)} – ${pct(r.hi, 1)}`);
const val = (r: Rate) => (r.p === null ? "—" : pct(r.p, 1));

/**
 * „Cât de des greșește modelul?” — probabilitatea de eroare, erorile de tip I și II și probabilitatea ca un semnal
 * să fie fals pozitiv / fals negativ. Totul pe zilele cu rezultat cunoscut (outcomes.csv), la pragul de alertă curent.
 */
export function ErrorSection() {
  const ews = useEws();
  const { fullSeries, thr, alerts, episodes, selectedDate, indexOf, hasOutcomes } = ews;
  const st = useMemo(() => errorStats(fullSeries, thr.alert), [fullSeries, thr.alert]);
  const al = useMemo(() => alertErrorStats(alerts, episodes), [alerts, episodes]);
  const curve = useMemo(() => thresholdCurve(fullSeries), [fullSeries]);
  const day = fullSeries[indexOf(selectedDate)];
  const loc = useMemo(() => (day ? localError(fullSeries, day.p, thr.alert) : null), [fullSeries, day, thr.alert]);

  const head = (
    <div className="mb-6">
      <p className="eyebrow mb-3">04.1 — Cât de des greșește?</p>
      <h2 className="font-display text-3xl font-bold tracking-tight md:text-4xl">
        Probabilitatea de <span className="text-gradient">eroare</span>
      </h2>
      <p className="mt-3 max-w-3xl text-muted-foreground">
        Un semnal înseamnă probabilitate ≥ pragul de alertă ({pct(thr.alert, 0)}). Comparăm semnalul fiecărei zile cu ce s-a întâmplat
        de fapt în următoarele 20 de zile de tranzacționare{st.n ? <> — {num(st.n)} zile cu rezultat cunoscut</> : null}.
      </p>
    </div>
  );

  if (!hasOutcomes || !st.n) {
    return (
      <section aria-label="Probabilitatea de eroare">
        {head}
        <EmptyState icon={FlaskConical} title="Lipsesc rezultatele reale">
          Erorile se pot calcula doar unde știm ce s-a întâmplat. Încarcă <strong>outcomes.csv</strong> (coloanele <code>Date, stress_event_20d</code>) pe{" "}
          <Link to="/date" className="font-semibold text-primary underline">pagina Date</Link>.
        </EmptyState>
      </section>
    );
  }

  const tiles: { k: string; r: Rate; term: string; d: string; of: string; accent?: string }[] = [
    { k: "Probabilitatea de eroare", r: st.error, term: "Probabilitatea de eroare",
      d: "Cât de des semnalul zilei (alertă sau fără alertă) a fost greșit, pe toate zilele.", of: "zile" },
    { k: "Eroare de tip I (α)", r: st.typeI, term: "Eroare de tip I — alarmă falsă",
      d: "Din zilele după care NU a urmat stres, în câte modelul a dat totuși semnal. Costă: acțiuni de protecție inutile.", of: "zile fără stres", accent: "bg-risk-moderate" },
    { k: "Eroare de tip II (β)", r: st.typeII, term: "Eroare de tip II — ratare",
      d: "Din zilele după care A urmat stres, în câte modelul NU a dat semnal. Costă: pierderi neanticipate — de obicei mai grav.", of: "zile cu stres", accent: "bg-risk-high" },
    { k: "P(semnal = fals pozitiv)", r: st.falseAlarm, term: "Probabilitatea ca o alertă să fie falsă",
      d: "Când modelul dă semnal, cât de des NU urmează stres (1 − precizia).", of: "zile cu semnal", accent: "bg-risk-moderate" },
    { k: "P(fără semnal = fals negativ)", r: st.falseCalm, term: "Probabilitatea ca liniștea să fie falsă",
      d: "Când modelul NU dă semnal, cât de des urmează totuși stres.", of: "zile fără semnal", accent: "bg-risk-high" },
  ];

  return (
    <section aria-label="Probabilitatea de eroare" className="space-y-6">
      {head}
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {tiles.map((t) => (
          <li key={t.k} className="card-surface relative overflow-hidden p-4">
            {t.accent && <span aria-hidden className={cn("absolute inset-x-0 top-0 h-0.5", t.accent)} />}
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-medium text-muted-foreground">{t.k}</p>
              <InfoTip term={t.term}>{t.d}</InfoTip>
            </div>
            <p className="mt-1 font-display text-4xl font-bold tabular-nums">{val(t.r)}</p>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">IÎ 95%: {ci(t.r)}</p>
            <p className="mt-2 text-xs text-muted-foreground">{num(t.r.x)} din {num(t.r.n)} {t.of}</p>
          </li>
        ))}
      </ul>

      <div className="grid gap-6 xl:grid-cols-5">
        <div className="card-surface bg-hero p-6 xl:col-span-2" aria-labelledby="loc-h">
          <h3 id="loc-h" className="font-mono text-[11px] uppercase tracking-[0.3em] text-muted-foreground">Semnalul zilei {day ? fmtDate(day.date) : ""}</h3>
          {day && loc ? (
            <>
              <p className="mt-3 text-sm">
                Probabilitate <strong className="tabular-nums">{pct(day.p)}</strong> →{" "}
                <strong className={loc.signal ? "text-risk-up-text" : "text-risk-low"}>{loc.signal ? "semnal de alertă" : "fără semnal"}</strong>
              </p>
              <p className="text-gradient mt-2 font-display text-6xl font-bold leading-none tabular-nums">{val(loc.rate)}</p>
              <p className="mt-3 text-[15px] leading-relaxed">
                șansa ca acest {loc.signal ? <strong>semnal să fie o alarmă falsă</strong> : <strong>„fără semnal” să fie greșit (ratare)</strong>}.
                Din cele {num(loc.rate.n)} zile istorice cu probabilitate apropiată ({pct(loc.from)} – {pct(loc.to)}),{" "}
                {num(loc.rate.x)}{" "}
                {loc.rate.x === 1
                  ? loc.signal ? "nu a fost urmată de stres" : "a fost totuși urmată de stres"
                  : loc.signal ? "nu au fost urmate de stres" : "au fost totuși urmate de stres"}.
              </p>
              <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">IÎ 95%: {ci(loc.rate)} · schimbă ziua din câmpul de sus</p>
            </>
          ) : <p className="mt-3 text-sm text-muted-foreground">Nu există o zi selectată.</p>}
          <dl className="mt-6 grid grid-cols-2 gap-3 border-t pt-5">
            <div>
              <dt className="text-xs text-muted-foreground">Alerte false (din alertele evaluate)</dt>
              <dd className="font-display text-2xl font-bold tabular-nums">{val(al.falseAlert)}</dd>
              <dd className="text-xs text-muted-foreground">{num(al.falseAlert.x)} din {num(al.falseAlert.n)} · IÎ {ci(al.falseAlert)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Episoade ratate</dt>
              <dd className="font-display text-2xl font-bold tabular-nums">{val(al.missedEpisode)}</dd>
              <dd className="text-xs text-muted-foreground">{num(al.missedEpisode.x)} din {num(al.missedEpisode.n)} · IÎ {ci(al.missedEpisode)}</dd>
            </div>
          </dl>
        </div>

        <ChartCard
          className="xl:col-span-3"
          title="Compromisul tip I ↔ tip II după prag"
          info="Un prag mai mic prinde mai multe episoade (scade eroarea de tip II), dar dă mai multe alarme false (crește eroarea de tip I). Linia verticală e pragul folosit acum."
          summary={`La pragul actual de ${pct(thr.alert, 0)}: eroare de tip I ${val(st.typeI)}, eroare de tip II ${val(st.typeII)}.`}
          table={{ headers: ["Prag", "Tip I (alarmă falsă)", "Tip II (ratare)"], rows: curve.map((c) => [pct(c.thr, 1), pct(c.typeI, 1), pct(c.typeII, 1)]) }}
        >
          <div className="h-72">
            <ResponsiveContainer>
              <LineChart data={curve} margin={{ left: 0, right: 16, top: 8, bottom: 4 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="thr" type="number" domain={[0, "dataMax"]} tickFormatter={(v) => pct(v, 0)} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                <YAxis domain={[0, 1]} tickFormatter={(v) => pct(v, 0)} width={44} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                <Tooltip
                  labelFormatter={(l) => `Prag ${pct(Number(l), 1)}`}
                  formatter={(v: number, n) => [pct(v, 1), n]}
                  contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 12 }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <ReferenceLine x={thr.alert} stroke="var(--foreground)" strokeDasharray="4 4"
                  label={{ value: `pragul actual ${pct(thr.alert, 0)}`, position: "insideTopRight", fill: "var(--foreground)", fontSize: 11 }} />
                <Line type="monotone" dataKey="typeI" name="Tip I — alarmă falsă" stroke="var(--cat-1)" strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="typeII" name="Tip II — ratare" stroke="var(--cat-2)" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      </div>
      <p className="text-xs text-muted-foreground">
        Calculat pe tot istoricul cu rezultat cunoscut, la nivel de zi. Intervalele de încredere (IÎ) sunt Wilson 95%; zilele consecutive nu sunt independente,
        deci incertitudinea reală e ceva mai mare. Matricea completă e în <Link to="/backtest" className="font-medium text-primary underline">Backtest</Link>.
      </p>
    </section>
  );
}
