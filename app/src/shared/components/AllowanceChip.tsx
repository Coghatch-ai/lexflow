// app/src/shared/components/AllowanceChip.tsx
//
// Compat shim (D4, epic #50): the two separate balance pills are unified into ONE
// wallet fuel gauge. This re-exports WalletGauge so existing call sites keep
// working; the gauge reads credits.wallet (server-computed percent, no magnitude).

import type { ReactElement } from "react";
import WalletGauge from "./WalletGauge";

interface AllowanceChipProps {
  compact?: boolean;
}

export default function AllowanceChip({ compact = false }: AllowanceChipProps): ReactElement {
  return <WalletGauge compact={compact} />;
}
