#!/bin/bash
set -euo pipefail
. "$(dirname "$0")/../scripts/process-identity-macos.sh"
pid=$$
expected="$(TZ=Asia/Shanghai process_started_at "$pid")"
[ "$expected" = "$(TZ=America/New_York process_started_at "$pid")" ]
TZ=America/New_York process_start_matches "$pid" "$expected"
TZ=Pacific/Auckland process_start_matches "$pid" "$expected"
! process_start_matches "$pid" 'UTC:Mon Jan 1 00:00:00 2000'
! process_start_matches 999999 "$expected"
legacy="$(/bin/ps -p "$pid" -o lstart= | /usr/bin/awk '{$1=$1; print}')"
process_start_matches "$pid" "$legacy"
! process_start_matches "$pid" ''
printf 'process identity timezone and legacy checks passed\n'
