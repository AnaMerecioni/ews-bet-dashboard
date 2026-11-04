import type { FileKind } from "./types";

export type RemoteStatus = "loading" | "ok" | "error";
export interface RemoteSource {
  url: string;
  status: RemoteStatus;
  error?: string;
  hint?: string;
  lastOk?: string; // ISO time of last successful fetch
  rows?: number;
  latestDate?: string;
  hash?: string;
}
export type RemoteSources = Partial<Record<FileKind, RemoteSource>>;
export type RefreshMinutes = 0 | 5 | 15 | 60;

/** Normalize GitHub blob / Google Sheets links to a direct CSV URL. Returns null if not a valid https URL. */
export function normalizeUrl(input: string): string | null {
  const raw = input.trim();
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== "https:") return null;
  if (u.hostname === "github.com") {
    const m = u.pathname.match(/^\/([^/]+)\/([^/]+)\/(?:blob|raw)\/(.+)$/);
    if (m) return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}`;
    return raw;
  }
  if (u.hostname === "docs.google.com" && u.pathname.startsWith("/spreadsheets/")) {
    if (/\/pub(html)?$/.test(u.pathname) || u.searchParams.get("output") === "csv") {
      if (u.pathname.endsWith("/pubhtml")) { u.pathname = u.pathname.replace(/pubhtml$/, "pub"); }
      u.searchParams.set("output", "csv");
      return u.toString();
    }
    const m = u.pathname.match(/^\/spreadsheets\/d\/([^/]+)/);
    if (m && m[1] !== "e") {
      const gid = u.searchParams.get("gid") ?? u.hash.match(/gid=(\d+)/)?.[1] ?? "0";
      return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv&gid=${gid}`;
    }
  }
  return raw;
}

/**
 * raw.githubusercontent.com este servit printr-un CDN care păstrează fișierul ~5 minute și ignoră
 * parametrii de tip ?t=. API-ul GitHub („contents”) întoarce mereu versiunea curentă și permite CORS.
 * Întoarce URL-ul API echivalent sau null dacă linkul nu e un fișier raw GitHub.
 */
export function githubApiUrl(rawUrl: string): string | null {
  const m = rawUrl.match(/^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/);
  if (!m) return null;
  const [, owner, repo, ref, path] = m;
  return `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`;
}

export function bust(url: string, t = Date.now()): string {
  return url + (url.includes("?") ? "&" : "?") + "t=" + t;
}

export function hashText(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36) + ":" + s.length;
}

export class FetchError extends Error {
  constructor(message: string, public hint: string) { super(message); }
}

/** Fișierele GitHub se citesc întâi prin API (fără cache); dacă API-ul refuză (ex. limita de 60 cereri/oră), revenim la raw. */
async function fetchGithubFresh(url: string): Promise<string | null> {
  const api = githubApiUrl(url);
  if (!api) return null;
  try {
    const res = await fetch(api, { cache: "no-store", headers: { Accept: "application/vnd.github.raw" } });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

export async function fetchCsvText(url: string): Promise<string> {
  const fresh = await fetchGithubFresh(url);
  if (fresh !== null && !looksLikeHtml(fresh)) return fresh;
  let res: Response;
  try {
    res = await fetch(bust(url), { cache: "no-store" });
  } catch {
    throw new FetchError(
      "Linkul nu permite citirea din browser (rețea sau CORS).",
      "Folosește linkul raw de pe GitHub sau Google Sheets publicat ca CSV (Fișier → Partajare → Publică pe web → CSV).",
    );
  }
  if (res.status === 404) throw new FetchError("Fișierul nu a fost găsit (404).", "Verifică linkul și că fișierul/foaia este publică.");
  if (res.status === 401 || res.status === 403) throw new FetchError(`Acces refuzat (${res.status}).`, "Fă fișierul public sau publică foaia Google Sheets pe web.");
  if (!res.ok) throw new FetchError(`Serverul a răspuns cu eroarea ${res.status}.`, "Încearcă din nou mai târziu sau verifică linkul.");
  const text = await res.text();
  if (looksLikeHtml(text)) {
    throw new FetchError("Linkul întoarce o pagină web, nu un fișier CSV.", "Pe GitHub folosește butonul „Raw”; pentru Google Sheets publică foaia ca CSV.");
  }
  return text;
}

export function looksLikeHtml(text: string): boolean {
  const head = text.slice(0, 300).trimStart().toLowerCase();
  return head.startsWith("<!doctype") || head.startsWith("<html") || head.startsWith("<?xml") || head.startsWith("{");
}

/** Shareable config: just the URLs per kind + refresh interval. */
export interface RemoteConfig { links: Partial<Record<FileKind, string>>; refresh?: RefreshMinutes }
const KINDS: FileKind[] = ["predictions", "drivers", "outcomes", "sensitivity"];

export function encodeConfig(c: RemoteConfig): string {
  const json = JSON.stringify(c);
  const b = btoa(unescape(encodeURIComponent(json)));
  return b.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeConfig(s: string): RemoteConfig | null {
  const t = s.trim();
  let json = t;
  if (!t.startsWith("{")) {
    try {
      const fromUrl = t.includes("src=") ? new URL(t, "https://x").searchParams.get("src") ?? "" : t;
      const b = fromUrl.replace(/-/g, "+").replace(/_/g, "/");
      json = decodeURIComponent(escape(atob(b + "===".slice((b.length + 3) % 4))));
    } catch { return null; }
  }
  try {
    const o = JSON.parse(json);
    const links: Partial<Record<FileKind, string>> = {};
    for (const k of KINDS) {
      const v = o?.links?.[k];
      if (typeof v === "string" && normalizeUrl(v)) links[k] = normalizeUrl(v)!;
    }
    if (!Object.keys(links).length) return null;
    const r = Number(o.refresh);
    return { links, refresh: ([0, 5, 15, 60] as number[]).includes(r) ? (r as RefreshMinutes) : undefined };
  } catch { return null; }
}
