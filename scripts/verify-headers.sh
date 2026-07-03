#!/usr/bin/env bash
# Verify security headers are present and correct on the live site.
# Usage: ./scripts/verify-headers.sh [url]
# Exits 1 if any required header is missing or misconfigured.

set -euo pipefail

URL="${1:-https://planner.davegregurke.au}"
FAIL=0

check() {
  local label="$1"
  local header="$2"
  local pattern="$3"

  value=$(curl -sI "$URL" | grep -i "^${header}:" | head -1 | sed 's/^[^:]*: //' | tr -d '\r')
  if echo "$value" | grep -qiE "$pattern"; then
    echo "PASS: $label - $value"
  else
    echo "FAIL: $label - got: '${value:-<missing>}'"
    FAIL=1
  fi
}

echo "Checking security headers on $URL"
echo "---"

check "X-Content-Type-Options"  "x-content-type-options" "nosniff"
check "X-Frame-Options"         "x-frame-options"        "DENY|SAMEORIGIN"
check "Referrer-Policy"         "referrer-policy"        "strict-origin|no-referrer|same-origin"
check "Strict-Transport-Security" "strict-transport-security" "max-age=[0-9]"
check "Content-Security-Policy" "content-security-policy" "default-src"
check "Permissions-Policy"      "permissions-policy"     "camera="

echo "---"
if [ "$FAIL" -eq 1 ]; then
  echo "RESULT: FAIL - one or more security headers missing or misconfigured."
  exit 1
else
  echo "RESULT: PASS - all security headers present."
fi
