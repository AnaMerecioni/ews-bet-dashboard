import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, NotebookText, Presentation as PresentationIcon, X } from "lucide-react";
import { useEws } from "@/lib/ews/store";
import { whatIf, byCategory, levelOf, scenarioFactor } from "@/lib/ews/compute";
import { categoryPhrases } from "@/lib/ews/summary";
import { days, fmtDate, pct } from "@/lib/ews/format";
import { LEVEL_RO } from "@/lib/ews/notify";
import { cn } from "@/lib/utils";

const Ctx = createContext<{ active: boolean; start: () => void }>({ active: false, start: () => {} });
export const usePresentation = () => useContext(Ctx);

interface Step { title: string; route: "/ansamblu" | "/explicabilitate"; targets: string[]; caption: string; notes: string[] }

export function PresentationProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState(false);
  const start = useCallback(() => setActive(true), []);
  return (
    <Ctx.Provider value={{ active, start }}>
      {children}
      {active && <Presentation onClose={() => setActive(false)} />}
    </Ctx.Provider>
  );
}

export function PresentationButton() {
  const { start } = usePresentation();
  return (
    <button onClick={start} className="inline-flex min-h-11 items-center gap-2 rounded-md border bg-card px-3 text-sm font-medium hover:bg-muted">
      <PresentationIcon aria-hidden className="size-4" /> <span className="hidden lg:inline">Mod prezentare</span>
      <span className="sr-only lg:hidden">Mod prezentare</span>
    </button>
  );
}

