// The Simulado Real between 00:00 and its settlement (BR-05.5, epic #67 slice
// S2d — second audit round of #79). Presentational only: the copy comes from
// `deadlineSubmittingNotice` in `real-exam-failures.ts`.
//
// Why it is not the failure card with softer words: this screen is the NORMAL
// end of every prova real taken to the deadline, and the failure card is an
// alarm with a retry button. Rendering that alarm over a healthy send told
// every student their answers "ainda NÃO chegaram ao servidor" while they were
// on their way. There is nothing to do here and nothing to retry — so there is
// no button at all, and the only job is to keep the page open.

import type { ReactElement } from 'react';
import { Loader2 } from 'lucide-react';
import type { RealNotice } from './real-exam-failures';

interface RealExamSubmittingCardProps {
  notice: RealNotice;
}

export default function RealExamSubmittingCard({
  notice,
}: RealExamSubmittingCardProps): ReactElement {
  return (
    <div className="bg-white rounded-xl p-6 shadow">
      <div className="flex items-start gap-3 mb-4">
        <Loader2 className="w-6 h-6 text-[#16161a] flex-shrink-0 mt-0.5 animate-spin" />
        <h3 className="text-xl font-bold text-[#16161a]">{notice.title}</h3>
      </div>

      <div className="bg-gray-50 border-2 border-gray-200 rounded-lg p-4">
        <p className="text-sm text-gray-700">{notice.body}</p>
      </div>
    </div>
  );
}
