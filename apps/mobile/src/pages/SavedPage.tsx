import { useMemo, useState, type ReactElement } from "react";
import { BookmarkX, ChevronDown } from "lucide-react";
import { trpc } from "../lib/trpc";

type SavedQuestion = {
  id: string;
  questionText: string;
  options: string[];
  explanation: string;
  discipline: string;
};

// "Salvos": questions the user bookmarked (during practice/review or here).
// bookmarks.list holds only the ids, so we hydrate the full rows via byIds.
export function SavedPage(): ReactElement {
  const utils = trpc.useUtils();
  const bookmarksQ = trpc.bookmarks.list.useQuery();
  const ids = useMemo(() => bookmarksQ.data ?? [], [bookmarksQ.data]);

  const questionsQ = trpc.questions.byIds.useQuery(
    { ids },
    { enabled: ids.length > 0, refetchOnWindowFocus: false },
  );
  const toggleMut = trpc.bookmarks.toggle.useMutation();

  function unsave(id: string): void {
    toggleMut.mutate(
      { questionId: id },
      {
        onSuccess: () => {
          void utils.bookmarks.list.invalidate();
        },
      },
    );
  }

  const questions: SavedQuestion[] = questionsQ.data ?? [];

  return (
    <div className="stagger flex flex-col gap-5 px-4 py-6 pb-24">
      <header>
        <p className="eyebrow !text-seal">Para revisar depois</p>
        <h1 className="mt-1 font-display text-3xl font-bold tracking-tightish text-ink">Salvos</h1>
      </header>

      {bookmarksQ.isLoading ? (
        <p className="text-sm text-ink-mute">Carregando…</p>
      ) : ids.length === 0 ? (
        <div className="card-default text-center">
          <p className="text-sm text-ink">Você ainda não salvou questões.</p>
          <p className="mt-1 text-sm text-ink-mute">
            Toque no ícone de marcador durante a prática para salvar.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {questions.map((q) => (
            <SavedCard key={q.id} question={q} onUnsave={unsave} pending={toggleMut.isPending} />
          ))}
        </ul>
      )}
    </div>
  );
}

function SavedCard({
  question,
  onUnsave,
  pending,
}: {
  question: SavedQuestion;
  onUnsave: (id: string) => void;
  pending: boolean;
}): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <li className="card-default flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <p className="badge-seal">{question.discipline}</p>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            onUnsave(question.id);
          }}
          aria-label="Remover dos salvos"
          className="text-ink-mute disabled:opacity-50"
        >
          <BookmarkX className="h-5 w-5" strokeWidth={1.75} />
        </button>
      </div>

      <p className={`text-sm text-ink ${open ? "" : "line-clamp-3"}`}>{question.questionText}</p>

      {open ? (
        <>
          <ul className="flex flex-col gap-1.5">
            {question.options.map((o) => (
              <li
                key={o}
                className="rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink-soft"
              >
                {o}
              </li>
            ))}
          </ul>
          <div className="rounded-xl border border-line bg-paper p-3">
            <p className="eyebrow mb-1">Comentário</p>
            <p className="text-sm leading-relaxed text-ink-soft">{question.explanation}</p>
          </div>
        </>
      ) : null}

      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
        }}
        className="flex items-center gap-1 self-start text-xs font-semibold text-seal"
      >
        {open ? "Recolher" : "Ver questão"}
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
    </li>
  );
}
