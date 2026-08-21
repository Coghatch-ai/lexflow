# Project library — index

Durable, authoritative records for LexFlow. `CLAUDE.md` is the INDEX (one-line pointers);
the content lives here. Every agent (analyst, builder, tester, reviewer) treats these docs as
authoritative product intent, above any hypothesis of its own.

| Doc                                                          | What it holds                                                                                                                                     |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| [kb-business/](kb-business/README.md)                        | Functional definitions / product intent — ONE FILE PER FUNCTIONALITY. Read BEFORE designing or fixing.                                            |
| [business-rules.md](business-rules.md)                       | Redirect only — the old single-file location, kept so existing links resolve.                                                                     |
| [answering-surfaces.md](answering-surfaces.md)               | Map of every place a question is answered (desktop QuestionCard screens, mobile QuestionRunner), the life of a test run + the backend it touches. |
| [migration-deploy-contract.md](migration-deploy-contract.md) | CI does NOT migrate — the migration↔deploy contract + push guard.                                                                                 |
| [project.md](project.md)                                     | Extended project/infra details too long for a CLAUDE.md line.                                                                                     |

## Functionalities → where they are defined

| Functionality                       | Rule                                         | Code map                                                                                |
| ----------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------- |
| LOV codes in the question catalog   | [BR-01](kb-business/br-01-lov-codes.md)      | `shared/data/lov.ts`, `scripts/seed*.ts`                                                |
| Descartar alternativas (cross-out)  | [BR-02](kb-business/br-02-cross-out.md)      | [answering-surfaces.md](answering-surfaces.md) · epic #65                               |
| Responder depois (postpone in test) | [BR-03](kb-business/br-03-postpone.md)       | `app/src/shared/lib/exam-queue.ts`, `app/src/pages/testing-flow-guards.ts`              |
| Bookmarks / Salvos                  | [BR-04](kb-business/br-04-bookmarks.md)      | `bookmarks.toggle`/`list`, `user_bookmarks`                                             |
| Salvar progresso / Sair e processar | [BR-05](kb-business/br-05-save-quit-test.md) | [answering-surfaces.md](answering-surfaces.md) (life of a test run) · `sessions.record` |

Adding a record: product-owner writes it, human approves, then append the row above AND a row in
[kb-business/README.md](kb-business/README.md). One file per functionality — never append a second
functionality to an existing rule file.
