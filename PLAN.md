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

## Revision 2026-11-01, twenty-fourth pass (no block for a capped details)

Half the `omp.edit` audits in this session's transcript carry `details` as `{fabricTruncated,
originalChars, preview}`: fabric replaces a details object serialising past 16 KB with its own JSON
text, cut at 15 900 chars. A prefix of a diff reads as the whole change, so those calls now draw no
output block and no `(no output)` marker either — `cappedDetails` is what tells `outputNode` and
`callBlock` apart, and the line keeps just the tool, the file and the duration. The `[README.md]`
first line of an edit's `output` was never involved: nothing in the diff path reads `output`. A
recovered-prefix renderer was tried and removed; measured on a real 34 570-char audit it produced 6
of the change's rows, which is the misleading half-fact this rule avoids.

## Revision 2026-11-01, twenty-third pass (a bash command is a code block)

`bashCommand` takes `args.command` whole for a bash call; `fencedCommand` wraps it in a fence longer
than any backtick run inside it, and `callBlock` drops that as an `md` node (role `omp-fabric.command`)
right after the call line, so Tern's markdown renderer supplies the language head, the Copy button and
the code background. `callHead` no longer puts a
one-line `$ …` copy of it in the line. Nothing collapses it: the block is the call's subject, not a
detail. It sits inside a `row` behind a 2ch spacer, so the block lines up under the call label
instead of starting left of it, and `tern/style.css` rings the fence and turns its sideways scroll
into wrapped lines (the fence markup itself is kit's, so that last rule is inner DOM).

`bun test` 45 pass / 0 fail, `bun run typecheck` clean, `oxlint` exit 0; smoke: a bash audit renders
`bash · 41ms`, then a `row` of the 2ch spacer and the `md` fence, then the output fold.

## Revision 2026-11-01, twenty-second pass (display is per tool)

fabric exposes 148 actions in this session (`tools.list`): `omp` 6 (read, bash, edit, write, grep, find),
`extensions` 61, `agents` 40, `mesh` 8, `state` 7, `schema` 5, `components` 4, `mcp` 4, `compact`/`image`/`memory` 3 each,
`codemap`/`judgment` 2. Only the `omp` set is stable across sessions.

`TOOL_DISPLAY` + `headFact`: a per-tool rule of `{ fold, fact }`, keyed by the tool label. `read` and `write`
have `fold: false` — no output block, a `3 lines` / `42 bytes` fact on the call line instead. Everything else
falls back to the generic fold; `edit` still picks the diff first.

`bun test` 43 pass / 0 fail, `bun run typecheck` clean; smoke: read → `read src/a.ts · 9ms 3 lines` with no
fold, grep → line + fold.

Simplification pass over these lines: `resultNode` → `outputNode` with a `fold: boolean` instead of the whole
rule, the one-use `displayFor` inlined, `countTextLines` trimmed instead of the regex, and `headFact` now returns
undefined for `(no output)` so a read prints that marker rather than `1 line`.

## Revision 2026-11-01, twenty-first pass (no fold for a call that printed nothing)

`(no output)` is the tool saying it printed nothing, so it does not deserve a fold: `resultNode` returns
undefined for it (as for a blank result), and `callBlock` appends a `warning strong` `(no output)` span to
the call line instead — at its right end, where the eye already is.

`bun test` 41 pass / 0 fail, `bun run typecheck` clean.

## Revision 2026-11-01, twentieth pass (diff fallbacks, and honesty about caps)

Some edit blocks showed no diff. Every shape reachable from this machine reproduced fine (single,
multi-line, two-hunk, replace-all, 8 KB diff, two edits of one file), so the renderer now covers the
remaining shapes instead of assuming one:

| Case | Behaviour |
| --- | --- |
| `details.diff` present | parsed as before. |
| diff missing, `oldText`/`newText` present | `diffFromTexts` rebuilds one hunk (common head/tail, 3 context lines). |
| `diff` at the top level of the result | accepted (`editDiff` reads `result.details` else `result`). |
| result is fabric's own `{fabricTruncated, originalChars}` | a muted note, not a JSON paste. |

`bun test` 40 pass / 0 fail, `bun run typecheck` clean.

## Revision 2026-11-01, nineteenth pass (edits render as diffs)

An `omp.edit` result is `{ ok, output, details }`: `output` is the post-edit excerpt with line numbers,
and the real change is `details.diff`, written `<marker><line>|text`. We were showing `output`, i.e. only
what the file looks like after the replace.

`editDiff` + `parseOmpDiff` turn that into hunks for Tern's `diff` kind (`mode: "unified"`, `path` for the
grammar): markers are kept, and a gap in a side's numbering starts a new hunk so a multi-edit diff
stays right. A diff with no changed line falls back to the text path. Result nodes carry roles
`omp-fabric.output-diff` / `omp-fabric.output-text`.

`bun test` 38 pass / 0 fail, `bun run typecheck` clean.

## Revision 2026-11-01, eighteenth pass (slow calls open their own output fold)

`SLOW_CALL_MS` is back, used only for the starting state: `collapsed: options.expanded !== true &&
!slowCall(audit)`. Every call still gets its row; only a call that took two seconds or more opens.

`bun test` 34 pass / 0 fail, `bun run typecheck` clean; smoke shows `output:0 collapsed true` (24 ms)
and `output:1 collapsed false` (5.2 s).

## Revision 2026-11-01, seventeenth pass (every call gets its output row)

`SLOW_CALL_MS` and the "only if slow or failed" gate are gone. A fold is one row while collapsed, so
hiding it saved nothing and left gaps that read as missing output. `callBlock` now always emits the
`resultNode` fold when the call has a result; `expanded` only decides whether folds start open.

`bun test` 34 pass / 0 fail, `bun run typecheck` clean.

## Revision 2026-11-01, sixteenth pass (output folds are named after their call)

The tree was already per-call; the heads were not: two folds both read `output · N lines`, so a column
of them says nothing about attribution. `callLabel` now names both the call line and its output fold
(`bash output · 6 lines`). `bun test` 34 pass / 0 fail, `bun run typecheck` clean.

## Revision 2026-11-01, fifteenth pass (each block is its own fold)

Option 2 from the exchange: a block that previews cannot unfold alone (the terminal's "N more lines"
always opens the enclosing disclosure), so every block became a disclosure.

| Change | |
| --- | --- |
| `programBlock(program, options)` | a `section`, head `program · N lines`, `collapsed: options.expanded !== true`, child `code` with the copy action and no preview. |
| `resultNode(audit, index, options)` | an `output · N lines` section over one `ansi`, same collapse rule; the ansi carries role `omp-fabric.output-text`, the section `omp-fabric.output`. |
| constants | `PROGRAM_PREVIEW_LINES`/`OUTPUT_PREVIEW_LINES` gone: nothing clamps, everything folds. |

Folded: `[program, call:0, call:1, output:1]`; expanded: every fold open. `bun test` 34 pass / 0 fail,
`bun run typecheck` clean.

## Revision 2026-11-01, fourteenth pass (outputs handed to the terminal's own clamp)

Why the card had no expand hint: the hint is drawn for content the terminal knows it hid. We were
cutting the text ourselves (`resultNodes`) and passing `preview: "children"`, so nothing was ever clamped
by the card and Tern had nothing to offer.

| Change | |
| --- | --- |
| `resultNodes` (self-clamping) removed | `resultNode(audit, index)` hands the whole text to `ansi` with `preview: { lines: 4 }`. |
| the `calls` section removed | a preview inside a section gives way, which killed the clamp. Each call is now a `text` line (role `omp-fabric.call`) plus, when earned, its `ansi` — direct children of the card. |
| when an output shows | `options.expanded`, or `endedAt - startedAt >= 2000`, or the call failed. |
| CSS | the `calls` rule is gone; `omp-fabric.call` indents the line. |

`bun test` 32 pass / 0 fail, `bun run typecheck` clean; smoke: folded `[code program, row phases, text call:0, text call:1,
ansi output:1]`, expanded adds `ansi output:0`. `tern plugin reload` exits 0. The card now has clamped content, so
the terminal can draw its own "N more lines" and expand hint.

## Revision 2026-11-01, thirteenth pass (the truncation note is text again)

The `… N lines more` fold from the twelfth pass replaced the terminal's own hint, and the terminal
already offers the card's expand (`ctrl+o`). It is a muted `text` again; the rest opens with the card.

`bun test` 34 pass / 0 fail, `bun run typecheck` clean.

## Revision 2026-11-01, twelfth pass (the more row is a fold)

The `… N lines more` under a slow call was muted text, so nothing opened it. `resultNodes` now emits a
nested `section` (key `output-more`, role `omp-fabric.output-more`) holding the tail as `ansi`: opening
it shows the rest in place. Sections nest; only `card`/`tool` children are flattened.

`bun test` 34 pass / 0 fail, `bun run typecheck` clean.

## Revision 2026-11-01, eleventh pass (output folded unless the call was slow)

`resultNode` became `resultNodes(audit, lines)`: it clamps the text itself (a `code`/`ansi` `preview`
gives way inside an open section, so the clamp could not be left to the terminal) and adds a muted
`… N lines more` when it hid any. `auditSection` now decides `collapsed`: open when the card is expanded
(`Number.POSITIVE_INFINITY` lines, no clamp), or when `endedAt - startedAt >= SLOW_CALL_MS (2000)`, or when
the call failed; folded otherwise. `slowAudit` fixture added.

`bun test` 34 pass / 0 fail, `bun run typecheck` clean; smoke prints folded `[a\nb]` for a 24 ms call and
open `1\n2\n3\n4` + `… 1 line more` for a 5.2 s one, all six lines with `expanded: true`.

## Revision 2026-11-01, tenth pass (folded previews are four lines)

`PROGRAM_PREVIEW_LINES` 8 -> 4 and the output clamp (`AUDIT_RESULT_LINES`), renamed `OUTPUT_PREVIEW_LINES`, 6 -> 4.

`bun test` 31 pass / 0 fail, `bun run typecheck` clean.

## Revision 2026-11-01, ninth pass (output text only, drawn as-a-terminal)

| Ask | Change |
| --- | --- |
| only the output content | new `resultText`: a string result as-is, an envelope's `output` field when the tool answers `{ ok, output, details }`, its JSON otherwise. |
| no JSON highlighting | `resultNode` emits `ansi` for every shape (`code lang=json` gone), so the text keeps whatever the tool itself colored. |

`jsonSafe` still backs the fallback; `COPY_ACTION` now rides only on the program block. `bun test` 31 pass / 0 fail,
`bun run typecheck` clean; smoke over an envelope audit prints `head + [ansi]` with the output field only.

## Revision 2026-11-01, eighth pass (outputs only, drawn as output)

| Ask | Change |
| --- | --- |
| drop the audit body | `argumentItems`, `scalarText`, `ARG_ENTRIES` and `ARG_VALUE_CHARS` are gone; `auditSection` renders only `resultNode` (plus an error line and a truncation note). The head still names the call. |
| render the output as output, not as data | `resultNode` no longer branches on `options.json`: text stays `ansi`, a structured result prints as `code lang=json`. The `json` tree kind is never used, so the field left `DescribeOptions`. |
| so the output can be framed | both output nodes carry `role = "omp-fabric.output"`; the sheet rings that role and the program's. |

Verification: `bun test` 30 pass / 0 fail, `bun run typecheck` clean, smoke prints per call
`head + [ansi]` / `head + [code json]`, both with the output role; `tern plugin reload` exits 0.

## Revision 2026-11-01, seventh pass (audit output only, rings back to a border)

| Ask | Change |
| --- | --- |
| use `audit.result` as the output, drop the aggregate | `outputNodes`, `valueBlock`, `logsSection` and the `outputFormat*` fields are gone. The result card is `program` + `calls`; every output on it is a call's own `audit.result`, rendered under that call. |
| each call shows its output | audit sections are `collapsed: false` (still collapsible). |
| borders all gone again | the `box-shadow` ring does not paint on these nodes; back to `border: 1px solid var(--l1)`, with the hairline suppression guarded by `:not([data-role^="omp-fabric."])` so it cannot eat a ring edge (`.sf-tool-hr` lands on the child element itself). |

Verification: `bun test` 29 pass / 0 fail, `bun run typecheck` clean, smoke prints `head facts + [program, calls]`
with each `call:N` section open and `[kv, ansi]`/`[kv, text]` under it; `tern plugin reload` exits 0 with
no sheet error. Whether the ring paints is the one thing left to the eye.

## Revision 2026-11-01, sixth pass (status in the head, one open level)

| Ask | Change |
| --- | --- |
| the outcome belongs on the title row | `footLine` and `metaLine` are gone. `statusFacts` returns head facts: `✓ Done · 2.4s` (success), `✗ Failed` (error), `✗ Cancelled` (warning), or `timeout 30s` while the call runs (`pendingFacts`, which the call view uses too). `NativeToolHead.meta` takes `TspText`, so a fact can be a span run. |
| `calls` open one level by default | `section collapsed: false`; the audit sections inside stay folded. |
| the output shows six lines | program and value are plain `code` blocks (`preview: { lines: 8 }` / `6`) — a nested section's preview gives way inside a folded disclosure, the code block's does not. Opening the card (`options.expanded`) makes both show whole, which is the behaviour asked for. |
| no hairline | the sheet drops the `call`/`foot` borders it had and suppresses `.sf-tool-hr` inside the fabric tool card; the rings on program and value stay. |

Consequences: `codeSection`/`programSection`/`valueSection`/`footLine`/`metaLine`/`joinSpans` deleted; `codeBlock` and
`COPY_ACTION` added; `logs` stays a folded section because logs are not the answer. Body: `program, calls, logs,
output`.

Verification: `bun test` 32 pass / 0 fail, `bun run typecheck` clean, smoke over `index.ts` prints the head facts
with the outcome last and the four body nodes; `tern plugin reload omp-fabric` exits 0 and the daemon log shows the
reload with no `plugin style sheet has errors`. Rings and hairline suppression are for the eye at the pane.

## Revision 2026-11-01, fifth pass (the directory line goes)

The meta line carried the session's working directory; it earned nothing on screen. Removed end to
end rather than blanked: `DescribeOptions.cwd`, the `withCwd` wrapper in `attach.ts`, the `cwd` parameter on
`attachDescribeHooks`/`patchToolListing`/`installFabricNative`, and the `path` span in `metaLine`. The hooks are
assigned directly again, and the meta line reads `1.2s · timeout 30s` (or bare `timeout 30s` settled).

`bun test` 38 pass / 0 fail, `bun run typecheck` clean.

## Revision 2026-11-01, fourth pass (the card chevron, and where frames come from)

Two reports: expanding the "Fabric" head changed nothing, and neither the hairline nor any border
showed. Answer to the second, asked as a question in the same breath: yes, the frames belong to
Tern, not to the node tree — and until now this plugin shipped no sheet.

| Finding | Change |
| --- | --- |
| every block was already folded, so the tool head's own fold had nothing left to hide | `options.expanded` now decides the sections' starting fold: expanding the card opens program, calls, logs and output (`collapsed: options.expanded !== true`). The head chevron finally differs from the collapsed state. |
| nested frames are flattened by protocol (`tsp.d.ts:722`), so no ring can come from a node | `tern/style.css`, installed by the manifest (`styles = ["style.css"]`, `guides/chrome.html#global-css`): a ring per block role, a hairline per nested call, a code well, and a rule above the foot. Only Tern can draw these; CSS borders and radii are supported (`styles/css.html`). |
| the tool's own hairline between differing child kinds was invisible | the same sheet styles the code wells and the foot rule; no explicit `rule` nodes (that would stack). |

