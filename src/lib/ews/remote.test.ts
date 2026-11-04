import { describe, expect, it } from "vitest";
import { bust, decodeConfig, encodeConfig, githubApiUrl, normalizeUrl } from "./remote";

describe("normalizeUrl", () => {
  it("converts GitHub blob links to raw", () => {
    expect(normalizeUrl("https://github.com/ana/ews/blob/main/data/predictions.csv"))
      .toBe("https://raw.githubusercontent.com/ana/ews/main/data/predictions.csv");
  });
  it("keeps raw GitHub links", () => {
    const u = "https://raw.githubusercontent.com/ana/ews/main/p.csv";
    expect(normalizeUrl(u)).toBe(u);
  });
  it("converts Google Sheets edit link with gid to CSV export", () => {
    expect(normalizeUrl("https://docs.google.com/spreadsheets/d/ABC123/edit#gid=42"))
      .toBe("https://docs.google.com/spreadsheets/d/ABC123/export?format=csv&gid=42");
  });
  it("rejects non-https", () => {
    expect(normalizeUrl("http://example.com/a.csv")).toBeNull();
    expect(normalizeUrl("not a url")).toBeNull();
  });
});

describe("githubApiUrl", () => {
  it("maps raw links to the uncached contents API", () => {
    expect(githubApiUrl("https://raw.githubusercontent.com/AnaMerecioni/ews-bet-date/main/predictions.csv"))
      .toBe("https://api.github.com/repos/AnaMerecioni/ews-bet-date/contents/predictions.csv?ref=main");
  });
  it("ignores non-GitHub links", () => {
    expect(githubApiUrl("https://docs.google.com/spreadsheets/d/x/export?format=csv")).toBeNull();
  });
});

describe("bust", () => {
  it("appends t with the right separator", () => {
    expect(bust("https://a/b.csv", 5)).toBe("https://a/b.csv?t=5");
    expect(bust("https://a/b?x=1", 5)).toBe("https://a/b?x=1&t=5");
  });
});

describe("config sharing", () => {
  it("round-trips through the ?src= parameter", () => {
    const enc = encodeConfig({ links: { predictions: "https://raw.githubusercontent.com/a/b/main/p.csv" }, refresh: 5 });
    expect(decodeConfig(`https://app.test/date?src=${enc}`)).toEqual({ links: { predictions: "https://raw.githubusercontent.com/a/b/main/p.csv" }, refresh: 5 });
  });
});
