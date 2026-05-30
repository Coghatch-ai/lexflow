#!/usr/bin/env bash
#
# One-time AWS bootstrap for the lexflow deploy pipeline. Creates (lexflow-only,
# additive — touches nothing outside the lexflow-* namespace):
#   - S3 bucket  lexflow-frontend-mrhewbuc   (sa-east-1, private, Block Public Access)
#   - CloudFront OAC + distribution  (SPA, OAC, default *.cloudfront.net domain)
#   - S3 bucket policy               (allow only this distribution via OAC)
#   - IAM role   lexflow-github-actions-role  + inline lexflow-deploy-policy
#                (OIDC trust → repo:Coghatch-ai/lexflow:*)
#
# Run once with the `dev` IAM user. Re-running is safe (existence-guarded).
# At the end it prints ROLE_ARN / DISTRIBUTION_ID / CLOUDFRONT_DOMAIN — paste
# those back to continue the deploy (see infra/deploy-runbook.md).

set -euo pipefail

ACCOUNT=394559824800
REGION=sa-east-1
BUCKET=lexflow-frontend-mrhewbuc
ROLE=lexflow-github-actions-role
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TAGS_TAGSET='TagSet=[{Key=Project,Value=lexflow},{Key=Environment,Value=prod},{Key=CostCenter,Value=billable}]'

echo "==> 1/5  S3 bucket $BUCKET"
if aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  echo "    bucket already exists"
else
  aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" \
    --create-bucket-configuration LocationConstraint="$REGION" >/dev/null
fi
aws s3api put-public-access-block --bucket "$BUCKET" \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-tagging --bucket "$BUCKET" --tagging "$TAGS_TAGSET"

echo "==> 2/5  CloudFront Origin Access Control"
OAC_ID=$(aws cloudfront list-origin-access-controls \
  --query "OriginAccessControlList.Items[?Name=='lexflow-frontend-mrhewbuc-oac'].Id | [0]" --output text)
if [ "$OAC_ID" = "None" ] || [ -z "$OAC_ID" ]; then
  OAC_ID=$(aws cloudfront create-origin-access-control \
    --origin-access-control-config "file://$DIR/oac-config.json" \
    --query 'OriginAccessControl.Id' --output text)
fi
echo "    OAC_ID=$OAC_ID"

echo "==> 3/5  CloudFront distribution"
CALLER_REF="lexflow-$(date +%s)"
sed -e "s/OAC_ID_PLACEHOLDER/$OAC_ID/" -e "s/CALLER_REF_PLACEHOLDER/$CALLER_REF/" \
  "$DIR/cloudfront-config.json" > /tmp/lexflow-cf.json
DIST_JSON=$(aws cloudfront create-distribution --distribution-config file:///tmp/lexflow-cf.json)
DISTRIBUTION_ID=$(printf '%s' "$DIST_JSON" | python3 -c 'import sys,json;print(json.load(sys.stdin)["Distribution"]["Id"])')
DIST_DOMAIN=$(printf '%s' "$DIST_JSON" | python3 -c 'import sys,json;print(json.load(sys.stdin)["Distribution"]["DomainName"])')
DIST_ARN="arn:aws:cloudfront::$ACCOUNT:distribution/$DISTRIBUTION_ID"
aws cloudfront tag-resource --resource "$DIST_ARN" \
  --tags 'Items=[{Key=Project,Value=lexflow},{Key=Environment,Value=prod},{Key=CostCenter,Value=billable}]'
echo "    DISTRIBUTION_ID=$DISTRIBUTION_ID  DOMAIN=$DIST_DOMAIN"

echo "==> 4/5  S3 bucket policy (OAC → this distribution only)"
sed "s|DISTRIBUTION_ARN_PLACEHOLDER|$DIST_ARN|" "$DIR/bucket-policy.json" > /tmp/lexflow-bucket-policy.json
aws s3api put-bucket-policy --bucket "$BUCKET" --policy file:///tmp/lexflow-bucket-policy.json

echo "==> 5/5  IAM role + deploy policy"
if aws iam get-role --role-name "$ROLE" >/dev/null 2>&1; then
  echo "    role already exists; updating trust + policy"
  aws iam update-assume-role-policy --role-name "$ROLE" \
    --policy-document "file://$DIR/trust-policy.json"
else
  aws iam create-role --role-name "$ROLE" \
    --assume-role-policy-document "file://$DIR/trust-policy.json" \
    --tags Key=Project,Value=lexflow Key=Environment,Value=prod Key=CostCenter,Value=billable >/dev/null
fi
sed "s|DISTRIBUTION_ID_PLACEHOLDER|$DISTRIBUTION_ID|" "$DIR/deploy-policy.json" > /tmp/lexflow-deploy-policy.json
aws iam put-role-policy --role-name "$ROLE" --policy-name lexflow-deploy-policy \
  --policy-document file:///tmp/lexflow-deploy-policy.json
ROLE_ARN="arn:aws:iam::$ACCOUNT:role/$ROLE"

rm -f /tmp/lexflow-cf.json /tmp/lexflow-bucket-policy.json /tmp/lexflow-deploy-policy.json

echo
echo "=================== PASTE THESE BACK ==================="
echo "ROLE_ARN=$ROLE_ARN"
echo "DISTRIBUTION_ID=$DISTRIBUTION_ID"
echo "CLOUDFRONT_DOMAIN=$DIST_DOMAIN"
echo "======================================================="
echo "(CloudFront takes ~5-10 min to finish deploying before the domain serves.)"
