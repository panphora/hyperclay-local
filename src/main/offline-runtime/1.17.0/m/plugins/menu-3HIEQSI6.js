import{a as q}from"../c-AQLFEATB.js";import{a as R}from"../c-VKEDWYDF.js";import{b as x,c as O,e as L,f as z}from"../c-OW5QIGG3.js";import"../c-BPF2NSPV.js";import"../c-P7KNDG34.js";import"../c-CYWLPPUS.js";import"../c-N7JPUPGC.js";import"../c-HA6INT6J.js";import"../c-WRBKEJD4.js";import"../c-VHNSBD2M.js";var B='<svg xmlns="http://www.w3.org/2000/svg" viewBox="-45.87 -57.96 100.26 60.98" fill="currentColor" aria-hidden="true" focusable="false"><path fill-rule="evenodd" d="M44.35 -4.56Q40.03 -0.52 34.69 -0.39Q29.34 -0.25 24.81 -0.14Q20.27 -0.02 15.6 0Q10.93 0.02 6.41 0Q1.89 -0.02 -2.79 -0.02Q-7.48 -0.02 -12.11 -0.14Q-16.73 -0.25 -21.64 -0.27Q-26.55 -0.3 -31.72 -2.25Q-36.88 -4.2 -39.87 -9.12Q-42.87 -14.03 -42.8 -19.61Q-42.74 -25.18 -40.43 -29.94Q-38.12 -34.69 -34.82 -38.78Q-31.52 -42.87 -27.25 -45.6Q-22.98 -48.33 -18.35 -50.59Q-13.73 -52.85 -8.7 -53.88Q-3.68 -54.91 1.32 -54.93Q6.32 -54.96 11.44 -54.56Q16.55 -54.16 21.35 -52.2Q26.16 -50.24 30.69 -48.01Q35.22 -45.78 38.99 -42.18Q42.76 -38.59 45.67 -34.37Q48.59 -30.15 49.99 -24.87Q51.39 -19.59 50.04 -14.09Q48.68 -8.6 44.35 -4.56ZM0.66 -30.49C0.5 -28.73 -0.88 -27.42 -2.42 -27.57C-3.96 -27.71 -5.08 -29.25 -4.91 -31.01C-4.75 -32.77 -3.36 -34.08 -1.83 -33.94C-0.29 -33.79 0.83 -32.25 0.66 -30.49ZM13.61 -29.28C13.44 -27.52 12.06 -26.21 10.52 -26.35C8.98 -26.5 7.87 -28.04 8.03 -29.8C8.2 -31.56 9.58 -32.87 11.12 -32.73C12.66 -32.58 13.77 -31.04 13.61 -29.28ZM-1.23 -17.71Q-0.62 -17.35 -0.03 -17.08Q0.56 -16.81 1.15 -16.54Q1.73 -16.28 2.4 -16Q3.07 -15.72 3.87 -15.6Q4.66 -15.48 5.4 -15.55Q6.13 -15.62 6.77 -15.79Q7.41 -15.96 7.97 -16.23Q8.53 -16.5 9 -16.91Q9.46 -17.32 9.73 -17.9Q9.99 -18.47 10.08 -19.12Q10.17 -19.77 10.08 -20.42Q9.99 -21.06 9.45 -21.32Q8.91 -21.58 8.27 -21.38Q7.63 -21.17 6.99 -20.91Q6.36 -20.65 5.7 -20.61Q5.04 -20.56 4.33 -20.73Q3.62 -20.9 2.92 -21.14Q2.23 -21.39 1.54 -21.68Q0.85 -21.97 0.16 -22.27Q-0.52 -22.56 -1.22 -22.79Q-1.92 -23.03 -2.49 -22.61Q-3.05 -22.19 -3.23 -21.5Q-3.4 -20.81 -3.2 -20.09Q-3.01 -19.38 -3.02 -19.15Q-3.02 -18.93 -2.42 -18.5Q-1.83 -18.06 -1.23 -17.71Z"/></svg>';var _=!0,$=6e3,U=12,G=`.clay-menu {
  position: fixed;
  top: max(12px, env(safe-area-inset-top));
  right: max(12px, env(safe-area-inset-right));
  z-index: 2147482000;
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: 8px;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  font-size: 13px;
  line-height: 1;
  color: var(--clay-ui-fg, #1F2328);
}
.clay-menu-edit {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  padding: 0;
  border: 0;
  font: inherit;
  color: inherit;
  background: none;
  cursor: pointer;
}
.clay-menu-edit:disabled { cursor: progress; opacity: .7; }
.clay-menu-track {
  position: relative;
  display: block;
  box-sizing: border-box;
  width: 52px;
  height: 32px;
  border: 1px solid rgba(23, 28, 36, .16);
  border-radius: 999px;
  background: var(--clay-ui-bg, #F4F4F5);
  transition: background-color .15s ease, border-color .15s ease;
}
.clay-menu-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: #FAFAFB;
  box-shadow: 0 1px 2px rgba(23, 28, 36, .35);
  transition: transform .15s ease;
}
.clay-menu-edit[aria-checked="true"] .clay-menu-track {
  border-color: transparent;
  background: var(--clay-ui-accent, #2F6FEB);
}
.clay-menu-edit[aria-checked="true"] .clay-menu-thumb { transform: translateX(20px); }
.clay-menu-label { font-size: 13px; line-height: 1; }
.clay-menu-goo {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  width: 32px;
  height: 32px;
  margin: 0;
  padding: 0;
  border: 1px solid rgba(23, 28, 36, .16);
  border-radius: 50%;
  color: inherit;
  background: var(--clay-ui-bg, #F4F4F5);
  cursor: pointer;
}
.clay-menu-goo svg { display: block; width: 18px; height: auto; }
.clay-menu-dot {
  position: absolute;
  top: 1px;
  right: 1px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--clay-ui-accent, #2F6FEB);
}
.clay-menu-list {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  min-width: 184px;
  margin: 0;
  padding: 4px;
  border: 1px solid rgba(23, 28, 36, .16);
  border-radius: 10px;
  background: var(--clay-ui-bg, #F4F4F5);
  box-shadow: 0 10px 28px -14px rgba(23, 28, 36, .5);
}
.clay-menu-list button {
  display: block;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  border-radius: 6px;
  font: inherit;
  text-align: left;
  color: inherit;
  background: none;
  cursor: pointer;
}
.clay-menu-list button:hover,
.clay-menu-list button:focus-visible { outline: none; background: rgba(23, 28, 36, .08); }
.clay-menu-note {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  max-width: 260px;
  padding: 8px 10px;
  border: 1px solid rgba(23, 28, 36, .16);
  border-radius: 8px;
  line-height: 1.4;
  text-align: left;
  background: var(--clay-ui-bg, #F4F4F5);
  box-shadow: 0 10px 28px -14px rgba(23, 28, 36, .5);
}
@media (pointer: coarse) {
  .clay-menu-edit { min-height: 44px; padding: 6px 0; }
  .clay-menu-goo { width: 44px; height: 44px; }
}
@media (prefers-color-scheme: dark) {
  .clay-menu { color: var(--clay-ui-fg, #E9E9EC); }
  .clay-menu-track,
  .clay-menu-goo,
  .clay-menu-list,
  .clay-menu-note { border-color: rgba(233, 233, 236, .16); background: var(--clay-ui-bg, #26282C); }
  .clay-menu-track { background: rgba(233, 233, 236, .22); }
  .clay-menu-thumb { background: #E9E9EC; }
  .clay-menu-list button:hover,
  .clay-menu-list button:focus-visible { background: rgba(233, 233, 236, .12); }
}
@media (prefers-reduced-motion: reduce) {
  .clay-menu-track, .clay-menu-thumb { transition: none; }
}`,D=()=>window.clay&&typeof window.clay.mode=="string"?window.clay.mode:z;function P(){if(document.getElementById("clay-menu-style"))return;let t=document.createElement("style");t.id="clay-menu-style",t.setAttribute("clay","editor-ui"),t.textContent=G,document.head.append(t)}function j(){if(document.querySelector(".clay-menu"))return;P();let t=document.createElement("div");t.className="clay-menu",t.setAttribute("clay","editor-ui"),t.setAttribute("clay-mode-toggle",""),t.innerHTML=`<button type="button" class="clay-menu-edit" role="switch" aria-checked="false"><span class="clay-menu-track" aria-hidden="true"><span class="clay-menu-thumb"></span></span><span class="clay-menu-label">Edit</span></button><button type="button" class="clay-menu-goo" aria-haspopup="menu" aria-expanded="false" aria-label="Clay menu">${B}</button><div class="clay-menu-list" role="menu" hidden></div><div class="clay-menu-note" role="status" hidden></div>`;let a=t.querySelector(".clay-menu-edit"),l=t.querySelector(".clay-menu-goo"),i=t.querySelector(".clay-menu-list"),p=t.querySelector(".clay-menu-note"),b=new Map,c=()=>!i.hidden;function w(e){i.hidden=!e,l.setAttribute("aria-expanded",e?"true":"false")}let Q=()=>[...i.querySelectorAll('[role="menuitem"]')];function m(e){let r=Q();r.length&&r[(e+r.length)%r.length].focus()}function s(){c()&&w(!1)}function f(){c()||w(!0)}function N(){let e=i.contains(document.activeElement);i.textContent="";for(let o of b.values()){let u=document.createElement("button");u.type="button",u.setAttribute("role","menuitem"),u.dataset.menuId=o.id,u.textContent=o.label,u.addEventListener("click",()=>{s(),o.run&&o.run()}),i.append(u)}let r=l.querySelector(".clay-menu-dot"),n=[...b.values()].some(o=>o.badge);if(n&&!r){let o=document.createElement("span");o.className="clay-menu-dot",l.append(o)}else!n&&r&&r.remove();e&&m(0)}function v({id:e,label:r,run:n,badge:o}={}){return e?(b.set(e,{id:e,label:String(r??""),run:typeof n=="function"?n:null,badge:!!o}),N(),e):null}function Z(e){e&&(p.textContent=e,p.hidden=!1,clearTimeout(k),k=setTimeout(()=>{p.hidden=!0,p.textContent=""},$))}let k=0,g=!1;function h(){a.setAttribute("aria-checked",D()==="edit"?"true":"false")}h(),document.addEventListener("clay:modechange",h),a.addEventListener("click",async()=>{if(g)return;let e=a.getAttribute("aria-checked"),r=D()==="edit"?"view":"edit";g=!0,a.setAttribute("aria-busy","true"),a.disabled=!0;let n;try{n=await window.clay?.setMode?.(r)}catch(o){n={ok:!1,message:o&&o.message}}if(!(n&&n.reloading))if(g=!1,a.removeAttribute("aria-busy"),a.disabled=!1,n&&n.ok===!1){a.setAttribute("aria-checked",e);let o=q(n);o&&Z(o)}else h()}),l.addEventListener("click",()=>{c()?s():f()}),document.addEventListener("click",e=>{c()&&!t.contains(e.target)&&s()}),t.addEventListener("keydown",e=>{if(e.key==="Escape"){if(!c())return;e.preventDefault(),s(),l.focus();return}if(e.target===l&&(e.key==="Enter"||e.key===" ")){e.preventDefault(),c()?s():(f(),m(0));return}if(!c())return;if(e.key==="Enter"&&i.contains(e.target)){e.preventDefault(),e.target.click();return}let r=Q();if(!r.length)return;let n=r.indexOf(document.activeElement);e.key==="ArrowDown"?(e.preventDefault(),m(n<0?0:n+1)):e.key==="ArrowUp"&&(e.preventDefault(),m(n<0?r.length-1:n-1))});let E=document,d=null,C=null;function F(e){t.style.top=`${Math.round(e.getBoundingClientRect().bottom)+U}px`}function M(){if(!t.isConnected)return;let e=E.querySelector(".clay-intro");if(e!==C){if(d&&(d.disconnect(),d=null),C=e,!e){t.style.removeProperty("top");return}typeof ResizeObserver=="function"&&(d=new ResizeObserver(()=>F(e)),d.observe(e)),F(e)}}let y=document.createElement("style");y.id="clay-menu-vars",y.setAttribute("clay","editor-ui"),document.head.append(y);function A(){let e=t.getBoundingClientRect();y.textContent=`:root { --clay-menu-width: ${Math.ceil(e.width)}px; --clay-menu-height: ${Math.ceil(e.height)}px; }`}document.body.append(t),A(),typeof ResizeObserver=="function"&&new ResizeObserver(A).observe(t),new MutationObserver(M).observe(E.body,{childList:!0}),M();let S=()=>import("../c-SMGU7RT3.js").then(e=>e.open());if(_){v({id:"seo",label:"SEO settings\u2026",run:S});let e=window.clay.storage&&window.clay.storage.session;e&&e.get("reopen-seo")===!0&&(e.remove("reopen-seo"),S().catch(()=>{}))}window.clay.menu={addItem:v,open:f,close:s}}var I=!1,H=()=>(O||L)&&!x;function T(){I||!H()||(I=!0,j())}x||(R(T),document.addEventListener("clay:capabilitychange",T));
