# tern-omp-fabric

Native [Tern](https://docs.stencil.so/tern) rendering for [omp-fabric](https://github.com/tickernelz/omp-fabric)'s
`fabric_exec` blocks, plus the Tern plugin that mirrors that rendering.

Tern draws omp's transcript itself, block by block. A tool call is described to it by the tool
that owns the call: `fabric_exec` only implements omp's ANSI renderers, so Tern fell back to its
generic card — the arguments as one line cut at 160 characters, and the result pasted as raw
terminal output. Both halves of the complaint that started this plugin:

| Before | After |
| --- | --- |
| `{code:"const [a, b] = await Promise.all([…`, 160 characters, not expandable | the program as a framed TypeScript block folded to eight lines, unfolded and refolded by its own head, copied by a click on the code |
| the whole result as one raw output dump | the call's walltime, timeout and directory, the phases and nested calls in one foldable section (arguments, their own output, timing, failures), the return value as highlighted YAML/JSON, and a foot line saying done or failed with the duration |

omp's own terminal rendering is untouched: fabric keeps its `renderCall`/`renderResult`, and the
hooks this plugin adds are read only by terminals that render natively.

## Requirements

- omp 18.14 or later, running directly in a Tern pane (not inside tmux, zellij or another
  multiplexer: those get omp's row renderer).
- Tern 0.9 or later.
- omp-fabric installed. Without it the extension loads and does nothing.

## Install

Two halves, as in `tern-omp-vimnav`: the repository root is the omp extension, `tern/` is the
Tern plugin.

```sh
omp plugin link .          # then restart omp
tern plugin link ./tern
```

`tern plugin list` should show `omp-fabric … ready`. Link instead of install while editing: both
halves reload on save.

## What you get

A `fabric_exec` card reads, top to bottom:

```text
Fabric  const [a, b] = await Promise.all([…      ← the verb and the program's first line
├ 1.2s · timeout 30s · D:/repos/demo             ← walltime, timeout, working directory
├ (the model's description, when it sent one)
├ ▸ TypeScript · 42 lines                        ← folded program: head unfolds, click copies
├ ▸ 3 calls · 1 failed · 2 phases                 ← phases and nested calls, folded
│    [discover] [report]
│    grep  /foo/ in src · 24ms
│      pattern foo
│      … (its own output, 6 lines folded)
│    mcp.do_thing  deploy · failed · 3.1s
│      (error) connection refused
├ ───────────────────────────────────────────────
├ ▸ output · 12 lines                            ← the program's return value
├ ───────────────────────────────────────────────
└ ✓ Done · 2.4s
```

Every clamp is a disclosure: the code block's `N more lines`, the nested output's, and the
card's own expand, which is omp's `ctrl+o` (`app.tools.expand`). The Tern plugin adds a palette
row for the same action — **omp fabric: expand tool output** — so it is reachable without
knowing the chord; it types `ctrl+o` into the focused omp pane.

### Where this parts from omp's TUI

- The head names the call and nothing else: `Fabric`, the program's first line, the display name. It
  carries no Copy command — the program block under it is what you copy, so a click on its code
  puts the whole program on the clipboard (and its menu offers Copy). The output block copies the
  same way.
- The program stays in the card once the result arrives. omp's transcript is append-only, so its
  card drops the code the moment the result replaces the call frame, leaving the command nowhere
  to be read; this card keeps it, folded to eight lines.
- The call names its own facts: the walltime and the invocation's `timeoutMs` (while it runs), and
  the session's working directory.
- The folds are the terminal's local state, kept per node: the program block, the calls section
  and the output block each unfold and refold on their own, and `ctrl+o` still expands the whole
  card.

## Limits

- Tern only. In any other terminal the extension is inert, and the Tern plugin's command does
  nothing outside an omp pane.
- Blocks already on screen when the extension loads keep Tern's generic card until the transcript
  is rendered again (a reload or a new session).
- If the host's extension runner cannot be reached, Tern warns once per session and the blocks
  stay generic; omp's log has the reason under `tern-omp-fabric`.
- The nested calls are described from fabric's own audit data: a program is as readable as its
  audits. Sessions rendered from a durable trace alone (no rich audits) say `result not retained
  after reload` where omp would show a diff.
- The timeout is the invocation's own `timeoutMs`. Without one, the configured executor deadline is
  not visible to an extension and the foot line says nothing while the call runs.
- The directory is the one omp was started in, captured when the extension loads; a program that
  changes its own working directory does not change the line.

## Layout

```text
index.ts          omp extension entry; installs the describe hooks
src/attach.ts     attaches describeCall/describeResult to fabric's fabric_exec definition
src/describe.ts   pure: fabric_exec args/details -> Tern nodes (no host imports at run time)
tests/            bun test over src/describe.ts and the attach seam
tern/plugin.toml  Tern plugin manifest (id omp-fabric)
tern/window.luau  the palette row that sends ctrl+o into the focused omp pane
```

## Development

```sh
bun install
bun test          # the view builder's behavior
bun run typecheck # tsc --noEmit against the host packages' types
```

## Uninstall

```sh
omp plugin uninstall tern-omp-fabric
tern plugin remove omp-fabric   # or: tern plugin unlink omp-fabric
```
