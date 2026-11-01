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
| the whole result as one raw output dump | the call's walltime and timeout, one fold per nested call (its own arguments, output, timing, failures), the program's logs and returned value each in their own fold, and a foot line saying done or failed with the duration |

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
Fabric  Sweep TODOs · TypeScript · 42 lines · 3 calls · 1 failed · 2 phases · ✓ Done · 2.4s
│ (the model's description, when it sent one)
│ ▸ program · 42 lines                       ← its own fold: open it to read the code
│ [discover] [report]                        ← the phases
│ grep /foo/ in src · 24ms                   ← every call, its line…
│ ▸ grep output · 12 lines                   ← …and its output: folded when it was quick
│ build · 5.2s
│ ▾ bash output · 40 lines                   ← open when the call took 2 s or more
│ deploy · failed · 3.1s
│ ▸ deploy output · 3 lines
```

Every output in the card is a call's own: `audit.result` from fabric's audit trail, rendered under the
call it belongs to, so two calls never share one body. It is drawn as terminal output — the `ansi`
kind, colors and all, never syntax-highlighted JSON and never the terminal's unfolding JSON tree:
what a tool returns is output, not data. A result that answers in an envelope (`{ ok, output,
details }`) shows only its `output` field, so the wrapper's bookkeeping stays out of the way. The
text fabric returns for the program as a whole — its `logs` plus the returned value, one blob with no
call attribution — is not drawn.

A call's arguments stay out of the body: the head already names the call (`grep /foo/ in src · 24ms`),
so the space under it belongs to what came back.

The head carries the outcome (`✓ Done · 2.4s`, `✗ Failed`, `✗ Cancelled`, or the `timeout 30s` it runs
under) beside the counted facts, so the body has no trailing status line.

Every block is a fold of its own: the program, and the output of every call that returned one. A
fold is one row until you open it — `program · 42 lines`, `grep output · 12 lines` — except the output of a
call that took two seconds or more, which starts open: the wait is the reason to look. `ctrl+o`
(`app.tools.expand`) opens all of them at once. That is the only arrangement that gives a
block its own disclosure: the terminal's "N more lines" button always opens the enclosing one, so
a block that shows a preview cannot also unfold by itself. The Tern plugin adds a palette row for
the open-all — **omp fabric: expand tool output** — so it is reachable without knowing the chord.

The ring around the program is this plugin's Tern sheet, not the node tree: the protocol gives
each tool call exactly one frame and flattens anything framed inside its body
(`elements/work.html#tool`), so a nested `card` loses both its border and its fold. `tern/style.css` draws
it per role and suppresses the tool's own hairlines — that is the half only Tern can do.

### Where this parts from omp's TUI

- The head carries the verb, the counted facts and the outcome — `Sweep TODOs · TypeScript · 42
  lines · 3 calls · 1 failed · 2 phases · ✓ Done · 2.4s` — and no target line and no Copy command:
  the program itself is the body, so repeating its first line up there would say the same thing
  twice. The outcome sits in the head rather than on a trailing line, which is also where omp's
  own card keeps it.
- Copy rides on the code: a click on the program block's code puts the whole program on the
  clipboard, and the same code's context menu offers Copy.
- The program stays in the card once the result arrives. omp's transcript is append-only, so its
  card drops the code the moment the result replaces the call frame, leaving the command nowhere
  to be read; here it is the first thing under the head, in a fold of its own.
- Each nested call is one line — what ran, its argument, how long — followed by the output fabric
  recorded for it (`audit.result`), in a fold named after that call. Every call that returned something
  gets one: the row costs a line, and a gap in the column reads as output that went missing. A call
  that took two seconds or more opens its fold by itself, so a slow step shows what it produced
  without a click. A call that printed nothing gets no fold at all — its line ends in a warning
  `(no output)` instead, where the eye already is. Two calls never share a body, and the output is
  what the sheet rings.
- An edit's output is a diff, drawn by Tern's `diff` kind: omp's `<marker><line>|text` rows are parsed
  into hunks (a gap in the numbering starts a new one), so the `-`/`+` lines get the terminal's own diff
  rendering instead of a monospaced paste of the post-edit excerpt. When that field did not survive
  fabric's own per-audit cap, the diff is rebuilt from `details.oldText`/`newText` instead; when the whole result
  was capped, the block says so rather than pasting a slice of JSON.
- A bash call's command is a code block of its own under the call line, highlighted with Tern's
  `bash` grammar and always whole: a pipe or a redirect cut down to fit a tool label stops being
  readable. The line keeps the tool and the duration; the output fold follows as for any other call.
- Display is per tool. `read` and `write` carry their fact on the call line — `3 lines`, `42 bytes` — and
  draw no output at all: a file's own text is data, not something anyone reads back in a
  transcript. Everything else keeps its fold, and `edit` gets the diff. The table lives in `TOOL_DISPLAY`
  in `src/describe.ts` and falls back to the generic fold for a tool it does not name.
- Any other call's output is drawn as a terminal (`ansi`) with its own colors, not as highlighted JSON: an
  envelope's `output` field when the tool answers with one, its string when it returns text, its
  printed JSON otherwise — and it lives in a fold named and counted after its call (`bash output · 12
  lines`), so a column of folds still says which call each one came from.
- The program's own returned text is not drawn. fabric hands it over as one blob — its `logs` and
  the returned value joined, with no attribution to a call — which is exactly the merged output
  this card used to show. What a call produced is read from its own audit instead.

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
- The program's returned value is deliberately not shown, so a program whose answer is not also
  visible through one of its calls (a computed number, a summary it assembled) reads as "no
  output" in this card. `ctrl+o` and the transcript's own text still carry it in an ordinary omp
  session; ask if you want it back as a trailing fold.
- The timeout is the invocation's own `timeoutMs`. Without one, the configured executor deadline is
  not visible to an extension and the head says nothing about it while the call runs.
- No block inside a `fabric_exec` card can carry its own frame from the node tree: the protocol
  draws one ring per tool call and flattens nested frames by design. The borders in `style.css`
  are a Tern sheet, so they exist only in Tern, only while this plugin is loaded, and a user CSS
  theme installed after it can override them.

## Layout

```text
index.ts          omp extension entry; installs the describe hooks
src/attach.ts     attaches describeCall/describeResult to fabric's fabric_exec definition
src/describe.ts   pure: fabric_exec args/details -> Tern nodes (no host imports at run time)
tests/            bun test over src/describe.ts and the attach seam
tern/plugin.toml  Tern plugin manifest (id omp-fabric); styles = ["style.css"]
tern/style.css    the rings, wells and dividers, by node role
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
