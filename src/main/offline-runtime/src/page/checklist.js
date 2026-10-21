import { state, view as pmView } from "../vendor/prosemirror.vendor.js";
import { schema } from "./schema.js";
import { asStep } from "./blocksel.js";

const { Plugin } = state;
const { Decoration, DecorationSet } = pmView;

function itemAt(view, id) {
  let found = null;
  view.state.doc.forEach((node, pos) => { if (node.attrs.id === id && node.type === schema.nodes.list_item && node.attrs.kind === "check") found = { node, pos }; });
  return found;
}

function setItem(view, id, attr, value) {
  const found = itemAt(view, id);
  if (!found) return;
  view.dispatch(asStep(view.state.tr.setNodeMarkup(found.pos, null, { ...found.node.attrs, [attr]: value || null })));
}

function chip(doc, label, aria, attr) {
  const button = doc.createElement("button");
  button.type = "button";
  button.className = "page-check-chip";
  button.dataset.check = attr;
  button.textContent = label;
  button.setAttribute("aria-label", aria);
  return button;
}

function ownerPicker(view, id, anchor) {
  const doc = anchor.ownerDocument;
  const popup = doc.createElement("span");
  popup.className = "page-check-popup";
  popup.contentEditable = "false";
  const input = doc.createElement("input");
  input.type = "text";
  input.setAttribute("aria-label", "Owner name");
  input.value = itemAt(view, id)?.node.attrs.owner || "";
  const choices = doc.createElement("span");
  choices.setAttribute("role", "listbox");
  const choose = (name) => setItem(view, id, "owner", name);
  const draw = (people) => {
    choices.replaceChildren();
    for (const person of people || []) {
      if (input.value && !person.name.toLowerCase().includes(input.value.toLowerCase())) continue;
      const option = chip(doc, person.name, `Owner: ${person.name}`, "owner-option");
      option.setAttribute("role", "option");
      option.addEventListener("click", () => choose(person.name));
      choices.append(option);
    }
    if (input.value.trim()) {
      const typed = chip(doc, `Use '${input.value.trim()}'`, `Use ${input.value.trim()}`, "owner-typed");
      typed.addEventListener("click", () => choose(input.value.trim()));
      choices.append(typed);
    }
  };
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); choose(input.value.trim()); }
    if (event.key === "Escape") { event.preventDefault(); popup.remove(); anchor.focus(); }
    event.stopPropagation();
  });
  const clear = chip(doc, "Clear", "Clear owner", "clear-owner");
  clear.addEventListener("click", () => choose(null));
  popup.append(input, choices, clear);
  anchor.after(popup);
  input.focus();
  let available = [];
  draw(available);
  input.addEventListener("input", () => draw(available));
  const source = globalThis.clay?.people?.available;
  if (source) Promise.resolve().then(() => source()).then((people) => { if (popup.isConnected) { available = people || []; draw(available); } }).catch(() => {});
}

function datePicker(view, id, anchor) {
  const doc = anchor.ownerDocument;
  const popup = doc.createElement("span");
  popup.className = "page-check-popup";
  popup.contentEditable = "false";
  const input = doc.createElement("input");
  input.type = "date";
  input.setAttribute("aria-label", "Due date");
  input.value = itemAt(view, id)?.node.attrs.due || "";
  input.addEventListener("change", () => setItem(view, id, "due", input.value));
  input.addEventListener("keydown", (event) => event.stopPropagation());
  const clear = chip(doc, "Clear", "Clear due date", "clear-date");
  clear.addEventListener("click", () => setItem(view, id, "due", null));
  popup.append(input, clear);
  anchor.after(popup);
  input.focus();
}

function controls(view, node) {
  const doc = view.dom.ownerDocument;
  const box = doc.createElement("span");
  box.className = "page-check-controls";
  box.contentEditable = "false";
  box.dataset.empty = String(!node.attrs.owner && !node.attrs.due);
  const owner = chip(doc, node.attrs.owner || "Assign", node.attrs.owner ? `Owner: ${node.attrs.owner}` : "Assign owner", "owner");
  const dueLabel = node.attrs.due ? new Date(`${node.attrs.due}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : "Date";
  const date = chip(doc, dueLabel, node.attrs.due ? `Due ${dueLabel}` : "Set due date", "date");
  owner.addEventListener("click", () => ownerPicker(view, node.attrs.id, owner));
  date.addEventListener("click", () => datePicker(view, node.attrs.id, date));
  box.append(owner, date);
  return box;
}

function focusControl(view, name) {
  const $pos = view.state.selection.$head;
  if ($pos.depth !== 1 || $pos.parent.type !== schema.nodes.list_item || $pos.parent.attrs.kind !== "check") return false;
  const id = $pos.parent.attrs.id;
  const widget = [...view.dom.querySelectorAll(".page-check-controls")].find((el) => el.dataset.item === id);
  const button = widget?.querySelector(`[data-check="${name}"]`);
  if (!button) return false;
  button.focus();
  return true;
}

export const checklistKeys = new Plugin({
  props: {
    handleKeyDown(view, event) {
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.altKey) return false;
      const name = event.key.toLowerCase() === "o" ? "owner" : event.key.toLowerCase() === "d" ? "date" : null;
      return name ? focusControl(view, name) : false;
    },
  },
});

export function checklistPlugin() {
  return new Plugin({
    props: {
      decorations(st) {
        const widgets = [];
        st.doc.forEach((node, pos) => {
          if (node.type !== schema.nodes.list_item || node.attrs.kind !== "check") return;
          widgets.push(Decoration.widget(pos + node.nodeSize - 1, (view) => {
            const box = controls(view, node);
            box.dataset.item = node.attrs.id;
            return box;
          }, { key: `${node.attrs.id}:${node.attrs.owner}:${node.attrs.due}`, side: 1, stopEvent: () => true, ignoreSelection: true }));
        });
        return DecorationSet.create(st.doc, widgets);
      },
    },
  });
}
