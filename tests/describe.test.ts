import { describe, expect, test } from "bun:test";
import type { UiNode } from "@oh-my-pi/pi-tui";
import {
	codeLineCount,
	describeFabricCall,
	describeFabricResult,
	programText,
	type DescribeOptions,
	type FabricAudit,
	type FabricDetails,
} from "../src/describe";
import {
	editAudit,
	fabricCallArgs,
	fabricDetails,
	fabricResult,
	fromTraceAudit,
	OUTPUT_TEXT,
	slowAudit,
	spawnAudit,
	traceOnlyDetails,
} from "./fixtures";

type Span = { t: string; s?: string; href?: string };

/** Unwrap an optional value or fail the test with a readable message. */
function unwrap<T>(value: T | undefined | null, what: string): T {
	if (value === undefined || value === null) throw new Error("expected " + what + ", got " + String(value));
	return value;
}

const props = (node: UiNode): Record<string, unknown> => node.props() as Record<string, unknown>;
const spanList = (value: unknown): Span[] => (Array.isArray(value) ? (value as Span[]) : []);
const textSpans = (node: UiNode): Span[] => spanList(props(node).spans);
const headSpans = (node: UiNode): Span[] => spanList(props(node).head);
const joined = (spans: Span[]): string => spans.map((span) => span.t).join("");
const kindList = (children: readonly UiNode[]): string[] => children.map((node) => node.kind);
const byKind = (children: readonly UiNode[], k: string): UiNode | undefined => children.find((node) => node.kind === k);
const byKey = (children: readonly UiNode[], key: string): UiNode | undefined =>
	children.find((node) => node.props().key === key);
const withRole = (children: readonly UiNode[], role: string): UiNode[] =>
	children.filter((node) => props(node).role === role);
const actionOf = (node: UiNode): Record<string, unknown> =>
	(typeof props(node).actions === "object" && props(node).actions !== null ? props(node).actions : {}) as Record<
		string,
		unknown
	>;
const auditsOf = (details: FabricDetails): FabricAudit[] => details.audits ?? [];
const summary = (body: readonly UiNode[]): Span[] => textSpans(unwrap(byKey(body, "summary"), "Fabric summary"));

const options: DescribeOptions = { elapsedMs: 1200 };

describe("programText / codeLineCount", () => {
	test("joins string[] code with newlines and normalizes CRLF", () => {
		expect(programText({ code: ["const a = 1;", "const b = 2;"] })).toBe("const a = 1;\nconst b = 2;");
		expect(programText({ code: "const a = 1;\r\nconst b = 2;\r" })).toBe("const a = 1;\nconst b = 2;");
	});

	test("counts the joined lines", () => {
		expect(codeLineCount({ code: ["a", "b", "c"] })).toBe(3);
		expect(codeLineCount(undefined)).toBe(0);
	});
});

describe("describeFabricCall", () => {
	const view = unwrap(describeFabricCall(fabricCallArgs, options), "call view");

	test("the first body row names the run, line count and deadline", () => {
		expect(view[0]?.props().role).toBe("omp-fabric.summary");
		expect(joined(summary(view))).toBe("Sweep TODOs · TypeScript · 12 lines · timeout 30s");
	});

	test("the description follows the summary", () => {
		const description = unwrap(view[1], "description line");
		expect(description.kind).toBe("text");
		const span = unwrap(textSpans(description)[0], "description span");
		expect(span.s).toBe("muted");
		expect(span.t).toBe("Greps src for TODO markers and reports files.");
	});

	test("the program is its own fold, counted in its head", () => {
		const program = unwrap(byKey(view, "program"), "program fold");
		expect(program.kind).toBe("section");
		expect(props(program).role).toBe("omp-fabric.program");
		expect(props(program).collapsible).toBe(true);
		expect(props(program).collapsed).toBe(true);
		expect(joined(headSpans(program))).toBe("program · 12 lines");
	});

	test("opening the program fold shows the whole program, and clicking the code copies it", () => {
		const program = unwrap(byKey(view, "program"), "program fold");
		const code = unwrap(byKind(program.children(), "code"), "program code");
		expect(props(code).text).toBe(programText(fabricCallArgs));
		expect(props(code).lang).toBe("typescript");
		expect(props(code).preview).toBeUndefined();
		expect(actionOf(code).click).toBe("copy");
		expect(actionOf(code).hold).toEqual(["copy"]);
	});

	test("long programs show the code overview without changing what Copy sees", () => {
		const source = Array.from({ length: 21 }, (_, i) => `// line ${i}`).join("\n");
		const program = unwrap(byKey(describeFabricCall({ code: source }, { expanded: true }), "program"), "program fold");
		const code = unwrap(byKind(program.children(), "code"), "program code");
		expect(props(code)).toMatchObject({ overview: true, text: source });
	});

	test("expanding the card starts the program open", () => {
		const expanded = unwrap(describeFabricCall(fabricCallArgs, { expanded: true }), "expanded call view");
		expect(props(unwrap(byKey(expanded, "program"), "program fold")).collapsed).toBe(false);
	});

	test("nothing in the body is a card", () => {
		for (const node of view) expect(node.kind).not.toBe("card");
	});

	test("incomplete args with no code show composing…", () => {
		const composing = unwrap(describeFabricCall(undefined, { argsComplete: false }), "composing view");
		expect(kindList(composing)).toEqual(["text"]);
		expect(joined(textSpans(unwrap(composing[0], "composing text")))).toBe("composing…");
	});

	test("complete args with no code and no timeout render an empty body", () => {
		const empty = unwrap(describeFabricCall(undefined, options), "empty call view");
		expect(kindList(empty)).toEqual([]);
	});
});

