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
import { fabricCallArgs, fabricDetails, fabricResult, fromTraceAudit, OUTPUT_TEXT, traceOnlyDetails } from "./fixtures";

type Span = { t: string; s?: string };

const CWD = "D:/repos/demo";

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
const kvItems = (node: NativeNode): { k: Span[]; v: Span[] }[] =>
	Array.isArray(props(node).items) ? (props(node).items as { k: Span[]; v: Span[] }[]) : [];
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
const codeOf = (card: NativeNode): NativeNode => unwrap(byKind(card.c, "code"), "the card's code node");
const auditsOf = (details: FabricDetails): FabricAudit[] => details.audits ?? [];
const toolHead = (view: NativeToolView): NativeToolHead => unwrap(view.tool, "tool head");

/** The audit sections live inside the folded calls section. */
function auditSections(view: NativeToolView): NativeNode[] {
	const calls = unwrap(byKey(view.body, "calls"), "calls section");
	return nodes(calls.c).filter(node => node.k === "section");
}

const options: DescribeOptions = { cwd: CWD, elapsedMs: 1200 };

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

	test("head names the call only: no Copy command, no counts", () => {
		const head = toolHead(view);
		expect(head.title).toBe("Fabric");
		expect(head.target).toBe("const pattern = /foo/;");
		expect(head.targetKind).toBe("command");
		expect(head.lang).toBe("typescript");
		expect(head.command).toBeUndefined();
		expect(head.meta).toEqual(["Sweep TODOs"]);
	});

	test("the meta line carries the walltime, the timeout and the directory", () => {
		const meta = unwrap(byKey(view.body, "meta"), "meta line");
		expect(meta.k).toBe("text");
		const spans = textSpans(meta);
		expect(joined(spans)).toBe("1.2s · timeout 30s · " + CWD);
		expect(spans.find(span => span.t === "timeout 30s")?.s).toBe("muted");
		expect(spans.find(span => span.t === CWD)?.s).toBe("path");
	});

	test("the description follows the meta line", () => {
		const description = unwrap(nodes(view.body)[1], "description line");
		expect(description.k).toBe("text");
		const span = unwrap(textSpans(description)[0], "description span");
		expect(span.s).toBe("muted");
		expect(span.t).toBe("Greps src for TODO markers and reports files.");
	});

	test("the program is a framed card, folded, head-labelled with its line count", () => {
		const program = unwrap(byKey(view.body, "program"), "program card");
		expect(program.k).toBe("card");
		expect(props(program).role).toBe("omp-fabric.program");
		expect(props(program).collapsible).toBe(true);
		expect(props(program).collapsed).toBe(true);
		expect(previewLines(program)).toBe(8);
		expect(joined(headSpans(program))).toBe("TypeScript · 12 lines");
	});

	test("the program card's code is the whole program and copies on click", () => {
		const code = codeOf(unwrap(byKey(view.body, "program"), "program card"));
		expect(props(code).text).toBe(programText(fabricCallArgs));
		expect(props(code).lang).toBe("typescript");
		expect(actionOf(code).click).toBe("copy");
		expect(actionOf(code).menu).toEqual(["copy"]);
		expect(props(code).title).toBe("Click the code to copy the program");
	});

	test("expanded starts the program card open and clamped at 200 lines", () => {
		const expanded = unwrap(describeFabricCall(fabricCallArgs, { expanded: true }), "expanded call view");
		const program = unwrap(byKey(expanded.body, "program"), "program card");
		expect(props(program).collapsed).toBe(false);
		expect(previewLines(program)).toBe(200);
	});

	test("incomplete args with no code show composing…", () => {
		const composing = unwrap(describeFabricCall(undefined, { argsComplete: false }), "composing view");
		const kinds = kindList(composing.body);
		expect(kinds).toEqual(["text"]);
		expect(joined(textSpans(unwrap(nodes(composing.body)[0], "composing text")))).toBe("composing…");
	});

	test("complete args with no code render an empty body", () => {
		const empty = unwrap(describeFabricCall(undefined, options), "empty call view");
		const kinds = kindList(empty.body);
		expect(kinds).toEqual(["text"]);
		expect(joined(textSpans(unwrap(nodes(empty.body)[0], "meta line")))).toBe("1.2s · " + CWD);
	});
});

