#!/usr/bin/env python3
"""Collect market, crypto, cyber-event and public macro data for the EWS notebook.

Original DataSprint train/test files are input-only and are never overwritten.
All external features are written separately and can be joined onto those files.
"""
from __future__ import annotations

import argparse
import json
import os
import time
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

import pandas as pd
import requests

UA = "DataSprint-EWS-research-scraper/1.0 (public data; respectful rate limits)"
SESSION = requests.Session()
SESSION.headers.update({"User-Agent": UA})
TODAY = date.today()


def get_json(url: str, params: dict[str, Any] | None = None, timeout: int = 45) -> Any:
    response = SESSION.get(url, params=params, timeout=timeout)
    response.raise_for_status()
    return response.json()


def get_text(url: str, params: dict[str, Any] | None = None, timeout: int = 45) -> str:
    response = SESSION.get(url, params=params, timeout=timeout)
    response.raise_for_status()
    return response.text


def yahoo_history(symbol: str, start: date, end: date) -> pd.DataFrame:
    """Yahoo chart endpoint; returns OHLCV, with end exclusive."""
    period1 = int(datetime.combine(start, datetime.min.time(), timezone.utc).timestamp())
    period2 = int(datetime.combine(end + timedelta(days=1), datetime.min.time(), timezone.utc).timestamp())
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
    data = get_json(url, {"period1": period1, "period2": period2, "interval": "1d", "events": "history"})
    result = data["chart"]["result"][0]
    quote = result["indicators"]["quote"][0]
    out = pd.DataFrame(quote, index=pd.to_datetime(result["timestamp"], unit="s", utc=True).date)
    out.index.name = "Date"
    out = out.rename(columns={"open": "open", "high": "high", "low": "low", "close": "close", "volume": "volume"})
    return out.reset_index()


def fetch_markets(start: date, end: date) -> pd.DataFrame:
    pieces: list[pd.DataFrame] = []
    # BET index (Yahoo symbol); each source is isolated so one failed ticker does not abort collection.
    for symbol, prefix in [("%5EBETI", "BET"), ("%5EBET", "BET_alt"), ("GC%3DF", "Gold"), ("SI%3DF", "Silver")]:
        try:
            frame = yahoo_history(symbol, start, end)
            frame = frame.rename(columns={c: f"{prefix}_{c}" for c in frame.columns if c != "Date"})
            pieces.append(frame)
        except Exception as exc:
            print(f"[WARN] Yahoo {symbol}: {exc}")
    # Yahoo quote fields include global indices and broad risk gauges.
    for symbol, prefix in [("%5EGSPC", "SP500"), ("%5ESTOXX50E", "EUROSTOXX"), ("%5ESTOXX", "STOXX600"), ("%5EVIX", "VIX"), ("%5EV2TX", "VSTOXX"), ("EURRON%3DX", "FX_RON_EUR")]:
        try:
            frame = yahoo_history(symbol, start, end)
            frame = frame[["Date", "close", "volume"]].rename(columns={"close": f"{prefix}_Close", "volume": f"{prefix}_Volume"})
            pieces.append(frame)
        except Exception as exc:
            print(f"[WARN] Yahoo {symbol}: {exc}")
    # FRED graph CSV downloads are usable without an API key. They are supplementary macro series;
    # the full original DataSprint panel is still required for the notebook's full feature set.
    fred_ids = {
        "VIXCLS": "VIX_FRED", "SP500": "SP500_FRED", "DCOILBRENTEU": "DCOILBRENTEU",
        "DEXUSEU": "FX_USD_EUR", "DTWEXBGS": "USD_Broad_Index",
        "DGS3MO": "US_3M_Rate", "DGS10": "US_10Y_Rate", "BAMLH0A0HYM2": "US_HY_Spread",
    }
    for series, col in fred_ids.items():
        try:
            csv = get_text("https://fred.stlouisfed.org/graph/fredgraph.csv", {"id": series, "cosd": start.isoformat(), "coed": end.isoformat()})
            frame = pd.read_csv(pd.io.common.StringIO(csv))
            frame.columns = ["Date", col]
            frame[col] = pd.to_numeric(frame[col].replace(".", pd.NA), errors="coerce")
            frame["Date"] = pd.to_datetime(frame["Date"]).dt.date
            pieces.append(frame)
        except Exception as exc:
            print(f"[WARN] FRED {series}: {exc}")
    if not pieces:
        return pd.DataFrame(columns=["Date"])
    merged = pieces[0]
    for frame in pieces[1:]:
        merged = merged.merge(frame, on="Date", how="outer")
    return merged.sort_values("Date").drop_duplicates("Date", keep="last")


