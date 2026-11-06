/**
 * Celula Python care se adaugă o singură dată la finalul notebook-ului (VARIANTA_FINALA.ipynb).
 * După „Save & Run All”, secțiunea Output din Kaggle conține, pe lângă submission.csv și risk_monitoring.csv,
 * și fișierele pentru Factori, Backtest și Sensibilitate. Celula nu modifică submission.csv și nu oprește notebook-ul.
 */
export const EXPORT_CELL_NAME = "export_dashboard_cell.py";

export const EXPORT_CELL = `# === Export pentru dashboard (EWS BET) ==========================================
# Scrie în Output, lângă submission.csv, fișierele pe care le citește dashboard-ul:
#   predictions.csv  - probabilitățile OOF 2010-2023 și cele de test, cu pragul final
#   outcomes.csv     - etichetele reale din perioada OOF (pentru Backtest)
#   drivers.csv      - contribuțiile SHAP pe zile pentru test (primii 12 factori pe zi)
#   sensitivity.csv  - cum se mută probabilitatea din ultima zi dacă un factor se schimbă cu ±1/±2 deviații standard
# Nu modifică submission.csv; dacă un pas eșuează, afișează motivul și trece mai departe.

_out = OUT_DIR if "OUT_DIR" in globals() else Path("/kaggle/working")
_thr = float(final_threshold)

_RULES = [
    ("Știri și sentiment", ["text_", "nlp", "lsa", "sentiment", "tfidf", "news"]),
    ("Volatilitate", ["vix", "vol", "garch", "atr"]),
    ("Regim de piață", ["hmm", "regime", "ciss", "pca"]),
    ("Crypto și cyber", ["crypto", "btc", "eth_", "cyber", "kev"]),
    ("Piețe internaționale", ["sp500", "dax", "stoxx", "nasdaq", "dow", "ftse", "cac", "nikkei", "wig", "bux", "msci", "spx"]),
    ("Curs valutar", ["eur", "usd", "ron", "chf", "huf", "pln", "fx"]),
    ("Dobânzi și obligațiuni", ["yield", "bond", "robor", "ircc", "rate", "bund", "spread", "treasury"]),
    ("Mărfuri", ["oil", "brent", "wti", "gold", "gas", "copper", "commod"]),
    ("Macroeconomie", ["cpi", "gdp", "pib", "infl", "unemp", "pmi", "macro", "prod"]),
    ("Piețe internaționale", ["close", "_ret", "drawdown", "zscore", "momentum"]),
]

def _category(name):
    n = str(name).lower()
    for cat, keys in _RULES:
        if any(k in n for k in keys):
            return cat
    return "Altele"

# 1) predictions.csv + outcomes.csv
try:
    _oof = OOF[["Date", "y", "p_adj"]].copy()
    _oof["Date"] = pd.to_datetime(_oof["Date"]).dt.strftime("%Y-%m-%d")
    _pred = pd.concat([
        pd.DataFrame({"Date": _oof["Date"], "stress_probability_20d": np.clip(_oof["p_adj"].astype(float), 0, 1)}),
        pd.DataFrame({"Date": pd.DatetimeIndex(X_TEST.index).strftime("%Y-%m-%d"),
                      "stress_probability_20d": np.clip(np.asarray(p_test_adj, dtype=float), 0, 1)}),
    ], ignore_index=True).drop_duplicates("Date", keep="last").sort_values("Date")
    _pred["stress_threshold"] = _thr
    _pred.to_csv(_out / "predictions.csv", index=False)
    _outc = _oof.rename(columns={"y": "stress_event_20d"})[["Date", "stress_event_20d"]].drop_duplicates("Date")
    _outc["stress_event_20d"] = _outc["stress_event_20d"].astype(int)
    if "BET_Close_RON" in train_raw.columns:
        _bet = pd.DataFrame({"Date": pd.to_datetime(train_raw[DATE_COL]).dt.strftime("%Y-%m-%d"),
                             "BET": pd.to_numeric(train_raw["BET_Close_RON"], errors="coerce")}).drop_duplicates("Date")
        _outc = _outc.merge(_bet, on="Date", how="left")
    _outc.to_csv(_out / "outcomes.csv", index=False)
    print("predictions.csv:", len(_pred), "zile | outcomes.csv:", len(_outc), "zile")
except Exception as e:
    print("predictions.csv / outcomes.csv nu au fost exportate:", repr(e)[:240])

# 2) drivers.csv (SHAP pe modelul tree din refit-ul final)
_model, _X, _sv = None, None, None
try:
    _tree_name = "lightgbm" if "lightgbm" in final_artifacts["models"] else ("xgboost" if "xgboost" in final_artifacts["models"] else "extra_trees")
    _model = final_artifacts["models"].get(_tree_name, {}).get("model")
    _X = final_artifacts.get("X_test_selected")
    if not HAS_SHAP or _model is None or _X is None or len(_X) == 0:
        raise RuntimeError("SHAP sau modelul tree nu sunt disponibile")
    _sv = shap.TreeExplainer(_model).shap_values(_X)
    if isinstance(_sv, list):
        _sv = _sv[-1]
    _sv = np.asarray(_sv)
    if _sv.ndim == 3:
        _sv = _sv[:, :, -1]
    _dates = pd.DatetimeIndex(_X.index if isinstance(_X.index, pd.DatetimeIndex) else X_TEST.index).strftime("%Y-%m-%d")
    _cols = list(_X.columns)
    _vals = _X.apply(pd.to_numeric, errors="coerce").to_numpy(dtype=float)
    _rows = []
    for i in range(len(_X)):
        for j in np.argsort(-np.abs(_sv[i]))[:12]:
            _rows.append((_dates[i], _cols[j], _category(_cols[j]), round(float(_sv[i, j]), 6), round(float(_vals[i, j]), 6)))
    pd.DataFrame(_rows, columns=["Date", "feature", "category", "contribution", "value"]).to_csv(_out / "drivers.csv", index=False)
    print("drivers.csv:", len(_rows), "rânduri | model:", _tree_name, "| contribuții SHAP în log-odds")
except Exception as e:
    print("drivers.csv nu a fost exportat:", repr(e)[:240])

# 3) sensitivity.csv (ultima zi de test; efectul trece prin modelul tree, aplicat pe probabilitatea finală)
try:
    if _model is None or _X is None or _sv is None:
        raise RuntimeError("lipsește modelul sau SHAP")
    _Xtr = final_artifacts.get("X_train_selected")
    _sd = (_Xtr if _Xtr is not None else _X).apply(pd.to_numeric, errors="coerce").std()
    _last = _X.iloc[[-1]].copy()
    _logit = lambda p: np.log(np.clip(p, 1e-6, 1 - 1e-6) / (1 - np.clip(p, 1e-6, 1 - 1e-6)))
    _p_tree0 = float(_model.predict_proba(_last)[:, 1][0])
    _p_final0 = float(np.asarray(p_test_adj, dtype=float)[-1])
    _imp = pd.Series(np.abs(_sv).mean(axis=0), index=_X.columns).sort_values(ascending=False)
    _sens = []
    for f in _imp.index[:6]:
        s = float(_sd.get(f, np.nan))
        v = pd.to_numeric(_last[f], errors="coerce").iloc[0]
        if not np.isfinite(s) or s == 0 or not np.isfinite(v):
            continue
        for k in [-2, -1, 0, 1, 2]:
            fr = _last.copy()
            fr[f] = v + k * s
            p_tree = float(_model.predict_proba(fr)[:, 1][0])
            p = 1 / (1 + np.exp(-(_logit(_p_final0) + _logit(p_tree) - _logit(_p_tree0))))
            _sens.append((f, k, round(float(p), 6)))
    pd.DataFrame(_sens, columns=["feature", "shift_sigma", "probability"]).to_csv(_out / "sensitivity.csv", index=False)
    print("sensitivity.csv:", len(_sens), "rânduri pentru", str(pd.DatetimeIndex(X_TEST.index)[-1].date()))
except Exception as e:
    print("sensitivity.csv nu a fost exportat:", repr(e)[:240])

print("Fișiere pentru dashboard în", _out, ":", sorted(p.name for p in _out.glob("*.csv")))
`;
