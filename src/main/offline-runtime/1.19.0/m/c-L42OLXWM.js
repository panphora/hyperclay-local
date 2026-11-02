import{b as x}from"./c-L7JL5TL3.js";import{a as w}from"./c-5B4YBZXC.js";import"./c-I2SCCUEW.js";import"./c-XGH4GS2T.js";import"./c-3O7OBDCM.js";import"./c-BPF2NSPV.js";import"./c-P7KNDG34.js";import"./c-CYWLPPUS.js";import"./c-N7JPUPGC.js";import"./c-HA6INT6J.js";import"./c-DCFSEJZG.js";import"./c-WRBKEJD4.js";import"./c-VHNSBD2M.js";var S=`.clay-upload {
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
@media print { .clay-upload { display: none; } }
:host { font-family: inherit !important; }`;function C({loaded:l,total:r,percent:n}){return typeof n=="number"?n:typeof r=="number"&&r>0?Math.round(l/r*100):null}function q(l,r){if(!l||typeof l.subscribe!="function")throw new TypeError("clay.upload.mount needs an upload task");let n=typeof r=="string"?document.querySelector(r):r;if(!n||n.nodeType!==1)throw new TypeError("clay.upload.mount needs a container");let d=l.file?.name||"File",a=document.createElement("div");a.className="clay-upload",a.setAttribute("clay","editor-ui"),a.setAttribute("data-clay-upload-state","uploading"),a.innerHTML='<span class="clay-upload__name"></span><progress class="clay-upload__progress"></progress><span class="clay-upload__label"></span><span class="clay-upload__status" role="status" aria-live="polite" aria-atomic="true"></span><span class="clay-upload__actions"><button type="button" class="clay-upload__button clay-upload__cancel">Cancel</button><button type="button" class="clay-upload__button clay-upload__retry" hidden>Retry</button><button type="button" class="clay-upload__button clay-upload__dismiss">Dismiss</button></span>';let E=a.querySelector(".clay-upload__name"),e=a.querySelector(".clay-upload__progress"),b=a.querySelector(".clay-upload__label"),k=a.querySelector(".clay-upload__status"),g=a.querySelector(".clay-upload__cancel"),u=a.querySelector(".clay-upload__retry"),_=a.querySelector(".clay-upload__dismiss");E.textContent=d,e.setAttribute("aria-label",`Upload progress for ${d}`);let f=null,c=null;function p(o){o!==f&&(f=o,k.textContent=o)}function A(o){let{state:t}=o,s=t==="uploading",i=C(o),h=s&&i!==null&&i>=100;if(a.setAttribute("data-clay-upload-state",t),s)e.hidden=!1,c=null,i===null?(e.removeAttribute("value"),e.removeAttribute("max"),b.textContent="Uploading"):(e.setAttribute("max","100"),e.setAttribute("value",String(i)),b.textContent=h?"Finishing upload":`${i}%`),p(h?`Finishing upload of ${d}`:`Uploading ${d}`);else{let y=o.result?.msg||(t==="succeeded"?"Uploaded":t==="cancelled"?"Upload cancelled":"Upload failed");t==="succeeded"?(e.setAttribute("max","100"),e.setAttribute("value","100")):(e.removeAttribute("value"),e.removeAttribute("max")),e.hidden=t!=="succeeded",b.textContent=y,t==="failed"?(c=y,p(y)):t==="cancelled"?(c=null,p("Upload cancelled")):p(y)}g.hidden=!s,_.hidden=s,u.hidden=!w(o),u.hidden||u.setAttribute("aria-label",c?`Retry ${d}: ${c}`:`Retry ${d}`)}let m=null;function v(){F(),m?.remove()}g.addEventListener("click",()=>{g.hidden||l.cancel()}),u.addEventListener("click",()=>{u.hidden||(u.hidden=!0,l.retry())}),_.addEventListener("click",()=>{_.hidden||v()});let F=l.subscribe(A);return m=x({name:"upload",content:a,css:[S],parent:n}),{unmount:v}}var $=q;export{$ as default,q as mount};
