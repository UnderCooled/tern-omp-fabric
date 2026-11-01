# PLAN — tern-omp-fabric

Beautify omp-fabric's `fabric_exec` blocks in Tern. Status: **planned, not started**.
Chunks are ordered; each is self-contained enough to hand to one `mechanic` subagent.
Owner tags: `[me]` = the session agent, `[mechanic]` = delegated, exact spec below.

## Symptoms (user-reported, ground truth)

1. In Tern, a `fabric_exec` block's command display is **truncated and cannot be expanded**.
2. Its output is **not as clear as in omp** (the TUI).

## Mechanism (verified, file:line evidence)

- Tern draws omp's transcript natively: each tool call becomes a TSP node tree built by
  `ToolExecutionComponent.describe()` (`@oh-my-pi/pi-tui/src/chat/tool-execution.ts:1024`).
- The native view comes from, in order: the tool's own `describeCall`/`describeResult`
  (`tool-execution.ts:1216-1260`) → the name-keyed built-in `toolRenderers[toolName]`
  (`tool-execution.ts:508`, gated by `hasBuiltInTool`, `pi-coding-agent/src/modes/controllers/tool-call-block.ts:26`)
  → `describeDefaultToolExecution` (`pi-tui/src/tools/default-renderer.ts:196`).
- `fabric_exec` is an **extension tool** (not built-in) and its definition has only
  `renderCall`/`renderResult` (`omp-fabric/src/fabric-exec-tool.ts:289,404`) — no describe hooks.
  So Tern falls back to the generic card: head target = args JSON truncated at 160 chars
  (`default-renderer.ts`, `NATIVE_ARGS_SUMMARY_CHARS`), body = `ansi(<whole result text>)`.
  **That is both symptoms.**
- `fabric_exec` is registered with `mergeCallAndResult: true` (`fabric-exec-tool.ts:219`), so in the
  native path the result view replaces the call view once a result exists.
- An extension can reach the registered definitions: `pi.pi` is the host's own
  `pi-coding-agent` barrel (`extensibility/extensions/loader.ts:211`, `extensibility/host-api.ts:4`),
  which exports `ExtensionRunner` (`src/index.ts:25`), and fabric itself already patches
  `ExtensionRunner.prototype.getAllRegisteredTools` (`omp-fabric/src/capture/interceptor.ts:104-119`).
  Patches compose by wrapping whatever function is present at install time.
- Hooks must be on the definition **before** `RegisteredToolAdapter` is built: the adapter copies
  keys through `applyToolProxy` getters defined at construction (`extensibility/tool-proxy.ts`),
  so a hook added later is invisible. Attaching inside the `getAllRegisteredTools` wrapper is
  early enough.

## Deliverable layout

```
tern-omp-fabric/            (repo root = the omp extension, like tern-omp-vimnav)
  package.json              omp manifest: {"omp":{"extensions":["./index.ts"]}}
  tsconfig.json
  index.ts                  extension entry: install the describe hooks
  src/attach.ts             registry patch + hook attach (no host imports at runtime)
  src/describe.ts           pure: args/details -> NativeToolView
  tests/describe.test.ts    bun test over the pure module
  tests/fixtures.ts         realistic fabric_exec args/details
  tern/plugin.toml          Tern plugin manifest (id "omp-fabric")
  tern/window.luau          one palette action: expand the focused omp pane's tool output
  README.md                 install, what changes, known limits
```

## Frozen interfaces (chunks depend on these)

