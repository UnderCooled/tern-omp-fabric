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
import { grepTree, pathTree } from "./tree.js";

/** A styled run; structurally TspSpan, declared here so no pi-wire import is needed. */
type Span = { t: string; s?: string; href?: string };

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

const nonEmpty = (value: unknown): string | undefined => {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed === "" ? undefined : trimmed;
};

/** One line, capped: a provider row names a call, it does not paste it. */
const oneLine = (value: string, max: number): string => {
	const single = value.replace(/\s+/g, " ").trim();
	return single.length <= max ? single : `${single.slice(0, max - 1)}…`;
};

/** How many entries a provider answered with, when it answered with a list. */
const countOf = (result: unknown): string | undefined =>
	Array.isArray(result) ? String(result.length) : undefined;

const shortId = (value: unknown): string | undefined =>
	typeof value === "string" && value !== "" ? value.slice(0, 8) : undefined;

/** The questions a judgment call asked, and the backend that answered them. */
function judgmentDetail(args: Record<string, unknown>, result: unknown): string | undefined {
	const questions = isRecord(args.questions) ? args.questions : undefined;
	let asked: string | undefined;
	if (questions !== undefined) {
		const keys = Object.keys(questions);
		const only = keys.length === 1 ? questions[keys[0]!] : undefined;
		const instructions = isRecord(only) ? nonEmpty(only.instructions) : undefined;
		if (keys.length === 1) asked = instructions === undefined ? "1 question" : oneLine(instructions, 44);
		else if (keys.length > 1) asked = countLabel(keys.length, "question");
	}
	let backend: string | undefined;
	if (isRecord(result)) {
		backend =
			typeof result.backend === "string"
				? (result.backend.split("/").pop() ?? result.backend)
				: result.ok === false
					? nonEmpty(result.reason)
					: undefined;
	}
	return pair(asked, backend, " · ");
}

/** What a provider call's row says after its label (fabric's own `providerCallDetail`). */
type ProviderDetail = (tool: string, args: Record<string, unknown>, result: unknown) => string | undefined;

const PROVIDER_DETAILS: Record<string, ProviderDetail> = {
	judgment: (tool, args, result) => (tool === "ask" ? judgmentDetail(args, result) : undefined),
	agents: (tool, args, result) => {
		const name = nonEmpty(args.name);
		const id = shortId(args.id);
		const message = nonEmpty(args.message);
		switch (tool) {
			case "create":
				return name;
			case "remove":
			case "stop":
			case "cleanup":
			case "wait":
			case "status":
			case "actorStatus":
			case "messages":
				return name ?? id;
			case "ask":
			case "tell":
				return pair(name ?? id, message === undefined ? undefined : oneLine(message, 48), " ");
			case "actors":
			case "list":
			case "models":
			case "peers":
				return countOf(result);
			default:
				return name ?? id;
		}
	},
	mesh: (tool, args, result) => {
		switch (tool) {
			case "publish":
				return nonEmpty(args.topic);
			case "read":
				return pair(nonEmpty(args.topic), countOf(result), " · ");
			case "get":
			case "put":
			case "delete":
				return nonEmpty(args.key);
			case "list":
				return pair(nonEmpty(args.prefix), countOf(result), " · ");
			case "members":
				return countOf(result);
			default:
				return undefined;
		}
	},
	mcp: (tool, args, result) => {
		switch (tool) {
			case "$call":
				return pair(nonEmpty(args.server), nonEmpty(args.tool), ".");
			case "$register":
				return nonEmpty(args.name);
			case "$servers":
				return countOf(result);
			default:
				return undefined;
		}
	},
	fabric: (tool, args, result) => {
		switch (tool) {
			case "discovery.providers":
			case "discovery.models":
			case "discovery.search":
				return countOf(result);
			case "discovery.list": {
				const detail = [nonEmpty(args.provider), nonEmpty(args.namespace), countOf(result)]
					.filter(Boolean)
					.join(" · ");
				return detail === "" ? undefined : detail;
			}
			case "discovery.describe":
				return nonEmpty(args.ref);
			case "workflow.parallel":
			case "workflow.pipeline": {
				const items = typeof args.itemCount === "number" ? countLabel(args.itemCount, "item") : undefined;
				const stages = typeof args.stageCount === "number" ? countLabel(args.stageCount, "stage") : undefined;
				return pair(items, stages, " · ");
			}
			default:
				return undefined;
		}
	},
};

