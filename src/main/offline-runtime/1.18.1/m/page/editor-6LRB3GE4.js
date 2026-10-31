import{a as se,c as L}from"../c-BIJALSRD.js";import"../c-IW6GGOU2.js";import"../c-HAWFNBYG.js";import{b as he}from"../c-VJYEVRYK.js";import{P as Pe,Q as Ce,f as te,j as ge,k as de,l as le,m as ce,o as ue,r as be,t as fe,y as me}from"../c-4TXNLX4K.js";import"../c-EXKHPOVC.js";import"../c-L5VFATT6.js";import{n as oe}from"../c-MWXFLW4J.js";import"../c-ZK4GIZH2.js";import{a as pe,b as ie,d as ne}from"../c-W4JCVLAB.js";import"../c-7K4SCQB7.js";import"../c-WMRJKQ2V.js";import{A as ze,B as Ee,H as Ae,b as ae,c as re,f as R,k as ve,o as ke,w as we,z as ye}from"../c-AMU3BPPR.js";import{G as Y,J,N as Q,P as Z,S as ee,a as W,b as u,d as v,e as B,f as D,g as w,h as U,i as X,m as b,w as G}from"../c-QIXT3Q7C.js";import{a as q,c as Be,d as F}from"../c-VILENZTD.js";import{a as xe}from"../c-BYTKL6UX.js";import"../c-WCXLG3MV.js";import"../c-57XDY6HC.js";import{b as I}from"../c-GY422N3Q.js";import"../c-7SWMYKAI.js";import"../c-UGHH4MB3.js";import"../c-ZWIOJGMT.js";import"../c-IJUK2GPW.js";import"../c-VG5XIN4T.js";import"../c-2YYDMLNZ.js";import"../c-HA6INT6J.js";import"../c-DCFSEJZG.js";import"../c-WRBKEJD4.js";import"../c-VHNSBD2M.js";var{Decoration:V,DecorationSet:qe}=v,Ve="Type / for blocks",$e="Untitled",He="To do";function _e(e){let a=!1,r=null;return e.forEach((o,t)=>{a||o.type!==b.nodes.heading||o.attrs.level!==1||(o.attrs.parent??null)!==null||(a=!0,o.content.size||(r=V.node(t,t+o.nodeSize,{class:"page-title-placeholder","data-placeholder":$e})))}),r}function Ne(e){let a=[];return e.forEach((r,o)=>{r.type!==b.nodes.list_item||r.attrs.kind!=="check"||r.content.size||r.attrs.checked||a.push(V.node(o,o+r.nodeSize,{class:"page-check-placeholder","data-placeholder":He}))}),a}function Se(e=Ve){return new u.Plugin({props:{decorations(a){let r=Ne(a.doc),o=_e(a.doc);o&&r.push(o);let{selection:t}=a;if(t.empty){let p=t.$from;if(p.depth===1){let n=p.parent;if(n.type===b.nodes.paragraph&&!n.content.size){let d=p.before(1);r.push(V.node(d,d+n.nodeSize,{class:"page-placeholder","data-placeholder":e}))}}}return r.length?qe.create(a.doc,r):null}}})}var De=new u.Plugin({props:{handleKeyDown(e,a){if(!(a.metaKey||a.ctrlKey)||!a.shiftKey||a.altKey)return!1;let r=a.key.toLowerCase()==="o"?"owner":a.key.toLowerCase()==="d"?"date":null;if(!r||e.dom.getAttribute(r==="owner"?"data-assignees":"data-dates")==="false")return!1;for(let o of pe.get(e)??[])if(o.focusControl?.(e,r))return!0;return!1}}});var Me="page-editor-style",We=[1,2,3,4,5,6,7,8],Ue=`
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
  --page-danger: #9E3B2F; --page-block-selected: rgba(88, 120, 170, 0.12);`,Fe=`
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
  --chart-1: #8DB0E6; --chart-2: #D9A0C8; --chart-3: #A9C98B; --chart-4: #BBA6E6; --chart-5: #E0B47A; --chart-6: #A3A098;`,Xe=`
@layer page {
:where(article[data-page], .page-shell) {${Ue}
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
@media (prefers-color-scheme: dark) { :where(:root:not([data-theme="light"]) :is(article[data-page], .page-shell)) {${Fe} } }
:where(:root[data-theme="dark"] :is(article[data-page], .page-shell)) {${Fe} }

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
.page-settings { position: absolute; z-index: 4; box-sizing: border-box; left: var(--page-pop-x, 0px); top: var(--page-pop-y, 0px); width: min(264px, calc(100vw - 28px)); padding: 9px 11px; background: var(--page-pop-bg); color: var(--page-pop-ink); border: 1px solid var(--page-pop-line); border-radius: var(--page-pop-radius); box-shadow: var(--page-pop-shadow); font-size: 13px; }
.page-settings-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding-bottom: 6px; margin-bottom: 2px; border-bottom: 1px solid var(--page-pop-line); }
.page-settings-title { font-size: 12.5px; font-weight: 600; color: var(--page-pop-ink); }
.page-settings-close { display: inline-grid; place-content: center; width: 20px; height: 20px; padding: 0; border: 1px solid transparent; border-radius: 5px; background: none; color: var(--page-pop-muted); cursor: pointer; }
.page-settings-close:hover { background: var(--page-pop-hover); color: var(--page-pop-ink); }
.page-settings-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 6px 0; }
.page-settings-name { min-width: 0; font-weight: 500; line-height: 1.3; }
.page-settings-switch { position: relative; flex: 0 0 30px; box-sizing: border-box; width: 30px; height: 18px; padding: 0; border: 0; border-radius: 9px; background: var(--page-chrome-line-moved); cursor: pointer; transition: background-color var(--page-fade); }
.page-settings-switch[aria-checked="true"] { background: var(--page-accent); }
.page-settings-knob { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: var(--page-pop-bg); transition: transform var(--page-fade); }
.page-settings-switch[aria-checked="true"] .page-settings-knob { transform: translateX(12px); }
.page-settings-note { margin: 4px 0 2px; color: var(--page-pop-muted); font-size: 11px; line-height: 1.4; }
.page-menu-title { padding: 4px 10px 6px; color: var(--page-pop-muted); font-size: 12px; }
.page-menu-item { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 34px; padding: 4px 10px; border: 0; border-radius: 7px; background: none; color: inherit; font: inherit; text-align: start; cursor: pointer; }
.page-menu-item[aria-selected="true"], .page-menu-item.is-active, .page-menu-item:hover { background: var(--page-pop-hover); }
.page-menu-icon { display: grid; place-items: center; width: 24px; height: 24px; border: 1px solid var(--page-pop-line); border-radius: 6px; color: var(--page-pop-muted); font-size: 12px; flex: none; }
.page-menu-icon svg { display: block; }
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
.page-editor .page-chart { position: relative; max-width: 100%; min-width: 0; margin-inline: 0; border: 1px solid var(--page-rule); border-radius: var(--page-chrome-radius); color: var(--page-ink); }
.page-chart-plot svg { display: block; width: 100%; height: auto; color: var(--chart-text, var(--page-ink-soft)); font: 12px var(--page-font); }
.page-chart-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--page-rule); }
.page-chart-title { min-width: 0; margin-inline-end: auto; font-size: 14px; font-weight: 600; line-height: 1.3; }
.page-chart-title.is-empty { color: var(--page-ink-faint); font-weight: 500; }
.page-chart-source { display: inline-flex; align-items: center; gap: 5px; box-sizing: border-box; height: 22px; padding: 0 7px; border: 1px solid var(--page-pop-line); border-radius: var(--page-chrome-radius); background: var(--page-pop-bg); color: var(--page-pop-muted); font: inherit; font-size: 11.5px; cursor: pointer; }
.page-chart-source:hover { color: var(--page-ink); border-color: var(--page-chrome-line-moved); }
.page-chart-source svg, .page-chart-edit svg, .page-chart-remove svg { flex: none; }
.page-chart-edit { display: inline-flex; align-items: center; gap: 6px; box-sizing: border-box; height: 28px; padding: 0 10px; border: 1px solid var(--page-rule); border-radius: var(--page-chrome-radius); background: none; color: var(--page-ink); font: inherit; font-size: 12.5px; font-weight: 500; cursor: pointer; }
.page-chart-edit:hover, .page-chart-edit[aria-expanded="true"] { background: var(--page-pop-hover); }
.page-chart-panel { position: absolute; z-index: 5; top: 46px; inset-inline-end: 10px; box-sizing: border-box; width: 304px; padding: 12px; border: 1px solid var(--page-pop-line); border-radius: var(--page-pop-radius); background: var(--page-pop-bg); box-shadow: var(--page-pop-shadow); color: var(--page-pop-ink); font-family: var(--page-font); font-size: 13px; text-align: start; }
.page-chart-panel:focus { outline: none; }
.page-chart-row { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; }
.page-chart-row:last-child { margin-bottom: 0; }
.page-chart-label { color: var(--page-pop-muted); font-size: 12px; font-weight: 500; }
.page-chart-types { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px; }
.page-chart-type, .page-chart-remove, .page-chart-done { display: inline-flex; align-items: center; justify-content: center; gap: 6px; box-sizing: border-box; height: 28px; padding: 0 10px; border: 1px solid var(--page-pop-line); border-radius: var(--page-chrome-radius); background: none; color: var(--page-pop-ink); font: inherit; font-size: 12.5px; font-weight: 500; cursor: pointer; }
.page-chart-type:hover, .page-chart-remove:hover, .page-chart-done:hover { background: var(--page-pop-hover); }
.page-chart-type[aria-pressed="true"] { border-color: var(--page-chrome-line-moved); background: var(--page-pop-hover); font-weight: 600; }
.page-chart-select, .page-chart-title-input { box-sizing: border-box; width: 100%; height: 28px; padding: 0 8px; border: 1px solid var(--page-pop-line); border-radius: var(--page-chrome-radius); background: var(--page-pop-bg); color: var(--page-pop-ink); font: inherit; font-size: 12.5px; }
.page-chart-values { display: flex; flex-direction: column; gap: 1px; padding: 5px 6px; border: 1px solid var(--page-pop-line); border-radius: var(--page-chrome-radius); }
.page-chart-value { display: flex; align-items: center; gap: 7px; padding: 2px 4px; font-size: 12.5px; cursor: pointer; }
.page-chart-value:hover { background: var(--page-pop-hover); }
.page-chart-value input { margin: 0; accent-color: var(--page-accent); }
.page-chart-swatch { flex: none; width: 10px; height: 10px; border-radius: 2px; }
.page-chart-hint { color: var(--page-pop-muted); font-size: 11px; line-height: 1.4; }
.page-chart-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--page-pop-line); }
.page-chart-remove { color: var(--page-danger); }
.page-chart-broken { box-sizing: border-box; padding: 16px; border: 1px solid var(--page-pop-line); border-radius: var(--page-chrome-radius); background: var(--page-pop-hover); font-family: var(--page-font); text-align: start; }
.page-chart-broken[hidden] { display: none; }
.page-chart-plot[hidden] { display: none; }
.page-chart-broken-head { margin-bottom: 4px; font-size: 13.5px; font-weight: 600; line-height: 1.3; }
.page-chart-broken-text { margin: 0 0 12px; color: var(--page-pop-muted); font-size: 12.5px; line-height: 1.45; }
.page-chart-broken-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.page-chart-use, .page-chart-delete { display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box; height: 28px; padding: 0 10px; border: 1px solid var(--page-pop-line); border-radius: var(--page-chrome-radius); background: var(--page-pop-bg); color: var(--page-pop-ink); font: inherit; font-size: 12.5px; font-weight: 500; cursor: pointer; }
.page-chart-use:hover, .page-chart-delete:hover { background: var(--page-pop-bg); border-color: var(--page-chrome-line-moved); }
.page-chart-delete { color: var(--page-danger); }
.page-chart-broken-actions .page-chart-select { width: auto; min-width: 0; flex: 1 1 140px; }
@media (max-width: 560px) {
  .page-chart-panel { position: static; inset-inline-end: auto; width: auto; border: 0; border-top: 1px solid var(--page-pop-line); border-radius: 0; box-shadow: none; }
  .page-chart-use, .page-chart-delete, .page-chart-broken-actions .page-chart-select { height: 44px; }
}
.page-table-scroll { max-width: 100%; overflow-x: auto; }
.page-table table { border-collapse: collapse; min-width: max-content; width: 100%; table-layout: auto; }
.page-table th, .page-table td { min-width: 120px; padding: 6px 10px; border-inline-end: 1px solid var(--page-rule); border-block-end: 1px solid var(--page-rule); text-align: start; white-space: pre-wrap; }
.page-table th { background: var(--page-code-bg); color: var(--page-ink-soft); font-weight: 600; }
.page-table th[data-kind="number"], .page-table td[data-kind="number"] { text-align: end; }
.page-table th[aria-sort="ascending"] button::after { content: " \u2191"; }
.page-table th[aria-sort="descending"] button::after { content: " \u2193"; }
.page-table th button, .page-table-row-menu { border: 0; border-radius: 5px; background: none; color: inherit; font: inherit; cursor: pointer; }
.page-table th button:hover, .page-table-row-menu:hover { background: var(--page-pop-hover); }
.page-editor td > span { display: block; }
.page-table-row-menu { float: inline-end; margin-inline-start: 4px; opacity: 0; font-size: 12px; color: var(--page-ink-soft); display: inline-grid; place-items: center; width: 22px; height: 22px; padding: 0; }
.page-table tr:hover .page-table-row-menu, .page-table tr:focus-within .page-table-row-menu, .page-table-row-menu:focus-visible { opacity: 1; }
/* The tags float to the end of the item's first line, so long text wraps beside and
   below them without the text's own marks being pulled apart. The item's whole line
   stays the click target for an empty item, which has no text of its own. */
.page-li.page-check-placeholder::after { content: attr(data-placeholder); position: absolute; inset-inline-start: calc((var(--li-indent) + 1) * var(--page-indent)); color: var(--page-ink-faint); pointer-events: none; }
.page-check-controls { display: inline-flex; float: inline-end; flex-wrap: wrap; align-items: center; gap: 5px; margin-inline-start: 10px; text-decoration: none; }
.page-check-chip { display: inline-flex; align-items: center; gap: 4px; box-sizing: border-box; height: 23px; padding: 0 7px; border: 1px solid var(--page-rule); border-radius: var(--page-check-radius); background: transparent; color: var(--page-ink-soft); font: 400 12px/1 var(--page-font); white-space: nowrap; cursor: pointer; }
.page-check-chip svg { flex: none; }
.page-check-chip:hover { background: var(--page-pop-hover); }
.page-check-chip[data-filled="true"] { border-color: transparent; background: var(--page-chrome-bg-moved); color: var(--page-ink); font-weight: 500; }
.page-check-chip[data-overdue="true"] { border-color: var(--page-danger); color: var(--page-danger); }
.page-li[data-checked="true"] .page-check-controls { opacity: 0.62; }
[data-assignees="false"] .page-check-chip[data-check="owner"], [data-dates="false"] .page-check-chip[data-check="date"] { display: none; }
[data-assignees="false"][data-dates="false"] .page-check-controls { display: none; }
.page-check-popup { display: inline-flex; gap: 4px; padding: 4px; background: var(--page-pop-bg); color: var(--page-pop-ink); border: 1px solid var(--page-pop-line); border-radius: var(--page-pop-radius); box-shadow: var(--page-pop-shadow); }
.page-check-popup input { font: inherit; color: inherit; background: var(--page-pop-bg); border: 1px solid var(--page-pop-line); }
.page-check-popup.page-check-owner, .page-check-popup.page-check-date { position: absolute; z-index: 5; display: block; box-sizing: border-box; width: min(264px, calc(100vw - 28px)); padding: 8px; background: var(--page-pop-bg); color: var(--page-pop-ink); border: 1px solid var(--page-pop-line); border-radius: var(--page-pop-radius); box-shadow: var(--page-pop-shadow); font-family: var(--page-font); }
.page-check-search { box-sizing: border-box; width: 100%; height: 28px; padding: 0 8px; border: 1px solid var(--page-pop-line); border-radius: 7px; background: var(--page-pop-bg); color: var(--page-pop-ink); font: inherit; font-size: 12.5px; }
.page-check-search::placeholder { color: var(--page-ink-faint); }
.page-check-subhead { padding: 7px 4px 4px; color: var(--page-pop-muted); font-size: 11.5px; font-weight: 500; }
.page-check-people { display: flex; flex-direction: column; gap: 1px; }
.page-check-person { display: flex; align-items: center; gap: 7px; width: 100%; padding: 5px 6px; border: 0; background: none; color: var(--page-pop-ink); font: inherit; font-size: 12.5px; text-align: start; cursor: pointer; }
.page-check-person:hover { background: var(--page-pop-hover); }
.page-check-person[aria-pressed="true"] { font-weight: 500; }
.page-check-person .page-board-face { flex: 0 0 18px; width: 18px; height: 18px; }
.page-check-person-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.page-check-person-meta { margin-inline-start: auto; color: var(--page-pop-muted); font-size: 11px; }
.page-check-person svg { flex: none; }
.page-check-divider { height: 1px; margin: 6px 0; background: var(--page-pop-line); }
.page-check-danger { color: var(--page-danger); }
.page-check-danger:hover { background: var(--page-pop-hover); }
.page-check-danger[disabled] { opacity: 0.45; background: none; cursor: default; }
.page-check-quick { display: flex; flex-direction: column; gap: 1px; }
.page-check-quick-row { display: flex; align-items: center; gap: 7px; width: 100%; padding: 5px 6px; border: 0; background: none; color: var(--page-pop-ink); font: inherit; font-size: 12.5px; text-align: start; cursor: pointer; }
.page-check-quick-row:hover { background: var(--page-pop-hover); }
.page-check-quick-row svg { flex: none; }
.page-check-quick-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.page-check-quick-meta { margin-inline-start: auto; color: var(--page-pop-muted); font-family: var(--page-font-mono); font-size: 11px; font-variant-numeric: tabular-nums; }
.page-check-cal { margin-top: 6px; padding-top: 6px; border-top: 1px solid var(--page-pop-line); }
.page-check-cal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 5px; padding: 0 2px; }
.page-check-cal-month { color: var(--page-pop-ink); font-size: 12px; font-weight: 600; }
.page-check-cal-year { font-family: var(--page-font-mono); font-size: 11.5px; font-variant-numeric: tabular-nums; }
.page-check-cal-nav { display: inline-flex; gap: 3px; }
.page-check-cal-btn { display: inline-grid; place-content: center; width: 22px; height: 22px; padding: 0; border: 1px solid var(--page-pop-line); border-radius: var(--page-check-radius); background: none; color: var(--page-pop-ink); cursor: pointer; }
.page-check-cal-btn:hover { background: var(--page-pop-hover); }
.page-check-cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; text-align: center; }
.page-check-cal-dow { padding: 2px 0; color: var(--page-pop-muted); font-size: 10.5px; font-weight: 500; }
.page-check-cal-day { height: 28px; padding: 0; border: 1px solid transparent; border-radius: var(--page-check-radius); background: transparent; color: var(--page-pop-ink); font-family: var(--page-font-mono); font-size: 11.5px; font-variant-numeric: tabular-nums; cursor: pointer; }
.page-check-cal-day:hover { background: var(--page-pop-hover); }
.page-check-cal-day[data-outside="true"] { opacity: 0.5; }
.page-check-cal-day[data-today="true"] { border-color: var(--page-accent); font-weight: 500; }
.page-check-cal-day[aria-pressed="true"] { background: var(--page-chrome-bg-moved); font-weight: 500; }
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
  .page-settings { position: fixed; left: 0; top: 0; transform: translate(var(--page-pop-x, 0px), var(--page-pop-y, 0px)); z-index: 5; }
  .page-menu-item { min-height: 48px; font-size: 16px; }
  .page-link { position: fixed; left: 0; right: 0; top: auto; bottom: 0; max-width: none; padding: 8px 16px calc(8px + env(safe-area-inset-bottom)); border-radius: 0; border-width: 1px 0 0; }
  .page-link-input { min-width: 0; height: 44px; font-size: 16px; }
  .page-link-btn, .page-upload-btn { min-width: 44px; height: 44px; }
  .page-image-frame { width: 100% !important; }
  .page-image-handle { display: none; }
  .page-table th button, .page-table-row-menu, .page-check-chip, .page-check-popup button, .page-menu-item { min-height: 44px; }
  .page-check-person { min-height: 44px; }
  .page-check-popup .page-check-quick-row { min-height: 44px; }
  .page-check-popup .page-check-cal-day { height: 40px; min-height: 40px; }
  .page-board-owner-input { font-size: 16px; height: 44px; }
  .page-check-search { font-size: 16px; height: 44px; }
  .page-check-popup .page-check-cal-btn { width: 44px; height: 44px; }
  .page-board-person { height: 44px; border-radius: 22px; }
}
@media (prefers-reduced-motion: reduce) {
  .page-dock, .page-plus, .page-grip, .page-toggle-button, .page-image-handle, .page-upload-bar > span, .page-board-person { transition: none; }
}
}
`,Ge=(e,a)=>(a&&a(e.tr.replaceSelectionWith(b.nodes.hard_break.create()).scrollIntoView()),!0),Ye=(e,a,r)=>!a||!r?.editable||!G(e,b.marks.underline)?!1:(import("../c-6UGWFMQC.js").then(({formatMark:o,refuse:t})=>o(r,"underline").then(p=>{p?.status!=="applied"&&t(r,p?.message??"That format isn\u2019t available here.")}),()=>null),!0),Je=({history:e=!0,undo:a,redo:r}={})=>({"Mod-z":e?B.undo:()=>(a?.(),!0),"Shift-Mod-z":e?B.redo:()=>(r?.(),!0),"Mod-y":e?B.redo:()=>(r?.(),!0),"Shift-Enter":Ge,"Mod-b":w.toggleMark(b.marks.strong),"Mod-i":w.toggleMark(b.marks.em),"Mod-u":Ye}),Qe=(e,a,r)=>ge(null,r)?!1:U.undoInputRule(e,a&&(o=>a(Ee(o)))),Ze={Backspace:w.chainCommands(Qe,ce),"Mod-e":w.toggleMark(b.marks.code),"Mod-Shift-s":w.toggleMark(b.marks.strike)},ea=(e,a)=>globalThis.clay?.upload?.(e,a)??Promise.resolve({ok:!1,code:"unavailable",msg:"File uploads are not available in this editor"}),Te=new WeakMap,T=new u.PluginKey("lazyViews"),$=class{constructor(a,r){this.node=a,this.type=a.type,this.registry=r;let{dom:o,contentDOM:t}=W.DOMSerializer.renderSpec(document,a.type.spec.toDOM(a));this.dom=o,this.contentDOM=t??null}update(a){return a.type===this.type&&!this.registry.has(a.type.name)}};function aa(){return new u.Plugin({key:T,state:{init:()=>v.DecorationSet.empty,apply(e){let a=e.getMeta(T);if(!a)return v.DecorationSet.empty;let r=[];return e.doc.forEach((o,t)=>{a.types.includes(o.type.name)&&r.push(v.Decoration.node(t,t+o.nodeSize,{},{lazyView:r.length+1}))}),v.DecorationSet.create(e.doc,r)}},props:{decorations:e=>T.getState(e)}})}function ra({view:e,upload:a,toolHost:r,board:o=null,undo:t=null,redo:p=null,revise:n=null,highlight:d},s,m){let x=m.createFeature({view:e,upload:a,toolHost:r,board:o,undo:t,redo:p,revise:n,highlight:d}),y=Te.get(e),z=()=>{if(x.css&&I(`page-feature-${s}`,x.css,`page-feature-${s}`,["editor-ui"]),!x.nodeViews)return;let A=Object.keys(x.nodeViews);for(let k of A)y.set(k,x.nodeViews[k]);e.dispatch(e.state.tr.setMeta(T,{types:A}).setMeta("addToHistory",!1))},E=()=>{e.isDestroyed||(e.composing?setTimeout(E,25):z())};return e.composing?e.dom.addEventListener("compositionend",()=>setTimeout(E,25),{once:!0}):z(),x}function oa(e){return new u.Plugin({view(a){let r=new Set,o=()=>{for(let p of r)e.has(p)&&r.delete(p);a.state.doc.forEach(p=>{let n=Be(p);!n||e.has(n)||r.has(n)||e.ensure(n).catch(()=>{r.add(n)})})},t=a.state.doc;return o(),{update(){a.state.doc!==t&&(t=a.state.doc,o())}}}})}function ta({load:e=()=>Promise.reject(new Error("page: this editor has no command module")),context:a=()=>({}),reportError:r}={}){let o=new Map,t=new Set,p=null,n=null,d=!0,s=!1,m=0,x=l=>{let g=o.get(l);return g||(g=Promise.resolve(e(l)),o.set(l,g),g.catch(()=>{o.get(l)===g&&o.delete(l)})),g},y=()=>(n??=L({load:x,install:(l,g)=>g.createFeature(a(p)),reportError:r??((l,g)=>console.error(`clayjs: the ${g} command failed to load`,l))}),n),z=()=>{let l=m,g=p.state.selection;return{revision:l,selection:g,valid:()=>d&&!s&&!p.isDestroyed&&m===l&&p.state.selection.eq(g)}};function E(l,g){l.doc!==g.doc&&(m+=1);for(let h of t)h.lease.valid()||(t.delete(h),h.controller.abort({ok:!1,code:"stale-target"}))}async function A(l,g){if(!d||s||!p||p.isDestroyed)return{ok:!1,code:"not-editing"};let h={lease:z(),controller:new AbortController};t.add(h);try{let c=await y().ensure(l,{signal:h.controller.signal});return c?h.lease.valid()?await c.run(g):{ok:!1,code:"stale-target"}:{ok:!1,code:"not-editing"}}catch(c){return h.controller.signal.aborted?h.controller.signal.reason:{ok:!1,code:"unavailable",error:c}}finally{t.delete(h)}}function k(){if(d){d=!1;for(let l of t)l.controller.abort({ok:!1,code:"not-editing"});t.clear()}}function S(){k(),n?.dispose(),n=null}return{attach(l){p=l},observe:E,run:A,enter(){s||(d=!0)},quiesce:k,leave:S,dispose(){S(),s=!0,d=!1,o.clear()}}}var H=new WeakMap;function pa(e){return new u.Plugin({view:()=>({update:(a,r)=>e.observe(a.state,r)}),props:{handleTextInput(a,r,o,t){return t!=="@"||a.composing||!Object.hasOwn(F,"mentions")?!1:(a.dispatch(a.state.tr.insertText("@",r,o)),e.run("mentions",{from:r,to:r+1}),!0)}}})}function qa(e,a,r){let o=e?H.get(e):null;return o?Object.hasOwn(F,a)?o.run(a,r):Promise.resolve({ok:!1,code:"unknown-command"}):Promise.resolve({ok:!1,code:"not-editing"})}function ia(e){return new u.Plugin({view(a){let r=e?()=>e.tablesChanged():()=>xe.get(a)?.tablesChanged?.(),o=a.state.doc;return{update(t){t.state.doc!==o&&(o=t.state.doc,r())}}}})}function na({upload:e=ea,highlight:a,history:r=!0,undo:o,redo:t,onAiTool:p=null,toolHost:n=null,features:d=null,commandHost:s=null}={}){return[re(),me({onAiTool:p}),s?pa(s):null,fe(),ia(n),ae(),ue(),Ae(),de(),le(),Se(),se(),D.keymap(Ze),Pe,De,D.keymap(ze),D.keymap(Je({history:r,undo:o,redo:t})),D.keymap(w.baseKeymap),ve(),ee(),Ce(),ne(),te({upload:e}),we(),oe({upload:e,features:d}),he(),ye(),be(),r?B.history():null,X.gapCursor(),aa(),d?oa(d):null].filter(Boolean)}function ga(e,a={}){let r=e&&Object.keys(e).length?e:{[J()]:{t:"paragraph",pos:Y(),c:""}},o=a.doc??Z(b,r);return u.EditorState.create({doc:o,plugins:na(a)})}function Va(e){!e||e.isDestroyed||e.updateState(e.state)}function $a(e,a,{quiesce:r=!1}={}){if(!e||e.isDestroyed)return!1;let o=a===!0;e.setProps({editable:()=>o});let t=H.get(e);return o?t?.enter():r?t?.quiesce():t?.leave(),o}function da(e,a){let r=a.target.closest?.('.page-li[data-kind="check"]');if(!r||!e.dom.contains(r))return!1;let o=r.getBoundingClientRect(),t=parseFloat(getComputedStyle(r).paddingInlineStart)||0,p=getComputedStyle(r).direction==="rtl"?o.right-a.clientX:a.clientX-o.left;if(p<0||p>t)return!1;let n=e.posAtDOM(r,0)-1,d=e.state.doc.nodeAt(n);return d?(a.preventDefault(),e.dispatch(e.state.tr.setNodeMarkup(n,null,{...d.attrs,checked:!d.attrs.checked})),!0):!1}function Ha(e,{blocks:a=null,onChange:r=null,upload:o,highlight:t,doc:p,dispatch:n,history:d=!0,undo:s,redo:m,editable:x=!0,toolHost:y=null,onAiTool:z=null,reviseTool:E=null,board:A=null,features:k=null,formatGate:S=null}={}){let l=e.ownerDocument;I(Me,Xe,Me,["editor-ui"]);let g=l.createElement("div");g.className="page-shell",g.setAttribute("clay","editor-ui"),g.setAttribute("sap-ignore",""),e.appendChild(g);let h=!1,c=null,O=k??L({load:i=>q[i].load(),install:(i,f)=>ra({view:c,upload:o,toolHost:y,board:A,undo:s,redo:m,revise:E,highlight:t},i,f)}),M=ta({load:i=>F[i].load(),context:i=>({view:i,upload:o})}),j=new Map,_={};for(let i of Object.values(q))for(let f of i.views??i.types)_[f]=(C,Ke,Ie,Le,Re)=>{let N=j.get(C.type.name);return N?N(C,Ke,Ie,Le,Re):new $(C,j)};c=new v.EditorView(g,{state:ga(a,{upload:o,highlight:t,doc:p,history:d,undo:s,redo:m,onAiTool:z,toolHost:y,features:O,commandHost:M}),attributes:{class:"page-editor"},scrollMargin:{top:16,bottom:96,left:5,right:5},scrollThreshold:{top:16,bottom:96,left:0,right:0},editable:()=>x,nodeViews:_,handleDOMEvents:{mousedown:da,dragstart(i,f){let C=i.state.selection;return C instanceof u.NodeSelection||C instanceof ke?(f.preventDefault(),!0):!1}},dispatchTransaction(i){if(n){n(i);return}h&&i.docChanged&&!i.getMeta(R)&&B.closeHistory(i),i.docChanged&&(h=!!i.getMeta(R));let f=c.state.doc;c.updateState(c.state.apply(i)),r&&c.state.doc!==f&&r(Q(c.state.doc))}}),Te.set(c,j),ie.set(c,O),M.attach(c),H.set(c,M);let Oe=c.destroy.bind(c),P=null,K=!1,je=()=>(P||(P=Promise.resolve().then(()=>S()).catch(i=>{throw P=null,i})),P);return c.runFormatCommand=async i=>{if(K)return{status:"disposed",retry:!1};if(!S)return{status:"unsupported-host",code:"page-format-unsupported",retry:!1};let f=await je();return K?(f.dispose?.(),{status:"disposed",retry:!1}):f.run({apply:i})},c.destroy=()=>{K=!0,P&&P.then(i=>i?.dispose?.(),()=>{}),M.dispose(),O.dispose(),Oe()},c}export{Xe as PAGE_EDITOR_CSS,Ha as createPageEditor,ra as installPageFeature,T as lazyViewsKey,aa as lazyViewsPlugin,na as pagePlugins,ga as pageState,Va as refreshMountedView,qa as runPageCommand,$a as setEditorActive};
