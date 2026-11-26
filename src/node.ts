import { UiNode, type UiKind } from "@oh-my-pi/pi-tui";

export const node = (kind: UiKind, props: Record<string, unknown>, children?: UiNode[]): UiNode =>
	new UiNode(kind, children === undefined ? props : { ...props, children }, props.propKey);