describe("describeFabricResult", () => {
	const settled: DescribeOptions = { cwd: CWD, elapsedMs: 2400 };
	const view = unwrap(describeFabricResult(fabricResult, settled, fabricCallArgs), "result view");

	test("head is the call's head", () => {
		const head = toolHead(view);
		expect(head.title).toBe("Fabric");
		expect(head.target).toBe("const pattern = /foo/;");
		expect(head.command).toBeUndefined();
		expect(head.meta).toEqual(["Sweep TODOs"]);
	});

	test("body order: meta, program, calls, rule, output, rule, foot", () => {
		expect(kindList(view.body)).toEqual(["text", "card", "section", "rule", "card", "rule", "text"]);
	});

	test("a settled result drops the walltime from the meta line", () => {
		expect(joined(textSpans(unwrap(byKey(view.body, "meta"), "meta line")))).toBe("timeout 30s · " + CWD);
	});

	test("the calls section folds, and its head counts calls, failures and phases", () => {
		const calls = unwrap(byKey(view.body, "calls"), "calls section");
		expect(props(calls).role).toBe("omp-fabric.calls");
		expect(props(calls).collapsible).toBe(true);
		expect(props(calls).collapsed).toBe(true);
		expect(joined(headSpans(calls))).toBe("3 calls · 1 failed · 2 phases");
		expect(kindList(calls.c)).toEqual(["row", "section", "section", "section"]);
		expect(props(unwrap(byKind(calls.c, "row"), "phase row")).role).toBe("omp-fabric.phase");
	});

	test("first audit section: key, role, head spans, kv args", () => {
		const section = unwrap(auditSections(view)[0], "first audit section");
		expect(props(section).role).toBe("omp-fabric.call");
		expect(section.key).toBe("call:0:omp.grep");
		const head = headSpans(section);
		expect(head.find(span => span.s === "strong")?.t).toBe("grep");
		expect(joined(head.filter(span => span.s === "accent"))).toContain("/foo/ in src");
		expect(joined(head.filter(span => span.s === "muted"))).toContain("24ms");
		const keys = kvItems(unwrap(byKind(section.c, "kv"), "args kv")).map(item => joined(item.k));
		expect(keys).toContain("pattern");
		expect(keys).toContain("path");
	});

	test("the foot reports done and the settled duration", () => {
		const foot = unwrap(byKey(view.body, "foot"), "foot line");
		const spans = textSpans(foot);
		expect(spans[0]).toEqual({ t: "✓ Done", s: "success strong" });
		expect(joined(spans)).toBe("✓ Done · 2.4s");
	});

	test("a failed result reports it in the foot", () => {
		const failed = unwrap(
			describeFabricResult({ ...fabricResult, isError: true }, settled, fabricCallArgs),
			"failed result view",
		);
		const spans = textSpans(unwrap(byKey(failed.body, "foot"), "foot line"));
		expect(spans[0]).toEqual({ t: "✗ Failed", s: "error strong" });
		expect(joined(spans)).toBe("✗ Failed · 2.4s");
	});

	test("an unfinished call reports its timeout instead of an outcome", () => {
		const running = unwrap(
			describeFabricResult({ isError: false, content: [], details: { audits: [], phases: [] } }, { cwd: CWD, isPartial: true }, fabricCallArgs),
			"running result view",
		);
		expect(joined(textSpans(unwrap(byKey(running.body, "foot"), "foot line")))).toBe("timeout 30s");
		expect(joined(textSpans(unwrap(byKey(running.body, "meta"), "meta line")))).toBe("timeout 30s · " + CWD);
	});

	test("a cancelled call says so", () => {
		const cancelled = unwrap(
			describeFabricResult({ ...fabricResult }, { cwd: CWD, elapsedMs: 900, cancelled: true }, fabricCallArgs),
			"cancelled result view",
		);
		const spans = textSpans(unwrap(byKey(cancelled.body, "foot"), "foot line"));
		expect(spans[0]).toEqual({ t: "✗ Cancelled", s: "warning strong" });
	});
});

describe("per-audit result rendering", () => {
	function auditSection(audit: FabricAudit, opts: DescribeOptions = options): NativeNode {
		const view = unwrap(
			describeFabricResult({ content: [], details: { ...fabricDetails, audits: [audit] } }, opts, fabricCallArgs),
			"single-audit view",
		);
		return unwrap(auditSections(view)[0], "audit section");
	}

	test("string result becomes an ansi node with 6 preview lines", () => {
		const ansi = unwrap(byKind(auditSection(unwrap(auditsOf(fabricDetails)[0], "grep audit")).c, "ansi"), "ansi node");
		expect(previewLines(ansi)).toBe(6);
	});

	test("object result becomes a json node with options.json, a json code node otherwise", () => {
		const read = unwrap(auditsOf(fabricDetails)[1], "read audit");
		expect(byKind(auditSection(read, { json: true }).c, "json")).toBeDefined();
		const code = unwrap(byKind(auditSection(read).c, "code"), "object result code node");
		expect(props(code).lang).toBe("json");
		expect(previewLines(code)).toBe(6);
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
		expect(more.k).toBe("text");
		expect(textSpans(more)[0]?.s).toBe("muted");
		expect(joined(textSpans(more))).toBe("… 4 calls more");
	});

	test("expanded: all 12 audit sections, and the blocks start open at 200 lines", () => {
		const view = render({ cwd: CWD, expanded: true });
		expect(auditSections(view)).toHaveLength(12);
		for (const key of ["program", "output"]) {
			const card = unwrap(byKey(view.body, key), key + " card");
			expect(props(card).collapsed).toBe(false);
			expect(previewLines(card)).toBe(200);
		}
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

	test("undefined details render program and output without throwing", () => {
		const bare = unwrap(describeFabricResult({ content: [{ type: "text", text: OUTPUT_TEXT }] }, options, fabricCallArgs), "no-details view");
		expect(byKey(bare.body, "calls")).toBeUndefined();
		expect(byKey(bare.body, "program")).toBeDefined();
		expect(byKey(bare.body, "output")).toBeDefined();
	});
});

describe("output card", () => {
	const view = unwrap(describeFabricResult(fabricResult, options, fabricCallArgs), "result view");
	const card = unwrap(byKey(view.body, "output"), "output card");

	test("is a framed card folded at 12 lines", () => {
		expect(card.k).toBe("card");
		expect(props(card).role).toBe("omp-fabric.output");
		expect(props(card).collapsed).toBe(true);
		expect(previewLines(card)).toBe(12);
		expect(joined(headSpans(card))).toBe("output · 12 lines");
	});

	test("its code keeps the joined text, the language, the start line, and copies on click", () => {
		const code = codeOf(card);
		expect(props(code).text).toBe(OUTPUT_TEXT);
		expect(props(code).lang).toBe("yaml");
		expect(props(code).start).toBe(3);
		expect(actionOf(code).click).toBe("copy");
		expect(props(code).title).toBe("Click the code to copy the output");
	});
});
