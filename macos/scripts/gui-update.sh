#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"

# Node gives defined lowercase variables priority, even when they are empty.
# Treat empty values as unset, matching the proxy selection below.
[ -n "${https_proxy:-}" ] || unset https_proxy
[ -n "${http_proxy:-}" ] || unset http_proxy
[ -n "${no_proxy:-}" ] || unset no_proxy

# Finder-launched apps do not inherit shell proxy exports. Resolve the active
# macOS HTTPS proxy before Node initializes fetch's environment proxy agent.
# Explicit HTTP(S)_PROXY settings (including lowercase variants) take priority.
if [ -z "${https_proxy:-${HTTPS_PROXY:-${http_proxy:-${HTTP_PROXY:-}}}}" ]; then
  proxy_settings="$(/usr/sbin/scutil --proxy)"
  proxy_enabled="$(printf '%s\n' "$proxy_settings" | /usr/bin/awk '$1 == "HTTPSEnable" { print $3; exit }')"
  if [ "$proxy_enabled" = 1 ]; then
    proxy_host="$(printf '%s\n' "$proxy_settings" | /usr/bin/awk '$1 == "HTTPSProxy" { print $3; exit }')"
    proxy_port="$(printf '%s\n' "$proxy_settings" | /usr/bin/awk '$1 == "HTTPSPort" { print $3; exit }')"
    [ -n "$proxy_host" ] || { printf 'System HTTPS proxy host is missing.\n' >&2; exit 1; }
    case "$proxy_port" in
      ''|*[!0-9]*) printf 'System HTTPS proxy port is invalid.\n' >&2; exit 1 ;;
    esac
    case "$proxy_host" in
      \[*\]) ;;
      *:*) proxy_host="[$proxy_host]" ;;
    esac
    # HTTPSProxy describes an HTTP CONNECT proxy for HTTPS destinations.
    export HTTPS_PROXY="http://$proxy_host:$proxy_port"
    export https_proxy="$HTTPS_PROXY"
    if [ -z "${no_proxy:-${NO_PROXY:-}}" ]; then
      export NO_PROXY="$(printf '%s\n' "$proxy_settings" | /usr/bin/awk '
        $1 == "ExceptionsList" { exceptions = 1; next }
        exceptions && $1 == "}" { exit }
        exceptions && $1 ~ /^[0-9]+$/ && $2 == ":" {
          printf "%s%s", separator, $3; separator = ","
        }
      ')"
      export no_proxy="$NO_PROXY"
    fi
  fi
fi

# The bundled Node 22.22.2 supports fetch proxies without extra dependencies.
# exec keeps the downloader PID attached to the manager's timeout/cancellation.
exec "$ROOT/runtime/node/bin/node" --use-env-proxy "$ROOT/scripts/gui-update.mjs" "$@"
