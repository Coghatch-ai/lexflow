-- Migration 0024: add CHECK constraint on coupons.kind
-- Enforces the three valid coupon kinds at the DB level (F2, issue #53).
-- Non-destructive: existing rows all have kind IN ('credits','allowance','subscription').
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_kind_check"
  CHECK (kind IN ('credits', 'allowance', 'subscription'));
