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
 *
 * The binding answers for its own lifecycle too: `flush()` reports whether the
 * record now holds the text and refuses while a composition is running, `open()`
 * and `close()` honor that refusal, and `dispose()` only detaches once the exit
 * barrier has landed.
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
  let disposed = false;
  const observer = new MutationObserver(() => {
    observer.takeRecords();
    if (s && !s.composing && s.code.textContent !== s.seen) reconcile(s.code.textContent);
  });

  // New durable input is the lifecycle's to admit, not the binding's: while a transition
  // runs, a keystroke is not new input and is refused. A standalone page has no lifecycle
  // and always admits.
  const admitted = () => window.clay?.modeLifecycle?.canWrite?.() !== false;

  // The record holds what the textarea holds. That is the only proof a flush landed: a
  // callback that staged a conflict or a gone record has not made the text represented.
  const represented = () => !!(s && s.code.isConnected && s.code.textContent === ta().value);

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
    if (merged == null) {
      onConflict?.(typed, { key: s.key, base, remote: now });
      show(now);
      return { ok: false, code: "conflict" };
    }
    if (merged !== now) write(merged);
    show(merged);
    return { ok: true };
  }
  // A record that cannot be resolved hands its text to `onGone` and is released: there is
  // nothing left here that a later write could land in, and holding the detached element
  // would refuse every record switch after it.
  function rebind() {
    const code = s.resolve ? s.resolve() : null;
    if (!code) {
      onGone?.(ta().value, { key: s.key, base: s.seen });
      observer.disconnect();
      s = null;
      return false;
    }
    s.code = code;
    observer.disconnect();
    observer.observe(s.code, OBSERVE);
    return true;
  }
  // `captured` is the composition this binding already holds: it finishes through its own
  // operation, so a closed admission does not throw away what the person was typing.
  function input(captured = false) {
    if (!s) return { ok: true };
    if (s.composing) return { ok: false, code: "composition" };
    if (!captured && !admitted()) return { ok: false, code: "busy" };
    if (!s.code.isConnected && !rebind()) return { ok: false, code: "gone" };
    const now = s.code.textContent;
    if (now !== s.seen) return reconcile(now);
    const value = ta().value;
    if (value !== s.seen) write(value);
    return { ok: true };
  }
  // A composition in progress is not something a flush may end on the person's behalf: it
  // is refused, and `s.composing` stays exactly as it was. Everything else runs the input
  // path above, and its answer says whether the record now holds the text.
  function flush() {
    if (!s) return { ok: true };
    if (s.composing) return { ok: false, code: "composition" };
    const result = input();
    if (!result.ok) return result;
    return represented() ? { ok: true } : { ok: false, code: "conflict" };
  }
  function open(textEl, options = {}) {
    if (disposed) return { ok: false, code: "disposed" };
    const key = options.key;
    if (s && s.key === key) {
      s.resolve = options.resolve;
      if (s.code !== textEl || !s.code.isConnected) {
        if (!rebind()) return { ok: false, code: "gone" };
        return input();
      }
      return { ok: true };
    }
    // A refused flush keeps the open record and its observer: nothing was written, so
    // switching records here would drop the text the refusal was protecting. A record that
    // was gone has already handed its text over and released itself, so there is nothing
    // left to protect and the switch goes ahead.
    const flushed = flush();
    if (!flushed.ok && s) return flushed;
    observer.disconnect();
    s = { key, code: textEl, seen: textEl.textContent, composing: false, resolve: options.resolve };
    observer.observe(textEl, OBSERVE);
    const el = ta();
    el.value = s.seen;
    el.setSelectionRange(0, 0);
    onShow?.();
    return { ok: true };
  }
  function close() {
    const flushed = flush();
    if (!flushed.ok && s) return flushed;
    observer.disconnect();
    s = null;
    return { ok: true };
  }
  // Detaching only. The barrier has already succeeded when a lease disposes the binding, so
  // this never flushes: a composition still in progress or text the record never took keeps
  // the listeners where they are, and the caller is told why.
  function dispose() {
    if (disposed) return { ok: true };
    if (s?.composing) return { ok: false, code: "composition" };
    if (s && !represented()) return { ok: false, code: "pending-input" };
    disposed = true;
    observer.disconnect();
    detach();
    s = null;
    return { ok: true };
  }
  function attach(next) {
    if (disposed || !next || next === field) return;
    detach();
    field = next;
    listen();
  }

  function onInput() { input(); }
  function onCompositionStart() { if (s) s.composing = true; }
  function onCompositionEnd() { if (s) { s.composing = false; input(true); } }
  function listen() {
    field.addEventListener("input", onInput);
    field.addEventListener("compositionstart", onCompositionStart);
    field.addEventListener("compositionend", onCompositionEnd);
  }
  function detach() {
    field.removeEventListener("input", onInput);
    field.removeEventListener("compositionstart", onCompositionStart);
    field.removeEventListener("compositionend", onCompositionEnd);
  }

  listen();

  return {
    open, close, flush, dispose,
    current: () => s && s.code,
    attach,
    composing: () => !!(s && s.composing),
  };
}