/** The core tool a call names: `grep`, from `grep` or omp's namespaced `omp.grep`. */
function coreToolName(audit: FabricAudit): string | undefined {
	const provider = audit.provider?.toLowerCase();
	if (provider !== undefined && provider !== "omp") return undefined;
	const raw = (audit.tool ?? audit.ref ?? "").toLowerCase();
	if (raw === "") return undefined;
	if (CORE_DETAILS[raw] !== undefined) return raw;
	const leaf = raw.split(".").pop();
	return leaf !== undefined && CORE_DETAILS[leaf] !== undefined ? leaf : undefined;
}

/** The one argument that names the call: a core tool's own title, else its provider's row. */
function callDetail(audit: FabricAudit): string | undefined {
	const args = audit.args ?? {};
	const name = coreToolName(audit);
	const named = name === undefined ? undefined : CORE_DETAILS[name]?.(args);
	if (named !== undefined) return named;
	const provider = audit.provider?.toLowerCase();
	const tool = audit.tool ?? (audit.ref ?? "").split(".")[1];
	const fromProvider =
		provider === undefined || tool === undefined ? undefined : PROVIDER_DETAILS[provider]?.(tool, args, audit.result);
	if (fromProvider !== undefined) return fromProvider;
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

function callDuration(audit: FabricAudit): number | undefined {
	return audit.startedAt !== undefined && audit.endedAt !== undefined ? audit.endedAt - audit.startedAt : undefined;
}

/** Two seconds of waiting is where a call's output stops being noise: it opens by itself. */
const SLOW_CALL_MS = 2000;

function slowCall(audit: FabricAudit): boolean {
	return (callDuration(audit) ?? 0) >= SLOW_CALL_MS;
}

/** One hunk as Tern's `diff` kind takes it: the two start numbers and the marked lines. */
type DiffHunk = { oldStart: number; newStart: number; lines: string[] };

/**
 * omp's edit diff as hunks: ` 1|alpha`, `-2|beta`, `+2|BETA`, one line per row,
 * marker first and the line number after it. A gap in a side's numbering starts a
 * new hunk, which is how a multi-edit diff stays correct.
 */
function parseOmpDiff(raw: string): DiffHunk[] | undefined {
	const hunks: DiffHunk[] = [];
	let current: DiffHunk | undefined;
	let oldNext = 0;
	let newNext = 0;
	for (const row of raw.replace(/\r\n?/g, "\n").split("\n")) {
		const match = /^([ +-])(\d+)\|(.*)$/.exec(row);
		if (match === null) {
			current = undefined;
			continue;
		}
		const mark = match[1] ?? " ";
		const num = Number(match[2]);
		const text = match[3] ?? "";
		const expected = mark === "+" ? newNext : oldNext;
		if (current === undefined || num !== expected) {
			current = { oldStart: num, newStart: num, lines: [] };
			hunks.push(current);
			oldNext = num;
			newNext = num;
		}
		current.lines.push(mark === " " ? " " + text : mark + text);
		if (mark !== "+") oldNext = num + 1;
		if (mark !== "-") newNext = num + 1;
	}
	const changed = hunks.filter(hunk => hunk.lines.some(line => line.startsWith("+") || line.startsWith("-")));
	return changed.length === 0 ? undefined : changed;
}

/** Three lines of context on each side, as every diff reader expects. */
const DIFF_CONTEXT = 3;

/**
 * A diff built from the two texts when the envelope's own diff did not survive
 * (a preview or a cap can drop the field): the common head and tail are found,
 * the middle is one removal run and one addition run.
 */
function diffFromTexts(oldText: string, newText: string): DiffHunk[] | undefined {
	const oldLines = oldText.replace(/\n+$/, "").split("\n");
	const newLines = newText.replace(/\n+$/, "").split("\n");
	let head = 0;
	while (head < oldLines.length && head < newLines.length && oldLines[head] === newLines[head]) head += 1;
	let tail = 0;
	while (
		tail < oldLines.length - head &&
		tail < newLines.length - head &&
		oldLines[oldLines.length - 1 - tail] === newLines[newLines.length - 1 - tail]
	) {
		tail += 1;
	}
	const removed = oldLines.slice(head, oldLines.length - tail);
	const added = newLines.slice(head, newLines.length - tail);
	if (removed.length === 0 && added.length === 0) return undefined;
	const contextBefore = Math.max(0, head - DIFF_CONTEXT);
	const lines = [
		...oldLines.slice(contextBefore, head).map(line => " " + line),
		...removed.map(line => "-" + line),
		...added.map(line => "+" + line),
		...oldLines.slice(oldLines.length - tail, Math.min(oldLines.length, oldLines.length - tail + DIFF_CONTEXT)).map(
			line => " " + line,
		),
	];
	return [{ oldStart: contextBefore + 1, newStart: contextBefore + 1, lines }];
}

/** The `details` object fabric replaced with its own cut JSON text, when it capped it. */
function cappedDetails(result: unknown): boolean {
	return isRecord(result) && isRecord(result.details) && result.details.fabricTruncated === true;
}

/**
 * A path as the link Tern opens it with: its routing hands a `file://` URL to the
 * file itself. A relative one resolves against the directory omp runs in, which is
 * the session's workspace -- the audit carries no cwd of its own.
 */
function fileHref(path: string): string | undefined {
	const trimmed = path.replace(/[\\/]+$/, "");
	if (trimmed === "") return undefined;
	const absolute = /^([A-Za-z]:[\\/]|[\\/]{2}|[\\/])/.test(trimmed) ? trimmed : `${process.cwd()}/${trimmed}`;
	return "file:///" + absolute.replace(/\\/g, "/").replace(/^\/+/, "");
}

/**
 * The diff an edit answered with: `details.diff` (omp's `<marker><line>|text`
 * rows) when it survived, else one built from `details.oldText`/`newText`.
 */
function editDiff(result: unknown): { hunks: DiffHunk[]; path?: string } | undefined {
	if (!isRecord(result)) return undefined;
	const details = isRecord(result.details) ? result.details : result;
	const raw = typeof details.diff === "string" ? details.diff : undefined;
	const hunks = raw === undefined ? undefined : parseOmpDiff(raw);
	const oldText = typeof details.oldText === "string" ? details.oldText : undefined;
	const newText = typeof details.newText === "string" ? details.newText : undefined;
	const resolved =
		hunks ?? (oldText !== undefined && newText !== undefined ? diffFromTexts(oldText, newText) : undefined);
	if (resolved === undefined) return undefined;
	const path = typeof details.path === "string" ? details.path : undefined;
	return path === undefined ? { hunks: resolved } : { hunks: resolved, path };
}

/** What the call ran, as the head names it: `grep` for a core tool, else its ref (`mesh.read`). */
function callLabel(audit: FabricAudit): string {
	const ref = firstLine(audit.ref ?? audit.tool ?? "call");
	const label = coreToolName(audit) ?? ref;
	return label === "" ? "call" : label;
}

/** The call's own line: the tool, its one argument, how long it took. */
function callHead(audit: FabricAudit): Span[] {
	const label = callLabel(audit);
	const head: Span[] = [span(label, "strong")];
	// A bash command and a spawned agent's brief are bodies of their own, not labels.
	const detail = label === "bash" ? undefined : (spawnLabel(audit) ?? callDetail(audit));
	if (detail !== undefined) {
		// An edit whose change fabric capped has no diff to show: the file name is how
		// the reader sees the change, so it opens the file instead.
		const path = cappedDetails(audit.result) ? audit.args?.path : undefined;
		const href = typeof path === "string" ? fileHref(path) : undefined;
		if (href !== undefined) head[0] = { ...head[0]!, href };
		head.push(span(" "), href === undefined ? span(detail, "accent") : { t: detail, s: "accent", href });
	}
	const took = formatDuration(callDuration(audit));
	if (took !== undefined) head.push(span(` · ${took}`, "muted"));
	if (audit.success === false) head.push(span(" · failed", "error"));
	return head;
}

/** A judgment's verdict and the bullets under it, as the answer itself reads. */
type JudgmentAnswer = { verdict: string; bullets: string[]; tone: "success" | "error" };

function judgmentAnswer(result: unknown): JudgmentAnswer | undefined {
	if (!isRecord(result)) return undefined;
	if (result.ok === false) {
		const reason = nonEmpty(result.reason) ?? "failed";
		const detail = nonEmpty(result.detail);
		return { verdict: reason, bullets: detail === undefined ? [] : [detail], tone: "error" };
	}
	if (result.ok !== true || !isRecord(result.answers)) return undefined;
	const answers = Object.entries(result.answers);
	const bullets: string[] = [];
	let verdict: string | undefined;
	for (const [id, value] of answers) {
		if (!isRecord(value)) continue;
		if (value.type === "bool" && typeof value.bool === "number") {
			const yes = value.bool >= 0.5;
			const percent = Math.round((yes ? value.bool : 1 - value.bool) * 100);
			bullets.push(id + ": " + (yes ? "yes" : "no") + " · " + percent + "%");
			if (answers.length === 1) verdict = (yes ? "yes" : "no") + " · " + percent + "%";
		} else if (value.type === "choice" && typeof value.choice === "string") {
			const confidence = typeof value.confidence === "number" ? " · " + Math.round(value.confidence * 100) + "%" : "";
			bullets.push(id + ": " + value.choice + confidence);
			if (answers.length === 1) verdict = value.choice + confidence;
		} else if (value.type === "score" && typeof value.score === "number") {
			bullets.push(id + ": " + value.score);
			if (answers.length === 1) verdict = String(value.score);
		}
	}
	if (verdict === undefined && bullets.length === 0) return undefined;
	return { verdict: verdict ?? countLabel(bullets.length, "answer"), bullets, tone: "success" };
}

/**
 * A judgment answers with a verdict and its bullets, not with a JSON dump: the
 * verdict is the badge, every question it answered is one line under it.
 */
function judgmentOutput(audit: FabricAudit, index: number, options: DescribeOptions): NativeChild | undefined {
	const answer = judgmentAnswer(audit.result);
	if (answer === undefined) return undefined;
	const raw = isRecord(audit.result) ? nonEmpty(audit.result.backend) : undefined;
	const backend = raw === undefined ? undefined : (raw.split("/").pop() ?? raw);
	const head: Span[] = [span("judgment", "muted")];
	if (backend !== undefined) head.push(span(" · " + backend, "muted"));
	if (answer.bullets.length > 0) head.push(span(" · " + countLabel(answer.bullets.length, "answer"), "muted"));
	return {
		k: "section",
		key: `output:${index}:judgment`,
		p: {
			head,
			role: "omp-fabric.judgment",
			collapsible: true,
			collapsed: options.expanded !== true && !slowCall(audit),
		},
		c: [
			{
				k: "badge",
				key: `output:${index}:verdict`,
				p: { text: answer.verdict, tone: answer.tone, role: "omp-fabric.verdict" },
			},
			...answer.bullets.map((bullet, at) => ({
				k: "text" as const,
				key: `output:${index}:answer:${at}`,
				p: { spans: [span("• ", "muted"), span(bullet)], role: "omp-fabric.answer" },
			})),
		],
	};
}

/** A result whose lines are structured — a grep's file groups, a find's paths — drawn as a tree. */
function treeOf(audit: FabricAudit, text: string, index: number): NativeChild | undefined {
	const label = callLabel(audit).toLowerCase();
	if (label === "grep") return grepTree(text, `output:${index}:grep`);
	if (label === "find" || label === "ls") return pathTree(text, `output:${index}:paths`);
	return undefined;
}

/**
 * One call's output in its own fold: the head names it and how many lines it
 * holds, and opening that fold shows it whole. A block inside a tool body cannot
 * clamp and unfold independently -- its preview button opens the enclosing
 * disclosure -- so each block is a disclosure of its own.
 */
function outputNode(
	audit: FabricAudit,
	index: number,
	options: DescribeOptions,
	fold: boolean,
): NativeChild | undefined {
	const result = audit.result;
	if (result === undefined || result === null) {
		return audit.fromTrace === true ? muted("result not retained after reload") : undefined;
	}
	// fabric caps what it keeps per audit; when the cap hit, say so instead of
	// pasting a slice of JSON into the fold.
	if (isRecord(result) && result.fabricTruncated === true) {
		const size = typeof result.originalChars === "number" ? result.originalChars + " chars" : "too large";
		return muted("result truncated by fabric (" + size + ")");
	}
	// A judgment answers with a verdict, not with the JSON envelope it arrived in.
	const judgment = audit.provider?.toLowerCase() === "judgment" ? judgmentOutput(audit, index, options) : undefined;
	if (judgment !== undefined) return judgment;
	// An edit answers with a diff: Tern draws that as a diff, not as a block of text.
	// When fabric capped that answer only a prefix survives, and a prefix reads as the
	// whole change; the call line names the file and the block stays away.
	const diff = editDiff(result);
	if (diff === undefined && cappedDetails(result)) return undefined;
	const text = diff === undefined ? resultText(result) : undefined;
	if (diff === undefined && text === undefined) return muted("result not shown");
	const flat = text?.trim();
	// "(no output)" is the tool saying it printed nothing: not a block worth folding.
	if (flat === "" || flat === NO_OUTPUT) return undefined;
	// A tool whose result a person never reads (a file's text) says so on its line.
	if (!fold) return undefined;
	const lines =
		diff === undefined ? (text ?? "").split("\n").length : diff.hunks.reduce((sum, hunk) => sum + hunk.lines.length, 0);
	// A grep's matches and a find's paths have a shape the text already carries:
	// the tree is that shape, and the reader stops parsing lines by eye.
	const tree = diff === undefined && text !== undefined ? treeOf(audit, text, index) : undefined;
	return {
		k: "section",
		key: `output:${index}`,
		p: {
			// Named for its call: a column of bare "output" rows says nothing about
			// which call each one belongs to.
			head: [span(callLabel(audit) + " output", "muted"), span(" · " + countLabel(lines, "line"), "muted")],
			role: "omp-fabric.output",
			collapsible: true,
			collapsed: options.expanded !== true && !slowCall(audit),
		},
		c: [
			tree ??
				(diff === undefined
					? { k: "ansi", key: `output:${index}:text`, p: { text: text ?? "", role: "omp-fabric.output-text" } }
					: {
						k: "diff",
						key: `output:${index}:diff`,
						p: {
							hunks: diff.hunks,
							path: diff.path,
							mode: "unified" as const,
							role: "omp-fabric.output-diff",
						},
					}),
		],
	};
}

/** What a tool prints when it changed nothing: a fold would only hold that line. */
const NO_OUTPUT = "(no output)";

/**
 * How one tool's result is shown. `fold: false` means the output is data a person
 * does not read back in a transcript (a file's own text), so the call line carries
 * the fact instead and no fold is drawn.
 */
type ToolDisplay = {
	fold: boolean;
	/** A short fact for the call line, from the result as text. */
	fact?: (text: string) => string | undefined;
};

const countTextLines = (text: string): string => countLabel(text.trim().split("\n").length, "line");

/** omp core tools, whose results differ enough to deserve their own line. */
const TOOL_DISPLAY: Record<string, ToolDisplay> = {
	read: { fold: false, fact: countTextLines },
	write: {
		fold: false,
		fact: text => {
			const bytes = /(\d+)\s+bytes/.exec(text);
			return bytes === null ? undefined : bytes[1] + " bytes";
		},
	},
};

/** A bash call's whole command, for the code block that replaces the one-line label. */
function bashCommand(audit: FabricAudit): string | undefined {
	if (callLabel(audit) !== "bash") return undefined;
	const command = audit.args?.command;
	return typeof command === "string" && command.trim() !== "" ? command : undefined;
}

/**
 * The command as a fenced block, so Tern draws what a fence always gets: the
 * language head with its Copy button, the highlighter, the code background. The
 * fence outruns any backtick run inside the command, so nothing closes it early.
 */
function fencedCommand(command: string): string {
	const runs = command.match(/`+/g) ?? [];
	const longest = runs.reduce((most, run) => Math.max(most, run.length), 0);
	const fence = "`".repeat(Math.max(3, longest + 1));
	return fence + "bash\n" + command.replace(/\n+$/, "") + "\n" + fence;
}


/** The child agent a spawn-like call started, as fabric reports it back. */
type SpawnedAgent = {
	name: string;
	agent?: string;
	model?: string;
	brief: string;
	status: "pending" | "done" | "failed" | "aborted";
};

/** The prefix omp's own agent row strips before it summarizes a brief. */
const ASSIGNMENT_PREFIX = /^\s*Complete assignment thoroughly:\s*/i;

/** The agents provider's calls that start a child: they take a `task`, nothing else does. */
const SPAWN_TOOLS = new Set(["spawn", "run", "handoff"]);

/** Fabric's own run states, in the words an agent row shows. */
const AGENT_STATUS: Record<string, SpawnedAgent["status"]> = {
	queued: "pending",
	running: "pending",
	completed: "done",
	failed: "failed",
	stopped: "aborted",
	cancelled: "aborted",
	timed_out: "aborted",
};

/**
 * The child an `agents.spawn`/`run`/`handoff` call started. The call takes one
 * `task`, so there is one agent, and the result is its handle: that names it,
 * says which runner and model it went to, and carries its run state. The brief
 * is fabric's own preview of the task -- the first 2000 characters.
 */
function spawnedAgent(audit: FabricAudit): SpawnedAgent | undefined {
	if (audit.provider?.toLowerCase() !== "agents") return undefined;
	const tool = toolLeaf(audit);
	if (!SPAWN_TOOLS.has(tool)) return undefined;
	const args = audit.args ?? {};
	const handle = isRecord(audit.result) ? audit.result : undefined;
	const brief =
		typeof args.task === "string" ? args.task.replace(/\r\n?/g, "\n").replace(/\n+$/, "") : "";
	const name =
		nonEmpty(args.name) ??
		nonEmpty(handle?.name) ??
		cut(firstLine(brief.replace(ASSIGNMENT_PREFIX, "")), 48);
	if (name === undefined && brief === "") return undefined;
	const agent = nonEmpty(handle?.runner) ?? nonEmpty(args.runner);
	const model = nonEmpty(handle?.model) ?? nonEmpty(args.model);
	const reported = AGENT_STATUS[String(handle?.status ?? "").toLowerCase()];
	return {
		name: name ?? "agent",
		...(agent === undefined ? {} : { agent }),
		...(model === undefined ? {} : { model }),
		brief,
		status: reported ?? (audit.success === false ? "failed" : tool === "spawn" ? "pending" : "done"),
	};
}

/** What the call spawned, as its line names it: the one agent. */
function spawnLabel(audit: FabricAudit): string | undefined {
	return spawnedAgent(audit)?.name;
}

/** The agents calls whose answer is one agent, and the ones that answer with a list. */
const AGENT_ONE_TOOLS = new Set(["status", "actorStatus", "wait", "ask", "tell", "create", "remove", "stop", "cleanup"]);
const AGENT_LIST_TOOLS = new Set(["actors", "list", "models", "peers"]);

/** The provider tool a call names, without the provider prefix: `status` from `agents.status`. */
function toolLeaf(audit: FabricAudit): string {
	return callLabel(audit).split(".").pop()?.toLowerCase() ?? "";
}

/** The agent an agents call reports on: a status handle, not a spawn. */
function reportedAgent(audit: FabricAudit): SpawnedAgent | undefined {
	if (audit.provider?.toLowerCase() !== "agents" || !AGENT_ONE_TOOLS.has(toolLeaf(audit))) return undefined;
	const handle = audit.result;
	if (!isRecord(handle)) return undefined;
	const name = nonEmpty(handle.name) ?? shortId(handle.id);
	if (name === undefined) return undefined;
	const agent = nonEmpty(handle.runner);
	const model = nonEmpty(handle.model);
	const reported = AGENT_STATUS[String(handle.status ?? "").toLowerCase()];
	return {
		name,
		...(agent === undefined ? {} : { agent }),
		...(model === undefined ? {} : { model }),
		brief: "",
		status: reported ?? (audit.success === false ? "failed" : "done"),
	};
}

/** The agents an agents call listed: one row each, named the way its own handle names it. */
function agentListNode(audit: FabricAudit, index: number): NativeChild | undefined {
	if (audit.provider?.toLowerCase() !== "agents" || !AGENT_LIST_TOOLS.has(toolLeaf(audit))) return undefined;
	if (!Array.isArray(audit.result)) return undefined;
	const rows = audit.result.filter(isRecord);
	if (rows.length === 0) return undefined;
	return {
		k: "list",
		key: `call:${index}:agents`,
		p: { role: "omp-fabric.agents" },
		c: rows.map((row, at) => {
			const status = AGENT_STATUS[String(row.status ?? "").toLowerCase()] ?? "done";
			const model = nonEmpty(row.model);
			return {
				k: "item" as const,
				key: `call:${index}:agents:${at}`,
				p: {
					label: nonEmpty(row.name) ?? shortId(row.id) ?? "agent",
					detail: model === undefined ? status : status + " · " + model,
				},
			};
		}),
	};
}

/**
 * The spawned agent: the row names it and says which runner and model it went
 * to, and the fold under it holds the whole brief as the model wrote it, drawn
 * as markdown the way omp's own agent card draws an assignment. A brief is long,
 * so the row starts folded.
 */
function agentNode(spawn: SpawnedAgent, call: number, options: DescribeOptions): NativeChild {
	const summary = firstLine(spawn.brief.replace(ASSIGNMENT_PREFIX, ""));
	const children: NativeChild[] =
		spawn.brief === ""
			? []
			: [{ k: "md", key: `call:${call}:agent:brief`, p: { text: spawn.brief, role: "omp-fabric.assignment" } }];
	return {
		k: "agent",
		key: `call:${call}:agent`,
		p: {
			name: spawn.name,
			...(spawn.agent === undefined ? {} : { agent: spawn.agent }),
			...(spawn.model === undefined ? {} : { model: spawn.model }),
			...(summary === "" ? {} : { task: cut(summary, DETAIL_CHARS) }),
			status: spawn.status,
			collapsible: children.length > 0,
			collapsed: options.expanded !== true,
			role: "omp-fabric.agent",
		},
		c: children,
	};
}

/** fabric caps a write's previewed content at this many characters. */
const WRITE_PREVIEW_CHARS = 16_000;

/**
 * The content a write call is about to write, while the call still runs: fabric
 * previews it from the arguments, so the card shows the change before it lands.
 * The preview is a prefix of the file, and says so when fabric cut it.
 */
function writePreview(audit: FabricAudit, index: number, options: DescribeOptions): NativeChild | undefined {
	if (coreToolName(audit) !== "write" || audit.result !== undefined) return undefined;
	const content = audit.args?.content;
	if (typeof content !== "string" || content === "") return undefined;
	const path = typeof audit.args?.path === "string" ? audit.args.path : undefined;
	const head: Span[] = [span("preview", "muted"), span(" · " + countLabel(content.split("\n").length, "line"), "muted")];
	if (content.length >= WRITE_PREVIEW_CHARS) {
		head.push(span(" · first " + WRITE_PREVIEW_CHARS + " chars", "warning"));
	}
	return {
		k: "section",
		key: `call:${index}:preview`,
		p: { head, role: "omp-fabric.preview", collapsible: true, collapsed: options.expanded !== true },
		c: [
			{
				k: "code",
				key: `call:${index}:preview-code`,
				p: {
					text: content.replace(/\n+$/, ""),
					...(path === undefined ? {} : { path }),
				},
			},
		],
	};
}

/** The fact a call's own rule puts on its line, for a result that has one. */
function headFact(display: ToolDisplay, result: unknown): string | undefined {
	const factOf = display.fact;
	if (factOf === undefined) return undefined;
	const text = resultText(result)?.trim();
	if (text === undefined || text === "" || text === NO_OUTPUT) return undefined;
	return factOf(text);
}

/**
 * One call: its line, then its output in a fold of its own. Every call that
 * returned something gets that fold — it is one row while folded, so there is
 * nothing to spare by hiding it, and a gap in the column only makes the reader
 * wonder what went missing. A call that printed nothing says so on its line
 * instead, where the eye already is.
 */
function callBlock(audit: FabricAudit, index: number, options: DescribeOptions): NativeChild[] {
	const display = TOOL_DISPLAY[callLabel(audit).toLowerCase()] ?? { fold: true };
	const body = outputNode(audit, index, options, display.fold);
	const spawn = spawnedAgent(audit);
	// A write still running shows what it is about to write, from the arguments.
	const preview = writePreview(audit, index, options);
	const head = callHead(audit);
	// A capped details was not "no output": it was output nobody can vouch for, and
	// a spawn or a running write is shown by its own block, not by that marker.
	if (body === undefined && preview === undefined && !cappedDetails(audit.result) && spawn === undefined) {
		const fact = headFact(display, audit.result);
		head.push(span(" ", "muted"), span(fact ?? NO_OUTPUT, fact === undefined ? "warning strong" : "muted"));
	}
	const nodes: NativeChild[] = [
		{ k: "text", key: `call:${index}:${audit.ref}`, p: { spans: head, role: "omp-fabric.call" } },
	];
	// The command itself, whole and highlighted: a shell line cut into a tool
	// label is unreadable the moment it has a pipe or a redirect in it.
	const command = bashCommand(audit);
	if (command !== undefined) {
		nodes.push({
			k: "row",
			key: `call:${index}:command`,
			c: [
				// Two cells in, so the block sits under the label instead of running
				// out past it to the left edge.
				{ k: "text", key: `call:${index}:indent`, p: { spans: [span("  ")], min: { w: "2ch" }, shrink: 0 } },
				{
					k: "md",
					key: `call:${index}:command-text`,
					// A fence, not a bare code node: Tern gives a fence the language head,
					// its Copy button and the code background; the sheet below rings it and
					// wraps its lines.
					p: { text: fencedCommand(command), role: "omp-fabric.command", grow: 1, basis: 0 },
				},
			],
		});
	}
	if (preview !== undefined) nodes.push(preview);
	// What the model asked the agent for: one row, whose own fold holds the brief.
	if (spawn !== undefined) nodes.push(agentNode(spawn, index, options));
	// An agents call that did not start a child still reports on one, or lists them.
	const reported = reportedAgent(audit);
	if (reported !== undefined) nodes.push(agentNode(reported, index, options));
	const listed = agentListNode(audit, index);
	if (listed !== undefined) nodes.push(listed);
	if (body !== undefined) nodes.push(body);
	if (audit.resultTruncated === true) nodes.push(muted("truncated"));
	if (audit.success === false && audit.error) {
		nodes.push(text([span(cut(firstLine(audit.error) || audit.error, 300), "error")]));
	}
	return nodes;
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
 * The program in its own fold: the head counts its lines, opening it shows the
 * whole program, and a click on the code copies it while the card's expand
 * (ctrl+o) opens every fold at once.
 */
function programBlock(program: string, options: DescribeOptions): NativeChild {
	const lines = program.split("\n").length;
	return {
		k: "section",
		key: "program",
		p: {
			head: [span("program", "muted"), span(" · " + countLabel(lines, "line"), "muted")],
			role: "omp-fabric.program",
			collapsible: true,
			collapsed: options.expanded !== true,
		},
		c: [
			{
				k: "code",
				key: "program-code",
				p: {
					text: program,
					lang: "typescript",
					actions: COPY_ACTION,
					title: "Click the code to copy the program",
				},
			},
		],
	};
}

/** The phases, then one block per call (the counts sit in the head). */
function callBlocks(audits: FabricAudit[], phases: string[], options: DescribeOptions): NativeChild[] {
	const nodes: NativeChild[] = phases.length > 0 ? [phaseRow(phases)] : [];
	const limit = options.expanded === true ? AUDITS_EXPANDED : AUDITS_COLLAPSED;
	const shown = audits.slice(0, limit);
	for (let index = 0; index < shown.length; index += 1) {
		const audit = shown[index];
		if (audit !== undefined) nodes.push(...callBlock(audit, index, options));
	}
	if (audits.length > shown.length) {
		nodes.push(muted("… " + countLabel(audits.length - shown.length, "call") + " more"));
	}
	return nodes;
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
		body.push(programBlock(program, options));
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

/** The program's own return text: `content` as a string, or its text parts joined. */
function contentText(content: unknown): string | undefined {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return undefined;
	const parts = content
		.map(part => (isRecord(part) && typeof part.text === "string" ? part.text : ""))
		.filter(part => part !== "");
	return parts.length === 0 ? undefined : parts.join("\n");
}

/** Lines up to the last non-blank one: how omp counts what a program returned. */
function trimmedLineCount(value: string): number {
	const lines = value.split("\n");
	let end = lines.length;
	while (end > 0 && (lines[end - 1] ?? "").trim() === "") end -= 1;
	return end;
}

/**
 * A nested read hands the program a whole file, but the program decides what the
 * model sees: when it returns fewer lines than it read, the card says how many.
 */
function modelReadHint(content: string | undefined, audits: FabricAudit[]): string | undefined {
	if (content === undefined) return undefined;
	const modelLines = trimmedLineCount(content);
	let readLines = 0;
	let sawRead = false;
	for (const audit of audits) {
		if (coreToolName(audit) !== "read") continue;
		const body = resultText(audit.result);
		if (typeof body !== "string") continue;
		sawRead = true;
		readLines += trimmedLineCount(body);
	}
	return sawRead && modelLines < readLines ? `→ ${modelLines} of ${readLines} lines to model` : undefined;
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
	if (program !== "") body.push(programBlock(program, options));
	body.push(...callBlocks(audits, phases, options));
	const hint = modelReadHint(contentText(result?.content), audits);
	if (hint !== undefined) body.push(text([span(hint, "warning")]));
	if (details.error !== undefined) {
		body.push(text([span(cut(firstLine(details.error) || details.error, 300), "error")]));
	} else if (audits.length === 0 && details.progress !== undefined) {
		body.push(muted(details.progress));
	}

	return { tool: head(program, display, facts), body, preview: "children" };
}

