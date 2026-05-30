// api/trpc/router.ts
//
// Root router. Domain routers live in api/trpc/routers/ and merge here. Keep
// this file thin — one line per domain router.

import { router, publicProcedure } from "./procedures";
import { usersRouter } from "./routers/users.router";
import { questionsRouter } from "./routers/questions.router";
import { sessionsRouter } from "./routers/sessions.router";
import { statsRouter } from "./routers/stats.router";
import { goalsRouter } from "./routers/goals.router";

export const appRouter = router({
  health: publicProcedure.query(() => ({ status: "ok" as const })),
  users: usersRouter,
  questions: questionsRouter,
  sessions: sessionsRouter,
  stats: statsRouter,
  goals: goalsRouter,
});

export type AppRouter = typeof appRouter;
