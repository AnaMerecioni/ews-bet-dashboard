import { byCategory, median, metrics, whatIf } from "./compute";
import { categoryPhrases } from "./summary";
import { days, fmtContrib, fmtDate, pct, pp } from "./format";
import { LEVEL_RO } from "./notify";
import type { Alert, Day, DriverRow, Episode, Level } from "./types";

export type Seg = string | { b: string };
export interface Answer {
  segs: Seg[];
  text: string;
  link?: { to: string; search?: Record<string, string | undefined>; label: string };
  visual?: { kind: "gauge"; p: number; alert: number; high: number } | { kind: "levels"; rows: { label: string; low: number; moderate: number; high: number }[] };
  extra?: { kind: "categories"; items: string[] };
}
export interface QAContext {
  series: Day[];
  alerts: Alert[];
  episodes: Episode[];
  thr: { alert: number; high: number };
  driversFor: (d: string) => DriverRow[];
  hasDrivers: boolean;
  hasOutcomes: boolean;
  unit: "pp" | "logit";
  playbook: Record<Level, { action: string; owner: string }>;
  categories: string[];
  confirmDays: number;
}
export interface Question {
  id: string;
  label: (c: QAContext) => string;
  keywords: string;
  answer: (c: QAContext, arg?: string) => Answer;
}

export const normalize = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ");

const mk = (segs: Seg[], rest: Omit<Answer, "segs" | "text"> = {}): Answer => ({
  segs, text: segs.map((s) => (typeof s === "string" ? s : s.b)).join(""), ...rest,
});
const last = (c: QAContext) => c.series[c.series.length - 1];
const sinceMonths = (c: QAContext, m: number) => {
  const d = new Date(last(c).date + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() - m);
  const from = d.toISOString().slice(0, 10);
  return c.series.filter((x) => x.date >= from);
};

