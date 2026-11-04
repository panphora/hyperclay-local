// Saving a page as a file the browser downloads. Kept apart from the conflict copy
// builders so an editor that only offers "download this page" loads none of them.

const HTML_TYPES = ["text/html", "application/xhtml+xml"];

function isHtml(type) {
  if (typeof type !== "string") return false;
  return HTML_TYPES.includes(type.split(";")[0].trim().toLowerCase());
}

export function documentName(pathname = location.pathname) {
  const last = pathname.split("/").filter(Boolean).pop();
  if (!last) return pathname.endsWith("/") || pathname === "" ? "index" : "page";
  let name = last;
  try { name = decodeURIComponent(last); } catch {}
  return name.replace(/\.(html?|htmlclay)$/i, "") || "page";
}

export async function downloadHtml({ html, name, type = "text/html" }) {
  let url = null;
  try {
    let contents = html;
    if (isHtml(type) && typeof html === "string" && /clay|data-paid-only/i.test(html)) {
      const { stripCopyContent } = await import("./copy-content.js");
      contents = stripCopyContent(html);
    }
    url = URL.createObjectURL(new Blob([contents], { type }));
    const a = document.createElement("a");
    a.setAttribute("clay", "no-save no-watch no-snapshot");
    a.href = url;
    a.download = name;
    a.style.setProperty("display", "none", "important");
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoked late: Safari cancels a download whose URL goes away too soon.
    setTimeout(() => URL.revokeObjectURL(url), 40000);
    return true;
  } catch (err) {
    console.error("clayjs: could not build the download", err);
    if (url) URL.revokeObjectURL(url);
    return false;
  }
}
