// What the Simulado Real shows when it could not decide, or could not start
// (BR-05.5, epic #67 slice S2d — audit of #79).
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
