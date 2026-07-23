// api/trpc/routers/relay.router.ts
//
// Generic poll endpoint for async relay jobs (api/lib/relay.ts). A channel
// procedure (e.g. ai.grade) enqueues a job and returns a jobId; the client then
// polls relay.job until the relay has written the result to S3. Scoped to
// ctx.userId, so a user can only ever read their own job results.
//
// Refund rail (S3 #52): a job that comes back status:error had its currency
// debited at enqueue but delivered nothing — refund here, idempotently.
// All three refund calls are no-ops when no matching spend/claim exists, so
// calling all three is safe regardless of which rail the job used:
//   refundCredits          → credit_ledger (non-core jobs)
//   refundAllowance        → allowance_ledger (paid core jobs)
//   reverseFreeTierCounter → free_daily_counter (free core jobs; F2 fix #52)

import { z } from "zod";
import { protectedProcedure, router } from "../procedures";
import { getRelayJob } from "../../lib/relay";
import { refundCredits } from "../../lib/credits";
import { refundAllowance, reverseFreeTierCounter } from "../../lib/allowance";

export const relayRouter = router({
  job: protectedProcedure
    .input(z.object({ jobId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const job = await getRelayJob(ctx.userId, input.jobId);
      if (job.status === "error") {
        // Refund whichever rail was debited. All three are idempotent no-ops when
        // no matching spend/claim exists — safe to call unconditionally.
        // refundCredits: credit_ledger (non-core jobs).
        // refundAllowance: allowance_ledger (paid core jobs).
        // reverseFreeTierCounter: free_daily_counter (free core jobs; F2 fix).
        await refundCredits(ctx.userId, input.jobId);
        await refundAllowance(ctx.userId, input.jobId);
        await reverseFreeTierCounter(ctx.userId, input.jobId);
      }
      return job;
    }),
});
