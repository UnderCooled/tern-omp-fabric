# tern-omp-fabric

Native [Tern](https://docs.stencil.so/tern) rendering for [omp-fabric](https://github.com/tickernelz/omp-fabric)'s
`fabric_exec` blocks, plus the Tern plugin that mirrors that rendering.

Tern draws omp's transcript itself, block by block. A tool call is described to it by the tool
that owns the call: `fabric_exec` only implements omp's ANSI renderers, so Tern fell back to its
generic card — the arguments as one line cut at 160 characters, and the result pasted as raw
terminal output. Both halves of the complaint that started this plugin:

| Before | After |
| --- | --- |
| `{code:"const [a, b] = await Promise.all([…`, 160 characters, not expandable | the program as a TypeScript code block under a `N more lines` disclosure, the card's own expand showing all of it, and a head whose Copy copies the whole program |
| the whole result as one raw output dump | the program, its phases, one section per nested call (arguments, its own output, its timing, its failures), and the return value as highlighted YAML/JSON |

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
Fabric  <display name>  TypeScript · 42 lines   [3 calls · 1 failed · 2 phases]   ✓ 1.2s
├ 1  const [a, b] = await Promise.all([…            ← program, 4 lines collapsed
│ 2    omp.grep({ pattern: "foo", path: "src" }),
│ 3    omp.read({ path: "src/a.ts" }),
│ 4  ]);
├ phases  [discover] [report]
├ grep  /foo/ in src · 41ms
│      pattern  foo
│      src/a.ts
│      ┌ 12│ foo bar
│      └ … (its own output, 6 lines collapsed)
├ read  src/a.ts:1-40 · 22ms
│      └ (a foldable JSON tree of the result)
├ mcp.do_thing  deploy · failed · 3.1s
│      (error) connection refused
└ ┌ yaml                    ← the program's return value
  │ services: 6
  └ …
```

Every clamp is a disclosure: the code block's `N more lines`, the nested output's, and the
card's own expand, which is omp's `ctrl+o` (`app.tools.expand`). The Tern plugin adds a palette
row for the same action — **omp fabric: expand tool output** — so it is reachable without
knowing the chord; it types `ctrl+o` into the focused omp pane.

### One deliberate divergence from omp's TUI

omp's card drops the program once the result replaces the call frame (its transcript is
append-only). Here the program stays in the card, clamped to four lines, because the command is
the first thing you reach for while reading a finished call. Everything else mirrors omp's
sections and their collapsed/expanded sizes.

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

## Layout

```text
index.ts          omp extension entry; installs the describe hooks
src/attach.ts     attaches describeCall/describeResult to fabric's fabric_exec definition
src/describe.ts   pure: fabric_exec args/details -> Tern nodes (no host imports at run time)
tests/            bun test over src/describe.ts
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
