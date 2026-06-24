// api/trpc/routers/issues.router.ts
//
// GitHub issue ops for the admin bug-report page, routed through LexFlow's own
// relay (lexflow-relay → GitHub, repo + PAT owned by the relay). Replaces the
// browser → mrhewbuc-issues Function URL path. Admin-gated (the page is admin
// only). Response shapes mirror what AdminIssuesPage consumes.

import { z } from "zod";
import { adminProcedure, router } from "../procedures";
import { invokeRelay } from "../../lib/relay";

type IssueListItem = {
  number: number;
  title: string;
  url: string;
  createdAt: string;
  labels: string[];
};
type IssueAuthor = { login: string | null; avatarUrl: string | null };
type IssueComment = { id: number; body: string; createdAt: string; author: IssueAuthor };
type IssueDetail = {
  number: number;
  title: string;
  body: string | null;
  state: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  author: IssueAuthor;
  labels: string[];
};

const numberInput = z.object({ number: z.number().int().positive() });

export const issuesRouter = router({
  // Open issues, newest first, PRs filtered out (relay side).
  list: adminProcedure.query(async () => {
    const data = await invokeRelay<{ issues: IssueListItem[] }>({
      channel: "github",
      action: "list",
    });
    return data.issues;
  }),

  // One issue + its comment thread, one round-trip.
  get: adminProcedure.input(numberInput).query(async ({ input }) => {
    return invokeRelay<{ issue: IssueDetail; comments: IssueComment[] }>({
      channel: "github",
      action: "get",
      number: input.number,
    });
  }),

  create: adminProcedure
    .input(
      z.object({
        title: z.string().min(1).max(256),
        body: z.string().min(1).max(20000),
        labels: z.array(z.string()).max(20).default([]),
      }),
    )
    .mutation(async ({ input }) => {
      return invokeRelay<{ number: number; url: string }>({
        channel: "github",
        action: "create",
        title: input.title,
        body: input.body,
        labels: input.labels,
      });
    }),

  close: adminProcedure.input(numberInput).mutation(async ({ input }) => {
    return invokeRelay<{ number: number; state: string }>({
      channel: "github",
      action: "close",
      number: input.number,
    });
  }),
});
