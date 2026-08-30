#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "usage: scripts/goldfish_reservoir.sh <kingdom-id> <threads> <out-dir>" >&2
  exit 2
fi

kingdom_id=$1
threads=$2
out_dir=$3
root_dir=$(cd "$(dirname "$0")/.." && pwd)
binary=${HEXDECK_GOLDFISH_BIN:-$root_dir/rust/target/release/hexdeck-goldfish}

if [[ ! -x "$binary" ]]; then
  (cd "$root_dir/rust" && cargo build --release -p hexdeck-goldfish)
fi

mkdir -p "$out_dir/tasks/goldfish-one" "$out_dir/tasks/goldfish-two" "$out_dir/goldfish" "$out_dir/reports"
one="$out_dir/tasks/goldfish-one/0-12972960.hgs"
two="$out_dir/tasks/goldfish-two/0-500000.hgs"
top="$out_dir/goldfish/top-500000.hgf"
reservoir="$out_dir/goldfish/reservoir.hgf"
one_inputs="$out_dir/tasks/goldfish-one-inputs.json"
two_inputs="$out_dir/tasks/goldfish-two-inputs.json"
printf '["%s"]\n' "$one" > "$one_inputs"
printf '["%s"]\n' "$two" > "$two_inputs"

"$binary" score-one --kingdom "$kingdom_id" --start 0 --end 12972960 --threads "$threads" \
  --out "$one" --report "$out_dir/reports/score-one.json"
"$binary" reduce-one --kingdom "$kingdom_id" --inputs "$one_inputs" --out "$top" \
  --report "$out_dir/reports/reduce-one.json"
"$binary" score-two --kingdom "$kingdom_id" --top "$top" --start 0 --end 500000 --threads "$threads" \
  --out "$two" --report "$out_dir/reports/score-two.json"
"$binary" reduce-two --kingdom "$kingdom_id" --top "$top" --inputs "$two_inputs" --out "$reservoir" \
  --report "$out_dir/reports/reduce-two.json"
"$binary" verify --kingdom "$kingdom_id" --kind top --file "$top" \
  | tee "$out_dir/reports/verify-top.json"
"$binary" verify --kingdom "$kingdom_id" --kind reservoir --file "$reservoir" --top "$top" \
  | tee "$out_dir/reports/verify-reservoir.json"

rm -rf "$out_dir/tasks"
