import { describe, expect, test } from "bun:test";
import { attachDescribeHooks, installFabricNative, PATCH_MARK } from "../src/attach";
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
		return this.tools.find(tool => tool.definition.name === name);
	}
	onToolRegistered(
		listener: (tool: { definition: Record<string, unknown> }, signal?: unknown) => unknown,
	): () => void {
		this.listeners.push(listener);
		return () => undefined;
	}
	/** Fire a late registration the way the host's toolRegistrationListeners do. */
	fire(tool: { definition: Record<string, unknown> }): void {
		for (const listener of this.listeners) listener(tool);
	}
}

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
		expect(installFabricNative(undefined).ok).toBe(false);
		expect(installFabricNative({}).ok).toBe(false);
		expect(String(installFabricNative({}).reason)).toContain("getAllRegisteredTools");
	});

	test("attaches to fabric_exec on the next listing, composes with fabric's own patch, and stays idempotent", () => {
		const seen: string[] = [];
		prepatchLikeFabric(seen);
		const fabric = registered("fabric_exec");
		const other = registered("read");
		const runner = new FakeRunner([fabric, other]);

		expect(installFabricNative(hostApi()).ok).toBe(true);
		const patchedOnce = FakeRunner.prototype.getAllRegisteredTools;
		expect(Object.prototype.hasOwnProperty.call(FakeRunner.prototype, PATCH_MARK)).toBe(true);

		const listed = runner.getAllRegisteredTools();
		expect(listed).toHaveLength(2);
		expect(seen).toEqual(["fabric"]); // fabric's own wrapper still runs
		expect(typeof fabric.definition.describeCall).toBe("function");
		expect(typeof fabric.definition.describeResult).toBe("function");
		expect(other.definition.describeCall).toBeUndefined();

		// The call view really is ours, not a placeholder.
		const describeCall = fabric.definition.describeCall as (
			args: unknown,
			options: unknown,
		) => { tool?: { title?: string }; body?: unknown[] } | undefined;
		const view = describeCall(fabricCallArgs, { expanded: false });
		expect(view?.tool?.title).toBe("Fabric");
		expect(view?.body?.length).toBeGreaterThan(0);

		expect(installFabricNative(hostApi()).ok).toBe(true);
		expect(FakeRunner.prototype.getAllRegisteredTools).toBe(patchedOnce);
	});

	test("attaches on late registration and on name lookup", () => {
		const runner = new FakeRunner([registered("fabric_exec")]);
		expect(installFabricNative(hostApi()).ok).toBe(true);
		runner.onToolRegistered(() => undefined);

		// A reload registers a fresh definition object under the same name.
		const reloaded = registered("fabric_exec");
		runner.tools.push(reloaded);
		runner.fire(reloaded);
		expect(typeof reloaded.definition.describeCall).toBe("function");

		// The name lookup attaches a definition the listing never returned.
		const fresh = registered("fabric_exec");
		const looked = new FakeRunner([fresh]).getRegisteredTool("fabric_exec");
		expect(looked).toBe(fresh);
		expect(typeof looked?.definition.describeCall).toBe("function");
	});

	test("declines a frozen definition instead of throwing", () => {
		const frozen = Object.freeze({ name: "fabric_exec" });
		expect(attachDescribeHooks(frozen)).toBe(false);
		expect(attachDescribeHooks({ name: "read" })).toBe(false);
		expect(attachDescribeHooks(undefined)).toBe(false);
	});
});
