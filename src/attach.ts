/**
 * Wire `describeCall`/`describeResult` onto fabric's registered `fabric_exec` tool.
 *
 * Tern draws a tool call from the tool's own describe hooks first, then from the name-keyed
 * built-in renderer registry, then from the generic fallback card. `fabric_exec` is an
 * extension tool with ANSI renderers only, so Tern shows a truncated one-line args summary
 * and a raw output dump. The hooks must be on the definition before the host builds its
 * RegisteredToolAdapter: the adapter copies keys through getters taken at construction, so a
 * hook added later is invisible.
 *
 * The listing wrapper is the same public seam omp-fabric itself uses
 * (omp-fabric/src/capture/interceptor.ts): wrap whatever
 * ExtensionRunner.prototype.getAllRegisteredTools is at install time, attach the hooks to
 * every definition named fabric_exec, and return the list untouched. Wrapping the current
 * function keeps both patches composing whichever loads first.
 */
import { describeFabricCall, describeFabricResult } from "./describe.js";

export const HOOKS_MARK: symbol = Symbol.for("tern-omp-fabric.describe.v1");
export const PATCH_MARK: symbol = Symbol.for("tern-omp-fabric.registry.v1");

const FABRIC_TOOL = "fabric_exec";

type Definition = Record<string | symbol, unknown> & { name?: unknown };

/** Attach the hooks to one definition. False when it is not fabric_exec or already ours. */
export function attachDescribeHooks(definition: unknown): boolean {
	if (typeof definition !== "object" || definition === null) return false;
	const target = definition as Definition;
	if (target.name !== FABRIC_TOOL || target[HOOKS_MARK] === true) return false;
	try {
		target.describeCall = describeFabricCall;
		target.describeResult = describeFabricResult;
		target[HOOKS_MARK] = true;
		return true;
	} catch {
		// A frozen definition keeps fabric's own renderers: Tern looks exactly as it did.
		return false;
	}
}

/** Wrap ExtensionRunner.prototype.getAllRegisteredTools. Idempotent per process. */
export function patchToolListing(hostApi: unknown): { ok: boolean; reason?: string } {
	const runner = (hostApi as { ExtensionRunner?: { prototype?: Record<string, unknown> } } | undefined)
		?.ExtensionRunner;
	const proto = runner?.prototype;
	if (!proto || typeof proto.getAllRegisteredTools !== "function") {
		return { ok: false, reason: "ExtensionRunner.getAllRegisteredTools is not reachable through pi.pi" };
	}
	if (Object.prototype.hasOwnProperty.call(proto, PATCH_MARK)) return { ok: true };
	const original = proto.getAllRegisteredTools as (this: unknown, ...args: unknown[]) => unknown;
	const patched = function getFabricNativeVisibleTools(this: unknown, ...args: unknown[]): unknown {
		const tools = original.apply(this, args);
		if (Array.isArray(tools)) {
			for (const tool of tools) {
				attachDescribeHooks((tool as { definition?: unknown } | undefined)?.definition);
			}
		}
		return tools;
	};
	try {
		proto.getAllRegisteredTools = patched;
		Object.defineProperty(proto, PATCH_MARK, { value: true, configurable: true });
	} catch (error) {
		return { ok: false, reason: error instanceof Error ? error.message : "could not replace getAllRegisteredTools" };
	}
	return { ok: true };
}

export function installFabricNative(hostApi: unknown): { ok: boolean; reason?: string } {
	return patchToolListing(hostApi);
}
