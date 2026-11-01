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
const auditsOf = (details: FabricDetails): FabricAudit[] => details.audits ?? [];
const toolHead = (view: NativeToolView): NativeToolHead => unwrap(view.tool, "tool head");

/** A head meta entry is a plain fact or a run of styled spans. */
const factText = (entry: unknown): string =>
	typeof entry === "string" ? entry : joined(spanList(entry));
const facts = (view: NativeToolView): string[] => (unwrap(toolHead(view).meta, "head meta") as unknown[]).map(factText);
const lastFact = (view: NativeToolView): Span[] => {
	const meta = unwrap(toolHead(view).meta, "head meta") as unknown[];
	return spanList(meta[meta.length - 1]);
};

/** The audit sections live inside the calls section. */
function auditSections(view: NativeToolView): NativeNode[] {
	const calls = unwrap(byKey(view.body, "calls"), "calls section");
	return nodes(calls.c).filter(node => node.k === "section");
}

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
		expect(props(program).lang).toBe("typescript");
	});

	test("a click on the program copies it", () => {
		const program = unwrap(byKey(view.body, "program"), "program block");
		expect(actionOf(program).click).toBe("copy");
		expect(actionOf(program).menu).toEqual(["copy"]);
		expect(props(program).title).toBe("Click the code to copy the program");
	});

	test("no card and no section: the tool card is the only disclosure", () => {
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

	test("no foot line: the outcome lives in the head", () => {
		expect(byKey(view.body, "foot")).toBeUndefined();
	});

	test("body order: the program, then the calls that carry the output", () => {
		expect(kindList(view.body)).toEqual(["code", "section"]);
		expect(byKey(view.body, "output")).toBeUndefined();
		expect(byKey(view.body, "logs")).toBeUndefined();
	});

	test("the calls section starts open, one level", () => {
		const calls = unwrap(byKey(view.body, "calls"), "calls section");
		expect(props(calls).role).toBe("omp-fabric.calls");
		expect(props(calls).collapsible).toBe(true);
		expect(props(calls).collapsed).toBe(false);
		expect(joined(headSpans(calls))).toBe("calls");
		expect(kindList(calls.c)).toEqual(["row", "section", "section", "section"]);
		expect(props(unwrap(byKind(calls.c, "row"), "phase row")).role).toBe("omp-fabric.phase");
	});

	test("a fast call starts folded, with only its own output inside", () => {
		const section = unwrap(auditSections(view)[0], "first audit section");
		expect(props(section).role).toBe("omp-fabric.call");
		expect(props(section).collapsible).toBe(true);
		expect(props(section).collapsed).toBe(true);
		expect(kindList(section.c)).toEqual(["ansi"]);
		expect(section.key).toBe("call:0:omp.grep");
		const head = headSpans(section);
		expect(head.find(span => span.s === "strong")?.t).toBe("grep");
		expect(joined(head.filter(span => span.s === "accent"))).toContain("/foo/ in src");
		expect(joined(head.filter(span => span.s === "muted"))).toContain("24ms");
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
	});

	test("a cancelled call says so", () => {
		const cancelled = unwrap(
			describeFabricResult({ ...fabricResult }, { elapsedMs: 900, cancelled: true }, fabricCallArgs),
			"cancelled result view",
		);
		expect(lastFact(cancelled)[0]).toEqual({ t: "✗ Cancelled", s: "warning" });
	});
});

