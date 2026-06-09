// shared/domain/admin-question.ts
//
// Zod schema for admin question create/update. Shared between the backend admin
// router and the frontend admin page form + CSV import parser.

import { z } from "zod";

export const adminQuestionInputSchema = z.object({
  id: z.string().optional(),
  questionText: z.string().min(1),
  options: z.array(z.string().min(1)).min(4).max(4),
  correctAnswer: z.string().min(1),
  legalBasis: z.string().nullable().default(null),
  explanation: z.string().min(1),
  legislationLink: z.string().nullable().default(null),
  legislationTitle: z.string().nullable().default(null),
  difficulty: z.enum(["easy", "medium", "hard"]),
  discipline: z.string().min(1),
  topic: z.string().min(1),
  examBoard: z.string().min(1),
  year: z.number().int().min(2000).max(2030),
  phase: z.enum(["1st", "2nd"]),
});

export type AdminQuestionInput = z.infer<typeof adminQuestionInputSchema>;
