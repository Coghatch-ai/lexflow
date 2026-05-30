// api/trpc/routers/list-of-values.router.ts
//
// Picklist reference data. LOV is genuinely public catalog data (no user info),
// so `list` is a publicProcedure — dropdowns can load before/without auth. This
// is the ONLY supported source of picklist options + pt-BR labels; never
// hardcode pt-BR option strings in the API or components.

import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/client";
import { listOfValues } from "../../../drizzle/schema";
import { publicProcedure, router } from "../procedures";

export const listOfValuesRouter = router({
  list: publicProcedure.input(z.object({ type: z.string().min(1) })).query(async ({ input }) => {
    return db
      .select({ code: listOfValues.code, value: listOfValues.value })
      .from(listOfValues)
      .where(and(eq(listOfValues.type, input.type), eq(listOfValues.active, true)))
      .orderBy(listOfValues.sortOrder);
  }),
});
