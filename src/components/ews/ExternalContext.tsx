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
    return series.map((d) => {
      const e = m.get(d.date);
      return { date: d.date, p: d.p, vol: e?.cryptoVol30, btc30: e?.btcRet30, kev30: e && e.kev !== undefined ? kev30.get(d.date) : undefined };
    });
  }, [ext, series]);

  const corr = useMemo(() => {
    const pair = (k: "vol" | "kev30" | "btc30") => {
      const ok = data.filter((d) => d[k] !== undefined);
      return { r: spearman(ok.map((d) => d.p), ok.map((d) => d[k] as number)), n: ok.length };
    };
    return { vol: pair("vol"), kev: pair("kev30"), btc: pair("btc30") };
  }, [data]);

  const head = (
    <div className="mb-6">
      <p className="eyebrow mb-3">04.2 — Extensia: context extern</p>
      <h2 className="font-display text-3xl font-bold tracking-tight md:text-4xl">Crypto și cyber, <span className="text-gradient">în paralel cu riscul</span></h2>
      <p className="mt-3 max-w-3xl text-muted-foreground">
        Datele aduse de extensie (scraper-ul) pe aceleași zile ca probabilitatea de stres. Arată dacă episoadele de risc coincid cu turbulențe crypto sau
        valuri de vulnerabilități exploatate — asociere, nu cauzalitate.
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
          <p className="max-w-lg text-sm text-muted-foreground">Colectează acum din surse publice (Binance, CISA KEV) sau încarcă CSV-urile scraper-ului pe <Link to="/date" className="font-medium text-primary underline">pagina Date</Link>.</p>
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
  const panels = [
    { key: "p", title: "Probabilitatea de stres", fmt: (v: number) => pct(v, 0), color: "var(--primary)", area: true },
    { key: "vol", title: "Volatilitatea pieței crypto (30 zile)", fmt: (v: number) => pct(v, 1), color: "var(--cat-3)" },
    { key: "kev30", title: "Vulnerabilități exploatate noi (KEV, ultimele 30 zile)", fmt: (v: number) => num(v), color: "var(--cat-7)" },
  ] as const;

  return (
    <section aria-label="Context extern" className="space-y-6">
      {head}
      <dl className="grid gap-4 sm:grid-cols-3">
        {[
          ["Volatilitate crypto", corr.vol],
          ["Vulnerabilități KEV (30 zile)", corr.kev],
          ["Randament BTC 30 zile", corr.btc],
        ].map(([k, c]) => {
          const cc = c as { r: number | null; n: number };
          return (
            <div key={k as string} className="card-surface p-4">
              <dt className="text-sm text-muted-foreground">Corelație cu probabilitatea · {k as string}</dt>
              <dd className="mt-1 font-display text-3xl font-bold tabular-nums">ρ = {corrText(cc.r)}</dd>
              <dd className="text-xs text-muted-foreground">{strength(cc.r)} · Spearman pe {num(cc.n)} zile comune</dd>
            </div>
          );
        })}
      </dl>
      <ChartCard
        title="Riscul și semnalele externe, pe aceleași zile"
        info="Trei grafice cu aceeași axă a timpului (nu o axă dublă): treci cu mouse-ul pe unul și vezi aceeași zi în toate. Datele externe vin de la extensie."
        summary={`Corelații Spearman cu probabilitatea: volatilitate crypto ${corrText(corr.vol.r)}, KEV ${corrText(corr.kev.r)}, randament BTC ${corrText(corr.btc.r)}.`}
        table={{ headers: ["Data", "Probabilitate", "Volatilitate crypto 30z", "KEV 30 zile"], rows: [...data].reverse().map((d) => [fmtDate(d.date), pct(d.p), d.vol === undefined ? "—" : pct(d.vol, 1), d.kev30 === undefined ? "—" : num(d.kev30)]) }}
      >
        <div className="space-y-2">
          {panels.map((pn, i) => (
            <div key={pn.key}>
              <p className="text-xs font-medium text-muted-foreground">{pn.title}</p>
              <div className="h-32">
                <ResponsiveContainer>
                  <ComposedChart data={data} syncId="ext" margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
                    <XAxis dataKey="date" tickFormatter={fmtMonth} minTickGap={48} hide={i < panels.length - 1} {...axis} />
                    <YAxis tickFormatter={(v) => pn.fmt(Number(v))} width={52} domain={[0, "auto"]} {...axis} />
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