export const QUESTIONS: Question[] = [
  {
    id: "today", keywords: "risc azi astazi acum nivel probabilitate stare situatie cum stam",
    label: () => "Care este riscul azi?",
    answer: (c) => {
      const d = last(c);
      const diff = d.p - c.thr.alert;
      return mk([
        `Riscul este `, { b: LEVEL_RO[d.level].toUpperCase() }, `: probabilitate de `, { b: pct(d.p) },
        ` ca BET să scadă cu ≥5% în următoarele 20 de zile, `, diff >= 0 ? `cu ${pp(diff)} peste` : `cu ${pp(-diff)} sub`,
        ` pragul de alertă (${pct(c.thr.alert, 0)}).`,
      ], { link: { to: "/", label: "Vezi rezumatul" }, visual: { kind: "gauge", p: d.p, alert: c.thr.alert, high: c.thr.high } });
    },
  },
  {
    id: "alert", keywords: "alerta activa avem alarma semnal acum",
    label: () => "Avem o alertă activă?",
    answer: (c) => {
      const a = c.alerts.find((x) => x.active);
      if (!a) return mk([{ b: "Nu" }, `. Nu există nicio alertă activă; probabilitatea de azi este ${pct(last(c).p)} (prag ${pct(c.thr.alert, 0)}).`], { link: { to: "/alerte", label: "Vezi alertele" } });
      return mk([{ b: "Da" }, ` — alertă ${LEVEL_RO[a.level].toLowerCase()} activă din `, { b: fmtDate(a.start) }, ` (${days(a.duration)}), cu vârf de `, { b: pct(a.peak) }, ` pe ${fmtDate(a.peakDate)}.`],
        { link: { to: "/alerte", search: { id: a.id }, label: "Vezi detaliile alertei" } });
    },
  },
  {
    id: "week", keywords: "schimbat saptamana trecuta fata de acum 5 zile evolutie variatie diferenta ieri",
    label: () => "Ce s-a schimbat față de săptămâna trecută?",
    answer: (c) => {
      const n = c.series.length;
      const d = c.series[n - 1], o = c.series[Math.max(0, n - 6)];
      const segs: Seg[] = [`Probabilitatea a ${d.p >= o.p ? "crescut" : "scăzut"} cu `, { b: pp(d.p - o.p) }, ` (de la ${pct(o.p)} la ${pct(d.p)}). `];
      segs.push(d.level === o.level ? `Nivelul a rămas ${LEVEL_RO[d.level]}.` : `Nivelul s-a schimbat: ${LEVEL_RO[o.level]} → `, ...(d.level === o.level ? [] : [{ b: LEVEL_RO[d.level] }, "."]));
      if (c.hasDrivers) {
        const now = new Map(byCategory(c.driversFor(d.date)).map((x) => [x.category, x.value]));
        const then = new Map(byCategory(c.driversFor(o.date)).map((x) => [x.category, x.value]));
        let best = "", bv = 0;
        for (const k of new Set([...now.keys(), ...then.keys()])) {
          const v = (now.get(k) ?? 0) - (then.get(k) ?? 0);
          if (Math.abs(v) > Math.abs(bv)) { bv = v; best = k; }
        }
        if (best) segs.push(` Cel mai mult s-a mișcat categoria `, { b: best }, ` (${fmtContrib(bv, c.unit)}).`);
      }
      return mk(segs, { link: { to: "/ansamblu", label: "Vezi graficul" } });
    },
  },
  {
    id: "why", keywords: "de ce cauza motiv factori explicatie ridicat scazut drivers ce impinge",
    label: (c) => `De ce este riscul ${last(c).level === "low" ? "scăzut" : "ridicat"}?`,
    answer: (c) => {
      const d = last(c);
      if (!c.hasDrivers) return mk(["Încarcă ", { b: "drivers.csv" }, " pentru a vedea factorii care explică riscul."], { link: { to: "/date", label: "Mergi la Date" } });
      const cp = categoryPhrases(c.driversFor(d.date), 3);
      if (!cp.items.length) return mk([`Riscul este ${LEVEL_RO[d.level].toLowerCase()} pentru că `, { b: "niciun factor nu împinge riscul în sus" }, " în această zi."], { link: { to: "/explicabilitate", label: "Vezi explicabilitatea" } });
      return mk([
        d.level === "low" ? "Riscul rămâne scăzut; factorii care îl cresc cel mai mult sunt: " : "Riscul este împins în sus de: ",
        { b: cp.sentence }, ".",
      ], { link: { to: "/explicabilitate", label: "Vezi explicabilitatea" }, extra: { kind: "categories", items: cp.items.map((i) => `${i.category} ${fmtContrib(i.value, c.unit)}`) } });
    },
  },
  {
    id: "action", keywords: "ce facem ce trebuie sa facem cine decide responsabil actiune plan decizie owner",
    label: () => "Ce trebuie să facem și cine decide?",
    answer: (c) => {
      const pb = c.playbook[last(c).level];
      return mk([`La nivel ${LEVEL_RO[last(c).level]} decide `, { b: pb.owner }, `: ${pb.action}`], { link: { to: "/alerte", label: "Vezi planul de acțiune" } });
    },
  },
  {
    id: "lastAlert", keywords: "ultima alerta cand cat a durat durata episod precedent",
    label: () => "Când a fost ultima alertă și cât a durat?",
    answer: (c) => {
      const a = c.alerts[c.alerts.length - 1];
      if (!a) return mk([{ b: "Nicio alertă" }, " în datele încărcate."]);
      const out = a.confirmed === null ? "" : a.confirmed ? " A fost confirmată (BET a scăzut ≥5%)." : " A fost o alarmă falsă.";
      return mk([`Ultima alertă a început pe `, { b: fmtDate(a.start) }, a.active ? " și este încă activă" : ` și s-a încheiat pe ${fmtDate(a.end)}`, `, durată `, { b: days(a.duration) }, `, vârf ${pct(a.peak)}.${out}`],
        { link: { to: "/alerte", search: { id: a.id }, label: "Vezi alerta" } });
    },
  },
  {
    id: "freq", keywords: "cat de des frecventa risc ridicat ultimele 3 6 12 luni an procent zile istoric",
    label: () => "Cât de des am avut risc ridicat în ultimele 3/6/12 luni?",
    answer: (c) => {
      const rows = [3, 6, 12].map((m) => {
        const s = sinceMonths(c, m);
        const share = (l: Level) => (s.length ? s.filter((x) => x.level === l).length / s.length : 0);
        return { label: m === 12 ? "12 luni" : `${m} luni`, low: share("low"), moderate: share("moderate"), high: share("high") };
      });
      return mk([`Risc ridicat în `, { b: pct(rows[0].high, 0) }, ` din zile în ultimele 3 luni, `, { b: pct(rows[1].high, 0) }, ` în 6 luni și `, { b: pct(rows[2].high, 0) }, ` în 12 luni.`],
        { link: { to: "/ansamblu", label: "Vezi graficul" }, visual: { kind: "levels", rows } });
    },
  },
  {
    id: "model", keywords: "cat de bun model performanta anticipat episoade trecute acuratete backtest f2 auc",
    label: () => "Cât de bine a anticipat modelul episoadele trecute?",
    answer: (c) => {
      if (!c.hasOutcomes) return mk(["Pentru a răspunde, încarcă ", { b: "outcomes.csv" }, " cu rezultatele reale (Date, stress_event_20d)."], { link: { to: "/date", label: "Mergi la Date" } });
      const w = c.episodes.filter((e) => e.warned);
      const med = median(w.map((e) => e.warningDays!));
      const m = metrics(c.series, c.thr.alert);
      return mk([{ b: `${w.length} din ${c.episodes.length}` }, " episoade anticipate", med !== null ? `, avans median ` : "", ...(med !== null ? [{ b: days(Math.round(med)) } as Seg] : []), `. F2 = ${m.f2.toFixed(2).replace(".", ",")}, AUC = ${m.auc.toFixed(2).replace(".", ",")}.`],
        { link: { to: "/backtest", label: "Vezi backtestul" } });
    },
  },
  {
    id: "false", keywords: "alarme false cat de des gresit fals pozitive precizie",
    label: () => "Cât de des dă alarme false?",
    answer: (c) => {
      if (!c.hasOutcomes) return mk(["Pentru a răspunde, încarcă ", { b: "outcomes.csv" }, " cu rezultatele reale."], { link: { to: "/date", label: "Mergi la Date" } });
      const known = c.alerts.filter((a) => a.confirmed !== null);
      const f = known.filter((a) => a.confirmed === false).length;
      return mk([{ b: `${f} din ${known.length}` }, ` alerte (${pct(known.length ? f / known.length : 0, 0)}) au fost alarme false. Pragul e ales să rateze cât mai puține episoade, acceptând unele alarme false.`],
        { link: { to: "/alerte", label: "Vezi alertele" } });
    },
  },
  {
    id: "whatif", keywords: "ce ar fi daca scenariu creste simulare categorie sensibilitate",
    label: () => "Ce s-ar întâmpla dacă o categorie crește?",
    answer: (c, arg) => {
      if (!c.hasDrivers) return mk(["Încarcă ", { b: "drivers.csv" }, " pentru scenarii."], { link: { to: "/date", label: "Mergi la Date" } });
      const d = last(c);
      const rows = c.driversFor(d.date);
      const cat = arg && c.categories.includes(arg) ? arg : byCategory(rows).find((x) => x.value > 0)?.category ?? c.categories[0];
      const np = whatIf(d.p, rows, { [cat]: 1.5 }, c.unit);
      return mk([`Dacă contribuția categoriei `, { b: cat }, ` crește cu 50%, probabilitatea ar trece de la ${pct(d.p)} la `, { b: pct(np) }, ` (aproximare pe baza contribuțiilor SHAP).`],
        { link: { to: "/explicabilitate", search: { cat }, label: "Deschide scenariul" }, extra: { kind: "categories", items: [] } });
    },
  },
  {
    id: "thresholds", keywords: "praguri prag de ce folosim justificare limita alerta ridicat",
    label: () => "Ce praguri folosim și de ce?",
    answer: (c) => mk([`Alertă la `, { b: pct(c.thr.alert, 0) }, ` (maximizează F2 — o alarmă ratată costă mai mult decât una falsă), risc ridicat de la `, { b: pct(c.thr.high, 0) }, ` (unde stresul apare istoric de ≥2× mai des). Alerta se confirmă după ${days(c.confirmDays)} consecutive.`],
      { link: { to: "/setari", label: "Vezi setările" } }),
  },
];

export function searchQuestions(q: string, c: QAContext) {
  const tokens = normalize(q).split(/\s+/).filter((t) => t.length > 1);
  if (!tokens.length) return QUESTIONS;
  return QUESTIONS.map((x) => {
    const words = normalize(`${x.label(c)} ${x.keywords}`).split(/\s+/);
    let score = 0;
    for (const t of tokens) {
      if (words.includes(t)) score += 2;
      else if (words.some((w) => w.startsWith(t) || (t.length > 3 && w.startsWith(t.slice(0, -1))))) score += 1;
    }
    return { x, score };
  }).filter((r) => r.score > 0).sort((a, b) => b.score - a.score).map((r) => r.x);
}