describe("describeFabricResult", () => {
	const settled: DescribeOptions = { elapsedMs: 2400 };
	const view = unwrap(describeFabricResult(fabricResult, settled, fabricCallArgs), "result view");

	test("the summary includes the call counts, failures, phases and outcome", () => {
		expect(joined(summary(view))).toBe(
			"Sweep TODOs · TypeScript · 12 lines · 3 calls · 1 failed · 2 phases · ✓ Done · 2.4s",
		);
		expect(summary(view)).toContainEqual({ t: "✓ Done", s: "success" });
	});

	test("body: the program fold, the phase row, then each call with its output", () => {
		// The read call has no fold: a file's own text is not output a person reads.
		expect(kindList(view)).toEqual(["text", "section", "row", "text", "section", "text", "text", "text"]);
		expect(withRole(view, "omp-fabric.call")).toHaveLength(3);
		expect(withRole(view, "omp-fabric.output")).toHaveLength(1);
		expect(props(unwrap(byKind(view, "row"), "phase row")).role).toBe("omp-fabric.phase");
	});

	test("a call line names the call and its timing", () => {
		const line = withRole(view, "omp-fabric.call")[0];
		const spans = textSpans(unwrap(line, "first call line"));
		expect(spans.find((span) => span.s === "strong")?.t).toBe("grep");
		expect(joined(spans.filter((span) => span.s === "accent"))).toContain("/foo/ in src");
		expect(joined(spans.filter((span) => span.s === "muted"))).toContain("24ms");
	});

	test("every call that returned something has an output fold, folded", () => {
		for (const output of withRole(view, "omp-fabric.output")) {
			expect(props(output).collapsed).toBe(true);
		}
	});

	test("a failing call still carries its message", () => {
		const message = unwrap(
			view.find((node) => props(node).role === undefined && textSpans(node).some((span) => span.s === "error")),
			"error text",
		);
		expect(joined(textSpans(message))).toContain("connection reset by peer");
	});

	test("a failed result says so in the head", () => {
		const failed = unwrap(
			describeFabricResult({ ...fabricResult, isError: true }, settled, fabricCallArgs),
			"failed result view",
		);
		expect(summary(failed)).toContainEqual({ t: "✗ Failed", s: "error" });
	});

	test("an unfinished call reports its timeout instead of an outcome", () => {
		const running = unwrap(
			describeFabricResult(
				{ isError: false, content: [], details: { audits: [], phases: [] } },
				{ isPartial: true },
				fabricCallArgs,
			),
			"running result view",
		);
		expect(joined(summary(running))).toEndWith("timeout 30s");
		expect(kindList(running)).toEqual(["text", "section"]);
	});
});

