#!/usr/bin/env bash
# Construiește site-ul static și îl publică pe GitHub Pages (branch gh-pages din AnaMerecioni/ews-bet-dashboard).
# Rulare: bash scripts/deploy-pages.sh
set -euo pipefail
cd "$(dirname "$0")/.."

REPO="AnaMerecioni/ews-bet-dashboard"
OUT="$(mktemp -d)"

rm -rf .output dist
GH_PAGES=1 npx vite build >/dev/null
cp -R .output/public/. "$OUT/"
cp "$OUT/_shell.html" "$OUT/index.html"
cp "$OUT/_shell.html" "$OUT/404.html"   # rutele SPA (ex. /alerte) funcționează și la reîncărcare
rm -f "$OUT/_headers"
touch "$OUT/.nojekyll"

cd "$OUT"
git init -q -b gh-pages
git add -A
git -c user.name="$(git -C "$OLDPWD" config user.name || echo deploy)" -c user.email="$(git -C "$OLDPWD" config user.email || echo deploy@localhost)" \
  commit -q -m "Publicare dashboard $(date '+%Y-%m-%d %H:%M')"
git push -q -f "https://github.com/${REPO}.git" gh-pages
echo "Publicat: https://anamerecioni.github.io/ews-bet-dashboard/"
