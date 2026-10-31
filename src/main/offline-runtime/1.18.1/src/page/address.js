const SAFE_SCHEME = /^(https?:|mailto:|tel:)/i;

export function safeHref(raw) {
  const s = String(raw ?? "").trim().replace(/[\u0000-\u001f\u007f]/g, "");
  if (!s) return null;
  if (s.startsWith("#") || (s.startsWith("/") && !s.startsWith("//"))) return s;
  if (SAFE_SCHEME.test(s)) return s;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return null;
  if (/^(\/\/)?[\w-]+(\.[\w-]+)+(:\d+)?([/?#]\S*)?$/.test(s)) return `https://${s.replace(/^\/\//, "")}`;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return `mailto:${s}`;
  return null;
}

export const safeSrc = (s) => (s && /^data:image\/(png|jpeg|gif|webp);/i.test(s) && s.length <= 2_100_000 ? s : safeHref(s));

export function safeFileHref(raw) {
  if (typeof raw !== "string") return null;
  const href = safeHref(raw);
  return href && /^(https?:|\/(?!\/))/i.test(href) ? href : null;
}