describe("when a call shows its output", () => {
	function render(audit: FabricAudit, opts: DescribeOptions = options): UiNode[] {
		return unwrap(
			describeFabricResult({ content: [], details: { ...fabricDetails, audits: [audit] } }, opts, fabricCallArgs),
			"single-audit view",
		);
	}

	/** The last span of a call's own line: the fact it carries instead of a fold. */
	function lineFact(view: UiNode[]): Span | undefined {
		const line = unwrap(
			view.find((node) => props(node).role === "omp-fabric.call"),
			"call line",
		);
		const spans = textSpans(line);
		return spans[spans.length - 1];
	}

	test("a slow call gets an output fold that starts open", () => {
		const view = render(slowAudit);
		const output = unwrap(byKey(view, "output:0"), "output fold");
		expect(output.kind).toBe("section");
		expect(props(output).role).toBe("omp-fabric.output");
		expect(props(output).collapsible).toBe(true);
		expect(props(output).collapsed).toBe(false);
		// Named after its call: two output folds side by side must be tellable apart.
		expect(joined(headSpans(output))).toBe("bash output · 6 lines");
	});

	test("opening that fold shows the whole output", () => {
		const view = render(slowAudit);
		const ansi = unwrap(
			byKey(unwrap(byKey(view, "output:0"), "output fold").children(), "output:0:text"),
			"output text",
		);
		expect(ansi.kind).toBe("ansi");
		expect(String(props(ansi).text).split("\n")).toEqual(["line 1", "line 2", "line 3", "line 4", "line 5", "line 6"]);
		expect(props(ansi).preview).toBeUndefined();
	});

	test("a fast call keeps its fold closed", () => {
		const output = unwrap(byKey(render(unwrap(auditsOf(fabricDetails)[0], "grep audit")), "output:0"), "output fold");
		expect(props(output).collapsed).toBe(true);
	});

	test("a failure gets one even when fast", () => {
		expect(byKey(render({ ...slowAudit, success: false, endedAt: 10 }), "output:0")).toBeDefined();
	});

	test("a bash command is a shell code block of its own, and leaves the line", () => {
		const view = render({
			ref: "omp.bash",
			tool: "bash",
			success: true,
			args: { command: "bun test 2>&1 | tail -4" },
			result: "43 pass",
			startedAt: 0,
			endedAt: 40,
		});
		const row = unwrap(byKey(view, "call:0:command"), "command row");
		expect(row.kind).toBe("row");
		const indent = unwrap(row.children()[0], "indent cell");
		expect(joined(textSpans(indent))).toBe("  ");
		const command = unwrap(row.children()[1], "command block");
		expect(command.kind).toBe("md");
		expect(props(command)).toMatchObject({
			text: "```bash\nbun test 2>&1 | tail -4\n```",
			role: "omp-fabric.command",
		});
		const line = unwrap(
			view.find((node) => props(node).role === "omp-fabric.call"),
			"call line",
		);
		expect(joined(textSpans(line))).toBe("bash · 40ms");
		expect(props(line).hovercard).toMatchObject({ k: "code", p: { text: "bun test 2>&1 | tail -4", lang: "bash" } });
		expect(props(unwrap(byKey(view, "output:0"), "output fold")).hovercard).toMatchObject({
			k: "ansi",
			p: { text: "43 pass" },
		});
	});

	test("a command holding a backtick fence gets a longer one around it", () => {
		const view = render({
			ref: "omp.bash",
			tool: "bash",
			success: true,
			args: { command: "echo '```js'" },
			result: "x",
			startedAt: 0,
			endedAt: 10,
		});
		const row = unwrap(byKey(view, "call:0:command"), "command row");
		expect(props(unwrap(row.children()[1], "command block")).text).toBe("````bash\necho '```js'\n````");
	});

	test("a read says how many lines it returned, with no fold", () => {
		const view = render({
			ref: "omp.read",
			tool: "read",
			success: true,
			args: { path: "src/a.ts" },
			result: "one\ntwo\nthree\n",
			startedAt: 0,
			endedAt: 12,
		});
		expect(byKey(view, "output:0")).toBeUndefined();
		expect(lineFact(view)).toEqual({ t: "3 lines", s: "muted" });
	});

	test("a write says how many bytes it took, with no fold", () => {
		const view = render({
			ref: "omp.write",
			tool: "write",
			success: true,
			args: { path: "src/a.ts" },
			result: "Successfully wrote 128 bytes to src/a.ts",
			startedAt: 0,
			endedAt: 12,
		});
		expect(byKey(view, "output:0")).toBeUndefined();
		expect(lineFact(view)).toEqual({ t: "128 bytes", s: "muted" });
	});

	test("a call that printed nothing says so on its line, with no fold", () => {
		for (const result of ["(no output)", "   "]) {
			const view = render({ ...slowAudit, result, endedAt: 9000 });
			expect(byKey(view, "output:0")).toBeUndefined();
			expect(lineFact(view)).toEqual({ t: "(no output)", s: "warning strong" });
		}
	});

	test("expanding the card opens every fold", () => {
		const view = render({ ...slowAudit, endedAt: 10 }, { expanded: true });
		expect(props(unwrap(byKey(view, "program"), "program fold")).collapsed).toBe(false);
		expect(props(unwrap(byKey(view, "output:0"), "output fold")).collapsed).toBe(false);
	});
});

