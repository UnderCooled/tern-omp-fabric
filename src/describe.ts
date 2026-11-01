/**
 * fabric_exec -> NativeToolView (Tern's TSP tree).
 *
 * Pure by design: nothing here imports a host package at run time, so the
 * extension's load path stays {this file, attach.ts, the host's own modules}.
 * The type imports are erased for the same reason.
 *
 * Layout mirrors omp's own ANSI card (fabric-exec-tool.ts renderCall/renderResult)
 * at the level of sections, with one deliberate divergence: the program stays in
 * the result card, clamped, because omp's append-only TUI drops it once the result
 * replaces the call frame, leaving the command nowhere to be read.
 */
import type { NativeChild } from "@oh-my-pi/pi-tui";
import type { NativeToolHead, NativeToolView } from "@oh-my-pi/pi-tui/tools";

/** A styled run; structurally TspSpan, declared here so no pi-wire import is needed. */
type Span = { t: string; s?: string };

export type FabricExecArgs = {
	code?: string | string[];
	payloads?: Record<string, string>;
	resultFormat?: string;
	tokenBudget?: number;
	agentBudget?: number;
	timeoutMs?: number;
	display?: unknown;
};

export type FabricAudit = {
	ref: string;
	tool?: string;
	provider?: string;
	success?: boolean;
	error?: string;
	args?: Record<string, unknown>;
	result?: unknown;
	resultTruncated?: boolean;
	fromTrace?: boolean;
	startedAt?: number;
	endedAt?: number;
};

export type FabricDetails = {
	success?: boolean;
	error?: string;
	progress?: string;
	outputFormat?: "yaml" | "json";
	outputFormatStartLine?: number;
	outputFormatLines?: number;
	phases?: string[];
	audits?: FabricAudit[];
};

export type DescribeOptions = {
	expanded?: boolean;
	isPartial?: boolean;
	argsComplete?: boolean;
	executionStarted?: boolean;
	/** The terminal says it draws the `json` kind. */
	json?: boolean;
	media?: boolean;
	elapsedMs?: number;
	cancelled?: boolean;
};

/** Code lines shown while collapsed; an expanded card shows everything, capped as omp caps it. */
const CALL_CODE_LINES = 8;
const RESULT_CODE_LINES = 4;
const CODE_EXPANDED_LINES = 200;
/** Lines of one nested call's own output shown while collapsed. */
const AUDIT_RESULT_LINES = 6;
/** Lines of the program's return value shown while collapsed. */
const OUTPUT_LINES = 12;
const AUDITS_COLLAPSED = 8;
const AUDITS_EXPANDED = 30;
const ARG_ENTRIES = 6;
const ARG_VALUE_CHARS = 120;
const DETAIL_CHARS = 72;

const span = (t: string, s?: string): Span => (s === undefined ? { t } : { t, s });
const text = (spans: Span[]): NativeChild => ({ k: "text", p: { spans } });
const muted = (t: string): NativeChild => text([span(t, "muted")]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const cut = (value: string, max: number): string =>
	value.length <= max ? value : `${value.slice(0, max - 1)}…`;

const firstLine = (value: string): string => {
	for (const line of value.split("\n")) {
		if (line.trim() !== "") return line.trim();
	}
	return "";
};

const countLabel = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** The program text as the model sent it; an array of lines is joined. */
export function programText(args: FabricExecArgs | undefined): string {
	const code = args?.code;
	const value = Array.isArray(code) ? code.join("\n") : typeof code === "string" ? code : "";
	return value
		.replace(/\r\n?/g, "\n")
		.replace(/[\t ]+$/gm, "")
		.replace(/\n+$/, "");
}

export function codeLineCount(args: FabricExecArgs | undefined): number {
	const program = programText(args);
	return program === "" ? 0 : program.split("\n").length;
}

/** Mirrors omp's normalizeRunDisplay: an object with name/description, or the string shorthand. */
function runDisplay(value: unknown): { name?: string; description?: string } {
	if (typeof value === "string") {
		const trimmed = value.trim();
		if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
			try {
				const parsed: unknown = JSON.parse(trimmed);
				if (isRecord(parsed)) return runDisplay(parsed);
			} catch {
				// Not JSON after all: fall through to the raw string.
			}
		}
		return trimmed === "" ? {} : { name: trimmed };
	}
	if (!isRecord(value)) return {};
	const name = typeof value.name === "string" && value.name.trim() !== "" ? value.name.trim() : undefined;
	const description =
		typeof value.description === "string" && value.description.trim() !== "" ? value.description.trim() : undefined;
	return { name, description };
}

