import { describe, expect, it } from "vitest";
import Papa from "papaparse";
import { augmentCsv, buildFeatureTable, combineDataSprint, featureTableToCsv, featureTableToExt, parseDataSprint, parseExtensionCsv, qualityFlags, type RawExt } from "./extension";

const days = (n: number) => Array.from({ length: n }, (_, i) => new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10));
const D = days(46); // 2024-01-01 … 2024-02-15
const raw: RawExt = {
  closes: {
    BTC: new Map(D.map((d, i) => [d, 100 * 1.01 ** i])),
    ETH: new Map(D.slice(5).map((d, i) => [d, 50 * 0.99 ** i])), // ETH începe mai târziu
  },
  kev: [
    { dateAdded: "2024-01-10", knownRansomwareCampaignUse: "Known" },
    { dateAdded: "2024-01-10", knownRansomwareCampaignUse: "Unknown" },
    { dateAdded: "2024-01-20" },
  ],
};
const opts = { start: D[0], end: D.at(-1)!, lagCrypto: false, kevBlankBeforeCatalog: true };

describe("buildFeatureTable", () => {
  const t = buildFeatureTable(raw, opts);
  const col = (c: string) => t.rows.map((r) => r[t.columns.indexOf(c)]);

  it("folosește numele de coloane ale scraper-ului", () => {
    expect(t.columns.slice(0, 5)).toEqual(["CRYPTO_BTC_close", "CRYPTO_BTC_ret_1d", "CRYPTO_BTC_ret_7d", "CRYPTO_BTC_ret_30d", "CRYPTO_BTC_vol_30d"]);
    expect(t.columns).toContain("CRYPTO_market_vol_30d");
    expect(t.columns.at(-1)).toBe("CYBER_KEV_ransomware_count");
    expect(t.dates).toHaveLength(46);
  });
  it("calculează randamentele și volatilitatea (minim 20 de randamente)", () => {
    expect(col("CRYPTO_BTC_ret_1d")[1]).toBeCloseTo(0.01);
    expect(col("CRYPTO_BTC_ret_7d")[7]).toBeCloseTo(1.01 ** 7 - 1);
    expect(col("CRYPTO_BTC_vol_30d")[19]).toBeNull();
    expect(col("CRYPTO_BTC_vol_30d")[20]).toBeCloseTo(0);
    expect(col("CRYPTO_ETH_close")[0]).toBeNull();
  });
  it("lățimea pieței folosește doar monedele disponibile", () => {
    expect(col("CRYPTO_breadth_down_1d")[3]).toBe(0); // doar BTC, în creștere
    expect(col("CRYPTO_breadth_down_1d")[10]).toBe(0.5); // BTC crește, ETH scade
  });
  it("KEV: decalat cu o zi și gol înainte de catalog", () => {
    expect(col("CYBER_KEV_added_count")[D.indexOf("2024-01-10")]).toBeNull();
    expect(col("CYBER_KEV_added_count")[D.indexOf("2024-01-11")]).toBe(2);
    expect(col("CYBER_KEV_ransomware_count")[D.indexOf("2024-01-11")]).toBe(1);
    expect(col("CYBER_KEV_added_count")[D.indexOf("2024-01-12")]).toBe(0);
  });
  it("decalajul crypto mută valorile cu o zi", () => {
    const lag = buildFeatureTable(raw, { ...opts, lagCrypto: true });
    const i = lag.columns.indexOf("CRYPTO_BTC_close");
    expect(lag.rows[0][i]).toBeNull();
    expect(lag.rows[5][i]).toBe(t.rows[4][i]);
  });
  it("produce CSV-ul și rândurile pentru dashboard", () => {
    const csv = featureTableToCsv(t).trim().split("\n");
    expect(csv[0].startsWith("Date,CRYPTO_BTC_close,")).toBe(true);
    expect(csv).toHaveLength(47);
    const ext = featureTableToExt(t);
    expect(ext[25].cryptoVol30).toBeDefined();
    expect(ext[D.indexOf("2024-01-11")].kev).toBe(2);
  });
});

