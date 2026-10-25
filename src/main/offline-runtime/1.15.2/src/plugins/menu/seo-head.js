const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const ROBOTS_OWNED = ["noindex", "nofollow"];
const PREVIEW_KEYS = ["ogTitle", "ogDescription", "ogImage", "ogImageAlt", "siteName"];

const text = (value) => (value == null ? "" : String(value));
const filled = (value) => text(value).trim() !== "";

const headOf = (doc) => doc.head || doc.querySelector("head");

const metas = (doc, attribute, name) =>
  Array.from(headOf(doc).querySelectorAll("meta")).filter(
    (meta) => text(meta.getAttribute(attribute)).trim().toLowerCase() === name,
  );

const links = (doc, rel) =>
  Array.from(headOf(doc).querySelectorAll("link")).filter((link) =>
    text(link.getAttribute("rel")).trim().toLowerCase().split(/\s+/).includes(rel),
  );

const titles = (doc) => Array.from(headOf(doc).querySelectorAll("title"));
const robotsMetas = (doc) => metas(doc, "name", "robots");

const drop = (element) => element.remove();

function createMeta(doc, attribute, name) {
  const meta = doc.createElement("meta");
  meta.setAttribute(attribute, name);
  headOf(doc).appendChild(meta);
  return meta;
}

function createLink(doc, rel) {
  const link = doc.createElement("link");
  link.setAttribute("rel", rel);
  headOf(doc).appendChild(link);
  return link;
}

function setMetaContent(doc, attribute, name, value) {
  const el = metas(doc, attribute, name)[0] || createMeta(doc, attribute, name);
  el.setAttribute("content", value);
}

function metaField(attribute, name, { trim = false } = {}) {
  const find = (doc) => metas(doc, attribute, name);
  return {
    find,
    read(doc) {
      const el = find(doc)[0];
      return el ? text(el.getAttribute("content")) : "";
    },
    write(doc, value) {
      const els = find(doc);
      const raw = text(value);
      if (!filled(raw)) {
        els.forEach(drop);
        return;
      }
      const el = els[0] || createMeta(doc, attribute, name);
      el.setAttribute("content", trim ? raw.trim() : raw);
      els.slice(1).forEach(drop);
    },
  };
}

const robotsTokens = (element) =>
  text(element.getAttribute("content"))
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);

function writeRobots(doc, wanted) {
  const els = robotsMetas(doc);
  const kept = (els[0] ? robotsTokens(els[0]) : []).filter(
    (token) => !ROBOTS_OWNED.includes(token.toLowerCase()),
  );
  const owned = [];
  if (wanted.index === false) owned.push("noindex");
  if (wanted.follow === false) owned.push("nofollow");
  const tokens = owned.concat(kept);
  if (!tokens.length) {
    els.forEach(drop);
    return;
  }
  const el = els[0] || createMeta(doc, "name", "robots");
  el.setAttribute("content", tokens.join(", "));
  els.slice(1).forEach(drop);
}

function robotsField(directive) {
  const own = directive === "noindex" ? "index" : "follow";
  const sibling = own === "index" ? "follow" : "index";
  return {
    find: robotsMetas,
    read(doc) {
      const el = robotsMetas(doc)[0];
      if (!el) return true;
      return !robotsTokens(el).some((token) => token.toLowerCase() === directive);
    },
    write(doc, value) {
      const wanted = { index: true, follow: true };
      wanted[own] = !!value;
      wanted[sibling] = SPECS[sibling].read(doc);
      writeRobots(doc, wanted);
    },
  };
}

const titleField = {
  find: titles,
  read(doc) {
    const el = titles(doc)[0];
    return el ? text(el.textContent) : "";
  },
  write(doc, value) {
    const els = titles(doc);
    const raw = text(value);
    if (!filled(raw)) {
      els.forEach(drop);
      return;
    }
    const el = els[0] || doc.createElement("title");
    if (!els.length) headOf(doc).appendChild(el);
    el.textContent = raw;
    els.slice(1).forEach(drop);
  },
};

const langField = {
  find(doc) {
    const root = doc.documentElement;
    return root && root.hasAttribute("lang") ? [root] : [];
  },
  read(doc) {
    const root = doc.documentElement;
    return root && root.hasAttribute("lang") ? text(root.getAttribute("lang")) : "";
  },
  write(doc, value) {
    const root = doc.documentElement;
    if (!root) return;
    const raw = text(value);
    if (!filled(raw)) {
      root.removeAttribute("lang");
      return;
    }
    root.setAttribute("lang", raw.trim());
  },
};

const canonicalField = {
  find: (doc) => links(doc, "canonical"),
  read(doc) {
    const el = links(doc, "canonical")[0];
    return el ? text(el.getAttribute("href")) : "";
  },
  write(doc, value) {
    const els = links(doc, "canonical");
    const raw = text(value);
    if (!filled(raw)) {
      els.forEach(drop);
      return;
    }
    const el = els[0] || createLink(doc, "canonical");
    el.setAttribute("href", raw.trim());
    els.slice(1).forEach(drop);
  },
};

