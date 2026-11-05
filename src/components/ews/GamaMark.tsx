import { useId } from "react";

/**
 * Simbolul Gama: litera grecească γ (în finanțe, „gama” măsoară cât de repede se schimbă riscul),
 * închisă la culoare pe un pătrat rotunjit verde fosforescent. Aceeași formă e în public/favicon.svg.
 */
export function GamaMark({ className }: { className?: string }) {
  const id = `gama-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden focusable="false">
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#d4ff3a" />
          <stop offset="0.5" stopColor="#39ff14" />
          <stop offset="1" stopColor="#00e676" />
        </linearGradient>
        <radialGradient id={`${id}-shine`} cx="0.3" cy="0.2" r="0.8">
          <stop offset="0" stopColor="#fff" stopOpacity="0.45" />
          <stop offset="0.6" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="40" height="40" rx="12" fill={`url(#${id}-bg)`} />
      <rect width="40" height="40" rx="12" fill={`url(#${id}-shine)`} />
      <g fill="none" stroke="#04140a" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9.5 13.2c4.2-1.4 7.1 1.8 10.5 10.8" />
        <path d="M30.5 11.5 20 24" />
        <path d="M20 24c-2.6 3.6-3 6.6-.9 7.6 2 .9 3.6-1.6.9-7.6" />
      </g>
    </svg>
  );
}
