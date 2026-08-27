import { describe, it, expect } from "vitest";
import { exitPrompt } from "./exit-rules";
import {
  decideNavigation,
  guardSaveOutcome,
  isRunGuarded,
  offersSaveAndExit,
  pickActiveRun,
  type RunRegistration,
} from "./run-guard";

// Navigation guard for a test still running (BR-05.1, epic #67 slice S1b).
// Plain vitest: the whole decision lives in a pure module, so leaving through
// the sidebar is provable without RTL/jsdom.

function run(over: Partial<RunRegistration> = {}): RunRegistration {
  return {
    id: "r1",
    mode: "standard",
    running: true,
    answeredCount: 3,
    totalQuestions: 10,
    ...over,
  };
}

describe("decideNavigation", () => {
  it("prompts with the SAME prompt exit-rules builds when leaving an armed run", () => {
    // The regression: the sidebar used to navigate unconditionally. The deep
    // equality is the second half of the guard — it proves no second set of
    // rules was born inside run-guard.ts.
    const decision = decideNavigation(run(), "/testing", "/analytics");

    expect(decision.action).toBe("prompt");
    if (decision.action !== "prompt") throw new Error("expected a prompt");
    expect(decision.prompt).toEqual(exitPrompt("standard", 3, 10));
  });

  it("navigates when the target is the page already open", () => {
    expect(decideNavigation(run(), "/testing", "/testing").action).toBe("navigate");
  });

  it("navigates with nothing answered — there is nothing to process", () => {
    expect(decideNavigation(run({ answeredCount: 0 }), "/testing", "/analytics").action).toBe(
      "navigate",
    );
  });

  it("navigates when the run is not running (mode selection or result screen)", () => {
    expect(decideNavigation(run({ running: false }), "/testing", "/analytics").action).toBe(
      "navigate",
    );
  });

  it("navigates when no screen is registered", () => {
    expect(decideNavigation(null, "/analytics", "/goals").action).toBe("navigate");
  });

  it("carries the prova real warning and labels (BR-05.5) through the sidebar too", () => {
    const decision = decideNavigation(
      run({ mode: "real", totalQuestions: 80 }),
      "/testing",
      "/goals",
    );

    if (decision.action !== "prompt") throw new Error("expected a prompt");
    expect(decision.prompt.warning).toContain("não pode ser salva");
    expect(decision.prompt.quitLabel).toBe("Encerrar e processar respostas");
  });

  it("prompts on logout, where there is no target path", () => {
    expect(decideNavigation(run(), "/testing", null).action).toBe("prompt");
  });
});

describe("pickActiveRun", () => {
  it("skips an idle registration and returns the armed one", () => {
    // TestingPage stays mounted while it renders the other modes, so its own
    // idle registration must never mask the mode actually running.
    const idle = run({ id: "testing-page", running: false });
    const armed = run({ id: "adaptive", mode: "adaptive" });

    expect(pickActiveRun([idle, armed])).toBe(armed);
  });

  it("returns null when nothing is armed", () => {
    const runs = [
      run({ id: "a", running: false }),
      run({ id: "b", mode: "adaptive", running: false }),
    ];

    expect(pickActiveRun(runs)).toBeNull();
    expect(isRunGuarded(null)).toBe(false);
  });
});

// Whether the third button exists at all (BR-05.3 / BR-05.5, slices S2b+S2d).
// The prova real persists since S2d, and persisting is exactly what could make
// someone "restore" a save handler to it — so the refusal is locked in a test
// instead of in a review comment.
describe("offersSaveAndExit", () => {
  const saveHandler = (): Promise<boolean> => Promise.resolve(true);

  it("offers it on a study mode that registered a save handler", () => {
    expect(offersSaveAndExit(exitPrompt("standard", 3, 10), saveHandler)).toBe(true);
  });

  it("REFUSES it on the prova real even with a save handler registered", () => {
    // The rule is the mode's, not the screen's: a prova real that persists is
    // persisting to be auto-submitted, never to be picked back up (BR-05.5).
    expect(offersSaveAndExit(exitPrompt("real", 5, 80), saveHandler)).toBe(false);
  });

  it("refuses it on the prova real as this slice actually registers it — with NO handler", () => {
    expect(offersSaveAndExit(exitPrompt("real", 5, 80), undefined)).toBe(false);
    expect(exitPrompt("real", 5, 80).saveLabel).toBeNull();
    expect(exitPrompt("real", 5, 80).optionCount).toBe(2);
  });

  it("refuses it on a study mode whose screen registered no handler", () => {
    expect(offersSaveAndExit(exitPrompt("spaced", 2, 5), undefined)).toBe(false);
  });
});

// "Salvar e sair" through the SIDEBAR (BR-05.3, slice S2b). The guard's dialog
// is `z-50` and painted after the screen, so whatever it does after the save
// decides whether the student can SEE the failure the screen just raised.
describe("guardSaveOutcome", () => {
  it("navigates only once the run is safely on the server", () => {
    expect(guardSaveOutcome(true)).toEqual({ navigate: true, closeDialog: true });
  });

  it("closes the guard dialog on a FAILED save, so the screen's message is visible", () => {
    // The regression: the guard kept its dialog up on `false`, and the failure
    // (and the CONFLICT) dialog was born behind its backdrop. The student saw
    // the unchanged dialog and clicked into the void.
    expect(guardSaveOutcome(false).closeDialog).toBe(true);
  });

  it("never navigates on a failed save — nothing was saved, so nothing may leave", () => {
    expect(guardSaveOutcome(false).navigate).toBe(false);
  });
});
