export const LOCAL_PREFIX = "/_/clayjs/";

const CONTROL = /[\u0000-\u001F\u007F]/;
const ASCII_EDGE_SPACE = /^[\t\n\f\r ]|[\t\n\f\r ]$/;
const ROLLING = /^https:\/\/clayjs\.com\/v(\d+)\/([\s\S]*)$/;
const EXACT = /^https:\/\/clayjs\.com\/(\d+)\.(\d+)\.(\d+)\/([\s\S]*)$/;
const LOCAL = /^\/_\/clayjs\/(\d+)\.(\d+)\.(\d+)\/([\s\S]*)$/;
const SUSPECT = /%2e|%2f|%5c/i;

function majorOf(version) {
  if (typeof version !== "string") return null;
  const match = /^(\d+)\.\d+\.\d+$/.exec(version);
  return match ? match[1] : null;
}

function originOf(documentURL) {
  if (typeof documentURL !== "string" || documentURL === "") return null;
  try {
    return new URL(documentURL).origin;
  } catch {
    return null;
  }
}

function splitURL(raw) {
  const hashAt = raw.indexOf("#");
  const hash = hashAt < 0 ? "" : raw.slice(hashAt);
  const withoutHash = hashAt < 0 ? raw : raw.slice(0, hashAt);
  const searchAt = withoutHash.indexOf("?");
  const search = searchAt < 0 ? "" : withoutHash.slice(searchAt);
  const head = searchAt < 0 ? withoutHash : withoutHash.slice(0, searchAt);
  return { head, search, hash };
}

function decodePath(rawPath) {
  if (rawPath === "") return null;
  if (rawPath.includes("\\")) return null;
  if (SUSPECT.test(rawPath)) return null;
  const segments = rawPath.split("/");
  const decoded = [];
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..") return null;
    let value;
    try {
      value = decodeURIComponent(segment);
    } catch {
      return null;
    }
    if (value.includes("/") || value.includes("\\")) return null;
    if (value === "." || value === "..") return null;
    decoded.push(value);
  }
  return decoded.join("/");
}

export function parseRuntimeURL(raw, { documentURL } = {}) {
  if (typeof raw !== "string") return null;
  if (raw === "") return null;
  if (ASCII_EDGE_SPACE.test(raw) || CONTROL.test(raw)) return null;
  const { head, search, hash } = splitURL(raw);

  let kind = null;
  let version = null;
  let major = null;
  let rawPath = null;

  let match = ROLLING.exec(head);
  if (match) {
    kind = "rolling";
    major = match[1];
    rawPath = match[2];
  }
  if (!kind) {
    match = EXACT.exec(head);
    if (match) {
      kind = "exact";
      version = `${match[1]}.${match[2]}.${match[3]}`;
      major = match[1];
      rawPath = match[4];
    }
  }
  if (!kind) {
    match = LOCAL.exec(head);
    if (match) {
      kind = "local";
      version = `${match[1]}.${match[2]}.${match[3]}`;
      major = match[1];
      rawPath = match[4];
    }
  }
  if (!kind) {
    const origin = originOf(documentURL);
    if (origin && head.startsWith(`${origin}/`)) {
      match = LOCAL.exec(head.slice(origin.length));
      if (match) {
        kind = "local";
        version = `${match[1]}.${match[2]}.${match[3]}`;
        major = match[1];
        rawPath = match[4];
      }
    }
  }
  if (!kind) return null;

  const path = decodePath(rawPath);
  if (path === null) return null;

  return { kind, major, version, rawPath, path, search, hash };
}

function filesOf(releases, version) {
  const release = releases && typeof releases === "object" ? releases[version] : null;
  return release && typeof release.files === "object" && release.files ? release.files : null;
}

