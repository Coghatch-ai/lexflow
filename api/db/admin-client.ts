// api/db/admin-client.ts
//
// Cross-user DB handle. Importing this file is the explicit "I am operating
// outside a single user's scope" signal.
// Used by:
//   - api/routes/webhook-routes.ts  (Clerk webhook — pre-context user writes)
//   - scripts/seed.ts                (global oab_questions seed)
//
// Today it is the same connection as the scoped ctx.db; the import-time signal
// is the contract, not a runtime difference.

import { db } from "./client";

export const adminDb = db;
