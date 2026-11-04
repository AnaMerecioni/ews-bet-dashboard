import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, BellRing, Copy, Mail, MessageCircleQuestion, Search } from "lucide-react";
import { useEws } from "@/lib/ews/store";
import { QUESTIONS, normalize, searchQuestions, type Answer, type QAContext } from "@/lib/ews/qa";
import { copyText, shareByEmail } from "@/lib/ews/share";
import { fmtDate, pct, pp } from "@/lib/ews/format";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { LevelBadge } from "./ui";
import { cn } from "@/lib/utils";

export function useQA(): QAContext {
  const e = useEws();
  return useMemo(() => ({
    series: e.fullSeries, alerts: e.alerts, episodes: e.episodes, thr: e.thr, driversFor: e.driversFor, hasDrivers: e.hasDrivers,
    hasOutcomes: e.hasOutcomes, unit: e.settings.shapUnit, playbook: e.settings.playbook, categories: e.categories, confirmDays: e.settings.confirmDays,
  }), [e.fullSeries, e.alerts, e.episodes, e.thr, e.driversFor, e.hasDrivers, e.hasOutcomes, e.settings, e.categories]);
}

function Visual({ v }: { v: NonNullable<Answer["visual"]> }) {
  if (v.kind === "gauge") {
    const max = Math.max(v.high * 1.4, v.p * 1.1, 0.05);
    const x = (n: number) => `${Math.min(100, (n / max) * 100)}%`;
    return (
      <div className="mt-3" aria-hidden>
        <div className="relative h-3 overflow-hidden rounded-full bg-muted">
          <div className="absolute inset-y-0 left-0 bg-risk-low/30" style={{ width: x(v.alert) }} />
          <div className="absolute inset-y-0 bg-risk-moderate/30" style={{ left: x(v.alert), width: `calc(${x(v.high)} - ${x(v.alert)})` }} />
          <div className="absolute inset-y-0 right-0 bg-risk-high/30" style={{ left: x(v.high) }} />
          <div className="absolute inset-y-0 w-1 rounded bg-foreground" style={{ left: x(v.p) }} />
        </div>
        <div className="mt-1 flex justify-between text-xs text-muted-foreground"><span>0%</span><span>alertă {pct(v.alert, 0)} · ridicat {pct(v.high, 0)}</span></div>
      </div>
    );
  }
  return (
    <table className="mt-3 w-full text-xs">
      <caption className="sr-only">Procent de zile pe nivel de risc</caption>
      <tbody>
        {v.rows.map((r) => (
          <tr key={r.label}>
            <th scope="row" className="w-16 py-1 pr-2 text-left font-medium">{r.label}</th>
            <td className="py-1">
              <div className="flex h-4 overflow-hidden rounded" aria-label={`Scăzut ${pct(r.low, 0)}, Moderat ${pct(r.moderate, 0)}, Ridicat ${pct(r.high, 0)}`}>
                <div className="bg-risk-low" style={{ width: `${r.low * 100}%` }} />
                <div className="bg-risk-moderate" style={{ width: `${r.moderate * 100}%` }} />
                <div className="bg-risk-high" style={{ width: `${r.high * 100}%` }} />
              </div>
            </td>
            <td className="w-24 pl-2 text-right tabular-nums">Ridicat {pct(r.high, 0)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function AnswerCard({ title, a, onNavigate }: { title: string; a: Answer; onNavigate?: () => void }) {
  const { settings, fullSeries } = useEws();
  const d = fullSeries.at(-1);
  const plain = `${title}\n${a.text}`;
  return (
    <div className="rounded-xl border bg-card p-5 shadow-card">
      <div aria-live="polite" className="sr-only">{a.text}</div>
      <p className="text-sm font-semibold text-muted-foreground">{title}</p>
      <p className="mt-1.5 text-base leading-relaxed">
        {a.segs.map((s, i) => (typeof s === "string" ? <span key={i}>{s}</span> : <strong key={i}>{s.b}</strong>))}
      </p>
      {a.visual && <Visual v={a.visual} />}
      {a.extra?.items.length ? (
        <ul className="mt-3 flex flex-wrap gap-2">
          {a.extra.items.map((t) => <li key={t} className="rounded-full border bg-muted px-3 py-1 text-xs font-medium">{t}</li>)}
        </ul>
      ) : null}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {a.link && (
          <Link {...({ to: a.link.to, search: a.link.search ?? {} } as { to: "/" })} onClick={onNavigate}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground">
            Vezi detalii <span className="sr-only">: {a.link.label}</span><ArrowRight aria-hidden className="size-4" />
          </Link>
        )}
        <button onClick={() => copyText(plain)} className="inline-flex min-h-11 items-center gap-1.5 rounded-md border px-3 text-sm hover:bg-muted">
          <Copy aria-hidden className="size-4" /> Copiază răspunsul
        </button>
        <button onClick={() => d && shareByEmail(settings.notif, `[Evaluare risc] ${title}`, plain, d.level, d.p)} className="inline-flex min-h-11 items-center gap-1.5 rounded-md border px-3 text-sm hover:bg-muted">
          <Mail aria-hidden className="size-4" /> Trimite pe e-mail
        </button>
      </div>
    </div>
  );
}

export function QuickQuestions({ ids }: { ids?: string[] }) {
  const qa = useQA();
  const [sel, setSel] = useState<string | null>(null);
  const list = ids ? QUESTIONS.filter((q) => ids.includes(q.id)) : QUESTIONS;
  const q = QUESTIONS.find((x) => x.id === sel);
  const ans = useMemo(() => (q && qa.series.length ? q.answer(qa) : null), [q, qa]);
  return (
    <section aria-labelledby="qq-h" className="space-y-3 print:hidden">
      <h2 id="qq-h" className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
        <MessageCircleQuestion aria-hidden className="size-4" /> Întrebări rapide
      </h2>
      <ul className="flex flex-wrap gap-2">
        {list.map((x) => (
          <li key={x.id}>
            <button aria-pressed={sel === x.id} onClick={() => setSel(sel === x.id ? null : x.id)}
              className={cn("min-h-11 rounded-full border px-4 text-sm font-medium transition-colors", sel === x.id ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted")}>
              {x.label(qa)}
            </button>
          </li>
        ))}
      </ul>
      {q && ans && <AnswerCard title={q.label(qa)} a={ans} />}
    </section>
  );
}

export function AskPalette() {
  const qa = useQA();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const lid = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const results = useMemo(() => searchQuestions(query, qa), [query, qa]);
  const pq = QUESTIONS.find((x) => x.id === picked);
  const catArg = qa.categories.find((c) => { const w = normalize(c).split(" ")[0]; return w.length > 3 && normalize(query).includes(w); });
  const ans = useMemo(() => (pq && qa.series.length ? pq.answer(qa, catArg) : null), [pq, qa, catArg]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen(true); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => { if (!open) { setQuery(""); setPicked(null); } }, [open]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(results.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Enter" && results[active]) { e.preventDefault(); setPicked(results[active].id); }
  };

  return (
    <>
      <button onClick={() => setOpen(true)} aria-label="Ce vrei să afli? Deschide căutarea (Ctrl+K)" aria-keyshortcuts="Control+K Meta+K"
        className="flex min-h-11 w-full min-w-0 items-center gap-2 rounded-lg border bg-card px-3 text-sm text-muted-foreground hover:border-primary sm:w-72">
        <Search aria-hidden className="size-4 shrink-0" />
        <span className="truncate">Ce vrei să afli?</span>
        <kbd className="ml-auto hidden rounded border bg-muted px-1.5 text-[11px] sm:inline">Ctrl K</kbd>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl gap-0 p-0">
          <DialogTitle className="sr-only">Întreabă</DialogTitle>
          <DialogDescription className="sr-only">Scrie o întrebare și alege din listă cu săgețile și Enter.</DialogDescription>
          <div className="flex items-center gap-2 border-b px-4">
            <Search aria-hidden className="size-5 text-muted-foreground" />
            <input
              ref={inputRef} autoFocus value={query} onChange={(e) => { setQuery(e.target.value); setPicked(null); }} onKeyDown={onKey}
              role="combobox" aria-expanded={results.length > 0} aria-controls={lid} aria-autocomplete="list"
              aria-activedescendant={results[active] ? `${lid}-${results[active].id}` : undefined} aria-label="Ce vrei să afli?"
              placeholder="ex. risc azi, alertă, de ce, ce facem, prag…"
              className="min-h-14 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div className="max-h-[65vh] overflow-y-auto p-3">
            {ans && pq ? (
              <AnswerCard title={pq.label(qa)} a={ans} onNavigate={() => setOpen(false)} />
            ) : null}
            <ul id={lid} role="listbox" aria-label="Întrebări" className={cn("space-y-1", ans && "mt-3")}>
              {results.map((r, i) => (
                <li key={r.id} id={`${lid}-${r.id}`} role="option" aria-selected={i === active}
                  onMouseEnter={() => setActive(i)} onClick={() => setPicked(r.id)}
                  className={cn("flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-3 text-sm", i === active ? "bg-accent text-accent-foreground" : "", picked === r.id && "font-semibold")}>
                  <MessageCircleQuestion aria-hidden className="size-4 shrink-0 text-muted-foreground" /> {r.label(qa)}
                </li>
              ))}
              {!results.length && <li className="px-3 py-6 text-center text-sm text-muted-foreground">Nicio întrebare potrivită. Încearcă „risc azi”, „alertă” sau „ce facem”.</li>}
            </ul>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ManagementStrip() {
  const { fullSeries, alerts, lastDate, isDemo, files, remoteLive } = useEws();
  const d = fullSeries.at(-1);
  if (!d) return null;
  const o = fullSeries[Math.max(0, fullSeries.length - 6)];
  const a = alerts.find((x) => x.active);
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t px-4 py-2 text-sm md:px-6" role="region" aria-label="Starea de azi pe scurt">
      <LevelBadge level={d.level} />
      <span>Probabilitate <strong className="tabular-nums">{pct(d.p)}</strong></span>
      <span className={d.p - o.p > 0 ? "text-risk-up-text" : "text-risk-down-text"}>{d.p - o.p >= 0 ? "▲" : "▼"} {pp(d.p - o.p)} <span className="text-muted-foreground">vs. 5 zile</span></span>
      <span className="inline-flex items-center gap-1">
        <BellRing aria-hidden className="size-4" /> {a ? <strong className="text-risk-up-text">Alertă activă din {fmtDate(a.start)}</strong> : "Fără alertă activă"}
      </span>
      <span className="ml-auto text-xs text-muted-foreground">
        {remoteLive && <span className="mr-1 inline-flex items-center gap-1 font-semibold text-risk-low"><span aria-hidden className="inline-block size-2 animate-pulse rounded-full bg-current" />live<span className="sr-only"> — sursă conectată prin link</span></span>}
        Ultima actualizare: <strong className="text-foreground">{fmtDate(lastDate)}</strong>
        {!isDemo && files.updatedAt && <> · încărcate {fmtDate(files.updatedAt.slice(0, 10))} {new Date(files.updatedAt).toTimeString().slice(0, 5)}</>}
      </span>
    </div>
  );
}
