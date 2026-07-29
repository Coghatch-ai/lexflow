// api/trpc/routers/relay.router.ts
//
// Generic poll endpoint for async relay jobs (api/lib/relay.ts). A channel
// procedure (e.g. ai.grade) enqueues a job and returns a jobId; the client then
// polls relay.job until the relay has written the result to S3. Scoped to
// ctx.userId, so a user can only ever read their own job results.
//
// No refund rail (D4, epic #50): nothing is debited at enqueue any more. Spend is
// metered POST-DELIVERY through the money core charge() (a delivered:false job is
// never charged), so a status:error job simply results in no charge — there is
// nothing to refund here.

import { z } from "zod";
import { protectedProcedure, router } from "../procedures";
import { getRelayJob } from "../../lib/relay";

export const relayRouter = router({
  job: protectedProcedure
    .input(z.object({ jobId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return getRelayJob(ctx.userId, input.jobId);
    }),
});
