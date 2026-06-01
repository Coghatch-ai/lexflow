#!/usr/bin/env bash
#
# Attach the custom domain my.probius.app (+ its ACM cert) to the existing
# lexflow CloudFront distribution. CloudFront is NOT part of the SAM stack — it
# was created by aws-bootstrap.sh — so this update is done out-of-band via the CLI.
#
# Run once with the `dev` IAM user after the us-east-1 cert is ISSUED:
#   bash cloudfront-add-domain.sh arn:aws:acm:us-east-1:394559824800:certificate/XXXX
#
# Idempotent: re-running with the same cert/alias is a no-op (CloudFront just
# returns the already-applied config). The cert MUST be in us-east-1 — CloudFront
# only reads certs from there.

set -euo pipefail

DIST_ID=E31A7ZWGZ815JT
ALIAS=my.probius.app

CERT_ARN="${1:-}"
if [ -z "$CERT_ARN" ]; then
  echo "usage: $0 <us-east-1 ACM certificate ARN>" >&2
  exit 1
fi
case "$CERT_ARN" in
  arn:aws:acm:us-east-1:*) ;;
  *) echo "ERROR: cert must be in us-east-1 (CloudFront requirement): $CERT_ARN" >&2; exit 1 ;;
esac

command -v jq >/dev/null || { echo "ERROR: jq is required" >&2; exit 1; }

echo "==> Fetching current distribution config ($DIST_ID)"
TMP=$(mktemp)
aws cloudfront get-distribution-config --id "$DIST_ID" > "$TMP"
ETAG=$(jq -r '.ETag' "$TMP")
echo "    ETag=$ETAG"

echo "==> Patching Aliases + ViewerCertificate"
jq --arg alias "$ALIAS" --arg cert "$CERT_ARN" '
  .DistributionConfig
  | .Aliases = { "Quantity": 1, "Items": [$alias] }
  | .ViewerCertificate = {
      "ACMCertificateArn": $cert,
      "SSLSupportMethod": "sni-only",
      "MinimumProtocolVersion": "TLSv1.2_2021",
      "CloudFrontDefaultCertificate": false,
      "Certificate": $cert,
      "CertificateSource": "acm"
    }
' "$TMP" > /tmp/lexflow-cf-update.json

echo "==> Applying update"
aws cloudfront update-distribution \
  --id "$DIST_ID" \
  --distribution-config "file:///tmp/lexflow-cf-update.json" \
  --if-match "$ETAG" \
  --query 'Distribution.{Status:Status,Aliases:DistributionConfig.Aliases.Items}' \
  --output json

rm -f "$TMP" /tmp/lexflow-cf-update.json

echo
echo "Done. CloudFront takes ~5-10 min to reach 'Deployed'. Then point Cloudflare:"
echo "  CNAME my -> d1qru6bxdnwd2r.cloudfront.net   (DNS-only / grey cloud)"