describe("a spawn shows the agent it started", () => {
	function render(audit: FabricAudit, opts: DescribeOptions = options): UiNode[] {
		return unwrap(
			describeFabricResult(
				{ content: [], details: { success: true, phases: [], audits: [audit] } },
				opts,
				fabricCallArgs,
			),
			"spawn view",
		);
	}
	function callLine(view: UiNode[]): UiNode {
		return unwrap(
			view.find((node) => props(node).role === "omp-fabric.call"),
			"call line",
		);
	}
	function agentRows(view: UiNode[]): UiNode[] {
		return view.filter((node) => node.kind === "agent");
	}

	test("the line names the agent instead of cutting the task to 72 characters", () => {
		expect(joined(textSpans(callLine(render(spawnAudit))))).toBe("agents.spawn ExploreRepos · 5.2s");
	});

	test("the spawn gets a row naming the runner and model, with the whole brief under it", () => {
		const rows = agentRows(render({ ...spawnAudit, result: { ...(spawnAudit.result as object), thinking: "xhigh" } }));
		expect(rows.length).toBe(1);
		const row = unwrap(rows[0], "agent row");
		expect(props(row)).toMatchObject({
			name: "ExploreRepos",
			agent: "omp",
			model: "anthropic/claude-sonnet-4-5",
			thinking: "thinkingXhigh",
			status: "pending",
			collapsible: true,
			collapsed: true,
			role: "omp-fabric.agent",
		});
		const brief = unwrap(row.children()[0], "brief");
		expect(brief.kind).toBe("md");
		expect(props(brief).text).toBe(
			"Complete assignment thoroughly: find every caller of describeFabricResult.\n\nThen report the files.",
		);
	});

	test("the row summarizes the brief in one line, without omp's assignment prefix", () => {
		const rows = agentRows(render(spawnAudit));
		expect(props(unwrap(rows[0], "agent row")).task).toBe("find every caller of describeFabricResult.");
	});

	test("a handle that failed says so on the row", () => {
		const view = render({
			...spawnAudit,
			result: { ...(spawnAudit.result as object), status: "failed" },
			success: false,
		});
		expect(props(unwrap(agentRows(view)[0], "agent row")).status).toBe("failed");
	});

	test("a waited run reports the agent as done", () => {
		const view = render({
			...spawnAudit,
			ref: "agents.run",
			tool: "run",
			result: { id: "01a1589d", name: "ExploreRepos", status: "completed", runner: "omp" },
			endedAt: 40,
		});
		expect(joined(textSpans(callLine(view)))).toBe("agents.run ExploreRepos · 40ms");
		expect(props(unwrap(agentRows(view)[0], "agent row")).status).toBe("done");
	});

	test("expanding the card opens the brief", () => {
		const rows = agentRows(render(spawnAudit, { expanded: true }));
		expect(props(unwrap(rows[0], "agent row")).collapsed).toBe(false);
	});

	test("another provider's spawn-shaped call is left to the generic line", () => {
		const view = render({ ...spawnAudit, provider: "mcp", tool: "spawn" });
		expect(agentRows(view).length).toBe(0);
	});

	test("a spawn with no result yet reads as pending, with no (no output) marker", () => {
		const view = render({ ...spawnAudit, result: undefined, endedAt: undefined });
		expect(props(unwrap(agentRows(view)[0], "agent row")).status).toBe("pending");
		expect(joined(textSpans(callLine(view)))).not.toContain("no output");
	});
});

describe("how a call's output is drawn", () => {
	function outputText(audit: FabricAudit): unknown {
		const view = unwrap(
			describeFabricResult(
				{ content: [], details: { ...fabricDetails, audits: [audit] } },
				{ expanded: true },
				fabricCallArgs,
			),
			"single-audit view",
		);
		const fold = unwrap(byKey(view, "output:0"), "output fold");
		return props(unwrap(byKind(fold.children(), "ansi"), "output text")).text;
	}

	test("text is drawn as a terminal, not as highlighted JSON", () => {
		expect(
			outputText({
				ref: "omp.bash",
				tool: "bash",
				provider: "omp",
				success: true,
				args: { command: "echo hi" },
				result: "hi",
				startedAt: 0,
				endedAt: 10,
			}),
		).toBe("hi");
	});

	test("a grep's matches are grouped by file, not dumped as lines", () => {
		const view = unwrap(
			describeFabricResult(
				{ content: [], details: { ...fabricDetails, audits: [unwrap(auditsOf(fabricDetails)[0], "grep audit")] } },
				{ expanded: true },
				fabricCallArgs,
			),
			"grep view",
		);
		const fold = unwrap(byKey(view, "output:0"), "output fold");
		const tree = unwrap(byKind(fold.children(), "tree"), "grep tree");
		expect(props(tree).role).toBe("omp-fabric.grep");
		const files = props(tree).nodes as { label: unknown; children?: unknown[] }[];
		expect(files.map((file) => joined(spanList(file.label)))).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
		expect(files.map((file) => file.children?.length)).toEqual([1, 1, 1]);
	});

	test("a structured result is terminal text too, never the JSON viewer", () => {
		const text = String(outputText({ ...slowAudit, result: { lines: 40, truncated: false } }));
		expect(text).toContain('"lines": 40');
	});

	test("an envelope result shows only its output field", () => {
		const text = outputText({
			ref: "omp.bash",
			tool: "bash",
			success: true,
			args: { command: "ls" },
			result: { ok: true, output: "src/a.ts\nsrc/b.ts", details: { exit: 0 } },
			startedAt: 0,
			endedAt: 5000,
		});
		expect(text).toBe("src/a.ts\nsrc/b.ts");
	});
});

