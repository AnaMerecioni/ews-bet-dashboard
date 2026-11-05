import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { Area, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Loader2, Puzzle, RefreshCw } from "lucide-react";
import { useEws } from "@/lib/ews/store";
import { spearman, useExtension } from "@/lib/ews/extension";
import { fmtDate, fmtMonth, num, pct } from "@/lib/ews/format";
import { ChartCard } from "./ui";
import { useLiveCollect } from "./DataHub";

const corrText = (r: number | null) => (r === null ? "—" : num(r, 2));
const strength = (r: number | null) =>
  r === null ? "prea puține date" : Math.abs(r) < 0.1 ? "practic fără legătură" : Math.abs(r) < 0.3 ? "legătură slabă" : Math.abs(r) < 0.5 ? "legătură moderată" : "legătură puternică";

type Key = "stressEA" | "stressRO" | "roSpread" | "ceeVol" | "vol" | "kev30" | "attnFear";
type Point = { date: string; p: number } & Partial<Record<Key, number>>;
/** Panourile, în ordinea relevanței pentru BET; culorile urmează ordinea fixă a paletei de categorii. */
const PANELS: { key: Key; title: string; short: string; fmt: (v: number) => string; color: string }[] = [
  { key: "stressEA", title: "Stres financiar sistemic în zona euro (ECB CISS)", short: "Stres sistemic zona euro", fmt: (v) => num(v, 2), color: "var(--cat-1)" },
  { key: "stressRO", title: "Stres financiar în România (ECB CLIFS, lunar)", short: "Stres financiar România", fmt: (v) => num(v, 2), color: "var(--cat-2)" },
  { key: "roSpread", title: "Prima de risc a României: randament 10A RO − DE (p.p.)", short: "Prima de risc RO", fmt: (v) => num(v, 1), color: "var(--cat-3)" },
  { key: "ceeVol", title: "Volatilitatea valutelor din regiune (HUF, PLN, CZK, TRY)", short: "Valute regionale", fmt: (v) => pct(v, 2), color: "var(--cat-4)" },
  { key: "vol", title: "Volatilitatea pieței crypto (30 zile)", short: "Volatilitate crypto", fmt: (v) => pct(v, 1), color: "var(--cat-5)" },
  { key: "kev30", title: "Vulnerabilități exploatate noi (KEV, ultimele 30 zile)", short: "Vulnerabilități KEV", fmt: (v) => num(v), color: "var(--cat-7)" },
  { key: "attnFear", title: "Atenție publică pentru recesiune / criză (Wikipedia)", short: "Atenție publică", fmt: (v) => num(v, 2), color: "var(--cat-8)" },
];

