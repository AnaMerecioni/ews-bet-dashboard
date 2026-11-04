import { useEffect, useState } from "react";
import { BellRing, ExternalLink, Info, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useEws, type NotifSettings } from "@/lib/ews/store";
import { EVENT_LABELS, isEmail, parseRecipients, SEVERITY_LABELS, type EventType, type NotifEvent, type Severity } from "@/lib/ews/notify";
import { sendDigest } from "@/lib/ews/email";
import { Card } from "./ui";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const SEVS: Severity[] = ["info", "avertizare", "critic"];

function Field({ label, id, value, onChange, placeholder, type = "text" }: { label: string; id: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <label htmlFor={id} className="block text-sm font-medium">
      {label}
      <input id={id} type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} autoComplete="off"
        className="mt-1 block min-h-11 w-full rounded-md border bg-card px-3 placeholder:text-muted-foreground" />
    </label>
  );
}

function Toggle({ label, desc, checked, onChange }: { label: string; desc?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b py-3 last:border-0">
      <div><p className="font-medium">{label}</p>{desc && <p className="text-sm text-muted-foreground">{desc}</p>}</div>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} className="scale-125" />
    </div>
  );
}

function SevSelect({ label, value, onChange }: { label: string; value: Severity; onChange: (v: Severity) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 py-3 text-sm font-medium">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value as Severity)} className="min-h-11 rounded-md border bg-card px-2">
        {SEVS.map((s) => <option key={s} value={s}>{SEVERITY_LABELS[s]} și peste</option>)}
      </select>
    </label>
  );
}

