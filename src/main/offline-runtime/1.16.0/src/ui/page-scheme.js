// The scheme a UI root gives its subtree: the page's own when it declares one, so
// light-dark() matches what the person is looking at, else the reader's preference.
// It lives alone so a reader can ask for it without the controls.
export function pageScheme() {
  const s = getComputedStyle(document.documentElement).colorScheme;
  return s === 'light' || s === 'dark' ? s : 'light dark';
}
