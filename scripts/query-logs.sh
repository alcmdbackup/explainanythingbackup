#!/bin/bash
# Query production logs by request ID from Grafana Loki via LogCLI.
# Usage: ./scripts/query-logs.sh <request-id> [time-range]
#
# Prerequisites:
#   - brew install grafana/tap/logcli
#   - Set LOKI_ADDR, LOKI_USERNAME, LOKI_PASSWORD in .env.local

set -euo pipefail

REQUEST_ID="${1:?Usage: $0 <request-id> [time-range]}"
RANGE="${2:-1h}"

# === INPUT VALIDATION (prevent LogQL injection) ===
if [[ ! "$REQUEST_ID" =~ ^[a-zA-Z0-9_-]+$ ]]; then
  echo "Error: REQUEST_ID must be alphanumeric with hyphens/underscores only"
  exit 1
fi

if [[ ! "$RANGE" =~ ^[0-9]+[smhd]$ ]]; then
  echo "Error: RANGE must be like '1h', '30m', '7d'"
  exit 1
fi

# === SAFE CREDENTIAL LOADING (avoid shell injection) ===
if [[ -f .env.local ]]; then
  while IFS='=' read -r key value; do
    case "$key" in
      LOKI_ADDR|LOKI_USERNAME|LOKI_PASSWORD)
        export "$key=$value"
        ;;
    esac
  done < <(grep -E '^LOKI_(ADDR|USERNAME|PASSWORD)=' .env.local)
fi

# === VALIDATE PREREQUISITES ===
if [[ -z "${LOKI_ADDR:-}" ]]; then
  echo "Error: LOKI_ADDR not set. Add to .env.local or export manually."
  exit 1
fi

if ! command -v logcli &> /dev/null; then
  echo "Error: logcli not found. Install with: brew install grafana/tap/logcli"
  exit 1
fi

# === EXECUTE QUERY ===
logcli query "{service_name=\"explainanything\"} |= \"requestId=$REQUEST_ID\"" \
  --since="$RANGE" \
  --limit=500 \
  --output=jsonl
