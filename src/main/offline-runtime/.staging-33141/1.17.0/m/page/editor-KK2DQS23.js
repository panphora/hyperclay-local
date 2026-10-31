import{a as ce,c as L}from"../c-WA6RDZNG.js";import"../c-IW6GGOU2.js";import"../c-HAWFNBYG.js";import{b as he}from"../c-EM7IERTR.js";import{M as Pe,N as Be,f as te,i as ge,j as le,k as de,l as se,n as ue,q as be,s as fe,x as ve}from"../c-3V5KJJST.js";import"../c-65EFVNBB.js";import"../c-LQ6AB2YP.js";import{n as oe}from"../c-346OFPAZ.js";import"../c-IREQTHWM.js";import{a as pe,b as ne,d as ie}from"../c-C4YWU4FM.js";import"../c-2NOMUB3B.js";import"../c-IEQJXUDS.js";import{A as ze,B as Ee,H as Ae,b as ee,c as ae,d as re,f as R,k as ke,o as xe,w as we,z as ye}from"../c-L5J2C7PN.js";import{G,J as Y,N as J,P as Q,S as Z,a as W,b as u,d as k,e as C,f as D,g as w,h as q,i as U,m as b,w as X}from"../c-5KSH2IHI.js";import{a as V,c as Ce,d as F}from"../c-CLMQ3KLL.js";import{a as me}from"../c-BYTKL6UX.js";import"../c-544IO2YI.js";import"../c-57XDY6HC.js";import{b as j}from"../c-GY422N3Q.js";import"../c-7SWMYKAI.js";import"../c-UGHH4MB3.js";import"../c-ZWIOJGMT.js";import"../c-IJUK2GPW.js";import"../c-VG5XIN4T.js";import"../c-2YYDMLNZ.js";import"../c-HA6INT6J.js";import"../c-DCFSEJZG.js";import"../c-WRBKEJD4.js";import"../c-VHNSBD2M.js";var{Decoration:Se,DecorationSet:$e}=k,He="Type / for blocks",Ne="Untitled";function _e(e){let a=!1,r=null;return e.forEach((o,t)=>{a||o.type!==b.nodes.heading||o.attrs.level!==1||(o.attrs.parent??null)!==null||(a=!0,o.content.size||(r=Se.node(t,t+o.nodeSize,{class:"page-title-placeholder","data-placeholder":Ne})))}),r}function De(e=He){return new u.Plugin({props:{decorations(a){let r=[],o=_e(a.doc);o&&r.push(o);let{selection:t}=a;if(t.empty){let n=t.$from;if(n.depth===1){let i=n.parent;if(i.type===b.nodes.paragraph&&!i.content.size){let l=n.before(1);r.push(Se.node(l,l+i.nodeSize,{class:"page-placeholder","data-placeholder":e}))}}}return r.length?$e.create(a.doc,r):null}}})}var Me=new u.Plugin({props:{handleKeyDown(e,a){if(!(a.metaKey||a.ctrlKey)||!a.shiftKey||a.altKey)return!1;let r=a.key.toLowerCase()==="o"?"owner":a.key.toLowerCase()==="d"?"date":null;if(!r)return!1;for(let o of pe.get(e)??[])if(o.focusControl?.(e,r))return!0;return!1}}});var Fe="page-editor-style",We=[1,2,3,4,5,6,7,8],qe=`
  --page-bg: #F7F6F2; --page-ink: #23221F; --page-ink-soft: #6B6862; --page-ink-faint: #9B968C;
  --page-rule: rgba(35, 34, 31, 0.10); --page-accent: #2F5E9E; --page-link: #164583; --page-selection: rgba(88, 120, 170, 0.20);
  --page-check-border: rgba(35, 34, 31, 0.35); --page-check-fill: #23221F; --page-check-ink: #F7F6F2;
  --page-callout-bg: rgba(35, 34, 31, 0.04); --page-code-bg: rgba(35, 34, 31, 0.05);
  --page-color-gray: #5B5953; --page-color-brown: #8A5A1E; --page-color-orange: #B4531A; --page-color-yellow: #7A6210; --page-color-green: #3E6A28;
  --page-color-blue: #1F5A8A; --page-color-purple: #5E4596; --page-color-pink: #A23E6E; --page-color-red: #9E3B2F;
  --page-mark-bg-gray: rgba(35, 34, 31, 0.12); --page-mark-bg-brown: rgba(138, 90, 30, 0.20); --page-mark-bg-orange: rgba(180, 83, 26, 0.20);
  --page-mark-bg-yellow: rgba(122, 98, 16, 0.22); --page-mark-bg-green: rgba(62, 106, 40, 0.20); --page-mark-bg-blue: rgba(31, 90, 138, 0.18);
  --page-mark-bg-purple: rgba(94, 69, 150, 0.18); --page-mark-bg-pink: rgba(162, 62, 110, 0.18); --page-mark-bg-red: rgba(158, 59, 47, 0.18);
  --page-code-token-keyword: #8A3B6E; --page-code-token-constant: #1F5A8A; --page-code-token-string: #3E6A28; --page-code-token-string-expression: #3E6A28; --page-code-token-comment: #8B877E; --page-code-token-function: #5E4596; --page-code-token-parameter: #8A5A1E; --page-code-token-punctuation: var(--page-ink-soft); --page-code-token-link: var(--page-link);
  --page-chrome-ink-rest: rgba(35, 34, 31, 0.20); --page-chrome-ink-moved: rgba(35, 34, 31, 0.34);
  --page-chrome-bg-rest: rgba(35, 34, 31, 0.02); --page-chrome-bg-moved: rgba(35, 34, 31, 0.04);
  --page-chrome-line-rest: rgba(35, 34, 31, 0.06); --page-chrome-line-moved: rgba(35, 34, 31, 0.11);
  --page-pop-bg: #FBFAF7; --page-pop-ink: #23221F; --page-pop-muted: #6B6862; --page-pop-line: rgba(35, 34, 31, 0.10);
  --page-pop-shadow: 0 1px 2px rgba(35, 34, 31, 0.05), 0 8px 24px rgba(35, 34, 31, 0.08); --page-pop-hover: rgba(35, 34, 31, 0.06);
  --page-scrim: rgba(35, 34, 31, 0.12);
  --page-danger: #9E3B2F; --page-block-selected: rgba(88, 120, 170, 0.12);`,Te=`
  --page-bg: #1A1A18; --page-ink: #E7E4DC; --page-ink-soft: #A3A098; --page-ink-faint: #75726B;
  --page-rule: rgba(231, 228, 220, 0.10); --page-accent: #8DB0E6; --page-link: #8DB0E6; --page-selection: rgba(120, 155, 210, 0.28);
  --page-check-border: rgba(231, 228, 220, 0.35); --page-check-fill: #E7E4DC; --page-check-ink: #1A1A18;
  --page-callout-bg: rgba(231, 228, 220, 0.05); --page-code-bg: rgba(231, 228, 220, 0.06);
  --page-color-gray: #A3A098; --page-color-brown: #E0B47A; --page-color-orange: #E8A177; --page-color-yellow: #DEC97A; --page-color-green: #A9C98B;
  --page-color-blue: #8DB0E6; --page-color-purple: #BBA6E6; --page-color-pink: #E3A3C4; --page-color-red: #E08A7A;
  --page-mark-bg-gray: rgba(231, 228, 220, 0.14); --page-mark-bg-brown: rgba(224, 180, 122, 0.22); --page-mark-bg-orange: rgba(232, 161, 119, 0.22);
  --page-mark-bg-yellow: rgba(222, 201, 122, 0.24); --page-mark-bg-green: rgba(169, 201, 139, 0.22); --page-mark-bg-blue: rgba(141, 176, 230, 0.22);
  --page-mark-bg-purple: rgba(187, 166, 230, 0.22); --page-mark-bg-pink: rgba(227, 163, 196, 0.22); --page-mark-bg-red: rgba(224, 138, 122, 0.22);
  --page-code-token-keyword: #D9A0C8; --page-code-token-constant: #8DB0E6; --page-code-token-string: #A9C98B; --page-code-token-string-expression: #A9C98B; --page-code-token-comment: #75726B; --page-code-token-function: #BBA6E6; --page-code-token-parameter: #E0B47A; --page-code-token-punctuation: var(--page-ink-soft); --page-code-token-link: var(--page-link);
  --page-chrome-ink-rest: rgba(231, 228, 220, 0.18); --page-chrome-ink-moved: rgba(231, 228, 220, 0.30);
  --page-chrome-bg-rest: rgba(231, 228, 220, 0.02); --page-chrome-bg-moved: rgba(231, 228, 220, 0.04);
  --page-chrome-line-rest: rgba(231, 228, 220, 0.06); --page-chrome-line-moved: rgba(231, 228, 220, 0.11);
  --page-pop-bg: #222220; --page-pop-ink: #E7E4DC; --page-pop-muted: #A3A098; --page-pop-line: rgba(231, 228, 220, 0.10);
  --page-pop-shadow: 0 1px 2px rgba(10, 10, 9, 0.3), 0 10px 28px rgba(10, 10, 9, 0.35); --page-pop-hover: rgba(231, 228, 220, 0.07);
  --page-scrim: rgba(10, 10, 9, 0.35);
  --page-danger: #E08A7A; --page-block-selected: rgba(120, 155, 210, 0.18);
  --chart-1: #8DB0E6; --chart-2: #D9A0C8; --chart-3: #A9C98B; --chart-4: #BBA6E6; --chart-5: #E0B47A; --chart-6: #A3A098;`,Ue=`
@layer page {
:where(article[data-page], .page-shell) {${qe}
  --chart-1: #2F5E9E; --chart-2: #164583; --chart-3: #5B5953; --chart-4: #8A3B6E; --chart-5: #3E6A28; --chart-6: #8A5A1E;
  --page-ink-strong: var(--page-ink); --page-caret: var(--page-accent);
  --page-font: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; --page-font-display: var(--page-font); --page-font-heading: var(--page-font);
  --page-font-mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  --page-font-size: 17px; --page-line-height: 1.65; --page-measure: 680px; --page-pad-top: 72px;
  --page-h1-size: 34px; --page-h1-weight: 600; --page-h1-tracking: -0.01em; --page-h1-line: 1.2;
  --page-h2-size: 21px; --page-h2-weight: 600; --page-h3-size: 17px; --page-h3-weight: 600;
  --page-block-gap: 0.35em; --page-indent: 1.6em;
  --page-marker: var(--page-ink-soft); --page-bullet-size: 0.36em; --page-check-size: 16px; --page-check-radius: 4px; --page-done-ink: var(--page-ink-faint);
  --page-toggle-ink: var(--page-ink-soft); --page-callout-line: transparent; --page-code-ink: var(--page-ink);
  --page-chrome-shadow-rest: none; --page-chrome-shadow-moved: none; --page-chrome-radius: 7px; --page-plus-size: 24px; --page-fade: 240ms;
  --page-pop-radius: 10px; --page-bar-bg: var(--page-pop-bg); --page-bar-ink: var(--page-pop-ink);
}
@media (prefers-color-scheme: dark) { :where(:root:not([data-theme="light"]) :is(article[data-page], .page-shell)) {${Te} } }
:where(:root[data-theme="dark"] :is(article[data-page], .page-shell)) {${Te} }

.page-shell { position: relative; background: var(--page-bg); color: var(--page-ink); font-family: var(--page-font); font-size: var(--page-font-size); line-height: var(--page-line-height); padding: 0 16px; }
.page-editor { max-width: var(--page-measure); margin: 0 auto; padding: var(--page-pad-top) 0 30vh; outline: none; white-space: pre-wrap; overflow-wrap: break-word; caret-color: var(--page-caret); }
:where(article[data-page], .page-editor) ::selection { background: var(--page-selection); }
:where(article[data-page], .page-editor) > * { margin: var(--page-block-gap) 0; margin-inline-start: calc(var(--page-depth, 0) * var(--page-indent)); }
:where(article[data-page], .page-editor) > h1 { font-family: var(--page-font-display); font-size: var(--page-h1-size); font-weight: var(--page-h1-weight); letter-spacing: var(--page-h1-tracking); line-height: var(--page-h1-line); color: var(--page-ink-strong); margin-block: 0 0.6em; }
:where(article[data-page], .page-editor) > h2 { font-family: var(--page-font-heading); font-size: var(--page-h2-size); font-weight: var(--page-h2-weight); color: var(--page-ink-strong); line-height: 1.35; margin-block-start: 1.4em; }
:where(article[data-page], .page-editor) > h3 { font-family: var(--page-font-heading); font-size: var(--page-h3-size); font-weight: var(--page-h3-weight); color: var(--page-ink-strong); margin-block-start: 1.2em; }
:where(article[data-page], .page-editor) a { color: var(--page-link, var(--page-accent)); }
:where(article[data-page], .page-editor) code { font-family: var(--page-font-mono); font-size: 0.88em; background: var(--page-code-bg); color: var(--page-code-ink); border-radius: 4px; padding: 0.1em 0.3em; }
:where(article[data-page], .page-editor) pre { font-family: var(--page-font-mono); font-size: 0.88em; background: var(--page-code-bg); color: var(--page-code-ink); border-radius: 8px; padding: 12px 14px; }
:where(article[data-page], .page-editor) pre code { background: none; padding: 0; font-size: inherit; }
:where(article[data-page], .page-editor) pre { position: relative; padding-top: 32px; white-space: pre-wrap; overflow-wrap: anywhere; }
:where(article[data-page], .page-editor) pre[data-lang] { white-space: pre; overflow-wrap: normal; }
:where(article[data-page], .page-editor) pre[data-lang] > code { display: block; overflow-x: auto; }
.page-code-lang { position: absolute; top: 5px; inset-inline-end: 6px; max-width: 120px; height: 24px; padding: 0 4px; border: 0; border-radius: 5px; background: none; color: var(--page-ink-faint); font: 12px/1 var(--page-font); opacity: 0; cursor: pointer; transition: opacity var(--page-fade); }
.page-editor pre:hover .page-code-lang, .page-editor pre:focus-within .page-code-lang, .page-code-lang:focus-visible, .page-editor pre[data-lang] .page-code-lang { opacity: 1; }
.page-code-lang:hover, .page-code-lang:focus-visible { background: var(--page-pop-hover); color: var(--page-ink-soft); }
:where(article[data-page], .page-editor) .page-callout { background: var(--page-callout-bg); border: 1px solid var(--page-callout-line); border-radius: 8px; padding: 10px 14px; }
/* The four floor-1 formats. A quote is set apart by its own inset and ink, with
   no left-border accent; the palette's keys are fixed tokens, in both themes. */
:where(article[data-page], .page-editor) blockquote { padding-inline-start: var(--page-indent); color: var(--page-ink-soft); }
:where(article[data-page], .page-editor) hr { border: 0; border-top: 1px solid var(--page-rule); margin-block: 1.2em; }
:where(article[data-page], .page-editor) .page-hidden { display: none; }
:where(article[data-page], .page-editor) .page-li { position: relative; --li-indent: 0; padding-inline-start: calc((var(--li-indent) + 1) * var(--page-indent)); }
${We.map(e=>`:where(article[data-page], .page-editor) .page-li[data-indent="${e}"] { --li-indent: ${e}; }`).join(`
`)}
:where(article[data-page], .page-editor) .page-li::before { position: absolute; inset-inline-start: calc(var(--li-indent) * var(--page-indent)); width: var(--page-indent); text-align: center; color: var(--page-marker); content: "\\2022"; }
:where(article[data-page], .page-editor) .page-li[data-kind="bullet"]::before { content: ""; box-sizing: border-box; width: var(--page-bullet-size); height: var(--page-bullet-size); top: calc((1em * var(--page-line-height) - var(--page-bullet-size)) / 2); inset-inline-start: calc(var(--li-indent) * var(--page-indent) + (var(--page-indent) - var(--page-bullet-size)) / 2); border-radius: 50%; background: currentColor; }
:where(article[data-page], .page-editor) .page-li[data-kind="ordered"]::before { content: attr(data-marker); font-variant-numeric: tabular-nums; }
:where(article[data-page], .page-editor) .page-li[data-kind="check"]::before { content: ""; box-sizing: border-box; width: var(--page-check-size); height: var(--page-check-size); top: calc((1em * var(--page-line-height) - var(--page-check-size)) / 2); inset-inline-start: calc(var(--li-indent) * var(--page-indent) + (var(--page-indent) - var(--page-check-size)) / 2); border: 1px solid var(--page-check-border); border-radius: var(--page-check-radius); cursor: pointer; }
:where(article[data-page], .page-editor) .page-li[data-kind="check"][data-checked="true"]::before { background: var(--page-check-fill); border-color: var(--page-check-fill); }
:where(article[data-page], .page-editor) .page-li[data-kind="check"][data-checked="true"]::after { content: ""; position: absolute; width: var(--page-check-size); height: var(--page-check-size); top: calc((1em * var(--page-line-height) - var(--page-check-size)) / 2); inset-inline-start: calc(var(--li-indent) * var(--page-indent) + (var(--page-indent) - var(--page-check-size)) / 2); background: var(--page-check-ink); -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M3.8 8.4l2.9 2.9 5.5-6.4' fill='none' stroke='%23000' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center / 72% no-repeat; mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M3.8 8.4l2.9 2.9 5.5-6.4' fill='none' stroke='%23000' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center / 72% no-repeat; pointer-events: none; }
:where(article[data-page], .page-editor) .page-li[data-kind="check"][data-checked="true"] { color: var(--page-done-ink); text-decoration: line-through; }
:where(article[data-page], .page-editor) .page-toggle { position: relative; padding-inline-start: var(--page-indent); }
.page-editor .page-toggle-button { position: absolute; inset-inline-start: 0; top: 0; width: var(--page-indent); height: calc(1em * var(--page-line-height)); display: grid; place-items: center; border: 0; padding: 0; background: none; color: var(--page-toggle-ink); font: inherit; line-height: 1; cursor: pointer; transition: transform var(--page-fade); }
.page-editor .page-toggle-button::before { content: "\\25B8"; font-size: 1.4em; }
.page-editor .page-toggle[aria-expanded="true"] > .page-toggle-button { transform: rotate(90deg); }

.page-dock, .page-plus { color: var(--page-chrome-ink-rest); background: var(--page-chrome-bg-rest); border: 1px solid var(--page-chrome-line-rest); box-shadow: var(--page-chrome-shadow-rest); border-radius: var(--page-chrome-radius); transition: color var(--page-fade), background-color var(--page-fade), border-color var(--page-fade), box-shadow var(--page-fade); }
.page-shell.is-moved .page-dock, .page-shell.is-moved .page-plus { color: var(--page-chrome-ink-moved); background: var(--page-chrome-bg-moved); border-color: var(--page-chrome-line-moved); box-shadow: var(--page-chrome-shadow-moved); }
.page-dock { position: sticky; top: 12px; z-index: 3; display: flex; align-items: center; gap: 2px; width: max-content; margin: 12px auto 0; padding: 3px; }
/* One formatting bar at a time: the selection bar covers what the fixed bar offers. Hidden, not removed, so the page does not shift under the selection. */
.page-shell:has(.page-bubble:not([hidden])) .page-dock { visibility: hidden; }
.page-dock, .page-shell.is-moved .page-dock { background: var(--page-pop-bg); }
.page-dock + .page-editor { padding-top: max(16px, calc(var(--page-pad-top) - 48px)); }
.page-tool { display: inline-flex; align-items: center; justify-content: center; min-width: 28px; height: 28px; padding: 0 6px; border: 0; border-radius: 5px; background: none; color: inherit; font: 500 13px/1 var(--page-font); cursor: pointer; }
.page-tool:hover, .page-tool[aria-pressed="true"] { background: var(--page-pop-hover); }
.page-tool-turn { gap: 4px; padding: 0 8px; }
/* The phone's fourth control folds away everything the narrow bar hides; on a desktop it
   holds what has no button of its own (colors, icon and cover, the exports). */
.page-tool-sep { width: 1px; height: 16px; margin: 0 3px; background: currentColor; opacity: 0.5; }
.page-safe-probe { position: fixed; left: 0; bottom: 0; width: 0; height: 0; padding-bottom: env(safe-area-inset-bottom); visibility: hidden; pointer-events: none; }
.page-plus { position: absolute; z-index: 2; top: calc(var(--page-plus-top, 0px) - var(--page-plus-size) / 2); left: calc(var(--page-plus-left, 0px) - var(--page-plus-size) - 12px); width: var(--page-plus-size); height: var(--page-plus-size); display: grid; place-items: center; padding: 0; cursor: pointer; }
.page-plus[aria-expanded="true"] { color: var(--page-chrome-ink-moved); background: var(--page-chrome-bg-moved); }
.page-grip { position: absolute; z-index: 2; top: calc(var(--page-plus-top, 0px) - var(--page-grip-size, var(--page-plus-size)) / 2); left: calc(var(--page-plus-left, 0px) - var(--page-plus-size) - 12px - var(--page-grip-size, var(--page-plus-size)) - 2px); width: var(--page-grip-size, var(--page-plus-size)); height: var(--page-grip-size, var(--page-plus-size)); display: grid; place-items: center; padding: 0; border: 0; border-radius: var(--page-chrome-radius); background: none; color: var(--page-chrome-ink-moved); opacity: 0; cursor: grab; touch-action: none; transition: opacity var(--page-fade); }
.page-shell.is-moved .page-grip, .page-grip.is-on, .page-grip:focus-visible, .page-grip[aria-expanded="true"] { opacity: 1; }
.page-bubble, .page-menu { position: absolute; z-index: 4; background: var(--page-pop-bg); color: var(--page-pop-ink); border: 1px solid var(--page-pop-line); box-shadow: var(--page-pop-shadow); border-radius: var(--page-pop-radius); }
.page-bubble { display: flex; gap: 1px; padding: 3px; left: var(--page-pop-x, 0px); top: var(--page-pop-y, 0px); transform: translate(-50%, calc(-100% - 8px)); }
.page-menu { left: var(--page-pop-x, 0px); top: var(--page-pop-y, 0px); width: 260px; max-height: 340px; overflow-y: auto; padding: 6px; font-size: 14px; }
.page-menu-title { padding: 4px 10px 6px; color: var(--page-pop-muted); font-size: 12px; }
.page-menu-item { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 34px; padding: 4px 10px; border: 0; border-radius: 7px; background: none; color: inherit; font: inherit; text-align: start; cursor: pointer; }
.page-menu-item[aria-selected="true"], .page-menu-item.is-active, .page-menu-item:hover { background: var(--page-pop-hover); }
.page-menu-icon { display: grid; place-items: center; width: 24px; height: 24px; border: 1px solid var(--page-pop-line); border-radius: 6px; color: var(--page-pop-muted); font-size: 12px; flex: none; }
.page-menu-hint { margin-inline-start: auto; color: var(--page-pop-muted); font-size: 12px; }
.page-menu-text { display: flex; flex-direction: column; min-width: 0; }
.page-menu-desc { color: var(--page-pop-muted); font-size: 12px; line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.page-menu-empty { padding: 8px 10px; color: var(--page-pop-muted); font-size: 13px; }
.page-shell.is-dragging, .page-shell.is-dragging .page-grip { cursor: grabbing; }
.page-shell[data-drop="none"] { cursor: no-drop; }
.page-drop { position: absolute; z-index: 3; left: var(--page-drop-x, 0px); top: var(--page-drop-y, 0px); width: var(--page-drop-w, 0px); height: 2px; margin-top: -1px; border-radius: 1px; background: var(--page-drop, var(--page-accent)); pointer-events: none; }
.page-shell.is-dragging .page-block-selected { opacity: 0.45; }
.page-editor.ProseMirror-hideselection { caret-color: transparent; }
.page-editor.ProseMirror-hideselection *::selection { background: transparent; }
.page-editor .page-block-selected { background: var(--page-block-selected, rgba(88, 120, 170, 0.12)); box-shadow: -6px 0 0 var(--page-block-selected, rgba(88, 120, 170, 0.12)), 6px 0 0 var(--page-block-selected, rgba(88, 120, 170, 0.12)); border-radius: 4px; }
.page-editor .page-link-pending { background: var(--page-selection); }
.page-link { position: absolute; z-index: 4; left: var(--page-pop-x, 0px); top: var(--page-pop-y, 0px); display: flex; align-items: center; gap: 2px; padding: 4px; max-width: min(420px, calc(100% - 32px)); background: var(--page-pop-bg); color: var(--page-pop-ink); border: 1px solid var(--page-pop-line); box-shadow: var(--page-pop-shadow); border-radius: var(--page-pop-radius); font-size: 14px; }
.page-link-input { flex: 1; min-width: 220px; height: 30px; padding: 0 8px; border: 0; border-radius: 6px; background: var(--page-pop-hover); color: inherit; font: inherit; outline: none; }
.page-link-input[aria-invalid="true"] { box-shadow: inset 0 0 0 1px var(--page-danger, #9E3B2F); }
.page-link-url { max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0 8px; color: var(--page-pop-muted); text-decoration: none; }
.page-link-btn { display: inline-grid; place-items: center; min-width: 30px; height: 30px; padding: 0 6px; border: 0; border-radius: 6px; background: none; color: inherit; font: inherit; cursor: pointer; }
.page-link-btn:hover { background: var(--page-pop-hover); }
.page-live { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.ProseMirror-focused .page-placeholder::before { content: attr(data-placeholder); float: left; height: 0; color: var(--page-ink-faint); pointer-events: none; }
.page-editor .page-title-placeholder::before { content: attr(data-placeholder); float: left; height: 0; color: var(--page-ink-faint); pointer-events: none; }
.page-csv-error { margin: 8px 0; color: var(--page-danger); font-size: 14px; }
.page-editor .page-table { max-width: 100%; min-width: 0; border: 1px solid var(--page-rule); border-radius: 8px; }
.page-editor .page-chart { position: relative; max-width: 100%; min-width: 0; margin-inline: 0; color: var(--page-ink); }
.page-chart-plot svg { display: block; width: 100%; height: auto; color: var(--chart-text, var(--page-ink-soft)); font: 12px var(--page-font); }
.page-chart figcaption { color: var(--page-ink-soft); font-size: 0.88em; text-align: center; }
.page-chart-settings { display: block; margin: 8px auto 0; padding: 4px 10px; border: 1px solid var(--page-rule); border-radius: 6px; background: var(--page-pop-bg); color: var(--page-ink); font: inherit; cursor: pointer; }
.page-chart-title-input { display: block; width: min(100%, 24em); box-sizing: border-box; margin: 6px auto; padding: 4px 8px; border: 1px solid var(--page-rule); border-radius: 6px; background: var(--page-pop-bg); color: var(--page-ink); font: inherit; }
.page-table-scroll { max-width: 100%; overflow-x: auto; }
.page-table table { border-collapse: collapse; min-width: max-content; width: 100%; table-layout: auto; }
.page-table th, .page-table td { min-width: 120px; padding: 6px 10px; border-inline-end: 1px solid var(--page-rule); border-block-end: 1px solid var(--page-rule); text-align: start; white-space: pre-wrap; }
.page-table th { background: var(--page-code-bg); color: var(--page-ink-soft); font-weight: 600; }
.page-table th[data-kind="number"], .page-table td[data-kind="number"] { text-align: end; }
.page-table th[aria-sort="ascending"] button::after { content: " \u2191"; }
.page-table th[aria-sort="descending"] button::after { content: " \u2193"; }
.page-table th button, .page-table-row-menu, .page-check-chip { border: 0; border-radius: 5px; background: none; color: inherit; font: inherit; cursor: pointer; }
.page-table th button:hover, .page-table-row-menu:hover, .page-check-chip:hover { background: var(--page-pop-hover); }
.page-editor td > span { display: block; }
.page-table-row-menu { float: inline-end; margin-inline-start: 4px; opacity: 0; font-size: 12px; color: var(--page-ink-soft); }
.page-table tr:hover .page-table-row-menu, .page-table tr:focus-within .page-table-row-menu, .page-table-row-menu:focus-visible { opacity: 1; }
.page-check-controls { display: inline-flex; gap: 4px; margin-inline-start: 8px; color: var(--page-ink-soft); font-size: 0.78em; text-decoration: none; }
.page-check-controls[data-empty="true"] { opacity: 0; }
.page-li:hover .page-check-controls, .page-li:focus-within .page-check-controls { opacity: 1; }
.page-check-popup { display: inline-flex; gap: 4px; padding: 4px; background: var(--page-pop-bg); color: var(--page-pop-ink); border: 1px solid var(--page-pop-line); border-radius: var(--page-pop-radius); box-shadow: var(--page-pop-shadow); }
.page-check-popup input { font: inherit; color: inherit; background: var(--page-pop-bg); border: 1px solid var(--page-pop-line); }
.page-check-popup.page-check-owner { display: inline-block; width: min(280px, 80vw); padding: 8px 0; vertical-align: top; }
.page-board-owners { display: flex; flex-direction: column; gap: 6px; min-width: 0; padding-inline: 8px; }
.page-board-people { display: flex; flex-wrap: wrap; gap: 4px; }
.page-board-person { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px 0 4px; border: 1px solid var(--page-rule); border-radius: 14px; background: var(--page-pop-bg); color: var(--page-pop-ink); font: inherit; font-size: 13px; cursor: pointer; transition: background-color var(--page-fade), border-color var(--page-fade); }
.page-board-person.is-none { padding-inline-start: 10px; color: var(--page-pop-muted); }
.page-board-person:hover { background: var(--page-pop-hover); }
.page-board-person[aria-pressed="true"] { border-color: var(--page-accent); background: var(--page-selection); color: var(--page-pop-ink); }
.page-board-owner-input { width: 100%; height: 32px; box-sizing: border-box; padding: 0 8px; border: 1px solid var(--page-pop-line); border-radius: 7px; background: var(--page-pop-bg); color: var(--page-pop-ink); font: inherit; font-size: 14px; }
.page-board-owner-input::placeholder { color: var(--page-ink-faint); }
.page-board-face { flex: none; display: inline-grid; place-items: center; width: 20px; height: 20px; border-radius: 50%; background: var(--page-code-bg); box-shadow: inset 0 0 0 1px var(--page-rule); color: var(--page-ink-soft); font-size: 10.5px; font-weight: 600; line-height: 1; }
.page-scrim { display: none; }
.page-shell [hidden] { display: none !important; }
@media (max-width: 560px) {
  /* One fixed bar over the visual viewport, with the four controls a phone keeps.
     The bubble and the desktop-only tools stand down so nothing is doubled. */
  .page-dock { display: flex; position: fixed; left: 0; top: 8px; width: 204px; min-width: 204px; box-sizing: border-box; align-items: center; justify-content: center; gap: 4px; margin: 0; padding: 8px; z-index: 3; }
  .page-tool-desk { display: none; }
  .page-dock .page-tool-more { display: inline-flex; }
  .page-dock .page-tool { min-width: 44px; height: 44px; }
  .page-shell:has(.page-bubble:not([hidden])) .page-dock { visibility: visible; }
  .page-dock + .page-editor { padding-bottom: calc(72px + env(safe-area-inset-bottom)); }
  .page-plus { position: fixed; top: auto; left: 16px; bottom: calc(16px + env(safe-area-inset-bottom)); width: 44px; height: 44px; border-radius: 22px; }
  .page-grip { position: fixed; top: auto; left: 68px; bottom: calc(16px + var(--page-grip-lift, 0px) + env(safe-area-inset-bottom)); width: 44px; height: 44px; border-radius: 22px; opacity: 1; color: var(--page-chrome-ink-rest); background: var(--page-chrome-bg-rest); border: 1px solid var(--page-chrome-line-rest); }
  .page-bubble { display: none; }
  .page-scrim { display: block; position: fixed; inset: 0; z-index: 4; background: var(--page-scrim); }
  .page-menu { position: fixed; left: 0; top: 0; width: var(--page-pop-width, min(280px, calc(100vw - 16px))); max-height: min(70vh, var(--page-pop-max, 70vh)); overflow-y: auto; transform: translate(var(--page-pop-x, 0px), var(--page-pop-y, 0px)); z-index: 5; }
  .page-menu-item { min-height: 48px; font-size: 16px; }
  .page-link { position: fixed; left: 0; right: 0; top: auto; bottom: 0; max-width: none; padding: 8px 16px calc(8px + env(safe-area-inset-bottom)); border-radius: 0; border-width: 1px 0 0; }
  .page-link-input { min-width: 0; height: 44px; font-size: 16px; }
  .page-link-btn, .page-upload-btn { min-width: 44px; height: 44px; }
  .page-image-frame { width: 100% !important; }
  .page-image-handle { display: none; }
  .page-table th button, .page-table-row-menu, .page-check-chip, .page-check-popup button, .page-menu-item { min-height: 44px; }
  .page-board-owner-input { font-size: 16px; height: 44px; }
  .page-board-person { height: 44px; border-radius: 22px; }
}
@media (prefers-reduced-motion: reduce) {
  .page-dock, .page-plus, .page-grip, .page-toggle-button, .page-image-handle, .page-upload-bar > span, .page-board-person { transition: none; }
}
}
`,Xe=(e,a)=>(a&&a(e.tr.replaceSelectionWith(b.nodes.hard_break.create()).scrollIntoView()),!0),Ge=(e,a,r)=>!a||!r?.editable||!X(e,b.marks.underline)?!1:(import("../c-GYMFECFS.js").then(({formatMark:o})=>o(r,"underline"),()=>null).then(o=>{o?.status!=="applied"&&!r.isDestroyed&&re(r,o?.message??"That format isn\u2019t available here.")}),!0),Ye=({history:e=!0,undo:a,redo:r}={})=>({"Mod-z":e?C.undo:()=>(a?.(),!0),"Shift-Mod-z":e?C.redo:()=>(r?.(),!0),"Mod-y":e?C.redo:()=>(r?.(),!0),"Shift-Enter":Xe,"Mod-b":w.toggleMark(b.marks.strong),"Mod-i":w.toggleMark(b.marks.em),"Mod-u":Ge}),Je=(e,a,r)=>ge(null,r)?!1:q.undoInputRule(e,a&&(o=>a(Ee(o)))),Qe={Backspace:w.chainCommands(Je,se),"Mod-e":w.toggleMark(b.marks.code),"Mod-Shift-s":w.toggleMark(b.marks.strike)},Ze=(e,a)=>globalThis.clay?.upload?.(e,a)??Promise.resolve({ok:!1,code:"unavailable",msg:"File uploads are not available in this editor"}),Oe=new WeakMap,T=new u.PluginKey("lazyViews"),$=class{constructor(a,r){this.node=a,this.type=a.type,this.registry=r;let{dom:o,contentDOM:t}=W.DOMSerializer.renderSpec(document,a.type.spec.toDOM(a));this.dom=o,this.contentDOM=t??null}update(a){return a.type===this.type&&!this.registry.has(a.type.name)}};function ea(){return new u.Plugin({key:T,state:{init:()=>k.DecorationSet.empty,apply(e){let a=e.getMeta(T);if(!a)return k.DecorationSet.empty;let r=[];return e.doc.forEach((o,t)=>{a.types.includes(o.type.name)&&r.push(k.Decoration.node(t,t+o.nodeSize,{},{lazyView:r.length+1}))}),k.DecorationSet.create(e.doc,r)}},props:{decorations:e=>T.getState(e)}})}function aa({view:e,upload:a,toolHost:r,board:o=null,undo:t=null,redo:n=null,revise:i=null,highlight:l},c,v){let m=v.createFeature({view:e,upload:a,toolHost:r,board:o,undo:t,redo:n,revise:i,highlight:l}),y=Oe.get(e),z=()=>{if(m.css&&j(`page-feature-${c}`,m.css,`page-feature-${c}`,["editor-ui"]),!m.nodeViews)return;let A=Object.keys(m.nodeViews);for(let x of A)y.set(x,m.nodeViews[x]);e.dispatch(e.state.tr.setMeta(T,{types:A}).setMeta("addToHistory",!1))},E=()=>{e.isDestroyed||(e.composing?setTimeout(E,25):z())};return e.composing?e.dom.addEventListener("compositionend",()=>setTimeout(E,25),{once:!0}):z(),m}function ra(e){return new u.Plugin({view(a){let r=new Set,o=()=>{for(let n of r)e.has(n)&&r.delete(n);a.state.doc.forEach(n=>{let i=Ce(n);!i||e.has(i)||r.has(i)||e.ensure(i).catch(()=>{r.add(i)})})},t=a.state.doc;return o(),{update(){a.state.doc!==t&&(t=a.state.doc,o())}}}})}function oa({load:e=()=>Promise.reject(new Error("page: this editor has no command module")),context:a=()=>({}),reportError:r}={}){let o=new Map,t=new Set,n=null,i=null,l=!0,c=!1,v=0,m=d=>{let g=o.get(d);return g||(g=Promise.resolve(e(d)),o.set(d,g),g.catch(()=>{o.get(d)===g&&o.delete(d)})),g},y=()=>(i??=L({load:m,install:(d,g)=>g.createFeature(a(n)),reportError:r??((d,g)=>console.error(`clayjs: the ${g} command failed to load`,d))}),i),z=()=>{let d=v,g=n.state.selection;return{revision:d,selection:g,valid:()=>l&&!c&&!n.isDestroyed&&v===d&&n.state.selection.eq(g)}};function E(d,g){d.doc!==g.doc&&(v+=1);for(let h of t)h.lease.valid()||(t.delete(h),h.controller.abort({ok:!1,code:"stale-target"}))}async function A(d,g){if(!l||c||!n||n.isDestroyed)return{ok:!1,code:"not-editing"};let h={lease:z(),controller:new AbortController};t.add(h);try{let s=await y().ensure(d,{signal:h.controller.signal});return s?h.lease.valid()?await s.run(g):{ok:!1,code:"stale-target"}:{ok:!1,code:"not-editing"}}catch(s){return h.controller.signal.aborted?h.controller.signal.reason:{ok:!1,code:"unavailable",error:s}}finally{t.delete(h)}}function x(){if(l){l=!1;for(let d of t)d.controller.abort({ok:!1,code:"not-editing"});t.clear()}}function S(){x(),i?.dispose(),i=null}return{attach(d){n=d},observe:E,run:A,enter(){c||(l=!0)},quiesce:x,leave:S,dispose(){S(),c=!0,l=!1,o.clear()}}}var H=new WeakMap;function ta(e){return new u.Plugin({view:()=>({update:(a,r)=>e.observe(a.state,r)}),props:{handleTextInput(a,r,o,t){return t!=="@"||a.composing||!Object.hasOwn(F,"mentions")?!1:(a.dispatch(a.state.tr.insertText("@",r,o)),e.run("mentions",{from:r,to:r+1}),!0)}}})}function Ra(e,a,r){let o=e?H.get(e):null;return o?Object.hasOwn(F,a)?o.run(a,r):Promise.resolve({ok:!1,code:"unknown-command"}):Promise.resolve({ok:!1,code:"not-editing"})}function pa(e){return new u.Plugin({view(a){let r=e?()=>e.tablesChanged():()=>me.get(a)?.tablesChanged?.(),o=a.state.doc;return{update(t){t.state.doc!==o&&(o=t.state.doc,r())}}}})}function na({upload:e=Ze,highlight:a,history:r=!0,undo:o,redo:t,onAiTool:n=null,toolHost:i=null,features:l=null,commandHost:c=null}={}){return[ae(),ve({onAiTool:n}),c?ta(c):null,fe(),pa(i),ee(),ue(),Ae(),le(),de(),De(),ce(),D.keymap(Qe),Pe,Me,D.keymap(ze),D.keymap(Ye({history:r,undo:o,redo:t})),D.keymap(w.baseKeymap),ke(),Z(),Be(),ie(),te({upload:e}),we(),oe({upload:e,features:l}),he(),ye(),be(),r?C.history():null,U.gapCursor(),ea(),l?ra(l):null].filter(Boolean)}function ia(e,a={}){let r=e&&Object.keys(e).length?e:{[Y()]:{t:"paragraph",pos:G(),c:""}},o=a.doc??Q(b,r);return u.EditorState.create({doc:o,plugins:na(a)})}function Va(e){!e||e.isDestroyed||e.updateState(e.state)}function $a(e,a,{quiesce:r=!1}={}){if(!e||e.isDestroyed)return!1;let o=a===!0;e.setProps({editable:()=>o});let t=H.get(e);return o?t?.enter():r?t?.quiesce():t?.leave(),o}function ga(e,a){let r=a.target.closest?.('.page-li[data-kind="check"]');if(!r||!e.dom.contains(r))return!1;let o=r.getBoundingClientRect(),t=parseFloat(getComputedStyle(r).paddingInlineStart)||0,n=getComputedStyle(r).direction==="rtl"?o.right-a.clientX:a.clientX-o.left;if(n<0||n>t)return!1;let i=e.posAtDOM(r,0)-1,l=e.state.doc.nodeAt(i);return l?(a.preventDefault(),e.dispatch(e.state.tr.setNodeMarkup(i,null,{...l.attrs,checked:!l.attrs.checked})),!0):!1}function Ha(e,{blocks:a=null,onChange:r=null,upload:o,highlight:t,doc:n,dispatch:i,history:l=!0,undo:c,redo:v,editable:m=!0,toolHost:y=null,onAiTool:z=null,reviseTool:E=null,board:A=null,features:x=null,formatGate:S=null}={}){let d=e.ownerDocument;j(Fe,Ue,Fe,["editor-ui"]);let g=d.createElement("div");g.className="page-shell",g.setAttribute("clay","editor-ui"),g.setAttribute("sap-ignore",""),e.appendChild(g);let h=!1,s=null,O=x??L({load:p=>V[p].load(),install:(p,f)=>aa({view:s,upload:o,toolHost:y,board:A,undo:c,redo:v,revise:E,highlight:t},p,f)}),M=oa({load:p=>F[p].load(),context:p=>({view:p,upload:o})}),K=new Map,N={};for(let p of Object.values(V))for(let f of p.views??p.types)N[f]=(B,je,Le,Re,Ve)=>{let _=K.get(B.type.name);return _?_(B,je,Le,Re,Ve):new $(B,K)};s=new k.EditorView(g,{state:ia(a,{upload:o,highlight:t,doc:n,history:l,undo:c,redo:v,onAiTool:z,toolHost:y,features:O,commandHost:M}),attributes:{class:"page-editor"},scrollMargin:{top:16,bottom:96,left:5,right:5},scrollThreshold:{top:16,bottom:96,left:0,right:0},editable:()=>m,nodeViews:N,handleDOMEvents:{mousedown:ga,dragstart(p,f){let B=p.state.selection;return B instanceof u.NodeSelection||B instanceof xe?(f.preventDefault(),!0):!1}},dispatchTransaction(p){if(i){i(p);return}h&&p.docChanged&&!p.getMeta(R)&&C.closeHistory(p),p.docChanged&&(h=!!p.getMeta(R));let f=s.state.doc;s.updateState(s.state.apply(p)),r&&s.state.doc!==f&&r(J(s.state.doc))}}),Oe.set(s,K),ne.set(s,O),M.attach(s),H.set(s,M);let Ke=s.destroy.bind(s),P=null,I=!1,Ie=()=>(P||(P=Promise.resolve().then(()=>S()).catch(p=>{throw P=null,p})),P);return s.runFormatCommand=async p=>{if(I)return{status:"disposed",retry:!1};if(!S)return{status:"unsupported-host",code:"page-format-unsupported",retry:!1};let f=await Ie();return I?(f.dispose?.(),{status:"disposed",retry:!1}):f.run({apply:p})},s.destroy=()=>{I=!0,P&&P.then(p=>p?.dispose?.(),()=>{}),M.dispose(),O.dispose(),Ke()},s}export{Ue as PAGE_EDITOR_CSS,Ha as createPageEditor,aa as installPageFeature,T as lazyViewsKey,ea as lazyViewsPlugin,na as pagePlugins,ia as pageState,Va as refreshMountedView,Ra as runPageCommand,$a as setEditorActive};
