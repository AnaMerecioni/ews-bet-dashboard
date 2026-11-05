# Scraper EWS DataSprint: piețe, crypto și evenimente cibernetice

Scriptul colectează date publice și le salvează în CSV-uri pentru Kaggle. Nu modifică fișierele DataSprint originale: le copiază separat și creează variante `*_augmented.csv`.

## Ce colectează

- Prețuri BET (unde simbolul Yahoo este disponibil), indici internaționali, VIX, aur și serii macro complementare din FRED.
- OHLCV zilnic pentru BTC, ETH, BNB, SOL, XRP, ADA, DOGE și LTC din endpointul public Binance.
- Catalogul CISA Known Exploited Vulnerabilities, cu data adăugării CVE-urilor exploatate.
- Știri recente despre atacuri cibernetice, ransomware, breșe, hack-uri crypto și evenimente de piață crypto prin GDELT; când GDELT limitează cererile, scriptul folosește fluxuri RSS CoinDesk și The Hacker News.
- Agregări zilnice cu randamente/volatilitate crypto, număr de știri și indicatori KEV, decalate cu o zi pentru a limita folosirea informației publicată după închiderea pieței.

Sursele publice sunt documentate la [FRED](https://fred.stlouisfed.org/docs/api/fred/), [Binance Spot API](https://binance-docs.github.io/apidocs/spot/en/), [CISA KEV](https://www.cisa.gov/known-exploited-vulnerabilities-catalog) și [GDELT DOC](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/).

## Rulare locală sau în Kaggle

Necesită Python 3.10+ și `pandas`, `requests`:

```bash
pip install pandas requests
python scraper_ews.py --data-dir /cale/catre/datele-datasprint --output-dir kaggle_upload
```

Pentru a colecta doar sursele noi, fără căutare de știri:

```bash
python scraper_ews.py --start 2017-08-17 --end 2026-11-05 --skip-news --output-dir kaggle_upload
```

În Kaggle, atașează setul original ca input și setează `--data-dir /kaggle/input/<dataset-original>`; poți apoi încărca folderul `kaggle_upload` ca un dataset Kaggle nou. În `dataset-metadata.json`, schimbă `REPLACE_WITH_KAGGLE_USERNAME` cu usernameul tău și alege licența după verificarea termenilor surselor înainte de upload via Kaggle CLI.

## Fișiere generate

| Fișier | Conținut |
|---|---|
| `ews_external_features.csv` | Tabel unic, `Date` + toate feature-urile externe; fișierul principal de încărcat în Kaggle |
| `train_augmented.csv`, `test_augmented.csv` | Fișierele DataSprint unite cu feature-urile externe; ținta rămâne neschimbată |
| `market_macro_raw.csv` | Serii de piață și macro complementare |
| `crypto_prices_raw.csv`, `crypto_daily.csv` | Cotații brute și feature-uri derivate pe crypto |
| `cyber_crypto_articles.csv`, `cyber_crypto_daily.csv` | Știri brute și agregări zilnice de evenimente |
| `cisa_kev.csv` | Catalogul KEV integral, cu date și descrieri CVE |
| `dataset-metadata.json` | Șablon pentru Kaggle CLI |

## Legarea la notebook

Notebookul cere în continuare `train.csv`, `test.csv`, `sample_submission.csv` și `NLP_DataSprint2026.parquet`. Aceste fișiere sunt specifice DataSprint și nu se pot reconstrui din API-uri publice: păstrează-le și oferă-le scriptului prin `--data-dir`. Pentru testarea feature-urilor noi, schimbă în notebook încărcarea lui `train.csv` / `test.csv` la `train_augmented.csv` / `test_augmented.csv`.

`GDELT` furnizează căutare de știri recente, nu un registru istoric complet al atacurilor; agregările de știri acoperă cel mult fereastra recentă colectată. KEV oferă istoric de vulnerabilități exploatate, nu toate incidentele cibernetice. Coincidența temporală nu dovedește că un eveniment a cauzat o mișcare BET sau crypto.

### Atenție la Kaggle și la țintă

Nu încărca `train_augmented.csv` cu eticheta `stress_event_20d` într-un dataset public fără să verifici regulile/licența DataSprint. Pentru notebookul privat, ține fișierele de concurs private sau într-un dataset privat Kaggle. În model, folosește doar caracteristicile crypto/cyber publicate până la momentul predicției; feature-urile evenimentelor sunt decalate cu o zi.
