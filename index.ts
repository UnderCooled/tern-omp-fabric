/**
 * tern-omp-fabric — omp side.
 *
 * Gives omp-fabric's `fabric_exec` blocks a native description in Tern: the program as an
 * expandable code block, one section per nested call, and the return value as highlighted
 * text, instead of the generic fallback card (a 160-character args summary and a raw dump).
 *
 * Nothing here changes omp's own TUI rendering: fabric keeps its `renderCall`/`renderResult`.
 * The describe hooks are read only by terminals that render natively (Tern), so attaching
 * them everywhere is inert elsewhere.
 *
 * Install: omp plugin link <repo>
 */
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { installFabricNative } from "./src/attach.js";

// omp's own test for expecting Tern (pi-tui terminal.ts `tspExpected`): a multiplexer started
// from Tern keeps TERM_PROGRAM=tern but renders rows, so the multiplexers are excluded.
const IN_TERN =
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
	].some(name => Bun.env[name]) &&
	!/^(tmux|screen)/i.test(Bun.env.TERM ?? "");

export default function ternOmpFabric(pi: ExtensionAPI): void {
	// Only the first failure warns, and only inside Tern: outside it the hooks are never read.
	let warned = false;
	const attempt = (warn: boolean, notify?: (text: string) => void): void => {
		const outcome = installFabricNative(pi.pi);
		if (outcome.ok) {
			pi.logger.debug("tern-omp-fabric: fabric_exec describe hooks installed");
			return;
		}
		pi.logger.debug(`tern-omp-fabric: fabric_exec describe hooks not installed: ${outcome.reason}`);
		if (!warn || warned || !notify) return;
		warned = true;
		notify(`tern-omp-fabric: fabric blocks stay generic here — ${outcome.reason}`);
	};

	// The extension loads before any session exists, which is early enough; the session_start
	// retry covers an omp that builds its extension runner later.
	attempt(false);
	pi.on("session_start", (_event, ctx) => {
		attempt(IN_TERN && ctx.hasUI, text => ctx.ui.notify(text, "warning"));
	});
}
