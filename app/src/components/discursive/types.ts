// app/src/components/discursive/types.ts
//
// Shared view types for the 2ª-fase (discursive) UI. The question shape matches
// the catalog columns the router exposes pre-submit (answer key withheld).

export type DiscursiveQuestion = {
  id: string;
  examLabel: string;
  examBoard: string;
  year: number;
  area: string;
  questionType: string; // QUESTION_TYPE LOV code
  orderIndex: number;
  statement: string;
  maxPoints: number;
  maxLines: number | null;
  topic: string | null;
};

export type AnswerKey = {
  modelAnswer: string | null;
  legalBasis: string | null;
};

export type AiResult = { score: number; feedback: string };

// One question's answer collected during a run. A graded answer is persisted at
// grade time (server-trusted) and carries its row id; finish upserts the rest.
export type CollectedAnswer = {
  questionId: string;
  answerText: string;
  selfScore: number | null;
  timeSpent: number;
  ai: AiResult | null;
  answerId: string | null;
};

export type Lov = {
  options: { code: string; value: string }[];
  labelOf: (code: string) => string;
};
