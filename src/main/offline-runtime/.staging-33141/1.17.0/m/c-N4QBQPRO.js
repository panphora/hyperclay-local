import{a as h,b as u,c as w,d as g}from"./c-BTDI4Y23.js";import{b as y}from"./c-3O7OBDCM.js";import"./c-BPF2NSPV.js";import"./c-P7KNDG34.js";import"./c-CYWLPPUS.js";import"./c-N7JPUPGC.js";import"./c-HA6INT6J.js";import"./c-WRBKEJD4.js";import"./c-VHNSBD2M.js";var l={draft:"You're seeing a private draft, like a visitor.",draftAction:"Edit the original",edit:"You're editing the original. Visitors get these changes.",editAction:"Back to my draft",close:"Hide this note"},E=`.clay-owner {
  --hcp-ground: #FDF8F0;
  --hcp-surface: #FFFCF6;
  --hcp-sunk: #F4ECDF;
  --hcp-ink: #2B241B;
  --hcp-ink-2: #4A4033;
  --hcp-muted: #6B5942;
  --hcp-line: #E8DCC6;
  --hcp-line-2: #D8C8AF;
  --hcp-brass: #8F6310;
  --hcp-shadow: 0 1px 2px rgba(23, 28, 36, .06), 0 14px 34px -14px rgba(43, 36, 27, .32);
  --hcp-sans: "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
  --hcp-lift: 0px;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  .clay-owner {
    --hcp-surface: #11131E; --hcp-sunk: #1A1D2C;
    --hcp-ink: #ECEAF2; --hcp-ink-2: #C9CDE0; --hcp-muted: #8A90AB;
    --hcp-line: #262B42; --hcp-line-2: #353B52;
    --hcp-brass: #D9A445;
    --hcp-shadow: 0 1px 2px rgba(0, 0, 0, .4), 0 16px 38px -14px rgba(0, 0, 0, .7);
    color-scheme: dark;
  }
}
.clay-owner, .clay-owner *, .clay-owner *::before, .clay-owner *::after {
  box-sizing: border-box; margin: 0; padding: 0; border: 0;
  font: inherit; letter-spacing: normal; text-transform: none; text-shadow: none;
  line-height: inherit; color: inherit; background: none; float: none; max-width: none;
}
.clay-owner {
  position: fixed; left: 12px; bottom: calc(12px + var(--hcp-lift)); z-index: 2147482000;
  display: flex; align-items: center; gap: 10px;
  max-width: min(460px, calc(100vw - 24px));
  padding: 8px 8px 8px 12px;
  font-family: var(--hcp-sans); font-size: 13px; font-weight: 400; line-height: 1.45;
  color: var(--hcp-ink-2); text-align: left; background: var(--hcp-surface);
  border: 1px solid var(--hcp-line-2); border-left: 3px solid var(--hcp-brass);
  box-shadow: var(--hcp-shadow);
  -webkit-font-smoothing: antialiased;
}
.clay-owner__action {
  flex: none; min-height: 0; font-weight: 600; color: var(--hcp-brass); cursor: pointer;
  text-decoration: underline; text-underline-offset: 2px; text-decoration-color: var(--hcp-line-2);
  white-space: nowrap;
}
.clay-owner .clay-owner__action:hover { color: var(--hcp-ink); background: none; }
.clay-owner__x {
  flex: none; display: inline-flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; min-height: 0; font-size: 15px; color: var(--hcp-muted); cursor: pointer;
}
.clay-owner .clay-owner__x:hover { color: var(--hcp-ink); background: none; }
.clay-owner__action:focus-visible, .clay-owner__x:focus-visible { outline: 2px solid var(--hcp-brass); outline-offset: 2px; }

.clay-owner svg {
  display: block; flex: none; width: 1em; height: 1em; line-height: 1;
  fill: currentColor; stroke: none; stroke-width: 0; stroke-linecap: butt; stroke-linejoin: miter;
}
.clay-owner button, .clay-owner a { border-radius: 0; line-height: 1.45; }
@media (pointer: coarse) {
  .clay-owner__action, .clay-owner__x { min-height: 44px; }
  .clay-owner__x { width: 44px; }
}
@media (prefers-reduced-motion: reduce) { .clay-owner { transition: none; } }
@media (forced-colors: active) { .clay-owner { border: 1px solid CanvasText; } }
@media print { .clay-owner { display: none; } }
`;function C(){if(document.getElementById("clay-owner-style"))return;let o=document.createElement("style");o.id="clay-owner-style",o.setAttribute("clay","editor-ui"),o.textContent=E,document.head.appendChild(o)}function A(){if(document.getElementById("clay-owner"))return null;C();let o=y,e=document.createElement("div");e.id="clay-owner",e.className="clay-owner",e.setAttribute("clay","editor-ui"),e.setAttribute("sap-ignore",""),e.setAttribute("role","status");let s=document.createElement("span");s.className="clay-owner__lead",s.textContent=o?l.draft:l.edit;let c=document.createElement("button");c.type="button",c.className="clay-owner__action",c.textContent=o?l.draftAction:l.editAction,c.addEventListener("click",()=>{let n=window.clay&&window.clay.visitorDrafts;n&&(o?n.editOriginal():n.backToDraft())});let r=document.createElement("button");r.type="button",r.className="clay-owner__x",r.setAttribute("aria-label",l.close),r.textContent="\xD7",r.addEventListener("click",()=>{e.remove(),f(),b()}),e.append(s,c,r),document.body.appendChild(e);let a=document.createElement("style");a.id="clay-owner-vars",a.setAttribute("clay","editor-ui"),document.head.appendChild(a);let m="";function v(n){let i=`:root { --clay-owner-room: ${Math.ceil(e.getBoundingClientRect().height)+16}px; }`;a.textContent!==i&&(a.textContent=i),m!==i+n&&(m=i+n,u())}function b(){a.remove(),u()}let d=0;function t(){d||(d=requestAnimationFrame(()=>{d=0;let n=w(24,x=>e.contains(x)||x.closest("#hcp")),i=g(e.getBoundingClientRect()),p=i>=window.innerHeight/3;i&&!p&&(n=Math.max(n,i-4)),e.style.visibility=p?"hidden":"",e.style.setProperty("--hcp-lift",n+"px"),v(p?-1:n)}))}function f(){removeEventListener("scroll",t),removeEventListener("resize",t),document.removeEventListener(h,t),document.removeEventListener("transitionend",t,!0),document.removeEventListener("pointerup",t,!0),window.removeEventListener("hashchange",t)}return addEventListener("scroll",t,{passive:!0}),addEventListener("resize",t),document.addEventListener(h,t),document.addEventListener("transitionend",t,!0),document.addEventListener("pointerup",t,!0),window.addEventListener("hashchange",t),t(),e.liftOff=f,e}export{l as COPY,A as mountOwnerChip};
