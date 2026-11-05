/**
 * Grep and path output -> Tern TSP trees.
 *
 * Pure by design: no I/O, no run-time imports beyond the erased type import.
 */
import type { NativeChild } from "@oh-my-pi/pi-tui";

/** A styled run; structurally TspSpan, declared here so no pi-wire import is needed. */
type Span = { t: string; s?: string };

/** A tree entry; structurally TspTreeNode. */
type TreeNode = {
	id: string;
	label: string | readonly Span[];
	open?: boolean;
	children?: TreeNode[];
};

const MATCH_ROW = /^(.+):(\d+):\s(.*)$/;
const CONTEXT_ROW = /^(.+)-(\d+)-\s(.*)$/;

/** Rows kept before the rest are dropped. */
const ROW_CAP = 200;
/** Paths kept before the rest are dropped. */
const PATH_CAP = 200;

const muted = (text: string): readonly Span[] => [{ t: text, s: "muted" }];

/** Control characters a terminal would act on, made inert. */
const escapeControlChars = (text: string): string =>
	text
		.replace(/\x1b/g, "␛")
		.replace(/\r/g, "␍")
		.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, "�");

/** Grep output -> one tree node per consecutive run of rows from one file. */
export function grepTree(text: string, key: string): NativeChild | undefined {
	const lines = text.split("\n");
	const nodes: TreeNode[] = [];
	let groupIndex = -1;
	let currentPath: string | undefined;
	let currentGroup: TreeNode | undefined;
	let rowIndex = 0;
	let parsedRows = 0;
	let dropped = 0;

	for (const line of lines) {
		const match = MATCH_ROW.exec(line);
		const parsed = match ?? CONTEXT_ROW.exec(line);
		if (!parsed) {
			if (line.length === 0) continue;
			nodes.push({ id: key + ":n" + nodes.length, label: muted(escapeControlChars(line)) });
			currentPath = undefined;
			currentGroup = undefined;
			continue;
		}
		parsedRows++;
		if (parsedRows > ROW_CAP) {
			dropped++;
			continue;
		}
		const path = parsed[1] ?? "";
		const lineNumber = parsed[2] ?? "";
		const code = parsed[3] ?? "";
		const isMatch = match !== null;
		if (path !== currentPath) {
			groupIndex++;
			currentPath = path;
			rowIndex = 0;
			currentGroup = {
				id: key + ":f" + groupIndex,
				label: [{ t: escapeControlChars(path), s: "accent" }],
				open: true,
				children: [],
			};
			nodes.push(currentGroup);
		}
		currentGroup?.children?.push({
			id: key + ":f" + groupIndex + ":" + rowIndex,
			label: [
				{ t: lineNumber.padStart(4, " "), s: isMatch ? "accent" : "muted" },
				{ t: isMatch ? " │ " : " ┆ ", s: isMatch ? "warning" : "muted" },
				{ t: escapeControlChars(code) },
			],
		});
		rowIndex++;
	}

	if (parsedRows === 0) return undefined;
	if (dropped > 0) {
		nodes.push({ id: key + ":more", label: muted("… " + dropped + " more matches") });
	}
	return { k: "tree", key, p: { nodes, role: "omp-fabric.grep" } };
}

/** Find/ls output -> a tree nested by path segments. */
export function pathTree(text: string, key: string): NativeChild | undefined {
	const lines = text.split("\n").filter(line => line.length > 0);
	if (!lines.some(line => line.includes("/"))) return undefined;

	const shown = lines.slice(0, PATH_CAP);
	const dropped = lines.length - shown.length;
	const roots: TreeNode[] = [];
	const byPath = new Map<string, TreeNode>();

	for (const line of shown) {
		if (line.startsWith("[") && line.endsWith("]")) {
			roots.push({ id: key + ":n" + roots.length, label: muted(escapeControlChars(line)) });
			continue;
		}
		const clean = line.startsWith("./") ? line.slice(2) : line;
		const directory = clean.endsWith("/");
		const parts = clean.split("/").filter(Boolean);
		let siblings = roots;
		let prefix = "";
		for (let index = 0; index < parts.length; index++) {
			const part = parts[index] ?? "";
			const leaf = index === parts.length - 1;
			const segment = prefix ? prefix + "/" + part : part;
			const wantsDirectory = !leaf || directory;
			let node = byPath.get(segment);
			if (!node) {
				node = wantsDirectory
					? { id: key + ":" + segment, label: [{ t: escapeControlChars(part) + "/", s: "accent" }], open: true }
					: { id: key + ":" + segment, label: escapeControlChars(part) };
				byPath.set(segment, node);
				siblings.push(node);
			} else if (wantsDirectory && typeof node.label === "string") {
				node.label = [{ t: escapeControlChars(part) + "/", s: "accent" }];
				node.open = true;
			}
			if (!leaf) {
				if (!node.children) node.children = [];
				siblings = node.children;
			}
			prefix = segment;
		}
	}

	if (dropped > 0) {
		roots.push({ id: key + ":more", label: muted("… " + dropped + " more paths") });
	}
	return { k: "tree", key, p: { nodes: roots, role: "omp-fabric.paths" } };
}