describe("an edit answers with a diff", () => {
	function editOutput(opts: DescribeOptions = options): UiNode {
		const view = unwrap(
			describeFabricResult({ content: [], details: { ...fabricDetails, audits: [editAudit] } }, opts, fabricCallArgs),
			"edit view",
		);
		return unwrap(byKey(view, "output:0"), "output fold");
	}

	test("the diff is handed to Tern's diff kind, not printed as text", () => {
		const fold = editOutput();
		expect(byKind(fold.children(), "ansi")).toBeUndefined();
		const diff = unwrap(byKind(fold.children(), "diff"), "diff node");
		expect(props(diff).mode).toBe("auto");
		expect(props(diff).path).toBe("src/a.ts");
		const hunks = props(diff).hunks as { oldStart: number; newStart: number; lines: string[] }[];
		expect(hunks).toEqual([{ oldStart: 1, newStart: 1, lines: [" alpha", "-beta", "+BETA", " gamma"] }]);
	});

	test("its head counts the diff's lines", () => {
		expect(joined(headSpans(editOutput()))).toBe("edit output · 4 lines");
	});

	test("a gap in the numbering starts a second hunk", () => {
		const view = unwrap(
			describeFabricResult(
				{
					content: [],
					details: {
						audits: [
							{
								...editAudit,
								result: { details: { diff: " 1|a\n-2|b\n+2|B\n 9|z\n-10|y\n+10|Y" } },
							},
						],
					},
				},
				options,
				fabricCallArgs,
			),
			"two-hunk view",
		);
		const diff = unwrap(byKind(unwrap(byKey(view, "output:0"), "output fold").children(), "diff"), "diff node");
		const hunks = props(diff).hunks as { oldStart: number; newStart: number; lines: string[] }[];
		expect(hunks.map((hunk) => hunk.oldStart)).toEqual([1, 9]);
		expect(hunks[1]?.lines).toEqual([" z", "-y", "+Y"]);
	});

	test("without details.diff the two texts still give a diff", () => {
		const view = unwrap(
			describeFabricResult(
				{
					content: [],
					details: {
						audits: [
							{
								...editAudit,
								result: {
									output: "[src/a.ts]\n1:alpha\n2:BETA\n3:gamma\n",
									details: { path: "src/a.ts", oldText: "alpha\nbeta\ngamma", newText: "alpha\nBETA\ngamma" },
								},
							},
						],
					},
				},
				options,
				fabricCallArgs,
			),
			"synthesised view",
		);
		const diff = unwrap(byKind(unwrap(byKey(view, "output:0"), "output fold").children(), "diff"), "diff node");
		expect(props(diff).hunks).toEqual([{ oldStart: 1, newStart: 1, lines: [" alpha", "-beta", "+BETA", " gamma"] }]);
	});

	test("an edit whose details fabric capped links its file, and draws no output", () => {
		const view = unwrap(
			describeFabricResult(
				{
					content: [],
					details: {
						audits: [
							{
								...editAudit,
								result: {
									ok: true,
									output: "[a.ts]\\n1:x",
									details: {
										fabricTruncated: true,
										originalChars: 34570,
										preview: '{"diff":" 1|a\\n-2|b\\n+2|B"}',
									},
								},
							},
						],
					},
				},
				options,
				fabricCallArgs,
			),
			"capped-details view",
		);
		// A prefix of a diff reads as the whole change: no block, and no marker either.
		expect(kindList(view)).toEqual(["text", "section", "text"]);
		expect(byKey(view, "output:0")).toBeUndefined();
		const spans = textSpans(unwrap(withRole(view, "omp-fabric.call")[0], "call line"));
		// A relative path resolves against the directory omp runs in, so the whole line
		// opens the file: label and path both carry the link.
		expect(spans[0]).toEqual({
			t: "edit",
			s: "strong",
			href: `file:///${process.cwd().replace(/\\/g, "/").replace(/^\/+/, "")}/src/a.ts`,
		});
		expect(spans[2]).toEqual({
			t: "src/a.ts",
			s: "accent",
			href: `file:///${process.cwd().replace(/\\/g, "/").replace(/^\/+/, "")}/src/a.ts`,
		});
	});

	test("an absolute path is the link Tern opens the file with", () => {
		const view = unwrap(
			describeFabricResult(
				{
					content: [],
					details: {
						audits: [
							{
								...editAudit,
								args: { path: "D:\\repos\\pkg\\src\\a.ts" },
								result: {
									ok: true,
									output: "[a.ts]\\n1:x",
									details: { fabricTruncated: true, originalChars: 34570, preview: "{}" },
								},
							},
						],
					},
				},
				options,
				fabricCallArgs,
			),
			"linked view",
		);
		const path = textSpans(unwrap(withRole(view, "omp-fabric.call")[0], "call line"))[2];
		expect(path).toEqual({ t: "D:\\repos\\pkg\\src\\a.ts", s: "accent", href: "file:///D:/repos/pkg/src/a.ts" });
	});

	test("a read call's whole line opens the file it read", () => {
		const view = unwrap(
			describeFabricResult(
				{
					content: [],
					details: {
						audits: [
							{
								ref: "omp.read",
								tool: "read",
								provider: "omp",
								args: { path: "src/a.ts" },
								result: "alpha\nbeta\n",
								success: true,
							},
						],
					},
				},
				options,
				fabricCallArgs,
			),
			"read view",
		);
		const spans = textSpans(
			unwrap(
				view.find((node) => props(node).role === "omp-fabric.call"),
				"call line",
			),
		);
		const href = `file:///${process.cwd().replace(/\\/g, "/").replace(/^\/+/, "")}/src/a.ts`;
		expect(spans[0]).toEqual({ t: "read", s: "strong", href });
		expect(spans[2]).toEqual({ t: "src/a.ts", s: "accent", href });
	});

	test("a result fabric itself truncated says so instead of pasting JSON", () => {
		const view = unwrap(
			describeFabricResult(
				{
					content: [],
					details: { audits: [{ ...editAudit, result: { fabricTruncated: true, originalChars: 90000 } }] },
				},
				options,
				fabricCallArgs,
			),
			"truncated view",
		);
		// Nothing to fold: the note is what the call's block shows.
		expect(byKey(view, "output:0")).toBeUndefined();
		const note = unwrap(
			view.find((node) => joined(textSpans(node)).includes("truncated by fabric")),
			"truncation note",
		);
		expect(joined(textSpans(note))).toBe("result truncated by fabric (90000 chars)");
	});

	test("a diff with no changed line falls back to the text", () => {
		const view = unwrap(
			describeFabricResult(
				{ content: [], details: { audits: [{ ...editAudit, result: { details: { diff: " 1|a\n 2|b" } } }] } },
				options,
				fabricCallArgs,
			),
			"unchanged view",
		);
		expect(byKind(unwrap(byKey(view, "output:0"), "output fold").children(), "diff")).toBeUndefined();
	});
});

