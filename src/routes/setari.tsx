import { createFileRoute } from "@tanstack/react-router";
import { useEws, type Settings } from "@/lib/ews/store";
import { levelRates } from "@/lib/ews/compute";
import { num, pct } from "@/lib/ews/format";
import { Card, InfoTip, LEVELS, PageHeader } from "@/components/ews/ui";
import { NotificationSettings } from "@/components/ews/NotificationSettings";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/setari")({
  head: () => ({
    meta: [
      { title: "Setări · Sistem de avertizare timpurie" },
      { name: "description", content: "Praguri de risc, regula de alertă, unitatea SHAP și opțiuni de accesibilitate." },
      { property: "og:title", content: "Setări · Sistem de avertizare timpurie" },
      { property: "og:description", content: "Configurează pragurile și afișarea sistemului de avertizare timpurie." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SettingsPage,
});

function Seg<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: { v: T; l: string }[]; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap rounded-lg border p-0.5">
      {options.map((o) => (
        <button key={String(o.v)} role="radio" aria-checked={value === o.v} onClick={() => onChange(o.v)}
          className={cn("min-h-11 rounded-md px-3 text-sm font-medium", value === o.v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}>
          {o.l}
        </button>
      ))}
    </div>
  );
}

function Row({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b py-4 last:border-0">
      <div className="max-w-lg"><p className="font-medium">{title}</p>{desc && <p className="text-sm text-muted-foreground">{desc}</p>}</div>
      {children}
    </div>
  );
}

function SettingsPage() {
  const ews = useEws();
  const { settings: s, updateSettings: u, thr } = ews;
  const rates = ews.hasOutcomes ? levelRates(ews.fullSeries, thr.alert, thr.high) : null;
  const toggle = (k: keyof Settings, title: string, desc: string) => (
    <Row title={title} desc={desc}>
      <Switch checked={s[k] as boolean} onCheckedChange={(v) => u({ [k]: v } as Partial<Settings>)} aria-label={title} className="scale-125" />
    </Row>
  );
  return (
    <div className="space-y-6">
      <PageHeader title="Setări" desc="Se salvează automat în acest browser." />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card aria-labelledby="thr-h">
          <h2 id="thr-h" className="text-base font-semibold">Praguri și alerte</h2>
          <Row title="Prag de alertă" desc="Vine din predictions.csv (stress_threshold).">
            <span className="text-lg font-bold tabular-nums">{pct(thr.alert)}</span>
          </Row>
          <Row title="Prag ridicat" desc={thr.highFromFile ? "Vine din coloana high_threshold a fișierului." : `Implicit: pragul de alertă × 1,5 = ${pct(Math.min(0.99, thr.alert * 1.5))}.`}>
            <div className="flex items-center gap-2">
              <input
                type="number" min={Math.round(thr.alert * 100)} max={99} step={1} disabled={thr.highFromFile}
                value={Math.round(thr.high * 1000) / 10}
                onChange={(e) => u({ highThreshold: Math.max(thr.alert, Number(e.target.value) / 100) })}
                aria-label="Prag ridicat în procente" className="min-h-11 w-24 rounded-md border bg-card px-2 text-right tabular-nums"
              />
              <span>%</span>
              {s.highThreshold !== null && !thr.highFromFile && (
                <button onClick={() => u({ highThreshold: null })} className="min-h-11 px-2 text-sm text-brand-accent hover:underline dark:text-primary">Implicit</button>
              )}
            </div>
          </Row>
          <Row title="Zile de confirmare" desc="Câte zile consecutive peste prag declanșează o alertă.">
            <Seg label="Zile de confirmare" value={s.confirmDays} onChange={(v) => u({ confirmDays: v })} options={[1, 2, 3].map((v) => ({ v, l: String(v) }))} />
          </Row>
          <Row title="Unitatea contribuțiilor SHAP" desc="Cum sunt exprimate valorile din drivers.csv.">
            <Seg label="Unitate SHAP" value={s.shapUnit} onChange={(v) => u({ shapUnit: v })} options={[{ v: "pp", l: "Procente" }, { v: "logit", l: "Log-odds" }]} />
          </Row>

          <div className="mt-4 rounded-lg bg-muted p-4 text-sm">
            <p className="flex items-center gap-1 font-semibold">De ce aceste praguri?
              <InfoTip term="Prag">Valoarea probabilității de la care se schimbă nivelul de risc.</InfoTip></p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li><strong>Pragul de alertă</strong> maximizează scorul F2: o alarmă ratată costă mai mult decât una falsă.</li>
              <li><strong>Pragul ridicat</strong> este nivelul de la care, istoric, stresul a apărut de cel puțin 2× mai des decât rata de bază.</li>
            </ul>
            {rates && (
              <table className="mt-3 w-full text-left">
                <caption className="sr-only">Rata de stres observată pe niveluri</caption>
                <thead><tr><th scope="col" className="py-1">Nivel</th><th scope="col">Zile</th><th scope="col">Stres observat</th><th scope="col">× rata de bază</th></tr></thead>
                <tbody>
                  {(["low", "moderate", "high"] as const).map((l) => (
                    <tr key={l} className="border-t">
                      <td className="py-1 font-medium">{LEVELS[l].label}</td>
                      <td className="tabular-nums">{num(rates[l].n)}</td>
                      <td className="tabular-nums">{pct(rates[l].rate)}</td>
                      <td className="tabular-nums">{rates.base.rate ? num(rates[l].rate / rates.base.rate, 1) + "×" : "—"}</td>
                    </tr>
                  ))}
                  <tr className="border-t text-muted-foreground"><td className="py-1">Rata de bază</td><td>{num(rates.base.n)}</td><td>{pct(rates.base.rate)}</td><td>1,0×</td></tr>
                </tbody>
              </table>
            )}
          </div>
        </Card>

        <Card aria-labelledby="disp-h">
          <h2 id="disp-h" className="text-base font-semibold">Afișare și accesibilitate</h2>
          <Row title="Temă">
            <Seg label="Temă" value={s.theme} onChange={(v) => u({ theme: v })} options={[{ v: "light", l: "Luminos" }, { v: "dark", l: "Întunecat" }, { v: "system", l: "Sistem" }]} />
          </Row>
          <Row title="Mărimea textului">
            <Seg label="Mărimea textului" value={s.textSize} onChange={(v) => u({ textSize: v })} options={([100, 115, 130] as const).map((v) => ({ v, l: `${v}%` }))} />
          </Row>
          {toggle("highContrast", "Contrast ridicat", "Text și margini mai închise.")}
          {toggle("reduceTransparency", "Reduce transparența", "Înlocuiește efectul de sticlă cu suprafețe opace. Se activează automat la contrast ridicat sau dacă sistemul cere transparență redusă.")}
          {toggle("reduceMotion", "Reduce animațiile", "Oprește tranzițiile și derulările animate.")}
          {toggle("cbPalette", "Paletă pentru daltonism", "Culori Okabe-Ito, ușor de distins pentru orice tip de vedere.")}
          <Row title="Turul de prezentare" desc="Arată din nou cei 3 pași pe pagina principală.">
            <button onClick={() => u({ tourDone: false })} className="min-h-11 rounded-md border px-4 text-sm hover:bg-muted">Repornește turul</button>
          </Row>
          <Row title="Limbă" desc="Interfața este în română; textele sunt pregătite pentru traducere.">
            <span className="text-sm font-medium">Română</span>
          </Row>
        </Card>
        <NotificationSettings />
      </div>
    </div>
  );
}
