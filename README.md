# EWS BET · Sistem de avertizare timpurie

Dashboard frontend React + TanStack Start + Tailwind pentru sistemul de avertizare timpurie BET. Datele sunt citite în browser, din fișiere CSV locale sau din linkuri publice GitHub / Google Sheets.

## GitHub Pages

Workflow-ul `.github/workflows/pages.yml` construiește aplicația statică la fiecare push în `main` și o publică pe GitHub Pages.

URL public: https://anamerecioni.github.io/ews-bet-dashboard/

În **Settings → Pages**, sursa trebuie să fie **GitHub Actions** (workflow-ul folosește `actions/configure-pages` și permisiunea `pages: write`).

## Rulare locală

```bash
npm install --legacy-peer-deps
npm run dev        # http://localhost:8080
npm test           # vitest
npm run build      # build local
```

## Fișiere de date din notebook-ul Kaggle

Aplicația acceptă exact următoarele formate:

- `predictions.csv` (obligatoriu): `Date,stress_probability_20d,stress_threshold[,high_threshold,asset]` — compatibil cu submisia Kaggle.
- `drivers.csv` (opțional): `Date,feature,category,contribution[,value,label,asset]` — contribuții SHAP / Shapley.
- `outcomes.csv` (opțional): `Date,stress_event_20d[,BET,asset]` — etichete istorice pentru Backtest.
- `sensitivity.csv` (opțional): `feature,shift_sigma,probability`.

Notebook-ul DataSprint exportă aceste patru CSV-uri. După rularea completă, încarcă-le în repository-ul public de date `AnaMerecioni/ews-bet-date` înlocuind fișierele omonime. Apoi, în pagina **Date** a dashboard-ului, conectează linkurile raw:

- `https://raw.githubusercontent.com/AnaMerecioni/ews-bet-date/main/predictions.csv`
- `https://raw.githubusercontent.com/AnaMerecioni/ews-bet-date/main/drivers.csv`
- `https://raw.githubusercontent.com/AnaMerecioni/ews-bet-date/main/outcomes.csv`
- `https://raw.githubusercontent.com/AnaMerecioni/ews-bet-date/main/sensitivity.csv`

Alternativ, încarcă fișierele CSV direct din pagina **Date**. Dashboard-ul nu antrenează modelul și nu execută Python; notebook-ul Kaggle rămâne responsabil pentru antrenare și generarea predicțiilor.

**Confidențialitate:** nu publica `train.csv`, `test.csv`, documente NLP sau alte date brute ale competiției. Publică doar exporturile strict necesare și numai dacă termenii competiției permit acest lucru.

## Deployment manual (opțional)

`bash scripts/deploy-pages.sh` construiește site-ul în modul GitHub Pages și publică branch-ul `gh-pages`. Pentru utilizarea obișnuită este recomandat workflow-ul automat de mai sus.
