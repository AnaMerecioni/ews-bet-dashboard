# EWS BET · Sistem de avertizare timpurie (dashboard)

Dashboard doar frontend (React + TanStack Start + Tailwind), fără backend. Datele vin din CSV-uri încărcate în browser
sau conectate prin link (GitHub / Google Sheets). Pornit în Lovable, întreținut de acum local.

## Rulare

```bash
npm install --legacy-peer-deps
npm run dev        # http://localhost:8080
npm test           # vitest
npm run build      # build de producție
```

## Date

- `predictions.csv` (obligatoriu): `Date, stress_probability_20d, stress_threshold[, high_threshold, asset]` — formatul submisiei Kaggle.
- `drivers.csv`: `Date, feature, category, contribution[, value, label]` — contribuții SHAP.
- `outcomes.csv`: `Date, stress_event_20d[, BET]` — pentru backtest.
- `sensitivity.csv`: `feature, shift_sigma, probability`.

Colegii publică automat din notebook-ul Kaggle cu `weekend_nowcast/kaggle_publica_dashboard.py`
în repo-ul `AnaMerecioni/ews-bet-date`; în pagina **Date** se pune linkul și dashboard-ul se reîncarcă singur.
Linkurile GitHub sunt citite prin API-ul GitHub (fără cache de ~5 minute ca la `raw.githubusercontent.com`).
