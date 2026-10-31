export const isMac = () =>
  /mac|iphone|ipad|ipod/i.test((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || navigator.userAgent || "");

const isWindows = () =>
  /Win/.test((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || navigator.userAgent || "");

export const revealLabel = () => (isMac() ? "Show in Finder" : isWindows() ? "Show in Explorer" : "Show in folder");

export const keys = (mac, other) => (isMac() ? mac : other);
