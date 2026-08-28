// scripts/check-migrations.ts
//
// Pre-push migration gate — `pnpm db:migrate:check`, run by .husky/pre-push
// BEFORE `pnpm validate`. Blocks a push that PUBLISHES a `drizzle/*.sql` which
// was never applied locally (merge/deploy ≠ migrated: CI ships code only and the
// DB sits in a no-NAT VPC — see .claude/library/migration-deploy-contract.md).
//
// Replaces the retired agent-only hook .claude/hooks/guard-migrate-push.mjs:
// being a git hook, this also covers the HUMAN's own terminal `git push`.
//
// This file is the impure SHELL (git + fs + stdin + env + exit codes). All
// decision logic is pure in scripts/lib/migration-guard.ts and unit-tested there.
//
// WHAT the push publishes comes from the pre-push STDIN (one line per ref:
// `<localref> <localsha> <remoteref> <remotesha>`), never from HEAD. Measuring
// `origin/main...HEAD` was the third bypass found on #74: `git push origin
// mig:mig` from a checked-out `main`, `git push --all` and `push.default=matching`
// all publish refs HEAD knows nothing about, so the gate saw zero candidates and
// waved unapplied SQL through. With no stdin (a direct `pnpm db:migrate:check`)
// we fall back to `HEAD`.
//
// WHICH UNIVERSE we measure is itself pure (`planMeasurement`), after the FOURTH
// bypass on #74: the shell used to fall back to `allSqlOnDisk()` whenever the
// diff was impossible, swapping the push for the worktree. A clone whose remote
// is not named `origin` (fork / `git remote rename`) then degraded on EVERY push
// and, with the disk fully applied, passed in silence. Now: no stdin ⇒ worktree
// (and say so); fed by git ⇒ block.
//
// The FIFTH residue (same class, next review round): a WORKING diff over a LOST
// feed measured `HEAD` and passed with zero output. `planMeasurement` now also
// takes `remoteArg` — git always invokes `pre-push` with `<remote> <url>`, a
// hand run has no argv — so a real push whose feed is absent/garbled is BLOCKED
// instead of silently re-pointed at `HEAD`.
//
// ROUND 6 split the EMPTY feed out of that rule. git starts `pre-push` before
// filtering refs that are already up to date, so an ordinary `git push` with
// nothing new arrives as zero bytes on fd 0 — and blocking the most routine push
// there is would get the gate disabled, which protects nothing. An empty feed now
// concludes NOTHING: the gate measures `HEAD` against `<remote>/main` and decides
// on what it finds (clean ⇒ pass, unapplied `.sql` ⇒ block, diff impossible ⇒
// block). Verified, not assumed — and `absent`/`garbled` still block.
//
// ROUND 7 asked HOW that emptiness arrived, not just what was on it. git opens a
// PIPE on fd 0 for `pre-push` even with zero refs to write, and the FIFO survives
// the whole husky → pnpm → tsx chain (measured); a feed swallowed WITHOUT a pipe
// — `</dev/null`, `0<&-`, an empty regular file — arrives as a character device
// or a regular file. So an empty feed on a pipe keeps the head-fallback (the
// routine no-op push still passes), while an empty feed on any non-pipe channel
// BLOCKS. `fstat` itself throwing counts as NOT a FIFO: fail closed.
// This is a DISCRIMINATOR, not a proof of provenance: it excludes non-pipe
// suppression only. Any pipe-shaped fd 0 carrying zero bytes — process
// substitution (`< <(printf "")`), `mkfifo`, a drained genuine feed — reads
// `fifo` exactly like git's own feed and still takes the fallback. That is the
// documented residue (contract `### Limits (honest)`), narrowed by round 7, not
// removed.
//
// The base ref comes from the remote name git passes `pre-push` as `$1`
// (`<remote-name> <remote-url>`), forwarded by `.husky/pre-push` as
// `pnpm db:migrate:check "$@"` — see `resolveBaseRef`. No argv ⇒ `origin/main`.
//
// Decision matrix:
//   • push only DELETES refs (all-zero local sha) ⇒ publishes nothing ⇒ pass;
//   • push only DELETES `.sql` (status `D`)       ⇒ nothing to apply ⇒ pass;
//   • no `.sql` published by this push            ⇒ pass, silently, WITHOUT even
//     reading the marker (it is gitignored, so a fresh clone must never be
//     falsely blocked on a docs-only push);
//   • published `.sql` + marker missing/invalid   ⇒ FAIL CLOSED;
//   • git / `<remote>/main` unavailable ON A REAL PUSH ⇒ FAIL CLOSED: we cannot
//     tell what the push publishes and the worktree does not answer for it;
//   • REAL PUSH (argv present) with an ABSENT/GARBLED ref feed ⇒ FAIL CLOSED:
//     the only thing left to measure would be `HEAD`, another universe;
//   • REAL PUSH with an EMPTY ref feed ON A PIPE (the shape git's own feed always
//     has, and the most any check here can establish) ⇒ measure `HEAD`
//     against the base and decide on the result: clean ⇒ pass (announced),
//     unapplied `.sql` ⇒ block, diff impossible ⇒ block;
//   • REAL PUSH with an EMPTY ref feed on a channel that is NOT a pipe (or whose
//     `fstat` fails) ⇒ FAIL CLOSED: git cannot have handed us that emptiness;
//   • same, but on a hand run with NO stdin        ⇒ conservative pass over every
//     `drizzle/**/*.sql` on disk, ANNOUNCED (never silent);
//   • `drizzle/` itself unreadable                ⇒ FAIL CLOSED, loudly (we
//     cannot even enumerate what we'd be protecting);
//   • stale marker entries for files that no longer exist ⇒ harmless.
//
// Paths resolve from the REPO ROOT (`git rev-parse --show-toplevel`), not the
// cwd, so `pnpm db:migrate:check` run from a subdirectory can no longer exit 0
// on an empty pathspec.
//
// Escape hatches (documented, not secret): MIGRATE_GUARD_SKIP=1, git push
// --no-verify, HUSKY=0.

