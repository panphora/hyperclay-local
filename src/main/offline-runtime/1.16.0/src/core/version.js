export function parseVersion(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/^v/, "");
  return /^\d+(\.\d+)*$/.test(trimmed) ? trimmed.split(".").map(Number) : null;
}

export function isNewerVersion(candidate, current) {
  const next = parseVersion(candidate);
  const now = parseVersion(current);
  if (!next || !now) return false;
  const length = Math.max(next.length, now.length);
  for (let index = 0; index < length; index++) {
    const candidatePart = next[index] || 0;
    const currentPart = now[index] || 0;
    if (candidatePart !== currentPart) return candidatePart > currentPart;
  }
  return false;
}
