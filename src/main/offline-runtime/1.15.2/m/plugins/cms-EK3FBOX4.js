import{b as Te,e as Hr}from"../c-JAX2667S.js";import{a as Ct}from"../c-HPURYVZS.js";import"../c-OIBUTDXI.js";import"../c-4JZDZFF6.js";import{e as V}from"../c-VAK7SG37.js";import"../c-NUHP2XDB.js";import"../c-VHNSBD2M.js";var Ur=`@layer clay-skin{
:is(.hcms-shell):not([data-theme]),:is(.hcms-shell):not([data-theme]) *{--mirk-canvas:light-dark(#FDF8F0, #0B0C13) !important;--mirk-bg:light-dark(#FFFCF6, #11131E) !important;--mirk-fg:light-dark(#2B241B, #ECEAF2) !important;--mirk-accent:light-dark(#F4ECDF, #1A1D2C) !important;--mirk-destructive:light-dark(#A83A2C, #FF5566) !important;--mirk-focus-color:light-dark(#8F6310, #D9A445) !important;--mirk-bevel-bg:light-dark(#F1E7D4, #22273E) !important;--mirk-bevel-fg:light-dark(#2B241B, #ECEAF2) !important;--mirk-bevel-tl:light-dark(#FFF9ED, #3C4260) !important;--mirk-bevel-br:light-dark(#D6C3A5, #1B2033) !important;--mirk-bevel-hover-bg:color-mix(in srgb, light-dark(#F1E7D4, #22273E), light-dark(#FFF9ED, #3C4260) 45%) !important;--mirk-pill-inner-top:light-dark(#FFF9ED, #3C4260) !important;--mirk-input-border:light-dark(#D8C8AF, #353B52) !important;--mirk-placeholder-color:light-dark(#9A8A70, #6A7090) !important;--mirk-ctrl-bg:light-dark(#6B5942, #8A90AB) !important;--mirk-toggle-bg:light-dark(#FCF8F1, #4A5275) !important;--mirk-toggle-hi:light-dark(#FFF9ED, #6C759A) !important;--mirk-toggle-lo:light-dark(#D6C3A5, #1B2033) !important;--mirk-mark-fg:light-dark(#2B241B, #ECEAF2) !important;--mirk-sortable-dot:light-dark(#D8C8AF, #353B52) !important;--mirk-sortable-shadow:light-dark(#D6C3A5, #1B2033) !important;--mirk-sortable-label:light-dark(#6B5942, #8A90AB) !important;--mirk-sortable-placeholder:light-dark(#9A8A70, #6A7090) !important;--mirk-slider-fill:light-dark(#F0E4CC, #3A2F17) !important;--mirk-slider-nub-bg:light-dark(#FCF8F1, #4A5275) !important;--mirk-slider-nub-hi:light-dark(#FFF9ED, #6C759A) !important;--mirk-slider-nub-lo:light-dark(#D6C3A5, #1B2033) !important;--mirk-chip-surface:light-dark(#FFFCF6, #11131E) !important;--mirk-chip-edge:light-dark(#D8C8AF, #353B52) !important;--mirk-chip-primary-bg:light-dark(#2B241B, #ECEAF2) !important;--mirk-chip-primary-fg:light-dark(#FDF8F0, #0B0C13) !important;--mirk-chip-alert:light-dark(#A83A2C, #FF5566) !important;--mirk-radius:0px !important;--mirk-focus-offset:2px !important}
:is(.hcms-shell){font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace !important}
.hcms-shell .mirk-chip__actions .mirk-chip__action--primary{--mirk-bevel-bg:var(--mirk-chip-primary-bg) !important;--mirk-bevel-fg:var(--mirk-chip-primary-fg) !important;--mirk-bevel-tl:color-mix(in srgb, var(--mirk-chip-primary-bg), white 24%) !important;--mirk-bevel-br:color-mix(in srgb, var(--mirk-chip-primary-bg), black 32%) !important;--mirk-bevel-hover-bg:color-mix(in srgb, var(--mirk-chip-primary-bg), white 10%) !important}
}`;var Vr=["[data-hcms-toggle-host]"],Wr=`@layer clay-skin{
[data-hcms-toggle-host]{--hcms-toggle-bg:${V.face} !important;--hcms-toggle-color:${V.ink} !important}
[data-hcms-toggle-host] :is(.hcms-toggle__main, .hcms-toggle__arrow){border-color:${V["edge-hi"]} ${V["edge-lo"]} ${V["edge-lo"]} ${V["edge-hi"]} !important}
[data-hcms-toggle-host] :is(.hcms-toggle__main, .hcms-toggle__arrow):hover:not(:active){--hcms-toggle-bg:color-mix(in srgb, ${V.face}, ${V["edge-hi"]} 45%) !important}
[data-hcms-toggle-host] :is(.hcms-toggle__main, .hcms-toggle__arrow):active{border-color:${V["edge-lo"]} ${V["edge-hi"]} ${V["edge-hi"]} ${V["edge-lo"]} !important}
}`;var Xo=Object.defineProperty,ir=(e,t)=>{for(var r in t)Xo(e,r,{get:t[r],enumerable:!0})},Xl={};ir(Xl,{cms:()=>jr,default:()=>xh});var Kl=["textContent","innerText","innerHTML","outerHTML","value","checked","selected","disabled","readOnly","type","tagName","nodeName","nodeType","nodeValue","childElementCount","id","className","classList","baseURI","offsetWidth","offsetHeight","clientWidth","clientHeight","scrollWidth","scrollHeight","dataset","currentSrc","duration","paused","title","documentURI","contentType"],Ko=new Set(Kl),Zo=new Set(["textContent","innerText","innerHTML","value","checked","selected","disabled","readOnly","type","id","className","title"]),Zl=new Set(["tagName","nodeName","nodeType","nodeValue","childElementCount","classList","baseURI","documentURI","contentType","offsetWidth","offsetHeight","clientWidth","clientHeight","scrollWidth","scrollHeight","currentSrc","duration","paused","dataset"]),Gr=new Set(["checked","selected","disabled","readOnly","paused"]);function Qo(e,t){return t==null?Gr.has(e)?!1:"":Gr.has(e)?t==="false"?!1:!!t:t}function P(e){let t=0,r=null,l=-1;for(let i=0;i<e.length;i++){let o=e[i];o==="\\"?i++:r?o===r&&(r=null):o==='"'||o==="'"?r=o:o==="["||o==="("?t++:o==="]"||o===")"?t>0&&t--:o==="@"&&t===0&&(l=i)}return l}function Yo(e){let t=P(e);return t===-1?{selector:e,prop:null}:{selector:e.slice(0,t),prop:e.slice(t+1)||null}}function Ql(e){let t=0,r=null,l=-1,i=!1;for(let o=0;o<e.length;o++){let a=e[o];a==="\\"?o++:r?a===r&&(r=null):a==='"'||a==="'"?r=a:a==="["||a==="("?t++:a==="]"||a===")"?t>0&&t--:t===0&&a===">"?l=o:t===0&&a===","&&(i=!0)}return i||l===-1||!ea(e,l+1)?null:e.slice(0,l).trim()||null}function ea(e,t){let r=t,l=e.replace(/\s+$/,"").length;for(;r<l&&/\s/.test(e[r]);)r++;let i=0,o=null;for(;r<l;r++){let a=e[r];if(a==="\\")r++;else if(o)a===o&&(o=null);else if(a==='"'||a==="'")o=a;else if(a==="["||a==="(")i++;else if(a==="]"||a===")")i>0&&i--;else if(i===0&&(a==="+"||a==="~"||/\s/.test(a)))return!1}return!0}var Yl={};ir(Yl,{EmptyListInsert:()=>Le,MAX_RULE_DEPTH:()=>ft,MaxRuleDepthExceeded:()=>ar,NoRulesTag:()=>ia,RuleTargetReadOnly:()=>ri,RulesParseError:()=>or,ShapeMismatch:()=>ti,UnknownRulesVersion:()=>ei,WriteNotRoundTripped:()=>la,WriteRefused:()=>ta,WriteRejected:()=>oa});var or=class extends Error{constructor(e,t){super(e),this.name="RulesParseError",this.cause=t}},ei=class extends Error{constructor(e){super(`unknown rules version: ${e}. Library supports "1".`),this.name="UnknownRulesVersion",this.version=e}},ft=20,ar=class extends Error{constructor(e){super(`rule depth exceeded ${ft} at path: ${e.join(".")}`),this.name="MaxRuleDepthExceeded",this.path=e}},ti=class extends Error{constructor(e){super(`shape mismatch: ${e.length} field(s) failed validation`),this.name="ShapeMismatch",this.mismatches=e}},Le=class extends Error{constructor(e,t){super(t?`cannot add items to empty list at "${e.join(".")}" \u2014 ${t}`:`cannot add items to empty list at "${e.join(".")}" \u2014 no sibling to clone as template. Seed the list with a hidden item first.`),this.name="EmptyListInsert",this.path=e}},ri=class extends Error{constructor(e){super(`cannot write to read-only DOM property "${e}"`),this.name="RuleTargetReadOnly",this.target=e}},ta=class extends Error{constructor(e){super(`write refused: ${e.length} write(s) broke the content-only policy`),this.name="WriteRefused",this.refusals=e}};function ra(e){return e.reduce((t,r)=>typeof r=="number"?`${t}[${r}]`:t?`${t}.${r}`:String(r),"")||"(root)"}var la=class extends Error{constructor(e){super(`write did not round-trip at "${ra(e)}"`),this.name="WriteNotRoundTripped",this.path=e}},ia=class extends Error{constructor(e){super(`no <script data-rules-name~="${e}"> rules tag in this document`),this.name="NoRulesTag",this.token=e}},oa=class extends Error{constructor(e,t){super(`write rejected: ${e.length} unknown key(s), ${t.length} rule(s) with no matching element`),this.name="WriteRejected",this.unknownKeys=e,this.unmatched=t}},aa=/^--[A-Za-z0-9_-]+$/;function li(e){return typeof e=="string"&&aa.test(e)}function ii(e){let t=[],r=0,l=null,i=0;for(let o=0;o<e.length;o++){let a=e[o];if(l){a==="\\"?o++:a===l&&(l=null);continue}if(a==="/"&&e[o+1]==="*"){let n=e.indexOf("*/",o+2);o=n===-1?e.length:n+1;continue}a==='"'||a==="'"?l=a:a==="("||a==="["||a==="{"?r++:(a===")"||a==="]"||a==="}")&&r>0?r--:a===";"&&r===0&&(t.push(e.slice(i,o)),i=o+1)}return t.push(e.slice(i)),t}function oi(e){let t=e.indexOf(":");if(t===-1)return null;let r=e.slice(0,t).trim(),l=e.slice(t+1).trim(),i=/!\s*important\s*$/i.exec(l);return i&&(l=l.slice(0,i.index).trim()),{name:r,value:l,important:!!i}}function ai(e,t){if(e==null)return null;let r=null;for(let l of ii(String(e))){let i=oi(l);!i||i.name!==t||(!r||i.important||!r.important)&&(r=i)}return r?r.value:null}function na(e,t,r){let l=e==null?"":String(e),i=r==null||r==="",o=ii(l),a=o.map(oi),n=a.some(m=>m&&m.name===t&&m.important),s=[],h=!1;o.forEach((m,p)=>{let u=a[p];if(!u||u.name!==t){s.push(m);return}if(i||h)return;let c=/^\s*/.exec(m)[0];s.push(`${c}${t}: ${r}${n?" !important":""}`),h=!0});let d=s.join(";");if(!i&&!h){let m=d.trimEnd();d=m===""?`${t}: ${r}`:`${m}${m.endsWith(";")?" ":"; "}${t}: ${r}`}return d.trim()===""?null:d}function Bt(e,t,r,l={}){if(Object.prototype.hasOwnProperty.call(l,"exclude")&&e.semanticExclude===!1)throw new Error("This adapter does not support semantic exclude queries; omit exclude or use the DOM adapter.");return It(e,t,r,{depth:0,path:[]},l)}function It(e,t,r,l,i){if(l.depth>ft)throw new ar(l.path);if(typeof r=="string")return sa(e,t,r,l,i);if(Array.isArray(r)){let[o,a]=r,n=e.find(t,o,i);return ni(i,l,n),n.map((s,h)=>It(e,s,a,{depth:l.depth+1,path:[...l.path,h]},i))}if(typeof r=="object"&&r!==null){let o={};for(let[a,n]of Object.entries(r))o[a]=It(e,t,n,{depth:l.depth+1,path:[...l.path,a]},i);return o}return null}function sa(e,t,r,l,i){if(r.endsWith("[]")){let n=r.slice(0,-2),s=e.find(t,n,i);return ni(i,l,s),s.map(h=>e.text(h))}if(r.startsWith("@"))return Jr(e,t,r.slice(1));let o=P(r);if(o!==-1){let n=r.slice(0,o),s=r.slice(o+1),h=n?e.find(t,n,i):[t];return h.length===0?null:Jr(e,h[0],s)}if(r===".")return e.text(t);let a=e.find(t,r,i);return a.length===0?null:e.text(a[0])}function ni(e,t,r){if(typeof e.onRowsRead=="function")try{e.onRowsRead(t.path.slice(),r)}catch(l){console.warn(`[hyper-html-api] onRowsRead threw at "${t.path.join(".")||"(root)"}"`,l)}}function Jr(e,t,r){if(li(r))return ai(e.attr(t,"style"),r);if(Ko.has(r)){let i=e.prop(t,r);return i==null?null:String(i)}return e.attr(t,r)??null}var nr=Object.freeze({data:Object.freeze({tokens:["no-data"],bundles:["editor-ui"]}),save:Object.freeze({tokens:["no-save"],bundles:["editor-ui"]}),snapshot:Object.freeze({tokens:["no-snapshot"],bundles:["editor-ui"]}),watch:Object.freeze({tokens:["no-watch"],bundles:["editor-ui"]}),undo:Object.freeze({tokens:["no-undo"],bundles:["editor-ui"]}),history:Object.freeze({tokens:[],bundles:["editor-ui"]})}),ca=Object.freeze({"editor-ui":Object.freeze(["no-data","no-save","no-snapshot","no-watch","no-undo"])}),ha=Object.freeze(["no-save","no-snapshot","no-trigger-autosave","no-dirty","no-watch","no-undo","no-data","freeze","editor-ui","live"]);function tt(e,t){if(!e||e.nodeType!==1)return!1;let r=e.getAttribute?.("clay");return!!(r&&r.split(/\s+/).includes(t)||e.hasAttribute?.(t))}function si(e,t){if(tt(e,t))return!0;for(let[r,l]of Object.entries(ca))if(l.includes(t)&&tt(e,r))return!0;return!1}function Pt(e){let t=nr[e];if(!t)throw new Error(`Unknown region capability: ${e}`);return[...t.tokens,...t.bundles].flatMap(r=>[`[clay~="${r}"]`,`[${r}]`]).join(", ")}function da(e,t){let r=e&&e.nodeType===1?e:e?.parentElement;for(;r&&r.nodeType===1;){let l=nr[t];if(!l)throw new Error(`Unknown region capability: ${t}`);if(l.tokens.some(i=>si(r,i))||l.bundles.some(i=>tt(r,i)))return r;r=r.parentElement}return null}function ua(e,t){return!!da(e,t)}var ma=/:(?:focus(?:-within|-visible)?|hover|active|visited|defined)\b/i;function pa(e,t){if(!/^(INPUT|TEXTAREA|SELECT|OPTION)$/.test(e.tagName||""))return;let r=(e.getAttribute?.("type")||"").toLowerCase();"value"in e&&"value"in t&&e.tagName!=="OPTION"&&r!=="checkbox"&&r!=="radio"&&r!=="file"&&(t.value=e.value),e.tagName==="INPUT"&&(r==="checkbox"||r==="radio")&&(t.checked=e.checked),e.tagName==="OPTION"&&(t.selected=e.selected),"indeterminate"in e&&"indeterminate"in t&&(t.indeterminate=e.indeterminate)}function Xr(e,t,r,l){if(l)return!!e.closest?.(t);let i=e;for(;i?.nodeType===1;){if(i.matches(t))return!0;if(i===r)break;i=i.parentElement}return!1}function Kr(e,t,r,l,i,o){return(o?ua(e,t):Xr(e,r,i,!1))||!!(l&&(o&&e!==i?e.matches(l):Xr(e,l,i,o)))}function fa(e,t){let r=nr[t];return r.tokens.some(l=>si(e,l))||r.bundles.some(l=>tt(e,l))}var ga=new Set(["INPUT","TEXTAREA","SELECT","OPTION"]);function ci(e,t,r,l){if(e.nodeType===1&&l(e)){r.dropped.push(t);return}r.cloneToLive.set(t,e),r.liveToClone.set(e,t);let i=e,o=t;if(e.nodeType===1){if(ga.has(e.tagName)&&r.controls.push(e,t),e.tagName==="TEMPLATE"){for(;t.firstChild;)t.removeChild(t.firstChild);i=e.content,o=t.content,r.cloneToLive.set(o,i),r.liveToClone.set(i,o)}}else if(e.nodeType!==11)return;let a=o.firstChild;for(let n=i.firstChild;n&&a;n=n.nextSibling)ci(n,a,r,l),a=a.nextSibling}function Ue(e,{capability:t="data",exclude:r=null,inherit:l=!0,provenance:i=null}={}){if(!e)throw new TypeError("createContentView requires a DOM context");let o=e.nodeType===9?e:e.ownerDocument;if(!o?.implementation?.createHTMLDocument)throw new TypeError("createContentView requires an HTML DOM implementation");let a=o.implementation.createHTMLDocument(""),n=i||new WeakMap,s=new WeakMap,h=e.nodeType===9?e.documentElement:e;r&&a.documentElement.matches(r);let d=Pt(t),m=l?c=>fa(c,t)||!!(r&&c.matches(r)):c=>Kr(c,t,d,r,h,!1),p=null;if(h.nodeType!==1||!Kr(h,t,d,r,h,l)){p=a.importNode(h,!0);let c={cloneToLive:n,liveToClone:s,dropped:[],controls:[]};ci(h,p,c,m);for(let f of c.dropped)f.remove();for(let f=0;f<c.controls.length;f+=2)pa(c.controls[f],c.controls[f+1])}e.nodeType===9&&p&&(a.replaceChild(p,a.documentElement),s.set(e,a),n.set(a,e));let u=c=>{if(ma.test(c))throw new Error(`Filtered content queries do not support stateful selector: ${c}`)};return{root:p,document:a,capability:t,selector:Pt(t),cloneToLive:n,liveToClone:s,original(c){return n.get(c)||null},cloneOf(c){return s.get(c)||null},query(c,f=p){return u(c),Array.from(f.querySelectorAll(c),b=>n.get(b)||b)},text(c=p){return(c===p?p:s.get(c))?.textContent||""},html(c=p){return(c===p?p:s.get(c))?.innerHTML??""},clone(c=p){let f=c===p?p:s.get(c);return f?a.importNode(f,!0):null}}}function hi(e){return e&&e.nodeType===1&&e.tagName==="SCRIPT"&&e.hasAttribute&&e.hasAttribute("data-rules-name")}function ba(e){return e?(e.nodeType===9||e.nodeType,e):null}function Zr(e,t,r){!e||e.nodeType!==1||(t==="value"&&e.tagName==="INPUT"?e.value=r===null?"":r:t==="checked"&&e.tagName==="INPUT"?e.checked=r!==null:t==="selected"&&e.tagName==="OPTION"&&(e.selected=r!==null))}function di(e,t){e&&e.tagName==="TEXTAREA"&&(e.value=t)}function ui(e){if(!e||e.nodeType!==1)return;let t=[e,...e.querySelectorAll?e.querySelectorAll("textarea, input, option"):[]];for(let r of t)if(r.tagName==="TEXTAREA")r.value=r.defaultValue;else if(r.tagName==="INPUT"){let l=r.type;l!=="file"&&l!=="checkbox"&&l!=="radio"&&(r.value=r.defaultValue),r.checked=r.defaultChecked}else r.tagName==="OPTION"&&(r.selected=r.defaultSelected)}var F={semanticExclude:!0,find(e,t,r={}){let l=ba(e);if(!l||!l.querySelectorAll)return[];let i=Array.from(l.querySelectorAll(t));r.includeRulesTag||(i=i.filter(n=>!hi(n)));let o=[];r.skip&&o.push(r.skip);let a=r.templateAttr===null?null:r.templateAttr||"cms-template";if(a&&o.push("["+a+"]"),o.length){let n=o.join(", ");i=i.filter(s=>!s.closest||!s.closest(n))}return i},parent(e){return e?e.parentElement:null},children(e){return e?Array.from(e.children):[]},matches(e,t){return!!(e&&e.matches)&&e.matches(t)},text(e,t){if(t===void 0)return(e.textContent||"").trim();e.textContent=t,di(e,t)},attr(e,t,r){if(r===void 0)return e.hasAttribute&&e.hasAttribute(t)?e.getAttribute(t):null;e.setAttribute(t,r),Zr(e,t,r)},removeAttr(e,t){e&&e.removeAttribute&&e.removeAttribute(t),Zr(e,t,null)},prop(e,t,r){if(r===void 0){let l=e?e[t]:void 0;return l!==void 0?l:null}e[t]=r},clone(e){let t=e.cloneNode(!0);return ui(t),t},insertAt(e,t,r){let l=e.children[r]||null;e.insertBefore(t,l)},insertBefore(e,t){e.parentNode.insertBefore(t,e)},insertAfter(e,t){e.parentNode.insertBefore(t,e.nextSibling)},identity(e){return e||null},remove(e){e&&e.parentNode&&e.parentNode.removeChild(e)},replaceWith(e,t){if(!e||!e.parentNode)throw new Error("dom.replaceWith: node has no parent");let r=e.ownerDocument.createElement("template");r.innerHTML=t;let l=r.content.firstElementChild;if(!l)throw new Error("dom.replaceWith: html did not parse to an element");return e.parentNode.replaceChild(l,e),l},stripIds(e){let t=0;return e.id&&(e.removeAttribute("id"),t++),(e.querySelectorAll?e.querySelectorAll("[id]"):[]).forEach(r=>{r.removeAttribute("id"),t++}),t},sameNode(e,t){return e===t}};function ge(e,t={}){if(t.exclude===null)return F;let r=[Pt("data"),t.exclude].filter(Boolean).join(", "),l=e.nodeType===9?e:e.ownerDocument||e,i=e.nodeType===9?e.documentElement:e;if(!t._write&&!i?.matches?.(r)&&!i?.querySelector?.(r)&&!l?.querySelector?.(r))return F;let o=e.nodeType===9||!e.isConnected?e:e.ownerDocument,a=e.nodeType===9?e:e.ownerDocument,n=null,s=()=>n||(n=Ue(o,{capability:"data",exclude:t.exclude||null})),h=c=>{let f=s();return c===e?f.cloneOf(e):f.cloneOf(c)||c},d=c=>n?.original(c)||c,m=(c,f)=>{s().liveToClone.set(c,f),s().cloneToLive.set(f,c);let b=c.childNodes||[],g=f.childNodes||[];for(let k=0;k<Math.min(b.length,g.length);k++)m(b[k],g[k])},p=(c,f,b,g)=>{let k=Array.from(c.childNodes).filter(E=>n.cloneOf(E)),y=k[0];for(;y&&k.includes(y);)y=y.nextSibling;for(let E of k)E.remove();if(b==="innerHTML"){let E=a.createElement("template");E.innerHTML=g;for(let $ of Array.from(E.content.childNodes))c.insertBefore($,y||null)}else c.insertBefore(a.createTextNode(g),y||null),di(c,g);let _=Ue(c,{capability:"data",exclude:t.exclude||null});f.replaceChildren(...Array.from(_.root?.childNodes||[]));let A=E=>{let $=_.original(E);$&&(n.liveToClone.set($,E),n.cloneToLive.set(E,$));for(let H of Array.from(E.childNodes||[]))A(H)};for(let E of Array.from(f.childNodes))A(E)},u={...F,find(c,f,b={}){let g=h(c);if(!g?.querySelectorAll)return[];let k=s().query(f,g);b.includeRulesTag||(k=k.filter(A=>!hi(A)));let y=[];b.skip&&y.push(b.skip);let _=b.templateAttr===null?null:b.templateAttr||"cms-template";if(_&&y.push(`[${_}]`),y.length){let A=y.join(", ");k=k.filter(E=>!E.closest?.(A))}return k},parent(c){let f=h(c)?.parentElement;return f?d(f):null},children(c){return Array.from(h(c)?.children||[],d)},text(c,f){if(f===void 0){let k=d(c);return!k?.matches?.(r)&&!k?.querySelector?.(r)?F.text(k):(h(c)?.textContent||"").trim()}let b=d(c);if(!b?.matches?.(r)&&!b?.querySelector?.(r)&&!n){F.text(b,f);return}let g=s().cloneOf(b);g?p(b,g,"textContent",f):F.text(b,f)},attr(c,f,b){let g=d(c);if(b===void 0)return F.attr(g,f);F.attr(g,f,b);let k=n?.cloneOf(g);k&&(F.attr(k,f,b),Ue(g,{capability:"data",exclude:t.exclude||null}).root===null&&(k.remove(),n.liveToClone.delete(g),n.cloneToLive.delete(k)))},removeAttr(c,f){let b=d(c);F.removeAttr(b,f);let g=n?.cloneOf(b);g&&F.removeAttr(g,f)},prop(c,f,b){let g=d(c);if(b===void 0)return f==="innerHTML"||f==="outerHTML"||f==="textContent"||f==="innerText"?F.prop(h(g),f):F.prop(g,f);let k=f==="innerHTML"||f==="textContent"||f==="innerText",y=k?s().cloneOf(g):n?.cloneOf(g);y&&k?p(g,y,f,b):(F.prop(g,f,b),y&&F.prop(y,f,b))},clone(c){let f=h(c);if(f===c)return F.clone(c);let b=a.importNode(f,!0);return ui(b),b},insertAt(c,f,b){let g=d(c),k=u.children(g)[b]||(()=>{for(let A=g.children.length-1;A>=0;A--){let E=g.children[A];if(s().cloneOf(E))return E.nextElementSibling}return g.firstElementChild})(),y=d(f);g.insertBefore(y,k||null);let _=s().cloneOf(g);if(_){let A=s().cloneOf(y);A||(A=a.importNode(y,!0),m(y,A));let E=Array.from(_.children);_.insertBefore(A,E[b]||null)}},insertBefore(c,f){let b=d(c),g=d(f);b.parentNode.insertBefore(g,b);let k=s().cloneOf(b.parentNode);if(k){let y=s().cloneOf(g);y||(y=a.importNode(g,!0),m(g,y));let _=s().cloneOf(b);_?_.before(y):k.appendChild(y)}},insertAfter(c,f){let b=d(c),g=d(f);b.parentNode.insertBefore(g,b.nextSibling);let k=s().cloneOf(b.parentNode);if(k){let y=s().cloneOf(g);y||(y=a.importNode(g,!0),m(g,y));let _=s().cloneOf(b);_?_.after(y):k.appendChild(y)}},identity(c){return d(c)||null},remove(c){let f=d(c),b=s().cloneOf(f);F.remove(f),b&&F.remove(b)},replaceWith(c,f){let b=d(c),g=s().cloneOf(b),k=F.replaceWith(b,f);if(g){let y=Ue(k,{capability:"data",exclude:t.exclude||null});if(!y.root)g.remove();else{g.replaceWith(y.root);let _=A=>{let E=y.original(A);E&&(n.liveToClone.set(E,A),n.cloneToLive.set(A,E));for(let $ of Array.from(A.childNodes||[]))_($)};_(y.root)}}return k}};return u}var Tt=F;function ka(e){try{return JSON.parse(e)}catch(t){throw new or(`Invalid strict JSON: ${t.message}`,t)}}function mi(e){try{return JSON.parse(e)}catch{}let t={BRACE_OPEN:"{",BRACE_CLOSE:"}",BRACKET_OPEN:"[",BRACKET_CLOSE:"]",COLON:":",COMMA:",",STRING:"STRING",SELECTOR:"SELECTOR",IDENTIFIER:"IDENTIFIER",NUMBER:"NUMBER",BOOLEAN:"BOOLEAN"};function r(i){let o=[],a=0;for(;a<i.length;){let n=i[a];if(/\s/.test(n)){a++;continue}if("{}".includes(n)){o.push({type:n,value:n}),a++;continue}if(n==="["){let m=!1,p=a+1;for(;p<i.length&&/\s/.test(i[p]);)p++;if(p<i.length&&/[a-zA-Z_]/.test(i[p])&&(m=!0),!m){o.push({type:n,value:n}),a++;continue}}if(n==="]"){o.push({type:n,value:n}),a++;continue}if(n===":"){o.push({type:t.COLON,value:n}),a++;continue}if(n===","){o.push({type:t.COMMA,value:n}),a++;continue}if(n==='"'||n==="'"){let m=n,p=a+1;for(;p<i.length&&i[p]!==m;)i[p]==="\\"&&p++,p++;o.push({type:t.STRING,value:i.substring(a+1,p),quoted:!0,sourceQuote:m}),a=p+1;continue}let s=a,h;for(;s<i.length&&!/[{},]/.test(i[s]);)if(i[s]===":"){let m=[":first",":last",":nth-child",":nth-of-type",":first-child",":last-child",":first-of-type",":last-of-type",":only-child",":only-of-type",":hover",":focus",":active",":visited",":disabled",":enabled",":checked",":empty",":root",":target",":not",":before",":after",":nth-last-child",":nth-last-of-type"],p=!1;for(let u of m){let c=u.substring(1);if(i.substring(s+1,s+1+c.length)===c){p=!0,s+=c.length;break}}if(!p)break}else if(i[s]==="["){for(s++;s<i.length&&i[s]!=="]";){if(i[s]==='"'||i[s]==="'"){let m=i[s];for(s++;s<i.length&&i[s]!==m;)i[s]==="\\"&&s++,s++}s++}s<i.length&&i[s]==="]"&&s++}else s++;h=i.substring(a,s);let d=t.IDENTIFIER;/^-?\d+(\.\d+)?$/.test(h)?d=t.NUMBER:h==="true"||h==="false"||h==="null"?d=t.BOOLEAN:/^[.#@\[]|[.#@\[]| /.test(h)&&(d=t.SELECTOR),o.push({type:d,value:h,quoted:!1}),a=s}return o}function l(i){let o="";for(let a=0;a<i.length;a++){let n=i[a];if("{}".includes(n.type)||"[]".includes(n.type)){o+=n.value;continue}if(n.type===t.COLON){o+=n.value;continue}if(n.type===t.COMMA){let s=i[a+1];if(s&&(s.type==="}"||s.type==="]"))continue;o+=n.value;continue}if(n.type===t.STRING&&n.quoted){let s=n.value;n.sourceQuote==="'"&&(s=s.replace(/\\'/g,"'"),s=s.replace(/(\\*)"/g,(h,d)=>d.length%2===0?d+'\\"':h)),o+=`"${s}"`;continue}if(n.type===t.NUMBER||n.type===t.BOOLEAN){o+=n.value;continue}if(n.type===t.SELECTOR||n.type===t.IDENTIFIER){o+=`"${n.value}"`;continue}o+=`"${n.value}"`}return o}try{let i=r(e),o=l(i);return JSON.parse(o)}catch(i){throw new or("Invalid extraction rules syntax: "+i.message,i)}}var va="1",Qr=/^[a-zA-Z0-9_-]+$/;function pi(e,t,r){let l;if(r===void 0)l="script[data-rules-name]";else{if(typeof r!="string"||!Qr.test(r))throw new Error(`hyper-html-api: invalid rules token ${JSON.stringify(r)} (must match ${Qr})`);l=`script[data-rules-name~="${r}"]`}let i=e.find(t,l,{includeRulesTag:!0});if(i.length===0)return null;r!==void 0&&i.length>1&&console.warn(`hyper-html-api: ${i.length} rules tags match data-rules-name~="${r}"; using the first.`);let o=i[0],a=e.attr(o,"data-rules-version");if(a!==va)throw new ei(a);return{rules:mi(e.text(o)),tagNode:o}}var Rh=new Function("url","return import(url)");function ya(e,t,r,l){let i=e.length,o=t.length,a=new Array(i).fill(-1);if(l){let g=new Set;for(let k=0;k<i;k++){let y=l[k];!(y>=0&&y<o)||g.has(y)||(a[k]=y,g.add(y))}}if(i===0||o===0)return a;let n=e.map(g=>Yr(g,r)),s=t.map(g=>Yr(g,r)),h=new Array(o).fill(!1);for(let g of a)g>=0&&(h[g]=!0);let d=new Map;s.forEach((g,k)=>{h[k]||d.set(g,d.has(g)?-1:k)});let m=new Map;n.forEach((g,k)=>{a[k]>=0||m.set(g,(m.get(g)||0)+1)}),n.forEach((g,k)=>{if(a[k]>=0||m.get(g)!==1)return;let y=d.get(g);y===void 0||y===-1||h[y]||(a[k]=y,h[y]=!0)});let p=[];for(let g=0;g<i;g++)a[g]<0&&p.push(g);let u=[];for(let g=0;g<o;g++)h[g]||u.push(g);if(p.length===0||u.length===0)return a;let c=i*o+1,f=xa(e,t,r),b=(g,k)=>f(g,k)*c+Math.abs(g-k);for(let[g,k]of wa(p,u,b))a[g]=k;return a}var fi=e=>typeof e=="object"&&e!==null;function Yr(e,t){if(!fi(t))return e==null?" null":String(e);let r=Object.keys(t);return JSON.stringify(r.map(l=>{let i=JSON.stringify(e?.[l]);return i===void 0?" undef":i}))}function xa(e,t,r){if(!fi(r))return(n,s)=>e[n]===t[s]?0:1;let l=Object.keys(r),i=n=>l.map(s=>JSON.stringify(n?.[s])),o=e.map(i),a=t.map(i);return(n,s)=>{let h=o[n],d=a[s],m=0;for(let p=0;p<l.length;p++)h[p]!==d[p]&&m++;return m}}function wa(e,t,r){return e.length<=t.length?el(e,t,r,!1):el(t,e,(l,i)=>r(i,l),!0)}function el(e,t,r,l){let i=e.length,o=t.length,a=[];for(let m=0;m<=i;m++)a.push(new Float64Array(o+1).fill(1/0));let n=[];for(let m=0;m<=i;m++)n.push(new Uint8Array(o+1));for(let m=0;m<=o;m++)a[i][m]=0;for(let m=i-1;m>=0;m--)for(let p=o-1;p>=0;p--){let u=r(e[m],t[p])+a[m+1][p+1],c=a[m][p+1];u<=c?(a[m][p]=u,n[m][p]=1):a[m][p]=c}let s=[],h=0,d=0;for(;h<i&&d<o;)n[h][d]&&(s.push(l?[t[d],e[h]]:[e[h],t[d]]),h++),d++;return s}function gi(e,t,r,l,i,o,a,n={}){let s=e.find(t,r,n);if(i.length===0){s.forEach(_=>e.remove(_)),Ht(n,"onRowsApplied",o.path,[]);return}let h=i.length>s.length,d=s[0]||null;if(h&&!d&&(d=Sa(e,t,r,n),!d))throw new Le(o.path);let m=s.map(_=>Ea(e,_,l,n)),p=null;if(h&&d){p=e.clone(d),n.templateAttr&&e.removeAttr(p,n.templateAttr);let _=e.stripIds(p);_>0&&console.warn(`[hyper-html-api] stripped ${_} id attribute(s) from cloned template at "${o.path.join(".")||"(root)"}"`)}let u=ya(i,m,l,Aa(e,s,i,o,n)),c=s.length>0?e.parent(s[0]):qa(e,t,r,d,o,n),f=s.length>0?bi(e,c,s[0]):0,b=La(e,s),g=new Set,k=[],y=i.map((_,A)=>{let E=u[A];if(E>=0)return g.add(E),k.push(!1),s[E];k.push(!0);let $=e.clone(p);return e.stripIds($),$});s.forEach((_,A)=>{g.has(A)||e.remove(_)}),b?Oa(e,c,f,y,k):ja(e,y,k,c,f),_a(e,y,l,i,o,a,n),Ht(n,"onRowsApplied",o.path,y)}function Ht(e,t,r,l){if(typeof e[t]=="function")try{return e[t](r.slice(),l)}catch(i){console.warn(`[hyper-html-api] ${t} threw at "${r.join(".")||"(root)"}"`,i);return}}function Aa(e,t,r,l,i){let o=Ht(i,"identifyRows",l.path,r);if(!Array.isArray(o))return null;let a=new Array(r.length).fill(-1),n=new Set,s=new Map(t.map((h,d)=>[e.identity(h),d]));for(let h=0;h<r.length;h++){if(!o[h])continue;let d=s.get(e.identity(o[h]));d===void 0||n.has(d)||(a[h]=d,n.add(d))}return a}function _a(e,t,r,l,i,o,a){t.forEach((n,s)=>{if(r===null){let h=l[s],d=h==null?"":String(h);e.text(n)!==d&&e.text(n,d)}else{let h=o(e,n,r,l[s],{depth:i.depth+1,path:[...i.path,s]},a);h&&h!==n&&(t[s]=h)}})}function Ea(e,t,r,l){return r===null?e.text(t):Bt(e,t,r,l.onRowsRead?{...l,onRowsRead:void 0}:l)}function bi(e,t,r){let l=e.children(t);for(let i=0;i<l.length;i++)if(e.sameNode(l[i],r))return i;return-1}function Sa(e,t,r,l){if(!l.templateAttr)return null;let i=/^\s*:scope\s*>\s*/.test(r),o=new RegExp(":not\\(\\["+l.templateAttr.replace(/[.*+?^${}()|[\]\\-]/g,"\\$&")+"\\]\\)","g"),a=r.replace(/^\s*:scope\s*>\s*/,"").replace(o,""),n=i?Ca(a):0,s=Ql(a),h=t;for(;h;){let d=e.find(h,a,{includeRulesTag:!1,templateAttr:null});for(let m of d)if(e.attr(m,l.templateAttr)!=null&&!(i&&!Ra(e,t,m,n))&&!(s&&!e.matches(e.parent(m),s)))return m;h=e.parent(h)}return null}function Ca(e){let t=0,r=null,l=1;for(let i=0;i<e.length;i++){let o=e[i];if(o==="\\")i++;else if(r)o===r&&(r=null);else if(o==='"'||o==="'")r=o;else if(o==="["||o==="(")t++;else if(o==="]"||o===")")t>0&&t--;else if(t===0&&o===">")l++;else{if(t===0&&(o==="+"||o==="~"))return null;if(t===0&&/\s/.test(o)){if(!Ta(e,i))return null;for(;i+1<e.length&&/\s/.test(e[i+1]);)i++}}}return l}function Ta(e,t){let r=t;for(;r<e.length&&/\s/.test(e[r]);)r++;let l=t>0?e[t-1]:"",i=r<e.length?e[r]:"";return tl(l)||tl(i)}function tl(e){return e===">"||e==="+"||e==="~"}function Ra(e,t,r,l){if(l===null)return!0;let i=r;for(let s=0;s<l;s++)if(i=e.parent(i),!i)return!1;let o=e.prop(t,"tagName");if(!o)return!0;let a=e.prop(i,"tagName");if(!a||String(a).toLowerCase()!==String(o).toLowerCase())return!1;let n=new Set(rl(e,i));return rl(e,t).every(s=>n.has(s))}function rl(e,t){let r=e.attr(t,"class");return r?String(r).split(/\s+/).filter(Boolean):[]}function qa(e,t,r,l,i,o){let a=e.parent(l);if(a&&$a(e,t,a)&&!il(e,a,o))return a;let n=Ql(r);if(!n)throw new Le(i.path,`the list selector "${r}" names no container to hold the new rows \u2014 write it as "container > row" (for example "ol.comments > li") so the cloned row lands in the list`);let s=(n===":scope"?e.prop(t,"tagName")?[t]:[]:e.find(t,n,o)).filter(h=>!il(e,h,o));if(s.length===0)throw new Le(i.path,`no container matching "${n}" inside this context to hold the new rows`);if(s.length>1)throw new Le(i.path,`"${n}" matches ${s.length} containers inside this context, so the new rows have no single destination`);return s[0]}function $a(e,t,r){let l=r;for(;l;){if(e.sameNode(l,t))return!0;l=e.parent(l)}return e.parent(t)?!1:e.find(t,"*",{includeRulesTag:!0,templateAttr:null}).some(i=>e.sameNode(i,r))}var ll=["no-data","editor-ui"];function il(e,t,r){let l=t;for(;l;){if(r.templateAttr&&e.attr(l,r.templateAttr)!=null||ll.some(o=>e.attr(l,o)!=null))return!0;let i=e.attr(l,"clay");if(i&&i.split(/\s+/).some(o=>ll.includes(o)))return!0;l=e.parent(l)}return!1}function Oa(e,t,r,l,i){let o=e.children(t),a=o.map(s=>e.identity(s)),n=!1;l.forEach((s,h)=>{let d=e.identity(s),m=r+h;if(a[m]===d)return;if(!i[h]){let u=a.indexOf(d);u!==-1&&(a.splice(u,1),o.splice(u,1))}let p=Math.min(m,o.length);p<o.length?e.insertBefore(o[p],s):o.length?n?e.insertAfter(o[o.length-1],s):(e.insertAt(t,s,m),n=!0):e.insertAt(t,s,0),a.splice(p,0,d),o.splice(p,0,s)})}function La(e,t){if(t.length<=1)return!0;let r=e.parent(t[0]);if(!r)return!1;let l=new Map(e.children(r).map((o,a)=>[e.identity(o),a])),i=[];for(let o of t){let a=l.get(e.identity(o));if(a===void 0)return!1;i.push(a)}return i.sort((o,a)=>o-a),i[i.length-1]-i[0]===i.length-1}function ja(e,t,r,l,i){let o=null,a=i;for(let n=0;n<t.length;n++){if(!r[n]){o=t[n];continue}let s=o?e.parent(o):l;if(!s)continue;let h=o?bi(e,s,o)+1:a++;e.insertAt(s,t[n],h),o=t[n]}}function ol(e,t,r,l,i={}){if(Object.prototype.hasOwnProperty.call(i,"exclude")&&e.semanticExclude===!1)throw new Error("This adapter does not support semantic exclude queries; omit exclude or use the DOM adapter.");let o=[];if(Ut(r,l,[],o),o.length)throw new ti(o);rt(e,t,r,l,{depth:0,path:[]},i)}function rt(e,t,r,l,i,o={}){if(i.depth>ft)throw new ar(i.path);if(l===void 0)return t;if(typeof r=="string")return Na(e,t,r,l,i,o);if(Array.isArray(r)){let[a,n]=r;return gi(e,t,a,n,l,i,rt,o),t}if(typeof r=="object"&&r!==null){for(let[a,n]of Object.entries(r)){let s=rt(e,t,n,l==null?l:l[a],{depth:i.depth+1,path:[...i.path,a]},o);s&&s!==t&&(t=s)}return t}return t}function Na(e,t,r,l,i,o){if(r.endsWith("[]")){let s=r.slice(0,-2);return gi(e,t,s,null,l,i,rt,o),t}if(r.startsWith("@"))return nl(e,t,r.slice(1),l);let a=P(r);if(a!==-1){let s=r.slice(0,a),h=r.slice(a+1),d=s?e.find(t,s,o):[t];return d.length===0||nl(e,d[0],h,l),t}if(r===".")return al(e,t,l),t;let n=e.find(t,r,o);return n.length===0||al(e,n[0],l),t}function al(e,t,r){let l=r==null?"":String(r);e.text(t)!==l&&e.text(t,l)}function nl(e,t,r,l){if(li(r)){let i=l==null?"":String(l).trim(),o=e.attr(t,"style");if((ai(o,r)??"")===i)return t;let a=na(o,r,i);return a==null?e.removeAttr(t,"style"):e.attr(t,"style",a),t}if(Zl.has(r)){let i=e.prop(t,r);if(i===l||i!=null&&l!=null&&String(i)===String(l))return t;throw new ri(r)}if(r==="outerHTML"){let i=l==null?"":String(l);return e.replaceWith(t,i)}if(Zo.has(r)){let i=Qo(r,l);return e.prop(t,r)!==i&&e.prop(t,r,i),t}if(l==null)e.attr(t,r)!=null&&e.removeAttr(t,r);else{let i=String(l);e.attr(t,r)!==i&&e.attr(t,r,i)}return t}function Ut(e,t,r,l){if(t!==void 0){if(typeof e=="string"){if(e.endsWith("[]")){Array.isArray(t)?t.forEach((i,o)=>{typeof i=="object"&&i!==null&&l.push({path:qe([...r,o]),expected:"scalar",got:Re(i)})}):l.push({path:qe(r),expected:"array",got:Re(t)});return}t!==null&&typeof t=="object"&&l.push({path:qe(r),expected:"scalar",got:Re(t)});return}if(Array.isArray(e)){if(!Array.isArray(t)){l.push({path:qe(r),expected:"array",got:Re(t)});return}let i=e[1];t.forEach((o,a)=>Ut(i,o,[...r,a],l));return}if(typeof e=="object"&&e!==null){if(t===null||Array.isArray(t)||typeof t!="object"){l.push({path:qe(r),expected:"object",got:Re(t)});return}for(let[i,o]of Object.entries(e))Ut(o,t[i],[...r,i],l)}}}function Re(e){return e===null?"null":Array.isArray(e)?"array":typeof e}function qe(e){return e.join(".")}var qh=Object.freeze({refusedRuleForms:["innerHTML","outerHTML"],refusedTargets:["script","style","template","noscript","iframe","object","embed","xmp","plaintext","noembed","noframes","meta","link","base","animate","set","animatemotion","animatetransform"],refusedAttributes:["style","srcdoc","is","http-equiv","sandbox","allow","nonce","integrity","charset","htmlclaytoken","htmlclayid","data-rules-name","data-rules-version","clay","contenteditable",...ha],refusedAttributePrefixes:["on"],urlAttributes:["href","src","srcset","action","formaction","poster","cite","data","ping","background","longdesc","usemap","xlink:href","manifest","codebase","icon"],refusedSchemes:["javascript","vbscript","data"],customPropertyValues:Object.freeze({maxLength:200,refusedCharacters:[";","{","}","<",">","\\"],refusedFunctions:["url","src","image","image-set","-webkit-image-set","cross-fade","element","expression","paint"]})});function sl(e,t,r){if(r&&typeof r=="object")return{rules:r,tagNode:null};if(typeof r=="string"){let l=t&&t.ownerDocument?t.ownerDocument:t;return pi(e,l,r)}return null}var Z={extract:(e,t,r={})=>Bt(ge(e,r),e,t,r),apply:(e,t,r,l={})=>ol(ge(e,{...l,_write:!0}),e,t,r,l),findRulesIn:(e,t)=>pi(Tt,e,t),findRules:(e,t)=>sl(Tt,e,t),bind:(e,t,r={})=>{let l=sl(Tt,e,t);if(!l){let i=typeof t=="string"?`data-rules-name~="${t}"`:"the provided rules object";throw new Error(`hyper-html-api: could not resolve rules for ${i}`)}return{...l,get:()=>Bt(ge(e,r),e,l.rules,r),set:i=>ol(ge(e,{...r,_write:!0}),e,l.rules,i,r)}},parseStrict:ka,parseRelaxed:mi,ruleAttrIndex:P,splitRule:Yo,errors:Yl,DOM_PROPERTIES:Kl},ki={};ir(ki,{fromString:()=>ve,getRuleAtPath:()=>lt,getValueAtPath:()=>za,setAtPath:()=>Vt,toString:()=>Ma});function Ma(e){return e.map(String).join(".")}function ve(e){return e===""?[]:e.split(".").map(t=>/^\d+$/.test(t)?Number(t):t)}function lt(e,t){let r=e;for(let l of t){if(r==null)return;if(typeof r=="string"){if(r.endsWith("[]")&&(typeof l=="number"||l==="*")){r=r.slice(0,-2);continue}return}if(Array.isArray(r)){if(typeof l!="number"&&l!=="*")return;r=r[1];continue}if(typeof r=="object"){if(typeof l=="number"||!(l in r))return;r=r[l];continue}return}return r}function za(e,t){let r=e;for(let l of t){if(r==null)return;r=r[l]}return r}function Vt(e,t,r){if(t.length===0)return r;let[l,...i]=t;if(typeof l=="number"){let o=Array.isArray(e)?[...e]:[];return o[l]=Vt(o[l],i,r),o}return{...e&&typeof e=="object"?e:{},[l]:Vt((e||{})[l],i,r)}}function sr(e){if(typeof e=="string")return e.endsWith("[]")?[]:"";if(Array.isArray(e))return[];if(typeof e=="object"&&e!==null){let t={};for(let[r,l]of Object.entries(e))t[r]=sr(l);return t}return""}function vi(e,t,{ignoreActiveValue:r=!0}={}){Hr.morph(e,t,{morphStyle:"innerHTML",ignoreActiveValue:r,restoreFocus:!0,formStateSync:"property",policy:"raw"})}var yi=new WeakMap,Wt=e=>e.map(String).join(".");function Fa(e){return typeof CSS<"u"&&CSS.escape?CSS.escape(e):String(e).replace(/[^a-zA-Z0-9_\-.*]/g,t=>"\\"+t)}function xi(e,t){if(!e||!e.querySelector)return null;let r=e.querySelector(`[data-hcms-path="${Fa(t)}"]`),l=r&&r.querySelector(".hcms-array-items");return l?Array.from(l.children).filter(i=>i.matches&&i.matches("[data-hcms-card], [data-hcms-array-item]")):null}function wi(e,t,r){let l=xi(e,t);!l||l.length!==r.length||l.forEach((i,o)=>{r[o]&&yi.set(i,r[o])})}function Ai(){let e=new Map;return{hooks:{onRowsRead(t,r){e.set(Wt(t),r)}},seed(t){for(let[r,l]of e)wi(t,r,l);e.clear()}}}function Da(e){return{identifyRows(t,r){let l=xi(e,Wt(t));return!l||l.length!==r.length?null:l.map(i=>yi.get(i)||null)},onRowsApplied(t,r){wi(e,Wt(t),r)}}}function se(e){return e&&e.nodeType===9?e.body||e.documentElement:e}var cl={skip:"[data-hcms-shell]",templateAttr:"cms-template"},Gt="data-hcms-rollback-ui",Ba=0;function Ia(e,t,r,l={}){return Pa(e,t,r,l)}function Pa(e,t,r,l){let{shellRoot:i,structural:o,structuralPath:a,formRoot:n}=l,s=n?{...cl,...Da(n)}:cl;if(!o)try{return Z.apply(e,t,r,s),{ok:!0}}catch(p){return{ok:!1,error:p}}let h=Ha(e,t,a),d=h?Va(h):null,m=h?null:Ga(se(e),i);try{return Z.apply(e,t,r,s),{ok:!0}}catch(p){return d?Wa(h,d):m&&Ja(se(e),i,m),{ok:!1,error:p}}}function Ha(e,t,r){if(!r||!e)return null;let l=ve(r),i=[],o=t;for(let a of l){if(typeof o=="string"||o==null||Array.isArray(o))break;if(typeof o=="object"&&a in o){if(i.push(a),o=o[a],Array.isArray(o)||typeof o=="string"&&o.endsWith("[]"))break}else return null}return!Array.isArray(o)&&!(typeof o=="string"&&o.endsWith("[]"))?null:Ua(e,t,i)}function Ua(e,t,r){if(r.length===0)return null;let l=e,i=t;for(let o=0;o<r.length;o++){let a=r[o];if(!i||typeof i!="object"||Array.isArray(i))return null;let n=i[a];if(n==null)return null;if(o===r.length-1){if(Array.isArray(n)){let[s]=n;return l.querySelector?.(s)?.parentElement||null}if(typeof n=="string"&&n.endsWith("[]")){let s=n.slice(0,-2);return l.querySelector?.(s)?.parentElement||null}return null}i=n}return null}function Va(e){let t=[],r=[];for(let l of Array.from(e.childNodes))t.push(cr(l,r));return{nodes:t,retained:r}}function Wa(e,t){let r=e.cloneNode(!1);for(let l of t.nodes)r.appendChild(l);Te(e,Array.from(r.childNodes),Ei()),_i(e,t.retained)}function Ga(e,t){let r=[],l=[];for(let i of Array.from(e.childNodes))i===t||t&&i.contains?.(t)||r.push(cr(i,l));return{nodes:r,retained:l}}function Ja(e,t,r){let l=e.cloneNode(!1);for(let i of r.nodes)l.appendChild(i);Te(e,Array.from(l.childNodes),Ei()),_i(e,r.retained)}function cr(e,t){let r=e.cloneNode(!1);if(e.nodeType===1&&e.matches('[editor-ui],[clay~="editor-ui"]')){let o=String(++Ba);r.setAttribute(Gt,o),t.push({id:o,node:e})}let l=e.nodeType===1&&e.tagName==="TEMPLATE"?e.content:e,i=r.nodeType===1&&r.tagName==="TEMPLATE"?r.content:r;for(let o of Array.from(l.childNodes||[]))i.appendChild(cr(o,t));return r}function _i(e,t){for(let{id:r,node:l}of t){let i=e.querySelector(`[${Gt}="${r}"]`);i===l?l.removeAttribute(Gt):l.isConnected?i?.remove():i?.replaceWith(l)}}function Ei(){return{morphStyle:"innerHTML",policy:"raw",restoreFocus:!1,scripts:{handle:!1,merge:!1}}}function Fe(e){return e.replace(/([a-z])([A-Z])/g,"$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g,"$1 $2").replace(/[-_]/g," ").replace(/\s+/g," ").trim().replace(/^./,t=>t.toUpperCase())}var Xa='<div class="hcms-drag-handle mirk-sortable__grip" aria-hidden="true"><div class="mirk-sortable__dots"><span class="mirk-sortable__dot"></span><span class="mirk-sortable__dot"></span><span class="mirk-sortable__dot"></span><span class="mirk-sortable__dot"></span><span class="mirk-sortable__dot"></span><span class="mirk-sortable__dot"></span><span class="mirk-sortable__dot"></span><span class="mirk-sortable__dot"></span></div></div>',Ve='<svg class="hcms-x" viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true"><path d="M4 4 L12 12 M12 4 L4 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square"></path></svg>',Si={"@scalar":`
    <label class="hcms-field" data-hcms-shape="scalar">
      <span class="hcms-label" data-hcms-label></span>
      <textarea class="mirk-textarea" rows="1" data-hcms-field></textarea>
      <div class="hcms-error" hidden></div>
    </label>
  `,"@object":`
    <section class="hcms-object" data-hcms-shape="object">
      <h3 class="hcms-object-title" data-hcms-label></h3>
      <div class="hcms-object-fields"></div>
      <div class="hcms-error" hidden></div>
    </section>
  `,"@scalar-array":`
    <section class="hcms-array hcms-scalar-array" data-hcms-shape="scalar-array">
      <header class="hcms-array-header">
        <h3 class="hcms-array-title" data-hcms-label></h3>
      </header>
      <ul class="hcms-array-items"></ul>
      <div class="hcms-error" hidden></div>
      <button type="button" class="hcms-add mirk-button mirk-button--small" data-hcms-action="add"><span class="mirk-button__label">+ Add</span></button>
    </section>
  `,"@scalar-array-item":`
    <li class="hcms-array-item" draggable="true">
      <input class="mirk-input" data-hcms-field />
      <button type="button" class="hcms-move hcms-move-up hcms-sr-only" data-hcms-action="move-up" aria-label="Move up">\u2191</button>
      <button type="button" class="hcms-move hcms-move-down hcms-sr-only" data-hcms-action="move-down" aria-label="Move down">\u2193</button>
      <button type="button" class="hcms-remove" data-hcms-action="remove" aria-label="Remove">\xD7</button>
      <div class="hcms-error" hidden></div>
    </li>
  `,"@object-array":`
    <section class="hcms-array hcms-object-array hcms-array--cards" data-hcms-shape="object-array">
      <header class="hcms-array-header">
        <h3 class="hcms-array-title" data-hcms-label></h3>
      </header>
      <div class="hcms-array-items"></div>
      <div class="hcms-error" hidden></div>
      <button type="button" class="hcms-add mirk-button mirk-button--small" data-hcms-action="add"><span class="mirk-button__label">+ Add</span></button>
    </section>
  `,"@object-array-item":`
    <article class="hcms-card mirk-sortable__item" draggable="true">
      ${Xa}
      <div class="hcms-card-body mirk-sortable__body">
        <div class="hcms-card-fields"></div>
        <div class="hcms-card-controls">
          <button type="button" class="hcms-move hcms-move-up hcms-sr-only" data-hcms-action="move-up" aria-label="Move up">\u2191</button>
          <button type="button" class="hcms-move hcms-move-down hcms-sr-only" data-hcms-action="move-down" aria-label="Move down">\u2193</button>
          <button type="button" class="hcms-remove hcms-remove--card" data-hcms-action="remove" aria-label="Remove">${Ve}</button>
        </div>
      </div>
      <div class="hcms-error" hidden></div>
    </article>
  `,"@file":`
    <div class="hcms-field hcms-upload hcms-upload--file" data-hcms-shape="scalar">
      <span class="hcms-label" data-hcms-label></span>
      <div class="mirk-file mirk-file--compact mirk-file--round">
        <label class="mirk-button mirk-button--round mirk-button--small">
          <input type="file" data-hcms-upload />
          <span class="mirk-button__label">Choose</span>
        </label>
        <a class="mirk-file__name" data-hcms-field></a>
        <button type="button" class="hcms-upload-clear" data-hcms-action="clear-upload" aria-label="Remove file">${Ve}</button>
      </div>
      <div class="hcms-error" hidden></div>
    </div>
  `,"@image":`
    <div class="hcms-field hcms-upload hcms-upload--image" data-hcms-shape="scalar">
      <span class="hcms-label" data-hcms-label></span>
      <div class="mirk-image mirk-image--compact mirk-image--rounded">
        <label class="mirk-button mirk-button--small mirk-image__upload">
          <input type="file" accept="image/*" data-hcms-upload />
          <span class="mirk-button__label">Upload image</span>
        </label>
        <figure class="mirk-image__thumb">
          <span class="mirk-image__frame"><img class="mirk-image__preview" data-hcms-field alt="" /></span>
          <button type="button" class="hcms-upload-clear hcms-upload-clear--badge" data-hcms-action="clear-upload" aria-label="Remove image">${Ve}</button>
        </figure>
      </div>
      <div class="hcms-error" hidden></div>
    </div>
  `,"@checkbox":`
    <div class="hcms-field hcms-field--row" data-hcms-shape="scalar">
      <span class="hcms-label" data-hcms-label></span>
      <label class="mirk-checkbox">
        <input type="checkbox" class="mirk-sr-only" data-hcms-field />
        <span class="mirk-checkbox__box"><span class="mirk-checkbox__mark"></span></span>
      </label>
      <div class="hcms-error" hidden></div>
    </div>
  `,"@toggle":`
    <div class="hcms-field hcms-field--row" data-hcms-shape="scalar">
      <span class="hcms-label" data-hcms-label></span>
      <label class="mirk-toggle">
        <input type="checkbox" role="switch" class="mirk-sr-only" data-hcms-field />
        <span class="mirk-toggle__track"><span class="mirk-toggle__thumb"></span></span>
      </label>
      <div class="hcms-error" hidden></div>
    </div>
  `,"@select":`
    <label class="hcms-field" data-hcms-shape="scalar">
      <span class="hcms-label" data-hcms-label></span>
      <div class="mirk-select">
        <select class="mirk-select__field" data-hcms-field></select>
        <span aria-hidden="true" class="mirk-select__chevron">\u203A</span>
      </div>
      <div class="hcms-error" hidden></div>
    </label>
  `,"@radio":`
    <div class="hcms-field" data-hcms-shape="scalar">
      <span class="hcms-label" data-hcms-label></span>
      <div class="hcms-radio-row">
        <label class="mirk-radio">
          <input type="radio" class="mirk-sr-only" data-hcms-field />
          <span class="mirk-radio__ring"><span class="mirk-radio__fill"></span><span class="mirk-radio__dot"></span></span>
          <span class="mirk-radio__label"></span>
        </label>
      </div>
      <div class="hcms-error" hidden></div>
    </div>
  `,"@textarea":`
    <label class="hcms-field" data-hcms-shape="scalar">
      <span class="hcms-label" data-hcms-label></span>
      <textarea class="mirk-textarea" rows="3" data-hcms-field></textarea>
      <div class="hcms-error" hidden></div>
    </label>
  `,"@richtext":`
    <div class="hcms-field" data-hcms-shape="scalar">
      <span class="hcms-label" data-hcms-label></span>
      <div class="mirk-textarea hcms-richtext" contenteditable="true" data-hcms-field></div>
      <div class="hcms-error" hidden></div>
    </div>
  `,"@number":`
    <label class="hcms-field" data-hcms-shape="scalar">
      <span class="hcms-label" data-hcms-label></span>
      <input class="mirk-input" type="number" data-hcms-field />
      <div class="hcms-error" hidden></div>
    </label>
  `,"@color":`
    <div class="hcms-field hcms-color" data-hcms-shape="scalar">
      <span class="hcms-label" data-hcms-label></span>
      <input type="hidden" data-hcms-field />
      <div class="hcms-color-row">
        <button type="button" class="hcms-color-current" data-hcms-action="color-panel" aria-expanded="false">
          <span class="hcms-color-chip"></span>
          <span class="hcms-color-name"></span>
        </button>
        <button type="button" class="hcms-color-clear" data-hcms-action="color-clear" aria-label="Clear color">${Ve}</button>
      </div>
      <div class="hcms-color-panel" hidden>
        <div class="hcms-color-grid"></div>
        <div class="hcms-color-custom">
          <input type="color" class="hcms-color-native" data-hcms-color-input="native" aria-label="Pick a custom color" />
          <input class="mirk-input hcms-color-text" data-hcms-color-input="text" spellcheck="false" autocomplete="off" placeholder="Any CSS color" aria-label="Custom color" />
        </div>
      </div>
      <div class="hcms-error" hidden></div>
    </div>
  `,"@font":`
    <div class="hcms-field hcms-font" data-hcms-shape="scalar">
      <span class="hcms-label" data-hcms-label></span>
      <input type="hidden" data-hcms-field />
      <button type="button" class="hcms-font-current" data-hcms-action="font-panel" aria-haspopup="listbox" aria-expanded="false">
        <span class="hcms-font-name"></span>
        <span aria-hidden="true" class="hcms-font-chevron">\u203A</span>
      </button>
      <div class="hcms-font-panel" hidden>
        <div class="hcms-font-list" role="listbox"></div>
      </div>
      <div class="hcms-error" hidden></div>
    </div>
  `,"@variant":`
    <div class="hcms-field hcms-variant" data-hcms-shape="scalar">
      <span class="hcms-label" data-hcms-label></span>
      <div class="hcms-variant-row" role="radiogroup">
        <label class="hcms-variant-option">
          <input type="radio" class="mirk-sr-only" data-hcms-field />
          <span class="hcms-variant-icon"></span>
          <span class="hcms-variant-label"></span>
        </label>
      </div>
      <div class="hcms-error" hidden></div>
    </div>
  `,"@chips":`
    <div class="hcms-field hcms-chips" data-hcms-shape="scalar-array">
      <span class="hcms-label" data-hcms-label></span>
      <div class="mirk-tags hcms-array-items"></div>
      <button type="button" class="hcms-add mirk-button mirk-button--small" data-hcms-action="add"><span class="mirk-button__label">+ Add</span></button>
      <div class="hcms-error" hidden></div>
    </div>
  `,"@chips-item":`
    <span class="mirk-tags__chip" data-hcms-array-item>
      <input class="hcms-chip-field" data-hcms-field aria-label="Item" placeholder="\u2026" />
      <button type="button" class="hcms-remove" data-hcms-action="remove" aria-label="Remove">\xD7</button>
    </span>
  `},Ka=["@scalar","@object","@scalar-array","@scalar-array-item","@object-array","@object-array-item"];function Ci(e){let t=e.head||e.documentElement;if(t)for(let r of Ka)Oi(e,t,r)}function Rt(e,t){if(!Si[t])return null;let r=e&&(e.head||e.documentElement);return r?Oi(e,r,t):null}var hl={src:"@image",checked:"@checkbox",innerHTML:"@richtext"},it={image:"@image",file:"@file",checkbox:"@checkbox",toggle:"@toggle",select:"@select",radio:"@radio",textarea:"@textarea",number:"@number",richtext:"@richtext",color:"@color",font:"@font",variant:"@variant"},Za=new Set([...Object.values(it),"@chips","@chips-item"]);function De(e,t,r,l){if(typeof e!="string")return"@scalar";let i=P(e),o=qi(e,i,r,l),a=gt(e,i,r,l,t,"data-hcms-component");if(a&&it[a]){let n=it[a],s=Array.isArray(r)&&r.some(h=>h==="*"||typeof h=="number");return n==="@number"&&!dl(e,i,t,s,o).every(rn)||(n==="@checkbox"||n==="@toggle")&&(i<0||e.slice(i+1)!=="checked")&&!dl(e,i,t,s,o).every(ln)?"@scalar":n}if(i>=0){let n=e.slice(i+1);if(hl[n])return hl[n];if(/^--color(-|$)/.test(n))return"@color";if(/^--font(-|$)/.test(n))return"@font"}return"@scalar"}function Qa(e,t,r,l){if(typeof e!="string")return null;let i=P(e),o=gt(e,i,r,l,t,"data-hcms-component");return o&&it[o]||null}var Ya=new Set(["@color","@font","@variant"]),en=new Set(["html","body",":root"]);function hr(e,t,r,l){if(typeof e!="string"||e.endsWith("[]")||!Ya.has(De(e,t,r,l)))return null;let i=Array.isArray(r)&&r.some(a=>a==="*"||typeof a=="number"),o=Ri(e,P(e)).trim();return!i&&en.has(o)?"page":"section"}var tn=/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;function rn(e){return e==null||e===""?!0:tn.test(String(e))}function ln(e){return e==null||e===""||e==="true"||e==="false"}function dl(e,t,r,l,i){if(!r||!r.querySelectorAll)return[];if(!i||i===".")return[];let o=null;try{o=r.querySelectorAll(i)}catch{return[]}let a=t>=0?e.slice(t+1):null,n=[];for(let s of o)if(!(s.closest&&s.closest("[cms-template], [data-hcms-shell]"))&&(a?a==="value"&&"value"in s?n.push(s.value):n.push(s.getAttribute?s.getAttribute(a):null):n.push((s.textContent||"").trim()),!l))break;return n}function dr(e,t){if(typeof e!="string"||!e.endsWith("[]")||!t||!t.querySelector)return null;let r=e.slice(0,-2).trim();if(!r)return null;let l=null;try{l=t.querySelector(r)}catch{return null}let i=l&&l.closest?l.closest("[data-hcms-component]"):null;return(i&&i.getAttribute?i.getAttribute("data-hcms-component"):null)==="chips"?{array:"@chips",item:"@chips-item"}:null}function Be(e,t,r){let l=e.join("."),i=e.map(o=>typeof o=="number"?"*":o).join(".");return l&&ee(r,l)||i&&i!==l&&ee(r,i)||ee(r,t)}function Ti(e,t,r){let l=dr(e,r);if(!l)return null;let i=Be(t,l.array,r);return i&&i.getAttribute("data-hcms-tpl")===l.array?l:null}function Xe(e,t,r,l){if(typeof e!="string")return null;let i=P(e),o=gt(e,i,r,l,t,"data-hcms-options");if(o==null)return null;let a=o.trim().split(/\s+/).filter(Boolean);return a.length?a:null}function on(e,t,r,l){if(typeof e!="string")return null;let i=P(e);return gt(e,i,r,l,t,"data-hcms-crop")}function Ri(e,t){return t>=0?e.slice(0,t):e}function qi(e,t,r,l){let i=Ri(e,t);return i&&i!=="."?i:an(l,r)}function an(e,t){if(e==null||!Array.isArray(t))return"";let r=[],l=e;for(let i of t){if(l==null||typeof l=="string")break;if(Array.isArray(l)){if(typeof l[0]!="string"||i!=="*"&&typeof i!="number")return"";r.push(l[0]),l=l[1];continue}if(typeof l!="object"||!Object.prototype.hasOwnProperty.call(l,i))return"";l=l[i]}return r.join(" ")}function ul(e,t,r){if(!t||!t.querySelector||!e||e===".")return null;let l=null;try{l=t.querySelector(e)}catch{return null}return l&&l.getAttribute?l.getAttribute(r):null}function gt(e,t,r,l,i,o){let a=qi(e,t,r,l),n=t>=0?e.slice(t+1):null;if(n){let s=ul(a,i,`${o}:${n}`);if(s!=null)return s;if(n.startsWith("--"))return null}return ul(a,i,o)}function $i(e,t){if(!e||t==null)return;r(t,[]);function r(l,i){let o=bt(l);if(o==="scalar"){let a=De(l,e,i,t);Za.has(a)&&Rt(e,a);return}if(o==="scalar-array"){let a=dr(l,e);a&&(Rt(e,a.array),Rt(e,a.item));return}if(o==="object"){for(let[a,n]of Object.entries(l))r(n,[...i,a]);return}if(o==="object-array"){let a=l[1],n=[...i,"*"];if(a&&typeof a=="object"&&!Array.isArray(a))for(let[s,h]of Object.entries(a))r(h,[...n,s]);else r(a,n)}}}function Oi(e,t,r){let l=ee(e,r);if(l)return l;let i=e.createElement("template");return i.setAttribute("data-hcms-tpl",r),i.setAttribute("save-remove",""),i.innerHTML=Si[r].trim(),t.appendChild(i),i}function ee(e,t){return!e||!e.querySelector?null:e.querySelector(`template[data-hcms-tpl="${nn(t)}"]`)}function nn(e){return typeof CSS<"u"&&CSS.escape?CSS.escape(e):String(e).replace(/[^a-zA-Z0-9_\-.*]/g,t=>"\\"+t)}function bt(e){return typeof e=="string"?e.endsWith("[]")?"scalar-array":"scalar":Array.isArray(e)?"object-array":typeof e=="object"&&e!==null?"object":"scalar"}function ur(e){return e?!!(e.content||e).querySelector("[data-hcms-field]"):!1}var ml={IMG:"src",A:"href"};function mr(e){if(!e)return"value";let t=(e.tagName||"").toUpperCase();return t==="INPUT"?(e.getAttribute("type")||"text").toLowerCase()==="checkbox"?"checked":"value":t==="TEXTAREA"||t==="SELECT"?"value":ml[t]?ml[t]:e.hasAttribute&&e.hasAttribute("contenteditable")?"innerHTML":null}function pl(e,t){let r=(e.tagName||"").toUpperCase(),l=(e.getAttribute&&e.getAttribute("type")||"").toLowerCase(),i=mr(e),o=`${Li(r,l)}[data-hcms-field="${oe(t)}"]`;return r==="INPUT"&&l==="radio"?`${o}:checked@value`:i?`${o}@${i}`:o}function sn(e){let t=(e.tagName||"").toUpperCase(),r=(e.getAttribute&&e.getAttribute("type")||"").toLowerCase(),l=mr(e),i=`${Li(t,r)}[data-hcms-field]`;return t==="INPUT"&&r==="radio"?`${i}:checked@value`:l?`${i}@${l}`:i}function Li(e,t){return e==="INPUT"?t?`input[type="${t}"]`:"input":e==="TEXTAREA"?"textarea":e==="SELECT"?"select":e==="IMG"?"img":e==="A"?"a":':not([data-hcms-shape="scalar"]):not([data-hcms-shape="object"]):not([data-hcms-shape="object-array"]):not([data-hcms-shape="scalar-array"])'}function oe(e){return typeof CSS<"u"&&CSS.escape?CSS.escape(e):String(e).replace(/[^a-zA-Z0-9_\-.*]/g,t=>"\\"+t)}var fl=new Set(["__proto__","constructor","prototype"]);function cn(e){let t=new Map;return r(e,null),t;function r(l,i){if(typeof l=="string"){typeof i=="string"&&!l.endsWith("[]")&&t.set(i,(t.get(i)||0)+1);return}if(Array.isArray(l)){r(l[1],null);return}if(l&&typeof l=="object")for(let[o,a]of Object.entries(l))r(a,o)}}function ji(e,t){let r=cn(e);return l(e,[]);function l(m,p){let u=bt(m);if(u==="scalar")return i(m,p);if(u==="scalar-array")return a(m,p);if(u==="object-array")return n(m,p);if(u==="object"){let c=Object.create(null);for(let[f,b]of Object.entries(m)){if(fl.has(f))throw new Error(`hypercms: rule key "${f}" is forbidden at "${p.join(".")||"<root>"}"`);c[f]=l(b,[...p,f])}return c}return null}function i(m,p){let u=p.length?p[p.length-1]:null,c=typeof u=="string"?u:"__value",f=d(p,c);if(f)return pl(f,c);let b=h(De(m,t,p,e),c);return b?o(p,c,pl(b,c)):o(p,c,`input[data-hcms-field="${oe(c)}"]@value`)}function o(m,p,u){if((r.get(p)||0)<2)return u;let c=-1;if(m.forEach((b,g)=>{(b==="*"||typeof b=="number")&&(c=g)}),c===-1)return`[data-hcms-path="${oe(m.join("."))}"] ${u}`;let f=m.slice(c+1);return f.length<2?u:`[data-hcms-path$=".${oe(f.join("."))}"] ${u}`}function a(m,p){let u=Ti(m,p,t),c=u&&h(u.item,null)||h("@scalar-array-item",null),f=c?sn(c):"input[data-hcms-field]@value";return[s(p,"[data-hcms-array-item]"),f]}function n(m,p){let[,u]=m,c=[...p,"*"],f=s(p,"[data-hcms-card]");if(u&&typeof u=="object"&&!Array.isArray(u)){let b=Object.create(null);for(let[g,k]of Object.entries(u)){if(fl.has(g))throw new Error(`hypercms: rule key "${g}" is forbidden at "${c.join(".")}"`);b[g]=l(k,[...c,g])}return[f,b]}return[f,l(u,[...c,0])]}function s(m,p){let u=m.length?m[m.length-1]:"",c=m.some(b=>b==="*"),f=m.join(".");return`${c?`[data-hcms-field="${oe(u)}"]`:`[data-hcms-path="${oe(f)}"]`} > .hcms-array-items > ${p}`}function h(m,p){if(!t)return null;let u=ee(t,m);if(!u)return null;let c=u.content||u;if(p){let f=c.querySelector(`[data-hcms-field="${oe(p)}"]`);if(f)return f}return c.querySelector("[data-hcms-field]")}function d(m,p){if(!t)return null;let u=m.map(f=>typeof f=="number"?"*":f).join("."),c=[m.join("."),u];for(let f=m.length-1;f>=0;f--){let b=m.slice(0,f).map(g=>typeof g=="number"?"*":g);b.push("*"),c.push(b.join("."))}for(let f of c){if(!f)continue;let b=ee(t,f);if(!b||!ur(b))continue;let g=b.content||b,k=g.querySelector(`[data-hcms-field="${oe(p)}"]`)||g.querySelector("[data-hcms-field]");if(k)return k}return null}}var hn=["50","100","200","300","400","500","600","700","800","900","950"],dn=["red","orange","amber","yellow","lime","green","emerald","teal","cyan","sky","blue","indigo","violet","purple","fuchsia","pink","rose","slate","gray","zinc","neutral","stone","mauve","olive","mist","taupe"],je=Object.freeze([{id:"red-50",hue:"red",shade:"50",value:"oklch(97.1% 0.013 17.38)"},{id:"red-100",hue:"red",shade:"100",value:"oklch(93.6% 0.032 17.717)"},{id:"red-200",hue:"red",shade:"200",value:"oklch(88.5% 0.062 18.334)"},{id:"red-300",hue:"red",shade:"300",value:"oklch(80.8% 0.114 19.571)"},{id:"red-400",hue:"red",shade:"400",value:"oklch(70.4% 0.191 22.216)"},{id:"red-500",hue:"red",shade:"500",value:"oklch(63.7% 0.237 25.331)"},{id:"red-600",hue:"red",shade:"600",value:"oklch(57.7% 0.245 27.325)"},{id:"red-700",hue:"red",shade:"700",value:"oklch(50.5% 0.213 27.518)"},{id:"red-800",hue:"red",shade:"800",value:"oklch(44.4% 0.177 26.899)"},{id:"red-900",hue:"red",shade:"900",value:"oklch(39.6% 0.141 25.723)"},{id:"red-950",hue:"red",shade:"950",value:"oklch(25.8% 0.092 26.042)"},{id:"orange-50",hue:"orange",shade:"50",value:"oklch(98% 0.016 73.684)"},{id:"orange-100",hue:"orange",shade:"100",value:"oklch(95.4% 0.038 75.164)"},{id:"orange-200",hue:"orange",shade:"200",value:"oklch(90.1% 0.076 70.697)"},{id:"orange-300",hue:"orange",shade:"300",value:"oklch(83.7% 0.128 66.29)"},{id:"orange-400",hue:"orange",shade:"400",value:"oklch(75% 0.183 55.934)"},{id:"orange-500",hue:"orange",shade:"500",value:"oklch(70.5% 0.213 47.604)"},{id:"orange-600",hue:"orange",shade:"600",value:"oklch(64.6% 0.222 41.116)"},{id:"orange-700",hue:"orange",shade:"700",value:"oklch(55.3% 0.195 38.402)"},{id:"orange-800",hue:"orange",shade:"800",value:"oklch(47% 0.157 37.304)"},{id:"orange-900",hue:"orange",shade:"900",value:"oklch(40.8% 0.123 38.172)"},{id:"orange-950",hue:"orange",shade:"950",value:"oklch(26.6% 0.079 36.259)"},{id:"amber-50",hue:"amber",shade:"50",value:"oklch(98.7% 0.022 95.277)"},{id:"amber-100",hue:"amber",shade:"100",value:"oklch(96.2% 0.059 95.617)"},{id:"amber-200",hue:"amber",shade:"200",value:"oklch(92.4% 0.12 95.746)"},{id:"amber-300",hue:"amber",shade:"300",value:"oklch(87.9% 0.169 91.605)"},{id:"amber-400",hue:"amber",shade:"400",value:"oklch(82.8% 0.189 84.429)"},{id:"amber-500",hue:"amber",shade:"500",value:"oklch(76.9% 0.188 70.08)"},{id:"amber-600",hue:"amber",shade:"600",value:"oklch(66.6% 0.179 58.318)"},{id:"amber-700",hue:"amber",shade:"700",value:"oklch(55.5% 0.163 48.998)"},{id:"amber-800",hue:"amber",shade:"800",value:"oklch(47.3% 0.137 46.201)"},{id:"amber-900",hue:"amber",shade:"900",value:"oklch(41.4% 0.112 45.904)"},{id:"amber-950",hue:"amber",shade:"950",value:"oklch(27.9% 0.077 45.635)"},{id:"yellow-50",hue:"yellow",shade:"50",value:"oklch(98.7% 0.026 102.212)"},{id:"yellow-100",hue:"yellow",shade:"100",value:"oklch(97.3% 0.071 103.193)"},{id:"yellow-200",hue:"yellow",shade:"200",value:"oklch(94.5% 0.129 101.54)"},{id:"yellow-300",hue:"yellow",shade:"300",value:"oklch(90.5% 0.182 98.111)"},{id:"yellow-400",hue:"yellow",shade:"400",value:"oklch(85.2% 0.199 91.936)"},{id:"yellow-500",hue:"yellow",shade:"500",value:"oklch(79.5% 0.184 86.047)"},{id:"yellow-600",hue:"yellow",shade:"600",value:"oklch(68.1% 0.162 75.834)"},{id:"yellow-700",hue:"yellow",shade:"700",value:"oklch(55.4% 0.135 66.442)"},{id:"yellow-800",hue:"yellow",shade:"800",value:"oklch(47.6% 0.114 61.907)"},{id:"yellow-900",hue:"yellow",shade:"900",value:"oklch(42.1% 0.095 57.708)"},{id:"yellow-950",hue:"yellow",shade:"950",value:"oklch(28.6% 0.066 53.813)"},{id:"lime-50",hue:"lime",shade:"50",value:"oklch(98.6% 0.031 120.757)"},{id:"lime-100",hue:"lime",shade:"100",value:"oklch(96.7% 0.067 122.328)"},{id:"lime-200",hue:"lime",shade:"200",value:"oklch(93.8% 0.127 124.321)"},{id:"lime-300",hue:"lime",shade:"300",value:"oklch(89.7% 0.196 126.665)"},{id:"lime-400",hue:"lime",shade:"400",value:"oklch(84.1% 0.238 128.85)"},{id:"lime-500",hue:"lime",shade:"500",value:"oklch(76.8% 0.233 130.85)"},{id:"lime-600",hue:"lime",shade:"600",value:"oklch(64.8% 0.2 131.684)"},{id:"lime-700",hue:"lime",shade:"700",value:"oklch(53.2% 0.157 131.589)"},{id:"lime-800",hue:"lime",shade:"800",value:"oklch(45.3% 0.124 130.933)"},{id:"lime-900",hue:"lime",shade:"900",value:"oklch(40.5% 0.101 131.063)"},{id:"lime-950",hue:"lime",shade:"950",value:"oklch(27.4% 0.072 132.109)"},{id:"green-50",hue:"green",shade:"50",value:"oklch(98.2% 0.018 155.826)"},{id:"green-100",hue:"green",shade:"100",value:"oklch(96.2% 0.044 156.743)"},{id:"green-200",hue:"green",shade:"200",value:"oklch(92.5% 0.084 155.995)"},{id:"green-300",hue:"green",shade:"300",value:"oklch(87.1% 0.15 154.449)"},{id:"green-400",hue:"green",shade:"400",value:"oklch(79.2% 0.209 151.711)"},{id:"green-500",hue:"green",shade:"500",value:"oklch(72.3% 0.219 149.579)"},{id:"green-600",hue:"green",shade:"600",value:"oklch(62.7% 0.194 149.214)"},{id:"green-700",hue:"green",shade:"700",value:"oklch(52.7% 0.154 150.069)"},{id:"green-800",hue:"green",shade:"800",value:"oklch(44.8% 0.119 151.328)"},{id:"green-900",hue:"green",shade:"900",value:"oklch(39.3% 0.095 152.535)"},{id:"green-950",hue:"green",shade:"950",value:"oklch(26.6% 0.065 152.934)"},{id:"emerald-50",hue:"emerald",shade:"50",value:"oklch(97.9% 0.021 166.113)"},{id:"emerald-100",hue:"emerald",shade:"100",value:"oklch(95% 0.052 163.051)"},{id:"emerald-200",hue:"emerald",shade:"200",value:"oklch(90.5% 0.093 164.15)"},{id:"emerald-300",hue:"emerald",shade:"300",value:"oklch(84.5% 0.143 164.978)"},{id:"emerald-400",hue:"emerald",shade:"400",value:"oklch(76.5% 0.177 163.223)"},{id:"emerald-500",hue:"emerald",shade:"500",value:"oklch(69.6% 0.17 162.48)"},{id:"emerald-600",hue:"emerald",shade:"600",value:"oklch(59.6% 0.145 163.225)"},{id:"emerald-700",hue:"emerald",shade:"700",value:"oklch(50.8% 0.118 165.612)"},{id:"emerald-800",hue:"emerald",shade:"800",value:"oklch(43.2% 0.095 166.913)"},{id:"emerald-900",hue:"emerald",shade:"900",value:"oklch(37.8% 0.077 168.94)"},{id:"emerald-950",hue:"emerald",shade:"950",value:"oklch(26.2% 0.051 172.552)"},{id:"teal-50",hue:"teal",shade:"50",value:"oklch(98.4% 0.014 180.72)"},{id:"teal-100",hue:"teal",shade:"100",value:"oklch(95.3% 0.051 180.801)"},{id:"teal-200",hue:"teal",shade:"200",value:"oklch(91% 0.096 180.426)"},{id:"teal-300",hue:"teal",shade:"300",value:"oklch(85.5% 0.138 181.071)"},{id:"teal-400",hue:"teal",shade:"400",value:"oklch(77.7% 0.152 181.912)"},{id:"teal-500",hue:"teal",shade:"500",value:"oklch(70.4% 0.14 182.503)"},{id:"teal-600",hue:"teal",shade:"600",value:"oklch(60% 0.118 184.704)"},{id:"teal-700",hue:"teal",shade:"700",value:"oklch(51.1% 0.096 186.391)"},{id:"teal-800",hue:"teal",shade:"800",value:"oklch(43.7% 0.078 188.216)"},{id:"teal-900",hue:"teal",shade:"900",value:"oklch(38.6% 0.063 188.416)"},{id:"teal-950",hue:"teal",shade:"950",value:"oklch(27.7% 0.046 192.524)"},{id:"cyan-50",hue:"cyan",shade:"50",value:"oklch(98.4% 0.019 200.873)"},{id:"cyan-100",hue:"cyan",shade:"100",value:"oklch(95.6% 0.045 203.388)"},{id:"cyan-200",hue:"cyan",shade:"200",value:"oklch(91.7% 0.08 205.041)"},{id:"cyan-300",hue:"cyan",shade:"300",value:"oklch(86.5% 0.127 207.078)"},{id:"cyan-400",hue:"cyan",shade:"400",value:"oklch(78.9% 0.154 211.53)"},{id:"cyan-500",hue:"cyan",shade:"500",value:"oklch(71.5% 0.143 215.221)"},{id:"cyan-600",hue:"cyan",shade:"600",value:"oklch(60.9% 0.126 221.723)"},{id:"cyan-700",hue:"cyan",shade:"700",value:"oklch(52% 0.105 223.128)"},{id:"cyan-800",hue:"cyan",shade:"800",value:"oklch(45% 0.085 224.283)"},{id:"cyan-900",hue:"cyan",shade:"900",value:"oklch(39.8% 0.07 227.392)"},{id:"cyan-950",hue:"cyan",shade:"950",value:"oklch(30.2% 0.056 229.695)"},{id:"sky-50",hue:"sky",shade:"50",value:"oklch(97.7% 0.013 236.62)"},{id:"sky-100",hue:"sky",shade:"100",value:"oklch(95.1% 0.026 236.824)"},{id:"sky-200",hue:"sky",shade:"200",value:"oklch(90.1% 0.058 230.902)"},{id:"sky-300",hue:"sky",shade:"300",value:"oklch(82.8% 0.111 230.318)"},{id:"sky-400",hue:"sky",shade:"400",value:"oklch(74.6% 0.16 232.661)"},{id:"sky-500",hue:"sky",shade:"500",value:"oklch(68.5% 0.169 237.323)"},{id:"sky-600",hue:"sky",shade:"600",value:"oklch(58.8% 0.158 241.966)"},{id:"sky-700",hue:"sky",shade:"700",value:"oklch(50% 0.134 242.749)"},{id:"sky-800",hue:"sky",shade:"800",value:"oklch(44.3% 0.11 240.79)"},{id:"sky-900",hue:"sky",shade:"900",value:"oklch(39.1% 0.09 240.876)"},{id:"sky-950",hue:"sky",shade:"950",value:"oklch(29.3% 0.066 243.157)"},{id:"blue-50",hue:"blue",shade:"50",value:"oklch(97% 0.014 254.604)"},{id:"blue-100",hue:"blue",shade:"100",value:"oklch(93.2% 0.032 255.585)"},{id:"blue-200",hue:"blue",shade:"200",value:"oklch(88.2% 0.059 254.128)"},{id:"blue-300",hue:"blue",shade:"300",value:"oklch(80.9% 0.105 251.813)"},{id:"blue-400",hue:"blue",shade:"400",value:"oklch(70.7% 0.165 254.624)"},{id:"blue-500",hue:"blue",shade:"500",value:"oklch(62.3% 0.214 259.815)"},{id:"blue-600",hue:"blue",shade:"600",value:"oklch(54.6% 0.245 262.881)"},{id:"blue-700",hue:"blue",shade:"700",value:"oklch(48.8% 0.243 264.376)"},{id:"blue-800",hue:"blue",shade:"800",value:"oklch(42.4% 0.199 265.638)"},{id:"blue-900",hue:"blue",shade:"900",value:"oklch(37.9% 0.146 265.522)"},{id:"blue-950",hue:"blue",shade:"950",value:"oklch(28.2% 0.091 267.935)"},{id:"indigo-50",hue:"indigo",shade:"50",value:"oklch(96.2% 0.018 272.314)"},{id:"indigo-100",hue:"indigo",shade:"100",value:"oklch(93% 0.034 272.788)"},{id:"indigo-200",hue:"indigo",shade:"200",value:"oklch(87% 0.065 274.039)"},{id:"indigo-300",hue:"indigo",shade:"300",value:"oklch(78.5% 0.115 274.713)"},{id:"indigo-400",hue:"indigo",shade:"400",value:"oklch(67.3% 0.182 276.935)"},{id:"indigo-500",hue:"indigo",shade:"500",value:"oklch(58.5% 0.233 277.117)"},{id:"indigo-600",hue:"indigo",shade:"600",value:"oklch(51.1% 0.262 276.966)"},{id:"indigo-700",hue:"indigo",shade:"700",value:"oklch(45.7% 0.24 277.023)"},{id:"indigo-800",hue:"indigo",shade:"800",value:"oklch(39.8% 0.195 277.366)"},{id:"indigo-900",hue:"indigo",shade:"900",value:"oklch(35.9% 0.144 278.697)"},{id:"indigo-950",hue:"indigo",shade:"950",value:"oklch(25.7% 0.09 281.288)"},{id:"violet-50",hue:"violet",shade:"50",value:"oklch(96.9% 0.016 293.756)"},{id:"violet-100",hue:"violet",shade:"100",value:"oklch(94.3% 0.029 294.588)"},{id:"violet-200",hue:"violet",shade:"200",value:"oklch(89.4% 0.057 293.283)"},{id:"violet-300",hue:"violet",shade:"300",value:"oklch(81.1% 0.111 293.571)"},{id:"violet-400",hue:"violet",shade:"400",value:"oklch(70.2% 0.183 293.541)"},{id:"violet-500",hue:"violet",shade:"500",value:"oklch(60.6% 0.25 292.717)"},{id:"violet-600",hue:"violet",shade:"600",value:"oklch(54.1% 0.281 293.009)"},{id:"violet-700",hue:"violet",shade:"700",value:"oklch(49.1% 0.27 292.581)"},{id:"violet-800",hue:"violet",shade:"800",value:"oklch(43.2% 0.232 292.759)"},{id:"violet-900",hue:"violet",shade:"900",value:"oklch(38% 0.189 293.745)"},{id:"violet-950",hue:"violet",shade:"950",value:"oklch(28.3% 0.141 291.089)"},{id:"purple-50",hue:"purple",shade:"50",value:"oklch(97.7% 0.014 308.299)"},{id:"purple-100",hue:"purple",shade:"100",value:"oklch(94.6% 0.033 307.174)"},{id:"purple-200",hue:"purple",shade:"200",value:"oklch(90.2% 0.063 306.703)"},{id:"purple-300",hue:"purple",shade:"300",value:"oklch(82.7% 0.119 306.383)"},{id:"purple-400",hue:"purple",shade:"400",value:"oklch(71.4% 0.203 305.504)"},{id:"purple-500",hue:"purple",shade:"500",value:"oklch(62.7% 0.265 303.9)"},{id:"purple-600",hue:"purple",shade:"600",value:"oklch(55.8% 0.288 302.321)"},{id:"purple-700",hue:"purple",shade:"700",value:"oklch(49.6% 0.265 301.924)"},{id:"purple-800",hue:"purple",shade:"800",value:"oklch(43.8% 0.218 303.724)"},{id:"purple-900",hue:"purple",shade:"900",value:"oklch(38.1% 0.176 304.987)"},{id:"purple-950",hue:"purple",shade:"950",value:"oklch(29.1% 0.149 302.717)"},{id:"fuchsia-50",hue:"fuchsia",shade:"50",value:"oklch(97.7% 0.017 320.058)"},{id:"fuchsia-100",hue:"fuchsia",shade:"100",value:"oklch(95.2% 0.037 318.852)"},{id:"fuchsia-200",hue:"fuchsia",shade:"200",value:"oklch(90.3% 0.076 319.62)"},{id:"fuchsia-300",hue:"fuchsia",shade:"300",value:"oklch(83.3% 0.145 321.434)"},{id:"fuchsia-400",hue:"fuchsia",shade:"400",value:"oklch(74% 0.238 322.16)"},{id:"fuchsia-500",hue:"fuchsia",shade:"500",value:"oklch(66.7% 0.295 322.15)"},{id:"fuchsia-600",hue:"fuchsia",shade:"600",value:"oklch(59.1% 0.293 322.896)"},{id:"fuchsia-700",hue:"fuchsia",shade:"700",value:"oklch(51.8% 0.253 323.949)"},{id:"fuchsia-800",hue:"fuchsia",shade:"800",value:"oklch(45.2% 0.211 324.591)"},{id:"fuchsia-900",hue:"fuchsia",shade:"900",value:"oklch(40.1% 0.17 325.612)"},{id:"fuchsia-950",hue:"fuchsia",shade:"950",value:"oklch(29.3% 0.136 325.661)"},{id:"pink-50",hue:"pink",shade:"50",value:"oklch(97.1% 0.014 343.198)"},{id:"pink-100",hue:"pink",shade:"100",value:"oklch(94.8% 0.028 342.258)"},{id:"pink-200",hue:"pink",shade:"200",value:"oklch(89.9% 0.061 343.231)"},{id:"pink-300",hue:"pink",shade:"300",value:"oklch(82.3% 0.12 346.018)"},{id:"pink-400",hue:"pink",shade:"400",value:"oklch(71.8% 0.202 349.761)"},{id:"pink-500",hue:"pink",shade:"500",value:"oklch(65.6% 0.241 354.308)"},{id:"pink-600",hue:"pink",shade:"600",value:"oklch(59.2% 0.249 0.584)"},{id:"pink-700",hue:"pink",shade:"700",value:"oklch(52.5% 0.223 3.958)"},{id:"pink-800",hue:"pink",shade:"800",value:"oklch(45.9% 0.187 3.815)"},{id:"pink-900",hue:"pink",shade:"900",value:"oklch(40.8% 0.153 2.432)"},{id:"pink-950",hue:"pink",shade:"950",value:"oklch(28.4% 0.109 3.907)"},{id:"rose-50",hue:"rose",shade:"50",value:"oklch(96.9% 0.015 12.422)"},{id:"rose-100",hue:"rose",shade:"100",value:"oklch(94.1% 0.03 12.58)"},{id:"rose-200",hue:"rose",shade:"200",value:"oklch(89.2% 0.058 10.001)"},{id:"rose-300",hue:"rose",shade:"300",value:"oklch(81% 0.117 11.638)"},{id:"rose-400",hue:"rose",shade:"400",value:"oklch(71.2% 0.194 13.428)"},{id:"rose-500",hue:"rose",shade:"500",value:"oklch(64.5% 0.246 16.439)"},{id:"rose-600",hue:"rose",shade:"600",value:"oklch(58.6% 0.253 17.585)"},{id:"rose-700",hue:"rose",shade:"700",value:"oklch(51.4% 0.222 16.935)"},{id:"rose-800",hue:"rose",shade:"800",value:"oklch(45.5% 0.188 13.697)"},{id:"rose-900",hue:"rose",shade:"900",value:"oklch(41% 0.159 10.272)"},{id:"rose-950",hue:"rose",shade:"950",value:"oklch(27.1% 0.105 12.094)"},{id:"slate-50",hue:"slate",shade:"50",value:"oklch(98.4% 0.003 247.858)"},{id:"slate-100",hue:"slate",shade:"100",value:"oklch(96.8% 0.007 247.896)"},{id:"slate-200",hue:"slate",shade:"200",value:"oklch(92.9% 0.013 255.508)"},{id:"slate-300",hue:"slate",shade:"300",value:"oklch(86.9% 0.022 252.894)"},{id:"slate-400",hue:"slate",shade:"400",value:"oklch(70.4% 0.04 256.788)"},{id:"slate-500",hue:"slate",shade:"500",value:"oklch(55.4% 0.046 257.417)"},{id:"slate-600",hue:"slate",shade:"600",value:"oklch(44.6% 0.043 257.281)"},{id:"slate-700",hue:"slate",shade:"700",value:"oklch(37.2% 0.044 257.287)"},{id:"slate-800",hue:"slate",shade:"800",value:"oklch(27.9% 0.041 260.031)"},{id:"slate-900",hue:"slate",shade:"900",value:"oklch(20.8% 0.042 265.755)"},{id:"slate-950",hue:"slate",shade:"950",value:"oklch(12.9% 0.042 264.695)"},{id:"gray-50",hue:"gray",shade:"50",value:"oklch(98.5% 0.002 247.839)"},{id:"gray-100",hue:"gray",shade:"100",value:"oklch(96.7% 0.003 264.542)"},{id:"gray-200",hue:"gray",shade:"200",value:"oklch(92.8% 0.006 264.531)"},{id:"gray-300",hue:"gray",shade:"300",value:"oklch(87.2% 0.01 258.338)"},{id:"gray-400",hue:"gray",shade:"400",value:"oklch(70.7% 0.022 261.325)"},{id:"gray-500",hue:"gray",shade:"500",value:"oklch(55.1% 0.027 264.364)"},{id:"gray-600",hue:"gray",shade:"600",value:"oklch(44.6% 0.03 256.802)"},{id:"gray-700",hue:"gray",shade:"700",value:"oklch(37.3% 0.034 259.733)"},{id:"gray-800",hue:"gray",shade:"800",value:"oklch(27.8% 0.033 256.848)"},{id:"gray-900",hue:"gray",shade:"900",value:"oklch(21% 0.034 264.665)"},{id:"gray-950",hue:"gray",shade:"950",value:"oklch(13% 0.028 261.692)"},{id:"zinc-50",hue:"zinc",shade:"50",value:"oklch(98.5% 0 none)"},{id:"zinc-100",hue:"zinc",shade:"100",value:"oklch(96.7% 0.001 286.375)"},{id:"zinc-200",hue:"zinc",shade:"200",value:"oklch(92% 0.004 286.32)"},{id:"zinc-300",hue:"zinc",shade:"300",value:"oklch(87.1% 0.006 286.286)"},{id:"zinc-400",hue:"zinc",shade:"400",value:"oklch(70.5% 0.015 286.067)"},{id:"zinc-500",hue:"zinc",shade:"500",value:"oklch(55.2% 0.016 285.938)"},{id:"zinc-600",hue:"zinc",shade:"600",value:"oklch(44.2% 0.017 285.786)"},{id:"zinc-700",hue:"zinc",shade:"700",value:"oklch(37% 0.013 285.805)"},{id:"zinc-800",hue:"zinc",shade:"800",value:"oklch(27.4% 0.006 286.033)"},{id:"zinc-900",hue:"zinc",shade:"900",value:"oklch(21% 0.006 285.885)"},{id:"zinc-950",hue:"zinc",shade:"950",value:"oklch(14.1% 0.005 285.823)"},{id:"neutral-50",hue:"neutral",shade:"50",value:"oklch(98.5% 0 none)"},{id:"neutral-100",hue:"neutral",shade:"100",value:"oklch(97% 0 none)"},{id:"neutral-200",hue:"neutral",shade:"200",value:"oklch(92.2% 0 none)"},{id:"neutral-300",hue:"neutral",shade:"300",value:"oklch(87% 0 none)"},{id:"neutral-400",hue:"neutral",shade:"400",value:"oklch(70.8% 0 none)"},{id:"neutral-500",hue:"neutral",shade:"500",value:"oklch(55.6% 0 none)"},{id:"neutral-600",hue:"neutral",shade:"600",value:"oklch(43.9% 0 none)"},{id:"neutral-700",hue:"neutral",shade:"700",value:"oklch(37.1% 0 none)"},{id:"neutral-800",hue:"neutral",shade:"800",value:"oklch(26.9% 0 none)"},{id:"neutral-900",hue:"neutral",shade:"900",value:"oklch(20.5% 0 none)"},{id:"neutral-950",hue:"neutral",shade:"950",value:"oklch(14.5% 0 none)"},{id:"stone-50",hue:"stone",shade:"50",value:"oklch(98.5% 0.001 106.423)"},{id:"stone-100",hue:"stone",shade:"100",value:"oklch(97% 0.001 106.424)"},{id:"stone-200",hue:"stone",shade:"200",value:"oklch(92.3% 0.003 48.717)"},{id:"stone-300",hue:"stone",shade:"300",value:"oklch(86.9% 0.005 56.366)"},{id:"stone-400",hue:"stone",shade:"400",value:"oklch(70.9% 0.01 56.259)"},{id:"stone-500",hue:"stone",shade:"500",value:"oklch(55.3% 0.013 58.071)"},{id:"stone-600",hue:"stone",shade:"600",value:"oklch(44.4% 0.011 73.639)"},{id:"stone-700",hue:"stone",shade:"700",value:"oklch(37.4% 0.01 67.558)"},{id:"stone-800",hue:"stone",shade:"800",value:"oklch(26.8% 0.007 34.298)"},{id:"stone-900",hue:"stone",shade:"900",value:"oklch(21.6% 0.006 56.043)"},{id:"stone-950",hue:"stone",shade:"950",value:"oklch(14.7% 0.004 49.25)"},{id:"mauve-50",hue:"mauve",shade:"50",value:"oklch(98.5% 0 none)"},{id:"mauve-100",hue:"mauve",shade:"100",value:"oklch(96% 0.003 325.6)"},{id:"mauve-200",hue:"mauve",shade:"200",value:"oklch(92.2% 0.005 325.62)"},{id:"mauve-300",hue:"mauve",shade:"300",value:"oklch(86.5% 0.012 325.68)"},{id:"mauve-400",hue:"mauve",shade:"400",value:"oklch(71.1% 0.019 323.02)"},{id:"mauve-500",hue:"mauve",shade:"500",value:"oklch(54.2% 0.034 322.5)"},{id:"mauve-600",hue:"mauve",shade:"600",value:"oklch(43.5% 0.029 321.78)"},{id:"mauve-700",hue:"mauve",shade:"700",value:"oklch(36.4% 0.029 323.89)"},{id:"mauve-800",hue:"mauve",shade:"800",value:"oklch(26.3% 0.024 320.12)"},{id:"mauve-900",hue:"mauve",shade:"900",value:"oklch(21.2% 0.019 322.12)"},{id:"mauve-950",hue:"mauve",shade:"950",value:"oklch(14.5% 0.008 326)"},{id:"olive-50",hue:"olive",shade:"50",value:"oklch(98.8% 0.003 106.5)"},{id:"olive-100",hue:"olive",shade:"100",value:"oklch(96.6% 0.005 106.5)"},{id:"olive-200",hue:"olive",shade:"200",value:"oklch(93% 0.007 106.5)"},{id:"olive-300",hue:"olive",shade:"300",value:"oklch(88% 0.011 106.6)"},{id:"olive-400",hue:"olive",shade:"400",value:"oklch(73.7% 0.021 106.9)"},{id:"olive-500",hue:"olive",shade:"500",value:"oklch(58% 0.031 107.3)"},{id:"olive-600",hue:"olive",shade:"600",value:"oklch(46.6% 0.025 107.3)"},{id:"olive-700",hue:"olive",shade:"700",value:"oklch(39.4% 0.023 107.4)"},{id:"olive-800",hue:"olive",shade:"800",value:"oklch(28.6% 0.016 107.4)"},{id:"olive-900",hue:"olive",shade:"900",value:"oklch(22.8% 0.013 107.4)"},{id:"olive-950",hue:"olive",shade:"950",value:"oklch(15.3% 0.006 107.1)"},{id:"mist-50",hue:"mist",shade:"50",value:"oklch(98.7% 0.002 197.1)"},{id:"mist-100",hue:"mist",shade:"100",value:"oklch(96.3% 0.002 197.1)"},{id:"mist-200",hue:"mist",shade:"200",value:"oklch(92.5% 0.005 214.3)"},{id:"mist-300",hue:"mist",shade:"300",value:"oklch(87.2% 0.007 219.6)"},{id:"mist-400",hue:"mist",shade:"400",value:"oklch(72.3% 0.014 214.4)"},{id:"mist-500",hue:"mist",shade:"500",value:"oklch(56% 0.021 213.5)"},{id:"mist-600",hue:"mist",shade:"600",value:"oklch(45% 0.017 213.2)"},{id:"mist-700",hue:"mist",shade:"700",value:"oklch(37.8% 0.015 216)"},{id:"mist-800",hue:"mist",shade:"800",value:"oklch(27.5% 0.011 216.9)"},{id:"mist-900",hue:"mist",shade:"900",value:"oklch(21.8% 0.008 223.9)"},{id:"mist-950",hue:"mist",shade:"950",value:"oklch(14.8% 0.004 228.8)"},{id:"taupe-50",hue:"taupe",shade:"50",value:"oklch(98.6% 0.002 67.8)"},{id:"taupe-100",hue:"taupe",shade:"100",value:"oklch(96% 0.002 17.2)"},{id:"taupe-200",hue:"taupe",shade:"200",value:"oklch(92.2% 0.005 34.3)"},{id:"taupe-300",hue:"taupe",shade:"300",value:"oklch(86.8% 0.007 39.5)"},{id:"taupe-400",hue:"taupe",shade:"400",value:"oklch(71.4% 0.014 41.2)"},{id:"taupe-500",hue:"taupe",shade:"500",value:"oklch(54.7% 0.021 43.1)"},{id:"taupe-600",hue:"taupe",shade:"600",value:"oklch(43.8% 0.017 39.3)"},{id:"taupe-700",hue:"taupe",shade:"700",value:"oklch(36.7% 0.016 35.7)"},{id:"taupe-800",hue:"taupe",shade:"800",value:"oklch(26.8% 0.011 36.5)"},{id:"taupe-900",hue:"taupe",shade:"900",value:"oklch(21.4% 0.009 43.1)"},{id:"taupe-950",hue:"taupe",shade:"950",value:"oklch(14.7% 0.004 49.3)"}]),un=12,gl=new Map(je.map(e=>[e.id,e])),mn=new Map(je.map(e=>[e.value,e])),pn=/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i,fn=/^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\(.*\)$/i,gn=/[;{}<>\\]|url\s*\(/i,bl=new WeakMap;function pr(e){let t=bl.get(e);return t||bl.set(e,t=new Set),t}function Ni(e,t){let r=String(e??"").trim();if(!r||gn.test(r))return!1;let l=t?.defaultView?.CSS;return l&&typeof l.supports=="function"?l.supports("color",r):pn.test(r)||fn.test(r)||/^[a-z]+$/i.test(r)}function Mi(e){return`${e.hue[0].toUpperCase()}${e.hue.slice(1)} ${e.shade}`}function We(e){return{id:e.id,label:Mi(e),value:e.value}}function zi(e){let t=String(e??"").trim(),r=mn.get(t);return r?Mi(r):t}function bn(e,t){if(!e||e.length===0)return{swatches:je.map(We),custom:!0,full:!0};let r=[],l=new Set,i=!1,o=a=>{l.has(a.value)||(l.add(a.value),r.push(a))};for(let a of e)a==="custom"?i=!0:gl.has(a)?o(We(gl.get(a))):dn.includes(a)?je.filter(n=>n.hue===a).forEach(n=>o(We(n))):hn.includes(a)?je.filter(n=>n.shade===a).forEach(n=>o(We(n))):Ni(a,t)?o({id:null,label:a,value:a}):console.warn(`[hypercms] color option "${a}" is not a Tailwind color, hue, shade, CSS color or "custom"; ignoring it`);return{swatches:r,custom:i,full:!1}}function kn(e,{value:t,tokens:r,path:l,doc:i}){let{swatches:o,custom:a,full:n}=bn(r,i),s=t==null?"":String(t).trim();s&&!o.some(p=>p.value===s)&&o.unshift({id:null,label:zi(s),value:s});let h=o.length<=un;e.setAttribute("data-hcms-color-path",l),e.classList.toggle("hcms-color--inline",h);let d=e.querySelector(".hcms-color-grid");if(d){d.classList.toggle("hcms-color-grid--full",n);for(let p of o){let u=i.createElement("button");u.type="button",u.className="hcms-color-swatch",u.setAttribute("data-hcms-action","color-pick"),u.setAttribute("data-hcms-color",p.value),u.setAttribute("aria-label",p.label),u.setAttribute("title",p.id||p.label),u.setAttribute("style",`--hcms-swatch: ${p.value}`),d.appendChild(u)}}a||e.querySelector(".hcms-color-custom")?.remove();let m=e.querySelector(".hcms-color-current");h&&m&&(m.removeAttribute("data-hcms-action"),m.removeAttribute("aria-expanded")),fr(e,h||pr(i).has(l)),Fi(e,s)}function Fi(e,t){let r=t==null?"":String(t).trim();e.toggleAttribute("data-hcms-color-empty",r==="");let l=e.querySelector(".hcms-color-chip");l&&(r?l.setAttribute("style",`--hcms-swatch: ${r}`):l.removeAttribute("style"));let i=e.querySelector(".hcms-color-name");i&&(i.textContent=r?zi(r):"Not set"),e.querySelectorAll(".hcms-color-swatch").forEach(n=>{n.setAttribute("aria-pressed",String(n.getAttribute("data-hcms-color")===r))});let o=e.querySelector('[data-hcms-color-input="text"]');o&&o.ownerDocument?.activeElement!==o&&(o.value=r);let a=e.querySelector('[data-hcms-color-input="native"]');a&&/^#[0-9a-f]{6}$/i.test(r)&&(a.value=r.toLowerCase())}function fr(e,t){let r=e.querySelector(".hcms-color-panel");r&&(r.hidden=!t);let l=e.querySelector(".hcms-color-current[data-hcms-action]");l&&l.setAttribute("aria-expanded",String(t))}function kt(e){return e?.closest?e.closest("[data-hcms-color-path]"):null}function vn(e){return e.querySelector('input[type="hidden"][data-hcms-field]')}function Di(e,t){let r=e.querySelector(":scope > .hcms-error");r&&(r.textContent=t||"",r.hidden=!t)}function gr(e,t){let r=vn(e);return!r||(Di(e,null),Fi(e,t),r.value===t)?null:(r.value=t,r)}function yn(e){let t=kt(e);return t?(t.classList.contains("hcms-color--inline")||(pr(t.ownerDocument).delete(t.getAttribute("data-hcms-color-path")),fr(t,!1)),gr(t,e.getAttribute("data-hcms-color")||"")):null}function xn(e){let t=kt(e);return t?gr(t,""):null}function wn(e){let t=kt(e);if(!t)return;let r=t.getAttribute("data-hcms-color-path"),l=pr(t.ownerDocument),i=!l.has(r);i?l.add(r):l.delete(r),fr(t,i)}function An(e){let t=kt(e);if(!t)return null;let r=String(e.value||"").trim();return r!==""&&!Ni(r,t.ownerDocument)?(Di(t,`"${r}" is not a CSS color`),null):gr(t,r)}var Bi=["sans","serif","display","mono"],M="ui-sans-serif, system-ui, sans-serif",Y="ui-serif, Georgia, serif",me="ui-monospace, SFMono-Regular, Menlo, monospace",re=Object.freeze([{slug:"inter",family:"Inter",group:"sans",fallback:M,request:"ital,wght@0,100..900;1,100..900"},{slug:"roboto",family:"Roboto",group:"sans",fallback:M,request:"ital,wght@0,100..900;1,100..900"},{slug:"open-sans",family:"Open Sans",group:"sans",fallback:M,request:"ital,wght@0,300..800;1,300..800"},{slug:"lato",family:"Lato",group:"sans",fallback:M,request:"ital,wght@0,100;0,300;0,400;0,700;0,900;1,100;1,300;1,400;1,700;1,900"},{slug:"montserrat",family:"Montserrat",group:"sans",fallback:M,request:"ital,wght@0,100..900;1,100..900"},{slug:"poppins",family:"Poppins",group:"sans",fallback:M,request:"ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,100;1,200;1,300;1,400;1,500;1,600;1,700;1,800;1,900"},{slug:"nunito",family:"Nunito",group:"sans",fallback:M,request:"ital,wght@0,200..1000;1,200..1000"},{slug:"raleway",family:"Raleway",group:"sans",fallback:M,request:"ital,wght@0,100..900;1,100..900"},{slug:"dm-sans",family:"DM Sans",group:"sans",fallback:M,request:"ital,wght@0,100..1000;1,100..1000"},{slug:"work-sans",family:"Work Sans",group:"sans",fallback:M,request:"ital,wght@0,100..900;1,100..900"},{slug:"source-sans-3",family:"Source Sans 3",group:"sans",fallback:M,request:"ital,wght@0,200..900;1,200..900"},{slug:"noto-sans",family:"Noto Sans",group:"sans",fallback:M,request:"ital,wght@0,100..900;1,100..900"},{slug:"plus-jakarta-sans",family:"Plus Jakarta Sans",group:"sans",fallback:M,request:"ital,wght@0,200..800;1,200..800"},{slug:"manrope",family:"Manrope",group:"sans",fallback:M,request:"wght@200..800"},{slug:"outfit",family:"Outfit",group:"sans",fallback:M,request:"wght@100..900"},{slug:"space-grotesk",family:"Space Grotesk",group:"sans",fallback:M,request:"wght@300..700"},{slug:"rubik",family:"Rubik",group:"sans",fallback:M,request:"ital,wght@0,300..900;1,300..900"},{slug:"ubuntu",family:"Ubuntu",group:"sans",fallback:M,request:"ital,wght@0,300;0,400;0,500;0,700;1,300;1,400;1,500;1,700"},{slug:"merriweather",family:"Merriweather",group:"serif",fallback:Y,request:"ital,wght@0,300..900;1,300..900"},{slug:"lora",family:"Lora",group:"serif",fallback:Y,request:"ital,wght@0,400..700;1,400..700"},{slug:"playfair-display",family:"Playfair Display",group:"serif",fallback:Y,request:"ital,wght@0,400..900;1,400..900"},{slug:"libre-baskerville",family:"Libre Baskerville",group:"serif",fallback:Y,request:"ital,wght@0,400..700;1,400..700"},{slug:"source-serif-4",family:"Source Serif 4",group:"serif",fallback:Y,request:"ital,wght@0,200..900;1,200..900"},{slug:"pt-serif",family:"PT Serif",group:"serif",fallback:Y,request:"ital,wght@0,400;0,700;1,400;1,700"},{slug:"noto-serif",family:"Noto Serif",group:"serif",fallback:Y,request:"ital,wght@0,100..900;1,100..900"},{slug:"crimson-pro",family:"Crimson Pro",group:"serif",fallback:Y,request:"ital,wght@0,200..900;1,200..900"},{slug:"eb-garamond",family:"EB Garamond",group:"serif",fallback:Y,request:"ital,wght@0,400..800;1,400..800"},{slug:"cormorant-garamond",family:"Cormorant Garamond",group:"serif",fallback:Y,request:"ital,wght@0,300..700;1,300..700"},{slug:"bebas-neue",family:"Bebas Neue",group:"display",fallback:M,request:"wght@400"},{slug:"oswald",family:"Oswald",group:"display",fallback:M,request:"wght@200..700"},{slug:"anton",family:"Anton",group:"display",fallback:M,request:"wght@400"},{slug:"abril-fatface",family:"Abril Fatface",group:"display",fallback:Y,request:"wght@400"},{slug:"lobster",family:"Lobster",group:"display",fallback:"cursive",request:"wght@400"},{slug:"bungee",family:"Bungee",group:"display",fallback:M,request:"wght@400"},{slug:"roboto-mono",family:"Roboto Mono",group:"mono",fallback:me,request:"ital,wght@0,100..700;1,100..700"},{slug:"jetbrains-mono",family:"JetBrains Mono",group:"mono",fallback:me,request:"ital,wght@0,100..800;1,100..800"},{slug:"fira-code",family:"Fira Code",group:"mono",fallback:me,request:"wght@300..700"},{slug:"source-code-pro",family:"Source Code Pro",group:"mono",fallback:me,request:"ital,wght@0,200..900;1,200..900"},{slug:"ibm-plex-mono",family:"IBM Plex Mono",group:"mono",fallback:me,request:"ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;1,100;1,200;1,300;1,400;1,500;1,600;1,700"},{slug:"space-mono",family:"Space Mono",group:"mono",fallback:me,request:"ital,wght@0,400;0,700;1,400;1,700"}]),Ne=Object.freeze({slug:"system",family:null,group:"sans",fallback:"system-ui, sans-serif"}),_n=new Map(re.map(e=>[e.family.toLowerCase(),e])),Lh=new Map(re.map(e=>[e.slug,e]));function Ke(e){return!e||e.slug==="system"?Ne.fallback:`'${e.family}', ${e.fallback}`}function Ii(e){if(e==null)return null;let t=String(e).split(",")[0].trim().replace(/^['"]|['"]$/g,"");return _n.get(t.toLowerCase())||null}function Pi(e){let t=new Map;for(let r of e||[]){let l=Ii(r);l&&t.set(l.family,l)}return t.size===0?null:`https://fonts.googleapis.com/css2?${[...t.values()].sort((r,l)=>r.family.localeCompare(l.family)).map(r=>`family=${r.family.replace(/ /g,"+")}:${r.request}`).join("&")}&display=swap`}var En={sans:"Sans",serif:"Serif",display:"Display",mono:"Mono"},Sn="link[data-hcms-font-preview]",kl=new WeakMap;function br(e){let t=kl.get(e);return t||kl.set(e,t=new Set),t}function Cn(e){return String(e??"").trim()===Ne.fallback}function Hi(e){let t=String(e??"").trim();if(!t)return"Not set";if(Cn(t))return"System";let r=Ii(t);return r?r.family:"Current font"}function Tn(e){if(!e||e.length===0)return{system:!0,fonts:[...re]};let t=!1,r=new Set;for(let l of e)l==="system"?t=!0:Bi.includes(l)?re.filter(i=>i.group===l).forEach(i=>r.add(i)):re.some(i=>i.slug===l)?r.add(re.find(i=>i.slug===l)):console.warn(`[hypercms] font option "${l}" is not a catalog font, a group or "system"; ignoring it`);return{system:t,fonts:re.filter(l=>r.has(l))}}function qt(e,{value:t,label:r,family:l}){let i=e.createElement("button");return i.type="button",i.className="hcms-font-option",i.setAttribute("role","option"),i.setAttribute("data-hcms-action","font-pick"),i.setAttribute("data-hcms-font",t),i.setAttribute("style",`font-family: ${l}`),i.textContent=r,i}function Rn(e,{value:t,tokens:r,path:l,doc:i}){let{system:o,fonts:a}=Tn(r),n=t==null?"":String(t).trim();e.setAttribute("data-hcms-font-path",l);let s=e.querySelector(".hcms-font-list");if(s){let h=new Set([...o?[Ne.fallback]:[],...a.map(Ke)]);n&&!h.has(n)&&s.appendChild(qt(i,{value:n,label:Hi(n),family:n})),o&&s.appendChild(qt(i,{value:Ne.fallback,label:"System",family:Ne.fallback}));for(let d of Bi){let m=a.filter(u=>u.group===d);if(!m.length)continue;let p=i.createElement("div");p.className="hcms-font-group",p.textContent=En[d],s.appendChild(p);for(let u of m)s.appendChild(qt(i,{value:Ke(u),label:u.family,family:Ke(u)}))}}kr(e,br(i).has(l)),Ui(e,n)}function Ui(e,t){let r=t==null?"":String(t).trim(),l=e.querySelector(".hcms-font-name");l&&(l.textContent=Hi(r),r?l.setAttribute("style",`font-family: ${r}`):l.removeAttribute("style")),e.querySelectorAll(".hcms-font-option").forEach(i=>{i.setAttribute("aria-selected",String(i.getAttribute("data-hcms-font")===r))})}function kr(e,t){let r=e.querySelector(".hcms-font-panel");r&&(r.hidden=!t),e.querySelector(".hcms-font-current")?.setAttribute("aria-expanded",String(t)),t&&qn(e.ownerDocument)}function qn(e){let t=e?.head;if(!t||t.querySelector(Sn))return;let r=Pi(re.map(Ke)),l=[...new Set(re.map(o=>o.family).join(""))].join(""),i=e.createElement("link");i.rel="stylesheet",i.href=`${r}&text=${encodeURIComponent(l)}`,i.setAttribute("data-hcms-font-preview","");for(let o of["editor-ui","no-save","save-remove","snapshot-remove"])i.setAttribute(o,"");t.appendChild(i)}function Vi(e){return e?.closest?e.closest("[data-hcms-font-path]"):null}function $n(e){let t=Vi(e);if(!t)return;let r=t.getAttribute("data-hcms-font-path"),l=br(t.ownerDocument),i=!l.has(r);i?l.add(r):l.delete(r),kr(t,i)}function On(e){let t=Vi(e);if(!t)return null;let r=t.querySelector('input[type="hidden"][data-hcms-field]');if(!r)return null;br(t.ownerDocument).delete(t.getAttribute("data-hcms-font-path")),kr(t,!1);let l=e.getAttribute("data-hcms-font")||"";return Ui(t,l),r.value===l?null:(r.value=l,r)}var J=e=>`<svg viewBox="0 0 32 20" width="32" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">${e}</svg>`,z=(e,t,r,l,i="")=>`<rect x="${e}" y="${t}" width="${r}" height="${l}" rx="1"${i}/>`,B=(e,t,r)=>`<path d="M${e} ${t}H${r}"/>`,$t=' fill="currentColor" fill-opacity="0.3"',Ln=Object.freeze({"cols-1":{label:"One column",svg:J(z(2,2,28,16))},"cols-2":{label:"Two columns",svg:J(z(2,2,13,16)+z(17,2,13,16))},"cols-3":{label:"Three columns",svg:J(z(2,2,8,16)+z(12,2,8,16)+z(22,2,8,16))},"cols-4":{label:"Four columns",svg:J(z(2,2,5.5,16)+z(9.5,2,5.5,16)+z(17,2,5.5,16)+z(24.5,2,5.5,16))},"media-left":{label:"Image left",svg:J(z(2,3,12,14,$t)+B(18,6,30)+B(18,10,30)+B(18,14,26))},"media-right":{label:"Image right",svg:J(z(18,3,12,14,$t)+B(2,6,14)+B(2,10,14)+B(2,14,10))},"media-top":{label:"Image on top",svg:J(z(2,2,28,8,$t)+B(2,14,30)+B(2,17,22))},list:{label:"List",svg:J(B(3,5,4)+B(8,5,29)+B(3,10,4)+B(8,10,29)+B(3,15,4)+B(8,15,29))},cards:{label:"Cards",svg:J(z(2,2,13,7)+z(17,2,13,7)+z(2,11,13,7)+z(17,11,13,7))},centered:{label:"Centered",svg:J(B(6,5,26)+B(9,10,23)+B(11,15,21))},"card-flat":{label:"Flat",svg:J(z(5,3,22,14))},"card-raised":{label:"Raised",svg:J(z(7,5,22,14,' stroke-opacity="0.35"')+z(4,2,22,14,' fill="var(--mirk-bg, transparent)"'))}});function jn(e){return(e||[]).map(t=>{let r=t.indexOf(":"),l=r===-1?t:t.slice(0,r),i=r===-1?t:t.slice(r+1),o=Ln[i]||null;return{value:l,icon:o,label:o?o.label:Fe(l)}})}function Nn(e,{tokens:t,value:r,name:l,doc:i}){let o=jn(t),a=r==null?"":String(r);a!==""&&!o.some(s=>s.value===a)&&o.unshift({value:a,icon:null,label:Fe(a)});let n=e.querySelector(".hcms-variant-option");if(!n||!n.parentNode)return o.length;for(let s of o){let h=n.cloneNode(!0),d=h.querySelector('input[type="radio"]');d&&(d.value=s.value,d.name=l);let m=h.querySelector(".hcms-variant-icon");m&&(s.icon?m.innerHTML=s.icon.svg:m.remove());let p=h.querySelector(".hcms-variant-label");p&&(p.textContent=s.label),h.setAttribute("title",s.label),n.parentNode.insertBefore(h,n)}return n.remove(),o.length}function Wi(e){if(!e)return"";let t=String(e).split(/[?#]/)[0],r=t.split("/").pop()||t;try{return decodeURIComponent(r)}catch{return r}}function vr({pageRules:e,formRules:t,data:r,doc:l}){let i=l.createDocumentFragment(),o=Mn(e,r,l);o&&i.appendChild(o);let a=vt(e,[],r,l,e);return a&&i.appendChild(a),i}function Mn(e,t,r){let l=[];if(s(e,t,[]),!l.length)return null;let i=ee(r,"@object");if(!i)return null;let o=he(i,r);o.setAttribute("data-hcms-page-style","");let a=o.querySelector("[data-hcms-label]");a&&(a.textContent="Page style");let n=o.querySelector(".hcms-object-fields")||o;for(let[h,d,m]of l){let p=vt(h,d,m,r,e);p&&n.appendChild(p)}return o;function s(h,d,m){if(typeof h=="string"){hr(h,r,m,e)==="page"&&l.push([h,m,d]);return}if(!(!h||typeof h!="object"||Array.isArray(h)))for(let[p,u]of Object.entries(h))s(u,d==null?null:d[p],[...m,p])}}function Gi(e,t,r,l){let i=[],o=[];for(let[a,n]of Object.entries(e)){let s=hr(n,r,[...t,a],l);s!=="page"&&(s?i:o).push([a,n])}return[...i,...o]}function zn({shape:e,itemShape:t,pathArr:r,data:l,doc:i,itemKey:o,pageRules:a}){if(e==="object-array-item")return Ki(t,r,l,i,a);if(e==="scalar-array-item")return Zi(r,l,i,o||null);throw new Error(`hypercms: buildItem called with unknown shape "${e}"`)}function vt(e,t,r,l,i){let o=bt(e);return o==="scalar"?Fn(e,t,r,l,i):o==="object"?In(e,t,r,l,i):o==="object-array"?Pn(e,t,r,l,i):o==="scalar-array"?Hn(e,t,r,l):null}function Fn(e,t,r,l,i){let o=De(e,l,t,i),a=Be(t,o,l);if(!a)throw new Error(`hypercms: missing template for scalar at "${t.join(".")}"`);let n=Qa(e,l,t,i);n==="@number"&&o==="@scalar"&&console.info(`[hypercms] field "${t.join(".")}" declares component "@number" but its value isn't a plain number; rendering a text input so the value is preserved`),(n==="@checkbox"||n==="@toggle")&&o==="@scalar"&&console.info(`[hypercms] field "${t.join(".")}" declares component "${n}" but its value isn't true/false; rendering a text input so the value is preserved`),Ji(a,n===o?n:null,t);let s=he(a,l);Ae(s,t);let h=a.getAttribute?.("data-hcms-tpl");if((o==="@select"||o==="@radio")&&h===o&&Dn(s,e,t,r,l,o,i),o==="@variant"&&h==="@variant"){let d=Xe(e,l,t,i);d||Xi(s,"data-hcms-options required (value:icon tokens)"),Nn(s,{tokens:d,value:r,name:yr(t.join(".")),doc:l})===0&&s.querySelector(".hcms-variant-option")?.remove()}if(o==="@image"&&h==="@image"){let d=on(e,l,t,i);d!=null&&!s.hasAttribute("data-hcms-crop")&&s.setAttribute("data-hcms-crop",d)}return Un(s,le(t)),yt(s,le(t)),xt(s,le(t)),ro(s,r),o==="@color"&&h==="@color"&&kn(s,{value:r,tokens:Xe(e,l,t,i),path:t.join("."),doc:l}),o==="@font"&&h==="@font"&&Rn(s,{value:r,tokens:Xe(e,l,t,i),path:t.join("."),doc:l}),o==="@file"&&Bn(s),s}function Ji(e,t,r){if(!t)return;let l=e.getAttribute?.("data-hcms-tpl");l&&l!==t&&console.info(`[hypercms] field "${r.join(".")}" declares component "${t}" but custom template "${l}" wins`)}function Dn(e,t,r,l,i,o,a){let n=Xe(t,i,r,a),s=n?[...n]:[],h=l==null?"":String(l);if(h!==""&&!s.includes(h)&&s.unshift(h),!n&&(Xi(e,"data-hcms-options required (space-separated values)"),s.length===0)){e.querySelector(".mirk-radio")?.remove();return}if(o==="@select"){let p=e.querySelector("select[data-hcms-field]");if(!p)return;for(let u of s){let c=i.createElement("option");c.value=u,c.textContent=Fe(u),p.appendChild(c)}return}let d=e.querySelector(".mirk-radio");if(!d||!d.parentNode)return;let m=yr(r.join("."));for(let p of s){let u=d.cloneNode(!0),c=u.querySelector('input[type="radio"]');c&&(c.value=p,c.name=m);let f=u.querySelector(".mirk-radio__label");f&&(f.textContent=Fe(p)),d.parentNode.insertBefore(u,d)}d.remove()}function yr(e){return"hcms-"+String(e).replace(/[^A-Za-z0-9_-]/g,"-")}function Xi(e,t){let r=e.querySelector?e.querySelector(".hcms-error"):null;r&&(r.textContent=t,r.hidden=!1)}function Bn(e){let t=e.querySelector?e.querySelector("a.mirk-file__name[data-hcms-field]"):null;t&&(t.textContent=Wi(t.getAttribute("href")))}function In(e,t,r,l,i){let o=Be(t,"@object",l);if(!o)throw new Error(`hypercms: missing template for object at "${t.join(".")}"`);let a=he(o,l);if(Ae(a,t),yt(a,le(t)),xt(a,le(t)),ur(o))return io(a,e,t),lo(a,e,r),a;let n=wt(a,".hcms-object-fields",o,t);for(let[s,h]of Gi(e,t,l,i)){let d=r==null?null:r[s],m=vt(h,[...t,s],d,l,i);m&&n.appendChild(m)}return t.length&&!n.children.length&&Object.keys(e).length?null:a}function Pn(e,t,r,l,i){let o=Be(t,"@object-array",l);if(!o)throw new Error(`hypercms: missing template for object-array at "${t.join(".")}"`);let a=he(o,l);Ae(a,t),yt(a,le(t)),xt(a,le(t)),Yi(a,o),to(a,o,t);let n=wt(a,".hcms-array-items",o,t),[,s]=e;return(Array.isArray(r)?r:[]).forEach((h,d)=>{let m=Ki(s,[...t,d],h,l,i);m&&n.appendChild(m)}),eo(a),a}function Ki(e,t,r,l,i){let o=Qi(t,"object-array-item",l);if(!o)throw new Error(`hypercms: missing item template for "${t.join(".")}"`);let a=he(o,l);if(a.setAttribute("data-hcms-card",""),a.classList.contains("hcms-card")||a.classList.add("hcms-card"),Ae(a,t),ur(o))return e&&typeof e=="object"&&!Array.isArray(e)&&(io(a,e,t),lo(a,e,r)),a;let n=wt(a,".hcms-card-fields",o,t);if(e&&typeof e=="object"&&!Array.isArray(e))for(let[s,h]of Gi(e,t,l,i)){let d=r==null?null:r[s],m=vt(h,[...t,s],d,l,i);m&&n.appendChild(m)}return a}function Hn(e,t,r,l){let i=dr(e,l),o=Ti(e,t,l),a=i?i.array:"@scalar-array",n=Be(t,a,l);if(!n)throw new Error(`hypercms: missing template for scalar-array at "${t.join(".")}"`);Ji(n,i?i.array:null,t);let s=he(n,l);Ae(s,t),yt(s,le(t)),xt(s,le(t)),Yi(s,n),to(s,n,t),o&&s.setAttribute("data-hcms-item-tpl",o.item);let h=wt(s,".hcms-array-items",n,t);return(Array.isArray(r)?r:[]).forEach((d,m)=>{let p=Zi([...t,m],d,l,o?o.item:null);p&&h.appendChild(p)}),eo(s),s}function Zi(e,t,r,l){let i=Qi(e,"scalar-array-item",r,l);if(!i)throw new Error(`hypercms: missing item template for "${e.join(".")}"`);let o=he(i,r);return o.setAttribute("data-hcms-array-item",""),o.classList.contains("hcms-array-item")||o.classList.add("hcms-array-item"),Ae(o,e),ro(o,t),o}function Qi(e,t,r,l){let i=e.map(o=>typeof o=="number"?"*":o).join(".");return ee(r,i)||l&&ee(r,l)||ee(r,"@"+t)}function he(e,t){let r=e.content||e,l=t.createElement("div");return l.appendChild(r.cloneNode(!0)),l.firstElementChild||l}function Ae(e,t){e.setAttribute("data-hcms-path",t.join("."))}function Un(e,t){let r=t==null?"":String(t);if(e.matches&&e.matches("[data-hcms-field]")){e.getAttribute("data-hcms-field")||e.setAttribute("data-hcms-field",r);return}(e.querySelectorAll?e.querySelectorAll("[data-hcms-field]"):[]).forEach(l=>{l.getAttribute("data-hcms-field")||l.setAttribute("data-hcms-field",r)})}function yt(e,t){t==null||t===""||!e.setAttribute||e.hasAttribute?.("data-hcms-field")||e.setAttribute("data-hcms-field",String(t))}function xt(e,t){t==null||t===""||(e.querySelectorAll?e.querySelectorAll("[data-hcms-label]"):[]).forEach(r=>{(r.textContent||"").trim()===""&&(r.textContent=Fe(String(t)))})}function Yi(e,t){["data-hcms-no-add","data-hcms-no-remove","data-hcms-no-reorder"].forEach(r=>{t.hasAttribute(r)&&e.setAttribute(r,"")}),["data-hcms-min-items","data-hcms-max-items"].forEach(r=>{t.hasAttribute(r)&&e.setAttribute(r,t.getAttribute(r))})}function eo(e){let t=e.querySelector?e.querySelector(".hcms-array-items"):null;if(!t)return;let r=Array.from(t.querySelectorAll(":scope > [data-hcms-card], :scope > [data-hcms-array-item]")),l=r.length,i=vl(e,"data-hcms-max-items"),o=vl(e,"data-hcms-min-items"),a=e.hasAttribute("data-hcms-no-add"),n=e.hasAttribute("data-hcms-no-remove"),s=e.hasAttribute("data-hcms-no-reorder"),h=e.querySelector('[data-hcms-action="add"]');h&&(h.hidden=a||i!=null&&l>=i),r.forEach((d,m)=>{let p=d.querySelector('[data-hcms-action="remove"]');p&&(p.hidden=n||o!=null&&l<=o);let u=d.querySelector('[data-hcms-action="move-up"]');u&&(u.hidden=s||m===0);let c=d.querySelector('[data-hcms-action="move-down"]');c&&(c.hidden=s||m===l-1)})}function vl(e,t){if(!e||!e.hasAttribute(t))return null;let r=parseInt(e.getAttribute(t),10);return Number.isFinite(r)?r:null}function to(e,t,r){if(e.hasAttribute("data-hcms-no-reorder")||t.hasAttribute("data-hcms-no-reorder"))return;let l=e.querySelector(".hcms-array-items");if(!l)return;let i="hcms-"+r.join(".");l.setAttribute("sortable",i),l.setAttribute("onsorted","hypercmsCommit && hypercmsCommit()")}function le(e){return e.length?e[e.length-1]:null}function ro(e,t){let r=Vn(e);if(r.length!==0)for(let l of r)oo(l,t)}function Vn(e){if(!e)return[];let t=[];return e.matches?.("[data-hcms-field]")&&Wn(e)&&t.push(e),(e.querySelectorAll?e.querySelectorAll("input[data-hcms-field], textarea[data-hcms-field], select[data-hcms-field], img[data-hcms-field], a[data-hcms-field], [contenteditable][data-hcms-field]"):[]).forEach(r=>t.push(r)),t}function Wn(e){let t=(e.tagName||"").toUpperCase();return!!(t==="INPUT"||t==="TEXTAREA"||t==="SELECT"||t==="IMG"||t==="A"||e.hasAttribute?.("contenteditable"))}function lo(e,t,r){(e.querySelectorAll?e.querySelectorAll("[data-hcms-field]"):[]).forEach(l=>{let i=l.getAttribute("data-hcms-field");if(!i)return;if(!t||typeof t!="object"||!(i in t)){console.warn(`[hypercms] inline template field "${i}" is not in the rule shape; ignoring`);return}let o=r==null?null:r[i];oo(l,o)})}function io(e,t,r){e.querySelectorAll&&e.querySelectorAll("[data-hcms-field]").forEach(l=>{let i=l.getAttribute("data-hcms-field");if(!i||t&&typeof t=="object"&&!(i in t))return;let o=[...r,i].join(".");l.setAttribute("data-hcms-path",o)})}function wt(e,t,r,l){if(!e.querySelector)return e;let i=e.querySelector(t);if(i)return i;let o=r?.getAttribute?.("data-hcms-tpl")||l.join(".");throw new Error(`hypercms: template "${o}" is in slotted mode but has no ${t} element`)}function oo(e,t){let r=mr(e),l=(e.tagName||"").toUpperCase(),i=(e.getAttribute("type")||"").toLowerCase();if(l==="INPUT"&&i==="radio"){e.checked=e.value!=null&&String(e.value)===String(t??"");return}if(r==="checked"){e.checked=t===!0||t==="true";return}if(r){e[r]=t==null?"":String(t);return}e.textContent=t==null?"":String(t)}var Gn={Mutation:(e,t)=>e?.Mutation??t?.Mutation,undo:(e,t)=>e?.undo??t?.undo,onPrepareForSave:(e,t)=>e?.addDocumentTransform??t?.onPrepareForSave,onSnapshot:(e,t)=>e?.onSnapshot??t?.onSnapshot,consent:(e,t)=>e?.confirm??t?.consent,RichClay:(e,t)=>e?.RichClay??t?.RichClay,quickcrop:(e,t)=>e?.quickcrop??t?.quickcrop,upload:(e,t)=>e?.upload??(t?.uploadFileBasic?Xn(t.uploadFileBasic):null)},Jn={402:"payment-required",413:"too-large",415:"unsupported-type",401:"unauthorized",403:"forbidden",404:"not-found"},Ot=()=>({ok:!1,msg:"Upload cancelled",msgType:"skipped",code:"aborted",uploads:[]});function Xn(e){return async function(t,{onProgress:r,signal:l}={}){if(l?.aborted)return Ot();try{let i=await e(t,{onProgress:a=>{r?.({loaded:null,total:null,percent:a})}});if(l?.aborted)return Ot();let o=i&&i.uploads||[];return typeof o[0]?.url!="string"?{ok:!1,msg:"The host accepted the file but did not say where it put it",msgType:"error",code:"bad-response",uploads:[]}:{ok:!0,msg:i.msg||"Uploaded",msgType:i.msgType||"success",code:i.code||null,uploads:o}}catch(i){if(l?.aborted)return Ot();let o={};try{o=JSON.parse(i?.response||"{}")}catch{o={}}let a=o.code||Jn[i?.status]||"error";return{ok:!1,msg:i&&i.message||"Upload failed",msgType:"error",code:a,uploads:[]}}}}function W(e,t){let r=Gn[e];if(!r)throw new Error(`hypercms: unknown platform capability "${e}"`);let l=t||(typeof window<"u"?window:null);return l&&r(l.clay,l.hyperclay)||null}var Kn=["clay:mutation-ready","hyperclay:mutation-ready"],Zn=["clay:sync-applied","hyperclay:livesync-applied"],Qn=["clay:ready","hyperclay:ready"];function xr(e,t,r){let l=null,i=o=>{l!==null&&l!==o.type||(l=o.type,queueMicrotask(()=>{l=null}),r(o))};for(let o of t)e.addEventListener(o,i);return()=>{for(let o of t)e.removeEventListener(o,i)}}var ie="data-hcms-bound",ye="data-hcms-bound-id",wr=new Map;function Yn(e,t){wr.set(e,t)}function es(e){wr.delete(e)}function ts(e){let t=e.getAttribute(ye);if(!t)return null;let r=wr.get(t);return!r||!r.restorable()?null:r.originalHTML}var xe="data-hcms-owns-richclay";function At(e){return e&&e.richclay&&e.richclay.RichClay||W("RichClay",e)||(e&&typeof e.RichClay=="function"?e.RichClay:null)}function rs(e,t,r){!e||typeof e.setAttribute!="function"||(e.setAttribute(ie,t?"rich":"plain"),r&&e.setAttribute(xe,"true"))}function ls(e,t){if(!e||typeof e.querySelectorAll!="function")return;let r=e.querySelectorAll(`[${ie}]`);if(!r.length)return;let l=At(t);if(l&&typeof l.stripFromClone=="function")try{l.stripFromClone(e)}catch(i){console.warn("[hypercms] richclay strip failed; editor state may reach the save",i)}for(let i of r)i.getAttribute(xe)==="true"&&i.removeAttribute("data-richclay"),i.removeAttribute(xe),i.removeAttribute(ie)}function is(e,t){if(!e||typeof e.removeAttribute!="function")return;let r=At(t);if(r&&typeof r.stripElement=="function")try{r.stripElement(e)}catch(l){console.warn("[hypercms] richclay element strip failed; the clone stays editable",l)}else e.removeAttribute("contenteditable"),e.removeAttribute("no-undo");e.getAttribute(xe)==="true"&&e.removeAttribute("data-richclay"),e.removeAttribute(xe),e.removeAttribute(ie),e.removeAttribute(ye)}function os(e,t){if(!t||e==null)return e;return r(e);function r(l){if(typeof l=="string"){if(l.endsWith("[]")||P(l)!==-1)return l;let i=null;try{i=t.querySelector(l)}catch{return l}return i&&i.children.length>0?l+"@innerHTML":l}if(Array.isArray(l))return l;if(l&&typeof l=="object"){let i=Object.create(null);for(let[o,a]of Object.entries(l))i[o]=r(a);return i}return l}}function as(e,t){if(!t||e==null)return e;return r(e,[t]);function r(l,i){if(typeof l=="string")return l.endsWith("[]")||P(l)!==-1?l:i.some(o=>ns(o,l))?l+"@innerHTML":l;if(Array.isArray(l)){let[o,a]=l;if(typeof o!="string"||!o)return l;let n=ss(t,o);return n.length?[o,r(a,n)]:l}if(l&&typeof l=="object"){let o=Object.create(null);for(let[a,n]of Object.entries(l))o[a]=r(n,i);return o}return l}}function ns(e,t){let r=null;try{r=e.querySelector(t)}catch{return!1}return r?r.hasAttribute(ie)?r.getAttribute(ie)==="rich":r.children.length>0:!1}function ss(e,t){try{return[...e.querySelectorAll(t)]}catch{return[]}}function ot(e){if(!e||e.tagName!=="TEXTAREA")return;let t=e.ownerDocument.defaultView||(typeof window<"u"?window:null);t&&t.CSS&&t.CSS.supports&&t.CSS.supports("field-sizing: content")||(e.style.height="auto",e.style.height=e.scrollHeight+"px")}function _t(e,t,r=!0){if(!e||!e.querySelectorAll||(e.querySelectorAll("textarea[data-hcms-field]").forEach(ot),r===!1))return;let l=t&&t.defaultView||(typeof window<"u"?window:null),i=At(l);i&&e.querySelectorAll("[contenteditable][data-hcms-field]").forEach(o=>{if(o.__hcmsRichclay)return;let a;try{a=new i(o,{inline:!0,hyperclay:!1,toolbar:["bold","italic","link","undo","redo"]})}catch(s){console.warn("[hypercms] richclay activation failed; field stays plain contenteditable",s);return}o.__hcmsRichclay=a;let n=a&&a.squire;n&&typeof n.addEventListener=="function"&&n.addEventListener("input",()=>{let s=l&&l.Event||Event;o.dispatchEvent(new s("input",{bubbles:!0}))})})}var cs="link[data-hcms-fonts]",hs="link[data-hcms-fonts-preconnect]";function ds(e,t,r){let l=[],i=!1;return o(e,t,[]),{stacks:l,found:i};function o(a,n,s){if(typeof a=="string"){if(a.endsWith("[]")||De(a,r,s,e)!=="@font")return;i=!0,n!=null&&n!==""&&l.push(String(n));return}if(Array.isArray(a)){let h=Array.isArray(n)?n:[];h.forEach(d=>o(a[1],d,[...s,"*"])),h.length||o(a[1],void 0,[...s,"*"]);return}if(a&&typeof a=="object")for(let[h,d]of Object.entries(a))o(d,n?.[h],[...s,h])}}function us(e,t){let r=e?.head;if(!r)return;let l=r.querySelector(cs),i=r.querySelector(hs);if(!t){l?.remove(),i?.remove();return}i||(i=e.createElement("link"),i.setAttribute("rel","preconnect"),i.setAttribute("href","https://fonts.gstatic.com"),i.setAttribute("crossorigin",""),i.setAttribute("data-hcms-fonts-preconnect",""),i.setAttribute("no-undo",""),r.appendChild(i)),l||(l=e.createElement("link"),l.setAttribute("rel","stylesheet"),l.setAttribute("data-hcms-fonts",""),l.setAttribute("no-undo",""),i.after(l)),l.getAttribute("href")!==t&&l.setAttribute("href",t)}function Ar(e,t){if(!e?.doc||e.pageRules==null)return;let{stacks:r,found:l}=ds(e.pageRules,t,e.doc);l&&us(e.doc,Pi(r))}var Lt=new WeakSet;function Ie(e,t){let r=W("undo");if(!r)return t();r.pause();try{let l=t();return l&&l.ok?r.commitCaptured(e):r.discardCaptured(),l}finally{r.resume()}}function _e(e){let t=W("undo");if(!t)return e();t.pause();try{return e()}finally{t.discardCaptured(),t.resume()}}function ao(e){let{formRoot:t}=e;if(!t||Lt.has(t))return;Lt.add(t);let r=a=>{let n=a.target;!n||!n.closest||n.closest("[data-hcms-form-root]")&&(n.matches("[data-hcms-color-input]")||n.matches("input, textarea, select, [contenteditable][data-hcms-field]")&&(n.tagName==="TEXTAREA"&&ot(n),!n.matches('input[type="file"]')&&(!n.closest("[data-hcms-field]")&&!n.hasAttribute?.("data-hcms-field")||$e(n,e))))},l=a=>{let n=a.target;if(!(!n||!n.closest)&&n.closest("[data-hcms-form-root]")){if(n.matches("[data-hcms-color-input]")){let s=An(n);s&&$e(s,e);return}if(n.matches('input[type="file"][data-hcms-upload]')){ys(n,e);return}n.matches('input[type="checkbox"], input[type="radio"], select')&&$e(n,e)}},i=a=>{let n=a.target;if(!n||!n.closest)return;let s=n.closest("[data-hcms-action]");if(!s)return;let h=s.getAttribute("data-hcms-action");if(h==="add"||h==="remove"||h==="move-up"||h==="move-down"||h==="clear-upload"||h==="color-pick"||h==="color-clear"||h==="color-panel"||h==="font-pick"||h==="font-panel"){if(!s.closest("[data-hcms-form-root]"))return}else if(h==="close"&&!s.closest("[data-hcms-shell]"))return;if(h==="add"){let d=s.closest("[data-hcms-path]");if(!d)return;let m=d.getAttribute("data-hcms-path");_r(m,e)}else if(h==="remove"){let d=s.closest("[data-hcms-card], [data-hcms-array-item]");if(!d)return;ho(d,e)}else if(h==="move-up"||h==="move-down"){let d=s.closest("[data-hcms-card], [data-hcms-array-item]");if(!d)return;co(d,h==="move-up"?-1:1,e)}else if(h==="clear-upload")_s(s,e);else if(h==="color-pick"||h==="color-clear"){let d=h==="color-pick"?yn(s):xn(s);d&&$e(d,e)}else if(h==="color-panel")wn(s);else if(h==="font-pick"){let d=On(s);d&&$e(d,e)}else h==="font-panel"?$n(s):h==="close"&&e.onCloseRequested?.()},o=t.ownerDocument;o.addEventListener("input",r,!0),o.addEventListener("change",l,!0),o.addEventListener("click",i,!0),e.detachEvents=()=>{o.removeEventListener("input",r,!0),o.removeEventListener("change",l,!0),o.removeEventListener("click",i,!0),Lt.delete(t)}}var ms=new Set(["value","checked"]);function ps(e,t){if(!t)return null;let r=ve(t);if(r.some(s=>typeof s=="number"||s==="*"))return null;let l=lt(e.pageRules,r);if(typeof l!="string")return null;let i=Z.ruleAttrIndex(l);if(i===-1)return null;let o=l.slice(i+1);if(!ms.has(o))return null;let a=l.slice(0,i),n=a?e.pageRoot.querySelector(a):se(e.pageRoot);return n?{el:n,prop:o,oldValue:n[o]}:null}function $e(e,t){let r=(e.closest("[data-hcms-field]")||e).closest("[data-hcms-path]")?.getAttribute("data-hcms-path")||"",l=ps(t,r);if(te(K(t),{path:r,structural:!1},t),l){let i=W("undo");i&&typeof i.recordValue=="function"&&i.recordValue(l.el,{prop:l.prop,oldValue:l.oldValue,newValue:l.el[l.prop]})}}var fs={type:"image/webp",quality:.85,maxWidth:2048,maxHeight:2048};async function gs(e,t){let r=t&&t.getAttribute?t.getAttribute("data-hcms-crop"):null;if(r==null)return{file:e};let l=W("quickcrop");if(typeof l!="function")return{file:e};try{let i=typeof window<"u"&&(window.clay?.modal??window.themodal)||"auto",o=await l(e,{aspect:bs(r),modal:i,...fs});return o===null?null:{file:ks(o.blob,e.name),dataURL:o.dataURL}}catch(i){return we(t,i&&i.message||"Crop failed"),null}}function bs(e){let t=String(e??"").trim().toLowerCase();if(t===""||t==="free")return null;let r=t.match(/^(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)$/);if(!r)return null;let l=parseFloat(r[1]),i=parseFloat(r[2]);return!l||!i?null:l/i}function ks(e,t){let r=e.type==="image/webp"?".webp":e.type==="image/jpeg"?".jpg":".png",l=String(t||"image").replace(/\.[^.]+$/,"");try{return new File([e],l+r,{type:e.type})}catch{return e}}var vs=new Set(["unsupported","payment-required"]);async function ys(e,t){let r=e.files&&e.files[0];if(!r)return;let l=e.closest("[data-hcms-path]");if(!l)return;let i=l.getAttribute("data-hcms-path")||"";we(l,null);let o=await gs(r,l);if(!o||t.closed){ae(e);return}let a=o.file,n=o.dataURL||null,s=W("upload");if(typeof s!="function")return jt(e,l,t,i,await yl(a,n,l),a);so(l,n),xl(l,0);let h=ws(t),d;try{d=await s(a,{signal:h?.signal,onProgress:({percent:p})=>xl(l,p)})}finally{As(t,h),Ss(l)}if(t.closed){ae(e);return}if(d.code==="aborted"){ae(e);return}if(d.ok)return jt(e,l,t,i,d.uploads[0].url,a);if(!vs.has(d.code)){we(l,d.msg||"Upload failed"),t.dispatch?.("hcms:error",{error:new Error(d.msg||"Upload failed"),code:d.code,path:i}),ae(e);return}let m=d.code==="payment-required"?"This file is stored in the page. Add a paid plan to upload files.":null;return jt(e,l,t,i,await yl(a,n,l),a,m)}function jt(e,t,r,l,i,o,a=null){if(r.closed){ae(e);return}if(so(t,null),we(t,null),!i){ae(e);return}no(t,i,o.name),te(K(r),{path:l,structural:!1},r),a&&we(t,a,"info"),ae(e)}async function yl(e,t,r){return t||await xs(e,r)}function xs(e,t){let r=t?.ownerDocument?.defaultView?.FileReader||globalThis.FileReader;return r?new Promise(l=>{let i=new r;i.onload=()=>l(typeof i.result=="string"?i.result:""),i.onerror=()=>l("");try{i.readAsDataURL(e)}catch{l("")}}):Promise.resolve("")}function ws(e){if(typeof AbortController!="function")return null;let t=new AbortController;return(e.uploads||(e.uploads=new Set)).add(t),t}function As(e,t){t&&e.uploads?.delete(t)}function _s(e,t){let r=e.closest("[data-hcms-path]");if(!r)return;let l=r.getAttribute("data-hcms-path")||"";no(r,"","");let i=r.querySelector('input[type="file"][data-hcms-upload]');i&&ae(i),we(r,null),te(K(t),{path:l,structural:!1},t)}function Es(e){return e.querySelector?e.querySelector("img[data-hcms-field], a[data-hcms-field]"):null}function no(e,t,r){let l=Es(e);if(!l)return;let i=(l.tagName||"").toUpperCase();i==="IMG"?l.src=t||"":i==="A"&&(l.href=t||"",l.textContent=t?r||Wi(t):"")}function ae(e){try{e.value=""}catch{}}function so(e,t){let r=e.querySelector?e.querySelector(".mirk-image__frame"):null;r&&(t?r.style.backgroundImage=`url("${t.replace(/"/g,"%22")}")`:r.style.removeProperty("background-image"))}function xl(e,t){let r=Math.max(0,Math.min(100,Number(t)||0));e.setAttribute("data-hcms-uploading",""),e.style?.setProperty?.("--hcms-upload-progress",`${r}%`)}function Ss(e){e.removeAttribute("data-hcms-uploading"),e.style?.removeProperty?.("--hcms-upload-progress")}function we(e,t,r="error"){let l=e.querySelector?e.querySelector(":scope > .hcms-error"):null;l&&(l.classList.toggle("hcms-error--info",!!t&&r==="info"),t?(l.textContent=t,l.hidden=!1):(l.textContent="",l.hidden=!0))}function _r(e,t){let{formRoot:r,pageRules:l}=t,i=r.querySelector(`[data-hcms-path="${Ee(e)}"]`);if(!i)throw new Error(`hypercms: no element at path "${e}"`);let o=i.querySelector(".hcms-array-items");if(!o)throw new Error(`hypercms: array container missing .hcms-array-items at "${e}"`);let a=ve(e),n=$s(l,a),s=Array.isArray(n),h=typeof n=="string"&&n.endsWith("[]");if(!s&&!h)throw new Error(`hypercms: path "${e}" is not an array`);let d=at(i,"data-hcms-max-items"),m=o.querySelectorAll(":scope > [data-hcms-card], :scope > [data-hcms-array-item]");if(i.hasAttribute("data-hcms-no-add")||d!=null&&m.length>=d)return;let p=m.length,u=s?n[1]:n.replace(/\[\]$/,""),c=sr(s?u:"string"),f=zn({shape:s?"object-array-item":"scalar-array-item",itemShape:u,pathArr:[...a,p],data:c,doc:t.doc,itemKey:i.getAttribute("data-hcms-item-tpl")||null,pageRules:l});return o.appendChild(f),_t(f,t.doc,t.view?.enhanceFormRichText!==!1),Er(i),Ie(`Add ${e}`,()=>te(K(t),{path:e,structural:!0},t))}function co(e,t,r){let l=e.closest('[data-hcms-shape="object-array"], [data-hcms-shape="scalar-array"]');if(!l||l.hasAttribute("data-hcms-no-reorder"))return;let i=l.querySelector(".hcms-array-items");if(!i)return;let o=Array.from(i.querySelectorAll(":scope > [data-hcms-card], :scope > [data-hcms-array-item]")),a=o.indexOf(e);if(a<0)return;let n=a+t;if(n<0||n>=o.length)return;let s=e.querySelector(`[data-hcms-action="${t<0?"move-up":"move-down"}"]`);return t<0?i.insertBefore(e,o[n]):i.insertBefore(e,o[n].nextSibling),Sr(i),Er(l),s&&typeof s.focus=="function"&&e.querySelector(`[data-hcms-action="${t<0?"move-up":"move-down"}"]`)?.focus?.(),Ie(`Reorder ${l.getAttribute("data-hcms-path")||""}`,()=>te(K(r),{path:l.getAttribute("data-hcms-path")||"",structural:!0},r))}var Nt="Delete this item?";function Cs(e,t){let r=e&&e.getAttribute("data-hcms-confirm-remove");if(r!=null)return/^(off|false|no|0)$/i.test(r.trim())?null:r||Nt;let l=t&&t.confirmRemove;return l===!1?null:typeof l=="string"?l||Nt:l===!0||e&&e.getAttribute("data-hcms-shape")==="object-array"?Nt:null}function ho(e,t){let r=e.closest('[data-hcms-shape="object-array"], [data-hcms-shape="scalar-array"]'),l=Cs(r,t);if(l==null)return Oe(e,t);let i=W("consent")||typeof window<"u"&&window.consent;typeof i=="function"?Promise.resolve(i(l)).then(()=>{t.closed||Oe(e,t)},()=>{}):typeof window<"u"&&typeof window.confirm=="function"?window.confirm(l)&&Oe(e,t):Oe(e,t)}function Oe(e,t){let r=e.getAttribute("data-hcms-path")||"",l=e.parentElement,i=e.closest('[data-hcms-shape="object-array"], [data-hcms-shape="scalar-array"]');if(!i?.hasAttribute("data-hcms-no-remove")){if(i){let o=at(i,"data-hcms-min-items"),a=i.querySelector(".hcms-array-items"),n=a?a.querySelectorAll(":scope > [data-hcms-card], :scope > [data-hcms-array-item]").length:0;if(o!=null&&n<=o)return}return e.remove(),l&&Sr(l),i&&Er(i),Ie(`Remove ${r}`,()=>te(K(t),{path:r,structural:!0},t))}}function te(e,t,r){if(r.closed)return{ok:!1,skipped:!0,closed:!0};let l=nt(e);if(!t.structural&&l===r.lastFingerprint)return{ok:!0,skipped:!0};let i=Object.hasOwn(r,"writeRules")?r.writeRules:r.pageRules,o=Ia(r.pageRoot,i,e,{shellRoot:r.shellRoot,structural:!!t.structural,structuralPath:t.path||null,formRoot:r.formRoot});return o.ok?(r.lastFingerprint=l,r.lastData=e,Ar(r,e),wl(r,null),r.dispatch?.("hcms:change",{data:e,path:t.path,structural:!!t.structural}),r.onChange?.(e,t)):(wl(r,qs(o.error,t.path)),r.dispatch?.("hcms:error",{error:o.error,attemptedData:e}),r.onError?.(o.error)),o}function uo(e,t){let r=Ee(t),l=`[data-hcms-path="${r}"] input[data-hcms-field], [data-hcms-path="${r}"] textarea[data-hcms-field], [data-hcms-path="${r}"] select[data-hcms-field], [data-hcms-path="${r}"] img[data-hcms-field], [data-hcms-path="${r}"] a[data-hcms-field], [data-hcms-path="${r}"] [contenteditable][data-hcms-field], input[data-hcms-path="${r}"][data-hcms-field], textarea[data-hcms-path="${r}"][data-hcms-field], select[data-hcms-path="${r}"][data-hcms-field], img[data-hcms-path="${r}"][data-hcms-field], a[data-hcms-path="${r}"][data-hcms-field], [contenteditable][data-hcms-path="${r}"][data-hcms-field]`;return e.querySelector(l)}function mo(e,t,r,l){let i=(e.tagName||"").toUpperCase(),o=(e.getAttribute("type")||"").toLowerCase();if(i==="INPUT"&&o==="checkbox"){e.checked=t===!0||t==="true";return}if(i==="INPUT"&&o==="radio"){let a=Ee(l),n=r.querySelectorAll(`[data-hcms-path="${a}"][data-hcms-field][type="radio"], [data-hcms-path="${a}"] [data-hcms-field][type="radio"]`);n.length?n.forEach(s=>{s.checked=String(s.value)===String(t??"")}):e.checked=String(e.value)===String(t??"");return}if(i==="IMG"){e.src=t==null?"":String(t);return}if(i==="A"){e.href=t==null?"":String(t);return}if(e.hasAttribute&&e.hasAttribute("contenteditable")){e.innerHTML=t==null?"":String(t);return}if("value"in e){e.value=t==null?"":String(t);return}e.textContent=t==null?"":String(t)}function K(e){let t=Z.extract(e.formRoot,e.formRules,{exclude:null});return ce(t,e.formRules)}function ce(e,t){if(t==null||e==null)return e;if(typeof t=="string")return t.endsWith("@checked")?e===!0||e==="true":e;if(Array.isArray(t)){if(!Array.isArray(e))return e;let[,r]=t;return e.map(l=>ce(l,r))}if(typeof t=="object"){if(typeof e!="object"||Array.isArray(e))return e;let r={};for(let[l,i]of Object.entries(t))r[l]=ce(e[l],i);return r}return e}function wl(e,t){e.lastErrors=t&&t.length?t:null,po(e)}function po(e){if(Ts(e),e.errorEl&&(e.errorEl.textContent="",e.errorEl.hidden=!0),!e.lastErrors)return;let t=[];for(let{message:r,path:l}of e.lastErrors){if(l!=null&&l!==""){let i=Rs(e.formRoot,l);if(i){i.textContent=i.textContent?`${i.textContent}
${r}`:r,i.hidden=!1;continue}}t.push(r)}t.length&&e.errorEl&&(e.errorEl.textContent=t.join(`
`),e.errorEl.hidden=!1)}function Ts(e){if(e.formRoot)for(let t of e.formRoot.querySelectorAll(".hcms-error"))t.textContent="",t.hidden=!0}function Rs(e,t){if(!e)return null;let r=t.split(".");for(;r.length>0;){let l=r.join("."),i=typeof CSS<"u"&&CSS.escape?CSS.escape(l):l.replace(/[^a-zA-Z0-9_\-.*]/g,a=>"\\"+a),o=e.querySelector(`[data-hcms-path="${i}"]`);if(o){for(let a of o.children)if(a.classList&&a.classList.contains("hcms-error"))return a}r.pop()}return null}function qs(e,t){return e?e.name==="EmptyListInsert"?[{message:"Add a seed item in HTML first.",path:t}]:e.name==="ShapeMismatch"&&Array.isArray(e.mismatches)&&e.mismatches.length?e.mismatches.map(r=>({message:`Shape mismatch: expected ${r.expected}, got ${r.got}`,path:r.path})):[{message:e.message||String(e),path:t}]:[{message:"unknown error",path:t}]}function $s(e,t){let r=e;for(let l of t){if(r==null||typeof r=="string")return;if(Array.isArray(r)){if(typeof l!="number"&&l!=="*")return;r=r[1];continue}if(typeof r=="object"){if(typeof l=="number"||!(l in r))return;r=r[l];continue}return}return r}function at(e,t){if(!e||!e.hasAttribute(t))return null;let r=parseInt(e.getAttribute(t),10);return Number.isFinite(r)?r:null}function Er(e){if(!e)return;let t=e.querySelector(".hcms-array-items");if(!t)return;let r=Array.from(t.querySelectorAll(":scope > [data-hcms-card], :scope > [data-hcms-array-item]")),l=r.length,i=at(e,"data-hcms-max-items"),o=at(e,"data-hcms-min-items"),a=e.hasAttribute("data-hcms-no-add"),n=e.hasAttribute("data-hcms-no-remove"),s=e.hasAttribute("data-hcms-no-reorder"),h=e.querySelector(':scope > .hcms-add, :scope > * > .hcms-add, :scope > [data-hcms-action="add"]');h&&(h.hidden=a||i!=null&&l>=i),r.forEach((d,m)=>{let p=d.querySelector('[data-hcms-action="remove"]');p&&(p.hidden=n||o!=null&&l<=o);let u=d.querySelector('[data-hcms-action="move-up"]');u&&(u.hidden=s||m===0);let c=d.querySelector('[data-hcms-action="move-down"]');c&&(c.hidden=s||m===l-1)})}function fo(e){!e||!e.querySelectorAll||e.querySelectorAll(".hcms-array-items").forEach(t=>Sr(t))}function Sr(e){let t=e.querySelectorAll?Array.from(e.querySelectorAll('input[type="radio"][data-hcms-field]'),l=>[l,l.checked]):[],r=0;for(let l of e.children){if(!l.matches?.("[data-hcms-card], [data-hcms-array-item]"))continue;let i=l.getAttribute("data-hcms-path");if(!i)continue;let o=i.split(".");o[o.length-1]=String(r);let a=o.join(".");a!==i&&Os(l,i,a),r++}for(let[l,i]of t)l.checked!==i&&(l.checked=i)}function Os(e,t,r){let l=e.querySelectorAll("[data-hcms-path]");e.setAttribute("data-hcms-path",r);for(let i of l){let o=i.getAttribute("data-hcms-path");o===t?i.setAttribute("data-hcms-path",r):o&&o.startsWith(t+".")&&i.setAttribute("data-hcms-path",r+o.slice(t.length))}Ls(e)}function Ls(e){for(let t of e.querySelectorAll('input[type="radio"][data-hcms-field]')){if(!t.name||!t.name.startsWith("hcms-"))continue;let r=t.closest("[data-hcms-path]");r&&(t.name=yr(r.getAttribute("data-hcms-path")))}}function nt(e){return JSON.stringify(e,(t,r)=>{if(r&&typeof r=="object"&&!Array.isArray(r)){let l=Object.create(null);for(let i of Object.keys(r).sort())l[i]=r[i];return l}return r})}function Ee(e){return typeof CSS<"u"&&CSS.escape?CSS.escape(e):String(e).replace(/[^a-zA-Z0-9_\-.*]/g,t=>"\\"+t)}var Ze="hcms-shell-styles",js="hcms-bundled-styles-installed",Cr="hcms-session-open",Ns='a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',pe=new WeakSet,Jt="";function Ms(e){Jt=e}function st(e){e?.body?.classList.add(Cr)}function go(e){e?.body?.classList.remove(Cr)}var zs=0;function Al(e){return String(e).replace(/[&<>"]/g,t=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[t])}function Fs({mountTo:e,side:t="right",overlay:r=!1,showSaveButton:l=!1,title:i="Page content",eyebrow:o="Edit",theme:a=null,doc:n}){bo(n);let s=`hcms-shell-title-${++zs}`,h=n.createElement("div");h.setAttribute("data-hcms-shell",""),h.setAttribute("editor-ui",""),h.setAttribute("save-remove",""),h.setAttribute("save-ignore",""),h.setAttribute("tabindex","-1"),h.setAttribute("role","dialog"),h.setAttribute("aria-modal","true"),h.setAttribute("aria-labelledby",s);let d=a==="dark"?" dark":a==="light"?" light":"";h.className="hcms-shell pixel-quiet hcms-panel hcms-side-"+t+(r?" hcms-overlay":"")+d;let m=Al(i),p=Al(o);h.innerHTML=`
    <div class="hcms-shell-minibar" aria-hidden="true">
      <span class="hcms-shell-minibar-title">${m}</span>
      <button type="button" class="hcms-shell-close mirk-button mirk-button--small" data-hcms-action="close" aria-label="Close">
        <span class="mirk-button__label">\xD7</span>
      </button>
    </div>
    <div class="hcms-shell-body">
      <header class="hcms-shell-header">
        <div class="hcms-shell-heading">
          <div class="hcms-shell-eyebrow">${p}</div>
          <h2 class="hcms-shell-title" id="${s}">${m}</h2>
        </div>
        <button type="button" class="hcms-shell-close mirk-button mirk-button--small" data-hcms-action="close" aria-label="Close">
          <span class="mirk-button__label">\xD7</span>
        </button>
      </header>
      <div class="hcms-shell-notice" role="status" hidden></div>
      <div class="hcms-shell-error" role="alert" hidden></div>
      <div data-hcms-form-root class="hcms-form"></div>
      <footer class="hcms-shell-footer"${l?"":" hidden"}>
        <button type="button" class="hcms-shell-save mirk-button" trigger-save>
          <span class="mirk-button__label">Save</span>
        </button>
      </footer>
    </div>
  `,(e||n.body).appendChild(h);let u=n.body;u.classList.add("hcms-open"),st(n),r&&u.classList.add("hcms-overlay"),t==="left"&&u.classList.add("hcms-side-left");let c=Bs(h,n),f=Ds(h);return{root:h,formRoot:h.querySelector("[data-hcms-form-root]"),noticeEl:h.querySelector(".hcms-shell-notice"),errorEl:h.querySelector(".hcms-shell-error"),saveButton:h.querySelector(".hcms-shell-save"),destroy(){c.detach(),f.detach(),h.remove(),u.classList.remove("hcms-open","hcms-overlay","hcms-side-left"),go(n)},restoreChrome(){Pe(n),u.classList.add("hcms-open"),st(n),r&&u.classList.add("hcms-overlay"),t==="left"&&u.classList.add("hcms-side-left")}}}function Pe(e){e&&(e.getElementById(Ze)||e.querySelector("style[data-hcms-bundled-styles]")||(pe.delete(e),bo(e)))}function bo(e){if(e&&!pe.has(e)){if(e[js]){pe.add(e);return}if(e.getElementById(Ze)||e.querySelector("style[data-hcms-bundled-styles]")){pe.add(e);return}if(Jt){let t=e.createElement("style");t.id=Ze,t.setAttribute("save-remove",""),t.setAttribute("save-ignore",""),t.textContent=Jt,(e.head||e.documentElement).appendChild(t),pe.add(e);return}try{let t=new URL("./theme.generated.css",import.meta.url).href,r=e.createElement("link");r.rel="stylesheet",r.id=Ze,r.setAttribute("save-remove",""),r.setAttribute("save-ignore",""),r.href=t,(e.head||e.documentElement).appendChild(r),pe.add(e)}catch{let t=()=>{link.isConnected&&console.warn("hypercms: shell stylesheet not applied \u2014 cssText is empty and the co-located theme fallback is unavailable. Call installStyles(themeText) before opening the CMS.")};e.defaultView?.queueMicrotask?e.defaultView.queueMicrotask(t):t()}}}function Ds(e){let t=e.querySelector(".hcms-shell-body"),r=e.querySelector(".hcms-shell-header");if(!t||!r||typeof t.addEventListener!="function")return{detach(){}};let l=()=>{let i=(r.offsetHeight||0)-12;e.classList.toggle("is-condensed",t.scrollTop>i)};return t.addEventListener("scroll",l,{passive:!0}),l(),{detach(){t.removeEventListener("scroll",l)}}}function Bs(e,t){function r(l){if(l.key!=="Tab"||!e.contains(t.activeElement))return;let i=Array.from(e.querySelectorAll(Ns));if(i.length===0)return;let o=i[0],a=i[i.length-1];l.shiftKey&&t.activeElement===o?(l.preventDefault(),a.focus()):!l.shiftKey&&t.activeElement===a&&(l.preventDefault(),o.focus())}return t.addEventListener("keydown",r),{detach:()=>t.removeEventListener("keydown",r)}}var Is="[hypercms]",_l={skip:"[data-hcms-shell]",templateAttr:"cms-template"},El={skip:"[data-hcms-shell]",templateAttr:null},Ps=class extends Error{constructor(e,t,r){super(`hypercms: rule at "${e}" has an invalid CSS selector: "${t}"`),this.name="InvalidRuleSelector",this.path=e,this.selector=t,this.cause=r}};function ko(e,t){let r=[],l=[],i=[];return Kt(ge(e),e,t,[],r,l,i),{missing:Sl(r),twins:Gs(l),readOnly:Sl(i)}}function vo(e){return Xt(e)}function Xt(e){if(typeof e=="string")return yo(e)?void 0:e;if(Array.isArray(e)){let[t,r]=e;return[t,Xt(r)]}if(e&&typeof e=="object"){let t={};for(let[r,l]of Object.entries(e)){let i=Xt(l);i!==void 0&&(t[r]=i)}return t}return e}function Kt(e,t,r,l,i,o,a){if(typeof r=="string"){let n=Hs(r),s=n?Ge(e,t,n,_l,l):[];if(yo(r)){a.push(fe(l));return}if(!n)return;if(r.endsWith("[]")){s.length===0&&Ge(e,t,n,El,l).length===0&&i.push(fe(l));return}s.length===0?i.push(fe(l)):s.length>1&&o.push({path:fe(l),count:s.length});return}if(Array.isArray(r)){let[n,s]=r;if(typeof n!="string"||!n)return;let h=Ge(e,t,n,_l,l);if(h.length===0){Ge(e,t,n,El,l).length===0&&i.push(fe(l));return}for(let d of h)Kt(e,d,s,[...l,"*"],i,o,a);return}if(r&&typeof r=="object")for(let[n,s]of Object.entries(r))Kt(e,t,s,[...l,n],i,o,a)}function Ge(e,t,r,l,i){try{return e.find(t,r,l)}catch(o){throw new Ps(fe(i),r,o)}}function Hs(e){if(e==="."||e.startsWith("@"))return null;if(e.endsWith("[]"))return e.slice(0,-2)||null;let t=P(e);return(t===-1?e:e.slice(0,t))||null}function Us(e){if(e.endsWith("[]"))return null;let t=P(e);return t===-1?null:e.slice(t+1)||null}function yo(e){let t=Us(e);return t!=null&&Zl.has(t)}function Tr(e){Vs(e),Ws(e)}function Vs(e){let t=e.noticeEl;if(!t)return;let r=e.unresolved&&e.unresolved.missing||[],l=e.unresolved&&e.unresolved.readOnly||[];if(r.length===0&&l.length===0){t.textContent="",t.hidden=!0;return}let i=[];if(r.length){let o=r.length===1?"1 field no longer matches this page":`${r.length} fields no longer match this page`;i.push(`${o}: ${r.join(", ")}`)}if(l.length){let o=l.length===1?"1 field reads a property the browser will not let anything write":`${l.length} fields read properties the browser will not let anything write`;i.push(`${o}: ${l.join(", ")}`)}t.textContent=i.join(`
`),t.hidden=!1}function Ws(e){let t=e.unresolved&&e.unresolved.twins||[],r=t.map(l=>`${l.path}:${l.count}`).join("|");if(r!==e.lastTwinSignature){e.lastTwinSignature=r;for(let{path:l,count:i}of t)console.warn(`${Is} "${l}" matches ${i} elements; edits go to the first one.`)}}function Sl(e){return[...new Set(e)]}function Gs(e){let t=new Map;for(let r of e){let l=t.get(r.path);(!l||r.count>l.count)&&t.set(r.path,r)}return[...t.values()]}function fe(e){return e.length?e.join("."):"(whole page)"}var Js={skip:"[data-hcms-shell]",templateAttr:"cms-template"};function be(e,{ignoreActiveValue:t}={}){return Xs(e,{ignoreActiveValue:t})}function Xs(e,{ignoreActiveValue:t}){let r=Z.findRules(e.doc,e.rulesSource||"cms");r&&(e.pageRules=e.view.prepareRules(r.rules),e.rulesTagNode=r.tagNode),Ci(e.doc),$i(e.doc,e.pageRules),e.formRules=ji(e.pageRules,e.doc),e.writeRules=vo(e.pageRules),e.unresolved=ko(e.pageRoot,e.pageRules);let l=Ai(),i=ce(Z.extract(e.pageRoot,e.pageRules,{...Js,...l.hooks}),e.pageRules),o=vr({pageRules:e.pageRules,formRules:e.formRules,data:i,doc:e.doc});vi(e.formRoot,o,{ignoreActiveValue:t}),Ar(e,i),l.seed(e.formRoot),_t(e.formRoot,e.doc,e.view?.enhanceFormRichText!==!1),po(e),Tr(e),e.updateFingerprint&&e.updateFingerprint()}function Ks({debounce:e=100,onRefresh:t}){let r=W("Mutation");if(!r||typeof r.onAnyChange!="function")throw new Error("hypercms: a mutation hub is required (clay.Mutation or hyperclay.Mutation). Load clayjs or hyperclayjs, or just the mutation utility, before initializing hypercms.");let l=r.onAnyChange({debounce:e},i=>{t(i)});return{unsubscribe:typeof l=="function"?l:()=>{}}}var Zs='input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])';function Qs({doc:e,pageRoot:t,opts:r={}}){let l=r.richText!==!1,i=null;return{name:"sidebar",richText:l,enhanceFormRichText:!0,ctx:null,root:null,formRoot:null,errorEl:null,noticeEl:null,prepareRules(o){return l?os(o,t):o},mount(o){let a=this.ctx;i=_e(()=>Fs({mountTo:r.mountTo||e.body,side:r.side||"right",overlay:!!r.overlay,showSaveButton:!!r.showSaveButton,title:r.title,eyebrow:r.eyebrow,theme:r.theme,doc:e})),this.root=i.root,this.formRoot=i.formRoot,this.errorEl=i.errorEl,this.noticeEl=i.noticeEl;let n=vr({pageRules:a.pageRules,formRules:a.formRules,data:o,doc:e});i.formRoot.appendChild(n),a.seeder.seed(i.formRoot),_t(i.formRoot,e),Tr(a),ao(a)},refresh(o){if(o==="livesync"){i?.restoreChrome?.(),be(this.ctx,{ignoreActiveValue:!0});return}if(o==="undo"){be(this.ctx,{ignoreActiveValue:!1});return}be(this.ctx)},focusOnOpen(){let o=this.root&&this.root.querySelector(Zs);o&&typeof o.focus=="function"&&o.focus()},destroy(){i?.destroy(),i=null}}}var Ys="[cms-template], [data-hcms-shell]";function Qe(e){if(!e||typeof e.getBoundingClientRect!="function"||typeof e.closest=="function"&&e.closest(Ys))return!1;let t=e.getBoundingClientRect();return t.width>=8&&t.height>=8}var ec={skip:"[data-hcms-shell]",templateAttr:"cms-template"},tc={skip:"[data-hcms-shell]",templateAttr:null},rc="text",lc="native",Cl="handle",ic=new Set(["INPUT","TEXTAREA","SELECT"]),xo=new Set(["IMG","INPUT","TEXTAREA","SELECT","OPTION","BR","HR","VIDEO","AUDIO","IFRAME","EMBED","OBJECT","CANVAS","SOURCE","TRACK","AREA","COL","PARAM","BUTTON","STYLE","SCRIPT","LINK","META"]);function wo(e,t,r=null){let l=[],i=[],o=ge(e);return Zt(o,e,t,[],l,i,r?(a,n)=>hr(a,r,n,t):()=>null),{targets:l,lists:i}}function Zt(e,t,r,l,i,o,a){if(typeof r=="string"){if(r.endsWith("[]")){let m=r.slice(0,-2);if(!m)return;let p=Ye(e,t,m);p.forEach((u,c)=>{i.push(Rl([...l,c],u,r,null))}),o.push(Tl(e,t,l,m,p,!0));return}let n=P(r),s=n===-1?null:r.slice(n+1),h=n===-1?r:r.slice(0,n),d=!h||h==="."?t:Ye(e,t,h)[0];d&&i.push(Rl(l,d,r,s,a(r,l)));return}if(Array.isArray(r)){let[n,s]=r;if(typeof n!="string"||!n)return;let h=Ye(e,t,n);h.forEach((d,m)=>Zt(e,d,s,[...l,m],i,o,a)),o.push(Tl(e,t,l,n,h,typeof s=="string"));return}if(r&&typeof r=="object")for(let[n,s]of Object.entries(r))Zt(e,t,s,[...l,n],i,o,a)}function Tl(e,t,r,l,i,o){let a=i[0]?i[0].parentElement:null;if(!a){let n=Ye(e,t,l,tc)[0];a=n?n.parentElement:null}return{path:r,items:i,container:a,scalar:o}}function Rl(e,t,r,l,i=null){return{path:e,el:t,rule:r,attr:l,kind:oc(t,l),icon:nc(t,l),style:i}}function oc(e,t){let r=(e.tagName||"").toUpperCase();return!t||t==="innerHTML"?xo.has(r)?Cl:rc:t==="value"&&ic.has(r)&&!e.readOnly&&!ac(e)?lc:Cl}function ac(e){return e.disabled?!0:typeof e.matches=="function"&&e.matches(":disabled")}function nc(e,t){let r=(e.tagName||"").toUpperCase();return(!t||t==="innerHTML")&&!xo.has(r)?null:r==="IMG"||t==="srcset"?"camera":r==="A"&&t==="href"?"paperclip":"pencil"}function Ye(e,t,r,l=ec){try{return e.find(t,r,l)}catch{return[]}}function sc(e,t){let r=[],l=new Map,i=null;for(let o of e){if(!o.style)continue;let a=o.path.join(".");if(o.style==="page"){i||(i={scope:"page",el:o.el,list:null,paths:[]},r.push(i)),i.paths.push(a);continue}let n=cc(o.path,t),s=n?n.row:o.el,h=l.get(s);h||(h={scope:n?"row":"section",el:s,list:n?n.list:null,paths:[]},l.set(s,h),r.push(h)),h.paths.push(a)}return r}function cc(e,t){for(let r=e.length-1;r>=0;r--){if(typeof e[r]!="number")continue;let l=e.slice(0,r).join("."),i=t.find(a=>a.path.join(".")===l),o=i&&i.items[e[r]];if(o)return{list:i,row:o}}return null}var Rr=Object.freeze({data:Object.freeze({tokens:["no-data"],bundles:["editor-ui"]}),save:Object.freeze({tokens:["no-save"],bundles:["editor-ui"]}),snapshot:Object.freeze({tokens:["no-snapshot"],bundles:["editor-ui"]}),watch:Object.freeze({tokens:["no-watch"],bundles:["editor-ui"]}),undo:Object.freeze({tokens:["no-undo"],bundles:["editor-ui"]}),history:Object.freeze({tokens:[],bundles:["editor-ui"]})}),hc=Object.freeze({"editor-ui":Object.freeze(["no-data","no-save","no-snapshot","no-watch","no-undo"])}),jh=Object.freeze(["no-save","no-snapshot","no-trigger-autosave","no-dirty","no-watch","no-undo","no-data","freeze","editor-ui","live"]);function ct(e,t){if(!e||e.nodeType!==1)return!1;let r=e.getAttribute?.("clay");return!!(r&&r.split(/\s+/).includes(t)||e.hasAttribute?.(t))}function Ao(e,t){if(ct(e,t))return!0;for(let[r,l]of Object.entries(hc))if(l.includes(t)&&ct(e,r))return!0;return!1}function Qt(e){let t=Rr[e];if(!t)throw new Error(`Unknown region capability: ${e}`);return[...t.tokens,...t.bundles].flatMap(r=>[`[clay~="${r}"]`,`[${r}]`]).join(", ")}function dc(e,t){let r=e&&e.nodeType===1?e:e?.parentElement;for(;r&&r.nodeType===1;){let l=Rr[t];if(!l)throw new Error(`Unknown region capability: ${t}`);if(l.tokens.some(i=>Ao(r,i))||l.bundles.some(i=>ct(r,i)))return r;r=r.parentElement}return null}function uc(e,t){return!!dc(e,t)}var mc=/:(?:focus(?:-within|-visible)?|hover|active|visited|defined)\b/i;function pc(e,t){if(!/^(INPUT|TEXTAREA|SELECT|OPTION)$/.test(e.tagName||""))return;let r=(e.getAttribute?.("type")||"").toLowerCase();"value"in e&&"value"in t&&e.tagName!=="OPTION"&&r!=="checkbox"&&r!=="radio"&&r!=="file"&&(t.value=e.value),e.tagName==="INPUT"&&(r==="checkbox"||r==="radio")&&(t.checked=e.checked),e.tagName==="OPTION"&&(t.selected=e.selected),"indeterminate"in e&&"indeterminate"in t&&(t.indeterminate=e.indeterminate)}function ql(e,t,r,l){if(l)return!!e.closest?.(t);let i=e;for(;i?.nodeType===1;){if(i.matches(t))return!0;if(i===r)break;i=i.parentElement}return!1}function $l(e,t,r,l,i,o){return(o?uc(e,t):ql(e,r,i,!1))||!!(l&&(o&&e!==i?e.matches(l):ql(e,l,i,o)))}function fc(e,t){let r=Rr[t];return r.tokens.some(l=>Ao(e,l))||r.bundles.some(l=>ct(e,l))}var gc=new Set(["INPUT","TEXTAREA","SELECT","OPTION"]);function _o(e,t,r,l){if(e.nodeType===1&&l(e)){r.dropped.push(t);return}r.cloneToLive.set(t,e),r.liveToClone.set(e,t);let i=e,o=t;if(e.nodeType===1){if(gc.has(e.tagName)&&r.controls.push(e,t),e.tagName==="TEMPLATE"){for(;t.firstChild;)t.removeChild(t.firstChild);i=e.content,o=t.content,r.cloneToLive.set(o,i),r.liveToClone.set(i,o)}}else if(e.nodeType!==11)return;let a=o.firstChild;for(let n=i.firstChild;n&&a;n=n.nextSibling)_o(n,a,r,l),a=a.nextSibling}function Eo(e,{capability:t="data",exclude:r=null,inherit:l=!0,provenance:i=null}={}){if(!e)throw new TypeError("createContentView requires a DOM context");let o=e.nodeType===9?e:e.ownerDocument;if(!o?.implementation?.createHTMLDocument)throw new TypeError("createContentView requires an HTML DOM implementation");let a=o.implementation.createHTMLDocument(""),n=i||new WeakMap,s=new WeakMap,h=e.nodeType===9?e.documentElement:e;r&&a.documentElement.matches(r);let d=Qt(t),m=l?c=>fc(c,t)||!!(r&&c.matches(r)):c=>$l(c,t,d,r,h,!1),p=null;if(h.nodeType!==1||!$l(h,t,d,r,h,l)){p=a.importNode(h,!0);let c={cloneToLive:n,liveToClone:s,dropped:[],controls:[]};_o(h,p,c,m);for(let f of c.dropped)f.remove();for(let f=0;f<c.controls.length;f+=2)pc(c.controls[f],c.controls[f+1])}e.nodeType===9&&p&&(a.replaceChild(p,a.documentElement),s.set(e,a),n.set(a,e));let u=c=>{if(mc.test(c))throw new Error(`Filtered content queries do not support stateful selector: ${c}`)};return{root:p,document:a,capability:t,selector:Qt(t),cloneToLive:n,liveToClone:s,original(c){return n.get(c)||null},cloneOf(c){return s.get(c)||null},query(c,f=p){return u(c),Array.from(f.querySelectorAll(c),b=>n.get(b)||b)},text(c=p){return(c===p?p:s.get(c))?.textContent||""},html(c=p){return(c===p?p:s.get(c))?.innerHTML??""},clone(c=p){let f=c===p?p:s.get(c);return f?a.importNode(f,!0):null}}}var bc=[16,8,0],D=8,kc=4;function vc({anchor:e,bar:t,rail:r=t,viewport:l,current:i=null}){let o=p=>i===p?kc:0;if(e.bottom<=0||e.top>=l.height||e.right<=0||e.left>=l.width)return{mode:"hidden",x:0,y:0};let a=p=>Math.max(D,Math.min(e.left,l.width-p-D)),n=e.top-16-t.height;if(n>=D-o("above"))return{mode:"above",x:a(t.width),y:n};let s=e.bottom+16;if(s+t.height<=l.height-D+o("below"))return{mode:"below",x:a(t.width),y:s};let h=l.width-e.right-D,d=e.left-D,m=h>=d?[["rail-right",h],["rail-left",d]]:[["rail-left",d],["rail-right",h]];for(let[p,u]of m)for(let c of bc){if(r.width+c>u+o(p))continue;let f=p==="rail-right"?Math.min(e.right+c,l.width-r.width-D):Math.max(e.left-c-r.width,D),b=Math.min(e.bottom,l.height-D)-r.height,g=Math.max(D,Math.min(Math.max(e.top,D),b));return{mode:p,x:f,y:g,gap:c}}return{mode:"pinned",x:a(t.width),y:D}}function Ol({anchor:e,handle:t,viewport:r,inset:l=6,prefer:i="auto"}){let o=e.height>=t.height*1.5&&e.width>=t.width*2;if(i==="corner"||o){let p=Math.max(D,Math.min(e.right-t.width+l,r.width-t.width-D)),u=Math.max(D,Math.min(e.top-l,r.height-t.height-D));return{x:p,y:u,mode:"over"}}let a=4,n=e.right+a+t.width<=r.width-D,s=n?e.right+a:e.left-a-t.width,h=Math.max(D,s),d=e.top+e.height/2-t.height/2,m=Math.max(D,Math.min(d,r.height-t.height-D));return{x:h,y:m,mode:n?"beside-right":"beside-left"}}var ht=!1;function So(){if(ht)return;let e=W("onPrepareForSave");typeof e=="function"&&(e(t=>{To(t),Co(t)}),ht=!0)}function Co(e){let t=e&&e.querySelector&&e.querySelector("body");t&&t.classList.remove("hcms-open","hcms-overlay","hcms-side-left",Cr)}function To(e){if(!(!e||typeof e.querySelectorAll!="function"))for(let t of e.querySelectorAll(`[${ye}]`)){let r=ts(t);r!==null&&(t.innerHTML=r),t.removeAttribute(ye)}}var dt=!1;function qr(){if(dt)return;let e=W("onSnapshot");typeof e=="function"&&(e(t=>{To(t),ls(t,typeof window<"u"?window:null),Co(t)}),dt=!0)}function yc(){So(),qr(),(!ht||!dt)&&xc()}var Je=null;function xc(){Je||typeof document>"u"||(Je=xr(document,Qn,()=>{So(),qr(),ht&&dt&&(Je?.(),Je=null)}))}var wc={edit:"M8 10h2v6H8zm2 4h4v2h-4zm0-6h2v2h-2zm2-2h2v2h-2zm2-2h2v2h-2zm2-2h2v2h-2zm2 2h2v2h-2zm2 2h2v2h-2zm-2 2h2v2h-2zm-2 2h2v2h-2zm-2 2h2v2h-2zm-4 0h2v2h-2z","move-up":"M11 4h2v2h2v2h2v2h2v2h-4v-2h-2v10h-2V10H9v2H5v-2h2V8h2V6h2z","move-down":"M11 4h2v10h2v-2h4v2h-2v2h-2v2h-2v2h-2v-2H9v-2H7v-2H5v-2h4v2h2z",remove:"M5 5h3v3h3v3h2V8h3V5h3v3h-3v3h-3v2h3v3h3v3h-3v-3h-3v-3h-2v3H8v3H5v-3h3v-3h3v-2H8V8H5z",add:"M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z"};function ut(e){let t=e==="edit"?"6 0 18 18":"0 0 24 24",r=e==="settings"?'<circle cx="6" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="18" cy="12" r="1.5"/>':`<path d="${wc[e]}"/>`;return`<svg class="hcms-inline-icon" xmlns="http://www.w3.org/2000/svg" viewBox="${t}" width="24" height="24" fill="currentColor" aria-hidden="true" focusable="false">${r}</svg>`}var Ll="data-hcms-ghost",Ac=Qt("history");function _c(e){let t=e.container,r=null;for(;t&&(t.namespaceURI!=="http://www.w3.org/1999/xhtml"||["SELECT","OPTGROUP","DATALIST"].includes(t.tagName));)r=t,t=t.parentElement;return{parent:t,anchor:r}}function Ec({doc:e,themeRoot:t,onAdd:r,onResize:l}){let i=e.defaultView,o=[],a=!1,n=null,s=new Map;function h(u,c,f){u.style[c]!==f&&(u.style[c]=f)}function d(){let u=new Set(o.map(c=>c.node.parentElement));for(let[c,f]of s)u.has(c)&&i?.Sortable?.get(c)===f.instance||(f.instance.option("draggable")===f.selector&&f.instance.option("draggable",f.original),s.delete(c));for(let c of u){let f=i?.Sortable?.get(c);if(!f)continue;let b=f.option("draggable");if(s.get(c)?.selector===b)continue;let g=b,k=`${g.trim().startsWith(">")?"> ":""}:is(${g.trim().replace(/^>\s*/,"")}):not(${Ac})`;f.option("draggable",k),s.set(c,{instance:f,original:g,selector:k})}}function m(){for(let u of o){let{node:c,slot:f,list:b}=u,g=b.items.filter(k=>k.isConnected).map(k=>k.getBoundingClientRect()).filter(k=>k.width>0&&k.height>0);g.length&&(u.width=g.reduce((k,y)=>k+y.width,0)/g.length,u.height=g.reduce((k,y)=>k+y.height,0)/g.length),h(c,"width",u.width?`${Math.round(u.width)}px`:"100%"),h(f,"height",`${Math.max(48,Math.round(u.height||64))}px`),f!==c&&(f.colSpan=Math.max(1,...b.items.map(k=>[...k.children].reduce((y,_)=>y+(_.colSpan||1),0)))),c.hidden!==a&&(c.hidden=a)}d()}function p(u,c){let f=c.tagName,b=["TBODY","THEAD","TFOOT","TABLE"].includes(f),g=e.createElement(b?"tr":["UL","OL","MENU"].includes(f)?"li":"div");for(let A of[Ll,"data-hcms-shell","editor-ui","no-watch","no-save","save-remove","snapshot-remove"])g.setAttribute(A,"");g.setAttribute("draggable","false"),g.setAttribute("contenteditable","false"),g.className="hcms-shell pixel-quiet hcms-inline-ghost";for(let A of["light","dark"])g.classList.toggle(A,!!t?.classList.contains(A));let k=b?e.createElement("td"):g;k!==g&&(k.className="hcms-inline-ghost-cell",g.appendChild(k));let y=e.createElement("button");y.type="button",y.className="hcms-inline-list-button hcms-inline-list-add mirk-button mirk-button--small",y.setAttribute("data-hcms-list-action","add"),y.innerHTML=`<span class="mirk-button__label">${ut("add")}<span>Add</span></span>`,k.appendChild(y);let _={node:g,slot:k,button:y,list:u,width:0,height:0};y.addEventListener("click",A=>{A.preventDefault(),A.stopPropagation(),r(_.list)});for(let A of["pointerdown","mousedown","touchstart","click"])g.addEventListener(A,E=>E.stopPropagation());return g.addEventListener("dragstart",A=>{A.preventDefault(),A.stopPropagation()}),_}return{setLists(u){let c=new Set(o),f=[],b=new Set(o.map(k=>k.node)),g=new Set;for(let k of u||[]){if(!k.container||!k.container.isConnected)continue;let{parent:y,anchor:_}=_c(k);if(!y)continue;if(!g.has(y)){for(let $ of y.querySelectorAll(`:scope > [${Ll}]`))b.has($)||$.remove();g.add(y)}let A=o.find($=>c.has($)&&$.list.container===k.container&&$.list.path.join(".")===k.path.join("."))||p(k,y);c.delete(A),A.list=k,A.button.setAttribute("data-hcms-list",k.path.join(".")),A.button.setAttribute("aria-label",`Add to ${k.path.join(".")||"the list"}`);let E=_||k.items.filter($=>$.parentElement===y).at(-1);E?E.nextSibling!==A.node&&E.after(A.node):A.node.parentElement!==y&&y.appendChild(A.node),f.push(A)}for(let k of c)k.node.remove();o=f,n?.disconnect(),!n&&typeof i?.ResizeObserver=="function"&&(n=new i.ResizeObserver(()=>{m(),l?.()}));for(let k of o)for(let y of k.list.items)n?.observe(y);m()},update:m,setHidden(u){a=!!u,m()},destroy(){n?.disconnect();for(let u of o)u.node.remove();o=[],d()}}}var jl=[["move-up","Move up"],["move-down","Move down"]],Sc={prefer:"corner",inset:0};function Cc(e,t){return t.width<=e.width&&t.height<=e.height}function Tc({doc:e,layerEl:t,onActivate:r,onListAction:l,onStyle:i}){let o=e.defaultView,a=[],n=new Map,s=0,h=new Map,d=null,m=new Set,p=0,u=!1,c=null,f=null,b=null,g=null,k=new Map,y=!1,_=null,A=Ec({doc:e,themeRoot:t.closest("[data-hcms-shell]"),onResize:$,onAdd:v=>l?.({action:"add",list:v,index:v.items.length})}),E=e.createElement("div");E.className="hcms-inline-highlight",E.hidden=!0,E.setAttribute("aria-hidden","true"),t.appendChild(E);function $(){if(!(p||!o)){if(typeof o.requestAnimationFrame!="function")return de();p=o.requestAnimationFrame(()=>{p=0,de()})}}let H=()=>b||g;function de(){if(!o)return;A.update();let v={width:o.innerWidth,height:o.innerHeight},x=H();for(let w of a){if(!w.visible){w.node.hidden=!0;continue}for(let T of w.members)T.node.hidden=y&&T.kind!=="handle";w.node.hidden=!1;let C=w.el.getBoundingClientRect(),S=w.node.getBoundingClientRect(),R=S.width,O=w.kind==="row"&&!Cc(C,S);if(O&&w.el!==x){for(let T of w.members)T.kind==="row"&&(T.node.hidden=!0);S=w.node.getBoundingClientRect()}if(w.members.every(T=>T.node.hidden)){w.node.hidden=!0;continue}if(w.kind==="style"){let T=Math.max(8,Math.min(C.left,v.width-S.width-8)),N=Math.max(8,Math.min(C.top,v.height-S.height-8));w.node.style.transform=`translate(${Math.round(T)}px, ${Math.round(N)}px)`;continue}let I=w.kind==="handle"?null:Sc,{x:L,y:Q}=Ol({anchor:C,handle:S,viewport:v,...I}),ue=w.members.find(T=>T.kind==="handle");if(O&&ue){let T=ue.node.getBoundingClientRect(),N=Ol({anchor:C,handle:T,viewport:v}),j=w.members.slice(w.members.indexOf(ue)+1).filter(St=>!St.node.hidden).reduce((St,Jo)=>St+Jo.node.getBoundingClientRect().width+2,0);L=Math.max(8+R,Math.min(v.width-8,N.x+T.width+j))-S.width,Q=N.y}w.node.style.transform=`translate(${Math.round(L)}px, ${Math.round(Q)}px)`}if(_)if(!_.node.isConnected||_.node.closest("[hidden]"))G();else{let w=_.button.getBoundingClientRect(),C=_.menu.getBoundingClientRect();_.menu.style.left=`${Math.max(8,w.right-C.width)-w.left}px`,_.menu.style.right="auto",_.menu.style.top=w.bottom+6+C.height>v.height-8?"auto":"calc(100% + 6px)",_.menu.style.bottom=w.bottom+6+C.height>v.height-8?"calc(100% + 6px)":"auto"}Ce(),c?.()}function U(v){if(v?.closest?.("[data-hcms-ghost]"))return null;for(let x=v;x&&x.nodeType===1;x=x.parentElement){let w=k.get(x);if(w)return w}return null}function ne(v){_&&!_.node.contains(v.target)&&G();let x=H();g=U(v.target),g&&t.contains(v.target)&&(b=null),H()!==x&&$()}function Se(v){if(v.relatedTarget||!g)return;let x=H();g=null,H()!==x&&$()}function Ce(){if(!f||E.hidden)return;let v=f.getBoundingClientRect();E.style.width=`${Math.round(v.width)}px`,E.style.height=`${Math.round(v.height)}px`,E.style.transform=`translate(${Math.round(v.left)}px, ${Math.round(v.top)}px)`}function No(){if(!o||typeof o.IntersectionObserver!="function"){for(let x of a)x.visible=!0;return}d||(d=new o.IntersectionObserver(x=>{let w=!1;for(let C of x)for(let S of n.get(C.target)||[])S.visible!==C.isIntersecting&&(S.visible=C.isIntersecting,w=!0);w&&$()},{threshold:0}));let v=new Set(n.keys());for(let x of m)v.has(x)||d.unobserve(x);for(let x of v)m.has(x)||d.observe(x);m=v}function Mo(){u||!o||(o.addEventListener("scroll",$,{passive:!0,capture:!0}),o.addEventListener("resize",$,{passive:!0}),e.addEventListener("focusin",ne),e.addEventListener("focusout",Se),e.addEventListener("pointerdown",Br,!0),e.addEventListener("keydown",Ir,!0),u=!0)}function zo(){!u||!o||(o.removeEventListener("scroll",$,{capture:!0}),o.removeEventListener("resize",$),e.removeEventListener("focusin",ne),e.removeEventListener("focusout",Se),e.removeEventListener("pointerdown",Br,!0),e.removeEventListener("keydown",Ir,!0),u=!1)}function Nr(v){return`${v.kind}\0${v.attr||""}`}function Mr(v,x){return v.container===x.container&&v.scalar===x.scalar}function Fo(v,x){return v.kind!==x.kind?!1:v.kind==="style"?!0:v.kind==="handle"?Nr(v.target)===Nr(x.target):v.kind==="row"?v.row===x.row&&Mr(v.list,x.list):Mr(v.list,x.list)}function zr(v,x){v.target=x;let w=x.path.join(".");v.node.setAttribute("data-hcms-target",w),x.icon?v.node.setAttribute("data-hcms-icon",x.icon):v.node.removeAttribute("data-hcms-icon"),v.node.setAttribute("aria-label",`Edit ${w}`)}function Do(v){let x=e.createElement("button");x.type="button",x.className="hcms-inline-handle mirk-button mirk-button--small",x.innerHTML=`<span class="mirk-button__label">${ut("edit")}</span>`;let w={node:x,kind:"handle",target:v};return zr(w,v),x.addEventListener("click",C=>{C.preventDefault(),C.stopPropagation(),r?.(w.target,x)}),w}function Bo(v){let x=e.createElement("button");x.type="button",x.className="hcms-inline-style-chip mirk-button mirk-button--small",x.setAttribute("aria-label","Edit style"),x.innerHTML='<span class="mirk-button__label">Style</span>';let w={node:x,kind:"style",group:v.group};return x.addEventListener("click",C=>{C.preventDefault(),C.stopPropagation(),i?.(w.group,x)}),w}function Fr(v,x){let w=e.createElement("button");return w.type="button",w.className="hcms-inline-list-button mirk-button mirk-button--small",w.setAttribute("data-hcms-list-action",v),w.setAttribute("aria-label",x),w.innerHTML=`<span class="mirk-button__label">${ut(v)}${v==="add"?"<span>Add</span>":""}</span>`,w}function Dr(v,{list:x,row:w,rowIndex:C,count:S}){let R=x.path.join(".");v.list=x,v.row=w,v.index=C,v.count=S,v.node.setAttribute("data-hcms-list",R),v.node.setAttribute("data-hcms-row",String(C));for(let O of v.node.querySelectorAll("[data-hcms-list-action]")){let I=O.getAttribute("data-hcms-list-action"),L=jl.find(([Q])=>Q===I)?.[1]||I;O.setAttribute("aria-label",`${L} ${R}.${C}`),O.disabled=I==="move-up"&&C===0||I==="move-down"&&C===S-1}}function Io(v,x,w,C){let S=e.createElement("div");S.className="hcms-inline-row-controls";let R={node:S,kind:"row",list:v,row:x,index:w,count:C};for(let[O,I]of jl){let L=Fr(O,I);L.addEventListener("click",Q=>{Q.preventDefault(),Q.stopPropagation(),!L.disabled&&l?.({action:O,list:R.list,index:R.index,row:R.row})}),S.appendChild(L)}return Dr(R,{list:v,row:x,rowIndex:w,count:C}),R}function G(v=!1){if(!_)return;let x=_;_=null,x.menu.hidden=!0,x.button.setAttribute("aria-expanded","false"),x.node.parentElement?.classList.remove("has-open-settings"),v&&x.button.isConnected&&x.button.focus({preventScroll:!0})}function Br(v){_&&!_.node.contains(v.target)&&G()}function Ir(v){_&&(v.key==="Escape"?(v.preventDefault(),v.stopPropagation(),G(!0)):v.key==="Tab"?G(!0):["ArrowDown","ArrowUp","Home","End"].includes(v.key)&&_.menu.contains(v.target)&&(v.preventDefault(),_.menu.querySelector('[role="menuitem"]').focus({preventScroll:!0})))}function Pr(v,{list:x,row:w,rowIndex:C,style:S=null}){Object.assign(v,{list:x,row:w,index:C,style:S}),v.node.setAttribute("data-hcms-list",x.path.join(".")),v.node.setAttribute("data-hcms-row",String(C)),v.button.setAttribute("aria-label",`Settings ${x.path.join(".")}.${C}`),S&&!v.styleItem.isConnected?v.menu.insertBefore(v.styleItem,v.menu.firstChild):S||v.styleItem.remove()}function Po(v){let x=e.createElement("div");x.className="hcms-inline-settings";let w=Fr("settings","Settings");w.setAttribute("aria-haspopup","menu"),w.setAttribute("aria-expanded","false");let C=e.createElement("div");C.className="hcms-inline-settings-menu",C.setAttribute("role","menu"),C.setAttribute("aria-label","Item settings"),C.hidden=!0;let S=e.createElement("button");S.type="button",S.setAttribute("role","menuitem"),S.setAttribute("data-hcms-style-action",""),S.textContent="Style";let R=e.createElement("button");R.type="button",R.setAttribute("role","menuitem"),R.setAttribute("data-hcms-list-action","remove"),R.textContent="Delete",C.appendChild(R),x.append(w,C);let O={node:x,button:w,menu:C,styleItem:S,kind:"settings"};Pr(O,v);let I=()=>{G(),_=O,C.hidden=!1,w.setAttribute("aria-expanded","true"),x.parentElement.classList.add("has-open-settings"),C.querySelector('[role="menuitem"]').focus({preventScroll:!0}),$()};return w.addEventListener("click",L=>{L.preventDefault(),L.stopPropagation(),_===O?G(!0):I()}),w.addEventListener("keydown",L=>{(L.key==="ArrowDown"||L.key==="ArrowUp")&&(L.preventDefault(),I())}),R.addEventListener("click",L=>{L.preventDefault(),L.stopPropagation(),G(!0),l?.({action:"remove",list:O.list,index:O.index,row:O.row})}),S.addEventListener("click",L=>{L.preventDefault(),L.stopPropagation(),G(),i?.(O.style,O.button)}),O}function Ho(v,x){v.kind==="handle"?zr(v,x.target):v.kind==="row"?Dr(v,x):v.kind==="settings"?Pr(v,x):v.kind==="style"&&(v.group=x.group)}function He(v,x,w,C,S){let R=x.get(w)?.find(O=>O.category===S);if(!R){R={el:w,category:S,members:[]},v.push(R);let O=x.get(w);O?O.push(R):x.set(w,[R])}R.members.push(C)}function Uo(v,x,w,C){let S=w.items||[];S.forEach((R,O)=>{Qe(R)&&(He(v,x,R,{kind:"row",list:w,row:R,rowIndex:O,count:S.length},"item"),He(v,x,R,{kind:"settings",list:w,row:R,rowIndex:O,style:C.get(R)||null},"item"))})}function Vo(v,x){let w=new Set(v.members),C=[];for(let S of x){let R=v.members.find(O=>w.has(O)&&Fo(O,S))||(S.kind==="handle"?Do(S.target):S.kind==="row"?Io(S.list,S.row,S.rowIndex,S.count):S.kind==="style"?Bo(S):Po(S));w.delete(R),Ho(R,S),y&&R.kind!=="handle"&&(R.node.hidden=!0),C.push(R)}for(let S of w)S===_&&G(),S.node.remove();C.sort((S,R)=>["row","handle","settings"].indexOf(S.kind)-["row","handle","settings"].indexOf(R.kind)),C.forEach((S,R)=>{v.node.children[R]!==S.node&&v.node.insertBefore(S.node,v.node.children[R]||null)}),v.members=C}function Wo(v,x,w){let C=[],S=new Map,R=new Map,O=0;for(let T of v||[])T.style||(R.has(T.el)||R.set(T.el,T),!(T.kind!=="handle"||!Qe(T.el))&&(He(C,S,T.el,{kind:"handle",target:T},"item"),O++));let I=new Map;for(let T of w||[])T.scope==="row"?I.set(T.el,T):T.scope==="section"&&Qe(T.el)&&He(C,S,T.el,{kind:"style",group:T},"style");for(let T of x||[])Uo(C,S,T,I);let L=new Set(a),Q=new Map;for(let T of a)Q.has(T.el)||Q.set(T.el,T.visible);let ue=[];for(let T of C){let N=a.find(j=>L.has(j)&&j.el===T.el&&j.category===T.category);if(!N){let j=e.createElement("div");j.className="hcms-inline-item-controls",j.setAttribute("role","group"),N={el:T.el,node:j,category:T.category,kind:T.category==="add"?"add":"handle",members:[],visible:Q.get(T.el)??!1},t.appendChild(j)}L.delete(N),N.el=T.el,N.category=T.category,Vo(N,T.members),N.kind=N.members.some(j=>j.kind==="row")?"row":N.members.some(j=>j.kind==="handle")?"handle":N.members.some(j=>j.kind==="style")?"style":"add",N.node.setAttribute("aria-label",N.category==="add"?"List controls":N.category==="style"?"Style controls":"Item controls"),ue.push(N)}for(let T of L)T.node.remove();a=ue,n=new Map,k=new Map;for(let T of a){let N=n.get(T.el);N?N.push(T):n.set(T.el,[T]);for(let j of T.members)j.kind!=="row"&&j.kind!=="settings"||(k.set(j.row,j.row),k.set(j.node,j.row),k.set(T.node,j.row))}b&&!k.has(b)&&(b=null),g&&!k.has(g)&&(g=null),h=R,s=O}function Go(){G(),d?.disconnect(),d=null,m=new Set;for(let v of a)v.node.remove();a=[],n=new Map,h=new Map,k=new Map,s=0}return{setTargets(v,x,w=[]){Wo(v,x,w),A.setLists(x),No(),Mo(),$()},refresh:$,get count(){return s},get controlsHidden(){return y},setControlsHidden(v){if(y=!!v,A.setHidden(y),y){G();for(let x of a){for(let w of x.members)w.kind!=="handle"&&(w.node.hidden=!0);x.members.every(w=>w.node.hidden)&&(x.node.hidden=!0)}}$()},elementToTarget(v){if(v?.closest?.("[data-hcms-ghost]"))return null;for(let x=v;x&&x.nodeType===1;x=x.parentElement){let w=h.get(x);if(w)return w}return null},setHoveredRow(v){let x=H();b=v?U(v):null,H()!==x&&$()},showHighlight(v){v&&(f=v,E.hidden=!1,Ce())},hideHighlight(){f=null,E.hidden=!0},setFollower(v){c=typeof v=="function"?v:null},destroy(){A.destroy(),p&&o&&o.cancelAnimationFrame(p),p=0,c=null,f=null,b=null,g=null,E.remove(),zo(),Go()}}}var Rc="hypercms-inline",ke="is-hcms-inline-active",Yt="is-hcms-inline-onpath",Nl='input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])',qc=["bold","italic","link","undo","redo"],$c=/^H[1-6]$/,Oc=0;function Lc({doc:e,pageRoot:t,opts:r={}}){let l=r.richText!==!1,i=null,o=null,a=null,n=new Map,s=null,h=null,d=[],m=null;function p(u,c,f,b,g){let k=At(e.defaultView);if(typeof k!="function")return null;let y=g||{},_=y.originalHTML??Eo(c,{capability:"history"}).html(),A=y.richClayIsOurs??!c.hasAttribute("data-richclay"),E=y.adopted??c.getAttribute("data-richclay-active")==="true",$=Me(c,b,"history"),H=jc(u,k,c,b,A);if(!H)return null;rs(c,b==="innerHTML",A);let de=String(++Oc);c.setAttribute(ye,de),qr();let U={el:c,editor:H,path:f,prop:b,boundId:de,originalHTML:_,oldValue:$,richClayIsOurs:A,adopted:E,dirty:!1,written:!1,restorable(){return!this.adopted&&!this.dirty&&!this.written},lastEdited:void 0};n.set(c,U),Yn(de,U);let ne=H.squire;if(ne&&typeof ne.addEventListener=="function"){let Ce=()=>{U.dirty=!0,U.lastEdited=Me(c,U.prop,"history"),Nc(u,U)};ne.addEventListener("input",Ce),U.detachInput=()=>ne.removeEventListener?.("input",Ce)}let Se=()=>Ro(U);return c.addEventListener("blur",Se),U.detachBlur=()=>c.removeEventListener("blur",Se),U}return{name:"inline",richText:l,ctx:null,root:null,formRoot:null,errorEl:null,noticeEl:null,handoffEl:null,handoffCountEl:null,popEl:null,enhanceFormRichText:!1,prepareRules(u){return l?as(u,t):u},bindText(u,c,f,b){return p(this.ctx,u,c,f,b)},mount(u){let c=this.ctx;i=Dc(e,r.theme),this.root=i.root,this.formRoot=i.formRoot,this.errorEl=i.errorEl,this.noticeEl=i.noticeEl,this.handoffEl=i.handoffEl,this.handoffCountEl=i.handoffCountEl,this.popEl=i.popEl,_e(()=>st(e));let f=vr({pageRules:c.pageRules,formRules:c.formRules,data:u,doc:e});i.formRoot.appendChild(f),c.seeder.seed(i.formRoot),_t(i.formRoot,e,this.enhanceFormRichText),Tr(c),ao(c),o=Tc({doc:e,layerEl:i.layerEl,onActivate:(b,g)=>this.activate(b,g),onListAction:b=>this.listAction(b),onStyle:(b,g)=>this.openStyle(b,g)}),o.setFollower(()=>this.placePopover()),i.closeEl.addEventListener("click",()=>this.deactivate()),i.toggleEl.addEventListener("click",b=>{b.preventDefault(),b.stopPropagation(),this.toggleControls()}),i.pageStyleEl.addEventListener("click",b=>{b.preventDefault(),b.stopPropagation();let g=d.find(k=>k.scope==="page");g&&this.openStyle(g,i.pageStyleEl)}),i.handoffEl.querySelector("[data-hcms-open-view]").addEventListener("click",b=>{b.preventDefault(),b.stopPropagation(),c.onViewRequested?.("sidebar")}),this.bindPage(),this.syncTargets()},listAction({action:u,list:c,index:f,row:b}){let g=this.ctx,k=c.path.join("."),y=g.formRoot.querySelector(`[data-hcms-path="${Ee(k)}"]`);if(!y)return;if(u==="add"){_r(k,g);return}let _=b?Ic(g,k,b):f;if(_===-1)return;let A=Bc(y,_);if(A){if(u==="remove"){ho(A,g),this.syncTargets();return}co(A,u==="move-up"?-1:1,g),this.syncTargets()}},toggleControls(){if(!o||!i)return;let u=!o.controlsHidden;o.setControlsHidden(u),i.toggleEl.setAttribute("aria-pressed",String(u));let c=i.toggleEl.querySelector(".mirk-button__label");c&&(c.textContent=u?"Show controls":"Hide controls")},bindPage(){let u=se(this.ctx.pageRoot),c=i.root,f=A=>{let E=o&&o.elementToTarget(A.target);E?o.showHighlight(E.el):o?.hideHighlight(),o?.setHoveredRow(A.target)},b=()=>{o?.hideHighlight(),o?.setHoveredRow(null)},g=A=>{if(c.contains(A.target))return;let E=o&&o.elementToTarget(A.target);!E||E.kind!=="text"||n.has(E.el)||p(this.ctx,E.el,E.path.join("."),mt(E))},k=A=>{if(c.contains(A.target))return;let E=o&&o.elementToTarget(A.target);if(!E){this.deactivate();return}(typeof A.target.closest=="function"&&A.target.closest("a[href]")||E.kind!=="text")&&A.preventDefault(),this.activate(E)},y=A=>{A.key==="Escape"&&this.deactivate()},_=A=>{let E=A.detail;if(!(!E||E.pageRoot!==se(this.ctx.pageRoot)||!E.path))for(let $ of n.values())$.path===E.path&&($.written=!0)};u.addEventListener("pointerover",f),u.addEventListener("pointerleave",b),u.addEventListener("pointerdown",g),u.addEventListener("click",k),c.addEventListener("keydown",y),e.addEventListener("hcms:change",_),a=()=>{u.removeEventListener("pointerover",f),u.removeEventListener("pointerleave",b),u.removeEventListener("pointerdown",g),u.removeEventListener("click",k),c.removeEventListener("keydown",y),e.removeEventListener("hcms:change",_)}},activate(u,c){if(!u||!i||u.kind==="text"&&this.activateText(u))return;let f=Ml(this,i,u.path.join("."));if(!f){this.deactivate();return}s=u,h=c||null,m=null,i.popTitleEl.textContent="Edit content",i.popEl.hidden=!1,i.formRoot.querySelectorAll(`.${ke}`).forEach(Mt),this.placePopover(),Fl(f)},openStyle(u,c){if(!u||!i)return;let f=zl(this,i,u.paths);if(!f){this.deactivate();return}s={kind:"style",scope:u.scope,el:u.scope==="page"?i.pageStyleEl:u.el,path:u.paths[0].split("."),paths:u.paths},h=c||null,m=null,i.popTitleEl.textContent=u.scope==="page"?"Page style":"Style",i.popEl.hidden=!1,i.formRoot.querySelectorAll(`.${ke}`).forEach(Mt),this.placePopover(),Fl(f)},activateText(u){let c=u.el,f=n.get(c);if(f)return et(f),!0;let b=p(this.ctx,c,u.path.join("."),mt(u));return b?(et(b),!0):!1},placePopover(){if(!i||!s||i.popEl.hidden)return;let u=e.defaultView;if(!u)return;let c={width:u.innerWidth,height:u.innerHeight},f=s.el.getBoundingClientRect(),b=i.popEl.getBoundingClientRect(),{mode:g,x:k,y}=vc({anchor:f,bar:b,viewport:c,current:m});m=g,i.popEl.style.transform=`translate(${Math.round(k)}px, ${Math.round(y)}px)`},deactivate(){if(!i||!s&&i.popEl.hidden)return;i.popEl.hidden=!0,$r(i.root);let u=h;if(s=null,h=null,m=null,u&&e.contains(u)&&typeof u.focus=="function")try{u.focus({preventScroll:!0})}catch{u.focus()}},syncTargets(){if(!o)return;let u=this.ctx,c=wo(u.pageRoot,u.pageRules,e),f=c.lists,b=c.targets.filter(y=>!y.style);d=sc(c.targets,f),i.pageStyleEl.hidden=!d.some(y=>y.scope==="page"),o.setTargets(c.targets,f,d);let g=Mc(this,n,b,e);if(s?.kind==="style"){let y=s.scope==="page"?d.find(_=>_.scope==="page"):d.find(_=>_.el===s.el);y?s={...s,paths:y.paths,path:y.paths[0].split(".")}:this.deactivate()}else if(s){let y=g.get(s.el)||[],_=y.find(A=>zc(A,s))||y.find(A=>A.path.join(".")===s.path.join("."))||(y.length===1?y[0]:null);_?s=_:this.deactivate()}Fc(this.ctx,n,e);let k=b.reduce((y,_)=>y+(Qe(_.el)?0:1),0);this.handoffEl&&(this.handoffCountEl.textContent=k===0?"":`${k} ${k===1?"field isn't":"fields aren't"} visible right now.`,this.handoffEl.hidden=k===0)},refresh(u,c){u==="livesync"?(Pe(e),st(e),be(this.ctx,{ignoreActiveValue:!0})):u==="undo"?be(this.ctx,{ignoreActiveValue:!1}):be(this.ctx),this.syncTargets(),(u==="livesync"||u==="undo")&&this.rebindText(u),this.restoreActive()},rebindText(u){let c=u!=="undo";for(let[f,b]of[...n]){if(!e.contains(f)){ze(this.ctx,b,{restore:!1,record:c}),n.delete(f);continue}if(f.hasAttribute(ie)){let y=Me(f,b.prop);y!==b.lastEdited&&(b.oldValue=y,b.lastEdited=void 0);continue}let g=e.activeElement===f;ze(this.ctx,b,{restore:!1,record:c}),n.delete(f);let k=p(this.ctx,f,b.path,b.prop,{richClayIsOurs:b.richClayIsOurs,adopted:b.adopted});k&&g&&et(k)}},restoreActive(){if(!(!i||!s||i.popEl.hidden)){if(!e.contains(s.el)){this.deactivate();return}if(!(s.kind==="style"?zl(this,i,s.paths):Ml(this,i,s.path.join(".")))){this.deactivate();return}i.formRoot.querySelectorAll(`.${ke}`).forEach(Mt),this.placePopover()}},focusOnOpen(){if(this.root&&typeof this.root.focus=="function")try{this.root.focus({preventScroll:!0})}catch{this.root.focus()}},destroy(){h=null,this.deactivate();for(let u of n.values())ze(this.ctx,u);n.clear(),a?.(),a=null,o?.destroy(),o=null,i?.destroy(),i=null,go(e),this.popEl=null,this.handoffEl=null,this.handoffCountEl=null}}}function jc(e,t,r,l,i){return _e(()=>{let o=null;try{o=new t(r,{inline:!0,hyperclay:!1,toolbar:l==="innerHTML"?qc:!1,...$c.test(r.tagName)?{singleLine:!0}:null})}catch(a){return console.warn("[hypercms] richclay activation failed; the field falls back to the popover",a),null}if(o.unsupported||!o.active){if(i)try{o.destroy()}catch{}return null}return typeof o.reattach=="function"&&o.reattach(),o})}function Nc(e,{path:t,el:r,prop:l}){let i=uo(e.formRoot,t);i&&(mo(i,Me(r,l),e.formRoot,t),te(K(e),{path:t,structural:!1},e))}function Me(e,t,r="data"){let l=Eo(e,{capability:r});return t==="innerHTML"?l.html():l.text().trim()}function Ro(e){let{el:t,prop:r,oldValue:l,lastEdited:i}=e,o=i;if(o===void 0||o===l)return;e.oldValue=o;let a=W("undo");if(!a||typeof a.recordValue!="function")return;let n={prop:r,oldValue:l,newValue:o,read:s=>Me(s,r,"history"),write:(s,h)=>qo(s,r,h)};a.isPaused?queueMicrotask(()=>{t.isConnected&&a.recordValue(t,n)}):a.recordValue(t,n)}function qo(e,t,r){let l=e.cloneNode(!1);t==="innerHTML"?l.innerHTML=r:l.textContent=r,Te(e,Array.from(l.childNodes),{morphStyle:"innerHTML",policy:"history",restoreFocus:!1,scripts:{handle:!1,merge:!1}})}function ze(e,t,{restore:r=!0,record:l=!0}={}){l&&Ro(t),t.detachInput?.(),t.detachBlur?.(),_e(()=>{if(!t.adopted){try{t.editor.destroy()}catch(i){console.warn("[hypercms] richclay teardown failed; editor state may reach the save",i)}t.richClayIsOurs&&t.el.removeAttribute("data-richclay")}t.el.removeAttribute(ie),t.el.removeAttribute(xe),t.el.removeAttribute(ye),es(t.boundId),r&&t.restorable()&&qo(t.el,"innerHTML",t.originalHTML)})}function et(e){let{editor:t,el:r}=e;if(r.ownerDocument.activeElement!==r)try{typeof t.focus=="function"?t.focus():r.focus()}catch{}}function Mc(e,t,r,l){let i=new Map;for(let o of r){let a=i.get(o.el);a?a.push(o):i.set(o.el,[o])}for(let[o,a]of[...t]){let n=i.get(o)||[],s=n.find(p=>mt(p)===a.prop)||n[0];if(!s){ze(e.ctx,a,{restore:!0}),t.delete(o);continue}a.path=s.path.join(".");let h=mt(s);if(h===a.prop)continue;let d=l.activeElement===o;ze(e.ctx,a,{restore:!1}),t.delete(o);let m=e.bindText(o,a.path,h,{richClayIsOurs:a.richClayIsOurs,adopted:a.adopted,originalHTML:a.originalHTML});m&&d&&et(m)}return i}function zc(e,t){return e.el===t.el&&e.kind===t.kind&&e.attr===t.attr}function mt(e){return e.attr==="innerHTML"?"innerHTML":"textContent"}function Fc(e,t,r){for(let l of e.pageRoot.querySelectorAll(`[${ie}]`))t.has(l)||_e(()=>is(l,r.defaultView))}function Ml(e,t,r){let l=e.formRoot&&e.formRoot.querySelector(`[data-hcms-path="${Ee(r)}"]`);if($r(t.root),!l)return null;let i=l.closest("[data-hcms-card]"),o=i?[...i.querySelectorAll('[data-hcms-shape="scalar"][data-hcms-path]')].filter(a=>a.closest("[data-hcms-card]")===i&&a.closest('[data-hcms-shape="object-array"], [data-hcms-shape="scalar-array"]')===i.parentElement.closest('[data-hcms-shape="object-array"]')):[l];o.includes(l)||o.push(l);for(let a of o)$o(e,a);return l}function zl(e,t,r){$r(t.root);let l=null;for(let i of r){let o=e.formRoot&&e.formRoot.querySelector(`[data-hcms-path="${Ee(i)}"]`);o&&(l=l||o,$o(e,o))}return l}function $o(e,t){t.classList.add(ke),t.removeAttribute("draggable");for(let r=t.parentElement;r&&(r.classList.add(Yt),r.removeAttribute("draggable"),r!==e.formRoot);r=r.parentElement);}function $r(e){if(e)for(let t of e.querySelectorAll(`.${ke}, .${Yt}`))t.classList.remove(ke,Yt)}function Mt(e){e.tagName==="TEXTAREA"&&ot(e),e.querySelectorAll?.("textarea").forEach(ot)}function Fl(e){let t=e.matches?.(Nl)?e:e.querySelector?.(Nl);if(!(!t||typeof t.focus!="function"))try{t.focus({preventScroll:!0})}catch{t.focus()}}function Dc(e,t){Pe(e);let r=e.createElement(Rc),l=t==="dark"?" dark":t==="light"?" light":"";return r.className="hcms-shell pixel-quiet hcms-inline"+l,r.setAttribute("data-hcms-shell",""),r.setAttribute("editor-ui",""),r.setAttribute("no-save",""),r.setAttribute("save-remove",""),r.setAttribute("snapshot-remove",""),r.setAttribute("no-watch",""),r.setAttribute("tabindex","-1"),r.innerHTML=`
    <div class="hcms-inline-bar">
      <div class="hcms-inline-handoff" hidden>
        <span class="hcms-inline-handoff-count"></span>
        <button type="button" class="hcms-inline-handoff-open mirk-button mirk-button--small" data-hcms-open-view="sidebar">
          <span class="mirk-button__label">Edit in the sidebar</span>
        </button>
      </div>
      <button type="button" class="hcms-inline-page-style mirk-button mirk-button--small" data-hcms-page-style-open hidden>
        <span class="mirk-button__label">Page style</span>
      </button>
      <button type="button" class="hcms-inline-toggle mirk-button mirk-button--small" data-hcms-controls-toggle aria-pressed="false" hidden>
        <span class="mirk-button__label">Hide controls</span>
      </button>
      <div class="hcms-inline-notice" role="status" hidden></div>
      <div class="hcms-inline-error" role="alert" hidden></div>
    </div>
    <div class="hcms-inline-layer"></div>
    <div class="hcms-inline-pop" role="dialog" aria-label="Edit content" hidden>
      <div class="hcms-inline-pop-header">
        <span class="hcms-inline-pop-title">Edit content</span>
        <button type="button" class="hcms-inline-pop-close mirk-button mirk-button--small" aria-label="Close field editor">
          <span class="mirk-button__label">${ut("remove")}</span>
        </button>
      </div>
      <div data-hcms-form-root class="hcms-form"></div>
    </div>
  `,e.body.appendChild(r),{root:r,formRoot:r.querySelector("[data-hcms-form-root]"),noticeEl:r.querySelector(".hcms-inline-notice"),errorEl:r.querySelector(".hcms-inline-error"),handoffEl:r.querySelector(".hcms-inline-handoff"),handoffCountEl:r.querySelector(".hcms-inline-handoff-count"),layerEl:r.querySelector(".hcms-inline-layer"),popEl:r.querySelector(".hcms-inline-pop"),closeEl:r.querySelector(".hcms-inline-pop-close"),toggleEl:r.querySelector("[data-hcms-controls-toggle]"),pageStyleEl:r.querySelector("[data-hcms-page-style-open]"),popTitleEl:r.querySelector(".hcms-inline-pop-title"),destroy(){r.remove()}}}function Bc(e,t){let r=e.querySelector(".hcms-array-items");return r&&r.querySelectorAll(":scope > [data-hcms-card], :scope > [data-hcms-array-item]")[t]||null}function Ic(e,t,r){let{lists:l}=wo(e.pageRoot,e.pageRules),i=l.find(o=>o.path.join(".")===t);return i?i.items.indexOf(r):-1}var Pc="[hypercms]";function Hc(e,t){if(!e||!e.querySelectorAll||!t)return;let r=Uc(t);e.querySelectorAll("template[data-hcms-tpl]").forEach(l=>{let i=l.getAttribute("data-hcms-tpl");i&&(i.startsWith("@")||r.has(i)||console.warn(`${Pc} template "${i}" doesn't match any rule path; ignored`))})}function Uc(e){let t=new Set;return r([],e),t;function r(l,i){let o=l.join("."),a=l.map(s=>typeof s=="number"?"*":s).join(".");o&&t.add(o),a&&t.add(a);let n=bt(i);if(n==="object")for(let[s,h]of Object.entries(i))r([...l,s],h);else if(n==="object-array"||n==="scalar-array"){let s=[...l,"*"],h=s.map(d=>typeof d=="number"?"*":d).join(".");if(t.add(h),n==="object-array"){let d=i[1];if(d&&typeof d=="object"&&!Array.isArray(d))for(let[m,p]of Object.entries(d))r([...s,m],p)}}}}var er={skip:"[data-hcms-shell]",templateAttr:"cms-template"},q={isOpen:!1,ctx:null,opts:null};function Vc({view:e,doc:t,pageRoot:r,opts:l={},onCloseRequested:i,onViewRequested:o}){let a=l.rules!==void 0?l.rules:"cms",n=Z.findRules(t,a);if(!n){let b=typeof a=="string"?`data-rules-name~="${a}"`:"the provided rules object";throw new Error(`hypercms: no rules found for ${b}`)}let s=e.prepareRules(n.rules),h=n.tagNode;Ci(t),$i(t,s),Hc(t,s);let d=ji(s,t),m=vo(s),p=ko(r,s),u=Ai(),c=ce(Z.extract(r,s,{...er,...u.hooks}),s),f={doc:t,pageRoot:r,pageRules:s,writeRules:m,formRules:d,rulesTagNode:h,rulesSource:a,richText:e.richText,view:e,seeder:u,initialData:c,get formRoot(){return e.formRoot},get shellRoot(){return e.root},get errorEl(){return e.errorEl},get noticeEl(){return e.noticeEl},unresolved:p,lastTwinSignature:null,lastFingerprint:null,lastData:null,observerHandle:null,undoUnsub:null,livesyncUnsub:null,onChange:l.onChange,onError:l.onError,confirmRemove:l.confirmRemove,previouslyFocused:t.activeElement,dispatch(b,g){let k=t.defaultView&&t.defaultView.CustomEvent||(typeof CustomEvent<"u"?CustomEvent:null);if(!k)return;let y={...g||{},pageRoot:se(r),view:e.name},_=new k(b,{bubbles:!0,cancelable:b==="hcms:change",detail:y});(e.root&&e.root.isConnected!==!1?e.root:se(r)).dispatchEvent(_)},onCloseRequested:i,onViewRequested:o};return f.updateFingerprint=()=>{f.lastFingerprint=nt(K(f))},e.ctx=f,f}function Wc(e){e.updateFingerprint(),Ar(e,ce(Z.extract(e.pageRoot,e.pageRules,er),e.pageRules)),e.observerHandle=Ks({onRefresh:l=>e.view.refresh("observer",l)});let t=W("undo");if(t&&typeof t.on=="function"){let l=()=>{if(q.ctx!==e)return;Dl(e,"undo");let i=ce(Z.extract(e.pageRoot,e.pageRules,er),e.pageRules);nt(i)!==nt(e.lastData)&&(e.lastData=i,e.onChange?.(i,{path:"",structural:!1}))};t.on("undo",l),t.on("redo",l),e.undoUnsub=()=>{t.off("undo",l),t.off("redo",l)}}let r=()=>Dl(e,"livesync");e.livesyncUnsub=xr(e.doc,Zn,r),Or.ctx=e,Jc(e.doc)}function Dl(e,t){q.ctx===e&&e.view.refresh(t)}function tr(e,{dispatch:t=!0,restoreFocus:r=!0,updateUrl:l=!0,reason:i="close"}={}){if(!e||e.closed)return;e.closed=!0;for(let a of e.uploads||[])try{a.abort()}catch{}e.uploads?.clear();let o=e.previouslyFocused;if(t&&e.dispatch("hcms:close",{reason:i}),l&&Zc(),e.observerHandle?.unsubscribe?.(),e.undoUnsub?.(),e.livesyncUnsub?.(),e.detachEvents?.(),_e(()=>e.view.destroy()),Gc(),r&&typeof o?.focus=="function")try{o.focus()}catch{}}function Gc(){q.isOpen=!1,q.ctx=null,q.opts=null,Or.ctx=null}var Or={ctx:null};function Jc(e){let t=e.defaultView||(typeof globalThis<"u"?globalThis:null);if(!t)return;let r=function(){let l=Or.ctx;if(l)return fo(l.formRoot),Ie("Reorder",()=>te(K(l),{path:"",structural:!0},l))};typeof t.hypercmsCommit!="function"&&(t.hypercmsCommit=r),typeof globalThis<"u"&&typeof globalThis.hypercmsCommit!="function"&&(globalThis.hypercmsCommit=r)}var rr="cms";function Xc(e){let t=typeof e=="string"?e:"",r=t.indexOf("?"),l=r===-1?t:t.slice(r+1);if(!l)return t;let i=new URLSearchParams(l);return i.get(rr)!=="true"?t:(i.set(rr,"false"),"?"+i.toString())}function Kc(e){let t=typeof e=="string"?e:"",r=t.indexOf("?"),l=r===-1?t:t.slice(r+1);return l?new URLSearchParams(l).get(rr)==="true":!1}function Zc(){if(typeof window>"u"||!window.location||!window.history||typeof window.history.replaceState!="function")return;let e=window.location.search,t=Xc(e);t!==e&&window.history.replaceState(window.history.state,"",t+window.location.hash)}var Bl="hcms-toggle",X="data-hcms-toggle-host",Il="hcms-toggle-style",Pl="data-hcms-toggle-style",pt="data-hcms-session",Qc="var(--hcms-toggle-bg, var(--hcms-toggle-_surface))",Yc="#fafafa",eh="#0a0a0a",th=`
[${X}] {
  all: unset;
  box-sizing: border-box;
  display: var(--hcms-toggle-display, inline-flex);
  font-family: 'Departure Mono', ui-monospace, Menlo, monospace;
  --hcms-toggle-_surface: ${Yc};
}
[${X}][data-hcms-surface="dark"] {
  --hcms-toggle-_surface: ${eh};
}
[${X}] .hcms-toggle__main {
  all: unset;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 0 14px;
  min-height: 40px;
  font-family: inherit;
  font-weight: 400;
  line-height: 1.5;
  font-size: 14px;
  color: var(--hcms-toggle-color, currentColor);
  border: 2px solid;
  border-color: var(--mirk-bevel-tl, #F0E7D8) var(--mirk-bevel-br, #E2D4BF) var(--mirk-bevel-br, #E2D4BF) var(--mirk-bevel-tl, #F0E7D8);
  border-radius: 0;
  cursor: pointer;
  box-shadow: none;
}
[${X}] .hcms-toggle__main:hover {
  border-color: var(--mirk-focus-color, #C7AE93);
  box-shadow: none;
}
[${X}] .hcms-toggle__main:active {
  border-color: var(--mirk-bevel-br, #E2D4BF) var(--mirk-bevel-tl, #F0E7D8) var(--mirk-bevel-tl, #F0E7D8) var(--mirk-bevel-br, #E2D4BF);
}
[${X}] .hcms-toggle__main:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: -5px;
}
[${X}] .hcms-toggle__close { display: none; }
[${X}][${pt}="open"] .hcms-toggle__open { display: none; }
[${X}][${pt}="open"] .hcms-toggle__close { display: inline; }
@media (pointer: coarse) {
  [${X}] .hcms-toggle__main { min-height: 44px; }
}
`;function rh({search:e="",cookie:t="",forced:r=null}={}){let l=typeof e=="string"?e:"",i=l.indexOf("?"),o=i===-1?l:l.slice(i+1),a=new URLSearchParams(o).get("editmode");return a?a==="true":r!=null?!!r:/(?:^|;\s*)isAdminOfCurrentResource=[^;]/.test(t)}var zt=new WeakMap;function Oo(e,t){try{e.globalCompositeOperation="copy",e.fillStyle=t,e.fillRect(0,0,1,1);let r=e.getImageData(0,0,1,1).data;return{r:r[0],g:r[1],b:r[2],a:r[3]/255}}catch{return null}}function lh(e){if(zt.has(e))return zt.get(e);let t=null;try{let r=e.createElement("canvas");if(r.width=r.height=1,t=r.getContext?r.getContext("2d",{willReadFrequently:!0}):null,t){let l=Oo(t,"rgb(1, 2, 3)");(!l||l.r!==1||l.g!==2||l.b!==3||l.a!==1)&&(t=null)}}catch{t=null}return zt.set(e,t),t}function ih(e,t){let r=String(e??"").trim();if(!r)return null;let l=oh(r);if(l)return l;let i=t&&t.defaultView;if(!i||!i.CSS||typeof i.CSS.supports!="function"||!i.CSS.supports("color",r))return null;let o=lh(t);return o?Oo(o,r):null}function oh(e){let t=/rgba?\(([^)]+)\)/.exec(String(e??""));if(!t)return null;let r=t[1].split(/[\s,/]+/).filter(Boolean);if(r.length<3)return null;let l=r.slice(0,3).map(Number);if(l.some(Number.isNaN))return null;let i=r[3],o=i===void 0?1:i.endsWith("%")?Number(i.slice(0,-1))/100:Number(i);return{r:l[0],g:l[1],b:l[2],a:Number.isNaN(o)?1:o}}function Hl({r:e,g:t,b:r}){let l=i=>{let o=i/255;return o<=.03928?o/12.92:((o+.055)/1.055)**2.4};return .2126*l(e)+.7152*l(t)+.0722*l(r)}function Ul(e,t){let r=Hl(e),l=Hl(t);return(Math.max(r,l)+.05)/(Math.min(r,l)+.05)}var Vl={r:10,g:10,b:10},Wl={r:250,g:250,b:250};function Gl(e,t){let r=e.a==null?1:e.a;return{r:e.r*r+t.r*(1-r),g:e.g*r+t.g*(1-r),b:e.b*r+t.b*(1-r)}}function ah(e){if(!e)return"light";let t=Ul(Gl(e,Vl),Vl),r=Ul(Gl(e,Wl),Wl);return t>r?"dark":"light"}function Jl(e,t){for(let[r,l]of Object.entries(t))e.style.setProperty(r,l,"important")}function Ft(e){let t=e.ownerDocument&&e.ownerDocument.defaultView,r=e.querySelector(".hcms-toggle__main");if(!t||!r||typeof t.getComputedStyle!="function")return;let l=ih(t.getComputedStyle(r).color,e.ownerDocument);e.setAttribute("data-hcms-surface",ah(l))}function nh(e){Ft(e);let t=e.ownerDocument,r=t&&t.defaultView;if(!r)return;let l=0,i=()=>{if(!l){if(typeof r.requestAnimationFrame!="function")return e.isConnected?Ft(e):n();l=r.requestAnimationFrame(()=>{if(l=0,!e.isConnected)return n();Ft(e)})}};typeof r.requestAnimationFrame=="function"&&i(),t.readyState!=="complete"&&r.addEventListener("load",i,{once:!0});let o=typeof r.MutationObserver=="function"?new r.MutationObserver(i):null;o&&(o.observe(t.documentElement,{attributes:!0}),t.body&&o.observe(t.body,{attributes:!0}));let a=typeof r.matchMedia=="function"?r.matchMedia("(prefers-color-scheme: dark)"):null;a&&typeof a.addEventListener=="function"&&a.addEventListener("change",i);function n(){o&&o.disconnect(),a&&typeof a.removeEventListener=="function"&&a.removeEventListener("change",i)}}function sh({open:e,close:t,isOpen:r,getTheme:l=()=>null},i=document){let o=i.querySelector(`[${X}]`);if(o)return o;if(!i.querySelector(`[${Pl}]`)){let m=i.createElement("style");m.setAttribute(Pl,""),m.setAttribute("editor-ui",""),i.getElementById(Il)||(m.id=Il),m.setAttribute("no-save",""),m.setAttribute("snapshot-remove",""),m.setAttribute("save-ignore",""),m.textContent=th,i.head.insertBefore(m,i.head.firstChild)}let a=i.createElement("hypercms-toggle");a.className="hcms-shell pixel-quiet",i.getElementById(Bl)||(a.id=Bl),a.setAttribute(X,""),a.setAttribute("editor-ui",""),a.setAttribute("no-save",""),a.setAttribute("snapshot-remove",""),a.setAttribute("save-ignore",""),a.innerHTML='<button type="button" class="hcms-toggle__main mirk-button"><span class="hcms-toggle__open">Edit content</span><span class="hcms-toggle__close">Close editor</span></button>';let n=a.querySelector(".hcms-toggle__main");Jl(a,{position:"fixed",right:"calc(var(--hcms-toggle-offset, 16px) + var(--hcms-toggle-shift, 0px))",bottom:"calc(var(--hcms-toggle-offset, 16px) + env(safe-area-inset-bottom, 0px))","z-index":"var(--hcms-toggle-z, 2147482900)"}),Jl(n,{background:Qc});async function s(){if(r()){t();return}return e()}async function h(m){try{await m()}catch(p){console.warn("hypercms: toggle failed to open the CMS",p)}}a.addEventListener("click",async()=>{await h(s)});let d=m=>{let p=l();a.classList.toggle("light",p==="light"),a.classList.toggle("dark",p==="dark"),m?a.setAttribute(pt,"open"):a.removeAttribute(pt)};return d(r()),i.addEventListener("hcms:open",()=>d(!0)),i.addEventListener("hcms:close",()=>d(!1)),i.body.appendChild(a),Pe(i),nh(a),a}function ch(e){if(typeof window>"u"||typeof document>"u")return;let t=window.__hyperclayEditMode!=null?window.__hyperclayEditMode:null;if(!rh({search:window.location.search,cookie:document.cookie,forced:t}))return;let r=()=>{document.body&&e.hasRules(document)&&sh(e)};document.readyState==="loading"?document.addEventListener("DOMContentLoaded",r,{once:!0}):r()}function hh(e){if(Ms(e),typeof document<"u"){let t=document.getElementById("hcms-shell-styles");t?.tagName==="LINK"&&t.remove(),Pe(document)}}var lr={sidebar:Qs,inline:Lc};function dh(e,t){let r=t!==void 0?t:"cms";if(typeof r!="string")return"sidebar";let l=Z.findRules(e,r)?.tagNode?.getAttribute?.("data-cms-view");return!l||l==="sidebar"?"sidebar":lr[l]?l:(console.warn(`hypercms: unknown data-cms-view "${l}" on the rules tag, opening the sidebar`),"sidebar")}function Et(e={}){let t=q.isOpen?{...q.opts,...e}:e,r=t.pageRoot||(typeof document<"u"?document:null);if(!r)throw new Error("hypercms: no pageRoot available");let l=(r.nodeType===9?r:r.ownerDocument)||(typeof document<"u"?document:null);if(!l)throw new Error("hypercms: no document available");let i=e.view||(q.isOpen?q.ctx.view.name:dh(l,t.rules)),o=lr[i];if(!o)throw new Error(`hypercms: unknown view "${i}" (expected ${Object.keys(lr).join(" or ")})`);let a=q.isOpen?{...t,view:i}:e,n=null,s=null;if(q.isOpen){if(q.ctx.view.name===i)return;n=q.ctx.previouslyFocused,s=q.ctx.view.name,tr(q.ctx,{restoreFocus:!1,updateUrl:!1,reason:"switch"})}yc();let h=o({doc:l,pageRoot:r,opts:a}),d=Vc({view:h,doc:l,pageRoot:r,opts:a,onCloseRequested:()=>Lr(),onViewRequested:m=>Et({view:m})});n&&(d.previouslyFocused=n);try{h.mount(d.initialData),Wc(d),h.focusOnOpen(),q.isOpen=!0,q.ctx=d,q.opts=a,d.dispatch("hcms:open",{pageRoot:r,previous:s})}catch(m){throw tr(d,{dispatch:!1,restoreFocus:!!n,updateUrl:!1}),m}}function Lr(){q.isOpen&&tr(q.ctx)}function Lo(){q.isOpen&&q.ctx.view.refresh("api")}function uh(){return q.isOpen}function mh(){return q.isOpen&&q.ctx?q.ctx.view.name:null}var ph={getData(){return q.isOpen?K(q.ctx):null},setValue(e,t){if(!q.isOpen)throw new Error("hypercms: cms is not open");let r=q.ctx,l=ve(e),i=lt(r.pageRules,l);if(i===void 0)throw new Error(`hypercms: no rule at path "${e}"`);if(typeof i!="string"||i.endsWith("[]"))throw new Error(`hypercms: setValue requires a leaf scalar path; "${e}" is not a leaf`);let o=uo(r.formRoot,e);if(!o)throw new Error(`hypercms: no field element at path "${e}"`);mo(o,t,r.formRoot,e),te(K(r),{path:e,structural:!1},r)},addItem(e){if(!q.isOpen)throw new Error("hypercms: cms is not open");_r(e,q.ctx)},removeItem(e){if(!q.isOpen)throw new Error("hypercms: cms is not open");let t=q.ctx,r=ve(e);if(typeof r[r.length-1]!="number")throw new Error(`hypercms: removeItem requires an item path; "${e}" is not an array index`);let l=lt(t.pageRules,r.slice(0,-1));if(!(Array.isArray(l)||typeof l=="string"&&l.endsWith("[]")))throw new Error(`hypercms: removeItem requires an item path; parent of "${e}" is not an array`);let i=t.formRoot.querySelector(`[data-hcms-path="${vh(e)}"]`);if(!i)throw new Error(`hypercms: no element at path "${e}"`);Oe(i,t)},refresh:Lo,_commit(){if(!q.isOpen)return;let e=q.ctx;return fo(e.formRoot),Ie("Update",()=>te(K(e),{path:"",structural:!0},e))}},fh=250,gh=1e4;function bh(){typeof window>"u"||typeof document>"u"||Kc(window.location?window.location.search:"")&&(q.isOpen||kh(()=>{if(!q.isOpen)try{Et()}catch(e){console.warn("hypercms: auto-open failed",e)}}))}function Dt(){return!!document.body&&!!W("Mutation")}function kh(e){if(Dt()){queueMicrotask(e);return}let t=Date.now()+gh,r=!1,l=null,i=null,o=()=>{r||(r=!0,l!==null&&clearInterval(l),i&&i())};function a(){if(q.isOpen){o();return}Dt()&&(o(),e())}i=xr(document,Kn,a),l=setInterval(()=>{if(q.isOpen){o();return}if(Dt()){o(),e();return}Date.now()>=t&&(o(),console.warn("hypercms: ?cms=true auto-open gave up \u2014 no mutation hub appeared. Load clayjs or hyperclayjs (or just the mutation utility) so the CMS can initialize."))},fh)}bh();ch({open:Et,close:Lr,isOpen:uh,getTheme:()=>q.opts?.theme,hasRules:e=>!!Z.findRules(e,"cms")});var jo={open:Et,close:Lr,refresh:Lo,api:ph,get isOpen(){return q.isOpen},currentView:mh,path:ki,scaffold:sr,morphForm:vi};function vh(e){return typeof CSS<"u"&&CSS.escape?CSS.escape(e):String(e).replace(/[^a-zA-Z0-9_\-.*]/g,t=>"\\"+t)}var yh=`/* GENERATED by scripts/build-theme.js from mirk-interface/mirk.css \u2014 DO NOT EDIT.
   Source of truth: mirk-interface/mirk.css + src/theme/pixel-quiet.overrides.css.
   Regenerate with: npm run build:theme */

/* ===== mirk-interface@2.2.0, scoped to .hcms-shell ===== */
/*
 * mirk.css \u2014 the mirk UI kit, v2.
 * Hand-written, no build. Fourteen form components as semantic BEM classes in
 * @layer components, so utilities (Tailwind or your own) always override them
 * with zero !important. Renders fully standalone; Tailwind is optional.
 *
 * Two hinges (see mirk-ui-guide.md):
 *   1. Components live in @layer components \u2192 utilities win.
 *   2. State serializes into the DOM (native attrs, :has(), inline --mirk-value)
 *      so document.documentElement.outerHTML round-trips every visible state.
 *
 * This @layer statement makes the file self-sufficient without Tailwind, and
 * merges into Tailwind's own order (@layer theme, base, components, utilities)
 * when present.
 */
@layer base, components;

@layer base {
  /* Components are authored border-box (a 2px bevel must not grow the box). */
  .hcms-shell *, .hcms-shell *::before, .hcms-shell *::after { box-sizing: border-box; }
  .hcms-shell button, .hcms-shell input, .hcms-shell optgroup, .hcms-shell select, .hcms-shell textarea { margin: 0; }

  @font-face {
    font-family: 'Departure Mono';
    src: url('https://cdn.jsdelivr.net/npm/mirk-interface@2.2.0/fonts/DepartureMono-1.500/DepartureMono-Regular.woff2') format('woff2');
    font-weight: 400; font-style: normal; font-display: swap;
  }

  .hcms-shell { font-family: 'Departure Mono', ui-monospace, "Menlo", monospace; }
  /* Preflight sets these to ui-monospace; keep them in Departure Mono. */
  .hcms-shell pre, .hcms-shell code, .hcms-shell kbd, .hcms-shell samp { font-family: inherit; }

  /* 28 tokens, one value each. light-dark() picks the side from color-scheme.
     :root paints the DEFAULT theme \u2014 "Pixel Quiet" (see 0030): mirk's warm soul
     with the volume down. The louder original palette is the opt-in
     [data-theme="full-volume"] block below. */
  .hcms-shell {
    color-scheme: light dark;                 /* default: follow the OS */

    --mirk-canvas:        light-dark(#FDF8F0, #0B0C13);
    --mirk-bg:            light-dark(#FDF8F0, #11131E);
    --mirk-fg:            light-dark(#2B241B, #ECEAF2);
    --mirk-accent:        light-dark(#efefe5, #1D1F2F);
    --mirk-destructive:   light-dark(#C24A3A, #ff5566);
    --mirk-focus-color:   light-dark(#C7AE93, #4A506B);
    --mirk-bevel-bg:      light-dark(#FCF8F1, #1A1D2C);
    --mirk-bevel-fg:      light-dark(#2B241B, #ECEAF2);
    --mirk-bevel-tl:      light-dark(#F0E7D8, #2A2E42);
    --mirk-bevel-br:      light-dark(#E2D4BF, #14182A);
    --mirk-bevel-hover-bg: light-dark(#F4ECDF, #202436);
    --mirk-pill-inner-top: light-dark(#FBF6EE, #202436);
    --mirk-input-border:  light-dark(#D8C8AF, #353B52);
    --mirk-placeholder-color: light-dark(#A8987F, #6A7090);
    --mirk-ctrl-bg:       light-dark(#8C7660, #5F6582);
    --mirk-toggle-bg:     light-dark(#EFDBBD, #3E4660);
    --mirk-toggle-hi:     light-dark(#F4EADA, #4E567A);
    --mirk-toggle-lo:     light-dark(#C2A87E, #262B42);
    --mirk-mark-fg:       light-dark(#6B5942, #C9CDE0);
    --mirk-sortable-dot:  light-dark(#DDCBB0, #353B52);
    --mirk-sortable-shadow:    light-dark(#C9B493, #0E1120);
    --mirk-sortable-label:     light-dark(#8C7B62, #8A90AB);
    --mirk-sortable-placeholder: light-dark(#A8987F, #6A7090);
    --mirk-slider-fill:   light-dark(#F2E0BD, #2A2E42);
    --mirk-slider-nub-bg: light-dark(#EFDBBD, #3E4660);
    --mirk-slider-nub-hi: light-dark(#F4EADA, #4E567A);
    --mirk-slider-nub-lo: light-dark(#C2A87E, #262B42);

    /* Chip \u2014 the recovery/notification component reads from the kit's own tokens
       via 5 slim hooks, so it matches the kit by default and reskins by overriding
       a hook (not a rule). Each follows the theme (incl. the Full Volume variant)
       and OS light/dark with no per-theme repaint; the one exception is the primary
       fill, which the default (Pixel Quiet) leaves as the theme's fg ink while the
       Full Volume variant tints it a warm brown in light (see below). */
    --mirk-chip-surface:     var(--mirk-bg);            /* raised panel face */
    --mirk-chip-edge:        var(--mirk-input-border);  /* panel + recess outline */
    --mirk-chip-primary-bg:  var(--mirk-fg);            /* primary action fill \u2014 the theme's fg ink (Full Volume tints it warm brown in light) */
    --mirk-chip-primary-fg:  var(--mirk-bg);
    --mirk-chip-alert:       var(--mirk-destructive);   /* icon + struck "now" value */

    --mirk-radius: 5px;                        /* the "rounded" corner */
    --mirk-focus-offset: 2px;                  /* non-color \u2192 can't ride light-dark() */

    background: var(--mirk-canvas);
    color: var(--mirk-fg);
  }

  /* The one non-color token with a real light/dark split (was 2px / 3px). */
  @media (prefers-color-scheme: dark) { .hcms-shell { --mirk-focus-offset: 3px; } }

  /* Force a mode on any subtree with one attribute (class aliases for hosts that
     prefer class-based theming and Tailwind's dark-variant convention). Each also
     paints its own canvas so a wrapper visibly flips. */
  .hcms-shell[data-theme="light"], .hcms-shell.light {
    color-scheme: light; --mirk-focus-offset: 2px;
    background: var(--mirk-canvas); color: var(--mirk-fg);
  }
  .hcms-shell[data-theme="dark"], .hcms-shell.dark {
    color-scheme: dark; --mirk-focus-offset: 3px;
    background: var(--mirk-canvas); color: var(--mirk-fg);
  }

  /* Built-in brand variant \u2014 "Full Volume": mirk's original full-strength palette,
     the loud pole of the volume axis (Pixel Quiet, now the default, is the quiet
     end). Full-contrast bevel, warm cream / deep navy, crimson destructive.
     Authored with light-dark() like :root, so it follows the OS and still flips
     with .dark / .light. Opt in: data-theme="full-volume". Sits after :root
     (equal specificity, source order wins). --mirk-radius / --mirk-focus-offset /
     --mirk-ctrl-bg and the four shared --mirk-chip-* hooks inherit from :root
     unchanged; only the tokens that differ from the default are re-declared here. */
  .hcms-shell[data-theme="full-volume"] {
    --mirk-canvas:        light-dark(#F7F2EA, #0B0C13);
    --mirk-bg:            light-dark(#F7F2EA, #1D1F2F);
    --mirk-fg:            light-dark(#15120e, #F6F7F9);
    --mirk-accent:        light-dark(#efefe5, #232639);
    --mirk-destructive:   light-dark(#d4183d, #ff5566);
    --mirk-focus-color:   light-dark(#BBA288, #5A607F);
    --mirk-bevel-bg:      light-dark(#e9d3bd, #1D1F2F);
    --mirk-bevel-fg:      light-dark(#15120e, #F6F7F9);
    --mirk-bevel-tl:      light-dark(#f3ddc7, #474C65);
    --mirk-bevel-br:      light-dark(#c2ad95, #131725);
    --mirk-bevel-hover-bg: light-dark(#dfc9b3, #232639);
    --mirk-pill-inner-top: light-dark(#efdac7, #232639);
    --mirk-input-border:  light-dark(#957E65, #6E738E);
    --mirk-placeholder-color: light-dark(#7F7366, #545973);
    --mirk-toggle-bg:     light-dark(#DFC9AF, #656D95);
    --mirk-toggle-hi:     light-dark(#E9D6C3, #7F87AD);
    --mirk-toggle-lo:     light-dark(#C7A88A, #505677);
    --mirk-mark-fg:       light-dark(#3F3225, #E1E3EA);
    --mirk-sortable-dot:  light-dark(#e2c5a6, #393f5b);
    --mirk-sortable-shadow:    light-dark(#c7a47f, #111527);
    --mirk-sortable-label:     light-dark(#231e18, #edeef2);
    --mirk-sortable-placeholder: light-dark(#99826c, #6f7695);
    --mirk-slider-fill:   light-dark(#e9d3bd, #232639);
    --mirk-slider-nub-bg: light-dark(#DFC9AF, #656D95);
    --mirk-slider-nub-hi: light-dark(#E9D6C3, #7F87AD);
    --mirk-slider-nub-lo: light-dark(#C7A88A, #505677);
    /* :root (Pixel Quiet) leaves the chip primary as its own fg ink; the original
       default tinted it a warm brown in light \u2014 restore that here. */
    --mirk-chip-primary-bg: light-dark(#1C170E, var(--mirk-fg));
  }

  /* Roll your own the same way \u2014 an explicit [data-theme] block is the escape hatch:
     [data-theme="sunset"] { color-scheme: light; --mirk-accent: #f0a868; \u2026 } */
}

@layer components {
  /* Visually hidden, still focusable/announced. The hidden native input behind
     every custom control relies on it; Tailwind is optional now. */
  .hcms-shell .mirk-sr-only {
    position: absolute; width: 1px; height: 1px;
    padding: 0; margin: -1px; overflow: hidden;
    clip: rect(0, 0, 0, 0); white-space: nowrap; border-width: 0;
  }

  /* ============================ BUTTON ============================ */
  .hcms-shell .mirk-button {
    display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem;
    font: inherit; line-height: 1.5; cursor: pointer; user-select: none;
    text-align: center;
    color: var(--mirk-bevel-fg);
    background: var(--mirk-bevel-bg);
    border: 2px solid;
    /* Raised bevel: light top+left, dark right+bottom. Shorthand is T R B L. */
    border-color: var(--mirk-bevel-tl) var(--mirk-bevel-br) var(--mirk-bevel-br) var(--mirk-bevel-tl);
    padding: 4px 14px 5px;                     /* medium */
    outline: none;
  }
  .hcms-shell .mirk-button__label { white-space: nowrap; user-select: none; display: inline-block; }

  /* States, written once, shared by every size and shape. */
  .hcms-shell .mirk-button:hover { background-color: var(--mirk-bevel-hover-bg); }
  .hcms-shell .mirk-button:active {
    border-color: var(--mirk-bevel-br) var(--mirk-bevel-tl) var(--mirk-bevel-tl) var(--mirk-bevel-br);
  }
  .hcms-shell .mirk-button:not(.mirk-button--round):active .mirk-button__label { translate: 1.5px 1.5px; }
  /* Direct focus (a real <button>) or a focus-visible descendant (a <label>
     wrapping a hidden input, as the file/image upload triggers do). */
  .hcms-shell .mirk-button:focus-visible, .hcms-shell .mirk-button:has(:focus-visible) {
    outline: 1px solid var(--mirk-focus-color); outline-offset: var(--mirk-focus-offset);
  }
  .hcms-shell .mirk-button:disabled { opacity: 0.5; cursor: not-allowed; }

  /* Sizes set padding + font (rect); round re-homes padding to the label below. */
  .hcms-shell .mirk-button--small { padding: 3px 12px; font-size: 14px; }
  .hcms-shell .mirk-button--large { padding: 4px 17px 7px; font-size: 18px; border-width: 3px; }

  /* Round register: a gradient pill frame with the label as the inner fill. */
  .hcms-shell .mirk-button--round {
    border: none; padding: 2px; border-radius: 14px;
    background-color: var(--mirk-canvas);
    background-image: linear-gradient(to top in oklab, var(--mirk-bevel-br), var(--mirk-bevel-tl));
    opacity: 0.9; transition: opacity 0.15s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .hcms-shell .mirk-button--round:hover { opacity: 1; }
  .hcms-shell .mirk-button--round:active {
    background-image: linear-gradient(to bottom in oklab, var(--mirk-bevel-br), var(--mirk-bevel-tl));
  }
  .hcms-shell .mirk-button--round .mirk-button__label {
    display: flex; align-items: center; gap: 0.5rem;
    padding: 4px 17px 6px; border-radius: 12px;
    color: var(--mirk-bevel-fg);
    background-color: var(--mirk-bevel-bg);
    background-image: linear-gradient(to top in oklab, var(--mirk-bevel-bg), var(--mirk-pill-inner-top));
  }
  .hcms-shell .mirk-button--round.mirk-button--small { border-radius: 12px; }
  .hcms-shell .mirk-button--round.mirk-button--small .mirk-button__label { padding: 2px 14px; border-radius: 10px; }
  .hcms-shell .mirk-button--round.mirk-button--large { border-radius: 16px; }
  .hcms-shell .mirk-button--round.mirk-button--large .mirk-button__label { padding: 7px 24px 9px; border-radius: 14px; }

  /* Quiet: a borderless text button (transparent border keeps the hit area + the
     baseline aligned with neighbouring bevel buttons). For tertiary actions. */
  .hcms-shell .mirk-button--quiet {
    background: none; background-image: none;
    border-color: transparent; color: var(--mirk-placeholder-color);
  }
  .hcms-shell .mirk-button--quiet:hover { background: none; color: var(--mirk-fg); }
  .hcms-shell .mirk-button--quiet:active { border-color: transparent; }

  /* ============================ TEXT INPUT ============================ */
  .hcms-shell .mirk-input {
    width: 100%;
    background: var(--mirk-bevel-bg); color: var(--mirk-bevel-fg);
    border: 1px solid var(--mirk-input-border);
    padding: 5px 14px 6px;                     /* medium */
    font: inherit; line-height: 1.5; border-radius: 0; outline: none;
  }
  .hcms-shell .mirk-input::placeholder { color: var(--mirk-placeholder-color); }
  .hcms-shell .mirk-input:focus-visible {
    outline: 1px solid var(--mirk-focus-color); outline-offset: var(--mirk-focus-offset);
  }
  .hcms-shell .mirk-input--small { padding: 4px 12px; font-size: 14px; }
  .hcms-shell .mirk-input--large { padding: 6px 17px 9px; font-size: 18px; }
  .hcms-shell .mirk-input--rounded { border-radius: var(--mirk-radius); }

  /* ============================ TEXTAREA ============================ */
  .hcms-shell .mirk-textarea {
    width: 100%;
    background: var(--mirk-bevel-bg); color: var(--mirk-bevel-fg);
    border: 1px solid var(--mirk-input-border);
    padding: 6px 17px 9px; font: inherit; font-size: 18px; line-height: 1.5;
    border-radius: 0; outline: none; resize: vertical;
  }
  .hcms-shell .mirk-textarea::placeholder { color: var(--mirk-placeholder-color); }
  .hcms-shell .mirk-textarea:focus-visible {
    outline: 1px solid var(--mirk-focus-color); outline-offset: var(--mirk-focus-offset);
  }
  .hcms-shell .mirk-textarea--rounded { border-radius: var(--mirk-radius); }

  /* ============================ NUMBER ============================ */
  .hcms-shell .mirk-number {
    display: flex; align-items: stretch; width: 100%;
    background: var(--mirk-bevel-bg);
    border: 1px solid var(--mirk-input-border); border-radius: 0;
  }
  .hcms-shell .mirk-number:has(:focus-visible) {
    outline: 1px solid var(--mirk-focus-color); outline-offset: var(--mirk-focus-offset);
  }
  .hcms-shell .mirk-number__input {
    flex: 1; min-width: 0; background: transparent; color: var(--mirk-bevel-fg);
    padding: 5px 10px 6px 14px;                /* medium */
    font: inherit; line-height: 1.5; outline: none;
    appearance: textfield; -webkit-appearance: textfield;
  }
  .hcms-shell .mirk-number__input::-webkit-outer-spin-button, .hcms-shell .mirk-number__input::-webkit-inner-spin-button { -webkit-appearance: none; appearance: none; }
  .hcms-shell .mirk-number__steps { display: flex; flex-direction: column; padding: 2px; gap: 2px; }
  .hcms-shell .mirk-number__step {
    flex: 1; cursor: pointer; line-height: 1; padding: 0 10px; font-size: 9px;  /* medium */
    display: flex; align-items: center; justify-content: center;
    background: var(--mirk-bevel-bg); outline: none;
    border: 2px solid;
    border-color: var(--mirk-bevel-tl) var(--mirk-bevel-br) var(--mirk-bevel-br) var(--mirk-bevel-tl);
  }
  .hcms-shell .mirk-number__step:hover { background: var(--mirk-bevel-hover-bg); }
  .hcms-shell .mirk-number__step:active {
    border-color: var(--mirk-bevel-br) var(--mirk-bevel-tl) var(--mirk-bevel-tl) var(--mirk-bevel-br);
  }
  .hcms-shell .mirk-number__step:focus-visible { outline: 1px solid var(--mirk-focus-color); outline-offset: 1px; }

  .hcms-shell .mirk-number--small .mirk-number__input { padding: 4px 8px 4px 12px; font-size: 14px; }
  .hcms-shell .mirk-number--small .mirk-number__step { padding: 0 8px; font-size: 8px; }
  .hcms-shell .mirk-number--large .mirk-number__input { padding: 6px 12px 9px 17px; font-size: 18px; }
  .hcms-shell .mirk-number--large .mirk-number__step { padding: 0 12px; font-size: 10px; }

  .hcms-shell .mirk-number--rounded { border-radius: var(--mirk-radius); }
  .hcms-shell .mirk-number--rounded .mirk-number__step { border-radius: 3px; }

  /* ============================ SELECT / DROPDOWN ============================ */
  /* Keeps appearance:none + a real chevron (renders identically everywhere today);
     base-select/::picker is a future enhancement. */
  .hcms-shell .mirk-select { position: relative; }
  .hcms-shell .mirk-select__field {
    width: 100%; appearance: none; -webkit-appearance: none;
    background: var(--mirk-bevel-bg); color: var(--mirk-bevel-fg);
    border: 2px solid;
    border-color: var(--mirk-bevel-tl) var(--mirk-bevel-br) var(--mirk-bevel-br) var(--mirk-bevel-tl);
    padding: 4px 40px 5px 14px;                /* medium */
    font: inherit; line-height: 1.5; border-radius: 0; outline: none;
  }
  .hcms-shell .mirk-select__field:focus-visible {
    outline: 1px solid var(--mirk-focus-color); outline-offset: var(--mirk-focus-offset);
  }
  .hcms-shell .mirk-select__chevron {
    pointer-events: none; position: absolute; top: 50%; right: 14px;  /* medium */
    translate: 0 -50%; rotate: 90deg; display: inline-block; line-height: 1; font-size: 20px;
  }
  .hcms-shell .mirk-select--small .mirk-select__field { padding: 3px 36px 3px 12px; font-size: 14px; }
  .hcms-shell .mirk-select--small .mirk-select__chevron { right: 12px; font-size: 18px; }
  .hcms-shell .mirk-select--large .mirk-select__field { padding: 4px 48px 7px 17px; font-size: 18px; border-width: 3px; }
  .hcms-shell .mirk-select--large .mirk-select__chevron { right: 16px; font-size: 24px; }

  /* Round: gradient pill frame around a borderless, pill-filled select. */
  .hcms-shell .mirk-select--round .mirk-select__frame {
    padding: 2px; border-radius: 14px;         /* medium */
    background-color: var(--mirk-canvas);
    background-image: linear-gradient(to top in oklab, var(--mirk-bevel-br), var(--mirk-bevel-tl));
  }
  .hcms-shell .mirk-select--round .mirk-select__frame:has(:focus-visible) {
    outline: 1px solid var(--mirk-focus-color); outline-offset: var(--mirk-focus-offset);
  }
  .hcms-shell .mirk-select--round .mirk-select__field {
    border: none; background-color: transparent;
    background-image: linear-gradient(to top in oklab, var(--mirk-bevel-bg), var(--mirk-pill-inner-top));
    border-radius: 12px; padding: 4px 40px 6px 17px;   /* medium */
  }
  .hcms-shell .mirk-select--round.mirk-select--small .mirk-select__frame { border-radius: 12px; }
  .hcms-shell .mirk-select--round.mirk-select--small .mirk-select__field { border-radius: 10px; padding: 2px 36px 2px 14px; }
  .hcms-shell .mirk-select--round.mirk-select--large .mirk-select__frame { border-radius: 16px; }
  .hcms-shell .mirk-select--round.mirk-select--large .mirk-select__field { border-radius: 14px; padding: 7px 48px 9px 24px; }
  .hcms-shell .mirk-select--round.mirk-select--large .mirk-select__chevron { right: 16px; font-size: 24px; }

  /* ============================ CHECKBOX ============================ */
  .hcms-shell .mirk-checkbox { display: inline-flex; align-items: center; gap: 0.75rem; cursor: pointer; width: fit-content; }
  .hcms-shell .mirk-checkbox__box {
    position: relative; flex-shrink: 0; width: 22px; height: 22px;
    display: flex; align-items: center; justify-content: center; border-radius: 0;
    background: var(--mirk-bevel-bg);
    border: 2px solid;
    border-color: var(--mirk-bevel-tl) var(--mirk-bevel-br) var(--mirk-bevel-br) var(--mirk-bevel-tl);
  }
  .hcms-shell .mirk-checkbox__mark {
    opacity: 0; display: block; width: 6px; height: 12px;
    border-right: 2.5px solid var(--mirk-mark-fg); border-bottom: 2.5px solid var(--mirk-mark-fg);
    rotate: 45deg; translate: 0.5px -1.5px;
  }
  .hcms-shell .mirk-checkbox__label { font-size: 18px; line-height: 1.5; }

  .hcms-shell .mirk-checkbox:has(:checked) .mirk-checkbox__box { border-color: var(--mirk-input-border); }
  .hcms-shell .mirk-checkbox:has(:checked) .mirk-checkbox__mark { opacity: 1; }
  .hcms-shell .mirk-checkbox:has(:focus-visible) .mirk-checkbox__box {
    outline: 1px solid var(--mirk-focus-color); outline-offset: var(--mirk-focus-offset);
  }

  .hcms-shell .mirk-checkbox--small { gap: 0.5rem; }
  .hcms-shell .mirk-checkbox--small .mirk-checkbox__box { width: 18px; height: 18px; }
  .hcms-shell .mirk-checkbox--small .mirk-checkbox__mark {
    width: 5px; height: 10px;
    border-right-width: 2px; border-bottom-width: 2px; translate: 0.5px -1px;
  }
  .hcms-shell .mirk-checkbox--small .mirk-checkbox__label { font-size: 14px; }

  /* ============================ RADIO ============================ */
  .hcms-shell .mirk-radio { display: inline-flex; align-items: center; gap: 0.75rem; cursor: pointer; width: fit-content; }
  .hcms-shell .mirk-radio__ring {
    position: relative; flex-shrink: 0; width: 25px; height: 25px; border-radius: 9999px;
    background-image: linear-gradient(to top in oklab, var(--mirk-bevel-br), var(--mirk-bevel-tl));
  }
  .hcms-shell .mirk-radio__fill {
    display: block; position: absolute; inset: 2px; border-radius: 9999px;
    background-image: linear-gradient(to top in oklab, var(--mirk-bevel-bg), var(--mirk-pill-inner-top));
  }
  .hcms-shell .mirk-radio__dot {
    display: none; position: absolute; top: 50%; left: 50%; translate: -50% -50%;
    width: 9px; height: 9px; border-radius: 9999px; background: var(--mirk-mark-fg);
  }
  .hcms-shell .mirk-radio__label { font-size: 18px; line-height: 1.5; }

  .hcms-shell .mirk-radio:has(:checked) .mirk-radio__ring {
    background-image: none; background-color: var(--mirk-bevel-bg);
    border: 2px solid var(--mirk-input-border);
  }
  .hcms-shell .mirk-radio:has(:checked) .mirk-radio__fill { display: none; }
  .hcms-shell .mirk-radio:has(:checked) .mirk-radio__dot { display: block; }
  .hcms-shell .mirk-radio:has(:focus-visible) .mirk-radio__ring {
    outline: 1px solid var(--mirk-focus-color); outline-offset: var(--mirk-focus-offset);
  }

  .hcms-shell .mirk-radio--small { gap: 0.5rem; }
  .hcms-shell .mirk-radio--small .mirk-radio__ring { width: 20px; height: 20px; }
  .hcms-shell .mirk-radio--small .mirk-radio__dot { width: 7px; height: 7px; }
  .hcms-shell .mirk-radio--small .mirk-radio__label { font-size: 14px; }

  /* ============================ TOGGLE ============================ */
  .hcms-shell .mirk-toggle { display: inline-flex; align-items: center; gap: 0.75rem; cursor: pointer; width: fit-content; }
  .hcms-shell .mirk-toggle__track {
    position: relative; flex-shrink: 0; width: 49px; height: 27px; border-radius: 0;
    background: var(--mirk-canvas);            /* own recessed channel, like the slider track \u2014 never the host page (0033) */
    border: 1px solid var(--mirk-input-border);
  }
  .hcms-shell .mirk-toggle__thumb {
    position: absolute; top: 3px; left: 3px; width: 19px; height: 19px;
    background-color: var(--mirk-toggle-bg);
    border: 2px solid;
    border-color: var(--mirk-toggle-hi) var(--mirk-toggle-lo) var(--mirk-toggle-lo) var(--mirk-toggle-hi);
    transition-property: transform, translate, scale, rotate;
    transition-duration: 0.15s; transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
  }
  .hcms-shell .mirk-toggle__label { font-size: 18px; line-height: 1.5; }

  .hcms-shell .mirk-toggle:has(:checked) .mirk-toggle__thumb { translate: 22px; }
  .hcms-shell .mirk-toggle:has(:focus-visible) .mirk-toggle__track {
    outline: 1px solid var(--mirk-focus-color); outline-offset: var(--mirk-focus-offset);
  }

  .hcms-shell .mirk-toggle--round .mirk-toggle__track { width: 50px; height: 29px; border-radius: 9999px; }
  .hcms-shell .mirk-toggle--round .mirk-toggle__thumb {
    width: 21px; height: 21px; border: none; border-radius: 9999px;
    background-color: transparent;
    background-image: linear-gradient(to top in oklab, var(--mirk-toggle-lo), var(--mirk-toggle-hi));
  }
  .hcms-shell .mirk-toggle--round .mirk-toggle__thumb::after {
    content: ""; position: absolute; inset: 2px; border-radius: 9999px; background: var(--mirk-toggle-bg);
  }
  .hcms-shell .mirk-toggle--round:has(:checked) .mirk-toggle__thumb { translate: 21px; }

  .hcms-shell .mirk-toggle--small { gap: 0.5rem; }
  .hcms-shell .mirk-toggle--small .mirk-toggle__track { width: 42px; height: 23px; }
  .hcms-shell .mirk-toggle--small .mirk-toggle__thumb { top: 2px; left: 2px; width: 17px; height: 17px; }
  .hcms-shell .mirk-toggle--small:has(:checked) .mirk-toggle__thumb { translate: 19px; }
  .hcms-shell .mirk-toggle--small .mirk-toggle__label { font-size: 14px; }
  .hcms-shell .mirk-toggle--round.mirk-toggle--small .mirk-toggle__track { width: 43px; height: 25px; }
  .hcms-shell .mirk-toggle--round.mirk-toggle--small .mirk-toggle__thumb { width: 19px; height: 19px; }
  .hcms-shell .mirk-toggle--round.mirk-toggle--small:has(:checked) .mirk-toggle__thumb { translate: 18px; }

  /* ============================ SLIDER ============================ */
  .hcms-shell .mirk-slider { position: relative; height: 32px; width: 100%; --mirk-value: 0%; }
  .hcms-shell .mirk-slider__input {
    position: absolute; inset: 0; width: 100%; height: 100%;
    opacity: 0; cursor: pointer; z-index: 10;
  }
  .hcms-shell .mirk-slider__track {
    position: absolute; left: 0; right: 0; top: 50%; translate: 0 -50%; height: 12px;
    background: var(--mirk-canvas); border: 1px solid var(--mirk-input-border); overflow: hidden;
  }
  .hcms-shell .mirk-slider__fill { height: 100%; width: var(--mirk-value); background: var(--mirk-slider-fill); }
  .hcms-shell .mirk-slider__nub {
    position: absolute; top: 50%; left: var(--mirk-value); translate: -50% -50%;
    width: 21px; height: 21px; pointer-events: none;
    background-color: var(--mirk-slider-nub-bg);
    border: 2px solid;
    border-color: var(--mirk-slider-nub-hi) var(--mirk-slider-nub-lo) var(--mirk-slider-nub-lo) var(--mirk-slider-nub-hi);
  }
  .hcms-shell .mirk-slider__input:focus-visible ~ .mirk-slider__nub {
    outline: 1px solid var(--mirk-focus-color); outline-offset: var(--mirk-focus-offset);
  }

  .hcms-shell .mirk-slider--round .mirk-slider__track { height: 10px; border-radius: 9999px; }
  .hcms-shell .mirk-slider--round .mirk-slider__nub {
    width: 24px; height: 24px; border: none; border-radius: 9999px;
    background-color: transparent;
    background-image: linear-gradient(to top in oklab, var(--mirk-slider-nub-lo), var(--mirk-slider-nub-hi));
  }
  .hcms-shell .mirk-slider--round .mirk-slider__nub::after {
    content: ""; position: absolute; inset: 2px; border-radius: 9999px; background: var(--mirk-slider-nub-bg);
  }

  .hcms-shell .mirk-slider--small { height: 24px; }
  .hcms-shell .mirk-slider--small .mirk-slider__track { height: 8px; }
  .hcms-shell .mirk-slider--small .mirk-slider__nub { width: 16px; height: 16px; }
  .hcms-shell .mirk-slider--round.mirk-slider--small .mirk-slider__track { height: 7px; }
  .hcms-shell .mirk-slider--round.mirk-slider--small .mirk-slider__nub { width: 18px; height: 18px; }

  /* ============================ DATE ============================ */
  .hcms-shell .mirk-date { position: relative; }
  .hcms-shell .mirk-date__field {
    width: 100%; background: var(--mirk-bevel-bg); color: var(--mirk-bevel-fg);
    border: 1px solid var(--mirk-input-border);
    padding: 6px 44px 9px 17px; font: inherit; font-size: 18px; line-height: 1.5;
    border-radius: 0; outline: none;
  }
  .hcms-shell .mirk-date__field:focus-visible {
    outline: 1px solid var(--mirk-focus-color); outline-offset: var(--mirk-focus-offset);
  }
  .hcms-shell .mirk-date__field::-webkit-calendar-picker-indicator {
    opacity: 0; position: absolute; right: 0; top: 0; bottom: 0; width: 44px; margin: 0; cursor: pointer;
  }
  .hcms-shell .mirk-date__field::-webkit-inner-spin-button { -webkit-appearance: none; appearance: none; }
  .hcms-shell .mirk-date__field::-webkit-clear-button { -webkit-appearance: none; appearance: none; }
  .hcms-shell .mirk-date__icon {
    pointer-events: none; position: absolute; right: 16px; top: 50%; translate: 0 -50%;
  }
  .hcms-shell .mirk-date--rounded .mirk-date__field { border-radius: var(--mirk-radius); }

  .hcms-shell .mirk-date--small .mirk-date__field { padding: 4px 36px 4px 12px; font-size: 14px; }
  .hcms-shell .mirk-date--small .mirk-date__field::-webkit-calendar-picker-indicator { width: 36px; }
  .hcms-shell .mirk-date--small .mirk-date__icon { right: 12px; }

  /* The native file/image inputs are visually hidden; their styled label drives
     them, and the focus ring rides :has(:focus-visible) on button or container. */
  .hcms-shell .mirk-file__input, .hcms-shell .mirk-image__input {
    position: absolute; width: 1px; height: 1px;
    padding: 0; margin: -1px; overflow: hidden;
    clip: rect(0, 0, 0, 0); white-space: nowrap; border-width: 0;
  }

  /* ============================ FILE ============================ */
  .hcms-shell .mirk-file { display: flex; align-items: center; gap: 0.75rem; width: 100%; }
  .hcms-shell .mirk-file__name {
    color: var(--mirk-placeholder-color); font-size: 18px; line-height: 1.5;
    min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .hcms-shell .mirk-file__name[data-filled] { color: var(--mirk-bevel-fg); }

  /* Compact: a shared bordered container holds a smaller button + the name. */
  .hcms-shell .mirk-file--compact {
    padding: 4px 8px; background: var(--mirk-bevel-bg);
    border: 1px solid var(--mirk-input-border); border-radius: 0;
  }
  .hcms-shell .mirk-file--compact:has(:focus-visible) {
    outline: 1px solid var(--mirk-focus-color); outline-offset: var(--mirk-focus-offset);
  }
  /* The upload trigger is a .mirk-button; nudge it onto the container's left
     border so the bevel sits flush (covers compact and round-compact). */
  .hcms-shell .mirk-file--compact .mirk-button { margin-left: -1px; }
  .hcms-shell .mirk-file--compact .mirk-file__name { font-size: 16px; }
  .hcms-shell .mirk-file--compact.mirk-file--round { border-radius: 15px; }

  /* Filled: the name slot becomes a link to the chosen file, beside a circular \xD7
     to clear it: a 1px ring over a bevel fill that turns destructive on hover.
     Empty keeps the placeholder span. */
  .hcms-shell a.mirk-file__name { text-decoration: underline; text-underline-offset: 2px; }
  .hcms-shell .mirk-file__remove {
    appearance: none; -webkit-appearance: none; flex-shrink: 0;
    width: 18px; height: 18px; border-radius: 50%;
    display: inline-flex; align-items: center; justify-content: center;
    margin: 0; padding: 0; cursor: pointer; line-height: 0;
    color: var(--mirk-bevel-fg); background: var(--mirk-bevel-bg);
    border: 1px solid var(--mirk-input-border);
  }
  .hcms-shell .mirk-file__remove svg { display: block; width: 66%; height: 66%; }
  .hcms-shell .mirk-file__remove:hover { border-color: var(--mirk-destructive); color: var(--mirk-destructive); }

  /* Small: tighter name + gap + remove \xD7; pair the trigger with mirk-button--small.
     Composes with --compact (densest) and --round. */
  .hcms-shell .mirk-file--small { gap: 0.5rem; }
  .hcms-shell .mirk-file--small .mirk-file__name { font-size: 14px; }
  .hcms-shell .mirk-file--small .mirk-file__remove { width: 16px; height: 16px; }
  .hcms-shell .mirk-file--small.mirk-file--compact { padding: 3px 8px; }
  .hcms-shell .mirk-file--small.mirk-file--compact .mirk-file__name { font-size: 13px; }

  /* ============================ IMAGE ============================ */
  .hcms-shell .mirk-image { display: flex; flex-direction: column; gap: 0.5rem; }
  .hcms-shell .mirk-image__frame {
    position: relative; width: 120px; height: 120px; overflow: hidden; border-radius: 0;
    display: flex; align-items: center; justify-content: center;
    background: var(--mirk-bevel-bg); border: 1px solid var(--mirk-input-border);
    color: var(--mirk-placeholder-color); font-size: 14px; line-height: 1.5;
  }
  .hcms-shell .mirk-image__preview { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .hcms-shell .mirk-image--rounded .mirk-image__frame { border-radius: var(--mirk-radius); }
  /* The upload trigger is a .mirk-button; keep it hugging its label instead of
     stretching to fill this column-flex container. */
  .hcms-shell .mirk-image .mirk-button { width: fit-content; }

  /* Compact: a focused 56px thumbnail upload. Empty shows a small upload button;
     once an image is chosen the button hides and a thumbnail + corner \xD7 takes its
     place. The frame clips the image (overflow hidden) while the thumb wrapper
     stays visible, so the \xD7 can sit just outside the corner without being cut. */
  .hcms-shell .mirk-image--compact { flex-direction: row; align-items: center; gap: 0; }
  .hcms-shell .mirk-image__thumb { position: relative; display: inline-block; width: fit-content; margin: 0; line-height: 0; }
  .hcms-shell .mirk-image--compact .mirk-image__frame {
    width: 56px; height: 56px; overflow: hidden; border-radius: 0;
    border: 1px solid var(--mirk-input-border);
  }
  .hcms-shell .mirk-image--compact.mirk-image--rounded .mirk-image__frame { border-radius: var(--mirk-radius); }
  .hcms-shell .mirk-image--compact .mirk-image__preview {
    position: static; inset: auto; width: 100%; height: 100%; display: block; object-fit: cover;
  }
  .hcms-shell .mirk-image__remove {
    position: absolute; top: -7px; right: -7px;
    width: 18px; height: 18px; border-radius: 50%; padding: 0;
    display: inline-flex; align-items: center; justify-content: center;
    appearance: none; -webkit-appearance: none; cursor: pointer; line-height: 0;
    color: var(--mirk-bevel-fg); background: var(--mirk-bevel-bg);
    border: 1px solid var(--mirk-input-border);
  }
  .hcms-shell .mirk-image__remove svg { display: block; width: 10px; height: 10px; }
  .hcms-shell .mirk-image__remove:hover { color: var(--mirk-destructive); border-color: var(--mirk-destructive); }

  /* ============================ TAGS ============================ */
  .hcms-shell .mirk-tags {
    display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; padding: 0.5rem;
    background: var(--mirk-bevel-bg); border: 1px solid var(--mirk-input-border);
    border-radius: 0; cursor: text;
  }
  .hcms-shell .mirk-tags:has(:focus-visible) {
    outline: 1px solid var(--mirk-focus-color); outline-offset: var(--mirk-focus-offset);
  }
  .hcms-shell .mirk-tags__chip {
    display: inline-flex; align-items: center; gap: 0.5rem;
    padding: 2px 8px 2px 12px; font-size: 14px; line-height: 1.5;
    color: var(--mirk-bevel-fg); background: var(--mirk-bevel-bg);
    border: 2px solid;
    border-color: var(--mirk-bevel-tl) var(--mirk-bevel-br) var(--mirk-bevel-br) var(--mirk-bevel-tl);
  }
  .hcms-shell .mirk-tags__remove {
    appearance: none; -webkit-appearance: none;
    margin: 0; padding: 0; border: 0; background: none; color: inherit;
    cursor: pointer; font-size: 14px; line-height: 1;
  }
  .hcms-shell .mirk-tags__remove:hover { color: var(--mirk-destructive); }
  .hcms-shell .mirk-tags__input {
    appearance: none; -webkit-appearance: none;
    border: 0; padding: 0;
    flex: 1; min-width: 120px; background: transparent; color: var(--mirk-bevel-fg);
    outline: none; font-size: 18px; line-height: 1.5;
  }
  .hcms-shell .mirk-tags__input::placeholder { color: var(--mirk-placeholder-color); }

  .hcms-shell .mirk-tags--round { border-radius: 15px; }
  .hcms-shell .mirk-tags--round .mirk-tags__chip {
    padding: 2px; border: none; border-radius: 12px;
    background-color: transparent;
    background-image: linear-gradient(to top in oklab, var(--mirk-bevel-br), var(--mirk-bevel-tl));
  }
  .hcms-shell .mirk-tags__chip-inner {
    display: inline-flex; align-items: center; gap: 0.5rem;
    padding: 1px 8px 1px 12px; border-radius: 10px;
    color: var(--mirk-bevel-fg); background-color: var(--mirk-bevel-bg);
    background-image: linear-gradient(to top in oklab, var(--mirk-bevel-bg), var(--mirk-pill-inner-top));
  }

  .hcms-shell .mirk-tags--small { gap: 0.375rem; padding: 0.375rem; }
  .hcms-shell .mirk-tags--small .mirk-tags__chip { padding: 1px 6px 1px 10px; font-size: 12px; }
  .hcms-shell .mirk-tags--small .mirk-tags__remove { font-size: 12px; }
  .hcms-shell .mirk-tags--small .mirk-tags__input { font-size: 14px; min-width: 90px; }
  .hcms-shell .mirk-tags--small.mirk-tags--round { border-radius: 12px; }
  .hcms-shell .mirk-tags--small.mirk-tags--round .mirk-tags__chip-inner { padding: 1px 6px 1px 10px; }

  /* ============================ SORTABLE ============================ */
  .hcms-shell .mirk-sortable { display: flex; flex-direction: column; gap: 0.5rem; }
  .hcms-shell .mirk-sortable__item {
    display: flex; flex-direction: row; width: 100%;
    background: var(--mirk-bevel-bg); border: 1px solid var(--mirk-input-border);
  }
  .hcms-shell .mirk-sortable__grip {
    width: 28px; flex-shrink: 0; display: flex; align-items: center; justify-content: center;
    cursor: grab; border-right: 1px solid var(--mirk-input-border);
  }
  .hcms-shell .mirk-sortable__grip:active { cursor: grabbing; }
  .hcms-shell .mirk-sortable__dots { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 3px; }
  .hcms-shell .mirk-sortable__dot {
    display: block; width: 4px; height: 4px; background: var(--mirk-sortable-dot);
    box-shadow: 1px 0 0 0 var(--mirk-sortable-shadow), 0 1px 0 0 var(--mirk-sortable-shadow), 1px 1px 0 0 var(--mirk-sortable-shadow);
  }
  .hcms-shell .mirk-sortable__body { display: flex; flex-direction: column; flex: 1; min-width: 0; }
  .hcms-shell .mirk-sortable__row { padding: 8px 17px 9px; }
  .hcms-shell .mirk-sortable__row:not(:last-child) { border-bottom: 1px solid var(--mirk-input-border); }
  .hcms-shell .mirk-sortable__label {
    display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 0.2em;
    margin-bottom: 2px; color: var(--mirk-sortable-label);
  }
  .hcms-shell .mirk-sortable__field {
    width: 100%; background: transparent; color: var(--mirk-bevel-fg);
    font-size: 18px; line-height: 1.5; outline: none;
  }
  .hcms-shell .mirk-sortable__field::placeholder { color: var(--mirk-sortable-placeholder); }
  .hcms-shell .mirk-sortable__field:focus-visible {
    outline: 1px solid var(--mirk-focus-color); outline-offset: var(--mirk-focus-offset);
  }
  .hcms-shell .mirk-sortable--small { gap: 0.375rem; }
  .hcms-shell .mirk-sortable--small .mirk-sortable__grip { width: 24px; }
  .hcms-shell .mirk-sortable--small .mirk-sortable__row { padding: 5px 13px 6px; }
  .hcms-shell .mirk-sortable--small .mirk-sortable__label { font-size: 10px; margin-bottom: 1px; }
  .hcms-shell .mirk-sortable--small .mirk-sortable__field { font-size: 14px; }

  /* ============================ CHIP ============================ */
  /* A collapsible recovery/notification: a round pill that expands into a RAISED
     panel \u2014 the kit's one elevated surface (a distinct --mirk-bg face, a hairline
     outline, and a soft drop shadow, the only shadow in the kit, reserved for this
     raised tier). State lives in classes (--open, is-changes) so it round-trips via
     outerHTML; mirk.js only flips them on click. Color reads from generic kit
     tokens through 5 slim --mirk-chip-* hooks, so it matches the kit and reskins by
     overriding a hook, not a rule. In a Hyperclay app, add \`save-remove\` to the
     block so a transient prompt never persists into the saved file. */
  .hcms-shell .mirk-chip { display: inline-flex; flex-direction: column; align-items: flex-start; }
  .hcms-shell .mirk-chip__panel { display: none; }
  .hcms-shell .mirk-chip--open .mirk-chip__trigger { display: none; }
  .hcms-shell .mirk-chip--open .mirk-chip__panel { display: flex; }

  /* Collapsed chip \u2014 a round mirk-button pill (mirk-button--round in the markup),
     the alert glyph seated in the label, so it reads as a distinct affordance, not
     a flat button. A soft, tight lift sets it above the page; deeper on a dark
     canvas (same media + forced-mode pattern as the panel shadow below). */
  .hcms-shell .mirk-chip__trigger .mirk-button__label { display: inline-flex; align-items: center; gap: 6px; font-size: 14px; }
  .hcms-shell .mirk-chip__trigger { box-shadow: 0 6px 14px -8px rgba(43, 36, 27, 0.5), 0 2px 5px -3px rgba(43, 36, 27, 0.32); }
  @media (prefers-color-scheme: dark) { .hcms-shell .mirk-chip__trigger { box-shadow: 0 6px 14px -8px rgba(0, 0, 0, 0.6), 0 2px 6px -3px rgba(0, 0, 0, 0.5); } }
  .hcms-shell.light .mirk-chip__trigger, .hcms-shell[data-theme="light"] .mirk-chip__trigger { box-shadow: 0 6px 14px -8px rgba(43, 36, 27, 0.5), 0 2px 5px -3px rgba(43, 36, 27, 0.32); }
  .hcms-shell.dark .mirk-chip__trigger, .hcms-shell[data-theme="dark"] .mirk-chip__trigger { box-shadow: 0 6px 14px -8px rgba(0, 0, 0, 0.6), 0 2px 6px -3px rgba(0, 0, 0, 0.5); }
  /* Drive the warning fill from CSS, not an SVG fill="var(...)" presentation
     attribute (var() is not reliably honored there). */
  .hcms-shell .mirk-chip__warn { fill: var(--mirk-chip-alert); }
  .hcms-shell .mirk-chip__trigger .mirk-chip__warn { vertical-align: -2px; }

  /* The panel \u2014 the raised surface: a --mirk-bg face over the page, a hairline
     outline, a soft drop shadow. */
  .hcms-shell .mirk-chip__panel {
    width: 300px; max-width: calc(100vw - 44px);
    background: var(--mirk-chip-surface); color: var(--mirk-fg);
    border: 1px solid var(--mirk-chip-edge); border-radius: var(--mirk-radius);
    box-shadow: 0 20px 50px -30px rgba(43, 36, 27, 0.6);
    padding: 14px 15px 13px; flex-direction: column; gap: 12px;
  }
  /* The panel's larger drop (the collapsed pill above carries a tighter one); deepen
     both on a dark canvas. Mirrors the --focus-offset pattern: a media default for
     the OS, plus explicit forced-mode overrides. */
  @media (prefers-color-scheme: dark) { .hcms-shell .mirk-chip__panel { box-shadow: 0 20px 52px -26px rgba(0, 0, 0, 0.78); } }
  .hcms-shell.light .mirk-chip__panel, .hcms-shell[data-theme="light"] .mirk-chip__panel { box-shadow: 0 20px 50px -30px rgba(43, 36, 27, 0.6); }
  .hcms-shell.dark .mirk-chip__panel, .hcms-shell[data-theme="dark"] .mirk-chip__panel { box-shadow: 0 20px 52px -26px rgba(0, 0, 0, 0.78); }

  /* Head \u2014 icon, text, collapse glyph. */
  .hcms-shell .mirk-chip__head { display: flex; gap: 10px; align-items: flex-start; }
  .hcms-shell .mirk-chip__icon { flex-shrink: 0; line-height: 0; margin-top: 1px; }
  .hcms-shell .mirk-chip__headtext { min-width: 0; }
  .hcms-shell .mirk-chip__eyebrow {
    font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.2em;
    color: var(--mirk-placeholder-color); margin-bottom: 3px;
  }
  .hcms-shell .mirk-chip__title { margin: 0; font-size: 13px; font-weight: 400; line-height: 1.3; color: var(--mirk-fg); }
  .hcms-shell .mirk-chip__collapse {
    margin-left: auto; flex-shrink: 0; width: 24px; height: 24px;
    display: inline-flex; align-items: center; justify-content: center;
    background: none; border: 0; cursor: pointer; padding: 0;
    color: var(--mirk-placeholder-color);
  }
  .hcms-shell .mirk-chip__collapse:hover { color: var(--mirk-fg); }
  .hcms-shell .mirk-chip__collapse svg { display: block; }

  /* Meta line. */
  .hcms-shell .mirk-chip__meta { font-size: 11px; letter-spacing: 0.04em; color: var(--mirk-placeholder-color); }
  .hcms-shell .mirk-chip__changes-toggle {
    background: none; border: 0; cursor: pointer; font: inherit; font-size: 11px; padding: 0 0 0 4px;
    color: var(--mirk-placeholder-color); text-decoration: underline; text-underline-offset: 2px;
  }
  .hcms-shell .mirk-chip__changes-toggle:hover { color: var(--mirk-fg); }

  /* Before/after field table \u2014 a recessed stack, revealed by the changes toggle. */
  .hcms-shell .mirk-chip__preview {
    display: none; flex-direction: column; gap: 11px;
    background: var(--mirk-bevel-bg); border: 1px solid var(--mirk-chip-edge);
    padding: 10px 11px;
  }
  .hcms-shell .mirk-chip__panel.is-changes .mirk-chip__preview { display: flex; }
  .hcms-shell .mirk-chip__row { display: flex; flex-direction: column; gap: 2px; }
  .hcms-shell .mirk-chip__key {
    font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.1em;
    color: var(--mirk-placeholder-color);
  }
  .hcms-shell .mirk-chip__old, .hcms-shell .mirk-chip__new { max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .hcms-shell .mirk-chip__old { font-size: 11px; color: var(--mirk-chip-alert); text-decoration: line-through; opacity: 0.85; }
  .hcms-shell .mirk-chip__new { font-size: 12px; color: var(--mirk-fg); }

  /* Action stack \u2014 full-width buttons by weight: an embossed primary, a plain bevel
     revert, a quiet (--quiet) dismiss. */
  .hcms-shell .mirk-chip__actions { display: flex; flex-direction: column; gap: 8px; margin-top: 1px; }
  .hcms-shell .mirk-chip__actions .mirk-button { width: 100%; }
  /* Primary action \u2014 a genuine kit bevel button whose bevel palette is derived from
     the chip's primary fill (lighter top-left, darker bottom-right), so it embosses
     on any color. The base .mirk-button rules then drive its border, hover, and the
     :active flip, identical to the kit's other buttons. */
  .hcms-shell .mirk-chip__actions .mirk-chip__action--primary {
    --mirk-bevel-bg:       var(--mirk-chip-primary-bg);
    --mirk-bevel-fg:       var(--mirk-chip-primary-fg);
    --mirk-bevel-tl:       color-mix(in srgb, var(--mirk-chip-primary-bg), white 24%);
    --mirk-bevel-br:       color-mix(in srgb, var(--mirk-chip-primary-bg), black 32%);
    --mirk-bevel-hover-bg: color-mix(in srgb, var(--mirk-chip-primary-bg), white 10%);
  }

  /* ============================ FIELD ============================ */
  /* Label + control + hint as one unit, so a form composes without utilities
     (and without needing the mirk-page rhythm). Any control drops in; the gap
     matches the page scaffold's label/hint hug. Consecutive fields space
     themselves. */
  .hcms-shell .mirk-field { display: flex; flex-direction: column; gap: 6px; }
  .hcms-shell .mirk-field__label { font-size: 16px; line-height: 1.5; }
  .hcms-shell .mirk-field + .mirk-field { margin-block-start: 18px; }
  .hcms-shell .mirk-field--small .mirk-field__label { font-size: 14px; }

  /* An alert hint inside a field stays hidden until a control in the field
     goes :user-invalid \u2014 a zero-JS native-validation message. Show one
     unconditionally (a server-side error) by placing it outside the field or
     overriding display. */
  .hcms-shell .mirk-field .mirk-hint--alert { display: none; }
  .hcms-shell .mirk-field:has(:user-invalid) .mirk-hint--alert { display: block; }

  /* ============================ INVALID ============================ */
  /* Native constraint validation, styled. :user-invalid fires only after the
     user interacts (unlike :invalid, which would paint required fields red on
     load). A flat destructive border is the 0012 stateful read; the focus ring
     stays the focus signal. Pair the message with mirk-hint--alert. */
  .hcms-shell .mirk-input:user-invalid, .hcms-shell .mirk-textarea:user-invalid, .hcms-shell .mirk-date__field:user-invalid, .hcms-shell .mirk-select__field:user-invalid, .hcms-shell .mirk-number:has(.mirk-number__input:user-invalid) {
    border-color: var(--mirk-destructive);
  }
  .hcms-shell .mirk-checkbox:has(:user-invalid) .mirk-checkbox__box, .hcms-shell .mirk-toggle:has(:user-invalid) .mirk-toggle__track {
    border-color: var(--mirk-destructive);
  }
  /* The unchecked ring is a borderless gradient pill; invalid swaps it for a
     flat destructive ring (the fill pill still seats inside). */
  .hcms-shell .mirk-radio:has(:user-invalid) .mirk-radio__ring {
    background-image: none;
    border: 2px solid var(--mirk-destructive);
  }

  /* ============================ PROGRESS ============================ */
  /* A native <progress> in the slider's clothes: the canvas channel, the
     slider-fill value bar. --blocks segments the fill into pixel blocks.
     Keep the -webkit and -moz rules separate \u2014 an unrecognized pseudo-element
     invalidates the whole selector list. */
  .hcms-shell .mirk-progress {
    appearance: none; -webkit-appearance: none;
    display: block; width: 100%; height: 12px;
    border: 1px solid var(--mirk-input-border);
    background: var(--mirk-canvas);
  }
  .hcms-shell .mirk-progress::-webkit-progress-bar { background: transparent; }
  .hcms-shell .mirk-progress::-webkit-progress-value { background: var(--mirk-slider-fill); }
  .hcms-shell .mirk-progress::-moz-progress-bar { background: var(--mirk-slider-fill); }
  .hcms-shell .mirk-progress--small { height: 8px; }
  .hcms-shell .mirk-progress--round { border-radius: 9999px; overflow: hidden; }
  .hcms-shell .mirk-progress--blocks::-webkit-progress-value {
    background: repeating-linear-gradient(to right,
      var(--mirk-slider-fill) 0 8px, transparent 8px 11px);
  }
  .hcms-shell .mirk-progress--blocks::-moz-progress-bar {
    background: repeating-linear-gradient(to right,
      var(--mirk-slider-fill) 0 8px, transparent 8px 11px);
  }

  /* ============================ NOTE ============================ */
  /* An informational callout. Flat on purpose: bevel means pressable in this
     kit (0012) and a note is content, so it gets the 1px content border over
     the recessed face, never the raised edge. The 4px left edge carries the
     status: neutral ink by default, destructive on --alert. */
  .hcms-shell .mirk-note {
    display: flex; flex-direction: column; gap: 4px;
    background: var(--mirk-bevel-bg);
    border: 1px solid var(--mirk-input-border);
    border-left: 4px solid var(--mirk-mark-fg);
    padding: 10px 14px 11px;
    font-size: 14px; line-height: 1.5;
  }
  .hcms-shell .mirk-note__title {
    font-size: 11px; text-transform: uppercase; letter-spacing: 0.2em;
    color: var(--mirk-mark-fg);
  }
  .hcms-shell .mirk-note__body { color: var(--mirk-fg); }
  .hcms-shell .mirk-note--alert { border-left-color: var(--mirk-destructive); }
  .hcms-shell .mirk-note--alert .mirk-note__title { color: var(--mirk-destructive); }
  .hcms-shell .mirk-note--rounded { border-radius: var(--mirk-radius); }

  /* ============================ HINT ============================ */
  /* Small print under a field: neutral help text, or --alert validation text. */
  .hcms-shell .mirk-hint { margin: 0; font-size: 13px; line-height: 1.5; color: var(--mirk-placeholder-color); }
  .hcms-shell .mirk-hint--alert { color: var(--mirk-destructive); }

  /* ============================ LIST ============================ */
  /* Content bullets. <ul> gets a square pixel dot (the sortable dot's idiom,
     one step larger); a nested <ul> hollows it. <ol> gets zero-padded counters
     in the muted label ink. Styles the bare <li> by descent, like the platform. */
  .hcms-shell .mirk-list {
    list-style: none; margin: 0; padding: 0;
    display: flex; flex-direction: column; gap: 6px;
    font-size: 16px; line-height: 1.5;
  }
  .hcms-shell .mirk-list li { position: relative; padding-left: 22px; }
  .hcms-shell ul.mirk-list > li::before {
    content: ""; position: absolute; left: 2px; top: 0.55em;
    width: 6px; height: 6px; background: var(--mirk-mark-fg);
    box-shadow: 1px 1px 0 0 var(--mirk-sortable-shadow);
  }
  .hcms-shell ol.mirk-list { counter-reset: mirk-li; }
  .hcms-shell ol.mirk-list > li { counter-increment: mirk-li; padding-left: 38px; }
  .hcms-shell ol.mirk-list > li::before {
    content: counter(mirk-li, decimal-leading-zero) ".";
    position: absolute; left: 0; top: 0;
    color: var(--mirk-sortable-label);
  }

  /* One nested level: hollow square, same stack. */
  .hcms-shell .mirk-list ul {
    list-style: none; margin: 6px 0 0; padding: 0;
    display: flex; flex-direction: column; gap: 6px;
  }
  .hcms-shell .mirk-list ul > li::before {
    content: ""; position: absolute; left: 2px; top: 0.55em;
    width: 6px; height: 6px; background: transparent;
    border: 1.5px solid var(--mirk-mark-fg); box-shadow: none;
  }

  .hcms-shell .mirk-list--small { font-size: 14px; gap: 4px; }
  .hcms-shell .mirk-list--small li { padding-left: 18px; }
  .hcms-shell ul.mirk-list--small > li::before, .hcms-shell .mirk-list--small ul > li::before { width: 5px; height: 5px; }
  .hcms-shell ol.mirk-list--small > li { padding-left: 32px; }

  /* ============================ BADGE ============================ */
  /* A static tag label \u2014 the display counterpart to the mirk-tags input. Flat
     on purpose: bevel means pressable (0012), a badge is content. */
  .hcms-shell .mirk-badge {
    display: inline-flex; align-items: center; gap: 0.375rem;
    padding: 1px 8px 2px; font-size: 12px; line-height: 1.5;
    color: var(--mirk-fg); background: var(--mirk-bevel-bg);
    border: 1px solid var(--mirk-input-border);
    white-space: nowrap; vertical-align: middle;
  }
  .hcms-shell .mirk-badge--accent { background: var(--mirk-accent); }
  .hcms-shell .mirk-badge--round { border-radius: 9999px; padding: 1px 10px 2px; }
  .hcms-shell .mirk-badge--alert { color: var(--mirk-destructive); border-color: var(--mirk-destructive); }

  /* ============================ TABLE ============================ */
  /* A flat data surface: the content face in a 1px frame, header cells in the
     eyebrow register, hairline row dividers. Semantic <table> styled by
     descent \u2014 no per-cell classes. The header/stripe tints ride color-mix
     toward the ink so they stay visible in every palette (Pixel Quiet's
     canvas and face are nearly the same value). Wrap in an overflow-x:auto
     div when the table can outgrow its column. */
  .hcms-shell .mirk-table {
    width: 100%; border-collapse: collapse;
    background: var(--mirk-bevel-bg);
    border: 1px solid var(--mirk-input-border);
    font-size: 14px; line-height: 1.5;
  }
  .hcms-shell .mirk-table th {
    text-align: left; font-weight: 400;
    font-size: 11px; text-transform: uppercase; letter-spacing: 0.15em;
    color: var(--mirk-placeholder-color);
    background: color-mix(in srgb, var(--mirk-bevel-bg), var(--mirk-fg) 4%);
    padding: 7px 14px;
    border-bottom: 1px solid var(--mirk-input-border);
  }
  .hcms-shell .mirk-table td {
    padding: 8px 14px;
    border-bottom: 1px solid var(--mirk-input-border);
    vertical-align: top;
  }
  .hcms-shell .mirk-table tbody tr:last-child td { border-bottom: 0; }
  .hcms-shell .mirk-table--striped tbody tr:nth-child(even) td {
    background: color-mix(in srgb, var(--mirk-bevel-bg), var(--mirk-fg) 3%);
  }
  .hcms-shell .mirk-table--small { font-size: 13px; }
  .hcms-shell .mirk-table--small th { padding: 5px 12px; font-size: 10px; }
  .hcms-shell .mirk-table--small td { padding: 5px 12px; }

  /* ============================ PAGE ============================ */
  /* The quickstart shell: mirk-page on <body> (or any wrapper) gives a centered
     column + typographic defaults, so two CDN tags and one class boot a full
     page. Every rule rides :where() (zero specificity): any utility, component
     class, or consumer rule beats it. Flow rhythm targets direct children only,
     so margins never leak inside component internals. */
  .hcms-shell .mirk-page { max-width: 640px; margin-inline: auto; padding: 48px 24px 96px; }
  .hcms-shell .mirk-page--wide { max-width: 960px; }

  /* Departure Mono ships one weight \u2014 hierarchy comes from size, never bold. */
  .hcms-shell .mirk-page :where(h1, h2, h3, h4) { margin: 0; font-weight: 400; line-height: 1.15; }
  .hcms-shell .mirk-page :where(h1) { font-size: 40px; }
  .hcms-shell .mirk-page :where(h2) { font-size: 26px; }
  .hcms-shell .mirk-page :where(h3) { font-size: 20px; }
  .hcms-shell .mirk-page :where(h4) { font-size: 16px; }
  .hcms-shell .mirk-page :where(p) { margin: 0; font-size: 16px; line-height: 1.6; }

  .hcms-shell .mirk-page :where(a) { color: inherit; text-decoration: underline; text-underline-offset: 2px; }
  .hcms-shell .mirk-page :where(code, kbd) {
    font-size: 0.875em; padding: 1px 4px;
    background: var(--mirk-bevel-bg); border: 1px solid var(--mirk-input-border);
  }
  .hcms-shell .mirk-page :where(pre) {
    margin: 0; padding: 12px 14px; font-size: 13px; line-height: 1.5; overflow-x: auto;
    background: var(--mirk-bevel-bg); border: 1px solid var(--mirk-input-border);
  }
  .hcms-shell .mirk-page :where(pre code) { padding: 0; border: 0; background: none; font-size: inherit; }
  .hcms-shell .mirk-page :where(hr) { border: 0; border-top: 1px solid var(--mirk-input-border); }

  /* Flow rhythm \u2014 direct children only; headings open sections, eyebrows and
     hints hug their neighbors. Equal specificity, so source order settles ties. */
  .hcms-shell .mirk-page > :where(* + *) { margin-block-start: 14px; }
  .hcms-shell .mirk-page > :where(h1, h2, h3, h4):where(* + *) { margin-block-start: 40px; }
  .hcms-shell .mirk-page > :where(.mirk-eyebrow + *), .hcms-shell .mirk-page > :where(* + .mirk-hint) { margin-block-start: 6px; }

  /* ============================ EYEBROW ============================ */
  /* The kit's signature section label, as a shippable class. Block so it works
     the same on <p>, <label>, or <div>, and flow margins always apply. */
  .hcms-shell .mirk-eyebrow {
    display: block; margin: 0;
    font-size: 11px; text-transform: uppercase; letter-spacing: 0.2em;
    color: var(--mirk-placeholder-color);
  }
}

/* Respect the machine \u2014 outside @layer components so it always wins. */
@media (prefers-reduced-motion: reduce) {
  .hcms-shell .mirk-button--round, .hcms-shell .mirk-toggle__thumb { transition: none; }
  .hcms-shell .mirk-button:active .mirk-button__label { translate: none; }
}
@media (forced-colors: active) {
  .hcms-shell .mirk-button, .hcms-shell .mirk-select__field, .hcms-shell .mirk-checkbox__box, .hcms-shell .mirk-toggle__track { border: 1px solid ButtonText; }
}

/* ===== pixel-quiet overrides (hypercms-owned) ===== */
/* =====================================================================
   Pixel Quiet \u2014 hypercms theme overrides (hypercms-owned).

   Adapted from ARCHIVE_PROJECTS/cms-sidebar/pixel-quiet/overrides.css. Two jobs:
     1. Retune --mirk-* tokens, scoped to .hcms-shell.pixel-quiet (never :root).
     2. Author the panel geometry + the functional chrome the static mockup
        doesn't have (error banner, add/remove/move controls, the engine's
        sortable cards, push / overlay / left-dock modes) on top of the
        .hcms-* structural hooks.

   This file is concatenated AFTER the scoped mirk base+components by
   scripts/build-theme.js, so plain rules here win over mirk's @layer
   components with zero !important. Loaded only inside .hcms-shell, so nothing
   here leaks onto the host page.
   ===================================================================== */

/* ============================================================
   TOKEN RETUNE \u2014 LIGHT (warm cream, gentle near-equal bevel)
   ============================================================ */
.hcms-shell.pixel-quiet {
  color-scheme: light;
  --mirk-canvas: #F7F2EA;
  --mirk-bg: #F7F2EA;
  --mirk-fg: #2B241B;
  --mirk-accent: #efefe5;
  --mirk-destructive: #C24A3A;
  --mirk-focus-color: #C7AE93;

  --mirk-bevel-bg: #FCF8F1;
  --mirk-bevel-fg: #2B241B;
  --mirk-bevel-tl: #F0E7D8;
  --mirk-bevel-br: #E2D4BF;
  --mirk-bevel-hover-bg: #F4ECDF;
  --mirk-pill-inner-top: #FBF6EE;
  --mirk-input-border: #D8C8AF;
  --mirk-placeholder-color: #A8987F;

  --mirk-mark-fg: #6B5942;
  --mirk-toggle-bg: #EFDBBD;
  --mirk-toggle-hi: #F4EADA;
  --mirk-toggle-lo: #C2A87E;
  --mirk-sortable-dot: #DDCBB0;
  --mirk-sortable-shadow: #C9B493;
  --mirk-sortable-label: #8C7B62;
  --mirk-sortable-placeholder: #A8987F;

  --mirk-radius: 5px;
  --mirk-focus-offset: 2px;
}

/* dark token deltas, shared by the explicit .dark opt-in and OS preference */
.hcms-shell.pixel-quiet.dark,
.hcms-shell.pixel-quiet[data-theme="dark"] {
  color-scheme: dark;
  --mirk-canvas: #0B0C13;
  --mirk-bg: #11131E;
  --mirk-fg: #ECEAF2;
  --mirk-accent: #1D1F2F;
  --mirk-focus-color: #4A506B;

  --mirk-bevel-bg: #1A1D2C;
  --mirk-bevel-fg: #ECEAF2;
  --mirk-bevel-tl: #2A2E42;
  --mirk-bevel-br: #14182A;
  --mirk-bevel-hover-bg: #202436;
  --mirk-pill-inner-top: #202436;
  --mirk-input-border: #353B52;
  --mirk-placeholder-color: #6A7090;

  --mirk-mark-fg: #C9CDE0;
  --mirk-toggle-bg: #3E4660;
  --mirk-toggle-hi: #4E567A;
  --mirk-toggle-lo: #262B42;
  --mirk-sortable-dot: #353B52;
  --mirk-sortable-shadow: #0E1120;
  --mirk-sortable-label: #8A90AB;
  --mirk-sortable-placeholder: #6A7090;
}

/* Auto-dark on OS preference, unless the shell pins light with .light */
@media (prefers-color-scheme: dark) {
  .hcms-shell.pixel-quiet:not(.light):not([data-theme="light"]) {
    color-scheme: dark;
    --mirk-canvas: #0B0C13;
    --mirk-bg: #11131E;
    --mirk-fg: #ECEAF2;
    --mirk-accent: #1D1F2F;
    --mirk-focus-color: #4A506B;

    --mirk-bevel-bg: #1A1D2C;
    --mirk-bevel-fg: #ECEAF2;
    --mirk-bevel-tl: #2A2E42;
    --mirk-bevel-br: #14182A;
    --mirk-bevel-hover-bg: #202436;
    --mirk-pill-inner-top: #202436;
    --mirk-input-border: #353B52;
    --mirk-placeholder-color: #6A7090;

    --mirk-mark-fg: #C9CDE0;
    --mirk-toggle-bg: #3E4660;
    --mirk-toggle-hi: #4E567A;
    --mirk-toggle-lo: #262B42;
    --mirk-sortable-dot: #353B52;
    --mirk-sortable-shadow: #0E1120;
    --mirk-sortable-label: #8A90AB;
    --mirk-sortable-placeholder: #6A7090;
  }
}

/* ============================================================
   SHELL GEOMETRY \u2014 fixed, docked panel, single column.
   position: fixed makes the shell a containing block so the absolute
   minibar anchors to it; flex column so the body owns the scroll.
   ============================================================ */
.hcms-shell.pixel-quiet.hcms-panel {
  box-sizing: border-box;
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: var(--hcms-shell-width, 380px);
  max-width: 100vw;
  z-index: 2147483000;
  display: flex;
  flex-direction: column;
  color: var(--mirk-fg);
  background: var(--mirk-bg);
  border-left: 1px solid var(--mirk-input-border);
  box-shadow: -16px 0 48px -28px rgba(43, 36, 27, 0.45);
}
.hcms-shell.pixel-quiet.hcms-panel.dark {
  box-shadow: -16px 0 48px -28px rgba(0, 0, 0, 0.6);
}

.hcms-shell.pixel-quiet.hcms-side-left {
  right: auto;
  left: 0;
  border-left: 0;
  border-right: 1px solid var(--mirk-input-border);
  box-shadow: 16px 0 48px -28px rgba(43, 36, 27, 0.45);
}

/* Push the page over so docked content is never hidden underneath, and publish
   the geometry the floating toggle has to compose with. --hcms-toggle-shift is
   the distance the toggle moves left, which is the shell width only while the
   shell is docked on the right; docked left, as an overlay, or full-viewport it
   is zero. */
body.hcms-open { --hcms-shell-width: 380px; }
body.hcms-open:not(.hcms-overlay) { padding-right: var(--hcms-shell-width); }
body.hcms-open:not(.hcms-overlay):not(.hcms-side-left) { --hcms-toggle-shift: var(--hcms-shell-width); }
body.hcms-open.hcms-side-left:not(.hcms-overlay) { padding-right: 0; padding-left: var(--hcms-shell-width); }
body.hcms-open.hcms-overlay { overflow: hidden; --hcms-toggle-display: none; }

@media (max-width: 799px) {
  body.hcms-open { --hcms-shell-width: 100vw; }
  body.hcms-open:not(.hcms-overlay):not(.hcms-side-left) { --hcms-toggle-shift: 0px; }
  body.hcms-open:not(.hcms-overlay),
  body.hcms-open.hcms-side-left:not(.hcms-overlay) { padding-right: 0; padding-left: 0; }
  body.hcms-open { overflow: hidden; }
}

/* ---------- SCROLL REGION \u2014 holds the (scrollable) header + form + save ---------- */
.hcms-shell-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

/* ---------- CONDENSED MINIBAR \u2014 appears once the full header scrolls away ---------- */
.hcms-shell-minibar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 24px 10px;
  background: var(--mirk-bg);
  border-bottom: 1px solid var(--mirk-input-border);
  opacity: 0;
  transform: translateY(-100%);
  pointer-events: none;
  transition: opacity 140ms ease, transform 160ms ease;
}
.hcms-shell.is-condensed .hcms-shell-minibar {
  opacity: 1;
  transform: none;
  pointer-events: auto;
}
.hcms-shell-minibar-title {
  font-size: 14px;
  line-height: 1;
  color: var(--mirk-fg);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ---------- HEADER (no underline rule \u2014 whitespace separates the bands) ---------- */
.hcms-shell-header {
  flex-shrink: 0;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 24px 24px 4px;
}
.hcms-shell-heading { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.hcms-shell-eyebrow {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  color: var(--mirk-placeholder-color);
}
.hcms-shell-title {
  margin: 0;
  font-size: 18px;
  font-weight: 400;
  line-height: 1.2;
  color: var(--mirk-fg);
}
.hcms-shell-close.mirk-button {
  flex-shrink: 0;
  padding: 2px 9px 3px;
  line-height: 1;
}
.hcms-shell-close .mirk-button__label { font-size: 16px; }

/* ---------- FORM \u2014 generous, even vertical rhythm ---------- */
.hcms-form {
  display: flex;
  flex-direction: column;
  gap: 26px;
  padding: 12px 24px 28px;
}

/* one labeled scalar field */
.hcms-field { display: flex; flex-direction: column; gap: 9px; }
.hcms-field--row {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

/* themed field label */
.hcms-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--mirk-sortable-label);
}

/* comfortable control padding + readable size, in mirk's own mono */
.hcms-shell.pixel-quiet .mirk-input,
.hcms-shell.pixel-quiet .mirk-textarea {
  font-size: 15px;
  padding: 9px 14px 10px;
}
.hcms-shell.pixel-quiet textarea.mirk-input { min-height: 76px; resize: vertical; }

/* default scalar fields: one-row textareas that grow with their content.
   Browsers without field-sizing get a scrollHeight fallback (enhance.js). */
.hcms-shell.pixel-quiet .hcms-form textarea.mirk-textarea {
  field-sizing: content;
  resize: none;
  overflow: hidden;
  min-height: 0;
}

/* rich-text surface (@richtext): a contenteditable styled like a textarea */
.hcms-shell.pixel-quiet .hcms-richtext {
  min-height: 2.5em;
  cursor: text;
  overflow-wrap: break-word;
}
.hcms-shell.pixel-quiet .hcms-richtext a {
  color: inherit;
  text-decoration: underline;
  text-underline-offset: 2px;
}
.hcms-shell.pixel-quiet .hcms-richtext:empty::before {
  content: attr(data-hcms-placeholder);
  color: var(--mirk-placeholder-color);
}
.hcms-shell.pixel-quiet .mirk-select__field {
  font-size: 15px;
  padding: 8px 40px 9px 14px;
}
.hcms-shell.pixel-quiet .mirk-radio__label,
.hcms-shell.pixel-quiet .mirk-toggle__label,
.hcms-shell.pixel-quiet .mirk-tags__input { font-size: 15px; }

/* inline radio row */
.hcms-radio-row { display: flex; align-items: center; gap: 22px; flex-wrap: wrap; }

/* chip-field (the @chips built-in): a borderless inline input that sizes to its
   text, so chips read like static chips but stay inline-editable. */
.hcms-shell .mirk-tags__chip { padding-right: 6px; }
.hcms-shell .hcms-chip-field {
  border: 0; background: transparent; color: inherit; font: inherit;
  outline: none; min-width: 2ch; field-sizing: content; padding: 0;
}
.hcms-shell .hcms-chips .hcms-add { margin-top: 4px; align-self: flex-start; }

/* ---------- OBJECT GROUP \u2014 a quiet framed band, not a heavy card ---------- */
.hcms-object {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.hcms-object-title {
  margin: 0;
  font-size: 11px;
  font-weight: 400;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--mirk-sortable-label);
}
.hcms-object-fields { display: flex; flex-direction: column; gap: 16px; }

/* ---------- SCALAR ARRAY \u2014 a calm list of mirk-input rows ---------- */
.hcms-array { display: flex; flex-direction: column; gap: 14px; }
.hcms-array-header { display: flex; align-items: baseline; justify-content: space-between; }
.hcms-array-title {
  margin: 0;
  font-size: 11px;
  font-weight: 400;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--mirk-sortable-label);
}
/* The generic stacked-list layout is unlayered, so it would beat mirk's
   @layer-components rules on any slot that is also a mirk component. Exempt a
   mirk tags box so it keeps mirk's own row-wrap layout and inner padding. */
.hcms-array-items:not(.mirk-tags) {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.hcms-array-item {
  display: flex;
  align-items: center;
  gap: 8px;
}
.hcms-array-item .mirk-input { flex: 1; min-width: 0; }

/* ---------- OBJECT ARRAY \u2014 mirk-sortable cards from the engine markup ---------- */
.hcms-array--cards .hcms-array-items { gap: 14px; }
.hcms-card.mirk-sortable__item { background: var(--mirk-bevel-bg); position: relative; }
.hcms-card .hcms-card-fields { display: flex; flex-direction: column; flex: 1; min-width: 0; }
.hcms-card .hcms-field {
  gap: 2px;
  padding: 8px 14px 9px;
}
.hcms-card .hcms-field:not(:last-child) { border-bottom: 1px solid var(--mirk-input-border); }
.hcms-card .hcms-label { letter-spacing: 0.16em; }
/* fields inside a card read as quiet rows, not chunky boxed inputs */
.hcms-card .mirk-input,
.hcms-card .mirk-textarea {
  border: none;
  background: transparent;
  padding: 0;
  font-size: 15px;
}
.hcms-card .mirk-input:focus-visible,
.hcms-card .mirk-textarea:focus-visible { outline: none; }
/* the remove \xD7 is pulled out to the card corner (below), so the controls row
   now only holds the sr-only move buttons \u2014 collapse it until one is focused. */
.hcms-card-controls {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  padding: 0;
}

/* quiet \xD7 remove control, shared by scalar-array rows and object-array cards */
.hcms-remove {
  flex-shrink: 0;
  appearance: none;
  border: 0;
  background: none;
  color: var(--mirk-placeholder-color);
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  padding: 2px 6px;
}
.hcms-remove:hover { color: var(--mirk-destructive); }
.hcms-remove[hidden] { display: none; }

/* object-array card: the delete control is a square corner button pinned
   top-right, carrying the card's own 1px border + a crisp-line \xD7 icon. */
.hcms-remove--card {
  position: absolute;
  top: -1px;
  right: -1px;
  width: 18px;
  height: 18px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--mirk-input-border);
  background: var(--mirk-bevel-bg);
  color: var(--mirk-placeholder-color);
}
.hcms-remove--card:hover { border-color: var(--mirk-destructive); }
.hcms-remove--card .hcms-x { width: 64%; height: 64%; display: block; }

/* "+ Add" \u2014 quiet, pinned left */
.hcms-add.mirk-button { align-self: flex-start; }

/* ---------- UPLOAD COMPONENTS (@file / @image) ----------
   Built on the kit's mirk-file / mirk-image--compact chrome. The native picker
   is visually hidden but focusable (the mirk-button label is the visible
   trigger and rings via :has(:focus-visible)); it is NOT .mirk-*__input, so the
   vendored mirk runtime never handles it. The empty/filled chrome is driven by
   the bound leaf's value attribute (src/href) in CSS \u2014 no JS state to desync. */
.hcms-upload input[type="file"] {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

/* @image: show the upload button until the bound <img> carries a real src. */
.hcms-upload--image .mirk-image__thumb { display: none; }
.hcms-upload--image:has(.mirk-image__preview[src]:not([src=""])) .mirk-image__upload { display: none; }
.hcms-upload--image:has(.mirk-image__preview[src]:not([src=""])) .mirk-image__thumb { display: inline-block; }

/* @file: reveal the clear \xD7 and the filename only once the bound <a> has href. */
.hcms-upload--file .hcms-upload-clear { display: none; }
.hcms-upload--file:has(a.mirk-file__name[href]:not([href=""])) .hcms-upload-clear { display: inline-flex; }
/* A filled filename uses the bright foreground (the kit's [data-filled] look),
   driven by the bound href so there's no JS attribute to keep in sync \u2014 the
   vendored runtime that would otherwise stamp data-filled is inert here. */
.hcms-upload--file:has(a.mirk-file__name[href]:not([href=""])) a.mirk-file__name {
  color: var(--mirk-bevel-fg);
}
.hcms-upload--file a.mirk-file__name:empty {
  text-decoration: none;
  cursor: default;
}
.hcms-upload--file a.mirk-file__name:empty::after {
  content: "No file chosen";
  color: var(--mirk-placeholder-color);
}

/* ---------- COLOR (@color) ----------
   Swatch colors arrive as --hcms-swatch on each element's style, so a value
   never becomes a selector or a class. The full palette is an 11-column grid
   (one row per hue); a narrowed set wraps. */
.hcms-color-row { display: flex; align-items: center; gap: 8px; }
.hcms-color-current {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 4px 12px 4px 4px; border: 1px solid var(--mirk-input-border); border-radius: 999px;
  background: var(--mirk-input-bg); color: var(--mirk-fg); font: inherit; cursor: pointer;
}
.hcms-color--inline .hcms-color-current { cursor: default; }
.hcms-color-chip, .hcms-color-swatch { background: var(--hcms-swatch, transparent); }
.hcms-color-chip {
  width: 20px; height: 20px; border-radius: 50%;
  box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--mirk-fg) 20%, transparent);
}
.hcms-color[data-hcms-color-empty] .hcms-color-chip {
  background: repeating-conic-gradient(var(--mirk-input-border) 0 25%, transparent 0 50%) 50% / 8px 8px;
}
.hcms-color-clear {
  display: inline-flex; padding: 2px; border: 0; background: transparent;
  color: var(--mirk-placeholder-color); cursor: pointer;
}
.hcms-color-clear:hover { color: var(--mirk-fg); }
.hcms-color[data-hcms-color-empty] .hcms-color-clear { display: none; }
.hcms-color-panel { margin-top: 8px; }
.hcms-color-panel[hidden] { display: none; }
.hcms-color-grid { display: flex; flex-wrap: wrap; gap: 4px; }
.hcms-color-grid--full { display: grid; grid-template-columns: repeat(11, minmax(0, 1fr)); gap: 3px; }
.hcms-color-swatch {
  width: 22px; height: 22px; padding: 0; border: 0; border-radius: 4px; cursor: pointer;
  box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--mirk-fg) 15%, transparent);
}
.hcms-color-grid--full .hcms-color-swatch { width: auto; height: auto; aspect-ratio: 1; }
.hcms-color-swatch[aria-pressed="true"] { box-shadow: 0 0 0 2px var(--mirk-bg), 0 0 0 4px var(--mirk-fg); }
.hcms-color-swatch:focus-visible { outline: 2px solid var(--mirk-focus-color); outline-offset: 2px; }
.hcms-color-custom { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.hcms-color-native {
  width: 32px; height: 28px; padding: 0; border: 1px solid var(--mirk-input-border);
  border-radius: 4px; background: none; cursor: pointer;
}
.hcms-color-text { flex: 1; min-width: 0; }

/* ---------- FONT (@font) ----------
   Each option sets its own font-family inline, so the list previews every
   family in its face once the editor-only preview stylesheet arrives. */
.hcms-font-current {
  display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%;
  padding: 6px 10px; border: 1px solid var(--mirk-input-border); border-radius: 4px;
  background: var(--mirk-input-bg); color: var(--mirk-fg); font: inherit; cursor: pointer; text-align: left;
}
.hcms-font-name { font-size: 15px; }
.hcms-font-chevron { transform: rotate(90deg); color: var(--mirk-placeholder-color); }
.hcms-font-panel { margin-top: 6px; }
.hcms-font-panel[hidden] { display: none; }
.hcms-font-list {
  display: flex; flex-direction: column; max-height: 320px; overflow-y: auto;
  border: 1px solid var(--mirk-input-border); border-radius: 4px; background: var(--mirk-input-bg);
}
.hcms-font-group {
  padding: 8px 10px 4px; font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase;
  color: var(--mirk-placeholder-color);
}
.hcms-font-option {
  padding: 6px 10px; border: 0; background: transparent; color: var(--mirk-fg);
  font-size: 16px; text-align: left; cursor: pointer;
}
.hcms-font-option:hover { background: color-mix(in oklab, var(--mirk-fg) 8%, transparent); }
.hcms-font-option[aria-selected="true"] { background: color-mix(in oklab, var(--mirk-fg) 14%, transparent); }
.hcms-font-option:focus-visible { outline: 2px solid var(--mirk-focus-color); outline-offset: -2px; }

/* ---------- VARIANT (@variant) ----------
   Native radios behind icon tiles: arrow keys move the choice, the tile with
   the checked radio is the selected one. */
.hcms-variant-row { display: flex; flex-wrap: wrap; gap: 8px; }
.hcms-variant-option {
  position: relative; display: inline-flex; flex-direction: column; align-items: center; gap: 4px;
  min-width: 64px; padding: 8px 10px; border: 1px solid var(--mirk-input-border); border-radius: 6px;
  background: var(--mirk-input-bg); color: var(--mirk-placeholder-color); font-size: 12px; cursor: pointer;
}
.hcms-variant-option:hover { color: var(--mirk-fg); }
.hcms-variant-option:has(input:checked) {
  color: var(--mirk-fg); border-color: var(--mirk-fg);
  box-shadow: inset 0 0 0 1px var(--mirk-fg);
}
.hcms-variant-option:has(input:focus-visible) { outline: 2px solid var(--mirk-focus-color); outline-offset: 2px; }
.hcms-variant-icon { display: inline-flex; }

/* ---------- UPLOADING (spec \xA79) ----------
   One attribute, [data-hcms-uploading], set on the field for as long as the host
   has the bytes, plus --hcms-upload-progress carrying the percent. No markup of
   its own: the templates keep their exact shape, so a half-finished upload cannot
   leave an orphan node behind in the form. The at-upload-time picture is painted
   on the frame as a background, never assigned to the bound <img>, because that
   img IS the field's value and a commit landing mid-upload would write a
   two-megabyte data URL straight into the live page. */
.hcms-upload[data-hcms-uploading] .mirk-image__frame {
  background-size: cover;
  background-position: center;
}
/* The empty state hides the thumb, so an upload into an empty field would have
   nowhere to show. Uploading reveals it, preview or not. */
.hcms-upload--image[data-hcms-uploading] .mirk-image__thumb { display: inline-block; }
.hcms-upload--image[data-hcms-uploading] .mirk-image__upload { display: none; }
/* No \xD7 mid-flight: clearing writes the leaf empty, which says nothing about the
   request still running and reads as a cancel that is not one. */
.hcms-upload[data-hcms-uploading] .hcms-upload-clear { display: none; }

.hcms-upload[data-hcms-uploading] .mirk-image__frame::after,
.hcms-upload--file[data-hcms-uploading] .mirk-file::after {
  content: "";
  position: absolute;
  left: 0;
  bottom: 0;
  height: 3px;
  width: var(--hcms-upload-progress, 0%);
  background: var(--mirk-bevel-fg);
  transition: width 120ms linear;
}
/* The @file row has no frame to hang the bar on, so it becomes the positioning
   context itself. */
.hcms-upload--file[data-hcms-uploading] .mirk-file { position: relative; }

/* clear-\xD7 (vendored-inert; data-hcms-action, never .mirk-*__remove). Bare \xD7 for
   @file, a pinned corner badge for @image \u2014 mirroring .hcms-remove / --card. */
.hcms-upload-clear {
  flex-shrink: 0;
  appearance: none;
  border: 0;
  background: none;
  color: var(--mirk-placeholder-color);
  cursor: pointer;
  line-height: 0;
  padding: 2px 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.hcms-upload-clear:hover { color: var(--mirk-destructive); }
.hcms-upload-clear .hcms-x { display: block; width: 14px; height: 14px; }

.hcms-upload-clear--badge {
  position: absolute;
  top: -7px;
  right: -7px;
  width: 18px;
  height: 18px;
  padding: 0;
  border-radius: 50%;
  border: 1px solid var(--mirk-input-border);
  background: var(--mirk-bevel-bg);
  color: var(--mirk-bevel-fg);
}
.hcms-upload-clear--badge:hover { color: var(--mirk-destructive); border-color: var(--mirk-destructive); }
.hcms-upload-clear--badge .hcms-x { width: 10px; height: 10px; }

/* ---------- UNRESOLVED-FIELDS NOTICE ---------- */
.hcms-shell-notice {
  font-size: 12px;
  line-height: 1.45;
  white-space: pre-line;
  color: var(--mirk-mark-fg);
  background: var(--mirk-bevel-bg);
  border: 1px solid var(--mirk-input-border);
  padding: 8px 12px;
  margin: 0 24px 8px;
}
.hcms-shell-notice[hidden] { display: none; }

/* ---------- ERROR BANNER + inline errors ---------- */
.hcms-shell-error,
.hcms-error {
  font-size: 12px;
  line-height: 1.45;
  color: var(--mirk-destructive);
  background: var(--mirk-bevel-bg);
  border: 1px solid var(--mirk-destructive);
  padding: 8px 12px;
}
.hcms-shell-error { margin: 0 24px; }
.hcms-error { margin-top: 6px; }
.hcms-shell-error[hidden],
.hcms-error[hidden] { display: none; }

/* A note, not a refusal: the file WAS stored, in the page, and this says why it
   is not on the host. Same slot, so there is one place a field ever speaks. */
.hcms-error--info {
  color: var(--mirk-mark-fg);
  border-color: var(--mirk-input-border);
}

/* ---------- SAVE (sits at the end of the scrolling form, not pinned) ---------- */
.hcms-shell-footer {
  display: flex;
  justify-content: flex-end;
  padding: 4px 24px 28px;
}
.hcms-shell-footer[hidden] { display: none; }

/* ---------- sr-only move buttons: hidden, visible on keyboard focus ---------- */
.hcms-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.hcms-sr-only:focus {
  position: static;
  width: auto;
  height: auto;
  padding: 2px 6px;
  margin: 0 2px;
  overflow: visible;
  clip: auto;
  white-space: normal;
  background: var(--mirk-bevel-bg);
  border: 1px solid var(--mirk-input-border);
  color: var(--mirk-fg);
  font-size: 12px;
  cursor: pointer;
}
.hcms-sr-only[hidden] { display: none; }

/* ============================================================
   INLINE VIEW GEOMETRY \u2014 not a panel. A transparent full-viewport
   host whose children are the only interactive surfaces, so the page
   underneath stays fully usable while the editor is open.
   ============================================================ */
.hcms-shell.pixel-quiet.hcms-inline {
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  /* The host must never intercept a click meant for the page. Each child
     re-enables pointer events for itself. */
  pointer-events: none;
  background: none;
  border: 0;
  box-shadow: none;
  color: var(--mirk-fg);
}
.hcms-inline > *,
.hcms-inline-layer > * { pointer-events: auto; }
.hcms-inline-layer { position: absolute; inset: 0; pointer-events: none; }

.hcms-inline-bar {
  position: absolute;
  left: 50%;
  bottom: 16px;
  transform: translateX(-50%);
  max-width: min(560px, calc(100vw - 32px));
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.hcms-inline-notice,
.hcms-inline-error {
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 14px;
  line-height: 1.4;
  border: 1px solid var(--mirk-input-border);
  background: var(--mirk-bg);
  color: var(--mirk-fg);
  box-shadow: 0 12px 32px -20px rgba(43, 36, 27, 0.5);
}
.hcms-inline-notice { white-space: pre-line; }
.hcms-inline-error { border-color: var(--mirk-destructive); color: var(--mirk-destructive); }
.hcms-inline-notice[hidden],
.hcms-inline-error[hidden] { display: none; }

.hcms-inline-pop {
  position: absolute;
  top: 0;
  left: 0;
  box-sizing: border-box;
  width: min(340px, calc(100vw - 24px));
  max-height: calc(100dvh - 24px);
  overflow: auto;
  padding: 16px;
  border-radius: 8px;
  border: 1px solid var(--mirk-input-border);
  background: var(--mirk-bg);
  color: var(--mirk-fg);
  box-shadow: 0 16px 40px -22px rgba(43, 36, 27, 0.55);
  /* Above the handles. They are positioned with z-index: 1 while the popover
     sat at auto, so a handle painted over the very field it had just opened
     and covered the text in it. The popover is what someone is using; a handle
     is only an offer to open one. */
  z-index: 2;
}
.hcms-inline-pop[hidden] { display: none; }
.hcms-inline-pop-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
  font-size: 14px;
}
.hcms-shell .hcms-inline-pop-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 36px;
  min-height: 36px;
  padding: 4px;
}

.hcms-inline-item-controls {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 1;
  will-change: transform;
  display: flex;
  align-items: center;
  gap: 2px;
}
.hcms-inline-item-controls[hidden],
.hcms-inline-handle[hidden] { display: none; }
.hcms-inline-item-controls.has-open-settings { z-index: 3; }
.hcms-inline-settings { position: relative; display: flex; flex: none; }
.hcms-inline-settings[hidden],
.hcms-inline-settings-menu[hidden] { display: none; }
.hcms-inline-settings-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  min-width: 120px;
  padding: 4px;
  border: 1px solid var(--mirk-input-border);
  border-radius: 5px;
  background: var(--mirk-bg);
  box-shadow: 0 8px 24px #0003;
}
.hcms-inline-settings-menu button {
  display: block;
  box-sizing: border-box;
  width: 100%;
  padding: 10px 12px;
  border: 0;
  background: transparent;
  color: var(--mirk-destructive);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.hcms-inline-settings-menu button:hover,
.hcms-inline-settings-menu button:focus-visible {
  background: var(--mirk-bevel-bg);
  outline: 1px solid var(--mirk-focus-color);
}

/* Buttons flow within the positioned item container. */
.hcms-inline-row-controls {
  display: flex;
  gap: 2px;
}
.hcms-inline-row-controls[hidden] { display: none; }

.hcms-inline-list-add[hidden] { display: none; }

.hcms-shell.hcms-inline-ghost {
  box-sizing: border-box;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
  max-width: 100%;
  min-width: 0;
  margin: 8px 0 0;
  padding: 0;
  border: 1px dashed color-mix(in srgb, currentColor 25%, transparent);
  border-radius: 3px;
  background: color-mix(in srgb, currentColor 3%, transparent);
  color: inherit;
  list-style: none;
}
.hcms-shell.hcms-inline-ghost[hidden] { display: none; }
tr.hcms-shell.hcms-inline-ghost { display: table-row; }
.hcms-inline-ghost-cell { padding: 0; text-align: center; vertical-align: middle; }

.hcms-shell .hcms-inline-handle,
.hcms-shell .hcms-inline-list-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 36px;
  min-height: 36px;
  padding: 4px;
  line-height: 1;
}
.hcms-inline-handle .mirk-button__label,
.hcms-inline-list-button .mirk-button__label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  line-height: 1;
}
.hcms-inline-icon { display: block; width: 24px; height: 24px; flex: none; }
.hcms-inline-handle .hcms-inline-icon { width: 20.4px; height: 20.4px; transform: translateY(-1px); }
.hcms-inline-list-add .hcms-inline-icon { width: 16.8px; height: 16.8px; }
.hcms-shell .hcms-inline-list-add { padding-inline: 10px; }

.hcms-inline-list-button {
  flex: none;
}
.hcms-inline-list-button[hidden] { display: none; }
.hcms-shell .hcms-inline-list-button:disabled {
  opacity: 1;
  color: #626B96;
  background: var(--mirk-bevel-bg);
  border-color: var(--mirk-bevel-tl) var(--mirk-bevel-br) var(--mirk-bevel-br) var(--mirk-bevel-tl);
}
.hcms-shell .hcms-inline-list-button:disabled .mirk-button__label { translate: none; }

/* A finger is not a mouse pointer: on touch the same three controls get the
   44px target the platform guidelines ask for. */
@media (pointer: coarse) {
  .hcms-shell .hcms-inline-handle,
  .hcms-shell .hcms-inline-list-button {
    min-width: 44px;
    min-height: 44px;
  }
}

.hcms-inline-toggle { align-self: center; }
.hcms-inline-toggle[hidden] { display: none; }

/* Fields with no visible anchor can still be edited through the sidebar. */
.hcms-inline-handoff {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 6px 6px 12px;
  border-radius: 999px;
  font-size: 13px;
  border: 1px solid var(--mirk-input-border);
  background: var(--mirk-bg);
  color: var(--mirk-fg);
  align-self: center;
}
.hcms-inline-handoff[hidden] { display: none; }

/* Selected fields only. Scoped to the inline host: [data-hcms-shell] is on BOTH
   hosts, so an unscoped rule hides the sidebar's whole form too. */
.hcms-inline .hcms-form [data-hcms-path] { display: none; }
.hcms-inline .hcms-form [data-hcms-path].is-hcms-inline-onpath,
.hcms-inline .hcms-form [data-hcms-path].is-hcms-inline-active { display: block; }
/* The Page style group has no data path of its own: hide it like a path until
   a reveal marks it on-path. */
.hcms-inline .hcms-form [data-hcms-page-style]:not(.is-hcms-inline-onpath) { display: none; }

.hcms-inline .hcms-form .is-hcms-inline-onpath,
.hcms-inline .hcms-form {
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 0;
  box-shadow: none;
  background: transparent;
  min-width: 0;
  min-height: 0;
  width: 100%;
}
.hcms-inline-pop .hcms-object-title,
.hcms-inline-pop .hcms-array-header,
.hcms-inline-pop .hcms-drag-handle,
.hcms-inline-pop [data-hcms-action="add"],
.hcms-inline-pop [data-hcms-action="remove"],
.hcms-inline-pop [data-hcms-action="move-up"],
.hcms-inline-pop [data-hcms-action="move-down"],
.hcms-inline-pop .hcms-card-controls { display: none; }
.hcms-inline .hcms-form .hcms-field.is-hcms-inline-active {
  display: flex;
  gap: 8px;
  padding: 0;
  margin: 0 0 16px;
  border: 0;
  min-width: min(260px, 100%);
}
.hcms-inline .hcms-form .hcms-field.is-hcms-inline-active:last-child { margin-bottom: 0; }
.hcms-shell.pixel-quiet .hcms-inline-pop .mirk-input,
.hcms-shell.pixel-quiet .hcms-inline-pop .mirk-textarea {
  box-sizing: border-box;
  width: 100%;
  min-width: min(260px, 100%);
  min-height: 42px;
  padding: 10px 12px;
  border: 1px solid var(--mirk-input-border);
  background: var(--mirk-input-bg);
}
.hcms-inline-pop .mirk-input:focus-visible,
.hcms-inline-pop .mirk-textarea:focus-visible {
  outline: 2px solid var(--mirk-focus-color);
  outline-offset: 2px;
}

.hcms-inline-highlight {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
  border: 2px solid var(--mirk-focus-color);
  border-radius: 4px;
  box-sizing: border-box;
  will-change: transform;
}
.hcms-inline-highlight[hidden] { display: none; }
`;typeof window<"u"&&typeof document<"u"&&(function(){if(window.__mirk)return;window.__mirk=!0;let e='<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4 12 12M12 4 4 12" stroke="currentColor" stroke-width="2" stroke-linecap="square" fill="none"/></svg>';document.addEventListener("click",r=>{let l=r.target.closest(".mirk-number__step");if(!l)return;let i=l.closest(".mirk-number").querySelector("input[type=number]");i&&(l.dataset.step==="up"?i.stepUp():i.stepDown(),i.dispatchEvent(new Event("change",{bubbles:!0})))}),document.addEventListener("input",r=>{let l=r.target.closest(".mirk-slider__input");l&&l.closest(".mirk-slider").style.setProperty("--mirk-value",`${l.value}%`)}),document.addEventListener("change",r=>{let l=r.target.closest(".mirk-file__input");if(!l||!l.files.length)return;let i=l.closest(".mirk-file"),o=i.querySelector(".mirk-file__name");if(!o)return;let a=l.files[0],n=document.createElement("a");if(n.className="mirk-file__name",n.dataset.filled="",n.href=URL.createObjectURL(a),n.target="_blank",n.rel="noopener",n.textContent=a.name,o.replaceWith(n),!i.querySelector(".mirk-file__remove")){let s=document.createElement("button");s.type="button",s.className="mirk-file__remove",s.setAttribute("aria-label","Remove file"),s.innerHTML=e,n.after(s)}}),document.addEventListener("change",r=>{let l=r.target.closest(".mirk-image__input");if(!l||!l.files.length)return;let i=l.closest(".mirk-image"),o=i.querySelector(".mirk-image__preview");if(!o)return;let a=i.querySelector(".mirk-image__placeholder"),n=new FileReader;n.onload=s=>{o.src=s.target.result,o.removeAttribute("hidden"),a&&a.setAttribute("hidden",""),i.querySelector(".mirk-image__thumb")?.removeAttribute("hidden"),i.querySelector(".mirk-image__upload")?.setAttribute("hidden","")},n.readAsDataURL(l.files[0])}),document.addEventListener("click",r=>{let l=r.target.closest(".mirk-file__remove");if(l){let o=l.closest(".mirk-file"),a=o?.querySelector(".mirk-file__input"),n=o?.querySelector(".mirk-file__name");if(a&&(a.value=""),n){let s=document.createElement("span");s.className="mirk-file__name",s.textContent="No file chosen",n.replaceWith(s)}l.remove();return}let i=r.target.closest(".mirk-image__remove");if(i){let o=i.closest(".mirk-image"),a=o?.querySelector(".mirk-image__input"),n=o?.querySelector(".mirk-image__preview");a&&(a.value=""),n&&(n.removeAttribute("src"),n.setAttribute("hidden","")),o?.querySelector(".mirk-image__thumb")?.setAttribute("hidden",""),o?.querySelector(".mirk-image__upload")?.removeAttribute("hidden")}});function t(r,l){let i=document.createElement("span");i.textContent=r;let o=document.createElement("input");o.type="hidden",o.name="tags[]",o.value=r;let a=document.createElement("button");a.type="button",a.className="mirk-tags__remove",a.textContent="\xD7";let n=document.createElement("span");if(n.className="mirk-tags__chip",l){let s=document.createElement("span");s.className="mirk-tags__chip-inner",s.append(i,o,a),n.append(s)}else n.append(i,o,a);return n}document.addEventListener("keydown",r=>{let l=r.target.closest(".mirk-tags__input");if(!l)return;let i=l.closest(".mirk-tags");if(r.key==="Enter"||r.key===","){let o=l.value.trim();if(!o)return;r.preventDefault(),l.before(t(o,i.classList.contains("mirk-tags--round"))),l.value=""}else if(r.key==="Backspace"&&!l.value){let o=i.querySelectorAll(".mirk-tags__chip");o[o.length-1]?.remove()}}),document.addEventListener("click",r=>{let l=r.target.closest(".mirk-tags__remove");if(l){l.closest(".mirk-tags__chip").remove();return}let i=r.target.closest(".mirk-tags");i&&r.target===i&&i.querySelector(".mirk-tags__input")?.focus()}),document.addEventListener("click",r=>{let l=r.target.closest("[data-mirk-chip]");if(!l)return;let i=l.getAttribute("data-mirk-chip");if(i==="open")l.closest(".mirk-chip")?.classList.add("mirk-chip--open");else if(i==="collapse")l.closest(".mirk-chip")?.classList.remove("mirk-chip--open");else if(i==="changes"){let o=l.closest(".mirk-chip__panel")?.classList.toggle("is-changes");l.textContent=o?"(hide changes)":"(view changes)"}}),document.addEventListener("click",r=>{let l=r.target.closest("[data-copy-btn]");if(!l)return;let i=l.closest("[data-copy]");if(!i)return;let o=i.cloneNode(!0);o.querySelectorAll("[data-copy-btn]").forEach(n=>n.remove());let a=i.getAttribute("data-copy")==="text"?o.textContent.replace(/^\s+|\s+$/g,""):o.innerHTML.replace(/\s+data-copy(="[^"]*")?/g,"").replace(/^\s*\n/gm,"").trim();navigator.clipboard.writeText(a).then(()=>{let n=l.textContent;l.textContent="copied",l.dataset.copied="",setTimeout(()=>{l.textContent=n,delete l.dataset.copied},1200)}).catch(()=>{l.textContent="error",setTimeout(()=>{l.textContent="copy"},1200)})})})();hh(yh);var jr=jo,xh={cms:jo};typeof window<"u"&&!window.__hyperclayNoAutoExport&&(window.hyperclay=window.hyperclay||{},window.hyperclay.hypercms=jr,window.h=window.hyperclay);var wh=jr,Ah=Xl;Ct("cms",Ur);Ct("cms-toggle",Wr,{roots:Vr});export{wh as cms,Ah as default};
