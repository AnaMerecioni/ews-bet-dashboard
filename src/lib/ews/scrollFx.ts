import { useEffect } from "react";

/**
 * Efecte la derulare (stilul „Povestea riscului”):
 *  - linia de progres din bara de sus și atributul data-scrolled pe <html> (bara devine mai opacă);
 *  - cardurile din <main> apar estompat → clar, ridicându-se, când intră în ecran (în cascadă).
 * Elementele primesc doar atribute data-*, pe care React nu le gestionează; dacă ceva eșuează,
 * conținutul rămâne vizibil. Cu „Reduce animațiile” sau prefers-reduced-motion nu se ascunde nimic.
 */
const REVEAL = ".card-surface, [data-reveal]";

const motionOff = () =>
  document.documentElement.classList.contains("reduce-motion") ||
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function useScrollFx() {
  // progres + stare „derulat”
  useEffect(() => {
    const root = document.documentElement;
    let raf = 0;
    let scrolled: boolean | null = null;
    const update = () => {
      raf = 0;
      const y = window.scrollY;
      const max = root.scrollHeight - window.innerHeight;
      const bar = document.querySelector<HTMLElement>(".scroll-progress");
      if (bar) bar.style.transform = `scaleX(${max > 0 ? Math.min(1, y / max) : 0})`;
      const s = y > 8;
      if (s !== scrolled) {
        scrolled = s;
        root.toggleAttribute("data-scrolled", s);
      }
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    // conținutul se schimbă (pagini, date încărcate) → recalculăm lungimea paginii
    const ro = new ResizeObserver(schedule);
    ro.observe(document.body);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      ro.disconnect();
      root.removeAttribute("data-scrolled");
    };
  }, []);

  // apariție la derulare
  useEffect(() => {
    const main = document.getElementById("main");
    if (!main || !("IntersectionObserver" in window)) return;

    const io = new IntersectionObserver(
      (entries) => {
        const shown = entries
          .filter((e) => e.isIntersecting)
          .map((e) => e.target as HTMLElement)
          .sort((a, b) => {
            const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
            return ra.top - rb.top || ra.left - rb.left;
          });
        // observatorul rulează după ce starea ascunsă a fost deja calculată, deci tranziția pornește corect
        shown.forEach((el, i) => {
          io.unobserve(el);
          const d = Math.min(i, 6) * 90;
          el.style.setProperty("--rv-delay", `${d}ms`);
          el.setAttribute("data-rv", "1");
          // rezervă: dacă tranziția nu pornește (element apărut în același cadru), curățăm oricum
          window.setTimeout(() => finish(el), d + 1400);
        });
      },
      { threshold: 0, rootMargin: "0px 0px -8% 0px" },
    );

    function finish(el: HTMLElement) {
      if (el.getAttribute("data-rv") !== "1") return;
      el.removeAttribute("data-rv");
      el.style.removeProperty("--rv-delay");
    }
    const done = (e: TransitionEvent) => {
      if (e.propertyName === "opacity") finish(e.target as HTMLElement);
    };

    const scan = () => {
      if (motionOff()) return;
      main.querySelectorAll<HTMLElement>(REVEAL).forEach((el) => {
        if (el.hasAttribute("data-rv-seen")) return;
        el.setAttribute("data-rv-seen", "");
        // cardurile din alte carduri, dialogurile fixe și cele animate deja la încărcare nu se ascund
        if (el.parentElement?.closest(REVEAL) || el.matches('[role="dialog"], .reveal')) return;
        el.setAttribute("data-rv", "0");
        io.observe(el);
      });
    };

    // rezervă: dacă observatorul nu răspunde (fereastră fără cadre randate, webview-uri), arătăm
    // cardurile aflate în ecran după ce derularea se oprește, ca nimic să nu rămână ascuns.
    const fallback = () => {
      main.querySelectorAll<HTMLElement>('[data-rv="0"]').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.top >= window.innerHeight || r.bottom <= 0) return;
        io.unobserve(el);
        el.setAttribute("data-rv", "1");
        window.setTimeout(() => finish(el), 1400);
      });
    };
    let fb = 0;
    const scheduleFallback = () => { clearTimeout(fb); fb = window.setTimeout(fallback, 600); };

    let timer = 0;
    const mo = new MutationObserver((records) => {
      // graficele (SVG) se modifică des la hover; le ignorăm
      if (records.every((r) => (r.target as Element).closest?.(".recharts-wrapper"))) return;
      if (!timer) timer = window.setTimeout(() => { timer = 0; scan(); scheduleFallback(); }, 30);
    });
    scan();
    scheduleFallback();
    mo.observe(main, { childList: true, subtree: true });
    main.addEventListener("transitionend", done);
    window.addEventListener("scroll", scheduleFallback, { passive: true });
    return () => {
      clearTimeout(timer);
      clearTimeout(fb);
      window.removeEventListener("scroll", scheduleFallback);
      io.disconnect();
      mo.disconnect();
      main.removeEventListener("transitionend", done);
      main.querySelectorAll<HTMLElement>("[data-rv]").forEach((el) => el.removeAttribute("data-rv"));
    };
  }, []);
}
