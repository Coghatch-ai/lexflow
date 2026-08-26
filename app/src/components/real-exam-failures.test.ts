import { afterEach, describe, expect, it, vi } from 'vitest';
import { UNSETTLED, settleWithin } from '../shared/lib/settle-within';
import {
  DEADLINE_SUBMIT_TIMEOUT_MS,
  PROCESS_REJECTED,
  deadlineCompletionFor,
  deadlineSettlementFor,
  deadlineSubmitFailure,
  deadlineSubmittingNotice,
  deadlineUnconfirmedNotice,
  realBoardScreen,
  realConflictNotice,
  realFailure,
  realScreen,
  realStartFailureKind,
  retryActionFor,
} from './real-exam-failures';

// The BLOCKING finding of the #79 audit: `decideOnMount` had no `catch`, so a
// failed `examDrafts.get` / `questions.byIds` / `processReal` fell through to
// the setup card — the same pixels as "no pending exam" — and the only button
// there calls `startReal`, which force-settles a LIVE 3 h prova real.
describe('realScreen', () => {
  const MOUNT = realFailure('mount');

  it('never shows the setup card when the mount decision FAILED', () => {
    // The whole regression in one line: `failure` outranks `setup`.
    expect(realScreen({ started: false, failure: MOUNT })).toBe('failure');
    expect(realScreen({ started: false, failure: MOUNT })).not.toBe('setup');
  });

  it('shows the setup card only when there is no failure', () => {
    expect(realScreen({ started: false, failure: null })).toBe('setup');
  });

  it('keeps a running exam on screen — a failure never evicts the board', () => {
    expect(realScreen({ started: true, failure: null })).toBe('exam');
    expect(realScreen({ started: true, failure: MOUNT })).toBe('exam');
  });

  it('shows the failure screen for a broken start too', () => {
    expect(realScreen({ started: false, failure: realFailure('start') })).toBe('failure');
    expect(realScreen({ started: false, failure: realFailure('start-after-settle') })).toBe(
      'failure',
    );
  });
});

// The second half of the same finding: the way OUT of a mount failure may not
// be the destructive path. Re-deciding is safe; `startReal` is not.
describe('retryActionFor', () => {
  it('retries the DECISION after a mount failure, never the start', () => {
    expect(retryActionFor('mount')).toBe('decide');
    expect(retryActionFor('mount')).not.toBe('start');
  });

  it('retries the start after a failed start', () => {
    expect(retryActionFor('start')).toBe('start');
    expect(retryActionFor('start-after-settle')).toBe('start');
  });
});

// Finding 2: `startReal` having resolved is the point of no return. A failure
// after it may not claim that nothing was changed — the previous prova real is
// already settled.
describe('realStartFailureKind', () => {
  it('is honest that the previous exam was already settled', () => {
    expect(realStartFailureKind(true)).toBe('start-after-settle');
    expect(realFailure('start-after-settle').body).toContain('JÁ foi encerrada e processada');
  });

  it('says nothing was changed only when startReal never resolved', () => {
    expect(realStartFailureKind(false)).toBe('start');
    expect(realFailure('start').body).toContain('Nada foi alterado');
    expect(realFailure('start-after-settle').body).not.toContain('Nada foi alterado');
  });
});

// The BLOCKING finding of the Codex review of #79: `finishByDeadline` ignored
// the result of `persistence.flush()` and closed the run + showed the review
// screen anyway. A timer expiry landing after a failed save DROPPED every
// answer that never reached the server — and this is the one door with no
// manual retry behind it, because the deadline has already passed.
describe('deadlineSettlementFor', () => {
  it('never settles a deadline whose flush did not land', () => {
    // Mutation guard: flipping this to `settle` is exactly the reported bug —
    // `processReal` settles the SERVER's row, so settling on a failed flush
    // files an exam missing everything typed since the last save (or one that
    // was never persisted at all).
    expect(deadlineSettlementFor({ ok: false })).toBe('hold');
    expect(deadlineSettlementFor({ ok: false })).not.toBe('settle');
  });

  it('settles only when the answers are on the server', () => {
    expect(deadlineSettlementFor({ ok: true })).toBe('settle');
  });

  it('holds a flush that never answered at all', () => {
    // Mutation guard for the third audit round: reading UNSETTLED as `settle`
    // is the optimistic reading this slice forbids everywhere else — "we did
    // not find out" is never "it landed".
    expect(deadlineSettlementFor(UNSETTLED)).toBe('hold');
    expect(deadlineSettlementFor(UNSETTLED)).not.toBe('settle');
  });
});

