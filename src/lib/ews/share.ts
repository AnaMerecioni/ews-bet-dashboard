import { toast } from "sonner";
import type { NotifSettings } from "./store";
import { parseRecipients } from "./notify";
import { sendDigest } from "./email";
import type { Level } from "./types";

/** Copies text to clipboard with Romanian feedback. */
export async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); toast.success("Textul a fost copiat."); }
  catch { toast.error("Nu am putut copia textul. Selectează-l manual."); }
}

/** Sends via EmailJS when configured, otherwise opens a prefilled mailto link. */
export async function shareByEmail(n: NotifSettings, subject: string, text: string, level: Level, p: number) {
  const to = parseRecipients(n.recipients);
  if (n.serviceId && n.templateId && n.publicKey && to.length) {
    try {
      await sendDigest(n, [{
        id: "share", createdAt: "", date: new Date().toISOString().slice(0, 10), asset: "", type: "level", severity: "info", title: subject,
        from: "", to: "", level, p, drivers: [], action: "", owner: "", read: true,
      }], window.location.origin, { subject, message: text });
      toast.success(`Trimis către ${to.join(", ")}.`);
      return;
    } catch { toast.error("EmailJS a eșuat; se deschide programul de e-mail."); }
  }
  window.location.href = `mailto:${encodeURIComponent(to.join(","))}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
}
