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

| Screen              | File                                        | Cross-out dies when                                      | "Responder depois" mechanics                                |
| ------------------- | ------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------- |
| Simulado Padrão     | `app/src/pages/testing-standard-board.tsx`  | answer recorded; frozen at Conferir (`locked={checked}`) | `moveToEnd`, cursor stays                                   |
| Simulado Real       | `app/src/components/RealExamSimulation.tsx` | exam leaves `playing` / reset                            | `findNextUnanswered` (cursor jumps; "Adiada" badge)         |
| Repetição Espaçada  | `app/src/components/SpacedRepetition.tsx`   | answer recorded                                          | `moveToEnd` on the ≤5 review queue; SM-2 untouched          |
| Simulado Adaptativo | `app/src/components/adaptive-screens.tsx`   | answer recorded                                          | `deferred` FIFO drained at the tail (`shouldServeDeferred`) |

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

Supporting pure modules (unit-tested with plain vitest, no RTL):

- `app/src/shared/lib/exam-queue.ts` — `moveToEnd` (standard + spaced postpone),
  `findNextUnanswered` (real-exam postpone), `canPostponeGuard`, `canPostponeAdaptive`,
  `shouldServeDeferred` (adaptive deferred FIFO). Never records a blank answer.
- `app/src/shared/lib/eliminations.ts` — cross-out state (`toggleElimination`, `eliminatedFor`,
  `clearForQuestion`), `eliminationDropsAnswer` (BR-02.2), swipe/latch rules. Session-only: nothing
  here reaches `sessions.record`, the stats or SM-2.
- `app/src/pages/testing-flow-guards.ts` — `primaryLabel`, `primaryDisabled`.
- `app/src/shared/hooks/use-notes-bookmarks.ts` — notes (debounced upsert) + bookmark toggle.
- `app/src/shared/lib/shuffle.ts`, `shared/domain/scoring.ts` (`accuracyPct`).
- `app/src/shared/lib/exit-rules.ts` — BR-05 leaving-a-running-test rules: `shouldPromptOnExit`,
  the pt-BR `exitPrompt` (`optionCount` 3 + `saveLabel: 'Salvar e sair'` nos modos de estudo desde
  a S2b; `real` fica em 2 + `saveLabel: null` e é o único que avisa), `processableAnswers` (blanks never
  recorded), `answeredStats`, `rowsForAnswers` (joins by question id, survives a partial or
  reordered run). Single source of truth for BOTH the in-screen exit and the navigation guard.
- `app/src/shared/lib/run-guard.ts` — the navigation-guard decision, pure: `isRunGuarded`,
  `pickActiveRun` (several screens may be registered at once), `decideNavigation` (same-path click
  and `targetPath === null` = logout). Owns no labels of its own — delegates to `exit-rules.ts`.

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
- `app/src/shared/hooks/use-run-persistence.ts` — o hook fino que liga scheduler + `examDrafts`
  (`save`/`get`/`discard`) e guarda `draftId`/`token` em refs. É o que #78 e #79 reusam; toda
  regra vem de `save-scheduler.ts` + `run-persistence.ts`.
- `app/src/components/QuitTestDialog.tsx` — the presentational confirmation, shared verbatim by the
  four screens and by the guard. No sidebar-only variant.

Other option-rendering screens (read-only, NOT answering): `app/src/pages/SavedQuestionsPage.tsx`,
admin forms (`admin-question-form.tsx`). Discursive 2ª fase has its own non-MC UI:
`app/src/components/discursive/DiscursiveQuestionCard.tsx` + `DiscursiveRunner.tsx`.

## Mobile app (`apps/mobile/`, deployed by `deploy-mobile.yml`)

Single immersive runner: **`apps/mobile/src/components/QuestionRunner.tsx`** — used by
`PracticePage.tsx` (Praticar), `DrillPage.tsx` (Drill) and `ReviewPage.tsx` (Revisão) via
`RunnerQuestion`. Select → instant reveal (single step, no Conferir) → Próxima; records the whole
session on finish. Has the bookmark button; **no postpone today** (must answer to advance).
State container: `apps/mobile/src/state/practice-context.ts`. Result: `ResultPage.tsx`.
`FlashcardsPage.tsx` and `SavedPage.tsx` render options with their own local UI.