Verification: `tern plugin reload omp-fabric` exits 0, `tern plugin list` shows `omp-fabric … ready`, and
`~/AppData/Local/Tern/Logs/tern.log` has the reload line with no `plugin style sheet has errors`. `bun test`
38 pass / 0 fail, `bun run typecheck` clean. What the rings actually look like is still the one
thing only a person at the pane can judge.

## Revision 2026-11-01, third pass (noise and per-call outputs)

Two asks: the three noisy rows a program returns (`ok`/`output`/`details` and friends) should go away or be
folded whole, and with several calls nothing should put two outputs in one block.

| Change | Why |
| --- | --- |
| every audit section is now `collapsible + collapsed` | a settled card shows one row per nested call; its arguments and its own output open on demand. |
| the program's result splits into `logs` and `output` | fabric joins the program's `logs` and the returned value into one text block and names the value's first line (`index.js:3661-3692`, `outputFormatStartLine`). Two different things no longer share a block, and each folds. |
| no `preview` left on the split value | the fold is the clamp; `code`'s own preview would double it. |

Body now: `meta, program, calls, logs, output, foot` (sections except the two texts). `outputNodes` returns an
array and keeps the single-block path when there is no value offset.

Verification: `bun test` 37 pass / 0 fail, `bun run typecheck` clean, smoke over `index.ts` prints the five
sections folded with `logs` and `output` separate. Not observed in a live Tern pane.

