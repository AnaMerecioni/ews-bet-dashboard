import { useState } from "react";
import { Bell, CheckCheck, Mail, OctagonAlert, AlertTriangle, Info } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useEws } from "@/lib/ews/store";
import { mailtoLink, parseRecipients, SEV_RANK, SEVERITY_LABELS, type NotifEvent, type Severity } from "@/lib/ews/notify";
import { fmtDate, pct } from "@/lib/ews/format";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

export const SEV_STYLE: Record<Severity, { Icon: typeof Info; cls: string }> = {
  info: { Icon: Info, cls: "bg-secondary text-secondary-foreground" },
  avertizare: { Icon: AlertTriangle, cls: "bg-risk-moderate text-on-risk" },
  critic: { Icon: OctagonAlert, cls: "bg-risk-high text-on-risk" },
};

export function SeverityBadge({ s }: { s: Severity }) {
  const { Icon, cls } = SEV_STYLE[s];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold", cls)}>
      <Icon aria-hidden className="size-3.5" /> {SEVERITY_LABELS[s]}
    </span>
  );
}

export function MailtoButton({ events, className }: { events: NotifEvent[]; className?: string }) {
  const { settings } = useEws();
  const to = parseRecipients(settings.notif.recipients).join(",");
  const href = mailtoLink(events, to, typeof window === "undefined" ? "" : `${window.location.origin}${import.meta.env.BASE_URL}alerte`);
  return (
    <a href={href} className={cn("inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-brand-accent hover:bg-muted dark:text-primary", className)}>
      <Mail aria-hidden className="size-4" /> Trimite pe e-mail
    </a>
  );
}

export function NotificationCenter() {
  const { notifications, markRead, live, simulateUpdate, canSimulate } = useEws();
  const [sev, setSev] = useState<Severity | "all">("all");
  const unread = notifications.filter((n) => !n.read).length;
  const list = notifications.filter((n) => sev === "all" || n.severity === sev);
  return (
    <>
      <div aria-live="polite" className="sr-only">{!live.assertive && live.text}</div>
      <div aria-live="assertive" className="sr-only">{live.assertive && live.text}</div>
      <Sheet>
        <SheetTrigger
          aria-label={unread ? `Notificări: ${unread} necitite` : "Notificări: nicio notificare necitită"}
          className="relative inline-flex size-11 items-center justify-center rounded-md border bg-card hover:bg-muted"
        >
          <Bell aria-hidden className="size-5" />
          {unread > 0 && (
            <span aria-hidden className="absolute -right-1.5 -top-1.5 min-w-5 rounded-full bg-risk-high px-1 text-center text-xs font-bold leading-5 text-on-risk">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </SheetTrigger>
        <SheetContent className="flex w-full flex-col sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Notificări</SheetTitle>
            <SheetDescription>Evenimente detectate la deschiderea tabloului de bord sau la încărcarea datelor noi.</SheetDescription>
          </SheetHeader>
          <div className="flex flex-wrap items-center gap-2 px-4">
            <label className="flex items-center gap-2 text-sm">
              Severitate
              <select value={sev} onChange={(e) => setSev(e.target.value as Severity | "all")} className="min-h-11 rounded-md border bg-card px-2">
                <option value="all">Toate</option>
                <option value="critic">Critic</option>
                <option value="avertizare">Avertizare</option>
                <option value="info">Info</option>
              </select>
            </label>
            <button onClick={() => markRead("all")} disabled={!unread} className="inline-flex min-h-11 items-center gap-1.5 rounded-md border px-3 text-sm hover:bg-muted disabled:opacity-50">
              <CheckCheck aria-hidden className="size-4" /> Marchează toate citite
            </button>
            {canSimulate && (
              <button onClick={simulateUpdate} className="min-h-11 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground">Simulează actualizare</button>
            )}
          </div>
          <ul className="flex-1 space-y-3 overflow-y-auto px-4 pb-4" aria-label="Listă notificări">
            {list.length === 0 && (
              <li className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                Nicio notificare încă. {canSimulate && "Apasă „Simulează actualizare” pentru a vedea cum funcționează."}
              </li>
            )}
            {/* cele mai recente primele: după momentul detectării, apoi după severitate */}
            {[...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.date.localeCompare(a.date) || SEV_RANK[b.severity] - SEV_RANK[a.severity]).map((n) => (
              <li key={n.id} className={cn("rounded-lg border p-3", !n.read && "border-l-4 border-l-brand-accent bg-accent/40")}>
                <div className="flex flex-wrap items-center gap-2">
                  <SeverityBadge s={n.severity} />
                  <span className="text-xs text-muted-foreground">{fmtDate(n.date)}{n.asset && ` · ${n.asset}`}</span>
                  {!n.read && <span className="text-xs font-semibold text-brand-accent dark:text-primary">Nou</span>}
                </div>
                <p className="mt-1.5 font-semibold">{n.title}</p>
                <p className="text-sm text-muted-foreground">{n.from} → {n.to} · probabilitate {pct(n.p)}</p>
                {n.drivers.length > 0 && <p className="mt-1 text-xs">Factori: {n.drivers.join("; ")}</p>}
                <p className="mt-1 text-xs"><strong>{n.owner}:</strong> {n.action}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {!n.read && <button onClick={() => markRead(n.id)} className="min-h-11 rounded-md px-3 text-sm hover:bg-muted">Marchează citit</button>}
                  <MailtoButton events={[n]} />
                </div>
              </li>
            ))}
          </ul>
          <div className="border-t px-4 py-3 text-sm">
            <Link to="/setari" className="font-medium text-brand-accent underline dark:text-primary">Setări notificări</Link>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
