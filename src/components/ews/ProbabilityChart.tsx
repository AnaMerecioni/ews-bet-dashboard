import { useId, useMemo } from "react";
import {
  Area, CartesianGrid, ComposedChart, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { Alert, Day, DriverRow } from "@/lib/ews/types";
import { fmtContrib, fmtDate, fmtMonth, num, pct } from "@/lib/ews/format";
import { topDrivers } from "@/lib/ews/compute";
import { LEVELS } from "./ui";

interface Props {
  data: Day[];
  alert: number;
  high: number;
  alerts: Alert[];
  selected?: string;
  onSelect?: (d: string) => void;
  driversFor?: (d: string) => DriverRow[];
  unit?: "pp" | "logit";
  height?: number;
  showBet?: boolean;
  showEpisodes?: boolean;
}

function labelRuns(data: Day[]) {
  const out: { from: string; to: string }[] = [];
  let s: number | null = null;
  data.forEach((d, i) => {
    if (d.y === 1 && s === null) s = i;
    if ((d.y !== 1 || i === data.length - 1) && s !== null) {
      out.push({ from: data[s].date, to: data[d.y === 1 ? i : i - 1].date });
      s = null;
    }
  });
  return out;
}

export function ProbabilityChart({
  data, alert, high, alerts, selected, onSelect, driversFor, unit = "pp", height = 320, showBet = true, showEpisodes = true,
}: Props) {
  const fillId = `pfill-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const yMax = useMemo(() => {
    const mp = Math.max(...data.map((d) => d.p), 0);
    return Math.min(1, Math.ceil(Math.max(high * 1.3, mp * 1.1) * 20) / 20);
  }, [data, high]);
  const first = data[0]?.date;
  const last = data.at(-1)?.date;
  const visAlerts = alerts.filter((a) => first && last && a.end >= first && a.start <= last);
  const eps = showEpisodes ? labelRuns(data) : [];
  const hasBet = showBet && data.some((d) => d.bet !== undefined);

  const onKey = (e: React.KeyboardEvent) => {
    if (!onSelect || !selected) return;
    const i = data.findIndex((d) => d.date === selected);
    let n = i;
    if (e.key === "ArrowLeft") n = Math.max(0, i - 1);
    else if (e.key === "ArrowRight") n = Math.min(data.length - 1, i + 1);
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = data.length - 1;
    else return;
    e.preventDefault();
    if (i === -1) n = data.length - 1;
    onSelect(data[n].date);
  };

  return (
    <div
      tabIndex={onSelect ? 0 : undefined}
      onKeyDown={onKey}
      aria-label={onSelect ? "Grafic probabilitate. Folosește săgețile stânga/dreapta pentru a selecta o zi." : undefined}
      className="rounded-md"
    >
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            syncId="ews"
            margin={{ top: 8, right: 64, left: 0, bottom: 0 }}
            onClick={(e) => e?.activeLabel && onSelect?.(String(e.activeLabel))}
            style={{ cursor: onSelect ? "pointer" : undefined }}
          >
            <defs>
              <pattern id="hatch" patternUnits="userSpaceOnUse" width="7" height="7" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="7" stroke="var(--foreground)" strokeWidth="1.5" strokeOpacity="0.28" />
              </pattern>
              <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" style={{ stopColor: "var(--primary)", stopOpacity: 0.35 }} />
                <stop offset="100%" style={{ stopColor: "var(--primary)", stopOpacity: 0 }} />
              </linearGradient>
            </defs>
            <ReferenceArea y1={0} y2={alert} fill="var(--risk-low)" fillOpacity={0.07} ifOverflow="hidden"
              label={{ value: "Scăzut", position: "insideBottomRight", fill: "var(--risk-low)", fontSize: 11, fontWeight: 600 }} />
            <ReferenceArea y1={alert} y2={high} fill="var(--risk-moderate)" fillOpacity={0.09} ifOverflow="hidden"
              label={{ value: "Moderat", position: "insideRight", fill: "var(--risk-moderate)", fontSize: 11, fontWeight: 600 }} />
            <ReferenceArea y1={high} y2={yMax} fill="var(--risk-high)" fillOpacity={0.08} ifOverflow="hidden"
              label={{ value: "Ridicat", position: "insideTopRight", fill: "var(--risk-high)", fontSize: 11, fontWeight: 600 }} />
            {eps.map((e, i) => (
              <ReferenceArea key={"e" + i} x1={e.from} x2={e.to} fill="url(#hatch)" ifOverflow="hidden" />
            ))}
            {visAlerts.map((a) => (
              <ReferenceArea key={a.id} x1={a.start < first! ? first : a.start} x2={a.end > last! ? last : a.end}
                fill="var(--risk-high)" fillOpacity={0.14} ifOverflow="hidden" />
            ))}
            <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.6} />
            <XAxis dataKey="date" tickFormatter={fmtMonth} minTickGap={40} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} axisLine={false} tickLine={false} />
            <YAxis domain={[0, yMax]} tickFormatter={(v) => pct(v, 0)} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} width={46} axisLine={false} tickLine={false} />
            <ReferenceLine y={alert} stroke="var(--risk-moderate)" strokeDasharray="6 4" strokeWidth={1.5}
              label={{ value: `Alertă ${pct(alert, 0)}`, position: "right", fill: "var(--foreground)", fontSize: 11 }} />
            <ReferenceLine y={high} stroke="var(--risk-high)" strokeDasharray="2 3" strokeWidth={1.5}
              label={{ value: `Ridicat ${pct(high, 0)}`, position: "right", fill: "var(--foreground)", fontSize: 11 }} />
            {selected && <ReferenceLine x={selected} stroke="var(--brand-accent)" strokeWidth={1.5} />}
            <Tooltip
              cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "3 3" }}
              content={({ active, label }) => {
                if (!active || !label) return null;
                const d = data.find((x) => x.date === label);
                if (!d) return null;
                const L = LEVELS[d.level];
                const top = driversFor ? topDrivers(driversFor(d.date), 3) : [];
                return (
                  <div className="rounded-lg border bg-popover p-3 text-sm text-popover-foreground shadow-lg">
                    <p className="font-semibold">{fmtDate(d.date)}</p>
                    <p className="mt-1 flex items-center gap-1.5">
                      <L.Icon aria-hidden className={`size-4 ${L.text}`} />
                      <span className="text-lg font-bold tabular-nums">{pct(d.p)}</span>
                      <span className="text-muted-foreground">· {L.label}</span>
                    </p>
                    {top.length > 0 && (
                      <ul className="mt-2 space-y-0.5 text-xs">
                        {top.map((t) => (
                          <li key={t.feature} className="flex justify-between gap-4">
                            <span>{t.label ?? t.feature}</span>
                            <span className={t.contribution >= 0 ? "text-risk-up-text" : "text-risk-down-text"}>{fmtContrib(t.contribution, unit)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {d.bet !== undefined && <p className="mt-1 text-xs text-muted-foreground">BET: {num(d.bet)}</p>}
                  </div>
                );
              }}
            />
            <Area
              type="monotone" dataKey="p" stroke="var(--primary)" strokeWidth={2} fill={`url(#${fillId})`} dot={false} isAnimationActive={false}
              activeDot={{ r: 5, fill: "var(--primary)", stroke: "var(--background)", strokeWidth: 2 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-5 rounded-sm bg-risk-high/20" /> Perioadă de alertă</span>
        {eps.length > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <svg width="20" height="12" aria-hidden><rect width="20" height="12" fill="url(#hatch)" stroke="var(--border)" /></svg>
            Stres real în următoarele 20 de zile
          </span>
        )}
        <span>— — prag alertă · ··· prag ridicat</span>
      </div>
      {hasBet && (
        <div className="mt-3" style={{ height: 110 }}>
          <p className="text-xs font-medium text-muted-foreground">Indicele BET</p>
          <ResponsiveContainer width="100%" height="85%">
            <LineChart data={data} syncId="ews" margin={{ top: 4, right: 64, left: 0, bottom: 0 }}>
              <XAxis dataKey="date" hide />
              <YAxis domain={["auto", "auto"]} tickFormatter={(v) => num(v)} width={46} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} axisLine={false} tickLine={false} />
              {selected && <ReferenceLine x={selected} stroke="var(--brand-accent)" />}
              <Tooltip content={() => null} cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "3 3" }} />
              <Line type="monotone" dataKey="bet" stroke="var(--muted-foreground)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