```ts
// src/describe.ts  — type-only imports, plain object literals, no runtime host import
export type FabricExecArgs = { code?: string | string[]; payloads?: Record<string, string>; resultFormat?: string;
  tokenBudget?: number; agentBudget?: number; timeoutMs?: number; display?: unknown };
export type FabricAudit = { ref: string; tool?: string; provider?: string; success?: boolean; error?: string;
  args?: Record<string, unknown>; result?: unknown; resultTruncated?: boolean; fromTrace?: boolean;
  startedAt?: number; endedAt?: number };
export type FabricDetails = { success?: boolean; error?: string; progress?: string; outputFormat?: "yaml" | "json";
  outputFormatStartLine?: number; outputFormatLines?: number; phases?: string[]; audits?: FabricAudit[] };
export type DescribeOptions = { expanded?: boolean; isPartial?: boolean; argsComplete?: boolean;
  executionStarted?: boolean; json?: boolean; media?: boolean; elapsedMs?: number; cancelled?: boolean };

export function programText(args: FabricExecArgs | undefined): string;
export function codeLineCount(args: FabricExecArgs | undefined): number;
export function describeFabricCall(args: FabricExecArgs | undefined, options: DescribeOptions): NativeToolView | undefined;
export function describeFabricResult(result: { content?: unknown; details?: unknown; isError?: boolean },
  options: DescribeOptions, args?: FabricExecArgs): NativeToolView | undefined;

// src/attach.ts
export const HOOKS_MARK: symbol;                       // Symbol.for("tern-omp-fabric.describe.v1")
export function attachDescribeHooks(definition: unknown): boolean;   // true when it attached now
export function patchToolListing(hostApi: unknown): { ok: boolean; reason?: string };
export default function installFabricNative(hostApi: unknown): { ok: boolean; reason?: string };
```

## View spec (what "clearer" means, mirroring omp's own card)

Constants: `CALL_CODE_LINES=8`, `RESULT_CODE_LINES=4`, `AUDIT_RESULT_LINES=6`, `AUDITS_COLLAPSED=8`,
`AUDITS_EXPANDED=30`, `OUTPUT_LINES=12`, `ARG_VALUE_CHARS=120`.

Tool head (both views): `title "Fabric"`, `target` = first code line, `targetKind "command"`,
`lang "typescript"`, `command` = the **whole program** (so Copy command copies the program),
`meta` = [display.name?, `TypeScript · N lines`]; result view adds [`N calls`, `k failed`?, `P phases`?].
`preview: "children"` so each child clamps itself and the card's own expand still works.

Call view body: [`text(display.description, muted)`?, `code(program, {lang:"typescript", preview:{lines:8}, role:"omp-fabric.program"})`].
Result view body, in order:
1. program `code` (preview 4) — deliberate divergence from omp's TUI, which drops the code once the
   result replaces the call frame; the user's complaint is that the command is unreachable.
2. `row` of `badge` nodes, one per phase (role `omp-fabric.phase`).
3. one `section` per audit (role `omp-fabric.call`, `key = "call:<i>:<ref>"`), head = `[strong tool label, muted detail, muted " · 1.2s", error " · failed"]`;
   body = `kv` of scalar args (bounded) + result node (string → `ansi` preview 6; JSON-able → `json` when
   `options.json`, else `code(JSON.stringify, {lang:"json"})`; `fromTrace` without result → muted note);
   capped at 8 collapsed / 30 expanded, then `overflow`-style muted "N more calls".
4. `code(output, {lang: details.outputFormat, preview:{lines:12}, role:"omp-fabric.output"})` where output is
   the joined `content` text blocks.
Failure text (`details.error`, audit `error`) uses the `error` span token; tone stays host-derived.

## Chunks

### A. `src/describe.ts` — pure view builder `[me]`
Acceptance: exports of the frozen interface; no runtime `@oh-my-pi/*` import (type-only);
handles partial args (`argsComplete=false`, no code), empty output, >cap audits, `fromTrace` audits,
string and object results, `isError`/failed state.

### B. `src/attach.ts` + `index.ts` — wire it up `[me]`
Acceptance: `index.ts` default-exports the extension factory, calls `installFabricNative(pi.pi)`, logs the
reason via `pi.logger.debug` when it could not patch; never throws; idempotent across repeat loads;
attaches only to definitions named `fabric_exec`; composes with fabric's own patch.

### C. `tests/fixtures.ts` + `tests/describe.test.ts` `[mechanic]`
Acceptance: `bun test` green; assertions cover the frozen interface and the view spec invariants
(head command = full program, body kinds in order, per-child `preview.lines` values, audit cap,
`fromTrace` note, failure tokens) — behavior, not snapshots of internals.
**Reminder for the mechanic: use read/write/edit only. Do NOT call the bash tool — it errors here.**

### D. `package.json`, `tsconfig.json`, `.gitignore` `[mechanic]`
Acceptance: `{"omp":{"extensions":["./index.ts"]}}`, type module, devDeps
`@oh-my-pi/pi-coding-agent@18.14.2`, `@oh-my-pi/pi-tui@18.14.2`, `@types/bun`, `typescript`;
tsconfig strict, `noEmit`, module `Preserve`/`bundler`, include `index.ts src tests`; `.gitignore` = `node_modules/`.
Same no-bash reminder.

