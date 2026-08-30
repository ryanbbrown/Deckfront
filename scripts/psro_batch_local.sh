#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: $0 <root> <workers> <threads> <kingdom>..." >&2
  echo "       $0 --one <root> <threads> <kingdom>" >&2
  exit 2
}

if [[ ${1:-} == "--one" ]]; then
  [[ $# -eq 4 ]] || usage
  root=$2
  threads=$3
  kingdom=$4
  [[ $threads =~ ^[1-9][0-9]*$ ]] || usage
  mkdir -p "$root/logs"
  "$(dirname "$0")/psro_search.sh" \
    "$kingdom" \
    "$threads" \
    "$root/$kingdom/goldfish/top-500000.hgf" \
    "$root/$kingdom/goldfish/reservoir.hgf" \
    "$root/$kingdom/matrix" \
    "$root/$kingdom/psro" \
    >"$root/logs/$kingdom-psro-console.log" 2>&1
  exit 0
fi

[[ $# -ge 4 ]] || usage
root=$1
workers=$2
threads=$3
shift 3
[[ $workers =~ ^[1-9][0-9]*$ && $threads =~ ^[1-9][0-9]*$ ]] || usage
printf '%s\0' "$@" | xargs -0 -P "$workers" -n 1 "$0" --one "$root" "$threads"
