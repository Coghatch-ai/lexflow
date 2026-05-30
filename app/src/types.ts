export type Role = "user" | "admin";
export type Difficulty = "easy" | "medium" | "hard";
export type ExamBoard = "FGV" | "CESPE";
export type Phase = "1st" | "2nd";
export type GoalNotificationType = "progress" | "achieved" | "warning";

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  createdAt: Date;
  updatedAt: Date;
}

export interface OabQuestion {
  id: string;
  questionText: string;
  options: string[];
  correctAnswer: string;
  legalBasis: string;
  explanation: string;
  legislationLink: string;
  legislationTitle: string;
  difficulty: Difficulty;
  discipline: string;
  topic: string;
  examBoard: ExamBoard;
  year: number;
  phase: Phase;
  createdAt: Date;
}

export interface UserAnswer {
  id: string;
  userId: string;
  questionId: string;
  userAnswer: string;
  correct: boolean;
  timeSpent: number;
  createdAt: Date;
}

export interface StudySession {
  id: string;
  userId: string;
  startedAt: Date;
  endedAt: Date | null;
  totalQuestions: number;
  correctAnswers: number;
  discipline: string;
  difficulty: Difficulty;
}

export interface UserPerformanceStats {
  id: string;
  userId: string;
  totalAnswered: number;
  totalCorrect: number;
  accuracy: number;
  totalSessions: number;
  averageTimePerQuestion: number;
  lastUpdated: Date;
}

export interface DisciplinePerformance {
  id: string;
  userId: string;
  discipline: string;
  totalAnswered: number;
  totalCorrect: number;
  accuracy: number;
  lastUpdated: Date;
}

export interface ExamBoardPerformance {
  id: string;
  userId: string;
  examBoard: ExamBoard;
  totalAnswered: number;
  totalCorrect: number;
  accuracy: number;
  lastUpdated: Date;
}

export interface UserGoal {
  id: string;
  userId: string;
  discipline: string;
  targetAccuracy: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface GoalNotification {
  id: string;
  userId: string;
  goalId: string;
  type: GoalNotificationType;
  message: string;
  read: boolean;
  createdAt: Date;
}

export const DISCIPLINES = [
  "Direito Constitucional",
  "Direito Civil",
  "Direito Penal",
  "Direito Processual Civil",
  "Direito Processual Penal",
  "Direito Administrativo",
  "Direito Tributário",
  "Direito Trabalhista",
  "Direito Comercial",
  "Direito Ambiental",
  "Ética Profissional",
];

export const EXAM_BOARDS = ["FGV", "CESPE"] as const;
export const DIFFICULTIES = ["easy", "medium", "hard"] as const;
export const PHASES = ["1st", "2nd"] as const;
