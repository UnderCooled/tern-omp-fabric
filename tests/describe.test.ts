import { describe, expect, test } from "bun:test";
import type { NativeChild, NativeNode } from "@oh-my-pi/pi-tui";
import type { NativeToolHead, NativeToolView } from "@oh-my-pi/pi-tui/tools";
import {
	codeLineCount,
	describeFabricCall,
	describeFabricResult,
	programText,
	type DescribeOptions,
	type FabricAudit,
	type FabricDetails,
} from "../src/describe";
import { fabricCallArgs, fabricDetails, fabricResult, fromTraceAudit, OUTPUT_TEXT, slowAudit, traceOnlyDetails } from "./fixtures";

type Span = { t: string; s?: string };

/** Unwrap an optional value or fail the test with a readable message. */
function unwrap<T>(value: T | undefined | null, what: string): T {
	if (value === undefined || value === null) throw new Error("expected " + what + ", got " + String(value));
	return value;
}

/** The body is described nodes only; a component child would mean the view is wrong. */
function asNode(child: NativeChild): NativeNode {
	if (!("k" in child)) throw new Error("expected a described node, found a component");
	return child;
}

const nodes = (children: readonly NativeChild[] | undefined): NativeNode[] => [...(children ?? [])].map(asNode);
const props = (node: NativeNode): Record<string, unknown> => (node.p ?? {}) as Record<string, unknown>;
const spanList = (value: unknown): Span[] => (Array.isArray(value) ? (value as Span[]) : []);
const textSpans = (node: NativeNode): Span[] => spanList(props(node).spans);
const headSpans = (node: NativeNode): Span[] => spanList(props(node).head);
const joined = (spans: Span[]): string => spans.map(span => span.t).join("");
const kindList = (children: readonly NativeChild[] | undefined): string[] => nodes(children).map(node => node.k);
const byKind = (children: readonly NativeChild[] | undefined, k: string): NativeNode | undefined =>
	nodes(children).find(node => node.k === k);
const byKey = (children: readonly NativeChild[] | undefined, key: string): NativeNode | undefined =>
	nodes(children).find(node => node.key === key);
const withRole = (children: readonly NativeChild[] | undefined, role: string): NativeNode[] =>
	nodes(children).filter(node => props(node).role === role);
const actionOf = (node: NativeNode): Record<string, unknown> =>
	(typeof props(node).actions === "object" && props(node).actions !== null
		? props(node).actions
		: {}) as Record<string, unknown>;
const auditsOf = (details: FabricDetails): FabricAudit[] => details.audits ?? [];
const toolHead = (view: NativeToolView): NativeToolHead => unwrap(view.tool, "tool head");

/** A head meta entry is a plain fact or a run of styled spans. */
const factText = (entry: unknown): string => (typeof entry === "string" ? entry : joined(spanList(entry)));
const facts = (view: NativeToolView): string[] => (unwrap(toolHead(view).meta, "head meta") as unknown[]).map(factText);
const lastFact = (view: NativeToolView): Span[] => {
	const meta = unwrap(toolHead(view).meta, "head meta") as unknown[];
	return spanList(meta[meta.length - 1]);
};

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

	test("head is the verb, the counts, and the deadline it runs under", () => {
		const head = toolHead(view);
		expect(head.title).toBe("Fabric");
		expect(head.target).toBeUndefined();
		expect(head.command).toBeUndefined();
		expect(facts(view)).toEqual(["Sweep TODOs", "TypeScript · 12 lines", "timeout 30s"]);
		expect(lastFact(view)).toEqual([{ t: "timeout 30s", s: "muted" }]);
	});

	test("the description is the first body child", () => {
		const description = unwrap(nodes(view.body)[0], "description line");
		expect(description.k).toBe("text");
		const span = unwrap(textSpans(description)[0], "description span");
		expect(span.s).toBe("muted");
		expect(span.t).toBe("Greps src for TODO markers and reports files.");
	});

	test("the program is its own fold, counted in its head", () => {
		const program = unwrap(byKey(view.body, "program"), "program fold");
		expect(program.k).toBe("section");
		expect(props(program).role).toBe("omp-fabric.program");
		expect(props(program).collapsible).toBe(true);
		expect(props(program).collapsed).toBe(true);
		expect(joined(headSpans(program))).toBe("program · 12 lines");
	});

	test("opening the program fold shows the whole program, and clicking the code copies it", () => {
		const program = unwrap(byKey(view.body, "program"), "program fold");
		const code = unwrap(byKind(program.c, "code"), "program code");
		expect(props(code).text).toBe(programText(fabricCallArgs));
		expect(props(code).lang).toBe("typescript");
		expect(props(code).preview).toBeUndefined();
		expect(actionOf(code).click).toBe("copy");
	});

	test("expanding the card starts the program open", () => {
		const expanded = unwrap(describeFabricCall(fabricCallArgs, { expanded: true }), "expanded call view");
		expect(props(unwrap(byKey(expanded.body, "program"), "program fold")).collapsed).toBe(false);
	});

	test("nothing in the body is a card", () => {
		for (const node of nodes(view.body)) expect(node.k).not.toBe("card");
	});

	test("incomplete args with no code show composing…", () => {
		const composing = unwrap(describeFabricCall(undefined, { argsComplete: false }), "composing view");
		expect(kindList(composing.body)).toEqual(["text"]);
		expect(joined(textSpans(unwrap(nodes(composing.body)[0], "composing text")))).toBe("composing…");
	});

	test("complete args with no code and no timeout render an empty body", () => {
		const empty = unwrap(describeFabricCall(undefined, options), "empty call view");
		expect(kindList(empty.body)).toEqual([]);
		expect(empty.tool?.meta).toBeUndefined();
	});
});

