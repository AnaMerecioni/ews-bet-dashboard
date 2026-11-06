# EWS BET · Sistem de avertizare timpurie

Dashboard frontend React + TanStack Start + Tailwind pentru sistemul de avertizare timpurie BET. Datele sunt citite în browser, din fișiere CSV locale sau din linkuri publice GitHub / Google Sheets.

## GitHub Pages

Repository-ul are deja build static publicat pe branch-ul `gh-pages`.

URL: https://anamerecioni.github.io/ews-bet-dashboard/

Pentru a publica o versiune nouă după modificări în aplicație, rulează din rădăcina repository-ului:

```bash
npm install --legacy-peer-deps
bash scripts/deploy-pages.sh
```

Scriptul construiește aplicația în modul `GH_PAGES=1`, pregătește fallback-ul SPA și împinge build-ul pe branch-ul `gh-pages`. În **Settings → Pages**, sursa trebuie să rămână branch-ul `gh-pages` (root).

## Rulare locală

```bash
npm install --legacy-peer-deps
npm run dev        # http://localhost:8080
npm test           # vitest
npm run build      # build local
```

## Datele: notebook-ul și output-ul lui

Pe pagina **Date** există o singură zonă de încărcare. Tragi acolo, odată, tot ce a produs o rulare din Kaggle:

- notebook-ul (`.ipynb`);
- fișierele din **Output** (`submission.csv`, `risk_monitoring.csv` etc.) sau direct arhiva `.zip` cu tot output-ul.

Dashboard-ul recunoaște fiecare fișier după coloane și construiește singur datele: predicțiile vin din `predictions.csv` (cu istoric) sau din `submission.csv`, iar pragul pentru risc ridicat din `risk_monitoring.csv`. Output-ul nou înlocuiește complet datele vechi și deconectează eventualele linkuri vechi (de ex. `ews-bet-date`), ca să nu mai suprascrie datele la fiecare deschidere.

Pentru paginile **Factori**, **Backtest** și scenariile „ce-ar fi dacă”, notebook-ul trebuie să exporte și `drivers.csv`, `outcomes.csv` și `sensitivity.csv`. Celula care face asta e pe pagina Date (butoanele *Copiază celula* / *Descarcă celula*) și în `src/lib/ews/exportCell.ts`. Se adaugă o singură dată la finalul notebook-ului; nu modifică `submission.csv`.

Formatul fișierelor (pentru referință):

- `predictions.csv` / `submission.csv`: `Date,stress_probability_20d,stress_threshold[,high_threshold,asset]`
- `risk_monitoring.csv`: `Date,stress_probability_20d,alert,risk_level`
- `drivers.csv`: `Date,feature,category,contribution[,value,label,asset]` (contribuții SHAP în log-odds)
- `outcomes.csv`: `Date,stress_event_20d[,BET,asset]`
- `sensitivity.csv`: `feature,shift_sigma,probability`

Dashboard-ul nu antrenează modelul și nu execută Python; notebook-ul Kaggle rămâne responsabil pentru antrenare și generarea predicțiilor.

**Confidențialitate:** nu publica `train.csv`, `test.csv`, documente NLP sau alte date brute ale competiției. Publică doar exporturile strict necesare și numai dacă termenii competiției permit acest lucru.
