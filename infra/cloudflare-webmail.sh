#!/usr/bin/env bash
# Reusable HostGator email + clean-webmail Cloudflare DNS bootstrap (project-agnostic).
#
# Scope: mirror HostGator cPanel EMAIL records into Cloudflare (gray/DNS-only) + webmail.{root}
#        clean URL (orange A + Origin Rule :2096). NO AWS app/api, NO Clerk.
#        Companion to docs/production_go_live_runbook.md §2, §9, §9b, §9c.
# Safe to re-run — every step is an upsert (create-or-update), idempotent.
#
#   bash infra/cloudflare-webmail.sh --root probius.com.br --ip 162.241.61.81
#   bash infra/cloudflare-webmail.sh --root probius.com.br --ip <ip> --dry-run
#
# Email values (MX/SPF/DKIM) are auto-pulled from the HostGator nameservers (cPanel's authoritative
# zone), so you don't need cPanel login. Override the NS with --hg-ns, or pass --spf/--dkim/--mx.
# Tokens come from env (preferred — keeps secrets out of shell history) or flags:
#   CLOUDFLARE_DNS_EDIT_TOKEN      Zone:DNS:Edit + Zone:Read              (required)
#   CLOUDFLARE_RULESET_EDIT_TOKEN  Zone:Dynamic Redirect:Edit + origin    (optional; manual fallback)
set -euo pipefail

CF_ACCOUNT="7c9a3929e22265bb765ab0f92c2362a4"            # Coghatch.ai (the one hard-coded constant)
CF_API="https://api.cloudflare.com/client/v4"
WEBMAIL_PORT=2096
EMAIL_HOSTS_RE='^(mail|autodiscover|autoconfig|webdisk|cpcalendars|cpcontacts|cpanel)\.'
CPANEL_HOSTS=(mail autodiscover autoconfig cpcalendars cpcontacts webdisk)  # A → IP, gray
DEFAULT_HG_NS=(nspro40.hostgator.com.br nspro41.hostgator.com.br)

WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT

# ── 0. Args / env / preflight ──────────────────────────────────────────────────
ROOT=""; IP=""; DRY_RUN=0
EMAIL_ONLY=0; WEBMAIL_ONLY=0; STRICT_SSL=0
MX_HOST=""; SPF_VAL=""; DKIM_VAL=""; DKIM_SELECTOR="default"; HG_NS=""
DNS_TOKEN="${CLOUDFLARE_DNS_EDIT_TOKEN:-}"
RULESET_TOKEN="${CLOUDFLARE_RULESET_EDIT_TOKEN:-}"

usage() { sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --root)          ROOT="$2"; shift 2 ;;
    --ip)            IP="$2"; shift 2 ;;
    --dns-token)     DNS_TOKEN="$2"; shift 2 ;;
    --ruleset-token) RULESET_TOKEN="$2"; shift 2 ;;
    --hg-ns)         HG_NS="$2"; shift 2 ;;
    --mx)            MX_HOST="$2"; shift 2 ;;
    --spf)           SPF_VAL="$2"; shift 2 ;;
    --dkim)          DKIM_VAL="$2"; shift 2 ;;
    --dkim-selector) DKIM_SELECTOR="$2"; shift 2 ;;
    --webmail-only)  WEBMAIL_ONLY=1; shift ;;
    --email-only)    EMAIL_ONLY=1; shift ;;
    --strict-ssl)    STRICT_SSL=1; shift ;;
    --dry-run)       DRY_RUN=1; shift ;;
    -h|--help)       usage 0 ;;
    *)               echo "✗ unknown arg: $1" >&2; usage 1 ;;
  esac
done