function useRect(ids: string[], key: string) {
  const [rect, setRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  useEffect(() => {
    let t = 0;
    const measure = () => {
      const els = ids.map((i) => document.getElementById(i)).filter(Boolean) as HTMLElement[];
      if (!els.length) { setRect(null); return; }
      const rs = els.map((e) => e.getBoundingClientRect());
      const x = Math.min(...rs.map((r) => r.left)), y = Math.min(...rs.map((r) => r.top));
      const r = { x: x - 8, y: y - 8, w: Math.max(...rs.map((r) => r.right)) - x + 16, h: Math.max(...rs.map((r) => r.bottom)) - y + 16 };
      setRect((p) => (p && Math.abs(p.x - r.x) + Math.abs(p.y - r.y) + Math.abs(p.w - r.w) + Math.abs(p.h - r.h) < 1 ? p : r));
    };
    const doScroll = () => {
      const el = document.getElementById(ids[0]);
      if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 150, behavior: "auto" });
    };
    const scroll = window.setTimeout(doScroll, 250);
    const scroll2 = window.setTimeout(doScroll, 900);
    t = window.setInterval(measure, 120);
    window.addEventListener("resize", measure);
    return () => { clearInterval(t); clearTimeout(scroll); clearTimeout(scroll2); window.removeEventListener("resize", measure); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return rect;
}

function Presentation({ onClose }: { onClose: () => void }) {
  const ews = useEws();
  const navigate = useNavigate();
  const { fullSeries, alerts, thr, settings, driversFor, setSelectedDate, indexOf, hasOutcomes, episodes } = ews;
  const reduce = settings.reduceMotion || (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  const choices = useMemo(() => {
    const max = fullSeries.reduce((a, b) => (b.p > a.p ? b : a), fullSeries[0]);
    const fa = [...alerts].reverse().find((a) => a.confirmed === false);
    return [
      { id: "today", label: `Ziua de azi (${fmtDate(ews.lastDate)}) — implicit`, date: ews.lastDate },
      { id: "max", label: `Ziua cu probabilitatea maximă (${fmtDate(max?.date ?? "")}, ${pct(max?.p ?? 0)})`, date: max?.date },
      ...(fa ? [{ id: "false", label: `O alarmă falsă (${fmtDate(fa.peakDate)})`, date: fa.peakDate }] : []),
    ];
  }, [fullSeries, alerts, ews.lastDate]);

  const [date, setDate] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [notes, setNotes] = useState(false);
  const panel = useRef<HTMLDivElement>(null);

  const steps = useMemo<Step[]>(() => {
    if (!date) return [];
    const idx = indexOf(date);
    const d = fullSeries[idx];
    const rows = driversFor(date);
    const cp = categoryPhrases(rows, 3);
    const alert = alerts.find((a) => a.startIdx <= idx && a.endIdx >= idx) ?? [...alerts].reverse().find((a) => a.startIdx <= idx);
    const pb = settings.playbook[alert?.level ?? d.level];
    const ep = alert ? episodes.find((e) => e.alertId === alert.id) : undefined;
    const topCat = byCategory(rows).find((c) => c.value > 0)?.category;
    const factor = scenarioFactor(d.p);
    const down = factor < 1;
    const np = topCat ? whatIf(d.p, rows, { [topCat]: factor }, settings.shapUnit) : d.p;
    const nl = levelOf(np, thr.alert, thr.high);
    const catPhrase = topCat ? (cp.items.find((i) => i.category === topCat)?.phrase ?? topCat.toLowerCase()) : "";
    return [
      { title: "Problema", route: "/ansamblu", targets: ["tour-status"],
        caption: "Estimăm probabilitatea ca indicele BET să scadă cu cel puțin 5% în următoarele 20 de zile de tranzacționare. Instrumentul e gândit pentru echipele de risc din bănci, fonduri și asigurători.",
        notes: ["Un episod de stres = scădere ≥5% a BET oricând în următoarele 20 de zile.", "Scopul: să acționăm înainte, nu după scădere."] },
      { title: "Probabilitatea estimată", route: "/ansamblu", targets: ["tour-status", "tour-chart"],
        caption: `Pe ${fmtDate(date)}, modelul estimează o probabilitate de ${pct(d.p)} pentru un episod de stres. Graficul arată evoluția zilnică a acestei probabilități.`,
        notes: ["Linia albastră = probabilitatea zilnică.", "Zonele hașurate = episoade reale de stres (dacă avem rezultate)."] },
      { title: "Nivelul de risc", route: "/ansamblu", targets: ["tour-status", "tour-chart"],
        caption: `Nivelul este ${LEVEL_RO[d.level]}. Sub ${pct(thr.alert, 0)} riscul e Scăzut, între ${pct(thr.alert, 0)} și ${pct(thr.high, 0)} Moderat, peste ${pct(thr.high, 0)} Ridicat. Pragul de alertă maximizează F2: o alarmă ratată costă mai mult decât una falsă.`,
        notes: ["Fiecare nivel are culoare, icon și text — nu doar culoare.", "Pragul ridicat = unde stresul apare istoric de ≥2× mai des."] },
      { title: "Alerta generată", route: "/ansamblu", targets: ["tour-alerts"],
        caption: alert
          ? `Alerta a pornit pe ${fmtDate(alert.start)} și a durat ${days(alert.duration)} (vârf ${pct(alert.peak)}). Acțiune: ${pb.action} Decide: ${pb.owner}.${alert.confirmed === true ? ` Confirmată: BET a scăzut ≥5%${ep?.warningDays != null ? `, cu ${days(ep.warningDays)} avans` : ""}.` : alert.confirmed === false ? " A fost o alarmă falsă — costul a fost doar unul de prudență." : ""}`
          : `Nu există nicio alertă până la această dată. O alertă pornește după ${days(settings.confirmDays)} consecutive peste prag.`,
        notes: ["Fiecare alertă are un responsabil și o acțiune clară.", hasOutcomes ? "Putem arăta câte zile de avans am avut." : "Cu outcomes.csv arătăm și avansul alertei."] },
      { title: "Explicațiile modelului", route: "/ansamblu", targets: ["tour-drivers", "tour-cats"],
        caption: cp.sentence
          ? `Riscul este împins în sus de: ${cp.sentence}. Acestea sunt contribuții, nu cauzalitate.`
          : "Încarcă drivers.csv pentru a vedea factorii. Explicațiile arată contribuții, nu cauzalitate.",
        notes: ["Roșu = crește riscul, albastru = îl scade (valori SHAP).", "Gruparea pe categorii ajută decizia rapidă."] },
      { title: "Scenariu what-if", route: "/explicabilitate", targets: ["tour-whatif"],
        caption: topCat
          ? `Dacă factorii din categoria „${topCat}” (${catPhrase}) ${down ? "scad" : "cresc"} cu 50%, probabilitatea ${down ? "coboară" : "urcă"} de la ${pct(d.p)} la ${pct(np)} și nivelul devine ${LEVEL_RO[nl]}.`
          : "Pentru scenarii avem nevoie de contribuțiile SHAP (drivers.csv).",
        notes: ["Aproximare pe baza contribuțiilor SHAP, nu rerulează modelul.", "Managementul poate testa singur alte scenarii cu cursoarele."] },
    ];
  }, [date, fullSeries, indexOf, driversFor, alerts, settings, thr, episodes, hasOutcomes]);

  const cur = step > 0 ? steps[step - 1] : null;
  useEffect(() => {
    if (!cur || !date) return;
    setSelectedDate(date);
    navigate({ to: cur.route, search: cur.route === "/explicabilitate" ? { cat: undefined } : undefined } as never);
    if (cur.route === "/explicabilitate") {
      const rows = driversFor(date);
      const topCat = byCategory(rows).find((c) => c.value > 0)?.category;
      if (topCat) {
        const t = window.setTimeout(() => window.dispatchEvent(new CustomEvent("ews-whatif", { detail: { cat: topCat, to: scenarioFactor(fullSeries[indexOf(date)]?.p ?? 0), instant: reduce } })), 700);
        return () => clearTimeout(t);
      }
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, date]);

  const rect = useRect(cur?.targets ?? [], `${step}|${date}`);
  const next = useCallback(() => setStep((s) => (date ? Math.min(6, s + 1) : s)), [date]);
  const prev = useCallback(() => setStep((s) => Math.max(date ? 1 : 0, s - 1)), [date]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      else if (e.key === "ArrowRight" && step > 0) { e.preventDefault(); next(); }
      else if (e.key === "ArrowLeft" && step > 1) { e.preventDefault(); prev(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [next, prev, onClose, step]);
  useEffect(() => { panel.current?.focus({ preventScroll: true }); }, [step]);
  useEffect(() => {
    document.body.style.paddingBottom = "70vh";
    return () => { document.body.style.paddingBottom = ""; };
  }, []);

  return (
    <div className="fixed inset-0 z-[60]" aria-hidden={false}>
      {rect ? (
        <div className={cn("pointer-events-none fixed rounded-xl ring-4 ring-brand-accent spotlight", !reduce && "transition-all duration-300")}
          style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }} />
      ) : (
        <div className="fixed inset-0 bg-overlay" />
      )}
      <div
        ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="pres-t"
        className="fixed inset-x-3 bottom-3 mx-auto max-w-4xl rounded-2xl border bg-card p-6 text-card-foreground shadow-2xl outline-none md:bottom-6 md:p-8"
      >
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm font-semibold uppercase tracking-wider text-brand-accent dark:text-primary">
            Mod prezentare {step > 0 && `· ${step}/6`}
          </p>
          <button onClick={onClose} aria-label="Ieși din modul prezentare (Esc)" className="-m-2 flex size-11 items-center justify-center rounded-md hover:bg-muted">
            <X aria-hidden className="size-5" />
          </button>
        </div>

        {step === 0 ? (
          <>
            <h2 id="pres-t" className="mt-2 text-3xl font-bold">Alege ziua prezentată</h2>
            <p className="mt-2 text-lg text-muted-foreground">Toată prezentarea folosește datele acestei zile.</p>
            <ul className="mt-5 grid gap-3">
              {choices.map((c) => (
                <li key={c.id}>
                  <button onClick={() => { setDate(c.date ?? null); setStep(1); }}
                    className="min-h-14 w-full rounded-lg border px-4 text-left text-lg font-medium hover:border-primary hover:bg-accent">
                    {c.label}
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : cur && (
          <>
            <h2 id="pres-t" className="mt-2 text-3xl font-bold md:text-4xl">{cur.title}</h2>
            <p className="mt-3 text-xl leading-relaxed md:text-2xl" aria-live="polite">{cur.caption}</p>
            {notes && (
              <ul className="mt-4 list-disc space-y-1 rounded-lg bg-muted p-4 pl-8 text-base">
                {cur.notes.map((n) => <li key={n}>{n}</li>)}
              </ul>
            )}
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
              <ol className="flex gap-2" aria-label="Pași">
                {steps.map((s, i) => (
                  <li key={s.title}>
                    <button onClick={() => setStep(i + 1)} aria-label={`Pasul ${i + 1}: ${s.title}`} aria-current={step === i + 1 ? "step" : undefined}
                      className="flex size-11 items-center justify-center">
                      <span className={cn("block size-3 rounded-full", step === i + 1 ? "bg-brand-accent" : "bg-border")} />
                    </button>
                  </li>
                ))}
              </ol>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => setNotes((v) => !v)} aria-pressed={notes} className="inline-flex min-h-12 items-center gap-2 rounded-md border px-4 text-base hover:bg-muted">
                  <NotebookText aria-hidden className="size-5" /> Note prezentator
                </button>
                <button onClick={prev} disabled={step <= 1} className="inline-flex min-h-12 items-center gap-1 rounded-md border px-4 text-base hover:bg-muted disabled:opacity-40">
                  <ChevronLeft aria-hidden className="size-5" /> Înapoi
                </button>
                {step < 6 ? (
                  <button onClick={next} className="inline-flex min-h-12 items-center gap-1 rounded-md bg-primary px-5 text-base font-semibold text-primary-foreground">
                    Înainte <ChevronRight aria-hidden className="size-5" />
                  </button>
                ) : (
                  <button onClick={onClose} className="min-h-12 rounded-md bg-primary px-5 text-base font-semibold text-primary-foreground">Încheie</button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
