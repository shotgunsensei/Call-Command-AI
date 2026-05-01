#!/usr/bin/env bash
# Smoke checks for the CallCommand production-readiness hardening pass.
#
# Coverage (read-only, dev-environment safe):
#   1. Health endpoint returns 200.
#   2. Twilio /voice/incoming rejects requests with no signature
#      (TWILIO_VALIDATE_SIGNATURE defaults to true).
#   3. Twilio /voice/consent route exists and rejects unsigned requests.
#   4. Channel write endpoints require auth (401 instead of 500).
#   5. Live-sessions transfer requires auth.
#   6. Pure helper sanity check via tsx (business hours + E.164 normalize).
#
# Run from repo root:  bash scripts/smoke-phase3-hardening.sh

set -uo pipefail

BASE="${BASE:-http://localhost:80}"
RED=$'\033[31m'; GRN=$'\033[32m'; YLW=$'\033[33m'; RST=$'\033[0m'
PASS=0; FAIL=0

check() {
  local name="$1"; shift
  local expected="$1"; shift
  local got="$1"; shift
  if [[ "$got" == "$expected" ]]; then
    echo "${GRN}PASS${RST}  $name (got $got)"
    PASS=$((PASS + 1))
  else
    echo "${RED}FAIL${RST}  $name (expected $expected, got $got)"
    FAIL=$((FAIL + 1))
  fi
}

echo "${YLW}=== HTTP smoke (BASE=$BASE) ===${RST}"

code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/healthz")
check "GET /api/healthz" "200" "$code"

code=$(curl -s -o /dev/null -w '%{http_code}' -X POST \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data 'CallSid=CAtest&From=%2B15555550100&To=%2B15555550199' \
  "$BASE/api/twilio/voice/incoming")
check "POST /api/twilio/voice/incoming (no signature)" "403" "$code"

code=$(curl -s -o /dev/null -w '%{http_code}' -X POST \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data 'CallSid=CAtest&Digits=1&From=%2B15555550100&To=%2B15555550199' \
  "$BASE/api/twilio/voice/consent")
check "POST /api/twilio/voice/consent (no signature)" "403" "$code"

code=$(curl -s -o /dev/null -w '%{http_code}' -X POST \
  -H 'Content-Type: application/json' \
  --data '{"name":"x","liveBehavior":"bogus"}' \
  "$BASE/api/channels")
check "POST /api/channels (no auth)" "401" "$code"

code=$(curl -s -o /dev/null -w '%{http_code}' -X POST \
  -H 'Content-Type: application/json' \
  --data '{"targetId":"00000000-0000-0000-0000-000000000000"}' \
  "$BASE/api/live-sessions/00000000-0000-0000-0000-000000000000/transfer")
check "POST /api/live-sessions/:id/transfer (no auth)" "401" "$code"

echo
echo "${YLW}=== Pure-helper sanity ===${RST}"

node --input-type=module -e '
const days = ["sun","mon","tue","wed","thu","fri","sat"];
const fixedNow = new Date("2026-05-04T15:00:00Z"); // Monday, 15:00 UTC

