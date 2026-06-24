import { useMemo, useState, type ReactElement, type ReactNode } from "react";
import { PracticeContext, type PracticeResult } from "./practice-context";

export function PracticeStateProvider({ children }: { children: ReactNode }): ReactElement {
  const [discipline, setDiscipline] = useState("");
  const [result, setResult] = useState<PracticeResult | null>(null);
  const value = useMemo(
    () => ({ discipline, setDiscipline, result, setResult }),
    [discipline, result],
  );
  return <PracticeContext.Provider value={value}>{children}</PracticeContext.Provider>;
}
