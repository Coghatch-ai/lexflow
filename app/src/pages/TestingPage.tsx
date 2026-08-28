// The Simulado screen: picks a mode, then hands over to that mode's own
// component. Since slice S2b (#77) the Simulado Padrão lives in
// `testing-standard-run.tsx` (setup + resume) and `testing-standard-board.tsx`
// (the run) — a pure extraction done BEFORE the persistence wiring, because
// the wiring does not fit the lint budgets otherwise (`eslint.config.js:147-151`).
//
// The mode picker also carries the INTENT: `resume` continues the run
// `examDrafts.list` is offering on that mode's card, `new` starts a fresh one.

import { useState, type ReactElement } from 'react';
import AdaptiveSimulation from '../components/AdaptiveSimulation';
import SpacedRepetition from '../components/SpacedRepetition';
import RealExamSimulation from '../components/RealExamSimulation';
import StandardRun from './testing-standard-run';
import { ModeSelection, type Mode, type StartIntent } from './testing-mode-selection';

export default function TestingPage(): ReactElement {
  const [mode, setMode] = useState<Mode | null>(null);
  const [intent, setIntent] = useState<StartIntent>('new');

  if (mode === 'adaptive') {
    return <AdaptiveSimulation intent={intent} onExit={() => { setMode(null); }} />;
  }
  if (mode === 'spaced') {
    return <SpacedRepetition intent={intent} onExit={() => { setMode(null); }} />;
  }
  if (mode === 'real') return <RealExamSimulation onExit={() => { setMode(null); }} />;

  if (mode === null) {
    return (
      <ModeSelection
        onSelect={(picked, pickedIntent) => {
          setIntent(pickedIntent);
          setMode(picked);
        }}
      />
    );
  }

  return <StandardRun intent={intent} onExitToModes={() => { setMode(null); }} />;
}
