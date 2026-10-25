import{b as D,c as $}from"./c-NUHP2XDB.js";import{f as j}from"./c-7VTQVAGP.js";import{a as p}from"./c-VKEDWYDF.js";import{b as O}from"./c-EHV7RYXM.js";import{c as K}from"./c-OTBOUTLE.js";import"./c-IJUK2GPW.js";import{b as R,d as P,e as E,f as u,g as d,h as c,i as o,j as h,l as k,n as N}from"./c-54NBR4CW.js";import"./c-P7KNDG34.js";import"./c-CYWLPPUS.js";import"./c-N7JPUPGC.js";import{j as C}from"./c-46H7C35J.js";import"./c-XQXZAO7N.js";import"./c-S7LK4KUE.js";import"./c-I7PZZ6CZ.js";import"./c-HA6INT6J.js";import"./c-DCFSEJZG.js";import"./c-WRBKEJD4.js";import{a as v}from"./c-VHNSBD2M.js";var S={};v(S,{activateInitialMode:()=>ae,canEdit:()=>d,default:()=>se,init:()=>T,isEditMode:()=>c,isOwner:()=>h,mode:()=>o,modeLifecycle:()=>re,setMode:()=>f,setPageTypeOnPageLoad:()=>_,setViewerPageTypeBeforeSave:()=>V,toggleEditMode:()=>z});var I=!1,re={register:N,canWrite:()=>k().phase==="idle"&&c,get state(){return Object.freeze(k())}},U=null;async function ae(){if(c)try{U||=await import("./c-5FJACVMA.js"),await U.activateInitial()}catch(e){console.error("clayjs: the mode lifecycle failed to start:",e)}}async function f(e){if(e!=="edit"&&e!=="view")throw new TypeError(`clay.setMode: unknown mode "${e}"`);if(e===o)return{ok:!0,mode:o,changed:!1};if(u||!d)return{ok:!1,mode:o,code:"not-allowed"};if(o==="edit"){let t;try{t=await window.clay?.save?.flush?.()}catch(r){return{ok:!1,mode:o,code:"save-failed",state:r?.state}}if(t&&t.state&&t.state!=="saved"&&t.state!=="clean")return{ok:!1,mode:o,code:"save-failed",state:t.state}}return I=!0,E({mode:e,canEdit:!0,internal:!0}),location.reload(),{ok:!0,mode:e,changed:!0,reloading:!0}}function ne(){let e=new URL(window.location.href);e.searchParams.set("editmode","true"),window.location.href=e.toString()}var z=()=>u?ne():f(o==="edit"?"view":"edit");function ie(){!d||u||window.addEventListener("pagehide",()=>{I||E({mode:o,canEdit:!0,internal:!1})})}function V(){C(e=>{e.setAttribute("editmode","false"),e.setAttribute("pageowner","false")})}function _(){p(()=>{document.documentElement.setAttribute("editmode",c?"true":"false"),document.documentElement.setAttribute("pageowner",h?"true":"false"),d?document.documentElement.setAttribute("canedit","true"):document.documentElement.removeAttribute("canedit"),u?document.documentElement.setAttribute("draftmode","true"):document.documentElement.removeAttribute("draftmode")})}function T(){V(),_(),ie()}T();var se={init:T,setMode:f,toggleEditMode:z,isEditMode:c,isOwner:h,canEdit:d,mode:o};var F={};var q=typeof navigator<"u"&&/Mac|iPhone|iPad/.test(navigator.platform||navigator.userAgent),de=q?"\u2318\u21E7E":"Ctrl+Shift+E",ce=`.clay-mode-note {
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
}`;function le(){if(document.getElementById("clay-mode-note-style"))return;let e=document.createElement("style");e.id="clay-mode-note-style",e.setAttribute("clay","editor-ui"),e.textContent=ce,document.head.append(e)}function ue(e){!(q?e.metaKey:e.ctrlKey)||!e.shiftKey||e.altKey||e.code!=="KeyE"||e.isComposing||(e.preventDefault(),f(o==="edit"?"view":"edit").then(t=>{!t.ok&&t.code==="save-failed"&&window.clay?.toast?.("Couldn't save, so this page stays in edit mode.","error")}))}function pe(){le();let e=document.createElement("div");e.setAttribute("clay","editor-ui"),e.setAttribute("role","status"),e.className="clay-mode-note",e.innerHTML=`<span>This page opens in view mode. Press <kbd>${de}</kbd> to edit.</span><button type="button" aria-label="Dismiss">\xD7</button>`;let t=()=>e.remove();e.querySelector("button").addEventListener("click",t),addEventListener("keydown",r=>{r.key==="Escape"&&t()},{once:!0}),setTimeout(t,12e3),document.body.append(e)}d&&!u&&(document.addEventListener("keydown",ue),p(()=>{o!=="view"||document.querySelector("[clay-mode-toggle]")||queueMicrotask(()=>{if(window.clay?.menu)return;let e=window.clay?.storage?.local;!e||e.get("mode-note")||(e.set("mode-note",!0),pe())})}));var A={};v(A,{whenShown:()=>ye});var me="This page can't be edited: the app serving it is out of date. Update HTML Clay to 1.9.0 or newer.",n=null,l=null;function g(){if(!n)return;let e=window.visualViewport,t=e?Math.max(0,window.innerHeight-e.height-e.offsetTop):0;D(n,"bottom",`calc(${16+t}px + env(safe-area-inset-bottom,0px))`)}function fe(){n&&(D(n,"display","none"),window.visualViewport?.removeEventListener("resize",g),window.visualViewport?.removeEventListener("scroll",g))}function ge(){n=l.bevelSurface("div",["position:fixed","left:50%","transform:translateX(-50%)","z-index:2147483001","display:flex","align-items:center","gap:10px 12px","width:max-content","max-width:calc(100vw - 24px)","flex-wrap:wrap","padding:8px 8px 8px 14px","text-align:left",`color-scheme:${l.pageScheme()}`]),n.setAttribute("clay",l.RUNTIME_ONLY),n.setAttribute("data-clay-stale-host",""),n.setAttribute("role","alert");let e=$("span",["all:initial","color-scheme:inherit","display:inline-block","flex:none","width:8px","height:8px","border-radius:50%",`background:${l.TOKENS.ox}`]);e.setAttribute("clay",l.RUNTIME_ONLY);let t=l.bevelButton("Dismiss",{small:!0,variant:"quiet",onClick:fe});t.setAttribute("aria-label","Dismiss this message"),n.append(e,l.bevelText("span",[],me),t),document.body.appendChild(n),g(),window.visualViewport?.addEventListener("resize",g),window.visualViewport?.addEventListener("scroll",g)}async function we(){if(!P()||c)return;let[e,t]=await Promise.all([import("./c-6HMB24EV.js"),import("./c-ZE46QDIH.js")]);l={...e,TOKENS:t.TOKENS},ge()}var B=Promise.resolve();p(()=>{B=we()});var ye=()=>B;var L={};v(L,{createPageDataApi:()=>G,readData:()=>ke,setPageDataLiveSync:()=>Te,writeData:()=>De});var he="data-read",be="data-write";function b(e,t,r){let a=new Error(t);return a.code=e,a.details=r,a}async function W(e){if(typeof e.json=="function")return e.json();let t=await e.text();return t?JSON.parse(t):null}async function xe(e){let t={};try{t=await W(e)||{}}catch{}let r=t.message||t.error||e.statusText||`Request failed (${e.status})`,a=new Error(r);return a.status=e.status,a.error=t.error,a.details=t.details,a}function ve(e){let t=e.headers?.get?.("ETag");return typeof t=="string"&&t?t:null}function Ee(e,t){let r=`${t.origin}${t.pathname}`;return e!==void 0?`${r}?data=${encodeURIComponent(JSON.stringify(e))}`:`${t.origin}/_/api${t.pathname}`}async function H(){let{isDraftMode:e}=await import("./core/is-edit-mode-Y3RDOOTU.js");return e?b("DataUnavailableInDraft","Page data is kept in this browser for this visitor."):null}function G({supports:e=K,token:t=R,fetchImpl:r=(...w)=>fetch(...w),getLocation:a=()=>window.location,eventTarget:J=document,loadWriteModules:Y,syncTimeoutMs:X,httpTimeoutMs:Q}={}){let w=null,m=null;function Z(i){w=i}async function ee(i){let y=await H();if(y)throw y;if(!await e(he))throw b("DataReadUnsupported","This host does not support reading page data.");let s;try{s=await r(Ee(i,a()),{method:"GET",credentials:"same-origin",cache:"no-store",redirect:"error"})}catch(x){throw Object.assign(b("DataReadFailed",x?.message||"Could not read page data."),{cause:x})}if(!s.ok)throw await xe(s);return{data:await W(s),etag:ve(s)}}function te(){return m||(m=import("./c-EGYAGUUQ.js").then(({createPageDataWrite:i})=>i({supports:e,token:t,fetchImpl:r,getLocation:a,eventTarget:J,getLiveSync:()=>w,loadWriteModules:Y,syncTimeoutMs:X,httpTimeoutMs:Q})).catch(i=>{throw m=null,i}),m)}async function oe(i,y){let s=await H();if(s)throw s;if(!await e(be))throw b("DataWriteUnsupported","This host does not support writing page data.");return(await te()).writeData(i,y)}return{readData:ee,writeData:oe,setLiveSync:Z}}var M=G(),ke=M.readData,De=M.writeData,Te=M.setLiveSync;var Ie={"lib/mutation.js":O,"core/preserve-authored.js":j,"core/edit-mode.js":S,"core/mode-key.js":F,"core/stale-host-notice.js":A,"core/page-data.js":L};export{Ie as core};