describe("caps", () => {
	function render(opts: DescribeOptions): UiNode[] {
		const audits: FabricAudit[] = Array.from({ length: 12 }, (_, index) => ({
			...fromTraceAudit,
			ref: "omp.grep." + index,
		}));
		return unwrap(
			describeFabricResult(
				{ content: [{ type: "text", text: OUTPUT_TEXT }], details: { audits } },
				opts,
				fabricCallArgs,
			),
			"capped result view",
		);
	}

	test("folded: 8 call lines plus a muted … 4 calls more", () => {
		const view = render(options);
		expect(withRole(view, "omp-fabric.call")).toHaveLength(8);
		const more = unwrap(
			view.find((node) => joined(textSpans(node)).includes("more")),
			"the more line",
		);
		expect(joined(textSpans(more))).toBe("… 4 calls more");
	});

	test("expanded: all 12 call lines", () => {
		expect(withRole(render({ expanded: true }), "omp-fabric.call")).toHaveLength(12);
	});
});

describe("trace-only details", () => {
	const view = unwrap(
		describeFabricResult(
			{ content: [{ type: "text", text: OUTPUT_TEXT }], details: traceOnlyDetails },
			options,
			fabricCallArgs,
		),
		"trace-only view",
	);

	test("one line per trace operation, keyed to its ref", () => {
		const lines = withRole(view, "omp-fabric.call");
		expect(lines).toHaveLength(2);
		expect(lines[0]?.props().key).toBe("call:0:omp.grep");
		expect(lines[1]?.props().key).toBe("call:1:omp.read");
	});

	test("the failing operation carries its error", () => {
		const message = unwrap(
			view.find((node) => props(node).role === undefined && textSpans(node).some((span) => span.s === "error")),
			"trace error",
		);
		expect(joined(textSpans(message))).toContain("ENOENT");
	});

	test("undefined details render the program alone", () => {
		const bare = unwrap(
			describeFabricResult({ content: [{ type: "text", text: OUTPUT_TEXT }] }, options, fabricCallArgs),
			"no-details view",
		);
		expect(kindList(bare)).toEqual(["text", "section"]);
	});
});