def binance_klines(symbol: str, start: date, end: date) -> pd.DataFrame:
    """Public Binance spot candles, paged at 1000 rows; no account credentials needed."""
    url = "https://data-api.binance.vision/api/v3/klines"
    start_ms = int(datetime.combine(start, datetime.min.time(), timezone.utc).timestamp() * 1000)
    end_ms = int(datetime.combine(end + timedelta(days=1), datetime.min.time(), timezone.utc).timestamp() * 1000)
    rows: list[list[Any]] = []
    while start_ms < end_ms:
        batch = get_json(url, {"symbol": symbol, "interval": "1d", "startTime": start_ms, "endTime": end_ms, "limit": 1000})
        if not batch:
            break
        rows.extend(batch)
        start_ms = int(batch[-1][0]) + 86_400_000
        if len(batch) < 1000:
            break
        time.sleep(0.15)
    cols = ["open_time", "open", "high", "low", "close", "volume", "close_time", "quote_volume", "trades", "taker_buy_base", "taker_buy_quote", "ignore"]
    frame = pd.DataFrame(rows, columns=cols)
    if frame.empty:
        return pd.DataFrame(columns=["Date", "asset", "close", "volume", "quote_volume", "trades"])
    frame["Date"] = pd.to_datetime(frame.open_time, unit="ms", utc=True).dt.date
    frame["asset"] = symbol.removesuffix("USDT")
    for col in ["open", "high", "low", "close", "volume", "quote_volume", "trades"]:
        frame[col] = pd.to_numeric(frame[col], errors="coerce")
    return frame[["Date", "asset", "open", "high", "low", "close", "volume", "quote_volume", "trades"]]


def fetch_crypto(start: date, end: date) -> pd.DataFrame:
    frames = []
    for symbol in ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT", "ADAUSDT", "DOGEUSDT", "LTCUSDT"]:
        try:
            frames.append(binance_klines(symbol, start, end))
        except Exception as exc:
            print(f"[WARN] Binance {symbol}: {exc}")
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()


def crypto_features(raw: pd.DataFrame) -> pd.DataFrame:
    if raw.empty:
        return pd.DataFrame(columns=["Date"])
    wide = raw.pivot(index="Date", columns="asset", values="close").sort_index()
    out = pd.DataFrame(index=wide.index)
    for asset in wide.columns:
        safe = asset.upper()
        out[f"CRYPTO_{safe}_close"] = wide[asset]
        for n in [1, 7, 30]:
            out[f"CRYPTO_{safe}_ret_{n}d"] = wide[asset].pct_change(n, fill_method=None)
        out[f"CRYPTO_{safe}_vol_30d"] = wide[asset].pct_change(fill_method=None).rolling(30, min_periods=20).std()
    ret = wide.pct_change(fill_method=None)
    out["CRYPTO_market_mean_ret_1d"] = ret.mean(axis=1)
    out["CRYPTO_market_vol_30d"] = out[[c for c in out if c.endswith("_ret_1d")]].mean(axis=1).rolling(30, min_periods=20).std()
    out["CRYPTO_breadth_down_1d"] = (ret < 0).mean(axis=1)
    out.index.name = "Date"
    return out.reset_index()


