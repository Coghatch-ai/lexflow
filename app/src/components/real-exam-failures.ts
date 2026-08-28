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

import type { RunConflictKind } from '@shared/run/run-persistence';
import { UNSETTLED, type Settled } from '@shared/run/settle-within';

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

/**
 * How long the deadline submission may stay in the air before the student gets
 * a button back (third audit round of #79).
 *
 * The flush is at worst three sequential round trips (save → read the id back →
 * probe), so 20 s is well past any healthy send on a bad-but-working mobile
 * link, while still being a wait a person will sit through. Tripping it early
 * costs exactly one extra flush — the retry is idempotent by construction (the
 * draft DELETE is the mutex, `saveRun` adopts the row it can prove it wrote) —
 * whereas not tripping it at all costs the student the whole prova.
 */
export const DEADLINE_SUBMIT_TIMEOUT_MS = 20_000;

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
 *
 * `UNSETTLED` — the flush never answered within `DEADLINE_SUBMIT_TIMEOUT_MS` —
 * is a `hold` for the same reason a failed one is, and it is what BOUNDS the
 * `submitting` card (third audit round of #79). Without it the whole screen
 * hung on a promise that may never settle: the student sat on a calm spinner
 * with no button, forever, and never reached this retry. Silence is read
 * fail-CLOSED here exactly as `claimlessVerdictFor` reads it — "we did not find
 * out" is never "it landed"; the cost of being wrong is one extra flush, and
 * the cost of the optimistic reading is the exam.
 */
export function deadlineSettlementFor(flushed: Settled<{ ok: boolean }>): DeadlineSettlement {
  if (flushed === UNSETTLED) return 'hold';
  return flushed.ok ? 'settle' : 'hold';
}

/**
 * What `processReal` answered at the deadline — and, as its third member, that
 * it did NOT (Codex adversarial review of #79).
 *
 * `PROCESS_REJECTED` is the call having thrown; `UNSETTLED` is it never having
 * answered inside `DEADLINE_SUBMIT_TIMEOUT_MS`. They are ONE state — unknown —
 * and the point of naming it is that it is not "settled".
 */
export const PROCESS_REJECTED = 'process-rejected';

/** What the board may show once the deadline flush landed and `processReal` answered — or did not. */
export type DeadlineCompletion = 'review' | 'unconfirmed';

/**
 * A run may only be SHOWN as finished when its settlement was confirmed.
 *
 * The flush landed, so the answers are on the server and `settleRealRun`
 * settles that row on the student's next authenticated contact — the DATA is
 * safe either way. What is unknown is whether it is settled now, and the review
 * screen is a claim about exactly that: it says "here is your finished exam"
 * and its only button starts ANOTHER prova real. Rendering it over an unknown
 * outcome asserts a result nobody has — the earlier reading ("a timeout is the
 * same as the existing `catch`, the server settles later") was right about the
 * data and wrong about the screen.
 *
 * `settled: false` is NOT unknown: the server answered, and it means another
 * settlement got there first — a finished exam either way.
 */
export function deadlineCompletionFor(
  processed: Settled<{ settled: boolean }> | typeof PROCESS_REJECTED,
): DeadlineCompletion {
  if (processed === UNSETTLED || processed === PROCESS_REJECTED) return 'unconfirmed';
  return 'review';
}

/**
 * The deadline flush LANDED but the settlement could not be confirmed (Codex
 * adversarial review of #79).
 *
 * Deliberately not `deadlineSubmitFailure`: that copy says the answers never
 * reached the server, which here is false and would push the student to retry a
 * send that already succeeded. Deliberately not the review screen either —
 * nobody knows the exam is settled. So it states the two facts apart: the
 * answers are safe, the closing was not confirmed. Leaving is explicitly
 * allowed, because the server finishes this on its own.
 */
export function deadlineUnconfirmedNotice(): RealFailureCopy {
  return {
    title: 'Suas respostas foram enviadas, mas não confirmamos o encerramento.',
    body:
      'A prova encerrou e suas respostas JÁ chegaram ao servidor — elas não serão perdidas. ' +
      'O que não deu para confirmar agora foi o processamento do resultado. Toque em ' +
      '"Confirmar de novo"; se preferir sair, o servidor encerra a prova sozinho e o ' +
      'resultado aparece no seu histórico.',
    retryLabel: 'Confirmar de novo',
  };
}

/** The five things the BOARD can put on screen once the exam is running. */
export type RealBoardScreen =
  | 'playing'
  | 'submitting'
  | 'submit-failed'
  | 'unconfirmed'
  | 'review';

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
 *
 * Actionless is only safe while it is BOUNDED (third audit round of #79). This
 * card has no button, so whatever ends it lives outside this function: the
 * bound is `DEADLINE_SUBMIT_TIMEOUT_MS` applied to the awaited calls themselves
 * (`settleWithin` in `finishByDeadline`), which turns a request that never
 * answers into a `hold` and lands the student on `submit-failed` with its
 * retry. Bound at the call, not by a second timer watching this screen: one
 * timeout, one truth, and the state machine here stays a pure function of what
 * the submission actually said.
 *
 * `unconfirmed` is the fourth precedence and the Codex adversarial finding: the
 * flush landed but `processReal` timed out or threw. It outranks `reviewing`
 * for the same reason `submit-failed` does — an UNKNOWN outcome may not be
 * rendered as a settled one — and it sits below `submit-failed` because "the
 * answers never left" is the graver of the two claims. It cannot fall through
 * to `submitting` either: that card has no button, and there is a decision to
 * offer here.
 */
export function realBoardScreen({
  reviewing,
  submitFailed,
  unconfirmed,
  expired,
}: {
  reviewing: boolean;
  submitFailed: boolean;
  unconfirmed: boolean;
  expired: boolean;
}): RealBoardScreen {
  if (submitFailed) return 'submit-failed';
  if (unconfirmed) return 'unconfirmed';
  if (reviewing) return 'review';
  return expired ? 'submitting' : 'playing';
}

/** The two deadline outcomes that render the failure card. */
export type DeadlineCardScreen = Extract<RealBoardScreen, 'submit-failed' | 'unconfirmed'>;

/** Whether the deadline card offers a door out of the mode, and nothing else. */
export type DeadlineExit = 'modes' | 'none';

/** The card the deadline put on screen: its copy AND whether leaving is offered. */
export interface DeadlineCard {
  failure: RealFailureCopy;
  exit: DeadlineExit;
}

/**
 * The deadline card, COPY AND EXIT DECIDED TOGETHER (Codex round five of #79).
 *
 * They are one decision because they answer one question — is what the student
 * answered on the server? — and splitting them is what produced the finding:
 * both states rendered the same card with `onExit={onExitToModes}`, so the
 * `submit-failed` screen, which exists BECAUSE the code detected the answers
 * never arrived, offered a button that throws them away in silence. The copy
 * said "Se sair agora, o que não chegou ao servidor será perdido." right above
 * a button doing exactly that.
 *
 * So `submit-failed` gets `exit: 'none'`: while the submission is held there is
 * nothing to navigate to that does not lose answers, and the only way forward
 * is the retry (the run stays in memory precisely so it can be re-sent). It is
 * not a trap — the retry is the way out, and a successful one lands on `review`
 * or on `unconfirmed`, both of which do let the student leave.
 *
 * `unconfirmed` keeps its exit, and that difference is the whole point: there
 * the flush LANDED, the answers are on the server, and `settleRealRun` closes
 * the exam on its own — leaving costs nothing, and its copy says so.
 */
export function deadlineCardFor(screen: DeadlineCardScreen, reason: string | null): DeadlineCard {
  if (screen === 'unconfirmed') {
    return { failure: deadlineUnconfirmedNotice(), exit: 'modes' };
  }
  return { failure: deadlineSubmitFailure(reason), exit: 'none' };
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
