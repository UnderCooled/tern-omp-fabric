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
 * Three host seams can hand a tool definition to the adapter builder, so all three are
 * wrapped: the listing (omp-fabric's own seam, capture/interceptor.ts), the late-registration
 * listener (deferred extensions and a reloaded extension host), and the name lookup the host
 * uses when it reactivates a tool. Each wrapper attaches the hooks to every definition named
 * fabric_exec and returns its value untouched; each wraps the current function so patches
 * compose whichever loads first.
 */
import { describeFabricCall, describeFabricResult } from "./describe.js";

export const HOOKS_MARK: symbol = Symbol.for("tern-omp-fabric.describe.v1");
export const PATCH_MARK: symbol = Symbol.for("tern-omp-fabric.registry.v1");
export const REGISTRATION_MARK: symbol = Symbol.for("tern-omp-fabric.registration.v1");
export const LOOKUP_MARK: symbol = Symbol.for("tern-omp-fabric.lookup.v1");

const FABRIC_TOOL = "fabric_exec";

type Definition = Record<string | symbol, unknown> & { name?: unknown };
type RegisteredTool = { definition?: unknown };

/** The live runner prototype, or undefined when the host does not expose it. */
const runnerPrototype = (hostApi: unknown): Record<string, unknown> | undefined =>
	(hostApi as { ExtensionRunner?: { prototype?: Record<string, unknown> } } | undefined)?.ExtensionRunner
		?.prototype;

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
	const proto = runnerPrototype(hostApi);
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

/**
 * Wrap ExtensionRunner.prototype.onToolRegistered. The host builds a RegisteredToolAdapter for
 * every late registration (a deferred extension, or an extension host that reloads) from the
 * tool object this listener receives, and that path never crosses the listing wrapper above.
 * Attaching here covers it; the wrapper keeps the current function so patches compose.
 */
export function patchToolRegistration(hostApi: unknown): { ok: boolean; reason?: string } {
	const proto = runnerPrototype(hostApi);
	if (!proto || typeof proto.onToolRegistered !== "function") {
		return { ok: false, reason: "ExtensionRunner.onToolRegistered is not reachable through pi.pi" };
	}
	if (Object.prototype.hasOwnProperty.call(proto, REGISTRATION_MARK)) return { ok: true };
	const original = proto.onToolRegistered as (
		this: unknown,
		listener: (tool: RegisteredTool, signal?: unknown) => unknown,
	) => unknown;
	const patched = function getFabricNativeVisibleRegistrations(
		this: unknown,
		listener: (tool: RegisteredTool, signal?: unknown) => unknown,
	): unknown {
		const wrapped = (tool: RegisteredTool, signal?: unknown): unknown => {
			attachDescribeHooks(tool?.definition);
			return listener(tool, signal);
		};
		return original.call(this, wrapped);
	};
	try {
		proto.onToolRegistered = patched;
		Object.defineProperty(proto, REGISTRATION_MARK, { value: true, configurable: true });
	} catch (error) {
		return { ok: false, reason: error instanceof Error ? error.message : "could not replace onToolRegistered" };
	}
	return { ok: true };
}

/** Wrap ExtensionRunner.prototype.getRegisteredTool. Idempotent per process. */
export function patchToolLookup(hostApi: unknown): { ok: boolean; reason?: string } {
	const proto = runnerPrototype(hostApi);
	if (!proto || typeof proto.getRegisteredTool !== "function") {
		return { ok: false, reason: "ExtensionRunner.getRegisteredTool is not reachable through pi.pi" };
	}
	if (Object.prototype.hasOwnProperty.call(proto, LOOKUP_MARK)) return { ok: true };
	const original = proto.getRegisteredTool as (this: unknown, ...args: unknown[]) => unknown;
	const patched = function getFabricNativeVisibleTool(this: unknown, ...args: unknown[]): unknown {
		const tool = original.apply(this, args) as RegisteredTool | undefined;
		attachDescribeHooks(tool?.definition);
		return tool;
	};
	try {
		proto.getRegisteredTool = patched;
		Object.defineProperty(proto, LOOKUP_MARK, { value: true, configurable: true });
	} catch (error) {
		return { ok: false, reason: error instanceof Error ? error.message : "could not replace getRegisteredTool" };
	}
	return { ok: true };
}

export function installFabricNative(hostApi: unknown): { ok: boolean; reason?: string } {
	const listing = patchToolListing(hostApi);
	if (!listing.ok) return listing;
	// The two late-registration seams are best-effort: an older host without them keeps the
	// listing patch rather than losing the hooks entirely.
	patchToolRegistration(hostApi);
	patchToolLookup(hostApi);
	return { ok: true };
}
