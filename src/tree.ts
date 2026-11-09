/**
 * Grep and path output -> Tern TSP trees.
 *
 * Pure by design: no I/O, no run-time imports beyond the erased type import.
 */
import type { NativeChild } from "@oh-my-pi/pi-tui";

/** A styled run; structurally TspSpan, declared here so no pi-wire import is needed. */
type Span = { t: string; s?: string; href?: string };

/** Where a path row opens when it is clicked: a `file://` URL, or nothing. */
type PathLink = (path: string) => string | undefined;

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

/** A find/ls directory header: `# root/`, `## sub/`, one hash per depth. */
const HEADER_RE = /^(#+)\s+(.+)$/;

/**
 * Find output lists files under the directory headers that own them (`# root/`,
 * `## sub/`, then names relative to the nearest header). Convert each line to a
 * full path so the tree builder nests files inside their directories.
 */
function expandFindLines(lines: string[]): string[] {
	const expanded: string[] = [];
	const stack: string[] = []; // stack[i] = full path of the header with i+1 hashes
	for (const line of lines) {
		if (line.startsWith("[")) {
			expanded.push(line);
			continue;
		}
		const header = HEADER_RE.exec(line);
		if (header) {
			const depth = header[1]!.length;
			const dir = header[2]!.endsWith("/") ? header[2]! : header[2]! + "/";
			const full = depth === 1 ? dir : (stack[depth - 2] ?? "") + dir;
			stack.length = depth - 1;
			stack[depth - 1] = full;
			expanded.push(full);
			continue;
		}
		const parent = stack[stack.length - 1];
		expanded.push(parent === undefined ? line : parent + line);
	}
	return expanded;
}

const muted = (text: string): readonly Span[] => [{ t: text, s: "muted" }];

/** Control characters a terminal would act on, made inert. */
const escapeControlChars = (text: string): string =>
	text
		.replace(/\x1b/g, "␛")
		.replace(/\r/g, "␍")
		.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, "�");

/** Grep output -> one tree node per consecutive run of rows from one file. */
export function grepTree(text: string, key: string, link?: PathLink): NativeChild | undefined {
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
			const href = link?.(path);
			currentGroup = {
				id: key + ":f" + groupIndex,
				label: [
					href === undefined
						? { t: escapeControlChars(path), s: "accent" }
						: { t: escapeControlChars(path), s: "accent", href },
				],
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
export function pathTree(text: string, key: string, link?: PathLink): NativeChild | undefined {
	const lines = text.split("\n").filter(line => line.length > 0);
	if (lines.length === 0) return undefined;

	const expanded = expandFindLines(lines);
	const shown = expanded.slice(0, PATH_CAP);
	const dropped = expanded.length - shown.length;
	const roots: TreeNode[] = [];
	const byPath = new Map<string, TreeNode>();

	for (const line of shown) {
		if (line.startsWith("[")) {
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
				const href = wantsDirectory ? undefined : link?.(segment);
				node = wantsDirectory
					? { id: key + ":" + segment, label: [{ t: escapeControlChars(part) + "/", s: "accent" }], open: true }
					: {
							id: key + ":" + segment,
							label: href === undefined ? escapeControlChars(part) : [{ t: escapeControlChars(part), href }],
						};
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
