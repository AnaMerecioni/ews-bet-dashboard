import { useEffect, useState, type ReactNode } from "react";
import { Link, useRouter } from "@tanstack/react-router";
import {
  BellRing, Database, FileText, FlaskConical, Info, LayoutDashboard, Lightbulb, PanelLeftClose, PanelLeftOpen, Settings,
} from "lucide-react";
import { useEws, type RangePreset } from "@/lib/ews/store";
import { useScrollFx } from "@/lib/ews/scrollFx";
import { fmtDate } from "@/lib/ews/format";
import { cn } from "@/lib/utils";
import { NotificationCenter } from "./NotificationCenter";
import { GamaMark } from "./GamaMark";
import { AskPalette, ManagementStrip } from "./Ask";
import { PresentationButton } from "./Presentation";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const NAV = [
  { to: "/", label: "Rezumat", short: "Rezumat", Icon: FileText },
  { to: "/ansamblu", label: "Privire de ansamblu", short: "Azi", Icon: LayoutDashboard },
  { to: "/alerte", label: "Alerte și acțiuni", short: "Alerte", Icon: BellRing },
  { to: "/explicabilitate", label: "Explicabilitate", short: "Factori", Icon: Lightbulb },
  { to: "/backtest", label: "Backtest", short: "Backtest", Icon: FlaskConical },
  { to: "/date", label: "Date", short: "Date", Icon: Database },
  { to: "/setari", label: "Setări", short: "Setări", Icon: Settings },
] as const;

const PRESETS: RangePreset[] = ["3L", "6L", "1A", "Tot"];
const PRESET_LABEL: Record<string, string> = { "3L": "Ultimele 3 luni", "6L": "Ultimele 6 luni", "1A": "Ultimul an", Tot: "Toată perioada" };