describe("provider rows", () => {
	function line(audit: FabricAudit): string {
		const view = unwrap(
			describeFabricResult(
				{ content: [], details: { success: true, phases: [], audits: [audit] } },
				options,
				fabricCallArgs,
			),
			"provider view",
		);
		const call = unwrap(
			view.find((node) => props(node).role === "omp-fabric.call"),
			"call line",
		);
		return joined(textSpans(call));
	}

	test("a mesh read names its topic and how many entries came back", () => {
		expect(
			line({
				ref: "mesh.read",
				tool: "read",
				provider: "mesh",
				args: { topic: "builds" },
				result: Array.from({ length: 12 }, (_, at) => at),
				success: true,
			}),
		).toBe("mesh.read builds · 12");
	});

	test("a mesh members call lists its members as rows", () => {
		const view = unwrap(
			describeFabricResult(
				{
					content: [],
					details: {
						success: true,
						audits: [
							{
								ref: "mesh.members",
								tool: "members",
								provider: "mesh",
								result: [
									{ id: "session:1", label: "TOF-49", kind: "root", status: "running", model: "omp", stale: false },
									{ id: "session:2", name: "main", kind: "agent", status: "completed", stale: true },
								],
								success: true,
							},
						],
					},
				},
				options,
				fabricCallArgs,
			),
			"mesh members view",
		);
		const list = unwrap(
			view.find((node) => props(node).role === "omp-fabric.mesh-members"),
			"members list",
		);
		const items = list.children();
		expect(items.map((item) => props(item).label)).toEqual(["TOF-49", "main"]);
		expect(props(items[0]!).detail).toBe("root · running · omp");
		expect(props(items[1]!).detail).toBe("agent · completed · stale");
	});

	test("an mcp call names the server and the tool it called", () => {
		expect(
			line({
				ref: "mcp.$call",
				tool: "$call",
				provider: "mcp",
				args: { server: "github", tool: "search" },
				result: { ok: true },
				success: true,
			}),
		).toBe("mcp.$call github.search");
	});

	test("discovery and workflow rows carry their counts", () => {
		expect(
			line({
				ref: "fabric.discovery.list",
				tool: "discovery.list",
				provider: "fabric",
				args: { provider: "omp", namespace: "tools" },
				result: [1, 2, 3],
				success: true,
			}),
		).toBe("fabric.discovery.list omp · tools · 3");
		expect(
			line({
				ref: "fabric.workflow.parallel",
				tool: "workflow.parallel",
				provider: "fabric",
				args: { itemCount: 3, stageCount: 2 },
				result: { ok: true },
				success: true,
			}),
		).toBe("fabric.workflow.parallel 3 items · 2 stages");
	});

	test("a mesh read is not drawn as a core read", () => {
		const view = unwrap(
			describeFabricResult(
				{
					content: [],
					details: {
						success: true,
						audits: [
							{
								ref: "mesh.read",
								tool: "read",
								provider: "mesh",
								args: { topic: "builds" },
								result: ["a", "b"],
								success: true,
							},
						],
					},
				},
				options,
				fabricCallArgs,
			),
			"mesh view",
		);
		// The core read rule would drop the fold and put a line count on the row.
		expect(byKey(view, "output:0")).toBeDefined();
	});
});

describe("agents calls that are not spawns", () => {
	function view(audit: FabricAudit): UiNode[] {
		return unwrap(
			describeFabricResult(
				{ content: [], details: { success: true, phases: [], audits: [audit] } },
				options,
				fabricCallArgs,
			),
			"agents view",
		);
	}

	test("status names the agent on a row", () => {
		const row = unwrap(
			view({
				ref: "agents.status",
				tool: "status",
				provider: "agents",
				args: { id: "01a1589d" },
				result: { id: "01a1589d", name: "ExploreRepos", status: "running", runner: "omp", model: "anthropic/x" },
				success: true,
			}).find((node) => node.kind === "agent"),
			"agent row",
		);
		expect(props(row)).toMatchObject({ name: "ExploreRepos", agent: "omp", model: "anthropic/x", status: "pending" });
	});

	test("a list draws one item per agent, with its state", () => {
		const list = unwrap(
			view({
				ref: "agents.list",
				tool: "list",
				provider: "agents",
				result: [
					{ name: "one", status: "completed" },
					{ name: "two", status: "failed" },
				],
				success: true,
			}).find((node) => node.kind === "list"),
			"agents list",
		);
		expect(list.children().map((item) => props(item).label)).toEqual(["one", "two"]);
		expect(list.children().map((item) => props(item).detail)).toEqual(["done", "failed"]);
	});
});

