import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import RealExamFailureCard from './real-exam-failure-card';
import { deadlineCardFor, realFailure } from './real-exam-failures';

// THE ROUND FIVE FINDING (Codex, high): the deadline's `submit-failed` card was
// rendered with `onExit={onExitToModes}`, so the ONE screen that exists because
// the code detected the student's answers never reached the server also offered
// a button that leaves the mode — unmounting the board and discarding the only
// copy of those answers, in silence, directly under copy saying they would be
// lost. `unconfirmed` is NOT the same case (there the flush landed), so it keeps
// its door.
//
// No jsdom and no React Testing Library in this project: the card is a pure
// presentational function, so it is CALLED and its element tree is read. That is
// enough to prove a button is absent, which is the whole assertion.

/** Every literal string in a rendered tree, in order. */
function textsOf(node: ReactNode): string[] {
  if (typeof node === 'string') return [node];
  if (Array.isArray(node)) return node.flatMap((child: ReactNode) => textsOf(child));
  if (isValidElement<{ children?: ReactNode }>(node)) return textsOf(node.props.children);
  return [];
}

function render(onExit: (() => void) | null, screen: 'submit-failed' | 'unconfirmed'): ReactElement {
  return RealExamFailureCard({
    failure: deadlineCardFor(screen, null).failure,
    busy: false,
    onRetry: () => undefined,
    onExit,
  });
}

const EXIT_LABEL = 'Voltar aos modos';

describe('RealExamFailureCard — the exit is a decision, not decoration', () => {
  it('renders NO exit at all when the caller passes none', () => {
    const texts = textsOf(render(null, 'submit-failed'));
    expect(texts).not.toContain(EXIT_LABEL);
    // …and the retry is still there: the card is a dead end without it.
    expect(texts).toContain('Enviar de novo');
  });

  it('renders the exit when the caller does pass one', () => {
    const texts = textsOf(
      render(() => undefined, 'unconfirmed'),
    );
    expect(texts).toContain(EXIT_LABEL);
    expect(texts).toContain('Confirmar de novo');
  });

  it('keeps the exit on the CONTAINER failures — those touched nothing', () => {
    const texts = textsOf(
      RealExamFailureCard({
        failure: realFailure('mount'),
        busy: false,
        onRetry: () => undefined,
        onExit: () => undefined,
      }),
    );
    expect(texts).toContain(EXIT_LABEL);
  });
});

// The wiring the board is bound to: one function decides the copy AND the exit,
// so a future edit cannot bring the door back on `submit-failed` without saying
// so here.
describe('deadlineCardFor', () => {
  it('offers NO way out while the answers are known to be unsent', () => {
    const card = deadlineCardFor('submit-failed', null);
    expect(card.exit).toBe('none');
    expect(card.exit).not.toBe('modes');
    // The only affordance is the retry, and it is the one that saves the run.
    expect(card.failure.retryLabel).toBe('Enviar de novo');
    // Rendered through the board's own wiring, the button is gone.
    expect(textsOf(render(card.exit === 'modes' ? () => undefined : null, 'submit-failed'))).not.toContain(
      EXIT_LABEL,
    );
  });

  it('keeps the exit for an UNCONFIRMED settlement — those answers DID land', () => {
    const card = deadlineCardFor('unconfirmed', null);
    expect(card.exit).toBe('modes');
    expect(card.failure.retryLabel).toBe('Confirmar de novo');
    expect(textsOf(render(card.exit === 'modes' ? () => undefined : null, 'unconfirmed'))).toContain(
      EXIT_LABEL,
    );
  });

  it('carries the underlying reason into the held submission, and never into the other', () => {
    expect(deadlineCardFor('submit-failed', 'Você está sem conexão.').failure.body).toContain(
      'Você está sem conexão.',
    );
    expect(deadlineCardFor('unconfirmed', 'Você está sem conexão.').failure.body).not.toContain(
      'Você está sem conexão.',
    );
  });
});