def fetch_kev() -> pd.DataFrame:
    url = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json"
    data = get_json(url)
    rows = data.get("vulnerabilities", [])
    frame = pd.DataFrame(rows)
    if frame.empty:
        return frame
    return frame.rename(columns={"cveID": "cve_id", "dateAdded": "Date", "vendorProject": "vendor", "vulnerabilityName": "title"})


CYBER_QUERY = '(cyberattack OR ransomware OR "data breach" OR "security breach" OR "bank hack" OR "exchange hack" OR "crypto hack" OR "cryptocurrency theft" OR "bitcoin hack")'
CRYPTO_QUERY = '("crypto exchange" OR cryptocurrency OR bitcoin OR ethereum) (hack OR exploit OR breach OR outage OR regulation OR lawsuit OR collapse OR ETF OR adoption)'


def fetch_gdelt_articles(start: date, end: date, query: str, label: str) -> pd.DataFrame:
    """GDELT DOC full-text search is recent-news coverage (roughly a rolling 3 months)."""
    url = "https://api.gdeltproject.org/api/v2/doc/doc"
    rows: list[dict[str, Any]] = []
    # Keep each query interval under 30 days to avoid API result caps and timeouts.
    cursor = start
    while cursor <= end:
        stop = min(cursor + timedelta(days=29), end)
        params = {"query": query, "mode": "ArtList", "format": "json", "maxrecords": 250,
                  "startdatetime": cursor.strftime("%Y%m%d000000"), "enddatetime": stop.strftime("%Y%m%d235959"), "sort": "HybridRel"}
        try:
            data = get_json(url, params, timeout=18)
            for article in data.get("articles", []):
                rows.append({"published_at": article.get("seendate"), "title": article.get("title"),
                             "domain": article.get("domain"), "language": article.get("language"),
                             "source_country": article.get("sourcecountry"), "url": article.get("url"),
                             "query_group": label, "tone": article.get("tone")})
        except Exception as exc:
            print(f"[WARN] GDELT {label} {cursor}..{stop}: {exc}")
            # GDELT may rate-limit automated clients; stop retrying this feed and use publisher RSS.
            if "429" in str(exc):
                break
        cursor = stop + timedelta(days=1)
        time.sleep(0.5)
    frame = pd.DataFrame(rows).drop_duplicates("url") if rows else pd.DataFrame(columns=["published_at", "title", "domain", "language", "source_country", "url", "query_group", "tone"])
    if not frame.empty:
        frame["Date"] = pd.to_datetime(frame.published_at, errors="coerce", utc=True).dt.date
    else:
        frame["Date"] = pd.Series(dtype="object")
    return frame


def fetch_rss_articles() -> pd.DataFrame:
    """Fallback recent headlines from publisher feeds when GDELT is rate-limited."""
    feeds = [
        ("https://feeds.feedburner.com/TheHackersNews", "cyber"),
        ("https://www.coindesk.com/arc/outboundfeeds/rss/", "crypto"),
    ]
    rows = []
    for url, default_group in feeds:
        try:
            response = SESSION.get(url, timeout=18)
            response.raise_for_status()
            root = ET.fromstring(response.content)
            for item in root.findall(".//item"):
                title = item.findtext("title", default="")
                description = item.findtext("description", default="")
                link = item.findtext("link", default="")
                pub = item.findtext("pubDate", default="")
                stamp = pd.to_datetime(pub, errors="coerce", utc=True)
                if pd.isna(stamp):
                    continue
                text = f"{title} {description}".lower()
                cyber_terms = ("ransomware", "cyberattack", "cyber attack", "data breach", "hack", "hacked", "malware", "phishing", "exploit", "breach")
                crypto_terms = ("bitcoin", "crypto", "ethereum", "exchange", "stablecoin", "blockchain", "token", "defi")
                group = "cyber" if any(t in text for t in cyber_terms) else "crypto" if any(t in text for t in crypto_terms) else default_group
                if default_group == "cyber" and group != "cyber":
                    continue
                rows.append({"published_at": stamp.isoformat(), "Date": stamp.date(), "title": title,
                             "domain": url.split("/")[2], "language": "English", "source_country": "",
                             "url": link, "query_group": group, "tone": 0.0})
        except Exception as exc:
            print(f"[WARN] RSS {url}: {exc}")
    return pd.DataFrame(rows).drop_duplicates("url") if rows else pd.DataFrame(columns=["published_at", "Date", "title", "domain", "language", "source_country", "url", "query_group", "tone"])