describe("judgment answers", () => {
	const view = unwrap(
		describeFabricResult(
			{
				content: [],
				details: {
					success: true,
					audits: [
						{
							ref: "judgment.ask",
							tool: "ask",
							provider: "judgment",
							args: { questions: { q: { type: "bool", instructions: "safe to ship?" } } },
							result: { ok: true, backend: "anthropic/claude", answers: { q: { type: "bool", bool: 0.93 } } },
							success: true,
						},
					],
				},
			},
			options,
			fabricCallArgs,
		),
		"judgment view",
	);
	const section = unwrap(byKey(view, "output:0:judgment"), "judgment section");

	test("the verdict is a badge, not a JSON dump", () => {
		expect(props(section).role).toBe("omp-fabric.judgment");
		expect(props(unwrap(byKind(section.children(), "badge"), "verdict badge")).text).toBe("yes · 93%");
		expect(byKind(section.children(), "ansi")).toBeUndefined();
	});

	test("the head names the backend and how many answers came back", () => {
		expect(joined(headSpans(section))).toBe("judgment · claude · 1 answer");
	});

	test("each answered question is one line", () => {
		expect(joined(textSpans(unwrap(byKind(section.children(), "text"), "answer line")))).toBe("• q: yes · 93%");
	});
});

describe("a write's preview", () => {
	function view(args: Record<string, unknown>, result?: unknown): UiNode[] {
		return unwrap(
			describeFabricResult(
				{
					content: [],
					details: {
						success: true,
						audits: [
							{
								ref: "omp.write",
								tool: "write",
								provider: "omp",
								args,
								success: true,
								...(result === undefined ? {} : { result }),
							},
						],
					},
				},
				options,
				fabricCallArgs,
			),
			"preview view",
		);
	}

	test("a running write shows the content it is about to write", () => {
		const preview = unwrap(
			byKey(view({ path: "src/a.ts", content: "export const a = 1;\n" }), "call:0:preview"),
			"preview fold",
		);
		const code = unwrap(byKind(preview.children(), "code"), "preview code");
		expect(props(code).text).toBe("export const a = 1;");
		expect(props(code).path).toBe("src/a.ts");
		expect(joined(headSpans(preview))).toBe("preview · 2 lines");
	});

	test("a capped preview says it is only a prefix", () => {
		const content = "x".repeat(16_000);
		const preview = unwrap(byKey(view({ path: "src/a.ts", content }), "call:0:preview"), "preview fold");
		expect(joined(headSpans(preview))).toContain("first 16000 chars");
	});

	test("a write that already returned says its bytes, with no preview", () => {
		const done = view({ path: "src/a.ts", content: "x" }, "Successfully wrote 1 bytes to src/a.ts");
		expect(byKey(done, "call:0:preview")).toBeUndefined();
	});
});

describe("what reached the model", () => {
	test("a program that returns fewer lines than it read says so", () => {
		const read: FabricAudit = {
			ref: "omp.read",
			tool: "read",
			provider: "omp",
			success: true,
			args: { path: "src/a.ts" },
			result: Array.from({ length: 40 }, (_, at) => "line " + at).join("\n"),
		};
		const view = unwrap(
			describeFabricResult(
				{ content: [{ type: "text", text: "a\nb\nc" }], details: { audits: [read] } },
				options,
				fabricCallArgs,
			),
			"hint view",
		);
		const hint = unwrap(
			view.find((node) => textSpans(node).some((span) => span.t.startsWith("→"))),
			"read hint",
		);
		expect(joined(textSpans(hint))).toBe("→ 3 of 40 lines to model");
	});

	test("a program that returns everything it read says nothing", () => {
		const read: FabricAudit = {
			ref: "omp.read",
			tool: "read",
			provider: "omp",
			success: true,
			args: { path: "src/a.ts" },
			result: "a\nb\nc",
		};
		const view = unwrap(
			describeFabricResult(
				{ content: [{ type: "text", text: "a\nb\nc" }], details: { audits: [read] } },
				options,
				fabricCallArgs,
			),
			"no-hint view",
		);
		expect(view.some((node) => textSpans(node).some((span) => span.t.startsWith("→")))).toBe(false);
	});
});
