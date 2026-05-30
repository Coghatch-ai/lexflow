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
`s3 sync dist/app → lexflow-frontend` → CloudFront invalidation.

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

## Teardown (if ever needed)

```bash
aws cloudformation delete-stack --region sa-east-1 --stack-name lexflow-api-prod
aws cloudfront get-distribution-config --id <DISTRIBUTION_ID>   # disable, then delete
aws s3 rb s3://lexflow-frontend --force
aws iam delete-role-policy --role-name lexflow-github-actions-role --policy-name lexflow-deploy-policy
aws iam delete-role --role-name lexflow-github-actions-role
```