def cyber_crypto_daily(articles: pd.DataFrame, kev: pd.DataFrame, start: date, end: date) -> pd.DataFrame:
    idx = pd.Index(pd.date_range(start, end, freq="D").date, name="Date")
    daily = pd.DataFrame(index=idx)
    for group, prefix in [("cyber", "CYBER"), ("crypto", "CRYPTO_NEWS")]:
        a = articles[articles.query_group == group] if not articles.empty else pd.DataFrame()
        if a.empty:
            daily[f"{prefix}_article_count"] = 0
            daily[f"{prefix}_mean_tone"] = 0.0
            daily[f"{prefix}_source_count"] = 0
        else:
            g = a.groupby("Date")
            daily[f"{prefix}_article_count"] = g.size()
            daily[f"{prefix}_mean_tone"] = pd.to_numeric(g.tone.mean(), errors="coerce")
            daily[f"{prefix}_source_count"] = g.domain.nunique()
    if not kev.empty and "Date" in kev:
        k = kev.copy()
        k["Date"] = pd.to_datetime(k.Date, errors="coerce").dt.date
        k = k[k.Date.between(start, end)]
        daily["CYBER_KEV_added_count"] = k.groupby("Date").size()
        daily["CYBER_KEV_ransomware_count"] = k[k.get("knownRansomwareCampaignUse", "Unknown").astype(str).str.lower().eq("known")].groupby("Date").size()
    else:
        daily["CYBER_KEV_added_count"] = 0
        daily["CYBER_KEV_ransomware_count"] = 0
    daily = daily.fillna(0).reset_index()
    # Conservative one-day lag for news/incident features: only yesterday's published coverage is used.
    event_cols = [c for c in daily if c.startswith("CYBER_") or c.startswith("CRYPTO_NEWS_")]
    daily[event_cols] = daily[event_cols].shift(1).fillna(0)
    return daily


