// shared/domain/question.ts
//
// Canonical question shape (camelCase). Replaces the four per-component
// snake_case `interface Question` copies in the simulation flows — import this
// type and `toQuestion()` instead of redefining + remapping in each component.

export type Question = {
  id: string;
  questionText: string;
  options: string[];
  correctAnswer: string;
  legalBasis: string | null;
  explanation: string;
  legislationLink: string | null;
  legislationTitle: string | null;
  difficulty: string;
  discipline: string;
  topic: string;
  examBoard: string;
  year: number;
  phase: string;
};

// A row returned by trpc.questions.list / reviewQueue carries the canonical
// fields plus system columns — accept the superset and project down.
export type QuestionRow = Question & Record<string, unknown>;

export function toQuestion(row: QuestionRow): Question {
  return {
    id: row.id,
    questionText: row.questionText,
    options: row.options,
    correctAnswer: row.correctAnswer,
    legalBasis: row.legalBasis,
    explanation: row.explanation,
    legislationLink: row.legislationLink,
    legislationTitle: row.legislationTitle,
    difficulty: row.difficulty,
    discipline: row.discipline,
    topic: row.topic,
    examBoard: row.examBoard,
    year: row.year,
    phase: row.phase,
  };
}
