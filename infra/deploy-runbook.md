# LexFlow deploy runbook (Phase 1)

One-time setup to deploy lexflow end-to-end via GitHub Actions. Region `sa-east-1`,
account `394559824800`, repo `Coghatch-ai/lexflow`, no custom domain.

Steps marked **[you]** run on your machine with the `dev` IAM user; **[claude]** I drive.

## 0. Prereqs

- `aws sts get-caller-identity` → account `394559824800`, user `dev`.
- `.env` present locally (DB + Clerk keys) — already created during DB provisioning.

## 1. [claude] GitHub repo + first push

I create `Coghatch-ai/lexflow` (private) and push `main`. The `deploy-api` / `deploy-app`
workflows will trigger and **fail** at the AWS-credentials step until secrets exist (step 3) —
that is expected and harmless (no AWS change happens).

## 2. [you] Run the AWS bootstrap

```bash
cd <repo>/infra
bash aws-bootstrap.sh
```

It creates the S3 bucket, CloudFront OAC + distribution, bucket policy, and the OIDC IAM role,
then prints three values. **Paste them back to me:**

```
ROLE_ARN=arn:aws:iam::394559824800:role/lexflow-github-actions-role
DISTRIBUTION_ID=E................
CLOUDFRONT_DOMAIN=d..............cloudfront.net
```

## 3. [claude] Set GitHub PROD secrets

I create the `PROD` environment and set:

- `AWS_ROLE_ARN` = ROLE_ARN
- `CLOUDFRONT_DISTRIBUTION_ID` = DISTRIBUTION_ID
- `VITE_CLERK_PUBLISHABLE_KEY` = your Clerk publishable key (`pk_test_…`)

## 4. [claude] Deploy the API

Dispatch the **Deploy API** workflow → creates stack `lexflow-api-prod` (Lambda + HTTP API,
resolving the `/lexflow/api/prod/*` SSM params). Read the API Gateway URL from the stack output:

```bash
aws cloudformation describe-stacks --region sa-east-1 --stack-name lexflow-api-prod \
  --query "Stacks[0].Outputs[?OutputKey=='ApiGatewayUrl'].OutputValue" --output text
```

## 5. [claude] Deploy the frontend

Set `VITE_API_URL` = the API Gateway URL, then dispatch **Deploy App** → `vite build` →
`s3 sync dist/app → lexflow-frontend-mrhewbuc` → CloudFront invalidation.

## 6. [you] Clerk + your user

- In the Clerk dashboard, add `https://<CLOUDFRONT_DOMAIN>` to the instance's allowed origins.
- Create your local user row (find your Clerk user id in the dashboard):
  ```bash
  pnpm db:create-user <clerk-user-id> <email>
  ```

## Verify

```bash
# API
curl https://<api-id>.execute-api.sa-east-1.amazonaws.com/prod/health   # {"status":"ok"}
aws cloudformation describe-stacks --region sa-east-1 --stack-name lexflow-api-prod \
  --query 'Stacks[0].StackStatus' --output text                         # CREATE_COMPLETE
```

- Open `https://<CLOUDFRONT_DOMAIN>` → sign in with Clerk → take a standard simulation →
  the dashboard/analytics update (browser → API Gateway → Lambda → RDS, all live).

## Custom domains (Phase 2) — api.probius.app + my.probius.app

DNS is on **Cloudflare**. Apex `probius.app` 301-redirects to `my.probius.app` via a Cloudflare
Redirect Rule (not AWS). The `my.` and `api.` records are **DNS-only (grey cloud)** so AWS
terminates TLS with the ACM certs. CloudFront only reads certs from **us-east-1**; the regional
API Gateway needs its cert in **sa-east-1**. Run AWS steps with the `dev` IAM user.

1. **Request two ACM certs (DNS validation):**

   ```bash
   aws acm request-certificate --region us-east-1 --domain-name my.probius.app  --validation-method DNS
   aws acm request-certificate --region sa-east-1 --domain-name api.probius.app --validation-method DNS
   ```

   For each, read the validation CNAME and add it in Cloudflare (DNS-only), then wait for `ISSUED`:

   ```bash
   aws acm describe-certificate --region <region> --certificate-arn <arn> \
     --query 'Certificate.DomainValidationOptions[0].ResourceRecord'
   aws acm describe-certificate --region <region> --certificate-arn <arn> \
     --query 'Certificate.Status'   # ISSUED
   ```

2. **Deploy the API custom domain.** Put the **sa-east-1** cert ARN into `samconfig.toml`:

   ```
   parameter_overrides = "Environment=prod ApiDomainName=api.probius.app ApiCertificateArn=<sa-east-1 arn>"
   ```

   Merge to `main` → **Deploy API** runs → read the regional target:

   ```bash
   aws cloudformation describe-stacks --region sa-east-1 --stack-name lexflow-api-prod \
     --query "Stacks[0].Outputs[?OutputKey=='ApiCustomDomainTarget'].OutputValue" --output text
   ```

3. **Cloudflare — `api`:** `CNAME api → <ApiCustomDomainTarget>`, **DNS-only (grey)**.

4. **Attach the CloudFront alias** with the **us-east-1** cert ARN, then wait for `Deployed`:

   ```bash
   bash infra/cloudfront-add-domain.sh <us-east-1 arn>
   aws cloudfront get-distribution --id E31A7ZWGZ815JT --query 'Distribution.Status'   # Deployed
   ```

5. **Cloudflare — `my` + apex:**
   - `CNAME my → d1qru6bxdnwd2r.cloudfront.net`, **DNS-only (grey)**.
   - Apex: a proxied placeholder (`A probius.app → 192.0.2.1`, orange) + a **Redirect Rule**
     `Hostname eq probius.app` → 301 `https://my.probius.app${http.request.uri.path}` (preserve query).

6. **Redeploy with the new API URL + locked CORS.** Set the GitHub PROD secret
   `VITE_API_URL=https://api.probius.app` (no `/prod`), merge the `handler.ts` / template CORS /
   `deploy-policy.json` changes → run **Deploy App** (rebuilds the SPA) and **Deploy API**. If
   `deploy-policy.json` changed, re-apply the inline policy:

   ```bash
   aws iam put-role-policy --role-name lexflow-github-actions-role \
     --policy-name lexflow-deploy-policy --policy-document file://infra/deploy-policy.json
   ```

   (The policy file uses a `DISTRIBUTION_ID_PLACEHOLDER` token that `aws-bootstrap.sh` substitutes;
   substitute it the same way before applying, or apply the already-substituted version.)

7. **Clerk (separate):** add `https://my.probius.app` to the existing Clerk instance's allowed
   origins so sign-in works. Production-instance migration (`clerk.`/`accounts.` DNS, `pk_live_`)
   is a later follow-up.

**Verify custom domains:**

```bash
curl -i https://api.probius.app/health          # {"status":"ok"}, ACAO: https://my.probius.app
curl -sI https://probius.app                     # 301 → https://my.probius.app/
```

Open `https://my.probius.app` → sign in → take a simulation; Network tab shows calls to
`api.probius.app` with no CORS errors.

## Teardown (if ever needed)

```bash
aws cloudformation delete-stack --region sa-east-1 --stack-name lexflow-api-prod
aws cloudfront get-distribution-config --id <DISTRIBUTION_ID>   # disable, then delete
aws s3 rb s3://lexflow-frontend-mrhewbuc --force
aws iam delete-role-policy --role-name lexflow-github-actions-role --policy-name lexflow-deploy-policy
aws iam delete-role --role-name lexflow-github-actions-role
```
