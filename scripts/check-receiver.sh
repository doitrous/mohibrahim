#!/usr/bin/env bash
# Smoke-test the SEOHub receiver contract. Boots the app on a temp DATA_DIR and
# asserts the custom-adapter envelope, validation, legacy shape and runtime stubs.
# Run: bash scripts/check-receiver.sh
set -euo pipefail
cd "$(dirname "$0")/.."
D=$(mktemp -d); PORT=3987; B=http://localhost:$PORT
DATA_DIR="$D" ADMIN_PASSWORD=x SESSION_SECRET=y HUB_TOKEN=tok \
  SITE_URL=https://example.test PORT=$PORT node server.js & SRV=$!
trap 'kill $SRV 2>/dev/null; rm -rf "$D"' EXIT
sleep 1
fail(){ echo "FAIL: $1"; exit 1; }
A(){ curl -s "$@"; }

[ "$(A -o /dev/null -w '%{http_code}' -X POST $B/api/articles -d '{}')" = 401 ] || fail "unauth not 401"

H=(-H "Authorization: Bearer tok" -H "Content-Type: application/json")
R=$(A "${H[@]}" -X POST $B/api/articles -d '{"cta":{"text":"احجز","url":"https://x"},"articles":[
  {"lang":"ar","title":"ت","slug":"g","bodyMd":"## x\ny","faq":[]},
  {"lang":"en","title":"t","slug":"g","bodyMd":"## x\ny"}]}')
echo "$R" | grep -q '"remoteId":"g:ar"' || fail "no ar result ($R)"
echo "$R" | grep -q 'slug=g&lang=en' || fail "en remoteUrl missing lang"

[ "$(A "${H[@]}" -o /dev/null -w '%{http_code}' -X POST $B/api/articles -d '{"articles":[{"lang":"a","title":"t","slug":"s","bodyMd":"b","references":[{"title":"x","url":"http://no"}]}]}')" = 400 ] || fail "http ref not 400"
[ "$(A "${H[@]}" -o /dev/null -w '%{http_code}' -X POST $B/api/articles -d '{"articles":[{"lang":"a","title":"","slug":"s","bodyMd":"b"}]}')" = 400 ] || fail "empty title not 400"

A "${H[@]}" -X POST $B/api/articles -d '[{"lang":"ar","title":"q","slug":"legacy","bodyMd":"x"}]' | grep -q '"legacy:ar"' || fail "legacy bare array"
A "${H[@]}" -X POST $B/api/seo/sync | grep -q '"ok":true' || fail "sync"
A "${H[@]}" $B/api/seo/pages | grep -q '"pages":\[\]' || fail "pages"
A $B/api/articles | grep -q '"cta"' || fail "cta not folded onto stored article"

echo "PASS: receiver contract"
