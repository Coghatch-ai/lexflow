import type { ReactElement, ReactNode } from "react";

// Full-screen centered column for loading / empty / redirect states. Shared by
// the practice + review runners and the list pages so every screen's neutral
// state looks identical.
export function Centered({ children }: { children: ReactNode }): ReactElement {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center text-ink-mute">
      {children}
    </div>
  );
}
