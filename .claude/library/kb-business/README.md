# kb-business — functional definitions (product intent)

One file per functionality. These are AUTHORITATIVE: every agent (analyst, builder, tester,
reviewer) treats them as the contract and never overrides them with a hypothesis of its own.
Rules are written as standing statements of how the product behaves — timeless, independent of
the current code. Code pointers live in [../answering-surfaces.md](../answering-surfaces.md) so a
refactor never invalidates a rule.

| Rule                             | Functionality                                              |
| -------------------------------- | ---------------------------------------------------------- |
| [BR-01](br-01-lov-codes.md)      | LOV codes in the question catalog (never pt-BR labels)     |
| [BR-02](br-02-cross-out.md)      | Descartar alternativas (cross-out) — a study aid, not data |
| [BR-03](br-03-postpone.md)       | Responder depois = postpone within the test, not bookmark  |
| [BR-04](br-04-bookmarks.md)      | Bookmarks / Salvos — the durable saved-questions library   |
| [BR-05](br-05-save-quit-test.md) | Salvar progresso / Sair e processar a test in progress     |

Adding a rule: the product-owner writes it, the human approves the exact text, then the row above
is added. Never paraphrase captured intent; never fold two functionalities into one file.
