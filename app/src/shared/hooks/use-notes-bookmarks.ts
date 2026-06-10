import { useEffect, useRef, useState } from "react";
import { trpc } from "../lib/trpc";

export interface NotesAndBookmarks {
  localNotes: Map<string, string>;
  bookmarkedIds: Set<string>;
  handleNoteChange: (questionId: string, text: string) => void;
  handleToggleBookmark: (questionId: string) => void;
}

export function useNotesAndBookmarks(): NotesAndBookmarks {
  const notesQuery = trpc.notes.list.useQuery();
  const bookmarksQuery = trpc.bookmarks.list.useQuery();
  const notesMutation = trpc.notes.upsert.useMutation();
  const deleteNoteMutation = trpc.notes.delete.useMutation();
  const bookmarksMutation = trpc.bookmarks.toggle.useMutation();

  const [localNotes, setLocalNotes] = useState<Map<string, string>>(new Map());
  const [bookmarkedIds, setBookmarkedIds] = useState<Set<string>>(new Set());
  const noteDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!notesQuery.data) return;
    const map = new Map<string, string>();
    notesQuery.data.forEach((n) => map.set(n.questionId, n.noteText));
    setLocalNotes(map);
  }, [notesQuery.data]);

  useEffect(() => {
    if (!bookmarksQuery.data) return;
    setBookmarkedIds(new Set(bookmarksQuery.data));
  }, [bookmarksQuery.data]);

  useEffect(() => {
    return () => {
      if (noteDebounceRef.current !== null) clearTimeout(noteDebounceRef.current);
    };
  }, []);

  const handleNoteChange = (questionId: string, text: string): void => {
    setLocalNotes((prev) => new Map(prev).set(questionId, text));
    if (noteDebounceRef.current !== null) clearTimeout(noteDebounceRef.current);
    noteDebounceRef.current = setTimeout(() => {
      if (text.trim().length > 0) {
        notesMutation.mutate({ questionId, noteText: text });
      } else {
        deleteNoteMutation.mutate({ questionId });
      }
    }, 1000);
  };

  const handleToggleBookmark = (questionId: string): void => {
    setBookmarkedIds((prev) => {
      const next = new Set(prev);
      if (next.has(questionId)) next.delete(questionId);
      else next.add(questionId);
      return next;
    });
    bookmarksMutation.mutate({ questionId });
  };

  return { localNotes, bookmarkedIds, handleNoteChange, handleToggleBookmark };
}
