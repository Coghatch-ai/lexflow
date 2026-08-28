# Answering surfaces — where a student answers a question

Map of every place a question is presented and answered, so no agent has to re-explore this.
Captured 2026-08-20 (epic #65). Update it when a surface is added or moved.

## Desktop app (`app/`, deployed by `deploy-app.yml` → https://my.probius.app)

Shared multiple-choice UI: **`app/src/shared/components/QuestionCard.tsx`** — renders the
discipline/board line, question text, option buttons, optional bookmark toggle + notes textarea.
The caller owns the card wrapper, header/timer and the action buttons. Props today:
`options`, `selectedAnswer`, `onSelect`, `locked`, `correctAnswer`, `note`/`onNoteChange`,
`isBookmarked`/`onToggleBookmark`, plus `eliminatedOptions`/`onToggleEliminate` (BR-02 cross-out;
both optional — a screen that passes neither gets the pre-#66 card).

Callers (the four MC test screens). Since #70 (epic #65 D2) **all four** have cross-out (BR-02)
AND "Responder depois" (BR-03):

| Screen              | File                                       | Cross-out dies when                                      | "Responder depois" mechanics                                |
| ------------------- | ------------------------------------------ | -------------------------------------------------------- | ----------------------------------------------------------- |
| Simulado Padrão     | `app/src/pages/testing-standard-board.tsx` | answer recorded; frozen at Conferir (`locked={checked}`) | `moveToEnd`, cursor stays                                   |
| Simulado Real       | `app/src/components/real-exam-board.tsx`   | exam leaves `playing` / reset                            | `findNextUnanswered` (cursor jumps; "Adiada" badge)         |
| Repetição Espaçada  | `app/src/components/spaced-board.tsx`      | answer recorded                                          | `moveToEnd` on the ≤5 review queue; SM-2 untouched          |
| Simulado Adaptativo | `app/src/components/adaptive-board.tsx`    | answer recorded                                          | `deferred` FIFO drained at the tail (`shouldServeDeferred`) |

The three screens outside the Padrão have **no "checked" state** (feedback is a separate screen, and
the real exam never reveals during the run), so they never pass `locked` — BR-02.5 ("after checking,
the green/red highlight takes over") is vacuous there. In the real exam the cross-outs live for the
WHOLE run, since an answer stays editable until the exam ends.

Render/logic splits of the big screens: `real-exam-playing.tsx` + `real-exam-review.tsx`,
`adaptive-screens.tsx` (render) + `app/src/components/adaptive-pool.ts` (pool, cursor, deferred FIFO),
`spaced-screens.tsx`, `testing-completed.tsx`. O Simulado Padrão foi dividido na S2b (#77):
`TestingPage.tsx` só escolhe o modo; `testing-standard-run.tsx` (filtros, sorteio, reidratação),
`testing-standard-board.tsx` (a corrida + persistência), `testing-standard-setup.tsx`,
`testing-standard-question.tsx`, `testing-run-conflict.tsx`, `testing-standard-types.ts`.

A S2c (#78) fez a MESMA divisão nas outras duas telas de estudo: `SpacedRepetition.tsx` e
`AdaptiveSimulation.tsx` viraram só a ENTRADA (`intent: 'new' | 'resume'` — fila do dia/setup, ou
reidratação), e a corrida mudou para `spaced-board.tsx` e `adaptive-board.tsx` (+
`adaptive-board-view.tsx`, só render), com `spaced-types.ts` / `adaptive-types.ts` guardando o
`RunStart` de cada uma. Ambas montam o board com `key` por corrida, como o Padrão.

A S2d (#79) fechou a divisão na prova real: `RealExamSimulation.tsx` virou só a ENTRADA (decisão de
montagem + sorteio + liquidação), `real-exam-board.tsx` é a corrida (com persistência, batimento e
auto-submit), `real-exam-setup.tsx` é o card de configuração (+ o slot de aviso) e
`real-exam-types.ts` guarda `ExamQuestion`/`RealRunStart`/`toExamQuestion`. As respostas da real
deixaram de ser `Map<number, string>` e passaram a ser `AnswerDraft[]` por `questionId` — índice só
existe DERIVADO (`answeredIndexes`), para o `ExamQuestionNav` e o `findNextUnanswered`.

Supporting pure modules (unit-tested with plain vitest, no RTL):

- `shared/domain/exam-queue.ts` — `moveToEnd` (standard + spaced + **mobile** postpone),
  `findNextUnanswered` (real-exam postpone), `canPostponeGuard`, `canPostponeAdaptive`,
  `shouldServeDeferred` (adaptive deferred FIFO), `carryTime`/`totalTimeFor` (#85: the seconds
  already spent on a postponed question, banked so the next one is not billed for them). Never
  records a blank answer.
- `shared/domain/eliminations.ts` — cross-out state (`toggleElimination`, `eliminatedFor`,
  `clearForQuestion`), `eliminationDropsAnswer` (BR-02.2), swipe/latch rules. Session-only: nothing
  here reaches `sessions.record`, the stats or SM-2.

Both moved out of `app/src/shared/lib/` in #85 (M1): the mobile bundle resolves only
`@shared`/`@api`/`@drizzle` (`apps/mobile/vite.config.ts`) and `deploy-mobile.yml` does not even
trigger on `app/**`, so a rule shared by desktop AND mobile cannot live under `app/`. Desktop
imports are `@shared/domain/…`; nothing else about them changed.

**A M2a (#86) repetiu a mudança de casa para a maquinaria de corrida**, pelo mesmo motivo e sem
alterar comportamento nenhum — quem move é o `git mv`, os desktop importam pelos caminhos novos:

- **`shared/run/`** (puro, testado por `vitest.config.ts`) — `exit-rules.ts`, `exit-listeners.ts`,
  `exit-save.ts`, `run-persistence.ts`, `run-claimless.ts`, `save-scheduler.ts`,
  `settle-within.ts` + o `mobile-run.ts` novo. Ou seja: TODAS as regras da BR-05 que os dois
  clientes precisam ler.
- **`shared/react/`** — `use-run-persistence.ts`, o único módulo React de `shared/`. É a exceção
  registrada em `tsconfig.api.json` (`exclude: ["shared/react/**"]`): aquele programa roda
  `lib: ["esnext"]`, sem DOM. As regras que ele embrulha ficam em `shared/run/**`, que **é**
  compilado ali.

O que **não** mudou de casa: `app/src/shared/lib/run-guard.ts` continua em `app/`, porque o guard
global de navegação é desktop-only (o mobile roda imersivo — ver "## Mobile app"). Ele apenas
**re-exporta** `offersSaveAndExit` de `shared/run/exit-rules.ts`, para os dois clientes lerem UMA
regra.

- `app/src/pages/testing-flow-guards.ts` — `primaryLabel`, `primaryDisabled`.
- `app/src/shared/hooks/use-notes-bookmarks.ts` — notes (debounced upsert) + bookmark toggle.
- `app/src/shared/lib/shuffle.ts`, `shared/domain/scoring.ts` (`accuracyPct`).
- `shared/run/exit-rules.ts` — BR-05 leaving-a-running-test rules: `shouldPromptOnExit`,
  the pt-BR `exitPrompt` (`optionCount` 3 + `saveLabel: 'Salvar e sair'` nos modos de estudo desde
  a S2b; `real` fica em 2 + `saveLabel: null` e é o único que avisa), `processableAnswers` (blanks never
  recorded), `answeredStats`, `rowsForAnswers` (joins by question id, survives a partial or
  reordered run) e, desde a #86, `offersSaveAndExit`. Single source of truth for the in-screen
  exit, the navigation guard **and o runner mobile** — os três leem daqui.
- `app/src/shared/lib/run-guard.ts` — the navigation-guard decision, pure: `isRunGuarded`,
  `pickActiveRun` (several screens may be registered at once), `decideNavigation` (same-path click
  and `targetPath === null` = logout). Owns no labels of its own — delegates to `exit-rules.ts`,
  de quem também re-exporta `offersSaveAndExit`. **Continua em `app/` de propósito: é desktop-only**
  (não há guard global no mobile — ver "## Mobile app").

Non-pure companions of the guard (React, but no run state of their own):

- `app/src/shared/run-guard-context.ts` — the click-time registry: `RunGuardContext`,
  `useRunGuard`, `useRegisterRun` (writes into a ref on every render, so it never goes stale and
  never re-renders the test tree). `.ts` not `.tsx` because it exports hooks.
- `app/src/components/RunGuardProvider.tsx` — reads the registry at click time, renders the dialog,
  and on "sair e processar" calls the active screen's OWN `quit` handler (the pending navigation is
  dropped, so the student lands on that mode's result screen). Desde a S2b também oferece
  **"Salvar e sair"** quando a tela registrou um `save?: () => Promise<boolean>`: o provider
  **aguarda** — `true` roda a navegação pendente, `false` (conflito) mantém o diálogo, porque
  navegar antes do flush desmontaria a tela que mostraria o CONFLICT.
- `shared/react/use-run-persistence.ts` — o hook fino que liga scheduler + `examDrafts`
  (`save`/`get`/`discard`) e guarda `draftId`/`token` em refs. É o que #78 e #79 reusam e, desde a
  #86, o runner MOBILE também (por isso ele mora em `shared/react/`, não mais em `app/`); toda
  regra vem de `save-scheduler.ts` + `run-persistence.ts`. Cada cliente lhe passa o seu
  `runPersistenceIO` (`app/src/shared/lib/trpc.ts` / `apps/mobile/src/lib/trpc.ts`).
- `app/src/components/QuitTestDialog.tsx` — the presentational confirmation, shared verbatim by the
  four screens and by the guard. No sidebar-only variant. O mobile tem o SEU próprio
  (`apps/mobile/src/components/QuitTestDialog.tsx`, bottom sheet) — apresentação diferente, mesmas
  strings: ambos leem `exitPrompt()` e `offersSaveAndExit()` de `@shared/run/exit-rules`.

Other option-rendering screens (read-only, NOT answering): `app/src/pages/SavedQuestionsPage.tsx`,
admin forms (`admin-question-form.tsx`). Discursive 2ª fase has its own non-MC UI:
`app/src/components/discursive/DiscursiveQuestionCard.tsx` + `DiscursiveRunner.tsx`.

## Mobile app (`apps/mobile/`, deployed by `deploy-mobile.yml`)

Single immersive runner: **`apps/mobile/src/components/QuestionRunner.tsx`** — used by
`PracticePage.tsx` (Praticar), `DrillPage.tsx` (Treino focado / Drill) and `ReviewPage.tsx`
(Revisão) via `RunnerQuestion`. Desde a #86 as três páginas montam o `RunStartGate`, e é ELE que
monta o runner (BR-05.8 antes de qualquer corrida — ver abaixo). Select → instant reveal (single
step, no Conferir) → Próxima; records the whole session on finish. Has the bookmark button. One
row = `RunnerOption.tsx` (#85).
State container: `apps/mobile/src/state/practice-context.ts`. Result: `ResultPage.tsx`.
`FlashcardsPage.tsx` and `SavedPage.tsx` render options with their own local UI.

**Desde a M1 (#85) o runner mobile tem riscar (BR-02) e "Responder depois" (BR-03)** — a mesma
lógica pura das telas desktop, importada de `@shared/domain/…`. BR-02.1 ("EVERY surface") está
satisfeita produto-afora.

| Surface                 | Cross-out dies when                               | "Responder depois" mechanics                            |
| ----------------------- | ------------------------------------------------- | ------------------------------------------------------- |
| Mobile `QuestionRunner` | answer committed in `next()` (`clearForQuestion`) | `moveToEnd(queue, index)`, cursor stays; `n/total` idem |

**Ciclo de vida do riscado no mobile (decidido na M1):** só se risca **antes** de escolher;
**congela na escolha** (o reveal instantâneo do mobile é o "Conferir" do desktop, logo o ✕ some e
BR-02.5 vale); **morre ao confirmar** em `next()`; **sobrevive ao adiar** (BR-03.3); morre com o
unmount do runner. Nada persistido, nada em `sessions.record`. "Riscada-e-selecionada" é impossível
aqui, então `eliminationDropsAnswer` não é usado no runner.

A fila do runner é `useState(questions)` semeada **uma vez** — `finish()` invalida
`questions.reviewQueue`/`list`, então o prop muda depois de gravar e um effect de sync reordenaria a
corrida no meio. O tempo já gasto numa questão adiada fica guardado em `carryTime` e é cobrado no
`totalTimeFor` da resposta final; `postpone()` reinicia `startRef` à mão porque o effect do
cronômetro depende de `index`, e adiar não move o índice.

**Desde a M2 (#86) o runner mobile também obedece a BR-05.** `RunStartGate.tsx` é a porta de
entrada das três páginas: lê `examDrafts.get({ mode })` com `FRESH_READ` e, havendo linha, oferece
"Continuar (n/N)" ou "Descartar e começar novo" (BR-05.8) ANTES de montar o runner. Retomar
replica o `questionIds` congelado por `questions.byIds` e reimpõe a ordem persistida — nunca
reconsulta `questions.list`/`reviewQueue`. `use-run-exit.ts` liga `@shared/react/use-run-persistence`
(autosave a cada resposta confirmada, flush ANTES de `sessions.record`, nada gravado em CONFLICT)
e o `QuitTestDialog` mobile só pinta o que `exitPrompt()` devolve.

**O mapeamento superfície → modo salvo é `mobileRunMode` (`shared/run/mobile-run.ts`): Praticar e
Treino focado gravam `standard`, Revisão grava `spaced`.** Não existe modo `mobile-*` — é isso que
torna real a retomada entre aparelhos (BR-05.2), e é a razão de Praticar e Treino focado dividirem
um único rascunho (BR-05.8 decide o encontro, nunca uma sobrescrita).

**Onde o mobile difere do desktop, de propósito:**

- **A corrida salva não é anunciada na Home.** No desktop o card do modo mostra "Continuar (n/N)";
  no mobile a oferta aparece só ao entrar no modo (`RunStartGate`). A regra é cumprida, o aviso
  antecipado não existe.
- **O relógio do mobile é uma SOMA, não um cronômetro.** `mobileElapsedSeconds` soma os `timeSpent`
  medidos, porque o runner mobile não tem cronômetro de corrida. `sessions.record` não recebe
  duração de sessão, então esse número não toca estatística nem SM-2: ele só semeia o relógio de
  tela do board desktop. Efeito colateral aceito: uma corrida do desktop retomada no mobile volta
  com `elapsedSeconds` REDUZIDO a essa soma no próximo save do mobile. BR-05.10 continua valendo
  (tempo fora do app nunca é contado); o número pode encolher, nunca inflar.

Módulos móveis da M2 (`apps/mobile/src/components/`), para não re-explorar:

- `RunStartGate.tsx` — a porta BR-05.8 acima; montada por `PracticePage`/`DrillPage`/`ReviewPage`.
- `use-run-exit.ts` — o hook das DUAS portas do diálogo ("Salvar e sair" / "Sair e processar") +
  o contrato flush-antes-de-`record` com `flushed.claim`. Não é puro: a regra mora em
  `@shared/run/exit-rules` e `@shared/run/mobile-run`.
- `RunnerChrome.tsx` — as duas barras da corrida imersiva; o `ArrowLeft` (`:34`) é a ÚNICA porta
  in-app e chama `onExit`.
- `QuitTestDialog.tsx` / `RunOverlays.tsx` — bottom sheets: a confirmação de saída e as cópias de
  CONFLICT/falha (`conflictFor()` / `saveFailureFor()`, as MESMAS do desktop).
- `apps/mobile/src/lib/trpc.ts` — `FRESH_READ`, `exitTrpcClient` e o singleton `runPersistenceIO`
  que o hook compartilhado recebe (gêmeo do `app/src/shared/lib/trpc.ts`).

As três portas de escrita de saída (`pagehide`/`visibilitychange`/unmount, `wireExitFlush`) vêm de
graça no mobile: elas moram dentro do próprio `@shared/react/use-run-persistence`.

## Backend touched by answering

- `sessions.record` — one transaction: session + every answer; moves the SM-2 schedule.
- `questions.list` / `questions.reviewQueue` / `questions.dueCount`; `stats.*` computed on read.
- `bookmarks.toggle` / `bookmarks.list` (`user_bookmarks`), `notes.upsert` / `notes.list`
  (`user_question_notes`), SM-2 state in `user_question_states` (`drizzle/schema.ts`).

## Life of a test run (as of 2026-08-28 — after #68 + #69 + #75 + #77 + #78 + #79 + #86; BR-05 completo, desktop + mobile)

1. **Start** — the student picks a mode on the mode-selection screen; `TestingPage.tsx` holds
   `mode` in React state, the runner component fetches its questions and owns the queue, the
   answers-so-far, the timer and the cursor. Nothing about the run exists outside browser memory
   até o primeiro autosave. No mobile o começo passa antes pelo `RunStartGate` (#86): se já houver
   rascunho daquele modo, a corrida nem monta sem o aluno escolher continuar ou descartar.
2. **Answer / postpone** — all in that component state (BR-03; blanks never recorded).
3. **Leave** — a leave attempt is now INTERCEPTED at its source e oferece "sair e processar"
   (BR-05, epic #67 S1 + S1b) e, em todo modo de ESTUDO — as três telas desktop (S2b/S2c) e as três
   superfícies mobile (#86) —, também "Salvar e sair". Só a prova real fica de fora (BR-05.5).
   Desde a S2a (#75) existe a tabela `exam_drafts` (uma linha por `(user, mode)`,
   `UNIQUE(user_id, mode)`). **Quem grava e retoma hoje:**
   - **Simulado Padrão (S2b, #77) — grava e retoma.** `testing-standard-run.tsx` (setup +
     reidratação) + `testing-standard-board.tsx` (a corrida) usam
     `shared/react/use-run-persistence.ts`: salva a cada resposta confirmada com
     debounce trailing de 1500 ms, dá flush no "Salvar e sair"/"Sair e processar"/última questão,
     e o card do modo mostra "Continuar (n/N)" a partir de `examDrafts.list`.
   - **Revisão Espaçada e Simulado Adaptativo (S2c, #78) — gravam e retomam.** Mesmo hook,
     agora parametrizado por modo (`useRunPersistence(mode, snapshot, io)` — o 3º argumento
     entrou na #86: cada cliente injeta o seu `runPersistenceIO`): `spaced-board.tsx` e
     `adaptive-board.tsx` salvam a cada resposta confirmada, dão flush nas mesmas três portas e
     ganharam "Salvar e sair" + card "Continuar (n/N)". A espaçada reidrata por
     `questions.byIds` sobre o `questionIds` persistido e **nunca** reconsulta
     `questions.reviewQueue` (a fila muda com o SM-2 e com o dia). O adaptativo repõe a escada
     (`AdaptiveState` verbatim) e a FIFO de adiadas (`deferredIds`), e re-sorteia só o pool
     candidato.
   - **Prova real (S2d, #79) — grava, mas NUNCA retoma.** Mesmo hook, mesma cadência; o que ela
     persiste é para ser AUTO-SUBMETIDA, não para ser oferecida de volta. O diálogo dela continua
     com 2 botões e o board **não registra handler de `save`** (BR-05.5). Detalhe abaixo, em
     "Como a prova real persiste".
   - **Runner mobile (M2, #86) — grava e retoma, nas MESMAS linhas.** `RunStartGate` +
     `use-run-exit` sobre o mesmo `useRunPersistence`: Praticar e Treino focado escrevem o rascunho
     `standard`, Revisão o `spaced` (`mobileRunMode`, `shared/run/mobile-run.ts`). Não há linha nem
     modo exclusivo do mobile — é isso que faz a BR-05.2 valer nos dois sentidos: o que o Padrão
     desktop salvou volta no celular e vice-versa. O que falta ali é só o AVISO antecipado (a Home
     mobile não tem card "Continuar (n/N)"); a oferta existe, ao entrar no modo.

   Não há `localStorage`/`sessionStorage` em lugar nenhum do repo: na prova real, "processar"
   continua significando "gravar o que foi respondido AGORA via `sessions.record`" (ou
   `settleRealRun`, que é o mesmo caminho), nunca "retomar depois".
   Nothing is asked when nothing was answered (`shouldPromptOnExit`): there is nothing to process
   and `sessions.record` requires `answers.min(1)`.

   Covered exits:
   - **In-screen exit, all 4 screens** (#68): each of `testing-standard-board.tsx`,
     `real-exam-board.tsx`, `spaced-board.tsx` e `adaptive-board.tsx` (as três últimas desde a
     S2c/S2d, #78/#79) renders its own `QuitTestDialog` and owns the `quit` handler that calls
     `sessions.record` over the answers so far.
   - **Global navigation guard** (#69): `RunGuardProvider` sits inside `<Router>` and above
     `<Layout>`. Each running screen registers itself via `useRegisterRun`; `Layout.tsx` routes the
     **sidebar nav** (`:114`), the **admin nav** (`:144`) and **Sair / sign-out** (`:182`) through
     `requestLeave` instead of navigating directly. On "sair e processar" the provider calls the
     ACTIVE screen's own `quit` and DROPS the pending navigation, so the student stays on that
     mode's result screen (the receipt that the answers counted).
   - **Tab close / reload** — `use-leave-warning.ts` still fires the native `beforeunload` prompt.
     It is browser-owned, cannot process anything, and does NOT cover SPA navigation.
   - **Saída do runner mobile** (#86): sem guard global e sem precisar de um — a corrida roda
     imersiva, então a única porta in-app é o `ArrowLeft` do `RunnerChrome.tsx`, que abre o
     `QuitTestDialog` mobile com as duas saídas da BR-05.

   **Residual gaps — o que sobrou depois que a persistência (epic #67 S2) e a #86 fecharam o
   resto. O primeiro é mitigado, não fechado; o segundo FECHOU; o terceiro tem issue própria:**
   - **Browser Back** is NOT guarded. `popstate` is not cancelable, so a Back press cannot be
     intercepted the way a click can; wouter 3.10 also has no `useBlocker` and a new dependency is
     out (CLAUDE.md). Persistence, not a guard, is the real net for this — e ela existe hoje nos
     **três modos de estudo do desktop** (S2b/S2c) e nas **três superfícies do mobile** (#86): o
     Back perde a tela, não a corrida (o último autosave está no servidor, e o card do modo — no
     mobile, o `RunStartGate` — oferece "Continuar"). Desde a revisão adversarial Codex do #79 o
     **unmount da tela também dispara a escrita de saída** (`wireExitFlush`,
     `shared/run/exit-listeners.ts`):
     o Back continua sem ser bloqueável, mas a escrita devida sai pelo mesmo `keepalive` que o
     fechamento de aba já tinha — mesmo best-effort, uma porta a mais, nunca uma garantia maior.
   - ~~**Mobile `QuestionRunner`**~~ — **fechado pela M2/#86.** As três superfícies móveis
     (Praticar, Treino focado, Revisão) montam `RunStartGate` e ganharam diálogo de saída, autosave
     e retomada; detalhe em "## Mobile app" acima. Não existe guard global no mobile e não é uma
     lacuna: a corrida roda IMERSIVA (`MobileLayout.tsx:33-39` esconde header e tab bar), então a
     única porta in-app é o `ArrowLeft` do `RunnerChrome.tsx:34`, e ela abre o diálogo.
   - Known rough edge of the guarded **sign-out**: the run is processed correctly, but the student
     is not actually signed out and must click "Sair" again — the provider drops the pending `next`
     (which holds the `signOut()`) by design. Tracked in #73.

4. **Finish** — the runner calls `sessions.record` ONCE with the full answer list. That single
   transaction inserts `study_sessions` (`totalQuestions`, `correctAnswers`, `endedAt = now()`),
   inserts one `user_answers` row per answer, and moves the SM-2 schedule
   (`upsertSm2States`). Input requires **at least one answer** (`answers.min(1)`).
5. **Read back** — `sessions.listRecent`; all statistics are computed on read from `user_answers`,
   so anything not recorded in step 4 simply never happened.

### Persistência de corrida (S2a backend + S2b Simulado Padrão)

- `exam_drafts` — linha existe ⇔ corrida em andamento; apagada = processada ou descartada. Sem
  coluna de status e sem coluna de revisão.
- `last_saved_at` **é** o token de concorrência otimista. `save` com token velho ⇒ `CONFLICT`;
  `save` com `token: null` sobre uma corrida viva **também** ⇒ `CONFLICT` (BR-05.8 mora no
  servidor, não na UI). Substituir uma corrida é ato deliberado: `discard` nos modos de estudo,
  `startReal` na real.
- `examDrafts.list` **nunca** devolve `mode: 'real'`, por mais fresca que a linha esteja
  (BR-05.5). A prova real só termina por liquidação: `settleRealRun` — preguiçosa, sem scheduler,
  disparada por `users.me`, `examDrafts.list`, `examDrafts.startReal` e pelo `processReal` do
  próprio cliente ao zerar o cronômetro.
- `recordSession` (`api/lib/record-session.ts`) é o corpo único de gravação; `sessions.record` e
  `settleRealRun` são as **duas entradas**. O `DELETE` do rascunho é a primeira instrução da
  transação e funciona como mutex: quem chega depois apaga 0 linhas e desiste sem escrever nada.
- Esse `DELETE` também **carrega o token** (`DraftClaim`): quem processa um rascunho manda
  `{ id, lastSavedAt }` — o `last_saved_at` que aquela aba observou —, nunca o id sozinho. O id
  de-duplica, o token detecta obsolescência: sem ele, a aba A que terminou a corrida apagaria a
  linha que a aba B (o **mesmo** aluno em outro aparelho) acabou de salvar e gravaria as respostas
  velhas de A. Com ele, a reivindicação de A casa 0 linhas ⇒ `CONFLICT`, com o rascunho e as
  respostas de B intactos. Quando as telas S2b/S2c/S2d chamarem `sessions.record` para uma corrida
  persistida, elas **precisam** mandar o token do último `save`/`touch`/`get`. A única exceção é
  `examDrafts.startReal` (variante `{ id, force: true }`): pedir uma nova prova real liquida a
  pendente por mais fresca que esteja (BR-05.5). **A S2b já cumpre isso no Padrão**: os dois
  caminhos de gravação (`handleNext` na última questão e `handleQuitAndProcess`) dão `flush()`
  ANTES e mandam `claimFor(draftId, token)`; sem o par, o rascunho sobreviveria à própria sessão
  e voltaria como "Continuar" de uma corrida já processada. **A S2d cumpre no lado mais
  perigoso**: a prova real tem DUAS portas de auto-submit (o cronômetro na aba aberta e a
  liquidação preguiçosa), então nenhum caminho dela grava sem `draftId` — é exatamente isso que
  transforma o `DELETE` mutex em "1 corrida = 1 sessão" em vez de duas.
- **A LINHA REIVINDICADA decide o arquivamento, nunca o payload do cliente.**
  `filingForClaimedMode` (`shared/domain/exam-draft.ts`): se o rascunho apagado era `mode: 'real'`,
  a sessão vira sempre `"Prova Real"`/`hard`, venha por `sessions.record` (a submissão do próprio
  aluno) ou por `settleRealRun` (a liquidação preguiçosa). Uma corrida = um arquivamento, por
  qualquer porta que ela saia. Simetricamente, `settleRealRun` **recusa rascunho não-`real`**: a
  liquidação existe só para a prova real, e os modos de estudo terminam por `discard` ou por uma
  gravação normal.
- **Assimetria de dois campos string da MESMA linha — não uniformizar:**
  - `deadline_at` é **COMPARADO** (`isRealRunAbandoned` lê pelo `timestampMs` estrito, **nunca**
    por `Date.parse`), nunca ecoado como token. É normalizável e o validador aceita de propósito
    os dois formatos (o ISO do browser e o texto cru do PG). Só o instante importa.
  - `last_saved_at` / `token` é **casado com `=` dentro do SQL** e viaja **VERBATIM**
    (`"2026-08-21 14:30:04.210932+00"`: µs, sem `T`, sem `Z` — drizzle usa parser identidade em
    `mode: "string"`). Passá-lo por `new Date(...)`, `toISOString()`, `Date.parse` ou por
    `superjson` de `Date` come os microssegundos e **mata a guarda otimista para sempre**: toda
    reivindicação casa 0 linhas e o aluno leva `CONFLICT` no próprio salvamento. Por isso ele mora
    num `useRef` (`use-run-persistence.ts`), nunca em state, e `run-persistence.test.ts` trava o
    valor cru como asserção. Se alguém for endurecer o parsing, é `deadlineAt` e **só**
    `deadlineAt` (#79) — nunca o token.

### O que a S2c (#78) acrescentou ao desenho

- **O hook virou paramétrico:** `useRunPersistence(mode, snapshot)` — o `"standard"` literal saiu
  das três chamadas (`get`, payload, `discard`) e o payload passa a vir do `snapshot(token)` da
  própria tela (`standardDraftPayload` / `spacedDraftPayload` / `adaptiveDraftPayload`).
- **O cursor do `reconcileRun` é POSICIONAL** (`shared/domain/exam-draft.ts`), nunca `indexOf`: o
  adaptativo serve a MESMA questão duas vezes de propósito (`park` a deixa em `questions` e
  `serveDeferred` a reanexa), e a primeira ocorrência jogaria o aluno para trás, sobre uma questão
  já respondida.
- **`draftTotalOf`** (mesmo módulo) é o "N" do card: no adaptativo é `modeState.totalQuestions`
  (a meta), porque `questionIds` ali é o que já foi SERVIDO — `examDrafts.list` ofereceria
  "Continuar (3/4)" numa prova de 10.
- **`questions.byIds` devolve o estado SM-2 do próprio aluno** (`interval`, `repetitions`,
  `nextReviewAt`, `lastCorrect`) por LEFT JOIN com o predicado do usuário **no ON**. No WHERE a
  junção vira INNER e some toda questão que o aluno nunca viu — quebraria "Questões Salvas" e a
  retomada do Padrão. `pnpm smoke` (q) trava as três metades: colunas próprias, nulos para a não
  vista e contagem de linhas intacta.
- **`RunSaveFailureKind` ganhou `'busy'`** ("Ainda estamos salvando este teste.") — a saída pedida
  durante um flush respondia `false` em silêncio e o aluno clicava no vazio. Nenhum código de erro
  mapeia para ela: é recusa local, não resposta do servidor.
- **~~O que NÃO entrou~~ — pago na S2d (#79):** `examDrafts.touch` ganhou seu primeiro chamador de
  app (o batimento de 60 s), e com ele a dívida registrada aqui: `keepAliveVia`
  (`use-run-persistence.ts`) escreve `refs.token.current = beaten.lastSavedAt`. Sem isso o próximo
  `save`/claim casa 0 linhas e o aluno leva um CONFLICT causado pelo próprio batimento.

### Como o Padrão persiste (S2b, #77 — o desenho que #78/#79 reusam)

- `shared/run/save-scheduler.ts` (puro) — debounce **trailing** de 1500 ms; `flush()`
  aguarda o envio EM VOO e, se o payload mudou durante ele, dispara **mais um** e resolve com o
  token FINAL. Sem isso o `save` em voo move `last_saved_at`, a reivindicação casa 0 linhas e o
  aluno recebe `CONFLICT` causado pelo próprio salvamento.
- `shared/run/run-persistence.ts` (puro) — payload do save (o Padrão **não** manda
  `deadlineAt`), reidratação (`questions.byIds` volta em ordem do banco e é **reordenado** pelo
  array persistido; `questions.list` nunca é refeito porque ordena por `random()`), o par do claim
  e as **duas** cópias pt-BR de CONFLICT: token velho ⇒ "continuado em outro aparelho"
  (Recarregar / Descartar esta cópia); `token: null` sobre corrida viva ⇒ "já existe um teste em
  andamento" (Continuar o salvo / Descartar o salvo).
- O **flush mora no handler da tela** (`handleSaveAndExit` / `handleQuitAndProcess`), nunca no
  `QuitTestDialog` nem no `RunGuardProvider` — os dois são apresentação e não podem esperar
  promessa. Enquanto ele roda, `busy` desabilita os 3 botões.
- `pagehide`/`visibilitychange` **e o unmount da tela** mandam a escrita devida por `keepalive`
  (revisão adversarial Codex do #79; as três portas moram em `shared/run/exit-listeners.ts` —
  o unmount é a saída in-SPA, que não dispara evento nenhum do DOM):
  `scheduler.flushOnExit()` despacha `exitSend` — um `fetch` com `keepalive: true`
  (`exitTrpcClient` em `shared/lib/trpc.ts`), o único transporte que leva `Authorization` E é
  concluído pelo navegador depois que o documento morre (`sendBeacon` não manda header nenhum). O
  `flush()` de antes **aguardava rede**: request normal é cancelado junto com o documento e, com
  um save em voo, o `await` nunca retomava — a escrita devida não saía. O que **continua sem
  garantia**, e está escrito onde é assumido (`use-run-persistence.ts`): save já em voo (a escrita
  de saída entra na fila atrás dele para não brigar pelo token — janela de perda = respostas dos
  últimos ~1,5 s), `getToken()` precisando renovar na hora, kill do processo, e payload acima do
  teto de 64 KiB do `keepalive` (`shared/run/exit-save.ts` cai para o cliente normal). Em todos
  eles a corrida continua no servidor no último save que pousou, e o `settleRealRun` a liquida.
- **Não salvam nada** (por contrato, BR-02.3 / D8): adiar, descartar alternativa, `Conferir`,
  bookmark e nota. Logo `checked` conta como respondida no diálogo mas **não** é persistida — o
  "(n/N)" do card pode mostrar 1 a menos. É desenho, não bug.
- **Falha NÃO-CONFLICT numa saída aparece na tela** (`saveFailureFor` + `RunFailureDialog`, via
  `persistence.failure`): offline, sessão expirada (`UNAUTHORIZED`/`FORBIDDEN`) e recusa do
  servidor têm cópias pt-BR diferentes, porque a ação do aluno é diferente em cada uma. O autosave
  de fundo continua **mudo** de propósito — quem retenta ali é o próximo debounce. Silêncio só
  existe onde há retry automático.
- **A retentativa depois de uma falha é idempotente por construção**, não por botão desabilitado:
  a saída que falha devolve a corrida para a tela com a resposta JÁ em `answers`, então toda
  montagem de payload passa por `appendAnswer` e toda gravação por `dedupeAnswers`
  (`run-persistence.ts`) — uma entrada por `questionId`, a última vale. Sem isso o segundo clique
  em "Finalizar" grava 2 linhas em `user_answers` para a mesma questão, `totalQuestions: 11` numa
  corrida de 10 e SM-2 aplicado duas vezes.
- **Corrida persistida nunca grava sem claim** (aceite 5): o id da linha é aprendido por um
  `examDrafts.get` depois do 1º `save`; se aquele read falhar, o flush **tenta de novo** e, se
  ainda faltar, `claimOutcomeFor` devolve `ok: false` com mensagem — em vez de gravar sem `draft`
  e deixar o rascunho vivo por cima da própria sessão.
- **Todo `examDrafts.get` é lido com `FRESH_READ` (`staleTime: 0`, `shared/lib/trpc.ts`)** e todo
  `discard`/`record` invalida o **router inteiro** (`utils.examDrafts.invalidate()`), nunca só
  `list`. `utils.…get.fetch()` é `fetchQuery`: sob o `staleTime` padrão de 5 min ele responde do
  **cache** e não chega ao servidor — a "tentativa de novo" do flush devolveria o `null` de antes
  da linha existir (corrida impossível de processar por 5 min) e um "Recarregar do servidor"
  reidrataria a mesma cópia que causou o conflito, em laço.
- **O id só é adotado da linha que ainda carrega o token deste save** (`adoptableDraftId`): id de
  qualquer outra linha + nosso token ⇒ o DELETE reivindicador casa 0 linhas ⇒ CONFLICT `remote`
  ("continuado em outro aparelho") numa corrida que ninguém tocou. Recusar custa uma retentativa;
  adotar errado custa as respostas do aluno.
- **Nenhum diálogo da corrida nasce coberto.** `RunConflictDialog`/`RunFailureDialog` são `z-[60]`
  contra o `z-50` do `QuitTestDialog`, porque o `RunGuardProvider` pinta a cópia dele **depois** de
  `{children}` (em z-index igual, quem vem depois no DOM ganha); e o guard **fecha** o próprio
  diálogo quando o `save()` da tela devolve `false` (`guardSaveOutcome`), para a mensagem de erro
  não ficar atrás do backdrop dele. Sair pela barra lateral e sair pela tela mostram a mesma falha.

### Como a prova real persiste (S2d, #79) — para AUTO-SUBMETER, nunca para retomar

1. **O que a linha guarda.** Colunas universais (`question_ids` na ordem sorteada congelada,
   `cursor`, `answers` como `AnswerDraft[]` por `questionId` com `timeSpent: 0`) + `deadline_at` +
   `last_saved_at`. `elapsed_seconds` grava **0** e `mode_state` fica **vazio** (`{ mode: 'real' }`):
   a única coisa por-modo da real é o prazo, e o prazo tem COLUNA própria — quem o lê é
   `isRealRunAbandoned`, do lado do servidor, não jsonb. Persistir o decorrido além do prazo só
   criaria dois números para discordar. `flagged`/`postponed`/cross-out continuam rascunho
   (BR-02.3 / D8) — e na real são duplamente irrelevantes: a liquidação só lê `answers`.
   O payload é `realDraftPayload` (`run-persistence.ts`), e ele **deduplica por `questionId`**:
   ao contrário do Padrão, a real grava a resposta na hora e o aluno pode trocá-la por 5 h.
2. **Cronômetro derivado, nunca contado.** `realSecondsLeft({ deadlineAt, now })`
   (`shared/domain/exam-draft.ts`, puro) — recarregar a aba **não** devolve tempo e o relógio não
   pausa (D8). O `now` anda de 1 em 1 s (`useTickingNow`); o prazo é sempre o do servidor.
   `realSecondsLeft` é de propósito **mais estrito que `Date.parse`**: `"2026"` e um
   `Date.toString()` respondem `null` (são justamente os dois valores que o PG recusa, 22007/22023),
   porque um cronômetro pintado a partir de um chute é pior que nenhum.
3. **Decisão de montagem — `realMountDecision`, e nunca uma oferta.** `null` ⇒ setup; viva
   (não abandonada **e** com tempo) ⇒ **reidrata direto**, sem diálogo (é a aba DONA voltando de um
   reload — critério 5; por isso `examDrafts.get({ mode: 'real' })` continua aceito enquanto `list`
   nunca devolve `real` e `discard` recusa `real`); abandonada ⇒ `processReal()` + aviso pt-BR
   **só se aquele `processReal` devolveu `settled: true`** (se `users.me` já liquidou no boot, é
   setup mudo, e está certo: a prova simplesmente acabou); prazo nulo/ilegível ⇒ setup (o
   `startReal` do próximo início liquida a órfã com `force`).
4. **Batimento de 60 s = `examDrafts.touch`** (uma coluna, sem reescrever ~25 KB de jsonb). Ele passa
   pelo `save-scheduler`, não por um `setInterval` solto, porque `touch` e `save` disputam o MESMO
   token: (a) `beat()` é **pulado** quando há save agendado ou em voo — um `save` já refresca
   `last_saved_at`, ou seja, já É um batimento; (b) os envios são **serializados** (`dispatch`
   encadeia no `inFlight` corrente), então um `schedule()` que caia durante um beat envia depois
   dele e lê o token já atualizado. Sem os dois, o sintoma é um CONFLICT falso ~1×/hora de prova —
   e ele **para o autosave** (`raiseIfConflict` fecha o scheduler): dali em diante a prova só existe
   na aba. Limiar do servidor: `REAL_RUN_STALE_SECONDS = 180` (3 batimentos perdidos).
   **`dirty` NÃO é motivo para pular** (2ª auditoria do #79): com o re-arme na falha, `dirty` sem
   nada agendado/em voo significa "o último envio FALHOU", então o beat **reenvia** em vez de calar.
   E toda escrita tem **teto** (revisão adversarial Codex): `fetch` não expira sozinho, e uma
   escrita pendurada segurava o `inFlight` para sempre — o beat pulava todo minuto,
   `last_saved_at` passava dos 180 s e o próximo contato autenticado liquidava a prova **debaixo**
   do aluno. Silêncio vira falha, o slot libera, o próximo beat reenvia.
   **Onde o teto mora importa** (3ª revisão adversarial): `SAVE_TIMEOUT_MS = 15 s` mora DENTRO do
   `saveRun` (`run-claimless.ts`), com `PROBE_TIMEOUT_MS = 5 s` para a sondagem, e
   `WRITE_TIMEOUT_MS = 30 s` no `save-scheduler` é só **rede de segurança** para quem não tem
   recuperação própria (`keepAlive`, `exitSend`) — 15+5 < 30 por construção, com teste que fixa a
   ordem. Um teto aplicado de FORA só sabia relatar a falha: a requisição abandonada podia **ter
   commitado**, o `token` continuava `null`, e o retry saía como outro `token: null` que o router
   recusa com `OVERWRITE_CONFLICT` — conflito do aluno contra a própria escrita, e TERMINAL
   (`raiseIfConflict` fecha o scheduler). Dentro do `saveRun` o estouro é só mais uma resposta
   perdida: a sondagem compara a linha com **o mesmo payload** que estourou — único instante em
   que o eco prova a posse, porque um beat depois o payload já mudou — e adota. Por isso também o
   `OVERWRITE_CONFLICT` de um save SEM token deixou de ser terminal por suposição e passou a ser
   terminal por **prova**: com `token: null` o CONFLICT só diz "existe linha em (user, mode)",
   nunca de quem; sem eco, o CONFLICT original segue de pé com o diálogo do BR-05.8.
   **A posse atravessa tentativas por NONCE** (5ª revisão adversarial, Codex): comparar só com o
   payload da tentativa ATUAL fecha a janela apenas enquanto o payload não anda. Cadeia que
   sobrava: o 1º save estoura o teto → a sondagem não lê linha nenhuma (o insert ainda não
   commitou) → a escrita **commita tarde** → o aluno responde mais uma questão → o retry encontra a
   própria linha, o conteúdo do RETRY não bate, a linha é julgada estrangeira e o
   `OVERWRITE_CONFLICT` fecha a prova. A 4ª revisão respondeu com uma MEMÓRIA de ecos
   (`MAX_PENDING_ECHOES = 4`), e o teto dela era ele próprio um travamento: com as 4 primeiras
   tentativas mortas e a 5ª sendo a que commitou tarde, o eco da 5ª era **descartado** e o aluno
   ficava trancado fora da prova pela própria escrita. Agora a posse é um **nonce por corrida**
   (`createRunNonce` / `stampRunNonce` / `runNonceAdoption`, `run-claimless.ts`): uma string opaca
   sorteada uma vez pela aba, carimbada em TODO save dela (inclusive o `exitSend` de `keepalive`) e
   carregada **dentro do jsonb `mode_state`** — sem coluna e sem migração (o zod do router aceita
   `runNonce`, senão seria removido na entrada). Linha com o nosso nonce foi escrita por nós, ponto:
   sem fila, sem teto, e não decai com o número de tentativas. Continua fail-closed — linha sem
   nonce (escrita antes disto existir) ou com nonce de outra corrida não é adotada, e o
   `OVERWRITE_CONFLICT` original segue de pé com o diálogo do BR-05.8. O nonce **gira** em
   `forgetIdentity` (`close`, `discardSaved`), senão a próxima corrida adotaria a linha da
   anterior; um `adopt` (resume) não gira, é a mesma corrida. Adotar por nonce prova de QUEM é a
   linha, não que ela está fresca: a escrita atual continua **devendo** (`SavedRun.owed`), o
   `sendVia` re-arma, e o `flush` drena `dirty` em laço — escrever uma vez só devolvia `ok: true`
   com a última resposta ainda só na aba, que é exatamente o contrato de que a porta do prazo
   depende antes do `processReal`.
5. **Duas portas de auto-submit, uma sessão.** Aba aberta no zero: `flush()` → `processReal()` →
   tela de revisão montada da MEMÓRIA (critério 4). Aba fechada: nada na hora (não há scheduler) —
   liquida no próximo contato autenticado. Os dois podem disparar; o `DELETE` do rascunho é a
   primeira instrução da transação e é o mutex, então o segundo apaga 0 linhas e não escreve nada.
   `settled: false` é "outro liquidou", não erro — o servidor RESPONDEU, então há resultado.
   O `processReal` do cliente é **acelerador** dos DADOS, não do que a tela pode afirmar (revisão
   adversarial Codex do #79): se ele estourar o teto (`DEADLINE_SUBMIT_TIMEOUT_MS`) ou falhar, o
   desfecho é **desconhecido**, e desconhecido não vira tela de revisão — ela diz "sua prova foi
   processada" e o único botão dela começa OUTRA prova real. Nesse caso o board mostra
   `unconfirmed` (`deadlineCompletionFor` + `deadlineUnconfirmedNotice`): as respostas JÁ chegaram
   ao servidor (o `flush` pousou — é pré-requisito), o encerramento é que não foi confirmado, o
   botão reexecuta a submissão e sair é seguro porque o servidor liquida no prazo. Antes disso:
   `flush` que não pousa ⇒ `submit-failed` (aí sim "não chegaram ao servidor"), e enquanto os dois
   estão no ar ⇒ `submitting`, cartão sem botão e por isso **limitado** pelos dois `settleWithin`.
   **`submit-failed` não tem porta de saída** (5ª revisão adversarial, Codex): copy e saída são
   decididas juntas por `deadlineCardFor` (`real-exam-failures.ts`) — `submit-failed` ⇒
   `exit: 'none'`, `unconfirmed` ⇒ `exit: 'modes'`. Aquela tela existe porque o código DETECTOU que
   as respostas não chegaram ao servidor e elas só existem na memória desta aba; um "Voltar aos
   modos" ali desmontava o board e jogava fora a única cópia, em silêncio, logo abaixo da copy que
   diz que sair perde tudo. A saída é o retry (que reexecuta a submissão e leva a `review` ou a
   `unconfirmed`, ambos com porta). O `unconfirmed` mantém a dele porque ali o `flush` POUSOU.
6. **CONFLICT aqui NUNCA abre o diálogo de conflito.** "Recarregar do servidor" e "Descartar esta
   cópia" são escolhas sobre uma corrida que se retoma; esta não se retoma, e "descartar" é o que a
   BR-05.5 proíbe. CONFLICT (do `save`, do `touch` ou do `record`) = a prova já terminou em outro
   lugar ⇒ **fim terminal**: aviso pt-BR + volta ao setup. Por isso o board monta
   `RunFailureDialog` direto, e não o `RunOverlays` inteiro.
7. **"Salvar e sair" não existe, e não pode voltar.** Trava tripla: `exitPrompt('real')` devolve
   `saveLabel: null` + `optionCount: 2`; o board **não registra handler de `save`** em
   `useRegisterRun`; e a regra virou função pura `offersSaveAndExit` — desde a #86 em
   `shared/run/exit-rules.ts` (o `run-guard.ts` a RE-EXPORTA, para o mobile ler a mesma regra),
   usada TANTO pelo `QuitTestDialog` (desktop e mobile) quanto pelo `RunGuardProvider` — travada
   em `run-guard.test.ts`.
8. **Mudança de contrato registrada:** `examDrafts.save` agora normaliza `deadlineAt`
   (`.transform((v) => new Date(v).toISOString())` **depois** do `refine`). Isso troca 500 por
   BAD_REQUEST nos valores que o `Date.parse` aceita e o PG recusa, ao custo de **truncar µs → ms**
   no `deadline_at`. Irrelevante para 5 h, mas é contrato. **NUNCA no `token`/`lastSavedAt`**, que
   viaja verbatim e é casado com `=`. `pnpm smoke` (p) segue verde porque o valor entra por `save`
   (ISO, ms) e a ida-e-volta é idempotente em ms; se algum dia a fixture entrar por `db.insert` com
   µs, a asserção certa passa a ser comparar INSTANTE (`Date.parse`), não texto.
   Cobertura nova em `pnpm smoke`: **(t)** o batimento roda o token (o velho ⇒ CONFLICT, o novo ⇒
   aceito) e **(u)** o `processReal` do cliente ⇒ 1 sessão "Prova Real"/hard, linha apagada, segunda
   chamada `settled: false`.

## Functional definitions attached to these surfaces

- [BR-02 Descartar alternativas](kb-business/br-02-cross-out.md)
- [BR-03 Responder depois = postpone, not bookmark](kb-business/br-03-postpone.md)
- [BR-04 Bookmarks](kb-business/br-04-bookmarks.md)
- [BR-05 Salvar progresso / Sair e processar](kb-business/br-05-save-quit-test.md)
