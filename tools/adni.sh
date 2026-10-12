#!/usr/bin/env bash
# One command, after ADNI approval and download:
#   ./tools/adni.sh                # looks in ~/Downloads
#   ./tools/adni.sh /path/to/dir   # or wherever you saved the CSVs
#
# Finds the newest NEUROBAT*.csv and ADNIMERGE*.csv, keeps them in data/adni_raw/ (git-ignored,
# never committed), fits the memory model and diagnosis templates, writes an aggregate-only report,
# and asks before publishing the fitted norms to GitHub Pages.
set -euo pipefail
cd "$(dirname "$0")/.."
SRC="${1:-$HOME/Downloads}"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
newest() { find "$SRC" -maxdepth 3 -type f -iname "$1" -print0 2>/dev/null | xargs -0 ls -t 2>/dev/null | head -n 1; }

command -v node >/dev/null || { echo "Node.js 18+ is needed. Install it from https://nodejs.org, then rerun this script."; exit 1; }

NB="$(newest 'NEUROBAT*.csv')"; DX="$(newest 'ADNIMERGE*.csv')"
if [[ -z "$NB" || -z "$DX" ]]; then
  echo "Couldn't find both files in $SRC."
  [[ -z "$NB" ]] && echo "  Missing: NEUROBAT.csv  (IDA → Download → Study Data → Assessments → Neuropsychological → Neuropsychological Battery)"
  [[ -z "$DX" ]] && echo "  Missing: ADNIMERGE.csv (IDA → Download → Study Data → Study Info → ADNIMERGE, the merged key-variables table)"
  echo "Download them, then rerun: ./tools/adni.sh [folder]"
  exit 1
fi
say "Using"; echo "  $NB"; echo "  $DX"

mkdir -p data/adni_raw
cp "$NB" data/adni_raw/NEUROBAT.csv
cp "$DX" data/adni_raw/ADNIMERGE.csv

say "Fitting (about 5 minutes)"
node tools/fit_adni.js --neurobat data/adni_raw/NEUROBAT.csv --dx data/adni_raw/ADNIMERGE.csv --write-engine "${@:2}" | tee data/adni_fit_report.txt

say "Check before publishing"
echo "  1. The ranges printed at the top should look like RAVLT: trials 0–15, recognition false positives low (mostly 0–5)."
echo "     If a column looks wrong, rerun with e.g.:  ./tools/adni.sh \"$SRC\" --map fas=COLUMN_NAME"
echo "  2. Only aggregate results (group means, spreads, cross-validation scores) are written. No participant rows leave data/adni_raw/."

if git rev-parse --git-dir >/dev/null 2>&1; then
  read -r -p $'\nCommit the fitted norms and publish them to GitHub Pages? [y/N] ' ans
  if [[ "$ans" =~ ^[Yy]$ ]]; then
    git add js/adni-fit.js data/adni_fit.json data/adni_fit_report.txt index.html dashboard.html
    git commit -m "Fit memory norms and amnestic template to ADNI RAVLT (aggregate only)"
    git push
    echo "Published. GitHub Pages updates within a couple of minutes."
  else
    echo "Left uncommitted. Review with: git status"
  fi
fi