describe("augmentCsv", () => {
  it("lipește feature-urile după Date fără să atingă ținta sau coloanele existente", () => {
    const t = buildFeatureTable(raw, opts);
    const train = "Date,stress_event_20d,CRYPTO_BTC_close\n1/2/2024,0,5\n2024-01-03,1,6\n2023-12-31,0,7\n";
    const r = augmentCsv(train, t);
    expect(r.total).toBe(3);
    expect(r.matched).toBe(2);
    expect(r.skipped).toBe(1);
    const rows = Papa.parse<string[]>(r.csv, { skipEmptyLines: true }).data;
    expect(rows[0].slice(0, 3)).toEqual(["Date", "stress_event_20d", "CRYPTO_BTC_close"]);
    expect(rows[1].slice(0, 3)).toEqual(["1/2/2024", "0", "5"]);
    expect(rows[2][1]).toBe("1");
    expect(rows[1]).toHaveLength(3 + r.added);
  });
});

describe("fișierul unic DataSprint + extensie", () => {
  const t = buildFeatureTable(raw, opts);
  const cols = (n: number) => Array.from({ length: n }, (_, i) => `C${i}`);
  const train = parseDataSprint(
    `Date,stress_event_20d,BET_Close_RON,${cols(9).join(",")}\n2024-01-02,1,101,${cols(9).map(() => 2).join(",")}\n2024-01-01,0,100,${cols(9).map(() => 1).join(",")}\n`, "train.csv");
  const test = parseDataSprint(`Date,${cols(9).join(",")}\n2024-01-03,${cols(9).map(() => 3).join(",")}\n`, "test.csv");

  it("recunoaște train și test", () => {
    expect([train.kind, test.kind]).toEqual(["train", "test"]);
    expect([train.from, train.to]).toEqual(["2024-01-01", "2024-01-02"]);
  });
  it("pune train + test într-un singur fișier, cu ținta neschimbată și variabilele noi pe fiecare zi", () => {
    const c = combineDataSprint([test, train], t);
    const rows = Papa.parse<string[]>(c.csv, { skipEmptyLines: true }).data;
    expect(rows[0].slice(0, 5)).toEqual(["Date", "split", "stress_event_20d", "BET_Close_RON", "C0"]);
    expect(rows[0]).toContain("CRYPTO_BTC_close");
    expect(rows.slice(1).map((r) => [r[0], r[1], r[2]])).toEqual([["2024-01-01", "train", "0"], ["2024-01-02", "train", "1"], ["2024-01-03", "test", ""]]);
    expect([c.rows, c.train, c.test, c.targets, c.matched, c.dsColumns]).toEqual([3, 2, 1, 2, 3, 11]);
    expect(rows[1][rows[0].indexOf("CRYPTO_BTC_close")]).toBe("100");
  });
  it("respinge fișiere care nu sunt DataSprint", () => {
    expect(() => parseDataSprint("Date,a\n2024-01-01,1\n", "x.csv")).toThrow();
  });
});

describe("parseExtensionCsv", () => {
  it("citește ews_external_features.csv", () => {
    const r = parseExtensionCsv("Date,CRYPTO_BTC_close,CRYPTO_market_vol_30d,CYBER_KEV_added_count,Gold_close\n2024-01-01,42000,0.03,2,2000\n");
    expect(r.rows[0]).toMatchObject({ date: "2024-01-01", btc: 42000, cryptoVol30: 0.03, kev: 2 });
  });
  it("numără cisa_kev.csv pe zi, cu decalaj", () => {
    const r = parseExtensionCsv("cve_id,Date,knownRansomwareCampaignUse\nCVE-1,2024-01-10,Known\nCVE-2,2024-01-10,Unknown\n");
    expect(r.rows).toEqual([{ date: "2024-01-11", kev: 2, kevRansom: 1 }]);
  });
  it("respinge fișiere fără coloanele extensiei", () => {
    expect(parseExtensionCsv("Date,foo\n2024-01-01,1\n").error).toBeTruthy();
  });
});

describe("qualityFlags", () => {
  it("semnalează știrile din afara perioadei predicțiilor", () => {
    const f = qualityFlags([{ date: "2026-11-01", newsCyber: 3 }, { date: "2026-11-02", newsCyber: 1 }], "2024-01-01", "2026-09-18");
    expect(f.some((x) => x.level === "warn" && x.text.includes("în afara perioadei"))).toBe(true);
  });
});
