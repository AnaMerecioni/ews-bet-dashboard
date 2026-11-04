import { describe, expect, it } from "vitest";
import { detectEvents, type Snapshot } from "./notify";
import { DEFAULT_PLAYBOOK } from "./store";

const snap = (p: number, level: Snapshot["level"], date = "2026-09-18"): Snapshot => ({
  date, p, level, alert: 0.145, high: 0.305, alertActive: level !== "low", alertStart: level !== "low" ? "2026-09-03" : null, topCategory: "Geopolitică",
});

describe("detectEvents", () => {
  it("o rulare nouă pe aceeași zi (Moderat → Ridicat) produce un eveniment nou", () => {
    const ev = detectEvents(snap(0.21, "moderate"), snap(0.55, "high"), 0.5, 5, "", [], "pp", DEFAULT_PLAYBOOK);
    const lvl = ev.find((e) => e.type === "level");
    expect(lvl?.title).toBe("Risc în creștere: Moderat → Ridicat");
    expect(lvl?.severity).toBe("critic");
  });

  it("ID-ul include tranziția, ca evenimente diferite din aceeași zi să nu fie deduplicate", () => {
    const down = detectEvents(snap(0.55, "high"), snap(0.21, "moderate"), null, 5, "", [], "pp", DEFAULT_PLAYBOOK).find((e) => e.type === "level");
    const up = detectEvents(snap(0.21, "moderate"), snap(0.55, "high"), null, 5, "", [], "pp", DEFAULT_PLAYBOOK).find((e) => e.type === "level");
    expect(down?.id).not.toBe(up?.id);
  });

  it("aceleași date nu produc evenimente", () => {
    expect(detectEvents(snap(0.21, "moderate"), snap(0.21, "moderate"), 0.2, 5, "", [], "pp", DEFAULT_PLAYBOOK)).toEqual([]);
  });
});
