/**
 * fabric_exec -> NativeToolView (Tern's TSP tree).
 *
 * Pure by design: nothing here imports a host package at run time, so the
 * extension's load path stays {this file, attach.ts, the host's own modules}.
 * The type imports are erased for the same reason.
 *
 * Layout: the head names the call and nothing else. Under it, the program is a
 * framed block folded to a few lines whose own head unfolds it and whose code
 * copies on click; the call names its walltime, timeout and working directory;
 * the result folds the phases and the nested calls into one section, separates
 * the parts with rules, and ends on a foot line (done/failed/timed-out and the
 * settled duration).
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
	phases?: string[];
	audits?: FabricAudit[];
};

export type DescribeOptions = {
	expanded?: boolean;
	isPartial?: boolean;
	argsComplete?: boolean;
	executionStarted?: boolean;
	media?: boolean;
	elapsedMs?: number;
	cancelled?: boolean;
};

/** Lines a block keeps while the tool card is folded; the card's expand shows the rest. */
const PROGRAM_PREVIEW_LINES = 4;
const OUTPUT_PREVIEW_LINES = 4;
const AUDITS_COLLAPSED = 8;
const AUDITS_EXPANDED = 30;
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

/** `1.2s` / `850ms` / `30s`, as omp's tool-call timing reads. */
function formatDuration(ms: number | undefined): string | undefined {
	if (ms === undefined || !Number.isFinite(ms) || ms < 0) return undefined;
	if (ms < 1000) return `${Math.round(ms)}ms`;
	const seconds = (ms / 1000).toFixed(1);
	return `${seconds.endsWith(".0") ? seconds.slice(0, -2) : seconds}s`;
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

function jsonSafe(value: unknown): string | undefined {
	try {
		return JSON.stringify(value, null, 2) ?? undefined;
	} catch {
		return undefined;
	}
}

/**
 * What a call handed back, as terminal text: its string as-is, the `output` field
 * when it answers with an envelope (`{ ok, output, details }`), else its JSON.
 * Never syntax-highlighted: what a tool returns is terminal output, so `ansi`
 * draws it the way it was written, colors and all.
 */
function resultText(result: unknown): string | undefined {
	if (typeof result === "string") return result;
	if (isRecord(result)) {
		const output = result.output;
		if (typeof output === "string") return output;
		if (output !== undefined && output !== null) return jsonSafe(output);
	}
	return jsonSafe(result);
}

/** A call whose output is worth showing unfolded: two seconds is where a wait becomes a fact. */
const SLOW_CALL_MS = 2000;

function callDuration(audit: FabricAudit): number | undefined {
	return audit.startedAt !== undefined && audit.endedAt !== undefined ? audit.endedAt - audit.startedAt : undefined;
}

/**
 * One call's output, as output rather than as data. The role is what the
 * stylesheet rings. `lines` clamps it here rather than through `preview`,
 * because a preview gives way inside an open section and this clamp must hold.
 */
function resultNodes(audit: FabricAudit, lines: number): NativeChild[] {
	const result = audit.result;
	if (result === undefined || result === null) {
		return audit.fromTrace === true ? [muted("result not retained after reload")] : [];
	}
	const text = resultText(result);
	if (text === undefined) return [muted("result not shown")];
	if (text.trim() === "") return [];
	const all = text.split("\n");
	if (all.length <= lines) {
		return [{ k: "ansi", key: "output", p: { text, role: "omp-fabric.output" } }];
	}
	// Plain truncation, no fold of its own: the hint the terminal already draws for
	// the card (ctrl+o / omp's app.tools.expand) is what opens the rest.
	return [
		{ k: "ansi", key: "output", p: { text: all.slice(0, lines).join("\n"), role: "omp-fabric.output" } },
		muted("… " + countLabel(all.length - lines, "line") + " more"),
	];
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

	// A fast call keeps its output folded; one that made the user wait two seconds
	// or more shows its first four lines without being asked, and a failure always
	// shows. The card's own expand opens every one of them whole.
	const expanded = options.expanded === true;
	const slow = (callDuration(audit) ?? 0) >= SLOW_CALL_MS;
	const failed = audit.success === false;
	const children: NativeChild[] = resultNodes(audit, expanded ? Number.POSITIVE_INFINITY : OUTPUT_PREVIEW_LINES);
	if (failed && audit.error) {
		children.push(text([span(cut(firstLine(audit.error) || audit.error, 300), "error")]));
	}
	if (audit.resultTruncated === true) children.push(muted("truncated"));
	return {
		k: "section",
		key: `call:${index}:${audit.ref}`,
		p: { head, role: "omp-fabric.call", collapsible: true, collapsed: !(expanded || slow || failed) },
		c: children,
	};
}

/** Before anything has returned: the deadline it runs under, or nothing. */
function pendingFacts(args: FabricExecArgs | undefined): Span[][] {
	const timeout = formatDuration(args?.timeoutMs);
	return timeout === undefined ? [] : [[span("timeout " + timeout, "muted")]];
}

/** The call's outcome as head facts: done/failed/cancelled, or its timeout while it runs. */
function statusFacts(
	failed: boolean,
	options: DescribeOptions,
	args: FabricExecArgs | undefined,
): Span[][] {
	if (options.cancelled === true) return [[span("✗ Cancelled", "warning")]];
	if (options.isPartial === true) return pendingFacts(args);
	const spans = [failed ? span("✗ Failed", "error") : span("✓ Done", "success")];
	const elapsed = formatDuration(options.elapsedMs);
	if (elapsed !== undefined) spans.push(span(" · " + elapsed, "muted"));
	return [spans];
}

/** A click on the code copies it (Tern's own copy action). */
const COPY_ACTION = { click: "copy", menu: ["copy"] } as const;

/**
 * A code block that clamps to `lines` while the tool card is folded and shows
 * whole once it is open: the card is the only disclosure here, because nested
 * frames are flattened (tsp.d.ts, TspToolProps) and a section's preview would
 * give way inside a folded one anyway.
 */
function codeBlock(
	key: string,
	role: string,
	text: string,
	lang: string | undefined,
	lines: number,
	copyTitle: string,
	start?: number,
): NativeChild {
	return {
		k: "code",
		key,
		p: { text, lang, start, preview: { lines }, role, actions: COPY_ACTION, title: copyTitle },
	};
}

/** The program, clamped until the card is expanded, copied by a click. */
function programBlock(program: string): NativeChild {
	return codeBlock(
		"program",
		"omp-fabric.program",
		program,
		"typescript",
		PROGRAM_PREVIEW_LINES,
		"Click the code to copy the program",
	);
}

/** One open section over the phases and the nested calls (the counts sit in the head). */
function callsSection(audits: FabricAudit[], phases: string[], options: DescribeOptions): NativeChild {
	const label = audits.length > 0 ? "calls" : "phases";
	const children: NativeChild[] = [];
	if (phases.length > 0) children.push(phaseRow(phases));
	const limit = options.expanded === true ? AUDITS_EXPANDED : AUDITS_COLLAPSED;
	const shown = audits.slice(0, limit);
	for (let index = 0; index < shown.length; index += 1) {
		const audit = shown[index];
		if (audit !== undefined) children.push(auditSection(audit, index, options));
	}
	if (audits.length > shown.length) {
		children.push(muted("… " + countLabel(audits.length - shown.length, "call") + " more"));
	}
	return {
		k: "section",
		key: "calls",
		p: { head: [span(label, "muted")], role: "omp-fabric.calls", collapsible: true, collapsed: false },
		c: children,
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

/**
 * The call's data head: the verb, then the counted facts and the outcome. No
 * target line and no Copy command — the program is the body, and the copy rides
 * on its code.
 */
function head(
	program: string,
	display: { name?: string; description?: string },
	facts: Span[][],
): NativeToolHead {
	const lines = program === "" ? 0 : program.split("\n").length;
	const meta: (string | Span[])[] = [];
	if (display.name !== undefined) meta.push(display.name);
	if (lines > 0) meta.push("TypeScript · " + countLabel(lines, "line"));
	meta.push(...facts);
	return { title: "Fabric", meta: meta.length > 0 ? meta : undefined };
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
		body.push(programBlock(program));
	} else if (options.argsComplete === false) {
		body.push(muted("composing…"));
	}
	return { tool: head(program, display, pendingFacts(args)), body, preview: "children" };
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
	return {
		...(success !== undefined ? { success } : {}),
		...(error !== undefined ? { error } : {}),
		...(typeof value.progress === "string" ? { progress: value.progress } : {}),
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
	const failed = result?.isError === true || details.success === false;
	const failedCalls = audits.filter(audit => audit.success === false).length;

	const facts: Span[][] = [];
	if (audits.length > 0) facts.push([span(countLabel(audits.length, "call"), "strong")]);
	if (failedCalls > 0) facts.push([span(failedCalls + " failed", "error")]);
	if (phases.length > 0) facts.push([span(countLabel(phases.length, "phase"), "muted")]);
	facts.push(...statusFacts(failed, options, args));

	const body: NativeChild[] = [];
	if (program !== "") body.push(programBlock(program));
	if (audits.length > 0 || phases.length > 0) body.push(callsSection(audits, phases, options));
	if (details.error !== undefined) {
		body.push(text([span(cut(firstLine(details.error) || details.error, 300), "error")]));
	} else if (audits.length === 0 && details.progress !== undefined) {
		body.push(muted(details.progress));
	}

	return { tool: head(program, display, facts), body, preview: "children" };
}

