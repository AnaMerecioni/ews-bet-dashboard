import { useId, useState, type ReactNode } from "react";
import { AlertTriangle, CircleHelp, OctagonAlert, ShieldCheck, Table2, BarChart3 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { Level } from "@/lib/ews/types";
import { fmtContrib } from "@/lib/ews/format";

export const LEVELS: Record<Level, { label: string; upper: string; Icon: typeof ShieldCheck; bg: string; text: string; color: string }> = {
  low: { label: "Scăzut", upper: "SCĂZUT", Icon: ShieldCheck, bg: "bg-risk-low", text: "text-risk-low", color: "var(--risk-low)" },
  moderate: { label: "Moderat", upper: "MODERAT", Icon: AlertTriangle, bg: "bg-risk-moderate", text: "text-risk-moderate", color: "var(--risk-moderate)" },
  high: { label: "Ridicat", upper: "RIDICAT", Icon: OctagonAlert, bg: "bg-risk-high", text: "text-risk-high", color: "var(--risk-high)" },
};

export function LevelBadge({ level, size = "sm" }: { level: Level; size?: "sm" | "lg" }) {
  const L = LEVELS[level];
  return (
    <span
      className={cn(
        "liquid-pill inline-flex items-center gap-1.5 rounded-full font-semibold text-on-risk",
        L.bg,
        size === "lg" ? "px-4 py-2 text-lg" : "px-2.5 py-0.5 text-xs",
      )}
    >
      <L.Icon aria-hidden className={size === "lg" ? "size-6" : "size-3.5"} />
      {size === "lg" ? `Risc ${L.label.toLowerCase()}` : L.label}
    </span>
  );
}

export function InfoTip({ term, children }: { term: string; children: ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label={`Ce înseamnă ${term}?`}
        className="inline-flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground align-middle"
      >
        <CircleHelp aria-hidden className="size-4" />
      </PopoverTrigger>
      <PopoverContent className="max-w-xs text-sm leading-relaxed">
        <p className="font-semibold">{term}</p>
        <div className="mt-1 text-muted-foreground">{children}</div>
      </PopoverContent>
    </Popover>
  );
}

export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLElement>) {
  return (
    <section className={cn("card-surface sheen p-5", className)} {...rest}>
      {children}
    </section>
  );
}

export interface TableData { headers: string[]; rows: (string | number)[][] }

export function ChartCard({
  title, info, summary, table, actions, children, className, id,
}: {
  title: string; info?: ReactNode; summary: string; table?: TableData; actions?: ReactNode; children: ReactNode; className?: string; id?: string;
}) {
  const [asTable, setAsTable] = useState(false);
  const hid = useId();
  return (
    <Card className={cn("glass-chart", className)} aria-labelledby={hid} id={id}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-1">
          <h2 id={hid} className="text-base font-semibold">{title}</h2>
          {info && <InfoTip term={title}>{info}</InfoTip>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          {table && (
            <button
              type="button"
              onClick={() => setAsTable((v) => !v)}
              aria-pressed={asTable}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-md border px-3 text-sm hover:bg-muted"
            >
              {asTable ? <BarChart3 aria-hidden className="size-4" /> : <Table2 aria-hidden className="size-4" />}
              {asTable ? "Vezi graficul" : "Vezi ca tabel"}
            </button>
          )}
        </div>
      </div>
      <p className="sr-only">{summary}</p>
      {asTable && table ? <DataTable data={table} caption={title} /> : children}
    </Card>
  );
}

export function DataTable({ data, caption }: { data: TableData; caption: string }) {
  return (
    <div className="max-h-96 overflow-auto rounded-md border" tabIndex={0} role="region" aria-label={`Tabel: ${caption}`}>
      <table className="w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0 bg-muted">
          <tr>{data.headers.map((h) => <th key={h} scope="col" className="px-3 py-2 text-left font-semibold">{h}</th>)}</tr>
        </thead>
        <tbody>
          {data.rows.map((r, i) => (
            <tr key={i} className="border-t">
              {r.map((c, j) => <td key={j} className="px-3 py-1.5 tabular-nums">{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DivergingBars({
  items, unit, emptyText = "Nu există date despre factori pentru această zi.",
}: { items: { key: string; label: string; sub?: string; value: number }[]; unit: "pp" | "logit"; emptyText?: string }) {
  if (!items.length) return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  const max = Math.max(...items.map((i) => Math.abs(i.value)), 1e-9);
  return (
    <ul className="space-y-2.5">
      {items.map((it) => {
        const w = (Math.abs(it.value) / max) * 50;
        const up = it.value >= 0;
        return (
          <li key={it.key} className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto] items-center gap-3">
            <div className="min-w-0">
              <p className="line-clamp-2 text-sm font-medium leading-snug" title={it.label}>{it.label}</p>
              {it.sub && <p className="truncate text-xs text-muted-foreground">{it.sub}</p>}
            </div>
            <div className="relative h-5" aria-hidden>
              <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
              <div
                className={cn("absolute inset-y-0.5 rounded-sm", up ? "bg-risk-up" : "bg-risk-down")}
                style={up ? { left: "50%", width: `${w}%` } : { right: "50%", width: `${w}%` }}
              />
            </div>
            <span className={cn("w-[5.5rem] text-right text-sm font-semibold tabular-nums", up ? "text-risk-up-text" : "text-risk-down-text")}>
              {up ? "▲" : "▼"} {fmtContrib(it.value, unit)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function EmptyState({ icon: Icon, title, children }: { icon: typeof ShieldCheck; title: string; children: ReactNode }) {
  return (
    <div className="card-surface mx-auto flex max-w-xl flex-col items-center gap-3 p-10 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-accent text-accent-foreground">
        <Icon aria-hidden className="size-7" />
      </span>
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="text-sm text-muted-foreground">{children}</div>
    </div>
  );
}

export function PageHeader({ title, desc, actions }: { title: string; desc?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {desc && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{desc}</p>}
      </div>
      {actions}
    </div>
  );
}

export const CausalityNote = () => (
  <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
    Explicația arată contribuții, nu cauzalitate.
  </p>
);
