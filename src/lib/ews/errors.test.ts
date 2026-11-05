import { describe, expect, it } from "vitest";
import { errorStats, localError, thresholdCurve, wilson } from "./compute";
import type { Day } from "./types";

const d = (i: number, p: number, y: 0 | 1 | null): Day => ({ date: `2024-01-${String(i + 1).padStart(2, "0")}`, p, level: "low", y });
// prag 0,5 → TP: 0,9 și 0,8 · FP: 0,7 · FN: 0,2 · TN: 5 zile · o zi fără rezultat (exclusă)
const series: Day[] = [d(0, 0.9, 1), d(1, 0.8, 1), d(2, 0.7, 0), d(3, 0.2, 1), d(4, 0.1, 0), d(5, 0.1, 0), d(6, 0.15, 0), d(7, 0.05, 0), d(8, 0.12, 0), d(9, 0.6, null)];

describe("wilson", () => {
  it("nu inventează o rată fără date", () => expect(wilson(0, 0).p).toBeNull());
  it("dă intervalul Wilson 95%", () => {
    const r = wilson(5, 10);
    expect(r.p).toBe(0.5);
    expect(r.lo).toBeCloseTo(0.2366, 3);
    expect(r.hi).toBeCloseTo(0.7634, 3);
  });
});

describe("errorStats", () => {
  const s = errorStats(series, 0.5);
  it("numără doar zilele cu rezultat cunoscut", () => expect(s.n).toBe(9));
  it("calculează erorile de tip I și II și probabilitățile de semnal greșit", () => {
    expect(s.error.p).toBeCloseTo(2 / 9);
    expect(s.typeI.p).toBeCloseTo(1 / 6); // FP / (FP + TN)
    expect(s.typeII.p).toBeCloseTo(1 / 3); // FN / (FN + TP)
    expect(s.falseAlarm.p).toBeCloseTo(1 / 3); // FP / (TP + FP)
    expect(s.falseCalm.p).toBeCloseTo(1 / 6); // FN / (FN + TN)
  });
});

describe("thresholdCurve", () => {
  const c = thresholdCurve(series, 10);
  it("la prag 0 totul e semnal: α = 100%, β = 0", () => {
    expect(c[0].typeI).toBe(1);
    expect(c[0].typeII).toBe(0);
  });
  it("la pragul maxim nu mai există alarme false", () => {
    expect(c.at(-1)!.typeI).toBe(0);
    expect(c.at(-1)!.typeII).toBeCloseTo(2 / 3);
  });
});

describe("localError", () => {
  it("folosește cele mai apropiate zile istorice după probabilitate", () => {
    const r = localError(series, 0.75, 0.5, 3)!;
    expect(r.signal).toBe(true);
    expect(r.rate.n).toBe(3);
    expect(r.rate.p).toBeCloseTo(1 / 3); // dintre 0,7 / 0,8 / 0,9 doar 0,7 a fost alarmă falsă
  });
});
