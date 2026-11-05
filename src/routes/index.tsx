import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { ChevronLeft, ChevronRight, Copy, Mail, Printer, UserRound } from "lucide-react";
import { toast } from "sonner";
import { useEws } from "@/lib/ews/store";
import { categoryPhrases, summaryPct } from "@/lib/ews/summary";
import { days, fmtContrib, fmtDate, pct } from "@/lib/ews/format";
import { parseRecipients } from "@/lib/ews/notify";
import { sendDigest } from "@/lib/ews/email";
import { LEVELS, LevelBadge, RiskGauge } from "@/components/ews/ui";
import { QuickQuestions } from "@/components/ews/Ask";
import { Hero } from "@/components/ews/Hero";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Rezumat evaluare risc · Sistem de avertizare timpurie" },
      { name: "description", content: "Rezumatul evaluării de risc pentru BET: probabilitate de stres pe 20 de zile, nivel, alertă și factori pe categorii." },
      { property: "og:title", content: "Rezumat evaluare risc · Sistem de avertizare timpurie" },
      { property: "og:description", content: "Probabilitatea unui episod de stres al BET, nivelul de risc și descompunerea pe categorii, într-un singur card." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Summary,
});

function Summary() {
  const ews = useEws();
  const { fullSeries, selectedDate, setSelectedDate, indexOf, thr, alerts, driversFor, hasDrivers, settings } = ews;
  const idx = indexOf(selectedDate);
  const day = fullSeries[idx];
  const rows = driversFor(selectedDate);
  const cp = useMemo(() => categoryPhrases(rows, 3), [rows]);
  if (!day) return <div className="mx-auto h-96 max-w-[800px] animate-pulse rounded-xl bg-muted" aria-label="Se încarcă" />;

  const L = LEVELS[day.level];
  const above = day.p >= thr.alert;
  const alert = alerts.find((a) => a.startIdx <= idx && a.endIdx >= idx);
  const thrTxt = pct(thr.alert, 0);
  const alertText = above
    ? `ALERTĂ DE STRES – probabilitatea estimată depășește pragul operațional de alertare (${thrTxt}).`
    : `Fără alertă – probabilitatea estimată este sub pragul operațional de alertare (${thrTxt}).`;
  const confirmTxt = above
    ? alert
      ? `Alertă confirmată, activă din ${fmtDate(alert.start)}, ${days(idx - alert.startIdx + 1)}.`
      : `Încă neconfirmată (necesită ${days(settings.confirmDays)} consecutive peste prag).`
    : "";
  const catSentence = !hasDrivers
    ? "Încarcă drivers.csv pentru descompunerea pe categorii."
    : cp.sentence
      ? cp.sentence.charAt(0).toUpperCase() + cp.sentence.slice(1) + "."
      : "Nicio categorie nu crește riscul în această zi.";
  const pb = settings.playbook[day.level];

  const text = [
    "Rezumat evaluare risc",
    `Data evaluării: ${fmtDate(day.date)}`,
    `Probabilitate estimată a unui episod de stres (următoarele 20 de zile): ${summaryPct(day.p)}`,
    `Nivel de risc: ${L.label}`,
    `Alertă: ${alertText}${confirmTxt ? " " + confirmTxt : ""}`,
    `Descompunerea riscului pe categorii: ${catSentence}`,
    ...(cp.items.length ? [cp.items.map((i) => `${i.category} ${fmtContrib(i.value, settings.shapUnit)}`).join("; ")] : []),
    "",
    `Acțiune recomandată (${pb.owner}): ${pb.action}`,
  ].join("\n");
  const subject = `[Evaluare risc] Risc ${L.upper} · ${summaryPct(day.p)} · ${fmtDate(day.date)}`;

  const go = (d: number) => {
    const n = fullSeries[Math.min(fullSeries.length - 1, Math.max(0, idx + d))];
    if (n) setSelectedDate(n.date);
  };
  const pick = (v: string) => {
    const c = fullSeries.find((d) => d.date >= v) ?? fullSeries.at(-1);
    if (c) setSelectedDate(c.date);
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); toast.success("Textul a fost copiat."); }
    catch { toast.error("Nu am putut copia textul. Selectează-l manual."); }
  };
  const email = async () => {
    const n = settings.notif;
    const to = parseRecipients(n.recipients);
    if (n.serviceId && n.templateId && n.publicKey && to.length) {
      try {
        await sendDigest(n, [{
          id: "rezumat", createdAt: "", date: day.date, asset: ews.asset, type: "level", severity: "info", title: subject, from: "", to: "",
          level: day.level, p: day.p, drivers: cp.items.map((i) => `${i.category} ${fmtContrib(i.value, settings.shapUnit)}`), action: pb.action, owner: pb.owner, read: true,
        }], window.location.origin, { subject, message: text });
        toast.success(`Rezumatul a fost trimis către ${to.join(", ")}.`);
        return;
      } catch { toast.error("EmailJS a eșuat; se deschide programul de e-mail."); }
    }
    window.location.href = `mailto:${encodeURIComponent(to.join(","))}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
  };

  const btn = "inline-flex min-h-11 items-center gap-2 rounded-md border bg-card px-4 text-sm font-medium hover:bg-muted disabled:opacity-50";

  return (
    <div className="space-y-10">
    <Hero />
    <div className="mx-auto max-w-[860px] space-y-5">
      <div aria-live="polite" className="sr-only">{text}</div>
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex items-center gap-2">
          <button className={btn} onClick={() => go(-1)} disabled={idx <= 0}><ChevronLeft aria-hidden className="size-4" /> Ziua anterioară</button>
          <button className={btn} onClick={() => go(1)} disabled={idx >= fullSeries.length - 1}>Ziua următoare <ChevronRight aria-hidden className="size-4" /></button>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className={btn} onClick={copy}><Copy aria-hidden className="size-4" /> Copiază textul</button>
          <button className={btn} onClick={() => window.print()}><Printer aria-hidden className="size-4" /> Descarcă PDF / Printează</button>
          <button className={cn(btn, "border-transparent bg-primary text-primary-foreground hover:bg-primary/90")} onClick={email}><Mail aria-hidden className="size-4" /> Trimite pe e-mail</button>
        </div>
      </div>

      <article id="raport" data-reveal className="scroll-mt-40 overflow-hidden rounded-3xl border bg-hero text-card-foreground shadow-card" aria-labelledby="rez-h">
        <div className="px-6 pt-8 sm:px-10">
          <p className="eyebrow">01 — Riscul acum · Sistem de avertizare timpurie pentru riscuri emergente</p>
        </div>
        <div className="px-6 pb-8 pt-4 sm:px-10">
          <h1 id="rez-h" className="font-display text-3xl font-bold tracking-tight">Rezumat evaluare <span className="text-gradient">risc</span></h1>
          <div className="mt-6 grid gap-8 border-b pb-8 md:grid-cols-[1.25fr_1fr] print:hidden">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-muted-foreground">Probabilitate de stres la</p>
              <p className="font-display text-lg font-semibold tabular-nums">{fmtDate(day.date)}</p>
              <p className="text-gradient mt-1 font-display text-[clamp(4rem,11vw,8.5rem)] font-bold leading-none tracking-tight tabular-nums">{summaryPct(day.p)}</p>
              <p className="mt-4 max-w-md text-muted-foreground">șansa ca BET să scadă cu cel puțin 5% în următoarele 20 de zile de tranzacționare.</p>
            </div>
            <div className="flex flex-col justify-center gap-5">
              <div className="flex flex-wrap items-center gap-3">
                <LevelBadge level={day.level} />
                <span className="text-sm text-muted-foreground">{above ? "Peste pragul de alertă" : "Situație sub pragul de alertă"}</span>
              </div>
              <RiskGauge p={day.p} alert={thr.alert} high={thr.high} />
              <dl className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border bg-card/60 p-3">
                  <dt className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Prag alertă</dt>
                  <dd className="font-display text-xl font-bold tabular-nums">{thrTxt}</dd>
                </div>
                <div className="rounded-xl border bg-card/60 p-3">
                  <dt className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Alertă Gama</dt>
                  <dd className={cn("font-display text-xl font-bold", alert && "text-risk-up-text")}>{alert ? "activă" : above ? "neconfirmată" : "inactivă"}</dd>
                </div>
              </dl>
            </div>
          </div>
          <ul className="mt-6 space-y-4 text-[15px] leading-relaxed marker:text-primary list-disc pl-5">
            <li>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <strong>Data evaluării:</strong>
                <span className="tabular-nums">{fmtDate(day.date)}</span>
                <label className="print:hidden">
                  <span className="sr-only">Alege data evaluării</span>
                  <input type="date" value={day.date} min={fullSeries[0]?.date} max={ews.lastDate} onChange={(e) => pick(e.target.value)}
                    className="min-h-11 rounded-md border bg-card px-2 text-sm" />
                </label>
              </div>
            </li>
            {/* pe ecran aceste două rânduri sunt în blocul mare de sus; la printare rămân în listă */}
            <li className="hidden print:list-item">
              <strong>Probabilitate estimată a unui episod de stres (următoarele 20 de zile):</strong>{" "}
              <span className="text-lg font-bold tabular-nums">{summaryPct(day.p)}</span>
            </li>
            <li className="hidden print:list-item">
              <strong>Nivel de risc:</strong>{" "}
              <span className={cn("inline-flex items-center gap-1 font-bold", L.text)}>
                <L.Icon aria-hidden className="size-4" /> {L.label}
              </span>
            </li>
            <li>
              <strong>Alertă:</strong>{" "}
              {above ? (
                <><strong className="text-risk-high">ALERTĂ DE STRES</strong> – probabilitatea estimată depășește pragul operațional de alertare ({thrTxt}).</>
              ) : (
                <>Fără alertă – probabilitatea estimată este sub pragul operațional de alertare ({thrTxt}).</>
              )}
              {confirmTxt && <span className="block text-sm text-muted-foreground">{confirmTxt}</span>}
            </li>
            <li>
              <strong>Descompunerea riscului pe categorii:</strong> {catSentence}
              {cp.items.length > 0 && (
                <ul className="mt-2 flex list-none flex-wrap gap-2 pl-0" aria-label="Categorii care cresc riscul">
                  {cp.items.map((i) => (
                    <li key={i.category} className="rounded-full border bg-muted px-3 py-1 text-xs font-medium">
                      {i.category} <span className="font-semibold text-risk-up-text">{fmtContrib(i.value, settings.shapUnit)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          </ul>
        </div>
      </article>

      <QuickQuestions />
      <p data-reveal className="flex items-start gap-2 rounded-xl border bg-card px-4 py-3 text-sm">
        <UserRound aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
        <span><strong>Acțiune recomandată ({pb.owner}):</strong> {pb.action}</span>
      </p>
    </div>
    </div>
  );
}