## Revision 2026-11-01, second pass (what Tern actually draws)

The framed cards did nothing in the terminal: `TspToolProps` (pi-wire `tsp.d.ts:720-724`) has the
terminal draw one frame per tool call and *flatten nested `card`/`tool` children into borderless
sections*, and the tool page of the SDK docs adds that nested `code` loses its frame and head too. A
nested card therefore lost both its ring and its `collapsed` state — which is exactly what the user
saw: no borders, and the program and output drawn in full under a card that never folded.

| Ask | Change |
| --- | --- |
| drop the head's first code line, bring the counts back | `head()` takes `extraMeta` again and sets `meta = [name?, "TypeScript · N lines", "N calls", "k failed", "P phases"]`; `target`/`targetKind`/`lang` are gone. |
| the program fold must work | `card` became `section` (`collapsible: true, collapsed: true`), child `code` keeps the whole text and the copy action; no `preview` (a folded section hides its body, an open one shows the program whole). |
| the output fold must work | same `section` shape, head `output · N lines`. |
| borders | Impossible inside a tool body by protocol. Removed the explicit `rule` nodes too: the tool body draws its own hairline wherever the child kind changes, so a `rule` would stack a second line on it. |

Consequences: `CALL_PROGRAM_LINES`, `OUTPUT_LINES`, `CODE_EXPANDED_LINES` and `card` are gone;
`options.expanded` now only widens the audit cap. `calls` section head is the label `calls` (counts live in
the head). Body order: `meta, program, calls, output, foot`, all sections except the two texts.