describe("per-call rendering", () => {
	function auditSection(audit: FabricAudit, opts: DescribeOptions = options): NativeNode {
		const view = unwrap(
			describeFabricResult({ content: [], details: { ...fabricDetails, audits: [audit] } }, opts, fabricCallArgs),
			"single-audit view",
		);
		return unwrap(auditSections(view)[0], "audit section");
	}

	test("a slow call shows its first four lines and says how many it hid", () => {
		const section = auditSection(slowAudit);
		expect(props(section).collapsed).toBe(false);
		const ansi = unwrap(byKind(section.c, "ansi"), "ansi node");
		expect(props(ansi).text).toBe("line 1\nline 2\nline 3\nline 4");
		const more = unwrap(
			nodes(section.c).find(node => joined(textSpans(node)).includes("more")),
			"the more line",
		);
		expect(textSpans(more)[0]?.s).toBe("muted");
		expect(joined(textSpans(more))).toBe("… 2 lines more");
	});

	test("a fast call hides its output but still carries it", () => {
		const section = auditSection(unwrap(auditsOf(fabricDetails)[0], "grep audit"));
		expect(props(section).collapsed).toBe(true);
		expect(nodes(section.c).some(node => node.k === "ansi")).toBe(true);
	});

	test("expanding the card opens every call and drops the clamp", () => {
		const section = auditSection(slowAudit, { expanded: true });
		expect(props(section).collapsed).toBe(false);
		const ansi = unwrap(byKind(section.c, "ansi"), "ansi node");
		expect(String(props(ansi).text).split("\n")).toHaveLength(6);
		expect(nodes(section.c).some(node => joined(textSpans(node)).includes("more"))).toBe(false);
	});

	test("a failure opens even when it was fast", () => {
		const section = auditSection(unwrap(auditsOf(fabricDetails)[2], "failing audit"));
		expect(props(section).collapsed).toBe(false);
	});

	test("a structured result is drawn as terminal text, not highlighted JSON", () => {
		const read = unwrap(auditsOf(fabricDetails)[1], "read audit");
		const section = auditSection(read);
		expect(byKind(section.c, "json")).toBeUndefined();
		expect(byKind(section.c, "code")).toBeUndefined();
		const ansi = unwrap(byKind(section.c, "ansi"), "ansi node");
		expect(props(ansi).text).toContain('"lines": 40');
	});

	test("an envelope result shows only its output field", () => {
		const section = auditSection({
			ref: "omp.bash",
			tool: "bash",
			success: true,
			args: { command: "ls" },
			result: { ok: true, output: "src/a.ts\nsrc/b.ts", details: { exit: 0 } },
		});
		const ansi = unwrap(byKind(section.c, "ansi"), "ansi node");
		expect(props(ansi).text).toBe("src/a.ts\nsrc/b.ts");
		expect(props(ansi).text).not.toContain("ok");
		expect(props(ansi).role).toBe("omp-fabric.output");
	});

	test("a plain string result is drawn as-is under the output role", () => {
		const ansi = unwrap(byKind(auditSection(unwrap(auditsOf(fabricDetails)[0], "grep audit")).c, "ansi"), "ansi node");
		expect(props(ansi).role).toBe("omp-fabric.output");
		expect(props(ansi).text).toBe("src/a.ts:12: foo\nsrc/b.ts:3: food\nsrc/c.ts:88: foobar");
	});

	test("a fromTrace audit with no result says the result was not retained", () => {
		const note = unwrap(byKind(auditSection(fromTraceAudit).c, "text"), "fromTrace note");
		expect(textSpans(note)[0]?.s).toBe("muted");
		expect(joined(textSpans(note))).toContain("not retained");
	});

	test("a failing audit marks its head and carries the message", () => {
		const section = auditSection(unwrap(auditsOf(fabricDetails)[2], "failing audit"));
		expect(headSpans(section).find(span => span.s === "error")?.t).toBe(" · failed");
		const message = unwrap(
			nodes(section.c).find(node => node.k === "text" && textSpans(node).some(span => span.s === "error")),
			"error message text",
		);
		expect(joined(textSpans(message))).toContain("connection reset by peer");
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

	test("folded: 8 audit sections plus a muted … 4 calls more", () => {
		const view = render(options);
		const calls = unwrap(byKey(view.body, "calls"), "calls section");
		expect(auditSections(view)).toHaveLength(8);
		const more = unwrap(
			nodes(calls.c).find(node => joined(textSpans(node)).includes("more")),
			"the more line",
		);
		expect(textSpans(more)[0]?.s).toBe("muted");
		expect(joined(textSpans(more))).toBe("… 4 calls more");
	});

	test("expanded: all 12 audit sections", () => {
		expect(auditSections(render({ expanded: true }))).toHaveLength(12);
	});
});

describe("trace-only details", () => {
	const view = unwrap(
		describeFabricResult({ content: [{ type: "text", text: OUTPUT_TEXT }], details: traceOnlyDetails }, options, fabricCallArgs),
		"trace-only view",
	);

	test("one audit section per trace operation, marked as trace", () => {
		const sections = auditSections(view);
		expect(sections).toHaveLength(2);
		expect(sections[0]?.key).toBe("call:0:omp.grep");
		expect(sections[1]?.key).toBe("call:1:omp.read");
	});

	test("operations without a result say so, and the failing one carries its error", () => {
		const second = unwrap(auditSections(view)[1], "second section");
		expect(joined(textSpans(unwrap(byKind(second.c, "text"), "trace note")))).toContain("not retained");
		expect(
			joined(
				textSpans(
					unwrap(
						nodes(second.c).find(node => textSpans(node).some(span => span.s === "error")),
						"trace error",
					),
				),
			),
		).toContain("ENOENT");
	});

	test("undefined details render the program without throwing and without a body output", () => {
		const bare = unwrap(
			describeFabricResult({ content: [{ type: "text", text: OUTPUT_TEXT }] }, options, fabricCallArgs),
			"no-details view",
		);
		expect(byKey(bare.body, "calls")).toBeUndefined();
		expect(byKey(bare.body, "program")).toBeDefined();
		expect(byKey(bare.body, "output")).toBeUndefined();
	});
});
