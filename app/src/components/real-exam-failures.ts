// What the Simulado Real shows when it could not decide, could not start, or
// could not SEND what the student answered (BR-05.5, epic #67 slice S2d —
// audit of #79).
//
// The rule this file exists for: **a read that FAILED must never be presented
// as "there is no exam pending".** The container's entry is imperative
// (`utils.*.fetch` / `mutateAsync`), not a `useQuery`, so nothing renders an
// error on its own — a rejected `examDrafts.get` used to fall through to the
// setup card, which is the exact same pixels as "nothing pending". One click on
// "Iniciar Simulado Real" from there calls `startReal`, which force-settles a
// live 3 h exam. Silence there costs the student the whole prova.
//
// So the failure gets its OWN screen, and the button on it re-runs the failed
// operation — never the destructive one. `retryActionFor` is that rule as a
// pure function: from a mount failure the only way forward is to DECIDE again.
//
// Pure and React-free on purpose: the invariants above are provable with plain
// vitest, while the wiring that feeds them (the `catch` blocks, the card) is
// only reachable by rendering.

import type { RunConflictKind } from '../shared/lib/run-persistence';

/**
 * Which operation failed.
 *
 * `start` and `start-after-settle` are told apart because they are not equally
 * honest: by the time `questions.list` runs, `examDrafts.startReal` has ALREADY
 * settled whatever prova real was pending. Telling that student "nothing was
 * changed" would be false.
 */
export type RealFailureKind = 'mount' | 'start' | 'start-after-settle';

export interface RealFailure {
  kind: RealFailureKind;
  title: string;
  body: string;
  retryLabel: string;
}

const REAL_FAILURES: Record<RealFailureKind, RealFailure> = {
  mount: {
    kind: 'mount',
    title: 'Não foi possível verificar se você tem uma prova real em andamento.',
    body:
      'Isto NÃO quer dizer que não há prova: a consulta ao servidor falhou. Não inicie ' +
      'um novo simulado agora — iniciar encerra qualquer prova real pendente, e ela pode ' +
      'ainda estar valendo. Verifique a conexão e tente de novo.',
    retryLabel: 'Tentar de novo',
  },
  start: {
    kind: 'start',
    title: 'Não foi possível iniciar o simulado real.',
    body:
      'Nada foi alterado: nenhuma prova foi iniciada, e nenhuma prova pendente foi ' +
      'encerrada. Verifique a conexão e tente de novo.',
    retryLabel: 'Tentar de novo',
  },
  'start-after-settle': {
    kind: 'start-after-settle',
    title: 'Não foi possível carregar as questões do novo simulado.',
    body:
      'Atenção: a prova real anterior JÁ foi encerrada e processada — o resultado está ' +
      'no seu histórico. O novo simulado não chegou a começar. Tente de novo.',
    retryLabel: 'Tentar de novo',
  },
};

/** The pt-BR copy of one failure kind. */
export function realFailure(kind: RealFailureKind): RealFailure {
  return REAL_FAILURES[kind];
}

/**
 * Which failure a broken "Iniciar Simulado Real" deserves, from whether
 * `examDrafts.startReal` had already resolved when the failure hit.
 */
export function realStartFailureKind(startRealDone: boolean): RealFailureKind {
  return startRealDone ? 'start-after-settle' : 'start';
}

/** The three things the container can put on screen. */
export type RealScreen = 'exam' | 'failure' | 'setup';

/**
 * What the container renders. `failure` outranks the setup card — that
 * precedence IS the fix: a failed mount decision falling through to `setup`
 * is indistinguishable from "no pending exam", and the setup card's only
 * button destroys a pending exam.
 */
export function realScreen({
  started,
  failure,
}: {
  started: boolean;
  failure: RealFailure | null;
}): RealScreen {
  if (started) return 'exam';
  if (failure !== null) return 'failure';
  return 'setup';
}

/** What the button on the failure card must re-run. */
export type RealRetryAction = 'decide' | 'start';

/**
 * A mount failure retries the DECISION (`examDrafts.get` → `realMountDecision`),
 * never `startReal`: the whole point is that we do not know whether a live exam
 * is out there, and `startReal` would settle it with `force`. The two start
 * failures retry the start, which the student explicitly asked for from a setup
 * card the mount decision had already cleared.
 */
export function retryActionFor(kind: RealFailureKind): RealRetryAction {
  return kind === 'mount' ? 'decide' : 'start';
}

/**
 * The copy a failure CARD needs. `kind` is deliberately not in it: it exists
 * only to pick the container's retry (`retryActionFor`, where one of the two
 * answers is the destructive `startReal`), and the board's own failure below is
 * not a container failure — it must never be routed through that map.
 */
export type RealFailureCopy = Pick<RealFailure, 'title' | 'body' | 'retryLabel'>;

/**
 * The deadline passed AND the flush that had to land first did not (audit of
 * #79, blocking finding).
 *
 * This is the one path with no manual retry behind it: the clock is at 0, so
 * the student cannot go back and press "Encerrar" again. Closing the run and
 * showing the review screen here — which is what the code did — throws away
 * every answer that never reached the server and tells the student their exam
 * was processed. So the exam ENDS (it can never be answered again) but the
 * submission is HELD: this copy says exactly that, and its button re-runs the
 * submission instead of dismissing it.
 *
 * `reason` is the pt-BR line of the underlying failure (offline / expired
 * session / server / claim) when there is one — the student needs to know
 * whether to fix the connection or sign in again.
 */
