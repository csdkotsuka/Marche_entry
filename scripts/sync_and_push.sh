#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

python3 scripts/sync_data.py

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Git repository not initialized yet."
  exit 1
fi

git add data/applications.csv data/applications.json

if git diff --cached --quiet; then
  echo "No new changes to commit."
else
  TIMESTAMP="$(date '+%Y-%m-%d %H:%M:%S')"
  git commit -m "chore: update marche applications snapshot (${TIMESTAMP})"
fi

if git remote get-url origin >/dev/null 2>&1; then
  git push -u origin main
  echo "Pushed latest changes to GitHub."
else
  echo "Remote 'origin' is not set. Run: git remote add origin <YOUR_GITHUB_REPO_URL>"
  exit 1
fi
