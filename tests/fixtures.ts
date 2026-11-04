import type { FabricDetails, FabricExecArgs, FabricAudit } from "../src/describe";

/** A 12-line TypeScript program, exactly as a model would send it. */
export const PROGRAM_LINES = [
	"const pattern = /foo/;",
	"const matches = await omp.grep({ pattern, path: \"src\" });",
	"for (const file of matches) {",
	"  const source = await omp.read({ path: file });",
	"  if (source.includes(\"TODO\")) {",
	"    console.log(file, \"has TODOs\");",
	"  }",
	"}",
	"return {",
	"  scanned: matches.length,",
	"  format: \"yaml\",",
	"};",
];

/** The result payload: a few lines of YAML, matching outputFormat below. */
export const OUTPUT_TEXT = [
	"scanned: 3",
	"todos:",
	"  - src/a.ts",
	"  - src/b.ts",
	"  - src/c.ts",
	"format: yaml",
	"duration_ms: 41",
	"audits: 3",
	"phases:",
	"  - scan",
	"  - report",
	"status: ok",
].join("\n");

export const fabricCallArgs: FabricExecArgs = {
	code: PROGRAM_LINES,
	timeoutMs: 30_000,
	display: { name: "Sweep TODOs", description: "Greps src for TODO markers and reports files." },
};

/** Rich details: two successful audits, one failing, two phases, YAML output. */
export const fabricDetails: FabricDetails = {
	success: true,
	phases: ["scan", "report"],
	audits: [
		{
			ref: "omp.grep",
			tool: "grep",
			provider: "omp",
			success: true,
			args: { pattern: "foo", path: "src" },
			result: "src/a.ts:12: foo\nsrc/b.ts:3: food\nsrc/c.ts:88: foobar",
			startedAt: 1000,
			endedAt: 1024,
		},
		{
			ref: "omp.read",
			tool: "read",
			provider: "omp",
			success: true,
			args: { path: "src/a.ts" },
			result: { lines: 40, truncated: false, encoding: "utf-8" },
			startedAt: 1024,
			endedAt: 1065,
		},
		{
			ref: "tools.mcp.do_thing",
			tool: "do_thing",
			provider: "tools.mcp",
			success: false,
			args: { name: "thing" },
			error: "MCP tool do_thing failed: connection reset by peer",
		},
	],
};

export const fabricResult = {
	isError: false,
	content: [{ type: "text", text: OUTPUT_TEXT }],
	details: fabricDetails,
};

/** The durable-trace fallback: no rich audits, just trace operations. */
export const traceOnlyDetails = {
	phases: ["scan"],
	trace: {
		kind: "omp-fabric.execution",
		version: 1,
		outcome: "succeeded",
		phases: ["scan"],
		operations: [
			{ ref: "omp.grep", action: "grep", provider: "omp", args: { pattern: "bar", path: "lib" }, outcome: "succeeded" },
			{ ref: "omp.read", action: "read", provider: "omp", args: { path: "lib/x.ts" }, outcome: "failed", error: "ENOENT: no such file" },
		],
		counts: { droppedValues: 0, truncatedValues: 0, redactedValues: 0, droppedOperations: 0 },
	},
};

/** An edit call: the result envelope an `omp.edit` returns, diff and all. */
export const editAudit: FabricAudit = {
	ref: "omp.edit",
	tool: "edit",
	provider: "omp",
	success: true,
	args: { path: "src/a.ts", old_string: "beta", new_string: "BETA" },
	result: {
		ok: true,
		output: "[src/a.ts]\n1:alpha\n2:BETA\n3:gamma\n",
		details: {
			op: "update",
			path: "src/a.ts",
			firstChangedLine: 2,
			diff: " 1|alpha\n-2|beta\n+2|BETA\n 3|gamma",
			oldText: "alpha\nbeta\ngamma\n",
			newText: "alpha\nBETA\ngamma\n",
		},
	},
	startedAt: 0,
	endedAt: 300,
};

/** A call slow enough that its output is worth showing without a click. */
export const slowAudit: FabricAudit = {
	ref: "omp.bash",
	tool: "bash",
	provider: "omp",
	success: true,
	args: { command: "bun run build" },
	result: ["line 1", "line 2", "line 3", "line 4", "line 5", "line 6"].join("\n"),
	startedAt: 0,
	endedAt: 5200,
};

/** A spawn: fabric started one child agent and handed back its handle. */
export const spawnAudit: FabricAudit = {
	ref: "agents.spawn",
	tool: "spawn",
	provider: "agents",
	success: true,
	args: {
		name: "ExploreRepos",
		task: "Complete assignment thoroughly: find every caller of describeFabricResult.\n\nThen report the files.",
		runner: "omp",
		model: "anthropic/claude-sonnet-4-5",
	},
	result: {
		id: "01a1589d",
		name: "ExploreRepos",
		status: "running",
		runner: "omp",
		transport: "process",
		cwd: "D:/repos/tern_plugins/tern-omp-fabric",
		model: "anthropic/claude-sonnet-4-5",
	},
	startedAt: 0,
	endedAt: 5200,
};

/** A trace-only audit: the result did not survive the reload. */
export const fromTraceAudit: FabricAudit = {
	ref: "omp.grep",
	tool: "grep",
	provider: "omp",
	fromTrace: true,
	success: true,
	args: { pattern: "bar", path: "lib" },
};
