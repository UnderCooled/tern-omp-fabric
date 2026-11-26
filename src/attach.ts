/**
 * Install native renderers before omp constructs a RegisteredToolAdapter. The
 * listing, registration listener and name lookup can all feed the adapter.
 * Each patch wraps the current method so it composes with omp-fabric's patch.
 */
import { describeFabricCall, describeFabricResult, type DescribeOptions, type FabricExecArgs } from "./describe.js";

export const HOOKS_MARK: symbol = Symbol.for("tern-omp-fabric.render.v1");
export const PATCH_MARK: symbol = Symbol.for("tern-omp-fabric.registry.v1");
export const REGISTRATION_MARK: symbol = Symbol.for("tern-omp-fabric.registration.v1");
export const LOOKUP_MARK: symbol = Symbol.for("tern-omp-fabric.lookup.v1");

const FABRIC_TOOL = "fabric_exec";
type LegacyRenderOptions = Pick<
	DescribeOptions,
	"expanded" | "isPartial" | "argsComplete" | "executionStarted" | "elapsedMs"
>;

const toOptions = ({
	expanded,
	isPartial,
	argsComplete,
	executionStarted,
	elapsedMs,
}: LegacyRenderOptions): DescribeOptions => ({ expanded, isPartial, argsComplete, executionStarted, elapsedMs });

type Definition = Record<string | symbol, unknown> & { name?: unknown };
type RegisteredTool = { definition?: unknown };

/** The live runner prototype, or undefined when the host does not expose it. */
const runnerPrototype = (hostApi: unknown): Record<string, unknown> | undefined =>
	(hostApi as { ExtensionRunner?: { prototype?: Record<string, unknown> } } | undefined)?.ExtensionRunner?.prototype;

/** Attach the renderers to one definition. False when it is not fabric_exec or already ours. */
export function attachRenderers(definition: unknown, native: () => boolean): boolean {
	if (typeof definition !== "object" || definition === null) return false;
	const target = definition as Definition;
	if (target.name !== FABRIC_TOOL || target[HOOKS_MARK] === true) return false;
	let call = typeof target.renderCall === "function" ? target.renderCall : undefined;
	let renderResult = typeof target.renderResult === "function" ? target.renderResult : undefined;

	function nativeCall(this: unknown, args: FabricExecArgs | undefined, options: LegacyRenderOptions, theme: unknown) {
		return native() ? describeFabricCall(args, toOptions(options)) : call?.call(this, args, options, theme);
	}

	function nativeResult(
		this: unknown,
		result: Parameters<typeof describeFabricResult>[0],
		options: LegacyRenderOptions,
		theme: unknown,
		args?: FabricExecArgs,
	) {
		return native()
			? describeFabricResult(result, toOptions(options), args)
			: renderResult?.call(this, result, options, theme, args);
	}

	try {
		// Fabric overwrites both methods in place before it re-registers the tool.
		// Already-mounted adapters read them from this same definition.
		Object.defineProperties(target, {
			renderCall: {
				configurable: true,
				enumerable: true,
				get: () => nativeCall,
				set(value: unknown) {
					if (value !== nativeCall) call = typeof value === "function" ? value : undefined;
				},
			},
			renderResult: {
				configurable: true,
				enumerable: true,
				get: () => nativeResult,
				set(value: unknown) {
					if (value !== nativeResult) renderResult = typeof value === "function" ? value : undefined;
				},
			},
			[HOOKS_MARK]: { value: true },
		});
		return true;
	} catch {
		// A frozen definition keeps fabric's own renderers: Tern looks exactly as it did.
		return false;
	}
}

/** Wrap ExtensionRunner.prototype.getAllRegisteredTools. Idempotent per process. */
export function patchToolListing(hostApi: unknown, native: () => boolean): { ok: boolean; reason?: string } {
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
				attachRenderers((tool as { definition?: unknown } | undefined)?.definition, native);
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
export function patchToolRegistration(hostApi: unknown, native: () => boolean): { ok: boolean; reason?: string } {
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
			attachRenderers(tool?.definition, native);
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
export function patchToolLookup(hostApi: unknown, native: () => boolean): { ok: boolean; reason?: string } {
	const proto = runnerPrototype(hostApi);
	if (!proto || typeof proto.getRegisteredTool !== "function") {
		return { ok: false, reason: "ExtensionRunner.getRegisteredTool is not reachable through pi.pi" };
	}
	if (Object.prototype.hasOwnProperty.call(proto, LOOKUP_MARK)) return { ok: true };
	const original = proto.getRegisteredTool as (this: unknown, ...args: unknown[]) => unknown;
	const patched = function getFabricNativeVisibleTool(this: unknown, ...args: unknown[]): unknown {
		const tool = original.apply(this, args) as RegisteredTool | undefined;
		attachRenderers(tool?.definition, native);
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

export function installFabricNative(hostApi: unknown, native: () => boolean): { ok: boolean; reason?: string } {
	const listing = patchToolListing(hostApi, native);
	if (!listing.ok) return listing;
	// The two late-registration seams are best-effort: an older host without them keeps the
	// listing patch rather than losing the hooks entirely.
	patchToolRegistration(hostApi, native);
	patchToolLookup(hostApi, native);
	return { ok: true };
}
