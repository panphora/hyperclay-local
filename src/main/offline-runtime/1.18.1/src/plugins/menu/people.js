// Who's here: a menu item and, on a page that opts in with `<html clay-menu-roster>`, a
// roster beside the capsule. Either opens the people panel, which lists the people on
// this page and lets you change the name your edits are signed with when this browser
// chose it. The roster comes from the presence store; nothing here is ever saved.
import { initialsOf, personColor } from "../../lib/person-face.js";

const CROSS =
  '<svg viewBox="0 0 256 256" aria-hidden="true" focusable="false"><path d="M205.66 194.34a8 8 0 0 1-11.32 11.32L128 139.31l-66.34 66.35a8 8 0 0 1-11.32-11.32L116.69 128 50.34 61.66a8 8 0 0 1 11.32-11.32L128 116.69l66.34-66.35a8 8 0 0 1 11.32 11.32L139.31 128Z"/></svg>';
const ROSTER_FACES = 3;

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function face(person) {
  const el = document.createElement("span");
  el.className = "clay-avatar";
  el.setAttribute("aria-hidden", "true");
  const color = personColor(person.id);
  el.style.setProperty("color", color);
  el.style.setProperty("border-color", color);
  el.style.setProperty("background", "var(--bevel-surface)");
  el.textContent = initialsOf(person.name);
  return el;
}

