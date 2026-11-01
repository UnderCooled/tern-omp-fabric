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

/** Unwrap an optional value or fail the test with a readable message. */
function unwrap<T>(value: T | undefined | null, what: string): T {
	if (value === undefined || value === null) throw new Error(`expected ${what}, got ${String(value)}`);
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
const joined = (spans: Span[]): string => spans.map(span => span.t).join("");
const kindList = (children: readonly NativeChild[] | undefined): string[] => nodes(children).map(node => node.k);
const codes = (children: readonly NativeChild[] | undefined): NativeNode[] =>
	nodes(children).filter(node => node.k === "code");
const sections = (children: readonly NativeChild[] | undefined): NativeNode[] =>
	nodes(children).filter(node => node.k === "section");
const byKind = (children: readonly NativeChild[] | undefined, k: string): NativeNode | undefined =>
	nodes(children).find(node => node.k === k);
const byKey = (children: readonly NativeChild[] | undefined, key: string): NativeNode | undefined =>
	nodes(children).find(node => node.key === key);
const auditsOf = (details: FabricDetails): FabricAudit[] => details.audits ?? [];
const toolHead = (view: NativeToolView): NativeToolHead => unwrap(view.tool, "tool head");

const options: DescribeOptions = {};

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

	test("head: title, target, command, targetKind, lang", () => {
		const head = toolHead(view);
		expect(head.title).toBe("Fabric");
		expect(head.target).toBe("const pattern = /foo/;");
		expect(head.targetKind).toBe("command");
		expect(head.lang).toBe("typescript");
		expect(head.command).toBe(programText(fabricCallArgs));
		expect(head.command).toContain("\n");
	});

	test("head meta includes display name and line count", () => {
		const meta = unwrap(toolHead(view).meta, "head meta");
		expect(meta).toContain("Sweep TODOs");
		expect(meta).toContain("TypeScript · 12 lines");
	});

	test("preview is children, one code child clamped to 8 lines", () => {
		expect(view.preview).toBe("children");
		const program = codes(view.body);
		expect(program).toHaveLength(1);
		expect(props(program[0] ?? ({} as NativeNode)).lang).toBe("typescript");
		expect(previewLines(unwrap(program[0], "program node"))).toBe(8);
	});

	test("expanded shows up to 200 lines", () => {
		const expanded = unwrap(describeFabricCall(fabricCallArgs, { expanded: true }), "expanded call view");
		expect(previewLines(unwrap(codes(expanded.body)[0], "program node"))).toBe(200);
	});

	test("description renders as the first muted text body child", () => {
		const first = unwrap(nodes(view.body)[0], "first body child");
		expect(first.k).toBe("text");
		const span = unwrap(textSpans(first)[0], "description span");
		expect(span.s).toBe("muted");
		expect(span.t).toBe("Greps src for TODO markers and reports files.");
	});

	test("incomplete args with no code show composing…", () => {
		const composing = unwrap(describeFabricCall(undefined, { argsComplete: false }), "composing view");
		expect(nodes(composing.body)).toHaveLength(1);
		const spans = textSpans(unwrap(nodes(composing.body)[0], "composing text"));
		expect(spans[0]?.s).toBe("muted");
		expect(joined(spans)).toBe("composing…");
	});

	test("complete args with no code render an empty body", () => {
		const empty = unwrap(describeFabricCall(undefined, options), "empty call view");
		expect(nodes(empty.body)).toHaveLength(0);
	});
});

