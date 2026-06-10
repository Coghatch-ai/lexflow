#!/usr/bin/env bash
# One-time AWS bootstrap for LexFlow.
# Creates: S3 bucket, CloudFront OAC + distribution, bucket policy, OIDC provider, IAM role + policy.
# Safe to re-run — every step checks for existing resources before creating.
#
# Run from the infra/ directory:  bash aws-bootstrap.sh
# Prereq: aws cli configured as the `dev` IAM user (account 394559824800)
set -euo pipefail

ACCOUNT="394559824800"
REGION="sa-east-1"
BUCKET="lexflow-frontend-mrhewbuc"
ROLE_NAME="lexflow-github-actions-role"
POLICY_NAME="lexflow-deploy-policy"

TMPDIR_WORK=$(mktemp -d)
trap 'rm -rf "$TMPDIR_WORK"' EXIT

# ── 1. S3 bucket ────────────────────────────────────────────────────────────
echo "→ S3 bucket: $BUCKET"
if aws s3api head-bucket --bucket "$BUCKET" --region "$REGION" 2>/dev/null; then
  echo "  (already exists)"
else
  aws s3api create-bucket \
    --bucket "$BUCKET" \
    --region "$REGION" \
    --create-bucket-configuration LocationConstraint="$REGION"
  aws s3api put-public-access-block \
    --bucket "$BUCKET" \
    --public-access-block-configuration \
      "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
  echo "  Created"
fi

# ── 2. CloudFront OAC ───────────────────────────────────────────────────────
echo "→ CloudFront OAC"
OAC_NAME="lexflow-frontend-mrhewbuc-oac"
OAC_ID=$(aws cloudfront list-origin-access-controls \
  --query "OriginAccessControlList.Items[?Name=='$OAC_NAME'].Id" \
  --output text 2>/dev/null)

if [ -n "$OAC_ID" ]; then
  echo "  (already exists: $OAC_ID)"
else
  OAC_ID=$(aws cloudfront create-origin-access-control \
    --origin-access-control-config file://oac-config.json \
    --query "OriginAccessControl.Id" --output text)
  echo "  Created: $OAC_ID"
fi

# ── 3. CloudFront distribution ──────────────────────────────────────────────
echo "→ CloudFront distribution"
DISTRIBUTION_ID=$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?Comment=='lexflow frontend SPA'].Id" \
  --output text 2>/dev/null)

if [ -n "$DISTRIBUTION_ID" ]; then
  echo "  (already exists: $DISTRIBUTION_ID)"
  CLOUDFRONT_DOMAIN=$(aws cloudfront get-distribution \
    --id "$DISTRIBUTION_ID" \
    --query "Distribution.DomainName" --output text)
else
  CALLER_REF="lexflow-bootstrap-$(date +%s)"
  DIST_CONFIG_FILE="$TMPDIR_WORK/dist-config.json"
  sed \
    -e "s/CALLER_REF_PLACEHOLDER/$CALLER_REF/" \
    -e "s/OAC_ID_PLACEHOLDER/$OAC_ID/" \
    cloudfront-config.json > "$DIST_CONFIG_FILE"

  DIST_RESULT=$(aws cloudfront create-distribution \
    --distribution-config "file://$DIST_CONFIG_FILE" \
    --query "Distribution.{Id:Id,Domain:DomainName}" --output json)

  DISTRIBUTION_ID=$(echo "$DIST_RESULT" | jq -r '.Id')
  CLOUDFRONT_DOMAIN=$(echo "$DIST_RESULT" | jq -r '.Domain')
  echo "  Created: $DISTRIBUTION_ID ($CLOUDFRONT_DOMAIN)"
  echo "  Note: distribution deployment takes ~15 min; you can proceed while it propagates"
fi

DISTRIBUTION_ARN="arn:aws:cloudfront::${ACCOUNT}:distribution/${DISTRIBUTION_ID}"

# ── 4. S3 bucket policy ─────────────────────────────────────────────────────
echo "→ S3 bucket policy"
BUCKET_POLICY_FILE="$TMPDIR_WORK/bucket-policy.json"
sed "s|DISTRIBUTION_ARN_PLACEHOLDER|$DISTRIBUTION_ARN|" \
  bucket-policy.json > "$BUCKET_POLICY_FILE"
aws s3api put-bucket-policy \
  --bucket "$BUCKET" \
  --policy "file://$BUCKET_POLICY_FILE"
echo "  Applied"

# ── 5. GitHub OIDC provider ─────────────────────────────────────────────────
echo "→ GitHub OIDC provider"
OIDC_ARN="arn:aws:iam::${ACCOUNT}:oidc-provider/token.actions.githubusercontent.com"
if aws iam get-open-id-connect-provider --open-id-connect-provider-arn "$OIDC_ARN" &>/dev/null; then
  echo "  (already exists)"
else
  aws iam create-open-id-connect-provider \
    --url "https://token.actions.githubusercontent.com" \
    --client-id-list "sts.amazonaws.com" \
    --thumbprint-list "6938fd4d98bab03faadb97b34396831e3780aea1"
  echo "  Created"
fi

# ── 6. IAM role ─────────────────────────────────────────────────────────────
echo "→ IAM role: $ROLE_NAME"
if aws iam get-role --role-name "$ROLE_NAME" &>/dev/null; then
  echo "  (already exists)"
  ROLE_ARN="arn:aws:iam::${ACCOUNT}:role/${ROLE_NAME}"
else
  ROLE_ARN=$(aws iam create-role \
    --role-name "$ROLE_NAME" \
    --assume-role-policy-document file://trust-policy.json \
    --query "Role.Arn" --output text)
  echo "  Created: $ROLE_ARN"
fi

# ── 7. IAM deploy policy ─────────────────────────────────────────────────────
echo "→ IAM deploy policy: $POLICY_NAME"
DEPLOY_POLICY_FILE="$TMPDIR_WORK/deploy-policy.json"
sed "s|DISTRIBUTION_ID_PLACEHOLDER|$DISTRIBUTION_ID|" \
  deploy-policy.json > "$DEPLOY_POLICY_FILE"
aws iam put-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-name "$POLICY_NAME" \
  --policy-document "file://$DEPLOY_POLICY_FILE"
echo "  Applied"

# ── Done ─────────────────────────────────────────────────────────────────────
echo ""
echo "Bootstrap complete. Paste these values back:"
echo ""
echo "ROLE_ARN=$ROLE_ARN"
echo "DISTRIBUTION_ID=$DISTRIBUTION_ID"
echo "CLOUDFRONT_DOMAIN=$CLOUDFRONT_DOMAIN"