### E. `tern/plugin.toml` + `tern/window.luau` `[mechanic]`
Manifest: `schema=1`, `id="omp-fabric"` (free among installed ids), `name="omp fabric"`, `version="0.1.0"`,
`window="window.luau"` (a Tern plugin must name at least one entry).
`window.luau`: one `tern.command` (`id="expand_tools"`, group `"omp"`) that writes **Ctrl+O**
(`"\15"`) into the focused pane with `cx:run`, reusing tern-omp-vimnav's guard verbatim
(`cx.session:pane(pane)` → `kind == "agent"`, and the surface tree's `title == "omp"`), no-op otherwise.
Rationale: answers symptom 1 in one keystroke; omp's own key for it is `app.tools.expand` (Ctrl+O).
Same no-bash reminder.

### F. Verification `[me]`
1. `bun install`, `bun test`, `tsc --noEmit`.
2. `tern plugin link ./tern`; `tern plugin list` shows `omp-fabric ready`.
3. `omp plugin link .` and check the extension loads (omp log, target `tern::plugin` equivalent).
4. Smoke in a real Tern pane running omp: run a `fabric_exec` call, observe the code block, its
   expand affordance, per-call sections, output; then expand once with the palette action.
   Screenshots are forbidden on this workstation — observe in the pane, report what is seen.

### G. `README.md` `[me]`
Install (omp + tern halves), what changes, the deliberate divergences, limits (Tern-only; reused
session cards before the extension loads keep the generic look until reload).

## Open risks

- `ExtensionRunner` identity: if `pi.pi.ExtensionRunner` is not the live class (compiled binary bundling),
  the patch no-ops — `installFabricNative` reports it and the chunk B smoke test catches it.
  Fallback, if it happens: reuse fabric's chunk-scan approach (`capture/interceptor.ts:60-100`).
- `section`/`badge`/`json` inside a `tool` body: expected to work, unverified until the smoke test.
- Our describe hooks coexist with fabric's ANSI renderers; nothing ANSI-visible changes.

## Deferred (user's follow-up, recorded separately)

Rework omp-fabric's dashboard/settings/chat surfaces to be Tern-native (TSP `prefs`/`chart`/`list`,
`font = "sans"`, per docs/tern design guide). Not part of this plan.

---

## Status — implemented and verified (2026-11-01)

All chunks A–E are written; F and G are done except the one check only a person can make.

| Check | Result |
| --- | --- |
| `bun test` | 25 pass, 0 fail (describe behavior + the attach seam: composition with fabric's own patch, idempotence, frozen definitions) |
| `bun run typecheck` | clean (`tsc --noEmit`, strict, against `@oh-my-pi/pi-tui` 18.14.2 / `pi-coding-agent` 18.14.2) |
| `tern plugin link ./tern` → `tern plugin list` | `omp-fabric 0.1.0 omp fabric — 0 blocks, 0 lenses, window ready` |
| `luau-lsp analyze` on `tern/window.luau` | clean against generated tern definitions (the temp `tern.d.luau` was deleted after the check) |
| `omp plugin link .` → `omp plugin list` | `tern-omp-fabric@0.1.0` |
| Real `omp` process (headless `omp -p`) | log `~/.omp/logs/omp.*.log`: `tern-omp-fabric: fabric_exec describe hooks installed` — `pi.pi.ExtensionRunner` is reachable in the running host and the listing wrapper is in place |
| Live Tern pane | not observed by the agent (screen capture is forbidden on this workstation). Open a Tern pane, run any `fabric_exec` call, and the card should show the program block, phases, one section per nested call and the return value; palette row **omp fabric: expand tool output** sends Ctrl+O |

Fixed during verification: `installFabricNative` is a named export (not default); `callDetail`/section labels fold omp's namespaced refs (`omp.grep` → core tool `grep`) so titles and details match omp's own card.

Side observation, unrelated to this plugin: a headless `omp -p` run hung for its 600 s deadline because the configured model endpoint answered Cloudflare 524 and omp retried; its log shows no error from this extension.

