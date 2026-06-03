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
import { listOfValuesRouter } from "./routers/list-of-values.router";
import { adminRouter } from "./routers/admin.router";
import { calendarsRouter } from "./routers/calendars.router";
import { notesRouter } from "./routers/notes.router";
import { bookmarksRouter } from "./routers/bookmarks.router";

export const appRouter = router({
  health: publicProcedure.query(() => ({ status: "ok" as const })),
  users: usersRouter,
  questions: questionsRouter,
  sessions: sessionsRouter,
  stats: statsRouter,
  goals: goalsRouter,
  lov: listOfValuesRouter,
  admin: adminRouter,
  calendars: calendarsRouter,
  notes: notesRouter,
  bookmarks: bookmarksRouter,
});

export type AppRouter = typeof appRouter;
