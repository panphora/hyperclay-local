// The people picker the @ command draws: one listbox at the caret, outside the saved
// article and never in it. It is built from the editor's own menu markup, so it needs no
// stylesheet of its own, and it takes no focus: the caret and the typed query stay in the
// document, and the active row is announced through the editor's aria-activedescendant as
// the slash menu does. A name is only ever text.
export const PICKER = "page-mention-picker";
export const OPTION = "page-menu-item";
const EMPTY = "No people to mention";

let count = 0;

// The people a picker may offer: the ones the document already names, with the host's live
// list laid over them by id, so a renamed person is shown under the name the host answers
// with. Nothing is invented when the host has no list.
export function peopleFrom(saved = [], allowed = null) {
  const byId = new Map();
  for (const person of saved ?? []) if (person && typeof person.id === "string") byId.set(person.id, person);
  for (const person of Array.isArray(allowed) ? allowed : []) if (person && typeof person.id === "string") byId.set(person.id, person);
  return [...byId.values()];
}

export const filterPeople = (people, query) => {
  const q = String(query ?? "").trim().toLowerCase();
  if (!q) return people;
  return people.filter((person) => String(person.name ?? "").toLowerCase().includes(q));
};

// The shell takes the words a command shows, so a date command reuses the same listbox:
// same placement, same rows, same keyboard, and its own name for what it lists.
export function createMentionPicker({ document: doc = globalThis.document, onPick = () => {}, label = "Mention a person", empty = EMPTY } = {}) {
  const id = `page-mentions-${++count}`;
  const el = doc.createElement("div");
  el.className = `page-menu ${PICKER}`;
  el.id = id;
  el.setAttribute("role", "listbox");
  el.setAttribute("aria-label", label);
  el.hidden = true;
  let people = [];
  let active = 0;

  const draw = () => {
    if (!people.length) {
      const none = doc.createElement("div");
      none.className = "page-menu-title";
      none.textContent = empty;
      el.replaceChildren(none);
      return;
    }
    el.replaceChildren(...people.map((person, i) => {
      const row = doc.createElement("button");
      row.type = "button";
      row.className = `${OPTION}${i === active ? " is-active" : ""}`;
      row.id = `${id}-${i}`;
      row.dataset.index = String(i);
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", String(i === active));
      row.textContent = String(person.name ?? "");
      row.addEventListener("mousedown", (event) => event.preventDefault());
      row.addEventListener("click", () => onPick(i));
      return row;
    }));
  };

  // The caret the list hangs from, in the page's own placement variables: the same ones
  // the block menu writes, so the existing menu stylesheet paints and lifts it.
  const place = (at) => {
    el.style.setProperty("--page-pop-x", `${at.x}px`);
    el.style.setProperty("--page-pop-y", `${at.y}px`);
  };

  return {
    el,
    show: (next, at = null) => {
      people = next;
      active = 0;
      draw();
      if (at) place(at);
      el.hidden = false;
    },
    move: (step) => {
      if (!people.length) return;
      active = (active + step + people.length) % people.length;
      draw();
    },
    activeId: () => (people.length ? `${id}-${active}` : null),
    index: () => active,
    personAt: (i) => people[i] ?? null,
    hide: () => {
      el.hidden = true;
      people = [];
      active = 0;
      el.replaceChildren();
    },
    destroy() {
      this.hide();
      el.remove();
    },
  };
}
