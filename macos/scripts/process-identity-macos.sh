#!/bin/bash
# Persist a timezone-qualified, locale-independent identity for new processes.
process_started_at() {
  local started
  started="$(LC_ALL=C TZ=UTC /bin/ps -p "$1" -o lstart= 2>/dev/null | /usr/bin/awk '{$1=$1; print}')"
  [ -n "$started" ] || return 1
  printf 'UTC:%s\n' "$started"
}

process_start_matches() {
  local pid="$1" expected="$2" actual
  [ -n "$expected" ] || return 1
  case "$expected" in
    UTC:*) actual="$(process_started_at "$pid")" || return 1 ;;
    *)
      # Legacy state has no timezone. Accept only an exact local match;
      # guessing an offset could authorize signalling a reused PID.
      actual="$(/bin/ps -p "$pid" -o lstart= 2>/dev/null | /usr/bin/awk '{$1=$1; print}')"
      ;;
  esac
  [ -n "$actual" ] && [ "$actual" = "$expected" ]
}
