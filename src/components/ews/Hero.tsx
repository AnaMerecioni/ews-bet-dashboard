import { useMemo, type CSSProperties } from "react";
import { ArrowDown } from "lucide-react";
import { useEws } from "@/lib/ews/store";
import { num, pct } from "@/lib/ews/format";

const delay = (ms: number): CSSProperties => ({ animationDelay: `${ms}ms` });

/**
 * Deschiderea paginii, după prototipul „Povestea riscului”: titlu mare care apare cuvânt cu cuvânt,
 * cifre-cheie calculate din datele încărcate și o bandă cu factorii modelului.
 */
export function Hero({ target = "raport" }: { target?: string }) {
  const { fullSeries, alerts, episodes, hasOutcomes, categories, driversFor } = useEws();
  const last = fullSeries.at(-1);

  const factors = useMemo(() => {
    const rows = last ? driversFor(last.date) : [];
    // eticheta variabilei dacă există, altfel categoria (numele brute gen „f3” nu spun nimic)
    const names = [...new Set(rows.map((r) => r.label ?? r.category))];
    return (names.length ? names : categories).slice(0, 14);
  }, [last, driversFor, categories]);

  if (!last) return null;
  const stats = [
    { v: num(fullSeries.length), l: "zile analizate" },
    hasOutcomes ? { v: num(episodes.length), l: "episoade de stres" } : { v: num(alerts.length), l: "alerte Gama" },
    { v: num(categories.length), l: "categorii de risc" },
    { v: pct(last.p, 1), l: "risc azi" },
  ];

  return (
    <section aria-label="Prezentare" className="relative isolate overflow-hidden rounded-3xl border bg-background/40 print:hidden">
      <div aria-hidden className="absolute inset-0 -z-10 overflow-hidden">
        <div className="aurora aurora-a" />
        <div className="aurora aurora-b" />
        <div className="aurora aurora-c" />
        <div className="scanline" />
      </div>

      <div className="px-6 pb-12 pt-10 sm:px-10 md:pb-16 md:pt-14">
        <p className="reveal eyebrow inline-flex items-center gap-2 rounded-full border bg-card px-4 py-1.5 max-sm:tracking-[0.16em]">
          <span aria-hidden className="pulse-dot inline-block size-2 rounded-full bg-risk-high text-risk-high" />
          Live · Gama
        </p>
        <p className="mt-6 font-display text-[clamp(2.75rem,7vw,6.75rem)] font-bold leading-[0.95] tracking-tight">
          <span className="reveal block" style={delay(80)}>Riscurile,</span>
          <span className="reveal text-gradient block pb-1" style={delay(220)}>traduse în</span>
          <span className="reveal block" style={delay(360)}>portofoliul tău<span className="text-risk-high">.</span></span>
        </p>
        <p className="reveal mt-8 max-w-2xl text-lg text-muted-foreground md:text-2xl" style={delay(500)}>
          Probabilitatea zilnică ca indicele BET să cadă cu cel puțin 5% în următoarele 20 de zile de tranzacționare — înainte să se întâmple.
        </p>
        <dl className="reveal mt-10 grid max-w-4xl grid-cols-2 gap-px overflow-hidden rounded-2xl border bg-border md:grid-cols-4" style={delay(650)}>
          {stats.map((s) => (
            <div key={s.l} className="flex flex-col-reverse gap-1 bg-card px-5 py-4">
              <dt className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{s.l}</dt>
              <dd className="font-display text-3xl font-bold tabular-nums md:text-4xl">{s.v}</dd>
            </div>
          ))}
        </dl>
        <a
          href={`#${target}`}
          className="reveal glow-primary mt-10 inline-flex min-h-12 items-center gap-3 rounded-full bg-primary px-6 font-display font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5"
          style={delay(800)}
        >
          Vezi evaluarea de azi <ArrowDown aria-hidden className="size-4" />
        </a>
      </div>

      {factors.length > 0 && (
        <div aria-hidden className="marquee-mask overflow-hidden border-t py-3">
          <div className="marquee flex w-max gap-12 whitespace-nowrap font-mono text-xs uppercase tracking-[0.25em] text-muted-foreground">
            {[...factors, ...factors].map((f, i) => (
              <span key={i} className="inline-flex items-center gap-3"><span className="text-primary-glow">◆</span>{f}</span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