**Mobile has NO cross-out (BR-02) yet — gap M1.** `QuestionRunner` renders no eliminate affordance
and never imports `shared/lib/eliminations.ts`. The "**all four**" in the desktop section above is
scoped to the desktop `QuestionCard` screens only, so BR-02.1 ("EVERY surface where a question is
answered") is **not** satisfied product-wide until M1 lands.

## Backend touched by answering

- `sessions.record` — one transaction: session + every answer; moves the SM-2 schedule.
- `questions.list` / `questions.reviewQueue` / `questions.dueCount`; `stats.*` computed on read.
- `bookmarks.toggle` / `bookmarks.list` (`user_bookmarks`), `notes.upsert` / `notes.list`
  (`user_question_notes`), SM-2 state in `user_question_states` (`drizzle/schema.ts`).

## Life of a test run (as of 2026-08-21 — after #68 + #69 + #77; BR-05 S1 + S1b + S2b)

1. **Start** — the student picks a mode on the mode-selection screen; `TestingPage.tsx` holds
   `mode` in React state, the runner component fetches its questions and owns the queue, the
   answers-so-far, the timer and the cursor. Nothing about the run exists outside browser memory.
2. **Answer / postpone** — all in that component state (BR-03; blanks never recorded).
3. **Leave** — a leave attempt is now INTERCEPTED at its source e oferece "sair e processar"
   (BR-05, epic #67 S1 + S1b) e, no Simulado Padrão, também "Salvar e sair" (S2b, #77).
   Desde a S2a (#75) existe a tabela `exam_drafts` (uma linha por `(user, mode)`,
   `UNIQUE(user_id, mode)`). **Quem grava e retoma hoje:**
   - **Simulado Padrão (S2b, #77) — grava e retoma.** `testing-standard-run.tsx` (setup +
     reidratação) + `testing-standard-board.tsx` (a corrida) usam
     `app/src/shared/hooks/use-run-persistence.ts`: salva a cada resposta confirmada com
     debounce trailing de 1500 ms, dá flush no "Salvar e sair"/"Sair e processar"/última questão,
     e o card do modo mostra "Continuar (n/N)" a partir de `examDrafts.list`.
   - **Revisão Espaçada e Adaptativo (#78) e prova real (#79) — ainda só em memória.** Elas
     reusarão o mesmo hook; até lá o diálogo delas segue com 2 botões (a REGRA já permite 3 nos
     modos de estudo — quem segura o botão é o `onSave` que a tela ainda não passa).

   Não há `localStorage`/`sessionStorage` em lugar nenhum do repo: fora do Padrão, "processar"
   continua significando "gravar o que foi respondido AGORA via `sessions.record`", nunca
   "retomar depois".
   Nothing is asked when nothing was answered (`shouldPromptOnExit`): there is nothing to process
   and `sessions.record` requires `answers.min(1)`.

   Covered exits:
   - **In-screen exit, all 4 screens** (#68): each of `TestingPage.tsx`, `RealExamSimulation.tsx`,
     `SpacedRepetition.tsx`, `AdaptiveSimulation.tsx` renders its own `QuitTestDialog` and owns the
     `quit` handler that calls `sessions.record` over the answers so far.
   - **Global navigation guard** (#69): `RunGuardProvider` sits inside `<Router>` and above
     `<Layout>`. Each running screen registers itself via `useRegisterRun`; `Layout.tsx` routes the
     **sidebar nav** (`:114`), the **admin nav** (`:144`) and **Sair / sign-out** (`:182`) through
     `requestLeave` instead of navigating directly. On "sair e processar" the provider calls the
     ACTIVE screen's own `quit` and DROPS the pending navigation, so the student stays on that
     mode's result screen (the receipt that the answers counted).
   - **Tab close / reload** — `use-leave-warning.ts` still fires the native `beforeunload` prompt.
     It is browser-owned, cannot process anything, and does NOT cover SPA navigation.

   **Residual gaps — all out of scope for S1/S1b. The first two are owned by epic #67 S2
   (server-side in-flight run persistence); the third has its own issue:**
   - **Browser Back** is NOT guarded. `popstate` is not cancelable, so a Back press cannot be
     intercepted the way a click can; wouter 3.10 also has no `useBlocker` and a new dependency is
     out (CLAUDE.md). Persistence, not a guard, is the real net for this — e desde a S2b ela
     existe **no Simulado Padrão**: o Back perde a tela, não a corrida (o último autosave está no
     servidor e o card oferece "Continuar"). Nos outros 3 modos o Back ainda descarta em silêncio.
   - **Mobile `QuestionRunner`** (`apps/mobile/`) has no exit dialog and no guard at all — the
     whole of BR-05 above is desktop-only, exactly like the BR-02 gap M1.
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
  e voltaria como "Continuar" de uma corrida já processada.
- **A LINHA REIVINDICADA decide o arquivamento, nunca o payload do cliente.**
  `filingForClaimedMode` (`shared/domain/exam-draft.ts`): se o rascunho apagado era `mode: 'real'`,
  a sessão vira sempre `"Prova Real"`/`hard`, venha por `sessions.record` (a submissão do próprio
  aluno) ou por `settleRealRun` (a liquidação preguiçosa). Uma corrida = um arquivamento, por
  qualquer porta que ela saia. Simetricamente, `settleRealRun` **recusa rascunho não-`real`**: a
  liquidação existe só para a prova real, e os modos de estudo terminam por `discard` ou por uma
  gravação normal.
- **Assimetria de dois campos string da MESMA linha — não uniformizar:**
  - `deadline_at` é **COMPARADO** (`isRealRunAbandoned` faz `Date.parse`), nunca ecoado como
    token. É normalizável e o validador aceita de propósito os dois formatos (o ISO do browser e
    o texto cru do PG). Só o instante importa.
  - `last_saved_at` / `token` é **casado com `=` dentro do SQL** e viaja **VERBATIM**
    (`"2026-08-21 14:30:04.210932+00"`: µs, sem `T`, sem `Z` — drizzle usa parser identidade em
    `mode: "string"`). Passá-lo por `new Date(...)`, `toISOString()`, `Date.parse` ou por
    `superjson` de `Date` come os microssegundos e **mata a guarda otimista para sempre**: toda
    reivindicação casa 0 linhas e o aluno leva `CONFLICT` no próprio salvamento. Por isso ele mora
    num `useRef` (`use-run-persistence.ts`), nunca em state, e `run-persistence.test.ts` trava o
    valor cru como asserção. Se alguém for endurecer o parsing, é `deadlineAt` e **só**
    `deadlineAt` (#79) — nunca o token.

### Como o Padrão persiste (S2b, #77 — o desenho que #78/#79 reusam)

- `app/src/shared/lib/save-scheduler.ts` (puro) — debounce **trailing** de 1500 ms; `flush()`
  aguarda o envio EM VOO e, se o payload mudou durante ele, dispara **mais um** e resolve com o
  token FINAL. Sem isso o `save` em voo move `last_saved_at`, a reivindicação casa 0 linhas e o
  aluno recebe `CONFLICT` causado pelo próprio salvamento.
- `app/src/shared/lib/run-persistence.ts` (puro) — payload do save (o Padrão **não** manda
  `deadlineAt`), reidratação (`questions.byIds` volta em ordem do banco e é **reordenado** pelo
  array persistido; `questions.list` nunca é refeito porque ordena por `random()`), o par do claim
  e as **duas** cópias pt-BR de CONFLICT: token velho ⇒ "continuado em outro aparelho"
  (Recarregar / Descartar esta cópia); `token: null` sobre corrida viva ⇒ "já existe um teste em
  andamento" (Continuar o salvo / Descartar o salvo).
- O **flush mora no handler da tela** (`handleSaveAndExit` / `handleQuitAndProcess`), nunca no
  `QuitTestDialog` nem no `RunGuardProvider` — os dois são apresentação e não podem esperar
  promessa. Enquanto ele roda, `busy` desabilita os 3 botões.
- `pagehide`/`visibilitychange` é **best-effort assumido** (`httpBatchLink` monta o header com o
  `getToken()` assíncrono do Clerk e não usa `keepalive`; `sendBeacon` não manda `Authorization`).
  A garantia real é o debounce de 1500 ms já ter pousado.
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

## Functional definitions attached to these surfaces

- [BR-02 Descartar alternativas](kb-business/br-02-cross-out.md)
- [BR-03 Responder depois = postpone, not bookmark](kb-business/br-03-postpone.md)
- [BR-04 Bookmarks](kb-business/br-04-bookmarks.md)
- [BR-05 Salvar progresso / Sair e processar](kb-business/br-05-save-quit-test.md)
