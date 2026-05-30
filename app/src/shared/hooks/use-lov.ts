// app/src/shared/hooks/use-lov.ts
//
// The single source of picklist options + pt-BR labels in the UI. Components
// pass a LOV `type` (e.g. "DISCIPLINE") and render `options` in a dropdown,
// storing `option.code` and showing `labelOf(code)` — never a hardcoded pt-BR
// string. Backed by the public `lov.list` procedure.

import { trpc } from "@/shared/lib/trpc";

export type LovOption = { code: string; value: string };

export type UseLovResult = {
  options: LovOption[];
  labelOf: (code: string) => string;
  isLoading: boolean;
};

export function useLov(type: string): UseLovResult {
  const query = trpc.lov.list.useQuery({ type }, { staleTime: 60 * 60 * 1000 });
  const options = query.data ?? [];
  return {
    options,
    labelOf: (code) => options.find((o) => o.code === code)?.value ?? code,
    isLoading: query.isLoading,
  };
}
