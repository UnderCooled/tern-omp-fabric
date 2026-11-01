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
	display: { name: "Sweep TODOs", description: "Greps src for TODO markers and reports files." },
};

/** Rich details: two successful audits, one failing, two phases, YAML output. */
export const fabricDetails: FabricDetails = {
	success: true,
	outputFormat: "yaml",
	outputFormatStartLine: 3,
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

/** A trace-only audit: the result did not survive the reload. */
export const fromTraceAudit: FabricAudit = {
	ref: "omp.grep",
	tool: "grep",
	provider: "omp",
	fromTrace: true,
	success: true,
	args: { pattern: "bar", path: "lib" },
};
