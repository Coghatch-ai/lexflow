import { describe, expect, it } from 'vitest';
import {
  deadlineSettlementFor,
  deadlineSubmitFailure,
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
});

describe('realBoardScreen', () => {
  it('never shows the review screen while a submission is held', () => {
    // `setReviewing(true)` may not be reachable on a path where answers were
    // lost: `submit-failed` outranks `review`.
    expect(realBoardScreen({ reviewing: true, submitFailed: true, expired: true })).toBe(
      'submit-failed',
    );
    expect(realBoardScreen({ reviewing: true, submitFailed: true, expired: true })).not.toBe(
      'review',
    );
  });

  it('never falls back to the playing board either — the deadline passed', () => {
    expect(realBoardScreen({ reviewing: false, submitFailed: true, expired: true })).toBe(
      'submit-failed',
    );
    expect(realBoardScreen({ reviewing: false, submitFailed: true, expired: true })).not.toBe(
      'playing',
    );
  });

  it('does not re-open the exam at 00:00 while the submission is in flight', () => {
    // The retry clears `submitFailed` BEFORE flushing, and the flush can hang
    // for a whole request: without `expired` the board went back to `playing`
    // and an exam that had already ended accepted answers again (audit #79).
    expect(realBoardScreen({ reviewing: false, submitFailed: false, expired: true })).toBe(
      'submit-failed',
    );
    expect(realBoardScreen({ reviewing: false, submitFailed: false, expired: true })).not.toBe(
      'playing',
    );
  });

  it('still shows the review of a run that WAS settled after the deadline', () => {
    // `expired` is true for the whole review screen — it may not swallow it.
    expect(realBoardScreen({ reviewing: true, submitFailed: false, expired: true })).toBe('review');
  });

  it('is the normal board and the normal review when nothing is held', () => {
    expect(realBoardScreen({ reviewing: false, submitFailed: false, expired: false })).toBe(
      'playing',
    );
    expect(realBoardScreen({ reviewing: true, submitFailed: false, expired: false })).toBe('review');
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
