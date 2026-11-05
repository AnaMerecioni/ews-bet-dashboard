import { afterEach, describe, expect, it, vi } from "vitest";
import {
  categoryOf, DATASPRINT_COLUMNS, DATASPRINT_PREFIXES, EXT_CATEGORIES, extendTable, metadataCsv, monthAvailable, notebookSnippet,
  placeOnCalendar, SOURCES, type ExtSeries,
} from "./sources";

const cal = (from: string, n: number) => Array.from({ length: n }, (_, i) => new Date(Date.parse(from + "T00:00:00Z") + i * 864e5).toISOString().slice(0, 10));
const series = (name: string, points: [string, number][], fill: ExtSeries["fill"]): ExtSeries =>
  ({ meta: { name, category: categoryOf(name), source: "test", freq: "zilnic", available: "", desc: "" }, points, fill });

describe("decalajul de publicare", () => {
  it("o lună devine disponibilă la 1 a lunii m+L", () => {
    expect(monthAvailable("2024-01", 2)).toBe("2024-03-01");
    expect(monthAvailable("2024-11", 2)).toBe("2025-01-01");
  });
});

describe("placeOnCalendar", () => {
  const dates = cal("2024-01-01", 20);
  it("zilnic: acoperă weekendul, dar nu mai mult de 5 zile", () => {
    const v = placeOnCalendar(dates, series("STRESS_X", [["2024-01-06", 1]], "daily"));
    expect(v[dates.indexOf("2024-01-05")]).toBeNull(); // nimic înainte de publicare
    expect(v[dates.indexOf("2024-01-08")]).toBe(1);
    expect(v[dates.indexOf("2024-01-11")]).toBe(1);
    expect(v[dates.indexOf("2024-01-12")]).toBeNull();
  });
  it("lunar: valoarea rămâne până la următoarea publicare", () => {
    const v = placeOnCalendar(cal("2024-02-25", 40), series("MACRO_X", [["2024-03-01", 7], ["2024-04-01", 8]], "monthly"));
    expect(v[0]).toBeNull();
    expect(v[5]).toBe(7);
    expect(v[36]).toBe(8);
  });
});

describe("doar îmbogățire", () => {
  it("niciun prefix al extensiei nu intră într-o categorie DataSprint", () => {
    for (const [p] of EXT_CATEGORIES) for (const d of DATASPRINT_PREFIXES) {
      expect(p.startsWith(d)).toBe(false);
      expect(d.startsWith(p)).toBe(false);
    }
  });
  it("extendTable nu adaugă coloane care există deja în DataSprint sau în tabel", () => {
    const t = { columns: ["CRYPTO_BTC_close"], dates: cal("2024-01-01", 3), rows: [[1], [2], [3]] };
    const out = extendTable(t, [
      series("VIX_Close", [["2024-01-01", 9]], "daily"),
      series("CRYPTO_BTC_close", [["2024-01-01", 9]], "daily"),
      series("STRESS_CISS_EA", [["2024-01-02", 0.2]], "daily"),
    ]);
    expect(out.columns).toEqual(["CRYPTO_BTC_close", "STRESS_CISS_EA"]);
    expect(out.rows[0]).toEqual([1, null]);
    expect(out.rows[2]).toEqual([3, 0.2]);
    expect(DATASPRINT_COLUMNS).toContain("VIX_Close");
  });
  it("categorii și metadate", () => {
    expect(categoryOf("RATES_RO_DE_SPREAD")).toBe("Randamente suverane");
    expect(categoryOf("ceva")).toBe("Altele");
    const csv = metadataCsv([{ name: "A", category: "B", source: "S", freq: "lunar", available: "1 a lunii m+2", desc: "x, \"y\"" }]);
    expect(csv.split("\n")[1]).toBe('A,B,S,lunar,1 a lunii m+2,"x, ""y"""');
    expect(notebookSnippet("u/ds")).toContain("(('STRESS_',), 'Stres financiar sistemic'),");
  });
});

describe("sursa „stres sistemic” (ECB, simulat)", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("pune CISS a doua zi și CLIFS de la 1 a lunii m+2", async () => {
    const head = "KEY,FREQ,REF_AREA,CURRENCY,PROVIDER_FM,INSTRUMENT_FM,PROVIDER_FM_ID,DATA_TYPE_FM,TIME_PERIOD,OBS_VALUE\n";
    const ciss = head + Array.from({ length: 25 }, (_, i) => `CISS.D.U2.Z0Z.4F.EC.SS_CIN.IDX,D,U2,Z0Z,4F,EC,SS_CIN,IDX,${cal("2024-01-01", 25)[i]},${(i + 1) / 100}`).join("\n");
    const clifs = head + ["RO", "HU", "CZ"].map((c, k) => `CLIFS.M.${c}._Z.4F.EC.CLIFS_CI.IDX,M,${c},_Z,4F,EC,CLIFS_CI,IDX,2024-01,${0.1 * (k + 1)}`).join("\n");
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(url.includes("CISS/") ? ciss : clifs, { status: 200 })));
    const out = await SOURCES.find((s) => s.id === "stress")!.run({ start: "2024-01-01", end: "2024-03-31", progress: () => {} });
    const get = (n: string) => out.find((s) => s.meta.name === n)!;
    expect(get("STRESS_CISS_EA").points[0]).toEqual(["2024-01-02", 0.01]);
    expect(get("STRESS_CISS_EA_chg20").points[0][1]).toBeCloseTo(0.2);
    expect(get("STRESS_CLIFS_RO").points).toEqual([["2024-03-01", 0.1]]);
    expect(get("STRESS_CLIFS_CEE").points[0][1]).toBeCloseTo((0.2 + 0.3) / 2);
  });
});
