import{a as v}from"./c-W6C2ZKRM.js";import"./c-YAIGE6V2.js";import"./c-72P6BIQH.js";import"./c-P7KNDG34.js";import"./c-CYWLPPUS.js";import"./c-N7JPUPGC.js";import"./c-HA6INT6J.js";import"./c-WRBKEJD4.js";import"./c-VHNSBD2M.js";var A=`.clay-upload {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--clay-upload-gap, 8px);
  padding: var(--clay-upload-padding, 8px 10px);
  font-family: var(--clay-upload-font, inherit);
  font-size: var(--clay-upload-font-size, 13px);
  line-height: var(--clay-upload-line-height, 1.4);
  color: var(--clay-upload-ink, #171A1F);
  text-align: left;
  background: var(--clay-upload-bg, transparent);
  border: var(--clay-upload-border-width, 0) solid var(--clay-upload-border, #D8D8DE);
  border-radius: var(--clay-upload-radius, 6px);
  box-sizing: border-box;
  max-width: 100%;
}
.clay-upload *, .clay-upload *::before, .clay-upload *::after { box-sizing: border-box; }
.clay-upload__name {
  flex: 1 1 8em;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: var(--clay-upload-name-weight, 500);
  color: var(--clay-upload-ink, #171A1F);
}
.clay-upload__progress {
  flex: 2 1 6em;
  width: auto;
  height: var(--clay-upload-progress-height, 6px);
  margin: 0;
  appearance: none;
  -webkit-appearance: none;
  border: 0;
  border-radius: calc(var(--clay-upload-progress-height, 6px) / 2);
  background: var(--clay-upload-track, rgba(23, 26, 31, .14));
  overflow: hidden;
}
.clay-upload__progress::-webkit-progress-bar { background: var(--clay-upload-track, rgba(23, 26, 31, .14)); }
.clay-upload__progress::-webkit-progress-value { background: var(--clay-upload-fill, #2F6FEB); }
.clay-upload__progress::-moz-progress-bar { background: var(--clay-upload-fill, #2F6FEB); }
.clay-upload__label {
  flex: 0 1 auto;
  font-variant-numeric: tabular-nums;
  color: var(--clay-upload-muted, #5C6069);
}
.clay-upload__status {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}
.clay-upload__actions { display: flex; flex: none; align-items: center; gap: var(--clay-upload-action-gap, 4px); }
.clay-upload__button {
  min-height: var(--clay-upload-button-height, 28px);
  padding: var(--clay-upload-button-padding, 4px 10px);
  font: inherit;
  font-weight: var(--clay-upload-button-weight, 500);
  color: var(--clay-upload-button-ink, #2F6FEB);
  background: var(--clay-upload-button-bg, transparent);
  border: 1px solid var(--clay-upload-button-border, transparent);
  border-radius: var(--clay-upload-button-radius, 4px);
  cursor: pointer;
  white-space: nowrap;
}
.clay-upload__button:hover { background: var(--clay-upload-button-bg-hover, rgba(47, 111, 235, .1)); }
.clay-upload__button:focus-visible { outline: 2px solid var(--clay-upload-fill, #2F6FEB); outline-offset: 2px; }
.clay-upload__button[hidden] { display: none; }
.clay-upload[data-clay-upload-state="failed"] .clay-upload__label { color: var(--clay-upload-failure-ink, #B3261E); }
@media (pointer: coarse) {
  .clay-upload__button { min-height: var(--clay-upload-button-height, 44px); }
}
@media (prefers-reduced-motion: reduce) {
  .clay-upload__progress { transition: none; }
}
@media (prefers-color-scheme: dark) {
  .clay-upload { color: var(--clay-upload-ink, #E9E9EC); border-color: var(--clay-upload-border, #3A3D45); }
  .clay-upload__name { color: var(--clay-upload-ink, #E9E9EC); }
  .clay-upload__label { color: var(--clay-upload-muted, #A2A6AE); }
  .clay-upload__progress { background: var(--clay-upload-track, rgba(233, 233, 236, .2)); }
  .clay-upload__progress::-webkit-progress-bar { background: var(--clay-upload-track, rgba(233, 233, 236, .2)); }
  .clay-upload__button { color: var(--clay-upload-button-ink, #8AB4FF); }
  .clay-upload[data-clay-upload-state="failed"] .clay-upload__label { color: var(--clay-upload-failure-ink, #FFB4AB); }
}
@media print { .clay-upload { display: none; } }`;function F(){if(document.getElementById("clay-upload-style"))return;let e=document.createElement("style");e.id="clay-upload-style",e.setAttribute("clay","editor-ui"),e.textContent=A,document.head.append(e)}function C({loaded:e,total:r,percent:n}){return typeof n=="number"?n:typeof r=="number"&&r>0?Math.round(e/r*100):null}function S(e,r){if(!e||typeof e.subscribe!="function")throw new TypeError("clay.upload.mount needs an upload task");let n=typeof r=="string"?document.querySelector(r):r;if(!n||n.nodeType!==1)throw new TypeError("clay.upload.mount needs a container");F();let d=e.file?.name||"File",a=document.createElement("div");a.className="clay-upload",a.setAttribute("clay","editor-ui"),a.setAttribute("data-clay-upload-state","uploading"),a.innerHTML='<span class="clay-upload__name"></span><progress class="clay-upload__progress"></progress><span class="clay-upload__label"></span><span class="clay-upload__status" role="status" aria-live="polite" aria-atomic="true"></span><span class="clay-upload__actions"><button type="button" class="clay-upload__button clay-upload__cancel">Cancel</button><button type="button" class="clay-upload__button clay-upload__retry" hidden>Retry</button><button type="button" class="clay-upload__button clay-upload__dismiss">Dismiss</button></span>';let h=a.querySelector(".clay-upload__name"),l=a.querySelector(".clay-upload__progress"),y=a.querySelector(".clay-upload__label"),x=a.querySelector(".clay-upload__status"),b=a.querySelector(".clay-upload__cancel"),u=a.querySelector(".clay-upload__retry"),w=a.querySelector(".clay-upload__dismiss");h.textContent=d,l.setAttribute("aria-label",`Upload progress for ${d}`);let _=null,c=null;function i(o){o!==_&&(_=o,x.textContent=o)}function E(o){let{state:t}=o,g=t==="uploading",p=C(o),m=g&&p!==null&&p>=100;if(a.setAttribute("data-clay-upload-state",t),g)l.hidden=!1,c=null,p===null?(l.removeAttribute("value"),l.removeAttribute("max"),y.textContent="Uploading"):(l.setAttribute("max","100"),l.setAttribute("value",String(p)),y.textContent=m?"Finishing upload":`${p}%`),i(m?`Finishing upload of ${d}`:`Uploading ${d}`);else{let s=o.result?.msg||(t==="succeeded"?"Uploaded":t==="cancelled"?"Upload cancelled":"Upload failed");t==="succeeded"?(l.setAttribute("max","100"),l.setAttribute("value","100")):(l.removeAttribute("value"),l.removeAttribute("max")),l.hidden=t!=="succeeded",y.textContent=s,t==="failed"?(c=s,i(s)):t==="cancelled"?(c=null,i("Upload cancelled")):i(s)}b.hidden=!g,u.hidden=!v(o),u.hidden||u.setAttribute("aria-label",c?`Retry ${d}: ${c}`:`Retry ${d}`)}function f(){k(),a.remove()}b.addEventListener("click",()=>{b.hidden||e.cancel()}),u.addEventListener("click",()=>{u.hidden||(u.hidden=!0,e.retry())}),w.addEventListener("click",()=>f());let k=e.subscribe(E);return n.append(a),{unmount:f}}var q=S;export{q as default,S as mount};
