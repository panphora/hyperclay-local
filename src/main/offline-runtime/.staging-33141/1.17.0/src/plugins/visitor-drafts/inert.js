export const DOWNLOAD_URL = "/_/download?as=htmlclay";

export function editOriginal() {
  const url = new URL(window.location.href);
  url.searchParams.set("editmode", "true");
  window.location.href = url.toString();
  return true;
}

export function backToDraft() {
  const url = new URL(window.location.href);
  url.searchParams.delete("editmode");
  window.location.href = url.toString();
  return true;
}

export function inertVisitorDrafts() {
  return {
    active: false,
    slot: null,
    key: null,
    hasDraft: () => false,
    restored: () => null,
    saveNow: () => false,
    reset: () => false,
    onRestore: () => false,
    editOriginal,
    backToDraft,
    downloadUrl: () => DOWNLOAD_URL,
    source: null,
  };
}
