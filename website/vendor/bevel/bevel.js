/*
 * bevel.js — the delegated runtime for the bevel UI kit, 0.1.0.
 * https://github.com/panphora/bevel
 *
 * One listener per interaction on `document`. No init(), no MutationObserver:
 * every current AND future element is handled, so injected, re-rendered, and
 * saved-and-reopened markup just works. Idempotent; safe to include twice.
 *
 * The markup carries the initial state (chips are real DOM, the slider fill is
 * an inline --bevel-value, native inputs hold their own value), so the page is
 * correct before this script runs. The script does two things on top:
 *   1. Drives the transitions (steppers, chips, tabs, drag order, previews,
 *      the grid's sort, select-all, expand, search and pages).
 *   2. Mirrors live control state back into attributes (checked, selected,
 *      value, the textarea's text), so document.documentElement.outerHTML
 *      round-trips every visible state of every bevel control.
 */
(function () {
  if (window.__bevel) return;
  window.__bevel = true;

  const X_SVG = '<svg aria-hidden="true" viewBox="0 0 256 256" fill="currentColor"><path d="M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z"/></svg>';

  const on = (type, selector, handler, options) => {
    document.addEventListener(type, (e) => {
      const target = e.target instanceof Element ? e.target.closest(selector) : null;
      if (target) handler(e, target);
    }, options);
  };
  const emit = (el, name, detail) => el.dispatchEvent(new CustomEvent(name, { bubbles: true, detail }));
  const nativeChange = (input) => {
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const clearInput = (input) => { input.value = ""; input.removeAttribute("value"); };

  /* ---------- state mirroring: the outerHTML contract ---------- */
  const MIRROR_VALUE = ".bevel-input, .bevel-number__input, .bevel-slider__input, .bevel-date__field, .bevel-sortable__field, .bevel-tags__input";
  on("input", MIRROR_VALUE, (e, input) => input.setAttribute("value", input.value));
  on("input", ".bevel-textarea", (e, area) => { area.textContent = area.value; });
  on("change", ".bevel-checkbox input, .bevel-toggle input, .bevel-table__pick input", (e, input) => {
    input.toggleAttribute("checked", input.checked);
  });
  on("change", ".bevel-radio input", (e, input) => {
    for (const r of document.querySelectorAll('input[type="radio"]')) {
      if (r.name === input.name && r.form === input.form) r.toggleAttribute("checked", r.checked);
    }
  });
  on("change", ".bevel-select__field", (e, select) => {
    for (const o of select.options) o.toggleAttribute("selected", o.selected);
  });

  /* ---------- number ---------- */
  on("click", ".bevel-number__step", (e, step) => {
    const input = step.closest(".bevel-number")?.querySelector(".bevel-number__input");
    if (!input || input.disabled) return;
    try { step.dataset.step === "down" ? input.stepDown() : input.stepUp(); } catch { return; }
    nativeChange(input);
  });

  /* ---------- slider ---------- */
  const percent = (input) => {
    const min = input.min === "" ? 0 : Number(input.min);
    const max = input.max === "" ? 100 : Number(input.max);
    if (!(max > min)) return "0%";
    const pct = ((Number(input.value) - min) / (max - min)) * 100;
    return `${+Math.min(100, Math.max(0, pct)).toFixed(2)}%`;
  };
  const syncSlider = (input) => {
    const wrap = input.closest(".bevel-slider");
    if (!wrap) return;
    wrap.style.setProperty("--bevel-value", percent(input));
    const out = wrap.closest(".bevel-sliderrow")?.querySelector("output, .bevel-sliderrow__value");
    if (out) { if (out.tagName === "OUTPUT") out.value = input.value; else out.textContent = input.value; }
  };
  on("input", ".bevel-slider__input", (e, input) => syncSlider(input));

  /* ---------- file ---------- */
  const fileName = (wrap) => wrap.querySelector(".bevel-file__name");
  const clearFile = (wrap, name) => {
    name.textContent = name.dataset.empty || "No file chosen";
    name.removeAttribute("data-filled");
    if (name.tagName === "A") name.removeAttribute("href");
    wrap.querySelector(".bevel-file__remove")?.remove();
  };
  on("change", ".bevel-file__input", (e, input) => {
    const wrap = input.closest(".bevel-file");
    const name = wrap && fileName(wrap);
    if (!name) return;
    if (!name.dataset.empty && !name.hasAttribute("data-filled")) name.dataset.empty = name.textContent;
    const files = input.files;
    if (files && files.length) {
      name.textContent = files.length === 1 ? files[0].name : `${files.length} files`;
      name.setAttribute("data-filled", "");
      if (!wrap.querySelector(".bevel-file__remove")) {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "bevel-file__remove";
        remove.setAttribute("aria-label", "Remove file");
        remove.innerHTML = X_SVG;
        name.after(remove);
      }
    } else clearFile(wrap, name);
  });
  on("click", ".bevel-file__remove", (e, button) => {
    const wrap = button.closest(".bevel-file");
    if (!wrap) return;
    const input = wrap.querySelector(".bevel-file__input");
    const name = fileName(wrap);
    if (input) { input.value = ""; nativeChange(input); }
    if (name && name.hasAttribute("data-filled")) clearFile(wrap, name);
    emit(wrap, "bevel:remove");
  });

  /* ---------- image ---------- */
  const showPreview = (wrap, src) => {
    const img = wrap.querySelector(".bevel-image__preview");
    const placeholder = wrap.querySelector(".bevel-image__placeholder");
    if (!img) return null;
    if (img.dataset.blob) { URL.revokeObjectURL(img.dataset.blob); delete img.dataset.blob; }
    if (src) { img.src = src; img.hidden = false; if (placeholder) placeholder.hidden = true; }
    else { img.removeAttribute("src"); img.hidden = true; if (placeholder) placeholder.hidden = false; }
    return img;
  };
  on("change", ".bevel-image__input", (e, input) => {
    const wrap = input.closest(".bevel-image");
    const file = input.files && input.files[0];
    if (!wrap) return;
    if (!file) { showPreview(wrap, null); return; }
    const url = URL.createObjectURL(file);
    const img = showPreview(wrap, url);
    if (img) img.dataset.blob = url; else URL.revokeObjectURL(url);
  });
  on("click", ".bevel-image__remove", (e, button) => {
    const wrap = button.closest(".bevel-image");
    const input = wrap?.querySelector(".bevel-image__input");
    if (!wrap) return;
    if (input) input.value = "";
    showPreview(wrap, null);
    emit(wrap, "bevel:remove");
  });

  /* ---------- tags ---------- */
  const addTag = (wrap, raw) => {
    const text = raw.trim();
    if (!text) return false;
    const taken = [...wrap.querySelectorAll(".bevel-tags__chip input")].some((i) => i.value.toLowerCase() === text.toLowerCase());
    if (taken) return false;
    const chip = document.createElement("span");
    chip.className = "bevel-tags__chip";
    chip.append(text);
    const hidden = document.createElement("input");
    hidden.type = "hidden";
    hidden.name = wrap.dataset.name || "tags[]";
    hidden.value = text;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "bevel-tags__remove";
    remove.setAttribute("aria-label", `Remove ${text}`);
    remove.textContent = "×";
    chip.append(hidden, remove);
    wrap.querySelector(".bevel-tags__input").before(chip);
    emit(wrap, "bevel:tags");
    return true;
  };
  on("keydown", ".bevel-tags__input", (e, input) => {
    const wrap = input.closest(".bevel-tags");
    if (!wrap) return;
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      if (addTag(wrap, input.value) || !input.value.trim()) clearInput(input);
    } else if (e.key === "Backspace" && !input.value) {
      const chips = wrap.querySelectorAll(".bevel-tags__chip");
      const last = chips[chips.length - 1];
      if (last) { last.remove(); emit(wrap, "bevel:tags"); }
    }
  });
  on("focusout", ".bevel-tags__input", (e, input) => {
    const wrap = input.closest(".bevel-tags");
    if (wrap && input.value.trim() && addTag(wrap, input.value)) clearInput(input);
  });
  on("click", ".bevel-tags__remove", (e, button) => {
    const wrap = button.closest(".bevel-tags");
    button.closest(".bevel-tags__chip")?.remove();
    if (wrap) emit(wrap, "bevel:tags");
  });
  on("click", ".bevel-tags", (e, wrap) => {
    if (e.target === wrap) wrap.querySelector(".bevel-tags__input")?.focus();
  });

  /* ---------- sortable ---------- */
  let drag = null;
  const rows = (list) => [...list.querySelectorAll(":scope > .bevel-sortable__item")];
  on("pointerdown", ".bevel-sortable__grip", (e, grip) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const item = grip.closest(".bevel-sortable__item");
    const list = item?.parentElement;
    if (!list) return;
    drag = { item, list, id: e.pointerId, from: rows(list).indexOf(item) };
    item.classList.add("is-dragging");
    grip.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  document.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const { item, list } = drag;
    for (const sibling of rows(list)) {
      if (sibling === item) continue;
      const box = sibling.getBoundingClientRect();
      const mid = box.top + box.height / 2;
      const follows = item.compareDocumentPosition(sibling) & Node.DOCUMENT_POSITION_FOLLOWING;
      if (follows && e.clientY > mid) sibling.after(item);
      else if (!follows && e.clientY < mid) sibling.before(item);
    }
  });
  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const { item, list, from } = drag;
    item.classList.remove("is-dragging");
    drag = null;
    const to = rows(list).indexOf(item);
    if (to !== from) emit(list, "bevel:reorder", { from, to });
  };
  document.addEventListener("pointerup", endDrag);
  document.addEventListener("pointercancel", endDrag);

  /* ---------- chip ---------- */
  on("click", "[data-bevel-chip]", (e, button) => {
    const chip = button.closest(".bevel-chip");
    if (!chip) return;
    const action = button.dataset.bevelChip;
    if (action === "open") chip.classList.add("bevel-chip--open");
    else if (action === "collapse") chip.classList.remove("bevel-chip--open");
    else if (action === "changes") chip.querySelector(".bevel-chip__panel")?.classList.toggle("is-changes");
  });

  /* ---------- tabs ---------- */
  const selectTab = (tab) => {
    const list = tab.closest(".bevel-tabs");
    if (!list) return;
    for (const t of list.querySelectorAll(".bevel-tabs__tab")) {
      const selected = t === tab;
      t.setAttribute("aria-selected", String(selected));
      t.tabIndex = selected ? 0 : -1;
      const id = t.getAttribute("aria-controls");
      const panel = id && document.getElementById(id);
      if (panel) panel.hidden = !selected;
    }
    emit(list, "bevel:tab", { tab });
  };
  on("click", ".bevel-tabs__tab", (e, tab) => selectTab(tab));
  on("keydown", ".bevel-tabs__tab", (e, tab) => {
    const list = tab.closest(".bevel-tabs");
    if (!list) return;
    const tabs = [...list.querySelectorAll(".bevel-tabs__tab")];
    const i = tabs.indexOf(tab);
    const next = e.key === "ArrowRight" ? tabs[(i + 1) % tabs.length]
      : e.key === "ArrowLeft" ? tabs[(i - 1 + tabs.length) % tabs.length]
      : e.key === "Home" ? tabs[0]
      : e.key === "End" ? tabs[tabs.length - 1]
      : null;
    if (!next) return;
    e.preventDefault();
    next.focus();
    selectTab(next);
  });

  /* ---------- segmented control ---------- */
  on("click", ".bevel-seg > .bevel-button[aria-pressed]", (e, button) => {
    const group = button.parentElement;
    for (const b of group.querySelectorAll(":scope > .bevel-button[aria-pressed]")) b.setAttribute("aria-pressed", String(b === button));
    emit(group, "bevel:seg", { value: button.dataset.value ?? button.textContent.trim(), button });
  });

  /* ---------- grid ---------- */
  /* Sort, select-all, expand, search and pages. Rows never leave the DOM:
     search and paging set hidden, sorting reorders, and every state is an
     attribute (aria-sort, checked, aria-expanded, data-page, value). The
     select-all's mixed flag and a detail row's hidden are derived from the
     rows on every layout, so a saved page recovers them. */
  const gridOf = (el) => el.closest(".bevel-grid");
  const gridRows = (grid) => [...grid.querySelectorAll(".bevel-grid__table > tbody > .bevel-grid__row")];
  const detailOf = (row) => {
    const next = row.nextElementSibling;
    return next && next.classList.contains("bevel-grid__detail") ? next : null;
  };
  const isOpen = (row) => row.querySelector(".bevel-grid__expand")?.getAttribute("aria-expanded") === "true";
  const pageButton = (n, current, standalone = false) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `bevel-button bevel-button--small ${standalone ? "bevel-pagination__page" : "bevel-grid__page"}`;
    b.dataset[standalone ? "bevelPage" : "page"] = n;
    b.innerHTML = '<span class="bevel-button__label"></span>';
    b.firstChild.textContent = n;
    if (n === current) b.setAttribute("aria-current", "page");
    return b;
  };
  const renderPages = (pages, total, current) => {
    const standalone = pages.classList.contains("bevel-pagination__pages");
    const selector = standalone ? "data-bevel-page" : "data-page";
    const prev = pages.querySelector(`[${selector}="prev"]`);
    const next = pages.querySelector(`[${selector}="next"]`);
    const items = [];
    if (total <= 7) for (let n = 1; n <= total; n++) items.push(n);
    else {
      items.push(1);
      if (current > 3) items.push("…");
      for (let n = Math.max(2, current - 1); n <= Math.min(total - 1, current + 1); n++) items.push(n);
      if (current < total - 2) items.push("…");
      items.push(total);
    }
    const rendered = [...pages.children].filter(node => node !== prev && node !== next);
    const matches = rendered.length === items.length && rendered.every((node, index) => items[index] === "…" ? node.textContent === "…" && node.getAttribute("aria-hidden") === "true" : node.getAttribute(selector) === String(items[index]) && node.hasAttribute("aria-current") === (items[index] === current));
    if (!matches) {
      rendered.forEach(node => node.remove());
      const frag = document.createDocumentFragment();
      for (const n of items) {
        if (n === "…") {
          const gap = document.createElement("span");
          gap.className = standalone ? "bevel-pagination__gap" : "bevel-grid__gap";
          gap.setAttribute("aria-hidden", "true");
          gap.textContent = n;
          frag.append(gap);
        } else frag.append(pageButton(n, current, standalone));
      }
      if (next) next.before(frag); else pages.append(frag);
    }
    if (prev && prev.disabled !== (current <= 1)) prev.disabled = current <= 1;
    if (next && next.disabled !== (current >= total)) next.disabled = current >= total;
  };
  const renderStandalonePages = (list, total, current) => {
    const previous = list.querySelector('[data-bevel-page="prev"]'), next = list.querySelector('[data-bevel-page="next"]'), items = [];
    if (total <= 7) for (let page = 1; page <= total; page++) items.push(page);
    else if (current <= 2) items.push(1, 2, 3, "…", total);
    else if (current >= total - 1) items.push(1, "…", total - 2, total - 1, total);
    else {
      items.push(1);
      if (current > 3) items.push("…");
      items.push(current - 1, current, current + 1);
      if (current < total - 2) items.push("…");
      items.push(total);
    }
    const rendered = [...list.children].filter((item) => item !== previous && item !== next), matches = rendered.length === items.length && rendered.every((node, index) => items[index] === "…" ? node.matches('.bevel-pagination__gap[aria-hidden="true"]') && node.textContent === "…" : node.matches(`.bevel-pagination__page[data-bevel-page="${items[index]}"]`) && node.hasAttribute("aria-current") === (items[index] === current));
    if (!matches) {
      rendered.forEach((item) => item.remove());
      for (const item of items) {
        const node = item === "…" ? document.createElement("span") : pageButton(item, current, true);
        if (item === "…") { node.className = "bevel-pagination__gap"; node.setAttribute("aria-hidden", "true"); node.textContent = item; }
        if (next) next.before(node); else list.append(node);
      }
    }
    if (previous && previous.disabled !== (current <= 1)) previous.disabled = current <= 1;
    if (next && next.disabled !== (current >= total)) next.disabled = current >= total;
  };
  const syncPick = (grid) => {
    const head = grid.querySelector(".bevel-grid__table > thead .bevel-grid__pick input");
    const all = [...grid.querySelectorAll(".bevel-grid__table > tbody .bevel-grid__pick input")];
    const shown = all.filter((i) => !i.disabled && !i.closest("tr").hidden);
    const on = shown.filter((i) => i.checked).length;
    if (head) {
      const checked = shown.length > 0 && on === shown.length, mixed = on > 0 && on < shown.length;
      if (head.checked !== checked) head.checked = checked;
      if (head.indeterminate !== mixed) head.indeterminate = mixed;
      if (head.hasAttribute("checked") !== checked) head.toggleAttribute("checked", checked);
    }
    const out = grid.querySelector(".bevel-grid__selected");
    if (out) { const count = String(all.filter(i => i.checked).length); if (out.textContent !== count) out.textContent = count; }
  };
  const matchesView = (row, view) => {
    const values = (view?.dataset.gridMatch || "").toLowerCase().split("|").filter(Boolean);
    return !values.length || values.includes(cellKey(row, Number(view.dataset.gridColumn), "text"));
  };
  const syncStats = (grid, rows) => {
    for (const output of grid.querySelectorAll("[data-grid-aggregate]")) {
      const values = rows.map((row) => cellKey(row, Number(output.dataset.gridColumn), "number"));
      const sum = values.reduce((total, value) => total + value, 0);
      const kind = output.dataset.gridAggregate;
      const value = kind === "count" ? rows.length : kind === "average" ? (values.length ? sum / values.length : 0) : sum;
      const format = output.dataset.gridFormat;
      const text = format === "currency" ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value)
        : format === "percent" ? `${Math.round(value)}%` : new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
      if (output.textContent !== text) output.textContent = text;
    }
  };
  const filterDefinitions = root => { try { const node=root.querySelector('script[type="application/json"][data-bevel-filter-fields]'); return node ? JSON.parse(node.textContent) : []; } catch { return []; } };
  const filterRead = root => ({ match: root.dataset.bevelMatch === "any" ? "any" : "all", rules:[...root.querySelectorAll('.bevel-filter__rules > .bevel-filter__rule')].map(row=>({ key:row.dataset.bevelKey, field:row.dataset.bevelField, operator:row.dataset.bevelOperator, value:row.querySelector('[data-bevel-filter-value]')?.value ?? "" })) });
  const filterEmpty = value => value == null || value === "";
  const filterDate = value => { if(!/^\d{4}-\d{2}-\d{2}$/.test(String(value||"")))return false; const date=new Date(`${value}T00:00:00Z`); return !Number.isNaN(date.valueOf())&&date.toISOString().slice(0,10)===value; };
  const filterOperators = { text: ["equals", "contains", "starts-with", "is-empty"], number: ["eq", "ne", "gt", "gte", "lt", "lte", "is-empty"], date: ["before", "on", "after", "is-empty"], enum: ["is", "is-not", "is-empty"] };
  const filterRuleValid = (rule, field) => {
    if (!field || !filterOperators[field.type || "text"]?.includes(rule.operator)) return false;
    if (rule.operator === "is-empty") return true;
    if (field.type === "number") return String(rule.value).trim() !== "" && Number.isFinite(Number(rule.value));
    if (field.type === "date") return filterDate(rule.value);
    if (field.type === "enum" && field.options) return field.options.some(option => String(option.id) === String(rule.value));
    return true;
  };
  const refreshFilterRule = row => {
    const field = filterDefinitions(row.closest(".bevel-filter")).find(item => item.id === row.dataset.bevelField);
    if (!field) return;
    const operator = row.querySelector("[data-bevel-filter-operator]"), previous = row.querySelector("[data-bevel-filter-value]");
    if (!operator || !previous) return;
    const choices = filterOperators[field.type || "text"], labels = { "starts-with": "starts with", "is-empty": "is empty", "is-not": "is not", eq: "=", ne: "≠", gt: ">", gte: "≥", lt: "<", lte: "≤" };
    const selected = choices.includes(row.dataset.bevelOperator) ? row.dataset.bevelOperator : choices[0];
    operator.replaceChildren(...choices.map(value => { const option = document.createElement("option"); option.value = value; option.textContent = labels[value] || value; option.selected = value === selected; option.toggleAttribute("selected", option.selected); return option; }));
    row.dataset.bevelOperator = selected;
    const value = previous.value, input = document.createElement(field.type === "enum" && field.options ? "select" : "input");
    input.dataset.bevelFilterValue = ""; input.setAttribute("aria-label", `${field.label || field.id} filter value`);
    if (input.tagName === "SELECT") {
      input.className = "bevel-select__field";
      for (const option of field.options) { const node = document.createElement("option"); node.value = String(option.id); node.textContent = option.label; input.append(node); }
      input.value = field.options.some(option => String(option.id) === value) ? value : String(field.options[0]?.id || "");
      for (const option of input.options) option.toggleAttribute("selected", option.selected);
    } else { input.type = "text"; input.className = "bevel-input bevel-input--small"; input.value = value; input.setAttribute("value", value); if (field.type === "number") input.inputMode = "decimal"; }
    const oldWrapper = previous.parentElement.classList.contains("bevel-select") ? previous.parentElement : previous;
    if (input.tagName === "SELECT") { const wrapper = document.createElement("span"); wrapper.className = "bevel-select"; wrapper.append(input); oldWrapper.replaceWith(wrapper); }
    else oldWrapper.replaceWith(input);
    input.disabled = selected === "is-empty";
  };
  const filterMatches = (record, expression, fields=[]) => {
    const definitions = new Map(fields.map(field=>[field.id,field])), rules=expression?.rules || [];
    const test = rule => { const field=definitions.get(rule.field); if(!field)return false; const actual=record[rule.field], op=rule.operator, wanted=rule.value; if(op==="is-empty")return filterEmpty(actual); if(field.type==="number"){ if(filterEmpty(actual)||filterEmpty(wanted)||String(actual).trim()===""||String(wanted).trim()===""||!Number.isFinite(Number(actual))||!Number.isFinite(Number(wanted)))return false; const a=Number(actual),b=Number(wanted); return op==="eq"?a===b:op==="ne"?a!==b:op==="gt"?a>b:op==="gte"?a>=b:op==="lt"?a<b:op==="lte"?a<=b:false; } if(field.type==="date"){ if(!filterDate(actual)||!filterDate(wanted))return false; return op==="before"?actual<wanted:op==="on"?actual===wanted:op==="after"?actual>wanted:false; } if(field.type==="enum")return op==="is"?String(actual)===String(wanted):op==="is-not"?String(actual)!==String(wanted):false; const a=String(actual??"").toLowerCase(),b=String(wanted??"").toLowerCase(); return op==="equals"?a===b:op==="contains"?a.includes(b):op==="starts-with"?a.startsWith(b):false; };
    return !rules.length || (expression.match==="any" ? rules.some(test) : rules.every(test));
  };
  const gridRecord = row => Object.fromEntries([...row.children].filter(cell=>cell.dataset.bevelColumn).map(cell=>[cell.dataset.bevelColumn,cell.dataset.value ?? cell.dataset.sort ?? cell.textContent.trim()]));
  const gridFilter = grid => { const root=grid.id&&document.querySelector(`.bevel-filter[data-bevel-grid="${CSS.escape(grid.id)}"]`); if(!root)return null; return { expression:filterRead(root), fields:filterDefinitions(root) }; };
  const searchedGridRows = grid => {
    const query = (grid.querySelector(".bevel-grid__search")?.value || "").trim().toLowerCase(), activeFilter = gridFilter(grid);
    return gridRows(grid).filter(row => (!query || row.textContent.toLowerCase().includes(query)) && (!activeFilter || filterMatches(gridRecord(row), activeFilter.expression, activeFilter.fields)));
  };
  const layoutGrid = (grid) => {
    const size = Number(grid.dataset.pageSize) || 0;
    const rows = gridRows(grid);
    const searched = searchedGridRows(grid);
    const view = grid.querySelector('.bevel-grid__view[aria-pressed="true"]');
    const matches = new Set(searched.filter((row) => matchesView(row, view)));
    const resultLabel = grid.closest(".bevel-grid-result")?.querySelector(".bevel-grid-result__label");
    if (resultLabel) { const label = `Applied / ${matches.size} matching record${matches.size === 1 ? "" : "s"}`; if (resultLabel.textContent !== label) resultLabel.textContent = label; }

    for (const tab of grid.querySelectorAll(".bevel-grid__view")) {
      const count = tab.querySelector("span");
      if (count) { const text = String(searched.filter(row => matchesView(row, tab)).length); if (count.textContent !== text) count.textContent = text; }
    }
    syncStats(grid, [...matches]);
    const total = size ? Math.max(1, Math.ceil(matches.size / size)) : 1;
    const current = Math.min(total, Math.max(1, Number(grid.dataset.page) || 1));
    if (size && grid.dataset.page !== String(current)) grid.dataset.page = String(current);
    const first = size ? (current - 1) * size : 0;
    const last = size ? first + size : matches.size;
    let i = 0;
    for (const row of rows) {
      const match = matches.has(row);
      const show = match && i >= first && i < last;
      if (match) i++;
      if (row.hidden !== !show) row.hidden = !show;
      const detail = detailOf(row);
      if (detail && detail.hidden !== (!show || !isOpen(row))) detail.hidden = !show || !isOpen(row);
    }
    for (const group of grid.querySelectorAll(".bevel-grid__table > tbody > .bevel-grid__group")) {
      let any = false;
      for (let tr = group.nextElementSibling; tr && !tr.classList.contains("bevel-grid__group"); tr = tr.nextElementSibling) {
        if (tr.classList.contains("bevel-grid__row") && !tr.hidden) { any = true; break; }
      }
      if (group.hidden !== !any) group.hidden = !any;
    }
    const empty = grid.querySelector(".bevel-grid__table > tbody > .bevel-grid__empty");
    if (empty && rows.length && empty.hidden !== (matches.size > 0)) empty.hidden = matches.size > 0;
    const pages = grid.querySelector(".bevel-grid__pages");
    if (pages && size) renderPages(pages, total, current);
    const range = grid.querySelector(".bevel-grid__range");
    if (range) { const text = matches.size ? `${first + 1} to ${Math.min(last, matches.size)} of ${matches.size}` : "0 of 0"; if (range.textContent !== text) range.textContent = text; }
    syncPick(grid);
    if (grid.id) document.querySelectorAll(`.bevel-pagination[data-bevel-target="${CSS.escape(grid.id)}"]`).forEach(pager => refreshPager(pager));
  };
  const cellKey = (row, index, type) => {
    const cell = row.children[index];
    const raw = cell ? (cell.dataset.sort ?? cell.textContent.trim()) : "";
    if (type === "number") return Number(raw.replace(/[^\d.-]/g, "")) || 0;
    return raw.toLowerCase();
  };
  on("click", ".bevel-grid__sort", (e, button) => {
    const th = button.closest("th");
    const table = th?.closest(".bevel-grid__table");
    const grid = table && gridOf(table);
    if (!grid) return;
    const dir = th.getAttribute("aria-sort") === "ascending" ? "descending" : "ascending";
    if (grid.dataset.bevelDataMode === "remote") {
      remoteRequest(grid, "sort", th.dataset.bevelColumn || String([...th.parentElement.children].indexOf(th)), th.getAttribute("aria-sort") || "none", dir);
      return;
    }
    for (const h of table.querySelectorAll("thead [aria-sort]")) h.setAttribute("aria-sort", h === th ? dir : "none");
    const index = [...th.parentElement.children].indexOf(th);
    const type = th.dataset.type || "text";
    const sign = dir === "ascending" ? 1 : -1;
    const tbody = table.tBodies[0];
    const segments = [{ head: [], units: [] }];
    for (const tr of [...tbody.children]) {
      const seg = segments[segments.length - 1];
      if (tr.classList.contains("bevel-grid__group")) segments.push({ head: [tr], units: [] });
      else if (tr.classList.contains("bevel-grid__row")) seg.units.push([tr]);
      else if (seg.units.length) seg.units[seg.units.length - 1].push(tr);
      else seg.head.push(tr);
    }
    for (const seg of segments) {
      seg.units.sort((a, b) => {
        const x = cellKey(a[0], index, type), y = cellKey(b[0], index, type);
        return x < y ? -sign : x > y ? sign : 0;
      });
      tbody.append(...seg.head, ...seg.units.flat());
    }
    layoutGrid(grid);
    emit(grid, "bevel:sort", { index, dir, th });
  });
  on("change", ".bevel-grid__table > thead .bevel-grid__pick input", (e, input) => {
    const grid = gridOf(input);
    if (!grid) return;
    for (const i of grid.querySelectorAll(".bevel-grid__table > tbody .bevel-grid__pick input")) {
      if (i.disabled || i.closest("tr").hidden) continue;
      i.checked = input.checked;
      i.toggleAttribute("checked", i.checked);
    }
    syncPick(grid);
    emit(grid, "bevel:select", { all: input.checked });
  });
  on("change", ".bevel-grid__table > tbody .bevel-grid__pick input", (e, input) => {
    const grid = gridOf(input);
    if (!grid) return;
    syncPick(grid);
    emit(grid, "bevel:select", { row: input.closest("tr"), checked: input.checked });
  });
  on("click", ".bevel-grid__expand", (e, button) => {
    const row = button.closest("tr");
    const open = button.getAttribute("aria-expanded") !== "true";
    button.setAttribute("aria-expanded", String(open));
    const detail = detailOf(row) || document.getElementById(button.getAttribute("aria-controls") || "");
    if (detail) detail.hidden = !open;
    const grid = gridOf(button);
    if (grid) emit(grid, "bevel:expand", { row, open });
  });
  const changeGridPage = (grid, token) => {
    if (!grid) return false;
    const current = Number(grid.dataset.page) || 1;
    const want = token === "prev" ? current - 1 : token === "next" ? current + 1 : Number(token);
    if (!want || want < 1) return false;
    if (grid.dataset.bevelDataMode === "remote") {
      const total = Number(grid.dataset.bevelTotal), size = Number(grid.dataset.pageSize) || 10;
      if (grid.hasAttribute("data-bevel-total") && want > Math.max(1, Math.ceil(Math.max(0, total) / size))) return false;
      remoteRequest(grid, "page", String(want), current, want);
      return true;
    }
    grid.dataset.page = String(want);
    layoutGrid(grid);
    emit(grid, "bevel:page", { page: Number(grid.dataset.page) });
    return true;
  };
  on("click", ".bevel-grid__page", (e, button) => {
    if (button.disabled) return;
    changeGridPage(gridOf(button), button.dataset.page);
  });
  on("click", ".bevel-grid__view", (e, button) => {
    const grid = gridOf(button);
    if (!grid) return;
    if (grid.dataset.bevelDataMode === "remote") { remoteRequest(grid, "view", button.dataset.value || "", grid.querySelector('.bevel-grid__view[aria-pressed="true"]')?.dataset.value || "", button.dataset.value || ""); return; }
    for (const view of grid.querySelectorAll(".bevel-grid__view")) view.setAttribute("aria-pressed", String(view === button));
    if (grid.dataset.pageSize) grid.dataset.page = "1";
    layoutGrid(grid);
    const scroll = grid.querySelector(".bevel-grid__scroll");
    if (scroll) scroll.scrollTop = 0;
    emit(grid, "bevel:view", { value: button.dataset.value, button });
  });
  on("input", ".bevel-grid__search", (e, input) => {
    const grid = gridOf(input);
    if (!grid) return;
    if (grid.dataset.bevelDataMode === "remote") { input.setAttribute("value", input.value); remoteRequest(grid, "search", "", grid.dataset.bevelQuery || "", input.value); return; }
    if (grid.dataset.pageSize) grid.dataset.page = "1";
    layoutGrid(grid);
    emit(grid, "bevel:search", { query: input.value });
  });

  /* ---------- files table ---------- */
  const filesPicks = (root) => [...root.querySelectorAll(".bevel-files__table > tbody .bevel-files__pick input")].filter((input) => !input.disabled);
  const syncFiles = (root) => {
    const head = root.querySelector(".bevel-files__table > thead .bevel-files__pick input");
    if (!head) return;
    const picks = filesPicks(root), count = picks.filter((input) => input.checked).length;
    const checked = picks.length > 0 && count === picks.length, mixed = count > 0 && !checked;
    if (head.checked !== checked) head.checked = checked;
    if (head.indeterminate !== mixed) head.indeterminate = mixed;
    if (head.hasAttribute("checked") !== checked) head.toggleAttribute("checked", checked);
  };
  on("change", ".bevel-files__table > thead .bevel-files__pick input", (e, input) => {
    const root = input.closest(".bevel-files");
    if (!root) return;
    for (const pick of filesPicks(root)) {
      pick.checked = input.checked;
      pick.toggleAttribute("checked", pick.checked);
    }
    syncFiles(root);
    emit(root, "bevel:select", { all: input.checked });
  });
  on("change", ".bevel-files__table > tbody .bevel-files__pick input", (e, input) => {
    const root = input.closest(".bevel-files");
    if (!root) return;
    const row = input.closest("tr");
    syncFiles(root);
    emit(root, "bevel:select", { row, key: row?.dataset.bevelKey ?? "", checked: input.checked });
  });
  on("click", ".bevel-files__sort", (e, button) => {
    const th = button.closest("th"), root = button.closest(".bevel-files");
    if (!th || !root) return;
    const direction = th.getAttribute("aria-sort") === "ascending" ? "descending" : "ascending";
    for (const head of th.parentElement.querySelectorAll("th[aria-sort]")) head.setAttribute("aria-sort", head === th ? direction : "none");
    emit(root, "bevel:sort", { column: th.dataset.bevelColumn ?? "", direction, th });
  });
  on("click", ".bevel-files__row", (e, row) => {
    if (!row.contains(e.target) || e.target.closest('a, button, input, label, select, textarea, summary, [role="button"], [role="menuitem"], .bevel-files__pick')) return;
    row.querySelector(".bevel-files__title")?.click();
  });

  /* ---------- functional component foundation ---------- */
  const sessions = new Map();
  let overlaySequence = Date.now();
  const uploadFiles = new WeakMap();
  const uploadSize = bytes => bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 1024)} KB`;
  const wizardForms = new Map();
  const rootFor = (el, selector) => el?.closest(selector);
  const disabled = (el) => !el || el.disabled || el.readOnly || el.getAttribute("aria-disabled") === "true" || !!el.closest("fieldset:disabled");
  const targetById = (id) => id ? document.getElementById(id) : null;
  const componentName = (root) => [...root.classList].find((name) => /^bevel-(modal|menu|drawer|popconfirm|combobox|multiselect|choice-card|dropzone|inline-edit|settings|errors|split-button|app-shell|sidebar|toolbar|bulk-bar|breadcrumbs|pagination|file-tree|tree|wizard|action-banner|code|diff|activity|stats|avatars|chart|filter|columns|split|richtext|kanban|grid|files)$/.test(name))?.slice(6) || "component";
  const jsonValue = (value) => value == null || typeof value !== "object" ? value : JSON.parse(JSON.stringify(value));
  const transition = (root, action, key, previous, next, mutate, source = "user") => {
    const detail = { component: componentName(root), action, key: String(key ?? ""), previous: jsonValue(previous), next: jsonValue(next) };
    if (!root.dispatchEvent(new CustomEvent("bevel:beforechange", { bubbles: true, cancelable: true, detail }))) return false;
    mutate();
    if (source !== "external") emit(root, "bevel:change", detail);
    return true;
  };
  const action = (root, name, key = "") => emit(root, "bevel:action", { component: componentName(root), action: name, key: String(key) });
  const error = (root, code, message) => {
    emit(root, "bevel:error", { component: componentName(root), code, message });
    console.error(`[Bevel ${code}] ${message}`);
  };
  const focusable = (root) => [...root.querySelectorAll("button,a[href],input,select,textarea,[tabindex]")].find((el) => !disabled(el) && el.tabIndex >= 0 && !el.hidden);
  const panelTrigger = (panel) => {
    const id = panel.id;
    return id ? document.querySelector(`[role="combobox"][aria-controls="${CSS.escape(id)}"],[data-bevel-open="${CSS.escape(id)}"]`) : null;
  };
  const setExpanded = (panel, value) => {
    if (!panel.id) return;
    for (const control of document.querySelectorAll(`[aria-controls="${CSS.escape(panel.id)}"]`)) control.setAttribute("aria-expanded", String(value));
  };
  const isModal = (root) => root.matches("dialog.bevel-modal, dialog.bevel-drawer");
  const isAnchored = (root) => root.matches(".bevel-menu,.bevel-popconfirm,.bevel-combobox__listbox,.bevel-multiselect__panel");
  const opened = () => [...document.querySelectorAll("[data-bevel-open]:is(dialog,[popover])")].filter((el) => el.hasAttribute("open") || el.matches(":popover-open")).sort((a, b) => (sessions.get(a)?.openOrder || Number(a.dataset.bevelOpenOrder) || 0) - (sessions.get(b)?.openOrder || Number(b.dataset.bevelOpenOrder) || 0));
  const position = (panel, trigger) => {
    const floating = window.FloatingUIDOM;
    if (!floating) {
      error(panel, "missing-positioner", "Anchored components require the vendored Floating UI core and DOM scripts.");
      return false;
    }
    let active = true;
    const middleware = [floating.offset(8), floating.flip(), floating.shift({ padding: 8 }), floating.size({ padding: 8, apply({ availableHeight, elements }) { if (active) elements.floating.style.setProperty("--bevel-available-height", `${Math.max(120, availableHeight)}px`); } })];
    const arrow = panel.querySelector("[data-bevel-arrow]");
    if (arrow) middleware.push(floating.arrow({ element: arrow }));
    const reference = panel.matches(".bevel-combobox__listbox,.bevel-multiselect__panel") ? trigger.closest(".bevel-combobox__control,.bevel-multiselect__control") || trigger : trigger;
    const update = () => floating.computePosition(reference, panel, { strategy: "fixed", placement: panel.dataset.bevelPlacement || "bottom-start", middleware }).then(({ x, y, placement, middlewareData }) => {
      if (!active || !panel.isConnected) return;
      panel.style.left = `${x}px`; panel.style.top = `${y}px`; panel.dataset.bevelActualPlacement = placement;
      if (arrow && middlewareData.arrow) {
        arrow.style.left = middlewareData.arrow.x == null ? "" : `${middlewareData.arrow.x}px`;
        arrow.style.top = middlewareData.arrow.y == null ? "" : `${middlewareData.arrow.y}px`;
      }
    });
    const stop = floating.autoUpdate(reference, panel, update);
    const cleanup = () => { active = false; stop(); };
    panel.dataset.bevelGeometry = "";
    sessions.set(panel, { ...(sessions.get(panel) || {}), cleanup, trigger });
    return true;
  };
  const closeOverlay = (root, { reason = "api", source = "user", focus = true } = {}) => {
    if (!root || !(root.hasAttribute("open") || root.matches(":popover-open") || root.hasAttribute("data-bevel-open"))) return false;
    const session = sessions.get(root);
    const commit = () => {
      session?.cleanup?.(); sessions.delete(root);
      root.removeAttribute("data-bevel-open");
      if (root.matches("dialog") && root.open) root.close();
      else if (root.matches("[popover]") && root.matches(":popover-open")) root.hidePopover();
      const trigger = session?.trigger || panelTrigger(root);
      trigger?.setAttribute("aria-expanded", "false");
      setExpanded(root, false);
      root.style.removeProperty("left"); root.style.removeProperty("top"); root.style.removeProperty("--bevel-available-height");
      root.removeAttribute("data-bevel-geometry");
      if (focus && trigger?.isConnected && !disabled(trigger)) trigger.focus();
    };
    return transition(root, "close", root.id, true, false, commit, source);
  };
  const openOverlay = (root, { trigger = panelTrigger(root), source = "user" } = {}) => {
    if (!root || root.hasAttribute("open") || root.matches(":popover-open")) return false;
    if (!(root instanceof HTMLDialogElement) && !root.matches("[popover]")) { error(root, "unsupported-overlay", "Overlay roots must be a dialog or manual popover."); return false; }
    if (isAnchored(root) && (!trigger || disabled(trigger))) return false;
    if (root.matches(".bevel-combobox__listbox") && (disabled(root.closest(".bevel-combobox")) || disabled(root.closest(".bevel-combobox").querySelector('[role="combobox"]')))) return false;
    if (isAnchored(root) && !window.FloatingUIDOM) { error(root, "missing-positioner", "Anchored components require the vendored Floating UI core and DOM scripts."); return false; }
    if (isModal(root)) {
      for (const panel of opened().filter((el) => isAnchored(el) && !root.contains(el))) if (!closeOverlay(panel, { reason: "modal-open", focus: false })) return false;
    }
    const commit = () => {
      root.setAttribute("data-bevel-open", "");
      if (isModal(root)) {
        root.dataset.bevelOpenOrder = String(++overlaySequence);
        root.showModal();
      } else {
        root.showPopover();
        position(root, trigger);
      }
      sessions.set(root, { ...(sessions.get(root) || {}), trigger, openOrder: ++overlaySequence });
      if (trigger) trigger.setAttribute("aria-expanded", "true");
      setExpanded(root, true);
      if (!root.matches(".bevel-combobox__listbox") && (source !== "external" || !document.activeElement || document.activeElement === document.body)) {
        let interrupted = false;
        const interrupt = () => { interrupted = true; };
        document.addEventListener("keydown", interrupt, true); document.addEventListener("pointerdown", interrupt, true);
        requestAnimationFrame(() => {
          document.removeEventListener("keydown", interrupt, true); document.removeEventListener("pointerdown", interrupt, true);
          if (!interrupted) (root.querySelector("[autofocus]") || focusable(root))?.focus();
        });
      }
    };
    return transition(root, "open", root.id, false, true, commit, source);
  };

  const requestScopes = new Map();
  let requestSequence = 0;
  const remoteRequest = (root, name, key, previous, next, scope = name) => {
    const requestId = `bevel-${Date.now().toString(36)}-${++requestSequence}`;
    const scopes = requestScopes.get(root) || new Map();
    scopes.set(scope, requestId); requestScopes.set(root, scopes);
    root.toggleAttribute("data-bevel-pending", true);
    emit(root, "bevel:request", { component: componentName(root), action: name, key: String(key ?? ""), requestId, revision: root.dataset.bevelRevision || null, previous: jsonValue(previous), next: jsonValue(next) });
    return requestId;
  };
  const localOrRemote = (root, name, key, previous, next, mutate, scope) => root.dataset.bevelDataMode === "remote"
    ? (remoteRequest(root, name, key, previous, next, scope), true)
    : transition(root, name, key, previous, next, mutate);

  const refreshCombo = (root, restore = false) => {
    const input = root.querySelector('[role="combobox"]');
    const hidden = root.querySelector('input[type="hidden"]');
    const list = root.querySelector('[role="listbox"]');
    if (!input || !list) return;
    const key = hidden?.value || root.dataset.bevelValue || "";
    const option = [...list.querySelectorAll('[role="option"]')].find((el) => el.dataset.bevelKey === key && el.getAttribute("aria-disabled") !== "true");
    for (const el of list.querySelectorAll('[role="option"]')) { const selected = String(el === option); if (el.getAttribute("aria-selected") !== selected) el.setAttribute("aria-selected", selected); }
    if (root.dataset.bevelValue !== key) root.dataset.bevelValue = key;
    if (hidden && hidden.getAttribute("value") !== key) hidden.setAttribute("value", key);
    const label = option?.dataset.bevelLabel || option?.textContent.trim() || "";
    if (restore || document.activeElement !== input || !input.value) { input.value = label; if (input.getAttribute("value") !== label) input.setAttribute("value", label); }
    input.setCustomValidity(input.required && (!option || input.value !== label) ? "Choose an option." : "");
  };
  const refreshMulti = (root) => {
    const name = root.dataset.bevelName || "values[]";
    const selected = [...root.querySelectorAll('.bevel-multiselect__panel input[type="checkbox"]:checked')];
    const wanted = selected.map((checkbox) => checkbox.value);
    const generated = [...root.querySelectorAll(':scope > input[type="hidden"][data-bevel-generated]')];
    if (generated.length !== wanted.length || generated.some((input, index) => input.name !== name || input.value !== wanted[index])) {
      generated.forEach((input) => input.remove());
      for (const value of wanted) {
        const hidden = document.createElement("input"); hidden.type = "hidden"; hidden.name = name; hidden.value = value; hidden.dataset.bevelGenerated = "multiselect"; root.append(hidden);
      }
    }
    for (const checkbox of root.querySelectorAll('.bevel-multiselect__panel input[type="checkbox"]')) if (checkbox.hasAttribute("checked") !== checkbox.checked) checkbox.toggleAttribute("checked", checkbox.checked);
    const summary = root.querySelector(".bevel-multiselect__summary"), text = selected.length ? `${selected.length} selected` : "Choose options"; if (summary && summary.textContent !== text) summary.textContent = text;
    for (const count of root.querySelectorAll("[data-bevel-multiselect-count]")) if (count.textContent !== String(selected.length)) count.textContent = String(selected.length);
    const tags = root.querySelector(".bevel-multiselect__tags");
    if (tags) {
      const present = [...tags.querySelectorAll(".bevel-multiselect__tag")].map((tag) => tag.dataset.bevelKey);
      if (present.length !== wanted.length || present.some((key, index) => key !== wanted[index])) {
        tags.replaceChildren(...selected.map((checkbox) => {
          const tag = document.createElement("span"); tag.className = "bevel-multiselect__tag"; tag.dataset.bevelGenerated = "multiselect-tag"; tag.dataset.bevelKey = checkbox.value;
          const label = document.createElement("span"); label.textContent = checkbox.dataset.bevelLabel || checkbox.closest("label")?.textContent.trim() || checkbox.value;
          if (checkbox.dataset.bevelTone) { const dot = document.createElement("i"); dot.className = `bevel-label-dot bevel-label-dot--${checkbox.dataset.bevelTone}`; dot.setAttribute("aria-hidden", "true"); tag.append(dot); }
          tag.append(label);
          if (!disabled(checkbox)) { const remove = document.createElement("button"); remove.type = "button"; remove.dataset.bevelMultiselectRemove = checkbox.value; remove.setAttribute("aria-label", `Remove ${label.textContent}`); remove.innerHTML = '<svg aria-hidden="true" height="11" width="11" viewBox="0 0 256 256" fill="currentColor"><path d="M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z"/></svg>'; tag.append(remove); }
          return tag;
        }));
      }
    }
  };
  const splitSessions = new Map();
  const splitMedia = matchMedia("(max-width: 640px)");
  const splitValue = root => Number(root.getAttribute(root.hasAttribute("data-bevel-split") ? "data-bevel-split" : "data-bevel-ratio")) || 50;
  const splitBounds = root => {
    const vertical = root.dataset.bevelOrientation === "vertical", extent = vertical ? root.clientHeight : root.clientWidth;
    const divider = root.querySelector(":scope > .bevel-split__divider"), gap = divider ? vertical ? divider.offsetHeight : divider.offsetWidth : 10;
    const first = Math.max(0, Number(root.dataset.bevelMinFirst) || 180), second = Math.max(0, Number(root.dataset.bevelMinSecond) || 180);
    if (extent <= 0) return [25, 75];
    if (extent - gap < first + second) { const value = 100 * Math.max(0, extent - gap) * first / ((first + second) * extent); return [value, value]; }
    const low = Math.max(25, first / extent * 100), high = Math.min(75, (extent - gap - second) / extent * 100);
    if (low > high) { const value = Math.min((extent - gap - second) / extent * 100, Math.max(first / extent * 100, 50)); return [value, value]; }
    return [low, high];
  };
  const splitClamped = (root, value) => { const [min, max] = splitBounds(root); return Math.min(max, Math.max(min, value)); };
  const refreshSplit = root => {
    const divider = root.querySelector(":scope > .bevel-split__divider");
    if (!divider) return;
    let session = splitSessions.get(root);
    if (!session) {
      session = { drag: null, observer: new ResizeObserver(() => { if (root.isConnected) refreshSplit(root); }) };
      splitSessions.set(root, session); session.observer.observe(root);
    }
    const stacked = splitMedia.matches, [min, max] = splitBounds(root), value = splitClamped(root, splitValue(root)), inactive = stacked || min === max || root.matches('[aria-disabled="true"],[disabled]');
    if (session.drag && (inactive || !root.isConnected || splitValue(root) !== session.drag.previous || root.dataset.bevelOrientation !== session.drag.orientation)) session.drag.stop(false);
    if (!session.drag) { const size = `${value}%`; if (root.style.getPropertyValue("--bevel-split-size") !== size) root.style.setProperty("--bevel-split-size", size); }
    const attrs = { role: "separator", "aria-orientation": root.dataset.bevelOrientation === "vertical" ? "horizontal" : "vertical", "aria-valuemin": String(Math.round(min * 100) / 100), "aria-valuemax": String(Math.round(max * 100) / 100), "aria-valuenow": String(Math.round(value * 100) / 100), "aria-disabled": String(inactive), tabindex: inactive ? "-1" : "0" };
    for (const [name, text] of Object.entries(attrs)) if (divider.getAttribute(name) !== text) divider.setAttribute(name, text);
    if (divider.hidden !== stacked) divider.hidden = stacked;
    const caption = root.nextElementSibling;
    if (caption?.matches(".bevel-split__caption")) { const text = caption.querySelector("output"), label = `${root.dataset.bevelLabel || "List"} ${Math.round(value)}% · minimum ${Math.round(min)}% · drag the divider`; if (text && text.textContent !== label) text.textContent = label; }
  };
  const commitSplit = (root, next) => {
    const previous = splitValue(root);
    if (previous === next) return false;
    return transition(root, "resize", root.dataset.bevelKey || "", previous, next, () => { root.setAttribute(root.hasAttribute("data-bevel-split") ? "data-bevel-split" : "data-bevel-ratio", String(next)); refreshSplit(root); });
  };
  splitMedia.addEventListener("change", () => { for (const root of splitSessions.keys()) if (root.isConnected) refreshSplit(root); });
  const codeFeedback = new Map();
  const clearCodeFeedback = (root) => {
    const session = codeFeedback.get(root);
    if (session?.timer) clearTimeout(session.timer);
    codeFeedback.delete(root);
    root.querySelectorAll('[data-bevel-transient="clipboard"]').forEach(node => node.remove());
  };
  const refreshCode = (root) => {
    const wrapped = root.hasAttribute("data-bevel-wrap");
    for (const button of root.querySelectorAll("[data-bevel-code-wrap]")) if (button.getAttribute("aria-pressed") !== String(wrapped)) button.setAttribute("aria-pressed", String(wrapped));
  };
  const diffVersions = new WeakMap();
  const refreshDiff = (root) => {
    const template = root.querySelector("template[data-bevel-diff-records]");
    if (!template) return;
    const layout = root.dataset.bevelLayout === "split" ? "split" : "unified";
    if (root.dataset.bevelLayout !== layout) root.dataset.bevelLayout = layout;
    for (const button of root.querySelectorAll("button[data-bevel-layout]")) if (button.getAttribute("aria-pressed") !== String(button.dataset.bevelLayout === layout)) button.setAttribute("aria-pressed", String(button.dataset.bevelLayout === layout));
    const signature = `${layout}:${template.innerHTML}:${root.dataset.bevelFilename || ""}:${root.dataset.bevelHunk || ""}`;
    if (diffVersions.get(root) === signature && root.querySelector('[data-bevel-generated="diff"]')) return;
    const records = [...template.content.querySelectorAll("[data-bevel-kind]")];
    for (const count of root.querySelectorAll(".bevel-diff__count[data-bevel-kind]")) {
      const kind = count.dataset.bevelKind, text = `${kind === "remove" ? "−" : "+"}${records.filter(record => record.dataset.bevelKind === kind).length}`;
      if (count.textContent !== text) count.textContent = text;
    }
    const line = (record, side) => {
      const row = document.createElement("div"), kind = record.dataset.bevelKind, code = record.querySelector("code");
      row.className = "bevel-diff__line"; row.dataset.bevelKind = kind; row.dataset.bevelKey = record.dataset.bevelKey || "";
      row.setAttribute("role", "listitem");
      const number = document.createElement("span"), symbol = document.createElement("span"), label = document.createElement("span");
      number.textContent = record.dataset[side === "before" || kind === "remove" ? "bevelOld" : "bevelNew"] || ""; number.setAttribute("aria-hidden", "true");
      symbol.textContent = kind === "add" ? "+" : kind === "remove" ? "−" : " "; symbol.setAttribute("aria-hidden", "true");
      label.className = "bevel-sr-only"; label.textContent = `${kind === "add" ? "Added" : kind === "remove" ? "Removed" : "Unchanged"}, line ${number.textContent}: `;
      row.append(number, symbol, label, code ? code.cloneNode(true) : document.createElement("code"));
      return row;
    };
    const body = document.createElement("div"); body.className = "bevel-diff__body"; body.dataset.bevelGenerated = "diff";
    if (layout === "unified") {
      const hunk = document.createElement("div"); hunk.className = "bevel-diff__hunk"; hunk.textContent = root.dataset.bevelHunk || "";
      const list = document.createElement("div"); list.setAttribute("role", "list"); list.setAttribute("aria-label", "Changes");
      list.append(...records.map(record => line(record))); body.append(hunk, list);
    } else for (const side of ["before", "after"]) {
      const section = document.createElement("section"), title = document.createElement("h3"), filename = document.createElement("small"), list = document.createElement("div");
      title.textContent = side === "before" ? "Before " : "After "; filename.textContent = root.dataset.bevelFilename || ""; title.append(filename);
      list.setAttribute("role", "list"); list.setAttribute("aria-label", side === "before" ? "Before" : "After");
      list.append(...records.filter(record => record.dataset.bevelKind !== (side === "before" ? "add" : "remove")).map(record => line(record, side)));
      section.append(title, list); body.append(section);
    }
    const old = root.querySelector('[data-bevel-generated="diff"]');
    if (old) old.replaceWith(body); else template.after(body);
    diffVersions.set(root, signature);
  };
  const refreshPager = (root, notifyClamp = false) => {
    const target = root.dataset.bevelTarget && document.getElementById(root.dataset.bevelTarget), grid = target?.matches(".bevel-grid") ? target : null, items = target && !grid ? [...target.children] : [], remote = grid?.dataset.bevelDataMode === "remote";
    if (grid) {
      const page = grid.dataset.page || "1", size = grid.dataset.pageSize || "10";
      if (root.dataset.bevelPage !== page) root.dataset.bevelPage = page;
      if (root.dataset.bevelPageSize !== size) root.dataset.bevelPageSize = size;
      if (remote) {
        if (grid.hasAttribute("data-bevel-total")) {
          if (root.dataset.bevelTotal !== grid.dataset.bevelTotal) root.dataset.bevelTotal = grid.dataset.bevelTotal;
        }
        else if (root.hasAttribute("data-bevel-total")) root.removeAttribute("data-bevel-total");
      } else {
        const view = grid.querySelector('.bevel-grid__view[aria-pressed="true"]');
        const total = String(searchedGridRows(grid).filter(row => matchesView(row, view)).length);
        if (root.dataset.bevelTotal !== total) root.dataset.bevelTotal = total;
      }
    }
    if (target && !grid && root.dataset.bevelTotal !== String(items.length)) root.dataset.bevelTotal = String(items.length);
    const knownTotal = root.hasAttribute("data-bevel-total"), page = Math.max(1, Number(root.dataset.bevelPage) || 1), size = Math.max(1, Number(root.dataset.bevelPageSize) || 10), total = knownTotal ? Math.max(0, Number(root.dataset.bevelTotal) || 0) : null, pages = total == null ? null : Math.max(1, Math.ceil(total / size));
    const current = pages == null ? page : Math.min(page, pages), normalized = String(current), clamped = current !== page; if (root.dataset.bevelPage !== normalized) root.dataset.bevelPage = normalized;
    const previous = root.querySelector('[data-bevel-page="prev"]'), next = root.querySelector('[data-bevel-page="next"]');
    if (previous?.hasAttribute("disabled") !== (current <= 1)) previous?.toggleAttribute("disabled", current <= 1);
    if (next?.hasAttribute("disabled") !== (pages != null && current >= pages)) next?.toggleAttribute("disabled", pages != null && current >= pages);
    for (const control of root.querySelectorAll("select[data-bevel-page-size]")) {
      if (control.value !== String(size)) control.value = String(size);
      for (const option of control.options) if (option.hasAttribute("selected") !== option.selected) option.toggleAttribute("selected", option.selected);
    }
    const list = root.querySelector(".bevel-pagination__pages");
    if (list) {
      if (pages == null) {
        for (const item of [...list.children]) if (!item.matches('[data-bevel-page="prev"],[data-bevel-page="next"]')) item.remove();
      }
      else renderStandalonePages(list, pages, current);
    }
    const out = root.querySelector(".bevel-pagination__range"), label = total == null ? `${(current - 1) * size + 1} to ${current * size}` : total ? `${(current - 1) * size + 1} to ${Math.min(current * size, total)} of ${total}` : "0 of 0"; if (out && out.textContent !== label) out.textContent = label;
    if (items.length) { const first = (current - 1) * size, last = first + size; items.forEach((item, index) => { const hidden = index < first || index >= last; if (item.hidden !== hidden) item.hidden = hidden; }); }
    if (clamped && notifyClamp) emit(root, "bevel:change", { component: "pagination", action: "page", key: String(current), previous: page, next: current });
  };
  const treeItems = (root) => [...root.querySelectorAll('[role="treeitem"][data-bevel-key], button[data-bevel-key], summary[data-bevel-key], a[data-bevel-key]')].filter((item) => item.closest(".bevel-tree") === root);
  const treeVisible = (root) => treeItems(root).filter((item) => {
    if (disabled(item) || item.hidden || item.closest("[hidden]")) return false;
    for (let branch = item.parentElement?.closest("details"); branch && root.contains(branch); branch = branch.parentElement?.closest("details")) if (!branch.open && item !== branch.querySelector(":scope > summary")) return false;
    return true;
  });
  const refreshTree = (root) => {
    if (root.getAttribute("role") !== "tree") root.setAttribute("role", "tree");
    const items = treeItems(root), selected = root.dataset.bevelSelected || "";
    for (const branch of root.querySelectorAll("details")) { if (branch.closest(".bevel-tree") !== root) continue; const value = String(branch.open), summary = branch.querySelector(":scope > summary"); if (branch.dataset.bevelExpanded !== value) branch.dataset.bevelExpanded = value; if (summary && summary.getAttribute("aria-expanded") !== value) summary.setAttribute("aria-expanded", value); }
    for (const item of items) { if (item.getAttribute("role") !== "treeitem") item.setAttribute("role", "treeitem"); const value = String(item.dataset.bevelKey === selected); if (item.getAttribute("aria-selected") !== value) item.setAttribute("aria-selected", value); }
    const visible = treeVisible(root), current = visible.find((item) => item === document.activeElement) || visible.find((item) => item.tabIndex === 0) || visible.find((item) => item.dataset.bevelKey === selected) || visible[0];
    for (const item of items) { const value = item === current ? "0" : "-1"; if (item.getAttribute("tabindex") !== value) item.setAttribute("tabindex", value); }
  };
  const refreshSidebar = (root) => {
    const collapsed = root.hasAttribute("data-bevel-collapsed");
    for (const button of root.querySelectorAll("[data-bevel-sidebar-toggle]")) { const expanded = String(!collapsed), label = collapsed ? "Expand sidebar" : "Collapse sidebar"; if (button.getAttribute("aria-expanded") !== expanded) button.setAttribute("aria-expanded", expanded); if (button.getAttribute("aria-label") !== label) button.setAttribute("aria-label", label); if (button.title !== label) button.title = label; }
  };
  const refreshShell = (root) => {
    const open = String(root.hasAttribute("data-bevel-nav-open"));
    for (const button of root.querySelectorAll("[data-bevel-shell-nav]")) if (button.getAttribute("aria-expanded") !== open) button.setAttribute("aria-expanded", open);
    for (const side of root.querySelectorAll(".bevel-app-shell__side")) {
      const collapsed = side.hasAttribute("data-bevel-collapsed"), expanded = String(!collapsed);
      for (const button of side.querySelectorAll("[data-bevel-shell-collapse]")) { const label = collapsed ? button.dataset.bevelLabelExpand || "Expand sidebar" : button.dataset.bevelLabelCollapse || "Collapse sidebar"; if (button.getAttribute("aria-expanded") !== expanded) button.setAttribute("aria-expanded", expanded); if (button.getAttribute("aria-label") !== label) button.setAttribute("aria-label", label); if (button.title !== label) button.title = label; }
    }
  };
  const wizardPanels = (root) => [...root.querySelectorAll(".bevel-wizard__panel")].filter((panel) => panel.closest(".bevel-wizard") === root);
  const wizardKeyed = (panels) => panels.some((panel) => panel.hasAttribute("data-bevel-key"));
  const wizardKey = (panels, panel, index = panels.indexOf(panel)) => wizardKeyed(panels) ? panel.dataset.bevelKey : String(index);
  const wizardControls = (panel) => [...panel.querySelectorAll("input,select,textarea")].filter((control) => control.closest(".bevel-wizard__panel") === panel && control.closest(".bevel-wizard") === panel.closest(".bevel-wizard"));
  const invalidControls = (controls) => [...controls].filter((control) => !disabled(control) && !control.closest('.bevel-wizard__panel[disabled],.bevel-wizard__panel[aria-disabled="true"]') && control.willValidate && !control.validity.valid);
  const wizardInvalid = (panels) => invalidControls(panels.flatMap(wizardControls));
  const setupWizardForm = (root) => {
    const form = root.closest("form");
    if (!form?.matches("[data-bevel-validate]")) return;
    let session = wizardForms.get(form);
    if (!session) {
      session = { authoredNoValidate: form.noValidate, roots: new Set(), initialSteps: new Map() };
      wizardForms.set(form, session);
      form.noValidate = true;
    }
    session.roots.add(root);
    if (!session.initialSteps.has(root)) session.initialSteps.set(root, root.dataset.bevelStep);
  };
  const refreshWizard = (root) => {
    const panels = wizardPanels(root), keyed = wizardKeyed(panels);
    const key = (panel, index) => keyed ? panel.dataset.bevelKey : String(index);
    let index = panels.findIndex((panel, i) => key(panel, i) === String(root.dataset.bevelStep ?? "0") && !disabled(panel));
    if (index < 0) index = panels.findIndex((panel) => !disabled(panel));
    if (index < 0) return;
    const active = key(panels[index], index); if (root.dataset.bevelStep !== active) root.dataset.bevelStep = active;
    panels.forEach((panel, i) => { if (panel.hidden !== (i !== index)) panel.hidden = i !== index; panel.toggleAttribute("inert", i !== index); });
    root.querySelectorAll(":scope > .bevel-wizard__steps > .bevel-wizard__step").forEach((el, i) => {
      const state = i < index ? "done" : i === index ? "current" : "next";
      if (el.dataset.bevelState !== state) el.dataset.bevelState = state;
      if (i === index && el.getAttribute("aria-current") !== "step") el.setAttribute("aria-current", "step"); else if (i !== index) el.removeAttribute("aria-current");
      const panel = panels[i];
      el.toggleAttribute("disabled", !panel || disabled(panel));
      const inactive = String(!panel || disabled(panel));
      if (el.getAttribute("aria-disabled") !== inactive) el.setAttribute("aria-disabled", inactive);
      const note = el.querySelector(".bevel-wizard__step-note");
      const label = i < index ? "Complete" : i === index ? "Current step" : "Up next";
      if (note && note.textContent !== label) note.textContent = label;
    });
    setupWizardForm(root);
  };
  const revealWizardControl = (control) => {
    const panel = control?.closest(".bevel-wizard__panel"), root = panel?.closest(".bevel-wizard");
    if (!panel || !root) return false;
    const panels = wizardPanels(root);
    root.dataset.bevelStep = wizardKey(panels, panel);
    refreshWizard(root);
    return true;
  };
  const setFieldError = (message, text) => {
    if (!message) return;
    (message.querySelector("[data-bevel-error-message]") || message).textContent = text;
    message.hidden = !text;
  };
  const refreshErrors = (form, controls = [...form.elements]) => {
    const summary = form.querySelector(".bevel-errors"), list = summary?.querySelector(".bevel-errors__list");
    const candidates = new Set(controls);
    const invalid = invalidControls(candidates);
    if (!summary || !list) return invalid;
    const reported = new Set(invalid);
    for (const control of form.elements) if (control instanceof HTMLElement && candidates.has(control) && control.willValidate && !reported.has(control)) {
      control.removeAttribute("aria-invalid");
      const authored = (control.dataset.bevelAuthoredDescribedby || "").split(/\s+/).filter(Boolean);
      if (control.dataset.bevelErrorId) {
        setFieldError(document.getElementById(control.dataset.bevelErrorId), "");
        const ids = (control.getAttribute("aria-describedby") || "").split(/\s+/).filter((id) => id !== control.dataset.bevelErrorId);
        if (ids.length) control.setAttribute("aria-describedby", ids.join(" ")); else control.removeAttribute("aria-describedby");
      }
      if (authored.length) control.setAttribute("aria-describedby", authored.join(" "));
    }
    list.replaceChildren(...invalid.map((control, index) => {
      if (!control.id) control.id = `${form.id || "bevel-form"}-invalid-${index + 1}`;
      control.setAttribute("aria-invalid", "true");
      let message = form.querySelector(`[data-bevel-error-for="${CSS.escape(control.id)}"]`);
      if (!message) { message = document.createElement("small"); message.className = "bevel-field-error"; message.dataset.bevelErrorFor = control.id; control.insertAdjacentElement("afterend", message); }
      if (!message.id) message.id = `${control.id}-error`;
      if (!control.dataset.bevelAuthoredDescribedby) control.dataset.bevelAuthoredDescribedby = control.getAttribute("aria-describedby") || "";
      const validationMessage = control.validity.customError ? control.validationMessage : control.dataset.bevelValidationMessage || control.validationMessage;
      control.dataset.bevelErrorId = message.id; setFieldError(message, validationMessage);
      const ids = new Set((control.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean)); ids.add(message.id); control.setAttribute("aria-describedby", [...ids].join(" "));
      const item = document.createElement("li"), link = document.createElement("a"); link.href = `#${control.id}`; link.textContent = validationMessage; link.addEventListener("click", event => { event.preventDefault(); const focus = () => { control.focus(); control.scrollIntoView({ block: "center" }); }; if (revealWizardControl(control)) requestAnimationFrame(focus); else focus(); }); item.append(link); return item;
    }));
    summary.hidden = invalid.length === 0;
    return invalid;
  };
  const kanbanCards = root => [...root.querySelectorAll(".bevel-kanban__list > .bevel-kanban__card")].filter(card => card.closest(".bevel-kanban") === root);
  const kanbanSelected = root => kanbanCards(root).find(card => card.dataset.bevelKey === root.dataset.bevelSelected);
  const kanbanItems = card => [...card.querySelectorAll('.bevel-kanban__checklist-data input[data-bevel-check-key]')];
  const kanbanDisabled = node => disabled(node) || disabled(node.closest(".bevel-kanban"));
  const kanbanText = (node, text) => { if (node && node.textContent !== String(text)) node.textContent = String(text); };
  const kanbanAttr = (node, name, value) => { if (node && node.getAttribute(name) !== String(value)) node.setAttribute(name, String(value)); };
  const kanbanFlag = (node, name, value) => { if (node && node.hasAttribute(name) !== !!value) node.toggleAttribute(name, !!value); };
  const kanbanNode = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
  const kanbanSnapshot = card => card ? { key: card.dataset.bevelKey, column: card.closest("[data-bevel-column-key]")?.dataset.bevelColumnKey || "", title: card.querySelector(".bevel-kanban__title,h3")?.textContent || "", description: card.querySelector(".bevel-kanban__description,.bevel-kanban__desc")?.textContent || "", assignee: card.dataset.bevelAssignee || "", priority: card.dataset.bevelPriority || "normal", due: card.dataset.bevelDue || "", labels: [...card.querySelectorAll(".bevel-kanban__labels > [data-bevel-label]")].map(label => label.dataset.bevelLabel), archived: card.hasAttribute("data-bevel-archived") } : null;
  const kanbanToday = root => {
    const now = new Date();
    return root.dataset.bevelToday || `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
  };
  const kanbanDue = (root, value, done = false) => {
    const node = kanbanNode("span", "bevel-kanban__due");
    node.dataset.bevelDue = done ? "done" : value === kanbanToday(root) ? "today" : value && value < kanbanToday(root) ? "overdue" : "";
    node.textContent = value ? `${value === kanbanToday(root) && !done ? "Today, " : ""}${new Date(`${value}T12:00:00`).toLocaleDateString("en-US", {month:"short", day:"2-digit"})}` : "No due date";
    const text=node.textContent;node.innerHTML='<svg aria-hidden="true" width="12" height="12" viewBox="0 0 256 256" fill="currentColor"><path d="M208,32H184V24a8,8,0,0,0-16,0v8H88V24a8,8,0,0,0-16,0v8H48A16,16,0,0,0,32,48V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V48A16,16,0,0,0,208,32ZM72,48v8a8,8,0,0,0,16,0V48h80v8a8,8,0,0,0,16,0V48h24V80H48V48ZM208,208H48V96H208V208Z"/></svg>';node.append(document.createTextNode(text));
    return node;
  };
  const kanbanMember = (root, key) => root.querySelector(`[data-bevel-kanban-form] [name="assignee"] option[value="${CSS.escape(key)}"]`)?.textContent || key || "Unassigned";
  const kanbanLabels = values => values.map(value => { const node = kanbanNode("span", "bevel-kanban__label", value[0]?.toUpperCase() + value.slice(1)); node.dataset.bevelLabel = value; return node; });
  const kanbanProgress = (scope, items) => {
    const done = items.filter(item => item.checked).length, percent = items.length ? Math.round(100 * done / items.length) : 0;
    kanbanText(scope.querySelector(".bevel-kanban__check-count"), `${done}/${items.length}`);
    const bar = scope.querySelector(".bevel-kanban__check-bar b"); if (bar && bar.style.width !== `${percent}%`) bar.style.width = `${percent}%`;
    kanbanAttr(scope, "aria-label", `Checklist ${done} of ${items.length}`);
  };
  const kanbanInspectorStates = new WeakMap();
  const refreshKanbanInspector = root => {
    const panel = root.querySelector("[data-bevel-kanban-inspector]"), template = root.querySelector("template[data-bevel-kanban-inspector-template]"), card = kanbanSelected(root);
    if (!panel) return;
    kanbanFlag(panel, "hidden", !card);
    const work = root.querySelector(".bevel-kanban__work"); if (work && work.classList.contains("bevel-kanban--has-panel") !== !!card) work.classList.toggle("bevel-kanban--has-panel", !!card);
    if (!card) {
      panel.querySelectorAll('[data-bevel-transient="kanban-inspector-body"]').forEach(node => node.remove());
      kanbanInspectorStates.delete(panel);
      return;
    }
    if (!template) return;
    const value = kanbanSnapshot(card), items = kanbanItems(card), details = card.querySelector("template[data-bevel-task-details]");
    const signature = JSON.stringify([value, items.map(item => [item.dataset.bevelCheckKey, item.checked, item.parentElement.textContent]), details?.innerHTML, card.hidden, disabled(root)]);
    if (kanbanInspectorStates.get(panel) === signature && panel.querySelector('[data-bevel-transient="kanban-inspector-body"]')) return;
    kanbanInspectorStates.set(panel, signature);
    const body = kanbanNode("div"); body.dataset.bevelTransient = "kanban-inspector-body"; body.append(template.content.cloneNode(true));
    kanbanText(body.querySelector(".bevel-kanban__panel-head .bevel-kanban__id"), value.key);
    kanbanText(body.querySelector("h2"), value.title);
    kanbanText(body.querySelector(".bevel-kanban__panel-lede"), value.description || "No description");
    const status = body.querySelector(".bevel-kanban__status"); status.dataset.bevelColumnKey = value.column;
    kanbanText(status, card.closest(".bevel-kanban__column")?.querySelector("h2")?.textContent || value.column);
    const field = name => body.querySelector(`[data-bevel-task-field="${name}"]`);
    const member = kanbanNode("span", "bevel-avatar bevel-avatar--small", value.assignee || "?"); member.dataset.who = value.assignee; member.title = kanbanMember(root, value.assignee);
    field("assignee").replaceChildren(member, document.createTextNode(` ${member.title}`));
    const priority = card.querySelector('.bevel-kanban__priority')?.cloneNode(true) || kanbanNode("span", "bevel-kanban__priority", value.priority); priority.dataset.bevelPriority = value.priority; field("priority").replaceChildren(priority);
    field("due").replaceChildren(kanbanDue(root, value.due, value.column === "done"));
    field("labels").replaceChildren(...kanbanLabels(value.labels));
    const checklist = body.querySelector("[data-bevel-kanban-checklist]");
    for (const source of items) {
      const row = kanbanNode("div"); row.dataset.bevelCheckRow = source.dataset.bevelCheckKey;
      const label = kanbanNode("label", "bevel-checkbox bevel-checkbox--small bevel-kanban__check-item");
      const input = kanbanNode("input", "bevel-sr-only"); input.type = "checkbox"; input.checked = source.checked; input.toggleAttribute("checked", source.checked); input.dataset.bevelCheckKey = source.dataset.bevelCheckKey;
      const box = kanbanNode("span", "bevel-checkbox__box"); box.ariaHidden = "true";
      label.append(input, box, kanbanNode("span", "bevel-checkbox__label", source.parentElement.textContent.trim()));
      const remove = kanbanNode("button", "bevel-kanban__icon"); remove.type = "button"; remove.dataset.bevelKanbanCheckRemove = source.dataset.bevelCheckKey; remove.setAttribute("aria-label", `Remove ${source.parentElement.textContent.trim()}`); remove.innerHTML = X_SVG;
      row.append(label, remove); checklist.append(row);
    }
    kanbanProgress(checklist, items);
    const extra = body.querySelector("[data-bevel-task-details]");
    if (details) extra.append(details.content.cloneNode(true));
    const estimate=extra.querySelector('[data-bevel-task-field="estimate"]'),created=extra.querySelector('[data-bevel-task-created]');
    kanbanText(field('estimate'),estimate?.textContent || '');kanbanFlag(field('estimate'),'hidden',!estimate);kanbanFlag(field('estimate').previousElementSibling,'hidden',!estimate);estimate?.closest('dl').remove();
    kanbanText(body.querySelector('.bevel-kanban__panel-foot [data-bevel-task-created]'),created?.textContent || '');created?.remove();
    kanbanFlag(body.querySelector("[data-bevel-kanban-outside]"), "hidden", !card.hidden);
    kanbanText(body.querySelector("[data-bevel-kanban-outside]"), value.archived ? "This task is archived. Restore it to return it to the board." : "This task is outside the current filters.");
    body.querySelectorAll('[data-bevel-action="open-task"],[data-bevel-action="task-options"],[data-bevel-action="comment"]').forEach(node => node.dataset.bevelKey = value.key);
    const archive = body.querySelector('[data-bevel-open]'); kanbanFlag(archive, "hidden", value.archived);
    const confirm = root.querySelector('[data-bevel-kanban-archive]')?.closest("[popover]"); if (archive && confirm) { archive.dataset.bevelOpen = confirm.id; archive.setAttribute("aria-controls", confirm.id); }
    kanbanFlag(body.querySelector('[data-bevel-kanban-restore]'), "hidden", !value.archived);
    const destination = body.querySelector('[data-bevel-kanban-move-column]'); destination.replaceChildren(...[...root.querySelectorAll('.bevel-kanban__column')].filter(column => column.closest('.bevel-kanban') === root).map(column => { const option = new Option(column.querySelector('h2')?.textContent || column.dataset.bevelColumnKey, column.dataset.bevelColumnKey); option.selected = option.value === value.column; return option; }));
    if (disabled(root)) body.querySelectorAll('button,input,select,textarea').forEach(node => node.disabled = true);
    panel.replaceChildren(body); kanbanAttr(panel, "aria-label", `Task ${value.key}`);
  };
  const kanbanFaces = new WeakMap();
  const refreshKanbanSelection = (root, cards = kanbanCards(root)) => {
    const loaded = new Set(cards.map(card => card.dataset.bevelKey));
    if (root.dataset.bevelSelected && !loaded.has(root.dataset.bevelSelected)) root.removeAttribute('data-bevel-selected');
    let keys = [];
    if (root.hasAttribute('data-bevel-selected-keys')) {
      try { const value = JSON.parse(root.dataset.bevelSelectedKeys); if (Array.isArray(value)) keys = [...new Set(value.map(String))].filter(key => loaded.has(key)); } catch {}
      kanbanAttr(root, 'data-bevel-selected-keys', JSON.stringify(keys));
    }
    const selected = new Set([...keys, root.dataset.bevelSelected].filter(Boolean));
    for (const card of cards) {
      const key = card.dataset.bevelKey, active = selected.has(key);
      if (card.classList.contains('bevel-kanban--selected') !== active) card.classList.toggle('bevel-kanban--selected', active);
      kanbanAttr(card, 'aria-selected', active);
      if (key === root.dataset.bevelSelected) kanbanAttr(card, 'aria-current', 'true'); else kanbanFlag(card, 'aria-current', false);
    }
    refreshKanbanInspector(root);
  };
  const kanbanFilterKinds = ["assignee", "label", "priority", "due-from", "due-to"];
  const kanbanFiltered = root => !!((root.querySelector('.bevel-kanban__search input') || root.querySelector('input.bevel-kanban__search'))?.value.trim() || kanbanFilterKinds.some(kind => root.getAttribute(`data-bevel-filter-${kind}`)) || root.dataset.bevelFilterDue);
  const refreshKanban = root => {
    if (root.dataset.bevelDataMode === 'remote') { refreshKanbanSelection(root); return; }
    const cards = kanbanCards(root), search = root.querySelector(".bevel-kanban__search input") || root.querySelector("input.bevel-kanban__search"), query = (search?.value || "").trim().toLowerCase();
    const assignee = root.dataset.bevelFilterAssignee || "", label = root.dataset.bevelFilterLabel || "", priority = root.dataset.bevelFilterPriority || "", from = root.dataset.bevelFilterDueFrom || "", to = root.dataset.bevelFilterDueTo || "";
    for (const card of cards) {
      const value = kanbanSnapshot(card), done = value.column === "done", items = kanbanItems(card);
      const faceKey=JSON.stringify([value.priority,value.assignee,value.due,done,kanbanToday(root)]);
      if(kanbanFaces.get(card)!==faceKey){
        kanbanFaces.set(card,faceKey);
        const priority=card.querySelector('.bevel-kanban__priority');if(priority){kanbanAttr(priority,'data-bevel-priority',value.priority);if(priority.textContent.trim().toLowerCase()!==value.priority){for(const node of [...priority.childNodes])if(node.nodeType===Node.TEXT_NODE)node.remove();priority.append(document.createTextNode(value.priority));}}
        const due=card.querySelector('.bevel-kanban__card-foot .bevel-kanban__due');if(due){const next=kanbanDue(root,value.due,done);if(value.due===kanbanToday(root)&&!done)next.lastChild.textContent='Today';due.replaceWith(next);}
        const people=card.querySelector('.bevel-kanban__card-foot .bevel-kanban__people');if(people){people.replaceChildren();if(value.assignee){const avatar=kanbanNode('span','bevel-avatar bevel-avatar--small',value.assignee);avatar.dataset.who=value.assignee;avatar.title=kanbanMember(root,value.assignee);avatar.setAttribute('aria-label',avatar.title);people.append(avatar);}}
      }
      kanbanFlag(card, "hidden", value.archived || (query && !card.textContent.toLowerCase().includes(query)) || (assignee && value.assignee !== assignee) || (label && !value.labels.includes(label)) || (priority && value.priority !== priority) || (from && (!value.due || value.due < from)) || (to && (!value.due || value.due > to)) || (root.dataset.bevelFilterDue === "set" && !value.due) || (root.dataset.bevelFilterDue === "empty" && !!value.due));
      if (card.classList.contains("bevel-kanban--done") !== done) card.classList.toggle("bevel-kanban--done", done);
      let progress = card.querySelector(".bevel-kanban__check");
      if (!progress && items.length) { progress=kanbanNode('div','bevel-kanban__check');const bar=kanbanNode('i','bevel-kanban__check-bar');bar.append(kanbanNode('b'));progress.append(bar,kanbanNode('span','bevel-kanban__check-count'));card.insertBefore(progress,card.querySelector('.bevel-kanban__card-foot')); }
      if (progress) { kanbanProgress(progress, items); kanbanFlag(progress, "hidden", !items.length); }
    }
    const active = cards.filter(card => !card.hasAttribute("data-bevel-archived")), done = active.filter(card => card.closest("[data-bevel-column-key]")?.dataset.bevelColumnKey === "done").length;
    for (const column of root.querySelectorAll(".bevel-kanban__column")) {
      if(column.closest(".bevel-kanban") !== root) continue;
      const count = active.filter(card => card.closest(".bevel-kanban__column") === column).length, limit = Number(column.dataset.bevelWip || 0);
      kanbanText(column.querySelector(".bevel-kanban__count"), count);
      if (limit) { const wip = column.querySelector(".bevel-kanban__wip"); kanbanText(wip, `WIP ${count} / ${limit}`); kanbanAttr(wip, "data-full", count >= limit); }
      kanbanFlag(column.querySelector('[data-bevel-kanban-column-empty]'), "hidden", count !== 0);
    }
    const percent = active.length ? Math.round(100 * done / active.length) : 0;
    for (const [name, value] of Object.entries({total:active.length, done, open:active.length-done, blocked:active.filter(card => card.classList.contains('bevel-kanban--blocked')).length, progress:`${percent}%`, people:new Set(active.map(card => card.dataset.bevelAssignee).filter(Boolean)).size, working:active.filter(card => card.closest('[data-bevel-column-key]').dataset.bevelColumnKey === 'progress').length})) root.querySelectorAll(`[data-bevel-kanban-${name}]`).forEach(node => kanbanText(node, value));
    kanbanText(root.querySelector('[data-bevel-kanban-limit]'), `of ${root.querySelector('.bevel-kanban__column[data-bevel-column-key="progress"]')?.dataset.bevelWip || '∞'}`);
    kanbanText(root.querySelector('[data-bevel-kanban-due-label]'),from || to ? `Due: ${from || 'any'} to ${to || 'any'}` : 'Due: any time');
    kanbanAttr(root.querySelector('[data-bevel-open="kanban-due-filter"]'),'aria-pressed',!!(from || to));
    const meter = root.querySelector('[data-bevel-kanban-meter]'); if (meter && meter.style.width !== `${percent}%`) meter.style.width = `${percent}%`;
    const zero = active.length > 0 && !cards.some(card => !card.hidden);
    kanbanFlag(root, 'data-bevel-zero-results', zero);
    kanbanFlag(root.querySelector('[data-bevel-kanban-empty]'), 'hidden', active.length !== 0);
    kanbanFlag(root.querySelector('[data-bevel-kanban-zero]'), 'hidden', !zero);
    for (const control of root.querySelectorAll('[data-bevel-kanban-filter]')) {
      const value = root.getAttribute(`data-bevel-filter-${control.dataset.bevelKanbanFilter}`) || '';
      if (control.matches('select')) { if (value && ![...control.options].some(option => option.value === value)) control.add(new Option(value, value)); for (const option of control.options) { const selected = option.value === value; if (option.selected !== selected) option.selected = selected; kanbanFlag(option, 'selected', selected); } }
      else if (control.matches('input')) { if (control.value !== value) control.value = value; kanbanAttr(control, 'value', value); }
    }
    const labels = root.querySelector('[data-bevel-kanban-filter="label"]'); if (labels) for (const value of new Set(cards.flatMap(card => kanbanSnapshot(card).labels))) if (![...labels.options].some(option => option.value === value)) labels.add(new Option(value[0].toUpperCase()+value.slice(1), value));
    if (!kanbanFiltered(root) && root.hasAttribute('data-bevel-move-message')) root.removeAttribute('data-bevel-move-message');
    refreshKanbanSelection(root, cards);
  };
  const kanbanEditor = (root, card = null, column = "") => {
    const dialog = root.querySelector("[data-bevel-kanban-editor]"), form = dialog?.querySelector("[data-bevel-kanban-form]");
    if (!form) return false;
    const value = kanbanSnapshot(card) || { key:"", column, title:"", description:"", assignee:"", priority:"normal", due:"", labels:[] };
    for (const name of ['key','column','title','description','assignee','priority','due']) form.elements[name].value = value[name];
    form.elements.labels.value = value.labels.join(', '); form.elements.title.setCustomValidity('');
    kanbanText(form.querySelector('[data-bevel-kanban-form-heading]'), card ? `Edit ${value.key}` : 'New task');
    return openOverlay(dialog, {trigger:document.activeElement});
  };
  const updateKanbanCard = (card, value) => {
    for (const name of ['assignee','priority','due']) card.setAttribute(`data-bevel-${name}`, value[name]);
    kanbanText(card.querySelector('.bevel-kanban__title,h3'), value.title);
    let description = card.querySelector('.bevel-kanban__description,.bevel-kanban__desc'); if (!description) { description = kanbanNode('p','bevel-kanban__description bevel-kanban__desc'); card.querySelector('h3').after(description); }
    kanbanText(description, value.description); description.hidden = !value.description;
    const priority = card.querySelector('.bevel-kanban__priority'); if (priority) { priority.dataset.bevelPriority = value.priority; for(const text of [...priority.childNodes])if(text.nodeType===Node.TEXT_NODE)text.remove();priority.append(document.createTextNode(value.priority)); }
    let labels = card.querySelector('.bevel-kanban__labels'); if (!labels) { labels = kanbanNode('div','bevel-kanban__labels'); description.after(labels); } labels.replaceChildren(...kanbanLabels(value.labels));
    const root = card.closest('.bevel-kanban');
    const foot = card.querySelector('.bevel-kanban__card-foot'); if (foot && root) { const due = foot.querySelector('.bevel-kanban__due'); due?.replaceWith(kanbanDue(root,value.due,value.column === 'done')); const people = foot.querySelector('.bevel-kanban__people'); if (people) { people.replaceChildren(); if (value.assignee) { const avatar = kanbanNode('span','bevel-avatar bevel-avatar--small',value.assignee); avatar.dataset.who=value.assignee; avatar.title=kanbanMember(root,value.assignee); people.append(avatar); } } }
  };
  const kanbanCard = value => {
    const card = kanbanNode('article','bevel-kanban__card'); card.tabIndex=0; card.dataset.bevelKey=value.key;
    const top = kanbanNode('div','bevel-kanban__card-top'); top.append(kanbanNode('span','bevel-kanban__id',value.key),kanbanNode('span','bevel-kanban__priority'));
    const foot = kanbanNode('footer','bevel-kanban__card-foot'); foot.append(kanbanNode('span','bevel-kanban__due'),kanbanNode('span','bevel-kanban__people'));
    card.append(top,kanbanNode('h3','bevel-kanban__title'),foot); updateKanbanCard(card,value); return card;
  };
  const kanbanMove = (root, card, list, index) => {
    if (!card?.isConnected || !list?.isConnected || list.closest('.bevel-kanban') !== root || kanbanDisabled(card)) return false;
    const source = card.parentElement, siblings = [...list.children].filter(node => node.matches('.bevel-kanban__card') && node !== card), position = Math.max(0,Math.min(index,siblings.length));
    const previous = {column:source.closest('[data-bevel-column-key]').dataset.bevelColumnKey,index:[...source.children].filter(node=>node.matches('.bevel-kanban__card')).indexOf(card)}, next = {column:list.closest('[data-bevel-column-key]').dataset.bevelColumnKey,index:position};
    if (previous.column === next.column && previous.index === next.index) return false;
    return localOrRemote(root,'move',card.dataset.bevelKey,previous,next,()=>{ list.insertBefore(card,siblings[position] || list.querySelector('.bevel-kanban__add')); refreshKanban(root); card.focus(); },`move:${card.dataset.bevelKey}`);
  };
  const refreshActivity = (root) => {
    const expanded = root.hasAttribute("data-bevel-expanded");
    const groups = [...root.querySelectorAll("[data-bevel-activity-older]")].filter((group) => group.closest(".bevel-activity") === root);
    for (const group of groups) if (group.hidden === expanded) group.hidden = !expanded;
    const button = root.querySelector("[data-bevel-activity-more]");
    if (!button) return;
    const count = groups.reduce((total, group) => total + group.querySelectorAll("[data-bevel-key]").length, 0);
    button.setAttribute("aria-expanded", String(expanded));
    const label = button.querySelector(".bevel-button__label");
    if (!expanded) {
      button.disabled = count === 0;
      if (label) label.textContent = count === 1 ? "Show yesterday (1)" : `Show older (${count})`;
    } else if (root.hasAttribute("data-bevel-has-more")) {
      button.disabled = false;
      if (label) label.textContent = "Load more";
    } else {
      button.disabled = true;
      if (label) label.textContent = "All activity shown";
    }
  };
  const showAvatarFallback = (image) => {
    const person = image.closest(".bevel-avatars__person");
    if (!person) return;
    person.dataset.bevelImageFailed = "";
    image.hidden = true;
    const fallback = person.querySelector(".bevel-avatars__fallback");
    if (fallback) fallback.hidden = false;
  };
  const refreshAvatars = (root) => {
    for (const person of root.querySelectorAll(".bevel-avatars__person")) {
      if (person.closest(".bevel-avatars") !== root) continue;
      const image = person.querySelector(".bevel-avatars__image"), fallback = person.querySelector(".bevel-avatars__fallback");
      if (!image || !fallback) continue;
      if (person.hasAttribute("data-bevel-image-failed") || (image.complete && image.naturalWidth === 0)) showAvatarFallback(image);
      else { image.hidden = false; fallback.hidden = true; }
    }
  };
  const refreshChart = (root) => {
    for (const button of root.querySelectorAll("[data-bevel-series]")) {
      if (button.closest(".bevel-chart") !== root) continue;
      const visible = button.getAttribute("aria-pressed") !== "false", key = button.dataset.bevelSeries;
      button.setAttribute("aria-pressed", String(visible));
      for (const group of root.querySelectorAll(`[data-bevel-series-key="${CSS.escape(key)}"]`)) if (group.closest(".bevel-chart") === root) group.toggleAttribute("hidden", !visible);
    }
  };
  const refresh = (scope = document, { source = "api" } = {}) => {
    const roots = (selector) => [...(scope.matches?.(selector) ? [scope] : []), ...scope.querySelectorAll(selector)];
    for (const [root, session] of [...sessions]) if (session.valid && (root === scope || scope.contains(root) || root.contains(scope)) && !session.valid()) session.cancel();
    roots(".bevel-grid").forEach((grid) => {
      if (grid.dataset.bevelDataMode !== "remote") { layoutGrid(grid); return; }
      syncPick(grid);
      if (grid.id) document.querySelectorAll(`.bevel-pagination[data-bevel-target="${CSS.escape(grid.id)}"]`).forEach(pager => refreshPager(pager));
    });
    roots(".bevel-files").forEach(syncFiles);
    roots(".bevel-slider__input").forEach(syncSlider);
    roots(".bevel-combobox").forEach(refreshCombo);
    roots(".bevel-multiselect").forEach(refreshMulti);
    roots(".bevel-pagination").forEach((root) => refreshPager(root, source === "api"));
    roots(".bevel-sidebar").forEach(refreshSidebar);
    roots(".bevel-app-shell").forEach(refreshShell);
    roots(".bevel-file-tree").forEach(syncFileTree);
    roots(".bevel-tree").forEach(refreshTree);
    roots(".bevel-code").forEach(refreshCode);
    roots(".bevel-diff").forEach(refreshDiff);
    roots(".bevel-split").forEach(refreshSplit);
    roots(".bevel-wizard").forEach(refreshWizard);
    roots(".bevel-kanban").forEach(refreshKanban);
    roots(".bevel-activity").forEach(refreshActivity);
    roots(".bevel-columns").forEach(refreshColumns);
    roots(".bevel-avatars").forEach(refreshAvatars);
    roots(".bevel-chart").forEach(refreshChart);
    roots("[data-bevel-open]:is(dialog,[popover])").sort((a, b) => Number(a.dataset.bevelOpenOrder || 0) - Number(b.dataset.bevelOpenOrder || 0)).forEach((panel) => {
      if (sessions.has(panel) && (panel.matches("dialog") ? panel.matches(":modal") : panel.matches(":popover-open"))) return;
      panel.removeAttribute("open");
      if (panel.matches("[popover]")) panel.hidePopover?.();
      openOverlay(panel, { trigger: panelTrigger(panel), source: "external" });
    });
    return scope;
  };
  const destroy = (scope, { preserve = [] } = {}) => {
    const owns = (node) => (node === scope || scope.contains?.(node)) && !preserve.some((root) => root === node || root.contains?.(node));
    for (const [root, session] of [...sessions]) if (owns(root) || (isAnchored(root) && session.trigger && owns(session.trigger))) {
      if (session.cancel) session.cancel(); else session.cleanup?.();
      sessions.delete(root);
      if (root.matches?.("dialog,[popover]")) {
        root.removeAttribute("data-bevel-open");
        if (root.matches("dialog") && root.open) root.close();
        else if (root.matches("[popover]") && root.matches(":popover-open")) root.hidePopover();
        const trigger = session.trigger?.isConnected ? session.trigger : panelTrigger(root);
        trigger?.setAttribute("aria-expanded", "false");
        setExpanded(root, false);
        root.style.removeProperty("left"); root.style.removeProperty("top"); root.style.removeProperty("--bevel-available-height");
        root.removeAttribute("data-bevel-geometry");
        queueMicrotask(() => { if (trigger?.isConnected && !disabled(trigger)) trigger.focus(); });
      }
    }
    for (const root of requestScopes.keys()) if (owns(root)) { requestScopes.delete(root); root.removeAttribute("data-bevel-pending"); }
    for (const root of codeFeedback.keys()) if (owns(root)) clearCodeFeedback(root);
    for (const [root, session] of splitSessions) if (owns(root)) { session.drag?.stop(false); session.observer.disconnect(); splitSessions.delete(root); }
    for (const [form, session] of [...wizardForms]) {
      for (const root of [...session.roots]) if (owns(root)) session.roots.delete(root);
      if (!session.roots.size || owns(form)) {
        form.noValidate = session.authoredNoValidate;
        wizardForms.delete(form);
      }
    }
    for (const root of [...(scope.matches?.(".bevel-filter,.bevel-grid__cell[data-bevel-edit]") ? [scope] : []), ...scope.querySelectorAll(".bevel-filter,.bevel-grid__cell[data-bevel-edit]")]) if (owns(root)) clearGridDrafts(root);
    for(const root of [...(scope.matches?.('.bevel-kanban') ? [scope] : []), ...scope.querySelectorAll('.bevel-kanban')])if(owns(root)){root.querySelectorAll('[data-bevel-transient="kanban-inspector-body"]').forEach(node=>node.remove());clearKanbanDrafts(root);}
    window.Bevel?.richtext?.unmount?.(scope, { preserve });
    for (const [toast, timer] of [...toastTimers || []]) if (owns(toast)) { if (timer.id) clearTimeout(timer.id); toastTimers.delete(toast); }
    if ([...(scope.matches?.(".bevel-saved") ? [scope] : []), ...scope.querySelectorAll(".bevel-saved")].some(owns)) { if (savedTimer) clearTimeout(savedTimer); savedTimer = null; }
    for (const root of [...(scope.matches?.(".bevel-dropzone") ? [scope] : []), ...(scope.querySelectorAll?.(".bevel-dropzone") || [])]) {
      if (!owns(root)) continue;
      for (const entry of uploadFiles.get(root)?.values() || []) if (entry.preview) URL.revokeObjectURL(entry.preview);
      uploadFiles.delete(root);
    }
    return scope;
  };
  const clearInlineDrafts = (scope) => {
    const roots = [...(scope.matches?.(".bevel-inline-edit") ? [scope] : []), ...scope.querySelectorAll(".bevel-inline-edit")];
    for (const root of roots) {
      root.removeAttribute("data-bevel-editing");
      clearInlineError(root);
      const value = inlinePart(root, ".bevel-inline-edit__value"), input = inlinePart(root, ".bevel-inline-edit__input");
      if (value && input && input.matches("input,textarea")) {
        input.value = value.textContent;
        if (input.matches("textarea")) input.textContent = input.value;
        else input.setAttribute("value", input.value);
        input.removeAttribute("aria-invalid");
      }
    }
  };
  const clearPickerDrafts = (scope) => {
    scope.querySelectorAll("[data-bevel-filtered]").forEach((el) => el.removeAttribute("data-bevel-filtered"));
    scope.querySelectorAll('.bevel-combobox [role="combobox"][aria-activedescendant]').forEach((el) => el.removeAttribute("aria-activedescendant"));
    scope.querySelectorAll(".bevel-combobox__empty,.bevel-multiselect__empty").forEach((el) => el.hidden = true);
  };
  const expirePendingUploads = (scope) => {
    for (const row of scope.querySelectorAll('.bevel-dropzone [data-bevel-file-key][data-bevel-status="selected"],.bevel-dropzone [data-bevel-file-key][data-bevel-status="uploading"]')) {
      row.dataset.bevelStatus = "error";
      row.dataset.bevelError = "Choose this file again";
      row.removeAttribute("data-bevel-progress");
      const status = row.querySelector(".bevel-upload__status");
      if (status) status.textContent = "Choose this file again";
      const progress = row.querySelector("progress");
      if (progress) progress.removeAttribute("value");
      const retry = row.querySelector("[data-bevel-upload-retry]");
      if (retry) retry.hidden = true;
    }
    for (const image of scope.querySelectorAll('.bevel-upload__preview img[src^="blob:"]')) { image.removeAttribute("src"); image.hidden = true; }
  };
  const clearGridDrafts = scope => {
    const roots = selector => [...(scope.matches?.(selector) ? [scope] : []), ...scope.querySelectorAll(selector)];
    for (const root of roots(".bevel-filter")) {
      root.querySelector(".bevel-filter__draft")?.replaceChildren();
      const draft = root.querySelector(".bevel-filter__draft"), committed = root.querySelector(".bevel-filter__rules");
      if (draft) draft.hidden = true;
      if (committed) committed.hidden = false;
      root.removeAttribute("data-bevel-editing"); root.removeAttribute("data-bevel-invalid");
    }
    for (const cell of roots(".bevel-grid__cell[data-bevel-edit]")) {
      cell.querySelector(".bevel-grid__cell-editor")?.remove();
      cell.removeAttribute("data-bevel-editing"); cell.removeAttribute("data-bevel-invalid");
      const error = cell.querySelector(".bevel-grid__cell-error"); if (error) error.hidden = true;
    }
    for (const header of roots(".bevel-grid th[data-bevel-width]")) {
      header.style.width = `${Number(header.dataset.bevelWidth)}px`;
      const handle = header.querySelector(".bevel-grid__resize"); if (handle) handle.setAttribute("aria-valuenow", header.dataset.bevelWidth);
    }
    for (const target of roots("[data-bevel-drop-target]")) target.removeAttribute("data-bevel-drop-target");
  };
  const clearKanbanDrafts = scope => {
    for (const dialog of [...(scope.matches?.('[data-bevel-kanban-editor]') ? [scope] : []), ...scope.querySelectorAll('[data-bevel-kanban-editor]')]) {
      for (const name of ['open','data-bevel-open','data-bevel-open-order']) dialog.removeAttribute(name);
      const form=dialog.querySelector('form');if(form)for(const input of form.elements){if(input.matches('input,textarea')){input.value='';input.removeAttribute('value');if(input.matches('textarea'))input.textContent='';}}
    }
  };
  const prepareForSave = (cloneRoot) => {
    cloneRoot.querySelectorAll('[data-bevel-transient], [data-bevel-generated]').forEach((el) => el.remove());
    cloneRoot.querySelectorAll("[data-bevel-pending], [data-bevel-dragging], [data-bevel-editing]").forEach((el) => { el.removeAttribute("data-bevel-pending"); el.removeAttribute("data-bevel-dragging"); el.removeAttribute("data-bevel-editing"); });
    cloneRoot.querySelectorAll("[data-bevel-geometry]").forEach((el) => { el.style.removeProperty("left"); el.style.removeProperty("top"); el.style.removeProperty("--bevel-available-height"); el.removeAttribute("data-bevel-geometry"); if (!el.getAttribute("style")) el.removeAttribute("style"); });
    cloneRoot.querySelectorAll("dialog.bevel-modal[open],dialog.bevel-drawer[open]").forEach((el) => el.removeAttribute("open"));
    [...(cloneRoot.matches?.(".bevel-app-shell") ? [cloneRoot] : []), ...cloneRoot.querySelectorAll(".bevel-app-shell")].forEach((shell) => { shell.removeAttribute("data-bevel-nav-open"); shell.querySelectorAll("[data-bevel-shell-nav]").forEach((button) => button.setAttribute("aria-expanded", "false")); });
    clearGridDrafts(cloneRoot);
    clearKanbanDrafts(cloneRoot);
    clearPickerDrafts(cloneRoot);
    clearInlineDrafts(cloneRoot);
    expirePendingUploads(cloneRoot);
    window.Bevel.richtext?.prepareForSave?.(cloneRoot);
    for (const root of cloneRoot.querySelectorAll(".bevel-split")) root.style.setProperty("--bevel-split-size", `${splitValue(root)}%`);
    return cloneRoot;
  };

  on("click", "[data-bevel-open]", (e, trigger) => { if (trigger.matches("dialog,[popover]")) return; const root = targetById(trigger.dataset.bevelOpen); if (root) { e.preventDefault(); if (root.matches(".bevel-menu:popover-open")) { if (!disabled(trigger)) closeOverlay(root, { reason: "toggle" }); return; } let comboInput = null; if (root.matches(".bevel-combobox__listbox") && !trigger.matches('[role="combobox"]')) { const combo = root.closest(".bevel-combobox"); comboInput = combo?.querySelector('[role="combobox"]'); if (comboInput) { comboInput.value = ""; comboFilter(combo, ""); } } openOverlay(root, { trigger }); if (comboInput) requestAnimationFrame(() => comboInput.focus()); } });
  on("click", "[data-bevel-close]", (e, button) => { const root = button.closest("dialog,[popover]"); if (root) { e.preventDefault(); closeOverlay(root, { reason: button.dataset.bevelClose || "button" }); } });
  document.addEventListener("cancel", (e) => { if (e.target.matches("dialog.bevel-modal,dialog.bevel-drawer")) { e.preventDefault(); closeOverlay(e.target, { reason: "escape" }); } }, true);
  document.addEventListener("close", (e) => { const root = e.target; if (!root.matches?.("dialog.bevel-modal,dialog.bevel-drawer") || root.open) return; const session = sessions.get(root); session?.cleanup?.(); sessions.delete(root); root.removeAttribute("data-bevel-open"); const trigger = session?.trigger || panelTrigger(root); trigger?.setAttribute("aria-expanded", "false"); setExpanded(root, false); }, true);
  document.addEventListener("toggle", (e) => { const root = e.target; if (!root.matches?.("[popover].bevel-menu,[popover].bevel-popconfirm,[popover].bevel-combobox__listbox,[popover].bevel-multiselect__panel") || root.matches(":popover-open")) return; const session = sessions.get(root); session?.cleanup?.(); sessions.delete(root); root.removeAttribute("data-bevel-open"); root.removeAttribute("data-bevel-geometry"); const trigger = session?.trigger || panelTrigger(root); trigger?.setAttribute("aria-expanded", "false"); setExpanded(root, false); }, true);
  document.addEventListener("keydown", (e) => { if (e.defaultPrevented || e.key !== "Escape") return; const panels = opened(), modal = panels.filter(isModal).at(-1), top = panels.filter(panel => !modal || panel === modal || modal.contains(panel)).at(-1); if (top) { e.preventDefault(); closeOverlay(top, { reason: "escape" }); } });
  document.addEventListener("pointerdown", (e) => { for (const root of opened().filter(isAnchored).reverse()) if (!root.contains(e.target) && !sessions.get(root)?.trigger?.contains(e.target)) closeOverlay(root, { reason: "outside", focus: false }); });

  on("keydown", ".bevel-menu [role^='menuitem']", (e, item) => {
    const menu = item.closest(".bevel-menu"), items = [...menu.querySelectorAll('[role^="menuitem"]')].filter((el) => !disabled(el)), index = items.indexOf(item);
    const next = e.key === "ArrowDown" ? items[(index + 1) % items.length] : e.key === "ArrowUp" ? items[(index - 1 + items.length) % items.length] : e.key === "Home" ? items[0] : e.key === "End" ? items.at(-1) : null;
    if (next) { e.preventDefault(); items.forEach((el) => el.tabIndex = el === next ? 0 : -1); next.focus(); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); item.click(); }
    else if (e.key === "Tab") closeOverlay(menu, { reason: "tab", focus: false });
    else if (e.key.length === 1 && !e.altKey && !e.ctrlKey && !e.metaKey) {
      const session = sessions.get(menu) || {}, now = performance.now(), buffer = now - (session.typeTime || 0) > 500 ? e.key : `${session.typeBuffer || ""}${e.key}`;
      session.typeBuffer = buffer.toLowerCase(); session.typeTime = now; sessions.set(menu, session);
      const match = items.find((candidate) => candidate.textContent.trim().toLowerCase().startsWith(session.typeBuffer));
      if (match) { e.preventDefault(); items.forEach((el) => el.tabIndex = el === match ? 0 : -1); match.focus(); }
    }
  });
  on("click", ".bevel-menu [role^='menuitem']", (e, item) => { if (disabled(item)) { e.preventDefault(); return; } const root = item.closest(".bevel-menu"), role = item.getAttribute("role"), previous = item.getAttribute("aria-checked") === "true"; if (role === "menuitemcheckbox" || role === "menuitemradio") { const next = role === "menuitemradio" ? true : !previous; if (!transition(root, "check", item.dataset.bevelKey, previous, next, () => { if (role === "menuitemradio") root.querySelectorAll('[role="menuitemradio"]').forEach((peer) => peer.setAttribute("aria-checked", String(peer === item))); else item.setAttribute("aria-checked", String(next)); })) return; } action(root, item.dataset.bevelAction || "select", item.dataset.bevelKey); if (item.hasAttribute("data-bevel-update-default")) { const split = root.closest(".bevel-split-button"), main = split?.querySelector("[data-bevel-split-default]"), label = main?.querySelector(".bevel-button__label-text,.bevel-button__label"); if (main && label) { main.dataset.bevelSplitDefault = item.dataset.bevelAction || "select"; main.dataset.bevelKey = item.dataset.bevelKey || ""; label.textContent = item.dataset.bevelDefaultLabel || item.textContent.trim(); } } if (role !== "menuitemcheckbox") closeOverlay(root, { reason: "select" }); });
  on("click", ".bevel-popconfirm [data-bevel-confirm]", (e, button) => { const root = button.closest(".bevel-popconfirm"); if (disabled(button)) return; if (closeOverlay(root, { reason: "confirm" })) action(root, button.dataset.bevelConfirm, button.dataset.bevelKey); });

  const comboOptions = (root) => [...root.querySelectorAll('[role="option"]')].filter((el) => !el.hidden && !el.hasAttribute("data-bevel-filtered") && el.getAttribute("aria-disabled") !== "true");
  const comboFilter = (root, query) => { let matches = 0; for (const option of root.querySelectorAll('[role="option"]')) { const filtered = !(option.dataset.bevelLabel || option.textContent).toLowerCase().includes(query.toLowerCase()); option.toggleAttribute("data-bevel-filtered", filtered); if (!option.hidden && !filtered && option.getAttribute("aria-disabled") !== "true") matches++; } const empty = root.querySelector(".bevel-combobox__empty"); if (empty) empty.hidden = matches > 0; };
  const comboCommit = (root, option) => { if (disabled(root) || disabled(root.querySelector('[role="combobox"]')) || (option && disabled(option))) return false; const input = root.querySelector('[role="combobox"]'), hidden = root.querySelector('input[type="hidden"]'), previous = hidden?.value || "", next = option?.dataset.bevelKey || ""; transition(root, "select", next, previous, next, () => { if (hidden) { hidden.value = next; if (hidden.getAttribute("value") !== next) hidden.setAttribute("value", next); } if (root.dataset.bevelValue !== next) root.dataset.bevelValue = next; if (input) { const label = option?.dataset.bevelLabel || option?.textContent.trim() || ""; input.value = label; if (input.getAttribute("value") !== label) input.setAttribute("value", label); input.removeAttribute("aria-activedescendant"); } refreshCombo(root); const panel = root.querySelector('[role="listbox"]'); if (panel?.matches(":popover-open")) closeOverlay(panel, { reason: "select", focus: false }); }); };
  on("input", ".bevel-combobox [role='combobox']", (e, input) => { if (e.isComposing || disabled(input) || disabled(input.closest(".bevel-combobox"))) return; const root = input.closest(".bevel-combobox"), list = root.querySelector('[role="listbox"]'); comboFilter(root, input.value); refreshCombo(root); if (!list.matches(":popover-open")) openOverlay(list, { trigger: input }); });
  on("keydown", ".bevel-combobox [role='combobox']", (e, input) => { if (e.isComposing || disabled(input) || disabled(input.closest(".bevel-combobox"))) return; const root = input.closest(".bevel-combobox"), list = root.querySelector('[role="listbox"]'), options = comboOptions(root), active = targetById(input.getAttribute("aria-activedescendant")), index = options.indexOf(active); if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (!list.matches(":popover-open")) openOverlay(list, { trigger: input }); const next = e.key === "ArrowDown" ? options[(index + 1) % options.length] : options[(index - 1 + options.length) % options.length]; if (next) { if (!next.id) next.id = `${root.id || "bevel-combo"}-option-${options.indexOf(next)}`; input.setAttribute("aria-activedescendant", next.id); } } else if (e.key === "Enter" && active) { e.preventDefault(); comboCommit(root, active); } else if (e.key === "Escape") { refreshCombo(root, true); input.removeAttribute("aria-activedescendant"); if (list.matches(":popover-open")) closeOverlay(list, { reason: "escape" }); } else if (e.key === "Tab") { refreshCombo(root, true); input.removeAttribute("aria-activedescendant"); if (list.matches(":popover-open")) closeOverlay(list, { reason: "tab", focus: false }); } });
  on("pointerdown", ".bevel-combobox [role='option']", (e, option) => { e.preventDefault(); comboCommit(option.closest(".bevel-combobox"), option); });
  on("click", ".bevel-combobox [data-bevel-combo-clear]", (e, button) => { const root = button.closest(".bevel-combobox"), input = root.querySelector('[role="combobox"]'); if (input?.required) return; comboCommit(root, null); input?.focus(); });
  on("change", ".bevel-multiselect__panel input[type='checkbox']", (e, input) => { const root = input.closest(".bevel-multiselect"), nextChecked = input.checked, previousChecked = !nextChecked, before = [...root.querySelectorAll('.bevel-multiselect__panel input[type="checkbox"]')].filter((item) => item !== input ? item.checked : previousChecked).map((item) => item.value), after = [...root.querySelectorAll('.bevel-multiselect__panel input[type="checkbox"]')].filter((item) => item.checked).map((item) => item.value); if (!transition(root, "select", input.value, before, after, () => refreshMulti(root))) { input.checked = previousChecked; input.toggleAttribute("checked", previousChecked); refreshMulti(root); } });
  on("input", ".bevel-multiselect__search", (e, input) => { const root = input.closest(".bevel-multiselect"), query = input.value.toLowerCase(); let matches = 0; for (const label of root.querySelectorAll(".bevel-multiselect__option")) { const checkbox = label.querySelector('input[type="checkbox"]'), filtered = !label.textContent.toLowerCase().includes(query); label.toggleAttribute("data-bevel-filtered", filtered); if (!label.hidden && !filtered && !disabled(checkbox)) matches++; } const empty = root.querySelector(".bevel-multiselect__empty"); if (empty) empty.hidden = matches > 0; });
  on("keydown", ".bevel-multiselect__search", (e, input) => { if (e.key === "Backspace" && !input.value) { const remove = [...input.closest(".bevel-multiselect").querySelectorAll("[data-bevel-multiselect-remove]:not(:disabled)")].at(-1); if (remove) { e.preventDefault(); remove.focus(); } } });
  on("click", ".bevel-multiselect [data-bevel-multiselect-remove]", (e, button) => { const root = button.closest(".bevel-multiselect"), buttons = [...root.querySelectorAll("[data-bevel-multiselect-remove]")], index = buttons.indexOf(button), checkbox = [...root.querySelectorAll('.bevel-multiselect__panel input[type="checkbox"]')].find((input) => input.value === button.dataset.bevelMultiselectRemove); if (!checkbox || disabled(checkbox)) return; checkbox.click(); requestAnimationFrame(() => { const remaining = [...root.querySelectorAll("[data-bevel-multiselect-remove]")]; (remaining[index] || remaining[index - 1] || root.querySelector(".bevel-multiselect__summary"))?.focus(); }); });

  const acceptFiles = (root, files) => {
    if (!root) return { accepted: [], rejected: [] };
    const limit = Number(root.dataset.bevelMaxBytes) || Infinity, accept = (root.querySelector('input[type="file"]')?.accept || "").split(",").map((s) => s.trim()).filter(Boolean), accepted = [], rejected = [];
    for (const file of files || []) { const validType = !accept.length || accept.some((rule) => rule.endsWith("/*") ? file.type.startsWith(rule.slice(0, -1)) : rule.startsWith(".") ? file.name.toLowerCase().endsWith(rule.toLowerCase()) : file.type.toLowerCase() === rule.toLowerCase()); if (file.size > limit) rejected.push({ name: file.name, reason: `File exceeds the ${limit.toLocaleString()} byte limit` }); else if (!validType) rejected.push({ name: file.name, reason: "File type is not accepted" }); else accepted.push({ key: crypto.randomUUID?.() || `file-${Date.now()}-${Math.random().toString(36).slice(2)}`, file }); }
    const store = uploadFiles.get(root) || new Map();
    const list = root.querySelector("[data-bevel-upload-list]") || (() => { const node = document.createElement("div"); node.className = "bevel-upload"; node.dataset.bevelUploadList = ""; root.append(node); return node; })();
    for (const item of accepted) {
      const preview = item.file.type.startsWith("image/") ? URL.createObjectURL(item.file) : "";
      store.set(item.key, { file: item.file, preview });
      let row = list.querySelector(`[data-bevel-file-key="${CSS.escape(item.key)}"]`);
      if (!row) { row = document.createElement("article"); row.className = "bevel-upload__row"; row.dataset.bevelFileKey = item.key; row.innerHTML = '<div class="bevel-upload__preview" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square" stroke-linejoin="miter"><path d="M5 3h9l5 5v13H5ZM14 3v6h5"/></svg><img alt="" hidden></div><div class="bevel-upload__copy"><strong class="bevel-upload__name"></strong><span class="bevel-upload__meta"></span><span class="bevel-upload__status" role="status"></span><progress class="bevel-upload__progress" max="100" value="0" aria-label="Upload progress"></progress></div><span class="bevel-upload__state" aria-hidden="true"></span><div class="bevel-upload__actions"><button class="bevel-button bevel-button--small" type="button" data-bevel-upload-retry hidden>Retry</button><button class="bevel-button bevel-button--small" type="button" data-bevel-upload-remove>Remove</button></div>'; list.append(row); }
      row.dataset.bevelStatus = "selected";
      row.dataset.bevelName = item.file.name;
      row.querySelector(".bevel-upload__name").textContent = item.file.name;
      row.querySelector(".bevel-upload__meta").textContent = uploadSize(item.file.size);
      row.querySelector(".bevel-upload__status").textContent = "Selected";
      const image = row.querySelector(".bevel-upload__preview img");
      if (preview) { image.src = preview; image.hidden = false; }
    }
    for (const item of rejected) { const row = document.createElement("p"); row.className = "bevel-upload__rejection"; row.dataset.bevelRejected = ""; row.setAttribute("role", "alert"); row.textContent = `${item.name}: ${item.reason}`; list.append(row); }
    uploadFiles.set(root, store); emit(root, "bevel:files", { files: accepted, rejected }); return { accepted, rejected };
  };
  on("change", ".bevel-dropzone input[type='file']", (e, input) => { acceptFiles(input.closest(".bevel-dropzone"), input.files); input.value = ""; });
  on("dragover", ".bevel-dropzone", (e, root) => { e.preventDefault(); root.dataset.bevelDragging = ""; });
  on("dragleave", ".bevel-dropzone", (e, root) => root.removeAttribute("data-bevel-dragging"));
  on("drop", ".bevel-dropzone", (e, root) => { e.preventDefault(); root.removeAttribute("data-bevel-dragging"); acceptFiles(root, e.dataTransfer.files); });
  on("click", ".bevel-dropzone [data-bevel-upload-remove]", (e, button) => upload.remove(button.closest(".bevel-dropzone"), button.closest("[data-bevel-file-key]").dataset.bevelFileKey));
  on("click", ".bevel-dropzone [data-bevel-upload-retry]", (e, button) => { const root = button.closest(".bevel-dropzone"), key = button.closest("[data-bevel-file-key]").dataset.bevelFileKey; if (uploadFiles.get(root)?.has(key)) action(root, "retry", key); });

  const inlinePart = (root, selector) => [...root.querySelectorAll(selector)].find(node => node.closest(".bevel-inline-edit") === root);
  const inlineReadOnly = root => disabled(root) || root.getAttribute("aria-readonly") === "true" || root.hasAttribute("data-bevel-readonly");
  const clearInlineError = root => {
    const message = inlinePart(root, "[data-bevel-edit-error]");
    setFieldError(message, "");
  };
  const startEdit = (root) => {
    if (!root?.matches(".bevel-inline-edit") || inlineReadOnly(root)) return false;
    if (sessions.get(root)?.input) return true;
    const value = inlinePart(root, ".bevel-inline-edit__value"), container = inlinePart(root, ".bevel-inline-edit__editor"), trigger = inlinePart(root, "[data-bevel-edit-start]");
    if (!value || !container || (trigger && disabled(trigger))) return false;
    const template = inlinePart(root, "template[data-bevel-edit-template]");
    const draft = template?.content.cloneNode(true);
    let input = draft?.querySelector(".bevel-inline-edit__input") || inlinePart(root, ".bevel-inline-edit__input");
    if (!input || disabled(input)) return false;
    const rich = root.dataset.bevelEditKind === "rich";
    if (rich && !window.Bevel.richtext) { error(root, "missing-richclay", "Load the Richclay integration before editing rich content."); return false; }
    if (rich && typeof window.RichClay !== "function") { error(root, "missing-richclay", "Load Richclay before editing rich content."); return false; }
    if (draft) {
      for (const child of draft.children) child.setAttribute("data-bevel-transient", "inline-draft");
      (inlinePart(root, "[data-bevel-edit-slot]") || container).prepend(draft);
    }
    clearInlineError(root);
    let editor, toolbarHost;
    const cleanup = (focus = false) => {
      if (rich) window.Bevel.richtext?.unmount(input);
      toolbarHost?.remove();
      if (template) container.querySelectorAll('[data-bevel-transient="inline-draft"]').forEach(node => node.remove());
      else { input.value = value.textContent; input.removeAttribute("aria-invalid"); }
      root.removeAttribute("data-bevel-editing");
      clearInlineError(root);
      sessions.delete(root);
      if (focus && trigger?.isConnected && !disabled(trigger)) trigger.focus();
    };
    root.setAttribute("data-bevel-editing", "");
    try {
      if (rich) {
        input.setAttribute("data-bevel-richtext", "");
        if (input.hasAttribute("required")) input.setAttribute("aria-required", "true");
        input.innerHTML = value.innerHTML;
        const singleLine = root.hasAttribute("data-bevel-single-line");
        const insideModal = !!root.closest("dialog");
        if (insideModal && !singleLine) {
          toolbarHost = document.createElement("div");
          toolbarHost.setAttribute("data-bevel-transient", "inline-draft");
          container.prepend(toolbarHost);
        }
        [editor] = window.Bevel.richtext.mount(input, { inline: !insideModal || singleLine, singleLine, toolbar: singleLine ? false : "inline", toolbarContainer: toolbarHost, placeholder: input.dataset.bevelPlaceholder || "", hyperclay: false });
        editor.focus();
      } else {
        input.value = value.textContent;
        input.focus();
        if (input.type !== "number") input.select();
      }
      const original = rich ? value.innerHTML : value.textContent;
      const valid = () => inlinePart(root, ".bevel-inline-edit__value") === value && inlinePart(root, ".bevel-inline-edit__editor") === container && container.contains(input) && (rich ? value.innerHTML : value.textContent) === original;
      sessions.set(root, { input, editor, rich, trigger, cleanup, valid, cancel: () => cleanup() });
      return true;
    } catch (cause) {
      cleanup();
      error(root, "editor-start", cause.message);
      return false;
    }
  };
  const endEdit = (root, commit) => {
    if (!root) return false;
    const session = sessions.get(root);
    if (!session?.input) return false;
    if (!session.valid()) { session.cleanup(); return false; }
    if (!commit) { session.cleanup(true); return true; }
    if (inlineReadOnly(root) || disabled(session.input)) return false;
    const { input, rich, editor } = session;
    const valid = rich ? !(input.hasAttribute("required") && !input.textContent.trim()) : input.checkValidity();
    if (!valid) {
      input.setAttribute("aria-invalid", "true");
      const message = inlinePart(root, "[data-bevel-edit-error]");
      if (message) {
        setFieldError(message, root.dataset.bevelValidationMessage || (rich ? "Enter a value before saving." : input.validationMessage));
      }
      input.focus();
      if (!rich && !message) input.reportValidity();
      return false;
    }
    const value = inlinePart(root, ".bevel-inline-edit__value");
    const previous = rich ? value.innerHTML : value.textContent;
    const next = rich ? editor.getHTML() : input.value;
    return transition(root, "edit", root.dataset.bevelKey, previous, next, () => {
      if (rich) value.innerHTML = next;
      else value.textContent = next;
      session.cleanup(true);
    });
  };
  on("click", ".bevel-inline-edit [data-bevel-edit-start]", (event, button) => { event.preventDefault(); startEdit(button.closest(".bevel-inline-edit")); });
  on("click", ".bevel-inline-edit [data-bevel-edit-save]", (event, button) => { event.preventDefault(); if (!disabled(button)) endEdit(button.closest(".bevel-inline-edit"), true); });
  on("click", ".bevel-inline-edit [data-bevel-edit-cancel]", (event, button) => { event.preventDefault(); if (!disabled(button)) endEdit(button.closest(".bevel-inline-edit"), false); });
  on("keydown", ".bevel-inline-edit__input", (event, input) => {
    if (event.isComposing) return;
    const root = input.closest(".bevel-inline-edit"), session = sessions.get(root);
    if (!session || session.input !== input) return;
    if (event.key === "Escape") {
      if (event.defaultPrevented) return;
      event.preventDefault(); endEdit(root, false);
    } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey || (session.rich ? root.hasAttribute("data-bevel-single-line") : input.tagName !== "TEXTAREA"))) {
      event.preventDefault(); endEdit(root, true);
    }
  }, true);

  on("click", ".bevel-split-button [data-bevel-split-default]", (e, button) => { if (!disabled(button)) action(button.closest(".bevel-split-button"), button.dataset.bevelSplitDefault, button.dataset.bevelKey); });

  on("click", ".bevel-toolbar [data-bevel-toggle]", (event, button) => { if (disabled(button)) return; const root = button.closest(".bevel-toolbar"), group = button.closest("[data-bevel-toggle-group]"); if (group) { const peers = [...group.querySelectorAll("[data-bevel-toggle]")], previous = peers.find((peer) => peer.getAttribute("aria-pressed") === "true")?.dataset.bevelToggle || "", next = button.dataset.bevelToggle; if (previous === next) return; transition(root, "toggle", next, previous, next, () => peers.forEach((peer) => peer.setAttribute("aria-pressed", String(peer === button)))); } else { const previous = button.getAttribute("aria-pressed") === "true", next = !previous; transition(root, "toggle", button.dataset.bevelToggle, previous, next, () => button.setAttribute("aria-pressed", String(next))); } });

  on("click", ".bevel-pagination [data-bevel-page]", (e, button) => { const root = button.closest(".bevel-pagination"); if (disabled(button)) return; const target = root.dataset.bevelTarget && document.getElementById(root.dataset.bevelTarget), grid = target?.matches(".bevel-grid") ? target : null, previous = Number(grid?.dataset.page || root.dataset.bevelPage) || 1, size = Number(grid?.dataset.pageSize || root.dataset.bevelPageSize) || 10, total = grid ? (grid.hasAttribute("data-bevel-total") ? Number(grid.dataset.bevelTotal) : null) : Number(root.dataset.bevelTotal) || 0, pages = total == null ? null : Math.max(1, Math.ceil(Math.max(0, total) / size)), token = button.dataset.bevelPage, next = token === "prev" ? previous - 1 : token === "next" ? previous + 1 : Number(token); if (!next || next < 1 || (pages != null && next > pages)) return; if (grid) changeGridPage(grid, token); else transition(root, "page", next, previous, next, () => { root.dataset.bevelPage = String(next); refreshPager(root); }); });
  on("change", ".bevel-pagination select[data-bevel-page-size]", (event, control) => { const root = control.closest(".bevel-pagination"), target = root.dataset.bevelTarget && document.getElementById(root.dataset.bevelTarget), grid = target?.matches(".bevel-grid") ? target : null, previous = Number(grid?.dataset.pageSize || root.dataset.bevelPageSize) || 10, next = Number(control.value); if (!Number.isFinite(next) || next < 1 || next === previous) { refreshPager(root); return; } const before = { page: Number(grid?.dataset.page || root.dataset.bevelPage) || 1, pageSize: previous }, after = { page: 1, pageSize: next }; if (grid?.dataset.bevelDataMode === "remote") { remoteRequest(grid, "page", "size", before, after); refreshPager(root); return; } if (grid) { grid.dataset.pageSize = String(next); grid.dataset.page = "1"; layoutGrid(grid); emit(grid, "bevel:page", { page: Number(grid.dataset.page), pageSize: next }); } else transition(root, "page-size", next, before, after, () => { root.dataset.bevelPageSize = String(next); root.dataset.bevelPage = "1"; refreshPager(root); }); });
  on("click", ".bevel-sidebar [data-bevel-sidebar-toggle]", (event, button) => { if (disabled(button)) return; event.preventDefault(); const root = button.closest(".bevel-sidebar"), previous = root.hasAttribute("data-bevel-collapsed"), next = !previous; transition(root, "collapse", "sidebar", previous, next, () => { root.toggleAttribute("data-bevel-collapsed", next); refreshSidebar(root); }); });
  on("click", ".bevel-app-shell [data-bevel-shell-nav]", (event, button) => { if (disabled(button)) return; event.preventDefault(); const root = button.closest(".bevel-app-shell"), previous = root.hasAttribute("data-bevel-nav-open"), next = !previous; transition(root, "open", "sidebar", previous, next, () => { root.toggleAttribute("data-bevel-nav-open", next); refreshShell(root); }); });
  on("click", ".bevel-app-shell .bevel-app-shell__side [data-bevel-shell-collapse]", (event, button) => { if (disabled(button)) return; event.preventDefault(); const root = button.closest(".bevel-app-shell"), side = button.closest(".bevel-app-shell__side"), previous = side.hasAttribute("data-bevel-collapsed"), next = !previous; transition(root, "collapse", "sidebar", previous, next, () => { side.toggleAttribute("data-bevel-collapsed", next); refreshShell(root); }); });
  const selectTreeItem = (root, item) => { const previous = root.dataset.bevelSelected || "", next = item.dataset.bevelKey; return transition(root, "select", next, previous, next, () => { root.dataset.bevelSelected = next; refreshTree(root); }); };
  const setTreeExpanded = (root, item, next) => { const branch = item.closest("details"); if (!branch || branch.querySelector(":scope > summary") !== item) return false; const previous = branch.open; if (previous === next) return true; return transition(root, next ? "expand" : "collapse", item.dataset.bevelKey, previous, next, () => { branch.open = next; branch.dataset.bevelExpanded = String(next); refreshTree(root); }); };
  on("click", '.bevel-tree [role="treeitem"][data-bevel-key]', (event, item) => { const root = item.closest(".bevel-tree"); if (disabled(item)) { event.preventDefault(); return; } if (item.tagName === "SUMMARY") { event.preventDefault(); setTreeExpanded(root, item, !item.closest("details").open); } else selectTreeItem(root, item); });
  on("keydown", '.bevel-tree [role="treeitem"][data-bevel-key]', (event, item) => {
    if (event.isComposing || disabled(item)) return;
    const root = item.closest(".bevel-tree"), visible = treeVisible(root), index = visible.indexOf(item);
    const focus = (next) => { if (!next) return; event.preventDefault(); for (const node of treeItems(root)) node.tabIndex = node === next ? 0 : -1; next.focus(); };
    if (event.key === "ArrowDown") return focus(visible[index + 1] || visible[0]);
    if (event.key === "ArrowUp") return focus(visible[index - 1] || visible.at(-1));
    if (event.key === "Home") return focus(visible[0]);
    if (event.key === "End") return focus(visible.at(-1));
    if (event.key === "ArrowRight" && item.tagName === "SUMMARY") { const branch = item.closest("details"); if (!branch.open) { event.preventDefault(); setTreeExpanded(root, item, true); } else focus(treeVisible(root).find((candidate) => candidate !== item && branch.contains(candidate))); return; }
    if (event.key === "ArrowLeft") { if (item.tagName === "SUMMARY" && item.closest("details").open) { event.preventDefault(); setTreeExpanded(root, item, false); return; } const owner = item.tagName === "SUMMARY" ? item.closest("details")?.parentElement : item.parentElement, parent = owner?.closest("details")?.querySelector(":scope > summary"); if (parent) focus(parent); return; }
    if (event.key === "Enter") { if (item.tagName !== "A") event.preventDefault(); selectTreeItem(root, item); return; }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) { const now = performance.now(), prior = root._bevelTypeahead || { value: "", at: 0 }, value = now - prior.at > 700 ? event.key : prior.value + event.key; root._bevelTypeahead = { value: value.toLocaleLowerCase(), at: now }; const ordered = [...visible.slice(index + 1), ...visible.slice(0, index + 1)], match = ordered.find((candidate) => (candidate.dataset.bevelLabel || candidate.textContent).trim().toLocaleLowerCase().startsWith(root._bevelTypeahead.value)); if (match) focus(match); }
  });
  document.addEventListener("toggle", (event) => { const branch = event.target; if (!(branch instanceof HTMLDetailsElement)) return; const root = branch.closest(".bevel-tree"), item = branch.querySelector(":scope > summary"); if (!root || !item) return; if (!branch.open && branch.contains(document.activeElement) && document.activeElement !== item) item.focus(); refreshTree(root); }, true);
  /* ---------- file tree ---------- */
  const fileTreeRows = (root) => [...root.querySelectorAll(".bevel-file-tree__row")].filter((row) => row.closest(".bevel-file-tree") === root);
  const fileTreeVisible = (root) => fileTreeRows(root).filter((row) => !row.hidden && !row.closest("[hidden]"));
  const fileTreeGroup = (row) => targetById(row.getAttribute("aria-controls"));
  const syncFileTree = (root) => {
    if (root.getAttribute("role") !== "tree") root.setAttribute("role", "tree");
    const selected = root.dataset.bevelSelected || "";
    for (const row of fileTreeRows(root)) {
      if (row.getAttribute("role") !== "treeitem") row.setAttribute("role", "treeitem");
      const group = fileTreeGroup(row);
      if (group) group.hidden = row.hidden || row.getAttribute("aria-expanded") !== "true";
      if (!group) { const value = String(row.dataset.bevelKey === selected); if (row.getAttribute("aria-selected") !== value) row.setAttribute("aria-selected", value); }
    }
    const visible = fileTreeVisible(root);
    const current = visible.find((row) => row === document.activeElement) || visible.find((row) => row.tabIndex === 0) || visible.find((row) => row.dataset.bevelKey === selected) || visible[0];
    for (const row of fileTreeRows(root)) { const value = row === current ? "0" : "-1"; if (row.getAttribute("tabindex") !== value) row.setAttribute("tabindex", value); }
    const empty = root.querySelector(".bevel-file-tree__empty");
    if (empty) empty.hidden = visible.length > 0;
  };
  const setFileTreeExpanded = (root, row, next) => {
    const previous = row.getAttribute("aria-expanded") === "true";
    if (previous === next) return true;
    return transition(root, next ? "expand" : "collapse", row.dataset.bevelKey, previous, next, () => {
      row.setAttribute("aria-expanded", String(next));
      row.dataset.bevelExpanded = String(next);
      syncFileTree(root);
    });
  };
  const selectFileTreeRow = (root, row) => {
    const previous = root.dataset.bevelSelected || "", next = row.dataset.bevelKey;
    return transition(root, "select", next, previous, next, () => { root.dataset.bevelSelected = next; syncFileTree(root); });
  };

  const filterFileTree = (root, query) => {
    const value = query.trim().toLocaleLowerCase(), rows = fileTreeRows(root);
    for (const row of rows) {
      const label = (row.dataset.bevelLabel || row.textContent).trim().toLocaleLowerCase();
      row.hidden = Boolean(value) && !label.includes(value);
      if (!value && row.hasAttribute("aria-expanded")) row.setAttribute("aria-expanded", row.dataset.bevelExpanded || "false");
    }
    if (value) for (const row of rows) {
      if (row.hidden) continue;
      for (let group = row.parentElement?.closest(".bevel-file-tree__group"); group && root.contains(group); group = group.parentElement?.closest(".bevel-file-tree__group")) {
        const owner = rows.find((candidate) => candidate.getAttribute("aria-controls") === group.id);
        if (!owner) break;
        owner.hidden = false;
        owner.setAttribute("aria-expanded", "true");
      }
    }
    syncFileTree(root);
    emit(root, "bevel:filter", { component: "file-tree", value: query, matches: fileTreeVisible(root).filter((row) => !row.hasAttribute("aria-controls")).length });
  };
  on("click", ".bevel-file-tree__row", (event, row) => {
    const root = row.closest(".bevel-file-tree");
    if (!root || disabled(row)) { event.preventDefault(); return; }
    if (row.hasAttribute("aria-expanded")) { event.preventDefault(); setFileTreeExpanded(root, row, row.getAttribute("aria-expanded") !== "true"); return; }
    selectFileTreeRow(root, row);
  });
  on("keydown", ".bevel-file-tree__row", (event, row) => {
    if (event.isComposing || disabled(row)) return;
    const root = row.closest(".bevel-file-tree");
    if (!root) return;
    const visible = fileTreeVisible(root), index = visible.indexOf(row);
    const focus = (next) => { if (!next) return; event.preventDefault(); for (const item of fileTreeRows(root)) item.tabIndex = item === next ? 0 : -1; next.focus(); };
    if (event.key === "ArrowDown") return focus(visible[index + 1] || visible[0]);
    if (event.key === "ArrowUp") return focus(visible[index - 1] || visible.at(-1));
    if (event.key === "Home") return focus(visible[0]);
    if (event.key === "End") return focus(visible.at(-1));
    if (event.key === "ArrowRight" && row.hasAttribute("aria-expanded")) {
      if (row.getAttribute("aria-expanded") !== "true") { event.preventDefault(); setFileTreeExpanded(root, row, true); }
      else focus(fileTreeGroup(row)?.querySelector(".bevel-file-tree__row"));
      return;
    }
    if (event.key === "ArrowLeft") {
      if (row.hasAttribute("aria-expanded") && row.getAttribute("aria-expanded") === "true") { event.preventDefault(); setFileTreeExpanded(root, row, false); return; }
      const group = row.parentElement?.closest(".bevel-file-tree__group");
      if (group) focus(fileTreeRows(root).find((candidate) => candidate.getAttribute("aria-controls") === group.id));
      return;
    }
    if (event.key === "Enter" && row.tagName !== "A") { event.preventDefault(); row.click(); }
  });
  on("input", "[data-bevel-file-tree]", (event, input) => {
    const root = targetById(input.dataset.bevelFileTree);
    if (root) filterFileTree(root, input.value);
  });

  const reportFormErrors = (form, controls) => {
    if (!form) {
      const invalid = invalidControls(controls);
      if (invalid.length) requestAnimationFrame(() => invalid[0].focus());
      return invalid;
    }
    const invalid = refreshErrors(form, controls);
    if (!invalid.length) return invalid;
    revealWizardControl(invalid[0]);
    const summary = form.querySelector(".bevel-errors");
    if (summary && !summary.hasAttribute("tabindex")) summary.tabIndex = -1;
    requestAnimationFrame(() => (summary || invalid[0]).focus());
    return invalid;
  };
  on("click", ".bevel-wizard [data-bevel-step]", (event, button) => {
    const root = button.closest(".bevel-wizard");
    if (button === root || !button.matches("button,[role='button']") || disabled(button)) return;
    const panels = wizardPanels(root), current = panels.findIndex((panel, index) => wizardKey(panels, panel, index) === String(root.dataset.bevelStep));
    const token = button.dataset.bevelStep;
    const target = token === "next" ? current + 1 : token === "prev" ? current - 1 : panels.findIndex((panel, index) => wizardKey(panels, panel, index) === token);
    if (current < 0 || target < 0 || target >= panels.length || disabled(panels[target])) return;
    if (target > current) {
      const requiredPanels = (token === "next" ? [panels[current]] : panels.slice(0, target)).filter((panel) => !disabled(panel));
      const invalid = wizardInvalid(requiredPanels);
      if (invalid.length) {
        event.preventDefault();
        reportFormErrors(root.closest("form"), wizardControls(invalid[0].closest(".bevel-wizard__panel")));
        return;
      }
    }
    const previous = wizardKey(panels, panels[current], current), next = wizardKey(panels, panels[target], target);
    transition(root, "step", next, previous, next, () => { root.dataset.bevelStep = next; refreshWizard(root); });
  });
  document.addEventListener("submit", (event) => {
    const form = event.target.closest?.("form[data-bevel-validate]");
    if (!form) return;
    const root = [...form.querySelectorAll(".bevel-wizard")].find((wizard) => wizard.closest("form") === form);
    const invalid = reportFormErrors(form, [...form.elements]);
    if (invalid.length) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (root) action(root, "finish", root.dataset.bevelStep || "");
  }, true);
  document.addEventListener("invalid", (event) => { const form = event.target.form?.matches("[data-bevel-validate]") ? event.target.form : null; if (form) requestAnimationFrame(() => refreshErrors(form)); }, true);
  document.addEventListener("input", (event) => { const form = event.target.form?.matches("[data-bevel-validate]") ? event.target.form : null; if (form && event.target.hasAttribute("aria-invalid")) queueMicrotask(() => { if (event.target.validity.valid) event.target.removeAttribute("aria-invalid"); refreshErrors(form); }); }, true);
  document.addEventListener("reset", (event) => { const form = event.target.closest?.("form[data-bevel-validate]"); if (form) requestAnimationFrame(() => { for (const control of form.querySelectorAll('[aria-invalid="true"]')) control.removeAttribute("aria-invalid"); for (const message of form.querySelectorAll("[data-bevel-error-for]")) setFieldError(message, ""); const summary = form.querySelector(".bevel-errors"); if (summary) summary.hidden = true; summary?.querySelector(".bevel-errors__list")?.replaceChildren(); const session = wizardForms.get(form); for (const [root, step] of session?.initialSteps || []) { if (step == null) delete root.dataset.bevelStep; else root.dataset.bevelStep = step; refreshWizard(root); } }); }, true);
  document.addEventListener("reset", (event) => requestAnimationFrame(() => refresh(event.target)), true);
  on("click", "[data-bevel-action]", (e, button) => { if (disabled(button) || button.closest(".bevel-menu") || (button.hasAttribute("data-bevel-toggle") && button.closest(".bevel-toolbar"))) return; const root = button.closest(".bevel-action-banner,.bevel-bulk-bar,.bevel-toolbar,.bevel-breadcrumbs,.bevel-kanban,.bevel-settings,.bevel-popconfirm,.bevel-sidebar,.bevel-files") || button; action(root, button.dataset.bevelAction, button.dataset.bevelKey); });
  on("click", ".bevel-action-banner [data-bevel-banner-dismiss]", (event, button) => { const root = button.closest(".bevel-action-banner"); if (disabled(button)) return; transition(root, "dismiss", root.dataset.bevelKey || "", false, true, () => { root.hidden = true; root.dataset.bevelDismissed = ""; }); });
  on("keydown", ".bevel-bulk-bar button", (event, button) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const buttons = [...button.closest(".bevel-bulk-bar").querySelectorAll("button")].filter(item => !disabled(item) && !item.hidden), index = buttons.indexOf(button), count = buttons.length;
    if (index < 0) return;
    event.preventDefault();
    buttons[event.key === "Home" ? 0 : event.key === "End" ? count - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + count) % count].focus();
  });

  on("click", ".bevel-code [data-bevel-code-wrap]", (e, button) => { if (disabled(button)) return; const root = button.closest(".bevel-code"), previous = root.hasAttribute("data-bevel-wrap"); transition(root, "wrap", "wrap", previous, !previous, () => { root.toggleAttribute("data-bevel-wrap", !previous); refreshCode(root); }); });
  on("click", ".bevel-code [data-bevel-copy]", async (e, button) => {
    if (disabled(button)) return;
    const root = button.closest(".bevel-code"), code = root.querySelector("pre code") || root.querySelector("code"), text = code?.textContent || "";
    clearCodeFeedback(root);
    const session = {}; codeFeedback.set(root, session);
    let copied = false;
    try { await navigator.clipboard.writeText(text); copied = true; } catch {}
    if (!root.isConnected || codeFeedback.get(root) !== session) return;
    const notice = document.createElement("p"); notice.className = "bevel-code__notice"; notice.dataset.bevelTransient = "clipboard"; notice.setAttribute("role", "status");
    notice.textContent = copied ? "Copied" : "Could not copy. Select the code below and copy it manually."; root.append(notice);
    if (copied) session.timer = setTimeout(() => clearCodeFeedback(root), 1500);
    else {
      const fallback = document.createElement("textarea"); fallback.className = "bevel-code__fallback"; fallback.dataset.bevelTransient = "clipboard"; fallback.readOnly = true; fallback.setAttribute("aria-label", "Code to copy manually"); fallback.value = text; root.append(fallback); fallback.focus(); fallback.select();
      error(root, "clipboard", "Could not copy code to the clipboard.");
    }
  });
  on("click", ".bevel-diff button[data-bevel-layout]", (e, button) => { if (disabled(button)) return; const root = button.closest(".bevel-diff"), previous = root.dataset.bevelLayout || "unified", next = button.dataset.bevelLayout; if (!["unified", "split"].includes(next) || previous === next) return; transition(root, "layout", next, previous, next, () => { root.dataset.bevelLayout = next; refreshDiff(root); }); });
  on("click", ".bevel-activity [data-bevel-activity-more]", (event, button) => {
    if (disabled(button)) return;
    const root = button.closest(".bevel-activity");
    if (root.hasAttribute("data-bevel-expanded")) action(root, "load-more", root.dataset.bevelKey || "");
    else transition(root, "reveal", root.dataset.bevelKey || "", false, true, () => { root.dataset.bevelExpanded = ""; refreshActivity(root); });
  });
  document.addEventListener("error", (event) => { if (event.target?.matches?.(".bevel-avatars__image")) showAvatarFallback(event.target); }, true);
  on("click", ".bevel-chart [data-bevel-series]", (event, button) => {
    if (disabled(button)) return;
    const root = button.closest(".bevel-chart"), previous = button.getAttribute("aria-pressed") !== "false", next = !previous;
    transition(root, "series", button.dataset.bevelSeries, previous, next, () => { button.setAttribute("aria-pressed", String(next)); refreshChart(root); });
  });
  const kanbanSelect = (root, key) => {
    if (disabled(root) || root.dataset.bevelSelected === key) return;
    transition(root,'select',key,root.dataset.bevelSelected || '',key,()=>{ if (key) root.dataset.bevelSelected=key; else delete root.dataset.bevelSelected; if (root.hasAttribute('data-bevel-selected-keys')) root.dataset.bevelSelectedKeys=JSON.stringify(key ? [key] : []); refreshKanban(root); });
  };
  on('input','.bevel-kanban__search input,input.bevel-kanban__search',(event,input)=>{
    const root=input.closest('.bevel-kanban'),previous=input.getAttribute('value') || '',next=input.value;
    if (kanbanDisabled(input)) { input.value=previous; return; }
    const committed=localOrRemote(root,'search','',previous,next,()=>{input.setAttribute('value',next);root.dataset.bevelQuery=next;refreshKanban(root);});
    if (!committed || root.dataset.bevelDataMode==='remote') input.value=previous;
  });
  on('click','.bevel-kanban__card',(event,card)=>{if (!kanbanDisabled(card) && !event.target.closest('button,a,input,select,textarea')) kanbanSelect(card.closest('.bevel-kanban'),card.dataset.bevelKey);});
  on('keydown','.bevel-kanban__card',(event,card)=>{
    if (event.target !== card || kanbanDisabled(card)) return;
    const root=card.closest('.bevel-kanban');
    if (event.key==='Enter' || event.key===' ') {event.preventDefault();kanbanSelect(root,card.dataset.bevelKey);return;}
    if (!event.altKey || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
    event.preventDefault();const list=card.parentElement,columns=[...root.querySelectorAll('.bevel-kanban__list')].filter(node=>node.closest('.bevel-kanban')===root),ci=columns.indexOf(list),siblings=[...list.children].filter(node=>node.matches('.bevel-kanban__card')),index=siblings.indexOf(card);
    if (event.key==='ArrowUp' || event.key==='ArrowDown') kanbanMove(root,card,list,Math.max(0,Math.min(siblings.length-1,index+(event.key==='ArrowUp'?-1:1))));
    else {const destination=columns[ci+(event.key==='ArrowLeft'?-1:1)];if(destination)kanbanMove(root,card,destination,[...destination.children].filter(node=>node.matches('.bevel-kanban__card')).length);}
  });
  on('click','[data-bevel-kanban-create]',(event,button)=>{if(kanbanDisabled(button))return;const root=button.closest('.bevel-kanban');kanbanEditor(root,null,button.dataset.bevelColumn || button.closest('.bevel-kanban__column')?.dataset.bevelColumnKey || root.querySelector('.bevel-kanban__column')?.dataset.bevelColumnKey);});
  on('click','[data-bevel-kanban-edit]',(event,button)=>{if(kanbanDisabled(button))return;const root=button.closest('.bevel-kanban'),card=kanbanSelected(root);if(card)kanbanEditor(root,card);});
  on('click','[data-bevel-kanban-close]',(event,button)=>{if(kanbanDisabled(button))return;const root=button.closest('.bevel-kanban'),card=kanbanSelected(root);kanbanSelect(root,'');if(!root.dataset.bevelSelected)card?.focus();});
  on('input','[data-bevel-kanban-form] [name="title"]',(event,input)=>input.setCustomValidity(''));
  on('keydown','[data-bevel-kanban-form]',(event)=>{if(event.isComposing && event.key==='Enter')event.preventDefault();});
  on('submit','[data-bevel-kanban-form]',(event,form)=>{
    event.preventDefault();event.stopPropagation();const root=form.closest('.bevel-kanban');
    if(disabled(root)||disabled(event.submitter || form.querySelector('[data-bevel-kanban-save]')))return;
    const key=form.elements.key.value,existing=kanbanCards(root).find(card=>card.dataset.bevelKey===key),title=form.elements.title;
    title.setCustomValidity(title.value.trim() ? '' : 'Enter a task title.');if(!form.reportValidity())return;
    const value={key:key || `FN-${Math.max(100,...kanbanCards(root).map(card=>Number(card.dataset.bevelKey.replace(/\D/g,''))||0))+1}`,column:form.elements.column.value,title:title.value.trim(),description:form.elements.description.value.trim(),assignee:form.elements.assignee.value,priority:form.elements.priority.value,due:form.elements.due.value,labels:[...new Set(form.elements.labels.value.split(',').map(label=>label.trim().toLowerCase()).filter(Boolean))]};
    const column=root.querySelector(`.bevel-kanban__column[data-bevel-column-key="${CSS.escape(value.column)}"] .bevel-kanban__list`);if(!column)return;
    const operation=existing?'edit':'create';
    localOrRemote(root,operation,value.key,kanbanSnapshot(existing),value,()=>{
      if(existing)updateKanbanCard(existing,value);else{const card=kanbanCard(value);column.insertBefore(card,column.querySelector('.bevel-kanban__add'));updateKanbanCard(card,value);}
      root.dataset.bevelSelected=value.key;closeOverlay(form.closest('dialog'),{focus:false});refreshKanban(root);root.querySelector('[data-bevel-kanban-edit]')?.focus();
    },`${operation}:${value.key}`);
  });
  on('click','[data-bevel-kanban-archive],[data-bevel-kanban-restore]',(event,button)=>{
    if(kanbanDisabled(button))return;const root=button.closest('.bevel-kanban'),card=kanbanSelected(root);if(!card)return;
    const previous=card.hasAttribute('data-bevel-archived'),next=!button.hasAttribute('data-bevel-kanban-restore');if(previous===next)return;
    localOrRemote(root,next?'archive':'restore',card.dataset.bevelKey,previous,next,()=>{card.toggleAttribute('data-bevel-archived',next);if(button.closest('[popover]'))closeOverlay(button.closest('[popover]'),{focus:false});refreshKanban(root);root.querySelector(next?'[data-bevel-kanban-restore]':'[data-bevel-kanban-edit]')?.focus();},`archive:${card.dataset.bevelKey}`);
  });
  on('change','[data-bevel-kanban-inspector] [data-bevel-check-key]',(event,input)=>{
    const root=input.closest('.bevel-kanban'),card=kanbanSelected(root),source=card && kanbanItems(card).find(node=>node.dataset.bevelCheckKey===input.dataset.bevelCheckKey);if(!source)return;
    const previous=source.checked,next=input.checked;
    const committed=!kanbanDisabled(input)&&localOrRemote(root,'checklist',card.dataset.bevelKey,{key:source.dataset.bevelCheckKey,checked:previous},{key:source.dataset.bevelCheckKey,checked:next},()=>{source.checked=next;source.toggleAttribute('checked',next);refreshKanban(root);root.querySelector(`[data-bevel-kanban-inspector] [data-bevel-check-key="${CSS.escape(source.dataset.bevelCheckKey)}"]`)?.focus();},`checklist:${card.dataset.bevelKey}:${source.dataset.bevelCheckKey}`);
    if(!committed || root.dataset.bevelDataMode==='remote'){input.checked=previous;input.toggleAttribute('checked',previous);}
  });
  on('click','[data-bevel-kanban-check-add],[data-bevel-kanban-check-cancel]',(event,button)=>{
    if(kanbanDisabled(button))return;const root=button.closest('.bevel-kanban'),form=root.querySelector('[data-bevel-kanban-check-form]');if(!form)return;
    form.hidden=button.hasAttribute('data-bevel-kanban-check-cancel');if(form.hidden){form.reset();root.querySelector('[data-bevel-kanban-check-add]')?.focus();}else form.elements.text.focus();
  });
  on('input','[data-bevel-kanban-check-form] [name="text"]',(event,input)=>input.setCustomValidity(''));
  on('submit','[data-bevel-kanban-check-form]',(event,form)=>{
    event.preventDefault();event.stopPropagation();const root=form.closest('.bevel-kanban'),card=kanbanSelected(root);if(!card||disabled(root)||disabled(event.submitter))return;
    const text=form.elements.text.value.trim();form.elements.text.setCustomValidity(text ? '' : 'Enter a checklist item.');if(!form.reportValidity())return;const next={key:`check-${crypto.randomUUID()}`,text,checked:false};
    localOrRemote(root,'checklist-add',card.dataset.bevelKey,null,next,()=>{let list=card.querySelector('.bevel-kanban__checklist-data');if(!list){list=kanbanNode('div','bevel-kanban__checklist-data');list.hidden=true;card.append(list);}const label=kanbanNode('label'),input=kanbanNode('input');input.type='checkbox';input.dataset.bevelCheckKey=next.key;label.append(input,document.createTextNode(text));list.append(label);refreshKanban(root);root.querySelector('[data-bevel-kanban-check-add]')?.focus();},`checklist:${card.dataset.bevelKey}`);
  });
  on('click','[data-bevel-kanban-check-remove]',(event,button)=>{
    if(kanbanDisabled(button))return;const root=button.closest('.bevel-kanban'),card=kanbanSelected(root),input=card && kanbanItems(card).find(item=>item.dataset.bevelCheckKey===button.dataset.bevelKanbanCheckRemove);if(!input)return;
    localOrRemote(root,'checklist-remove',card.dataset.bevelKey,{key:input.dataset.bevelCheckKey,text:input.parentElement.textContent.trim(),checked:input.checked},null,()=>{input.parentElement.remove();refreshKanban(root);root.querySelector('[data-bevel-kanban-check-add]')?.focus();},`checklist:${card.dataset.bevelKey}`);
  });
  on('click','[data-bevel-kanban-move]',(event,button)=>{
    if(kanbanDisabled(button))return;const root=button.closest('.bevel-kanban'),card=kanbanSelected(root),key=root.querySelector('[data-bevel-kanban-move-column]').value,list=root.querySelector(`.bevel-kanban__column[data-bevel-column-key="${CSS.escape(key)}"] .bevel-kanban__list`);
    if(list)kanbanMove(root,card,list,root.querySelector('[data-bevel-kanban-move-position]').value==='first'?0:[...list.children].filter(node=>node.matches('.bevel-kanban__card')).length);
  });
  on('change','[data-bevel-kanban-filter]',(event,control)=>{
    const root=control.closest('.bevel-kanban'),kind=control.dataset.bevelKanbanFilter;if(!kanbanFilterKinds.includes(kind))return;
    const attribute=`data-bevel-filter-${kind}`,previous=root.getAttribute(attribute)||'',next=control.value;
    const committed=!kanbanDisabled(control)&&localOrRemote(root,'filter',kind,previous,next,()=>{if(next)root.setAttribute(attribute,next);else root.removeAttribute(attribute);refreshKanban(root);},`filter:${kind}`);
    if(!committed||root.dataset.bevelDataMode==='remote'){control.value=previous;if(control.matches('input'))control.setAttribute('value',previous);else for(const option of control.options)option.toggleAttribute('selected',option.value===previous);}
  });
  on('click','[data-bevel-kanban-filter-clear]',(event,button)=>{
    if(kanbanDisabled(button))return;const root=button.closest('.bevel-kanban'),previous={from:root.dataset.bevelFilterDueFrom||'',to:root.dataset.bevelFilterDueTo||''};
    localOrRemote(root,'filter','due',previous,{from:'',to:''},()=>{delete root.dataset.bevelFilterDueFrom;delete root.dataset.bevelFilterDueTo;refreshKanban(root);},'filter:due');
  });
  on('keydown','.bevel-kanban',(event,root)=>{if(event.metaKey || event.ctrlKey){if(event.key.toLowerCase()==='k'){event.preventDefault();(root.querySelector('.bevel-kanban__search input')||root.querySelector('input.bevel-kanban__search'))?.focus();}else if(event.key==='Enter' && event.target.closest('.bevel-kanban__composer')){event.preventDefault();event.target.closest('.bevel-kanban__composer').click();}}});
  on('pointerdown','.bevel-kanban__card' ,(event,card)=>{
    if(event.button!==0||kanbanDisabled(card)||event.target.closest('button,a,input,select,textarea')||sessions.has(card))return;
    const root=card.closest('.bevel-kanban');if(kanbanFiltered(root)){root.dataset.bevelMoveMessage='Clear filters to drag tasks. Use Move while filters are active.';return;}
    const pointerId=event.pointerId,startX=event.clientX,startY=event.clientY,session={active:false,list:null,target:null,before:false,cancel:()=>stop(false)};
    const clear=()=>{session.target?.removeAttribute('data-bevel-drop-target');session.target=null;session.list=null;};
    const move=current=>{
      if(current.pointerId!==pointerId)return;if(!session.active&&Math.hypot(current.clientX-startX,current.clientY-startY)<5)return;
      session.active=true;card.dataset.bevelDragging='';clear();const hit=document.elementFromPoint(current.clientX,current.clientY),target=hit?.closest('.bevel-kanban__card'),list=hit?.closest('.bevel-kanban__list')||hit?.closest('.bevel-kanban__column')?.querySelector('.bevel-kanban__list');
      if(!list||list.closest('.bevel-kanban')!==root||target===card)return;session.list=list;
      if(target&&target!==card){session.target=target;const rect=target.getBoundingClientRect();session.before=current.clientY<rect.top+rect.height/2;target.dataset.bevelDropTarget=session.before?'before':'after';}
    };
    const stop=commit=>{
      if(!sessions.has(card))return;document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',up);document.removeEventListener('pointercancel',cancel);document.removeEventListener('lostpointercapture',cancel);document.removeEventListener('keydown',escape,true);document.removeEventListener('dragstart',native,true);sessions.delete(card);card.removeAttribute('data-bevel-dragging');
      const {list,target,before}=session;clear();if(!commit||!session.active||!list||!root.isConnected||!card.isConnected||target&&!target.isConnected)return;
      const siblings=[...list.children].filter(node=>node.matches('.bevel-kanban__card')&&node!==card),index=target?siblings.indexOf(target)+(before?0:1):siblings.length;
      kanbanMove(root,card,list,index);
    };
    const native=current=>current.preventDefault(),up=current=>{if(current.pointerId===pointerId)stop(true);},cancel=current=>{if(current.pointerId===pointerId)stop(false);},escape=current=>{if(current.key==='Escape'){current.preventDefault();stop(false);}};
    sessions.set(card,session);document.addEventListener('pointermove',move);document.addEventListener('pointerup',up);document.addEventListener('pointercancel',cancel);document.addEventListener('lostpointercapture',cancel);document.addEventListener('keydown',escape,true);document.addEventListener('dragstart',native,true);
  });

  const cancelGridEdit = (cell, focus = true) => { const session=sessions.get(cell); if(!session)return; session.editor.remove(); cell.removeAttribute("data-bevel-editing"); cell.removeAttribute("data-bevel-invalid"); sessions.delete(cell); const error=cell.querySelector(".bevel-grid__cell-error");if(error)error.hidden=true;if (focus && session.button?.isConnected) session.button.focus(); };
  const beginGridEdit = cell => { const grid=gridOf(cell); if(!grid||disabled(cell))return; const active=grid.querySelector('.bevel-grid__cell[data-bevel-editing]'); if(active&&active!==cell)cancelGridEdit(active); if(sessions.has(cell))return; const button=cell.querySelector('[data-bevel-cell-edit]'), value=cell.dataset.value ?? button?.querySelector('.bevel-grid__cell-value')?.textContent ?? cell.textContent.trim(), type=cell.dataset.bevelEdit;
    const editor=document.createElement("span"); editor.className="bevel-grid__cell-editor"; editor.dataset.bevelTransient="grid-editor"; let input;
    if(type==="enum"){ input=document.createElement("select"); input.className="bevel-select__field"; for(const option of JSON.parse(cell.dataset.bevelOptions||"[]")){ const node=document.createElement("option"); node.value=option.id; node.textContent=option.label; input.append(node); } }
    else { input=document.createElement("input"); input.className="bevel-grid__cell-input"; input.type="text"; if(type==="number") input.inputMode="decimal"; }
    input.value=value; input.setAttribute("aria-label",cell.dataset.bevelLabel||`Edit ${cell.dataset.bevelColumn||"cell"}`); editor.append(input);
    for (const [name, icon] of [["save", '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.71" stroke-linecap="square" stroke-linejoin="miter"><path d="m5 12 4 4L19 6"/></svg>'], ["cancel", '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 256 256" fill="currentColor"><path d="M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z"/></svg>']]) {
      const control=document.createElement("button");control.type="button";control.className="bevel-grid__cell-action";control.dataset.bevelCellAction=name;control.setAttribute("aria-label", name==="save"?"Save cell":"Cancel cell");control.innerHTML=icon;editor.append(control);
    } cell.append(editor); cell.dataset.bevelEditing=""; const canonical = [cell.dataset.value, cell.dataset.sort, button?.querySelector(".bevel-grid__cell-value")?.textContent]; const valid = () => cell.contains(editor) && cell.querySelector("[data-bevel-cell-edit]") === button && JSON.stringify([cell.dataset.value, cell.dataset.sort, button?.querySelector(".bevel-grid__cell-value")?.textContent]) === JSON.stringify(canonical); sessions.set(cell,{editor,input,button,value,valid,cancel:()=>cancelGridEdit(cell,false)}); input.focus(); input.select?.(); };
  const gridEditable = grid => [...grid.querySelectorAll('.bevel-grid__cell[data-bevel-edit]')].filter(cell=>!cell.hidden&&!cell.closest("tr")?.hidden&&!disabled(cell));
  const resortGrid = grid => { const th=grid.querySelector('thead th[aria-sort="ascending"],thead th[aria-sort="descending"]'); if(!th)return; const index=[...th.parentElement.children].indexOf(th),type=th.dataset.type||"text",sign=th.getAttribute("aria-sort")==="ascending"?1:-1,tbody=grid.querySelector("tbody"),units=[]; for(const row of [...tbody.children])if(row.classList.contains("bevel-grid__row")){const unit=[row],detail=detailOf(row);if(detail)unit.push(detail);units.push(unit);} units.sort((a,b)=>{const x=cellKey(a[0],index,type),y=cellKey(b[0],index,type);return x<y?-sign:x>y?sign:0;});tbody.append(...units.flat()); };
  const commitGridEdit = (cell,direction=0) => { const session=sessions.get(cell),grid=gridOf(cell); if(!session||!grid)return false; if(!session.valid()){cancelGridEdit(cell,false);return false;} const input=session.input,next=input.value,type=cell.dataset.bevelEdit,key=cell.closest("tr")?.dataset.bevelKey||"",column=cell.dataset.bevelColumn||""; if((type==="number"&&(next.trim()===""||!Number.isFinite(Number(next))))||!input.checkValidity()){ cell.dataset.bevelInvalid=""; input.setAttribute("aria-invalid","true"); const error=cell.querySelector('.bevel-grid__cell-error'); if(error){error.hidden=false;if(!error.id)error.id=`bevel-grid-error-${crypto.randomUUID()}`;input.setAttribute("aria-describedby",error.id);} input.focus(); return false; } const previous=cell.dataset.value??session.value, display=type==="number"&&cell.dataset.bevelFormat==="currency"?new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(Number(next)):type==="enum"?input.selectedOptions[0]?.textContent||next:next; const finish=()=>{ const value=cell.querySelector('.bevel-grid__cell-value'); if(value)value.textContent=display; cell.dataset.value=next; cell.dataset.sort=next; session.editor.remove(); cell.removeAttribute("data-bevel-editing"); cell.removeAttribute("data-bevel-invalid"); sessions.delete(cell); const error=cell.querySelector(".bevel-grid__cell-error");if(error)error.hidden=true;resortGrid(grid); layoutGrid(grid); const target=grid.querySelector(`tr[data-bevel-key="${CSS.escape(key)}"] [data-bevel-column="${CSS.escape(column)}"]`); if(target?.closest("tr")?.hidden){ (gridEditable(grid).find(candidate=>!candidate.closest("tr")?.hidden)?.querySelector("[data-bevel-cell-edit]")||grid.querySelector(".bevel-grid__status,[tabindex]")||grid)?.focus(); } else if(direction){ const cells=gridEditable(grid),index=cells.indexOf(target); (cells[index+direction]||target)?.querySelector("[data-bevel-cell-edit]")?.focus(); } else target?.querySelector("[data-bevel-cell-edit]")?.focus(); };
    return grid.dataset.bevelDataMode==="remote" ? (remoteRequest(grid,"edit",key,{column,value:previous},{column,value:next},`edit:${key}:${column}`),cancelGridEdit(cell),true) : transition(grid,"edit",key,{column,value:previous},{column,value:next},finish); };
  on("click", ".bevel-grid__cell [data-bevel-cell-action]", (event, button) => { const cell=button.closest(".bevel-grid__cell");button.dataset.bevelCellAction==="save"?commitGridEdit(cell):cancelGridEdit(cell); });
  on("click", ".bevel-grid__cell [data-bevel-cell-edit]",(e,button)=>beginGridEdit(button.closest(".bevel-grid__cell")));
  on("dblclick", ".bevel-grid__cell[data-bevel-edit]",(e,cell)=>beginGridEdit(cell));
  on("keydown", ".bevel-grid__cell[data-bevel-edit]",(e,cell)=>{ if(!cell.hasAttribute("data-bevel-editing")&&(e.key==="Enter"||e.key==="F2")){e.preventDefault();beginGridEdit(cell);} });
  on("keydown", ".bevel-grid__cell[data-bevel-edit] :is(input,select)",(e,input)=>{ if(e.isComposing)return; const cell=input.closest(".bevel-grid__cell"); if(e.key==="Escape"){e.preventDefault();cancelGridEdit(cell);} else if(e.key==="Enter"){e.preventDefault();commitGridEdit(cell);} else if(e.key==="Tab"){e.preventDefault();commitGridEdit(cell,e.shiftKey?-1:1);} });
  on("pointerdown","body",(e)=>{ for(const cell of document.querySelectorAll('.bevel-grid__cell[data-bevel-editing]')) if(!cell.contains(e.target))cancelGridEdit(cell); });
  const filterDraft = root => root.querySelector(".bevel-filter__draft");
  on("click",".bevel-filter [data-bevel-filter-edit]",(e,button)=>{ const root=button.closest(".bevel-filter"),draft=filterDraft(root),committed=root.querySelector(".bevel-filter__rules"); draft.replaceChildren(...[...committed.children].map(node=>node.cloneNode(true))); draft.querySelectorAll(".bevel-filter__rule").forEach(refreshFilterRule); draft.hidden=false; committed.hidden=true; root.dataset.bevelEditing=""; });
  on("change",".bevel-filter__draft [data-bevel-filter-field]",(e,select)=>{const row=select.closest(".bevel-filter__rule");row.dataset.bevelField=select.value;refreshFilterRule(row);});
  on("change",".bevel-filter__draft [data-bevel-filter-operator]",(e,select)=>{const row=select.closest(".bevel-filter__rule");row.dataset.bevelOperator=select.value;const input=row.querySelector("[data-bevel-filter-value]");if(input)input.disabled=select.value==="is-empty";});
  on("click",".bevel-filter [data-bevel-filter-add]",(e,button)=>{const root=button.closest(".bevel-filter"),template=root.querySelector("template[data-bevel-filter-rule]"),rule=template?.content.firstElementChild?.cloneNode(true);if(rule){rule.dataset.bevelKey=crypto.randomUUID?.()||String(Date.now());filterDraft(root).append(rule);refreshFilterRule(rule);rule.querySelector("select,input")?.focus();}});
  on("click",".bevel-filter [data-bevel-filter-remove]",(e,button)=>button.closest(".bevel-filter__rule")?.remove());
  on("click",".bevel-filter [data-bevel-filter-cancel]",(e,button)=>{ const root=button.closest(".bevel-filter"); filterDraft(root).replaceChildren(); filterDraft(root).hidden=true; root.querySelector(".bevel-filter__rules").hidden=false; root.removeAttribute("data-bevel-editing"); });
  on("click", ".bevel-filter [data-bevel-filter-apply]", (e, button) => { const root=button.closest(".bevel-filter"),draft=filterDraft(root),committed=root.querySelector(".bevel-filter__rules"),definitions=filterDefinitions(root),expression={match:root.dataset.bevelMatch==="any"?"any":"all",rules:[...draft.children].map(row=>({key:row.dataset.bevelKey,field:row.dataset.bevelField,operator:row.dataset.bevelOperator,value:row.querySelector('[data-bevel-filter-value]')?.value??""}))}; if(expression.rules.some(rule=>!filterRuleValid(rule,definitions.find(item=>item.id===rule.field)))){root.dataset.bevelInvalid="";return;} const grid=targetById(root.dataset.bevelGrid),previous=filterRead(root); const commit=()=>{committed.replaceChildren(...[...draft.children].map(node=>node.cloneNode(true))); draft.replaceChildren(); draft.hidden=true; committed.hidden=false; root.removeAttribute("data-bevel-editing"); root.removeAttribute("data-bevel-invalid"); if(grid){grid.dataset.page="1";layoutGrid(grid);} }; if(grid)localOrRemote(grid,"filter","",previous,expression,commit); else transition(root,"filter","",previous,expression,commit); });
  const columnHeaders = grid => [...grid.querySelectorAll("thead > tr:first-child > [data-bevel-column]")];
  const rememberGridFields = grid => {
    const cells = [...grid.querySelector("thead > tr")?.children || []];
    for (const node of grid.querySelectorAll("[data-grid-column]")) if (!node.dataset.bevelField) {
      const key = cells[Number(node.dataset.gridColumn)]?.dataset.bevelColumn;
      if (key) node.dataset.bevelField = key;
    }
  };
  const orderColumn = (manager, key, destination, before) => {
    const grid = targetById(manager.dataset.bevelGrid), headers = columnHeaders(grid);
    rememberGridFields(grid);
    const header = headers.find(node => node.dataset.bevelColumn === key), target = headers.find(node => node.dataset.bevelColumn === destination);
    if (header && target) before ? target.before(header) : target.after(header);
    refreshColumns(manager);
  };
  const refreshColumns = manager => {
    const grid = targetById(manager.dataset.bevelGrid), table = grid?.querySelector(".bevel-grid__table");
    if (!table) return;
    rememberGridFields(grid);
    const headers = columnHeaders(grid), order = headers.map(node => node.dataset.bevelColumn);
    const attr = (node, name, value) => { if (node.getAttribute(name) !== String(value)) node.setAttribute(name, String(value)); };
    const flag = (node, name, value) => { if (node.hasAttribute(name) !== Boolean(value)) node.toggleAttribute(name, Boolean(value)); };
    const style = (node, name, value) => { if (node.style[name] !== value) node.style[name] = value; };
    const managerItems = [...manager.querySelectorAll(":scope > .bevel-columns__item")];
    const arranged = order.map(key => managerItems.find(node => node.dataset.bevelColumn === key)).filter(Boolean);
    if (arranged.some((node, index) => node !== managerItems[index])) manager.append(...arranged);
    for (const row of table.querySelectorAll("tbody > tr,tfoot > tr")) {
      const cells = [...row.children].filter(node => node.dataset.bevelColumn), arrangedCells = order.map(key => cells.find(node => node.dataset.bevelColumn === key)).filter(Boolean);
      if (arrangedCells.some((node, index) => node !== cells[index])) row.append(...arrangedCells);
    }
    let colgroup = table.querySelector(":scope > colgroup");
    if (!colgroup) { colgroup = document.createElement("colgroup"); table.prepend(colgroup); }
    flag(colgroup, "data-bevel-columns", true);
    const allHeaders = [...table.querySelector("thead > tr").children];
    while (colgroup.children.length < allHeaders.length) colgroup.append(document.createElement("col"));
    for (const node of grid.querySelectorAll("[data-bevel-field][data-grid-column]")) {
      const index = allHeaders.findIndex(header => header.dataset.bevelColumn === node.dataset.bevelField);
      if (index >= 0) attr(node, "data-grid-column", index);
    }
    let left = 0, visibleCount = 0;
    for (const [index, header] of allHeaders.entries()) {
      const key = header.dataset.bevelColumn, col = colgroup.children[index];
      if (!key) continue;
      const item = arranged.find(node => node.dataset.bevelColumn === key), required = item?.hasAttribute("data-bevel-column-required");
      if (required) { flag(header, "hidden", false); flag(header, "data-bevel-pinned", true); }
      const visible = !header.hidden, pinned = header.hasAttribute("data-bevel-pinned"), width = header.dataset.bevelWidth;
      attr(col, "data-bevel-column", key); style(col, "width", visible ? width ? `${Number(width)}px` : "" : "0px");
      for (const cell of table.querySelectorAll(`[data-bevel-column="${CSS.escape(key)}"]`)) {
        if (cell.tagName === "COL") continue;
        flag(cell, "hidden", !visible); flag(cell, "data-bevel-pinned", pinned);
        style(cell, "width", width ? `${Number(width)}px` : "");
        style(cell, "left", pinned && visible ? `${left}px` : "");
      }
      if (visible) { visibleCount++; if (pinned) left += header.getBoundingClientRect().width; }
      const input = item?.querySelector("[data-bevel-column-visible]");
      if (input) { if (input.checked !== visible) input.checked = visible; flag(input, "checked", visible); if (required) input.disabled = true; }
      const number = item?.querySelector("[data-bevel-column-position]");
      if (number && number.textContent !== String(index + 1)) number.textContent = String(index + 1);
      const up = item?.querySelector('[data-bevel-column-move="up"]'), down = item?.querySelector('[data-bevel-column-move="down"]');
      if (up) up.disabled = Boolean(required || index === 0 || arranged[index - 1]?.hasAttribute("data-bevel-column-required"));
      if (down) down.disabled = Boolean(required || index === allHeaders.length - 1);
      const pin = item?.querySelector("[data-bevel-column-pin]"); if (pin) { attr(pin, "aria-pressed", pinned); pin.disabled = Boolean(required); }
      const handle = header.querySelector(".bevel-grid__resize");
      if (handle) { attr(handle, "aria-valuemin", Number(header.dataset.columnMin) || 80); attr(handle, "aria-valuemax", Number(header.dataset.columnMax) || 800); attr(handle, "aria-valuenow", Number(width) || Math.round(header.getBoundingClientRect().width)); }
    }
    left = 0;
    for (const header of headers) {
      const pinned = header.hasAttribute("data-bevel-pinned") && !header.hidden;
      for (const cell of table.querySelectorAll(`[data-bevel-column="${CSS.escape(header.dataset.bevelColumn)}"]`)) if (cell.tagName !== "COL") style(cell, "left", pinned ? `${left}px` : "");
      if (pinned) left += header.getBoundingClientRect().width;
    }
    const span = allHeaders.filter(header => !header.hidden).length;
    for (const cell of table.querySelectorAll(".bevel-grid__detail > td,.bevel-grid__group > td,.bevel-grid__empty > td")) if (cell.colSpan !== span) cell.colSpan = span;
    const summary = manager.closest(".bevel-columns-panel")?.querySelector("[data-bevel-column-summary]"), text = `${visibleCount} of ${headers.length} shown`;
    if (summary && summary.textContent !== text) summary.textContent = text;
    attr(grid, "data-bevel-column-order", order.join(" "));
    layoutGrid(grid);
  };
  on("click", ".bevel-columns [data-bevel-column-move]", (event, button) => {
    if (disabled(button)) return;
    const manager = button.closest(".bevel-columns"), item = button.closest(".bevel-columns__item"), up = button.dataset.bevelColumnMove === "up", sibling = up ? item.previousElementSibling : item.nextElementSibling;
    if (!sibling || item.hasAttribute("data-bevel-column-required") || sibling.hasAttribute("data-bevel-column-required")) return;
    transition(manager, "column-order", item.dataset.bevelColumn, [...manager.children].indexOf(item), [...manager.children].indexOf(sibling), () => orderColumn(manager, item.dataset.bevelColumn, sibling.dataset.bevelColumn, up));
  });
  on("change", ".bevel-columns [data-bevel-column-visible]", (event, input) => {
    const manager = input.closest(".bevel-columns"), item = input.closest(".bevel-columns__item"), grid = targetById(manager.dataset.bevelGrid), header = columnHeaders(grid).find(node => node.dataset.bevelColumn === item.dataset.bevelColumn), checked = input.checked, previous = !header.hidden;
    const remaining = columnHeaders(grid).filter(node => !node.hidden && node !== header && !manager.querySelector(`[data-bevel-column="${CSS.escape(node.dataset.bevelColumn)}"]`)?.hasAttribute("data-bevel-column-required"));
    if (item.hasAttribute("data-bevel-column-required") || (!checked && !remaining.length) || !transition(manager, "column-visibility", item.dataset.bevelColumn, previous, checked, () => { header.hidden = !checked; refreshColumns(manager); })) {
      input.checked = previous; input.toggleAttribute("checked", previous);
    }
  });
  on("click", ".bevel-columns [data-bevel-column-pin]", (event, button) => {
    if (disabled(button)) return;
    const manager = button.closest(".bevel-columns"), item = button.closest(".bevel-columns__item"), grid = targetById(manager.dataset.bevelGrid), header = columnHeaders(grid).find(node => node.dataset.bevelColumn === item.dataset.bevelColumn);
    if (item.hasAttribute("data-bevel-column-required")) return;
    const previous = header.hasAttribute("data-bevel-pinned");
    transition(manager, "column-pin", item.dataset.bevelColumn, previous, !previous, () => { header.toggleAttribute("data-bevel-pinned", !previous); refreshColumns(manager); });
  });
  const resizeColumn=(handle,width)=>{const header=handle.closest("th"),grid=gridOf(header),min=Number(header.dataset.columnMin)||80,max=Number(header.dataset.columnMax)||800,next=Math.min(max,Math.max(min,width)),previous=Number(header.dataset.bevelWidth)||Math.round(header.getBoundingClientRect().width); return transition(grid,"column-resize",header.dataset.bevelColumn,previous,next,()=>{header.dataset.bevelWidth=String(Math.round(next));handle.setAttribute("aria-valuenow",String(Math.round(next)));const manager=document.querySelector(`.bevel-columns[data-bevel-grid="${CSS.escape(grid.id)}"]`);if(manager)refreshColumns(manager);});};
  on("keydown", ".bevel-grid__resize",(e,handle)=>{if(!["ArrowLeft","ArrowRight","Home","End"].includes(e.key))return;e.preventDefault();const header=handle.closest("th"),min=Number(header.dataset.columnMin)||80,max=Number(header.dataset.columnMax)||800,current=Number(header.dataset.bevelWidth)||Math.round(header.getBoundingClientRect().width),step=e.shiftKey?32:8;resizeColumn(handle,e.key==="Home"?min:e.key==="End"?max:current+(e.key==="ArrowRight"?step:-step));});
  on("pointerdown", ".bevel-grid__resize",(e,handle)=>{if(e.button!==0||sessions.has(handle))return;const header=handle.closest("th"),start=e.clientX,pointerId=e.pointerId,previous=Number(header.dataset.bevelWidth)||Math.round(header.getBoundingClientRect().width);e.preventDefault();handle.setPointerCapture(pointerId);const session={current:previous,cancel:()=>stop(false)},move=current=>{if(current.pointerId===pointerId){session.current=Math.min(Number(header.dataset.columnMax)||800,Math.max(Number(header.dataset.columnMin)||80,previous+current.clientX-start));header.style.width=`${session.current}px`;handle.setAttribute("aria-valuenow",String(Math.round(session.current)));}},stop=commit=>{if(!sessions.has(handle))return;handle.removeEventListener("pointermove",move);handle.removeEventListener("pointerup",up);handle.removeEventListener("pointercancel",cancel);handle.removeEventListener("lostpointercapture",lost);document.removeEventListener("keydown",escape,true);header.style.width="";handle.setAttribute("aria-valuenow",String(previous));sessions.delete(handle);if(handle.hasPointerCapture(pointerId))handle.releasePointerCapture(pointerId);if(commit&&handle.isConnected)resizeColumn(handle,session.current);},up=current=>{if(current.pointerId===pointerId)stop(true);},cancel=current=>{if(current.pointerId===pointerId)stop(false);},lost=()=>stop(false),escape=current=>{if(current.key==="Escape"){current.preventDefault();stop(false);}};sessions.set(handle,session);handle.addEventListener("pointermove",move);handle.addEventListener("pointerup",up);handle.addEventListener("pointercancel",cancel);handle.addEventListener("lostpointercapture",lost);document.addEventListener("keydown",escape,true);});
  on("pointerdown", ".bevel-columns__grip",(e,grip)=>{if(e.button!==0||sessions.has(grip))return;const item=grip.closest(".bevel-columns__item"),manager=grip.closest(".bevel-columns");if(item.hasAttribute("data-bevel-column-required"))return;const pointerId=e.pointerId,previous=[...manager.children].indexOf(item),session={target:null,before:false,cancel:()=>stop(false)},clear=()=>{session.target?.removeAttribute("data-bevel-drop-target");session.target=null;},move=current=>{if(current.pointerId!==pointerId)return;const target=[...manager.querySelectorAll(":scope > .bevel-columns__item")].find(node=>{const rect=node.getBoundingClientRect();return current.clientY>=rect.top&&current.clientY<=rect.bottom;});clear();if(target&&target!==item&&!target.hasAttribute("data-bevel-column-required")){session.target=target;const rect=target.getBoundingClientRect();session.before=current.clientY<rect.top+rect.height/2;target.dataset.bevelDropTarget=session.before?"before":"after";}},stop=commit=>{if(!sessions.has(grip))return;document.removeEventListener("pointermove",move);document.removeEventListener("pointerup",up);document.removeEventListener("pointercancel",cancel);document.removeEventListener("keydown",escape,true);sessions.delete(grip);const target=session.target,before=session.before;clear();if(commit&&grip.isConnected&&target?.isConnected){const children=[...manager.children],targetIndex=children.indexOf(target)+(before?0:1),next=targetIndex>(children.indexOf(item))?targetIndex-1:targetIndex;if(next!==previous)transition(manager,"column-order",item.dataset.bevelColumn,previous,next,()=>orderColumn(manager,item.dataset.bevelColumn,target.dataset.bevelColumn,before));}},up=current=>{if(current.pointerId===pointerId)stop(true);},cancel=current=>{if(current.pointerId===pointerId)stop(false);},escape=current=>{if(current.key==="Escape"){current.preventDefault();stop(false);}};e.preventDefault();sessions.set(grip,session);document.addEventListener("pointermove",move);document.addEventListener("pointerup",up);document.addEventListener("pointercancel",cancel);document.addEventListener("keydown",escape,true);});
  on("keydown", ".bevel-split__divider", (event, divider) => {
    if (disabled(divider) || event.isComposing) return;
    const root = divider.closest(".bevel-split"), vertical = root.dataset.bevelOrientation === "vertical", forward = vertical ? "ArrowDown" : "ArrowRight", backward = vertical ? "ArrowUp" : "ArrowLeft";
    if (![forward, backward, "Home", "End"].includes(event.key)) return;
    event.preventDefault(); const [min, max] = splitBounds(root), step = event.shiftKey ? 10 : 2;
    const value = event.key === "Home" ? min : event.key === "End" ? max : splitClamped(root, splitValue(root) + (event.key === forward ? step : -step));
    commitSplit(root, Math.round(value * 100) / 100);
  });
  on("pointerdown", ".bevel-split__divider", (event, divider) => {
    if (event.button !== 0 || disabled(divider)) return;
    const root = divider.closest(".bevel-split"); refreshSplit(root);
    const session = splitSessions.get(root); if (session.drag || disabled(divider)) return;
    event.preventDefault(); divider.focus();
    const previous = splitValue(root), vertical = root.dataset.bevelOrientation === "vertical", extent = vertical ? root.clientHeight : root.clientWidth;
    const start = vertical ? event.clientY : event.clientX, pointerId = event.pointerId;
    const drag = { previous, orientation: root.dataset.bevelOrientation, current: splitClamped(root, previous), stop(commit) {
      if (session.drag !== drag) return;
      session.drag = null; root.removeAttribute("data-bevel-dragging");
      divider.removeEventListener("pointermove", move); divider.removeEventListener("pointerup", up); divider.removeEventListener("pointercancel", cancel); divider.removeEventListener("lostpointercapture", cancel); document.removeEventListener("keydown", escape, true);
      if (divider.hasPointerCapture(pointerId)) divider.releasePointerCapture(pointerId);
      if (commit && root.isConnected) commitSplit(root, Math.round(drag.current * 100) / 100);
      refreshSplit(root);
    } };
    const move = current => { if (current.pointerId !== pointerId) return; if (!root.isConnected || splitMedia.matches || disabled(divider)) return drag.stop(false); const offset = (vertical ? current.clientY : current.clientX) - start; drag.current = splitClamped(root, splitClamped(root, previous) + offset / extent * 100); root.style.setProperty("--bevel-split-size", `${drag.current}%`); divider.setAttribute("aria-valuenow", String(Math.round(drag.current * 100) / 100)); };
    const up = current => { if (current.pointerId === pointerId) drag.stop(true); };
    const cancel = current => { if (current.pointerId === pointerId) drag.stop(false); };
    const escape = current => { if (current.key === "Escape") { current.preventDefault(); current.stopPropagation(); drag.stop(false); } };
    session.drag = drag; root.dataset.bevelDragging = "";
    divider.addEventListener("pointermove", move); divider.addEventListener("pointerup", up); divider.addEventListener("pointercancel", cancel); divider.addEventListener("lostpointercapture", cancel); document.addEventListener("keydown", escape, true);
    divider.setPointerCapture(pointerId);
  });

  const toastTimers = new Map(), toastReturns = new WeakMap();
  const toastStack = () => { let stack = document.querySelector(".bevel-toasts"); if (!stack) { stack = document.createElement("div"); stack.className = "bevel-toasts"; stack.setAttribute("aria-live", "polite"); document.body.append(stack); } return stack; };
  const restoreToastFocus = ({ previous, fallback } = {}) => { for (const target of [previous, fallback]) { if (!target?.isConnected || typeof target.focus !== "function") continue; target.focus(); if (document.activeElement === target) return; } };
  const dismissToast = toast => {
    const timer = toastTimers.get(toast); if (timer?.id) clearTimeout(timer.id); toastTimers.delete(toast);
    const focused = toast.contains(document.activeElement), next = toast.nextElementSibling || toast.previousElementSibling, entry = toastReturns.get(toast);
    toast.remove(); if (!focused) return; const target = next ? focusable(next) : null; target ? target.focus() : restoreToastFocus(entry);
  };
  const scheduleToast = (toast, delay) => {
    const timer = toastTimers.get(toast); if (!timer || delay <= 0) return;
    timer.remaining = delay; timer.started = performance.now(); timer.id = setTimeout(() => dismissToast(toast), delay);
  };
  const pauseToast = toast => { const timer = toastTimers.get(toast); if (!timer?.id) return; clearTimeout(timer.id); timer.id = null; timer.remaining = Math.max(0, timer.remaining - (performance.now() - timer.started)); };
  const resumeToast = toast => { const timer = toastTimers.get(toast); if (timer && !timer.id && !toast.matches(":hover") && !toast.contains(document.activeElement) && !document.hidden) scheduleToast(toast, timer.remaining); };
  const toastIcon = tone => tone === "success" ? '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square" stroke-linejoin="miter"><path d="m5 12 4 4L19 6"/></svg>' : tone === "error" ? '<svg aria-hidden="true" viewBox="0 0 256 256" fill="currentColor"><path d="M236.8,188.09,149.35,36.22h0a24.76,24.76,0,0,0-42.7,0L19.2,188.09a23.51,23.51,0,0,0,0,23.72A24.35,24.35,0,0,0,40.55,224h174.9a24.35,24.35,0,0,0,21.33-12.19A23.51,23.51,0,0,0,236.8,188.09ZM222.93,203.8a8.5,8.5,0,0,1-7.48,4.2H40.55a8.5,8.5,0,0,1-7.48-4.2,7.59,7.59,0,0,1,0-7.72L120.52,44.21a8.75,8.75,0,0,1,15,0l87.45,151.87A7.59,7.59,0,0,1,222.93,203.8ZM120,144V104a8,8,0,0,1,16,0v40a8,8,0,0,1-16,0Zm20,36a12,12,0,1,1-12-12A12,12,0,0,1,140,180Z"/></svg>' : '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square" stroke-linejoin="miter"><path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M12 7.75v.85M10.3 11.15H12v5.1M10.3 16.25h3.4"/></svg>';
  const notify = ({ title = "Notice", message, tone = "info", key = crypto.randomUUID?.() || String(Date.now()), action: item, duration, focus = false, returnFocus } = {}) => {
    const stack = toastStack(), template = stack.querySelector("template[data-bevel-toast-template]"), toast = template?.content.firstElementChild?.cloneNode(true) || document.createElement("article"); if (!toast.classList.contains("bevel-toast")) toast.className = "bevel-toast"; toast.dataset.bevelTone = tone; toast.dataset.bevelKey = String(key); toast.dataset.bevelTransient = "toast";
    const holder = [...stack.children].find(node => toastReturns.has(node) && node.contains(document.activeElement)), inherited = holder && toastReturns.get(holder); toastReturns.set(toast, { previous: inherited ? inherited.previous : document.activeElement, fallback: returnFocus ?? inherited?.fallback });
    if (tone === "error") toast.setAttribute("role", "alert");
    if (focus) toast.setAttribute("aria-live", "off");
    if (!template) toast.innerHTML = '<span class="bevel-toast__icon"></span><div class="bevel-toast__body"><h2 class="bevel-toast__title"></h2><p class="bevel-toast__message"></p></div><button type="button" class="bevel-toast__close"></button>';
    toast.querySelector(".bevel-toast__icon").innerHTML = toastIcon(tone); const close = toast.querySelector(".bevel-toast__close"); close.innerHTML = '<svg aria-hidden="true" viewBox="0 0 256 256" fill="currentColor"><path d="M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z"/></svg>'; close.setAttribute("aria-label", `Dismiss ${title}`);
    toast.querySelector(".bevel-toast__title").textContent = title; toast.querySelector(".bevel-toast__message").textContent = message || "";
    let button = toast.querySelector(".bevel-toast__action"); if (item) { if (!button) { button = document.createElement("button"); button.type = "button"; button.className = "bevel-button bevel-button--small bevel-toast__action"; toast.querySelector(".bevel-toast__body").append(button); } button.replaceChildren(); const actionIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg"); actionIcon.setAttribute("aria-hidden", "true"); actionIcon.setAttribute("viewBox", "0 0 256 256"); actionIcon.setAttribute("fill", "currentColor"); actionIcon.innerHTML = '<path d="M224,128a96,96,0,0,1-94.71,96H128A95.38,95.38,0,0,1,62.1,197.8a8,8,0,0,1,11-11.63A80,80,0,1,0,71.43,71.39a3.07,3.07,0,0,1-.26.25L44.59,96H72a8,8,0,0,1,0,16H24a8,8,0,0,1-8-8V56a8,8,0,0,1,16,0V85.8L60.25,60A96,96,0,0,1,224,128Z"/>'; if ((item.icon || item.id) === "retry") actionIcon.style.transform = "scaleX(-1)"; const label = document.createElement("span"); label.className = "bevel-button__label"; label.textContent = item.label; button.append(actionIcon, label); button.addEventListener("click", () => { action(stack, item.id, key); dismissToast(toast); }, { once: true }); } else button?.remove();
    toast.querySelector(".bevel-toast__close").addEventListener("click", () => dismissToast(toast), { once: true });
    toast.addEventListener("mouseenter", () => pauseToast(toast)); toast.addEventListener("mouseleave", () => resumeToast(toast)); toast.addEventListener("focusin", () => pauseToast(toast)); toast.addEventListener("focusout", () => queueMicrotask(() => resumeToast(toast)));
    stack.append(toast); const timeout = duration ?? (tone === "error" || item || focus ? 0 : 4000); if (timeout > 0) { toastTimers.set(toast, { remaining: timeout, id: null, started: 0 }); scheduleToast(toast, timeout); } if (focus) { toast.tabIndex = -1; toast.focus({ preventScroll: true }); } return toast;
  };
  document.addEventListener("visibilitychange", () => { for (const toast of toastTimers.keys()) document.hidden ? pauseToast(toast) : resumeToast(toast); });
  let savedTimer = null;
  const saved = ({ duration = 2000 } = {}) => { let chip = document.querySelector(".bevel-saved"); if (!chip) { chip = document.createElement("div"); chip.className = "bevel-saved"; chip.dataset.bevelTransient = "saved"; chip.setAttribute("role", "status"); chip.setAttribute("aria-live", "polite"); chip.textContent = "Saved"; document.body.append(chip); } if (savedTimer) clearTimeout(savedTimer); chip.hidden = false; savedTimer = duration > 0 ? setTimeout(() => { chip.hidden = true; savedTimer = null; }, duration) : null; return chip; };
  const upload = {
    update(root, key, state) {
      const row = root?.querySelector(`[data-bevel-file-key="${CSS.escape(String(key))}"]`);
      if (!row) return false;
      const next = { ...state }, allowed = new Set(["selected", "uploading", "uploaded", "error"]);
      if (next.status && !allowed.has(next.status)) return false;
      if ("progress" in next) next.progress = Math.min(100, Math.max(0, Number(next.progress) || 0));
      const candidateStatus = next.status || row.dataset.bevelStatus;
      const candidateUrl = "url" in next ? next.url : row.dataset.bevelUrl;
      const candidateError = "error" in next ? next.error : row.dataset.bevelError;
      if (candidateStatus === "uploaded") {
        let protocol; try { protocol = new URL(candidateUrl, document.baseURI).protocol; } catch { return false; }
        if (!candidateUrl || !["http:", "https:", "data:"].includes(protocol)) return false;
      }
      for (const name of ["status", "progress", "url", "name", "error"]) if (name in next) { const value = next[name]; if (value == null || value === "") row.removeAttribute(`data-bevel-${name}`); else row.setAttribute(`data-bevel-${name}`, String(value)); }
      const progress = row.querySelector("progress");
      if (progress && "progress" in next) progress.value = next.progress;
      const stateMark = row.querySelector(".bevel-upload__state");
      if (stateMark) stateMark.textContent = candidateStatus === "uploading" ? `${"progress" in next ? next.progress : row.dataset.bevelProgress || 0}%` : candidateStatus === "uploaded" ? "✓" : candidateStatus === "error" ? "Failed" : "";
      const status = row.querySelector(".bevel-upload__status");
      if (status && ("status" in next || "error" in next)) status.textContent = candidateError || (candidateStatus === "uploaded" ? "Uploaded" : candidateStatus[0].toUpperCase() + candidateStatus.slice(1));
      const name = row.querySelector(".bevel-upload__name");
      if (name && next.name) name.textContent = next.name;
      const retry = row.querySelector("[data-bevel-upload-retry]");
      if (retry) retry.hidden = candidateStatus !== "error" || !uploadFiles.get(root)?.has(String(key));
      let link = row.querySelector(".bevel-upload__link");
      if (candidateStatus === "uploaded" && ("status" in next || "url" in next)) {
        if (!link) { link = document.createElement("a"); link.className = "bevel-upload__link"; link.textContent = "Open file"; row.querySelector(".bevel-upload__actions")?.prepend(link); }
        link.href = candidateUrl; link.rel = "noopener noreferrer"; if (root.hasAttribute("data-bevel-download")) link.download = next.name || row.dataset.bevelName || "";
        const entry = uploadFiles.get(root)?.get(String(key)); if (entry?.preview) URL.revokeObjectURL(entry.preview); uploadFiles.get(root)?.delete(String(key));
        const preview = row.querySelector(".bevel-upload__preview img"); if (preview?.src.startsWith("blob:")) { preview.removeAttribute("src"); preview.hidden = true; }
      }
      return true;
    },
    remove(root, key) {
      const id = String(key), row = root?.querySelector(`[data-bevel-file-key="${CSS.escape(id)}"]`);
      if (!row) return false;
      const files = uploadFiles.get(root), entry = files?.get(id);
      if (entry?.preview) URL.revokeObjectURL(entry.preview);
      files?.delete(id); row.remove(); action(root, "remove", id); return true;
    }
  };
  const edit = {
    start: startEdit,
    commit(root) { return endEdit(root, true); },
    cancel(root) { return endEdit(root, false); }
  };
  const remote = { resolve(root, requestId, { status, message = "" }) { if (!root?.isConnected || !["accepted", "rejected"].includes(status)) return false; const scopes = requestScopes.get(root); if (!scopes || ![...scopes.values()].includes(requestId)) return false; for (const [scope, id] of scopes) if (id === requestId) scopes.delete(scope); if (!scopes.size) root.removeAttribute("data-bevel-pending"); root.dataset.bevelResolution = status; if (message) root.dataset.bevelMessage = message; return true; } };
  window.Bevel = { open: openOverlay, close: closeOverlay, refresh, destroy, prepareForSave, notify, saved, upload, edit, filter:{ read:filterRead, matches:filterMatches }, remote, _transition: transition, _request: remoteRequest };

  /* ---------- first paint: fill any slider whose markup forgot --bevel-value ---------- */
  const boot = () => {
    document.querySelectorAll("[data-bevel-transient]").forEach((el) => el.remove());
    clearGridDrafts(document);
    clearKanbanDrafts(document);
    clearPickerDrafts(document);
    clearInlineDrafts(document);
    for (const grid of document.querySelectorAll(".bevel-grid")) if (grid.dataset.bevelDataMode !== "remote") layoutGrid(grid);
    for (const input of document.querySelectorAll(".bevel-slider__input")) {
      const wrap = input.closest(".bevel-slider");
      if (wrap && !wrap.style.getPropertyValue("--bevel-value")) syncSlider(input);
    }
    for (const name of document.querySelectorAll(".bevel-file__name[data-filled][data-empty]")) {
      const wrap = name.closest(".bevel-file");
      const input = wrap?.querySelector(".bevel-file__input");
      if (input && !input.files.length) clearFile(wrap, name);
    }
    refresh(document, { source: "boot" });
    expirePendingUploads(document);
    window.addEventListener("beforeunload", () => { for (const root of document.querySelectorAll(".bevel-dropzone")) for (const entry of uploadFiles.get(root)?.values() || []) if (entry.preview) URL.revokeObjectURL(entry.preview); }, { once: true });
  };
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", boot) : boot();
})();
