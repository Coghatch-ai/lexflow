import { useEffect } from "react";

/**
 * Arms the browser's native "leave site?" prompt while a test is running, so
 * closing the tab or reloading does not silently drop the answers already
 * given (BR-05.1, slice S1 — the in-app exits get the real dialog).
 *
 * No custom UI is possible here: the text is the browser's. Recovering a run
 * after the tab is gone needs the server-side storage of a later slice.
 */
export function useLeaveWarning(armed: boolean): void {
  useEffect(() => {
    if (!armed) return;
    const handler = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      // preventDefault() is the modern signal; older engines act on the
      // returnValue ASSIGNMENT itself, whatever the value. Kept empty because
      // every current browser ignores the string and shows its own wording.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => {
      window.removeEventListener("beforeunload", handler);
    };
  }, [armed]);
}
