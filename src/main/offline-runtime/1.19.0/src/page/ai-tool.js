import { state } from "../vendor/prosemirror.vendor.js";
import { schema } from "./schema.js";
import { asStep } from "./blocksel.js";
import { keyBetween, newId } from "./model.js";
import { createToolClient } from "./rich/page-tool.js";
import { createToolHost } from "./tools.js";
import { toolContext } from "./tool-data.js";

const { Selection } = state;

function findBlock(doc, id) {
  let found = null;
  doc.forEach((node, at, index) => { if (node.attrs.id === id) found = { node, at, index }; });
  return found;
}

function insertCandidate(view, candidate, bookmark) {
  const st = view.state;
  const found = findBlock(st.doc, bookmark?.hostId) ?? (() => {
    const index = Math.min(st.selection.$head.index(0), st.doc.childCount - 1);
    let at = 0;
    for (let i = 0; i < index; i++) at += st.doc.child(i).nodeSize;
    return { node: st.doc.child(index), at, index };
  })();
  const { node: current, at, index } = found;
  const next = st.doc.maybeChild(index + 1);
  const replace = current.isTextblock && (current.content.size === 0 || bookmark?.hostId === current.attrs.id && current.textContent === bookmark.slashText);
  const pos = replace ? current.attrs.pos : keyBetween(current.attrs.pos, next?.attrs.pos ?? null);
  const tool = schema.nodes.tool.create({
    id: candidate.id, pos, parent: current.attrs.parent ?? null,
    artifact: candidate.artifact, rev: candidate.rev, state: candidate.state,
  });
  const place = replace ? at : at + current.nodeSize;
  const tr = st.tr;
  if (!replace && bookmark?.hostId === current.attrs.id && bookmark.slashText && bookmark.slashOffset >= 0) {
    const from = at + 1 + bookmark.slashOffset;
    const to = from + bookmark.slashText.length;
    if (to <= at + current.nodeSize - 1 && st.doc.textBetween(from, to) === bookmark.slashText) tr.delete(from, to);
  }
  const mapped = tr.mapping.map(place);
  tr.replaceWith(mapped, replace ? tr.mapping.map(at + current.nodeSize) : mapped, tool);
  tr.setSelection(Selection.near(tr.doc.resolve(Math.min(mapped + tool.nodeSize, tr.doc.content.size))));
  view.dispatch(asStep(tr).scrollIntoView());
}

