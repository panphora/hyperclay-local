// The CMS's "Edit content" toggle in Bevel's button face. HyperCMS pins the toggle's fill
// to an opaque neutral (#0a0a0a or #fafafa) and exposes --hcms-toggle-bg and
// --hcms-toggle-color for authors; on a dark page Bevel's dark bottom-right edge vanished
// into the near-black fill and the button read as pressed in. Hand-written, not
// generated: the generated CMS skin may only pin the vendor's --mirk-* tokens.
import { TOKENS } from "../bevel.js";

export const ROOTS = ["[data-hcms-toggle-host]"];

export const CSS = `@layer clay-skin{
[data-hcms-toggle-host]{--hcms-toggle-bg:${TOKENS.face} !important;--hcms-toggle-color:${TOKENS.ink} !important}
[data-hcms-toggle-host] :is(.hcms-toggle__main, .hcms-toggle__arrow){border-color:${TOKENS["edge-hi"]} ${TOKENS["edge-lo"]} ${TOKENS["edge-lo"]} ${TOKENS["edge-hi"]} !important}
[data-hcms-toggle-host] :is(.hcms-toggle__main, .hcms-toggle__arrow):hover:not(:active){--hcms-toggle-bg:color-mix(in srgb, ${TOKENS.face}, ${TOKENS["edge-hi"]} 45%) !important}
[data-hcms-toggle-host] :is(.hcms-toggle__main, .hcms-toggle__arrow):active{border-color:${TOKENS["edge-lo"]} ${TOKENS["edge-hi"]} ${TOKENS["edge-hi"]} ${TOKENS["edge-lo"]} !important}
}`;
