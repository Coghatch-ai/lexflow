import { useState, type ReactElement } from 'react';
import { Bookmark, BookmarkX, ChevronDown, ChevronUp } from 'lucide-react';
import { useLov } from '../shared/hooks/use-lov';
import { trpc } from '../shared/lib/trpc';

export default function SavedQuestionsPage(): ReactElement {
  const disciplineLov = useLov('DISCIPLINE');
  const examBoardLov = useLov('EXAM_BOARD');
  const utils = trpc.useUtils();

  const bookmarksQuery = trpc.bookmarks.list.useQuery();
  const notesQuery = trpc.notes.list.useQuery();
  const bookmarksMutation = trpc.bookmarks.toggle.useMutation({
    onSuccess: () => {
      void utils.bookmarks.invalidate();
    },
  });

  const ids = bookmarksQuery.data ?? [];
  const questionsQuery = trpc.questions.byIds.useQuery(
    { ids },
    { enabled: ids.length > 0 },
  );

  const [expandedId, setExpandedId] = useState<string | null>(null);

  const notesMap = new Map<string, string>();
  notesQuery.data?.forEach((n) => {
    if (n.noteText.trim().length > 0) notesMap.set(n.questionId, n.noteText);
  });

  const isLoading = bookmarksQuery.isLoading || (ids.length > 0 && questionsQuery.isLoading);

  if (isLoading) {
    return (
      <div className="bg-white rounded-xl p-8 shadow flex items-center justify-center h-48">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#16161a]" />
      </div>
    );
  }

  if (ids.length === 0) {
    return (
      <div className="bg-white rounded-xl p-8 shadow text-center">
        <Bookmark className="w-12 h-12 text-gray-200 mx-auto mb-4" />
        <h4 className="text-lg font-bold text-[#16161a] mb-2">Nenhuma questão salva</h4>
        <p className="text-sm text-gray-500">
          Durante os simulados, use o botão "Salvar para depois" em qualquer questão para encontrá-la aqui.
        </p>
      </div>
    );
  }

  const questions = (questionsQuery.data ?? []).filter((q) => ids.includes(q.id));

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl px-5 py-4 shadow flex items-center justify-between">
        <h4 className="font-bold text-[#16161a]">
          {questions.length} questão{questions.length !== 1 ? 'ões' : ''} salva{questions.length !== 1 ? 's' : ''}
        </h4>
        <p className="text-xs text-gray-500">Clique em ▼ para expandir</p>
      </div>

      {questions.map((q) => {
        const note = notesMap.get(q.id);
        const isExpanded = expandedId === q.id;
        return (
          <div key={q.id} className="bg-white rounded-xl p-4 shadow">
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-500 mb-1">
                  {disciplineLov.labelOf(q.discipline)} · {examBoardLov.labelOf(q.examBoard)} · {q.year}
                </p>
                <p className={`text-sm text-gray-800 leading-relaxed ${!isExpanded ? 'line-clamp-2' : ''}`}>
                  {q.questionText}
                </p>
                {isExpanded && (
                  <div className="mt-3 space-y-2">
                    {q.options.map((opt, idx) => (
                      <p key={idx} className="text-sm text-gray-600 pl-3 border-l-2 border-gray-100">
                        {opt}
                      </p>
                    ))}
                  </div>
                )}
                {note !== undefined && (
                  <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    <p className="text-xs font-semibold text-amber-700 mb-0.5">Anotação</p>
                    <p className="text-sm text-amber-900">{note}</p>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0 ml-2">
                <button
                  onClick={() => { setExpandedId(isExpanded ? null : q.id); }}
                  className="p-1.5 text-gray-400 hover:text-[#16161a] transition rounded-md hover:bg-gray-100"
                  title={isExpanded ? 'Recolher' : 'Expandir'}
                >
                  {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
                <button
                  onClick={() => { bookmarksMutation.mutate({ questionId: q.id }); }}
                  disabled={bookmarksMutation.isPending}
                  className="p-1.5 text-gray-400 hover:text-red-500 transition rounded-md hover:bg-red-50"
                  title="Remover dos salvos"
                >
                  <BookmarkX className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
