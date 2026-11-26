--!strict
-- Tern side of tern-omp-fabric: expands the focused omp pane's tool output by typing omp's own
-- shortcut, Ctrl+O (byte 0x0F).
--
-- In omp, \15 is bound to app.tools.expand: it expands the outer tool card without opening
-- the Fabric folds. This plugin gives that action a palette row.

local function ompPane(cx: WindowCx): number?
	local pane = cx.session:focused()
	if not pane then
		return nil
	end
	-- A running omp is an agent pane whose surface omp titled "omp". The program is no help (in WSL it is the WSL
	-- launcher), `at_prompt` is true at omp's own prompt, and the surface outlives omp, whose pane then turns back
	-- into a terminal.
	local info = cx.session:pane(pane)
	local tree = cx.session:surface(pane, { nodes = 1, depth = 1 })
	if not info or info.kind ~= "agent" or typeof(tree) ~= "table" or tree.surface.title ~= "omp" then
		return nil
	end
	return pane
end

tern.command({
	id = "expand_tools",
	title = "omp fabric: expand tool output",
	icon = "terminal",
	group = "omp",
	run = function(cx: WindowCx)
		local pane = ompPane(cx)
		if not pane then
			return
		end
		cx:run(pane, "\15")
	end,
})
