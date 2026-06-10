import type { AdminQuestionInput } from '@shared/domain/admin-question';

export const CSV_HEADER =
  'id,question_text,option_a,option_b,option_c,option_d,correct_answer,legal_basis,explanation,legislation_link,legislation_title,difficulty,discipline,topic,exam_board,year,phase';

export function splitCSVRow(row: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (ch === '"') {
      if (inQuotes && row[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current); current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

export function parseCSVText(text: string): Record<string, string | undefined>[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = splitCSVRow(lines[0]).map((h) => h.trim().replace(/^\uFEFF/, ''));
  return lines.slice(1).map((line) => {
    const values = splitCSVRow(line);
    const obj: Record<string, string | undefined> = {};
    headers.forEach((h, i) => { obj[h] = (values.at(i) ?? '').trim(); });
    return obj;
  });
}

function getStr(row: Record<string, string | undefined>, key: string): string {
  return row[key] ?? '';
}

export function csvRowToInput(row: Record<string, string | undefined>): AdminQuestionInput {
  const idRaw = getStr(row, 'id').trim();
  const yearRaw = parseInt(getStr(row, 'year'), 10);
  const yearVal = Number.isNaN(yearRaw) ? 2024 : yearRaw;
  const diffStr = getStr(row, 'difficulty');
  const phaseStr = getStr(row, 'phase');
  return {
    id: idRaw.length > 0 ? idRaw : undefined,
    questionText: getStr(row, 'question_text'),
    options: [getStr(row, 'option_a'), getStr(row, 'option_b'), getStr(row, 'option_c'), getStr(row, 'option_d')],
    correctAnswer: getStr(row, 'correct_answer'),
    legalBasis: getStr(row, 'legal_basis'),
    explanation: getStr(row, 'explanation'),
    legislationLink: getStr(row, 'legislation_link'),
    legislationTitle: getStr(row, 'legislation_title'),
    difficulty: (diffStr.length > 0 ? diffStr : 'medium') as 'easy' | 'medium' | 'hard',
    discipline: getStr(row, 'discipline'),
    topic: getStr(row, 'topic'),
    examBoard: getStr(row, 'exam_board'),
    year: yearVal,
    phase: (phaseStr.length > 0 ? phaseStr : '1st') as '1st' | '2nd',
  };
}

export function downloadTemplate(): void {
  const example =
    ',Qual é o prazo prescricional geral do Código Civil?,3 anos,5 anos,10 anos,20 anos,10 anos,CC/2002 Art. 205,O prazo prescricional geral é de 10 anos conforme o Art. 205 do CC.,,Código Civil,medium,CIVIL_LAW,Prescrição,FGV,2023,1st';
  const content = `${CSV_HEADER}\n${example}\n`;
  const blob = new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'questoes_template.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export const BLANK_FORM: AdminQuestionInput = {
  id: '',
  questionText: '',
  options: ['', '', '', ''],
  correctAnswer: '',
  legalBasis: '',
  explanation: '',
  legislationLink: '',
  legislationTitle: '',
  difficulty: 'medium',
  discipline: '',
  topic: '',
  examBoard: 'FGV',
  year: 2024,
  phase: '1st',
};

