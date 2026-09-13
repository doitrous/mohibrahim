#!/usr/bin/env bash
# Smoke-test the PayTabs payment endpoints offline (no real gateway calls).
# Covers: config gating, unconfigured guard, admin guard, callback HMAC verify.
# Run: bash scripts/check-pay.sh
set -euo pipefail
cd "$(dirname "$0")/.."
D=$(mktemp -d); PORT=3994; B=http://localhost:$PORT
fail(){ echo "FAIL: $1"; exit 1; }

# --- no keys: online payment disabled ---
DATA_DIR="$D/a" ADMIN_PASSWORD=x SESSION_SECRET=y PORT=$PORT node server.js & S1=$!
trap 'kill $S1 $S2 2>/dev/null; rm -rf "$D"' EXIT
sleep 1
curl -s $B/api/pay/config | grep -q '"enabled":false' || fail "config should be disabled without keys"
[ "$(curl -s -o /dev/null -w '%{http_code}' -X POST $B/api/pay/create -H 'Content-Type: application/json' -d '{"name":"A","phone":"1"}')" = 503 ] || fail "create should be 503 without keys"
[ "$(curl -s -o /dev/null -w '%{http_code}' $B/api/payments)" = 401 ] || fail "payments should require admin"
kill $S1 2>/dev/null; sleep 0.3

# --- with keys: callback signature verification ---
DATA_DIR="$D/b" ADMIN_PASSWORD=x SESSION_SECRET=y PAYTABS_PROFILE_ID=1 PAYTABS_SERVER_KEY=SKEY PORT=$PORT node server.js & S2=$!
sleep 1
curl -s $B/api/pay/config | grep -q '"enabled":true' || fail "config should be enabled with keys"
BODY='{"tran_ref":"T1","cart_id":"c1","payment_result":{"response_status":"A"}}'
SIG=$(node -e 'const c=require("crypto");process.stdout.write(c.createHmac("sha256","SKEY").update(process.argv[1]).digest("hex"))' "$BODY")
curl -s -X POST $B/api/pay/callback -H 'Content-Type: application/json' -H "signature: $SIG" -d "$BODY" | grep -q '"ok":true' || fail "good signature rejected"
[ "$(curl -s -o /dev/null -w '%{http_code}' -X POST $B/api/pay/callback -H 'Content-Type: application/json' -H 'signature: bad' -d "$BODY")" = 400 ] || fail "bad signature not 400"
grep -q '"status": "paid"' "$D/b/payments.json" || fail "approved callback not recorded as paid"

echo "PASS: payment endpoints"
