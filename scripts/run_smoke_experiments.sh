#!/bin/sh
# Runs the smoke experiment for every curated kingdom, one after another. Sequential on purpose: the
# match runner is single threaded and parallel runs would make the recorded throughput meaningless.
set -e
cd "$(dirname "$0")/.."
for kingdom in current-duel three-way-open three-way-engine range-rich-mixed rigged-melee; do
  echo "=== $kingdom"
  npm run experiment --silent -- --kingdom "$kingdom" --mode smoke
done
