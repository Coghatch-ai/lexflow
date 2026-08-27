# RDS IP allowlist — restoring DB access when your IP changes

The developer works from changing networks, so this recurs: the moment the laptop's public IP
changes, every command that touches the `lexflow` database stops connecting. Nothing in the code
broke. This is the runbook to get access back.

## Symptom — it is reachability, never a code defect

`pnpm smoke` (and anything else that opens a DB connection) dies **before any SQL runs**:

```
connect ETIMEDOUT 54.232.1.9:5432
Connection terminated due to connection timeout
```

A timeout at connect time means the packet never reached the instance. Do NOT go looking for a
query bug, a Drizzle regression, or a bad credential — a wrong password fails fast with an auth
error, not a timeout.

Quick check, straight to the point:

```bash
nc -z -w 5 mrhewbuc-rds.ctaccs4ugjxb.sa-east-1.rds.amazonaws.com 5432
```

No "succeeded" → your `/32` is not in the allowlist. That is the whole diagnosis.

## The security group is `sg-01be3c83d801344d9` — NOT the one in CLAUDE.md

This is the first wrong turn, and it costs the most time. The DB instance is `mrhewbuc-rds` in
`sa-east-1`, `PubliclyAccessible: true`, and the security group that carries the developer
allowlist is **`sg-01be3c83d801344d9`**.

`sg-0d065bb06c8c04a68` — the SG named in `CLAUDE.md` — is the **Lambda/VPC** security group. It has
no tcp/5432 rule at all, so editing it changes nothing and tells you nothing.

`sg-01be3c83d801344d9` holds one `/32` ingress rule on tcp/5432 **per developer**, identified only
by the rule's **Description**. Two exist today:

- `nomad-auto` — the rotating slot for the travelling developer (this is the one you rotate).
- `dev-machine-claude-gsc` — someone else's machine. Never touch it.

## The fix — rotate the `nomad-auto` slot

**Authorize the new `/32` BEFORE revoking the stale one.** In that order a mistake leaves an extra
rule; in the other order a mistake locks everyone out of a DB in a no-NAT VPC.

```bash
# 1. find your current public IP
curl -s https://checkip.amazonaws.com

# 2. inspect the rules that exist right now (CIDR + Description)
aws ec2 describe-security-groups --group-ids sg-01be3c83d801344d9 --region sa-east-1 \
  --output text --query 'SecurityGroups[0].IpPermissions[].IpRanges[].[CidrIp,Description]'

# 3. authorize the NEW ip (keep the nomad-auto description — it is the only identity a rule has)
aws ec2 authorize-security-group-ingress --group-id sg-01be3c83d801344d9 --region sa-east-1 \
  --ip-permissions 'IpProtocol=tcp,FromPort=5432,ToPort=5432,IpRanges=[{CidrIp=<NEW_IP>/32,Description=nomad-auto}]'

# 4. only now revoke the STALE nomad-auto ip
aws ec2 revoke-security-group-ingress --group-id sg-01be3c83d801344d9 --region sa-east-1 \
  --ip-permissions 'IpProtocol=tcp,FromPort=5432,ToPort=5432,IpRanges=[{CidrIp=<OLD_IP>/32}]'
```

Verify with the same `nc -z` from the top — it must return "succeeded". Then re-run whatever failed.

## Rules — this is the SHARED AWS account 394559824800

- **Touch only the `nomad-auto` rule.** Another developer's `/32` is not yours to revoke, even when
  it looks stale.
- **One `/32` per person. Never `0.0.0.0/0`** — not "temporarily", not "while debugging". A public
  Postgres port is scanned within minutes.
- **Always set the Description.** The rule's Description is the only thing that says whose it is; an
  undescribed `/32` becomes an orphan nobody dares delete.

## CI/deploy is unaffected — migrations are what need this

GitHub Actions deploys through OIDC and does not use this security group, so a stale allowlist never
breaks a deploy. What it breaks is **migrations**: `pnpm db:migrate` runs from a laptop by design (CI
cannot reach RDS — see
[migration-deploy-contract.md](migration-deploy-contract.md)), so an unrotated `/32` means the
schema change simply cannot be applied, while the code that expects it deploys just fine.
