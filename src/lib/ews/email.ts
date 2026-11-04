import type { NotifSettings } from "./store";
import { digestSubject, eventBody, parseRecipients, type NotifEvent } from "./notify";
import { pct, fmtDate } from "./format";
import { LEVEL_RO } from "./notify";

/** Sends ONE digest email via EmailJS (client-side). Library is loaded lazily in the browser only. */
export async function sendDigest(n: Pick<NotifSettings, "serviceId" | "templateId" | "publicKey" | "recipients">, ev: NotifEvent[], origin: string, override?: { subject: string; message: string }) {
  const emailjs = (await import("@emailjs/browser")).default;
  const e = ev[0];
  const link = `${origin}${import.meta.env.BASE_URL}alerte`;
  return emailjs.send(
    n.serviceId.trim(),
    n.templateId.trim(),
    {
      to_email: parseRecipients(n.recipients).join(","),
      subject: override?.subject ?? digestSubject(ev),
      level: LEVEL_RO[e.level],
      probability: pct(e.p),
      date: fmtDate(e.date),
      drivers: e.drivers.join("; "),
      action: `${e.action} (Responsabil: ${e.owner})`,
      dashboard_link: link,
      message: override?.message ?? eventBody(ev, link),
    },
    { publicKey: n.publicKey.trim() },
  );
}
