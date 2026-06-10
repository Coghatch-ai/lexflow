import { useState, type ReactElement } from 'react';
import { Plus, Pencil, Trash2, Check, X } from 'lucide-react';
import { trpc } from '../shared/lib/trpc';
import { AdminGate } from './admin-gate';

type CalendarEvent = { label: string; dateText: string; sortOrder: number };
type CalendarRow = {
  id: string;
  title: string;
  note: string | null;
  active: boolean;
  sortOrder: number;
  events: CalendarEvent[];
};

const EMPTY_EVENT: CalendarEvent = { label: '', dateText: '', sortOrder: 0 };
const EMPTY_FORM = { title: '', note: '', active: true, sortOrder: 0, events: [{ ...EMPTY_EVENT }] };

function CalendarAdmin(): ReactElement {
  const utils = trpc.useUtils();
  const listQuery = trpc.admin.calendars.list.useQuery();
  const createMutation = trpc.admin.calendars.create.useMutation({ onSuccess: () => { void utils.admin.calendars.invalidate(); void utils.calendars.invalidate(); resetForm(); } });
  const updateMutation = trpc.admin.calendars.update.useMutation({ onSuccess: () => { void utils.admin.calendars.invalidate(); void utils.calendars.invalidate(); resetForm(); } });
  const toggleMutation = trpc.admin.calendars.toggleActive.useMutation({ onSuccess: () => { void utils.admin.calendars.invalidate(); void utils.calendars.invalidate(); } });
  const deleteMutation = trpc.admin.calendars.delete.useMutation({ onSuccess: () => { void utils.admin.calendars.invalidate(); void utils.calendars.invalidate(); } });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<typeof EMPTY_FORM>({ ...EMPTY_FORM });

  function resetForm() { setForm({ ...EMPTY_FORM, events: [{ ...EMPTY_EVENT }] }); setEditingId(null); setShowForm(false); }

  function startEdit(cal: CalendarRow) {
    setEditingId(cal.id);
    setForm({
      title: cal.title,
      note: cal.note ?? '',
      active: cal.active,
      sortOrder: cal.sortOrder,
      events: cal.events.length > 0 ? cal.events.map((e) => ({ ...e })) : [{ ...EMPTY_EVENT }],
    });
    setShowForm(true);
  }

  function addEvent() { setForm((f) => ({ ...f, events: [...f.events, { ...EMPTY_EVENT, sortOrder: f.events.length }] })); }
  function removeEvent(i: number) { setForm((f) => ({ ...f, events: f.events.filter((_, idx) => idx !== i) })); }

  function setEvent(i: number, field: keyof CalendarEvent, value: string) {
    const numValue = Number.isNaN(parseInt(value, 10)) ? 0 : parseInt(value, 10);
    setForm((f) => ({
      ...f,
      events: f.events.map((e, idx) =>
        idx === i ? { ...e, [field]: field === 'sortOrder' ? numValue : value } : e
      ),
    }));
  }

  function handleSave() {
    const payload = { ...form, events: form.events.map((e, i) => ({ ...e, sortOrder: i })) };
    if (editingId !== null) { updateMutation.mutate({ id: editingId, ...payload }); }
    else { createMutation.mutate(payload); }
  }

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-ink-mute">Gerencie os ciclos de exame exibidos na página inicial.</p>
        {!showForm && (
          <button
            onClick={() => { resetForm(); setShowForm(true); }}
            className="flex items-center gap-2 px-4 py-2 bg-[#d9ab53] text-[#16161a] text-sm font-semibold rounded-lg hover:bg-[#e0b86a] transition-colors"
          >
            <Plus className="w-4 h-4" />
            Novo Calendário
          </button>
        )}
      </div>

      {showForm && (
        <div className="border border-line rounded-xl p-5 space-y-4 bg-white">
          <h3 className="font-semibold text-ink">{editingId !== null ? 'Editar Calendário' : 'Novo Calendário'}</h3>

          <div className="grid gap-3">
            <div>
              <label className="text-xs font-semibold text-ink-mute uppercase tracking-wide">Título</label>
              <input
                value={form.title}
                onChange={(e) => { setForm((f) => ({ ...f, title: e.target.value })); }}
                placeholder="Ex: 46º EXAME DE ORDEM UNIFICADO"
                className="mt-1 w-full px-3 py-2 border border-line rounded-lg text-sm bg-white text-ink focus:outline-none focus:ring-2 focus:ring-[#d9ab53]"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-ink-mute uppercase tracking-wide">Nota (opcional)</label>
              <input
                value={form.note}
                onChange={(e) => { setForm((f) => ({ ...f, note: e.target.value })); }}
                placeholder="Ex: * Sujeito a alterações"
                className="mt-1 w-full px-3 py-2 border border-line rounded-lg text-sm bg-white text-ink focus:outline-none focus:ring-2 focus:ring-[#d9ab53]"
              />
            </div>
            <div className="flex items-center gap-4">
              <div>
                <label className="text-xs font-semibold text-ink-mute uppercase tracking-wide">Ordem</label>
                <input
                  type="number"
                  value={form.sortOrder}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    setForm((f) => ({ ...f, sortOrder: Number.isNaN(n) ? 0 : n }));
                  }}
                  className="mt-1 w-24 px-3 py-2 border border-line rounded-lg text-sm bg-white text-ink focus:outline-none focus:ring-2 focus:ring-[#d9ab53]"
                />
              </div>
              <div className="flex items-center gap-2 mt-5">
                <input type="checkbox" id="cal-active" checked={form.active} onChange={(e) => { setForm((f) => ({ ...f, active: e.target.checked })); }} className="w-4 h-4" />
                <label htmlFor="cal-active" className="text-sm text-ink">Ativo (visível na página inicial)</label>
              </div>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-ink-mute uppercase tracking-wide">Eventos</label>
              <button onClick={addEvent} className="flex items-center gap-1 text-xs text-[#d9ab53] hover:underline">
                <Plus className="w-3 h-3" /> Adicionar linha
              </button>
            </div>
            <div className="space-y-2">
              {form.events.map((ev, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <input
                    value={ev.label}
                    onChange={(e) => { setEvent(i, 'label', e.target.value); }}
                    placeholder="Descrição do evento"
                    className="flex-1 px-3 py-2 border border-line rounded-lg text-sm bg-white text-ink focus:outline-none focus:ring-2 focus:ring-[#d9ab53]"
                  />
                  <input
                    value={ev.dateText}
                    onChange={(e) => { setEvent(i, 'dateText', e.target.value); }}
                    placeholder="Data ou período"
                    className="w-44 px-3 py-2 border border-line rounded-lg text-sm bg-white text-ink focus:outline-none focus:ring-2 focus:ring-[#d9ab53]"
                  />
                  <button onClick={() => { removeEvent(i); }} className="p-1.5 text-ink-mute hover:text-red-500 transition-colors">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              onClick={handleSave}
              disabled={isSaving || form.title.trim().length === 0}
              className="flex items-center gap-2 px-5 py-2.5 bg-[#d9ab53] text-[#16161a] text-sm font-semibold rounded-lg hover:bg-[#e0b86a] transition-colors disabled:opacity-50"
            >
              {isSaving ? 'Salvando...' : 'Salvar'}
            </button>
            <button onClick={resetForm} className="px-4 py-2.5 text-sm text-ink-mute border border-line rounded-lg hover:text-ink transition-colors">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {listQuery.isLoading ? (
        <div className="flex items-center justify-center h-24 text-ink-mute">Carregando...</div>
      ) : (listQuery.data ?? []).length === 0 ? (
        <div className="text-center py-12 text-ink-mute text-sm">Nenhum calendário criado ainda.</div>
      ) : (
        <div className="space-y-3">
          {(listQuery.data ?? []).map((cal) => (
            <div key={cal.id} className={`border rounded-xl p-4 ${cal.active ? 'border-line bg-white' : 'border-line bg-line/20 opacity-60'}`}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-ink">{cal.title}</p>
                  {cal.note !== null && <p className="text-xs text-ink-mute mt-0.5">{cal.note}</p>}
                  <ul className="mt-2 space-y-1">
                    {cal.events.map((ev, i) => (
                      <li key={i} className="flex gap-2 text-sm text-ink-soft">
                        <span className="text-ink-mute">–</span>
                        <span>{ev.label}:</span>
                        <span className="font-medium text-ink">{ev.dateText}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => { toggleMutation.mutate({ id: cal.id, active: !cal.active }); }}
                    title={cal.active ? 'Desativar' : 'Ativar'}
                    className="p-1.5 text-ink-mute hover:text-ink transition-colors"
                  >
                    {cal.active ? <Check className="w-4 h-4 text-green-600" /> : <X className="w-4 h-4" />}
                  </button>
                  <button onClick={() => { startEdit(cal); }} className="p-1.5 text-ink-mute hover:text-ink transition-colors">
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => { if (confirm('Excluir este calendário?')) deleteMutation.mutate({ id: cal.id }); }}
                    className="p-1.5 text-ink-mute hover:text-red-500 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function AdminCalendarPage(): ReactElement {
  return <AdminGate><CalendarAdmin /></AdminGate>;
}
