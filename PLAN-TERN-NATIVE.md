# Tern-native fabric, remaining surfaces

The `fabric_exec` card is adapted (`src/attach.ts` attaches `describeCall`/`describeResult` from
`src/describe.ts`). This plan covers what is still drawn the old way: the bodies inside that card,
and the four panels fabric opens from `/fabric`.

Evidence for every item was read from `R:/agent_tmp/omp-fabric` (fabric source) and this repo.
Nothing here was observed in a live Tern pane; screenshot capture is not available on this machine.

## Decisions

Locked. A phase may not reverse one without a new entry here.

- **`write` reports a byte count, never a diff.** The body of a written file is all additions, so a
  diff restates the file and the reader opens it instead. `describe.ts:441` already behaves this
  way; it is a rule, not a gap.
- **`read` reports a line count, never a body.** Same reason (`describe.ts:439`, comment at
  `:390`).
- **Output is terminal text.** A call's result is drawn as `ansi`, never as highlighted JSON
  (README, "What you get").

## Decision, the panel seam

Locked 2026-11-04. The four panels get `describe()` in fabric. No rows-to-node bridge, no Luau
reimplementation.

The reasons, in the order that settled it:

1. Upstream already names this seam. `pi-tui/src/native/describe.ts` is a builder layer for
   `describe()`, and `pi-tui/src/native/picker.ts:1-14` states the rule: the component returns its
   data, Tern draws the sheet, and a terminal without the kind falls back to the component's generic
   composition. `rows` is marked a migration fallback (`pi-wire/dist/types/tsp.d.ts:391`), and
   `reconcile.ts:927-948` only reaches it when a component has no `describe()` or inherits
   `Container`'s while painting its own rows.
2. A generic rows-to-node bridge would re-derive layout the components already computed as strings,
   against that design.
3. A Tern-side Luau panel duplicates about 10k lines of state and layout (`wc -l` over the ten
   panel files: 9978) in a second language, and the panel stops existing inside omp.

Supporting evidence, not the reason: a JEV `choice` call (`jev-1.14-free`) on the same facts gave
`describe_in_fabric 0.9`, `tern_luau_panels 0.06`, `defer 0.03`, `generic_rows_bridge 0.01`,
confidence 0.87. Read as "the architecture facts point one way", not as a measurement.

Two consequences to handle before phase 7a:

- The fork clone is `R:/agent_tmp/omp-fabric`, a RAM disk that is wiped on reboot. Move it to real
  disk first, or a reboot takes the branch with it.
- The `rows` fallback keeps key input working; only the drawing is a snapshot. So `defer` stays a
  safe state at every point between phases.

Panel components stay `render()`-only today: `src/ui/dashboard.ts:107`,
`src/ui/conversation.ts:231`, `src/ui/lcm-dashboard.ts:65`, `src/ui/settings.ts:1065`.

## Phases

Each phase ends green: `bun test`, `bun run typecheck`, and one fabric_exec call whose card shows
the new body. Phases 1 to 6 touch only `src/describe.ts` and `tests/describe.test.ts`.

### Phase 1, provider titles carry their counts

Today `callDetail` picks one argument (`describe.ts:172`). Fabric joins two facts for these calls.

- mesh: `read` gives `topic · count`, `list` gives `prefix · count`, `members` gives a count
  (`fabric-render.ts:586,592,594`).
- mcp: `$call` gives `server.tool`, `$servers` gives a count (`:603,607`).
- discovery: `list` gives `provider · namespace · count`, `describe` gives `ref`, the rest give
  counts (`:629,633,625-627`).
- workflow: `parallel` and `pipeline` give `itemCount · stageCount` (`:635,636`).

Files: `src/describe.ts` (a provider table beside `CORE_DETAILS:147`), tests.
Acceptance: a mesh `read` card reads `mesh.read topic · 12`, an mcp `$call` reads
`mcp.$call github.search`.

### Phase 2, grep keeps its grouping

Fabric groups matches by file, then by line, with a marker (`core-tool-render.ts:1250`, rows at
`:1220`). Tern shows the raw text (`describe.ts:407`).

