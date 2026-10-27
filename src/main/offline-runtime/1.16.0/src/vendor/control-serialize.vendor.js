// GENERATED — do not edit. Vendored from sapjs/src/control-serialize.js
// via sapjs `npm run propagate`, which writes every client's copy from one
// table. Edit the sapjs source and re-run.

// The one place that knows how a form control's live state maps to the DOM
// attributes that survive serialization (cloneNode / outerHTML).
//
// Browser form state lives in JS properties (.value, .checked, .selected), not
// in attributes. A save serializes attributes, so that state is lost unless it
// is copied into attributes first. This module is shared by sapjs (carrier
// mirror) and hyperclayjs (persistent form input values) so the two never drift.
//
// Two phases:
//   serializeControlToAttributes(el)        LIVE, cursor-safe. Run on every edit.
//     A textarea writes an inert `data-value` attribute, because writing its
//     `textContent` while focused destroys the cursor; everything else writes
//     its real attribute (the WHATWG dirty-value flag keeps the display intact).
//   finalizeControlForSave(target, source)  SAVE, on a detached clone. Reads live
//     state from `source`, writes `target`'s attributes, and resolves a textarea
//     `data-value` into real `textContent` so the saved HTML is clean.

function inputType(el) {
  return (el.getAttribute("type") || "text").toLowerCase();
}

export function serializeControlToAttributes(el) {
  const tag = el.tagName;
  if (tag === "INPUT") {
    const type = inputType(el);
    if (type === "checkbox" || type === "radio") {
      if (el.checked) el.setAttribute("checked", "");
      else el.removeAttribute("checked");
    } else {
      el.setAttribute("value", el.value);
    }
    return;
  }
  if (tag === "TEXTAREA") {
    el.setAttribute("data-value", el.value);
    return;
  }
  if (tag === "SELECT") {
    const opts = el.options;
    for (let i = 0; i < opts.length; i++) {
      if (opts[i].selected) opts[i].setAttribute("selected", "");
      else opts[i].removeAttribute("selected");
    }
  }
}

// Writes only what changes what a reload would show. A control whose attributes
// already reload as its live state is left exactly as the author wrote it, because a
// source-preserving save copies the author's bytes for every node the save did not
// change, and a rewrite here is a change.
export function finalizeControlForSave(target, source = target) {
  const tag = target.tagName;
  if (tag === "INPUT") {
    const type = inputType(target);
    if (type === "checkbox" || type === "radio") {
      if (!source.checked) target.removeAttribute("checked");
      else if (!target.hasAttribute("checked")) target.setAttribute("checked", "");
    } else if (source.value !== (target.getAttribute("value") ?? "")) {
      target.setAttribute("value", source.value);
    }
    return;
  }
  if (tag === "TEXTAREA") {
    // The HTML parser drops one newline right after <textarea>, so a value that
    // starts with one needs a sacrificial newline to survive a reload.
    const text = source.value.startsWith("\n") ? "\n" + source.value : source.value;
    if (target.textContent !== text) target.textContent = text;
    target.removeAttribute("data-value");
    return;
  }
  if (tag === "SELECT") {
    const tOpts = target.options;
    const sOpts = source.options;
    for (let i = 0; i < tOpts.length; i++) {
      if (!(sOpts[i] && sOpts[i].selected)) tOpts[i].removeAttribute("selected");
      else if (!tOpts[i].hasAttribute("selected")) tOpts[i].setAttribute("selected", "");
    }
  }
}

// Load-time inverse of the textarea half of serialize. A saved file can still
// carry a textarea's value in the cursor-safe data-value attribute (when no save
// step finalized it into textContent), and the browser ignores data-value when
// populating .value on load. Restore it so the value round-trips on reload.
// Other control types round-trip natively (the browser seeds .value/.checked/
// .selected from their attributes), so they need nothing here.
export function rehydrateControlFromAttributes(el) {
  if (el.tagName !== "TEXTAREA" || !el.hasAttribute("data-value")) return;
  if (el === el.ownerDocument.activeElement) return; // mid-edit: leave it to persist
  el.textContent = el.getAttribute("data-value");
  el.removeAttribute("data-value");
}
