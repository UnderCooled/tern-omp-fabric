/** Native Fabric tool bodies for omp running directly in Tern. */
import { installFabricNative } from "./src/attach.js";

/**
 * The slice of omp's extension host this extension uses, typed from omp's own docs and observed in
 * omp 19.2.1. Declared here rather than imported so the repo carries no dependency on
 * `@oh-my-pi/pi-coding-agent`.
 */
interface ExtensionHost {
	/** omp's host API, probed for `ExtensionRunner` by `installFabricNative`. */
	pi: unknown;
	logger: { debug(message: string): void };
	on(event: "session_start", handler: (event: unknown, ctx: SessionStartContext) => void): void;
}

interface SessionStartContext {
	hasUI: boolean;
	ui: { notify(text: string, level: "warning" | "info" | "error"): void };
}

// omp's own test for expecting Tern (pi-tui terminal.ts `tspExpected`): a multiplexer started
// from Tern keeps TERM_PROGRAM=tern but renders rows, so the multiplexers are excluded.
const inTern = (): boolean =>
	Bun.env.TERM_PROGRAM?.toLowerCase() === "tern" &&
	Bun.env.HERDR_ENV !== "1" &&
	Bun.env.WMUX !== "1" &&
	![
		"HERDR_PANE_ID",
		"HERDR_TAB_ID",
		"HERDR_WORKSPACE_ID",
		"TMUX",
		"STY",
		"ZELLIJ",
		"CMUX_WORKSPACE_ID",
		"CMUX_SURFACE_ID",
		"CMUX_REMOTE_TRANSPORT",
		"WMUX_SURFACE_ID",
	].some((name) => Bun.env[name]) &&
	!/^(tmux|screen)/i.test(Bun.env.TERM ?? "");

export default function ternOmpFabric(pi: ExtensionHost): void {
	if (!inTern()) return;
	// Only the first installation failure warns.
	let warned = false;
	const attempt = (warn: boolean, notify?: (text: string) => void): void => {
		const outcome = installFabricNative(pi.pi, inTern);
		if (outcome.ok) {
			pi.logger.debug("tern-omp-fabric: fabric_exec native renderers installed");
			return;
		}
		pi.logger.debug(`tern-omp-fabric: fabric_exec native renderers not installed: ${outcome.reason}`);
		if (!warn || warned || !notify) return;
		warned = true;
		notify(`tern-omp-fabric: fabric blocks stay generic here — ${outcome.reason}`);
	};

	// The extension loads before any session exists, which is early enough; the session_start
	// retry covers an omp that builds its extension runner later.
	attempt(false);
	pi.on("session_start", (_event, ctx) => {
		attempt(ctx.hasUI, (text) => ctx.ui.notify(text, "warning"));
	});
}