// The BLOCKING finding of the Codex review of the second round: the deadline
// auto-submit awaited `flush()` / `processReal` with NO bound while the board
// rendered `submitting` — a card with no button. A request that never settles
// therefore stranded the student on an actionless screen forever, never
// reaching the retry. Same defect as the round before it, mirrored: the screen
// asserted ("this wait ends") something the code did not know.
describe('the deadline submission is BOUNDED', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('never leaves the board on the actionless submitting card', async () => {
    vi.useFakeTimers();
    // The exact shape of the bug: a flush that answers neither way.
    const hungFlush = new Promise<{ ok: boolean }>(() => {
      // never resolves, never rejects
    });
    const flushed = settleWithin(hungFlush, DEADLINE_SUBMIT_TIMEOUT_MS);
    await vi.advanceTimersByTimeAsync(DEADLINE_SUBMIT_TIMEOUT_MS);

    // The whole chain, at the pure layer: silence → hold → the retry screen.
    const held = deadlineSettlementFor(await flushed) === 'hold';
    const screen = realBoardScreen({
      reviewing: false,
      submitFailed: held,
      unconfirmed: false,
      expired: true,
    });
    expect(screen).not.toBe('submitting');
    expect(screen).toBe('submit-failed');
    expect(deadlineSubmitFailure(null).retryLabel).toBe('Enviar de novo');
  });

  it('leaves the HAPPY path alone — a send that lands is still not a failure', async () => {
    vi.useFakeTimers();
    const flushed = settleWithin(Promise.resolve({ ok: true }), DEADLINE_SUBMIT_TIMEOUT_MS);
    await vi.advanceTimersByTimeAsync(0);
    expect(deadlineSettlementFor(await flushed)).toBe('settle');
    // …and while it is still in the air, before the bound, the board is the
    // neutral card, never the red one.
    expect(realBoardScreen({ reviewing: false, submitFailed: false, unconfirmed: false, expired: true })).toBe(
      'submitting',
    );
  });
});

describe('realBoardScreen', () => {
  it('never shows the review screen while a submission is held', () => {
    // `setReviewing(true)` may not be reachable on a path where answers were
    // lost: `submit-failed` outranks `review`.
    expect(realBoardScreen({ reviewing: true, submitFailed: true, unconfirmed: false, expired: true })).toBe(
      'submit-failed',
    );
    expect(realBoardScreen({ reviewing: true, submitFailed: true, unconfirmed: false, expired: true })).not.toBe(
      'review',
    );
  });

  it('never falls back to the playing board either — the deadline passed', () => {
    expect(realBoardScreen({ reviewing: false, submitFailed: true, unconfirmed: false, expired: true })).toBe(
      'submit-failed',
    );
    expect(realBoardScreen({ reviewing: false, submitFailed: true, unconfirmed: false, expired: true })).not.toBe(
      'playing',
    );
  });

  it('does not re-open the exam at 00:00 while the submission is in flight', () => {
    // The retry clears `submitFailed` BEFORE flushing, and the flush can hang
    // for a whole request: without `expired` the board went back to `playing`
    // and an exam that had already ended accepted answers again (audit #79).
    expect(realBoardScreen({ reviewing: false, submitFailed: false, unconfirmed: false, expired: true })).not.toBe(
      'playing',
    );
  });

  it('calls the in-flight deadline submission SUBMITTING, not a failure', () => {
    // Second audit round of #79: `expired` used to answer `submit-failed`, so
    // the whole happy path of criterion 4 — every student who reaches 00:00
    // with the tab open, answers already saved — got the red "suas respostas
    // ainda NÃO chegaram ao servidor" card for the length of the send. The
    // failure screen is reserved for an actual `hold`.
    expect(realBoardScreen({ reviewing: false, submitFailed: false, unconfirmed: false, expired: true })).toBe(
      'submitting',
    );
    expect(realBoardScreen({ reviewing: false, submitFailed: false, unconfirmed: false, expired: true })).not.toBe(
      'submit-failed',
    );
    // …and a submission that really failed still outranks it.
    expect(realBoardScreen({ reviewing: false, submitFailed: true, unconfirmed: false, expired: true })).toBe(
      'submit-failed',
    );
  });

  it('never shows the review screen for an UNCONFIRMED settlement', () => {
    // Codex adversarial finding: `finishByDeadline` used to `setReviewing(true)`
    // whatever `processReal` did. Even with `reviewing` set, an unconfirmed
    // outcome may not paint the result screen.
    expect(
      realBoardScreen({ reviewing: true, submitFailed: false, unconfirmed: true, expired: true }),
    ).toBe('unconfirmed');
    expect(
      realBoardScreen({ reviewing: true, submitFailed: false, unconfirmed: true, expired: true }),
    ).not.toBe('review');
    // …and the graver claim still outranks it: "your answers never left" is
    // about the answers, not about the result.
    expect(
      realBoardScreen({ reviewing: false, submitFailed: true, unconfirmed: true, expired: true }),
    ).toBe('submit-failed');
  });

  it('still shows the review of a run that WAS settled after the deadline', () => {
    // `expired` is true for the whole review screen — it may not swallow it.
    expect(realBoardScreen({ reviewing: true, submitFailed: false, unconfirmed: false, expired: true })).toBe('review');
  });

  it('is the normal board and the normal review when nothing is held', () => {
    expect(realBoardScreen({ reviewing: false, submitFailed: false, unconfirmed: false, expired: false })).toBe(
      'playing',
    );
    expect(realBoardScreen({ reviewing: true, submitFailed: false, unconfirmed: false, expired: false })).toBe('review');
  });
});

