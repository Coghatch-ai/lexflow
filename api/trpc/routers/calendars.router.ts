// api/trpc/routers/calendars.router.ts
//
// Public (authenticated) read access to the admin-managed exam calendars.
// Used by the homepage to list active exam cycles with their events.

import { asc, eq, inArray } from "drizzle-orm";
import { db } from "../../db/client";
import { examCalendarEvents, examCalendars } from "../../../drizzle/schema";
import { protectedProcedure, router } from "../procedures";

export const calendarsRouter = router({
  listActive: protectedProcedure.query(async () => {
    const cals = await db
      .select()
      .from(examCalendars)
      .where(eq(examCalendars.active, true))
      .orderBy(asc(examCalendars.sortOrder), asc(examCalendars.createdAt));

    if (cals.length === 0) return [];

    const events = await db
      .select()
      .from(examCalendarEvents)
      .where(
        inArray(
          examCalendarEvents.calendarId,
          cals.map((c) => c.id),
        ),
      )
      .orderBy(asc(examCalendarEvents.sortOrder), asc(examCalendarEvents.createdAt));

    return cals.map((cal) => ({
      ...cal,
      events: events.filter((e) => e.calendarId === cal.id),
    }));
  }),
});