export function deadlineSubmitFailure(reason: string | null): RealFailureCopy {
  return {
    title: 'O tempo acabou, mas suas respostas ainda não foram enviadas.',
    body:
      (reason === null ? '' : `${reason} `) +
      'A prova encerrou e não pode mais ser respondida, mas suas respostas continuam nesta ' +
      'aba e ainda NÃO chegaram ao servidor — nada foi processado. Não feche esta página: ' +
      'toque em "Enviar de novo". Se sair agora, o que não chegou ao servidor será perdido.',
    retryLabel: 'Enviar de novo',
  };
}

/** The copy of a screen that is WAITING, not asking for anything. */
export type RealNotice = { title: string; body: string };

/**
 * The deadline passed and the submission is IN THE AIR (second audit round of
 * #79).
 *
 * This is the happy path of criterion 4 — the clock reaches 0 with the tab
 * open, the answers are already saved, the flush + `processReal` take a couple
 * of seconds — and it used to render `deadlineSubmitFailure`: a red alarm
 * telling EVERY student that their answers "ainda NÃO chegaram ao servidor",
 * for the whole length of a send that was going perfectly well. The copy was
 * simply false while the request was in flight.
 *
 * So the wait gets its own state, with no `retryLabel` (there is nothing to
 * retry) and no reason line (nothing failed). `deadlineSubmitFailure` is
 * reserved for a real `hold`.
 */
export function deadlineSubmittingNotice(): RealNotice {
  return {
    title: 'O tempo acabou. Encerrando sua prova…',
    body:
      'A prova encerrou e não pode mais ser respondida. Enviando e processando suas ' +
      'respostas — isto leva alguns segundos. Não feche esta página até terminar.',
  };
}

/** What the deadline auto-submit may do, once the flush has answered. */
export type DeadlineSettlement = 'settle' | 'hold';

/**
 * The rule the blocking finding is about: a deadline auto-submit may only
 * settle (`processReal` → close the run → review screen) when the flush LANDED.
 *
 * A failed flush means the answers are still only in this tab: closing the run
 * drops them and the review screen claims a result that does not exist. `hold`
 * keeps them, and the retry is what completes the submission.
 *
 * The premise this leans on lives in `save-scheduler.ts`: `ok: true` means
 * "everything the scheduler was asked to send has landed", because a send that
 * failed in the background re-arms `dirty` and is RESENT by this very flush.
 * Without that, `ok` was only "no send failed while you were watching" and this
 * predicate settled runs whose first save never reached the server (audit #79).
 */
export function deadlineSettlementFor(flushed: { ok: boolean }): DeadlineSettlement {
  return flushed.ok ? 'settle' : 'hold';
}

/** The four things the BOARD can put on screen once the exam is running. */
export type RealBoardScreen = 'playing' | 'submitting' | 'submit-failed' | 'review';

/**
 * What the board renders. `submit-failed` outranks ALL — that precedence is
 * the fix: it may not fall back to `playing` (the deadline passed, the exam
 * cannot be answered any more) and it may not become `review` (which is the
 * screen that says "your exam was processed" over answers that never landed).
 *
 * `expired` closes the gap the retry opened (audit of #79): `finishByDeadline`
 * clears `submitFailed` before flushing, and that flush can hang for the length
 * of a request — so between 00:00 and its answer the board fell back to
 * `playing` and an exam that had ALREADY ended accepted answers again. Past the
 * deadline there is no playing board at all.
 *
 * What that window is NOT is a failure (second audit round of #79). It first
 * answered `submit-failed`, so the whole happy path — every student who reaches
 * 00:00 with everything already saved — got the red "suas respostas ainda NÃO
 * chegaram ao servidor" card while a perfectly healthy send was in the air, and
 * even before the auto-submit effect had run. `submitting` is that wait, honest
 * and actionless; `submit-failed` is only reached once the flush actually held.
 */
export function realBoardScreen({
  reviewing,
  submitFailed,
  expired,
}: {
  reviewing: boolean;
  submitFailed: boolean;
  expired: boolean;
}): RealBoardScreen {
  if (submitFailed) return 'submit-failed';
  if (reviewing) return 'review';
  return expired ? 'submitting' : 'playing';
}

/**
 * What the setup card says after a CONFLICT ended this tab's prova real.
 *
 * Told apart by the conflict's own kind, because the two are NOT the same fact
 * and the old copy asserted the stronger one for both. A `remote` conflict
 * (this tab HAD a token and lost the race) is either an exam submitted
 * elsewhere or one being continued elsewhere — the save cannot tell, so the
 * copy may not promise a result in the history. A `live` conflict (no token:
 * the FIRST save hit a row that already exists) is a prova real still running
 * somewhere else; announcing it as "encerrada e processada" is simply false,
 * and it sends the student to a histórico with nothing new in it.
 *
 * What `live` may NOT assert either (audit of #79) is the OTHER device: the
 * same conflict happens in a single tab whose first save committed and lost its
 * response (`hadToken === false`), so the next save arrives as a "first save"
 * against the student's OWN row. Telling them to continue "no aparelho onde ela
 * está aberta" sends them looking for something that does not exist. The fact
 * that holds in both readings is the row: the run IS on the server and the
 * server settles it at its deadline.
 */
export function realConflictNotice(kind: RunConflictKind): string {
  if (kind === 'live') {
    return (
      'Já existe uma prova real em andamento registrada no servidor, então esta aba não ' +
      'pôde assumi-la. Se ela estiver aberta em outro aparelho, continue por lá; quando o ' +
      'prazo terminar, o servidor encerra a prova e o resultado aparece no seu histórico.'
    );
  }
  return (
    'Esta prova real foi encerrada ou continuada em outro lugar, então esta aba parou de ' +
    'salvar. Se ela já foi encerrada, o resultado está no seu histórico; se ainda está ' +
    'valendo em outro aparelho, continue por lá.'
  );
}
