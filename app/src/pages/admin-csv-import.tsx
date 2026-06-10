import { useState, useRef, type ReactElement, type ChangeEvent } from 'react';
import { Check, AlertCircle, Upload, Download } from 'lucide-react';
import { trpc } from '../shared/lib/trpc';
import { useLov } from '../shared/hooks/use-lov';
import { adminQuestionInputSchema, type AdminQuestionInput } from '@shared/domain/admin-question';
import { parseCSVText, csvRowToInput, downloadTemplate, CSV_HEADER } from './admin-csv-helpers';

type ParsedRow = {
  index: number;
  raw: AdminQuestionInput;
  valid: boolean;
  errors: string[];
};

export function CsvImport({ onSuccess }: { onSuccess: () => void }): ReactElement {
  const utils = trpc.useUtils();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [importResult, setImportResult] = useState<{ upserted: number } | null>(null);

  const disciplineLov = useLov('DISCIPLINE');

  const bulkUpsert = trpc.admin.questions.bulkUpsert.useMutation({
    onSuccess: (data) => {
      setImportResult(data);
      void utils.admin.questions.list.invalidate();
    },
    onError: (e) => {
      setRows((prev) =>
        prev.map((r, i) => (i === 0 ? { ...r, errors: [e.message] } : r))
      );
    },
  });

  function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setImportResult(null);

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result;
      if (typeof text !== 'string') return;
      const rawRows = parseCSVText(text);
      const parsed: ParsedRow[] = rawRows.map((raw, idx) => {
        const input = csvRowToInput(raw);
        const result = adminQuestionInputSchema.safeParse(input);
        return {
          index: idx + 1,
          raw: input,
          valid: result.success,
          errors: result.success ? [] : result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
        };
      });
      setRows(parsed);
    };
    reader.readAsText(file, 'UTF-8');
  }

  const validRows = rows.filter((r) => r.valid);
  const invalidRows = rows.filter((r) => !r.valid);

  function handleImport() {
    if (validRows.length === 0) return;
    bulkUpsert.mutate(validRows.map((r) => r.raw));
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div className="bg-[#16161a] rounded-xl p-5 text-sm space-y-3">
        <p className="font-semibold text-surface flex items-center gap-2">
          <Upload className="w-4 h-4 text-[#d9ab53]" />
          Importação via CSV
        </p>
        <ol className="list-decimal list-inside space-y-1 text-white/70 pl-1">
          <li>Baixe o template CSV abaixo e preencha com as questões</li>
          <li>Salve como CSV (UTF-8) no Excel: <em>Arquivo → Salvar como → CSV UTF-8</em></li>
          <li>Faça upload do arquivo e revise a pré-visualização</li>
          <li>Clique em Importar — rows com ID existente serão atualizadas</li>
        </ol>
        <div>
          <p className="text-white/50 text-xs mb-2">Colunas esperadas:</p>
          <code className="text-[0.68rem] text-[#d9ab53] break-all">{CSV_HEADER}</code>
        </div>
        <button
          onClick={downloadTemplate}
          className="flex items-center gap-2 px-3 py-1.5 border border-[#d9ab53]/40 text-[#d9ab53] text-xs font-medium rounded-lg hover:bg-[#d9ab53]/10 transition-colors"
        >
          <Download className="w-3.5 h-3.5" />
          Baixar template
        </button>
      </div>

      <div>
        <label className="block text-sm font-medium text-ink mb-2">Arquivo CSV</label>
        <div
          className="flex items-center gap-3 border-2 border-dashed border-line rounded-xl p-6 cursor-pointer hover:border-[#d9ab53]/50 transition-colors"
          onClick={() => { fileRef.current?.click(); }}
        >
          <Upload className="w-8 h-8 text-ink-mute shrink-0" />
          <div>
            <p className="text-sm font-medium text-ink">
              {fileName.length > 0 ? fileName : 'Clique para selecionar ou arraste aqui'}
            </p>
            <p className="text-xs text-ink-mute mt-0.5">CSV, máx. 500 linhas</p>
          </div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          onChange={handleFile}
          className="hidden"
        />
      </div>

      {rows.length > 0 && !importResult && (
        <div className="space-y-4">
          <div className="flex items-center gap-4 text-sm">
            <span className="flex items-center gap-1.5 text-emerald-700">
              <Check className="w-4 h-4" /> {validRows.length} válida(s)
            </span>
            {invalidRows.length > 0 && (
              <span className="flex items-center gap-1.5 text-red-600">
                <AlertCircle className="w-4 h-4" /> {invalidRows.length} inválida(s) (serão ignoradas)
              </span>
            )}
          </div>

          {invalidRows.length > 0 && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 space-y-1">
              <p className="font-semibold">Erros encontrados (linhas ignoradas):</p>
              {invalidRows.slice(0, 10).map((r) => (
                <p key={r.index}>Linha {r.index + 1}: {r.errors.join(', ')}</p>
              ))}
              {invalidRows.length > 10 && (
                <p>…e mais {invalidRows.length - 10} linha(s)</p>
              )}
            </div>
          )}

          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-xs">
              <thead className="bg-paper-sink text-ink-mute text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">#</th>
                  <th className="px-3 py-2 font-medium">Enunciado</th>
                  <th className="px-3 py-2 font-medium">Disciplina</th>
                  <th className="px-3 py-2 font-medium">Banca</th>
                  <th className="px-3 py-2 font-medium">Dificuldade</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.slice(0, 20).map((r) => (
                  <tr key={r.index} className={r.valid ? '' : 'bg-red-50/50'}>
                    <td className="px-3 py-2 text-ink-mute">{r.index}</td>
                    <td className="px-3 py-2 text-ink max-w-xs">
                      <p className="line-clamp-1">{r.raw.questionText.length > 0 ? r.raw.questionText : '—'}</p>
                    </td>
                    <td className="px-3 py-2 text-ink-mute">{disciplineLov.labelOf(r.raw.discipline)}</td>
                    <td className="px-3 py-2 text-ink-mute">{r.raw.examBoard}</td>
                    <td className="px-3 py-2 text-ink-mute">{r.raw.difficulty}</td>
                    <td className="px-3 py-2">
                      {r.valid
                        ? <Check className="w-3.5 h-3.5 text-emerald-600" />
                        : <span title={r.errors.join(', ')}><AlertCircle className="w-3.5 h-3.5 text-red-500" /></span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 20 && (
              <p className="px-3 py-2 text-xs text-ink-mute border-t border-line">
                Mostrando 20 de {rows.length} linhas na prévia
              </p>
            )}
          </div>

          <button
            onClick={handleImport}
            disabled={validRows.length === 0 || bulkUpsert.isPending}
            className="flex items-center gap-2 px-5 py-2.5 bg-[#d9ab53] text-[#16161a] text-sm font-semibold rounded-lg hover:bg-[#e0b86a] disabled:opacity-60 transition-colors"
          >
            <Upload className="w-4 h-4" />
            {bulkUpsert.isPending
              ? 'Importando...'
              : `Importar ${validRows.length} questão(ões)`}
          </button>
        </div>
      )}

      {importResult && (
        <div className="flex items-center gap-3 p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800">
          <Check className="w-5 h-5 shrink-0" />
          <div>
            <p className="font-semibold">{importResult.upserted} questão(ões) importada(s) com sucesso!</p>
            <button
              onClick={() => { setRows([]); setFileName(''); setImportResult(null); onSuccess(); }}
              className="mt-1 text-sm underline hover:no-underline"
            >
              Ver questões
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
