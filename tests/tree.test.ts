import { describe, expect, test } from "bun:test";
import type { NativeChild, NativeNode } from "@oh-my-pi/pi-tui";
import { grepTree, pathTree } from "../src/tree";

type Span = { t: string; s?: string };

/** The body is described nodes only; a component child would mean the view is wrong. */
function asNode(child: NativeChild): NativeNode {
	if (!("k" in child)) throw new Error("expected a described node, found a component");
	return child;
}

const props = (node: NativeNode): Record<string, unknown> => (node.p ?? {}) as Record<string, unknown>;

type TreeNode = {
	id: string;
	label: string | Span[];
	open?: boolean;
	children?: TreeNode[];
};

const treeOf = (child: NativeChild | undefined): TreeNode[] => {
	if (!child) throw new Error("expected a tree, got undefined");
	const node = asNode(child);
	expect(node.k).toBe("tree");
	return props(node).nodes as TreeNode[];
};

const spans = (node: TreeNode): Span[] => (Array.isArray(node.label) ? node.label : [{ t: node.label }]);
const textOf = (node: TreeNode): string => spans(node).map(span => span.t).join("");

describe("grepTree", () => {
	test("groups consecutive rows per file", () => {
		const text = [
			"src/a.ts:12: const a = 1;",
			"src/a.ts-13- const b = 2;",
			"src/b.ts:4: hit;",
			"src/b.ts-5- ctx;",
			"src/c.ts:9: only;",
		].join("\n");
		const nodes = treeOf(grepTree(text, "k"));
		expect(nodes).toHaveLength(3);
		expect(nodes.map(node => textOf(node))).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
		expect(nodes[0]?.children).toHaveLength(2);
		expect(nodes[1]?.children).toHaveLength(2);
		expect(nodes[2]?.children).toHaveLength(1);

		const matchRow = nodes[0]?.children?.[0];
		expect(textOf(matchRow!)).toBe("  12 │ const a = 1;");
		expect(spans(matchRow!)[0]?.s).toBe("accent");
		expect(spans(matchRow!)[1]?.s).toBe("warning");

		const contextRow = nodes[0]?.children?.[1];
		expect(textOf(contextRow!)).toBe("  13 ┆ const b = 2;");
		expect(spans(contextRow!)[0]?.s).toBe("muted");
		expect(spans(contextRow!)[1]?.s).toBe("muted");
	});

	test("returns undefined without any parsed row", () => {
		expect(grepTree("hello world\n", "k")).toBeUndefined();
	});

	test("keeps a notice line as a muted top-level node", () => {
		const nodes = treeOf(grepTree("src/a.ts:1: hit;\n[notice] trailing\n", "k"));
		const notice = nodes[nodes.length - 1];
		expect(textOf(notice!)).toBe("[notice] trailing");
		expect(spans(notice!)[0]?.s).toBe("muted");
	});
});

describe("pathTree", () => {
	test("nests paths by segment", () => {
		const text = ["src/a.ts", "src/lib/b.ts", "README.md"].join("\n");
		const nodes = treeOf(pathTree(text, "k"));
		expect(nodes).toHaveLength(2);
		const src = nodes[0]!;
		expect(textOf(src)).toBe("src/");
		expect(src.open).toBe(true);
		const srcChildren = src.children ?? [];
		expect(srcChildren.map(node => textOf(node))).toEqual(["a.ts", "lib/"]);
		const lib = srcChildren[1]!;
		expect(lib.children?.map(node => textOf(node))).toEqual(["b.ts"]);
		expect(textOf(nodes[1]!)).toBe("README.md");
	});

	test("returns undefined for flat paths", () => {
		expect(pathTree("a.ts\nb.ts\n", "k")).toBeUndefined();
	});
});
