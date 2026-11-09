import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import StandardBoard from './testing-standard-board';
import type { StandardRunStart, TestQuestion } from './testing-standard-types';

// THE REVIEW FINDING (internal, blocking item 2 of #102): a zero-question draw
// crashed the board — `questions[currentIndex]` then `currentQuestion.id` in the
// unconditional render path. BR-06.3 ("runs with what exists") makes 0 a
// reachable state, so the board needs its own floor.
//
// No jsdom and no React Testing Library in this project. The exported
// `StandardBoard` is a dispatcher with ZERO hooks of its own — it either returns
// `EmptyRunNotice` or an UNCALLED `<StandardBoardRun/>` element — so it is
// CALLED as a plain function and its element tree is read, exactly as
// `app/src/components/real-exam-failure-card.test.tsx` already does. Picking the
// empty branch is the whole assertion: `StandardBoardRun` (the half that
// dereferences a current question) is never invoked, so nothing can crash.

/** Every literal string in a rendered tree, in order. */
function textsOf(node: ReactNode): string[] {
  if (typeof node === 'string') return [node];
  if (Array.isArray(node)) return node.flatMap((child: ReactNode) => textsOf(child));
  if (isValidElement<{ children?: ReactNode }>(node)) return textsOf(node.props.children);
  return [];
}

type FunctionComponentLike = (props: Record<string, unknown>) => ReactNode;

/** The name of the component an element would mount, or its tag. */
function componentNameOf(node: ReactElement): string {
  const { type } = node;
  return typeof type === 'function' ? type.name : String(type);
}

/**
 * Renders ONE level: calls the function component the dispatcher picked with the
 * props it handed over. Safe only because the branch under test holds no hooks.
 */
function callOnce(node: ReactElement): ReactNode {
  if (!isValidElement<Record<string, unknown>>(node)) throw new Error('not an element');
  if (typeof node.type !== 'function') throw new Error(`not a component: ${String(node.type)}`);
  const render = node.type as FunctionComponentLike;
  return render(node.props);
}

function question(id: string): TestQuestion {
  return {
    id,
    questionText: `Enunciado ${id}`,
    options: ['A', 'B', 'C', 'D'],
    correctAnswer: 'A',
    difficulty: 'MEDIUM',
    discipline: 'CONSTITUTIONAL_LAW',
    examBoard: 'FGV',
    explanation: `Explicação ${id}`,
    legislationTitle: null,
  };
}

function startWith(questions: TestQuestion[]): StandardRunStart {
  return {
    questions,
    cursor: 0,
    answers: [],
    carriedTime: new Map<string, number>(),
    elapsedSeconds: 0,
    filters: {
      discipline: 'CONSTITUTIONAL_LAW',
      examBoard: '',
      difficulty: '',
      topic: 'Controle de Constitucionalidade',
    },
    draft: null,
  };
}

function board(questions: TestQuestion[]): ReactElement {
  return StandardBoard({
    start: startWith(questions),
    notice: null,
    onExitToModes: () => undefined,
    onRestart: () => undefined,
    onReloadFromServer: () => undefined,
  });
}

const EMPTY_NOTICE = 'Nenhuma questão disponível para este teste. Ajuste os filtros e comece de novo.';

describe('StandardBoard — a zero-question run is a notice, never a crash', () => {
  it('shows the empty-state notice and its two ways out when the queue is empty', () => {
    const element = board([]);
    const texts = textsOf(callOnce(element));
    expect(texts).toContain(EMPTY_NOTICE);
    expect(texts).toContain('Ajustar filtros');
    expect(texts).toContain('Voltar aos modos');
  });

  it('never reaches the run — the half that dereferences a current question', () => {
    // The crash was `currentQuestion.id` on `questions[0]` of an empty queue.
    // It cannot happen while the empty branch is the one taken: the run
    // component is not even constructed, let alone called.
    expect(componentNameOf(board([]))).not.toBe('StandardBoardRun');
    expect(() => textsOf(callOnce(board([])))).not.toThrow();
  });

  it('still hands a non-empty run straight to the board, uncalled', () => {
    // The guard must be the empty case ONLY: a run with questions reaches
    // `StandardBoardRun` (returned as an element, so its hooks never run here).
    const element = board([question('q1')]);
    expect(componentNameOf(element)).toBe('StandardBoardRun');
  });
});
