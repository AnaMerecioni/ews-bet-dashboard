import { describe, expect, it } from "vitest";
import { buildBundle, roleOf } from "./bundle";
import type { PredRow } from "./types";

const submission = "Date,stress_probability_20d,stress_threshold\n1/1/2024,0.05,0.125\n1/2/2024,0.20,0.125\n1/3/2024,0.30,0.125\n";
const risk = "Date,stress_probability_20d,alert,risk_level\n2024-01-01,0.05,0,Scăzut\n2024-01-02,0.20,1,Moderat\n2024-01-03,0.30,1,Ridicat\n";
const notebook = JSON.stringify({ cells: [{ cell_type: "markdown", source: ["# Titlu\n"] }, { cell_type: "code", source: "submission.to_csv('submission.csv')", outputs: [], execution_count: null }], metadata: {} });

describe("încărcarea notebook + output", () => {
  it("recunoaște fiecare fișier după coloane", () => {
    expect(roleOf("submission.csv", submission)).toBe("submission");
    expect(roleOf("predictions.csv", submission)).toBe("predictions");
    expect(roleOf("risk_monitoring.csv", risk)).toBe("risk_monitoring");
    expect(roleOf("x.ipynb", notebook)).toBe("notebook");
    expect(roleOf("drivers.csv", "Date,feature,category,contribution\n")).toBe("drivers");
    expect(roleOf("outcomes.csv", "Date,stress_event_20d,BET\n")).toBe("outcomes");
    expect(roleOf("sensitivity.csv", "feature,shift_sigma,probability\n")).toBe("sensitivity");
    expect(roleOf("train.csv", "Date,a,b,c,d,e,f,stress_event_20d\n")).toBe("ignored");
  });

  it("ia predicțiile din submisie și pragul de risc ridicat din risk_monitoring", () => {
    const b = buildBundle([{ name: "submission.csv", text: submission }, { name: "risk_monitoring.csv", text: risk }, { name: "VARIANTA.ipynb", text: notebook }]);
    const p = b.data.predictions as PredRow[];
    expect(p).toHaveLength(3);
    expect(p[0]).toMatchObject({ date: "2024-01-01", thr: 0.125, high: 0.3 });
    expect(b.notebook?.title).toBe("Titlu");
    expect(b.report.every((r) => r.ok)).toBe(true);
  });

  it("fără submisie, deduce predicțiile și pragul din risk_monitoring", () => {
    const b = buildBundle([{ name: "risk_monitoring.csv", text: risk }]);
    const p = b.data.predictions as PredRow[];
    expect(p.map((r) => r.thr)).toEqual([0.2, 0.2, 0.2]);
    expect(p[2].high).toBe(0.3);
  });

  it("predictions.csv (cu istoric) are prioritate față de submission.csv", () => {
    const hist = "Date,stress_probability_20d,stress_threshold\n2023-12-29,0.1,0.125\n2024-01-01,0.05,0.125\n";
    const b = buildBundle([{ name: "submission.csv", text: submission }, { name: "predictions.csv", text: hist }]);
    expect(b.names.predictions).toBe("predictions.csv");
    expect((b.data.predictions as PredRow[])[0].date).toBe("2023-12-29");
  });
});
