import { useState, type ReactElement } from 'react';
import { useSearchParams } from 'wouter';
import { Bookmark, BookmarkX, ChevronDown, ChevronUp, StickyNote, Trash2 } from 'lucide-react';
import { useLov } from '../shared/hooks/use-lov';
import { trpc } from '../shared/lib/trpc';
import { META_SEP } from '@shared/domain/ui-format';

type SavedQuestionCardProps = {
  metaLine: string;
  questionText: string;
  options: string[];
  note?: string;
  expanded: boolean;
  onToggleExpand: () => void;
  onRemoveBookmark?: () => void;
  onDeleteNote?: () => void;
  actionPending: boolean;
};

function SavedQuestionCard({
  metaLine,
  questionText,
  options,
  note,
  expanded,
  onToggleExpand,
  onRemoveBookmark,
  onDeleteNote,
  actionPending,
}: SavedQuestionCardProps): ReactElement {
  return (
    <div className="bg-white rounded-xl p-4 shadow">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-xs text-gray-500 mb-1">{metaLine}</p>
          <p className={`text-sm text-gray-800 leading-relaxed ${!expanded ? 'line-clamp-2' : ''}`}>
            {questionText}
          </p>
          {expanded && (
            <div className="mt-3 space-y-2">
              {options.map((opt, idx) => (
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
            onClick={onToggleExpand}
            className="p-1.5 text-gray-400 hover:text-[#16161a] transition rounded-md hover:bg-gray-100"
            title={expanded ? 'Recolher' : 'Expandir'}
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {onRemoveBookmark !== undefined && (
            <button
              onClick={onRemoveBookmark}
              disabled={actionPending}
              className="p-1.5 text-gray-400 hover:text-red-500 transition rounded-md hover:bg-red-50"
              title="Remover dos salvos"
            >
              <BookmarkX className="w-4 h-4" />
            </button>
          )}
          {onDeleteNote !== undefined && (
            <button
              onClick={onDeleteNote}
              disabled={actionPending}
              className="p-1.5 text-gray-400 hover:text-red-500 transition rounded-md hover:bg-red-50"
              title="Excluir anotação"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function LoadingCard(): ReactElement {
  return (
    <div className="bg-white rounded-xl p-8 shadow flex items-center justify-center h-48">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#16161a]" />
    </div>
  );
}

function EmptyState({ icon, title, hint }: { icon: ReactElement; title: string; hint: string }): ReactElement {
  return (
    <div className="bg-white rounded-xl p-8 shadow text-center">
      {icon}
      <h4 className="text-lg font-bold text-[#16161a] mb-2">{title}</h4>
      <p className="text-sm text-gray-500">{hint}</p>
    </div>
  );
}

function CountHeader({ text }: { text: string }): ReactElement {
  return (
    <div className="bg-white rounded-xl px-5 py-4 shadow flex items-center justify-between">
      <h4 className="font-bold text-[#16161a]">{text}</h4>
      <p className="text-xs text-gray-500">Clique em ▼ para expandir</p>
    </div>
  );
}

function BookmarkedTab(): ReactElement {
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

  if (isLoading) return <LoadingCard />;

  if (ids.length === 0) {
    return (
      <EmptyState
        icon={<Bookmark className="w-12 h-12 text-gray-200 mx-auto mb-4" />}
        title="Nenhuma questão salva"
        hint={'Durante os simulados, use o botão "Salvar para depois" em qualquer questão para encontrá-la aqui.'}
      />
    );
  }

  const questions = (questionsQuery.data ?? []).filter((q) => ids.includes(q.id));

  return (
    <div className="space-y-4">
      <CountHeader
        text={questions.length === 1 ? '1 questão salva' : `${questions.length} questões salvas`}
      />
      {questions.map((q) => (
        <SavedQuestionCard
          key={q.id}
          metaLine={`${disciplineLov.labelOf(q.discipline)} ${META_SEP} ${examBoardLov.labelOf(q.examBoard)} ${META_SEP} ${q.year}`}
          questionText={q.questionText}
          options={q.options}
          note={notesMap.get(q.id)}
          expanded={expandedId === q.id}
          onToggleExpand={() => {
            setExpandedId(expandedId === q.id ? null : q.id);
          }}
          onRemoveBookmark={() => {
            bookmarksMutation.mutate({ questionId: q.id });
          }}
          actionPending={bookmarksMutation.isPending}
        />
      ))}
    </div>
  );
}

function NotesTab(): ReactElement {
  const disciplineLov = useLov('DISCIPLINE');
  const examBoardLov = useLov('EXAM_BOARD');
  const utils = trpc.useUtils();

  const notesQuery = trpc.notes.list.useQuery();
  const deleteMutation = trpc.notes.delete.useMutation({
    onSuccess: () => {
      void utils.notes.invalidate();
    },
  });

  const notes = (notesQuery.data ?? []).filter((n) => n.noteText.trim().length > 0);
  const ids = notes.map((n) => n.questionId);
  const questionsQuery = trpc.questions.byIds.useQuery(
    { ids },
    { enabled: ids.length > 0 },
  );

  const [expandedId, setExpandedId] = useState<string | null>(null);

  const isLoading = notesQuery.isLoading || (ids.length > 0 && questionsQuery.isLoading);

  if (isLoading) return <LoadingCard />;

  if (notes.length === 0) {
    return (
      <EmptyState
        icon={<StickyNote className="w-12 h-12 text-gray-200 mx-auto mb-4" />}
        title="Nenhuma anotação"
        hint="Durante os simulados, use o campo Anotações em qualquer questão para encontrá-la aqui."
      />
    );
  }

  const questionsById = new Map((questionsQuery.data ?? []).map((q) => [q.id, q] as const));

  return (
    <div className="space-y-4">
      <CountHeader text={notes.length === 1 ? '1 anotação' : `${notes.length} anotações`} />
      {notes.map((n) => {
        const q = questionsById.get(n.questionId);
        if (q === undefined) return null;
        return (
          <SavedQuestionCard
            key={n.questionId}
            metaLine={`${disciplineLov.labelOf(q.discipline)} ${META_SEP} ${examBoardLov.labelOf(q.examBoard)} ${META_SEP} ${q.year}`}
            questionText={q.questionText}
            options={q.options}
            note={n.noteText}
            expanded={expandedId === n.questionId}
            onToggleExpand={() => {
              setExpandedId(expandedId === n.questionId ? null : n.questionId);
            }}
            onDeleteNote={() => {
              if (window.confirm('Excluir esta anotação?')) {
                deleteMutation.mutate({ questionId: n.questionId });
              }
            }}
            actionPending={deleteMutation.isPending}
          />
        );
      })}
    </div>
  );
}

function TabButton({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2 ${
        active ? 'bg-[#16161a] text-white' : 'text-gray-600 hover:bg-gray-100'
      }`}
    >
      {label}
      <span
        className={`text-xs px-1.5 py-0.5 rounded-full ${
          active ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500'
        }`}
      >
        {count}
      </span>
    </button>
  );
}

export default function SavedQuestionsPage(): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') === 'notes' ? 'notes' : 'saved';

  const bookmarksQuery = trpc.bookmarks.list.useQuery();
  const notesQuery = trpc.notes.list.useQuery();
  const savedCount = (bookmarksQuery.data ?? []).length;
  const notesCount = (notesQuery.data ?? []).filter((n) => n.noteText.trim().length > 0).length;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl p-1.5 shadow inline-flex gap-1">
        <TabButton
          active={tab === 'saved'}
          label="Salvas"
          count={savedCount}
          onClick={() => {
            setSearchParams({}, { replace: true });
          }}
        />
        <TabButton
          active={tab === 'notes'}
          label="Anotações"
          count={notesCount}
          onClick={() => {
            setSearchParams({ tab: 'notes' }, { replace: true });
          }}
        />
      </div>
      {tab === 'saved' ? <BookmarkedTab /> : <NotesTab />}
    </div>
  );
}