const TITLE_MODE = "clay-seo-title-mode";

const titleModeField = {
  find: (doc) => metas(doc, "name", TITLE_MODE),
  read(doc) {
    const el = metas(doc, "name", TITLE_MODE)[0];
    return el && text(el.getAttribute("content")).trim().toLowerCase() === "custom" ? "custom" : "derived";
  },
  write(doc, value) {
    const els = metas(doc, "name", TITLE_MODE);
    if (text(value).trim().toLowerCase() !== "custom") {
      els.forEach(drop);
      return;
    }
    const el = els[0] || createMeta(doc, "name", TITLE_MODE);
    el.setAttribute("content", "custom");
    els.slice(1).forEach(drop);
  },
};

const SPECS = {
  title: titleField,
  description: metaField("name", "description"),
  lang: langField,
  canonical: canonicalField,
  index: robotsField("noindex"),
  follow: robotsField("nofollow"),
  ogTitle: metaField("property", "og:title"),
  ogDescription: metaField("property", "og:description"),
  ogImage: metaField("property", "og:image", { trim: true }),
  ogImageAlt: metaField("property", "og:image:alt"),
  siteName: metaField("property", "og:site_name"),
  twitterSite: metaField("name", "twitter:site"),
  titleMode: titleModeField,
};

export const FIELDS = Object.fromEntries(
  Object.keys(SPECS).map((key) => [key, { read: SPECS[key].read, write: SPECS[key].write }]),
);

function isLocalHost(url) {
  const host = url.hostname.toLowerCase();
  return host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1";
}

function parseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isWebUrl(url) {
  return url.protocol === "http:" || url.protocol === "https:";
}

function pageUrl(doc) {
  const raw = (doc.location && doc.location.href) || doc.URL || doc.baseURI || "";
  const url = parseUrl(raw);
  if (!url || !isWebUrl(url) || isLocalHost(url)) return "";
  return url.origin + url.pathname;
}

function canonicalProblem(value) {
  const raw = text(value).trim();
  if (!raw) return "";
  const url = parseUrl(raw);
  if (!url || !isWebUrl(url)) return "Enter a full http: or https: address.";
  if (isLocalHost(url)) return "A localhost address cannot be a canonical URL.";
  return "";
}

function imageProblem(value, base) {
  const raw = text(value).trim();
  if (!raw) return "";
  if (SCHEME.test(raw)) {
    const url = parseUrl(raw);
    if (!url || !isWebUrl(url)) return "Use an http: or https: image address.";
    return "";
  }
  if (base) {
    try {
      new URL(raw, base);
    } catch {
      return "Use an http: or https: image address.";
    }
  }
  return "";
}

function canonicalValue(doc, wanted) {
  const value = ("canonical" in wanted ? text(wanted.canonical).trim() : SPECS.canonical.read(doc)).trim();
  return value && !canonicalProblem(value) ? value : "";
}

function writeAutomatic(doc, wanted) {
  const previewSet = PREVIEW_KEYS.some((key) => key in wanted && filled(wanted[key]));
  const canonicalSet = "canonical" in wanted && filled(wanted.canonical);
  if (!previewSet && !canonicalSet && !("ogImage" in wanted)) return;

  if (previewSet || canonicalSet) {
    if (!metas(doc, "property", "og:type").length) setMetaContent(doc, "property", "og:type", "website");
    const target = canonicalValue(doc, wanted) || pageUrl(doc);
    if (target) setMetaContent(doc, "property", "og:url", target);
  }

  const image = "ogImage" in wanted ? wanted.ogImage : SPECS.ogImage.read(doc);
  setMetaContent(doc, "name", "twitter:card", filled(image) ? "summary_large_image" : "summary");
}

export function readHead(doc) {
  const values = {};
  const present = {};
  for (const key of Object.keys(SPECS)) {
    const spec = SPECS[key];
    values[key] = spec.read(doc);
    present[key] = spec.find(doc).length > 0;
  }
  return { values, present };
}

export function applyHead(doc, changes) {
  const wanted = changes || {};
  const keys = Object.keys(SPECS).filter((key) => key in wanted);
  const errors = {};

  if (keys.includes("canonical")) {
    const problem = canonicalProblem(wanted.canonical);
    if (problem) errors.canonical = problem;
  }
  if (keys.includes("ogImage")) {
    const base = canonicalValue(doc, wanted) || pageUrl(doc);
    const problem = imageProblem(wanted.ogImage, base);
    if (problem) errors.ogImage = problem;
  }
  if (Object.keys(errors).length) return { normalized: [], errors };

  const normalized = [];
  const reported = new Set();
  for (const key of keys) {
    const find = SPECS[key].find;
    if (find(doc).length > 1 && !reported.has(find)) {
      reported.add(find);
      normalized.push(key);
    }
  }

  for (const key of keys) SPECS[key].write(doc, wanted[key]);
  writeAutomatic(doc, wanted);

  return { normalized, errors: {} };
}
