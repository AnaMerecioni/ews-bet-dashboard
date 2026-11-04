import type { Alert, Day, DriverRow, Level } from "./types";
import { byCategory, topDrivers } from "./compute";
import { fmtContrib, fmtDate, num, pct } from "./format";

export type Severity = "info" | "avertizare" | "critic";
export type EventType = "level" | "alertStart" | "alertEnd" | "jump" | "threshold" | "driver";

export const EVENT_LABELS: Record<EventType, string> = {
  level: "Schimbare nivel de risc",
  alertStart: "Alertă nouă",
  alertEnd: "Alertă încheiată",
  jump: "Salt de probabilitate",
  threshold: "Praguri modificate",
  driver: "Categorie principală schimbată",
};
export const SEVERITY_LABELS: Record<Severity, string> = { info: "Info", avertizare: "Avertizare", critic: "Critic" };
export const SEV_RANK: Record<Severity, number> = { info: 0, avertizare: 1, critic: 2 };
const LEVEL_RANK: Record<Level, number> = { low: 0, moderate: 1, high: 2 };
export const LEVEL_RO: Record<Level, string> = { low: "Scăzut", moderate: "Moderat", high: "Ridicat" };

export interface Snapshot {
  date: string;
  p: number;
  level: Level;
  alert: number;
  high: number;
  alertActive: boolean;
  alertStart: string | null;
  topCategory: string | null;
}

export interface NotifEvent {
  id: string;
  createdAt: string;
  date: string;
  asset: string;
  type: EventType;
  severity: Severity;
  title: string;
  from: string;
  to: string;
  level: Level;
  p: number;
  drivers: string[];
  action: string;
  owner: string;
  read: boolean;
}

export function makeSnapshot(series: Day[], alerts: Alert[], thr: { alert: number; high: number }, drivers: DriverRow[]): Snapshot | null {
  const d = series.at(-1);
  if (!d) return null;
  const active = alerts.find((a) => a.active) ?? null;
  return {
    date: d.date, p: d.p, level: d.level, alert: thr.alert, high: thr.high,
    alertActive: !!active, alertStart: active?.start ?? null,
    topCategory: byCategory(drivers).find((c) => c.value > 0)?.category ?? null,
  };
}

/**
 * ID-ul unui eveniment include tranziția (de unde → unde), nu doar tipul și data.
 * Altfel, o rulare nouă a modelului pe ACEEAȘI zi (ex. Moderat → Ridicat după ce mai devreme fusese
 * Ridicat → Moderat) avea același ID cu un eveniment vechi și era aruncată ca duplicat.
 */
export const eventId = (asset: string, type: EventType, date: string, from: string, to: string) =>
  `${asset}|${type}|${date}|${from}→${to}`;

/** Compare previous and new snapshot; returns events (without playbook fields). */
export function detectEvents(
  prev: Snapshot | null, next: Snapshot, prevDayP: number | null, jumpPP: number, asset: string,
  driverRows: DriverRow[], unit: "pp" | "logit", playbook: Record<Level, { action: string; owner: string }>,
): NotifEvent[] {
  if (!prev) return [];
  if (prev.date === next.date && prev.p === next.p && prev.alert === next.alert && prev.high === next.high) return [];
  const drivers = topDrivers(driverRows, 3).map((r) => `${r.label ?? r.feature} (${fmtContrib(r.contribution, unit)})`);
  const pb = playbook[next.level];
  const out: NotifEvent[] = [];
  const add = (type: EventType, severity: Severity, title: string, from: string, to: string) =>
    out.push({
      id: eventId(asset, type, next.date, from, to), createdAt: new Date().toISOString(), date: next.date, asset, type, severity, title, from, to,
      level: next.level, p: next.p, drivers, action: pb.action, owner: pb.owner, read: false,
    });

  if (prev.level !== next.level) {
    const up = LEVEL_RANK[next.level] > LEVEL_RANK[prev.level];
    add("level", up ? (next.level === "high" ? "critic" : "avertizare") : "info",
      `Risc ${up ? "în creștere" : "în scădere"}: ${LEVEL_RO[prev.level]} → ${LEVEL_RO[next.level]}`, LEVEL_RO[prev.level], LEVEL_RO[next.level]);
  }
  if (next.alertActive && (!prev.alertActive || prev.alertStart !== next.alertStart)) {
    add("alertStart", next.level === "high" ? "critic" : "avertizare", `Alertă EWS nouă din ${fmtDate(next.alertStart ?? next.date)}`, "fără alertă", "alertă activă");
  }
  if (!next.alertActive && prev.alertActive) add("alertEnd", "info", "Alerta EWS s-a încheiat", "alertă activă", "fără alertă");
  if (prevDayP !== null) {
    const diff = next.p - prevDayP;
    if (Math.abs(diff) * 100 >= jumpPP) {
      add("jump", diff > 0 ? (diff * 100 >= jumpPP * 2 ? "critic" : "avertizare") : "info",
        `Probabilitatea a ${diff > 0 ? "crescut" : "scăzut"} cu ${num(Math.abs(diff) * 100, 1)} p.p. într-o zi`, pct(prevDayP), pct(next.p));
    }
  }
  if (prev.alert !== next.alert || Math.abs(prev.high - next.high) > 1e-9) {
    add("threshold", "info", "Pragurile de risc s-au modificat", `${pct(prev.alert)} / ${pct(prev.high)}`, `${pct(next.alert)} / ${pct(next.high)}`);
  }
  if (prev.topCategory && next.topCategory && prev.topCategory !== next.topCategory) {
    add("driver", "info", `Categoria principală de risc: ${next.topCategory}`, prev.topCategory, next.topCategory);
  }
  return out;
}

export function digestSubject(ev: NotifEvent[]) {
  const top = [...ev].sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity])[0];
  return `[Evaluare risc] Risc ${LEVEL_RO[top.level].toUpperCase()} · ${pct(top.p)} · ${fmtDate(top.date)}`;
}

export function eventBody(ev: NotifEvent[], link: string) {
  const e = ev[0];
  return [
    `Nivel de risc: ${LEVEL_RO[e.level]} · probabilitate ${pct(e.p)} · data ${fmtDate(e.date)}${e.asset ? ` · activ ${e.asset}` : ""}`,
    "",
    "Evenimente:",
    ...ev.map((x) => `- [${SEVERITY_LABELS[x.severity]}] ${x.title} (${x.from} → ${x.to})`),
    "",
    `Factori principali: ${e.drivers.join("; ") || "—"}`,
    `Acțiune recomandată: ${e.action}`,
    `Responsabil: ${e.owner}`,
    "",
    `Tablou de bord: ${link}`,
  ].join("\n");
}

export function mailtoLink(ev: NotifEvent[], to: string, link: string) {
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(digestSubject(ev))}&body=${encodeURIComponent(eventBody(ev, link))}`;
}

export const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim());
export const parseRecipients = (s: string) => s.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);

export function inQuietHours(from: string, to: string, now = new Date()) {
  if (!from || !to) return false;
  const m = now.getHours() * 60 + now.getMinutes();
  const [fh, fm] = from.split(":").map(Number), [th, tm] = to.split(":").map(Number);
  const a = fh * 60 + fm, b = th * 60 + tm;
  return a <= b ? m >= a && m < b : m >= a || m < b;
}