def merge_original(data_dir: Path, out_dir: Path, features: pd.DataFrame) -> list[str]:
    created: list[str] = []
    for filename in ["train.csv", "test.csv", "sample_submission.csv", "NLP_DataSprint2026.parquet"]:
        src = data_dir / filename
        if src.exists():
            dst = out_dir / filename
            if src.resolve() != dst.resolve():
                import shutil
                shutil.copy2(src, dst)
            created.append(filename)
    for name in ["train.csv", "test.csv"]:
        src = data_dir / name
        if not src.exists():
            continue
        original = pd.read_csv(src, low_memory=False)
        if "Date" not in original:
            print(f"[WARN] {src} has no Date column; skipping merge")
            continue
        original["Date"] = pd.to_datetime(original.Date, errors="coerce").dt.date
        add = features.copy()
        add["Date"] = pd.to_datetime(add.Date, errors="coerce").dt.date
        add = add.drop(columns=[c for c in add if c in original.columns and c != "Date"])
        augmented = original.merge(add, on="Date", how="left", validate="many_to_one")
        target = "stress_event_20d"
        if target in original and (target not in augmented or not augmented[target].equals(original[target])):
            raise ValueError(f"Target column changed during merge in {name}; refusing to write")
        out_name = name.replace(".csv", "_augmented.csv")
        augmented.to_csv(out_dir / out_name, index=False)
        created.append(out_name)
    return created


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=None, help="folder containing original DataSprint train/test and optional NLP/sample submission")
    parser.add_argument("--output-dir", type=Path, default=Path("kaggle_upload"))
    parser.add_argument("--start", default="2017-08-17", help="start date for crypto and extra source series")
    parser.add_argument("--end", default=TODAY.isoformat())
    parser.add_argument("--skip-news", action="store_true", help="skip GDELT search; useful if API is unavailable")
    args = parser.parse_args()
    start, end = date.fromisoformat(args.start), date.fromisoformat(args.end)
    if end < start:
        parser.error("--end must be on or after --start")
    out = args.output_dir
    out.mkdir(parents=True, exist_ok=True)
    print(f"Collecting {start} to {end}; output: {out.resolve()}")

    markets = fetch_markets(start, end)
    markets.to_csv(out / "market_macro_raw.csv", index=False)
    crypto = fetch_crypto(start, end)
    crypto.to_csv(out / "crypto_prices_raw.csv", index=False)
    crypto_daily = crypto_features(crypto)
    crypto_daily.to_csv(out / "crypto_daily.csv", index=False)

    kev = fetch_kev()
    kev.to_csv(out / "cisa_kev.csv", index=False)
    if args.skip_news:
        articles = fetch_rss_articles()
    else:
        # GDELT's full-text API is a recent-news feed; older history is covered by the KEV dates,
        # but historical article coverage should be treated as incomplete.
        news_start = max(start, end - timedelta(days=89))
        articles = pd.concat([
            fetch_gdelt_articles(news_start, end, CYBER_QUERY, "cyber"),
            fetch_gdelt_articles(news_start, end, CRYPTO_QUERY, "crypto"),
        ], ignore_index=True).drop_duplicates("url")
        if articles.empty:
            articles = fetch_rss_articles()
    articles.to_csv(out / "cyber_crypto_articles.csv", index=False)
    event_daily = cyber_crypto_daily(articles, kev, start, end)
    event_daily.to_csv(out / "cyber_crypto_daily.csv", index=False)

    # Single Date-keyed feature table suitable for Kaggle and notebook joins.
    features = pd.DataFrame({"Date": pd.date_range(start, end, freq="D").date})
    for frame in [markets, crypto_daily, event_daily]:
        if not frame.empty:
            frame = frame.copy()
            frame["Date"] = pd.to_datetime(frame.Date, errors="coerce").dt.date
            features = features.merge(frame, on="Date", how="left", validate="one_to_one")
    features.to_csv(out / "ews_external_features.csv", index=False)

    copied = []
    if args.data_dir:
        copied = merge_original(args.data_dir, out, features)
    metadata = {
        "title": "DataSprint EWS external market, crypto and cyber features",
        "id": "REPLACE_WITH_KAGGLE_USERNAME/datasprint-ews-external-features",
        "licenses": [],
        "description": "Supplementary data. Set a Kaggle-allowed license after checking source terms; replace the Kaggle username before CLI upload.",
    }
    (out / "dataset-metadata.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    (out / "collection_manifest.json").write_text(json.dumps({
        "collected_at_utc": datetime.now(timezone.utc).isoformat(), "start": start.isoformat(), "end": end.isoformat(),
        "sources": {"markets_macro": "Yahoo Finance chart endpoint and FRED graph CSV", "crypto": "Binance public spot klines",
                    "cyber_vulnerabilities": "CISA KEV JSON catalog", "recent_incident_and_crypto_news": "GDELT DOC API; rolling recent window"},
        "original_files_copied": copied,
        "notes": ["Original DataSprint files are copied unchanged when --data-dir is provided.",
                  "*_augmented.csv files merge external features by Date and retain stress_event_20d as-is.",
                  "GDELT recent-news coverage is not a complete historical incident database.",
                  "External raw prices do not replace the benchmark's original train/test columns or labels."],
    }, indent=2), encoding="utf-8")
    print("Wrote:", ", ".join(sorted(p.name for p in out.iterdir() if p.is_file())))
    if args.data_dir and not copied:
        print("[WARN] No original DataSprint files found in --data-dir. External data is ready; original train/test are still required by the notebook.")


if __name__ == "__main__":
    main()
