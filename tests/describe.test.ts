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
const previewLines = (node: NativeNode): number | undefined => {
	const preview = props(node).preview;
	if (typeof preview !== "object" || preview === null || !("lines" in preview)) return undefined;
	return Number((preview as { lines: number }).lines);
};
const actionOf = (node: NativeNode): Record<string, unknown> =>
	(typeof props(node).actions === "object" && props(node).actions !== null
		? props(node).actions
		: {}) as Record<string, unknown>;
const joined = (spans: Span[]): string => spans.map(span => span.t).join("");
const kindList = (children: readonly NativeChild[] | undefined): string[] => nodes(children).map(node => node.k);
const byKind = (children: readonly NativeChild[] | undefined, k: string): NativeNode | undefined =>
	nodes(children).find(node => node.k === k);
const byKey = (children: readonly NativeChild[] | undefined, key: string): NativeNode | undefined =>
	nodes(children).find(node => node.key === key);
const withRole = (children: readonly NativeChild[] | undefined, role: string): NativeNode[] =>
	nodes(children).filter(node => props(node).role === role);
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

	test("the program is a clamped code block, not a second disclosure", () => {
		const program = unwrap(byKey(view.body, "program"), "program block");
		expect(program.k).toBe("code");
		expect(props(program).role).toBe("omp-fabric.program");
		expect(props(program).collapsed).toBeUndefined();
		expect(previewLines(program)).toBe(4);
		expect(props(program).text).toBe(programText(fabricCallArgs));
		expect(actionOf(program).click).toBe("copy");
	});

	test("nothing in the body is a card or a section", () => {
		for (const node of nodes(view.body)) {
			expect(node.k).not.toBe("card");
			expect(node.k).not.toBe("section");
		}
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

	test("body: program, the phase row, one line per call", () => {
		expect(kindList(view.body)).toEqual(["code", "row", "text", "text", "text", "text"]);
		expect(withRole(view.body, "omp-fabric.call")).toHaveLength(3);
		expect(props(unwrap(byKind(view.body, "row"), "phase row")).role).toBe("omp-fabric.phase");
	});

	test("a call line names the call and its timing", () => {
		const line = withRole(view.body, "omp-fabric.call")[0];
		const spans = textSpans(unwrap(line, "first call line"));
		expect(spans.find(span => span.s === "strong")?.t).toBe("grep");
		expect(joined(spans.filter(span => span.s === "accent"))).toContain("/foo/ in src");
		expect(joined(spans.filter(span => span.s === "muted"))).toContain("24ms");
	});

	test("fast calls that worked show no output at all", () => {
		expect(withRole(view.body, "omp-fabric.output")).toHaveLength(0);
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
		expect(kindList(running.body)).toEqual(["code"]);
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

	test("a slow call shows its output as a terminal the card clamps", () => {
		const view = render(slowAudit);
		const output = unwrap(withRole(view.body, "omp-fabric.output")[0], "output node");
		expect(output.k).toBe("ansi");
		expect(previewLines(output)).toBe(4);
		expect(props(output).text).toContain("line 6");
		// The clamp is the terminal's own, so it still draws its expand hint.
		expect(withRole(view.body, "omp-fabric.output")).toHaveLength(1);
	});

	test("a fast working call shows none", () => {
		const view = render(unwrap(auditsOf(fabricDetails)[0], "grep audit"));
		expect(withRole(view.body, "omp-fabric.output")).toHaveLength(0);
	});

	test("a failure shows its output even when fast", () => {
		const view = render({ ...slowAudit, success: false, endedAt: 10 });
		expect(withRole(view.body, "omp-fabric.output")).toHaveLength(1);
	});

	test("expanding the card shows every call's output", () => {
		const view = render(unwrap(auditsOf(fabricDetails)[1], "read audit"), { expanded: true });
		const output = unwrap(withRole(view.body, "omp-fabric.output")[0], "output node");
		expect(props(output).text).toContain('"lines": 40');
	});
});

describe("how a call's output is drawn", () => {
	function outputOf(audit: FabricAudit, opts: DescribeOptions = options): NativeNode {
		const view = unwrap(
			describeFabricResult({ content: [], details: { ...fabricDetails, audits: [audit] } }, opts, fabricCallArgs),
			"single-audit view",
		);
		return unwrap(withRole(view.body, "omp-fabric.output")[0], "output node");
	}

	test("text is drawn as a terminal, not as highlighted JSON", () => {
		const output = outputOf(unwrap(auditsOf(fabricDetails)[0], "grep audit"), { expanded: true });
		expect(output.k).toBe("ansi");
		expect(props(output).text).toBe("src/a.ts:12: foo\nsrc/b.ts:3: food\nsrc/c.ts:88: foobar");
	});

	test("a structured result is terminal text too, never the JSON viewer", () => {
		const output = outputOf(unwrap(auditsOf(fabricDetails)[1], "read audit"), { expanded: true });
		expect(output.k).toBe("ansi");
		expect(props(output).text).toContain('"lines": 40');
	});

	test("an envelope result shows only its output field", () => {
		const output = outputOf({
			ref: "omp.bash",
			tool: "bash",
			success: true,
			args: { command: "ls" },
			result: { ok: true, output: "src/a.ts\nsrc/b.ts", details: { exit: 0 } },
			startedAt: 0,
			endedAt: 5000,
		});
		expect(props(output).text).toBe("src/a.ts\nsrc/b.ts");
	});

	test("every output carries the role the stylesheet rings", () => {
		expect(props(outputOf(slowAudit)).role).toBe("omp-fabric.output");
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
		expect(kindList(bare.body)).toEqual(["code"]);
	});
});