Verification: `bun test` 34 pass / 0 fail, `bun run typecheck` clean, and the `index.ts` smoke prints that
order with `k: "section"` for program/calls/output. Still unobserved in a real Tern pane.

## Revision 2026-11-01 (user review of the first cut)

The first cut was rejected on layout: the head repeated the program, the reachable copy sat in the
head, nothing was framed, and a settled call said nothing about how it ended.

| Ask | What the view does now |
| --- | --- |
| drop `command` from the head | head = title, first code line, display name. No Copy command, no counts. |
| program block: folded by default, unfold *and* refold, framed, carries Copy | `card` (ring, `collapsible`, `collapsed`, `preview.lines`) over one `code` node; the card head is `TypeScript · N lines`; the code carries `actions.click = "copy"` plus a Copy menu entry, titled "Click the code to copy the program". |
| call: walltime, timeout, then cwd | one muted `text` line under the head: `1.2s · timeout 30s · <cwd>` (cwd as a `path` span). |
| result head = call head; counts folded; rule; output folded; rule; foot | `calls` section (collapsed) holds the phase row and the audit sections and its head carries `N calls · k failed · P phases`; `rule`; output `card` (folded, 12 lines); `rule`; foot `✓ Done · 2.4s` / `✗ Failed · 2.4s` / `✗ Cancelled`, or `timeout 30s` while the call is still running. |

Interface changes:

- `DescribeOptions` gained `cwd?: string`. The host sends no directory, so `attach.ts` wraps every hook
  call with `{ ...options, cwd }`, captured from `process.cwd()` at install (override for tests).
- `head()` no longer takes options or extra meta; `programNode` became `programCard`/`codeCard`;
  `RESULT_CODE_LINES` and `RESULT_PROGRAM_LINES` are gone (one fold size, 8 lines).

Verification for this revision: `bun test` 33 pass / 0 fail, `bun run typecheck` clean, and a smoke run
of `index.ts` through a fake `ExtensionRunner` printed the exact body order the spec asks for
(`meta, program card, calls section, rule, output card, rule, foot`) with the cwd filled in. The Tern pane
itself is still unobserved (screen capture is forbidden here): folds, the click-to-copy action on a
`code` node and the `card`-inside-`tool` frame need one human look.

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

