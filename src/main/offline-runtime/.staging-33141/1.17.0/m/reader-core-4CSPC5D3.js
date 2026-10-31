import{b as D,c as W}from"./c-NUHP2XDB.js";import{g as z}from"./c-Q26MME6N.js";import{a as m}from"./c-VKEDWYDF.js";import{b as F}from"./c-ZWIOJGMT.js";import{e as H}from"./c-NJCGEPG6.js";import"./c-IJUK2GPW.js";import{a as S,b as f,c as r,f as l,g as n,h as b,j as T,o as q}from"./c-3O7OBDCM.js";import{c as j,e as $}from"./c-BPF2NSPV.js";import"./c-P7KNDG34.js";import"./c-CYWLPPUS.js";import"./c-N7JPUPGC.js";import"./c-VG5XIN4T.js";import"./c-2YYDMLNZ.js";import"./c-HA6INT6J.js";import{d as U,s as V}from"./c-DCFSEJZG.js";import"./c-WRBKEJD4.js";import{a as k}from"./c-VHNSBD2M.js";var N={};k(N,{activateInitialMode:()=>be,canEdit:()=>r,default:()=>Te,init:()=>C,isEditMode:()=>l,isOwner:()=>b,mode:()=>n,modeLifecycle:()=>ge,noteLiveSwitch:()=>ve,setMode:()=>y,setPageTypeOnPageLoad:()=>X,toggleEditMode:()=>Y});var M=!1,he=e=>{if(typeof e?.id=="string"&&e.id.startsWith("clay:"))throw new TypeError(`clay.modeLifecycle: the id "${e.id}" is reserved`);return q(e)},ge={register:he,canWrite:()=>T().phase==="idle"&&l,get state(){return Object.freeze(T())}},L=null,G=()=>L||=import("./c-EP25IIV7.js").catch(()=>L=null),A=null,ve=e=>{A=e};async function be(){if(l)try{await(await G()).activateInitial()}catch(e){console.error("clayjs: the mode lifecycle failed to start:",e)}}var p=null;async function y(e){if(e!=="edit"&&e!=="view")throw new TypeError(`clay.setMode: unknown mode "${e}"`);if(p)return p.target===e?p.promise:{ok:!1,mode:n,code:"busy"};if(e===n&&!L)return{ok:!0,mode:n,changed:!1};if(f)return{ok:!1,mode:n,code:"not-allowed"};let t=xe(e);p={target:e,promise:t};try{return await t}finally{p?.promise===t&&(p=null)}}async function xe(e){let t=typeof window<"u"?window.clay?._requestHostMode:void 0;if(typeof t=="function"&&e!==n){let o;try{o=await t(e)}catch{return{ok:!1,mode:n,code:"host-failed"}}if(o?.reason!=="host-unsupported")return o?.ok?(M=!0,{ok:!0,mode:e,changed:!0,reloading:!0}):{ok:!1,mode:n,code:o?.reason||"host-refused"}}return e==="edit"&&n!=="edit"?Ee():!r&&!(e==="view"&&n==="edit")?{ok:!1,mode:n,code:"not-allowed"}:J(e)}async function Ee(){let e=location.pathname,{checkHostPermission:t}=await import("./core/host-permission-O63Y74WU.js"),o=await t({fresh:!0});return location.pathname!==e?{ok:!1,mode:n,code:"cancelled"}:o===!1?{ok:!1,mode:n,code:"permission-denied"}:r?J("edit"):{ok:!1,mode:n,code:"not-allowed"}}async function J(e){if(A){let t=await G(),o=t&&await t.switchMode(e,A);if(o)return o}if(e===n)return{ok:!0,mode:n,changed:!1};if(n==="edit"){let t;try{t=await window.clay?.save?.flush?.()}catch(o){return{ok:!1,mode:n,code:"save-failed",state:o?.state}}if(t&&t.state&&t.state!=="saved"&&t.state!=="clean")return{ok:!1,mode:n,code:"save-failed",state:t.state}}return M=!0,S({mode:e,canEdit:r,internal:!0}),location.reload(),{ok:!0,mode:e,changed:!0,reloading:!0}}function ke(){let e=new URL(window.location.href);e.searchParams.set("editmode","true"),window.location.href=e.toString()}var Y=()=>f?ke():y(n==="edit"?"view":"edit");function Se(){!r||f||window.addEventListener("pagehide",()=>{M||S({mode:n,canEdit:r,internal:!1})})}function B(){r?document.documentElement.setAttribute("canedit","true"):document.documentElement.removeAttribute("canedit")}function X(){m(()=>{document.documentElement.setAttribute("editmode",l?"true":"false"),document.documentElement.setAttribute("pageowner",b?"true":"false"),B(),document.addEventListener("clay:capabilitychange",B),f?document.documentElement.setAttribute("draftmode","true"):document.documentElement.removeAttribute("draftmode")})}function C(){X(),Se()}C();var Te={init:C,setMode:y,toggleEditMode:Y,isEditMode:l,isOwner:b,canEdit:r,mode:n};var ie={};var Q=typeof navigator<"u"&&/Mac|iPhone|iPad/.test(navigator.platform||navigator.userAgent),De=Q?"\u2318\u21E7E":"Ctrl+Shift+E",Le=`.clay-mode-note {
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
}`;function Z(){if(document.getElementById("clay-mode-note-style"))return;let e=document.createElement("style");e.id="clay-mode-note-style",e.setAttribute("clay","editor-ui"),e.textContent=Le,document.head.append(e)}function ee(e){return y(e).then(t=>{t.ok||import("./c-QHIWXHRO.js").then(({modeRefusalText:o})=>{let i=o(t);i&&(typeof window.clay?.toast=="function"?window.clay.toast(i,"error"):typeof window.clay?.menu?.note=="function"?window.clay.menu.note(i):ne(i))})})}function Ae(e){(r||n==="edit")&&(!(Q?e.metaKey:e.ctrlKey)||!e.shiftKey||e.altKey||e.code!=="KeyE"||e.isComposing||(e.preventDefault(),ee(n==="edit"?"view":"edit")))}var Me="In view mode, so edits won't be saved.",Ce=":is(input, textarea, select):is([persist], [clay-persist])",R="[editmode\\:contenteditable], [viewmode\\:readonly], [viewmode\\:disabled]",a=null;function te(e){if(!e.isConnected)return!1;let t=V(e);return t.persist===U.FULL&&!t.extension}function oe(e){let t=e?.nodeType===1?e:e?.parentElement;if(!t)return null;let o=t.closest(Ce)||t.closest(R)||(t.isContentEditable?t:null);return o&&te(o)?o:null}var Ne=e=>e.isContentEditable||e.matches("input, textarea, select")&&!e.readOnly&&!e.disabled,P=()=>r&&n==="view";function Re(e){P()&&oe(e.target)&&I()}function Pe(e){if(!P()||e.defaultPrevented||e.isComposing||e.ctrlKey||e.metaKey||e.altKey||!(e.key.length===1&&e.key!==" ")&&e.key!=="Backspace"&&e.key!=="Delete")return;let t=e.target;if(t?.nodeType!==1||Ne(t)||t!==document.body&&!t.closest(R))return;oe(t===document.body?document.getSelection()?.anchorNode:t)?.matches(R)&&I()}function Ie(e){if(!P())return;let t=e.target?.closest?.("[viewmode\\:disabled]");t&&te(t)&&I()}function I(){a||(console.warn('clayjs: this tab is in view mode, so edits made here are not saved. clay.setMode("edit") switches; a page that must edit as soon as it opens declares <html opens-in="edit">.'),Z(),document.querySelector(".clay-mode-note")?.remove(),a=document.createElement("div"),a.setAttribute("clay","editor-ui"),a.setAttribute("role","alert"),a.className="clay-mode-note clay-view-notice",a.innerHTML='<span></span><button type="button" class="clay-view-notice__edit">Switch to edit</button>',a.querySelector("span").textContent=Me,a.querySelector("button").addEventListener("click",()=>ee("edit")),document.body.append(a))}function _e(){n==="view"||!a||(a.remove(),a=null)}function ne(e){Z();let t=document.createElement("div");t.setAttribute("clay","editor-ui"),t.setAttribute("role","status"),t.className="clay-mode-note",t.innerHTML=`<span>This page opens in view mode. Press <kbd>${De}</kbd> to edit.</span><button type="button" aria-label="Dismiss">\xD7</button>`,e&&(t.querySelector("span").textContent=e);let o=()=>t.remove();t.querySelector("button").addEventListener("click",o),addEventListener("keydown",i=>{i.key==="Escape"&&o()},{once:!0}),setTimeout(o,12e3),document.body.append(t)}f||(document.addEventListener("keydown",Ae),document.addEventListener("input",Re,!0),document.addEventListener("pointerdown",Ie,!0),window.addEventListener("keydown",Pe),document.addEventListener("clay:modechange",_e),m(()=>{if(!r||n!=="view"||document.querySelector("[clay-mode-toggle]"))return;(t=>{let o=window.clay?.ready;window.clay?.storage||typeof o?.then!="function"?queueMicrotask(t):o.then(t,()=>{})})(()=>{if(window.clay?.menu||window.clay?.plugins?.includes?.("menu"))return;let t=window.clay?.storage?.local;!t||t.get("mode-note")||(t.set("mode-note",!0),ne())})}));var _={};k(_,{whenShown:()=>qe});var Oe="This page can't be edited: the app serving it is out of date. Update HTML Clay to 1.9.0 or newer.",s=null,u=null;function h(){if(!s)return;let e=window.visualViewport,t=e?Math.max(0,window.innerHeight-e.height-e.offsetTop):0;D(s,"bottom",`calc(${16+t}px + env(safe-area-inset-bottom,0px))`)}function Ke(){s&&(D(s,"display","none"),window.visualViewport?.removeEventListener("resize",h),window.visualViewport?.removeEventListener("scroll",h))}function je(){s=u.bevelSurface("div",["position:fixed","left:50%","transform:translateX(-50%)","z-index:2147483001","display:flex","align-items:center","gap:10px 12px","width:max-content","max-width:calc(100vw - 24px)","flex-wrap:wrap","padding:8px 8px 8px 14px","text-align:left",`color-scheme:${u.pageScheme()}`]),s.setAttribute("clay",u.RUNTIME_ONLY),s.setAttribute("data-clay-stale-host",""),s.setAttribute("role","alert");let e=W("span",["all:initial","color-scheme:inherit","display:inline-block","flex:none","width:8px","height:8px","border-radius:50%",`background:${u.TOKENS.ox}`]);e.setAttribute("clay",u.RUNTIME_ONLY);let t=u.bevelButton("Dismiss",{small:!0,variant:"quiet",onClick:Ke});t.setAttribute("aria-label","Dismiss this message"),s.append(e,u.bevelText("span",[],Oe),t),document.body.appendChild(s),h(),window.visualViewport?.addEventListener("resize",h),window.visualViewport?.addEventListener("scroll",h)}async function $e(){if(!$()||l)return;let[e,t]=await Promise.all([import("./c-6HMB24EV.js"),import("./c-ZE46QDIH.js")]);u={...e,TOKENS:t.TOKENS},je()}var re=Promise.resolve();m(()=>{re=$e()});var qe=()=>re;var K={};k(K,{createPageDataApi:()=>de,readData:()=>We,setPageDataLiveSync:()=>Ge,writeData:()=>Be});var Ue="data-read",Ve="data-write";function x(e,t,o){let i=new Error(t);return i.code=e,i.details=o,i}async function se(e){if(typeof e.json=="function")return e.json();let t=await e.text();return t?JSON.parse(t):null}async function Fe(e){let t={};try{t=await se(e)||{}}catch{}let o=t.message||t.error||e.statusText||`Request failed (${e.status})`,i=new Error(o);return i.status=e.status,i.error=t.error,i.details=t.details,i}function ze(e){let t=e.headers?.get?.("ETag");return typeof t=="string"&&t?t:null}function He(e,t){let o=`${t.origin}${t.pathname}`;return e!==void 0?`${o}?data=${encodeURIComponent(JSON.stringify(e))}`:`${t.origin}/_/api${t.pathname}`}async function ae(){let{isDraftMode:e}=await import("./core/is-edit-mode-GCX6767E.js");return e?x("DataUnavailableInDraft","Page data is kept in this browser for this visitor."):null}function de({supports:e=H,token:t=j,fetchImpl:o=(...g)=>fetch(...g),getLocation:i=()=>window.location,eventTarget:ce=document,loadWriteModules:le,syncTimeoutMs:ue,httpTimeoutMs:fe}={}){let g=null,w=null;function me(d){g=d}async function pe(d){let v=await ae();if(v)throw v;if(!await e(Ue))throw x("DataReadUnsupported","This host does not support reading page data.");let c;try{c=await o(He(d,i()),{method:"GET",credentials:"same-origin",cache:"no-store",redirect:"error"})}catch(E){throw Object.assign(x("DataReadFailed",E?.message||"Could not read page data."),{cause:E})}if(!c.ok)throw await Fe(c);return{data:await se(c),etag:ze(c)}}function we(){return w||(w=import("./c-KRMTQE2R.js").then(({createPageDataWrite:d})=>d({supports:e,token:t,fetchImpl:o,getLocation:i,eventTarget:ce,getLiveSync:()=>g,loadWriteModules:le,syncTimeoutMs:ue,httpTimeoutMs:fe})).catch(d=>{throw w=null,d}),w)}async function ye(d,v){let c=await ae();if(c)throw c;if(!await e(Ve))throw x("DataWriteUnsupported","This host does not support writing page data.");return(await we()).writeData(d,v)}return{readData:pe,writeData:ye,setLiveSync:me}}var O=de(),We=O.readData,Be=O.writeData,Ge=O.setLiveSync;var dt={"lib/mutation.js":F,"core/preserve-authored.js":z,"core/edit-mode.js":N,"core/mode-key.js":ie,"core/stale-host-notice.js":_,"core/page-data.js":K};export{dt as core};