// The Codex ADVERSARIAL finding: after a LANDED flush, `processReal` timing out
// or throwing was collapsed into "carry on" — `close()` + the review screen —
// so a student whose settlement nobody confirmed was told their exam was
// processed. Unknown is not settled; the DATA is safe (the row is on the server
// and `settleRealRun` finishes it), the SCREEN was the lie.
describe('deadlineCompletionFor', () => {
  it('never shows the review screen when processReal never answered', () => {
    expect(deadlineCompletionFor(UNSETTLED)).toBe('unconfirmed');
    expect(deadlineCompletionFor(UNSETTLED)).not.toBe('review');
  });

  it('never shows the review screen when processReal THREW', () => {
    expect(deadlineCompletionFor(PROCESS_REJECTED)).toBe('unconfirmed');
    expect(deadlineCompletionFor(PROCESS_REJECTED)).not.toBe('review');
  });

  it('shows the result once the server ANSWERED — either way', () => {
    // `settled: false` is a known outcome, not an unknown one: another
    // settlement got there first, so the exam is finished all the same.
    expect(deadlineCompletionFor({ settled: true })).toBe('review');
    expect(deadlineCompletionFor({ settled: false })).toBe('review');
  });

  it('is the whole chain: silence at the settlement lands on a card with a button', async () => {
    vi.useFakeTimers();
    const hung = new Promise<{ settled: boolean }>(() => {
      // never resolves, never rejects — the shape of the bug
    });
    const processed = settleWithin(hung, DEADLINE_SUBMIT_TIMEOUT_MS);
    await vi.advanceTimersByTimeAsync(DEADLINE_SUBMIT_TIMEOUT_MS);

    const unconfirmed = deadlineCompletionFor(await processed) === 'unconfirmed';
    const screen = realBoardScreen({
      reviewing: false,
      submitFailed: false,
      unconfirmed,
      expired: true,
    });
    expect(screen).toBe('unconfirmed');
    // Not the result screen, and not the actionless waiting card either.
    expect(screen).not.toBe('review');
    expect(screen).not.toBe('submitting');
    vi.useRealTimers();
  });
});