import { execFileSync } from "node:child_process";
import { fstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FEED_LOST_REASON,
  FEED_NOT_FIFO_REASON,
  classifyFeedChannel,
  classifyPublishedSql,
  findUnappliedMigrations,
  parseAppliedMarker,
  planMeasurement,
  resolveBaseRef,
  resolveDiffTips,
  type FeedChannel,
  type MeasurementPlan,
} from "./lib/migration-guard";

const DRIZZLE_DIR = "drizzle";
const MARKER_PATH = "drizzle/meta/_applied.json";

/** Result of trying to read what the pushed tips publish. */
type DiffOutcome =
  | { readonly kind: "measured"; readonly files: string[] }
  | { readonly kind: "failed"; readonly reason: string };

function git(args: readonly string[], cwd: string): string {
  return execFileSync("git", [...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** Repo root, so every path below is independent of the caller's cwd. */
function repoRoot(): string | null {
  try {
    const root = git(["rev-parse", "--show-toplevel"], process.cwd()).trim();
    return root === "" ? null : root;
  } catch {
    return null;
  }
}

/**
 * The pre-push ref list git feeds us on stdin, or `null` when there is none.
 *
 * A TTY means a human ran `pnpm db:migrate:check` by hand — reading fd 0 there
 * would block forever, so we report "no stdin" and the pure core falls back to
 * `HEAD`.
 */
function readPushRefs(): string | null {
  if (process.stdin.isTTY === true) return null;
  try {
    return readFileSync(0, "utf8");
  } catch {
    return null;
  }
}

/**
 * HOW fd 0 arrived, asked of the OS rather than of the bytes: git opens a pipe
 * for `pre-push` even when it has no refs to write, and that FIFO survives the
 * `git` → `.husky/_/h` → `pre-push` → `pnpm` → `tsx` chain. `</dev/null`,
 * `0<&-`, or a wrapper substituting a NON-PIPE stream shows up as a character
 * device or a regular file. A pipe-shaped substitute (process substitution,
 * `mkfifo`) does not: `isFIFO()` says "pipe", never "git". `fstat` throwing ⇒
 * `not-fifo` (handled inside `classifyFeedChannel`) ⇒ fail closed.
 */
function readFeedChannel(): FeedChannel {
  return classifyFeedChannel(() => fstatSync(0).isFIFO());
}

/**
 * Every migration on disk — the conservative universe of a HAND RUN that could
 * not diff (never of a real push: see `planMeasurement`). Recursive, so a `.sql`
 * parked in a subfolder of `drizzle/` is not invisible. `null` ⇒ the directory
 * could not be read at all.
 */
function allSqlOnDisk(root: string): string[] | null {
  try {
    return readdirSync(join(root, DRIZZLE_DIR), { encoding: "utf8", recursive: true })
      .map((entry) => entry.replace(/\\/g, "/"))
      .filter((entry) => entry.endsWith(".sql"))
      .map((entry) => `${DRIZZLE_DIR}/${entry}`)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return null;
  }
}

/**
 * The remote NAME git passes `pre-push` as `$1` (`<remote-name> <remote-url>`),
 * forwarded by `.husky/pre-push` (`pnpm db:migrate:check "$@"`). Absent on a
 * hand run ⇒ `null` ⇒ `resolveBaseRef` uses `origin/main`.
 */
function pushRemoteArg(): string | null {
  const arg = process.argv[2];
  return arg === undefined || arg.trim() === "" ? null : arg.trim();
}

/** The `drizzle/*.sql` files this push publishes, across every pushed tip. */
function publishedMigrations(root: string, tips: readonly string[], baseRef: string): DiffOutcome {
  const remote = baseRef.split("/")[0] ?? "origin";
  try {
    git(["rev-parse", "--verify", "--quiet", `${baseRef}^{commit}`], root);
  } catch {
    return {
      kind: "failed",
      reason: `não foi possível resolver \`${baseRef}\` (rode \`git fetch ${remote}\`)`,
    };
  }

  const files = new Set<string>();
  for (const tip of tips) {
    let nameStatus: string;
    try {
      nameStatus = git(["diff", "--name-status", `${baseRef}...${tip}`, "--", DRIZZLE_DIR], root);
    } catch {
      return { kind: "failed", reason: `\`git diff ${baseRef}...${tip}\` falhou` };
    }
    for (const file of classifyPublishedSql(nameStatus.split("\n"))) files.add(file);
  }

  return { kind: "measured", files: [...files].sort((a, b) => a.localeCompare(b)) };
}

function readMarker(root: string): string | null {
  try {
    return readFileSync(join(root, MARKER_PATH), "utf8");
  } catch {
    return null;
  }
}

/**
 * How the candidate set was obtained when it was NOT the pushed tips: the
 * hand-run disk universe, or the empty-feed `HEAD` measurement. `null` ⇒ the
 * normal path (git's ref feed). Never silent in either non-normal case.
 */
type FallbackNote =
  | { readonly kind: "worktree"; readonly reason: string }
  | { readonly kind: "head-fallback"; readonly reason: string }
  | null;

/** Where the blocked candidates came from, for the pt-BR sentence. */
function blockedOrigin(note: FallbackNote): string {
  if (note === null) return "que este push publica e";
  if (note.kind === "worktree") return "encontradas no disco e";
  return "que `HEAD` publica e";
}

function reportBlocked(unapplied: readonly string[], note: FallbackNote): void {
  console.error("");
  console.error("✗ Push bloqueado: migração não aplicada neste banco local.");
  if (note !== null && note.kind === "worktree") {
    console.error(
      `  (modo conservador — execução manual sem stdin: ${note.reason}; universo = todas as migrações do disco)`,
    );
  }
  if (note !== null && note.kind === "head-fallback") {
    console.error(`  (feed de refs vazio: ${note.reason}; universo = o que \`HEAD\` publica)`);
  }
  console.error("");
  const origem = blockedOrigin(note);
  console.error(`  ${unapplied.length} migração(ões) ${origem} que não constam em`);
  console.error(`  ${MARKER_PATH}:`);
  for (const file of unapplied) console.error(`    • ${file}`);
  console.error("");
  console.error("  Rode `pnpm db:migrate` e tente o push de novo.");
  console.error(
    "  A CI NÃO aplica migrações (deploy só publica código; o banco está em VPC sem NAT):",
  );
  console.error("  merge/deploy ≠ migrado. Ver .claude/library/migration-deploy-contract.md.");
  console.error("  (Bypass intencional: MIGRATE_GUARD_SKIP=1 git push)");
  console.error("");
}

/**
 * A REAL push whose published SQL we could not read at all — fail closed.
 * Substituting the worktree here was the fourth bypass (#74).
 */
function reportUnknowable(reason: string): void {
  console.error("");
  console.error("✗ Push bloqueado: não foi possível determinar o que este push publica.");
  console.error(`  Motivo: ${reason}`);
  console.error("");
  console.error("  O gate NÃO troca o push pela árvore de trabalho: o que está em check-out não");
  console.error("  responde pelo que o push publica (um `.sql` pode estar só no ref empurrado).");
  console.error("  Sem conseguir diffar, o gate falha FECHADO.");
  console.error("");
  printUnknowableHint(reason);
  console.error("  (Bypass intencional: MIGRATE_GUARD_SKIP=1 git push)");
  console.error("");
}

/** The actionable half of `reportUnknowable`, one hint per block reason. */
function printUnknowableHint(reason: string): void {
  if (reason === FEED_LOST_REASON) {
    console.error("  O `pre-push` recebe do git a lista de refs no stdin. Ela chegou ausente ou");
    console.error("  ilegível, então algum wrapper na cadeia (`git` → `.husky/_/h` → `pre-push` →");
    console.error("  `pnpm` → `tsx`) mexeu no stdin. Rode o push direto pelo `git`.");
    console.error(
      "  (Um feed VAZIO chegando NUM PIPE é outro caso — é o que o push já atualizado produz —",
    );
    console.error("  e ali o gate mede `HEAD` contra a base em vez de bloquear.)");
    return;
  }
  if (reason === FEED_NOT_FIFO_REASON) {
    console.error("  O git entrega a lista de refs num PIPE no fd 0 — inclusive quando ela está");
    console.error("  vazia (push já atualizado), e esse pipe sobrevive à cadeia `git` →");
    console.error("  `.husky/_/h` → `pre-push` → `pnpm` → `tsx`. Aqui o fd 0 veio vazio e NÃO era");
    console.error("  um pipe, então quem respondeu não foi o git: `</dev/null`, `0<&-` ou algum");
    console.error("  wrapper trocou o stdin por algo que não é pipe. Rode o push direto pelo");
    console.error("  `git`, sem redirecionar o stdin do hook. (O teste é a FORMA do fd 0, não a");
    console.error("  origem: um pipe vazio qualquer ainda passa pelo caminho do `HEAD`.)");
    return;
  }
  console.error(
    "  Rode `git fetch <remoto>` (o gate compara contra `<remoto>/main`) e tente de novo.",
  );
}

/**
 * The documented escape hatch, made AUDIBLE. `.husky/_/h` sources
 * `${XDG_CONFIG_HOME:-$HOME/.config}/husky/init.sh`, so an exported
 * `MIGRATE_GUARD_SKIP=1` would otherwise disable the gate forever without ever
 * saying so — `--no-verify` at least shows up on the command line.
 */
function reportSkipped(): void {
  console.warn("");
  console.warn("⚠ Gate de migração DESLIGADO por MIGRATE_GUARD_SKIP=1 — nada foi verificado.");
  console.warn(
    "  Se você não digitou isso agora, a variável está exportada no ambiente (perfil do",
  );
  console.warn("  shell ou ~/.config/husky/init.sh, que o husky carrega em todo hook): remova-a.");
  console.warn("");
}

/**
 * Degraded but PASSING — must never be silent: a quiet degraded pass is
 * indistinguishable from a real verification, which is how the fourth bypass
 * stayed invisible (#74).
 */
function reportDegradedPass(reason: string, checked: number): void {
  console.warn("");
  console.warn("⚠ Gate de migração em MODO CONSERVADOR (não verificou um push).");
  console.warn(`  Motivo: ${reason}`);
  console.warn(
    `  Universo medido: ${checked} arquivo(s) \`${DRIZZLE_DIR}/**/*.sql\` do disco — todos constantes em`,
  );
  console.warn(
    `  ${MARKER_PATH}. Execução manual sem stdin de \`pre-push\`, então NÃO há push a medir.`,
  );
  console.warn("  Isto NÃO é uma verificação de push: num push real este mesmo motivo BLOQUEIA.");
  console.warn("");
}

/**
 * The empty-feed path PASSED — say what was actually measured. This pass is
 * verified (a real `git diff <base>...HEAD`), not assumed, but it measured
 * `HEAD` and not the pushed tip, so it never pretends to be the normal path.
 */
function reportHeadFallbackPass(reason: string, checked: number): void {
  console.warn("");
  console.warn("⚠ Gate de migração: feed de refs vazio — medi `HEAD` em vez do ref empurrado.");
  console.warn(`  Motivo: ${reason}`);
  console.warn(
    `  Universo medido: ${checked} arquivo(s) \`${DRIZZLE_DIR}/*.sql\` publicados por \`HEAD\` — todos`,
  );
  console.warn(`  constantes em ${MARKER_PATH}. Push liberado por MEDIÇÃO, não por suposição.`);
  console.warn("");
}

function reportBlind(degradedReason: string | null): void {
  console.error("");
  console.error("✗ Push bloqueado: o gate de migração não conseguiu inspecionar `drizzle/`.");
  if (degradedReason !== null) console.error(`  Motivo: ${degradedReason}`);
  console.error("");
  console.error("  Sem conseguir listar as migrações, o gate falha FECHADO por definição —");
  console.error("  não dá para afirmar que este push não publica SQL não aplicado.");
  console.error("  Rode o push da raiz do repositório (git disponível) ou, se for intencional,");
  console.error("  MIGRATE_GUARD_SKIP=1 git push.");
  console.error("");
}

/**
 * What the plan says to look at: the diffed push, the diffed `HEAD` (empty-feed
 * fallback — same `outcome`, since the shell already diffed `HEAD` as the only
 * tip), or (hand run only) the disk.
 */
function candidateFiles(
  plan: MeasurementPlan,
  outcome: DiffOutcome,
  root: string,
): string[] | null {
  if (plan.kind === "worktree") return allSqlOnDisk(root);
  return outcome.kind === "measured" ? outcome.files : [];
}

/** The non-normal universes, carried to whichever report ends up printing. */
function fallbackNote(plan: MeasurementPlan): FallbackNote {
  if (plan.kind === "worktree") return { kind: "worktree", reason: plan.reason };
  if (plan.kind === "head-fallback") return { kind: "head-fallback", reason: plan.reason };
  return null;
}

/** A pass that did NOT measure the pushed tips is announced, never silent. */
function reportFallbackPass(note: FallbackNote, checked: number): void {
  if (note === null) return;
  if (note.kind === "worktree") reportDegradedPass(note.reason, checked);
  else reportHeadFallbackPass(note.reason, checked);
}

function main(): void {
  if (process.env["MIGRATE_GUARD_SKIP"] === "1") {
    reportSkipped();
    return;
  }

  // Channel FIRST, before anything reads fd 0 — what we ask the OS about must be
  // the descriptor as git handed it over.
  const feedChannel = readFeedChannel();
  const rawStdin = readPushRefs();
  const tips = resolveDiffTips(rawStdin);
  if (tips.length === 0) return; // push só apaga refs — não publica SQL nenhum

  const remoteArg = pushRemoteArg();
  const root = repoRoot();
  const outcome: DiffOutcome =
    root === null
      ? {
          kind: "failed",
          reason:
            "`git rev-parse --show-toplevel` falhou (git indisponível ou fora de um repositório)",
        }
      : publishedMigrations(root, tips, resolveBaseRef(remoteArg));

  const plan = planMeasurement({
    rawStdin,
    tips,
    failure: outcome.kind === "failed" ? outcome.reason : null,
    remoteArg,
    feedChannel,
  });
  if (plan.kind === "block") {
    reportUnknowable(plan.reason);
    process.exit(1);
  }

  const note = fallbackNote(plan);
  const files = candidateFiles(plan, outcome, root ?? process.cwd());
  if (files === null) {
    reportBlind(note === null ? null : note.reason);
    process.exit(1);
  }
  if (files.length === 0) {
    reportFallbackPass(note, 0);
    return; // nada a proteger — nem lê o marcador
  }

  const marker = readMarker(root ?? process.cwd());
  const unapplied = findUnappliedMigrations(files, parseAppliedMarker(marker));
  if (unapplied.length === 0) {
    reportFallbackPass(note, files.length);
    return;
  }

  reportBlocked(unapplied, note);
  process.exit(1);
}

main();
