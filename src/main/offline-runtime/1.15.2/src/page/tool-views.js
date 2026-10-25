// The tool host a tool's plugin can reach, filled by the tool view part when it
// loads, per editor. A document whose editor has no host yet notifies nothing.
export const toolViews = new WeakMap();
