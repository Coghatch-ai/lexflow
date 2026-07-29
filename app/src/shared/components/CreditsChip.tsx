// app/src/shared/components/CreditsChip.tsx
//
// Compat shim (D4, epic #50): unified into ONE wallet fuel gauge. Re-exports
// WalletGauge so existing call sites keep working; the gauge reads credits.wallet
// (server-computed percent, no magnitude, no client reset logic).

import type { ReactElement } from "react";
import WalletGauge from "./WalletGauge";

interface CreditsChipProps {
  compact?: boolean;
}

export default function CreditsChip({ compact = false }: CreditsChipProps): ReactElement {
  return <WalletGauge compact={compact} />;
}