/** `1.2s` / `850ms`, as omp's tool-call timing reads. */
function formatDuration(ms: number): string | undefined {
	if (!Number.isFinite(ms) || ms < 0) return undefined;
	return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

const pathText = (value: unknown): string | undefined =>
	typeof value === "string" && value.trim() !== "" ? cut(value.trim(), DETAIL_CHARS) : undefined;

const patternText = (value: unknown): string | undefined =>
	typeof value === "string" && value.trim() !== "" ? cut(`/${value.trim()}/`, DETAIL_CHARS) : undefined;

const pair = (left: string | undefined, right: string | undefined, join: string): string | undefined =>
	left === undefined ? right : right === undefined ? left : `${left}${join}${right}`;

const commandText = (value: unknown): string | undefined => {
	if (typeof value !== "string") return undefined;
	const line = firstLine(value);
	return line === "" ? undefined : cut(`$ ${line}`, DETAIL_CHARS);
};

/** The titles omp's own card gives core tools (coreToolTitle, without the highlighting). */
const CORE_DETAILS: Record<string, (args: Record<string, unknown>) => string | undefined> = {
	grep: args => pair(patternText(args.pattern), pathText(args.path), " in "),
	find: args => pair(patternText(args.pattern ?? args.query), pathText(args.path), " in "),
	ls: args => pathText(args.path) ?? commandText(args.command),
	read: args => pathText(args.path),
	write: args => pathText(args.path),
	edit: args => pathText(args.path),
	bash: args => commandText(args.command),
};

/** The core tool a call names: `grep`, from `grep` or omp's namespaced `omp.grep`. */
function coreToolName(audit: FabricAudit): string | undefined {
	const raw = (audit.tool ?? audit.ref ?? "").toLowerCase();
	if (raw === "") return undefined;
	if (CORE_DETAILS[raw] !== undefined) return raw;
	const leaf = raw.split(".").pop();
	return leaf !== undefined && CORE_DETAILS[leaf] !== undefined ? leaf : undefined;
}

/** The one argument that names the call. */
function callDetail(audit: FabricAudit): string | undefined {
	const args = audit.args ?? {};
	const name = coreToolName(audit);
	const named = name === undefined ? undefined : CORE_DETAILS[name]?.(args);
	if (named !== undefined) return named;
	for (const key of ["path", "pattern", "query", "ref", "name", "task", "topic", "key", "op", "command"]) {
		const value = args[key];
		if (key === "command") {
			const command = commandText(value);
			if (command !== undefined) return command;
			continue;
		}
		if (typeof value === "string" && value.trim() !== "") return cut(value.trim(), DETAIL_CHARS);
	}
	for (const value of Object.values(args)) {
		if (typeof value === "string" && value.trim() !== "") return cut(value.trim(), DETAIL_CHARS);
		if (typeof value === "number" || typeof value === "boolean") return String(value);
	}
	return undefined;
}

function scalarText(value: unknown): string | undefined {
	if (typeof value === "string") {
		const flat = value.replace(/\s+/g, " ").trim();
		return flat === "" ? undefined : cut(flat, ARG_VALUE_CHARS);
	}
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	return undefined;
}

/** The scalars of one call's arguments; objects and arrays stay in its own result view. */
function argumentItems(args: Record<string, unknown> | undefined): { k: Span[]; v: Span[] }[] {
	const items: { k: Span[]; v: Span[] }[] = [];
	for (const [key, value] of Object.entries(args ?? {})) {
		if (items.length >= ARG_ENTRIES) break;
		const shown = scalarText(value);
		if (shown === undefined) continue;
		items.push({ k: [span(key, "muted")], v: [span(shown, "mono")] });
	}
	return items;
}

function jsonSafe(value: unknown): string | undefined {
	try {
		return JSON.stringify(value, null, 2) ?? undefined;
	} catch {
		return undefined;
	}
}

/** One nested call's own output: a terminal for text, a tree for structured data. */
function resultNode(audit: FabricAudit, options: DescribeOptions): NativeChild | undefined {
	const result = audit.result;
	if (result === undefined || result === null) {
		return audit.fromTrace === true ? muted("result not retained after reload") : undefined;
	}
	if (typeof result === "string") {
		if (result.trim() === "") return undefined;
		return { k: "ansi", p: { text: result, preview: { lines: AUDIT_RESULT_LINES } } };
	}
	if (options.json === true) return { k: "json", p: { value: result } };
	const encoded = jsonSafe(result);
	if (encoded === undefined) return muted("result not shown");
	return { k: "code", p: { text: encoded, lang: "json", preview: { lines: AUDIT_RESULT_LINES } } };
}

function auditSection(audit: FabricAudit, index: number, options: DescribeOptions): NativeChild {
	const raw = firstLine(audit.tool ?? audit.ref ?? "call");
	const label = coreToolName(audit) ?? raw;
	const head: Span[] = [span(label === "" ? "call" : label, "strong")];
	const detail = callDetail(audit);
	if (detail !== undefined) head.push(span(" "), span(detail, "accent"));
	if (audit.startedAt !== undefined && audit.endedAt !== undefined) {
		const took = formatDuration(audit.endedAt - audit.startedAt);
		if (took !== undefined) head.push(span(` · ${took}`, "muted"));
	}
	if (audit.success === false) head.push(span(" · failed", "error"));

	const children: NativeChild[] = [];
	const items = argumentItems(audit.args);
	if (items.length > 0) children.push({ k: "kv", p: { items } });
	const body = resultNode(audit, options);
	if (body !== undefined) children.push(body);
	if (audit.success === false && audit.error) {
		children.push(text([span(cut(firstLine(audit.error) || audit.error, 300), "error")]));
	}
	if (audit.resultTruncated === true) children.push(muted("truncated"));
	return {
		k: "section",
		key: `call:${index}:${audit.ref}`,
		p: { head, role: "omp-fabric.call" },
		c: children,
	};
}

/** The program's return value as the model read it. */
function outputNode(content: unknown, details: FabricDetails, options: DescribeOptions): NativeChild | undefined {
	const blocks = Array.isArray(content) ? content : [];
	const output = blocks
		.filter(
			(block): block is { type: string; text: string } =>
				isRecord(block) && block.type === "text" && typeof block.text === "string",
		)
		.map(block => block.text)
		.join("\n")
		.replace(/\r\n?/g, "\n")
		.replace(/\n+$/, "");
	if (output.trim() === "") return undefined;
	const start = details.outputFormatStartLine;
	return {
		k: "code",
		key: "output",
		p: {
			text: output,
			lang: details.outputFormat,
			start: typeof start === "number" && start > 0 ? start : undefined,
			preview: { lines: options.expanded === true ? CODE_EXPANDED_LINES : OUTPUT_LINES },
			role: "omp-fabric.output",
		},
	};
}

function phaseRow(phases: string[]): NativeChild {
	return {
		k: "row",
		key: "phases",
		p: { gap: "xs", role: "omp-fabric.phase" },
		c: phases.map(phase => ({ k: "badge", p: { text: phase } })),
	};
}

function head(
	program: string,
	display: { name?: string; description?: string },
	options: DescribeOptions,
	extraMeta: string[],
): NativeToolHead {
	const lines = program === "" ? 0 : program.split("\n").length;
	const target = program === "" ? "" : firstLine(program);
	const meta: string[] = [];
	if (display.name !== undefined) meta.push(display.name);
	if (lines > 0) meta.push(`TypeScript · ${countLabel(lines, "line")}`);
	meta.push(...extraMeta);
	return {
		title: "Fabric",
		target: target === "" ? undefined : target,
		targetKind: target === "" ? undefined : "command",
		lang: target === "" ? undefined : "typescript",
		// The head's Copy command copies the whole program, not the shown first line.
		command: program === "" ? undefined : program,
		meta: meta.length > 0 ? meta : undefined,
		badges: options.isPartial === true ? [{ text: "running", tone: "accent" }] : undefined,
	};
}

function programNode(program: string, lines: number): NativeChild {
	return {
		k: "code",
		key: "program",
		p: { text: program, lang: "typescript", preview: { lines }, role: "omp-fabric.program" },
	};
}

/** The call, before any result exists. */
export function describeFabricCall(
	args: FabricExecArgs | undefined,
	options: DescribeOptions,
): NativeToolView | undefined {
	const program = programText(args);
	const display = runDisplay(args?.display);
	const body: NativeChild[] = [];
	if (display.description !== undefined) body.push(text([span(display.description, "muted")]));
	if (program !== "") {
		body.push(programNode(program, options.expanded === true ? CODE_EXPANDED_LINES : CALL_CODE_LINES));
	} else if (options.argsComplete === false) {
		body.push(muted("composing…"));
	}
	return { tool: head(program, display, options, []), body, preview: "children" };
}

function readAudit(value: unknown): FabricAudit | undefined {
	if (!isRecord(value) || typeof value.ref !== "string") return undefined;
	return {
		ref: value.ref,
		...(typeof value.tool === "string" ? { tool: value.tool } : {}),
		...(typeof value.provider === "string" ? { provider: value.provider } : {}),
		...(typeof value.success === "boolean" ? { success: value.success } : {}),
		...(typeof value.error === "string" ? { error: value.error } : {}),
		...(isRecord(value.args) ? { args: value.args } : {}),
		...(value.result !== undefined ? { result: value.result } : {}),
		...(typeof value.resultTruncated === "boolean" ? { resultTruncated: value.resultTruncated } : {}),
		...(value.fromTrace === true ? { fromTrace: true } : {}),
		...(typeof value.startedAt === "number" ? { startedAt: value.startedAt } : {}),
		...(typeof value.endedAt === "number" ? { endedAt: value.endedAt } : {}),
	};
}

/** A durable-trace operation, when the details carry no rich audits. */
function readTraceOperation(value: unknown): FabricAudit | undefined {
	if (!isRecord(value) || typeof value.ref !== "string") return undefined;
	const traceArgs = isRecord(value.args) && Object.keys(value.args).length > 0 ? { args: value.args } : {};
	return {
		ref: value.ref,
		fromTrace: true,
		...(typeof value.action === "string" ? { tool: value.action } : {}),
		...(typeof value.provider === "string" ? { provider: value.provider } : {}),
		success: value.outcome === "succeeded",
		...(typeof value.error === "string" ? { error: value.error } : {}),
		...traceArgs,
		...(value.result !== undefined ? { result: value.result } : {}),
		...(value.resultTruncated === true ? { resultTruncated: true } : {}),
	};
}

/** `readFabricExecutionRenderDetails`: rich audits win, the durable trace is the fallback. */
function readDetails(value: unknown): FabricDetails {
	if (!isRecord(value)) return { audits: [], phases: [] };
	const trace = isRecord(value.trace) ? value.trace : undefined;
	const strings = (input: unknown): string[] | undefined =>
		Array.isArray(input) ? input.filter((entry): entry is string => typeof entry === "string") : undefined;
	const audits = Array.isArray(value.audits)
		? value.audits.map(readAudit).filter((audit): audit is FabricAudit => audit !== undefined)
		: undefined;
	const operations = Array.isArray(trace?.operations)
		? trace.operations.map(readTraceOperation).filter((audit): audit is FabricAudit => audit !== undefined)
		: undefined;
	const outcome = typeof trace?.outcome === "string" ? trace.outcome : undefined;
	const error = typeof value.error === "string" ? value.error : typeof trace?.error === "string" ? trace.error : undefined;
	const success =
		typeof value.success === "boolean" ? value.success : outcome === undefined ? undefined : outcome === "succeeded";
	const outputFormat =
		value.outputFormat === "yaml" || value.outputFormat === "json" ? value.outputFormat : undefined;
	return {
		...(success !== undefined ? { success } : {}),
		...(error !== undefined ? { error } : {}),
		...(typeof value.progress === "string" ? { progress: value.progress } : {}),
		...(outputFormat !== undefined ? { outputFormat } : {}),
		...(typeof value.outputFormatStartLine === "number" ? { outputFormatStartLine: value.outputFormatStartLine } : {}),
		...(typeof value.outputFormatLines === "number" ? { outputFormatLines: value.outputFormatLines } : {}),
		phases: strings(value.phases) ?? strings(trace?.phases) ?? [],
		audits: audits ?? operations ?? [],
	};
}

/** The settled (or streaming) result: the program, its phases, every nested call, its return value. */
export function describeFabricResult(
	result: { content?: unknown; details?: unknown; isError?: boolean },
	options: DescribeOptions,
	args?: FabricExecArgs,
): NativeToolView | undefined {
	const details = readDetails(result?.details);
	const program = programText(args);
	const display = runDisplay(args?.display);
	const audits = details.audits ?? [];
	const phases = details.phases ?? [];
	const failed = audits.filter(audit => audit.success === false).length;

	const extraMeta: string[] = [];
	if (audits.length > 0) extraMeta.push(countLabel(audits.length, "call"));
	if (failed > 0) extraMeta.push(`${failed} failed`);
	if (phases.length > 0) extraMeta.push(countLabel(phases.length, "phase"));

	const body: NativeChild[] = [];
	if (program !== "") {
		body.push(programNode(program, options.expanded === true ? CODE_EXPANDED_LINES : RESULT_CODE_LINES));
	}
	if (phases.length > 0) body.push(phaseRow(phases));
	if (details.error !== undefined) {
		body.push(text([span(cut(firstLine(details.error) || details.error, 300), "error")]));
	} else if (audits.length === 0 && details.progress !== undefined) {
		body.push(muted(details.progress));
	}

	const limit = options.expanded === true ? AUDITS_EXPANDED : AUDITS_COLLAPSED;
	const shown = audits.slice(0, limit);
	for (let index = 0; index < shown.length; index += 1) {
		const audit = shown[index];
		if (audit !== undefined) body.push(auditSection(audit, index, options));
	}
	if (audits.length > shown.length) {
		body.push(muted(`… ${countLabel(audits.length - shown.length, "call")} more`));
	}

	const output = outputNode(result?.content, details, options);
	if (output !== undefined) body.push(output);

	return { tool: head(program, display, options, extraMeta), body, preview: "children" };
}