describe("describeFabricResult", () => {
	const view = unwrap(describeFabricResult(fabricResult, options, fabricCallArgs), "result view");

	test("head meta counts calls, failures, phases", () => {
		const meta = unwrap(toolHead(view).meta, "result meta");
		expect(meta).toContain("3 calls");
		expect(meta).toContain("1 failed");
		expect(meta).toContain("2 phases");
	});

	test("body order: program, phases, sections, output", () => {
		expect(kindList(view.body)).toEqual(["code", "row", "section", "section", "section", "code"]);
		expect(previewLines(unwrap(nodes(view.body)[0], "program node"))).toBe(4);
		expect(props(unwrap(nodes(view.body)[1], "phase row")).role).toBe("omp-fabric.phase");
		expect(props(unwrap(nodes(view.body).at(-1), "output node")).role).toBe("omp-fabric.output");
	});

	test("first audit section: key, role, head spans, kv args", () => {
		const section = unwrap(sections(view.body)[0], "first audit section");
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
});

describe("per-audit result rendering", () => {
	function auditSection(audit: FabricAudit, opts: DescribeOptions = options): NativeNode {
		const view = unwrap(
			describeFabricResult({ content: [], details: { ...fabricDetails, audits: [audit] } }, opts, fabricCallArgs),
			"single-audit view",
		);
		return unwrap(sections(view.body)[0], "audit section");
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
		const audits: FabricAudit[] = Array.from({ length: 12 }, (_, index) => ({ ...fromTraceAudit, ref: `omp.grep.${index}` }));
		return unwrap(
			describeFabricResult({ content: [{ type: "text", text: OUTPUT_TEXT }], details: { audits } }, opts, fabricCallArgs),
			"capped result view",
		);
	}

	test("collapsed: 8 sections plus a muted … 4 calls more", () => {
		const view = render(options);
		expect(sections(view.body)).toHaveLength(8);
		const more = unwrap(
			nodes(view.body).find(node => joined(textSpans(node)).includes("more")),
			"the more line",
		);
		expect(more.k).toBe("text");
		const spans = textSpans(more);
		expect(spans[0]?.s).toBe("muted");
		expect(joined(spans)).toContain("… 4 calls more");
	});

	test("expanded: all 12 sections and 200-line code previews", () => {
		const view = render({ expanded: true });
		expect(sections(view.body)).toHaveLength(12);
		for (const code of codes(view.body)) expect(previewLines(code)).toBe(200);
	});
});

describe("trace-only details", () => {
	const view = unwrap(
		describeFabricResult({ content: [{ type: "text", text: OUTPUT_TEXT }], details: traceOnlyDetails }, options, fabricCallArgs),
		"trace-only view",
	);

	test("one section per trace operation, marked as trace", () => {
		expect(sections(view.body)).toHaveLength(2);
		expect(sections(view.body)[0]?.key).toBe("call:0:omp.grep");
		expect(sections(view.body)[1]?.key).toBe("call:1:omp.read");
	});

	test("operations without a result say so, and the failing one carries its error", () => {
		const second = unwrap(sections(view.body)[1], "second section");
		expect(joined(textSpans(unwrap(byKind(second.c, "text"), "trace note")))).toContain("not retained");
		expect(joined(textSpans(unwrap(nodes(second.c).find(node => textSpans(node).some(span => span.s === "error")), "trace error")))).toContain(
			"ENOENT",
		);
	});

	test("undefined details render program and output without throwing", () => {
		const bare = unwrap(describeFabricResult({ content: [{ type: "text", text: OUTPUT_TEXT }] }, options, fabricCallArgs), "no-details view");
		expect(sections(bare.body)).toHaveLength(0);
		expect(byKey(bare.body, "program")).toBeDefined();
		expect(byKey(bare.body, "output")).toBeDefined();
	});
});

describe("output node", () => {
	test("joins the text blocks, keeps lang and start, clamps to 12 lines", () => {
		const view = unwrap(describeFabricResult(fabricResult, options, fabricCallArgs), "result view");
		const output = unwrap(byKey(view.body, "output"), "output node");
		expect(props(output).text).toBe(OUTPUT_TEXT);
		expect(props(output).lang).toBe("yaml");
		expect(props(output).start).toBe(3);
		expect(previewLines(output)).toBe(12);
	});
});
