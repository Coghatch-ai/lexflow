# LexFlow deploy runbook

One-time setup to deploy lexflow end-to-end via GitHub Actions. Region `sa-east-1`,
account `394559824800`, repo `Coghatch-ai/lexflow`.

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

---

## Outbound relay bootstrap (lexflow-relay)

The relay (`lexflow-relay-{env}`; channels `ai`/`github`/`email`) deploys as part of the
`lexflow-api-prod` stack via `deploy-api.yml`. It replaced the shared `mrhewbuc-issues` central
Lambda. One-time prep **before the first deploy that includes it**:

1. **[you] Re-apply the deploy policy** — `infra/deploy-policy.json` was broadened so the CI role
   can manage `lexflow-relay-*` (Lambda + log group). Re-run put-role-policy (substitute the real
   CloudFront distribution id for the placeholder):

   ```bash
   sed "s/DISTRIBUTION_ID_PLACEHOLDER/$DISTRIBUTION_ID/" infra/deploy-policy.json > /tmp/lexflow-deploy-policy.json
   aws iam put-role-policy --role-name lexflow-github-actions-role \
     --policy-name lexflow-deploy-policy \
     --policy-document file:///tmp/lexflow-deploy-policy.json
   ```

2. **[you] Create the relay SSM params** (region sa-east-1) — `ai-*` + `github-token` are needed
   immediately; the `smtp-*` set only when you actually wire email (the channel exists but isn't
   invoked until then):

   ```bash
   R=sa-east-1
   aws ssm put-parameter --region $R --name /lexflow/relay/prod/ai-api-key   --type SecureString --value '<gemini-key>'
   aws ssm put-parameter --region $R --name /lexflow/relay/prod/ai-model     --type String       --value 'gemini-2.0-flash'
   aws ssm put-parameter --region $R --name /lexflow/relay/prod/github-token --type SecureString --value '<fine-grained PAT>'
   # email (later): smtp-host/smtp-port/smtp-secure/smtp-user/smtp-from (String) + smtp-password (SecureString)
   ```

   Use a **fresh** fine-grained GitHub PAT scoped to `Coghatch-ai/lexflow` Issues:Read+Write
   (per-project secret isolation — do not reuse the shared mrhewbuc-issues PAT). `ai-model` is read
   live (uncached) — swap it with `--overwrite`, no redeploy.

3. **[you] Clerk webhook** (activates auto user-creation; CFN resolves the param at deploy, so it
   must exist first or the stack fails):

   ```bash
   aws ssm put-parameter --region sa-east-1 --name /lexflow/api/prod/clerk-webhook-secret \
     --type SecureString --value '<whsec_… from Clerk dashboard>'
   ```

   Then Clerk dashboard → Webhooks → add endpoint `https://api.probius.app/webhooks/clerk`,
   subscribe `user.created` / `user.updated` / `user.deleted`.

4. **Deploy** via `deploy-api.yml`. The relay has **no** Function URL — confirm:
   `aws lambda get-function-url-config --function-name lexflow-relay-prod` → ResourceNotFound.

5. **[you, after LexFlow is live] Cut LexFlow from `mrhewbuc-issues`** (separate repo): remove
   `PROJECTS.lexflow` from its `src/config.ts`, drop the lexflow origins from its `template.yaml`
   CORS, delete SSM `/mrhewbuc/issues/clerk-jwt-key-lexflow`. Leave the shared stack + shared
   Gemini key / multi-repo PAT running for other projects.

### Smoke-test the relay (post-deploy)

```bash
aws lambda invoke --region sa-east-1 --function-name lexflow-relay-prod \
  --payload '{"channel":"github","action":"list"}' --cli-binary-format raw-in-base64-out /tmp/out.json
cat /tmp/out.json   # {"success":true,"data":{"issues":[...]}}
```

---

## Custom domain setup (one-time, post-bootstrap)

Custom domains: `my.probius.app` (frontend) and `api.probius.app` (API).
ACM certs — both already issued:

- `my.probius.app` → `arn:aws:acm:us-east-1:394559824800:certificate/831dde06-3d7a-4ee0-953d-d0b53ab94562` (us-east-1, for CloudFront)
- `api.probius.app` → `arn:aws:acm:sa-east-1:394559824800:certificate/4004112d-a1b0-4046-9b4f-8801af5e7c23` (sa-east-1, for API Gateway)

### 1. API Gateway custom domain (declarative)

The `Domain` block is declared in `template.yaml`. Merging to `main` triggers `deploy-api.yml`,
which runs `sam deploy` and creates the `api.probius.app` API GW domain automatically.

Read the CNAME target after deploy:

```bash
aws cloudformation describe-stacks --region sa-east-1 --stack-name lexflow-api-prod \
  --query "Stacks[0].Outputs[?OutputKey=='CustomDomainName'].OutputValue" --output text
```

### 2. CloudFront alias + cert (imperative)

CloudFront was created by `aws-bootstrap.sh` (already deleted — it was a one-time op). Update it:

```bash
CONFIG=$(aws cloudfront get-distribution-config --id E31A7ZWGZ815JT)
ETAG=$(echo "$CONFIG" | jq -r '.ETag')
PATCHED=$(echo "$CONFIG" | jq '.DistributionConfig |
  .Aliases = {"Quantity": 1, "Items": ["my.probius.app"]} |
  .ViewerCertificate = {
    "ACMCertificateArn": "arn:aws:acm:us-east-1:394559824800:certificate/831dde06-3d7a-4ee0-953d-d0b53ab94562",
    "SSLSupportMethod": "sni-only",
    "MinimumProtocolVersion": "TLSv1.2_2021",
    "CertificateSource": "acm"
  } |
  del(.ViewerCertificate.CloudFrontDefaultCertificate)')
aws cloudfront update-distribution \
  --id E31A7ZWGZ815JT \
  --if-match "$ETAG" \
  --distribution-config "$PATCHED"
```

### 3. DNS — Cloudflare (dashboard, DNS only / grey cloud)

| Name  | Type  | Value                            |
| ----- | ----- | -------------------------------- |
| `my`  | CNAME | `d1qru6bxdnwd2r.cloudfront.net`  |
| `api` | CNAME | `<CustomDomainName from step 1>` |

**Important:** set both records to **DNS only** (grey cloud). Do not proxy through Cloudflare — CloudFront and API Gateway handle TLS termination themselves.

### 4. Frontend env + Clerk

```bash
gh secret set VITE_API_URL --env PROD --repo Coghatch-ai/lexflow
# value: https://api.probius.app
```

Then dispatch `deploy-app.yml` (workflow_dispatch).

In the Clerk dashboard, add `https://my.probius.app` to allowed origins and redirect URLs.

## Teardown (if ever needed)

```bash
aws cloudformation delete-stack --region sa-east-1 --stack-name lexflow-api-prod
aws cloudfront get-distribution-config --id <DISTRIBUTION_ID>   # disable, then delete
aws s3 rb s3://lexflow-frontend-mrhewbuc --force
aws iam delete-role-policy --role-name lexflow-github-actions-role --policy-name lexflow-deploy-policy
aws iam delete-role --role-name lexflow-github-actions-role
```
