import { describe, expect, it } from 'vitest';
import {
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
