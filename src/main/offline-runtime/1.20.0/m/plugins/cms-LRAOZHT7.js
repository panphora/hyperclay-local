import{b as qe,e as Zr}from"../c-JAX2667S.js";import{a as $t}from"../c-OJYM642Q.js";import"../c-BJ7YQ5QZ.js";import"../c-4JZDZFF6.js";import{e as V}from"../c-VAK7SG37.js";import"../c-MHI3GYKF.js";import"../c-NUHP2XDB.js";import"../c-VHNSBD2M.js";var Qr=`@layer clay-skin{
:is(.hcms-shell):not([data-theme]),:is(.hcms-shell):not([data-theme]) *{--mirk-canvas:light-dark(#FDF8F0, #0B0C13) !important;--mirk-bg:light-dark(#FFFCF6, #11131E) !important;--mirk-fg:light-dark(#2B241B, #ECEAF2) !important;--mirk-accent:light-dark(#F4ECDF, #1A1D2C) !important;--mirk-destructive:light-dark(#A83A2C, #FF5566) !important;--mirk-focus-color:light-dark(#8F6310, #D9A445) !important;--mirk-bevel-bg:light-dark(#F1E7D4, #22273E) !important;--mirk-bevel-fg:light-dark(#2B241B, #ECEAF2) !important;--mirk-bevel-tl:light-dark(#FFF9ED, #3C4260) !important;--mirk-bevel-br:light-dark(#D6C3A5, #1B2033) !important;--mirk-bevel-hover-bg:color-mix(in srgb, light-dark(#F1E7D4, #22273E), light-dark(#FFF9ED, #3C4260) 45%) !important;--mirk-pill-inner-top:light-dark(#FFF9ED, #3C4260) !important;--mirk-input-border:light-dark(#D8C8AF, #353B52) !important;--mirk-placeholder-color:light-dark(#9A8A70, #6A7090) !important;--mirk-ctrl-bg:light-dark(#6B5942, #8A90AB) !important;--mirk-toggle-bg:light-dark(#FCF8F1, #4A5275) !important;--mirk-toggle-hi:light-dark(#FFF9ED, #6C759A) !important;--mirk-toggle-lo:light-dark(#D6C3A5, #1B2033) !important;--mirk-mark-fg:light-dark(#2B241B, #ECEAF2) !important;--mirk-sortable-dot:light-dark(#D8C8AF, #353B52) !important;--mirk-sortable-shadow:light-dark(#D6C3A5, #1B2033) !important;--mirk-sortable-label:light-dark(#6B5942, #8A90AB) !important;--mirk-sortable-placeholder:light-dark(#9A8A70, #6A7090) !important;--mirk-slider-fill:light-dark(#F0E4CC, #3A2F17) !important;--mirk-slider-nub-bg:light-dark(#FCF8F1, #4A5275) !important;--mirk-slider-nub-hi:light-dark(#FFF9ED, #6C759A) !important;--mirk-slider-nub-lo:light-dark(#D6C3A5, #1B2033) !important;--mirk-chip-surface:light-dark(#FFFCF6, #11131E) !important;--mirk-chip-edge:light-dark(#D8C8AF, #353B52) !important;--mirk-chip-primary-bg:light-dark(#2B241B, #ECEAF2) !important;--mirk-chip-primary-fg:light-dark(#FDF8F0, #0B0C13) !important;--mirk-chip-alert:light-dark(#A83A2C, #FF5566) !important;--mirk-radius:0px !important;--mirk-focus-offset:2px !important}
:is(.hcms-shell){font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace !important}
.hcms-shell .mirk-chip__actions .mirk-chip__action--primary{--mirk-bevel-bg:var(--mirk-chip-primary-bg) !important;--mirk-bevel-fg:var(--mirk-chip-primary-fg) !important;--mirk-bevel-tl:color-mix(in srgb, var(--mirk-chip-primary-bg), white 24%) !important;--mirk-bevel-br:color-mix(in srgb, var(--mirk-chip-primary-bg), black 32%) !important;--mirk-bevel-hover-bg:color-mix(in srgb, var(--mirk-chip-primary-bg), white 10%) !important}
}`;var Yr=["[data-hcms-toggle-host]"],ei=`@layer clay-skin{
[data-hcms-toggle-host]{--hcms-toggle-bg:${V.face} !important;--hcms-toggle-color:${V.ink} !important}
[data-hcms-toggle-host] :is(.hcms-toggle__main, .hcms-toggle__arrow){border-color:${V["edge-hi"]} ${V["edge-lo"]} ${V["edge-lo"]} ${V["edge-hi"]} !important}
[data-hcms-toggle-host] :is(.hcms-toggle__main, .hcms-toggle__arrow):hover:not(:active){--hcms-toggle-bg:color-mix(in srgb, ${V.face}, ${V["edge-hi"]} 45%) !important}
[data-hcms-toggle-host] :is(.hcms-toggle__main, .hcms-toggle__arrow):active{border-color:${V["edge-lo"]} ${V["edge-hi"]} ${V["edge-hi"]} ${V["edge-lo"]} !important}
}`;var hn=Object.defineProperty,cr=(e,t)=>{for(var r in t)hn(e,r,{get:t[r],enumerable:!0})},il={};cr(il,{cms:()=>Pr,default:()=>Gh});var ll=["textContent","innerText","innerHTML","outerHTML","value","checked","selected","disabled","readOnly","type","tagName","nodeName","nodeType","nodeValue","childElementCount","id","className","classList","baseURI","offsetWidth","offsetHeight","clientWidth","clientHeight","scrollWidth","scrollHeight","dataset","currentSrc","duration","paused","title","documentURI","contentType"],un=new Set(ll),dn=new Set(["textContent","innerText","innerHTML","value","checked","selected","disabled","readOnly","type","id","className","title"]),ol=new Set(["tagName","nodeName","nodeType","nodeValue","childElementCount","classList","baseURI","documentURI","contentType","offsetWidth","offsetHeight","clientWidth","clientHeight","scrollWidth","scrollHeight","currentSrc","duration","paused","dataset"]),ti=new Set(["checked","selected","disabled","readOnly","paused"]);function mn(e,t){return t==null?ti.has(e)?!1:"":ti.has(e)?t==="false"?!1:!!t:t}function P(e){let t=0,r=null,i=-1;for(let l=0;l<e.length;l++){let o=e[l];o==="\\"?l++:r?o===r&&(r=null):o==='"'||o==="'"?r=o:o==="["||o==="("?t++:o==="]"||o===")"?t>0&&t--:o==="@"&&t===0&&(i=l)}return i}function pn(e){let t=P(e);return t===-1?{selector:e,prop:null}:{selector:e.slice(0,t),prop:e.slice(t+1)||null}}function nl(e){let t=0,r=null,i=-1,l=!1;for(let o=0;o<e.length;o++){let n=e[o];n==="\\"?o++:r?n===r&&(r=null):n==='"'||n==="'"?r=n:n==="["||n==="("?t++:n==="]"||n===")"?t>0&&t--:t===0&&n===">"?i=o:t===0&&n===","&&(l=!0)}return l||i===-1||!fn(e,i+1)?null:e.slice(0,i).trim()||null}function fn(e,t){let r=t,i=e.replace(/\s+$/,"").length;for(;r<i&&/\s/.test(e[r]);)r++;let l=0,o=null;for(;r<i;r++){let n=e[r];if(n==="\\")r++;else if(o)n===o&&(o=null);else if(n==='"'||n==="'")o=n;else if(n==="["||n==="(")l++;else if(n==="]"||n===")")l>0&&l--;else if(l===0&&(n==="+"||n==="~"||/\s/.test(n)))return!1}return!0}var al={};cr(al,{EmptyListInsert:()=>Me,MAX_RULE_DEPTH:()=>kt,MaxRuleDepthExceeded:()=>ur,NoRulesTag:()=>vn,RuleTargetReadOnly:()=>hl,RulesParseError:()=>hr,ShapeMismatch:()=>cl,UnknownRulesVersion:()=>sl,WriteNotRoundTripped:()=>kn,WriteRefused:()=>gn,WriteRejected:()=>yn});var hr=class extends Error{constructor(e,t){super(e),this.name="RulesParseError",this.cause=t}},sl=class extends Error{constructor(e){super(`unknown rules version: ${e}. Library supports "1".`),this.name="UnknownRulesVersion",this.version=e}},kt=20,ur=class extends Error{constructor(e){super(`rule depth exceeded ${kt} at path: ${e.join(".")}`),this.name="MaxRuleDepthExceeded",this.path=e}},cl=class extends Error{constructor(e){super(`shape mismatch: ${e.length} field(s) failed validation`),this.name="ShapeMismatch",this.mismatches=e}},Me=class extends Error{constructor(e,t){super(t?`cannot add items to empty list at "${e.join(".")}" \u2014 ${t}`:`cannot add items to empty list at "${e.join(".")}" \u2014 no sibling to clone as template. Seed the list with a hidden item first.`),this.name="EmptyListInsert",this.path=e}},hl=class extends Error{constructor(e){super(`cannot write to read-only DOM property "${e}"`),this.name="RuleTargetReadOnly",this.target=e}},gn=class extends Error{constructor(e){super(`write refused: ${e.length} write(s) broke the content-only policy`),this.name="WriteRefused",this.refusals=e}};function bn(e){return e.reduce((t,r)=>typeof r=="number"?`${t}[${r}]`:t?`${t}.${r}`:String(r),"")||"(root)"}var kn=class extends Error{constructor(e){super(`write did not round-trip at "${bn(e)}"`),this.name="WriteNotRoundTripped",this.path=e}},vn=class extends Error{constructor(e){super(`no <script data-rules-name~="${e}"> rules tag in this document`),this.name="NoRulesTag",this.token=e}},yn=class extends Error{constructor(e,t){super(`write rejected: ${e.length} unknown key(s), ${t.length} rule(s) with no matching element`),this.name="WriteRejected",this.unknownKeys=e,this.unmatched=t}},xn=/^--[A-Za-z0-9_-]+$/;function ul(e){return typeof e=="string"&&xn.test(e)}function dl(e){let t=[],r=[],i=null,l=0;for(let o=0;o<e.length;o++){let n=e[o];if(i){n==="\\"?o++:n===i&&(i=null);continue}if(n==="/"&&e[o+1]==="*"){let a=e.indexOf("*/",o+2);o=a===-1?e.length:a+1;continue}n==='"'||n==="'"?i=n:n==="("?r.push(")"):n==="["?r.push("]"):n==="{"?r.push("}"):(n===")"||n==="]"||n==="}")&&r[r.length-1]===n?r.pop():n===";"&&r.length===0&&(t.push(e.slice(l,o)),l=o+1)}return t.push(e.slice(l)),t}function wn(e){let t="",r=null;for(let i=0;i<e.length;i++){let l=e[i];if(r){t+=l,l==="\\"&&i+1<e.length?t+=e[++i]:l===r&&(r=null);continue}if(l==="/"&&e[i+1]==="*"){let o=e.indexOf("*/",i+2);i=o===-1?e.length:o+1,t+=" ";continue}(l==='"'||l==="'")&&(r=l),t+=l}return t}function ml(e){e=wn(e);let t=e.indexOf(":");if(t===-1)return null;let r=e.slice(0,t).trim(),i=e.slice(t+1).trim(),l=/!\s*important\s*$/i.exec(i);return l&&(i=i.slice(0,l.index).trim()),{name:r,value:i,important:!!l}}function pl(e,t){if(e==null)return null;let r=null;for(let i of dl(String(e))){let l=ml(i);!l||l.name!==t||(!r||l.important||!r.important)&&(r=l)}return r?r.value:null}function An(e,t,r){let i=e==null?"":String(e),l=r==null||r==="",o=dl(i),n=o.map(ml),a=n.some(f=>f&&f.name===t&&f.important),s=[],h=!1;o.forEach((f,m)=>{let u=n[m];if(!u||u.name!==t){s.push(f);return}if(l||h)return;let c=/^\s*/.exec(f)[0];s.push(`${c}${t}: ${r}${a?" !important":""}`),h=!0});let d=s.join(";");if(!l&&!h){let f=d.trimEnd();d=f===""?`${t}: ${r}`:`${f}${f.endsWith(";")?" ":"; "}${t}: ${r}`}return d.trim()===""?null:d}function _n(e,t,r,i){let l=e.attr(t,"style");if((pl(l,r)??"")===i)return;let o=An(l,r,i);o==null?e.removeAttr(t,"style"):e.attr(t,"style",o)}function Vt(e,t,r,i={}){if(Object.prototype.hasOwnProperty.call(i,"exclude")&&e.semanticExclude===!1)throw new Error("This adapter does not support semantic exclude queries; omit exclude or use the DOM adapter.");return Wt(e,t,r,{depth:0,path:[]},i)}function Wt(e,t,r,i,l){if(i.depth>kt)throw new ur(i.path);if(typeof r=="string")return En(e,t,r,i,l);if(Array.isArray(r)){let[o,n]=r,a=e.find(t,o,l);return fl(l,i,a),a.map((s,h)=>Wt(e,s,n,{depth:i.depth+1,path:[...i.path,h]},l))}if(typeof r=="object"&&r!==null){let o={};for(let[n,a]of Object.entries(r))o[n]=Wt(e,t,a,{depth:i.depth+1,path:[...i.path,n]},l);return o}return null}function En(e,t,r,i,l){if(r.endsWith("[]")){let a=r.slice(0,-2),s=e.find(t,a,l);return fl(l,i,s),s.map(h=>e.text(h))}if(r.startsWith("@"))return ri(e,t,r.slice(1));let o=P(r);if(o!==-1){let a=r.slice(0,o),s=r.slice(o+1),h=a?e.find(t,a,l):[t];return h.length===0?null:ri(e,h[0],s)}if(r===".")return e.text(t);let n=e.find(t,r,l);return n.length===0?null:e.text(n[0])}function fl(e,t,r){if(typeof e.onRowsRead=="function")try{e.onRowsRead(t.path.slice(),r)}catch(i){console.warn(`[hyper-html-api] onRowsRead threw at "${t.path.join(".")||"(root)"}"`,i)}}function ri(e,t,r){if(ul(r))return pl(e.attr(t,"style"),r);if(un.has(r)){let l=e.prop(t,r);return l==null?null:String(l)}return e.attr(t,r)??null}var dr=Object.freeze({data:Object.freeze({tokens:["no-data"],bundles:["editor-ui"]}),save:Object.freeze({tokens:["no-save"],bundles:["editor-ui"]}),snapshot:Object.freeze({tokens:["no-snapshot"],bundles:["editor-ui"]}),watch:Object.freeze({tokens:["no-watch"],bundles:["editor-ui"]}),undo:Object.freeze({tokens:["no-undo"],bundles:["editor-ui"]}),history:Object.freeze({tokens:[],bundles:["editor-ui"]})}),Sn=Object.freeze({"editor-ui":Object.freeze(["no-data","no-save","no-snapshot","no-watch","no-undo"])}),Cn=Object.freeze(["no-save","no-snapshot","no-trigger-autosave","no-dirty","no-watch","no-undo","no-data","freeze","editor-ui","live"]);function lt(e,t){if(!e||e.nodeType!==1)return!1;let r=e.getAttribute?.("clay");return!!(r&&r.split(/\s+/).includes(t)||e.hasAttribute?.(t))}function gl(e,t){if(lt(e,t))return!0;for(let[r,i]of Object.entries(Sn))if(i.includes(t)&&lt(e,r))return!0;return!1}function Gt(e){let t=dr[e];if(!t)throw new Error(`Unknown region capability: ${e}`);return[...t.tokens,...t.bundles].flatMap(r=>[`[clay~="${r}"]`,`[${r}]`]).join(", ")}function Tn(e,t){let r=e&&e.nodeType===1?e:e?.parentElement;for(;r&&r.nodeType===1;){let i=dr[t];if(!i)throw new Error(`Unknown region capability: ${t}`);if(i.tokens.some(l=>gl(r,l))||i.bundles.some(l=>lt(r,l)))return r;r=r.parentElement}return null}function Rn(e,t){return!!Tn(e,t)}var qn=/:(?:focus(?:-within|-visible)?|hover|active|visited|defined)\b/i;function $n(e,t){if(!/^(INPUT|TEXTAREA|SELECT|OPTION)$/.test(e.tagName||""))return;let r=(e.getAttribute?.("type")||"").toLowerCase();"value"in e&&"value"in t&&e.tagName!=="OPTION"&&r!=="checkbox"&&r!=="radio"&&r!=="file"&&(t.value=e.value),e.tagName==="INPUT"&&(r==="checkbox"||r==="radio")&&(t.checked=e.checked),e.tagName==="OPTION"&&(t.selected=e.selected),"indeterminate"in e&&"indeterminate"in t&&(t.indeterminate=e.indeterminate)}function ii(e,t,r,i){if(i)return!!e.closest?.(t);let l=e;for(;l?.nodeType===1;){if(l.matches(t))return!0;if(l===r)break;l=l.parentElement}return!1}function li(e,t,r,i,l,o){return(o?Rn(e,t):ii(e,r,l,!1))||!!(i&&(o&&e!==l?e.matches(i):ii(e,i,l,o)))}function On(e,t){let r=dr[t];return r.tokens.some(i=>gl(e,i))||r.bundles.some(i=>lt(e,i))}var Ln=new Set(["INPUT","TEXTAREA","SELECT","OPTION"]);function bl(e,t,r,i){if(e.nodeType===1&&i(e)){r.dropped.push(t);return}r.cloneToLive.set(t,e),r.liveToClone.set(e,t);let l=e,o=t;if(e.nodeType===1){if(Ln.has(e.tagName)&&r.controls.push(e,t),e.tagName==="TEMPLATE"){for(;t.firstChild;)t.removeChild(t.firstChild);l=e.content,o=t.content,r.cloneToLive.set(o,l),r.liveToClone.set(l,o)}}else if(e.nodeType!==11)return;let n=o.firstChild;for(let a=l.firstChild;a&&n;a=a.nextSibling)bl(a,n,r,i),n=n.nextSibling}function Ge(e,{capability:t="data",exclude:r=null,inherit:i=!0,provenance:l=null}={}){if(!e)throw new TypeError("createContentView requires a DOM context");let o=e.nodeType===9?e:e.ownerDocument;if(!o?.implementation?.createHTMLDocument)throw new TypeError("createContentView requires an HTML DOM implementation");let n=o.implementation.createHTMLDocument(""),a=l||new WeakMap,s=new WeakMap,h=e.nodeType===9?e.documentElement:e;r&&n.documentElement.matches(r);let d=Gt(t),f=i?c=>On(c,t)||!!(r&&c.matches(r)):c=>li(c,t,d,r,h,!1),m=null;if(h.nodeType!==1||!li(h,t,d,r,h,i)){m=n.importNode(h,!0);let c={cloneToLive:a,liveToClone:s,dropped:[],controls:[]};bl(h,m,c,f);for(let p of c.dropped)p.remove();for(let p=0;p<c.controls.length;p+=2)$n(c.controls[p],c.controls[p+1])}e.nodeType===9&&m&&(n.replaceChild(m,n.documentElement),s.set(e,n),a.set(n,e));let u=c=>{if(qn.test(c))throw new Error(`Filtered content queries do not support stateful selector: ${c}`)};return{root:m,document:n,capability:t,selector:Gt(t),cloneToLive:a,liveToClone:s,original(c){return a.get(c)||null},cloneOf(c){return s.get(c)||null},query(c,p=m){return u(c),Array.from(p.querySelectorAll(c),b=>a.get(b)||b)},text(c=m){return(c===m?m:s.get(c))?.textContent||""},html(c=m){return(c===m?m:s.get(c))?.innerHTML??""},clone(c=m){let p=c===m?m:s.get(c);return p?n.importNode(p,!0):null}}}function kl(e){return e&&e.nodeType===1&&e.tagName==="SCRIPT"&&e.hasAttribute&&e.hasAttribute("data-rules-name")}function jn(e){return e?(e.nodeType===9||e.nodeType,e):null}function oi(e,t,r){!e||e.nodeType!==1||(t==="value"&&e.tagName==="INPUT"?e.value=r===null?"":r:t==="checked"&&e.tagName==="INPUT"?e.checked=r!==null:t==="selected"&&e.tagName==="OPTION"&&(e.selected=r!==null))}function vl(e,t){e&&e.tagName==="TEXTAREA"&&(e.value=t)}function yl(e){if(!e||e.nodeType!==1)return;let t=[e,...e.querySelectorAll?e.querySelectorAll("textarea, input, option"):[]];for(let r of t)if(r.tagName==="TEXTAREA")r.value=r.defaultValue;else if(r.tagName==="INPUT"){let i=r.type;i!=="file"&&i!=="checkbox"&&i!=="radio"&&(r.value=r.defaultValue),r.checked=r.defaultChecked}else r.tagName==="OPTION"&&(r.selected=r.defaultSelected)}var F={semanticExclude:!0,find(e,t,r={}){let i=jn(e);if(!i||!i.querySelectorAll)return[];let l=Array.from(i.querySelectorAll(t));r.includeRulesTag||(l=l.filter(a=>!kl(a)));let o=[];r.skip&&o.push(r.skip);let n=r.templateAttr===null?null:r.templateAttr||"cms-template";if(n&&o.push("["+n+"]"),o.length){let a=o.join(", ");l=l.filter(s=>!s.closest||!s.closest(a))}return l},parent(e){return e?e.parentElement:null},children(e){return e?Array.from(e.children):[]},matches(e,t){return!!(e&&e.matches)&&e.matches(t)},text(e,t){if(t===void 0)return(e.textContent||"").trim();e.textContent=t,vl(e,t)},attr(e,t,r){if(r===void 0)return e.hasAttribute&&e.hasAttribute(t)?e.getAttribute(t):null;e.setAttribute(t,r),oi(e,t,r)},removeAttr(e,t){e&&e.removeAttribute&&e.removeAttribute(t),oi(e,t,null)},prop(e,t,r){if(r===void 0){let i=e?e[t]:void 0;return i!==void 0?i:null}e[t]=r},clone(e){let t=e.cloneNode(!0);return yl(t),t},insertAt(e,t,r){let i=e.children[r]||null;e.insertBefore(t,i)},insertBefore(e,t){e.parentNode.insertBefore(t,e)},insertAfter(e,t){e.parentNode.insertBefore(t,e.nextSibling)},identity(e){return e||null},remove(e){e&&e.parentNode&&e.parentNode.removeChild(e)},replaceWith(e,t){if(!e||!e.parentNode)throw new Error("dom.replaceWith: node has no parent");let r=e.ownerDocument.createElement("template");r.innerHTML=t;let i=r.content.firstElementChild;if(!i)throw new Error("dom.replaceWith: html did not parse to an element");return e.parentNode.replaceChild(i,e),i},stripIds(e){let t=0;return e.id&&(e.removeAttribute("id"),t++),(e.querySelectorAll?e.querySelectorAll("[id]"):[]).forEach(r=>{r.removeAttribute("id"),t++}),t},sameNode(e,t){return e===t}};function ge(e,t={}){if(t.exclude===null)return F;let r=[Gt("data"),t.exclude].filter(Boolean).join(", "),i=e.nodeType===9?e:e.ownerDocument||e,l=e.nodeType===9?e.documentElement:e;if(!t._write&&!l?.matches?.(r)&&!l?.querySelector?.(r)&&!i?.querySelector?.(r))return F;let o=e.nodeType===9||!e.isConnected?e:e.ownerDocument,n=e.nodeType===9?e:e.ownerDocument,a=null,s=()=>a||(a=Ge(o,{capability:"data",exclude:t.exclude||null})),h=c=>{let p=s();return c===e?p.cloneOf(e):p.cloneOf(c)||c},d=c=>a?.original(c)||c,f=(c,p)=>{s().liveToClone.set(c,p),s().cloneToLive.set(p,c);let b=c.childNodes||[],g=p.childNodes||[];for(let k=0;k<Math.min(b.length,g.length);k++)f(b[k],g[k])},m=(c,p,b,g)=>{let k=Array.from(c.childNodes).filter(E=>a.cloneOf(E)),y=k[0];for(;y&&k.includes(y);)y=y.nextSibling;for(let E of k)E.remove();if(b==="innerHTML"){let E=n.createElement("template");E.innerHTML=g;for(let $ of Array.from(E.content.childNodes))c.insertBefore($,y||null)}else c.insertBefore(n.createTextNode(g),y||null),vl(c,g);let _=Ge(c,{capability:"data",exclude:t.exclude||null});p.replaceChildren(...Array.from(_.root?.childNodes||[]));let A=E=>{let $=_.original(E);$&&(a.liveToClone.set($,E),a.cloneToLive.set(E,$));for(let H of Array.from(E.childNodes||[]))A(H)};for(let E of Array.from(p.childNodes))A(E)},u={...F,find(c,p,b={}){let g=h(c);if(!g?.querySelectorAll)return[];let k=s().query(p,g);b.includeRulesTag||(k=k.filter(A=>!kl(A)));let y=[];b.skip&&y.push(b.skip);let _=b.templateAttr===null?null:b.templateAttr||"cms-template";if(_&&y.push(`[${_}]`),y.length){let A=y.join(", ");k=k.filter(E=>!E.closest?.(A))}return k},parent(c){let p=h(c)?.parentElement;return p?d(p):null},children(c){return Array.from(h(c)?.children||[],d)},text(c,p){if(p===void 0){let k=d(c);return!k?.matches?.(r)&&!k?.querySelector?.(r)?F.text(k):(h(c)?.textContent||"").trim()}let b=d(c);if(!b?.matches?.(r)&&!b?.querySelector?.(r)&&!a){F.text(b,p);return}let g=s().cloneOf(b);g?m(b,g,"textContent",p):F.text(b,p)},attr(c,p,b){let g=d(c);if(b===void 0)return F.attr(g,p);F.attr(g,p,b);let k=a?.cloneOf(g);k&&(F.attr(k,p,b),Ge(g,{capability:"data",exclude:t.exclude||null}).root===null&&(k.remove(),a.liveToClone.delete(g),a.cloneToLive.delete(k)))},removeAttr(c,p){let b=d(c);F.removeAttr(b,p);let g=a?.cloneOf(b);g&&F.removeAttr(g,p)},prop(c,p,b){let g=d(c);if(b===void 0)return p==="innerHTML"||p==="outerHTML"||p==="textContent"||p==="innerText"?F.prop(h(g),p):F.prop(g,p);let k=p==="innerHTML"||p==="textContent"||p==="innerText",y=k?s().cloneOf(g):a?.cloneOf(g);y&&k?m(g,y,p,b):(F.prop(g,p,b),y&&F.prop(y,p,b))},clone(c){let p=h(c);if(p===c)return F.clone(c);let b=n.importNode(p,!0);return yl(b),b},insertAt(c,p,b){let g=d(c),k=u.children(g)[b]||(()=>{for(let A=g.children.length-1;A>=0;A--){let E=g.children[A];if(s().cloneOf(E))return E.nextElementSibling}return g.firstElementChild})(),y=d(p);g.insertBefore(y,k||null);let _=s().cloneOf(g);if(_){let A=s().cloneOf(y);A||(A=n.importNode(y,!0),f(y,A));let E=Array.from(_.children);_.insertBefore(A,E[b]||null)}},insertBefore(c,p){let b=d(c),g=d(p);b.parentNode.insertBefore(g,b);let k=s().cloneOf(b.parentNode);if(k){let y=s().cloneOf(g);y||(y=n.importNode(g,!0),f(g,y));let _=s().cloneOf(b);_?_.before(y):k.appendChild(y)}},insertAfter(c,p){let b=d(c),g=d(p);b.parentNode.insertBefore(g,b.nextSibling);let k=s().cloneOf(b.parentNode);if(k){let y=s().cloneOf(g);y||(y=n.importNode(g,!0),f(g,y));let _=s().cloneOf(b);_?_.after(y):k.appendChild(y)}},identity(c){return d(c)||null},remove(c){let p=d(c),b=s().cloneOf(p);F.remove(p),b&&F.remove(b)},replaceWith(c,p){let b=d(c),g=s().cloneOf(b),k=F.replaceWith(b,p);if(g){let y=Ge(k,{capability:"data",exclude:t.exclude||null});if(!y.root)g.remove();else{g.replaceWith(y.root);let _=A=>{let E=y.original(A);E&&(a.liveToClone.set(E,A),a.cloneToLive.set(A,E));for(let $ of Array.from(A.childNodes||[]))_($)};_(y.root)}}return k}};return u}var Ot=F;function Mn(e){try{return JSON.parse(e)}catch(t){throw new hr(`Invalid strict JSON: ${t.message}`,t)}}function xl(e){try{return JSON.parse(e)}catch{}let t={BRACE_OPEN:"{",BRACE_CLOSE:"}",BRACKET_OPEN:"[",BRACKET_CLOSE:"]",COLON:":",COMMA:",",STRING:"STRING",SELECTOR:"SELECTOR",IDENTIFIER:"IDENTIFIER",NUMBER:"NUMBER",BOOLEAN:"BOOLEAN"};function r(l){let o=[],n=0;for(;n<l.length;){let a=l[n];if(/\s/.test(a)){n++;continue}if("{}".includes(a)){o.push({type:a,value:a}),n++;continue}if(a==="["){let f=!1,m=n+1;for(;m<l.length&&/\s/.test(l[m]);)m++;if(m<l.length&&/[a-zA-Z_]/.test(l[m])&&(f=!0),!f){o.push({type:a,value:a}),n++;continue}}if(a==="]"){o.push({type:a,value:a}),n++;continue}if(a===":"){o.push({type:t.COLON,value:a}),n++;continue}if(a===","){o.push({type:t.COMMA,value:a}),n++;continue}if(a==='"'||a==="'"){let f=a,m=n+1;for(;m<l.length&&l[m]!==f;)l[m]==="\\"&&m++,m++;o.push({type:t.STRING,value:l.substring(n+1,m),quoted:!0,sourceQuote:f}),n=m+1;continue}let s=n,h;for(;s<l.length&&!/[{},]/.test(l[s]);)if(l[s]===":"){let f=[":first",":last",":nth-child",":nth-of-type",":first-child",":last-child",":first-of-type",":last-of-type",":only-child",":only-of-type",":hover",":focus",":active",":visited",":disabled",":enabled",":checked",":empty",":root",":target",":not",":before",":after",":nth-last-child",":nth-last-of-type"],m=!1;for(let u of f){let c=u.substring(1);if(l.substring(s+1,s+1+c.length)===c){m=!0,s+=c.length;break}}if(!m)break}else if(l[s]==="["){for(s++;s<l.length&&l[s]!=="]";){if(l[s]==='"'||l[s]==="'"){let f=l[s];for(s++;s<l.length&&l[s]!==f;)l[s]==="\\"&&s++,s++}s++}s<l.length&&l[s]==="]"&&s++}else s++;h=l.substring(n,s);let d=t.IDENTIFIER;/^-?\d+(\.\d+)?$/.test(h)?d=t.NUMBER:h==="true"||h==="false"||h==="null"?d=t.BOOLEAN:/^[.#@\[]|[.#@\[]| /.test(h)&&(d=t.SELECTOR),o.push({type:d,value:h,quoted:!1}),n=s}return o}function i(l){let o="";for(let n=0;n<l.length;n++){let a=l[n];if("{}".includes(a.type)||"[]".includes(a.type)){o+=a.value;continue}if(a.type===t.COLON){o+=a.value;continue}if(a.type===t.COMMA){let s=l[n+1];if(s&&(s.type==="}"||s.type==="]"))continue;o+=a.value;continue}if(a.type===t.STRING&&a.quoted){let s=a.value;a.sourceQuote==="'"&&(s=s.replace(/\\'/g,"'"),s=s.replace(/(\\*)"/g,(h,d)=>d.length%2===0?d+'\\"':h)),o+=`"${s}"`;continue}if(a.type===t.NUMBER||a.type===t.BOOLEAN){o+=a.value;continue}if(a.type===t.SELECTOR||a.type===t.IDENTIFIER){o+=`"${a.value}"`;continue}o+=`"${a.value}"`}return o}try{let l=r(e),o=i(l);return JSON.parse(o)}catch(l){throw new hr("Invalid extraction rules syntax: "+l.message,l)}}var Nn="1",ni=/^[a-zA-Z0-9_-]+$/;function wl(e,t,r){let i;if(r===void 0)i="script[data-rules-name]";else{if(typeof r!="string"||!ni.test(r))throw new Error(`hyper-html-api: invalid rules token ${JSON.stringify(r)} (must match ${ni})`);i=`script[data-rules-name~="${r}"]`}let l=e.find(t,i,{includeRulesTag:!0});if(l.length===0)return null;r!==void 0&&l.length>1&&console.warn(`hyper-html-api: ${l.length} rules tags match data-rules-name~="${r}"; using the first.`);let o=l[0],n=e.attr(o,"data-rules-version");if(n!==Nn)throw new sl(n);return{rules:xl(e.text(o)),tagNode:o}}var ru=new Function("url","return import(url)");function zn(e,t,r,i){let l=e.length,o=t.length,n=new Array(l).fill(-1);if(i){let g=new Set;for(let k=0;k<l;k++){let y=i[k];!(y>=0&&y<o)||g.has(y)||(n[k]=y,g.add(y))}}if(l===0||o===0)return n;let a=e.map(g=>ai(g,r)),s=t.map(g=>ai(g,r)),h=new Array(o).fill(!1);for(let g of n)g>=0&&(h[g]=!0);let d=new Map;s.forEach((g,k)=>{h[k]||d.set(g,d.has(g)?-1:k)});let f=new Map;a.forEach((g,k)=>{n[k]>=0||f.set(g,(f.get(g)||0)+1)}),a.forEach((g,k)=>{if(n[k]>=0||f.get(g)!==1)return;let y=d.get(g);y===void 0||y===-1||h[y]||(n[k]=y,h[y]=!0)});let m=[];for(let g=0;g<l;g++)n[g]<0&&m.push(g);let u=[];for(let g=0;g<o;g++)h[g]||u.push(g);if(m.length===0||u.length===0)return n;let c=l*o+1,p=Fn(e,t,r),b=(g,k)=>p(g,k)*c+Math.abs(g-k);for(let[g,k]of Dn(m,u,b))n[g]=k;return n}var Al=e=>typeof e=="object"&&e!==null;function ai(e,t){if(!Al(t))return e==null?" null":String(e);let r=Object.keys(t);return JSON.stringify(r.map(i=>{let l=JSON.stringify(e?.[i]);return l===void 0?" undef":l}))}function Fn(e,t,r){if(!Al(r))return(a,s)=>e[a]===t[s]?0:1;let i=Object.keys(r),l=a=>i.map(s=>JSON.stringify(a?.[s])),o=e.map(l),n=t.map(l);return(a,s)=>{let h=o[a],d=n[s],f=0;for(let m=0;m<i.length;m++)h[m]!==d[m]&&f++;return f}}function Dn(e,t,r){return e.length<=t.length?si(e,t,r,!1):si(t,e,(i,l)=>r(l,i),!0)}function si(e,t,r,i){let l=e.length,o=t.length,n=[];for(let f=0;f<=l;f++)n.push(new Float64Array(o+1).fill(1/0));let a=[];for(let f=0;f<=l;f++)a.push(new Uint8Array(o+1));for(let f=0;f<=o;f++)n[l][f]=0;for(let f=l-1;f>=0;f--)for(let m=o-1;m>=0;m--){let u=r(e[f],t[m])+n[f+1][m+1],c=n[f][m+1];u<=c?(n[f][m]=u,a[f][m]=1):n[f][m]=c}let s=[],h=0,d=0;for(;h<l&&d<o;)a[h][d]&&(s.push(i?[t[d],e[h]]:[e[h],t[d]]),h++),d++;return s}function _l(e,t,r,i,l,o,n,a={}){let s=e.find(t,r,a);if(l.length===0){s.forEach(_=>e.remove(_)),Jt(a,"onRowsApplied",o.path,[]);return}let h=l.length>s.length,d=s[0]||null;if(h&&!d&&(d=Hn(e,t,r,a),!d))throw new Me(o.path);let f=s.map(_=>Pn(e,_,i,a)),m=null;if(h&&d){m=e.clone(d),a.templateAttr&&e.removeAttr(m,a.templateAttr);let _=e.stripIds(m);_>0&&console.warn(`[hyper-html-api] stripped ${_} id attribute(s) from cloned template at "${o.path.join(".")||"(root)"}"`)}let u=zn(l,f,i,Bn(e,s,l,o,a)),c=s.length>0?e.parent(s[0]):Gn(e,t,r,d,o,a),p=s.length>0?El(e,c,s[0]):0,b=Kn(e,s),g=new Set,k=[],y=l.map((_,A)=>{let E=u[A];if(E>=0)return g.add(E),k.push(!1),s[E];k.push(!0);let $=e.clone(m);return e.stripIds($),$});s.forEach((_,A)=>{g.has(A)||e.remove(_)}),b?Xn(e,c,p,y,k):Zn(e,y,k,c,p),In(e,y,i,l,o,n,a),Jt(a,"onRowsApplied",o.path,y)}function Jt(e,t,r,i){if(typeof e[t]=="function")try{return e[t](r.slice(),i)}catch(l){console.warn(`[hyper-html-api] ${t} threw at "${r.join(".")||"(root)"}"`,l);return}}function Bn(e,t,r,i,l){let o=Jt(l,"identifyRows",i.path,r);if(!Array.isArray(o))return null;let n=new Array(r.length).fill(-1),a=new Set,s=new Map(t.map((h,d)=>[e.identity(h),d]));for(let h=0;h<r.length;h++){if(!o[h])continue;let d=s.get(e.identity(o[h]));d===void 0||a.has(d)||(n[h]=d,a.add(d))}return n}function In(e,t,r,i,l,o,n){t.forEach((a,s)=>{if(r===null){let h=i[s],d=h==null?"":String(h);e.text(a)!==d&&e.text(a,d)}else{let h=o(e,a,r,i[s],{depth:l.depth+1,path:[...l.path,s]},n);h&&h!==a&&(t[s]=h)}})}function Pn(e,t,r,i){return r===null?e.text(t):Vt(e,t,r,i.onRowsRead?{...i,onRowsRead:void 0}:i)}function El(e,t,r){let i=e.children(t);for(let l=0;l<i.length;l++)if(e.sameNode(i[l],r))return l;return-1}function Hn(e,t,r,i){if(!i.templateAttr)return null;let l=/^\s*:scope\s*>\s*/.test(r),o=new RegExp(":not\\(\\["+i.templateAttr.replace(/[.*+?^${}()|[\]\\-]/g,"\\$&")+"\\]\\)","g"),n=r.replace(/^\s*:scope\s*>\s*/,"").replace(o,""),a=l?Un(n):0,s=nl(n),h=t;for(;h;){let d=e.find(h,n,{includeRulesTag:!1,templateAttr:null});for(let f of d)if(e.attr(f,i.templateAttr)!=null&&!(l&&!Wn(e,t,f,a))&&!(s&&!e.matches(e.parent(f),s)))return f;h=e.parent(h)}return null}function Un(e){let t=0,r=null,i=1;for(let l=0;l<e.length;l++){let o=e[l];if(o==="\\")l++;else if(r)o===r&&(r=null);else if(o==='"'||o==="'")r=o;else if(o==="["||o==="(")t++;else if(o==="]"||o===")")t>0&&t--;else if(t===0&&o===">")i++;else{if(t===0&&(o==="+"||o==="~"))return null;if(t===0&&/\s/.test(o)){if(!Vn(e,l))return null;for(;l+1<e.length&&/\s/.test(e[l+1]);)l++}}}return i}function Vn(e,t){let r=t;for(;r<e.length&&/\s/.test(e[r]);)r++;let i=t>0?e[t-1]:"",l=r<e.length?e[r]:"";return ci(i)||ci(l)}function ci(e){return e===">"||e==="+"||e==="~"}function Wn(e,t,r,i){if(i===null)return!0;let l=r;for(let s=0;s<i;s++)if(l=e.parent(l),!l)return!1;let o=e.prop(t,"tagName");if(!o)return!0;let n=e.prop(l,"tagName");if(!n||String(n).toLowerCase()!==String(o).toLowerCase())return!1;let a=new Set(hi(e,l));return hi(e,t).every(s=>a.has(s))}function hi(e,t){let r=e.attr(t,"class");return r?String(r).split(/\s+/).filter(Boolean):[]}function Gn(e,t,r,i,l,o){let n=e.parent(i);if(n&&Jn(e,t,n)&&!di(e,n,o))return n;let a=nl(r);if(!a)throw new Me(l.path,`the list selector "${r}" names no container to hold the new rows \u2014 write it as "container > row" (for example "ol.comments > li") so the cloned row lands in the list`);let s=(a===":scope"?e.prop(t,"tagName")?[t]:[]:e.find(t,a,o)).filter(h=>!di(e,h,o));if(s.length===0)throw new Me(l.path,`no container matching "${a}" inside this context to hold the new rows`);if(s.length>1)throw new Me(l.path,`"${a}" matches ${s.length} containers inside this context, so the new rows have no single destination`);return s[0]}function Jn(e,t,r){let i=r;for(;i;){if(e.sameNode(i,t))return!0;i=e.parent(i)}return e.parent(t)?!1:e.find(t,"*",{includeRulesTag:!0,templateAttr:null}).some(l=>e.sameNode(l,r))}var ui=["no-data","editor-ui"];function di(e,t,r){let i=t;for(;i;){if(r.templateAttr&&e.attr(i,r.templateAttr)!=null||ui.some(o=>e.attr(i,o)!=null))return!0;let l=e.attr(i,"clay");if(l&&l.split(/\s+/).some(o=>ui.includes(o)))return!0;i=e.parent(i)}return!1}function Xn(e,t,r,i,l){let o=e.children(t),n=o.map(s=>e.identity(s)),a=!1;i.forEach((s,h)=>{let d=e.identity(s),f=r+h;if(n[f]===d)return;if(!l[h]){let u=n.indexOf(d);u!==-1&&(n.splice(u,1),o.splice(u,1))}let m=Math.min(f,o.length);m<o.length?e.insertBefore(o[m],s):o.length?a?e.insertAfter(o[o.length-1],s):(e.insertAt(t,s,f),a=!0):e.insertAt(t,s,0),n.splice(m,0,d),o.splice(m,0,s)})}function Kn(e,t){if(t.length<=1)return!0;let r=e.parent(t[0]);if(!r)return!1;let i=new Map(e.children(r).map((o,n)=>[e.identity(o),n])),l=[];for(let o of t){let n=i.get(e.identity(o));if(n===void 0)return!1;l.push(n)}return l.sort((o,n)=>o-n),l[l.length-1]-l[0]===l.length-1}function Zn(e,t,r,i,l){let o=null,n=l;for(let a=0;a<t.length;a++){if(!r[a]){o=t[a];continue}let s=o?e.parent(o):i;if(!s)continue;let h=o?El(e,s,o)+1:n++;e.insertAt(s,t[a],h),o=t[a]}}function mi(e,t,r,i,l={}){if(Object.prototype.hasOwnProperty.call(l,"exclude")&&e.semanticExclude===!1)throw new Error("This adapter does not support semantic exclude queries; omit exclude or use the DOM adapter.");let o=[];if(Xt(r,i,[],o),o.length)throw new cl(o);ot(e,t,r,i,{depth:0,path:[]},l)}function ot(e,t,r,i,l,o={}){if(l.depth>kt)throw new ur(l.path);if(i===void 0)return t;if(typeof r=="string")return Qn(e,t,r,i,l,o);if(Array.isArray(r)){let[n,a]=r;return _l(e,t,n,a,i,l,ot,o),t}if(typeof r=="object"&&r!==null){for(let[n,a]of Object.entries(r)){let s=ot(e,t,a,i==null?i:i[n],{depth:l.depth+1,path:[...l.path,n]},o);s&&s!==t&&(t=s)}return t}return t}function Qn(e,t,r,i,l,o){if(r.endsWith("[]")){let s=r.slice(0,-2);return _l(e,t,s,null,i,l,ot,o),t}if(r.startsWith("@"))return fi(e,t,r.slice(1),i);let n=P(r);if(n!==-1){let s=r.slice(0,n),h=r.slice(n+1),d=s?e.find(t,s,o):[t];return d.length===0||fi(e,d[0],h,i),t}if(r===".")return pi(e,t,i),t;let a=e.find(t,r,o);return a.length===0||pi(e,a[0],i),t}function pi(e,t,r){let i=r==null?"":String(r);e.text(t)!==i&&e.text(t,i)}function Yn(e,t,r,i){if(e.styleVar){e.styleVar(t,r,i);return}_n(e,t,r,i)}function fi(e,t,r,i){if(ul(r))return Yn(e,t,r,i==null?"":String(i).trim()),t;if(ol.has(r)){let l=e.prop(t,r);if(l===i||l!=null&&i!=null&&String(l)===String(i))return t;throw new hl(r)}if(r==="outerHTML"){let l=i==null?"":String(i);return e.replaceWith(t,l)}if(dn.has(r)){let l=mn(r,i);return e.prop(t,r)!==l&&e.prop(t,r,l),t}if(i==null)e.attr(t,r)!=null&&e.removeAttr(t,r);else{let l=String(i);e.attr(t,r)!==l&&e.attr(t,r,l)}return t}function Xt(e,t,r,i){if(t!==void 0){if(typeof e=="string"){if(e.endsWith("[]")){Array.isArray(t)?t.forEach((l,o)=>{typeof l=="object"&&l!==null&&i.push({path:Oe([...r,o]),expected:"scalar",got:$e(l)})}):i.push({path:Oe(r),expected:"array",got:$e(t)});return}t!==null&&typeof t=="object"&&i.push({path:Oe(r),expected:"scalar",got:$e(t)});return}if(Array.isArray(e)){if(!Array.isArray(t)){i.push({path:Oe(r),expected:"array",got:$e(t)});return}let l=e[1];t.forEach((o,n)=>Xt(l,o,[...r,n],i));return}if(typeof e=="object"&&e!==null){if(t===null||Array.isArray(t)||typeof t!="object"){i.push({path:Oe(r),expected:"object",got:$e(t)});return}for(let[l,o]of Object.entries(e))Xt(o,t[l],[...r,l],i)}}}function $e(e){return e===null?"null":Array.isArray(e)?"array":typeof e}function Oe(e){return e.join(".")}var ea=Object.freeze({refusedRuleForms:["innerHTML","outerHTML"],refusedTargets:["script","style","template","noscript","iframe","object","embed","xmp","plaintext","noembed","noframes","meta","link","base","animate","set","animatemotion","animatetransform"],refusedAttributes:["style","srcdoc","is","http-equiv","sandbox","allow","nonce","integrity","charset","htmlclaytoken","htmlclayid","data-rules-name","data-rules-version","clay","contenteditable",...Cn],refusedAttributePrefixes:["on"],urlAttributes:["href","src","srcset","action","formaction","poster","cite","data","ping","background","longdesc","usemap","xlink:href","manifest","codebase","icon"],refusedSchemes:["javascript","vbscript","data"],customPropertyValues:Object.freeze({maxLength:200,refusedCharacters:[";","{","}","<",">","\\"],refusedFunctions:["url","src","image","image-set","-webkit-image-set","cross-fade","element","expression","paint"]})});function ta(e){if(/[\u0000-\u001f\u007f]/.test(e))return"control characters are not allowed in a custom property value";let t=[],r=null;for(let i=0;i<e.length;i++){let l=e[i];if(r){l===r&&(r=null);continue}if(l==='"'||l==="'")r=l;else{if(l==="/"&&e[i+1]==="*")return"comments are not allowed in a custom property value";if(l==="(")t.push(")");else if(l==="[")t.push("]");else if((l===")"||l==="]")&&t.pop()!==l)return`"${l}" does not close anything in this custom property value`}}return r?"a custom property value must close its quotes":t.length?"a custom property value must close its brackets":null}function ra(e,t=ea){let r=t.customPropertyValues,i=String(e);if(i.length>r.maxLength)return`custom property values are limited to ${r.maxLength} characters`;let l=r.refusedCharacters.find(s=>i.includes(s));if(l)return`${JSON.stringify(l)} is not allowed in a custom property value`;let o=ta(i);if(o)return o;let n=i.toLowerCase(),a=r.refusedFunctions.find(s=>new RegExp(`(^|[^a-z0-9_-])${s.replace(/[-]/g,"\\-")}\\s*\\(`).test(n));return a?`"${a}()" is not allowed in a custom property value`:null}function gi(e,t,r){if(r&&typeof r=="object")return{rules:r,tagNode:null};if(typeof r=="string"){let i=t&&t.ownerDocument?t.ownerDocument:t;return wl(e,i,r)}return null}var G={extract:(e,t,r={})=>Vt(ge(e,r),e,t,r),apply:(e,t,r,i={})=>mi(ge(e,{...i,_write:!0}),e,t,r,i),findRulesIn:(e,t)=>wl(Ot,e,t),findRules:(e,t)=>gi(Ot,e,t),bind:(e,t,r={})=>{let i=gi(Ot,e,t);if(!i){let l=typeof t=="string"?`data-rules-name~="${t}"`:"the provided rules object";throw new Error(`hyper-html-api: could not resolve rules for ${l}`)}return{...i,get:()=>Vt(ge(e,r),e,i.rules,r),set:l=>mi(ge(e,{...r,_write:!0}),e,i.rules,l,r)}},parseStrict:Mn,parseRelaxed:xl,ruleAttrIndex:P,splitRule:pn,errors:al,DOM_PROPERTIES:ll},Sl={};cr(Sl,{fromString:()=>ve,getRuleAtPath:()=>Be,getValueAtPath:()=>la,setAtPath:()=>Kt,toString:()=>ia});function ia(e){return e.map(String).join(".")}function ve(e){return e===""?[]:e.split(".").map(t=>/^\d+$/.test(t)?Number(t):t)}function Be(e,t){let r=e;for(let i of t){if(r==null)return;if(typeof r=="string"){if(r.endsWith("[]")&&(typeof i=="number"||i==="*")){r=r.slice(0,-2);continue}return}if(Array.isArray(r)){if(typeof i!="number"&&i!=="*")return;r=r[1];continue}if(typeof r=="object"){if(typeof i=="number"||!(i in r))return;r=r[i];continue}return}return r}function la(e,t){let r=e;for(let i of t){if(r==null)return;r=r[i]}return r}function Kt(e,t,r){if(t.length===0)return r;let[i,...l]=t;if(typeof i=="number"){let o=Array.isArray(e)?[...e]:[];return o[i]=Kt(o[i],l,r),o}return{...e&&typeof e=="object"?e:{},[i]:Kt((e||{})[i],l,r)}}function mr(e){if(typeof e=="string")return e.endsWith("[]")?[]:"";if(Array.isArray(e))return[];if(typeof e=="object"&&e!==null){let t={};for(let[r,i]of Object.entries(e))t[r]=mr(i);return t}return""}function Cl(e,t,{ignoreActiveValue:r=!0}={}){Zr.morph(e,t,{morphStyle:"innerHTML",ignoreActiveValue:r,restoreFocus:!0,formStateSync:"property",policy:"raw"})}var Tl=new WeakMap,Zt=e=>e.map(String).join(".");function oa(e){return typeof CSS<"u"&&CSS.escape?CSS.escape(e):String(e).replace(/[^a-zA-Z0-9_\-.*]/g,t=>"\\"+t)}function Rl(e,t){if(!e||!e.querySelector)return null;let r=e.querySelector(`[data-hcms-path="${oa(t)}"]`),i=r&&r.querySelector(".hcms-array-items");return i?Array.from(i.children).filter(l=>l.matches&&l.matches("[data-hcms-card], [data-hcms-array-item]")):null}function ql(e,t,r){let i=Rl(e,t);!i||i.length!==r.length||i.forEach((l,o)=>{r[o]&&Tl.set(l,r[o])})}function $l(){let e=new Map;return{hooks:{onRowsRead(t,r){e.set(Zt(t),r)}},seed(t){for(let[r,i]of e)ql(t,r,i);e.clear()}}}function na(e){return{identifyRows(t,r){let i=Rl(e,Zt(t));return!i||i.length!==r.length?null:i.map(l=>Tl.get(l)||null)},onRowsApplied(t,r){ql(e,Zt(t),r)}}}function se(e){return e&&e.nodeType===9?e.body||e.documentElement:e}function Ol(e,t){if(!t||t.nodeType!==9)return e;return r(e);function r(i){if(typeof i=="string")return i==="."?"body":i.startsWith("@")?`body${i}`:i;if(Array.isArray(i)||!i||typeof i!="object")return i;let l={};for(let[o,n]of Object.entries(i))l[o]=r(n);return l}}var bi={skip:"[data-hcms-shell]",templateAttr:"cms-template"},Qt="data-hcms-rollback-ui",aa=0;function sa(e,t,r,i={}){return ca(e,t,r,i)}function ca(e,t,r,i){let{shellRoot:l,structural:o,structuralPath:n,formRoot:a}=i,s=a?{...bi,...na(a)}:bi;if(!o)try{return G.apply(e,t,r,s),{ok:!0}}catch(m){return{ok:!1,error:m}}let h=ha(e,t,n),d=h?da(h):null,f=h?null:pa(se(e),l);try{return G.apply(e,t,r,s),{ok:!0}}catch(m){return d?ma(h,d):f&&fa(se(e),l,f),{ok:!1,error:m}}}function ha(e,t,r){if(!r||!e)return null;let i=ve(r),l=[],o=t;for(let n of i){if(typeof o=="string"||o==null||Array.isArray(o))break;if(typeof o=="object"&&n in o){if(l.push(n),o=o[n],Array.isArray(o)||typeof o=="string"&&o.endsWith("[]"))break}else return null}return!Array.isArray(o)&&!(typeof o=="string"&&o.endsWith("[]"))?null:ua(e,t,l)}function ua(e,t,r){if(r.length===0)return null;let i=e,l=t;for(let o=0;o<r.length;o++){let n=r[o];if(!l||typeof l!="object"||Array.isArray(l))return null;let a=l[n];if(a==null)return null;if(o===r.length-1){if(Array.isArray(a)){let[s]=a;return i.querySelector?.(s)?.parentElement||null}if(typeof a=="string"&&a.endsWith("[]")){let s=a.slice(0,-2);return i.querySelector?.(s)?.parentElement||null}return null}l=a}return null}function da(e){let t=[],r=[];for(let i of Array.from(e.childNodes))t.push(pr(i,r));return{nodes:t,retained:r}}function ma(e,t){let r=e.cloneNode(!1);for(let i of t.nodes)r.appendChild(i);qe(e,Array.from(r.childNodes),jl()),Ll(e,t.retained)}function pa(e,t){let r=[],i=[];for(let l of Array.from(e.childNodes))l===t||t&&l.contains?.(t)||r.push(pr(l,i));return{nodes:r,retained:i}}function fa(e,t,r){let i=e.cloneNode(!1);for(let l of r.nodes)i.appendChild(l);qe(e,Array.from(i.childNodes),jl()),Ll(e,r.retained)}function pr(e,t){let r=e.cloneNode(!1);if(e.nodeType===1&&e.matches('[editor-ui],[clay~="editor-ui"]')){let o=String(++aa);r.setAttribute(Qt,o),t.push({id:o,node:e})}let i=e.nodeType===1&&e.tagName==="TEMPLATE"?e.content:e,l=r.nodeType===1&&r.tagName==="TEMPLATE"?r.content:r;for(let o of Array.from(i.childNodes||[]))l.appendChild(pr(o,t));return r}function Ll(e,t){for(let{id:r,node:i}of t){let l=e.querySelector(`[${Qt}="${r}"]`);l===i?i.removeAttribute(Qt):i.isConnected?l?.remove():l?.replaceWith(i)}}function jl(){return{morphStyle:"innerHTML",policy:"raw",restoreFocus:!1,scripts:{handle:!1,merge:!1}}}var ga=/^--font-(size|weight|style|stretch|variant|feature-settings|variation-settings|optical-sizing|kerning|synthesis|smoothing|palette|size-adjust|display)(-|$)/;function Ie(e){return e.replace(/([a-z])([A-Z])/g,"$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g,"$1 $2").replace(/[-_]/g," ").replace(/\s+/g," ").trim().replace(/^./,t=>t.toUpperCase())}var ba='<div class="hcms-drag-handle mirk-sortable__grip" aria-hidden="true"><div class="mirk-sortable__dots"><span class="mirk-sortable__dot"></span><span class="mirk-sortable__dot"></span><span class="mirk-sortable__dot"></span><span class="mirk-sortable__dot"></span><span class="mirk-sortable__dot"></span><span class="mirk-sortable__dot"></span><span class="mirk-sortable__dot"></span><span class="mirk-sortable__dot"></span></div></div>',Je='<svg class="hcms-x" viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true"><path d="M4 4 L12 12 M12 4 L4 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square"></path></svg>',Ml={"@scalar":`
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
      ${ba}
      <div class="hcms-card-body mirk-sortable__body">
        <div class="hcms-card-fields"></div>
        <div class="hcms-card-controls">
          <button type="button" class="hcms-move hcms-move-up hcms-sr-only" data-hcms-action="move-up" aria-label="Move up">\u2191</button>
          <button type="button" class="hcms-move hcms-move-down hcms-sr-only" data-hcms-action="move-down" aria-label="Move down">\u2193</button>
          <button type="button" class="hcms-remove hcms-remove--card" data-hcms-action="remove" aria-label="Remove">${Je}</button>
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
        <button type="button" class="hcms-upload-clear" data-hcms-action="clear-upload" aria-label="Remove file">${Je}</button>
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
          <button type="button" class="hcms-upload-clear hcms-upload-clear--badge" data-hcms-action="clear-upload" aria-label="Remove image">${Je}</button>
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
        <button type="button" class="hcms-color-clear" data-hcms-action="color-clear" aria-label="Clear color">${Je}</button>
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
  `},ka=["@scalar","@object","@scalar-array","@scalar-array-item","@object-array","@object-array-item"];function Nl(e){let t=e.head||e.documentElement;if(t)for(let r of ka)Il(e,t,r)}function Lt(e,t){if(!Ml[t])return null;let r=e&&(e.head||e.documentElement);return r?Il(e,r,t):null}var ki={src:"@image",checked:"@checkbox",innerHTML:"@richtext"},nt={image:"@image",file:"@file",checkbox:"@checkbox",toggle:"@toggle",select:"@select",radio:"@radio",textarea:"@textarea",number:"@number",richtext:"@richtext",color:"@color",font:"@font",variant:"@variant"},va=new Set([...Object.values(nt),"@chips","@chips-item"]);function He(e,t,r,i){if(typeof e!="string")return"@scalar";let l=P(e),o=Dl(e,l,r,i),n=vt(e,l,r,i,t,"data-hcms-component");if(n&&nt[n]){let a=nt[n],s=Array.isArray(r)&&r.some(h=>h==="*"||typeof h=="number");return a==="@number"&&!vi(e,l,t,s,o).every(_a)||(a==="@checkbox"||a==="@toggle")&&(l<0||e.slice(l+1)!=="checked")&&!vi(e,l,t,s,o).every(Ea)?"@scalar":a}if(l>=0){let a=e.slice(l+1);if(ki[a])return ki[a];if(/^--color(-|$)/.test(a)&&a!=="--color-scheme")return"@color";if(/^--font(-|$)/.test(a)&&!ga.test(a))return"@font"}return"@scalar"}function ya(e,t,r,i){if(typeof e!="string")return null;let l=P(e),o=vt(e,l,r,i,t,"data-hcms-component");return o&&nt[o]||null}var xa=new Set(["@color","@font","@variant"]),wa=new Set(["html","body",":root"]);function fr(e,t,r,i){if(typeof e!="string"||e.endsWith("[]")||!xa.has(He(e,t,r,i)))return null;let l=Array.isArray(r)&&r.some(n=>n==="*"||typeof n=="number"),o=Fl(e,P(e)).trim();return!l&&wa.has(o)?"page":"section"}var Aa=/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;function _a(e){return e==null||e===""?!0:Aa.test(String(e))}function Ea(e){return e==null||e===""||e==="true"||e==="false"}function vi(e,t,r,i,l){if(!r||!r.querySelectorAll)return[];if(!l||l===".")return[];let o=null;try{o=r.querySelectorAll(l)}catch{return[]}let n=t>=0?e.slice(t+1):null,a=[];for(let s of o)if(!(s.closest&&s.closest("[cms-template], [data-hcms-shell]"))&&(n?n==="value"&&"value"in s?a.push(s.value):a.push(s.getAttribute?s.getAttribute(n):null):a.push((s.textContent||"").trim()),!i))break;return a}function gr(e,t){if(typeof e!="string"||!e.endsWith("[]")||!t||!t.querySelector)return null;let r=e.slice(0,-2).trim();if(!r)return null;let i=null;try{i=t.querySelector(r)}catch{return null}let l=i&&i.closest?i.closest("[data-hcms-component]"):null;return(l&&l.getAttribute?l.getAttribute("data-hcms-component"):null)==="chips"?{array:"@chips",item:"@chips-item"}:null}function Ae(e,t,r){let i=e.join("."),l=e.map(o=>typeof o=="number"?"*":o).join(".");return i&&ee(r,i)||l&&l!==i&&ee(r,l)||ee(r,t)}function zl(e,t,r){let i=gr(e,r);if(!i)return null;let l=Ae(t,i.array,r);return l&&l.getAttribute("data-hcms-tpl")===i.array?i:null}function Qe(e,t,r,i){if(typeof e!="string")return null;let l=P(e),o=vt(e,l,r,i,t,"data-hcms-options");if(o==null)return null;let n=o.trim().split(/\s+/).filter(Boolean);return n.length?n:null}function Sa(e,t,r,i){if(typeof e!="string")return null;let l=P(e);return vt(e,l,r,i,t,"data-hcms-crop")}function Fl(e,t){return t>=0?e.slice(0,t):e}function Dl(e,t,r,i){let l=Fl(e,t);return l&&l!=="."?l:Ca(i,r)}function Ca(e,t){if(e==null||!Array.isArray(t))return"";let r=[],i=e;for(let l of t){if(i==null||typeof i=="string")break;if(Array.isArray(i)){if(typeof i[0]!="string"||l!=="*"&&typeof l!="number")return"";r.push(i[0]),i=i[1];continue}if(typeof i!="object"||!Object.prototype.hasOwnProperty.call(i,l))return"";i=i[l]}return r.join(" ")}function yi(e,t,r){if(!t||!t.querySelector||!e||e===".")return null;let i=null;try{i=t.querySelector(e)}catch{return null}return i&&i.getAttribute?i.getAttribute(r):null}function vt(e,t,r,i,l,o){let n=Dl(e,t,r,i),a=t>=0?e.slice(t+1):null;if(a){let s=yi(n,l,`${o}:${a}`);if(s!=null)return s;if(a.startsWith("--"))return null}return yi(n,l,o)}function Bl(e,t){if(!e||t==null)return;r(t,[]);function r(i,l){let o=Pe(i);if(o==="scalar"){let n=He(i,e,l,t);va.has(n)&&Lt(e,n);return}if(o==="scalar-array"){let n=gr(i,e);n&&(Lt(e,n.array),Lt(e,n.item));return}if(o==="object"){for(let[n,a]of Object.entries(i))r(a,[...l,n]);return}if(o==="object-array"){let n=i[1],a=[...l,"*"];if(n&&typeof n=="object"&&!Array.isArray(n))for(let[s,h]of Object.entries(n))r(h,[...a,s]);else r(n,a)}}}function Il(e,t,r){let i=ee(e,r);if(i)return i;let l=e.createElement("template");return l.setAttribute("data-hcms-tpl",r),l.setAttribute("save-remove",""),l.innerHTML=Ml[r].trim(),t.appendChild(l),l}function ee(e,t){return!e||!e.querySelector?null:e.querySelector(`template[data-hcms-tpl="${Ta(t)}"]`)}function Ta(e){return typeof CSS<"u"&&CSS.escape?CSS.escape(e):String(e).replace(/[^a-zA-Z0-9_\-.*]/g,t=>"\\"+t)}function Pe(e){return typeof e=="string"?e.endsWith("[]")?"scalar-array":"scalar":Array.isArray(e)?"object-array":typeof e=="object"&&e!==null?"object":"scalar"}function yt(e){return e?!!(e.content||e).querySelector("[data-hcms-field]"):!1}var xi={IMG:"src",A:"href"};function br(e){return e.map(t=>typeof t=="number"||/^[0-9]+$/.test(String(t))?"*":String(t)).join(".")}function kr(e){if(!e)return"value";let t=(e.tagName||"").toUpperCase();return t==="INPUT"?(e.getAttribute("type")||"text").toLowerCase()==="checkbox"?"checked":"value":t==="TEXTAREA"||t==="SELECT"?"value":xi[t]?xi[t]:e.hasAttribute&&e.hasAttribute("contenteditable")?"innerHTML":null}function wi(e,t){let r=(e.tagName||"").toUpperCase(),i=(e.getAttribute&&e.getAttribute("type")||"").toLowerCase(),l=kr(e),o=`${Pl(r,i)}[data-hcms-field="${ae(t)}"]`;return r==="INPUT"&&i==="radio"?`${o}:checked@value`:l?`${o}@${l}`:o}function Ra(e){let t=(e.tagName||"").toUpperCase(),r=(e.getAttribute&&e.getAttribute("type")||"").toLowerCase(),i=kr(e),l=`${Pl(t,r)}[data-hcms-field]`;return t==="INPUT"&&r==="radio"?`${l}:checked@value`:i?`${l}@${i}`:l}function Pl(e,t){return e==="INPUT"?t?`input[type="${t}"]`:"input":e==="TEXTAREA"?"textarea":e==="SELECT"?"select":e==="IMG"?"img":e==="A"?"a":':not([data-hcms-shape="scalar"]):not([data-hcms-shape="object"]):not([data-hcms-shape="object-array"]):not([data-hcms-shape="scalar-array"])'}function ae(e){return typeof CSS<"u"&&CSS.escape?CSS.escape(e):String(e).replace(/[^a-zA-Z0-9_\-.*]/g,t=>"\\"+t)}var Ai=new Set(["__proto__","constructor","prototype"]);function qa(e){let t=new Map;return r(e,null),t;function r(i,l){if(typeof i=="string"){typeof l=="string"&&!i.endsWith("[]")&&t.set(l,(t.get(l)||0)+1);return}if(Array.isArray(i)){r(i[1],null);return}if(i&&typeof i=="object")for(let[o,n]of Object.entries(i))r(n,o)}}function Hl(e,t){let r=qa(e);return i(e,[]);function i(f,m){let u=Pe(f);if(u==="scalar")return l(f,m);if(u==="scalar-array")return n(f,m);if(u==="object-array")return a(f,m);if(u==="object"){let c=Object.create(null);for(let[p,b]of Object.entries(f)){if(Ai.has(p))throw new Error(`hypercms: rule key "${p}" is forbidden at "${m.join(".")||"<root>"}"`);c[p]=i(b,[...m,p])}return c}return null}function l(f,m){let u=m.length?m[m.length-1]:null,c=typeof u=="string"?u:"__value",p=d(m,c);if(p)return o(m,c,wi(p,c));let b=h(He(f,t,m,e),c);return b?o(m,c,wi(b,c)):o(m,c,`input[data-hcms-field="${ae(c)}"]@value`)}function o(f,m,u){if((r.get(m)||0)<2)return u;let c=`[data-hcms-path-shape="${ae(br(f))}"]`,p=u.lastIndexOf("@"),b=p===-1?u:u.slice(0,p),g=p===-1?"":u.slice(p);return`${c} ${b}, ${b}${c}${g}`}function n(f,m){let u=zl(f,m,t),c=u&&h(u.item,null)||h("@scalar-array-item",null),p=c?Ra(c):"input[data-hcms-field]@value";return[s(m,"[data-hcms-array-item]"),p]}function a(f,m){let[,u]=f,c=[...m,"*"],p=s(m,"[data-hcms-card]");if(u&&typeof u=="object"&&!Array.isArray(u)){let b=Object.create(null);for(let[g,k]of Object.entries(u)){if(Ai.has(g))throw new Error(`hypercms: rule key "${g}" is forbidden at "${c.join(".")}"`);b[g]=i(k,[...c,g])}return[p,b]}return[p,i(u,[...c,0])]}function s(f,m){let u=f.length?f[f.length-1]:"",c=f.some(b=>b==="*"),p=f.join(".");return`${c?`[data-hcms-field="${ae(u)}"]`:`[data-hcms-path="${ae(p)}"]`} > .hcms-array-items > ${m}`}function h(f,m){if(!t)return null;let u=ee(t,f);if(!u)return null;let c=u.content||u;if(m){let p=c.querySelector(`[data-hcms-field="${ae(m)}"]`);if(p)return p}return c.querySelector("[data-hcms-field]")}function d(f,m){if(!t)return null;let u=f.map(p=>typeof p=="number"?"*":p).join("."),c=[f.join("."),u];for(let p=f.length-1;p>=0;p--){let b=f.slice(0,p).map(g=>typeof g=="number"?"*":g);Pe(Be(e,b))==="object"&&c.push(b.join(".")),b.push("*"),c.push(b.join("."))}for(let p of c){if(!p)continue;let b=ee(t,p);if(!b||!yt(b))continue;let g=b.content||b,k=g.querySelector(`[data-hcms-field="${ae(m)}"]`)||g.querySelector("[data-hcms-field]");if(k)return k}return null}}var $a=["50","100","200","300","400","500","600","700","800","900","950"],Oa=["red","orange","amber","yellow","lime","green","emerald","teal","cyan","sky","blue","indigo","violet","purple","fuchsia","pink","rose","slate","gray","zinc","neutral","stone","mauve","olive","mist","taupe"],Ne=Object.freeze([{id:"red-50",hue:"red",shade:"50",value:"oklch(97.1% 0.013 17.38)"},{id:"red-100",hue:"red",shade:"100",value:"oklch(93.6% 0.032 17.717)"},{id:"red-200",hue:"red",shade:"200",value:"oklch(88.5% 0.062 18.334)"},{id:"red-300",hue:"red",shade:"300",value:"oklch(80.8% 0.114 19.571)"},{id:"red-400",hue:"red",shade:"400",value:"oklch(70.4% 0.191 22.216)"},{id:"red-500",hue:"red",shade:"500",value:"oklch(63.7% 0.237 25.331)"},{id:"red-600",hue:"red",shade:"600",value:"oklch(57.7% 0.245 27.325)"},{id:"red-700",hue:"red",shade:"700",value:"oklch(50.5% 0.213 27.518)"},{id:"red-800",hue:"red",shade:"800",value:"oklch(44.4% 0.177 26.899)"},{id:"red-900",hue:"red",shade:"900",value:"oklch(39.6% 0.141 25.723)"},{id:"red-950",hue:"red",shade:"950",value:"oklch(25.8% 0.092 26.042)"},{id:"orange-50",hue:"orange",shade:"50",value:"oklch(98% 0.016 73.684)"},{id:"orange-100",hue:"orange",shade:"100",value:"oklch(95.4% 0.038 75.164)"},{id:"orange-200",hue:"orange",shade:"200",value:"oklch(90.1% 0.076 70.697)"},{id:"orange-300",hue:"orange",shade:"300",value:"oklch(83.7% 0.128 66.29)"},{id:"orange-400",hue:"orange",shade:"400",value:"oklch(75% 0.183 55.934)"},{id:"orange-500",hue:"orange",shade:"500",value:"oklch(70.5% 0.213 47.604)"},{id:"orange-600",hue:"orange",shade:"600",value:"oklch(64.6% 0.222 41.116)"},{id:"orange-700",hue:"orange",shade:"700",value:"oklch(55.3% 0.195 38.402)"},{id:"orange-800",hue:"orange",shade:"800",value:"oklch(47% 0.157 37.304)"},{id:"orange-900",hue:"orange",shade:"900",value:"oklch(40.8% 0.123 38.172)"},{id:"orange-950",hue:"orange",shade:"950",value:"oklch(26.6% 0.079 36.259)"},{id:"amber-50",hue:"amber",shade:"50",value:"oklch(98.7% 0.022 95.277)"},{id:"amber-100",hue:"amber",shade:"100",value:"oklch(96.2% 0.059 95.617)"},{id:"amber-200",hue:"amber",shade:"200",value:"oklch(92.4% 0.12 95.746)"},{id:"amber-300",hue:"amber",shade:"300",value:"oklch(87.9% 0.169 91.605)"},{id:"amber-400",hue:"amber",shade:"400",value:"oklch(82.8% 0.189 84.429)"},{id:"amber-500",hue:"amber",shade:"500",value:"oklch(76.9% 0.188 70.08)"},{id:"amber-600",hue:"amber",shade:"600",value:"oklch(66.6% 0.179 58.318)"},{id:"amber-700",hue:"amber",shade:"700",value:"oklch(55.5% 0.163 48.998)"},{id:"amber-800",hue:"amber",shade:"800",value:"oklch(47.3% 0.137 46.201)"},{id:"amber-900",hue:"amber",shade:"900",value:"oklch(41.4% 0.112 45.904)"},{id:"amber-950",hue:"amber",shade:"950",value:"oklch(27.9% 0.077 45.635)"},{id:"yellow-50",hue:"yellow",shade:"50",value:"oklch(98.7% 0.026 102.212)"},{id:"yellow-100",hue:"yellow",shade:"100",value:"oklch(97.3% 0.071 103.193)"},{id:"yellow-200",hue:"yellow",shade:"200",value:"oklch(94.5% 0.129 101.54)"},{id:"yellow-300",hue:"yellow",shade:"300",value:"oklch(90.5% 0.182 98.111)"},{id:"yellow-400",hue:"yellow",shade:"400",value:"oklch(85.2% 0.199 91.936)"},{id:"yellow-500",hue:"yellow",shade:"500",value:"oklch(79.5% 0.184 86.047)"},{id:"yellow-600",hue:"yellow",shade:"600",value:"oklch(68.1% 0.162 75.834)"},{id:"yellow-700",hue:"yellow",shade:"700",value:"oklch(55.4% 0.135 66.442)"},{id:"yellow-800",hue:"yellow",shade:"800",value:"oklch(47.6% 0.114 61.907)"},{id:"yellow-900",hue:"yellow",shade:"900",value:"oklch(42.1% 0.095 57.708)"},{id:"yellow-950",hue:"yellow",shade:"950",value:"oklch(28.6% 0.066 53.813)"},{id:"lime-50",hue:"lime",shade:"50",value:"oklch(98.6% 0.031 120.757)"},{id:"lime-100",hue:"lime",shade:"100",value:"oklch(96.7% 0.067 122.328)"},{id:"lime-200",hue:"lime",shade:"200",value:"oklch(93.8% 0.127 124.321)"},{id:"lime-300",hue:"lime",shade:"300",value:"oklch(89.7% 0.196 126.665)"},{id:"lime-400",hue:"lime",shade:"400",value:"oklch(84.1% 0.238 128.85)"},{id:"lime-500",hue:"lime",shade:"500",value:"oklch(76.8% 0.233 130.85)"},{id:"lime-600",hue:"lime",shade:"600",value:"oklch(64.8% 0.2 131.684)"},{id:"lime-700",hue:"lime",shade:"700",value:"oklch(53.2% 0.157 131.589)"},{id:"lime-800",hue:"lime",shade:"800",value:"oklch(45.3% 0.124 130.933)"},{id:"lime-900",hue:"lime",shade:"900",value:"oklch(40.5% 0.101 131.063)"},{id:"lime-950",hue:"lime",shade:"950",value:"oklch(27.4% 0.072 132.109)"},{id:"green-50",hue:"green",shade:"50",value:"oklch(98.2% 0.018 155.826)"},{id:"green-100",hue:"green",shade:"100",value:"oklch(96.2% 0.044 156.743)"},{id:"green-200",hue:"green",shade:"200",value:"oklch(92.5% 0.084 155.995)"},{id:"green-300",hue:"green",shade:"300",value:"oklch(87.1% 0.15 154.449)"},{id:"green-400",hue:"green",shade:"400",value:"oklch(79.2% 0.209 151.711)"},{id:"green-500",hue:"green",shade:"500",value:"oklch(72.3% 0.219 149.579)"},{id:"green-600",hue:"green",shade:"600",value:"oklch(62.7% 0.194 149.214)"},{id:"green-700",hue:"green",shade:"700",value:"oklch(52.7% 0.154 150.069)"},{id:"green-800",hue:"green",shade:"800",value:"oklch(44.8% 0.119 151.328)"},{id:"green-900",hue:"green",shade:"900",value:"oklch(39.3% 0.095 152.535)"},{id:"green-950",hue:"green",shade:"950",value:"oklch(26.6% 0.065 152.934)"},{id:"emerald-50",hue:"emerald",shade:"50",value:"oklch(97.9% 0.021 166.113)"},{id:"emerald-100",hue:"emerald",shade:"100",value:"oklch(95% 0.052 163.051)"},{id:"emerald-200",hue:"emerald",shade:"200",value:"oklch(90.5% 0.093 164.15)"},{id:"emerald-300",hue:"emerald",shade:"300",value:"oklch(84.5% 0.143 164.978)"},{id:"emerald-400",hue:"emerald",shade:"400",value:"oklch(76.5% 0.177 163.223)"},{id:"emerald-500",hue:"emerald",shade:"500",value:"oklch(69.6% 0.17 162.48)"},{id:"emerald-600",hue:"emerald",shade:"600",value:"oklch(59.6% 0.145 163.225)"},{id:"emerald-700",hue:"emerald",shade:"700",value:"oklch(50.8% 0.118 165.612)"},{id:"emerald-800",hue:"emerald",shade:"800",value:"oklch(43.2% 0.095 166.913)"},{id:"emerald-900",hue:"emerald",shade:"900",value:"oklch(37.8% 0.077 168.94)"},{id:"emerald-950",hue:"emerald",shade:"950",value:"oklch(26.2% 0.051 172.552)"},{id:"teal-50",hue:"teal",shade:"50",value:"oklch(98.4% 0.014 180.72)"},{id:"teal-100",hue:"teal",shade:"100",value:"oklch(95.3% 0.051 180.801)"},{id:"teal-200",hue:"teal",shade:"200",value:"oklch(91% 0.096 180.426)"},{id:"teal-300",hue:"teal",shade:"300",value:"oklch(85.5% 0.138 181.071)"},{id:"teal-400",hue:"teal",shade:"400",value:"oklch(77.7% 0.152 181.912)"},{id:"teal-500",hue:"teal",shade:"500",value:"oklch(70.4% 0.14 182.503)"},{id:"teal-600",hue:"teal",shade:"600",value:"oklch(60% 0.118 184.704)"},{id:"teal-700",hue:"teal",shade:"700",value:"oklch(51.1% 0.096 186.391)"},{id:"teal-800",hue:"teal",shade:"800",value:"oklch(43.7% 0.078 188.216)"},{id:"teal-900",hue:"teal",shade:"900",value:"oklch(38.6% 0.063 188.416)"},{id:"teal-950",hue:"teal",shade:"950",value:"oklch(27.7% 0.046 192.524)"},{id:"cyan-50",hue:"cyan",shade:"50",value:"oklch(98.4% 0.019 200.873)"},{id:"cyan-100",hue:"cyan",shade:"100",value:"oklch(95.6% 0.045 203.388)"},{id:"cyan-200",hue:"cyan",shade:"200",value:"oklch(91.7% 0.08 205.041)"},{id:"cyan-300",hue:"cyan",shade:"300",value:"oklch(86.5% 0.127 207.078)"},{id:"cyan-400",hue:"cyan",shade:"400",value:"oklch(78.9% 0.154 211.53)"},{id:"cyan-500",hue:"cyan",shade:"500",value:"oklch(71.5% 0.143 215.221)"},{id:"cyan-600",hue:"cyan",shade:"600",value:"oklch(60.9% 0.126 221.723)"},{id:"cyan-700",hue:"cyan",shade:"700",value:"oklch(52% 0.105 223.128)"},{id:"cyan-800",hue:"cyan",shade:"800",value:"oklch(45% 0.085 224.283)"},{id:"cyan-900",hue:"cyan",shade:"900",value:"oklch(39.8% 0.07 227.392)"},{id:"cyan-950",hue:"cyan",shade:"950",value:"oklch(30.2% 0.056 229.695)"},{id:"sky-50",hue:"sky",shade:"50",value:"oklch(97.7% 0.013 236.62)"},{id:"sky-100",hue:"sky",shade:"100",value:"oklch(95.1% 0.026 236.824)"},{id:"sky-200",hue:"sky",shade:"200",value:"oklch(90.1% 0.058 230.902)"},{id:"sky-300",hue:"sky",shade:"300",value:"oklch(82.8% 0.111 230.318)"},{id:"sky-400",hue:"sky",shade:"400",value:"oklch(74.6% 0.16 232.661)"},{id:"sky-500",hue:"sky",shade:"500",value:"oklch(68.5% 0.169 237.323)"},{id:"sky-600",hue:"sky",shade:"600",value:"oklch(58.8% 0.158 241.966)"},{id:"sky-700",hue:"sky",shade:"700",value:"oklch(50% 0.134 242.749)"},{id:"sky-800",hue:"sky",shade:"800",value:"oklch(44.3% 0.11 240.79)"},{id:"sky-900",hue:"sky",shade:"900",value:"oklch(39.1% 0.09 240.876)"},{id:"sky-950",hue:"sky",shade:"950",value:"oklch(29.3% 0.066 243.157)"},{id:"blue-50",hue:"blue",shade:"50",value:"oklch(97% 0.014 254.604)"},{id:"blue-100",hue:"blue",shade:"100",value:"oklch(93.2% 0.032 255.585)"},{id:"blue-200",hue:"blue",shade:"200",value:"oklch(88.2% 0.059 254.128)"},{id:"blue-300",hue:"blue",shade:"300",value:"oklch(80.9% 0.105 251.813)"},{id:"blue-400",hue:"blue",shade:"400",value:"oklch(70.7% 0.165 254.624)"},{id:"blue-500",hue:"blue",shade:"500",value:"oklch(62.3% 0.214 259.815)"},{id:"blue-600",hue:"blue",shade:"600",value:"oklch(54.6% 0.245 262.881)"},{id:"blue-700",hue:"blue",shade:"700",value:"oklch(48.8% 0.243 264.376)"},{id:"blue-800",hue:"blue",shade:"800",value:"oklch(42.4% 0.199 265.638)"},{id:"blue-900",hue:"blue",shade:"900",value:"oklch(37.9% 0.146 265.522)"},{id:"blue-950",hue:"blue",shade:"950",value:"oklch(28.2% 0.091 267.935)"},{id:"indigo-50",hue:"indigo",shade:"50",value:"oklch(96.2% 0.018 272.314)"},{id:"indigo-100",hue:"indigo",shade:"100",value:"oklch(93% 0.034 272.788)"},{id:"indigo-200",hue:"indigo",shade:"200",value:"oklch(87% 0.065 274.039)"},{id:"indigo-300",hue:"indigo",shade:"300",value:"oklch(78.5% 0.115 274.713)"},{id:"indigo-400",hue:"indigo",shade:"400",value:"oklch(67.3% 0.182 276.935)"},{id:"indigo-500",hue:"indigo",shade:"500",value:"oklch(58.5% 0.233 277.117)"},{id:"indigo-600",hue:"indigo",shade:"600",value:"oklch(51.1% 0.262 276.966)"},{id:"indigo-700",hue:"indigo",shade:"700",value:"oklch(45.7% 0.24 277.023)"},{id:"indigo-800",hue:"indigo",shade:"800",value:"oklch(39.8% 0.195 277.366)"},{id:"indigo-900",hue:"indigo",shade:"900",value:"oklch(35.9% 0.144 278.697)"},{id:"indigo-950",hue:"indigo",shade:"950",value:"oklch(25.7% 0.09 281.288)"},{id:"violet-50",hue:"violet",shade:"50",value:"oklch(96.9% 0.016 293.756)"},{id:"violet-100",hue:"violet",shade:"100",value:"oklch(94.3% 0.029 294.588)"},{id:"violet-200",hue:"violet",shade:"200",value:"oklch(89.4% 0.057 293.283)"},{id:"violet-300",hue:"violet",shade:"300",value:"oklch(81.1% 0.111 293.571)"},{id:"violet-400",hue:"violet",shade:"400",value:"oklch(70.2% 0.183 293.541)"},{id:"violet-500",hue:"violet",shade:"500",value:"oklch(60.6% 0.25 292.717)"},{id:"violet-600",hue:"violet",shade:"600",value:"oklch(54.1% 0.281 293.009)"},{id:"violet-700",hue:"violet",shade:"700",value:"oklch(49.1% 0.27 292.581)"},{id:"violet-800",hue:"violet",shade:"800",value:"oklch(43.2% 0.232 292.759)"},{id:"violet-900",hue:"violet",shade:"900",value:"oklch(38% 0.189 293.745)"},{id:"violet-950",hue:"violet",shade:"950",value:"oklch(28.3% 0.141 291.089)"},{id:"purple-50",hue:"purple",shade:"50",value:"oklch(97.7% 0.014 308.299)"},{id:"purple-100",hue:"purple",shade:"100",value:"oklch(94.6% 0.033 307.174)"},{id:"purple-200",hue:"purple",shade:"200",value:"oklch(90.2% 0.063 306.703)"},{id:"purple-300",hue:"purple",shade:"300",value:"oklch(82.7% 0.119 306.383)"},{id:"purple-400",hue:"purple",shade:"400",value:"oklch(71.4% 0.203 305.504)"},{id:"purple-500",hue:"purple",shade:"500",value:"oklch(62.7% 0.265 303.9)"},{id:"purple-600",hue:"purple",shade:"600",value:"oklch(55.8% 0.288 302.321)"},{id:"purple-700",hue:"purple",shade:"700",value:"oklch(49.6% 0.265 301.924)"},{id:"purple-800",hue:"purple",shade:"800",value:"oklch(43.8% 0.218 303.724)"},{id:"purple-900",hue:"purple",shade:"900",value:"oklch(38.1% 0.176 304.987)"},{id:"purple-950",hue:"purple",shade:"950",value:"oklch(29.1% 0.149 302.717)"},{id:"fuchsia-50",hue:"fuchsia",shade:"50",value:"oklch(97.7% 0.017 320.058)"},{id:"fuchsia-100",hue:"fuchsia",shade:"100",value:"oklch(95.2% 0.037 318.852)"},{id:"fuchsia-200",hue:"fuchsia",shade:"200",value:"oklch(90.3% 0.076 319.62)"},{id:"fuchsia-300",hue:"fuchsia",shade:"300",value:"oklch(83.3% 0.145 321.434)"},{id:"fuchsia-400",hue:"fuchsia",shade:"400",value:"oklch(74% 0.238 322.16)"},{id:"fuchsia-500",hue:"fuchsia",shade:"500",value:"oklch(66.7% 0.295 322.15)"},{id:"fuchsia-600",hue:"fuchsia",shade:"600",value:"oklch(59.1% 0.293 322.896)"},{id:"fuchsia-700",hue:"fuchsia",shade:"700",value:"oklch(51.8% 0.253 323.949)"},{id:"fuchsia-800",hue:"fuchsia",shade:"800",value:"oklch(45.2% 0.211 324.591)"},{id:"fuchsia-900",hue:"fuchsia",shade:"900",value:"oklch(40.1% 0.17 325.612)"},{id:"fuchsia-950",hue:"fuchsia",shade:"950",value:"oklch(29.3% 0.136 325.661)"},{id:"pink-50",hue:"pink",shade:"50",value:"oklch(97.1% 0.014 343.198)"},{id:"pink-100",hue:"pink",shade:"100",value:"oklch(94.8% 0.028 342.258)"},{id:"pink-200",hue:"pink",shade:"200",value:"oklch(89.9% 0.061 343.231)"},{id:"pink-300",hue:"pink",shade:"300",value:"oklch(82.3% 0.12 346.018)"},{id:"pink-400",hue:"pink",shade:"400",value:"oklch(71.8% 0.202 349.761)"},{id:"pink-500",hue:"pink",shade:"500",value:"oklch(65.6% 0.241 354.308)"},{id:"pink-600",hue:"pink",shade:"600",value:"oklch(59.2% 0.249 0.584)"},{id:"pink-700",hue:"pink",shade:"700",value:"oklch(52.5% 0.223 3.958)"},{id:"pink-800",hue:"pink",shade:"800",value:"oklch(45.9% 0.187 3.815)"},{id:"pink-900",hue:"pink",shade:"900",value:"oklch(40.8% 0.153 2.432)"},{id:"pink-950",hue:"pink",shade:"950",value:"oklch(28.4% 0.109 3.907)"},{id:"rose-50",hue:"rose",shade:"50",value:"oklch(96.9% 0.015 12.422)"},{id:"rose-100",hue:"rose",shade:"100",value:"oklch(94.1% 0.03 12.58)"},{id:"rose-200",hue:"rose",shade:"200",value:"oklch(89.2% 0.058 10.001)"},{id:"rose-300",hue:"rose",shade:"300",value:"oklch(81% 0.117 11.638)"},{id:"rose-400",hue:"rose",shade:"400",value:"oklch(71.2% 0.194 13.428)"},{id:"rose-500",hue:"rose",shade:"500",value:"oklch(64.5% 0.246 16.439)"},{id:"rose-600",hue:"rose",shade:"600",value:"oklch(58.6% 0.253 17.585)"},{id:"rose-700",hue:"rose",shade:"700",value:"oklch(51.4% 0.222 16.935)"},{id:"rose-800",hue:"rose",shade:"800",value:"oklch(45.5% 0.188 13.697)"},{id:"rose-900",hue:"rose",shade:"900",value:"oklch(41% 0.159 10.272)"},{id:"rose-950",hue:"rose",shade:"950",value:"oklch(27.1% 0.105 12.094)"},{id:"slate-50",hue:"slate",shade:"50",value:"oklch(98.4% 0.003 247.858)"},{id:"slate-100",hue:"slate",shade:"100",value:"oklch(96.8% 0.007 247.896)"},{id:"slate-200",hue:"slate",shade:"200",value:"oklch(92.9% 0.013 255.508)"},{id:"slate-300",hue:"slate",shade:"300",value:"oklch(86.9% 0.022 252.894)"},{id:"slate-400",hue:"slate",shade:"400",value:"oklch(70.4% 0.04 256.788)"},{id:"slate-500",hue:"slate",shade:"500",value:"oklch(55.4% 0.046 257.417)"},{id:"slate-600",hue:"slate",shade:"600",value:"oklch(44.6% 0.043 257.281)"},{id:"slate-700",hue:"slate",shade:"700",value:"oklch(37.2% 0.044 257.287)"},{id:"slate-800",hue:"slate",shade:"800",value:"oklch(27.9% 0.041 260.031)"},{id:"slate-900",hue:"slate",shade:"900",value:"oklch(20.8% 0.042 265.755)"},{id:"slate-950",hue:"slate",shade:"950",value:"oklch(12.9% 0.042 264.695)"},{id:"gray-50",hue:"gray",shade:"50",value:"oklch(98.5% 0.002 247.839)"},{id:"gray-100",hue:"gray",shade:"100",value:"oklch(96.7% 0.003 264.542)"},{id:"gray-200",hue:"gray",shade:"200",value:"oklch(92.8% 0.006 264.531)"},{id:"gray-300",hue:"gray",shade:"300",value:"oklch(87.2% 0.01 258.338)"},{id:"gray-400",hue:"gray",shade:"400",value:"oklch(70.7% 0.022 261.325)"},{id:"gray-500",hue:"gray",shade:"500",value:"oklch(55.1% 0.027 264.364)"},{id:"gray-600",hue:"gray",shade:"600",value:"oklch(44.6% 0.03 256.802)"},{id:"gray-700",hue:"gray",shade:"700",value:"oklch(37.3% 0.034 259.733)"},{id:"gray-800",hue:"gray",shade:"800",value:"oklch(27.8% 0.033 256.848)"},{id:"gray-900",hue:"gray",shade:"900",value:"oklch(21% 0.034 264.665)"},{id:"gray-950",hue:"gray",shade:"950",value:"oklch(13% 0.028 261.692)"},{id:"zinc-50",hue:"zinc",shade:"50",value:"oklch(98.5% 0 none)"},{id:"zinc-100",hue:"zinc",shade:"100",value:"oklch(96.7% 0.001 286.375)"},{id:"zinc-200",hue:"zinc",shade:"200",value:"oklch(92% 0.004 286.32)"},{id:"zinc-300",hue:"zinc",shade:"300",value:"oklch(87.1% 0.006 286.286)"},{id:"zinc-400",hue:"zinc",shade:"400",value:"oklch(70.5% 0.015 286.067)"},{id:"zinc-500",hue:"zinc",shade:"500",value:"oklch(55.2% 0.016 285.938)"},{id:"zinc-600",hue:"zinc",shade:"600",value:"oklch(44.2% 0.017 285.786)"},{id:"zinc-700",hue:"zinc",shade:"700",value:"oklch(37% 0.013 285.805)"},{id:"zinc-800",hue:"zinc",shade:"800",value:"oklch(27.4% 0.006 286.033)"},{id:"zinc-900",hue:"zinc",shade:"900",value:"oklch(21% 0.006 285.885)"},{id:"zinc-950",hue:"zinc",shade:"950",value:"oklch(14.1% 0.005 285.823)"},{id:"neutral-50",hue:"neutral",shade:"50",value:"oklch(98.5% 0 none)"},{id:"neutral-100",hue:"neutral",shade:"100",value:"oklch(97% 0 none)"},{id:"neutral-200",hue:"neutral",shade:"200",value:"oklch(92.2% 0 none)"},{id:"neutral-300",hue:"neutral",shade:"300",value:"oklch(87% 0 none)"},{id:"neutral-400",hue:"neutral",shade:"400",value:"oklch(70.8% 0 none)"},{id:"neutral-500",hue:"neutral",shade:"500",value:"oklch(55.6% 0 none)"},{id:"neutral-600",hue:"neutral",shade:"600",value:"oklch(43.9% 0 none)"},{id:"neutral-700",hue:"neutral",shade:"700",value:"oklch(37.1% 0 none)"},{id:"neutral-800",hue:"neutral",shade:"800",value:"oklch(26.9% 0 none)"},{id:"neutral-900",hue:"neutral",shade:"900",value:"oklch(20.5% 0 none)"},{id:"neutral-950",hue:"neutral",shade:"950",value:"oklch(14.5% 0 none)"},{id:"stone-50",hue:"stone",shade:"50",value:"oklch(98.5% 0.001 106.423)"},{id:"stone-100",hue:"stone",shade:"100",value:"oklch(97% 0.001 106.424)"},{id:"stone-200",hue:"stone",shade:"200",value:"oklch(92.3% 0.003 48.717)"},{id:"stone-300",hue:"stone",shade:"300",value:"oklch(86.9% 0.005 56.366)"},{id:"stone-400",hue:"stone",shade:"400",value:"oklch(70.9% 0.01 56.259)"},{id:"stone-500",hue:"stone",shade:"500",value:"oklch(55.3% 0.013 58.071)"},{id:"stone-600",hue:"stone",shade:"600",value:"oklch(44.4% 0.011 73.639)"},{id:"stone-700",hue:"stone",shade:"700",value:"oklch(37.4% 0.01 67.558)"},{id:"stone-800",hue:"stone",shade:"800",value:"oklch(26.8% 0.007 34.298)"},{id:"stone-900",hue:"stone",shade:"900",value:"oklch(21.6% 0.006 56.043)"},{id:"stone-950",hue:"stone",shade:"950",value:"oklch(14.7% 0.004 49.25)"},{id:"mauve-50",hue:"mauve",shade:"50",value:"oklch(98.5% 0 none)"},{id:"mauve-100",hue:"mauve",shade:"100",value:"oklch(96% 0.003 325.6)"},{id:"mauve-200",hue:"mauve",shade:"200",value:"oklch(92.2% 0.005 325.62)"},{id:"mauve-300",hue:"mauve",shade:"300",value:"oklch(86.5% 0.012 325.68)"},{id:"mauve-400",hue:"mauve",shade:"400",value:"oklch(71.1% 0.019 323.02)"},{id:"mauve-500",hue:"mauve",shade:"500",value:"oklch(54.2% 0.034 322.5)"},{id:"mauve-600",hue:"mauve",shade:"600",value:"oklch(43.5% 0.029 321.78)"},{id:"mauve-700",hue:"mauve",shade:"700",value:"oklch(36.4% 0.029 323.89)"},{id:"mauve-800",hue:"mauve",shade:"800",value:"oklch(26.3% 0.024 320.12)"},{id:"mauve-900",hue:"mauve",shade:"900",value:"oklch(21.2% 0.019 322.12)"},{id:"mauve-950",hue:"mauve",shade:"950",value:"oklch(14.5% 0.008 326)"},{id:"olive-50",hue:"olive",shade:"50",value:"oklch(98.8% 0.003 106.5)"},{id:"olive-100",hue:"olive",shade:"100",value:"oklch(96.6% 0.005 106.5)"},{id:"olive-200",hue:"olive",shade:"200",value:"oklch(93% 0.007 106.5)"},{id:"olive-300",hue:"olive",shade:"300",value:"oklch(88% 0.011 106.6)"},{id:"olive-400",hue:"olive",shade:"400",value:"oklch(73.7% 0.021 106.9)"},{id:"olive-500",hue:"olive",shade:"500",value:"oklch(58% 0.031 107.3)"},{id:"olive-600",hue:"olive",shade:"600",value:"oklch(46.6% 0.025 107.3)"},{id:"olive-700",hue:"olive",shade:"700",value:"oklch(39.4% 0.023 107.4)"},{id:"olive-800",hue:"olive",shade:"800",value:"oklch(28.6% 0.016 107.4)"},{id:"olive-900",hue:"olive",shade:"900",value:"oklch(22.8% 0.013 107.4)"},{id:"olive-950",hue:"olive",shade:"950",value:"oklch(15.3% 0.006 107.1)"},{id:"mist-50",hue:"mist",shade:"50",value:"oklch(98.7% 0.002 197.1)"},{id:"mist-100",hue:"mist",shade:"100",value:"oklch(96.3% 0.002 197.1)"},{id:"mist-200",hue:"mist",shade:"200",value:"oklch(92.5% 0.005 214.3)"},{id:"mist-300",hue:"mist",shade:"300",value:"oklch(87.2% 0.007 219.6)"},{id:"mist-400",hue:"mist",shade:"400",value:"oklch(72.3% 0.014 214.4)"},{id:"mist-500",hue:"mist",shade:"500",value:"oklch(56% 0.021 213.5)"},{id:"mist-600",hue:"mist",shade:"600",value:"oklch(45% 0.017 213.2)"},{id:"mist-700",hue:"mist",shade:"700",value:"oklch(37.8% 0.015 216)"},{id:"mist-800",hue:"mist",shade:"800",value:"oklch(27.5% 0.011 216.9)"},{id:"mist-900",hue:"mist",shade:"900",value:"oklch(21.8% 0.008 223.9)"},{id:"mist-950",hue:"mist",shade:"950",value:"oklch(14.8% 0.004 228.8)"},{id:"taupe-50",hue:"taupe",shade:"50",value:"oklch(98.6% 0.002 67.8)"},{id:"taupe-100",hue:"taupe",shade:"100",value:"oklch(96% 0.002 17.2)"},{id:"taupe-200",hue:"taupe",shade:"200",value:"oklch(92.2% 0.005 34.3)"},{id:"taupe-300",hue:"taupe",shade:"300",value:"oklch(86.8% 0.007 39.5)"},{id:"taupe-400",hue:"taupe",shade:"400",value:"oklch(71.4% 0.014 41.2)"},{id:"taupe-500",hue:"taupe",shade:"500",value:"oklch(54.7% 0.021 43.1)"},{id:"taupe-600",hue:"taupe",shade:"600",value:"oklch(43.8% 0.017 39.3)"},{id:"taupe-700",hue:"taupe",shade:"700",value:"oklch(36.7% 0.016 35.7)"},{id:"taupe-800",hue:"taupe",shade:"800",value:"oklch(26.8% 0.011 36.5)"},{id:"taupe-900",hue:"taupe",shade:"900",value:"oklch(21.4% 0.009 43.1)"},{id:"taupe-950",hue:"taupe",shade:"950",value:"oklch(14.7% 0.004 49.3)"}]),La=12,_i=new Map(Ne.map(e=>[e.id,e])),ja=new Map(Ne.map(e=>[e.value,e])),Ma=/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i,Na=/^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\(.*\)$/i,za=/[;{}<>\\]|url\s*\(/i,Ei=new WeakMap;function vr(e){let t=Ei.get(e);return t||Ei.set(e,t=new Set),t}function Ul(e,t){let r=String(e??"").trim();if(!r||za.test(r)||ra(r))return!1;let i=t?.defaultView?.CSS;return i&&typeof i.supports=="function"?i.supports("color",r):Ma.test(r)||Na.test(r)||/^[a-z]+$/i.test(r)}function Vl(e){return`${e.hue[0].toUpperCase()}${e.hue.slice(1)} ${e.shade}`}function Xe(e){return{id:e.id,label:Vl(e),value:e.value}}function Wl(e){let t=String(e??"").trim(),r=ja.get(t);return r?Vl(r):t}function Fa(e,t){if(!e||e.length===0)return{swatches:Ne.map(Xe),custom:!0,full:!0};let r=[],i=new Set,l=!1,o=n=>{i.has(n.value)||(i.add(n.value),r.push(n))};for(let n of e)n==="custom"?l=!0:_i.has(n)?o(Xe(_i.get(n))):Oa.includes(n)?Ne.filter(a=>a.hue===n).forEach(a=>o(Xe(a))):$a.includes(n)?Ne.filter(a=>a.shade===n).forEach(a=>o(Xe(a))):Ul(n,t)?o({id:null,label:n,value:n}):console.warn(`[hypercms] color option "${n}" is not a Tailwind color, hue, shade, CSS color or "custom"; ignoring it`);return{swatches:r,custom:l,full:!1}}function Da(e,{value:t,tokens:r,path:i,doc:l}){let{swatches:o,custom:n,full:a}=Fa(r,l),s=t==null?"":String(t).trim();s&&!o.some(m=>m.value===s)&&o.unshift({id:null,label:Wl(s),value:s});let h=o.length<=La;e.setAttribute("data-hcms-color-path",i),e.classList.toggle("hcms-color--inline",h);let d=e.querySelector(".hcms-color-grid");if(d){d.classList.toggle("hcms-color-grid--full",a);for(let m of o){let u=l.createElement("button");u.type="button",u.className="hcms-color-swatch",u.setAttribute("data-hcms-action","color-pick"),u.setAttribute("data-hcms-color",m.value),u.setAttribute("aria-label",m.label),u.setAttribute("title",m.id||m.label),u.setAttribute("style",`--hcms-swatch: ${m.value}`),d.appendChild(u)}}n||e.querySelector(".hcms-color-custom")?.remove();let f=e.querySelector(".hcms-color-current");h&&f&&(f.removeAttribute("data-hcms-action"),f.removeAttribute("aria-expanded")),yr(e,h||vr(l).has(i)),Gl(e,s)}function Gl(e,t){let r=t==null?"":String(t).trim();e.toggleAttribute("data-hcms-color-empty",r==="");let i=e.querySelector(".hcms-color-chip");i&&(r?i.setAttribute("style",`--hcms-swatch: ${r}`):i.removeAttribute("style"));let l=e.querySelector(".hcms-color-name");l&&(l.textContent=r?Wl(r):"Not set"),e.querySelectorAll(".hcms-color-swatch").forEach(a=>{a.setAttribute("aria-pressed",String(a.getAttribute("data-hcms-color")===r))});let o=e.querySelector('[data-hcms-color-input="text"]');o&&o.ownerDocument?.activeElement!==o&&(o.value=r);let n=e.querySelector('[data-hcms-color-input="native"]');n&&/^#[0-9a-f]{6}$/i.test(r)&&(n.value=r.toLowerCase())}function yr(e,t){let r=e.querySelector(".hcms-color-panel");r&&(r.hidden=!t);let i=e.querySelector(".hcms-color-current[data-hcms-action]");i&&i.setAttribute("aria-expanded",String(t))}function xt(e){return e?.closest?e.closest("[data-hcms-color-path]"):null}function Ba(e){return e.querySelector('input[type="hidden"][data-hcms-field]')}function Jl(e,t){let r=e.querySelector(":scope > .hcms-error");r&&(r.textContent=t||"",r.hidden=!t)}function xr(e,t){let r=Ba(e);return!r||(Jl(e,null),Gl(e,t),r.value===t)?null:(r.value=t,r)}function Ia(e){let t=xt(e);return t?(t.classList.contains("hcms-color--inline")||(vr(t.ownerDocument).delete(t.getAttribute("data-hcms-color-path")),yr(t,!1)),xr(t,e.getAttribute("data-hcms-color")||"")):null}function Pa(e){let t=xt(e);return t?xr(t,""):null}function Ha(e){let t=xt(e);if(!t)return;let r=t.getAttribute("data-hcms-color-path"),i=vr(t.ownerDocument),l=!i.has(r);l?i.add(r):i.delete(r),yr(t,l)}function Ua(e){let t=xt(e);if(!t)return null;let r=String(e.value||"").trim();return r!==""&&!Ul(r,t.ownerDocument)?(Jl(t,`"${r}" is not a CSS color`),null):xr(t,r)}var Xl=["sans","serif","display","mono"],N="ui-sans-serif, system-ui, sans-serif",Y="ui-serif, Georgia, serif",me="ui-monospace, SFMono-Regular, Menlo, monospace",re=Object.freeze([{slug:"inter",family:"Inter",group:"sans",fallback:N,request:"ital,wght@0,100..900;1,100..900"},{slug:"roboto",family:"Roboto",group:"sans",fallback:N,request:"ital,wght@0,100..900;1,100..900"},{slug:"open-sans",family:"Open Sans",group:"sans",fallback:N,request:"ital,wght@0,300..800;1,300..800"},{slug:"lato",family:"Lato",group:"sans",fallback:N,request:"ital,wght@0,100;0,300;0,400;0,700;0,900;1,100;1,300;1,400;1,700;1,900"},{slug:"montserrat",family:"Montserrat",group:"sans",fallback:N,request:"ital,wght@0,100..900;1,100..900"},{slug:"poppins",family:"Poppins",group:"sans",fallback:N,request:"ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,100;1,200;1,300;1,400;1,500;1,600;1,700;1,800;1,900"},{slug:"nunito",family:"Nunito",group:"sans",fallback:N,request:"ital,wght@0,200..1000;1,200..1000"},{slug:"raleway",family:"Raleway",group:"sans",fallback:N,request:"ital,wght@0,100..900;1,100..900"},{slug:"dm-sans",family:"DM Sans",group:"sans",fallback:N,request:"ital,wght@0,100..1000;1,100..1000"},{slug:"work-sans",family:"Work Sans",group:"sans",fallback:N,request:"ital,wght@0,100..900;1,100..900"},{slug:"source-sans-3",family:"Source Sans 3",group:"sans",fallback:N,request:"ital,wght@0,200..900;1,200..900"},{slug:"noto-sans",family:"Noto Sans",group:"sans",fallback:N,request:"ital,wght@0,100..900;1,100..900"},{slug:"plus-jakarta-sans",family:"Plus Jakarta Sans",group:"sans",fallback:N,request:"ital,wght@0,200..800;1,200..800"},{slug:"manrope",family:"Manrope",group:"sans",fallback:N,request:"wght@200..800"},{slug:"outfit",family:"Outfit",group:"sans",fallback:N,request:"wght@100..900"},{slug:"space-grotesk",family:"Space Grotesk",group:"sans",fallback:N,request:"wght@300..700"},{slug:"rubik",family:"Rubik",group:"sans",fallback:N,request:"ital,wght@0,300..900;1,300..900"},{slug:"ubuntu",family:"Ubuntu",group:"sans",fallback:N,request:"ital,wght@0,300;0,400;0,500;0,700;1,300;1,400;1,500;1,700"},{slug:"merriweather",family:"Merriweather",group:"serif",fallback:Y,request:"ital,wght@0,300..900;1,300..900"},{slug:"lora",family:"Lora",group:"serif",fallback:Y,request:"ital,wght@0,400..700;1,400..700"},{slug:"playfair-display",family:"Playfair Display",group:"serif",fallback:Y,request:"ital,wght@0,400..900;1,400..900"},{slug:"libre-baskerville",family:"Libre Baskerville",group:"serif",fallback:Y,request:"ital,wght@0,400..700;1,400..700"},{slug:"source-serif-4",family:"Source Serif 4",group:"serif",fallback:Y,request:"ital,wght@0,200..900;1,200..900"},{slug:"pt-serif",family:"PT Serif",group:"serif",fallback:Y,request:"ital,wght@0,400;0,700;1,400;1,700"},{slug:"noto-serif",family:"Noto Serif",group:"serif",fallback:Y,request:"ital,wght@0,100..900;1,100..900"},{slug:"crimson-pro",family:"Crimson Pro",group:"serif",fallback:Y,request:"ital,wght@0,200..900;1,200..900"},{slug:"eb-garamond",family:"EB Garamond",group:"serif",fallback:Y,request:"ital,wght@0,400..800;1,400..800"},{slug:"cormorant-garamond",family:"Cormorant Garamond",group:"serif",fallback:Y,request:"ital,wght@0,300..700;1,300..700"},{slug:"bebas-neue",family:"Bebas Neue",group:"display",fallback:N,request:"wght@400"},{slug:"oswald",family:"Oswald",group:"display",fallback:N,request:"wght@200..700"},{slug:"anton",family:"Anton",group:"display",fallback:N,request:"wght@400"},{slug:"abril-fatface",family:"Abril Fatface",group:"display",fallback:Y,request:"wght@400"},{slug:"lobster",family:"Lobster",group:"display",fallback:"cursive",request:"wght@400"},{slug:"bungee",family:"Bungee",group:"display",fallback:N,request:"wght@400"},{slug:"roboto-mono",family:"Roboto Mono",group:"mono",fallback:me,request:"ital,wght@0,100..700;1,100..700"},{slug:"jetbrains-mono",family:"JetBrains Mono",group:"mono",fallback:me,request:"ital,wght@0,100..800;1,100..800"},{slug:"fira-code",family:"Fira Code",group:"mono",fallback:me,request:"wght@300..700"},{slug:"source-code-pro",family:"Source Code Pro",group:"mono",fallback:me,request:"ital,wght@0,200..900;1,200..900"},{slug:"ibm-plex-mono",family:"IBM Plex Mono",group:"mono",fallback:me,request:"ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;1,100;1,200;1,300;1,400;1,500;1,600;1,700"},{slug:"space-mono",family:"Space Mono",group:"mono",fallback:me,request:"ital,wght@0,400;0,700;1,400;1,700"}]),ze=Object.freeze({slug:"system",family:null,group:"sans",fallback:"system-ui, sans-serif"}),Va=new Map(re.map(e=>[e.family.toLowerCase(),e])),ou=new Map(re.map(e=>[e.slug,e]));function Ye(e){return!e||e.slug==="system"?ze.fallback:`'${e.family}', ${e.fallback}`}function Kl(e){return e==null?null:String(e).split(",")[0].trim().replace(/^['"]|['"]$/g,"")||null}function Yt(e){let t=new Map;if(!e)return t;let r=String(e).split("?")[1]||"";for(let i of r.split("&")){if(!i.startsWith("family="))continue;let l=decodeURIComponent(i.slice(7).split(":")[0].replace(/\+/g," ")).trim();l&&t.set(l.toLowerCase(),i)}return t}function Wa(e,t){let r=Yt(e),i=Yt(t);return r.size===i.size&&[...r.keys()].every(l=>i.has(l))}function Zl(e){let t=Kl(e);return t&&Va.get(t.toLowerCase())||null}function Ql(e,t=null){let r=Yt(t),i=new Map;for(let l of e||[]){let o=Zl(l);if(o){i.set(o.family.toLowerCase(),`family=${o.family.replace(/ /g,"+")}:${o.request}`);continue}let n=Kl(l),a=n&&r.get(n.toLowerCase());a&&i.set(n.toLowerCase(),a)}return i.size===0?null:`https://fonts.googleapis.com/css2?${[...i.entries()].sort(([l],[o])=>l.localeCompare(o)).map(([,l])=>l).join("&")}&display=swap`}var Ga={sans:"Sans",serif:"Serif",display:"Display",mono:"Mono"},Ja="link[data-hcms-font-preview]",Si=new WeakMap;function wr(e){let t=Si.get(e);return t||Si.set(e,t=new Set),t}function Xa(e){return String(e??"").trim()===ze.fallback}function Yl(e){let t=String(e??"").trim();if(!t)return"Not set";if(Xa(t))return"System";let r=Zl(t);return r?r.family:"Current font"}function Ka(e){if(!e||e.length===0)return{system:!0,fonts:[...re]};let t=!1,r=new Set;for(let i of e)i==="system"?t=!0:Xl.includes(i)?re.filter(l=>l.group===i).forEach(l=>r.add(l)):re.some(l=>l.slug===i)?r.add(re.find(l=>l.slug===i)):console.warn(`[hypercms] font option "${i}" is not a catalog font, a group or "system"; ignoring it`);return{system:t,fonts:re.filter(i=>r.has(i))}}function jt(e,{value:t,label:r,family:i}){let l=e.createElement("button");return l.type="button",l.className="hcms-font-option",l.setAttribute("role","option"),l.setAttribute("data-hcms-action","font-pick"),l.setAttribute("data-hcms-font",t),l.setAttribute("style",`font-family: ${i}`),l.textContent=r,l}function Za(e,{value:t,tokens:r,path:i,doc:l}){let{system:o,fonts:n}=Ka(r),a=t==null?"":String(t).trim();e.setAttribute("data-hcms-font-path",i);let s=e.querySelector(".hcms-font-list");if(s){let h=new Set([...o?[ze.fallback]:[],...n.map(Ye)]);a&&!h.has(a)&&s.appendChild(jt(l,{value:a,label:Yl(a),family:a})),o&&s.appendChild(jt(l,{value:ze.fallback,label:"System",family:ze.fallback}));for(let d of Xl){let f=n.filter(u=>u.group===d);if(!f.length)continue;let m=l.createElement("div");m.className="hcms-font-group",m.textContent=Ga[d],s.appendChild(m);for(let u of f)s.appendChild(jt(l,{value:Ye(u),label:u.family,family:Ye(u)}))}}Ar(e,wr(l).has(i)),eo(e,a)}function eo(e,t){let r=t==null?"":String(t).trim(),i=e.querySelector(".hcms-font-name");i&&(i.textContent=Yl(r),r?i.setAttribute("style",`font-family: ${r}`):i.removeAttribute("style")),e.querySelectorAll(".hcms-font-option").forEach(l=>{l.setAttribute("aria-selected",String(l.getAttribute("data-hcms-font")===r))})}function Ar(e,t){let r=e.querySelector(".hcms-font-panel");r&&(r.hidden=!t),e.querySelector(".hcms-font-current")?.setAttribute("aria-expanded",String(t)),t&&Qa(e.ownerDocument)}function Qa(e){let t=e?.head;if(!t||t.querySelector(Ja))return;let r=Ql(re.map(Ye)),i=[...new Set(re.map(o=>o.family).join(""))].join(""),l=e.createElement("link");l.rel="stylesheet",l.href=`${r}&text=${encodeURIComponent(i)}`,l.setAttribute("data-hcms-font-preview","");for(let o of["editor-ui","no-save","save-remove","snapshot-remove"])l.setAttribute(o,"");t.appendChild(l)}function to(e){return e?.closest?e.closest("[data-hcms-font-path]"):null}function Ya(e){let t=to(e);if(!t)return;let r=t.getAttribute("data-hcms-font-path"),i=wr(t.ownerDocument),l=!i.has(r);l?i.add(r):i.delete(r),Ar(t,l)}function es(e){let t=to(e);if(!t)return null;let r=t.querySelector('input[type="hidden"][data-hcms-field]');if(!r)return null;wr(t.ownerDocument).delete(t.getAttribute("data-hcms-font-path")),Ar(t,!1);let i=e.getAttribute("data-hcms-font")||"";return eo(t,i),r.value===i?null:(r.value=i,r)}var K=e=>`<svg viewBox="0 0 32 20" width="32" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">${e}</svg>`,z=(e,t,r,i,l="")=>`<rect x="${e}" y="${t}" width="${r}" height="${i}" rx="1"${l}/>`,B=(e,t,r)=>`<path d="M${e} ${t}H${r}"/>`,Mt=' fill="currentColor" fill-opacity="0.3"',ts=Object.freeze({"cols-1":{label:"One column",svg:K(z(2,2,28,16))},"cols-2":{label:"Two columns",svg:K(z(2,2,13,16)+z(17,2,13,16))},"cols-3":{label:"Three columns",svg:K(z(2,2,8,16)+z(12,2,8,16)+z(22,2,8,16))},"cols-4":{label:"Four columns",svg:K(z(2,2,5.5,16)+z(9.5,2,5.5,16)+z(17,2,5.5,16)+z(24.5,2,5.5,16))},"media-left":{label:"Image left",svg:K(z(2,3,12,14,Mt)+B(18,6,30)+B(18,10,30)+B(18,14,26))},"media-right":{label:"Image right",svg:K(z(18,3,12,14,Mt)+B(2,6,14)+B(2,10,14)+B(2,14,10))},"media-top":{label:"Image on top",svg:K(z(2,2,28,8,Mt)+B(2,14,30)+B(2,17,22))},list:{label:"List",svg:K(B(3,5,4)+B(8,5,29)+B(3,10,4)+B(8,10,29)+B(3,15,4)+B(8,15,29))},cards:{label:"Cards",svg:K(z(2,2,13,7)+z(17,2,13,7)+z(2,11,13,7)+z(17,11,13,7))},centered:{label:"Centered",svg:K(B(6,5,26)+B(9,10,23)+B(11,15,21))},"card-flat":{label:"Flat",svg:K(z(5,3,22,14))},"card-raised":{label:"Raised",svg:K(z(7,5,22,14,' stroke-opacity="0.35"')+z(4,2,22,14,' fill="var(--mirk-bg, transparent)"'))}});function rs(e){return(e||[]).map(t=>{let r=t.indexOf(":"),i=r===-1?t:t.slice(0,r),l=r===-1?t:t.slice(r+1),o=ts[l]||null;return{value:i,icon:o,label:o?o.label:Ie(i)}})}function is(e,{tokens:t,value:r,name:i,doc:l}){let o=rs(t),n=r==null?"":String(r);n!==""&&!o.some(s=>s.value===n)&&o.unshift({value:n,icon:null,label:Ie(n)});let a=e.querySelector(".hcms-variant-option");if(!a||!a.parentNode)return o.length;for(let s of o){let h=a.cloneNode(!0),d=h.querySelector('input[type="radio"]');d&&(d.value=s.value,d.name=i);let f=h.querySelector(".hcms-variant-icon");f&&(s.icon?f.innerHTML=s.icon.svg:f.remove());let m=h.querySelector(".hcms-variant-label");m&&(m.textContent=s.label),h.setAttribute("title",s.label),a.parentNode.insertBefore(h,a)}return a.remove(),o.length}function ro(e){if(!e)return"";let t=String(e).split(/[?#]/)[0],r=t.split("/").pop()||t;try{return decodeURIComponent(r)}catch{return r}}function _r({pageRules:e,formRules:t,data:r,doc:i}){let l=i.createDocumentFragment(),o=ls(e,r,i);o&&l.appendChild(o);let n=wt(e,[],r,i,e);return n&&l.appendChild(n),l}function ls(e,t,r){let i=[];if(s(e,t,[]),!i.length)return null;let l=ee(r,"@object");if(!l)return null;let o=he(l,r);o.setAttribute("data-hcms-page-style","");let n=o.querySelector("[data-hcms-label]");n&&(n.textContent="Page style");let a=o.querySelector(".hcms-object-fields")||o;for(let[h,d,f]of i){let m=wt(h,d,f,r,e);m&&a.appendChild(m)}return o;function s(h,d,f){if(typeof h=="string"){f.length&&fr(h,r,f,e)==="page"&&i.push([h,f,d]);return}if(!(!h||typeof h!="object"||Array.isArray(h))){if(f.length){let m=Ae(f,"@object",r);if(m&&yt(m))return}for(let[m,u]of Object.entries(h))s(u,d==null?null:d[m],[...f,m])}}}function io(e,t,r,i){let l=[],o=[];for(let[n,a]of Object.entries(e)){let s=fr(a,r,[...t,n],i);s!=="page"&&(s?l:o).push([n,a])}return[...l,...o]}function os({shape:e,itemShape:t,pathArr:r,data:i,doc:l,itemKey:o,pageRules:n}){if(e==="object-array-item")return no(t,r,i,l,n);if(e==="scalar-array-item")return ao(r,i,l,o||null);throw new Error(`hypercms: buildItem called with unknown shape "${e}"`)}function wt(e,t,r,i,l){let o=Pe(e);return o==="scalar"?ns(e,t,r,i,l):o==="object"?cs(e,t,r,i,l):o==="object-array"?hs(e,t,r,i,l):o==="scalar-array"?us(e,t,r,i):null}function ns(e,t,r,i,l){let o=He(e,i,t,l),n=Ae(t,o,i);if(!n)throw new Error(`hypercms: missing template for scalar at "${t.join(".")}"`);let a=ya(e,i,t,l);a==="@number"&&o==="@scalar"&&console.info(`[hypercms] field "${t.join(".")}" declares component "@number" but its value isn't a plain number; rendering a text input so the value is preserved`),(a==="@checkbox"||a==="@toggle")&&o==="@scalar"&&console.info(`[hypercms] field "${t.join(".")}" declares component "${a}" but its value isn't true/false; rendering a text input so the value is preserved`),lo(n,a===o?a:null,t);let s=he(n,i);_e(s,t);let h=n.getAttribute?.("data-hcms-tpl");if((o==="@select"||o==="@radio")&&h===o&&as(s,e,t,r,i,o,l),o==="@variant"&&h==="@variant"){let d=Qe(e,i,t,l);d||oo(s,"data-hcms-options required (value:icon tokens)"),is(s,{tokens:d,value:r,name:Er(t.join(".")),doc:i})===0&&s.querySelector(".hcms-variant-option")?.remove()}if(o==="@image"&&h==="@image"){let d=Sa(e,i,t,l);d!=null&&!s.hasAttribute("data-hcms-crop")&&s.setAttribute("data-hcms-crop",d)}return ds(s,ie(t)),At(s,ie(t)),_t(s,ie(t)),mo(s,r),o==="@color"&&h==="@color"&&Da(s,{value:r,tokens:Qe(e,i,t,l),path:t.join("."),doc:i}),o==="@font"&&h==="@font"&&Za(s,{value:r,tokens:Qe(e,i,t,l),path:t.join("."),doc:i}),o==="@file"&&ss(s),s}function lo(e,t,r){if(!t)return;let i=e.getAttribute?.("data-hcms-tpl");i&&i!==t&&console.info(`[hypercms] field "${r.join(".")}" declares component "${t}" but custom template "${i}" wins`)}function as(e,t,r,i,l,o,n){let a=Qe(t,l,r,n),s=a?[...a]:[],h=i==null?"":String(i);if(h!==""&&!s.includes(h)&&s.unshift(h),!a&&(oo(e,"data-hcms-options required (space-separated values)"),s.length===0)){e.querySelector(".mirk-radio")?.remove();return}if(o==="@select"){let m=e.querySelector("select[data-hcms-field]");if(!m)return;for(let u of s){let c=l.createElement("option");c.value=u,c.textContent=Ie(u),m.appendChild(c)}return}let d=e.querySelector(".mirk-radio");if(!d||!d.parentNode)return;let f=Er(r.join("."));for(let m of s){let u=d.cloneNode(!0),c=u.querySelector('input[type="radio"]');c&&(c.value=m,c.name=f);let p=u.querySelector(".mirk-radio__label");p&&(p.textContent=Ie(m)),d.parentNode.insertBefore(u,d)}d.remove()}function Er(e){return"hcms-"+String(e).replace(/[^A-Za-z0-9_-]/g,"-")}function oo(e,t){let r=e.querySelector?e.querySelector(".hcms-error"):null;r&&(r.textContent=t,r.hidden=!1)}function ss(e){let t=e.querySelector?e.querySelector("a.mirk-file__name[data-hcms-field]"):null;t&&(t.textContent=ro(t.getAttribute("href")))}function cs(e,t,r,i,l){let o=Ae(t,"@object",i);if(!o)throw new Error(`hypercms: missing template for object at "${t.join(".")}"`);let n=he(o,i);if(_e(n,t),At(n,ie(t)),_t(n,ie(t)),yt(o))return fo(n,e,t),po(n,e,r),n;let a=Et(n,".hcms-object-fields",o,t);for(let[s,h]of io(e,t,i,l)){let d=r==null?null:r[s],f=wt(h,[...t,s],d,i,l);f&&a.appendChild(f)}return t.length&&!a.children.length&&Object.keys(e).length?null:n}function hs(e,t,r,i,l){let o=Ae(t,"@object-array",i);if(!o)throw new Error(`hypercms: missing template for object-array at "${t.join(".")}"`);let n=he(o,i);_e(n,t),At(n,ie(t)),_t(n,ie(t)),co(n,o),uo(n,o,t);let a=Et(n,".hcms-array-items",o,t),[,s]=e;return(Array.isArray(r)?r:[]).forEach((h,d)=>{let f=no(s,[...t,d],h,i,l);f&&a.appendChild(f)}),ho(n),n}function no(e,t,r,i,l){let o=so(t,"object-array-item",i);if(!o)throw new Error(`hypercms: missing item template for "${t.join(".")}"`);let n=he(o,i);if(n.setAttribute("data-hcms-card",""),n.classList.contains("hcms-card")||n.classList.add("hcms-card"),_e(n,t),yt(o))return e&&typeof e=="object"&&!Array.isArray(e)&&(fo(n,e,t),po(n,e,r)),n;let a=Et(n,".hcms-card-fields",o,t);if(e&&typeof e=="object"&&!Array.isArray(e))for(let[s,h]of io(e,t,i,l)){let d=r==null?null:r[s],f=wt(h,[...t,s],d,i,l);f&&a.appendChild(f)}return n}function us(e,t,r,i){let l=gr(e,i),o=zl(e,t,i),n=l?l.array:"@scalar-array",a=Ae(t,n,i);if(!a)throw new Error(`hypercms: missing template for scalar-array at "${t.join(".")}"`);lo(a,l?l.array:null,t);let s=he(a,i);_e(s,t),At(s,ie(t)),_t(s,ie(t)),co(s,a),uo(s,a,t),o&&s.setAttribute("data-hcms-item-tpl",o.item);let h=Et(s,".hcms-array-items",a,t);return(Array.isArray(r)?r:[]).forEach((d,f)=>{let m=ao([...t,f],d,i,o?o.item:null);m&&h.appendChild(m)}),ho(s),s}function ao(e,t,r,i){let l=so(e,"scalar-array-item",r,i);if(!l)throw new Error(`hypercms: missing item template for "${e.join(".")}"`);let o=he(l,r);return o.setAttribute("data-hcms-array-item",""),o.classList.contains("hcms-array-item")||o.classList.add("hcms-array-item"),_e(o,e),mo(o,t),o}function so(e,t,r,i){let l=e.map(o=>typeof o=="number"?"*":o).join(".");return ee(r,l)||i&&ee(r,i)||ee(r,"@"+t)}function he(e,t){let r=e.content||e,i=t.createElement("div");return i.appendChild(r.cloneNode(!0)),i.firstElementChild||i}function _e(e,t){e.setAttribute("data-hcms-path",t.join(".")),e.setAttribute("data-hcms-path-shape",br(t))}function ds(e,t){let r=t==null?"":String(t);if(e.matches&&e.matches("[data-hcms-field]")){e.getAttribute("data-hcms-field")||e.setAttribute("data-hcms-field",r);return}(e.querySelectorAll?e.querySelectorAll("[data-hcms-field]"):[]).forEach(i=>{i.getAttribute("data-hcms-field")||i.setAttribute("data-hcms-field",r)})}function At(e,t){t==null||t===""||!e.setAttribute||e.hasAttribute?.("data-hcms-field")||e.setAttribute("data-hcms-field",String(t))}function _t(e,t){t==null||t===""||(e.querySelectorAll?e.querySelectorAll("[data-hcms-label]"):[]).forEach(r=>{(r.textContent||"").trim()===""&&(r.textContent=Ie(String(t)))})}function co(e,t){["data-hcms-no-add","data-hcms-no-remove","data-hcms-no-reorder"].forEach(r=>{t.hasAttribute(r)&&e.setAttribute(r,"")}),["data-hcms-min-items","data-hcms-max-items"].forEach(r=>{t.hasAttribute(r)&&e.setAttribute(r,t.getAttribute(r))})}function ho(e){let t=e.querySelector?e.querySelector(".hcms-array-items"):null;if(!t)return;let r=Array.from(t.querySelectorAll(":scope > [data-hcms-card], :scope > [data-hcms-array-item]")),i=r.length,l=Ci(e,"data-hcms-max-items"),o=Ci(e,"data-hcms-min-items"),n=e.hasAttribute("data-hcms-no-add"),a=e.hasAttribute("data-hcms-no-remove"),s=e.hasAttribute("data-hcms-no-reorder"),h=e.querySelector('[data-hcms-action="add"]');h&&(h.hidden=n||l!=null&&i>=l),r.forEach((d,f)=>{let m=d.querySelector('[data-hcms-action="remove"]');m&&(m.hidden=a||o!=null&&i<=o);let u=d.querySelector('[data-hcms-action="move-up"]');u&&(u.hidden=s||f===0);let c=d.querySelector('[data-hcms-action="move-down"]');c&&(c.hidden=s||f===i-1)})}function Ci(e,t){if(!e||!e.hasAttribute(t))return null;let r=parseInt(e.getAttribute(t),10);return Number.isFinite(r)?r:null}function uo(e,t,r){if(e.hasAttribute("data-hcms-no-reorder")||t.hasAttribute("data-hcms-no-reorder"))return;let i=e.querySelector(".hcms-array-items");if(!i)return;let l="hcms-"+r.join(".");i.setAttribute("sortable",l),i.setAttribute("onsorted","hypercmsCommit && hypercmsCommit()")}function ie(e){return e.length?e[e.length-1]:null}function mo(e,t){let r=ms(e);if(r.length!==0)for(let i of r)go(i,t)}function ms(e){if(!e)return[];let t=[];return e.matches?.("[data-hcms-field]")&&ps(e)&&t.push(e),(e.querySelectorAll?e.querySelectorAll("input[data-hcms-field], textarea[data-hcms-field], select[data-hcms-field], img[data-hcms-field], a[data-hcms-field], [contenteditable][data-hcms-field]"):[]).forEach(r=>t.push(r)),t}function ps(e){let t=(e.tagName||"").toUpperCase();return!!(t==="INPUT"||t==="TEXTAREA"||t==="SELECT"||t==="IMG"||t==="A"||e.hasAttribute?.("contenteditable"))}function po(e,t,r){(e.querySelectorAll?e.querySelectorAll("[data-hcms-field]"):[]).forEach(i=>{let l=i.getAttribute("data-hcms-field");if(!l)return;if(!t||typeof t!="object"||!(l in t)){console.warn(`[hypercms] inline template field "${l}" is not in the rule shape; ignoring`);return}let o=r==null?null:r[l];go(i,o)})}function fo(e,t,r){e.querySelectorAll&&e.querySelectorAll("[data-hcms-field]").forEach(i=>{let l=i.getAttribute("data-hcms-field");if(!l||t&&typeof t=="object"&&!(l in t))return;let o=[...r,l].join(".");i.setAttribute("data-hcms-path",o),i.setAttribute("data-hcms-path-shape",br([...r,l]))})}function Et(e,t,r,i){if(!e.querySelector)return e;let l=e.querySelector(t);if(l)return l;let o=r?.getAttribute?.("data-hcms-tpl")||i.join(".");throw new Error(`hypercms: template "${o}" is in slotted mode but has no ${t} element`)}function go(e,t){let r=kr(e),i=(e.tagName||"").toUpperCase(),l=(e.getAttribute("type")||"").toLowerCase();if(i==="INPUT"&&l==="radio"){e.checked=e.value!=null&&String(e.value)===String(t??"");return}if(r==="checked"){e.checked=t===!0||t==="true";return}if(r){e[r]=t==null?"":String(t);return}e.textContent=t==null?"":String(t)}var fs={Mutation:(e,t)=>e?.Mutation??t?.Mutation,undo:(e,t)=>e?.undo??t?.undo,onPrepareForSave:(e,t)=>e?.addDocumentTransform??t?.onPrepareForSave,onSnapshot:(e,t)=>e?.onSnapshot??t?.onSnapshot,consent:(e,t)=>e?.confirm??t?.consent,RichClay:(e,t)=>e?.RichClay??t?.RichClay,quickcrop:(e,t)=>e?.quickcrop??t?.quickcrop,upload:(e,t)=>e?.upload??(t?.uploadFileBasic?bs(t.uploadFileBasic):null)},gs={402:"payment-required",413:"too-large",415:"unsupported-type",401:"unauthorized",403:"forbidden",404:"not-found"},Nt=()=>({ok:!1,msg:"Upload cancelled",msgType:"skipped",code:"aborted",uploads:[]});function bs(e){return async function(t,{onProgress:r,signal:i}={}){if(i?.aborted)return Nt();try{let l=await e(t,{onProgress:n=>{r?.({loaded:null,total:null,percent:n})}});if(i?.aborted)return Nt();let o=l&&l.uploads||[];return typeof o[0]?.url!="string"?{ok:!1,msg:"The host accepted the file but did not say where it put it",msgType:"error",code:"bad-response",uploads:[]}:{ok:!0,msg:l.msg||"Uploaded",msgType:l.msgType||"success",code:l.code||null,uploads:o}}catch(l){if(i?.aborted)return Nt();let o={};try{o=JSON.parse(l?.response||"{}")}catch{o={}}let n=o.code||gs[l?.status]||"error";return{ok:!1,msg:l&&l.message||"Upload failed",msgType:"error",code:n,uploads:[]}}}}function J(e,t){let r=fs[e];if(!r)throw new Error(`hypercms: unknown platform capability "${e}"`);let i=t||(typeof window<"u"?window:null);return i&&r(i.clay,i.hyperclay)||null}var ks=["clay:mutation-ready","hyperclay:mutation-ready"],vs=["clay:sync-applied","hyperclay:livesync-applied"],ys=["clay:ready","hyperclay:ready"];function Sr(e,t,r){let i=null,l=o=>{i!==null&&i!==o.type||(i=o.type,queueMicrotask(()=>{i=null}),r(o))};for(let o of t)e.addEventListener(o,l);return()=>{for(let o of t)e.removeEventListener(o,l)}}var le="data-hcms-bound",ye="data-hcms-bound-id",Cr=new Map;function xs(e,t){Cr.set(e,t)}function ws(e){Cr.delete(e)}function As(e){let t=e.getAttribute(ye);if(!t)return null;let r=Cr.get(t);return!r||!r.restorable()?null:r.originalHTML}var xe="data-hcms-owns-richclay";function St(e){return e&&e.richclay&&e.richclay.RichClay||J("RichClay",e)||(e&&typeof e.RichClay=="function"?e.RichClay:null)}function _s(e,t,r){!e||typeof e.setAttribute!="function"||(e.setAttribute(le,t?"rich":"plain"),r&&e.setAttribute(xe,"true"))}function Es(e,t){if(!e||typeof e.querySelectorAll!="function")return;let r=e.querySelectorAll(`[${le}]`);if(!r.length)return;let i=St(t);if(i&&typeof i.stripFromClone=="function")try{i.stripFromClone(e)}catch(l){console.warn("[hypercms] richclay strip failed; editor state may reach the save",l)}for(let l of r)l.getAttribute(xe)==="true"&&l.removeAttribute("data-richclay"),l.removeAttribute(xe),l.removeAttribute(le)}function Ss(e,t){if(!e||typeof e.removeAttribute!="function")return;let r=St(t);if(r&&typeof r.stripElement=="function")try{r.stripElement(e)}catch(i){console.warn("[hypercms] richclay element strip failed; the clone stays editable",i)}else e.removeAttribute("contenteditable"),e.removeAttribute("no-undo");e.getAttribute(xe)==="true"&&e.removeAttribute("data-richclay"),e.removeAttribute(xe),e.removeAttribute(le),e.removeAttribute(ye)}function Cs(e,t){if(!t||e==null)return e;return r(e);function r(i){if(typeof i=="string"){if(i.endsWith("[]")||P(i)!==-1)return i;let l=null;try{l=t.querySelector(i)}catch{return i}return l&&l.children.length>0?i+"@innerHTML":i}if(Array.isArray(i))return i;if(i&&typeof i=="object"){let l=Object.create(null);for(let[o,n]of Object.entries(i))l[o]=r(n);return l}return i}}function Ts(e,t){if(!t||e==null)return e;return r(e,[t]);function r(i,l){if(typeof i=="string")return i.endsWith("[]")||P(i)!==-1?i:l.some(o=>Rs(o,i))?i+"@innerHTML":i;if(Array.isArray(i)){let[o,n]=i;if(typeof o!="string"||!o)return i;let a=qs(t,o);return a.length?[o,r(n,a)]:i}if(i&&typeof i=="object"){let o=Object.create(null);for(let[n,a]of Object.entries(i))o[n]=r(a,l);return o}return i}}function Rs(e,t){let r=null;try{r=e.querySelector(t)}catch{return!1}return r?r.hasAttribute(le)?r.getAttribute(le)==="rich":r.children.length>0:!1}function qs(e,t){try{return[...e.querySelectorAll(t)]}catch{return[]}}function at(e){if(!e||e.tagName!=="TEXTAREA")return;let t=e.ownerDocument.defaultView||(typeof window<"u"?window:null);t&&t.CSS&&t.CSS.supports&&t.CSS.supports("field-sizing: content")||(e.style.height="auto",e.style.height=e.scrollHeight+"px")}function Ct(e,t,r=!0){if(!e||!e.querySelectorAll||(e.querySelectorAll("textarea[data-hcms-field]").forEach(at),r===!1))return;let i=t&&t.defaultView||(typeof window<"u"?window:null),l=St(i);l&&e.querySelectorAll("[contenteditable][data-hcms-field]").forEach(o=>{if(o.__hcmsRichclay)return;let n;try{n=new l(o,{inline:!0,hyperclay:!1,toolbar:["bold","italic","link","undo","redo"]})}catch(s){console.warn("[hypercms] richclay activation failed; field stays plain contenteditable",s);return}o.__hcmsRichclay=n;let a=n&&n.squire;a&&typeof a.addEventListener=="function"&&a.addEventListener("input",()=>{let s=i&&i.Event||Event;o.dispatchEvent(new s("input",{bubbles:!0}))})})}var bo="link[data-hcms-fonts]",$s="link[data-hcms-fonts-preconnect]";function Os(e,t,r){let i=[],l=!1;return o(e,t,[]),{stacks:i,found:l};function o(n,a,s){if(typeof n=="string"){if(n.endsWith("[]")||He(n,r,s,e)!=="@font")return;l=!0,a!=null&&a!==""&&i.push(String(a));return}if(Array.isArray(n)){let h=Array.isArray(a)?a:[];h.forEach(d=>o(n[1],d,[...s,"*"])),h.length||o(n[1],void 0,[...s,"*"]);return}if(n&&typeof n=="object")for(let[h,d]of Object.entries(n))o(d,a?.[h],[...s,h])}}function Ls(e,t){let r=e?.head;if(!r)return;let i=r.querySelector(bo),l=r.querySelector($s);if(!t){i?.remove(),l?.remove();return}l||(l=e.createElement("link"),l.setAttribute("rel","preconnect"),l.setAttribute("href","https://fonts.gstatic.com"),l.setAttribute("crossorigin",""),l.setAttribute("data-hcms-fonts-preconnect",""),l.setAttribute("no-undo",""),r.appendChild(l)),i||(i=e.createElement("link"),i.setAttribute("rel","stylesheet"),i.setAttribute("data-hcms-fonts",""),i.setAttribute("no-undo",""),l.after(i)),i.hasAttribute("no-undo")||i.setAttribute("no-undo",""),l.hasAttribute("no-undo")||l.setAttribute("no-undo",""),i.getAttribute("href")!==t&&i.setAttribute("href",t)}function Tr(e,t){if(!e?.doc||e.pageRules==null)return;let{stacks:r,found:i}=Os(e.pageRules,t,e.doc);if(!i)return;let l=e.doc.head?.querySelector(bo)?.getAttribute("href")||null,o=Ql(r,l);o&&l&&Wa(l,o)||Ls(e.doc,o)}var zt=new WeakSet;function Ue(e,t){let r=J("undo");if(!r)return t();r.pause();try{let i=t();return i&&i.ok?r.commitCaptured(e):r.discardCaptured(),i}finally{r.resume()}}function Ee(e){let t=J("undo");if(!t)return e();t.pause();try{return e()}finally{t.discardCaptured(),t.resume()}}function ko(e){let{formRoot:t}=e;if(!t||zt.has(t))return;zt.add(t);let r=n=>{let a=n.target;!a||!a.closest||a.closest("[data-hcms-form-root]")&&(a.matches("[data-hcms-color-input]")||a.matches("input, textarea, select, [contenteditable][data-hcms-field]")&&(a.tagName==="TEXTAREA"&&at(a),!a.matches('input[type="file"]')&&(!a.closest("[data-hcms-field]")&&!a.hasAttribute?.("data-hcms-field")||Le(a,e))))},i=n=>{let a=n.target;if(!(!a||!a.closest)&&a.closest("[data-hcms-form-root]")){if(a.matches("[data-hcms-color-input]")){let s=Ua(a);s&&Le(s,e);return}if(a.matches('input[type="file"][data-hcms-upload]')){Is(a,e);return}a.matches('input[type="checkbox"], input[type="radio"], select')&&Le(a,e)}},l=n=>{let a=n.target;if(!a||!a.closest)return;let s=a.closest("[data-hcms-action]");if(!s)return;let h=s.getAttribute("data-hcms-action");if(h==="add"||h==="remove"||h==="move-up"||h==="move-down"||h==="clear-upload"||h==="color-pick"||h==="color-clear"||h==="color-panel"||h==="font-pick"||h==="font-panel"){if(!s.closest("[data-hcms-form-root]"))return}else if(h==="close"&&!s.closest("[data-hcms-shell]"))return;if(h==="add"){let d=s.closest("[data-hcms-path]");if(!d)return;let f=d.getAttribute("data-hcms-path");Rr(f,e)}else if(h==="remove"){let d=s.closest("[data-hcms-card], [data-hcms-array-item]");if(!d)return;wo(d,e)}else if(h==="move-up"||h==="move-down"){let d=s.closest("[data-hcms-card], [data-hcms-array-item]");if(!d)return;xo(d,h==="move-up"?-1:1,e)}else if(h==="clear-upload")Vs(s,e);else if(h==="color-pick"||h==="color-clear"){let d=h==="color-pick"?Ia(s):Pa(s);d&&Le(d,e)}else if(h==="color-panel")Ha(s);else if(h==="font-pick"){let d=es(s);d&&Le(d,e)}else h==="font-panel"?Ya(s):h==="close"&&e.onCloseRequested?.()},o=t.ownerDocument;o.addEventListener("input",r,!0),o.addEventListener("change",i,!0),o.addEventListener("click",l,!0),e.detachEvents=()=>{o.removeEventListener("input",r,!0),o.removeEventListener("change",i,!0),o.removeEventListener("click",l,!0),zt.delete(t)}}var js=new Set(["value","checked"]);function Ms(e,t){if(!t)return null;let r=ve(t);if(r.some(s=>typeof s=="number"||s==="*"))return null;let i=Be(e.pageRules,r);if(typeof i!="string")return null;let l=G.ruleAttrIndex(i);if(l===-1)return null;let o=i.slice(l+1);if(!js.has(o))return null;let n=i.slice(0,l),a=n?e.pageRoot.querySelector(n):se(e.pageRoot);return a?{el:a,prop:o,oldValue:a[o]}:null}function Le(e,t){let r=(e.closest("[data-hcms-field]")||e).closest("[data-hcms-path]")?.getAttribute("data-hcms-path")||"",i=Ms(t,r);if(te(Z(t),{path:r,structural:!1},t),i){let l=J("undo");l&&typeof l.recordValue=="function"&&l.recordValue(i.el,{prop:i.prop,oldValue:i.oldValue,newValue:i.el[i.prop]})}}var Ns={type:"image/webp",quality:.85,maxWidth:2048,maxHeight:2048};async function zs(e,t){let r=t&&t.getAttribute?t.getAttribute("data-hcms-crop"):null;if(r==null)return{file:e};let i=J("quickcrop");if(typeof i!="function")return{file:e};try{let l=typeof window<"u"&&(window.clay?.modal??window.themodal)||"auto",o=await i(e,{aspect:Fs(r),modal:l,...Ns});return o===null?null:{file:Ds(o.blob,e.name),dataURL:o.dataURL}}catch(l){return we(t,l&&l.message||"Crop failed"),null}}function Fs(e){let t=String(e??"").trim().toLowerCase();if(t===""||t==="free")return null;let r=t.match(/^(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)$/);if(!r)return null;let i=parseFloat(r[1]),l=parseFloat(r[2]);return!i||!l?null:i/l}function Ds(e,t){let r=e.type==="image/webp"?".webp":e.type==="image/jpeg"?".jpg":".png",i=String(t||"image").replace(/\.[^.]+$/,"");try{return new File([e],i+r,{type:e.type})}catch{return e}}var Bs=new Set(["unsupported","payment-required"]);async function Is(e,t){let r=e.files&&e.files[0];if(!r)return;let i=e.closest("[data-hcms-path]");if(!i)return;let l=i.getAttribute("data-hcms-path")||"";we(i,null);let o=await zs(r,i);if(!o||t.closed){oe(e);return}let n=o.file,a=o.dataURL||null,s=J("upload");if(typeof s!="function")return Ft(e,i,t,l,await Ti(n,a,i),n);yo(i,a),Ri(i,0);let h=Hs(t),d;try{d=await s(n,{signal:h?.signal,onProgress:({percent:m})=>Ri(i,m)})}finally{Us(t,h),Gs(i)}if(t.closed){oe(e);return}if(d.code==="aborted"){oe(e);return}if(d.ok)return Ft(e,i,t,l,d.uploads[0].url,n);if(!Bs.has(d.code)){we(i,d.msg||"Upload failed"),t.dispatch?.("hcms:error",{error:new Error(d.msg||"Upload failed"),code:d.code,path:l}),oe(e);return}let f=d.code==="payment-required"?"This file is stored in the page. Add a paid plan to upload files.":null;return Ft(e,i,t,l,await Ti(n,a,i),n,f)}function Ft(e,t,r,i,l,o,n=null){if(r.closed){oe(e);return}if(yo(t,null),we(t,null),!l){oe(e);return}vo(t,l,o.name),te(Z(r),{path:i,structural:!1},r),n&&we(t,n,"info"),oe(e)}async function Ti(e,t,r){return t||await Ps(e,r)}function Ps(e,t){let r=t?.ownerDocument?.defaultView?.FileReader||globalThis.FileReader;return r?new Promise(i=>{let l=new r;l.onload=()=>i(typeof l.result=="string"?l.result:""),l.onerror=()=>i("");try{l.readAsDataURL(e)}catch{i("")}}):Promise.resolve("")}function Hs(e){if(typeof AbortController!="function")return null;let t=new AbortController;return(e.uploads||(e.uploads=new Set)).add(t),t}function Us(e,t){t&&e.uploads?.delete(t)}function Vs(e,t){let r=e.closest("[data-hcms-path]");if(!r)return;let i=r.getAttribute("data-hcms-path")||"";vo(r,"","");let l=r.querySelector('input[type="file"][data-hcms-upload]');l&&oe(l),we(r,null),te(Z(t),{path:i,structural:!1},t)}function Ws(e){return e.querySelector?e.querySelector("img[data-hcms-field], a[data-hcms-field]"):null}function vo(e,t,r){let i=Ws(e);if(!i)return;let l=(i.tagName||"").toUpperCase();l==="IMG"?i.src=t||"":l==="A"&&(i.href=t||"",i.textContent=t?r||ro(t):"")}function oe(e){try{e.value=""}catch{}}function yo(e,t){let r=e.querySelector?e.querySelector(".mirk-image__frame"):null;r&&(t?r.style.backgroundImage=`url("${t.replace(/"/g,"%22")}")`:r.style.removeProperty("background-image"))}function Ri(e,t){let r=Math.max(0,Math.min(100,Number(t)||0));e.setAttribute("data-hcms-uploading",""),e.style?.setProperty?.("--hcms-upload-progress",`${r}%`)}function Gs(e){e.removeAttribute("data-hcms-uploading"),e.style?.removeProperty?.("--hcms-upload-progress")}function we(e,t,r="error"){let i=e.querySelector?e.querySelector(":scope > .hcms-error"):null;i&&(i.classList.toggle("hcms-error--info",!!t&&r==="info"),t?(i.textContent=t,i.hidden=!1):(i.textContent="",i.hidden=!0))}function Rr(e,t){let{formRoot:r,pageRules:i}=t,l=r.querySelector(`[data-hcms-path="${Se(e)}"]`);if(!l)throw new Error(`hypercms: no element at path "${e}"`);let o=l.querySelector(".hcms-array-items");if(!o)throw new Error(`hypercms: array container missing .hcms-array-items at "${e}"`);let n=ve(e),a=Qs(i,n),s=Array.isArray(a),h=typeof a=="string"&&a.endsWith("[]");if(!s&&!h)throw new Error(`hypercms: path "${e}" is not an array`);let d=st(l,"data-hcms-max-items"),f=o.querySelectorAll(":scope > [data-hcms-card], :scope > [data-hcms-array-item]");if(l.hasAttribute("data-hcms-no-add")||d!=null&&f.length>=d)return;let m=f.length,u=s?a[1]:a.replace(/\[\]$/,""),c=mr(s?u:"string"),p=os({shape:s?"object-array-item":"scalar-array-item",itemShape:u,pathArr:[...n,m],data:c,doc:t.doc,itemKey:l.getAttribute("data-hcms-item-tpl")||null,pageRules:i});return o.appendChild(p),Ct(p,t.doc,t.view?.enhanceFormRichText!==!1),qr(l),Ue(`Add ${e}`,()=>te(Z(t),{path:e,structural:!0},t))}function xo(e,t,r){let i=e.closest('[data-hcms-shape="object-array"], [data-hcms-shape="scalar-array"]');if(!i||i.hasAttribute("data-hcms-no-reorder"))return;let l=i.querySelector(".hcms-array-items");if(!l)return;let o=Array.from(l.querySelectorAll(":scope > [data-hcms-card], :scope > [data-hcms-array-item]")),n=o.indexOf(e);if(n<0)return;let a=n+t;if(a<0||a>=o.length)return;let s=e.querySelector(`[data-hcms-action="${t<0?"move-up":"move-down"}"]`);return t<0?l.insertBefore(e,o[a]):l.insertBefore(e,o[a].nextSibling),$r(l),qr(i),s&&typeof s.focus=="function"&&e.querySelector(`[data-hcms-action="${t<0?"move-up":"move-down"}"]`)?.focus?.(),Ue(`Reorder ${i.getAttribute("data-hcms-path")||""}`,()=>te(Z(r),{path:i.getAttribute("data-hcms-path")||"",structural:!0},r))}var Dt="Delete this item?";function Js(e,t){let r=e&&e.getAttribute("data-hcms-confirm-remove");if(r!=null)return/^(off|false|no|0)$/i.test(r.trim())?null:r||Dt;let i=t&&t.confirmRemove;return i===!1?null:typeof i=="string"?i||Dt:i===!0||e&&e.getAttribute("data-hcms-shape")==="object-array"?Dt:null}function wo(e,t){let r=e.closest('[data-hcms-shape="object-array"], [data-hcms-shape="scalar-array"]'),i=Js(r,t);if(i==null)return je(e,t);let l=J("consent")||typeof window<"u"&&window.consent;typeof l=="function"?Promise.resolve(l(i)).then(()=>{t.closed||je(e,t)},()=>{}):typeof window<"u"&&typeof window.confirm=="function"?window.confirm(i)&&je(e,t):je(e,t)}function je(e,t){let r=e.getAttribute("data-hcms-path")||"",i=e.parentElement,l=e.closest('[data-hcms-shape="object-array"], [data-hcms-shape="scalar-array"]');if(!l?.hasAttribute("data-hcms-no-remove")){if(l){let o=st(l,"data-hcms-min-items"),n=l.querySelector(".hcms-array-items"),a=n?n.querySelectorAll(":scope > [data-hcms-card], :scope > [data-hcms-array-item]").length:0;if(o!=null&&a<=o)return}return e.remove(),i&&$r(i),l&&qr(l),Ue(`Remove ${r}`,()=>te(Z(t),{path:r,structural:!0},t))}}function te(e,t,r){if(r.closed)return{ok:!1,skipped:!0,closed:!0};let i=ct(e);if(!t.structural&&i===r.lastFingerprint)return{ok:!0,skipped:!0};let l=Object.hasOwn(r,"writeRules")?r.writeRules:r.pageRules,o=sa(r.pageRoot,l,e,{shellRoot:r.shellRoot,structural:!!t.structural,structuralPath:t.path||null,formRoot:r.formRoot});return o.ok?(r.lastFingerprint=i,r.lastData=e,Tr(r,e),qi(r,null),r.dispatch?.("hcms:change",{data:e,path:t.path,structural:!!t.structural}),r.onChange?.(e,t)):(qi(r,Zs(o.error,t.path)),r.dispatch?.("hcms:error",{error:o.error,attemptedData:e}),r.onError?.(o.error)),o}function Ao(e,t){let r=Se(t),i=`[data-hcms-path="${r}"] input[data-hcms-field], [data-hcms-path="${r}"] textarea[data-hcms-field], [data-hcms-path="${r}"] select[data-hcms-field], [data-hcms-path="${r}"] img[data-hcms-field], [data-hcms-path="${r}"] a[data-hcms-field], [data-hcms-path="${r}"] [contenteditable][data-hcms-field], input[data-hcms-path="${r}"][data-hcms-field], textarea[data-hcms-path="${r}"][data-hcms-field], select[data-hcms-path="${r}"][data-hcms-field], img[data-hcms-path="${r}"][data-hcms-field], a[data-hcms-path="${r}"][data-hcms-field], [contenteditable][data-hcms-path="${r}"][data-hcms-field]`;return e.querySelector(i)}function _o(e,t,r,i){let l=(e.tagName||"").toUpperCase(),o=(e.getAttribute("type")||"").toLowerCase();if(l==="INPUT"&&o==="checkbox"){e.checked=t===!0||t==="true";return}if(l==="INPUT"&&o==="radio"){let n=Se(i),a=r.querySelectorAll(`[data-hcms-path="${n}"][data-hcms-field][type="radio"], [data-hcms-path="${n}"] [data-hcms-field][type="radio"]`);a.length?a.forEach(s=>{s.checked=String(s.value)===String(t??"")}):e.checked=String(e.value)===String(t??"");return}if(l==="IMG"){e.src=t==null?"":String(t);return}if(l==="A"){e.href=t==null?"":String(t);return}if(e.hasAttribute&&e.hasAttribute("contenteditable")){e.innerHTML=t==null?"":String(t);return}if("value"in e){e.value=t==null?"":String(t);return}e.textContent=t==null?"":String(t)}function Z(e){let t=G.extract(e.formRoot,e.formRules,{exclude:null});return ce(t,e.formRules)}function ce(e,t){if(t==null||e==null)return e;if(typeof t=="string")return t.endsWith("@checked")?e===!0||e==="true":e;if(Array.isArray(t)){if(!Array.isArray(e))return e;let[,r]=t;return e.map(i=>ce(i,r))}if(typeof t=="object"){if(typeof e!="object"||Array.isArray(e))return e;let r={};for(let[i,l]of Object.entries(t))r[i]=ce(e[i],l);return r}return e}function qi(e,t){e.lastErrors=t&&t.length?t:null,Eo(e)}function Eo(e){if(Xs(e),e.errorEl&&(e.errorEl.textContent="",e.errorEl.hidden=!0),!e.lastErrors)return;let t=[];for(let{message:r,path:i}of e.lastErrors){if(i!=null&&i!==""){let l=Ks(e.formRoot,i);if(l){l.textContent=l.textContent?`${l.textContent}
${r}`:r,l.hidden=!1;continue}}t.push(r)}t.length&&e.errorEl&&(e.errorEl.textContent=t.join(`
`),e.errorEl.hidden=!1)}function Xs(e){if(e.formRoot)for(let t of e.formRoot.querySelectorAll(".hcms-error"))t.textContent="",t.hidden=!0}function Ks(e,t){if(!e)return null;let r=t.split(".");for(;r.length>0;){let i=r.join("."),l=typeof CSS<"u"&&CSS.escape?CSS.escape(i):i.replace(/[^a-zA-Z0-9_\-.*]/g,n=>"\\"+n),o=e.querySelector(`[data-hcms-path="${l}"]`);if(o){for(let n of o.children)if(n.classList&&n.classList.contains("hcms-error"))return n}r.pop()}return null}function Zs(e,t){return e?e.name==="EmptyListInsert"?[{message:"Add a seed item in HTML first.",path:t}]:e.name==="ShapeMismatch"&&Array.isArray(e.mismatches)&&e.mismatches.length?e.mismatches.map(r=>({message:`Shape mismatch: expected ${r.expected}, got ${r.got}`,path:r.path})):[{message:e.message||String(e),path:t}]:[{message:"unknown error",path:t}]}function Qs(e,t){let r=e;for(let i of t){if(r==null||typeof r=="string")return;if(Array.isArray(r)){if(typeof i!="number"&&i!=="*")return;r=r[1];continue}if(typeof r=="object"){if(typeof i=="number"||!(i in r))return;r=r[i];continue}return}return r}function st(e,t){if(!e||!e.hasAttribute(t))return null;let r=parseInt(e.getAttribute(t),10);return Number.isFinite(r)?r:null}function qr(e){if(!e)return;let t=e.querySelector(".hcms-array-items");if(!t)return;let r=Array.from(t.querySelectorAll(":scope > [data-hcms-card], :scope > [data-hcms-array-item]")),i=r.length,l=st(e,"data-hcms-max-items"),o=st(e,"data-hcms-min-items"),n=e.hasAttribute("data-hcms-no-add"),a=e.hasAttribute("data-hcms-no-remove"),s=e.hasAttribute("data-hcms-no-reorder"),h=e.querySelector(':scope > .hcms-add, :scope > * > .hcms-add, :scope > [data-hcms-action="add"]');h&&(h.hidden=n||l!=null&&i>=l),r.forEach((d,f)=>{let m=d.querySelector('[data-hcms-action="remove"]');m&&(m.hidden=a||o!=null&&i<=o);let u=d.querySelector('[data-hcms-action="move-up"]');u&&(u.hidden=s||f===0);let c=d.querySelector('[data-hcms-action="move-down"]');c&&(c.hidden=s||f===i-1)})}function So(e){!e||!e.querySelectorAll||e.querySelectorAll(".hcms-array-items").forEach(t=>$r(t))}function $r(e){let t=e.querySelectorAll?Array.from(e.querySelectorAll('input[type="radio"][data-hcms-field]'),i=>[i,i.checked]):[],r=0;for(let i of e.children){if(!i.matches?.("[data-hcms-card], [data-hcms-array-item]"))continue;let l=i.getAttribute("data-hcms-path");if(!l)continue;let o=l.split(".");o[o.length-1]=String(r);let n=o.join(".");n!==l&&Ys(i,l,n),r++}for(let[i,l]of t)i.checked!==l&&(i.checked=l)}function Ys(e,t,r){let i=e.querySelectorAll("[data-hcms-path]");e.setAttribute("data-hcms-path",r);for(let l of i){let o=l.getAttribute("data-hcms-path");o===t?l.setAttribute("data-hcms-path",r):o&&o.startsWith(t+".")&&l.setAttribute("data-hcms-path",r+o.slice(t.length))}ec(e)}function ec(e){for(let t of e.querySelectorAll('input[type="radio"][data-hcms-field]')){if(!t.name||!t.name.startsWith("hcms-"))continue;let r=t.closest("[data-hcms-path]");r&&(t.name=Er(r.getAttribute("data-hcms-path")))}}function ct(e){return JSON.stringify(e,(t,r)=>{if(r&&typeof r=="object"&&!Array.isArray(r)){let i=Object.create(null);for(let l of Object.keys(r).sort())i[l]=r[l];return i}return r})}function Se(e){return typeof CSS<"u"&&CSS.escape?CSS.escape(e):String(e).replace(/[^a-zA-Z0-9_\-.*]/g,t=>"\\"+t)}var et="hcms-shell-styles",tc="hcms-bundled-styles-installed",Or="hcms-session-open",rc='a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',pe=new WeakSet,er="";function ic(e){er=e}function ht(e){e?.body?.classList.add(Or)}function Co(e){e?.body?.classList.remove(Or)}var lc=0;function $i(e){return String(e).replace(/[&<>"]/g,t=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[t])}function oc({mountTo:e,side:t="right",overlay:r=!1,showSaveButton:i=!1,title:l="Page content",eyebrow:o="Edit",theme:n=null,doc:a}){To(a);let s=`hcms-shell-title-${++lc}`,h=a.createElement("div");h.setAttribute("data-hcms-shell",""),h.setAttribute("editor-ui",""),h.setAttribute("save-remove",""),h.setAttribute("save-ignore",""),h.setAttribute("tabindex","-1"),h.setAttribute("role","dialog"),h.setAttribute("aria-modal","true"),h.setAttribute("aria-labelledby",s);let d=n==="dark"?" dark":n==="light"?" light":"";h.className="hcms-shell pixel-quiet hcms-panel hcms-side-"+t+(r?" hcms-overlay":"")+d;let f=$i(l),m=$i(o);h.innerHTML=`
    <div class="hcms-shell-minibar" aria-hidden="true">
      <span class="hcms-shell-minibar-title">${f}</span>
      <button type="button" class="hcms-shell-close mirk-button mirk-button--small" data-hcms-action="close" aria-label="Close">
        <span class="mirk-button__label">\xD7</span>
      </button>
    </div>
    <div class="hcms-shell-body">
      <header class="hcms-shell-header">
        <div class="hcms-shell-heading">
          <div class="hcms-shell-eyebrow">${m}</div>
          <h2 class="hcms-shell-title" id="${s}">${f}</h2>
        </div>
        <button type="button" class="hcms-shell-close mirk-button mirk-button--small" data-hcms-action="close" aria-label="Close">
          <span class="mirk-button__label">\xD7</span>
        </button>
      </header>
      <div class="hcms-shell-notice" role="status" hidden></div>
      <div class="hcms-shell-error" role="alert" hidden></div>
      <div data-hcms-form-root class="hcms-form"></div>
      <footer class="hcms-shell-footer"${i?"":" hidden"}>
        <button type="button" class="hcms-shell-save mirk-button" trigger-save>
          <span class="mirk-button__label">Save</span>
        </button>
      </footer>
    </div>
  `,(e||a.body).appendChild(h);let u=a.body;u.classList.add("hcms-open"),ht(a),r&&u.classList.add("hcms-overlay"),t==="left"&&u.classList.add("hcms-side-left");let c=ac(h,a),p=nc(h);return{root:h,formRoot:h.querySelector("[data-hcms-form-root]"),noticeEl:h.querySelector(".hcms-shell-notice"),errorEl:h.querySelector(".hcms-shell-error"),saveButton:h.querySelector(".hcms-shell-save"),destroy(){c.detach(),p.detach(),h.remove(),u.classList.remove("hcms-open","hcms-overlay","hcms-side-left"),Co(a)},restoreChrome(){Ve(a),u.classList.add("hcms-open"),ht(a),r&&u.classList.add("hcms-overlay"),t==="left"&&u.classList.add("hcms-side-left")}}}function Ve(e){e&&(e.getElementById(et)||e.querySelector("style[data-hcms-bundled-styles]")||(pe.delete(e),To(e)))}function To(e){if(e&&!pe.has(e)){if(e[tc]){pe.add(e);return}if(e.getElementById(et)||e.querySelector("style[data-hcms-bundled-styles]")){pe.add(e);return}if(er){let t=e.createElement("style");t.id=et,t.setAttribute("save-remove",""),t.setAttribute("save-ignore",""),t.textContent=er,(e.head||e.documentElement).appendChild(t),pe.add(e);return}try{let t=new URL("./theme.generated.css",import.meta.url).href,r=e.createElement("link");r.rel="stylesheet",r.id=et,r.setAttribute("save-remove",""),r.setAttribute("save-ignore",""),r.href=t,(e.head||e.documentElement).appendChild(r),pe.add(e)}catch{let t=()=>{link.isConnected&&console.warn("hypercms: shell stylesheet not applied \u2014 cssText is empty and the co-located theme fallback is unavailable. Call installStyles(themeText) before opening the CMS.")};e.defaultView?.queueMicrotask?e.defaultView.queueMicrotask(t):t()}}}function nc(e){let t=e.querySelector(".hcms-shell-body"),r=e.querySelector(".hcms-shell-header");if(!t||!r||typeof t.addEventListener!="function")return{detach(){}};let i=()=>{let l=(r.offsetHeight||0)-12;e.classList.toggle("is-condensed",t.scrollTop>l)};return t.addEventListener("scroll",i,{passive:!0}),i(),{detach(){t.removeEventListener("scroll",i)}}}function ac(e,t){function r(i){if(i.key!=="Tab"||!e.contains(t.activeElement))return;let l=Array.from(e.querySelectorAll(rc));if(l.length===0)return;let o=l[0],n=l[l.length-1];i.shiftKey&&t.activeElement===o?(i.preventDefault(),n.focus()):!i.shiftKey&&t.activeElement===n&&(i.preventDefault(),o.focus())}return t.addEventListener("keydown",r),{detach:()=>t.removeEventListener("keydown",r)}}var sc="[hypercms]",Oi={skip:"[data-hcms-shell]",templateAttr:"cms-template"},Li={skip:"[data-hcms-shell]",templateAttr:null},cc=class extends Error{constructor(e,t,r){super(`hypercms: rule at "${e}" has an invalid CSS selector: "${t}"`),this.name="InvalidRuleSelector",this.path=e,this.selector=t,this.cause=r}};function Ro(e,t){let r=[],i=[],l=[];return rr(ge(e),e,t,[],r,i,l),{missing:ji(r),twins:pc(i),readOnly:ji(l)}}function qo(e){return tr(e)}function tr(e){if(typeof e=="string")return $o(e)?void 0:e;if(Array.isArray(e)){let[t,r]=e;return[t,tr(r)]}if(e&&typeof e=="object"){let t={};for(let[r,i]of Object.entries(e)){let l=tr(i);l!==void 0&&(t[r]=l)}return t}return e}function rr(e,t,r,i,l,o,n){if(typeof r=="string"){let a=hc(r),s=a?Ke(e,t,a,Oi,i):[];if($o(r)){n.push(fe(i));return}if(!a)return;if(r.endsWith("[]")){s.length===0&&Ke(e,t,a,Li,i).length===0&&l.push(fe(i));return}s.length===0?l.push(fe(i)):s.length>1&&o.push({path:fe(i),count:s.length});return}if(Array.isArray(r)){let[a,s]=r;if(typeof a!="string"||!a)return;let h=Ke(e,t,a,Oi,i);if(h.length===0){Ke(e,t,a,Li,i).length===0&&l.push(fe(i));return}for(let d of h)rr(e,d,s,[...i,"*"],l,o,n);return}if(r&&typeof r=="object")for(let[a,s]of Object.entries(r))rr(e,t,s,[...i,a],l,o,n)}function Ke(e,t,r,i,l){try{return e.find(t,r,i)}catch(o){throw new cc(fe(l),r,o)}}function hc(e){if(e==="."||e.startsWith("@"))return null;if(e.endsWith("[]"))return e.slice(0,-2)||null;let t=P(e);return(t===-1?e:e.slice(0,t))||null}function uc(e){if(e.endsWith("[]"))return null;let t=P(e);return t===-1?null:e.slice(t+1)||null}function $o(e){let t=uc(e);return t!=null&&ol.has(t)}function Lr(e){dc(e),mc(e)}function dc(e){let t=e.noticeEl;if(!t)return;let r=e.unresolved&&e.unresolved.missing||[],i=e.unresolved&&e.unresolved.readOnly||[];if(r.length===0&&i.length===0){t.textContent="",t.hidden=!0;return}let l=[];if(r.length){let o=r.length===1?"1 field no longer matches this page":`${r.length} fields no longer match this page`;l.push(`${o}: ${r.join(", ")}`)}if(i.length){let o=i.length===1?"1 field reads a property the browser will not let anything write":`${i.length} fields read properties the browser will not let anything write`;l.push(`${o}: ${i.join(", ")}`)}t.textContent=l.join(`
`),t.hidden=!1}function mc(e){let t=e.unresolved&&e.unresolved.twins||[],r=t.map(i=>`${i.path}:${i.count}`).join("|");if(r!==e.lastTwinSignature){e.lastTwinSignature=r;for(let{path:i,count:l}of t)console.warn(`${sc} "${i}" matches ${l} elements; edits go to the first one.`)}}function ji(e){return[...new Set(e)]}function pc(e){let t=new Map;for(let r of e){let i=t.get(r.path);(!i||r.count>i.count)&&t.set(r.path,r)}return[...t.values()]}function fe(e){return e.length?e.join("."):"(whole page)"}var fc={skip:"[data-hcms-shell]",templateAttr:"cms-template"};function be(e,{ignoreActiveValue:t}={}){return gc(e,{ignoreActiveValue:t})}function gc(e,{ignoreActiveValue:t}){let r=G.findRules(e.doc,e.rulesSource||"cms");r&&(e.pageRules=e.view.prepareRules(Ol(r.rules,e.pageRoot)),e.rulesTagNode=r.tagNode),Nl(e.doc),Bl(e.doc,e.pageRules),e.formRules=Hl(e.pageRules,e.doc),e.writeRules=qo(e.pageRules),e.unresolved=Ro(e.pageRoot,e.pageRules);let i=$l(),l=ce(G.extract(e.pageRoot,e.pageRules,{...fc,...i.hooks}),e.pageRules),o=_r({pageRules:e.pageRules,formRules:e.formRules,data:l,doc:e.doc});Cl(e.formRoot,o,{ignoreActiveValue:t}),Tr(e,l),i.seed(e.formRoot),Ct(e.formRoot,e.doc,e.view?.enhanceFormRichText!==!1),Eo(e),Lr(e),e.updateFingerprint&&e.updateFingerprint()}function bc({debounce:e=100,onRefresh:t}){let r=J("Mutation");if(!r||typeof r.onAnyChange!="function")throw new Error("hypercms: a mutation hub is required (clay.Mutation or hyperclay.Mutation). Load clayjs or hyperclayjs, or just the mutation utility, before initializing hypercms.");let i=r.onAnyChange({debounce:e},l=>{t(l)});return{unsubscribe:typeof i=="function"?i:()=>{}}}var kc='input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])';function vc({doc:e,pageRoot:t,opts:r={}}){let i=r.richText!==!1,l=null;return{name:"sidebar",richText:i,enhanceFormRichText:!0,ctx:null,root:null,formRoot:null,errorEl:null,noticeEl:null,prepareRules(o){return i?Cs(o,t):o},mount(o){let n=this.ctx;l=Ee(()=>oc({mountTo:r.mountTo||e.body,side:r.side||"right",overlay:!!r.overlay,showSaveButton:!!r.showSaveButton,title:r.title,eyebrow:r.eyebrow,theme:r.theme,doc:e})),this.root=l.root,this.formRoot=l.formRoot,this.errorEl=l.errorEl,this.noticeEl=l.noticeEl;let a=_r({pageRules:n.pageRules,formRules:n.formRules,data:o,doc:e});l.formRoot.appendChild(a),n.seeder.seed(l.formRoot),Ct(l.formRoot,e),Lr(n),ko(n)},refresh(o){if(o==="livesync"){l?.restoreChrome?.(),be(this.ctx,{ignoreActiveValue:!0});return}if(o==="undo"){be(this.ctx,{ignoreActiveValue:!1});return}be(this.ctx)},focusOnOpen(){let o=this.root&&this.root.querySelector(kc);o&&typeof o.focus=="function"&&o.focus()},destroy(){l?.destroy(),l=null}}}var yc="[cms-template], [data-hcms-shell]";function tt(e){if(!e||typeof e.getBoundingClientRect!="function"||typeof e.closest=="function"&&e.closest(yc))return!1;let t=e.getBoundingClientRect();return t.width>=8&&t.height>=8}var xc={skip:"[data-hcms-shell]",templateAttr:"cms-template"},wc={skip:"[data-hcms-shell]",templateAttr:null},Ac="text",_c="native",Mi="handle",Ec=new Set(["INPUT","TEXTAREA","SELECT"]),Oo=new Set(["IMG","INPUT","TEXTAREA","SELECT","OPTION","BR","HR","VIDEO","AUDIO","IFRAME","EMBED","OBJECT","CANVAS","SOURCE","TRACK","AREA","COL","PARAM","BUTTON","STYLE","SCRIPT","LINK","META"]);function Lo(e,t,r=null){let i=[],l=[],o=ge(e);return ir(o,e,t,[],i,l,r?(n,a)=>fr(n,r,a,t):()=>null),{targets:i,lists:l}}function ir(e,t,r,i,l,o,n){if(typeof r=="string"){if(r.endsWith("[]")){let f=r.slice(0,-2);if(!f)return;let m=rt(e,t,f);m.forEach((u,c)=>{l.push(zi([...i,c],u,r,null))}),o.push(Ni(e,t,i,f,m,!0));return}let a=P(r),s=a===-1?null:r.slice(a+1),h=a===-1?r:r.slice(0,a),d=!h||h==="."?t:rt(e,t,h)[0];d&&l.push(zi(i,d,r,s,n(r,i)));return}if(Array.isArray(r)){let[a,s]=r;if(typeof a!="string"||!a)return;let h=rt(e,t,a);h.forEach((d,f)=>ir(e,d,s,[...i,f],l,o,n)),o.push(Ni(e,t,i,a,h,typeof s=="string"));return}if(r&&typeof r=="object")for(let[a,s]of Object.entries(r))ir(e,t,s,[...i,a],l,o,n)}function Ni(e,t,r,i,l,o){let n=l[0]?l[0].parentElement:null;if(!n){let a=rt(e,t,i,wc)[0];n=a?a.parentElement:null}return{path:r,items:l,container:n,scalar:o}}function zi(e,t,r,i,l=null){return{path:e,el:t,rule:r,attr:i,kind:Sc(t,i),icon:Tc(t,i),style:l}}function Sc(e,t){let r=(e.tagName||"").toUpperCase();return!t||t==="innerHTML"?Oo.has(r)?Mi:Ac:t==="value"&&Ec.has(r)&&!e.readOnly&&!Cc(e)?_c:Mi}function Cc(e){return e.disabled?!0:typeof e.matches=="function"&&e.matches(":disabled")}function Tc(e,t){let r=(e.tagName||"").toUpperCase();return(!t||t==="innerHTML")&&!Oo.has(r)?null:r==="IMG"||t==="srcset"?"camera":r==="A"&&t==="href"?"paperclip":"pencil"}function rt(e,t,r,i=xc){try{return e.find(t,r,i)}catch{return[]}}function Rc(e,t){let r=[],i=new Map,l=null;for(let o of e){if(!o.style)continue;let n=o.path.join(".");if(o.style==="page"){l||(l={scope:"page",el:o.el,list:null,paths:[]},r.push(l)),l.paths.push(n);continue}let a=qc(o.path,t),s=a?a.row:o.el,h=i.get(s);h||(h={scope:a?"row":"section",el:s,list:a?a.list:null,paths:[]},i.set(s,h),r.push(h)),h.paths.push(n)}return r}function qc(e,t){for(let r=e.length-1;r>=0;r--){if(typeof e[r]!="number")continue;let i=e.slice(0,r).join("."),l=t.find(n=>n.path.join(".")===i),o=l&&l.items[e[r]];if(o)return{list:l,row:o}}return null}var jr=Object.freeze({data:Object.freeze({tokens:["no-data"],bundles:["editor-ui"]}),save:Object.freeze({tokens:["no-save"],bundles:["editor-ui"]}),snapshot:Object.freeze({tokens:["no-snapshot"],bundles:["editor-ui"]}),watch:Object.freeze({tokens:["no-watch"],bundles:["editor-ui"]}),undo:Object.freeze({tokens:["no-undo"],bundles:["editor-ui"]}),history:Object.freeze({tokens:[],bundles:["editor-ui"]})}),$c=Object.freeze({"editor-ui":Object.freeze(["no-data","no-save","no-snapshot","no-watch","no-undo"])}),nu=Object.freeze(["no-save","no-snapshot","no-trigger-autosave","no-dirty","no-watch","no-undo","no-data","freeze","editor-ui","live"]);function ut(e,t){if(!e||e.nodeType!==1)return!1;let r=e.getAttribute?.("clay");return!!(r&&r.split(/\s+/).includes(t)||e.hasAttribute?.(t))}function jo(e,t){if(ut(e,t))return!0;for(let[r,i]of Object.entries($c))if(i.includes(t)&&ut(e,r))return!0;return!1}function lr(e){let t=jr[e];if(!t)throw new Error(`Unknown region capability: ${e}`);return[...t.tokens,...t.bundles].flatMap(r=>[`[clay~="${r}"]`,`[${r}]`]).join(", ")}function Oc(e,t){let r=e&&e.nodeType===1?e:e?.parentElement;for(;r&&r.nodeType===1;){let i=jr[t];if(!i)throw new Error(`Unknown region capability: ${t}`);if(i.tokens.some(l=>jo(r,l))||i.bundles.some(l=>ut(r,l)))return r;r=r.parentElement}return null}function Lc(e,t){return!!Oc(e,t)}var jc=/:(?:focus(?:-within|-visible)?|hover|active|visited|defined)\b/i;function Mc(e,t){if(!/^(INPUT|TEXTAREA|SELECT|OPTION)$/.test(e.tagName||""))return;let r=(e.getAttribute?.("type")||"").toLowerCase();"value"in e&&"value"in t&&e.tagName!=="OPTION"&&r!=="checkbox"&&r!=="radio"&&r!=="file"&&(t.value=e.value),e.tagName==="INPUT"&&(r==="checkbox"||r==="radio")&&(t.checked=e.checked),e.tagName==="OPTION"&&(t.selected=e.selected),"indeterminate"in e&&"indeterminate"in t&&(t.indeterminate=e.indeterminate)}function Fi(e,t,r,i){if(i)return!!e.closest?.(t);let l=e;for(;l?.nodeType===1;){if(l.matches(t))return!0;if(l===r)break;l=l.parentElement}return!1}function Di(e,t,r,i,l,o){return(o?Lc(e,t):Fi(e,r,l,!1))||!!(i&&(o&&e!==l?e.matches(i):Fi(e,i,l,o)))}function Nc(e,t){let r=jr[t];return r.tokens.some(i=>jo(e,i))||r.bundles.some(i=>ut(e,i))}var zc=new Set(["INPUT","TEXTAREA","SELECT","OPTION"]);function Mo(e,t,r,i){if(e.nodeType===1&&i(e)){r.dropped.push(t);return}r.cloneToLive.set(t,e),r.liveToClone.set(e,t);let l=e,o=t;if(e.nodeType===1){if(zc.has(e.tagName)&&r.controls.push(e,t),e.tagName==="TEMPLATE"){for(;t.firstChild;)t.removeChild(t.firstChild);l=e.content,o=t.content,r.cloneToLive.set(o,l),r.liveToClone.set(l,o)}}else if(e.nodeType!==11)return;let n=o.firstChild;for(let a=l.firstChild;a&&n;a=a.nextSibling)Mo(a,n,r,i),n=n.nextSibling}function No(e,{capability:t="data",exclude:r=null,inherit:i=!0,provenance:l=null}={}){if(!e)throw new TypeError("createContentView requires a DOM context");let o=e.nodeType===9?e:e.ownerDocument;if(!o?.implementation?.createHTMLDocument)throw new TypeError("createContentView requires an HTML DOM implementation");let n=o.implementation.createHTMLDocument(""),a=l||new WeakMap,s=new WeakMap,h=e.nodeType===9?e.documentElement:e;r&&n.documentElement.matches(r);let d=lr(t),f=i?c=>Nc(c,t)||!!(r&&c.matches(r)):c=>Di(c,t,d,r,h,!1),m=null;if(h.nodeType!==1||!Di(h,t,d,r,h,i)){m=n.importNode(h,!0);let c={cloneToLive:a,liveToClone:s,dropped:[],controls:[]};Mo(h,m,c,f);for(let p of c.dropped)p.remove();for(let p=0;p<c.controls.length;p+=2)Mc(c.controls[p],c.controls[p+1])}e.nodeType===9&&m&&(n.replaceChild(m,n.documentElement),s.set(e,n),a.set(n,e));let u=c=>{if(jc.test(c))throw new Error(`Filtered content queries do not support stateful selector: ${c}`)};return{root:m,document:n,capability:t,selector:lr(t),cloneToLive:a,liveToClone:s,original(c){return a.get(c)||null},cloneOf(c){return s.get(c)||null},query(c,p=m){return u(c),Array.from(p.querySelectorAll(c),b=>a.get(b)||b)},text(c=m){return(c===m?m:s.get(c))?.textContent||""},html(c=m){return(c===m?m:s.get(c))?.innerHTML??""},clone(c=m){let p=c===m?m:s.get(c);return p?n.importNode(p,!0):null}}}var Fc=[16,8,0],D=8,Dc=4;function Bc({anchor:e,bar:t,rail:r=t,viewport:i,current:l=null}){let o=m=>l===m?Dc:0;if(e.bottom<=0||e.top>=i.height||e.right<=0||e.left>=i.width)return{mode:"hidden",x:0,y:0};let n=m=>Math.max(D,Math.min(e.left,i.width-m-D)),a=e.top-16-t.height;if(a>=D-o("above"))return{mode:"above",x:n(t.width),y:a};let s=e.bottom+16;if(s+t.height<=i.height-D+o("below"))return{mode:"below",x:n(t.width),y:s};let h=i.width-e.right-D,d=e.left-D,f=h>=d?[["rail-right",h],["rail-left",d]]:[["rail-left",d],["rail-right",h]];for(let[m,u]of f)for(let c of Fc){if(r.width+c>u+o(m))continue;let p=m==="rail-right"?Math.min(e.right+c,i.width-r.width-D):Math.max(e.left-c-r.width,D),b=Math.min(e.bottom,i.height-D)-r.height,g=Math.max(D,Math.min(Math.max(e.top,D),b));return{mode:m,x:p,y:g,gap:c}}return{mode:"pinned",x:n(t.width),y:D}}function Bi({anchor:e,handle:t,viewport:r,inset:i=6,prefer:l="auto"}){let o=e.height>=t.height*1.5&&e.width>=t.width*2;if(l==="corner"||o){let m=Math.max(D,Math.min(e.right-t.width+i,r.width-t.width-D)),u=Math.max(D,Math.min(e.top-i,r.height-t.height-D));return{x:m,y:u,mode:"over"}}let n=4,a=e.right+n+t.width<=r.width-D,s=a?e.right+n:e.left-n-t.width,h=Math.max(D,s),d=e.top+e.height/2-t.height/2,f=Math.max(D,Math.min(d,r.height-t.height-D));return{x:h,y:f,mode:a?"beside-right":"beside-left"}}var dt=!1;function zo(){if(dt)return;let e=J("onPrepareForSave");typeof e=="function"&&(e(t=>{Do(t),Fo(t)}),dt=!0)}function Fo(e){let t=e&&e.querySelector&&e.querySelector("body");t&&t.classList.remove("hcms-open","hcms-overlay","hcms-side-left",Or)}function Do(e){if(!(!e||typeof e.querySelectorAll!="function"))for(let t of e.querySelectorAll(`[${ye}]`)){let r=As(t);r!==null&&(t.innerHTML=r),t.removeAttribute(ye)}}var mt=!1;function Mr(){if(mt)return;let e=J("onSnapshot");typeof e=="function"&&(e(t=>{Do(t),Es(t,typeof window<"u"?window:null),Fo(t)}),mt=!0)}function Ic(){zo(),Mr(),(!dt||!mt)&&Pc()}var Ze=null;function Pc(){Ze||typeof document>"u"||(Ze=Sr(document,ys,()=>{zo(),Mr(),dt&&mt&&(Ze?.(),Ze=null)}))}var Hc={edit:"M8 10h2v6H8zm2 4h4v2h-4zm0-6h2v2h-2zm2-2h2v2h-2zm2-2h2v2h-2zm2-2h2v2h-2zm2 2h2v2h-2zm2 2h2v2h-2zm-2 2h2v2h-2zm-2 2h2v2h-2zm-2 2h2v2h-2zm-4 0h2v2h-2z","move-up":"M11 4h2v2h2v2h2v2h2v2h-4v-2h-2v10h-2V10H9v2H5v-2h2V8h2V6h2z","move-down":"M11 4h2v10h2v-2h4v2h-2v2h-2v2h-2v2h-2v-2H9v-2H7v-2H5v-2h4v2h2z",remove:"M5 5h3v3h3v3h2V8h3V5h3v3h-3v3h-3v2h3v3h3v3h-3v-3h-3v-3h-2v3H8v3H5v-3h3v-3h3v-2H8V8H5z",add:"M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z"};function pt(e){let t=e==="edit"?"6 0 18 18":"0 0 24 24",r=e==="settings"?'<circle cx="6" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="18" cy="12" r="1.5"/>':`<path d="${Hc[e]}"/>`;return`<svg class="hcms-inline-icon" xmlns="http://www.w3.org/2000/svg" viewBox="${t}" width="24" height="24" fill="currentColor" aria-hidden="true" focusable="false">${r}</svg>`}var Ii="data-hcms-ghost",Uc=lr("history");function Vc(e){let t=e.container,r=null;for(;t&&(t.namespaceURI!=="http://www.w3.org/1999/xhtml"||["SELECT","OPTGROUP","DATALIST"].includes(t.tagName));)r=t,t=t.parentElement;return{parent:t,anchor:r}}function Wc({doc:e,themeRoot:t,onAdd:r,onResize:i}){let l=e.defaultView,o=[],n=!1,a=null,s=new Map;function h(u,c,p){u.style[c]!==p&&(u.style[c]=p)}function d(){let u=new Set(o.map(c=>c.node.parentElement));for(let[c,p]of s)u.has(c)&&l?.Sortable?.get(c)===p.instance||(p.instance.option("draggable")===p.selector&&p.instance.option("draggable",p.original),s.delete(c));for(let c of u){let p=l?.Sortable?.get(c);if(!p)continue;let b=p.option("draggable");if(s.get(c)?.selector===b)continue;let g=b,k=`${g.trim().startsWith(">")?"> ":""}:is(${g.trim().replace(/^>\s*/,"")}):not(${Uc})`;p.option("draggable",k),s.set(c,{instance:p,original:g,selector:k})}}function f(){for(let u of o){let{node:c,slot:p,list:b}=u,g=b.items.filter(k=>k.isConnected).map(k=>k.getBoundingClientRect()).filter(k=>k.width>0&&k.height>0);g.length&&(u.width=g.reduce((k,y)=>k+y.width,0)/g.length,u.height=g.reduce((k,y)=>k+y.height,0)/g.length),h(c,"width",u.width?`${Math.round(u.width)}px`:"100%"),h(p,"height",`${Math.max(48,Math.round(u.height||64))}px`),p!==c&&(p.colSpan=Math.max(1,...b.items.map(k=>[...k.children].reduce((y,_)=>y+(_.colSpan||1),0)))),c.hidden!==n&&(c.hidden=n)}d()}function m(u,c){let p=c.tagName,b=["TBODY","THEAD","TFOOT","TABLE"].includes(p),g=e.createElement(b?"tr":["UL","OL","MENU"].includes(p)?"li":"div");for(let A of[Ii,"data-hcms-shell","editor-ui","no-watch","no-save","save-remove","snapshot-remove"])g.setAttribute(A,"");g.setAttribute("draggable","false"),g.setAttribute("contenteditable","false"),g.className="hcms-shell pixel-quiet hcms-inline-ghost";for(let A of["light","dark"])g.classList.toggle(A,!!t?.classList.contains(A));let k=b?e.createElement("td"):g;k!==g&&(k.className="hcms-inline-ghost-cell",g.appendChild(k));let y=e.createElement("button");y.type="button",y.className="hcms-inline-list-button hcms-inline-list-add mirk-button mirk-button--small",y.setAttribute("data-hcms-list-action","add"),y.innerHTML=`<span class="mirk-button__label">${pt("add")}<span>Add</span></span>`,k.appendChild(y);let _={node:g,slot:k,button:y,list:u,width:0,height:0};y.addEventListener("click",A=>{A.preventDefault(),A.stopPropagation(),r(_.list)});for(let A of["pointerdown","mousedown","touchstart","click"])g.addEventListener(A,E=>E.stopPropagation());return g.addEventListener("dragstart",A=>{A.preventDefault(),A.stopPropagation()}),_}return{setLists(u){let c=new Set(o),p=[],b=new Set(o.map(k=>k.node)),g=new Set;for(let k of u||[]){if(!k.container||!k.container.isConnected)continue;let{parent:y,anchor:_}=Vc(k);if(!y)continue;if(!g.has(y)){for(let $ of y.querySelectorAll(`:scope > [${Ii}]`))b.has($)||$.remove();g.add(y)}let A=o.find($=>c.has($)&&$.list.container===k.container&&$.list.path.join(".")===k.path.join("."))||m(k,y);c.delete(A),A.list=k,A.button.setAttribute("data-hcms-list",k.path.join(".")),A.button.setAttribute("aria-label",`Add to ${k.path.join(".")||"the list"}`);let E=_||k.items.filter($=>$.parentElement===y).at(-1);E?E.nextSibling!==A.node&&E.after(A.node):A.node.parentElement!==y&&y.appendChild(A.node),p.push(A)}for(let k of c)k.node.remove();o=p,a?.disconnect(),!a&&typeof l?.ResizeObserver=="function"&&(a=new l.ResizeObserver(()=>{f(),i?.()}));for(let k of o)for(let y of k.list.items)a?.observe(y);f()},update:f,setHidden(u){n=!!u,f()},destroy(){a?.disconnect();for(let u of o)u.node.remove();o=[],d()}}}var Pi=[["move-up","Move up"],["move-down","Move down"]],Gc={prefer:"corner",inset:0};function Jc(e,t){return t.width<=e.width&&t.height<=e.height}function Xc({doc:e,layerEl:t,onActivate:r,onListAction:i,onStyle:l}){let o=e.defaultView,n=[],a=new Map,s=0,h=new Map,d=null,f=new Set,m=0,u=!1,c=null,p=null,b=null,g=null,k=new Map,y=!1,_=null,A=Wc({doc:e,themeRoot:t.closest("[data-hcms-shell]"),onResize:$,onAdd:v=>i?.({action:"add",list:v,index:v.items.length})}),E=e.createElement("div");E.className="hcms-inline-highlight",E.hidden=!0,E.setAttribute("aria-hidden","true"),t.appendChild(E);function $(){if(!(m||!o)){if(typeof o.requestAnimationFrame!="function")return ue();m=o.requestAnimationFrame(()=>{m=0,ue()})}}let H=()=>b||g;function ue(){if(!o)return;A.update();let v={width:o.innerWidth,height:o.innerHeight},x=H();for(let w of n){if(!w.visible){w.node.hidden=!0;continue}for(let T of w.members)T.node.hidden=y&&T.kind!=="handle";w.node.hidden=!1;let C=w.el.getBoundingClientRect(),S=w.node.getBoundingClientRect(),q=S.width,O=w.kind==="row"&&!Jc(C,S);if(O&&w.el!==x){for(let T of w.members)T.kind==="row"&&(T.node.hidden=!0);S=w.node.getBoundingClientRect()}if(w.members.every(T=>T.node.hidden)){w.node.hidden=!0;continue}if(w.kind==="style"){let T=Math.max(8,Math.min(C.left,v.width-S.width-8)),M=Math.max(8,Math.min(C.top,v.height-S.height-8));w.node.style.transform=`translate(${Math.round(T)}px, ${Math.round(M)}px)`;continue}let I=w.kind==="handle"?null:Gc,{x:L,y:Q}=Bi({anchor:C,handle:S,viewport:v,...I}),de=w.members.find(T=>T.kind==="handle");if(O&&de){let T=de.node.getBoundingClientRect(),M=Bi({anchor:C,handle:T,viewport:v}),j=w.members.slice(w.members.indexOf(de)+1).filter(qt=>!qt.node.hidden).reduce((qt,cn)=>qt+cn.node.getBoundingClientRect().width+2,0);L=Math.max(8+q,Math.min(v.width-8,M.x+T.width+j))-S.width,Q=M.y}w.node.style.transform=`translate(${Math.round(L)}px, ${Math.round(Q)}px)`}if(_)if(!_.node.isConnected||_.node.closest("[hidden]"))X();else{let w=_.button.getBoundingClientRect(),C=_.menu.getBoundingClientRect();_.menu.style.left=`${Math.max(8,w.right-C.width)-w.left}px`,_.menu.style.right="auto",_.menu.style.top=w.bottom+6+C.height>v.height-8?"auto":"calc(100% + 6px)",_.menu.style.bottom=w.bottom+6+C.height>v.height-8?"calc(100% + 6px)":"auto"}Re(),c?.()}function U(v){if(v?.closest?.("[data-hcms-ghost]"))return null;for(let x=v;x&&x.nodeType===1;x=x.parentElement){let w=k.get(x);if(w)return w}return null}function ne(v){_&&!_.node.contains(v.target)&&X();let x=H();g=U(v.target),g&&t.contains(v.target)&&(b=null),H()!==x&&$()}function Te(v){if(v.relatedTarget||!g)return;let x=H();g=null,H()!==x&&$()}function Re(){if(!p||E.hidden)return;let v=p.getBoundingClientRect();E.style.width=`${Math.round(v.width)}px`,E.style.height=`${Math.round(v.height)}px`,E.style.transform=`translate(${Math.round(v.left)}px, ${Math.round(v.top)}px)`}function Xo(){if(!o||typeof o.IntersectionObserver!="function"){for(let x of n)x.visible=!0;return}d||(d=new o.IntersectionObserver(x=>{let w=!1;for(let C of x)for(let S of a.get(C.target)||[])S.visible!==C.isIntersecting&&(S.visible=C.isIntersecting,w=!0);w&&$()},{threshold:0}));let v=new Set(a.keys());for(let x of f)v.has(x)||d.unobserve(x);for(let x of v)f.has(x)||d.observe(x);f=v}function Ko(){u||!o||(o.addEventListener("scroll",$,{passive:!0,capture:!0}),o.addEventListener("resize",$,{passive:!0}),e.addEventListener("focusin",ne),e.addEventListener("focusout",Te),e.addEventListener("pointerdown",Jr,!0),e.addEventListener("keydown",Xr,!0),u=!0)}function Zo(){!u||!o||(o.removeEventListener("scroll",$,{capture:!0}),o.removeEventListener("resize",$),e.removeEventListener("focusin",ne),e.removeEventListener("focusout",Te),e.removeEventListener("pointerdown",Jr,!0),e.removeEventListener("keydown",Xr,!0),u=!1)}function Hr(v){return`${v.kind}\0${v.attr||""}`}function Ur(v,x){return v.container===x.container&&v.scalar===x.scalar}function Qo(v,x){return v.kind!==x.kind?!1:v.kind==="style"?!0:v.kind==="handle"?Hr(v.target)===Hr(x.target):v.kind==="row"?v.row===x.row&&Ur(v.list,x.list):Ur(v.list,x.list)}function Vr(v,x){v.target=x;let w=x.path.join(".");v.node.setAttribute("data-hcms-target",w),x.icon?v.node.setAttribute("data-hcms-icon",x.icon):v.node.removeAttribute("data-hcms-icon"),v.node.setAttribute("aria-label",`Edit ${w}`)}function Yo(v){let x=e.createElement("button");x.type="button",x.className="hcms-inline-handle mirk-button mirk-button--small",x.innerHTML=`<span class="mirk-button__label">${pt("edit")}</span>`;let w={node:x,kind:"handle",target:v};return Vr(w,v),x.addEventListener("click",C=>{C.preventDefault(),C.stopPropagation(),r?.(w.target,x)}),w}function en(v){let x=e.createElement("button");x.type="button",x.className="hcms-inline-style-chip mirk-button mirk-button--small",x.setAttribute("aria-label","Edit style"),x.innerHTML='<span class="mirk-button__label">Style</span>';let w={node:x,kind:"style",group:v.group};return x.addEventListener("click",C=>{C.preventDefault(),C.stopPropagation(),l?.(w.group,x)}),w}function Wr(v,x){let w=e.createElement("button");return w.type="button",w.className="hcms-inline-list-button mirk-button mirk-button--small",w.setAttribute("data-hcms-list-action",v),w.setAttribute("aria-label",x),w.innerHTML=`<span class="mirk-button__label">${pt(v)}${v==="add"?"<span>Add</span>":""}</span>`,w}function Gr(v,{list:x,row:w,rowIndex:C,count:S}){let q=x.path.join(".");v.list=x,v.row=w,v.index=C,v.count=S,v.node.setAttribute("data-hcms-list",q),v.node.setAttribute("data-hcms-row",String(C));for(let O of v.node.querySelectorAll("[data-hcms-list-action]")){let I=O.getAttribute("data-hcms-list-action"),L=Pi.find(([Q])=>Q===I)?.[1]||I;O.setAttribute("aria-label",`${L} ${q}.${C}`),O.disabled=I==="move-up"&&C===0||I==="move-down"&&C===S-1}}function tn(v,x,w,C){let S=e.createElement("div");S.className="hcms-inline-row-controls";let q={node:S,kind:"row",list:v,row:x,index:w,count:C};for(let[O,I]of Pi){let L=Wr(O,I);L.addEventListener("click",Q=>{Q.preventDefault(),Q.stopPropagation(),!L.disabled&&i?.({action:O,list:q.list,index:q.index,row:q.row})}),S.appendChild(L)}return Gr(q,{list:v,row:x,rowIndex:w,count:C}),q}function X(v=!1){if(!_)return;let x=_;_=null,x.menu.hidden=!0,x.button.setAttribute("aria-expanded","false"),x.node.parentElement?.classList.remove("has-open-settings"),v&&x.button.isConnected&&x.button.focus({preventScroll:!0})}function Jr(v){_&&!_.node.contains(v.target)&&X()}function Xr(v){if(_){if(v.key==="Escape")v.preventDefault(),v.stopPropagation(),X(!0);else if(v.key==="Tab")X(!0);else if(["ArrowDown","ArrowUp","Home","End"].includes(v.key)&&_.menu.contains(v.target)){v.preventDefault();let x=[..._.menu.querySelectorAll('[role="menuitem"]')],w=x.indexOf(v.target),C=v.key==="Home"?0:v.key==="End"?x.length-1:w===-1?0:(w+(v.key==="ArrowDown"?1:-1)+x.length)%x.length;x[C]?.focus({preventScroll:!0})}}}function Kr(v,{list:x,row:w,rowIndex:C,style:S=null}){Object.assign(v,{list:x,row:w,index:C,style:S}),v.node.setAttribute("data-hcms-list",x.path.join(".")),v.node.setAttribute("data-hcms-row",String(C)),v.button.setAttribute("aria-label",`Settings ${x.path.join(".")}.${C}`),S&&!v.styleItem.isConnected?v.menu.insertBefore(v.styleItem,v.menu.firstChild):S||v.styleItem.remove()}function rn(v){let x=e.createElement("div");x.className="hcms-inline-settings";let w=Wr("settings","Settings");w.setAttribute("aria-haspopup","menu"),w.setAttribute("aria-expanded","false");let C=e.createElement("div");C.className="hcms-inline-settings-menu",C.setAttribute("role","menu"),C.setAttribute("aria-label","Item settings"),C.hidden=!0;let S=e.createElement("button");S.type="button",S.setAttribute("role","menuitem"),S.setAttribute("data-hcms-style-action",""),S.textContent="Style";let q=e.createElement("button");q.type="button",q.setAttribute("role","menuitem"),q.setAttribute("data-hcms-list-action","remove"),q.textContent="Delete",C.appendChild(q),x.append(w,C);let O={node:x,button:w,menu:C,styleItem:S,kind:"settings"};Kr(O,v);let I=()=>{X(),_=O,C.hidden=!1,w.setAttribute("aria-expanded","true"),x.parentElement.classList.add("has-open-settings"),C.querySelector('[role="menuitem"]').focus({preventScroll:!0}),$()};return w.addEventListener("click",L=>{L.preventDefault(),L.stopPropagation(),_===O?X(!0):I()}),w.addEventListener("keydown",L=>{(L.key==="ArrowDown"||L.key==="ArrowUp")&&(L.preventDefault(),I())}),q.addEventListener("click",L=>{L.preventDefault(),L.stopPropagation(),X(!0),i?.({action:"remove",list:O.list,index:O.index,row:O.row})}),S.addEventListener("click",L=>{L.preventDefault(),L.stopPropagation(),X(),l?.(O.style,O.button)}),O}function ln(v,x){v.kind==="handle"?Vr(v,x.target):v.kind==="row"?Gr(v,x):v.kind==="settings"?Kr(v,x):v.kind==="style"&&(v.group=x.group)}function We(v,x,w,C,S){let q=x.get(w)?.find(O=>O.category===S);if(!q){q={el:w,category:S,members:[]},v.push(q);let O=x.get(w);O?O.push(q):x.set(w,[q])}q.members.push(C)}function on(v,x,w,C){let S=w.items||[];S.forEach((q,O)=>{tt(q)&&(We(v,x,q,{kind:"row",list:w,row:q,rowIndex:O,count:S.length},"item"),We(v,x,q,{kind:"settings",list:w,row:q,rowIndex:O,style:C.get(q)||null},"item"))})}function nn(v,x){let w=new Set(v.members),C=[];for(let S of x){let q=v.members.find(O=>w.has(O)&&Qo(O,S))||(S.kind==="handle"?Yo(S.target):S.kind==="row"?tn(S.list,S.row,S.rowIndex,S.count):S.kind==="style"?en(S):rn(S));w.delete(q),ln(q,S),y&&q.kind!=="handle"&&(q.node.hidden=!0),C.push(q)}for(let S of w)S===_&&X(),S.node.remove();C.sort((S,q)=>["row","handle","settings"].indexOf(S.kind)-["row","handle","settings"].indexOf(q.kind)),C.forEach((S,q)=>{v.node.children[q]!==S.node&&v.node.insertBefore(S.node,v.node.children[q]||null)}),v.members=C}function an(v,x,w){let C=[],S=new Map,q=new Map,O=0;for(let T of v||[])T.style||(q.has(T.el)||q.set(T.el,T),!(T.kind!=="handle"||!tt(T.el))&&(We(C,S,T.el,{kind:"handle",target:T},"item"),O++));let I=new Map;for(let T of w||[])T.scope==="row"?I.set(T.el,T):T.scope==="section"&&tt(T.el)&&We(C,S,T.el,{kind:"style",group:T},"style");for(let T of x||[])on(C,S,T,I);let L=new Set(n),Q=new Map;for(let T of n)Q.has(T.el)||Q.set(T.el,T.visible);let de=[];for(let T of C){let M=n.find(j=>L.has(j)&&j.el===T.el&&j.category===T.category);if(!M){let j=e.createElement("div");j.className="hcms-inline-item-controls",j.setAttribute("role","group"),M={el:T.el,node:j,category:T.category,kind:T.category==="add"?"add":"handle",members:[],visible:Q.get(T.el)??!1},t.appendChild(j)}L.delete(M),M.el=T.el,M.category=T.category,nn(M,T.members),M.kind=M.members.some(j=>j.kind==="row")?"row":M.members.some(j=>j.kind==="handle")?"handle":M.members.some(j=>j.kind==="style")?"style":"add",M.node.setAttribute("aria-label",M.category==="add"?"List controls":M.category==="style"?"Style controls":"Item controls"),de.push(M)}for(let T of L)T.node.remove();n=de,a=new Map,k=new Map;for(let T of n){let M=a.get(T.el);M?M.push(T):a.set(T.el,[T]);for(let j of T.members)j.kind!=="row"&&j.kind!=="settings"||(k.set(j.row,j.row),k.set(j.node,j.row),k.set(T.node,j.row))}b&&!k.has(b)&&(b=null),g&&!k.has(g)&&(g=null),h=q,s=O}function sn(){X(),d?.disconnect(),d=null,f=new Set;for(let v of n)v.node.remove();n=[],a=new Map,h=new Map,k=new Map,s=0}return{setTargets(v,x,w=[]){an(v,x,w),A.setLists(x),Xo(),Ko(),$()},refresh:$,get count(){return s},get controlsHidden(){return y},setControlsHidden(v){if(y=!!v,A.setHidden(y),y){X();for(let x of n){for(let w of x.members)w.kind!=="handle"&&(w.node.hidden=!0);x.members.every(w=>w.node.hidden)&&(x.node.hidden=!0)}}$()},elementToTarget(v){if(v?.closest?.("[data-hcms-ghost]"))return null;for(let x=v;x&&x.nodeType===1;x=x.parentElement){let w=h.get(x);if(w)return w}return null},setHoveredRow(v){let x=H();b=v?U(v):null,H()!==x&&$()},showHighlight(v){v&&(p=v,E.hidden=!1,Re())},hideHighlight(){p=null,E.hidden=!0},setFollower(v){c=typeof v=="function"?v:null},destroy(){A.destroy(),m&&o&&o.cancelAnimationFrame(m),m=0,c=null,p=null,b=null,g=null,E.remove(),Zo(),sn()}}}var Kc="hypercms-inline",ke="is-hcms-inline-active",or="is-hcms-inline-onpath",Hi='input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])',Zc=["bold","italic","link","undo","redo"],Qc=/^H[1-6]$/,Yc=0;function eh({doc:e,pageRoot:t,opts:r={}}){let i=r.richText!==!1,l=null,o=null,n=null,a=new Map,s=null,h=null,d=[],f=null;function m(u,c,p,b,g){let k=St(e.defaultView);if(typeof k!="function")return null;let y=g||{},_=y.originalHTML??No(c,{capability:"history"}).html(),A=y.richClayIsOurs??!c.hasAttribute("data-richclay"),E=y.adopted??c.getAttribute("data-richclay-active")==="true",$=Fe(c,b,"history"),H=th(u,k,c,b,A);if(!H)return null;_s(c,b==="innerHTML",A);let ue=String(++Yc);c.setAttribute(ye,ue),Mr();let U={el:c,editor:H,path:p,prop:b,boundId:ue,originalHTML:_,oldValue:$,richClayIsOurs:A,adopted:E,dirty:!1,written:!1,restorable(){return!this.adopted&&!this.dirty&&!this.written},lastEdited:void 0};a.set(c,U),xs(ue,U);let ne=H.squire;if(ne&&typeof ne.addEventListener=="function"){let Re=()=>{U.dirty=!0,U.lastEdited=Fe(c,U.prop,"history"),rh(u,U)};ne.addEventListener("input",Re),U.detachInput=()=>ne.removeEventListener?.("input",Re)}let Te=()=>Bo(U);return c.addEventListener("blur",Te),U.detachBlur=()=>c.removeEventListener("blur",Te),U}return{name:"inline",richText:i,ctx:null,root:null,formRoot:null,errorEl:null,noticeEl:null,handoffEl:null,handoffCountEl:null,popEl:null,enhanceFormRichText:!1,prepareRules(u){return i?Ts(u,t):u},bindText(u,c,p,b){return m(this.ctx,u,c,p,b)},mount(u){let c=this.ctx;l=nh(e,r.theme),this.root=l.root,this.formRoot=l.formRoot,this.errorEl=l.errorEl,this.noticeEl=l.noticeEl,this.handoffEl=l.handoffEl,this.handoffCountEl=l.handoffCountEl,this.popEl=l.popEl,Ee(()=>ht(e));let p=_r({pageRules:c.pageRules,formRules:c.formRules,data:u,doc:e});l.formRoot.appendChild(p),c.seeder.seed(l.formRoot),Ct(l.formRoot,e,this.enhanceFormRichText),Lr(c),ko(c),o=Xc({doc:e,layerEl:l.layerEl,onActivate:(b,g)=>this.activate(b,g),onListAction:b=>this.listAction(b),onStyle:(b,g)=>this.openStyle(b,g)}),o.setFollower(()=>this.placePopover()),l.closeEl.addEventListener("click",()=>this.deactivate()),l.toggleEl.addEventListener("click",b=>{b.preventDefault(),b.stopPropagation(),this.toggleControls()}),l.pageStyleEl.addEventListener("click",b=>{b.preventDefault(),b.stopPropagation();let g=d.find(k=>k.scope==="page");g&&this.openStyle(g,l.pageStyleEl)}),l.handoffEl.querySelector("[data-hcms-open-view]").addEventListener("click",b=>{b.preventDefault(),b.stopPropagation(),c.onViewRequested?.("sidebar")}),this.bindPage(),this.syncTargets()},listAction({action:u,list:c,index:p,row:b}){let g=this.ctx,k=c.path.join("."),y=g.formRoot.querySelector(`[data-hcms-path="${Se(k)}"]`);if(!y)return;if(u==="add"){Rr(k,g);return}let _=b?sh(g,k,b):p;if(_===-1)return;let A=ah(y,_);if(A){if(u==="remove"){wo(A,g),this.syncTargets();return}xo(A,u==="move-up"?-1:1,g),this.syncTargets()}},toggleControls(){if(!o||!l)return;let u=!o.controlsHidden;o.setControlsHidden(u),l.toggleEl.setAttribute("aria-pressed",String(u));let c=l.toggleEl.querySelector(".mirk-button__label");c&&(c.textContent=u?"Show controls":"Hide controls")},bindPage(){let u=se(this.ctx.pageRoot),c=l.root,p=A=>{let E=o&&o.elementToTarget(A.target);E?o.showHighlight(E.el):o?.hideHighlight(),o?.setHoveredRow(A.target)},b=()=>{o?.hideHighlight(),o?.setHoveredRow(null)},g=A=>{if(c.contains(A.target))return;let E=o&&o.elementToTarget(A.target);!E||E.kind!=="text"||a.has(E.el)||m(this.ctx,E.el,E.path.join("."),ft(E))},k=A=>{if(c.contains(A.target))return;let E=o&&o.elementToTarget(A.target);if(!E){this.deactivate();return}(typeof A.target.closest=="function"&&A.target.closest("a[href]")||E.kind!=="text")&&A.preventDefault(),this.activate(E)},y=A=>{A.key==="Escape"&&this.deactivate()},_=A=>{let E=A.detail;if(!(!E||E.pageRoot!==se(this.ctx.pageRoot)||!E.path))for(let $ of a.values())$.path===E.path&&($.written=!0)};u.addEventListener("pointerover",p),u.addEventListener("pointerleave",b),u.addEventListener("pointerdown",g),u.addEventListener("click",k),c.addEventListener("keydown",y),e.addEventListener("hcms:change",_),n=()=>{u.removeEventListener("pointerover",p),u.removeEventListener("pointerleave",b),u.removeEventListener("pointerdown",g),u.removeEventListener("click",k),c.removeEventListener("keydown",y),e.removeEventListener("hcms:change",_)}},activate(u,c){if(!u||!l||u.kind==="text"&&this.activateText(u))return;let p=Ui(this,l,u.path.join("."));if(!p){this.deactivate();return}s=u,h=c||null,f=null,l.popTitleEl.textContent="Edit content",l.popEl.hidden=!1,l.formRoot.querySelectorAll(`.${ke}`).forEach(Bt),this.placePopover(),Wi(p)},openStyle(u,c){if(!u||!l)return;let p=Vi(this,l,u.paths);if(!p){this.deactivate();return}s={kind:"style",scope:u.scope,el:u.scope==="page"?l.pageStyleEl:u.el,path:u.paths[0].split("."),paths:u.paths},h=c||null,f=null,l.popTitleEl.textContent=u.scope==="page"?"Page style":"Style",l.popEl.hidden=!1,l.formRoot.querySelectorAll(`.${ke}`).forEach(Bt),this.placePopover(),Wi(p)},activateText(u){let c=u.el,p=a.get(c);if(p)return it(p),!0;let b=m(this.ctx,c,u.path.join("."),ft(u));return b?(it(b),!0):!1},placePopover(){if(!l||!s||l.popEl.hidden)return;let u=e.defaultView;if(!u)return;let c={width:u.innerWidth,height:u.innerHeight},p=s.el.getBoundingClientRect(),b=l.popEl.getBoundingClientRect(),{mode:g,x:k,y}=Bc({anchor:p,bar:b,viewport:c,current:f});f=g,l.popEl.style.transform=`translate(${Math.round(k)}px, ${Math.round(y)}px)`},deactivate(){if(!l||!s&&l.popEl.hidden)return;l.popEl.hidden=!0,Nr(l.root);let u=h;if(s=null,h=null,f=null,u&&e.contains(u)&&typeof u.focus=="function")try{u.focus({preventScroll:!0})}catch{u.focus()}},syncTargets(){if(!o)return;let u=this.ctx,c=Lo(u.pageRoot,u.pageRules,e),p=c.lists,b=c.targets.filter(y=>!y.style);d=Rc(c.targets,p),l.pageStyleEl.hidden=!d.some(y=>y.scope==="page"),o.setTargets(c.targets,p,d);let g=ih(this,a,b,e);if(s?.kind==="style"){let y=s.scope==="page"?d.find(_=>_.scope==="page"):d.find(_=>_.el===s.el);y?s={...s,paths:y.paths,path:y.paths[0].split(".")}:this.deactivate()}else if(s){let y=g.get(s.el)||[],_=y.find(A=>lh(A,s))||y.find(A=>A.path.join(".")===s.path.join("."))||(y.length===1?y[0]:null);_?s=_:this.deactivate()}oh(this.ctx,a,e);let k=b.reduce((y,_)=>y+(tt(_.el)?0:1),0);this.handoffEl&&(this.handoffCountEl.textContent=k===0?"":`${k} ${k===1?"field isn't":"fields aren't"} visible right now.`,this.handoffEl.hidden=k===0)},refresh(u,c){u==="livesync"?(Ve(e),ht(e),be(this.ctx,{ignoreActiveValue:!0})):u==="undo"?be(this.ctx,{ignoreActiveValue:!1}):be(this.ctx),this.syncTargets(),(u==="livesync"||u==="undo")&&this.rebindText(u),this.restoreActive()},rebindText(u){let c=u!=="undo";for(let[p,b]of[...a]){if(!e.contains(p)){De(this.ctx,b,{restore:!1,record:c}),a.delete(p);continue}if(p.hasAttribute(le)){let y=Fe(p,b.prop);y!==b.lastEdited&&(b.oldValue=y,b.lastEdited=void 0);continue}let g=e.activeElement===p;De(this.ctx,b,{restore:!1,record:c}),a.delete(p);let k=m(this.ctx,p,b.path,b.prop,{richClayIsOurs:b.richClayIsOurs,adopted:b.adopted});k&&g&&it(k)}},restoreActive(){if(!(!l||!s||l.popEl.hidden)){if(!e.contains(s.el)){this.deactivate();return}if(!(s.kind==="style"?Vi(this,l,s.paths):Ui(this,l,s.path.join(".")))){this.deactivate();return}l.formRoot.querySelectorAll(`.${ke}`).forEach(Bt),this.placePopover()}},focusOnOpen(){if(this.root&&typeof this.root.focus=="function")try{this.root.focus({preventScroll:!0})}catch{this.root.focus()}},destroy(){h=null,this.deactivate();for(let u of a.values())De(this.ctx,u);a.clear(),n?.(),n=null,o?.destroy(),o=null,l?.destroy(),l=null,Co(e),this.popEl=null,this.handoffEl=null,this.handoffCountEl=null}}}function th(e,t,r,i,l){return Ee(()=>{let o=null;try{o=new t(r,{inline:!0,hyperclay:!1,toolbar:i==="innerHTML"?Zc:!1,...Qc.test(r.tagName)?{singleLine:!0}:null})}catch(n){return console.warn("[hypercms] richclay activation failed; the field falls back to the popover",n),null}if(o.unsupported||!o.active){if(l)try{o.destroy()}catch{}return null}return typeof o.reattach=="function"&&o.reattach(),o})}function rh(e,{path:t,el:r,prop:i}){let l=Ao(e.formRoot,t);l&&(_o(l,Fe(r,i),e.formRoot,t),te(Z(e),{path:t,structural:!1},e))}function Fe(e,t,r="data"){let i=No(e,{capability:r});return t==="innerHTML"?i.html():i.text().trim()}function Bo(e){let{el:t,prop:r,oldValue:i,lastEdited:l}=e,o=l;if(o===void 0||o===i)return;e.oldValue=o;let n=J("undo");if(!n||typeof n.recordValue!="function")return;let a={prop:r,oldValue:i,newValue:o,read:s=>Fe(s,r,"history"),write:(s,h)=>Io(s,r,h)};n.isPaused?queueMicrotask(()=>{t.isConnected&&n.recordValue(t,a)}):n.recordValue(t,a)}function Io(e,t,r){let i=e.cloneNode(!1);t==="innerHTML"?i.innerHTML=r:i.textContent=r,qe(e,Array.from(i.childNodes),{morphStyle:"innerHTML",policy:"history",restoreFocus:!1,scripts:{handle:!1,merge:!1}})}function De(e,t,{restore:r=!0,record:i=!0}={}){i&&Bo(t),t.detachInput?.(),t.detachBlur?.(),Ee(()=>{if(!t.adopted){try{t.editor.destroy()}catch(l){console.warn("[hypercms] richclay teardown failed; editor state may reach the save",l)}t.richClayIsOurs&&t.el.removeAttribute("data-richclay")}t.el.removeAttribute(le),t.el.removeAttribute(xe),t.el.removeAttribute(ye),ws(t.boundId),r&&t.restorable()&&Io(t.el,"innerHTML",t.originalHTML)})}function it(e){let{editor:t,el:r}=e;if(r.ownerDocument.activeElement!==r)try{typeof t.focus=="function"?t.focus():r.focus()}catch{}}function ih(e,t,r,i){let l=new Map;for(let o of r){let n=l.get(o.el);n?n.push(o):l.set(o.el,[o])}for(let[o,n]of[...t]){let a=l.get(o)||[],s=a.find(m=>ft(m)===n.prop)||a[0];if(!s){De(e.ctx,n,{restore:!0}),t.delete(o);continue}n.path=s.path.join(".");let h=ft(s);if(h===n.prop)continue;let d=i.activeElement===o;De(e.ctx,n,{restore:!1}),t.delete(o);let f=e.bindText(o,n.path,h,{richClayIsOurs:n.richClayIsOurs,adopted:n.adopted,originalHTML:n.originalHTML});f&&d&&it(f)}return l}function lh(e,t){return e.el===t.el&&e.kind===t.kind&&e.attr===t.attr}function ft(e){return e.attr==="innerHTML"?"innerHTML":"textContent"}function oh(e,t,r){for(let i of e.pageRoot.querySelectorAll(`[${le}]`))t.has(i)||Ee(()=>Ss(i,r.defaultView))}function Ui(e,t,r){let i=e.formRoot&&e.formRoot.querySelector(`[data-hcms-path="${Se(r)}"]`);if(Nr(t.root),!i)return null;let l=i.closest("[data-hcms-card]"),o=l?[...l.querySelectorAll('[data-hcms-shape="scalar"][data-hcms-path]')].filter(n=>n.closest("[data-hcms-card]")===l&&n.closest('[data-hcms-shape="object-array"], [data-hcms-shape="scalar-array"]')===l.parentElement.closest('[data-hcms-shape="object-array"]')):[i];o.includes(i)||o.push(i);for(let n of o)Po(e,n);return i}function Vi(e,t,r){Nr(t.root);let i=null;for(let l of r){let o=e.formRoot&&e.formRoot.querySelector(`[data-hcms-path="${Se(l)}"]`);o&&(i=i||o,Po(e,o))}return i}function Po(e,t){t.classList.add(ke),t.removeAttribute("draggable");for(let r=t.parentElement;r&&(r.classList.add(or),r.removeAttribute("draggable"),r!==e.formRoot);r=r.parentElement);}function Nr(e){if(e)for(let t of e.querySelectorAll(`.${ke}, .${or}`))t.classList.remove(ke,or)}function Bt(e){e.tagName==="TEXTAREA"&&at(e),e.querySelectorAll?.("textarea").forEach(at)}function Wi(e){let t=e.matches?.(Hi)?e:e.querySelector?.(Hi);if(!(!t||typeof t.focus!="function"))try{t.focus({preventScroll:!0})}catch{t.focus()}}function nh(e,t){Ve(e);let r=e.createElement(Kc),i=t==="dark"?" dark":t==="light"?" light":"";return r.className="hcms-shell pixel-quiet hcms-inline"+i,r.setAttribute("data-hcms-shell",""),r.setAttribute("editor-ui",""),r.setAttribute("no-save",""),r.setAttribute("save-remove",""),r.setAttribute("snapshot-remove",""),r.setAttribute("no-watch",""),r.setAttribute("tabindex","-1"),r.innerHTML=`
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
          <span class="mirk-button__label">${pt("remove")}</span>
        </button>
      </div>
      <div data-hcms-form-root class="hcms-form"></div>
    </div>
  `,e.body.appendChild(r),{root:r,formRoot:r.querySelector("[data-hcms-form-root]"),noticeEl:r.querySelector(".hcms-inline-notice"),errorEl:r.querySelector(".hcms-inline-error"),handoffEl:r.querySelector(".hcms-inline-handoff"),handoffCountEl:r.querySelector(".hcms-inline-handoff-count"),layerEl:r.querySelector(".hcms-inline-layer"),popEl:r.querySelector(".hcms-inline-pop"),closeEl:r.querySelector(".hcms-inline-pop-close"),toggleEl:r.querySelector("[data-hcms-controls-toggle]"),pageStyleEl:r.querySelector("[data-hcms-page-style-open]"),popTitleEl:r.querySelector(".hcms-inline-pop-title"),destroy(){r.remove()}}}function ah(e,t){let r=e.querySelector(".hcms-array-items");return r&&r.querySelectorAll(":scope > [data-hcms-card], :scope > [data-hcms-array-item]")[t]||null}function sh(e,t,r){let{lists:i}=Lo(e.pageRoot,e.pageRules),l=i.find(o=>o.path.join(".")===t);return l?l.items.indexOf(r):-1}var ch="[hypercms]";function hh(e,t){if(!e||!e.querySelectorAll||!t)return;let r=uh(t);e.querySelectorAll("template[data-hcms-tpl]").forEach(i=>{let l=i.getAttribute("data-hcms-tpl");l&&(l.startsWith("@")||r.has(l)||console.warn(`${ch} template "${l}" doesn't match any rule path; ignored`))})}function uh(e){let t=new Set;return r([],e),t;function r(i,l){let o=i.join("."),n=i.map(s=>typeof s=="number"?"*":s).join(".");o&&t.add(o),n&&t.add(n);let a=Pe(l);if(a==="object")for(let[s,h]of Object.entries(l))r([...i,s],h);else if(a==="object-array"||a==="scalar-array"){let s=[...i,"*"],h=s.map(d=>typeof d=="number"?"*":d).join(".");if(t.add(h),a==="object-array"){let d=l[1];if(d&&typeof d=="object"&&!Array.isArray(d))for(let[f,m]of Object.entries(d))r([...s,f],m)}}}}var nr={skip:"[data-hcms-shell]",templateAttr:"cms-template"},R={isOpen:!1,ctx:null,opts:null};function dh({view:e,doc:t,pageRoot:r,opts:i={},onCloseRequested:l,onViewRequested:o}){let n=i.rules!==void 0?i.rules:"cms",a=G.findRules(t,n);if(!a){let b=typeof n=="string"?`data-rules-name~="${n}"`:"the provided rules object";throw new Error(`hypercms: no rules found for ${b}`)}let s=e.prepareRules(Ol(a.rules,r)),h=a.tagNode;Nl(t),Bl(t,s),hh(t,s);let d=Hl(s,t),f=qo(s),m=Ro(r,s),u=$l(),c=ce(G.extract(r,s,{...nr,...u.hooks}),s),p={doc:t,pageRoot:r,pageRules:s,writeRules:f,formRules:d,rulesTagNode:h,rulesSource:n,richText:e.richText,view:e,seeder:u,initialData:c,get formRoot(){return e.formRoot},get shellRoot(){return e.root},get errorEl(){return e.errorEl},get noticeEl(){return e.noticeEl},unresolved:m,lastTwinSignature:null,lastFingerprint:null,lastData:null,observerHandle:null,undoUnsub:null,livesyncUnsub:null,onChange:i.onChange,onError:i.onError,confirmRemove:i.confirmRemove,previouslyFocused:t.activeElement,quiesced:!1,dispatch(b,g){let k=t.defaultView&&t.defaultView.CustomEvent||(typeof CustomEvent<"u"?CustomEvent:null);if(!k)return;let y={...g||{},pageRoot:se(r),view:e.name},_=new k(b,{bubbles:!0,cancelable:b==="hcms:change",detail:y});(e.root&&e.root.isConnected!==!1?e.root:se(r)).dispatchEvent(_)},onCloseRequested:l,onViewRequested:o};return p.updateFingerprint=()=>{p.lastFingerprint=ct(Z(p))},e.ctx=p,p}function mh(e){e.updateFingerprint(),Tr(e,ce(G.extract(e.pageRoot,e.pageRules,nr),e.pageRules)),e.observerHandle=bc({onRefresh:i=>e.view.refresh("observer",i)});let t=J("undo");if(t&&typeof t.on=="function"){let i=()=>{if(R.ctx!==e)return;Gi(e,"undo");let l=ce(G.extract(e.pageRoot,e.pageRules,nr),e.pageRules);ct(l)!==ct(e.lastData)&&(e.lastData=l,e.onChange?.(l,{path:"",structural:!1}))};t.on("undo",i),t.on("redo",i),e.undoUnsub=()=>{t.off("undo",i),t.off("redo",i)}}let r=()=>Gi(e,"livesync");e.livesyncUnsub=Sr(e.doc,vs,r),Fr.ctx=e,kh(e.doc)}function Gi(e,t){R.ctx===e&&e.view.refresh(t)}function gt(e,{dispatch:t=!0,restoreFocus:r=!0,updateUrl:i=!0,reason:l="close"}={}){if(!e||e.closed)return;e.closed=!0;for(let n of e.uploads||[])try{n.abort()}catch{}e.uploads?.clear();let o=e.previouslyFocused;if(t&&e.dispatch("hcms:close",{reason:l}),i&&xh(),e.observerHandle?.unsubscribe?.(),e.undoUnsub?.(),e.livesyncUnsub?.(),e.detachEvents?.(),Ee(()=>e.view.destroy()),ph(),r&&typeof o?.focus=="function")try{o.focus()}catch{}}function ph(){R.isOpen=!1,R.ctx=null,R.opts=null,Fr.ctx=null}function Tt(e){let t=e||(typeof window<"u"?window:null),r=t&&t.clay?t.clay.modeLifecycle:null;return r&&typeof r.canWrite=="function"?r:null}function zr(e){let t=Tt(e);if(!t)return!0;try{return t.canWrite()!==!1}catch{return!1}}var fh="[data-hcms-uploading]";function Ho(e){if(!e)return[];let t=[];return e.uploads&&e.uploads.size>0&&t.push("upload"),e.pageRoot&&typeof e.pageRoot.querySelector=="function"&&e.pageRoot.querySelector(fh)&&t.push("preview"),t}function gh(e){if(!e||e.closed)return{ok:!0};let t=Ho(e);return t.length?{ok:!1,code:"pending-input",pending:t}:(e.quiesced=!0,{ok:!0})}function bh(e){!e||e.closed||(e.quiesced=!1)}var Fr={ctx:null};function kh(e){let t=e.defaultView||(typeof globalThis<"u"?globalThis:null);if(!t)return;let r=function(){let i=Fr.ctx;if(i)return So(i.formRoot),Ue("Reorder",()=>te(Z(i),{path:"",structural:!0},i))};typeof t.hypercmsCommit!="function"&&(t.hypercmsCommit=r),typeof globalThis<"u"&&typeof globalThis.hypercmsCommit!="function"&&(globalThis.hypercmsCommit=r)}var ar="cms";function vh(e){let t=typeof e=="string"?e:"",r=t.indexOf("?"),i=r===-1?t:t.slice(r+1);if(!i)return t;let l=new URLSearchParams(i);return l.get(ar)!=="true"?t:(l.set(ar,"false"),"?"+l.toString())}function yh(e){let t=typeof e=="string"?e:"",r=t.indexOf("?"),i=r===-1?t:t.slice(r+1);return i?new URLSearchParams(i).get(ar)==="true":!1}function xh(){if(typeof window>"u"||!window.location||!window.history||typeof window.history.replaceState!="function")return;let e=window.location.search,t=vh(e);t!==e&&window.history.replaceState(window.history.state,"",t+window.location.hash)}var Ji="hcms-toggle",W="data-hcms-toggle-host",Xi="hcms-toggle-style",Ki="data-hcms-toggle-style",bt="data-hcms-session",wh="var(--hcms-toggle-bg, var(--hcms-toggle-_surface))",Ah="#fafafa",_h="#0a0a0a",Eh=`
[${W}] {
  all: unset;
  box-sizing: border-box;
  display: var(--hcms-toggle-display, inline-flex);
  font-family: 'Departure Mono', ui-monospace, Menlo, monospace;
  --hcms-toggle-_surface: ${Ah};
}
[${W}][data-hcms-surface="dark"] {
  --hcms-toggle-_surface: ${_h};
}
[${W}] .hcms-toggle__main {
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
[${W}] .hcms-toggle__main:hover {
  border-color: var(--mirk-focus-color, #C7AE93);
  box-shadow: none;
}
[${W}] .hcms-toggle__main:active {
  border-color: var(--mirk-bevel-br, #E2D4BF) var(--mirk-bevel-tl, #F0E7D8) var(--mirk-bevel-tl, #F0E7D8) var(--mirk-bevel-br, #E2D4BF);
}
[${W}] .hcms-toggle__main:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: -5px;
}
[${W}] .hcms-toggle__close { display: none; }
[${W}][${bt}="open"] .hcms-toggle__open { display: none; }
[${W}][${bt}="open"] .hcms-toggle__close { display: inline; }
@media (pointer: coarse) {
  [${W}] .hcms-toggle__main { min-height: 44px; }
}
`;function Sh({search:e="",cookie:t="",forced:r=null}={}){let i=typeof e=="string"?e:"",l=i.indexOf("?"),o=l===-1?i:i.slice(l+1),n=new URLSearchParams(o).get("editmode");return n?n==="true":r!=null?!!r:/(?:^|;\s*)isAdminOfCurrentResource=[^;]/.test(t)}var It=new WeakMap;function Uo(e,t){try{e.globalCompositeOperation="copy",e.fillStyle=t,e.fillRect(0,0,1,1);let r=e.getImageData(0,0,1,1).data;return{r:r[0],g:r[1],b:r[2],a:r[3]/255}}catch{return null}}function Ch(e){if(It.has(e))return It.get(e);let t=null;try{let r=e.createElement("canvas");if(r.width=r.height=1,t=r.getContext?r.getContext("2d",{willReadFrequently:!0}):null,t){let i=Uo(t,"rgb(1, 2, 3)");(!i||i.r!==1||i.g!==2||i.b!==3||i.a!==1)&&(t=null)}}catch{t=null}return It.set(e,t),t}function Th(e,t){let r=String(e??"").trim();if(!r)return null;let i=Rh(r);if(i)return i;let l=t&&t.defaultView;if(!l||!l.CSS||typeof l.CSS.supports!="function"||!l.CSS.supports("color",r))return null;let o=Ch(t);return o?Uo(o,r):null}function Rh(e){let t=/rgba?\(([^)]+)\)/.exec(String(e??""));if(!t)return null;let r=t[1].split(/[\s,/]+/).filter(Boolean);if(r.length<3)return null;let i=r.slice(0,3).map(Number);if(i.some(Number.isNaN))return null;let l=r[3],o=l===void 0?1:l.endsWith("%")?Number(l.slice(0,-1))/100:Number(l);return{r:i[0],g:i[1],b:i[2],a:Number.isNaN(o)?1:o}}function Zi({r:e,g:t,b:r}){let i=l=>{let o=l/255;return o<=.03928?o/12.92:((o+.055)/1.055)**2.4};return .2126*i(e)+.7152*i(t)+.0722*i(r)}function Qi(e,t){let r=Zi(e),i=Zi(t);return(Math.max(r,i)+.05)/(Math.min(r,i)+.05)}var Yi={r:10,g:10,b:10},el={r:250,g:250,b:250};function tl(e,t){let r=e.a==null?1:e.a;return{r:e.r*r+t.r*(1-r),g:e.g*r+t.g*(1-r),b:e.b*r+t.b*(1-r)}}function qh(e){if(!e)return"light";let t=Qi(tl(e,Yi),Yi),r=Qi(tl(e,el),el);return t>r?"dark":"light"}function rl(e,t){for(let[r,i]of Object.entries(t))e.style.setProperty(r,i,"important")}function Pt(e){let t=e.ownerDocument&&e.ownerDocument.defaultView,r=e.querySelector(".hcms-toggle__main");if(!t||!r||typeof t.getComputedStyle!="function")return;let i=Th(t.getComputedStyle(r).color,e.ownerDocument);e.setAttribute("data-hcms-surface",qh(i))}function $h(e){Pt(e);let t=e.ownerDocument,r=t&&t.defaultView;if(!r)return;let i=0,l=()=>{if(!i){if(typeof r.requestAnimationFrame!="function")return e.isConnected?Pt(e):a();i=r.requestAnimationFrame(()=>{if(i=0,!e.isConnected)return a();Pt(e)})}};typeof r.requestAnimationFrame=="function"&&l(),t.readyState!=="complete"&&r.addEventListener("load",l,{once:!0});let o=typeof r.MutationObserver=="function"?new r.MutationObserver(l):null;o&&(o.observe(t.documentElement,{attributes:!0}),t.body&&o.observe(t.body,{attributes:!0}));let n=typeof r.matchMedia=="function"?r.matchMedia("(prefers-color-scheme: dark)"):null;n&&typeof n.addEventListener=="function"&&n.addEventListener("change",l);function a(){o&&o.disconnect(),n&&typeof n.removeEventListener=="function"&&n.removeEventListener("change",l)}}function Oh({open:e,close:t,isOpen:r,getTheme:i=()=>null},l=document){let o=l.querySelector(`[${W}]`);if(o)return o;if(!l.querySelector(`[${Ki}]`)){let u=l.createElement("style");u.setAttribute(Ki,""),u.setAttribute("editor-ui",""),l.getElementById(Xi)||(u.id=Xi),u.setAttribute("no-save",""),u.setAttribute("snapshot-remove",""),u.setAttribute("save-ignore",""),u.textContent=Eh,l.head.insertBefore(u,l.head.firstChild)}let n=l.createElement("hypercms-toggle");n.className="hcms-shell pixel-quiet",l.getElementById(Ji)||(n.id=Ji),n.setAttribute(W,""),n.setAttribute("editor-ui",""),n.setAttribute("no-save",""),n.setAttribute("snapshot-remove",""),n.setAttribute("save-ignore",""),n.innerHTML='<button type="button" class="hcms-toggle__main mirk-button"><span class="hcms-toggle__open">Edit content</span><span class="hcms-toggle__close">Close editor</span></button>';let a=n.querySelector(".hcms-toggle__main");rl(n,{position:"fixed",right:"calc(var(--hcms-toggle-offset, 16px) + var(--hcms-toggle-shift, 0px))",bottom:"calc(var(--hcms-toggle-offset, 16px) + env(safe-area-inset-bottom, 0px))","z-index":"var(--hcms-toggle-z, 2147482900)"}),rl(a,{background:wh});function s(u){let c=l.defaultView;if(!Tt(c))return null;let p=c.clay&&c.clay.setMode;return typeof p!="function"?null:p.call(c.clay,u)}function h(){let u=l.defaultView;return u&&u.clay?u.clay.mode:null}async function d(){if(r()){let p=s("view");if(p)return p;t();return}if(h()==="edit")return e();let u=s("edit");if(!u)return e();let c=await u;if(!(c&&c.ok===!1))return e()}async function f(u){try{await u()}catch(c){console.warn("hypercms: toggle failed to open the CMS",c)}}n.addEventListener("click",async()=>{await f(d)});let m=u=>{let c=i();n.classList.toggle("light",c==="light"),n.classList.toggle("dark",c==="dark"),u?n.setAttribute(bt,"open"):n.removeAttribute(bt)};return m(r()),l.addEventListener("hcms:open",()=>m(!0)),l.addEventListener("hcms:close",()=>m(!1)),l.body.appendChild(n),Ve(l),$h(n),n}function Lh(e){if(typeof window>"u"||typeof document>"u")return;let t=window.clay,r=!!t&&typeof t.setMode=="function",i=()=>{document.body&&e.hasRules(document)&&Oh(e)},l=n=>{document.readyState==="loading"?document.addEventListener("DOMContentLoaded",n,{once:!0}):n()};if(r){let n=!1,a=()=>{let h=window.clay&&window.clay.plugins;return!n&&Array.isArray(h)&&h.includes("menu")},s=()=>{if(window.clay&&window.clay.canEdit===!0&&!a()){i();return}let h=document.querySelector(`[${W}]`);h&&h.remove()};l(s),document.addEventListener("clay:capabilitychange",s),document.addEventListener("clay:plugin-failed",h=>{!h.detail||h.detail.plugin!=="menu"||(n=!0,s())});return}let o=window.__hyperclayEditMode!=null?window.__hyperclayEditMode:null;Sh({search:window.location.search,cookie:document.cookie,forced:o})&&l(i)}function jh(e){if(ic(e),typeof document<"u"){let t=document.getElementById("hcms-shell-styles");t?.tagName==="LINK"&&t.remove(),Ve(document)}}var sr={sidebar:vc,inline:eh};function Mh(e,t){let r=t!==void 0?t:"cms";if(typeof r!="string")return"sidebar";let i=G.findRules(e,r)?.tagNode?.getAttribute?.("data-cms-view");return!i||i==="sidebar"?"sidebar":sr[i]?i:(console.warn(`hypercms: unknown data-cms-view "${i}" on the rules tag, opening the sidebar`),"sidebar")}function Dr(e={}){return Br(e)}function Nh(e){let t=e&&e.defaultView;if(!Tt(t))return null;let r=t.clay&&t.clay.setMode;return typeof r!="function"?null:r.call(t.clay,"view")}function Br(e={},t=!1){let r=R.isOpen?{...R.opts,...e}:e,i=r.pageRoot||(typeof document<"u"?document:null);if(!i)throw new Error("hypercms: no pageRoot available");let l=(i.nodeType===9?i:i.ownerDocument)||(typeof document<"u"?document:null);if(!l)throw new Error("hypercms: no document available");if(!t&&!zr(l.defaultView))return{ok:!1,code:"not-allowed"};let o=e.view||(R.isOpen?R.ctx.view.name:Mh(l,r.rules)),n=sr[o];if(!n)throw new Error(`hypercms: unknown view "${o}" (expected ${Object.keys(sr).join(" or ")})`);let a=R.isOpen?{...r,view:o}:e,s=null,h=null;if(R.isOpen){if(R.ctx.view.name===o)return{ok:!0,view:o};s=R.ctx.previouslyFocused,h=R.ctx.view.name,gt(R.ctx,{restoreFocus:!1,updateUrl:!1,reason:"switch"})}Ic();let d=n({doc:l,pageRoot:i,opts:a}),f=dh({view:d,doc:l,pageRoot:i,opts:a,onCloseRequested:()=>Nh(l)||Ir(),onViewRequested:m=>Br({view:m},!0)});s&&(f.previouslyFocused=s);try{d.mount(f.initialData),mh(f),d.focusOnOpen(),R.isOpen=!0,R.ctx=f,R.opts=a,f.dispatch("hcms:open",{pageRoot:i,previous:h})}catch(m){throw gt(f,{dispatch:!1,restoreFocus:!!s,updateUrl:!1}),m}return{ok:!0,view:o}}function Ir(){if(!R.isOpen)return{ok:!1,code:"no-session"};let e=R.ctx.doc;if(Tt(e&&e.defaultView)){let t=Ho(R.ctx);if(t.length)return{ok:!1,code:"pending-input",pending:t};if(!zr(e&&e.defaultView))return{ok:!1,code:"busy"}}return gt(R.ctx),{ok:!0}}function Vo(){R.isOpen&&R.ctx.view.refresh("api")}function zh(){return R.isOpen}function Fh(){return R.isOpen&&R.ctx?R.ctx.view.name:null}function Wo({doc:e,pageRoot:t,opts:r={}}={}){let i=null,l=!1;return{ready:Promise.resolve(),enable(){if(l)return;let o={...r};t&&(o.pageRoot=t),o.pageRoot||(o.pageRoot=e&&e.body||e||null),Br(o,!0),i=R.ctx},quiesce(){return l||!i||R.ctx!==i?{ok:!0}:gh(i)},resume(){l||!i||R.ctx!==i||bh(i)},dispose(){l||(l=!0,i&&R.ctx===i&&gt(i),i=null)}}}function Dh(e={}){return{id:"hypercms",order:1e3,prepare(){return Wo(e)}}}function Ht(){if(!R.isOpen)throw new Error("hypercms: cms is not open");if(R.ctx.quiesced)throw new Error("hypercms: the CMS is not admitting new changes")}var Bh={getData(){return R.isOpen?Z(R.ctx):null},setValue(e,t){Ht();let r=R.ctx,i=ve(e),l=Be(r.pageRules,i);if(l===void 0)throw new Error(`hypercms: no rule at path "${e}"`);if(typeof l!="string"||l.endsWith("[]"))throw new Error(`hypercms: setValue requires a leaf scalar path; "${e}" is not a leaf`);let o=Ao(r.formRoot,e);if(!o)throw new Error(`hypercms: no field element at path "${e}"`);_o(o,t,r.formRoot,e),te(Z(r),{path:e,structural:!1},r)},addItem(e){Ht(),Rr(e,R.ctx)},removeItem(e){Ht();let t=R.ctx,r=ve(e);if(typeof r[r.length-1]!="number")throw new Error(`hypercms: removeItem requires an item path; "${e}" is not an array index`);let i=Be(t.pageRules,r.slice(0,-1));if(!(Array.isArray(i)||typeof i=="string"&&i.endsWith("[]")))throw new Error(`hypercms: removeItem requires an item path; parent of "${e}" is not an array`);let l=t.formRoot.querySelector(`[data-hcms-path="${Vh(e)}"]`);if(!l)throw new Error(`hypercms: no element at path "${e}"`);je(l,t)},refresh:Vo,_commit(){if(!R.isOpen||R.ctx.quiesced)return;let e=R.ctx;return So(e.formRoot),Ue("Update",()=>te(Z(e),{path:"",structural:!0},e))}},Ih=250,Ph=1e4;function Hh(){typeof window>"u"||typeof document>"u"||yh(window.location?window.location.search:"")&&(R.isOpen||Uh(()=>{if(!R.isOpen&&zr())try{Dr()}catch(e){console.warn("hypercms: auto-open failed",e)}}))}function Ut(){return!!document.body&&!!J("Mutation")}function Uh(e){if(Ut()){queueMicrotask(e);return}let t=Date.now()+Ph,r=!1,i=null,l=null,o=()=>{r||(r=!0,i!==null&&clearInterval(i),l&&l())};function n(){if(R.isOpen){o();return}Ut()&&(o(),e())}l=Sr(document,ks,n),i=setInterval(()=>{if(R.isOpen){o();return}if(Ut()){o(),e();return}Date.now()>=t&&(o(),console.warn("hypercms: ?cms=true auto-open gave up \u2014 no mutation hub appeared. Load clayjs or hyperclayjs (or just the mutation utility) so the CMS can initialize."))},Ih)}Hh();Lh({open:Dr,close:Ir,isOpen:zh,getTheme:()=>R.opts?.theme,hasRules:e=>!!G.findRules(e,"cms")});var Go={open:Dr,close:Ir,refresh:Vo,api:Bh,hasRules:(e=document)=>!!G.findRules(e,"cms"),prepareModeLease:Wo,modeParticipant:Dh,get isOpen(){return R.isOpen},currentView:Fh,path:Sl,scaffold:mr,morphForm:Cl};function Vh(e){return typeof CSS<"u"&&CSS.escape?CSS.escape(e):String(e).replace(/[^a-zA-Z0-9_\-.*]/g,t=>"\\"+t)}var Wh=`/* GENERATED by scripts/build-theme.js from mirk-interface/mirk.css \u2014 DO NOT EDIT.
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
`;typeof window<"u"&&typeof document<"u"&&(function(){if(window.__mirk)return;window.__mirk=!0;let e='<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4 12 12M12 4 4 12" stroke="currentColor" stroke-width="2" stroke-linecap="square" fill="none"/></svg>';document.addEventListener("click",r=>{let i=r.target.closest(".mirk-number__step");if(!i)return;let l=i.closest(".mirk-number").querySelector("input[type=number]");l&&(i.dataset.step==="up"?l.stepUp():l.stepDown(),l.dispatchEvent(new Event("change",{bubbles:!0})))}),document.addEventListener("input",r=>{let i=r.target.closest(".mirk-slider__input");i&&i.closest(".mirk-slider").style.setProperty("--mirk-value",`${i.value}%`)}),document.addEventListener("change",r=>{let i=r.target.closest(".mirk-file__input");if(!i||!i.files.length)return;let l=i.closest(".mirk-file"),o=l.querySelector(".mirk-file__name");if(!o)return;let n=i.files[0],a=document.createElement("a");if(a.className="mirk-file__name",a.dataset.filled="",a.href=URL.createObjectURL(n),a.target="_blank",a.rel="noopener",a.textContent=n.name,o.replaceWith(a),!l.querySelector(".mirk-file__remove")){let s=document.createElement("button");s.type="button",s.className="mirk-file__remove",s.setAttribute("aria-label","Remove file"),s.innerHTML=e,a.after(s)}}),document.addEventListener("change",r=>{let i=r.target.closest(".mirk-image__input");if(!i||!i.files.length)return;let l=i.closest(".mirk-image"),o=l.querySelector(".mirk-image__preview");if(!o)return;let n=l.querySelector(".mirk-image__placeholder"),a=new FileReader;a.onload=s=>{o.src=s.target.result,o.removeAttribute("hidden"),n&&n.setAttribute("hidden",""),l.querySelector(".mirk-image__thumb")?.removeAttribute("hidden"),l.querySelector(".mirk-image__upload")?.setAttribute("hidden","")},a.readAsDataURL(i.files[0])}),document.addEventListener("click",r=>{let i=r.target.closest(".mirk-file__remove");if(i){let o=i.closest(".mirk-file"),n=o?.querySelector(".mirk-file__input"),a=o?.querySelector(".mirk-file__name");if(n&&(n.value=""),a){let s=document.createElement("span");s.className="mirk-file__name",s.textContent="No file chosen",a.replaceWith(s)}i.remove();return}let l=r.target.closest(".mirk-image__remove");if(l){let o=l.closest(".mirk-image"),n=o?.querySelector(".mirk-image__input"),a=o?.querySelector(".mirk-image__preview");n&&(n.value=""),a&&(a.removeAttribute("src"),a.setAttribute("hidden","")),o?.querySelector(".mirk-image__thumb")?.setAttribute("hidden",""),o?.querySelector(".mirk-image__upload")?.removeAttribute("hidden")}});function t(r,i){let l=document.createElement("span");l.textContent=r;let o=document.createElement("input");o.type="hidden",o.name="tags[]",o.value=r;let n=document.createElement("button");n.type="button",n.className="mirk-tags__remove",n.textContent="\xD7";let a=document.createElement("span");if(a.className="mirk-tags__chip",i){let s=document.createElement("span");s.className="mirk-tags__chip-inner",s.append(l,o,n),a.append(s)}else a.append(l,o,n);return a}document.addEventListener("keydown",r=>{let i=r.target.closest(".mirk-tags__input");if(!i)return;let l=i.closest(".mirk-tags");if(r.key==="Enter"||r.key===","){let o=i.value.trim();if(!o)return;r.preventDefault(),i.before(t(o,l.classList.contains("mirk-tags--round"))),i.value=""}else if(r.key==="Backspace"&&!i.value){let o=l.querySelectorAll(".mirk-tags__chip");o[o.length-1]?.remove()}}),document.addEventListener("click",r=>{let i=r.target.closest(".mirk-tags__remove");if(i){i.closest(".mirk-tags__chip").remove();return}let l=r.target.closest(".mirk-tags");l&&r.target===l&&l.querySelector(".mirk-tags__input")?.focus()}),document.addEventListener("click",r=>{let i=r.target.closest("[data-mirk-chip]");if(!i)return;let l=i.getAttribute("data-mirk-chip");if(l==="open")i.closest(".mirk-chip")?.classList.add("mirk-chip--open");else if(l==="collapse")i.closest(".mirk-chip")?.classList.remove("mirk-chip--open");else if(l==="changes"){let o=i.closest(".mirk-chip__panel")?.classList.toggle("is-changes");i.textContent=o?"(hide changes)":"(view changes)"}}),document.addEventListener("click",r=>{let i=r.target.closest("[data-copy-btn]");if(!i)return;let l=i.closest("[data-copy]");if(!l)return;let o=l.cloneNode(!0);o.querySelectorAll("[data-copy-btn]").forEach(a=>a.remove());let n=l.getAttribute("data-copy")==="text"?o.textContent.replace(/^\s+|\s+$/g,""):o.innerHTML.replace(/\s+data-copy(="[^"]*")?/g,"").replace(/^\s*\n/gm,"").trim();navigator.clipboard.writeText(n).then(()=>{let a=i.textContent;i.textContent="copied",i.dataset.copied="",setTimeout(()=>{i.textContent=a,delete i.dataset.copied},1200)}).catch(()=>{i.textContent="error",setTimeout(()=>{i.textContent="copy"},1200)})})})();jh(Wh);var Pr=Go,Gh={cms:Go};typeof window<"u"&&!window.__hyperclayNoAutoExport&&(window.hyperclay=window.hyperclay||{},window.hyperclay.hypercms=Pr,window.h=window.hyperclay);var Ce=Pr,Jh=il;$t("cms",Qr);$t("cms-toggle",ei,{roots:Yr});var Rt=(e,t)=>Object.assign(new Error(`clay:cms: ${e}`),{code:t}),Xh=e=>e?e.signal?.aborted?!0:typeof e.isCurrent=="function"&&!e.isCurrent():!1;function Jo(e){let t=!1;return{ready:e.ready,enable(){t||e.enable()},quiesce(){if(t)return;let r=e.quiesce();if(r&&r.ok===!1)throw Object.assign(Rt("the CMS still has work to finish",r.code||"pending-input"),{pending:r.pending});return r},resume(){t||e.resume()},dispose(){t||(t=!0,e.dispose())}}}function Kh(){if(Ce.isOpen)throw Rt("the CMS this boot opened cannot be taken back","unsupported-plugin");let e=Jo(Ce.prepareModeLease({}));return{enable(){},quiesce:()=>e.quiesce(),resume:()=>e.resume(),dispose:()=>e.dispose()}}function _u(e={}){return{id:"clay:cms",order:1e3,async prepare(t={}){if(typeof Ce.prepareModeLease!="function")throw Rt("this vendor build has no quiescable session","unsupported-plugin");if(Xh(t))throw Rt("prepared for a stale generation","stale-document");return t.initial===!0?Kh():Jo(Ce.prepareModeLease(e))}}}export{Ce as cms,_u as cmsParticipant,Jh as default,_u as modeParticipant};
