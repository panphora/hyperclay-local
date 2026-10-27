import{b as S,c as q}from"./c-NUHP2XDB.js";import{g as U}from"./c-QIX5BJYN.js";import{a as f}from"./c-VKEDWYDF.js";import{b as K}from"./c-HT33EQRN.js";import{e as I}from"./c-AYVOREBE.js";import"./c-IJUK2GPW.js";import{b as O,d as $,e as k,f as u,g as a,i as c,j as o,k as b,m as D,r as j}from"./c-7O6AFR65.js";import"./c-P7KNDG34.js";import"./c-CYWLPPUS.js";import"./c-N7JPUPGC.js";import"./c-GHBCCVG4.js";import"./c-HA6INT6J.js";import"./c-DCFSEJZG.js";import"./c-WRBKEJD4.js";import{a as E}from"./c-VHNSBD2M.js";var R={};E(R,{activateInitialMode:()=>ce,canEdit:()=>a,default:()=>pe,init:()=>L,isEditMode:()=>c,isOwner:()=>b,mode:()=>o,modeLifecycle:()=>se,noteLiveSwitch:()=>de,setMode:()=>w,setPageTypeOnPageLoad:()=>V,toggleEditMode:()=>F});var M=!1,ie=e=>{if(typeof e?.id=="string"&&e.id.startsWith("clay:"))throw new TypeError(`clay.modeLifecycle: the id "${e.id}" is reserved`);return j(e)},se={register:ie,canWrite:()=>D().phase==="idle"&&c,get state(){return Object.freeze(D())}},T=null,_=()=>T||=import("./c-WWDBYXLK.js").catch(()=>T=null),A=null,de=e=>{A=e};async function ce(){if(c)try{await(await _()).activateInitial()}catch(e){console.error("clayjs: the mode lifecycle failed to start:",e)}}var m=null;async function w(e){if(e!=="edit"&&e!=="view")throw new TypeError(`clay.setMode: unknown mode "${e}"`);if(m)return m.target===e?m.promise:{ok:!1,mode:o,code:"busy"};if(e===o&&!T)return{ok:!0,mode:o,changed:!1};if(u)return{ok:!1,mode:o,code:"not-allowed"};let t=le(e);m={target:e,promise:t};try{return await t}finally{m?.promise===t&&(m=null)}}async function le(e){let t=typeof window<"u"?window.clay?._requestHostMode:void 0;if(typeof t=="function"&&e!==o){let r;try{r=await t(e)}catch{return{ok:!1,mode:o,code:"host-failed"}}if(r?.reason!=="host-unsupported")return r?.ok?(M=!0,{ok:!0,mode:e,changed:!0,reloading:!0}):{ok:!1,mode:o,code:r?.reason||"host-refused"}}return e==="edit"&&o!=="edit"?ue():!a&&!(e==="view"&&o==="edit")?{ok:!1,mode:o,code:"not-allowed"}:H(e)}async function ue(){let e=location.pathname,{checkHostPermission:t}=await import("./core/host-permission-XN3K2IW3.js"),r=await t({fresh:!0});return location.pathname!==e?{ok:!1,mode:o,code:"cancelled"}:r===!1?{ok:!1,mode:o,code:"permission-denied"}:a?H("edit"):{ok:!1,mode:o,code:"not-allowed"}}async function H(e){if(A){let t=await _(),r=t&&await t.switchMode(e,A);if(r)return r}if(e===o)return{ok:!0,mode:o,changed:!1};if(o==="edit"){let t;try{t=await window.clay?.save?.flush?.()}catch(r){return{ok:!1,mode:o,code:"save-failed",state:r?.state}}if(t&&t.state&&t.state!=="saved"&&t.state!=="clean")return{ok:!1,mode:o,code:"save-failed",state:t.state}}return M=!0,k({mode:e,canEdit:a,internal:!0}),location.reload(),{ok:!0,mode:e,changed:!0,reloading:!0}}function fe(){let e=new URL(window.location.href);e.searchParams.set("editmode","true"),window.location.href=e.toString()}var F=()=>u?fe():w(o==="edit"?"view":"edit");function me(){!a||u||window.addEventListener("pagehide",()=>{M||k({mode:o,canEdit:a,internal:!1})})}function z(){a?document.documentElement.setAttribute("canedit","true"):document.documentElement.removeAttribute("canedit")}function V(){f(()=>{document.documentElement.setAttribute("editmode",c?"true":"false"),document.documentElement.setAttribute("pageowner",b?"true":"false"),z(),document.addEventListener("clay:capabilitychange",z),u?document.documentElement.setAttribute("draftmode","true"):document.documentElement.removeAttribute("draftmode")})}function L(){V(),me()}L();var pe={init:L,setMode:w,toggleEditMode:F,isEditMode:c,isOwner:b,canEdit:a,mode:o};var B={};var W=typeof navigator<"u"&&/Mac|iPhone|iPad/.test(navigator.platform||navigator.userAgent),we=W?"\u2318\u21E7E":"Ctrl+Shift+E",he=`.clay-mode-note {
  position: fixed;
  right: calc(16px + env(safe-area-inset-right, 0px));
  bottom: calc(16px + env(safe-area-inset-bottom, 0px));
  z-index: 2147482000;
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: min(420px, calc(100vw - 32px));
  padding: 10px 10px 10px 14px;
  border: 1px solid rgba(23, 28, 36, .16);
  border-radius: 12px;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  font-size: 13px;
  line-height: 1.45;
  text-align: left;
  color: var(--clay-ui-fg, #1F2328);
  background: var(--clay-ui-bg, #F4F4F5);
  box-shadow: 0 8px 24px -12px rgba(23, 28, 36, .45);
  transition: opacity .25s ease, transform .25s ease;
}
.clay-mode-note kbd {
  font: inherit;
  font-weight: 600;
  padding: 1px 5px;
  border: 1px solid rgba(23, 28, 36, .2);
  border-radius: 5px;
  background: rgba(23, 28, 36, .07);
}
.clay-mode-note button {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  font: inherit;
  font-size: 16px;
  line-height: 1;
  color: inherit;
  background: none;
  cursor: pointer;
  opacity: .65;
}
.clay-mode-note button:hover { opacity: 1; background: rgba(23, 28, 36, .08); }
@media (prefers-color-scheme: dark) {
  .clay-mode-note {
    border-color: rgba(233, 233, 236, .16);
    color: var(--clay-ui-fg, #E9E9EC);
    background: var(--clay-ui-bg, #26282C);
    box-shadow: 0 8px 24px -12px rgba(0, 0, 0, .7);
  }
  .clay-mode-note kbd { border-color: rgba(233, 233, 236, .22); background: rgba(233, 233, 236, .1); }
  .clay-mode-note button:hover { background: rgba(233, 233, 236, .12); }
}
@media (prefers-reduced-motion: reduce) {
  .clay-mode-note { transition: none; }
}
@media (max-width: 559px) {
  .clay-mode-note {
    left: calc(16px + env(safe-area-inset-left, 0px));
    right: calc(16px + env(safe-area-inset-right, 0px));
    max-width: none;
  }
}`;function ge(){if(document.getElementById("clay-mode-note-style"))return;let e=document.createElement("style");e.id="clay-mode-note-style",e.setAttribute("clay","editor-ui"),e.textContent=he,document.head.append(e)}function ye(e){(a||o==="edit")&&(!(W?e.metaKey:e.ctrlKey)||!e.shiftKey||e.altKey||e.code!=="KeyE"||e.isComposing||(e.preventDefault(),w(o==="edit"?"view":"edit").then(t=>{t.ok||import("./c-QHIWXHRO.js").then(({modeRefusalText:r})=>{let n=r(t);n&&window.clay?.toast?.(n,"error")})})))}function be(){ge();let e=document.createElement("div");e.setAttribute("clay","editor-ui"),e.setAttribute("role","status"),e.className="clay-mode-note",e.innerHTML=`<span>This page opens in view mode. Press <kbd>${we}</kbd> to edit.</span><button type="button" aria-label="Dismiss">\xD7</button>`;let t=()=>e.remove();e.querySelector("button").addEventListener("click",t),addEventListener("keydown",r=>{r.key==="Escape"&&t()},{once:!0}),setTimeout(t,12e3),document.body.append(e)}u||(document.addEventListener("keydown",ye),f(()=>{!a||o!=="view"||document.querySelector("[clay-mode-toggle]")||queueMicrotask(()=>{if(window.clay?.menu)return;let e=window.clay?.storage?.local;!e||e.get("mode-note")||(e.set("mode-note",!0),be())})}));var P={};E(P,{whenShown:()=>De});var ve="This page can't be edited: the app serving it is out of date. Update HTML Clay to 1.9.0 or newer.",i=null,l=null;function h(){if(!i)return;let e=window.visualViewport,t=e?Math.max(0,window.innerHeight-e.height-e.offsetTop):0;S(i,"bottom",`calc(${16+t}px + env(safe-area-inset-bottom,0px))`)}function xe(){i&&(S(i,"display","none"),window.visualViewport?.removeEventListener("resize",h),window.visualViewport?.removeEventListener("scroll",h))}function Ee(){i=l.bevelSurface("div",["position:fixed","left:50%","transform:translateX(-50%)","z-index:2147483001","display:flex","align-items:center","gap:10px 12px","width:max-content","max-width:calc(100vw - 24px)","flex-wrap:wrap","padding:8px 8px 8px 14px","text-align:left",`color-scheme:${l.pageScheme()}`]),i.setAttribute("clay",l.RUNTIME_ONLY),i.setAttribute("data-clay-stale-host",""),i.setAttribute("role","alert");let e=q("span",["all:initial","color-scheme:inherit","display:inline-block","flex:none","width:8px","height:8px","border-radius:50%",`background:${l.TOKENS.ox}`]);e.setAttribute("clay",l.RUNTIME_ONLY);let t=l.bevelButton("Dismiss",{small:!0,variant:"quiet",onClick:xe});t.setAttribute("aria-label","Dismiss this message"),i.append(e,l.bevelText("span",[],ve),t),document.body.appendChild(i),h(),window.visualViewport?.addEventListener("resize",h),window.visualViewport?.addEventListener("scroll",h)}async function ke(){if(!$()||c)return;let[e,t]=await Promise.all([import("./c-6HMB24EV.js"),import("./c-ZE46QDIH.js")]);l={...e,TOKENS:t.TOKENS},Ee()}var G=Promise.resolve();f(()=>{G=ke()});var De=()=>G;var N={};E(N,{createPageDataApi:()=>X,readData:()=>Re,setPageDataLiveSync:()=>Ce,writeData:()=>Pe});var Se="data-read",Te="data-write";function v(e,t,r){let n=new Error(t);return n.code=e,n.details=r,n}async function Y(e){if(typeof e.json=="function")return e.json();let t=await e.text();return t?JSON.parse(t):null}async function Ae(e){let t={};try{t=await Y(e)||{}}catch{}let r=t.message||t.error||e.statusText||`Request failed (${e.status})`,n=new Error(r);return n.status=e.status,n.error=t.error,n.details=t.details,n}function Me(e){let t=e.headers?.get?.("ETag");return typeof t=="string"&&t?t:null}function Le(e,t){let r=`${t.origin}${t.pathname}`;return e!==void 0?`${r}?data=${encodeURIComponent(JSON.stringify(e))}`:`${t.origin}/_/api${t.pathname}`}async function J(){let{isDraftMode:e}=await import("./core/is-edit-mode-JXHDVGUL.js");return e?v("DataUnavailableInDraft","Page data is kept in this browser for this visitor."):null}function X({supports:e=I,token:t=O,fetchImpl:r=(...g)=>fetch(...g),getLocation:n=()=>window.location,eventTarget:Q=document,loadWriteModules:Z,syncTimeoutMs:ee,httpTimeoutMs:te}={}){let g=null,p=null;function oe(s){g=s}async function re(s){let y=await J();if(y)throw y;if(!await e(Se))throw v("DataReadUnsupported","This host does not support reading page data.");let d;try{d=await r(Le(s,n()),{method:"GET",credentials:"same-origin",cache:"no-store",redirect:"error"})}catch(x){throw Object.assign(v("DataReadFailed",x?.message||"Could not read page data."),{cause:x})}if(!d.ok)throw await Ae(d);return{data:await Y(d),etag:Me(d)}}function ne(){return p||(p=import("./c-NZMNXVF6.js").then(({createPageDataWrite:s})=>s({supports:e,token:t,fetchImpl:r,getLocation:n,eventTarget:Q,getLiveSync:()=>g,loadWriteModules:Z,syncTimeoutMs:ee,httpTimeoutMs:te})).catch(s=>{throw p=null,s}),p)}async function ae(s,y){let d=await J();if(d)throw d;if(!await e(Te))throw v("DataWriteUnsupported","This host does not support writing page data.");return(await ne()).writeData(s,y)}return{readData:re,writeData:ae,setLiveSync:oe}}var C=X(),Re=C.readData,Pe=C.writeData,Ce=C.setLiveSync;var Ve={"lib/mutation.js":K,"core/preserve-authored.js":U,"core/edit-mode.js":R,"core/mode-key.js":B,"core/stale-host-notice.js":P,"core/page-data.js":N};export{Ve as core};