export function createAiTool({ getView, store, transport, acceptState = () => globalThis.clay?.save?.flush?.(), newId: allocate = newId }) {
  const client = transport ? createToolClient({ transport, newId: () => allocate("request") }) : null;
  let panel = null;
  let generation = 0;

  const close = () => {
    generation++;
    if (!panel) return;
    client?.discard(panel.pending);
    panel.preview?.dispose();
    panel.previewHost?.dispose();
    panel.element.remove();
    panel = null;
  };

  const open = ({ target = null, remove = null } = {}) => {
    close();
    const view = getView();
    if (!view) return;
    const selection = view.state.selection;
    const host = view.state.doc.child(Math.min(selection.$head.index(0), view.state.doc.childCount - 1));
    const bookmark = {
      hostId: host?.attrs.id,
      slashText: remove ? view.state.doc.textBetween(remove.from, remove.to) : null,
      slashOffset: remove && selection.$head.depth ? remove.from - selection.$head.before(1) - 1 : null,
    };
    const doc = view.dom.ownerDocument;
    const element = doc.createElement("section");
    element.className = "page-ai-panel";
    element.contentEditable = "false";
    element.setAttribute("role", "dialog");
    element.setAttribute("aria-label", target ? "Revise tool" : "Make a tool with AI");
    const input = doc.createElement("textarea");
    input.setAttribute("aria-label", "Describe the tool");
    input.placeholder = target ? "What should change?" : "Describe the tool you want";
    const status = doc.createElement("p");
    status.className = "page-ai-status";
    const previewRoot = doc.createElement("div");
    previewRoot.className = "page-ai-preview";
    const actions = doc.createElement("div");
    actions.className = "page-ai-actions";
    element.append(input, status, previewRoot, actions);
    view.dom.parentElement.append(element);
    panel = { element, input, status, previewRoot, actions, target, bookmark, candidate: null, pending: null, preview: null, previewHost: null, kept: false, busy: false };

    const button = (label, run) => {
      const el = doc.createElement("button");
      el.type = "button";
      el.textContent = label;
      el.addEventListener("click", run);
      actions.append(el);
    };
    const showPrompt = () => {
      if (!panel) return;
      panel.preview?.dispose();
      panel.previewHost?.dispose();
      panel.preview = null;
      panel.previewHost = null;
      panel.previewRoot.replaceChildren();
      panel.input.hidden = false;
      panel.actions.replaceChildren();
      button("Generate", generate);
      button("Cancel", close);
      panel.input.focus();
    };
    const showCandidate = () => {
      const p = panel;
      p.input.hidden = true;
      p.status.textContent = "";
      p.previewHost = createToolHost({ mode: "view" });
      p.preview = p.previewHost.mount(p.previewRoot, { id: "preview", rev: "preview", artifact: p.candidate.artifact, seed: p.candidate.state });
      p.actions.replaceChildren();
      button("Keep", keep);
      button("Revise", showPrompt);
      button("Discard", close);
    };
    const generate = async () => {
      const p = panel;
      if (!p || p.busy || !p.input.value.trim()) return;
      if (!client) { p.status.textContent = "Tool generation is unavailable"; return; }
      p.busy = true;
      p.status.textContent = "Making your tool…";
      p.actions.replaceChildren();
      button("Cancel", close);
      const turn = ++generation;
      const candidate = client.request(p.input.value.trim(), toolContext(view.state.doc, doc.title), p.target);
      p.pending = candidate;
      try {
        const result = await client.wait(candidate);
        if (panel !== p || turn !== generation) return;
        p.candidate = { artifact: result.artifact, state: result.state, id: null, rev: null };
        showCandidate();
      } catch (error) {
        if (panel !== p || turn !== generation) return;
        p.status.textContent = error.message;
        p.actions.replaceChildren();
        button("Generate", generate);
        button("Cancel", close);
      } finally { p.busy = false; }
    };
    const keep = async () => {
      const p = panel;
      if (!p?.candidate || p.busy || p.kept) return;
      p.busy = true;
      const candidate = p.candidate;
      candidate.id ??= p.target?.toolId ?? allocate("b");
      candidate.rev ??= allocate("rev");
      try {
        if (!store) throw new Error("This document can't save tool state");
        await store.set([candidate.id, candidate.rev], candidate.state);
        const accepted = await acceptState();
        if (accepted?.ok !== true && !["saved", "clean"].includes(accepted?.state)) {
          throw new Error(accepted?.msg ?? accepted?.message ?? "Tool state was not saved");
        }
        if (panel !== p || p.kept) return;
        if (p.target) {
          const found = findBlock(view.state.doc, p.target.toolId);
          if (found?.node.type !== schema.nodes.tool || found.node.attrs.rev !== p.target.rev) {
            p.status.textContent = "This tool changed while you were revising. Keep as a new tool, or discard.";
            p.target = null;
            candidate.id = null;
            candidate.rev = null;
            p.actions.replaceChildren();
            button("Keep as new tool", keep);
            button("Discard", close);
            return;
          }
          view.dispatch(asStep(view.state.tr.setNodeMarkup(found.at, null, {
            ...found.node.attrs, artifact: candidate.artifact, rev: candidate.rev,
          })));
        } else insertCandidate(view, candidate, p.bookmark);
        p.kept = true;
        close();
      } catch (error) {
        if (panel === p) p.status.textContent = error.message;
      } finally { p.busy = false; }
    };
    showPrompt();
    return element;
  };

  return { open, dispose: close };
}