// The copy of that screen must not borrow either neighbour's claim: the answers
// DID land (unlike `deadlineSubmitFailure`) and the exam is NOT known to be
// processed (unlike the review screen).
describe('deadlineUnconfirmedNotice', () => {
  it('never says the answers were lost — they are on the server', () => {
    const copy = deadlineUnconfirmedNotice();
    expect(copy.body).not.toContain('NÃO chegaram ao servidor');
    expect(copy.body).not.toContain('será perdido');
    expect(copy.body).toContain('JÁ chegaram ao servidor');
  });

  it('never asserts the exam was processed', () => {
    const copy = deadlineUnconfirmedNotice();
    expect(copy.title).toContain('não confirmamos o encerramento');
    expect(copy.body).not.toContain('foi processada');
  });

  it('offers to confirm again, and says leaving is safe', () => {
    const copy = deadlineUnconfirmedNotice();
    expect(copy.retryLabel).toBe('Confirmar de novo');
    expect(copy.body).toContain('o servidor encerra a prova sozinho');
  });
});

describe('deadlineSubmitFailure', () => {
  it('says the answers did NOT reach the server, and that leaving loses them', () => {
    const copy = deadlineSubmitFailure(null);
    expect(copy.body).toContain('NÃO chegaram ao servidor');
    expect(copy.body).toContain('nada foi processado');
    expect(copy.body).toContain('será perdido');
    // The opposite claim is what the review screen makes — it may never appear
    // on the screen raised BECAUSE the submission failed.
    expect(copy.body).not.toContain('foram processadas');
    expect(copy.body).not.toContain('está no seu histórico');
  });

  it('carries the underlying reason so the student knows what to fix', () => {
    expect(deadlineSubmitFailure('Sua sessão expirou.').body).toContain('Sua sessão expirou.');
  });

  it('retries the submission instead of dismissing it', () => {
    expect(deadlineSubmitFailure(null).retryLabel).toBe('Enviar de novo');
  });
});

// The other half of the same finding: while the deadline submission is IN THE
// AIR, the copy may not assert the failure. It is the normal end of every prova
// real, so it says what is happening and asks the student to wait.
describe('deadlineSubmittingNotice', () => {
  it('never claims the answers did not reach the server', () => {
    const notice = deadlineSubmittingNotice();
    expect(notice.body).not.toContain('NÃO chegaram ao servidor');
    expect(notice.body).not.toContain('nada foi processado');
    expect(notice.body).not.toContain('será perdido');
  });

  it('says the exam ended and the submission is under way', () => {
    const notice = deadlineSubmittingNotice();
    expect(notice.title).toContain('tempo acabou');
    expect(notice.body).toContain('Enviando');
    expect(notice.body).toContain('Não feche esta página');
  });

  it('offers no retry — there is nothing to retry while it is in flight', () => {
    // Structural, not cosmetic: the retry label is what makes the failure card
    // a failure card, and this notice must not be routed through it.
    expect(deadlineSubmittingNotice()).not.toHaveProperty('retryLabel');
  });
});

// The sibling the audit named: a `live` CONFLICT is a prova real still RUNNING
// somewhere else — announcing it as processed sends the student to a histórico
// with nothing in it.
describe('realConflictNotice', () => {
  it('never claims a live conflict was encerrada e processada', () => {
    const live = realConflictNotice('live');
    expect(live).toContain('em andamento');
    expect(live).not.toContain('encerrada e processada');
    expect(live).not.toContain('resultado está no seu histórico');
  });

  it('does not send the student to a device that may not exist', () => {
    // A single tab whose first save committed and lost its response hits the
    // SAME `live` conflict against its own row (`hadToken === false`), so the
    // copy may only mention another device as a possibility — never as an
    // instruction. The fact that holds either way is the row on the server.
    const live = realConflictNotice('live');
    expect(live).not.toContain('Continue a prova no aparelho onde ela está aberta');
    expect(live).toContain('Se ela estiver aberta em outro aparelho');
    expect(live).toContain('registrada no servidor');
  });

  it('keeps a remote conflict honest about not knowing which it was', () => {
    const remote = realConflictNotice('remote');
    expect(remote).toContain('encerrada ou continuada');
    expect(remote).toContain('Se ela já foi encerrada');
  });
});

// The mount copy must actively warn AGAINST starting a new exam: the student
// cannot see that the check failed, only that no exam is offered back.
describe('realFailure', () => {
  it('warns the mount failure is not proof there is no exam', () => {
    const mount = realFailure('mount');
    expect(mount.kind).toBe('mount');
    expect(mount.body).toContain('NÃO quer dizer que não há prova');
    expect(mount.body).toContain('Não inicie');
  });
});
