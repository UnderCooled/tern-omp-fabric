# tern-omp-fabric

Native [Tern](https://docs.stencil.so/tern) rendering for [omp-fabric](https://github.com/tickernelz/omp-fabric)'s
`fabric_exec` blocks, with optional styling and a command palette entry.

Tern draws omp's transcript as native nodes. This extension wraps Fabric's renderers to supply
those nodes in Tern rather than leaving the body to the generic card or terminal rows.
The wrapper survives Fabric's in-place tool refresh during activation, including for cards
already mounted. Outside Tern, Fabric's latest original renderers stay in use.

## Requirements

- omp 19.2.1 or later, running directly in a Tern pane (not inside tmux, zellij or another
  multiplexer). The extension and host must share the host's `@oh-my-pi/pi-tui` runtime.
- Tern 0.9 or later.
- omp-fabric installed. Without it the extension loads and does nothing.

## Install

Link the omp extension and restart omp. It supplies the native body without a Tern plugin.

```sh
omp plugin link .
```

Optionally link the Tern plugin for borders, a header without the argument summary, and the
expand command in the palette.

```sh
tern plugin link ./tern
```

`tern plugin list` should show `omp-fabric … ready`. Restart omp after changing the omp extension.

## What you get

A `fabric_exec` step reads, top to bottom:

```text
fabric_exec                                  ← host header with the Tern plugin linked
│ Sweep TODOs · TypeScript · 42 lines · 3 calls · 1 failed · 2 phases · ✓ Done · 2.4s
│ (the model's description, when it sent one)
│ ▸ program · 42 lines                       ← its own fold: open it to read the code
│ [discover] [report]                        ← the phases
│ grep /foo/ in src · 24ms                   ← every call, its line…
│ ▸ grep output · 12 lines                   ← …and its independently folded output
│ build · 5.2s
│ ▸ bash output · 40 lines
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

The first body row carries the run name, counts and outcome (or the timeout while running).
omp owns the outer header and displays cancellation there; the renderer does not receive a
cancellation flag. The body has no trailing status line.

Open the outer card first, then click a fold such as `program · 42 lines` or `grep output · 12 lines`.
Each fold starts closed and opens independently. `Ctrl+O` (`app.tools.expand`) and the optional Tern
palette command **omp fabric: expand tool output** expand the outer card, not its folds.

The ring around the program is this plugin's Tern sheet, not the node tree: the protocol gives
each tool call exactly one frame and flattens anything framed inside its body
(`elements/work.html#tool`), so a nested `card` loses both its border and its fold. `tern/style.css` draws
it per role and suppresses the tool's own hairlines — that is the half only Tern can do.

### Where this parts from omp's TUI

- omp still owns the header. The optional Tern stylesheet hides its argument summary for
  `fabric_exec` only. The full code stays in the Program fold.
- Copy rides on the code: click, context menu, or phone long press. Long programs show a native
  overview when the program section is open.
- The program stays in the card once the result arrives. omp's transcript is append-only, so its
  card drops the code the moment the result replaces the call frame, leaving the command nowhere
  to be read; here it is the first thing under the head, in a fold of its own.
- Each nested call is one line — what ran, its argument, how long — followed by the output fabric
  recorded for it (`audit.result`), in a fold named after that call. Every call that returned something
  gets one: the row costs a line, and a gap in the column reads as output that went missing. A call
  that printed nothing gets no fold at all — its line ends in a warning
  `(no output)` instead, where the eye already is. Two calls never share a body, and the output is
  what the sheet rings.
- An edit's output is a diff, drawn by Tern's `diff` kind: omp's `<marker><line>|text` rows are parsed
  into hunks (a gap in the numbering starts a new one). Tern chooses split or unified mode by width;
  the `-`/`+` lines get its native diff
  rendering instead of a monospaced paste of the post-edit excerpt. When fabric caps the details
  object itself, only a prefix of the diff survives, and a prefix reads as the whole change: that call
  gets no output block and no marker, and its call line becomes a `file://` link — label and path both —
  which Tern routes to opening the file, so the change is one click away instead of half-shown. A
  relative path resolves against the workspace omp runs in. When only the diff field is
  missing, the change is rebuilt from `details.oldText`/`newText`; when the whole result was capped,
  the block says so rather than pasting a slice of JSON.
- A bash call's command is a markdown fence of its own under the call line, so Tern draws what a
  fence always gets: the `bash` label with its Copy button, the highlighter, the code background,
  and a ring from `tern/style.css`. It wraps instead of scrolling sideways and sits two cells in
  from the call line, under the label rather than out past it. The line keeps the tool and the
  duration; the output fold follows as for any other call. Hover over a bash call or a text output fold for a bounded preview.
- A provider call is named by its ref, not its bare tool name, and carries the fact its provider joins:
  `mesh.read builds · 12`, `mcp.$call github.search`, `fabric.discovery.list omp · tools · 3`,
  `fabric.workflow.parallel 3 items · 2 stages`, `agents.list · 7`. The table lives in
  `PROVIDER_DETAILS` in `src/describe.ts`; a provider it does not name falls back to the one argument
  that names the call. A provider's `read` is not omp's `read`: the core-tool rules only apply to
  `omp` (or unnamed) calls.
- `grep` keeps the grouping fabric draws: Tern's `tree` node with one group per file and one row per
  match, the line number padded, a `│` for a match and a `┆` for context. `find` and `ls` nest their
  paths the same way, directories as open nodes. Both cap at 200 rows and say how many were left.
- An `agents` call that is not a spawn still shows its agent: `status`, `wait`, `ask` and friends put
  the handle on an `agent` row, `list`, `actors`, `models` and `peers` draw one `item` per entry with
  its state.
- A judgment call shows its verdict as a badge — `yes · 93%`, the choice, or the score — with one line
  per answered question and the backend in the fold's head, instead of the JSON envelope.
- A spawn — `agents.spawn`, `agents.run`, `agents.handoff` — shows the agent it started instead of a
  cut of its brief: the line reads `agents.spawn ExploreRepos · 5.2s`, and the row under it names the runner and
  model, carries the brief's first line, and opens onto the whole brief as markdown. The row's status
  comes from the handle fabric returned (`running` reads as pending, `completed` as done), falling back
  to the call's own success. The brief is fabric's own 2000-character preview of the `task` argument, so
  a longer assignment is shown up to that cut.
- Display is per tool. `read` and `write` carry their fact on the call line — `3 lines`, `42 bytes` — and
  draw no output at all: a file's own text is data, not something anyone reads back in a
  transcript. Everything else keeps its fold, and `edit` gets the diff. The table lives in `TOOL_DISPLAY`
  in `src/describe.ts` and falls back to the generic fold for a tool it does not name.
- Any other call's output is drawn as a terminal (`ansi`) with its own colors, not as highlighted JSON: an
  envelope's `output` field when the tool answers with one, its string when it returns text, its
  printed JSON otherwise — and it lives in a fold named and counted after its call (`bash output · 12
  lines`), so a column of folds still says which call each one came from.
- A write still running shows the content it is about to write: fabric previews the `content`
  argument from the call itself, so the card carries a `preview` fold with the file's own grammar
  before the write lands. The preview is a prefix — fabric cuts `content` at 16000 characters — and
  the fold's head says `first 16000 chars` when the cut hit. Once the call returns, the preview is
  gone and the line carries the byte count instead.
- When a program returns fewer lines than its nested reads handed it, the card says so on a warning
  row — `→ 12 of 40 lines to model` — mirroring omp's own read notice, because the model sees only
  what the program returned.
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
  not visible to an extension and the summary omits it while the call runs.
- No block inside a `fabric_exec` card can carry its own frame from the node tree: the protocol
  draws one ring per tool call and flattens nested frames by design. The borders in `style.css`
  are a Tern sheet, so they exist only in Tern, only while this plugin is loaded, and a user CSS
  theme installed after it can override them.

## Layout

```text
index.ts          omp extension entry; installs the renderers only in Tern
src/attach.ts     wraps Fabric’s renderCall/renderResult before omp adapts the definition
src/describe.ts   builds native UiNode bodies from fabric_exec args and audits
src/node.ts       constructs pi-tui nodes with wire props
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
omp -p hi -e ./index.ts --no-session --max-time 5
```

## Uninstall

```sh
omp plugin uninstall tern-omp-fabric
tern plugin remove omp-fabric   # or: tern plugin unlink omp-fabric
```
