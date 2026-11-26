import { describe, expect, test } from "bun:test";
import { isUiNode, type UiNode } from "@oh-my-pi/pi-tui";
import { attachRenderers, installFabricNative, PATCH_MARK } from "../src/attach";
import { fabricCallArgs } from "./fixtures";

/** A stand-in for one registered tool, with just enough surface to attach onto. */
function registered(name: string): { definition: Record<string, unknown> } {
	return { definition: { name, execute: () => undefined, renderCall: () => undefined } };
}

/** A stand-in ExtensionRunner; the host's real one is patched the same way. */
class FakeRunner {
	readonly listeners: Array<(tool: { definition: Record<string, unknown> }, signal?: unknown) => unknown> = [];
	constructor(readonly tools: { definition: Record<string, unknown> }[]) {}
	getAllRegisteredTools(): { definition: Record<string, unknown> }[] {
		return this.tools;
	}
	getRegisteredTool(name: string): { definition: Record<string, unknown> } | undefined {
		return this.tools.find((tool) => tool.definition.name === name);
	}
	onToolRegistered(listener: (tool: { definition: Record<string, unknown> }, signal?: unknown) => unknown): () => void {
		this.listeners.push(listener);
		return () => undefined;
	}
	/** Fire a late registration the way the host's toolRegistrationListeners do. */
	fire(tool: { definition: Record<string, unknown> }): void {
		for (const listener of this.listeners) listener(tool);
	}
}

const native = () => true;

const hostApi = (): { ExtensionRunner: typeof FakeRunner } => ({ ExtensionRunner: FakeRunner });

/** What omp-fabric itself does to the prototype, so composition is exercised. */
function prepatchLikeFabric(seen: string[]): void {
	const original = FakeRunner.prototype.getAllRegisteredTools;
	FakeRunner.prototype.getAllRegisteredTools = function patched(): { definition: Record<string, unknown> }[] {
		const tools = original.call(this);
		seen.push("fabric");
		return tools;
	};
}

describe("installFabricNative", () => {
	test("reports why it cannot patch when the runner is unreachable", () => {
		expect(installFabricNative(undefined, native).ok).toBe(false);
		expect(installFabricNative({}, native).ok).toBe(false);
		expect(String(installFabricNative({}, native).reason)).toContain("getAllRegisteredTools");
	});

	test("attaches to fabric_exec on the next listing, composes with fabric's own patch, and stays idempotent", () => {
		const seen: string[] = [];
		prepatchLikeFabric(seen);
		const fabric = registered("fabric_exec");
		const other = registered("read");
		const runner = new FakeRunner([fabric, other]);

		expect(installFabricNative(hostApi(), native).ok).toBe(true);
		const patchedOnce = FakeRunner.prototype.getAllRegisteredTools;
		expect(Object.prototype.hasOwnProperty.call(FakeRunner.prototype, PATCH_MARK)).toBe(true);

		const listed = runner.getAllRegisteredTools();
		expect(listed).toHaveLength(2);
		expect(seen).toEqual(["fabric"]); // fabric's own wrapper still runs
		expect(other.definition.renderResult).toBeUndefined();

		const renderCall = fabric.definition.renderCall as (args: unknown, options: unknown) => UiNode[];
		const view = renderCall(fabricCallArgs, { expanded: false, isPartial: true });
		expect(isUiNode(view?.[0])).toBe(true);
		expect(view?.find((node) => node.props().key === "program")?.props().role).toBe("omp-fabric.program");
		const renderResult = fabric.definition.renderResult as (
			result: unknown,
			options: unknown,
			theme: unknown,
			args: unknown,
		) => UiNode[];
		const result = renderResult({ content: [] }, { isPartial: false }, undefined, fabricCallArgs);
		expect((result[0]?.props() as Record<string, unknown>).spans).toContainEqual({ t: "✓ Done", s: "success" });

		expect(installFabricNative(hostApi(), native).ok).toBe(true);
		expect(FakeRunner.prototype.getAllRegisteredTools).toBe(patchedOnce);
	});

	test("attaches on late registration and on name lookup", () => {
		const runner = new FakeRunner([registered("fabric_exec")]);
		expect(installFabricNative(hostApi(), native).ok).toBe(true);
		runner.onToolRegistered((tool) => {
			expect(typeof tool.definition.renderResult).toBe("function");
		});

		// A reload registers a fresh definition object under the same name.
		const reloaded = registered("fabric_exec");
		runner.tools.push(reloaded);
		runner.fire(reloaded);
		expect(typeof reloaded.definition.renderResult).toBe("function");

		// The name lookup attaches a definition the listing never returned.
		const fresh = registered("fabric_exec");
		const looked = new FakeRunner([fresh]).getRegisteredTool("fabric_exec");
		expect(looked).toBe(fresh);
		expect(typeof looked?.definition.renderResult).toBe("function");
	});

	test("keeps a mounted Fabric card native across an in-place renderer refresh", () => {
		const { definition } = registered("fabric_exec");
		let inTern = true;
		const native = () => inTern;
		attachRenderers(definition, native);
		// Like RegisteredToolAdapter, read the current method on the retained definition.
		const call = () => (definition.renderCall as (...args: unknown[]) => unknown)(fabricCallArgs, { isPartial: true });
		const result = (isPartial: boolean) => (definition.renderResult as (...args: unknown[]) => unknown)(
			{ content: [] }, { isPartial }, undefined, fabricCallArgs,
		);
		const hasProgram = (body: unknown) => Array.isArray(body) &&
			body.some(node => isUiNode(node) && node.props().key === "program");
		expect(hasProgram(call())).toBe(true);

		const callRows = { render: () => ["refreshed call"] };
		const resultRows = { render: () => ["refreshed result"] };
		Object.assign(definition, { renderCall: () => callRows, renderResult: () => resultRows });
		expect(hasProgram(result(true))).toBe(true);
		attachRenderers(definition, native); // Re-registration may follow the refresh later.
		expect(hasProgram(call())).toBe(true);
		expect(hasProgram(result(false))).toBe(true);

		inTern = false;
		expect(call()).toBe(callRows);
		expect(result(false)).toBe(resultRows);
	});

	test("delegates to the original renderers outside Tern", () => {
		const rows = { render: () => ["original"] };
		const theme = {};
		const options = { expanded: false, isPartial: false };
		const result = { content: [] };
		const tool = {
			name: "fabric_exec",
			renderCall(args: unknown, opts: unknown, colors: unknown) {
				expect(this).toBe(tool);
				expect([args, opts, colors]).toEqual([fabricCallArgs, options, theme]);
				return rows;
			},
			renderResult(value: unknown, opts: unknown, colors: unknown, args: unknown) {
				expect(this).toBe(tool);
				expect([value, opts, colors, args]).toEqual([result, options, theme, fabricCallArgs]);
				return rows;
			},
		};
		attachRenderers(tool, () => false);
		expect(tool.renderCall(fabricCallArgs, options, theme)).toBe(rows);
		expect(tool.renderResult(result, options, theme, fabricCallArgs)).toBe(rows);
	});

	test("declines a frozen definition instead of throwing", () => {
		const frozen = Object.freeze({ name: "fabric_exec" });
		expect(attachRenderers(frozen, native)).toBe(false);
		expect(attachRenderers({ name: "read" }, native)).toBe(false);
		expect(attachRenderers(undefined, native)).toBe(false);
	});
});
