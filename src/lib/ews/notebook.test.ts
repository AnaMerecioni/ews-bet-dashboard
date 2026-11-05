import { describe, expect, it } from "vitest";
import { analyzeNotebook } from "./notebook";

const nb = {
  metadata: { language_info: { name: "python" } },
  cells: [
    { cell_type: "markdown", source: ["# Model EWS\n", "Text\n", "## 1. Date"] },
    {
      cell_type: "code", execution_count: 1,
      source: "N_TRIALS = 20\nREGULI_CATEGORIE = [\n    (('BET_',), 'Piața de capital'),\n]\ntrain = pd.read_csv('/kaggle/input/x/train_augmented.csv')\n",
      outputs: [{ output_type: "stream", text: ["Scor final: 0.474\n", "gata\n"] }],
    },
    { cell_type: "code", execution_count: 2, source: ["predictions_export.to_csv('predictions.csv')"], outputs: [{ output_type: "error", ename: "KeyError", evalue: "Timestamp('2024-01-06')" }] },
    { cell_type: "code", execution_count: null, source: "x = 1", outputs: [] },
  ],
};

describe("analyzeNotebook", () => {
  const s = analyzeNotebook(JSON.stringify(nb), "model.ipynb");
  it("rezumă structura", () => {
    expect(s.title).toBe("Model EWS");
    expect(s.outline).toEqual(["Model EWS", "1. Date"]);
    expect(s.cells).toEqual({ code: 3, markdown: 1 });
    expect(s.executed).toBe(2);
    expect(s.language).toBe("python");
  });
  it("găsește parametrii, metricile, fișierele și erorile", () => {
    expect(s.params).toContainEqual({ name: "N_TRIALS", value: "20" });
    expect(s.metrics).toContain("Scor final: 0.474");
    expect(s.inputs).toContain("train_augmented.csv");
    expect(s.errors).toEqual([{ cell: 3, ename: "KeyError", evalue: "Timestamp('2024-01-06')" }]);
  });
  it("verifică legătura cu dashboard-ul și cu extensia", () => {
    expect(s.exports.predictions).toBe(true);
    expect(s.exports.drivers).toBe(false);
    expect(s.extension.uses).toBe(true);
    expect(s.extension.category).toBe(false);
  });
  it("respinge fișiere care nu sunt notebook-uri", () => {
    expect(() => analyzeNotebook("nu e json", "x.ipynb")).toThrow();
  });
});

describe("analyzeNotebook — notebook-ul din Kaggle", () => {
  const k = analyzeNotebook(JSON.stringify({
    cells: [
      { cell_type: "markdown", source: '# <span style="color:#00338D">DataSprint 2026 — Starter Notebook</span>' },
      { cell_type: "code", execution_count: 1, source: "sub.to_csv('submission.csv', index=False)", outputs: [] },
    ],
  }), "varianta-ana.ipynb");
  it("scoate HTML-ul din titlu", () => expect(k.title).toBe("DataSprint 2026 — Starter Notebook"));
  it("submission.csv contează drept predicții", () => expect(k.exports.predictions).toBe(true));
});
