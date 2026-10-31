import{b as D,c as W}from"./c-NUHP2XDB.js";import{g as z}from"./c-Q26MME6N.js";import{a as m}from"./c-VKEDWYDF.js";import{b as F}from"./c-ZWIOJGMT.js";import{e as H}from"./c-XGH4GS2T.js";import"./c-IJUK2GPW.js";import{a as S,b as f,c as r,f as u,g as n,h as b,j as T,o as q}from"./c-3O7OBDCM.js";import{c as j,e as $}from"./c-BPF2NSPV.js";import"./c-P7KNDG34.js";import"./c-CYWLPPUS.js";import"./c-N7JPUPGC.js";import"./c-VG5XIN4T.js";import"./c-2YYDMLNZ.js";import"./c-HA6INT6J.js";import{d as U,s as V}from"./c-DCFSEJZG.js";import"./c-WRBKEJD4.js";import{a as k}from"./c-VHNSBD2M.js";var C={};k(C,{activateInitialMode:()=>Ee,canEdit:()=>r,default:()=>Le,init:()=>N,isEditMode:()=>u,isOwner:()=>b,mode:()=>n,modeLifecycle:()=>be,noteLiveSwitch:()=>xe,setMode:()=>y,setPageTypeOnPageLoad:()=>X,toggleEditMode:()=>Y});var A=!1,ve=e=>{if(typeof e?.id=="string"&&e.id.startsWith("clay:"))throw new TypeError(`clay.modeLifecycle: the id "${e.id}" is reserved`);return q(e)},be={register:ve,canWrite:()=>T().phase==="idle"&&u,get state(){return Object.freeze(T())}},L=null,G=()=>L||=import("./c-BUAYFEV5.js").catch(()=>L=null),M=null,xe=e=>{M=e};async function Ee(){if(u)try{await(await G()).activateInitial()}catch(e){console.error("clayjs: the mode lifecycle failed to start:",e)}}var p=null;async function y(e){if(e!=="edit"&&e!=="view")throw new TypeError(`clay.setMode: unknown mode "${e}"`);if(p)return p.target===e?p.promise:{ok:!1,mode:n,code:"busy"};if(e===n&&!L)return{ok:!0,mode:n,changed:!1};if(f)return{ok:!1,mode:n,code:"not-allowed"};let t=ke(e);p={target:e,promise:t};try{return await t}finally{p?.promise===t&&(p=null)}}async function ke(e){let t=typeof window<"u"?window.clay?._requestHostMode:void 0;if(typeof t=="function"&&e!==n){let o;try{o=await t(e)}catch{return{ok:!1,mode:n,code:"host-failed"}}if(o?.reason!=="host-unsupported")return o?.ok?(A=!0,{ok:!0,mode:e,changed:!0,reloading:!0}):{ok:!1,mode:n,code:o?.reason||"host-refused"}}return e==="edit"&&n!=="edit"?Se():!r&&!(e==="view"&&n==="edit")?{ok:!1,mode:n,code:"not-allowed"}:J(e)}async function Se(){let e=location.pathname,{checkHostPermission:t}=await import("./core/host-permission-6EVJGNPL.js"),o=await t({fresh:!0});return location.pathname!==e?{ok:!1,mode:n,code:"cancelled"}:o===!1?{ok:!1,mode:n,code:"permission-denied"}:r?J("edit"):{ok:!1,mode:n,code:"not-allowed"}}async function J(e){if(M){let t=await G(),o=t&&await t.switchMode(e,M);if(o)return o}if(e===n)return{ok:!0,mode:n,changed:!1};if(n==="edit"){let t;try{t=await window.clay?.save?.flush?.()}catch(o){return{ok:!1,mode:n,code:"save-failed",state:o?.state}}if(t&&t.state&&t.state!=="saved"&&t.state!=="clean")return{ok:!1,mode:n,code:"save-failed",state:t.state}}return A=!0,S({mode:e,canEdit:r,internal:!0}),location.reload(),{ok:!0,mode:e,changed:!0,reloading:!0}}function Te(){let e=new URL(window.location.href);e.searchParams.set("editmode","true"),window.location.href=e.toString()}var Y=()=>f?Te():y(n==="edit"?"view":"edit");function De(){!r||f||window.addEventListener("pagehide",()=>{A||S({mode:n,canEdit:r,internal:!1})})}function B(){r?document.documentElement.setAttribute("canedit","true"):document.documentElement.removeAttribute("canedit")}function X(){m(()=>{document.documentElement.setAttribute("editmode",u?"true":"false"),document.documentElement.setAttribute("pageowner",b?"true":"false"),B(),document.addEventListener("clay:capabilitychange",B),f?document.documentElement.setAttribute("draftmode","true"):document.documentElement.removeAttribute("draftmode")})}function N(){X(),De()}N();var Le={init:N,setMode:y,toggleEditMode:Y,isEditMode:u,isOwner:b,canEdit:r,mode:n};var ae={};var Q=typeof navigator<"u"&&/Mac|iPhone|iPad/.test(navigator.platform||navigator.userAgent),Me=Q?"\u2318\u21E7E":"Ctrl+Shift+E",Ae=`.clay-mode-note {
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
.clay-mode-note .clay-view-notice__edit {
  width: auto;
  padding: 0 10px;
  border: 1px solid rgba(23, 28, 36, .2);
  font-size: 13px;
  font-weight: 600;
  opacity: 1;
}
@media (prefers-color-scheme: dark) {
  .clay-mode-note .clay-view-notice__edit { border-color: rgba(233, 233, 236, .22); }
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
}`,Z=new WeakSet;function ee(e){import("./c-QO4HNGCQ.js").then(({mountEditorUI:t})=>{Z.has(e)||t({name:"mode-note",content:e,css:[Ae]})})}function te(e){Z.add(e),e.getRootNode().host?.remove()}function oe(e){return y(e).then(t=>{t.ok||import("./c-QHIWXHRO.js").then(({modeRefusalText:o})=>{let i=o(t);i&&(typeof window.clay?.toast=="function"?window.clay.toast(i,"error"):typeof window.clay?.menu?.note=="function"?window.clay.menu.note(i):re(i))})})}function Ne(e){(r||n==="edit")&&(!(Q?e.metaKey:e.ctrlKey)||!e.shiftKey||e.altKey||e.code!=="KeyE"||e.isComposing||(e.preventDefault(),oe(n==="edit"?"view":"edit")))}var Ce="In view mode, so edits won't be saved.",Re=":is(input, textarea, select):is([persist], [clay-persist])",R="[editmode\\:contenteditable], [viewmode\\:readonly], [viewmode\\:disabled]",a=null;function ne(e){if(!e.isConnected)return!1;let t=V(e);return t.persist===U.FULL&&!t.extension}function ie(e){let t=e?.nodeType===1?e:e?.parentElement;if(!t)return null;let o=t.closest(Re)||t.closest(R)||(t.isContentEditable?t:null);return o&&ne(o)?o:null}var Pe=e=>e.isContentEditable||e.matches("input, textarea, select")&&!e.readOnly&&!e.disabled,P=()=>r&&n==="view";function Ie(e){P()&&ie(e.target)&&I()}function Oe(e){if(!P()||e.defaultPrevented||e.isComposing||e.ctrlKey||e.metaKey||e.altKey||!(e.key.length===1&&e.key!==" ")&&e.key!=="Backspace"&&e.key!=="Delete")return;let t=e.target;if(t?.nodeType!==1||Pe(t)||t!==document.body&&!t.closest(R))return;ie(t===document.body?document.getSelection()?.anchorNode:t)?.matches(R)&&I()}function _e(e){if(!P())return;let t=e.target?.closest?.("[viewmode\\:disabled]");t&&ne(t)&&I()}function I(){a||(console.warn('clayjs: this tab is in view mode, so edits made here are not saved. clay.setMode("edit") switches; a page that must edit as soon as it opens declares <html opens-in="edit">.'),document.querySelector('clay-editor-ui[data-clay-ui="mode-note"]')?.remove(),a=document.createElement("div"),a.setAttribute("clay","editor-ui"),a.setAttribute("role","alert"),a.className="clay-mode-note clay-view-notice",a.innerHTML='<span></span><button type="button" class="clay-view-notice__edit">Switch to edit</button>',a.querySelector("span").textContent=Ce,a.querySelector("button").addEventListener("click",()=>oe("edit")),ee(a))}function Ke(){n==="view"||!a||(te(a),a=null)}function re(e){let t=document.createElement("div");t.setAttribute("clay","editor-ui"),t.setAttribute("role","status"),t.className="clay-mode-note",t.innerHTML=`<span>This page opens in view mode. Press <kbd>${Me}</kbd> to edit.</span><button type="button" aria-label="Dismiss">\xD7</button>`,e&&(t.querySelector("span").textContent=e);let o=()=>te(t);t.querySelector("button").addEventListener("click",o),addEventListener("keydown",i=>{i.key==="Escape"&&o()},{once:!0}),setTimeout(o,12e3),ee(t)}f||(document.addEventListener("keydown",Ne),document.addEventListener("input",Ie,!0),document.addEventListener("pointerdown",_e,!0),window.addEventListener("keydown",Oe),document.addEventListener("clay:modechange",Ke),m(()=>{if(!r||n!=="view"||document.querySelector("[clay-mode-toggle]"))return;(t=>{let o=window.clay?.ready;window.clay?.storage||typeof o?.then!="function"?queueMicrotask(t):o.then(t,()=>{})})(()=>{if(window.clay?.menu||window.clay?.plugins?.includes?.("menu"))return;let t=window.clay?.storage?.local;!t||t.get("mode-note")||(t.set("mode-note",!0),re())})}));var O={};k(O,{whenShown:()=>Ve});var je="This page can't be edited: the app serving it is out of date. Update HTML Clay to 1.9.0 or newer.",s=null,d=null;function h(){if(!s)return;let e=window.visualViewport,t=e?Math.max(0,window.innerHeight-e.height-e.offsetTop):0;D(s,"bottom",`calc(${16+t}px + env(safe-area-inset-bottom,0px))`)}function $e(){s&&(D(s,"display","none"),window.visualViewport?.removeEventListener("resize",h),window.visualViewport?.removeEventListener("scroll",h))}function qe(){s=d.bevelSurface("div",["position:fixed","left:50%","transform:translateX(-50%)","z-index:2147483001","display:flex","align-items:center","gap:10px 12px","width:max-content","max-width:calc(100vw - 24px)","flex-wrap:wrap","padding:8px 8px 8px 14px","text-align:left",`color-scheme:${d.pageScheme()}`]),s.setAttribute("clay",d.RUNTIME_ONLY),s.setAttribute("data-clay-stale-host",""),s.setAttribute("role","alert");let e=W("span",["all:initial","color-scheme:inherit","display:inline-block","flex:none","width:8px","height:8px","border-radius:50%",`background:${d.TOKENS.ox}`]);e.setAttribute("clay",d.RUNTIME_ONLY);let t=d.bevelButton("Dismiss",{small:!0,variant:"quiet",onClick:$e});t.setAttribute("aria-label","Dismiss this message"),s.append(e,d.bevelText("span",[],je),t),document.body.appendChild(s),h(),d.paintLook(s,{background:d.TOKENS.surface}),window.visualViewport?.addEventListener("resize",h),window.visualViewport?.addEventListener("scroll",h)}async function Ue(){if(!$()||u)return;let[e,t]=await Promise.all([import("./c-2ZZBC45O.js"),import("./c-ZE46QDIH.js")]);d={...e,TOKENS:t.TOKENS},qe()}var se=Promise.resolve();m(()=>{se=Ue()});var Ve=()=>se;var K={};k(K,{createPageDataApi:()=>le,readData:()=>Ge,setPageDataLiveSync:()=>Ye,writeData:()=>Je});var Fe="data-read",ze="data-write";function x(e,t,o){let i=new Error(t);return i.code=e,i.details=o,i}async function ce(e){if(typeof e.json=="function")return e.json();let t=await e.text();return t?JSON.parse(t):null}async function He(e){let t={};try{t=await ce(e)||{}}catch{}let o=t.message||t.error||e.statusText||`Request failed (${e.status})`,i=new Error(o);return i.status=e.status,i.error=t.error,i.details=t.details,i}function We(e){let t=e.headers?.get?.("ETag");return typeof t=="string"&&t?t:null}function Be(e,t){let o=`${t.origin}${t.pathname}`;return e!==void 0?`${o}?data=${encodeURIComponent(JSON.stringify(e))}`:`${t.origin}/_/api${t.pathname}`}async function de(){let{isDraftMode:e}=await import("./core/is-edit-mode-GCX6767E.js");return e?x("DataUnavailableInDraft","Page data is kept in this browser for this visitor."):null}function le({supports:e=H,token:t=j,fetchImpl:o=(...g)=>fetch(...g),getLocation:i=()=>window.location,eventTarget:ue=document,loadWriteModules:fe,syncTimeoutMs:me,httpTimeoutMs:pe}={}){let g=null,w=null;function we(c){g=c}async function ye(c){let v=await de();if(v)throw v;if(!await e(Fe))throw x("DataReadUnsupported","This host does not support reading page data.");let l;try{l=await o(Be(c,i()),{method:"GET",credentials:"same-origin",cache:"no-store",redirect:"error"})}catch(E){throw Object.assign(x("DataReadFailed",E?.message||"Could not read page data."),{cause:E})}if(!l.ok)throw await He(l);return{data:await ce(l),etag:We(l)}}function he(){return w||(w=import("./c-JNLX3RJB.js").then(({createPageDataWrite:c})=>c({supports:e,token:t,fetchImpl:o,getLocation:i,eventTarget:ue,getLiveSync:()=>g,loadWriteModules:fe,syncTimeoutMs:me,httpTimeoutMs:pe})).catch(c=>{throw w=null,c}),w)}async function ge(c,v){let l=await de();if(l)throw l;if(!await e(ze))throw x("DataWriteUnsupported","This host does not support writing page data.");return(await he()).writeData(c,v)}return{readData:ye,writeData:ge,setLiveSync:we}}var _=le(),Ge=_.readData,Je=_.writeData,Ye=_.setLiveSync;var lt={"lib/mutation.js":F,"core/preserve-authored.js":z,"core/edit-mode.js":C,"core/mode-key.js":ae,"core/stale-host-notice.js":O,"core/page-data.js":K};export{lt as core};