[ -n "$ROOT" ] || { echo "✗ --root is required" >&2; usage 1; }
[ -n "$IP" ]   || { echo "✗ --ip is required"   >&2; usage 1; }
[[ "$IP" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || { echo "✗ --ip is not an IPv4: $IP" >&2; exit 1; }
[ -n "$DNS_TOKEN" ] || { echo "✗ no DNS token (set CLOUDFLARE_DNS_EDIT_TOKEN or --dns-token)" >&2; exit 1; }
[ "$EMAIL_ONLY" = 1 ] && [ "$WEBMAIL_ONLY" = 1 ] && { echo "✗ --email-only and --webmail-only are mutually exclusive" >&2; exit 1; }
for bin in jq curl dig; do command -v "$bin" >/dev/null 2>&1 || { echo "✗ missing dependency: $bin" >&2; exit 1; }; done

HAVE_RULESET=0; [ -n "$RULESET_TOKEN" ] && HAVE_RULESET=1
last4() { printf '%s' "${1: -4}"; }
echo "→ Config"
echo "  root=$ROOT  ip=$IP  dry-run=$DRY_RUN  strict-ssl=$STRICT_SSL"
echo "  DNS token: present (…$(last4 "$DNS_TOKEN"))"
echo "  Ruleset token: $([ "$HAVE_RULESET" = 1 ] && echo "present (…$(last4 "$RULESET_TOKEN"))" || echo "ABSENT → manual fallback for Origin Rule / redirect cleanup")"

# cf <token> <METHOD> <path> [json-body]  → echoes .result on success; prints CF error + returns 1 on failure.
cf() {
  local tok="$1" method="$2" path="$3" body="${4:-}"
  if [ "$DRY_RUN" = 1 ] && [ "$method" != "GET" ]; then
    echo "  DRY-RUN $method $path ${body:+--data '$body'}" >&2; echo '{}'; return 0
  fi
  local resp
  resp=$(curl -s -X "$method" "$CF_API$path" \
    -H "Authorization: Bearer $tok" -H "Content-Type: application/json" ${body:+--data "$body"})
  if [ "$(jq -r '.success' <<<"$resp")" != "true" ]; then
    echo "  ✗ CF error ($method $path): $(jq -rc '.errors' <<<"$resp")" >&2; return 1
  fi
  jq -c '.result' <<<"$resp"
}

# ── 1. Resolve zone id + authoritative NS ──────────────────────────────────────
echo "→ Zone for $ROOT"
ZID=$(cf "$DNS_TOKEN" GET "/zones?name=$ROOT" | jq -r '.[0].id // empty')
[ -n "$ZID" ] || { echo "  ✗ no zone named $ROOT in account $CF_ACCOUNT (token scope? typo?)" >&2; exit 1; }
ZONE_NS=$(cf "$DNS_TOKEN" GET "/zones/$ZID" | jq -r '.name_servers[0] // empty')
echo "  zone=$ZID  ns=${ZONE_NS:-<unknown>}"

# Join a chunked dig +short TXT answer into one logical string (merge "..." "..." chunks, drop quotes).
dig_txt() { dig +short TXT "$1" @"$2" 2>/dev/null | sed 's/" "//g; s/"//g'; }
RECORDS=""
rec_id() { echo "$RECORDS" | jq -r "$1" | head -1; }
put_or_post() {  # <existing-id> <body-json>  → PATCH if id, else POST
  local id="$1" body="$2"
  if [ -n "$id" ] && [ "$id" != "null" ]; then cf "$DNS_TOKEN" PATCH "/zones/$ZID/dns_records/$id" "$body" >/dev/null
  else cf "$DNS_TOKEN" POST "/zones/$ZID/dns_records" "$body" >/dev/null; fi
}

# ── 2. HostGator email records → Cloudflare (gray / DNS-only) ───────────────────
if [ "$WEBMAIL_ONLY" != 1 ]; then
  echo "→ Email records → gray (proxied:false)"
  RECORDS=$(cf "$DNS_TOKEN" GET "/zones/$ZID/dns_records?per_page=100")

  # 2a. Resolve a working HostGator NS + pull the per-domain SPF/DKIM (unless overridden).
  if [ -z "$HG_NS" ]; then
    for ns in "${DEFAULT_HG_NS[@]}"; do
      [ -n "$(dig +short MX "$ROOT" @"$ns" 2>/dev/null)" ] && { HG_NS="$ns"; break; }
    done
  fi
  if [ -n "$HG_NS" ]; then echo "  HostGator NS: $HG_NS"
  else echo "  ⚠ no HostGator NS reachable (tried ${DEFAULT_HG_NS[*]}); pass --hg-ns or --spf/--dkim"; fi
  [ -z "$SPF_VAL" ]  && [ -n "$HG_NS" ] && SPF_VAL=$(dig_txt "$ROOT" "$HG_NS" | grep -m1 'v=spf1' || true)
  [ -z "$DKIM_VAL" ] && [ -n "$HG_NS" ] && DKIM_VAL=$(dig_txt "${DKIM_SELECTOR}._domainkey.$ROOT" "$HG_NS" | grep -m1 'v=DKIM1' || true)

  # 2b. Flip any other existing orange cPanel-pattern hosts gray (catches cpanel/whm etc.).
  while IFS=$'\t' read -r id name; do
    [ -n "$id" ] || continue
    cf "$DNS_TOKEN" PATCH "/zones/$ZID/dns_records/$id" '{"proxied":false}' >/dev/null && echo "  gray: $name"
  done < <(echo "$RECORDS" | jq -r --arg re "$EMAIL_HOSTS_RE" \
    '.[] | select(.name|test($re)) | select(.proxied==true) | "\(.id)\t\(.name)"')

  # 2c. Upsert the canonical cPanel host A records → IP, gray.
  for h in "${CPANEL_HOSTS[@]}"; do
    fqdn="$h.$ROOT"
    id=$(rec_id ".[]|select(.type==\"A\" and .name==\"$fqdn\")|.id")
    body=$(jq -n --arg n "$fqdn" --arg c "$IP" '{type:"A",name:$n,content:$c,proxied:false,ttl:300}')
    put_or_post "$id" "$body" && echo "  A $fqdn → $IP (gray)"
  done

  # 2d. MX → mail.{root} prio 0 (replaces a null `.` MX if present).
  MX_TARGET="${MX_HOST%%:*}"; [ -n "$MX_TARGET" ] || MX_TARGET="mail.$ROOT"
  MX_PRIO="${MX_HOST##*:}"; { [ "$MX_PRIO" = "$MX_HOST" ] || [ -z "$MX_PRIO" ]; } && MX_PRIO=0
  id=$(rec_id '.[]|select(.type=="MX")|.id')
  body=$(jq -n --arg n "$ROOT" --arg c "$MX_TARGET" --argjson p "$MX_PRIO" \
    '{type:"MX",name:$n,content:$c,priority:$p,proxied:false,ttl:300}')
  put_or_post "$id" "$body" && echo "  MX $ROOT → $MX_TARGET (prio $MX_PRIO)"

  # 2e. SPF (apex TXT containing v=spf1) — replaces a parked "v=spf1 -all".
  if [ -n "$SPF_VAL" ]; then
    id=$(rec_id ".[]|select(.type==\"TXT\" and .name==\"$ROOT\" and (.content|test(\"v=spf1\")))|.id")
    body=$(jq -n --arg n "$ROOT" --arg c "$SPF_VAL" '{type:"TXT",name:$n,content:$c,proxied:false,ttl:300}')
    put_or_post "$id" "$body" && echo "  SPF: $SPF_VAL"
  else echo "  ⚠ no SPF value (NS pull empty + no --spf) — skipped"; fi

  # 2f. DKIM (selector._domainkey TXT).
  if [ -n "$DKIM_VAL" ]; then
    dname="${DKIM_SELECTOR}._domainkey.$ROOT"
    id=$(rec_id ".[]|select(.type==\"TXT\" and .name==\"$dname\")|.id")
    body=$(jq -n --arg n "$dname" --arg c "$DKIM_VAL" '{type:"TXT",name:$n,content:$c,proxied:false,ttl:300}')
    put_or_post "$id" "$body" && echo "  DKIM $dname set"
  else echo "  ⚠ no DKIM value (NS pull empty + no --dkim) — skipped"; fi

  # 2g. DMARC sanity (do not auto-loosen the user's policy).
  dmarc=$(echo "$RECORDS" | jq -r ".[]|select(.type==\"TXT\" and .name==\"_dmarc.$ROOT\")|.content" | head -1)
  if echo "$dmarc" | grep -qiE 'p=(reject|quarantine)'; then
    echo "  ⚠ DMARC is strict ($dmarc). OK once SPF+DKIM align (they now do). If legit mail bounces,"
    echo "     relax _dmarc.$ROOT to 'v=DMARC1; p=none;' temporarily. Not auto-changed."
  fi
fi

# ── 3. Webmail clean URL: A → HostGator IP, ORANGE (documented §9 exception) ─────
if [ "$EMAIL_ONLY" != 1 ]; then
  WM="webmail.$ROOT"
  echo "→ $WM → A $IP (orange/proxied)"
  EXIST=$(cf "$DNS_TOKEN" GET "/zones/$ZID/dns_records?name=$WM")
  RECID=$(echo "$EXIST" | jq -r '.[0].id // empty')
  TYPE=$(echo  "$EXIST" | jq -r '.[0].type // empty')
  DESIRED=$(jq -n --arg n "$WM" --arg c "$IP" '{type:"A",name:$n,content:$c,proxied:true,ttl:300}')
  if [ -z "$RECID" ]; then
    cf "$DNS_TOKEN" POST "/zones/$ZID/dns_records" "$DESIRED" >/dev/null && echo "  created A (orange)"
  elif [ "$TYPE" != "A" ]; then
    cf "$DNS_TOKEN" PUT "/zones/$ZID/dns_records/$RECID" "$DESIRED" >/dev/null && echo "  repointed $TYPE→A (orange) via PUT"
  else
    cf "$DNS_TOKEN" PATCH "/zones/$ZID/dns_records/$RECID" \
      "$(jq -n --arg c "$IP" '{content:$c,proxied:true}')" >/dev/null && echo "  A present (ensured $IP, orange)"
  fi

  # 3b. Origin Rule (phase http_request_origin): rewrite origin port → 2096.
  echo "→ Origin Rule: $WM → origin :$WEBMAIL_PORT"
  if [ "$HAVE_RULESET" = 1 ]; then
    RULES=$(jq -n --arg h "$WM" --argjson p "$WEBMAIL_PORT" '{
      rules:[{action:"route",
              action_parameters:{origin:{port:$p}},
              expression:("(http.host eq \"" + $h + "\")"),
              description:("webmail -> origin :" + ($p|tostring)),
              enabled:true}]}')
    cf "$RULESET_TOKEN" PUT "/zones/$ZID/rulesets/phases/http_request_origin/entrypoint" "$RULES" >/dev/null \
      && echo "  Origin Rule set (replaces http_request_origin entrypoint)"
  else
    echo "  ⚠ no ruleset token — set manually: Dashboard → Rules → Origin Rules → Create"
    echo "      If (http.host eq \"$WM\") → Rewrite to → Origin → Port = $WEBMAIL_PORT"
  fi

  # ── 4. Remove stale dynamic-redirect rule (runs BEFORE origin → overrides/loops) ──
  echo "→ Stale redirect cleanup (http_request_dynamic_redirect)"
  if [ "$HAVE_RULESET" = 1 ]; then
    DR=$(cf "$RULESET_TOKEN" GET "/zones/$ZID/rulesets/phases/http_request_dynamic_redirect/entrypoint" 2>/dev/null || echo "")
    STALE=$(echo "${DR:-{}}" | jq --arg h "$WM" '[.rules[]?|select(.expression|test($h))]|length' 2>/dev/null || echo 0)
    if [ "${STALE:-0}" -gt 0 ]; then
      KEPT=$(echo "$DR" | jq --arg h "$WM" '{rules:[.rules[]?|select((.expression|test($h))|not)]}')
      if cf "$RULESET_TOKEN" PUT "/zones/$ZID/rulesets/phases/http_request_dynamic_redirect/entrypoint" "$KEPT" >/dev/null 2>&1; then
        echo "  removed $STALE stale redirect rule(s)"
      else
        echo "  ⚠ token denied on dynamic_redirect phase (expected, §9b). Delete by hand:"
        echo "      Dashboard → Rules → Redirect Rules → delete the rule matching host=$WM"
      fi
    else echo "  none"; fi
  else
    echo "  ⚠ no ruleset token — check Dashboard → Rules → Redirect Rules for a stale host=$WM rule and delete it"
  fi

  # ── 5. Verify ───────────────────────────────────────────────────────────────
  if [ "$DRY_RUN" != 1 ] && [ -n "$ZONE_NS" ]; then
    echo "→ Verify (@ $ZONE_NS)"
    echo "  MX   : $(dig +short MX  "$ROOT" @"$ZONE_NS" | tr '\n' ' ')          # expect 0 mail.$ROOT"
    echo "  mail : $(dig +short A   "mail.$ROOT" @"$ZONE_NS" | tr '\n' ' ')     # expect $IP"
    echo "  SPF  : $(dig_txt "$ROOT" "$ZONE_NS" | grep -m1 v=spf1 || echo MISSING)"
    echo "  DKIM : $(dig_txt "${DKIM_SELECTOR}._domainkey.$ROOT" "$ZONE_NS" | grep -qm1 v=DKIM1 && echo present || echo MISSING)"
    echo "  curl -I https://$WM/ :"
    curl -sI --max-time 15 "https://$WM/" 2>/dev/null | grep -iE '^(HTTP/|server:|location:)' | sed 's/^/    /' \
      || echo "    (no response — may be cpsrvd rate-limit/522 on rapid retries, not a fault; retry once)"
    echo "  expect: HTTP 200, server: cloudflare, NO location: …:$WEBMAIL_PORT, body <title>Login no Webmail</title>"
  fi
fi

# ── 6. Manual steps the API tokens cannot do ────────────────────────────────────
SSL_MODE="Full"; [ "$STRICT_SSL" = 1 ] && SSL_MODE="Full (strict)"
cat <<EOF
→ MANUAL (tokens return 9109 / are denied — do these in the Cloudflare dashboard):
  1. SSL/TLS → Overview → set mode = $SSL_MODE
       (Flexible ⇒ 525/526; Full strict only if origin has an AutoSSL cert for webmail.$ROOT)
  2. If §4 printed a token-denied warning: Rules → Redirect Rules → delete stale host=webmail.$ROOT rule.
  3. New domain with no webmail cert (strict 526): set webmail GRAY → cPanel → SSL/TLS Status →
     Run AutoSSL → flip webmail back ORANGE (re-run this script). (runbook §9b)
EOF
echo "✓ done ($ROOT)"
