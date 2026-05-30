// api/trpc/router.ts
//
// Root router. Domain routers live in api/trpc/routers/ and merge here. Keep
// this file thin — one line per domain router. The data routers (questions,
// answers, sessions, stats, goals) land in a later chunk when the UI migrates
// off mock data.

import { router, publicProcedure } from "./procedures";
import { usersRouter } from "./routers/users.router";

export const appRouter = router({
  health: publicProcedure.query(() => ({ status: "ok" as const })),
  users: usersRouter,
});

export type AppRouter = typeof appRouter;
