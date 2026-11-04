import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type Context, type ReactNode } from "react";
import { toast } from "sonner";
import { generateDemo } from "./demo";
import { buildAlerts, buildEpisodes, levelOf, pairAlertsEpisodes } from "./compute";
import { detectEvents, makeSnapshot, SEV_RANK, inQuietHours, digestSubject, EVENT_LABELS, type NotifEvent, type Severity, type EventType, type Snapshot } from "./notify";
import { sendDigest } from "./email";
import { parseCsv } from "./parse";
import { decodeConfig, FetchError, fetchCsvText, hashText, normalizeUrl, type RefreshMinutes, type RemoteConfig, type RemoteSource, type RemoteSources } from "./remote";
import type { Alert, DataFiles, Day, DriverRow, Episode, FileKind, Level, OutcomeRow, PredRow, SensRow } from "./types";

export interface Playbook { action: string; owner: string }
export interface Settings {
  highThreshold: number | null;
  confirmDays: number;
  shapUnit: "pp" | "logit";
  theme: "light" | "dark" | "system";
  textSize: 100 | 115 | 130;
  highContrast: boolean;
  reduceMotion: boolean;
  reduceTransparency: boolean;
  cbPalette: boolean;
  playbook: Record<Level, Playbook>;
  tourDone: boolean;
  notif: NotifSettings;
}
export interface NotifSettings {
  inApp: boolean;
  browser: boolean;
  email: boolean;
  types: Record<EventType, boolean>;
  minSeverity: Severity;
  emailMinSeverity: Severity;
  jumpPP: number;
  quietFrom: string;
  quietTo: string;
  serviceId: string;
  templateId: string;
  publicKey: string;
  recipients: string;
}
export const DEFAULT_NOTIF: NotifSettings = {
  inApp: true, browser: false, email: false,
  types: { level: true, alertStart: true, alertEnd: true, jump: true, threshold: true, driver: true },
  minSeverity: "info", emailMinSeverity: "avertizare", jumpPP: 5, quietFrom: "", quietTo: "",
  serviceId: "", templateId: "", publicKey: "", recipients: "",
};
export const DEFAULT_PLAYBOOK: Record<Level, Playbook> = {
  low: { action: "Monitorizare standard: urmărire zilnică a indicatorilor, fără acțiuni suplimentare.", owner: "Analist risc" },
  moderate: { action: "Revizuirea expunerilor pe acțiuni BET, verificarea limitelor de stop-loss, raport către Comitetul de risc.", owner: "Risk Manager" },
  high: { action: "Reducerea expunerii sau hedging (futures/opțiuni), ședință extraordinară ALCO / Comitet de investiții.", owner: "CRO / CIO" },
};
export const DEFAULT_SETTINGS: Settings = {
  highThreshold: null,
  confirmDays: 2,
  shapUnit: "pp",
  theme: "light",
  textSize: 100,
  highContrast: false,
  reduceMotion: false,
  reduceTransparency: false,
  cbPalette: false,
  playbook: DEFAULT_PLAYBOOK,
  tourDone: false,
  notif: DEFAULT_NOTIF,
};

export type RangePreset = "3L" | "6L" | "1A" | "Tot" | "custom";
export interface Range { preset: RangePreset; from?: string; to?: string }

interface Ctx {
  hydrated: boolean;
  isDemo: boolean;
  files: DataFiles;
  settings: Settings;
  updateSettings: (s: Partial<Settings>) => void;
  setFile: (kind: FileKind, rows: unknown[], name: string) => void;
  clearData: () => void;
  assets: string[];
  asset: string;
  setAsset: (a: string) => void;
  range: Range;
  setRange: (r: Range) => void;
  fullSeries: Day[];
  series: Day[];
  thr: { alert: number; high: number; highFromFile: boolean };
  alerts: Alert[];
  episodes: Episode[];
  hasDrivers: boolean;
  hasOutcomes: boolean;
  sensitivity: SensRow[] | null;
  driversFor: (date: string) => DriverRow[];
  driverMap: Map<string, DriverRow[]>;
  features: { feature: string; label: string; category: string }[];
  categories: string[];
  lastDate: string;
  selectedDate: string;
  setSelectedDate: (d: string | null) => void;
  indexOf: (d: string) => number;
  notifications: NotifEvent[];
  markRead: (id: string | "all") => void;
  clearNotifications: () => void;
  updateNotif: (n: Partial<NotifSettings>) => void;
  simulateUpdate: () => void;
  canSimulate: boolean;
  live: { text: string; assertive: boolean; n: number };
  sources: RemoteSources;
  refreshMinutes: RefreshMinutes;
  setRefreshMinutes: (m: RefreshMinutes) => void;
  connectSource: (kind: FileKind, url: string) => Promise<boolean>;
  disconnectSource: (kind: FileKind) => void;
  refreshSources: () => Promise<void>;
  importConfig: (c: RemoteConfig) => void;
  remoteLive: boolean;
  remoteStatus: { text: string; n: number };
}