export function attachPeople({ root, capsule, addItem, removeItem, closeMenu, note }) {
  let snapshot = { supported: false, people: [], anonymous: 0 };
  let panel = null;
  let opener = null;
  let roster = null;
  let renaming = false;

  const people = () => window.clay && window.clay.people;
  const me = () => (window.clay && window.clay.me) || null;
  const canRename = () => {
    try {
      return !!people()?.canRename?.();
    } catch {
      return false;
    }
  };
  const total = () => snapshot.people.length + snapshot.anonymous;
  const wantsRoster = () => document.documentElement.hasAttribute("clay-menu-roster");

  function closePanel({ restore = true } = {}) {
    if (!panel) return;
    panel.remove();
    panel = null;
    renaming = false;
    roster?.setAttribute("aria-expanded", "false");
    if (restore && opener && opener.isConnected) opener.focus();
    opener = null;
  }

  function meSection() {
    const mine = me();
    if (!mine || !mine.name) return null;
    const section = document.createElement("div");
    section.className = "clay-people-me";
    const label = document.createElement("span");
    label.className = "clay-people-me-label";
    label.textContent = "Your edits are signed as";
    const row = document.createElement("div");
    row.className = "clay-people-me-row";
    section.append(label, row);

    if (renaming) {
      const input = document.createElement("input");
      input.className = "clay-people-input";
      input.type = "text";
      input.value = mine.name;
      input.setAttribute("aria-label", "Your name");
      input.maxLength = 120;
      const save = document.createElement("button");
      save.type = "button";
      save.className = "clay-menu-btn clay-menu-btn-small clay-menu-btn-primary";
      save.textContent = "Save";
      const commit = () => {
        try {
          people().rename(input.value);
        } catch (err) {
          note(err && err.code === "not-renamable" ? "This name comes from your account, so it can't be changed here." : "Use a name of 1 to 120 characters that isn't an email address.");
          input.focus();
          return;
        }
        renaming = false;
        draw();
        panel?.querySelector(".clay-people-me .clay-menu-btn")?.focus();
      };
      save.addEventListener("click", commit);
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        }
      });
      row.append(input, save);
      queueMicrotask(() => {
        if (!input.isConnected) return;
        input.focus();
        input.select();
      });
    } else {
      const name = document.createElement("span");
      name.className = "clay-people-me-name";
      name.textContent = mine.name;
      row.append(face(mine), name);
      if (canRename()) {
        const change = document.createElement("button");
        change.type = "button";
        change.className = "clay-menu-btn clay-menu-btn-small";
        change.textContent = "Change";
        change.addEventListener("click", () => {
          renaming = true;
          draw();
        });
        row.append(change);
      }
    }
    return section;
  }

  function draw() {
    if (!panel) return;
    const count = total();
    panel.textContent = "";

    const head = document.createElement("div");
    head.className = "clay-people-head";
    const title = document.createElement("h3");
    title.className = "clay-people-title";
    title.textContent = "Who's here";
    const sum = document.createElement("span");
    sum.className = "clay-people-sum";
    sum.textContent = plural(count, "person", "people");
    const x = document.createElement("button");
    x.type = "button";
    x.className = "clay-people-close";
    x.setAttribute("aria-label", "Close");
    x.innerHTML = CROSS;
    x.addEventListener("click", () => closePanel());
    head.append(title, sum, x);
    panel.append(head);

    if (snapshot.people.length) {
      const list = document.createElement("ul");
      list.className = "clay-people-list";
      for (const person of snapshot.people) {
        const row = document.createElement("li");
        row.className = "clay-people-row";
        const who = document.createElement("span");
        who.className = "clay-people-who";
        const name = document.createElement("strong");
        name.textContent = person.name;
        if (person.you) {
          const you = document.createElement("span");
          you.textContent = "(you)";
          name.append(you);
        }
        who.append(name);
        row.append(face(person), who);
        list.append(row);
      }
      panel.append(list);
    }

    if (snapshot.anonymous > 0) {
      const anon = document.createElement("p");
      anon.className = "clay-people-anon";
      anon.textContent =
        snapshot.anonymous === 1
          ? "1 other person is here without a shared name."
          : `${snapshot.anonymous} others are here without a shared name.`;
      panel.append(anon);
    }

    const mine = meSection();
    if (mine) panel.append(mine);
  }

  function openPanel(from) {
    closeMenu();
    if (panel) {
      closePanel();
      return;
    }
    opener = from;
    panel = document.createElement("div");
    panel.className = "clay-people";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Who's here");
    panel.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (renaming) {
        renaming = false;
        draw();
        panel.querySelector(".clay-people-me .clay-menu-btn")?.focus();
      } else {
        closePanel();
      }
    });
    draw();
    root.append(panel);
    roster?.setAttribute("aria-expanded", from === roster ? "true" : "false");
    panel.querySelector(".clay-people-close").focus();
  }

  function drawRoster() {
    const show = wantsRoster() && snapshot.supported && total() > 1;
    if (!show) {
      roster?.remove();
      roster = null;
      return;
    }
    if (!roster) {
      roster = document.createElement("button");
      roster.type = "button";
      roster.className = "clay-roster";
      roster.setAttribute("aria-haspopup", "dialog");
      roster.setAttribute("aria-expanded", panel ? "true" : "false");
      roster.addEventListener("click", () => openPanel(roster));
      root.insertBefore(roster, capsule);
    }
    const shown = snapshot.people.slice(0, ROSTER_FACES);
    const rest = total() - shown.length;
    const faces = document.createElement("span");
    faces.className = "clay-roster-faces";
    for (const person of shown) faces.append(face(person));
    roster.textContent = "";
    roster.append(faces);
    if (rest > 0) roster.append(plural(rest, "other", "others"));
    const names = shown.map((person) => person.name);
    roster.setAttribute("aria-label", `Who's here: ${names.join(", ")}${rest > 0 ? `${names.length ? " and " : ""}${plural(rest, "other", "others")}` : ""}`);
  }

  let itemLabel = null;

  function update() {
    const count = total();
    if (snapshot.supported && (count > 1 || canRename())) {
      const label = count > 1 ? `Who's here (${plural(count, "person", "people")})` : "Who's here";
      // Re-adding redraws the open menu, so only a changed label does it.
      if (label !== itemLabel) {
        itemLabel = label;
        addItem({ id: "clay.people", label, run: () => openPanel(capsule.querySelector(".clay-menu-goo")) });
      }
    } else {
      if (itemLabel !== null) removeItem("clay.people");
      itemLabel = null;
      closePanel({ restore: false });
    }
    drawRoster();
    if (panel && !renaming) {
      const active = root.getRootNode().activeElement;
      const focused = active && panel.contains(active) ? active.classList[0] : null;
      draw();
      if (focused) panel.querySelector(`.${focused}`)?.focus();
    }
  }

  document.addEventListener("click", (event) => {
    if (panel && !event.composedPath().includes(root)) closePanel({ restore: false });
  });
  document.addEventListener("clay:people", () => {
    if (!renaming) update();
  });

  import("../../sync/presence-store.js")
    .then(({ presence }) => {
      presence.subscribe((next) => {
        snapshot = next || snapshot;
        update();
      });
    })
    .catch(() => {});

  return { close: closePanel };
}
