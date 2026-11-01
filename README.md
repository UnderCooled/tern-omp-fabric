# tern-omp-fabric

Native [Tern](https://docs.stencil.so/tern) rendering for [omp-fabric](https://github.com/tickernelz/omp-fabric)'s
`fabric_exec` blocks, plus the Tern plugin that mirrors that rendering.

Tern draws omp's transcript itself, block by block. A tool call is described to it by the tool
that owns the call: `fabric_exec` only implements omp's ANSI renderers, so Tern fell back to its
generic card — the arguments as one line cut at 160 characters, and the result pasted as raw
terminal output. Both halves of the complaint that started this plugin:

| Before | After |
| --- | --- |
| `{code:"const [a, b] = await Promise.all([…`, 160 characters, not expandable | the program as a highlighted block in its own foldable section, unfolded and refolded by its head, copied by a click on the code |
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

A `fabric_exec` step reads, top to bottom:

```text
Fabric   Sweep TODOs · TypeScript · 42 lines · 3 calls · 1 failed · 2 phases   ← head: verb and counts
│ 1.2s · timeout 30s · D:/repos/demo                 ← walltime, timeout, working directory
│ (the model's description, when it sent one)
│ ▸ program                                           ← folded: its head unfolds, click copies
│ ▸ calls                                             ← folded: phases, then one section per call
│     [discover] [report]
│     grep  /foo/ in src · 24ms
│       pattern foo
│       … (its own output, 6 lines folded)
│     mcp.do_thing  deploy · failed · 3.1s
│       (error) connection refused
│ ▸ output · 12 lines                                 ← the program's return value, folded
│ ✓ Done · 2.4s
```

The three blocks are foldable sections, not frames: Tern draws exactly one ring per tool call and
flattens anything framed inside it, so a nested card loses its border *and* its fold
(`elements/work.html#tool`). The tool body draws a hairline wherever the child kind changes, which
is where the dividers in that sketch come from.

Every fold is the terminal's own state: the section heads unfold and refold independently, and
`ctrl+o` (`app.tools.expand`) still expands the whole card. The Tern plugin adds a palette row for
the same action — **omp fabric: expand tool output** — so it is reachable without knowing the
chord; it types `ctrl+o` into the focused omp pane.

### Where this parts from omp's TUI

- The head carries the verb and the counted facts — `Sweep TODOs · TypeScript · 42 lines · 3 calls ·
  1 failed · 2 phases` — and no target line and no Copy command: the program itself is the body,
  so repeating its first line up there would say the same thing twice.
- Copy rides on the code: a click on the program block's code puts the whole program on the
  clipboard, and the same code's context menu offers Copy. The output block copies the same way.
- The program stays in the card once the result arrives. omp's transcript is append-only, so its
  card drops the code the moment the result replaces the call frame, leaving the command nowhere
  to be read; here it is the first thing under the head, folded.
- The call names its own facts: the walltime and the invocation's `timeoutMs` (while it runs), and
  the session's working directory.
- The foot line says how the program ended and how long it took (`✓ Done · 2.4s`, `✗ Failed`,
  `✗ Cancelled`), and says `timeout 30s` instead while the call has not returned.

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
- No block inside a `fabric_exec` card can carry its own frame: the protocol draws one ring per tool
  call and flattens nested frames by design, so the delimitation is the tool's own hairlines plus
  the section heads, not borders around each block.

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
