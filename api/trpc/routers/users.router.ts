// api/trpc/routers/users.router.ts
//
// The signed-in user's own profile. Example of the protectedProcedure pattern.

import { eq } from "drizzle-orm";
import { db } from "../../db/client";
import { users } from "../../../drizzle/schema";
import { router, protectedProcedure } from "../procedures";

export const usersRouter = router({
  me: protectedProcedure.query(async ({ ctx }) => {
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
