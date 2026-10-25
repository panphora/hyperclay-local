import{b as W,c as X}from"./c-NUHP2XDB.js";import{a as S}from"./c-VKEDWYDF.js";import{b as Y}from"./c-EHV7RYXM.js";import{c as Q}from"./c-YAIGE6V2.js";import"./c-IJUK2GPW.js";import{b as B,d as J,e as N,f as h,g as f,h as k,i,j as R}from"./c-72P6BIQH.js";import"./c-P7KNDG34.js";import"./c-CYWLPPUS.js";import"./c-N7JPUPGC.js";import{j as G}from"./c-46H7C35J.js";import"./c-XQXZAO7N.js";import"./c-S7LK4KUE.js";import"./c-I7PZZ6CZ.js";import"./c-HA6INT6J.js";import"./c-DCFSEJZG.js";import"./c-WRBKEJD4.js";import{a as I}from"./c-VHNSBD2M.js";var j={};I(j,{canEdit:()=>f,default:()=>be,init:()=>F,isEditMode:()=>k,isOwner:()=>R,mode:()=>i,setMode:()=>M,setPageTypeOnPageLoad:()=>ae,setViewerPageTypeBeforeSave:()=>te,toggleEditMode:()=>ee});var Z=!1;async function M(e){if(e!=="edit"&&e!=="view")throw new TypeError(`clay.setMode: unknown mode "${e}"`);if(e===i)return{ok:!0,mode:i,changed:!1};if(h||!f)return{ok:!1,mode:i,code:"not-allowed"};if(i==="edit"){let t;try{t=await window.clay?.save?.flush?.()}catch(n){return{ok:!1,mode:i,code:"save-failed",state:n?.state}}if(t&&t.state&&t.state!=="saved"&&t.state!=="clean")return{ok:!1,mode:i,code:"save-failed",state:t.state}}return Z=!0,N({mode:e,canEdit:!0,internal:!0}),location.reload(),{ok:!0,mode:e,changed:!0,reloading:!0}}function ye(){let e=new URL(window.location.href);e.searchParams.set("editmode","true"),window.location.href=e.toString()}var ee=()=>h?ye():M(i==="edit"?"view":"edit");function ve(){!f||h||window.addEventListener("pagehide",()=>{Z||N({mode:i,canEdit:!0,internal:!1})})}function te(){G(e=>{e.setAttribute("editmode","false"),e.setAttribute("pageowner","false")})}function ae(){S(()=>{document.documentElement.setAttribute("editmode",k?"true":"false"),document.documentElement.setAttribute("pageowner",R?"true":"false"),f?document.documentElement.setAttribute("canedit","true"):document.documentElement.removeAttribute("canedit"),h?document.documentElement.setAttribute("draftmode","true"):document.documentElement.removeAttribute("draftmode")})}function F(){te(),ae(),ve()}F();var be={init:F,setMode:M,toggleEditMode:ee,isEditMode:k,isOwner:R,canEdit:f,mode:i};var oe={};var ne=typeof navigator<"u"&&/Mac|iPhone|iPad/.test(navigator.platform||navigator.userAgent),xe=ne?"\u2318\u21E7E":"Ctrl+Shift+E",Ee=`.clay-mode-note {
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
}`;function ke(){if(document.getElementById("clay-mode-note-style"))return;let e=document.createElement("style");e.id="clay-mode-note-style",e.setAttribute("clay","editor-ui"),e.textContent=Ee,document.head.append(e)}function Se(e){!(ne?e.metaKey:e.ctrlKey)||!e.shiftKey||e.altKey||e.code!=="KeyE"||e.isComposing||(e.preventDefault(),M(i==="edit"?"view":"edit").then(t=>{!t.ok&&t.code==="save-failed"&&window.clay?.toast?.("Couldn't save, so this page stays in edit mode.","error")}))}function Te(){ke();let e=document.createElement("div");e.setAttribute("clay","editor-ui"),e.setAttribute("role","status"),e.className="clay-mode-note",e.innerHTML=`<span>This page opens in view mode. Press <kbd>${xe}</kbd> to edit.</span><button type="button" aria-label="Dismiss">\xD7</button>`;let t=()=>e.remove();e.querySelector("button").addEventListener("click",t),addEventListener("keydown",n=>{n.key==="Escape"&&t()},{once:!0}),setTimeout(t,12e3),document.body.append(e)}f&&!h&&(document.addEventListener("keydown",Se),S(()=>{i!=="view"||document.querySelector("[clay-mode-toggle]")||queueMicrotask(()=>{if(window.clay?.menu)return;let e=window.clay?.storage?.local;!e||e.get("mode-note")||(e.set("mode-note",!0),Te())})}));var _={};I(_,{whenShown:()=>Me});var De="This page can't be edited: the app serving it is out of date. Update HTML Clay to 1.9.0 or newer.",p=null,w=null;function U(){if(!p)return;let e=window.visualViewport,t=e?Math.max(0,window.innerHeight-e.height-e.offsetTop):0;W(p,"bottom",`calc(${16+t}px + env(safe-area-inset-bottom,0px))`)}function Ae(){p&&(W(p,"display","none"),window.visualViewport?.removeEventListener("resize",U),window.visualViewport?.removeEventListener("scroll",U))}function Pe(){p=w.bevelSurface("div",["position:fixed","left:50%","transform:translateX(-50%)","z-index:2147483001","display:flex","align-items:center","gap:10px 12px","width:max-content","max-width:calc(100vw - 24px)","flex-wrap:wrap","padding:8px 8px 8px 14px","text-align:left",`color-scheme:${w.pageScheme()}`]),p.setAttribute("clay",w.RUNTIME_ONLY),p.setAttribute("data-clay-stale-host",""),p.setAttribute("role","alert");let e=X("span",["all:initial","color-scheme:inherit","display:inline-block","flex:none","width:8px","height:8px","border-radius:50%",`background:${w.TOKENS.ox}`]);e.setAttribute("clay",w.RUNTIME_ONLY);let t=w.bevelButton("Dismiss",{small:!0,variant:"quiet",onClick:Ae});t.setAttribute("aria-label","Dismiss this message"),p.append(e,w.bevelText("span",[],De),t),document.body.appendChild(p),U(),window.visualViewport?.addEventListener("resize",U),window.visualViewport?.addEventListener("scroll",U)}async function Oe(){if(!J()||k)return;let[e,t]=await Promise.all([import("./c-JE2NGRLB.js"),import("./c-ZE46QDIH.js")]);w={...e,TOKENS:t.TOKENS},Pe()}var re=Promise.resolve();S(()=>{re=Oe()});var Me=()=>re;var K={};I(K,{createPageDataApi:()=>pe,readData:()=>Fe,setPageDataLiveSync:()=>_e,writeData:()=>je});var Ue="data-read",Ce="data-write",ie="Waiting for the page data write to finish",Re=12e3,Le=3e4;function o(e,t,n){let a=new Error(t);return a.code=e,a.details=n,a}async function q(e){if(typeof e.json=="function")return e.json();let t=await e.text();return t?JSON.parse(t):null}async function se(e){let t={};try{t=await q(e)||{}}catch{}let n=t.message||t.error||e.statusText||`Request failed (${e.status})`,a=new Error(n);return a.status=e.status,a.error=t.error,a.details=t.details,a}function de(e){let t=e.headers?.get?.("ETag");return typeof t=="string"&&t?t:null}function ce(e,t){let n=`${t.origin}${t.pathname}`;return e!==void 0?`${n}?data=${encodeURIComponent(JSON.stringify(e))}`:`${t.origin}/_/api${t.pathname}`}function le(e){return!!e&&!e.isDestroyed&&e.sse?.readyState===1}function Ie(e,t){let n=[],a=null,c=null,l=null,T=r=>r?.source==="disk"&&(a===null||r.etag===a),L=r=>r?.source==="disk"&&(r.etag==null||a===null||r.etag===a),u=()=>{clearTimeout(l),e.removeEventListener("clay:sync-applied",y)},y=r=>{if(n.push(r.detail),!c||!L(r.detail))return;let v=c;c=null,u(),v(!0)};return e.addEventListener("clay:sync-applied",y),{waitFor(r){return a=r,n.some(T)?(u(),Promise.resolve(!0)):new Promise(v=>{c=v,l=setTimeout(()=>{c=null,u(),v(!1)},t)})},cancel:u}}function Ne(e){let t=new AbortController,n,a=new Promise((l,T)=>{n=T}),c=setTimeout(()=>{let l=new Error("The page data write timed out.");l.name="TimeoutError",t.abort(l),n(l)},e);return{signal:t.signal,waitFor(l){return Promise.race([l,a])},cancel(){clearTimeout(c)}}}async function We(){let[e,t,n,a,c]=await Promise.all([import("./core/save-BKKDTD25.js"),import("./core/save-core-VJ7M2DY6.js"),import("./c-NFECBNI5.js"),import("./core/unsaved-warning-VTDLSLLJ.js"),import("./core/is-edit-mode-RYNJSCCI.js")]);return{...e,...t,...n,...a,...c}}async function ue(){let{isDraftMode:e}=await import("./core/is-edit-mode-RYNJSCCI.js");return e?o("DataUnavailableInDraft","Page data is kept in this browser for this visitor."):null}function pe({supports:e=Q,token:t=B,fetchImpl:n=(...u)=>fetch(...u),getLocation:a=()=>window.location,eventTarget:c=document,loadWriteModules:l=We,syncTimeoutMs:T=Re,httpTimeoutMs:L=Le}={}){let u=null,y=!1,r=!1;function v(s){u=s}async function me(s){let m=await ue();if(m)throw m;if(!await e(Ue))throw o("DataReadUnsupported","This host does not support reading page data.");let g;try{g=await n(ce(s,a()),{method:"GET",credentials:"same-origin",cache:"no-store",redirect:"error"})}catch(D){throw Object.assign(o("DataReadFailed",D?.message||"Could not read page data."),{cause:D})}if(!g.ok)throw await se(g);return{data:await q(g),etag:de(g)}}function H(s,{checkHold:m=!0}={}){if(r)throw o("DataWriteOutcomeUnknown","A previous page data write has an unknown outcome. Reload before writing again.");if(y)throw o("DataWriteInProgress","Another page data write is already running.");if(s.isSaveInProgress())throw o("SaveInProgress","The page is already being saved.");if(s.saveFateIsUnknown())throw o("SaveOutcomeUnknown","The page's last save has an unknown outcome.");if(m&&(s.savesHeld()||s.isSaveConflicted()))throw o("SavesHeld","The page cannot write data while another save hold is active.");if(s.hasUnsavedChanges())throw o("UnsavedChanges","Save or discard the page's unsaved changes before writing data.");if(!le(u))throw o("SyncRequired","Page data writes require the sync plugin to be connected.")}async function fe(s){s.baselineSettled()||await new Promise(m=>c.addEventListener("clay:baseline-settled",m,{once:!0}))}async function we(s,{rules:m,ifMatch:g}={}){let D=await ue();if(D)throw D;if(!await e(Ce))throw o("DataWriteUnsupported","This host does not support writing page data.");let d=await l();if(!d.isEditMode)throw o("DataWriteUnavailable","Page data writes require an editable page.");await fe(d),H(d);let A=g;if(A==null&&(A=d.lastSeenEtag()||await d.seedEtag()),typeof A!="string"||A==="")throw o("DataWriteVersionRequired","Page data writes require a trustworthy document ETag.");H(d),y=!0,d.holdAllSaves(ie);let b=null;try{if(d.isSaveInProgress())throw o("SaveInProgress","The page is already being saved.");if(d.saveFateIsUnknown())throw o("SaveOutcomeUnknown","The page's last save has an unknown outcome.");if(d.isSaveConflicted())throw o("SavesHeld","The page cannot write data while another save hold is active.");if(d.hasUnsavedChanges())throw o("UnsavedChanges","Save or discard the page's unsaved changes before writing data.");if(!le(u))throw o("SyncRequired","Page data writes require the sync plugin to be connected.");let V={"Content-Type":"application/json","If-Match":A},z=t();z&&(V["Save-Token"]=z);let ge=JSON.stringify(s);b=Ie(c,T);let x=Ne(L),P;try{P=await x.waitFor(n(ce(m,a()),{method:"POST",credentials:"same-origin",redirect:"error",headers:V,body:ge,signal:x.signal}))}catch(O){throw x.cancel(),r=!0,Object.assign(o("DataWriteOutcomeUnknown","The page data write has an unknown outcome. Do not retry automatically."),{cause:O,unknownOutcome:!0})}let C;try{if(!P.ok)throw await x.waitFor(se(P));C=await x.waitFor(q(P))}catch(O){throw O?.status?O:(r=!0,Object.assign(o("DataWriteOutcomeUnknown","The page data was written, but its response could not be read."),{cause:O,unknownOutcome:!0}))}finally{x.cancel()}let E=de(P);if(E&&E===d.lastSeenEtag())return b.cancel(),b=null,{data:C,etag:E};let he=await b.waitFor(E);return b=null,he?{data:C,etag:E}:{data:C,etag:E,pageUpdatePending:!0,message:"Written, page update pending."}}finally{b?.cancel(),y=!1,d.releaseAllSaves({reason:ie})}}return{readData:me,writeData:we,setLiveSync:v}}var $=pe(),Fe=$.readData,je=$.writeData,_e=$.setLiveSync;var et={"lib/mutation.js":Y,"core/edit-mode.js":j,"core/mode-key.js":oe,"core/stale-host-notice.js":_,"core/page-data.js":K};export{et as core};
