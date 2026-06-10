import { type ReactElement, type ReactNode } from 'react';
import { Shield } from 'lucide-react';
import { trpc } from '../shared/lib/trpc';

export function AdminGate({ children }: { children: ReactNode }): ReactElement {
  const me = trpc.users.me.useQuery();

  if (me.isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-ink-mute">
        Carregando...
      </div>
    );
  }

  if (me.data?.role !== 'admin') {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-center">
        <Shield className="w-10 h-10 text-ink-mute" strokeWidth={1.5} />
        <p className="text-lg font-semibold text-ink">Acesso restrito</p>
        <p className="text-sm text-ink-mute">Esta página requer permissão de administrador.</p>
      </div>
    );
  }

  return <>{children}</>;
}