/** Extensia în acțiune: probabilitatea de stres alături de semnalele externe aduse de scraper (small multiples, o singură axă fiecare). */
export function ExternalContext() {
  const { series } = useEws();
  const ext = useExtension();
  const live = useLiveCollect();

  const data = useMemo(() => {
    if (!ext) return [];
    // KEV pe 30 de zile calendaristice (rândurile extensiei sunt zilnice, inclusiv weekend)
    const kev30 = new Map<string, number>();
    let sum = 0;
    ext.rows.forEach((r, i) => {
      sum += r.kev ?? 0;
      if (i >= 30) sum -= ext.rows[i - 30].kev ?? 0;
      kev30.set(r.date, sum);
    });
    const m = new Map(ext.rows.map((r) => [r.date, r]));
    return series.map((d): Point => {
      const e = m.get(d.date);
      return {
        date: d.date, p: d.p, vol: e?.cryptoVol30, kev30: e && e.kev !== undefined ? kev30.get(d.date) : undefined,
        stressEA: e?.stressEA, stressRO: e?.stressRO, roSpread: e?.roSpread, ceeVol: e?.ceeVol, attnFear: e?.attnFear,
      };
    });
  }, [ext, series]);

  // doar seriile care au date în perioada aleasă
  const shown = useMemo(() => PANELS.filter((pn) => data.some((d) => d[pn.key] !== undefined)), [data]);
  const corr = useMemo(() => shown.map((pn) => {
    const ok = data.filter((d) => d[pn.key] !== undefined);
    return { pn, r: spearman(ok.map((d) => d.p), ok.map((d) => d[pn.key] as number)), n: ok.length };
  }), [data, shown]);

  const head = (
    <div className="mb-6">
      <p className="eyebrow mb-3">04.2 — Extensia: context extern</p>
      <h2 className="font-display text-3xl font-bold tracking-tight md:text-4xl">Ce se întâmplă în jur, <span className="text-gradient">în paralel cu riscul</span></h2>
      <p className="mt-3 max-w-3xl text-muted-foreground">
        Datele aduse de extensie — doar ce nu există în DataSprint — pe aceleași zile ca probabilitatea de stres: stresul financiar din zona euro și
        din România, prima de risc a României, valutele din regiune, crypto, atacuri cibernetice și atenția publică. Asociere, nu cauzalitate.
      </p>
    </div>
  );

  if (!ext) {
    return (
      <section aria-label="Context extern">
        {head}
        <div className="card-surface flex flex-col items-center gap-3 p-10 text-center">
          <span className="flex size-14 items-center justify-center rounded-full bg-primary/15 text-primary"><Puzzle aria-hidden className="size-7" /></span>
          <p className="font-display text-lg font-semibold">Extensia nu a adus încă date</p>
          <p className="max-w-lg text-sm text-muted-foreground">Colectează acum din surse publice (ECB, Eurostat, OECD, Binance, CISA, DefiLlama, Wikipedia) — durează 1–2 minute — sau încarcă CSV-urile scraper-ului pe <Link to="/date" className="font-medium text-primary underline">pagina Date</Link>.</p>
          <button onClick={() => void live.run()} disabled={live.busy}
            className="glow-primary mt-2 inline-flex min-h-12 items-center gap-2 rounded-full bg-primary px-6 font-display font-semibold text-primary-foreground disabled:opacity-60">
            {live.busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <RefreshCw aria-hidden className="size-4" />}
            {live.busy ? "Colectez…" : "Colectează live"}
          </button>
          <p className="min-h-5 text-xs text-muted-foreground" aria-live="polite">{live.msg}</p>
        </div>
      </section>
    );
  }

  const axis = { tick: { fontSize: 11, fill: "var(--muted-foreground)" }, axisLine: false, tickLine: false } as const;
  const tip = { contentStyle: { background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 12 }, labelFormatter: (l: unknown) => fmtDate(String(l)) };
  const all = [{ key: "p" as const, title: "Probabilitatea de stres (modelul)", fmt: (v: number) => pct(v, 0), color: "var(--primary)", area: true }, ...shown];

  return (
    <section aria-label="Context extern" className="space-y-6">
      {head}
      <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {corr.map(({ pn, r, n }) => (
          <div key={pn.key} className="card-surface relative overflow-hidden p-4">
            <span aria-hidden className="absolute inset-x-0 top-0 h-0.5" style={{ background: pn.color }} />
            <dt className="text-sm text-muted-foreground">Corelație cu probabilitatea · {pn.short}</dt>
            <dd className="mt-1 font-display text-3xl font-bold tabular-nums">ρ = {corrText(r)}</dd>
            <dd className="text-xs text-muted-foreground">{strength(r)} · Spearman pe {num(n)} zile comune</dd>
          </div>
        ))}
      </dl>
      <ChartCard
        title="Riscul și semnalele externe, pe aceleași zile"
        info="Câte un grafic pe serie, cu aceeași axă a timpului (nu o axă dublă): treci cu mouse-ul pe unul și vezi aceeași zi în toate. Datele externe vin de la extensie, puse la data publicării."
        summary={`Corelații Spearman cu probabilitatea: ${corr.map(({ pn, r }) => `${pn.short} ${corrText(r)}`).join(", ")}.`}
        table={{
          headers: ["Data", "Probabilitate", ...shown.map((pn) => pn.short)],
          rows: [...data].reverse().map((d) => [fmtDate(d.date), pct(d.p), ...shown.map((pn) => (d[pn.key] === undefined ? "—" : pn.fmt(d[pn.key] as number)))]),
        }}
      >
        <div className="space-y-2">
          {all.map((pn, i) => (
            <div key={pn.key}>
              <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <span aria-hidden className="inline-block h-0.5 w-4 rounded" style={{ background: pn.color }} />{pn.title}
              </p>
              <div className={i === 0 ? "h-36" : "h-24"}>
                <ResponsiveContainer>
                  <ComposedChart data={data} syncId="ext" margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
                    <XAxis dataKey="date" tickFormatter={fmtMonth} minTickGap={48} hide={i < all.length - 1} {...axis} />
                    <YAxis tickFormatter={(v) => pn.fmt(Number(v))} width={52} domain={["auto", "auto"]} {...axis} />
                    <Tooltip {...tip} formatter={(v: number) => [pn.fmt(v), pn.title]} />
                    {"area" in pn
                      ? <Area type="monotone" dataKey={pn.key} stroke={pn.color} fill={pn.color} fillOpacity={0.18} strokeWidth={2} dot={false} isAnimationActive={false} />
                      : <Line type="monotone" dataKey={pn.key} stroke={pn.color} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Sursa datelor externe: {ext.sources.join(", ")} · actualizat {fmtDate(ext.updatedAt.slice(0, 10))}. Verificările de calitate sunt pe pagina{" "}
          <Link to="/date" className="font-medium text-primary underline">Date</Link>.
        </p>
      </ChartCard>
    </section>
  );
}
