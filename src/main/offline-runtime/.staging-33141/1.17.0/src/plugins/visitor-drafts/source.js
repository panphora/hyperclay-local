const SRC = /^[a-z0-9][a-z0-9-]{0,39}$/;

export function rememberSource(memory, search = window.location.search) {
  const mem = memory.get();
  let incoming = null;
  try { incoming = new URLSearchParams(search).get("src"); } catch {}
  if (!mem.src && incoming && SRC.test(incoming)) { mem.src = incoming; memory.save(); }
  return mem.src;
}

export function downloadUrl(src, loc = window.location) {
  let path = loc.pathname.replace(/\/+$/, "");
  if (path && !/\.(html|htmlclay)$/.test(path)) path += ".html";
  return `/_/download${path}?as=htmlclay${src ? `&src=${encodeURIComponent(src)}` : ""}`;
}

