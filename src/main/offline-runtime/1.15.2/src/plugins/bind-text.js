/**
 * clay.bindText — an editor textarea that lives outside the saved records.
 *
 * The textarea sits in a `clay="freeze"` region and edits one record's text
 * element (for example `<pre><code class="entry-body">`). Every input is
 * written into the record at once, so a save captures it as the record's text
 * and a peer's merge of another paragraph keeps both edits. A change to the
 * record from elsewhere (a peer's merge, a restored draft, a JSON API write) is
 * shown in the textarea with the caret kept. During an IME composition nothing
 * is written or shown, and when it ends both edits apply unless they touch the
 * same stretch of text. Nothing here is Journal-specific: OverType, the
 * timestamps and the note arrive as callbacks.
 */

// Applies two edits to one text when each is one stretch of it (an IME composition always is) and the
// stretches do not overlap (two inserts at one point keep both); null when they do.
export function spliceMerge(base, local, remote) {
  const span = (text) => {
    let pre = 0;
    const max = Math.min(base.length, text.length);
    while (pre < max && base[pre] === text[pre]) pre++;
    let suf = 0;
    while (suf < max - pre && base[base.length - 1 - suf] === text[text.length - 1 - suf]) suf++;
    return { start: pre, end: base.length - suf, text: text.slice(pre, text.length - suf) };
  };
  const l = span(local);
  const r = span(remote);
  if (l.end <= r.start) return base.slice(0, l.start) + l.text + base.slice(l.end, r.start) + r.text + base.slice(r.end);
  if (r.end <= l.start) return base.slice(0, r.start) + r.text + base.slice(r.end, l.start) + l.text + base.slice(l.end);
  return null;
}

// Where an offset in `before` lands in `after`, when the two differ in one stretch.
export function mapCaret(before, after, offset) {
  let pre = 0;
  const max = Math.min(before.length, after.length);
  while (pre < max && before[pre] === after[pre]) pre++;
  if (offset <= pre) return offset;
  let suf = 0;
  while (suf < max - pre && before[before.length - 1 - suf] === after[after.length - 1 - suf]) suf++;
  return offset >= before.length - suf ? after.length - (before.length - offset) : after.length - suf;
}

export function bindText(textarea, { onWrite, onShow, onConflict, onGone } = {}) {
  const OBSERVE = { characterData: true, childList: true, subtree: true };
  let field = textarea;
  const ta = () => field;
  let s = null; // { key, code, seen, composing, resolve }
  const observer = new MutationObserver(() => {
    observer.takeRecords();
    if (s && !s.composing && s.code.textContent !== s.seen) reconcile(s.code.textContent);
  });

  function write(value) {
    const t = s.code.firstChild;
    if (t && t.nodeType === 3 && !t.nextSibling) t.data = value;
    else s.code.textContent = value;
    observer.takeRecords();
    s.seen = value;
    onWrite?.(s.code);
  }
  function show(value) {
    const el = ta();
    const before = el.value;
    const [a, b] = [mapCaret(before, value, el.selectionStart), mapCaret(before, value, el.selectionEnd)];
    el.value = value;
    if (document.activeElement === el) el.setSelectionRange(a, b);
    s.seen = value;
    onShow?.();
  }
  // The record changed while the textarea held text the record had not taken yet.
  // `base` is the text both sides were editing, read before show() moves `seen`: a
  // caller staging the losing side needs what the clash was measured against, not
  // what the textarea holds afterwards. The second argument is additive, so a
  // caller that only wants the typed string ignores it.
  function reconcile(now) {
    const typed = ta().value;
    const base = s.seen;
    const merged = typed === base ? now : spliceMerge(base, typed, now);
    if (merged == null) onConflict?.(typed, { key: s.key, base, remote: now });
    else if (merged !== now) write(merged);
    show(merged ?? now);
  }
  function rebind() {
    const code = s.resolve ? s.resolve() : null;
    if (!code) { onGone?.(ta().value, { key: s.key, base: s.seen }); return false; }
    s.code = code;
    observer.disconnect();
    observer.observe(s.code, OBSERVE);
    return true;
  }
  function input() {
    if (!s || s.composing) return;
    if (!s.code.isConnected && !rebind()) return;
    const now = s.code.textContent;
    if (now !== s.seen) return reconcile(now);
    const value = ta().value;
    if (value !== s.seen) write(value);
  }
  function flush() {
    if (s) { s.composing = false; input(); }
  }
  function open(textEl, options = {}) {
    const key = options.key;
    if (s && s.key === key) {
      s.resolve = options.resolve;
      if ((s.code !== textEl || !s.code.isConnected) && rebind()) input();
      return;
    }
    flush();
    observer.disconnect();
    s = { key, code: textEl, seen: textEl.textContent, composing: false, resolve: options.resolve };
    observer.observe(textEl, OBSERVE);
    const el = ta();
    el.value = s.seen;
    el.setSelectionRange(0, 0);
    onShow?.();
  }
  function close() {
    flush();
    observer.disconnect();
    s = null;
  }
  function attach(next) {
    if (!next || next === field) return;
    detach();
    field = next;
    listen();
  }

  function onCompositionStart() { if (s) s.composing = true; }
  function onCompositionEnd() { if (s) { s.composing = false; input(); } }
  function listen() {
    field.addEventListener("input", input);
    field.addEventListener("compositionstart", onCompositionStart);
    field.addEventListener("compositionend", onCompositionEnd);
  }
  function detach() {
    field.removeEventListener("input", input);
    field.removeEventListener("compositionstart", onCompositionStart);
    field.removeEventListener("compositionend", onCompositionEnd);
  }

  listen();

  return {
    open, close, flush,
    current: () => s && s.code,
    attach,
    composing: () => !!(s && s.composing),
  };
}