describe("describeFabricResult", () => {
	const settled: DescribeOptions = { elapsedMs: 2400 };
	const view = unwrap(describeFabricResult(fabricResult, settled, fabricCallArgs), "result view");

	test("head: verb, line count, calls, failures, phases, then the outcome", () => {
		expect(facts(view)).toEqual([
			"Sweep TODOs",
			"TypeScript · 12 lines",
			"3 calls",
			"1 failed",
			"2 phases",
			"✓ Done · 2.4s",
		]);
		expect(lastFact(view)).toEqual([
			{ t: "✓ Done", s: "success" },
			{ t: " · 2.4s", s: "muted" },
		]);
	});

	test("body: the program fold, the phase row, then each call with its output", () => {
		expect(kindList(view.body)).toEqual([
			"section",
			"row",
			"text",
			"section",
			"text",
			"section",
			"text",
			"text",
		]);
		expect(withRole(view.body, "omp-fabric.call")).toHaveLength(3);
		expect(withRole(view.body, "omp-fabric.output")).toHaveLength(2);
		expect(props(unwrap(byKind(view.body, "row"), "phase row")).role).toBe("omp-fabric.phase");
	});

	test("a call line names the call and its timing", () => {
		const line = withRole(view.body, "omp-fabric.call")[0];
		const spans = textSpans(unwrap(line, "first call line"));
		expect(spans.find(span => span.s === "strong")?.t).toBe("grep");
		expect(joined(spans.filter(span => span.s === "accent"))).toContain("/foo/ in src");
		expect(joined(spans.filter(span => span.s === "muted"))).toContain("24ms");
	});

	test("every call that returned something has an output fold, folded", () => {
		for (const output of withRole(view.body, "omp-fabric.output")) {
			expect(props(output).collapsed).toBe(true);
		}
	});

	test("a failing call still carries its message", () => {
		const message = unwrap(
			nodes(view.body).find(
				node => props(node).role !== "omp-fabric.call" && textSpans(node).some(span => span.s === "error"),
			),
			"error text",
		);
		expect(joined(textSpans(message))).toContain("connection reset by peer");
	});

	test("a failed result says so in the head", () => {
		const failed = unwrap(
			describeFabricResult({ ...fabricResult, isError: true }, settled, fabricCallArgs),
			"failed result view",
		);
		expect(lastFact(failed)[0]).toEqual({ t: "✗ Failed", s: "error" });
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
		expect(joined(lastFact(running))).toBe("timeout 30s");
		expect(kindList(running.body)).toEqual(["section"]);
	});

	test("a cancelled call says so", () => {
		const cancelled = unwrap(
			describeFabricResult({ ...fabricResult }, { elapsedMs: 900, cancelled: true }, fabricCallArgs),
			"cancelled result view",
		);
		expect(lastFact(cancelled)[0]).toEqual({ t: "✗ Cancelled", s: "warning" });
	});
});

