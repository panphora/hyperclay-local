import{f as y}from"./c-54NBR4CW.js";var u="clay:bottom-ui-changed";function x(){document.dispatchEvent(new CustomEvent(u))}function g(t,e){let n=window.innerHeight,c=0,a=document.elementsFromPoint?document.elementsFromPoint(t,n-3):[];for(let l of a)for(let i=l;i&&i!==document.body&&i!==document.documentElement&&!e(i);i=i.parentElement){let p=getComputedStyle(i).position;if(p==="fixed"||p==="sticky"){let h=Math.ceil(n-i.getBoundingClientRect().top);h<n/3&&(c=Math.max(c,h));break}}return c}function v(t){let e=document.querySelector("#hcp:not([hidden])");if(!e)return 0;let n=e.getBoundingClientRect();return!n.width||!n.height||n.right<=t.left||n.left>=t.right?0:Math.ceil(window.innerHeight-n.top)}var d={draft:"You're seeing a private draft, like a visitor.",draftAction:"Edit the original",edit:"You're editing the original. Visitors get these changes.",editAction:"Back to my draft",close:"Hide this note"},E=`.clay-owner {
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
`;function C(){if(document.getElementById("clay-owner-style"))return;let t=document.createElement("style");t.id="clay-owner-style",t.setAttribute("clay","editor-ui"),t.textContent=E,document.head.appendChild(t)}function B(){if(document.getElementById("clay-owner"))return null;C();let t=y,e=document.createElement("div");e.id="clay-owner",e.className="clay-owner",e.setAttribute("clay","editor-ui"),e.setAttribute("sap-ignore",""),e.setAttribute("role","status");let n=document.createElement("span");n.className="clay-owner__lead",n.textContent=t?d.draft:d.edit;let c=document.createElement("button");c.type="button",c.className="clay-owner__action",c.textContent=t?d.draftAction:d.editAction,c.addEventListener("click",()=>{let r=window.clay&&window.clay.visitorDrafts;r&&(t?r.editOriginal():r.backToDraft())});let a=document.createElement("button");a.type="button",a.className="clay-owner__x",a.setAttribute("aria-label",d.close),a.textContent="\xD7",a.addEventListener("click",()=>{e.remove(),b(),h()}),e.append(n,c,a),document.body.appendChild(e);let l=document.createElement("style");l.id="clay-owner-vars",l.setAttribute("clay","editor-ui"),document.head.appendChild(l);let i="";function p(r){let s=`:root { --clay-owner-room: ${Math.ceil(e.getBoundingClientRect().height)+16}px; }`;l.textContent!==s&&(l.textContent=s),i!==s+r&&(i=s+r,x())}function h(){l.remove(),x()}let m=0;function o(){m||(m=requestAnimationFrame(()=>{m=0;let r=g(24,w=>e.contains(w)||w.closest("#hcp")),s=v(e.getBoundingClientRect()),f=s>=window.innerHeight/3;s&&!f&&(r=Math.max(r,s-4)),e.style.visibility=f?"hidden":"",e.style.setProperty("--hcp-lift",r+"px"),p(f?-1:r)}))}function b(){removeEventListener("scroll",o),removeEventListener("resize",o),document.removeEventListener(u,o),document.removeEventListener("transitionend",o,!0),document.removeEventListener("pointerup",o,!0),window.removeEventListener("hashchange",o)}return addEventListener("scroll",o,{passive:!0}),addEventListener("resize",o),document.addEventListener(u,o),document.addEventListener("transitionend",o,!0),document.addEventListener("pointerup",o,!0),window.addEventListener("hashchange",o),o(),e}export{x as a,g as b,d as c,B as d};