export function resolveRuntimeURL(raw, { releases, selectedVersion, documentURL } = {}) {
  const selected = filesOf(releases, selectedVersion);
  if (selected) {
    const aliases = releases[selectedVersion].aliases;
    if (aliases && typeof aliases === "object" && Object.hasOwn(aliases, raw)) {
      const target = aliases[raw];
      return {
        kind: "alias",
        version: selectedVersion,
        path: target,
        search: "",
        hash: "",
        available: true,
        canonicalURL: raw,
        localURL: `${LOCAL_PREFIX}${selectedVersion}/${target}`,
      };
    }
  }

  const parsed = parseRuntimeURL(raw, { documentURL });
  if (!parsed) return null;
  if (parsed.kind === "local") return null;

  let version;
  if (parsed.kind === "rolling") {
    if (majorOf(selectedVersion) === null || majorOf(selectedVersion) !== parsed.major) return null;
    version = selectedVersion;
  } else {
    version = parsed.version;
    if (!filesOf(releases, version)) {
      return {
        kind: "exact",
        version,
        path: parsed.path,
        search: parsed.search,
        hash: parsed.hash,
        available: false,
        canonicalURL: raw,
        localURL: null,
      };
    }
  }

  const files = filesOf(releases, version);
  if (!files || !Object.hasOwn(files, parsed.path)) return null;

  return {
    kind: parsed.kind,
    version,
    path: parsed.path,
    search: parsed.search,
    hash: parsed.hash,
    available: true,
    canonicalURL: raw,
    localURL: `${LOCAL_PREFIX}${version}/${parsed.rawPath}${parsed.search}${parsed.hash}`,
  };
}

function entriesOf(descriptor) {
  if (!descriptor || typeof descriptor !== "object") return [];
  if (!Array.isArray(descriptor.entries)) return [];
  return descriptor.entries.filter((entry) => entry && typeof entry === "object");
}

function originalMatchesRelease(original, version, releases) {
  if (!releases) return true;
  const files = filesOf(releases, version);
  return Boolean(files && Object.hasOwn(files, original.path));
}

export function canonicalizeRuntimeURL(value, { descriptor, releases, documentURL, aliases } = {}) {
  const local = parseRuntimeURL(value, { documentURL });
  if (!local || local.kind !== "local") return value;

  const entries = entriesOf(descriptor);
  const localMajor = majorOf(local.version);

  for (const entry of entries) {
    if (entry.local !== value || typeof entry.original !== "string") continue;
    const trusted = releases?.[local.version]?.aliases ?? aliases;
    if (trusted && typeof trusted === "object" && !local.search && !local.hash &&
        Object.hasOwn(trusted, entry.original) && trusted[entry.original] === local.path) {
      return entry.original;
    }
    const original = parseRuntimeURL(entry.original);
    if (!original) continue;
    if (original.kind !== "rolling" && original.kind !== "exact") continue;
    if (original.rawPath !== local.rawPath) continue;
    if (original.search !== local.search) continue;
    if (original.hash !== local.hash) continue;
    if (original.kind === "rolling" ? original.major !== localMajor : original.version !== local.version) continue;
    if (!originalMatchesRelease(local, local.version, releases)) continue;
    if (original.kind === "exact") return entry.original;
    return `https://clayjs.com/v${original.major}/${local.rawPath}${local.search}${local.hash}`;
  }

  for (const entry of entries) {
    if (typeof entry.original !== "string") continue;
    const original = parseRuntimeURL(entry.original);
    if (!original) continue;
    if (original.kind !== "rolling" && original.kind !== "exact") continue;
    if (original.rawPath !== local.rawPath) continue;
    if (original.kind === "rolling" ? original.major !== localMajor : original.version !== local.version) continue;
    if (original.kind === "rolling") {
      return `https://clayjs.com/v${original.major}/${local.rawPath}${local.search}${local.hash}`;
    }
    return `https://clayjs.com/${original.version}/${local.rawPath}${local.search}${local.hash}`;
  }

  return `https://clayjs.com/${local.version}/${local.rawPath}${local.search}${local.hash}`;
}
