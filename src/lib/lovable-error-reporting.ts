// Fost hook de raportare către editorul Lovable. Proiectul rulează acum independent,
// așa că doar logăm eroarea în consolă (păstrăm semnătura ca restul codului să nu se schimbe).
export function reportLovableError(error: unknown, context: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;
  console.warn("[Gama] eroare capturată de error boundary", { route: window.location.pathname, ...context }, error);
}
