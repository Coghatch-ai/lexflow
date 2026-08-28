// api/trpc/routers/users.router.ts
//
// The signed-in user's own profile. Example of the protectedProcedure pattern.
//
// `me` is the first call of any session, so it doubles as the "came back to the
// product" trigger that settles an abandoned prova real (BR-05.5). There is no
// scheduler in this project — settlement is always lazy, on the next contact.
//
// That piggy-backing must never be able to break the profile: `me` is the app's
// boot query (Layout.tsx), so a settlement failure here would 500 the whole
// product for that account with no way out through the UI. It is therefore
// caught and LOGGED (console.error, never swallowed) — settlement is lazy by
// nature and simply runs again on the next contact.

import { eq } from "drizzle-orm";
import { db } from "../../db/client";
import { users } from "../../../drizzle/schema";
import { router, protectedProcedure } from "../procedures";
import { settleRealRun } from "../../lib/settle-real-run";

export const usersRouter = router({
  me: protectedProcedure.query(async ({ ctx }) => {
    try {
      await settleRealRun(ctx.userId);
    } catch (err: unknown) {
      // Loud in the logs, invisible to the student: the profile still loads and
      // the next contact (examDrafts.list, startReal) settles the run.
      console.error("[users.me] settleRealRun failed, profile served anyway:", err);
    }
    const [row] = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
      })
      .from(users)
      .where(eq(users.id, ctx.userId))
      .limit(1);
    return row ?? null;
  }),
});
