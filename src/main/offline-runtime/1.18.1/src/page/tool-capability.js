// A host that advertises page-tool/1 can answer tool requests. The check stays
// in the core: the slash menu asks it before the tool view part loads.
export const capabilityAdvertised = (meta) => Array.isArray(meta?.extensions) && meta.extensions.includes("page-tool/1");