export function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  // Pe GitHub Pages orice adresă primește același HTML pre-randat pentru „/”, iar componentele <Link>
  // rămân la starea din hidratare. Urmărim calea direct din router, după fiecare navigare rezolvată.
  const router = useRouter();
  const [path, setPath] = useState<string | null>(null);
  useEffect(() => {
    const update = () => setPath(router.state.resolvedLocation?.pathname ?? router.state.location.pathname);
    update();
    return router.subscribe("onResolved", update);
  }, [router]);
  const isActive = (to: string) => path !== null && (to === "/" ? path === "/" : path.startsWith(to));
  const ews = useEws();
  useScrollFx();

  return (
    <div
      className="app-root min-h-screen bg-background"
      onPointerMove={(e) => {
        const el = (e.target as HTMLElement).closest<HTMLElement>(".sheen");
        if (!el) return;
        const r = el.getBoundingClientRect();
        el.style.setProperty("--mx", `${e.clientX - r.left}px`);
        el.style.setProperty("--my", `${e.clientY - r.top}px`);
      }}
    >
      <div aria-hidden className="mesh" />
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground">
        Sari la conținut
      </a>
      <div className="flex">
        <aside
          className={cn(
            "glass-bar sticky top-0 hidden h-screen shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground md:flex print:hidden",
            collapsed ? "w-[72px]" : "w-64",
          )}
          aria-label="Navigare principală"
        >
          <div className="flex h-20 items-center gap-3 px-5">
            <GamaMark className="size-10 shrink-0 rounded-xl shadow-[0_0_26px_-4px_#39ff14]" />
            {!collapsed && (
              <span className="min-w-0 leading-tight">
                <span className="block font-display text-lg font-bold tracking-tight">Gama</span>
                <span className="block text-xs text-muted-foreground">Sistem de avertizare timpurie</span>
              </span>
            )}
          </div>
          <nav key={path ?? "ssr"} className="flex-1 space-y-1 p-3">
            {NAV.map(({ to, label, Icon }) => {
              const active = isActive(to);
              return (
                <Link
                  key={to}
                  to={to}
                  title={collapsed ? label : undefined}
                  activeProps={{}}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex min-h-11 items-center gap-3 rounded-lg border-l-2 px-3 text-sm transition-colors",
                    active
                      ? "border-primary bg-sidebar-accent font-semibold text-sidebar-foreground"
                      : "border-transparent font-medium text-muted-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-foreground",
                  )}
                >
                  <Icon aria-hidden className="size-5 shrink-0" />
                  {collapsed ? <span className="sr-only">{label}</span> : label}
                </Link>
              );
            })}
          </nav>
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? "Extinde meniul" : "Restrânge meniul"}
            className="m-3 flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm text-muted-foreground hover:bg-muted"
          >
            {collapsed ? <PanelLeftOpen aria-hidden className="size-5" /> : <PanelLeftClose aria-hidden className="size-5" />}
            {!collapsed && "Restrânge"}
          </button>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col pb-20 md:pb-0">
          {/* pe telefon bara de sus e prea înaltă ca să rămână fixată; se fixează de la md în sus */}
          <header className="app-header glass-bar relative z-30 border-b bg-background/70 backdrop-blur-xl md:sticky md:top-0 print:hidden">
            <div className="flex flex-wrap items-end gap-x-4 gap-y-3 px-4 py-3 md:px-6">
              <div className="mr-auto min-w-0 self-center">
                <p className="font-display text-base font-semibold sm:text-lg">
                  Sistem de avertizare timpurie<span className="hidden 2xl:inline"> – stres pe indicele BET</span>
                </p>
                {ews.lastDate && <p className="text-xs text-muted-foreground">Ultima actualizare a datelor: <span className="tabular-nums">{fmtDate(ews.lastDate)}</span></p>}
              </div>
              {ews.assets.length > 1 && (
                <label className="flex flex-col gap-1">
                  <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Activ</span>
                  <select
                    value={ews.asset}
                    onChange={(e) => ews.setAsset(e.target.value)}
                    className="min-h-10 rounded-lg border border-input bg-card px-2 text-sm"
                  >
                    {ews.assets.map((a) => <option key={a} value={a}>{a || "Implicit"}</option>)}
                  </select>
                </label>
              )}
              <div className="flex flex-col gap-1">
              <span aria-hidden className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Perioadă</span>
              <div role="group" aria-label="Interval de timp" className="flex items-center rounded-lg border border-input bg-card p-0.5">
                {PRESETS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    aria-pressed={ews.range.preset === p}
                    aria-label={PRESET_LABEL[p]}
                    onClick={() => ews.setRange({ preset: p })}
                    className={cn(
                      "min-h-10 min-w-11 rounded-md px-2.5 text-sm font-medium",
                      ews.range.preset === p ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {p}
                  </button>
                ))}
                <Popover>
                  <PopoverTrigger
                    aria-pressed={ews.range.preset === "custom"}
                    className={cn(
                      "min-h-10 rounded-md px-2.5 text-sm font-medium",
                      ews.range.preset === "custom" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
                    )}
                  >
                    Interval…
                  </PopoverTrigger>
                  <PopoverContent className="w-72 space-y-3">
                    <p className="text-sm font-semibold">Interval personalizat</p>
                    {(["from", "to"] as const).map((k) => (
                      <label key={k} className="block text-sm">
                        {k === "from" ? "De la" : "Până la"}
                        <input
                          type="date"
                          min={ews.fullSeries[0]?.date}
                          max={ews.lastDate}
                          value={ews.range[k] ?? ""}
                          onChange={(e) => ews.setRange({ ...ews.range, preset: "custom", [k]: e.target.value })}
                          className="mt-1 block min-h-11 w-full rounded-md border bg-card px-2"
                        />
                      </label>
                    ))}
                  </PopoverContent>
                </Popover>
              </div>
              </div>
              <div className="flex items-center gap-2">
                <AskPalette />
                <PresentationButton />
                <NotificationCenter />
              </div>
            </div>
            <ManagementStrip />
            {ews.isDemo && ews.hydrated && (
              <div className="flex items-center gap-2 border-t bg-accent/60 px-4 py-1.5 text-xs text-accent-foreground md:px-6">
                <Info aria-hidden className="size-4 shrink-0" />
                <span>Date demonstrative —</span>
                <Link to="/date" className="font-semibold underline underline-offset-2">încarcă fișierele echipei</Link>
                {ews.canSimulate && (
                  <button onClick={ews.simulateUpdate} className="ml-auto min-h-8 rounded-md border border-current px-2 font-semibold hover:bg-background">
                    Simulează actualizare
                  </button>
                )}
              </div>
            )}
            <div aria-hidden className="scroll-progress" />
          </header>
          <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1500px] flex-1 px-4 py-6 md:px-6 focus:outline-none">
            {children}
          </main>
        </div>
      </div>

      <nav key={path ?? "ssr"} aria-label="Navigare principală" className="fixed inset-x-0 bottom-0 z-40 glass-bar grid grid-cols-7 border-t bg-sidebar/90 backdrop-blur-xl md:hidden print:hidden">
        {NAV.map(({ to, short, label, Icon }) => {
          const active = isActive(to);
          return (
            <Link key={to} to={to} aria-label={label} activeProps={{}} aria-current={active ? "page" : undefined}
              className={cn("flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px]", active ? "text-primary font-semibold" : "text-muted-foreground")}>
              <Icon aria-hidden className="size-5" />
              {short}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