export function NotificationSettings() {
  const { settings, updateNotif, clearNotifications, notifications } = useEws();
  const n = settings.notif;
  const [perm, setPerm] = useState<string>("default");
  useEffect(() => { setPerm(typeof Notification === "undefined" ? "unsupported" : Notification.permission); }, []);
  const [sending, setSending] = useState(false);
  const recips = parseRecipients(n.recipients);
  const bad = recips.filter((r) => !isEmail(r));

  const askBrowser = async () => {
    if (typeof Notification === "undefined") { setPerm("unsupported"); return; }
    const r = await Notification.requestPermission();
    setPerm(r);
    if (r === "granted") { updateNotif({ browser: true }); new Notification("Sistem de avertizare timpurie", { body: "Notificările din browser sunt active." }); }
    else toast.error("Permisiunea a fost refuzată. O poți activa din setările browserului (iconița de lângă adresă).");
  };

  const test = async () => {
    if (!n.serviceId || !n.templateId || !n.publicKey) { toast.error("Completează Service ID, Template ID și Public Key."); return; }
    if (!recips.length || bad.length) { toast.error("Adaugă cel puțin o adresă de e-mail validă."); return; }
    setSending(true);
    const ev: NotifEvent = {
      id: "test", createdAt: new Date().toISOString(), date: new Date().toISOString().slice(0, 10), asset: "", type: "level", severity: "info",
      title: "E-mail de test — Sistem de avertizare timpurie", from: "—", to: "—", level: "moderate", p: 0.184, drivers: ["Indicele VIX (+3,1 p.p.)"],
      action: settings.playbook.moderate.action, owner: settings.playbook.moderate.owner, read: true,
    };
    try {
      await sendDigest(n, [ev], window.location.origin);
      toast.success(`E-mail de test trimis către ${recips.join(", ")}.`);
    } catch (e) {
      const err = e as { text?: string; message?: string };
      toast.error(`Trimiterea a eșuat: ${err?.text ?? err?.message ?? "verifică datele EmailJS"}`);
    } finally { setSending(false); }
  };

  return (
    <Card aria-labelledby="notif-h" className="xl:col-span-2">
      <h2 id="notif-h" className="flex items-center gap-2 text-base font-semibold"><BellRing aria-hidden className="size-5" /> Notificări</h2>
      <p className="mt-2 flex gap-2 rounded-md bg-accent p-3 text-sm text-accent-foreground">
        <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
        Notificările sunt generate când deschizi tabloul de bord sau încarci date noi. E-mailuri complet automate, fără a deschide aplicația, ar necesita un server.
      </p>
      <div className="mt-4 grid gap-8 lg:grid-cols-3">
        <section aria-labelledby="ch-h">
          <h3 id="ch-h" className="font-semibold">Canale și reguli</h3>
          <Toggle label="În aplicație" desc="Clopoțel + mesaje pe ecran." checked={n.inApp} onChange={(v) => updateNotif({ inApp: v })} />
          <div className="border-b py-3">
            <div className="flex items-center justify-between gap-3">
              <div><p className="font-medium">În browser</p><p className="text-sm text-muted-foreground">Mesaj de sistem, chiar dacă fila nu e în față.</p></div>
              {perm === "granted" ? (
                <Switch checked={n.browser} onCheckedChange={(v) => updateNotif({ browser: v })} aria-label="Notificări în browser" className="scale-125" />
              ) : perm === "unsupported" ? null : (
                <button onClick={askBrowser} className="min-h-11 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground">Permite</button>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {perm === "unsupported" && "Browserul tău nu suportă notificări."}
              {perm === "denied" && "Permisiune refuzată. Activeaz-o din setările site-ului în browser, apoi reîncarcă pagina."}
              {perm === "default" && "Browserul îți va cere permisiunea o singură dată. Poți renunța oricând."}
            </p>
          </div>
          <Toggle label="Pe e-mail (EmailJS)" desc="Un singur e-mail de rezumat la fiecare încărcare de date." checked={n.email} onChange={(v) => updateNotif({ email: v })} />
          <SevSelect label="Severitate minimă (aplicație/browser)" value={n.minSeverity} onChange={(v) => updateNotif({ minSeverity: v })} />
          <label className="flex items-center justify-between gap-3 py-3 text-sm font-medium">
            Salt de probabilitate (p.p.)
            <input type="number" min={1} max={50} value={n.jumpPP} onChange={(e) => updateNotif({ jumpPP: Math.max(1, Number(e.target.value) || 5) })}
              className="min-h-11 w-20 rounded-md border bg-card px-2 text-right" />
          </label>
          <fieldset className="py-3 text-sm">
            <legend className="font-medium">Ore de liniște (opțional)</legend>
            <div className="mt-1 flex items-center gap-2">
              <input type="time" aria-label="De la" value={n.quietFrom} onChange={(e) => updateNotif({ quietFrom: e.target.value })} className="min-h-11 rounded-md border bg-card px-2" />
              <span>–</span>
              <input type="time" aria-label="Până la" value={n.quietTo} onChange={(e) => updateNotif({ quietTo: e.target.value })} className="min-h-11 rounded-md border bg-card px-2" />
            </div>
          </fieldset>
        </section>

        <section aria-labelledby="ty-h">
          <h3 id="ty-h" className="font-semibold">Tipuri de evenimente</h3>
          {(Object.keys(EVENT_LABELS) as EventType[]).map((t) => (
            <Toggle key={t} label={EVENT_LABELS[t]} checked={n.types[t]} onChange={(v) => updateNotif({ types: { ...n.types, [t]: v } })} />
          ))}
          <div className="pt-4">
            <AlertDialog>
              <AlertDialogTrigger disabled={!notifications.length} className="min-h-11 rounded-md border px-4 text-sm text-destructive hover:bg-muted disabled:opacity-50">
                Șterge istoricul ({notifications.length})
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Ștergi istoricul notificărilor?</AlertDialogTitle>
                  <AlertDialogDescription>Toate notificările salvate în acest browser vor fi șterse.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Renunță</AlertDialogCancel>
                  <AlertDialogAction onClick={clearNotifications}>Șterge</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </section>

        <section aria-labelledby="em-h" className="space-y-3">
          <h3 id="em-h" className="font-semibold">Notificări pe e-mail</h3>
          <p className="text-xs text-muted-foreground">Cheile se salvează doar în acest browser (localStorage) și nu sunt trimise nicăieri altundeva decât la EmailJS.</p>
          <Field id="ej-s" label="EmailJS Service ID" value={n.serviceId} onChange={(v) => updateNotif({ serviceId: v })} placeholder="service_xxxxxxx" />
          <Field id="ej-t" label="EmailJS Template ID" value={n.templateId} onChange={(v) => updateNotif({ templateId: v })} placeholder="template_xxxxxxx" />
          <Field id="ej-k" label="EmailJS Public Key" value={n.publicKey} onChange={(v: string) => updateNotif({ publicKey: v } as Partial<NotifSettings>)} />
          <label htmlFor="ej-r" className="block text-sm font-medium">
            Destinatari (separați prin virgulă)
            <textarea id="ej-r" rows={2} value={n.recipients} onChange={(e) => updateNotif({ recipients: e.target.value })}
              aria-invalid={bad.length > 0} aria-describedby="ej-r-err" placeholder="risk@banca.ro, cro@banca.ro"
              className="mt-1 block w-full rounded-md border bg-card px-3 py-2 placeholder:text-muted-foreground" />
          </label>
          <p id="ej-r-err" className="text-sm text-destructive" role={bad.length ? "alert" : undefined}>
            {bad.length > 0 && `Adrese invalide: ${bad.join(", ")}`}
          </p>
          <SevSelect label="Severitate minimă e-mail" value={n.emailMinSeverity} onChange={(v) => updateNotif({ emailMinSeverity: v })} />
          <button onClick={test} disabled={sending} className="inline-flex min-h-11 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60">
            {sending && <Loader2 aria-hidden className="size-4 animate-spin" />} Trimite e-mail de test
          </button>
          <details className="rounded-md border p-3 text-sm">
            <summary className="cursor-pointer font-medium">Cum configurez EmailJS (gratuit)?</summary>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
              <li>Creează un cont pe <a href="https://www.emailjs.com/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-brand-accent underline dark:text-primary">emailjs.com <ExternalLink aria-hidden className="size-3" /></a>.</li>
              <li>Email Services → Add New Service (ex. Gmail) → copiază <strong>Service ID</strong>.</li>
              <li>Email Templates → Create: pune <code>{"{{to_email}}"}</code> în câmpul „To”, <code>{"{{subject}}"}</code> la subiect și în corp variabilele <code>{"{{level}} {{probability}} {{date}} {{drivers}} {{action}} {{dashboard_link}}"}</code> (sau <code>{"{{message}}"}</code>). Copiază <strong>Template ID</strong>.</li>
              <li>Account → General → copiază <strong>Public Key</strong>.</li>
            </ol>
          </details>
        </section>
      </div>
    </Card>
  );
}