describe("when a call shows its output", () => {
	function render(audit: FabricAudit, opts: DescribeOptions = options): NativeToolView {
		return unwrap(
			describeFabricResult({ content: [], details: { ...fabricDetails, audits: [audit] } }, opts, fabricCallArgs),
			"single-audit view",
		);
	}

	test("a slow call gets an output fold, counted in its head", () => {
		const view = render(slowAudit);
		const output = unwrap(byKey(view.body, "output:0"), "output fold");
		expect(output.k).toBe("section");
		expect(props(output).role).toBe("omp-fabric.output");
		expect(props(output).collapsible).toBe(true);
		expect(props(output).collapsed).toBe(true);
		// Named after its call: two output folds side by side must be tellable apart.
		expect(joined(headSpans(output))).toBe("bash output · 6 lines");
	});

	test("opening that fold shows the whole output", () => {
		const view = render(slowAudit);
		const ansi = unwrap(byKey(unwrap(byKey(view.body, "output:0"), "output fold").c, "output:0:text"), "output text");
		expect(ansi.k).toBe("ansi");
		expect(String(props(ansi).text).split("\n")).toEqual(["line 1", "line 2", "line 3", "line 4", "line 5", "line 6"]);
		expect(props(ansi).preview).toBeUndefined();
	});

	test("a fast working call gets one too, and it starts folded", () => {
		const output = unwrap(byKey(render(unwrap(auditsOf(fabricDetails)[0], "grep audit")).body, "output:0"), "output fold");
		expect(props(output).collapsed).toBe(true);
	});

	test("a failure gets one even when fast", () => {
		expect(byKey(render({ ...slowAudit, success: false, endedAt: 10 }).body, "output:0")).toBeDefined();
	});

	test("expanding the card opens every fold", () => {
		const view = render(unwrap(auditsOf(fabricDetails)[1], "read audit"), { expanded: true });
		expect(props(unwrap(byKey(view.body, "program"), "program fold")).collapsed).toBe(false);
		expect(props(unwrap(byKey(view.body, "output:0"), "output fold")).collapsed).toBe(false);
	});
});

describe("how a call's output is drawn", () => {
	function outputText(audit: FabricAudit): unknown {
		const view = unwrap(
			describeFabricResult({ content: [], details: { ...fabricDetails, audits: [audit] } }, { expanded: true }, fabricCallArgs),
			"single-audit view",
		);
		const fold = unwrap(byKey(view.body, "output:0"), "output fold");
		return props(unwrap(byKind(fold.c, "ansi"), "output text")).text;
	}

	test("text is drawn as a terminal, not as highlighted JSON", () => {
		expect(outputText(unwrap(auditsOf(fabricDetails)[0], "grep audit"))).toBe(
			"src/a.ts:12: foo\nsrc/b.ts:3: food\nsrc/c.ts:88: foobar",
		);
	});

	test("a structured result is terminal text too, never the JSON viewer", () => {
		const text = String(outputText(unwrap(auditsOf(fabricDetails)[1], "read audit")));
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

describe("caps", () => {
	function render(opts: DescribeOptions): NativeToolView {
		const audits: FabricAudit[] = Array.from({ length: 12 }, (_, index) => ({ ...fromTraceAudit, ref: "omp.grep." + index }));
		return unwrap(
			describeFabricResult({ content: [{ type: "text", text: OUTPUT_TEXT }], details: { audits } }, opts, fabricCallArgs),
			"capped result view",
		);
	}

	test("folded: 8 call lines plus a muted … 4 calls more", () => {
		const view = render(options);
		expect(withRole(view.body, "omp-fabric.call")).toHaveLength(8);
		const more = unwrap(
			nodes(view.body).find(node => joined(textSpans(node)).includes("more")),
			"the more line",
		);
		expect(joined(textSpans(more))).toBe("… 4 calls more");
	});

	test("expanded: all 12 call lines", () => {
		expect(withRole(render({ expanded: true }).body, "omp-fabric.call")).toHaveLength(12);
	});
});

describe("trace-only details", () => {
	const view = unwrap(
		describeFabricResult({ content: [{ type: "text", text: OUTPUT_TEXT }], details: traceOnlyDetails }, options, fabricCallArgs),
		"trace-only view",
	);

	test("one line per trace operation, keyed to its ref", () => {
		const lines = withRole(view.body, "omp-fabric.call");
		expect(lines).toHaveLength(2);
		expect(lines[0]?.key).toBe("call:0:omp.grep");
		expect(lines[1]?.key).toBe("call:1:omp.read");
	});

	test("the failing operation carries its error", () => {
		const message = unwrap(
			nodes(view.body).find(
				node => props(node).role !== "omp-fabric.call" && textSpans(node).some(span => span.s === "error"),
			),
			"trace error",
		);
		expect(joined(textSpans(message))).toContain("ENOENT");
	});

	test("undefined details render the program alone", () => {
		const bare = unwrap(
			describeFabricResult({ content: [{ type: "text", text: OUTPUT_TEXT }] }, options, fabricCallArgs),
			"no-details view",
		);
		expect(kindList(bare.body)).toEqual(["section"]);
	});
});