Files: `src/describe.ts` (`callBlock:583` gets a grep branch), tests.
Node: `tree` or `list` + `item`, one item per match, the file as the group head.
Acceptance: a 20-match grep card shows 3 file groups and no raw dump.

### Phase 3, find and ls draw the paths as a tree

Fabric draws a path tree with icons (`core-tool-render.ts:1353`, `:1393-1423`). Tern shows text.

Files: `src/describe.ts`, tests.
Node: `tree`.
Acceptance: a recursive find card nests directories instead of listing flat paths.

### Phase 4, agents calls other than spawn

`create`, `remove`, `stop`, `cleanup`, `wait`, `status`, `actorStatus`, `messages`, `ask`,
`tell`, `actors`, `list`, `models`, `peers` (`fabric-render.ts:554-575`) fall through to the
generic body, and their titles lose the count or the name-and-message form.

Files: `src/describe.ts` (`spawnedAgent:508` grows into a provider branch), tests.
Node: reuse `agent` for single-agent answers, `list` for the counted ones.
Acceptance: `agents.list` reads `agents.list · 7`; `agents.status` names the agent.

### Phase 5, judgment answers

Fabric prints the verdict and its bullets (`fabric-render.ts:1309-1332`). Tern shows text.

Files: `src/describe.ts`, tests.
Node: `section` with a `badge` head and one `text` per bullet.
Acceptance: `judgment.bool` shows the verdict as a badge, not a JSON dump.

### Phase 6, the two previews nothing draws

Fabric previews a write's content before the call returns (`fabric-render.ts:394`) and tells the
model when it read a file instead of calling a tool (`:1489`). Tern draws neither.

Files: `src/describe.ts` (`describeFabricCall:728`).
Acceptance: a write call's card shows the content it is about to write, capped the way fabric caps
it.
Risk: the args are capped at 2000 chars per string (`action-registry.ts` `previewArgs`), so the
preview is a prefix. Say so on the block.

### Phase 7, the four panels

Seam is fixed: `describe()` on the component, per the decision above. Order inside the phase is by
use: dashboard, lcm, chat, settings.

Every step is the same shape: add `describe()` next to `render()`, leave `render()` and every key
binding untouched, and let `reconcile.ts` prefer the description. A component that paints rows but
inherits `Container`'s `describe()` must override it, or the fallback wins (`reconcile.ts:931-933`).

Step 0 for the phase: the fork clone lives at `vendor/omp-fabric` (gitignored; branch
`fix/child-omp-tool-names`, pinned by `vendor/omp-fabric` in `.gitignore`, not a submodule: jj tracks
no submodule content, and the branch is pushed to `UnderCooled/omp-fabric` so the pin is fetchable).

The graph question is answered: a JEV `noul` on "can existing kinds carry it" returned 0.87 yes
(87% likelihood), so no protocol change is planned. Compose it from `tree`/`chart`/`col`+`row`;
keep `ansi` only if the composed form loses information.

- **7a dashboard.** `src/ui/dashboard.ts:107`, with `dashboard-detail.ts:97`,
  `dashboard-fabric-graph.ts:898`, `state-file-preview.ts:88`. The graph is the hard part: it is
  an ASCII canvas today.
- **7b lcm.** `src/ui/lcm-dashboard.ts:65` and `lcm-panel.ts:119,139,171,242`, all ANSI strings.
- **7c chat.** `src/ui/conversation.ts:231`, body from `conversation-render.ts:85` and
  `conversation-chrome.ts:43`.
- **7d settings.** `src/ui/settings.ts:1065`, a `Container`; TSP has `prefs` for exactly this.

Acceptance per panel: the panel opens in Tern with native chrome, its keys still work, and omp's row
renderer outside Tern is unchanged.

## Not in this plan

- `/fabric` subcommands that only call `context.ui.notify`: status, schema, prewalk, reload,
  providers, agents, actors, messages, clear-messages, events, log, export-log, attach, stop, remove,
  kill, global, import, export, repairs, entropy. Plain text, nothing to adapt.
- Core tool title metadata (`core-tool-render.ts:1583-1653`: bash timeout, read range, grep glob).
  The call line already names the call and its file; the metadata is fabric's own affordance.