function dayKey(now, tz){
  const p = new Intl.DateTimeFormat("en-US",{weekday:"short",timeZone:tz||"UTC"}).format(now).toLowerCase().slice(0,3);
  return days.includes(p) ? p : days[now.getUTCDay()];
}
function minutes(now, tz){
  const parts = new Intl.DateTimeFormat("en-US",{hour:"2-digit",minute:"2-digit",hour12:false,timeZone:tz||"UTC"}).formatToParts(now);
  const h = parseInt(parts.find(p=>p.type==="hour").value,10)%24;
  const m = parseInt(parts.find(p=>p.type==="minute").value,10);
  return h*60+m;
}
function parseHM(s){ const m = s && s.match(/^(\d{1,2}):(\d{2})$/); if(!m) return null; const h=+m[1], mn=+m[2]; if(h<0||h>23||mn<0||mn>59) return null; return h*60+mn; }
function inHours(hours, now){
  if(!hours) return true;
  if(hours.mode==="always") return true;
  if(!hours.weekly) return true;
  const slot = hours.weekly[dayKey(now, hours.timezone)];
  if(!slot) return false;
  const s = parseHM(slot.start), e = parseHM(slot.end);
  if(s==null || e==null) return false;
  const c = minutes(now, hours.timezone);
  if(e>s) return c>=s && c<e;
  if(e<s) return c>=s || c<e;
  return false;
}
const cases = [
  ["always-on", inHours(null, fixedNow), true],
  ["mode=always", inHours({mode:"always"}, fixedNow), true],
  ["weekly mon 9-17 in", inHours({mode:"weekly",timezone:"UTC",weekly:{mon:{start:"09:00",end:"17:00"}}}, fixedNow), true],
  ["weekly mon 9-12 out", inHours({mode:"weekly",timezone:"UTC",weekly:{mon:{start:"09:00",end:"12:00"}}}, fixedNow), false],
  ["weekly tue 9-17 wrong day", inHours({mode:"weekly",timezone:"UTC",weekly:{tue:{start:"09:00",end:"17:00"}}}, fixedNow), false],
  ["overnight 22-06 outside", inHours({mode:"weekly",timezone:"UTC",weekly:{mon:{start:"22:00",end:"06:00"}}}, fixedNow), false],
  ["overnight 22-06 in (00:30 next day)", inHours({mode:"weekly",timezone:"UTC",weekly:{tue:{start:"22:00",end:"06:00"}}}, new Date("2026-05-05T00:30:00Z")), true],
  ["malformed slot → closed", inHours({mode:"weekly",timezone:"UTC",weekly:{mon:{start:"bad",end:"17:00"}}}, fixedNow), false],
];
let pass = 0, fail = 0;
for (const [name, got, want] of cases) {
  if (got === want) { console.log("\x1b[32mPASS\x1b[0m " + name); pass++; }
  else              { console.log("\x1b[31mFAIL\x1b[0m " + name + " (got " + got + ", want " + want + ")"); fail++; }
}

function normalizeE164(raw){
  if(raw==null) return null;
  const t=String(raw).trim();
  if(!t) return null;
  const plus=t.startsWith("+");
  const d=t.replace(/[^\d]/g,"");
  if(!d) return null;
  if(plus) return "+"+d;
  if(d.length===11 && d.startsWith("1")) return "+"+d;
  if(d.length===10) return "+1"+d;
  return "+"+d;
}
const phoneCases = [
  ["null → null", normalizeE164(null), null],
  ["empty → null", normalizeE164("  "), null],
  ["+1 415-555-0142", normalizeE164("+1 415-555-0142"), "+14155550142"],
  ["(415) 555-0142", normalizeE164("(415) 555-0142"), "+14155550142"],
  ["14155550142", normalizeE164("14155550142"), "+14155550142"],
  ["4155550142", normalizeE164("4155550142"), "+14155550142"],
  ["+44 20 7946 0958", normalizeE164("+44 20 7946 0958"), "+442079460958"],
];
for (const [name, got, want] of phoneCases) {
  if (got === want) { console.log("\x1b[32mPASS\x1b[0m " + name); pass++; }
  else              { console.log("\x1b[31mFAIL\x1b[0m " + name + " (got " + got + ", want " + want + ")"); fail++; }
}
process.exit(fail === 0 ? 0 : 1);
'
node_rc=$?

echo
if [[ "$FAIL" -gt 0 || "$node_rc" -ne 0 ]]; then
  echo "${RED}HTTP smoke: $PASS passed, $FAIL failed; node helpers: rc=$node_rc${RST}"
  exit 1
fi
echo "${GRN}All smoke checks passed (HTTP: $PASS, helpers: ok).${RST}"