// Keep provider and consumers on the same context during Vite updates. This
// module also exports settings/helpers, so it can reload before its consumers.
const EwsContext: Context<Ctx | null> = import.meta.hot?.data?.ewsContext ?? createContext<Ctx | null>(null);
if (import.meta.hot?.data) import.meta.hot.data.ewsContext = EwsContext;
const K_DATA = "ews.data.v1";
const K_SET = "ews.settings.v1";
const K_NOTIF = "ews.notifications.v1";
const K_SNAP = "ews.snapshots.v1";
const K_SENT = "ews.emailSent.v1";
const K_CUT = "ews.demoCut.v1";
const DEMO_CUT = 6;
const K_SRC = "ews.sources.v1";
const KINDS_ALL: FileKind[] = ["predictions", "drivers", "outcomes", "sensitivity"];
const FILE_NAMES: Record<FileKind, string> = { predictions: "predictions.csv", drivers: "drivers.csv", outcomes: "outcomes.csv", sensitivity: "sensitivity.csv" };

export function EwsProvider({ children }: { children: ReactNode }) {
  const demo = useMemo(() => generateDemo(), []);
  const [hydrated, setHydrated] = useState(false);
  const [user, setUser] = useState<DataFiles>({});
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [assetSel, setAsset] = useState("");
  const [range, setRange] = useState<Range>({ preset: "1A" });
  const [selected, setSelectedDate] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<NotifEvent[]>([]);
  const [demoCut, setDemoCut] = useState(DEMO_CUT);
  const [live, setLive] = useState({ text: "", assertive: false, n: 0 });
  const [sources, setSources] = useState<RemoteSources>({});
  const [refreshMinutes, setRefreshMinutesState] = useState<RefreshMinutes>(15);
  const [remoteStatus, setRemoteStatus] = useState({ text: "", n: 0 });
  const [srcLoaded, setSrcLoaded] = useState(false);
  const sourcesRef = useRef<RemoteSources>({});

  useEffect(() => {
    try {
      const d = localStorage.getItem(K_DATA);
      if (d) setUser(JSON.parse(d));
      const s = localStorage.getItem(K_SET);
      if (s) {
        const parsed = JSON.parse(s);
        setSettings({ ...DEFAULT_SETTINGS, ...parsed, notif: { ...DEFAULT_NOTIF, ...parsed.notif, types: { ...DEFAULT_NOTIF.types, ...parsed.notif?.types } } });
      }
      const n = localStorage.getItem(K_NOTIF);
      if (n) setNotifications(JSON.parse(n));
      const c = localStorage.getItem(K_CUT);
      if (c !== null) setDemoCut(Number(c));
      const src = localStorage.getItem(K_SRC);
      let parsedSrc: { sources: RemoteSources; refresh: RefreshMinutes } = { sources: {}, refresh: 15 };
      if (src) parsedSrc = { ...parsedSrc, ...JSON.parse(src) };
      const qs = new URLSearchParams(window.location.search).get("src");
      const cfg = qs ? decodeConfig(qs) : null;
      if (cfg) {
        for (const k of KINDS_ALL) if (cfg.links[k]) parsedSrc.sources[k] = { url: cfg.links[k]!, status: "loading" };
        if (cfg.refresh !== undefined) parsedSrc.refresh = cfg.refresh;
        const u = new URL(window.location.href); u.searchParams.delete("src");
        window.history.replaceState(null, "", u.toString());
        toast.success("Configurația de linkuri a fost importată.");
      }
      sourcesRef.current = parsedSrc.sources;
      setSources(parsedSrc.sources);
      setRefreshMinutesState(parsedSrc.refresh);
    } catch { /* ignore corrupted storage */ }
    setSrcLoaded(true);
    setHydrated(true);
  }, []);

  // apply display settings
  useEffect(() => {
    const root = document.documentElement;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = settings.theme === "dark" || (settings.theme === "system" && mq.matches);
      root.classList.toggle("dark", dark);
    };
    apply();
    root.classList.toggle("hc", settings.highContrast);
    root.classList.toggle("cb", settings.cbPalette);
    root.classList.toggle("reduce-motion", settings.reduceMotion);
    const rt = window.matchMedia("(prefers-reduced-transparency: reduce)");
    root.classList.toggle("glass", !settings.reduceTransparency && !settings.highContrast && !rt.matches);
    root.style.fontSize = `${settings.textSize}%`;
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [settings]);

  const updateSettings = useCallback((s: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...s };
      try { localStorage.setItem(K_SET, JSON.stringify(next)); } catch { /* noop */ }
      return next;
    });
  }, []);

  const persist = (next: DataFiles) => {
    try {
      localStorage.setItem(K_DATA, JSON.stringify(next));
    } catch {
      toast.warning("Fișierele sunt prea mari pentru stocarea locală. Datele rămân active doar în această sesiune.");
    }
  };
  const setFile = useCallback((kind: FileKind, rows: unknown[], name: string) => {
    setUser((prev) => {
      const next: DataFiles = { ...prev, [kind]: rows, names: { ...prev.names, [kind]: name }, updatedAt: new Date().toISOString() };
      persist(next);
      return next;
    });
    setSelectedDate(null);
  }, []);
  const clearData = useCallback(() => {
    setUser({});
    try { localStorage.removeItem(K_DATA); } catch { /* noop */ }
    setSelectedDate(null);
  }, []);

  // ---- remote (link) sources ----
  const saveSources = (next: RemoteSources, refresh?: RefreshMinutes) => {
    sourcesRef.current = next;
    setSources(next);
    setRefreshMinutesState((r) => {
      const rr = refresh ?? r;
      try { localStorage.setItem(K_SRC, JSON.stringify({ sources: next, refresh: rr })); } catch { /* noop */ }
      return rr;
    });
  };
  const patchSource = (kind: FileKind, p: Partial<RemoteSource> | null) => {
    const cur = sourcesRef.current;
    const next = { ...cur };
    if (p === null) delete next[kind]; else next[kind] = { ...(cur[kind] ?? { url: "", status: "loading" }), ...p } as RemoteSource;
    saveSources(next);
  };
  const announce = (text: string) => setRemoteStatus((s) => ({ text, n: s.n + 1 }));
  const fetchOne = useCallback(async (kind: FileKind, url: string): Promise<boolean> => {
    patchSource(kind, { url, status: "loading", error: undefined, hint: undefined });
    announce(`${FILE_NAMES[kind]}: se încarcă.`);
    try {
      const text = await fetchCsvText(url);
      const h = hashText(text);
      const prev = sourcesRef.current[kind];
      if (sourcesRef.current[kind]?.url !== url) return false; // disconnected meanwhile
      if (prev?.hash === h && prev.rows !== undefined) {
        patchSource(kind, { status: "ok", lastOk: new Date().toISOString() });
        announce(`${FILE_NAMES[kind]}: conectat, fără modificări.`);
        return true;
      }
      const r = parseCsv(kind, text);
      if (r.errors.length) {
        patchSource(kind, { status: "error", error: r.errors.join(" "), hint: "Corectează fișierul sursă; formatul este același ca la încărcarea manuală (vezi șablonul)." });
        announce(`${FILE_NAMES[kind]}: eroare de validare.`);
        return false;
      }
      const dates = (r.rows as { date?: string }[]).map((x) => x.date).filter(Boolean) as string[];
      const latest = dates.reduce((a, b) => (b > a ? b : a), "");
      setFile(kind, r.rows, FILE_NAMES[kind] + " (link)");
      patchSource(kind, { status: "ok", lastOk: new Date().toISOString(), rows: r.rows.length, latestDate: latest || undefined, hash: h });
      announce(`${FILE_NAMES[kind]}: conectat, ${r.rows.length} rânduri.`);
      return true;
    } catch (e) {
      if (sourcesRef.current[kind]?.url !== url) return false;
      const fe = e instanceof FetchError ? e : new FetchError("Fișierul nu a putut fi citit.", "Verifică linkul și încearcă din nou.");
      patchSource(kind, { status: "error", error: fe.message, hint: fe.hint });
      announce(`${FILE_NAMES[kind]}: eroare. ${fe.message}`);
      return false;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const refreshSources = useCallback(async () => {
    const cur = sourcesRef.current;
    // predictions first so the series exists before optional files
    for (const k of KINDS_ALL) { const s = cur[k]; if (s) await fetchOne(k, s.url); }
  }, [fetchOne]);
  const connectSource = useCallback(async (kind: FileKind, input: string) => {
    const url = normalizeUrl(input);
    if (!url) {
      toast.error("Linkul nu este valid. Folosește o adresă care începe cu https://.");
      return false;
    }
    patchSource(kind, { url, status: "loading", hash: undefined, rows: undefined });
    return fetchOne(kind, url);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchOne]);
  const disconnectSource = useCallback((kind: FileKind) => { patchSource(kind, null); announce(`${FILE_NAMES[kind]}: deconectat.`); }, []);
  const importConfig = useCallback((c: RemoteConfig) => {
    const next: RemoteSources = { ...sourcesRef.current };
    for (const k of KINDS_ALL) if (c.links[k]) next[k] = { url: c.links[k]!, status: "loading" };
    saveSources(next, c.refresh);
    void refreshSources();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSources]);
  const setRefreshMinutes = useCallback((m: RefreshMinutes) => saveSources(sourcesRef.current, m), []);
  // refresh on app open
  const opened = useRef(false);
  useEffect(() => {
    if (!srcLoaded || opened.current) return;
    opened.current = true;
    void refreshSources();
  }, [srcLoaded, refreshSources]);
  // auto-refresh while open, paused when tab hidden
  const hasSources = Object.keys(sources).length > 0;
  useEffect(() => {
    if (!hasSources || !refreshMinutes) return;
    const id = window.setInterval(() => { if (document.visibilityState === "visible") void refreshSources(); }, refreshMinutes * 60_000);
    return () => window.clearInterval(id);
  }, [hasSources, refreshMinutes, refreshSources]);

  const isDemo = !user.predictions?.length;
  const demoView = useMemo(() => {
    const cutDate = demo.predictions[demo.predictions.length - 1 - demoCut]?.date ?? "";
    return {
      cutDate,
      predictions: demo.predictions.filter((r) => r.date <= cutDate),
      drivers: demo.drivers.filter((r) => r.date <= cutDate),
      outcomes: demo.outcomes.filter((r) => r.date <= cutDate),
    };
  }, [demo, demoCut]);
  const files: DataFiles = isDemo
    ? { ...demoView, names: { predictions: "demo", drivers: "demo", outcomes: "demo" }, updatedAt: undefined }
    : user;
  const simulateUpdate = useCallback(() => {
    setDemoCut((c) => {
      const n = Math.max(0, c - 1);
      try { localStorage.setItem(K_CUT, String(n)); } catch { /* noop */ }
      return n;
    });
    setSelectedDate(null);
  }, []);

  const assets = useMemo(() => [...new Set((files.predictions ?? []).map((r) => r.asset))].sort(), [files.predictions]);
  const asset = assets.includes(assetSel) ? assetSel : assets[0] ?? "";

  const preds = useMemo<PredRow[]>(
    () => (files.predictions ?? []).filter((r) => r.asset === asset).sort((a, b) => a.date.localeCompare(b.date)),
    [files.predictions, asset],
  );
  const thr = useMemo(() => {
    const alert = preds[0]?.thr ?? 0.2;
    const fileHigh = preds.find((r) => r.high !== undefined)?.high;
    const high = fileHigh ?? settings.highThreshold ?? Math.min(0.99, alert * 1.5);
    return { alert, high: Math.max(high, alert), highFromFile: fileHigh !== undefined };
  }, [preds, settings.highThreshold]);

  const outcomeMap = useMemo(() => {
    const m = new Map<string, OutcomeRow>();
    for (const o of files.outcomes ?? []) if (o.asset === asset || o.asset === "") m.set(o.date, o);
    return m;
  }, [files.outcomes, asset]);
  const hasOutcomes = outcomeMap.size > 0;

  // simulated "current date" (demo): every derived stat must only see data up to it
  const asOf = isDemo ? demoView.cutDate : "";
  const fullSeries = useMemo<Day[]>(
    () => preds.filter((r) => !asOf || r.date <= asOf).map((r) => {
      const o = outcomeMap.get(r.date);
      return { date: r.date, p: r.p, level: levelOf(r.p, thr.alert, thr.high), y: o?.y ?? null, bet: o?.bet };
    }),
    [preds, outcomeMap, thr, asOf],
  );
  const idxMap = useMemo(() => new Map(fullSeries.map((d, i) => [d.date, i])), [fullSeries]);
  const { alerts, episodes } = useMemo(() => {
    const raw = buildAlerts(fullSeries, thr.alert, thr.high, settings.confirmDays);
    return hasOutcomes ? pairAlertsEpisodes(fullSeries, raw, buildEpisodes(fullSeries)) : { alerts: raw, episodes: [] };
  }, [fullSeries, thr, settings.confirmDays, hasOutcomes]);

  const driverMap = useMemo(() => {
    const m = new Map<string, DriverRow[]>();
    for (const d of files.drivers ?? []) {
      if (d.asset !== asset && d.asset !== "") continue;
      if (asOf && d.date > asOf) continue;
      const arr = m.get(d.date);
      if (arr) arr.push(d); else m.set(d.date, [d]);
    }
    return m;
  }, [files.drivers, asset, asOf]);
  const features = useMemo(() => {
    const m = new Map<string, { feature: string; label: string; category: string }>();
    for (const rows of driverMap.values()) for (const r of rows) if (!m.has(r.feature)) m.set(r.feature, { feature: r.feature, label: r.label ?? r.feature, category: r.category });
    return [...m.values()];
  }, [driverMap]);
  const categories = useMemo(() => [...new Set(features.map((f) => f.category))], [features]);

  const lastDate = fullSeries.at(-1)?.date ?? "";
  const series = useMemo(() => {
    if (!fullSeries.length) return fullSeries;
    if (range.preset === "Tot") return fullSeries;
    if (range.preset === "custom") {
      return fullSeries.filter((d) => (!range.from || d.date >= range.from) && (!range.to || d.date <= range.to));
    }
    const months = range.preset === "3L" ? 3 : range.preset === "6L" ? 6 : 12;
    const end = new Date(lastDate + "T00:00:00Z");
    end.setUTCMonth(end.getUTCMonth() - months);
    const from = end.toISOString().slice(0, 10);
    return fullSeries.filter((d) => d.date >= from);
  }, [fullSeries, range, lastDate]);

  const selectedDate = selected && idxMap.has(selected) ? selected : lastDate;
  const driversFor = useCallback((d: string) => driverMap.get(d) ?? [], [driverMap]);
  const indexOf = useCallback((d: string) => idxMap.get(d) ?? -1, [idxMap]);

  // ---- change detection & notifications ----
  const lastKey = useRef("");
  const persistNotifs = (list: NotifEvent[]) => {
    try { localStorage.setItem(K_NOTIF, JSON.stringify(list.slice(0, 300))); } catch { /* noop */ }
  };
  const lastP = fullSeries.at(-1)?.p ?? null;
  useEffect(() => {
    if (!hydrated || !fullSeries.length) return;
    // Cheia include și probabilitatea ultimei zile + momentul încărcării: o rulare nouă a modelului pe ACELEAȘI
    // zile (alte probabilități) trebuie să declanșeze detectarea, nu doar apariția unei zile noi.
    const key = `${isDemo}|${asset}|${lastDate}|${lastP}|${files.updatedAt ?? ""}|${thr.alert}|${thr.high}|${settings.confirmDays}`;
    if (lastKey.current === key) return;
    lastKey.current = key;
    const rows = driverMap.get(lastDate) ?? [];
    const snap = makeSnapshot(fullSeries, alerts, thr, rows);
    if (!snap) return;
    let snaps: Record<string, Snapshot> = {};
    try { snaps = JSON.parse(localStorage.getItem(K_SNAP) ?? "{}"); } catch { /* noop */ }
    const sk = (isDemo ? "demo|" : "") + asset;
    const n = settings.notif;
    const evs = detectEvents(snaps[sk] ?? null, snap, fullSeries.at(-2)?.p ?? null, n.jumpPP, asset, rows, settings.shapUnit, settings.playbook)
      .filter((e) => n.types[e.type]);
    snaps[sk] = snap;
    try { localStorage.setItem(K_SNAP, JSON.stringify(snaps)); } catch { /* noop */ }
    if (!evs.length) return;
    setNotifications((prev) => {
      const ids = new Set(prev.map((p) => p.id));
      const fresh = evs.filter((e) => !ids.has(e.id));
      const next = [...fresh, ...prev];
      persistNotifs(next);
      return next;
    });
    const quiet = inQuietHours(n.quietFrom, n.quietTo);
    const shown = evs.filter((e) => SEV_RANK[e.severity] >= SEV_RANK[n.minSeverity]);
    if (n.inApp && shown.length && !quiet) {
      const crit = shown.some((e) => e.severity === "critic");
      for (const e of shown.slice(0, 3)) {
        (e.severity === "critic" ? toast.error : e.severity === "avertizare" ? toast.warning : toast.info)(e.title, { description: `${e.from} → ${e.to}` });
      }
      setLive((l) => ({ text: `${shown.length} notificări noi. ${shown[0].title}.`, assertive: crit, n: l.n + 1 }));
    }
    if (n.browser && !quiet && typeof Notification !== "undefined" && Notification.permission === "granted" && shown.length) {
      try {
        new Notification(digestSubject(shown), { body: shown.map((e) => `${EVENT_LABELS[e.type]}: ${e.from} → ${e.to}`).join("\n"), tag: `ews-${snap.date}` });
      } catch { /* some browsers require a service worker */ }
    }
    if (n.email && n.serviceId && n.templateId && n.publicKey && n.recipients) {
      let sent: string[] = [];
      try { sent = JSON.parse(localStorage.getItem(K_SENT) ?? "[]"); } catch { /* noop */ }
      const toSend = evs.filter((e) => SEV_RANK[e.severity] >= SEV_RANK[n.emailMinSeverity] && !sent.includes(e.id));
      if (toSend.length) {
        try { localStorage.setItem(K_SENT, JSON.stringify([...toSend.map((e) => e.id), ...sent].slice(0, 500))); } catch { /* noop */ }
        sendDigest(n, toSend, window.location.origin)
          .then(() => toast.success("E-mailul de rezumat a fost trimis."))
          .catch((err) => toast.error(`E-mailul nu a putut fi trimis: ${err?.text ?? err?.message ?? "eroare necunoscută"}`));
      }
    }
  }, [hydrated, fullSeries, alerts, thr, asset, lastDate, lastP, files.updatedAt, isDemo, driverMap, settings]);

  const markRead = useCallback((id: string) => {
    setNotifications((prev) => {
      const next = prev.map((e) => (id === "all" || e.id === id ? { ...e, read: true } : e));
      persistNotifs(next);
      return next;
    });
  }, []);
  const clearNotifications = useCallback(() => {
    setNotifications([]);
    try { localStorage.removeItem(K_NOTIF); localStorage.removeItem(K_SENT); } catch { /* noop */ }
  }, []);
  const updateNotif = useCallback((p: Partial<NotifSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, notif: { ...prev.notif, ...p } };
      try { localStorage.setItem(K_SET, JSON.stringify(next)); } catch { /* noop */ }
      return next;
    });
  }, []);

  const value: Ctx = {
    notifications, markRead, clearNotifications, updateNotif, simulateUpdate, canSimulate: isDemo && demoCut > 0, live,
    sources, refreshMinutes, setRefreshMinutes, connectSource, disconnectSource, refreshSources, importConfig, remoteStatus,
    remoteLive: Object.values(sources).some((x) => x?.status === "ok" || (x?.status === "loading" && x.lastOk)),
    hydrated, isDemo, files, settings, updateSettings, setFile, clearData,
    assets, asset, setAsset, range, setRange, fullSeries, series, thr, alerts, episodes,
    hasDrivers: driverMap.size > 0, hasOutcomes, sensitivity: files.sensitivity?.length ? files.sensitivity : null,
    driversFor, driverMap, features, categories, lastDate, selectedDate, setSelectedDate, indexOf,
  };
  return <EwsContext.Provider value={value}>{children}</EwsContext.Provider>;
}

export function useEws() {
  const c = useContext(EwsContext);
  if (!c) throw new Error("useEws must be used inside EwsProvider");
  return c;
}
