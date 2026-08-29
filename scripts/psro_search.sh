#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 6 || $# -gt 7 ]]; then
  echo "usage: $0 <kingdom-id> <threads> <top-file> <reservoir> <matrix-dir> <out-dir> [--verify]" >&2
  exit 2
fi
if [[ $# -eq 7 && $7 != "--verify" ]]; then
  echo "usage: $0 <kingdom-id> <threads> <top-file> <reservoir> <matrix-dir> <out-dir> [--verify]" >&2
  exit 2
fi

kingdom=$1
threads=$2
top_file=$3
reservoir=$4
matrix_dir=$5
out_dir=$6
deep_verify=${7:-}
root=$(cd "$(dirname "$0")/.." && pwd)
binary=${HEXDECK_GOLDFISH_BIN:-$root/rust/target/release/hexdeck-goldfish}

if [[ ! -x "$binary" ]]; then
  (cd "$root/rust" && cargo build --release)
fi

"$binary" psro \
  --kingdom "$kingdom" \
  --top-file "$top_file" \
  --reservoir "$reservoir" \
  --matrix-dir "$matrix_dir" \
  --out "$out_dir" \
  --threads "$threads" \
  --report "$out_dir/run-report.json"

if [[ "$deep_verify" == "--verify" ]]; then
  "$binary" psro-verify \
    --kingdom "$kingdom" \
    --top-file "$top_file" \
    --reservoir "$reservoir" \
    --matrix-dir "$matrix_dir" \
    --out "$out_dir"
fi
