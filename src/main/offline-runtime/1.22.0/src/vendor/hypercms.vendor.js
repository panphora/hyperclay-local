var sl=Object.defineProperty;var Sr=(e,t)=>{for(var r in t)sl(e,r,{get:t[r],enumerable:!0})};var jn={};Sr(jn,{cms:()=>wr,default:()=>zu});var Ct=["textContent","innerText","innerHTML","outerHTML","value","checked","selected","disabled","readOnly","type","tagName","nodeName","nodeType","nodeValue","childElementCount","id","className","classList","baseURI","offsetWidth","offsetHeight","clientWidth","clientHeight","scrollWidth","scrollHeight","dataset","currentSrc","duration","paused","title","documentURI","contentType"],nt=new Set(Ct),Er=new Set(["textContent","innerText","innerHTML","value","checked","selected","disabled","readOnly","type","id","className","title"]),Re=new Set(["tagName","nodeName","nodeType","nodeValue","childElementCount","classList","baseURI","documentURI","contentType","offsetWidth","offsetHeight","clientWidth","clientHeight","scrollWidth","scrollHeight","currentSrc","duration","paused","dataset"]),Hn=new Set(["checked","selected","disabled","readOnly","paused"]);function _r(e,t){return t==null?Hn.has(e)?!1:"":Hn.has(e)?t==="false"?!1:!!t:t}function q(e){let t=0,r=null,n=-1;for(let i=0;i<e.length;i++){let o=e[i];o==="\\"?i++:r?o===r&&(r=null):o==='"'||o==="'"?r=o:o==="["||o==="("?t++:o==="]"||o===")"?t>0&&t--:o==="@"&&t===0&&(n=i)}return n}function it(e){let t=q(e);return t===-1?{selector:e,prop:null}:{selector:e.slice(0,t),prop:e.slice(t+1)||null}}function Tr(e){let t=0,r=null,n=-1,i=!1;for(let o=0;o<e.length;o++){let s=e[o];s==="\\"?o++:r?s===r&&(r=null):s==='"'||s==="'"?r=s:s==="["||s==="("?t++:s==="]"||s===")"?t>0&&t--:t===0&&s===">"?n=o:t===0&&s===","&&(i=!0)}return i||n===-1||!ll(e,n+1)?null:e.slice(0,n).trim()||null}function ll(e,t){let r=t,n=e.replace(/\s+$/,"").length;for(;r<n&&/\s/.test(e[r]);)r++;let i=0,o=null;for(;r<n;r++){let s=e[r];if(s==="\\")r++;else if(o)s===o&&(o=null);else if(s==='"'||s==="'")o=s;else if(s==="["||s==="(")i++;else if(s==="]"||s===")")i>0&&i--;else if(i===0&&(s==="+"||s==="~"||/\s/.test(s)))return!1}return!0}import sd from"./hyper-morph.vendor.js";var Lt={};Sr(Lt,{EmptyListInsert:()=>ue,MAX_RULE_DEPTH:()=>Me,MaxRuleDepthExceeded:()=>ye,NoRulesTag:()=>Cr,RuleTargetReadOnly:()=>st,RulesParseError:()=>Le,ShapeMismatch:()=>ot,UnknownRulesVersion:()=>Ne,WriteNotRoundTripped:()=>Rt,WriteRefused:()=>Ot,WriteRejected:()=>Or});var Le=class extends Error{constructor(t,r){super(t),this.name="RulesParseError",this.cause=r}},Ne=class extends Error{constructor(t){super(`unknown rules version: ${t}. Library supports "1".`),this.name="UnknownRulesVersion",this.version=t}},Me=20,ye=class extends Error{constructor(t){super(`rule depth exceeded ${Me} at path: ${t.join(".")}`),this.name="MaxRuleDepthExceeded",this.path=t}},ot=class extends Error{constructor(t){super(`shape mismatch: ${t.length} field(s) failed validation`),this.name="ShapeMismatch",this.mismatches=t}},ue=class extends Error{constructor(t,r){super(r?`cannot add items to empty list at "${t.join(".")}" \u2014 ${r}`:`cannot add items to empty list at "${t.join(".")}" \u2014 no sibling to clone as template. Seed the list with a hidden item first.`),this.name="EmptyListInsert",this.path=t}},st=class extends Error{constructor(t){super(`cannot write to read-only DOM property "${t}"`),this.name="RuleTargetReadOnly",this.target=t}},Ot=class extends Error{constructor(t){super(`write refused: ${t.length} write(s) broke the content-only policy`),this.name="WriteRefused",this.refusals=t}};function ml(e){return e.reduce((r,n)=>typeof n=="number"?`${r}[${n}]`:r?`${r}.${n}`:String(n),"")||"(root)"}var Rt=class extends Error{constructor(t){super(`write did not round-trip at "${ml(t)}"`),this.name="WriteNotRoundTripped",this.path=t}},Cr=class extends Error{constructor(t){super(`no <script data-rules-name~="${t}"> rules tag in this document`),this.name="NoRulesTag",this.token=t}},Or=class extends Error{constructor(t,r){super(`write rejected: ${t.length} unknown key(s), ${r.length} rule(s) with no matching element`),this.name="WriteRejected",this.unknownKeys=t,this.unmatched=r}};var fl=/^--[A-Za-z0-9_-]+$/;function ve(e){return typeof e=="string"&&fl.test(e)}function Wn(e){let t=[],r=[],n=null,i=0;for(let o=0;o<e.length;o++){let s=e[o];if(n){s==="\\"?o++:s===n&&(n=null);continue}if(s==="/"&&e[o+1]==="*"){let l=e.indexOf("*/",o+2);o=l===-1?e.length:l+1;continue}s==='"'||s==="'"?n=s:s==="("?r.push(")"):s==="["?r.push("]"):s==="{"?r.push("}"):(s===")"||s==="]"||s==="}")&&r[r.length-1]===s?r.pop():s===";"&&r.length===0&&(t.push(e.slice(i,o)),i=o+1)}return t.push(e.slice(i)),t}function pl(e){let t="",r=null;for(let n=0;n<e.length;n++){let i=e[n];if(r){t+=i,i==="\\"&&n+1<e.length?t+=e[++n]:i===r&&(r=null);continue}if(i==="/"&&e[n+1]==="*"){let o=e.indexOf("*/",n+2);n=o===-1?e.length:o+1,t+=" ";continue}(i==='"'||i==="'")&&(r=i),t+=i}return t}function Kn(e){e=pl(e);let t=e.indexOf(":");if(t===-1)return null;let r=e.slice(0,t).trim(),n=e.slice(t+1).trim(),i=/!\s*important\s*$/i.exec(n);return i&&(n=n.slice(0,i.index).trim()),{name:r,value:n,important:!!i}}function lt(e,t){if(e==null)return null;let r=null;for(let n of Wn(String(e))){let i=Kn(n);!i||i.name!==t||(!r||i.important||!r.important)&&(r=i)}return r?r.value:null}function Gn(e,t,r){let n=e==null?"":String(e),i=r==null||r==="",o=Wn(n),s=o.map(Kn),l=s.some(p=>p&&p.name===t&&p.important),a=[],u=!1;o.forEach((p,h)=>{let m=s[h];if(!m||m.name!==t){a.push(p);return}if(i||u)return;let c=/^\s*/.exec(p)[0];a.push(`${c}${t}: ${r}${l?" !important":""}`),u=!0});let d=a.join(";");if(!i&&!u){let p=d.trimEnd();d=p===""?`${t}: ${r}`:`${p}${p.endsWith(";")?" ":"; "}${t}: ${r}`}return d.trim()===""?null:d}function Rr(e,t,r,n){let i=e.attr(t,"style");if((lt(i,r)??"")===n)return;let o=Gn(i,r,n);o==null?e.removeAttr(t,"style"):e.attr(t,"style",o)}function de(e,t,r,n={}){if(Object.prototype.hasOwnProperty.call(n,"exclude")&&e.semanticExclude===!1)throw new Error("This adapter does not support semantic exclude queries; omit exclude or use the DOM adapter.");return Lr(e,t,r,{depth:0,path:[]},n)}function Lr(e,t,r,n,i){if(n.depth>Me)throw new ye(n.path);if(typeof r=="string")return gl(e,t,r,n,i);if(Array.isArray(r)){let[o,s]=r,l=e.find(t,o,i);return Xn(i,n,l),l.map((a,u)=>Lr(e,a,s,{depth:n.depth+1,path:[...n.path,u]},i))}if(typeof r=="object"&&r!==null){let o={};for(let[s,l]of Object.entries(r))o[s]=Lr(e,t,l,{depth:n.depth+1,path:[...n.path,s]},i);return o}return null}function gl(e,t,r,n,i){if(r.endsWith("[]")){let l=r.slice(0,-2),a=e.find(t,l,i);return Xn(i,n,a),a.map(u=>e.text(u))}if(r.startsWith("@"))return Yn(e,t,r.slice(1));let o=q(r);if(o!==-1){let l=r.slice(0,o),a=r.slice(o+1),u=l?e.find(t,l,i):[t];return u.length===0?null:Yn(e,u[0],a)}if(r===".")return e.text(t);let s=e.find(t,r,i);return s.length===0?null:e.text(s[0])}function Xn(e,t,r){if(typeof e.onRowsRead=="function")try{e.onRowsRead(t.path.slice(),r)}catch(n){console.warn(`[hyper-html-api] onRowsRead threw at "${t.path.join(".")||"(root)"}"`,n)}}function Yn(e,t,r){if(ve(r))return lt(e.attr(t,"style"),r);if(nt.has(r)){let i=e.prop(t,r);return i==null?null:String(i)}let n=e.attr(t,r);return n??null}var Nt=Object.freeze({data:Object.freeze({tokens:["no-data"],bundles:["editor-ui"]}),save:Object.freeze({tokens:["no-save"],bundles:["editor-ui"]}),snapshot:Object.freeze({tokens:["no-snapshot"],bundles:["editor-ui"]}),watch:Object.freeze({tokens:["no-watch"],bundles:["editor-ui"]}),undo:Object.freeze({tokens:["no-undo"],bundles:["editor-ui"]}),history:Object.freeze({tokens:[],bundles:["editor-ui"]})}),bl=Object.freeze({"editor-ui":Object.freeze(["no-data","no-save","no-snapshot","no-watch","no-undo"])}),Jn=Object.freeze(["no-save","no-snapshot","no-trigger-autosave","no-dirty","no-watch","no-undo","no-data","freeze","editor-ui","live"]);function at(e,t){if(!e||e.nodeType!==1)return!1;let r=e.getAttribute?.("clay");return!!(r&&r.split(/\s+/).includes(t)||e.hasAttribute?.(t))}function Nr(e,t){if(at(e,t))return!0;for(let[r,n]of Object.entries(bl))if(n.includes(t)&&at(e,r))return!0;return!1}function ct(e){let t=Nt[e];if(!t)throw new Error(`Unknown region capability: ${e}`);return[...t.tokens,...t.bundles].flatMap(r=>[`[clay~="${r}"]`,`[${r}]`]).join(", ")}function kl(e,t){let r=e&&e.nodeType===1?e:e?.parentElement;for(;r&&r.nodeType===1;){let n=Nt[t];if(!n)throw new Error(`Unknown region capability: ${t}`);if(n.tokens.some(i=>Nr(r,i))||n.bundles.some(i=>at(r,i)))return r;r=r.parentElement}return null}function Zn(e,t){return!!kl(e,t)}var yl=/:(?:focus(?:-within|-visible)?|hover|active|visited|defined)\b/i;function vl(e,t){if(!/^(INPUT|TEXTAREA|SELECT|OPTION)$/.test(e.tagName||""))return;let r=(e.getAttribute?.("type")||"").toLowerCase();"value"in e&&"value"in t&&e.tagName!=="OPTION"&&r!=="checkbox"&&r!=="radio"&&r!=="file"&&(t.value=e.value),e.tagName==="INPUT"&&(r==="checkbox"||r==="radio")&&(t.checked=e.checked),e.tagName==="OPTION"&&(t.selected=e.selected),"indeterminate"in e&&"indeterminate"in t&&(t.indeterminate=e.indeterminate)}function Qn(e,t,r,n){if(n)return!!e.closest?.(t);let i=e;for(;i?.nodeType===1;){if(i.matches(t))return!0;if(i===r)break;i=i.parentElement}return!1}function ei(e,t,r,n,i,o){return(o?Zn(e,t):Qn(e,r,i,!1))||!!(n&&(o&&e!==i?e.matches(n):Qn(e,n,i,o)))}function xl(e,t){let r=Nt[t];return r.tokens.some(n=>Nr(e,n))||r.bundles.some(n=>at(e,n))}var wl=new Set(["INPUT","TEXTAREA","SELECT","OPTION"]);function ti(e,t,r,n){if(e.nodeType===1&&n(e)){r.dropped.push(t);return}r.cloneToLive.set(t,e),r.liveToClone.set(e,t);let i=e,o=t;if(e.nodeType===1){if(wl.has(e.tagName)&&r.controls.push(e,t),e.tagName==="TEMPLATE"){for(;t.firstChild;)t.removeChild(t.firstChild);i=e.content,o=t.content,r.cloneToLive.set(o,i),r.liveToClone.set(i,o)}}else if(e.nodeType!==11)return;let s=o.firstChild;for(let l=i.firstChild;l&&s;l=l.nextSibling)ti(l,s,r,n),s=s.nextSibling}function ut(e,{capability:t="data",exclude:r=null,inherit:n=!0,provenance:i=null}={}){if(!e)throw new TypeError("createContentView requires a DOM context");let o=e.nodeType===9?e:e.ownerDocument;if(!o?.implementation?.createHTMLDocument)throw new TypeError("createContentView requires an HTML DOM implementation");let s=o.implementation.createHTMLDocument(""),l=i||new WeakMap,a=new WeakMap,u=e.nodeType===9?e.documentElement:e;r&&s.documentElement.matches(r);let d=ct(t),p=n?c=>xl(c,t)||!!(r&&c.matches(r)):c=>ei(c,t,d,r,u,!1),h=null;if(u.nodeType!==1||!ei(u,t,d,r,u,n)){h=s.importNode(u,!0);let c={cloneToLive:l,liveToClone:a,dropped:[],controls:[]};ti(u,h,c,p);for(let f of c.dropped)f.remove();for(let f=0;f<c.controls.length;f+=2)vl(c.controls[f],c.controls[f+1])}e.nodeType===9&&h&&(s.replaceChild(h,s.documentElement),a.set(e,s),l.set(s,e));let m=c=>{if(yl.test(c))throw new Error(`Filtered content queries do not support stateful selector: ${c}`)};return{root:h,document:s,capability:t,selector:ct(t),cloneToLive:l,liveToClone:a,original(c){return l.get(c)||null},cloneOf(c){return a.get(c)||null},query(c,f=h){return m(c),Array.from(f.querySelectorAll(c),b=>l.get(b)||b)},text(c=h){return(c===h?h:a.get(c))?.textContent||""},html(c=h){return(c===h?h:a.get(c))?.innerHTML??""},clone(c=h){let f=c===h?h:a.get(c);return f?s.importNode(f,!0):null}}}function ni(e){return e&&e.nodeType===1&&e.tagName==="SCRIPT"&&e.hasAttribute&&e.hasAttribute("data-rules-name")}function Al(e){return e?(e.nodeType===9||e.nodeType===11,e):null}function ri(e,t,r){!e||e.nodeType!==1||(t==="value"&&e.tagName==="INPUT"?e.value=r===null?"":r:t==="checked"&&e.tagName==="INPUT"?e.checked=r!==null:t==="selected"&&e.tagName==="OPTION"&&(e.selected=r!==null))}function ii(e,t){e&&e.tagName==="TEXTAREA"&&(e.value=t)}function oi(e){if(!e||e.nodeType!==1)return;let t=[e,...e.querySelectorAll?e.querySelectorAll("textarea, input, option"):[]];for(let r of t)if(r.tagName==="TEXTAREA")r.value=r.defaultValue;else if(r.tagName==="INPUT"){let n=r.type;n!=="file"&&n!=="checkbox"&&n!=="radio"&&(r.value=r.defaultValue),r.checked=r.defaultChecked}else r.tagName==="OPTION"&&(r.selected=r.defaultSelected)}var F={semanticExclude:!0,find(e,t,r={}){let n=Al(e);if(!n||!n.querySelectorAll)return[];let i=Array.from(n.querySelectorAll(t));r.includeRulesTag||(i=i.filter(l=>!ni(l)));let o=[];r.skip&&o.push(r.skip);let s=r.templateAttr===null?null:r.templateAttr||"cms-template";if(s&&o.push("["+s+"]"),o.length){let l=o.join(", ");i=i.filter(a=>!a.closest||!a.closest(l))}return i},parent(e){return e?e.parentElement:null},children(e){return e?Array.from(e.children):[]},matches(e,t){return!!(e&&e.matches)&&e.matches(t)},text(e,t){if(t===void 0)return(e.textContent||"").trim();e.textContent=t,ii(e,t)},attr(e,t,r){if(r===void 0)return e.hasAttribute&&e.hasAttribute(t)?e.getAttribute(t):null;e.setAttribute(t,r),ri(e,t,r)},removeAttr(e,t){e&&e.removeAttribute&&e.removeAttribute(t),ri(e,t,null)},prop(e,t,r){if(r===void 0){let n=e?e[t]:void 0;return n!==void 0?n:null}e[t]=r},clone(e){let t=e.cloneNode(!0);return oi(t),t},insertAt(e,t,r){let n=e.children[r]||null;e.insertBefore(t,n)},insertBefore(e,t){e.parentNode.insertBefore(t,e)},insertAfter(e,t){e.parentNode.insertBefore(t,e.nextSibling)},identity(e){return e||null},remove(e){e&&e.parentNode&&e.parentNode.removeChild(e)},replaceWith(e,t){if(!e||!e.parentNode)throw new Error("dom.replaceWith: node has no parent");let n=e.ownerDocument.createElement("template");n.innerHTML=t;let i=n.content.firstElementChild;if(!i)throw new Error("dom.replaceWith: html did not parse to an element");return e.parentNode.replaceChild(i,e),i},stripIds(e){let t=0;return e.id&&(e.removeAttribute("id"),t++),(e.querySelectorAll?e.querySelectorAll("[id]"):[]).forEach(n=>{n.removeAttribute("id"),t++}),t},sameNode(e,t){return e===t}};function ne(e,t={}){if(t.exclude===null)return F;let r=[ct("data"),t.exclude].filter(Boolean).join(", "),n=e.nodeType===9?e:e.ownerDocument||e,i=e.nodeType===9?e.documentElement:e;if(!t._write&&!i?.matches?.(r)&&!i?.querySelector?.(r)&&!n?.querySelector?.(r))return F;let o=e.nodeType===9||!e.isConnected?e:e.ownerDocument,s=e.nodeType===9?e:e.ownerDocument,l=null,a=()=>l||(l=ut(o,{capability:"data",exclude:t.exclude||null})),u=c=>{let f=a();return c===e?f.cloneOf(e):f.cloneOf(c)||c},d=c=>l?.original(c)||c,p=(c,f)=>{a().liveToClone.set(c,f),a().cloneToLive.set(f,c);let b=c.childNodes||[],g=f.childNodes||[];for(let k=0;k<Math.min(b.length,g.length);k++)p(b[k],g[k])},h=(c,f,b,g)=>{let k=Array.from(c.childNodes).filter(O=>l.cloneOf(O)),A=k[0];for(;A&&k.includes(A);)A=A.nextSibling;for(let O of k)O.remove();if(b==="innerHTML"){let O=s.createElement("template");O.innerHTML=g;for(let B of Array.from(O.content.childNodes))c.insertBefore(B,A||null)}else c.insertBefore(s.createTextNode(g),A||null),ii(c,g);let S=ut(c,{capability:"data",exclude:t.exclude||null});f.replaceChildren(...Array.from(S.root?.childNodes||[]));let E=O=>{let B=S.original(O);B&&(l.liveToClone.set(B,O),l.cloneToLive.set(O,B));for(let ce of Array.from(O.childNodes||[]))E(ce)};for(let O of Array.from(f.childNodes))E(O)},m={...F,find(c,f,b={}){let g=u(c);if(!g?.querySelectorAll)return[];let k=a().query(f,g);b.includeRulesTag||(k=k.filter(S=>!ni(S)));let v=[];b.skip&&v.push(b.skip);let A=b.templateAttr===null?null:b.templateAttr||"cms-template";if(A&&v.push(`[${A}]`),v.length){let S=v.join(", ");k=k.filter(E=>!E.closest?.(S))}return k},parent(c){let f=u(c)?.parentElement;return f?d(f):null},children(c){return Array.from(u(c)?.children||[],d)},text(c,f){if(f===void 0){let k=d(c);return!k?.matches?.(r)&&!k?.querySelector?.(r)?F.text(k):(u(c)?.textContent||"").trim()}let b=d(c);if(!b?.matches?.(r)&&!b?.querySelector?.(r)&&!l){F.text(b,f);return}let g=a().cloneOf(b);g?h(b,g,"textContent",f):F.text(b,f)},attr(c,f,b){let g=d(c);if(b===void 0)return F.attr(g,f);F.attr(g,f,b);let k=l?.cloneOf(g);k&&(F.attr(k,f,b),ut(g,{capability:"data",exclude:t.exclude||null}).root===null&&(k.remove(),l.liveToClone.delete(g),l.cloneToLive.delete(k)))},removeAttr(c,f){let b=d(c);F.removeAttr(b,f);let g=l?.cloneOf(b);g&&F.removeAttr(g,f)},prop(c,f,b){let g=d(c);if(b===void 0)return f==="innerHTML"||f==="outerHTML"||f==="textContent"||f==="innerText"?F.prop(u(g),f):F.prop(g,f);let k=f==="innerHTML"||f==="textContent"||f==="innerText",v=k?a().cloneOf(g):l?.cloneOf(g);v&&k?h(g,v,f,b):(F.prop(g,f,b),v&&F.prop(v,f,b))},clone(c){let f=u(c);if(f===c)return F.clone(c);let b=s.importNode(f,!0);return oi(b),b},insertAt(c,f,b){let g=d(c),v=m.children(g)[b]||(()=>{for(let E=g.children.length-1;E>=0;E--){let O=g.children[E];if(a().cloneOf(O))return O.nextElementSibling}return g.firstElementChild})(),A=d(f);g.insertBefore(A,v||null);let S=a().cloneOf(g);if(S){let E=a().cloneOf(A);E||(E=s.importNode(A,!0),p(A,E));let O=Array.from(S.children);S.insertBefore(E,O[b]||null)}},insertBefore(c,f){let b=d(c),g=d(f);b.parentNode.insertBefore(g,b);let k=a().cloneOf(b.parentNode);if(k){let v=a().cloneOf(g);v||(v=s.importNode(g,!0),p(g,v));let A=a().cloneOf(b);A?A.before(v):k.appendChild(v)}},insertAfter(c,f){let b=d(c),g=d(f);b.parentNode.insertBefore(g,b.nextSibling);let k=a().cloneOf(b.parentNode);if(k){let v=a().cloneOf(g);v||(v=s.importNode(g,!0),p(g,v));let A=a().cloneOf(b);A?A.after(v):k.appendChild(v)}},identity(c){return d(c)||null},remove(c){let f=d(c),b=a().cloneOf(f);F.remove(f),b&&F.remove(b)},replaceWith(c,f){let b=d(c),g=a().cloneOf(b),k=F.replaceWith(b,f);if(g){let v=ut(k,{capability:"data",exclude:t.exclude||null});if(!v.root)g.remove();else{g.replaceWith(v.root);let A=S=>{let E=v.original(S);E&&(l.liveToClone.set(E,S),l.cloneToLive.set(S,E));for(let O of Array.from(S.childNodes||[]))A(O)};A(v.root)}}return k}};return m}var je=F;function Mr(e){try{return JSON.parse(e)}catch(t){throw new Le(`Invalid strict JSON: ${t.message}`,t)}}function qe(e){try{return JSON.parse(e)}catch{}let t={BRACE_OPEN:"{",BRACE_CLOSE:"}",BRACKET_OPEN:"[",BRACKET_CLOSE:"]",COLON:":",COMMA:",",STRING:"STRING",SELECTOR:"SELECTOR",IDENTIFIER:"IDENTIFIER",NUMBER:"NUMBER",BOOLEAN:"BOOLEAN"};function r(i){let o=[],s=0;for(;s<i.length;){let l=i[s];if(/\s/.test(l)){s++;continue}if("{}".includes(l)){o.push({type:l,value:l}),s++;continue}if(l==="["){let p=!1,h=s+1;for(;h<i.length&&/\s/.test(i[h]);)h++;if(h<i.length&&/[a-zA-Z_]/.test(i[h])&&(p=!0),!p){o.push({type:l,value:l}),s++;continue}}if(l==="]"){o.push({type:l,value:l}),s++;continue}if(l===":"){o.push({type:t.COLON,value:l}),s++;continue}if(l===","){o.push({type:t.COMMA,value:l}),s++;continue}if(l==='"'||l==="'"){let p=l,h=s+1;for(;h<i.length&&i[h]!==p;)i[h]==="\\"&&h++,h++;o.push({type:t.STRING,value:i.substring(s+1,h),quoted:!0,sourceQuote:p}),s=h+1;continue}let a=s,u;for(;a<i.length&&!/[{},]/.test(i[a]);)if(i[a]===":"){let p=[":first",":last",":nth-child",":nth-of-type",":first-child",":last-child",":first-of-type",":last-of-type",":only-child",":only-of-type",":hover",":focus",":active",":visited",":disabled",":enabled",":checked",":empty",":root",":target",":not",":before",":after",":nth-last-child",":nth-last-of-type"],h=!1;for(let m of p){let c=m.substring(1);if(i.substring(a+1,a+1+c.length)===c){h=!0,a+=c.length;break}}if(!h)break}else if(i[a]==="["){for(a++;a<i.length&&i[a]!=="]";){if(i[a]==='"'||i[a]==="'"){let p=i[a];for(a++;a<i.length&&i[a]!==p;)i[a]==="\\"&&a++,a++}a++}a<i.length&&i[a]==="]"&&a++}else a++;u=i.substring(s,a);let d=t.IDENTIFIER;/^-?\d+(\.\d+)?$/.test(u)?d=t.NUMBER:u==="true"||u==="false"||u==="null"?d=t.BOOLEAN:/^[.#@\[]|[.#@\[]| /.test(u)&&(d=t.SELECTOR),o.push({type:d,value:u,quoted:!1}),s=a}return o}function n(i){let o="";for(let s=0;s<i.length;s++){let l=i[s];if("{}".includes(l.type)||"[]".includes(l.type)){o+=l.value;continue}if(l.type===t.COLON){o+=l.value;continue}if(l.type===t.COMMA){let a=i[s+1];if(a&&(a.type==="}"||a.type==="]"))continue;o+=l.value;continue}if(l.type===t.STRING&&l.quoted){let a=l.value;l.sourceQuote==="'"&&(a=a.replace(/\\'/g,"'"),a=a.replace(/(\\*)"/g,(u,d)=>d.length%2===0?d+'\\"':u)),o+=`"${a}"`;continue}if(l.type===t.NUMBER||l.type===t.BOOLEAN){o+=l.value;continue}if(l.type===t.SELECTOR||l.type===t.IDENTIFIER){o+=`"${l.value}"`;continue}o+=`"${l.value}"`}return o}try{let i=r(e),o=n(i);return JSON.parse(o)}catch(i){throw new Le("Invalid extraction rules syntax: "+i.message,i)}}var li="1",si=/^[a-zA-Z0-9_-]+$/;function dt(e,t,r){let n;if(r===void 0)n="script[data-rules-name]";else{if(typeof r!="string"||!si.test(r))throw new Error(`hyper-html-api: invalid rules token ${JSON.stringify(r)} (must match ${si})`);n=`script[data-rules-name~="${r}"]`}let i=e.find(t,n,{includeRulesTag:!0});if(i.length===0)return null;r!==void 0&&i.length>1&&console.warn(`hyper-html-api: ${i.length} rules tags match data-rules-name~="${r}"; using the first.`);let o=i[0],s=e.attr(o,"data-rules-version");if(s!==li)throw new Ne(s);return{rules:qe(e.text(o)),tagNode:o}}var zd=new Function("url","return import(url)");function mi(e,t,r,n){let i=e.length,o=t.length,s=new Array(i).fill(-1);if(n){let g=new Set;for(let k=0;k<i;k++){let v=n[k];!(v>=0&&v<o)||g.has(v)||(s[k]=v,g.add(v))}}if(i===0||o===0)return s;let l=e.map(g=>di(g,r)),a=t.map(g=>di(g,r)),u=new Array(o).fill(!1);for(let g of s)g>=0&&(u[g]=!0);let d=new Map;a.forEach((g,k)=>{u[k]||d.set(g,d.has(g)?-1:k)});let p=new Map;l.forEach((g,k)=>{s[k]>=0||p.set(g,(p.get(g)||0)+1)}),l.forEach((g,k)=>{if(s[k]>=0||p.get(g)!==1)return;let v=d.get(g);v===void 0||v===-1||u[v]||(s[k]=v,u[v]=!0)});let h=[];for(let g=0;g<i;g++)s[g]<0&&h.push(g);let m=[];for(let g=0;g<o;g++)u[g]||m.push(g);if(h.length===0||m.length===0)return s;let c=i*o+1,f=El(e,t,r),b=(g,k)=>f(g,k)*c+Math.abs(g-k);for(let[g,k]of _l(h,m,b))s[g]=k;return s}var fi=e=>typeof e=="object"&&e!==null;function di(e,t){if(!fi(t))return e==null?" null":String(e);let r=Object.keys(t);return JSON.stringify(r.map(n=>{let i=JSON.stringify(e?.[n]);return i===void 0?" undef":i}))}function El(e,t,r){if(!fi(r))return(l,a)=>e[l]===t[a]?0:1;let n=Object.keys(r),i=l=>n.map(a=>JSON.stringify(l?.[a])),o=e.map(i),s=t.map(i);return(l,a)=>{let u=o[l],d=s[a],p=0;for(let h=0;h<n.length;h++)u[h]!==d[h]&&p++;return p}}function _l(e,t,r){return e.length<=t.length?hi(e,t,r,!1):hi(t,e,(n,i)=>r(i,n),!0)}function hi(e,t,r,n){let i=e.length,o=t.length,s=[];for(let p=0;p<=i;p++)s.push(new Float64Array(o+1).fill(1/0));let l=[];for(let p=0;p<=i;p++)l.push(new Uint8Array(o+1));for(let p=0;p<=o;p++)s[i][p]=0;for(let p=i-1;p>=0;p--)for(let h=o-1;h>=0;h--){let m=r(e[p],t[h])+s[p+1][h+1],c=s[p][h+1];m<=c?(s[p][h]=m,l[p][h]=1):s[p][h]=c}let a=[],u=0,d=0;for(;u<i&&d<o;)l[u][d]&&(a.push(n?[t[d],e[u]]:[e[u],t[d]]),u++),d++;return a}function qr(e,t,r,n,i,o,s,l={}){let a=e.find(t,r,l);if(i.length===0){a.forEach(A=>e.remove(A)),jr(l,"onRowsApplied",o.path,[]);return}let u=i.length>a.length,d=a[0]||null;if(u&&!d&&(d=Rl(e,t,r,l),!d))throw new ue(o.path);let p=a.map(A=>Ol(e,A,n,l)),h=null;if(u&&d){h=e.clone(d),l.templateAttr&&e.removeAttr(h,l.templateAttr);let A=e.stripIds(h);A>0&&console.warn(`[hyper-html-api] stripped ${A} id attribute(s) from cloned template at "${o.path.join(".")||"(root)"}"`)}let m=mi(i,p,n,Tl(e,a,i,o,l)),c=a.length>0?e.parent(a[0]):jl(e,t,r,d,o,l),f=a.length>0?yi(e,c,a[0]):0,b=Il(e,a),g=new Set,k=[],v=i.map((A,S)=>{let E=m[S];if(E>=0)return g.add(E),k.push(!1),a[E];k.push(!0);let O=e.clone(h);return e.stripIds(O),O});a.forEach((A,S)=>{g.has(S)||e.remove(A)}),b?Pl(e,c,f,v,k):Fl(e,v,k,c,f),Cl(e,v,n,i,o,s,l),jr(l,"onRowsApplied",o.path,v)}function jr(e,t,r,n){if(typeof e[t]=="function")try{return e[t](r.slice(),n)}catch(i){console.warn(`[hyper-html-api] ${t} threw at "${r.join(".")||"(root)"}"`,i);return}}function Tl(e,t,r,n,i){let o=jr(i,"identifyRows",n.path,r);if(!Array.isArray(o))return null;let s=new Array(r.length).fill(-1),l=new Set,a=new Map(t.map((u,d)=>[e.identity(u),d]));for(let u=0;u<r.length;u++){if(!o[u])continue;let d=a.get(e.identity(o[u]));d===void 0||l.has(d)||(s[u]=d,l.add(d))}return s}function Cl(e,t,r,n,i,o,s){t.forEach((l,a)=>{if(r===null){let u=n[a],d=u==null?"":String(u);e.text(l)!==d&&e.text(l,d)}else{let u=o(e,l,r,n[a],{depth:i.depth+1,path:[...i.path,a]},s);u&&u!==l&&(t[a]=u)}})}function Ol(e,t,r,n){return r===null?e.text(t):de(e,t,r,n.onRowsRead?{...n,onRowsRead:void 0}:n)}function yi(e,t,r){let n=e.children(t);for(let i=0;i<n.length;i++)if(e.sameNode(n[i],r))return i;return-1}function Rl(e,t,r,n){if(!n.templateAttr)return null;let i=/^\s*:scope\s*>\s*/.test(r),o=new RegExp(":not\\(\\["+n.templateAttr.replace(/[.*+?^${}()|[\]\\-]/g,"\\$&")+"\\]\\)","g"),s=r.replace(/^\s*:scope\s*>\s*/,"").replace(o,""),l=i?Ll(s):0,a=Tr(s),u=t;for(;u;){let d=e.find(u,s,{includeRulesTag:!1,templateAttr:null});for(let p of d)if(e.attr(p,n.templateAttr)!=null&&!(i&&!Ml(e,t,p,l))&&!(a&&!e.matches(e.parent(p),a)))return p;u=e.parent(u)}return null}function Ll(e){let t=0,r=null,n=1;for(let i=0;i<e.length;i++){let o=e[i];if(o==="\\")i++;else if(r)o===r&&(r=null);else if(o==='"'||o==="'")r=o;else if(o==="["||o==="(")t++;else if(o==="]"||o===")")t>0&&t--;else if(t===0&&o===">")n++;else{if(t===0&&(o==="+"||o==="~"))return null;if(t===0&&/\s/.test(o)){if(!Nl(e,i))return null;for(;i+1<e.length&&/\s/.test(e[i+1]);)i++}}}return n}function Nl(e,t){let r=t;for(;r<e.length&&/\s/.test(e[r]);)r++;let n=t>0?e[t-1]:"",i=r<e.length?e[r]:"";return pi(n)||pi(i)}function pi(e){return e===">"||e==="+"||e==="~"}function Ml(e,t,r,n){if(n===null)return!0;let i=r;for(let a=0;a<n;a++)if(i=e.parent(i),!i)return!1;let o=e.prop(t,"tagName");if(!o)return!0;let s=e.prop(i,"tagName");if(!s||String(s).toLowerCase()!==String(o).toLowerCase())return!1;let l=new Set(gi(e,i));return gi(e,t).every(a=>l.has(a))}function gi(e,t){let r=e.attr(t,"class");return r?String(r).split(/\s+/).filter(Boolean):[]}function jl(e,t,r,n,i,o){let s=e.parent(n);if(s&&ql(e,t,s)&&!ki(e,s,o))return s;let l=Tr(r);if(!l)throw new ue(i.path,`the list selector "${r}" names no container to hold the new rows \u2014 write it as "container > row" (for example "ol.comments > li") so the cloned row lands in the list`);let u=(l===":scope"?e.prop(t,"tagName")?[t]:[]:e.find(t,l,o)).filter(d=>!ki(e,d,o));if(u.length===0)throw new ue(i.path,`no container matching "${l}" inside this context to hold the new rows`);if(u.length>1)throw new ue(i.path,`"${l}" matches ${u.length} containers inside this context, so the new rows have no single destination`);return u[0]}function ql(e,t,r){let n=r;for(;n;){if(e.sameNode(n,t))return!0;n=e.parent(n)}return e.parent(t)?!1:e.find(t,"*",{includeRulesTag:!0,templateAttr:null}).some(i=>e.sameNode(i,r))}var bi=["no-data","editor-ui"];function ki(e,t,r){let n=t;for(;n;){if(r.templateAttr&&e.attr(n,r.templateAttr)!=null||bi.some(o=>e.attr(n,o)!=null))return!0;let i=e.attr(n,"clay");if(i&&i.split(/\s+/).some(o=>bi.includes(o)))return!0;n=e.parent(n)}return!1}function Pl(e,t,r,n,i){let o=e.children(t),s=o.map(a=>e.identity(a)),l=!1;n.forEach((a,u)=>{let d=e.identity(a),p=r+u;if(s[p]===d)return;if(!i[u]){let m=s.indexOf(d);m!==-1&&(s.splice(m,1),o.splice(m,1))}let h=Math.min(p,o.length);h<o.length?e.insertBefore(o[h],a):o.length?l?e.insertAfter(o[o.length-1],a):(e.insertAt(t,a,p),l=!0):e.insertAt(t,a,0),s.splice(h,0,d),o.splice(h,0,a)})}function Il(e,t){if(t.length<=1)return!0;let r=e.parent(t[0]);if(!r)return!1;let n=new Map(e.children(r).map((o,s)=>[e.identity(o),s])),i=[];for(let o of t){let s=n.get(e.identity(o));if(s===void 0)return!1;i.push(s)}return i.sort((o,s)=>o-s),i[i.length-1]-i[0]===i.length-1}function Fl(e,t,r,n,i){let o=null,s=i;for(let l=0;l<t.length;l++){if(!r[l]){o=t[l];continue}let a=o?e.parent(o):n;if(!a)continue;let u=o?yi(e,a,o)+1:s++;e.insertAt(a,t[l],u),o=t[l]}}function Pe(e,t,r,n,i={}){if(Object.prototype.hasOwnProperty.call(i,"exclude")&&e.semanticExclude===!1)throw new Error("This adapter does not support semantic exclude queries; omit exclude or use the DOM adapter.");let o=[];if(Pr(r,n,[],o),o.length)throw new ot(o);Mt(e,t,r,n,{depth:0,path:[]},i)}function Mt(e,t,r,n,i,o={}){if(i.depth>Me)throw new ye(i.path);if(n===void 0)return t;if(typeof r=="string")return $l(e,t,r,n,i,o);if(Array.isArray(r)){let[s,l]=r;return qr(e,t,s,l,n,i,Mt,o),t}if(typeof r=="object"&&r!==null){for(let[s,l]of Object.entries(r)){let a=Mt(e,t,l,n==null?n:n[s],{depth:i.depth+1,path:[...i.path,s]},o);a&&a!==t&&(t=a)}return t}return t}function $l(e,t,r,n,i,o){if(r.endsWith("[]")){let a=r.slice(0,-2);return qr(e,t,a,null,n,i,Mt,o),t}if(r.startsWith("@"))return xi(e,t,r.slice(1),n);let s=q(r);if(s!==-1){let a=r.slice(0,s),u=r.slice(s+1),d=a?e.find(t,a,o):[t];return d.length===0||xi(e,d[0],u,n),t}if(r===".")return vi(e,t,n),t;let l=e.find(t,r,o);return l.length===0||vi(e,l[0],n),t}function vi(e,t,r){let n=r==null?"":String(r);e.text(t)!==n&&e.text(t,n)}function Dl(e,t,r,n){if(e.styleVar){e.styleVar(t,r,n);return}Rr(e,t,r,n)}function xi(e,t,r,n){if(ve(r))return Dl(e,t,r,n==null?"":String(n).trim()),t;if(Re.has(r)){let i=e.prop(t,r);if(i===n||i!=null&&n!=null&&String(i)===String(n))return t;throw new st(r)}if(r==="outerHTML"){let i=n==null?"":String(n);return e.replaceWith(t,i)}if(Er.has(r)){let i=_r(r,n);return e.prop(t,r)!==i&&e.prop(t,r,i),t}if(n==null)e.attr(t,r)!=null&&e.removeAttr(t,r);else{let i=String(n);e.attr(t,r)!==i&&e.attr(t,r,i)}return t}function Pr(e,t,r,n){if(t!==void 0){if(typeof e=="string"){if(e.endsWith("[]")){Array.isArray(t)?t.forEach((i,o)=>{typeof i=="object"&&i!==null&&n.push({path:mt([...r,o]),expected:"scalar",got:ht(i)})}):n.push({path:mt(r),expected:"array",got:ht(t)});return}t!==null&&typeof t=="object"&&n.push({path:mt(r),expected:"scalar",got:ht(t)});return}if(Array.isArray(e)){if(!Array.isArray(t)){n.push({path:mt(r),expected:"array",got:ht(t)});return}let i=e[1];t.forEach((o,s)=>Pr(i,o,[...r,s],n));return}if(typeof e=="object"&&e!==null){if(t===null||Array.isArray(t)||typeof t!="object"){n.push({path:mt(r),expected:"object",got:ht(t)});return}for(let[i,o]of Object.entries(e))Pr(o,t[i],[...r,i],n)}}}function ht(e){return e===null?"null":Array.isArray(e)?"array":typeof e}function mt(e){return e.join(".")}var Ai=Object.freeze({refusedRuleForms:["innerHTML","outerHTML"],refusedTargets:["script","style","template","noscript","iframe","object","embed","xmp","plaintext","noembed","noframes","meta","link","base","animate","set","animatemotion","animatetransform"],refusedAttributes:["style","srcdoc","is","http-equiv","sandbox","allow","nonce","integrity","charset","htmlclaytoken","htmlclayid","data-rules-name","data-rules-version","clay","contenteditable",...Jn],refusedAttributePrefixes:["on"],urlAttributes:["href","src","srcset","action","formaction","poster","cite","data","ping","background","longdesc","usemap","xlink:href","manifest","codebase","icon"],refusedSchemes:["javascript","vbscript","data"],customPropertyValues:Object.freeze({maxLength:200,refusedCharacters:[";","{","}","<",">","\\"],refusedFunctions:["url","src","image","image-set","-webkit-image-set","cross-fade","element","expression","paint"]})});function Zl(e){if(/[\u0000-\u001f\u007f]/.test(e))return"control characters are not allowed in a custom property value";let t=[],r=null;for(let n=0;n<e.length;n++){let i=e[n];if(r){i===r&&(r=null);continue}if(i==='"'||i==="'")r=i;else{if(i==="/"&&e[n+1]==="*")return"comments are not allowed in a custom property value";if(i==="(")t.push(")");else if(i==="[")t.push("]");else if((i===")"||i==="]")&&t.pop()!==i)return`"${i}" does not close anything in this custom property value`}}return r?"a custom property value must close its quotes":t.length?"a custom property value must close its brackets":null}function Ir(e,t=Ai){let r=t.customPropertyValues,n=String(e);if(n.length>r.maxLength)return`custom property values are limited to ${r.maxLength} characters`;let i=r.refusedCharacters.find(a=>n.includes(a));if(i)return`${JSON.stringify(i)} is not allowed in a custom property value`;let o=Zl(n);if(o)return o;let s=n.toLowerCase(),l=r.refusedFunctions.find(a=>new RegExp(`(^|[^a-z0-9_-])${a.replace(/[-]/g,"\\-")}\\s*\\(`).test(s));return l?`"${l}()" is not allowed in a custom property value`:null}function Fr(e,t,r){if(r&&typeof r=="object")return{rules:r,tagNode:null};if(typeof r=="string"){let n=t&&t.ownerDocument?t.ownerDocument:t;return dt(e,n,r)}return null}var U={extract:(e,t,r={})=>de(ne(e,r),e,t,r),apply:(e,t,r,n={})=>Pe(ne(e,{...n,_write:!0}),e,t,r,n),findRulesIn:(e,t)=>dt(je,e,t),findRules:(e,t)=>Fr(je,e,t),bind:(e,t,r={})=>{let n=Fr(je,e,t);if(!n){let i=typeof t=="string"?`data-rules-name~="${t}"`:"the provided rules object";throw new Error(`hyper-html-api: could not resolve rules for ${i}`)}return{...n,get:()=>de(ne(e,r),e,n.rules,r),set:i=>Pe(ne(e,{...r,_write:!0}),e,n.rules,i,r)}},parseStrict:Mr,parseRelaxed:qe,ruleAttrIndex:q,splitRule:it,errors:Lt,DOM_PROPERTIES:Ct};var Dr={};Sr(Dr,{fromString:()=>ie,getRuleAtPath:()=>oe,getValueAtPath:()=>na,setAtPath:()=>$r,toString:()=>ra});function ra(e){return e.map(String).join(".")}function ie(e){return e===""?[]:e.split(".").map(t=>/^\d+$/.test(t)?Number(t):t)}function oe(e,t){let r=e;for(let n of t){if(r==null)return;if(typeof r=="string"){if(r.endsWith("[]")&&(typeof n=="number"||n==="*")){r=r.slice(0,-2);continue}return}if(Array.isArray(r)){if(typeof n!="number"&&n!=="*")return;r=r[1];continue}if(typeof r=="object"){if(typeof n=="number"||!(n in r))return;r=r[n];continue}return}return r}function na(e,t){let r=e;for(let n of t){if(r==null)return;r=r[n]}return r}function $r(e,t,r){if(t.length===0)return r;let[n,...i]=t;if(typeof n=="number"){let o=Array.isArray(e)?[...e]:[];return o[n]=$r(o[n],i,r),o}return{...e&&typeof e=="object"?e:{},[n]:$r((e||{})[n],i,r)}}function ft(e){if(typeof e=="string")return e.endsWith("[]")?[]:"";if(Array.isArray(e))return[];if(typeof e=="object"&&e!==null){let t={};for(let[r,n]of Object.entries(e))t[r]=ft(n);return t}return""}import ia from"./hyper-morph.vendor.js";function jt(e,t,{ignoreActiveValue:r=!0}={}){ia.morph(e,t,{morphStyle:"innerHTML",ignoreActiveValue:r,restoreFocus:!0,formStateSync:"property",policy:"raw"})}import{morph as Oi}from"./hyper-morph.vendor.js";var Si=new WeakMap,zr=e=>e.map(String).join(".");function oa(e){return typeof CSS<"u"&&CSS.escape?CSS.escape(e):String(e).replace(/[^a-zA-Z0-9_\-.*]/g,t=>"\\"+t)}function Ei(e,t){if(!e||!e.querySelector)return null;let r=e.querySelector(`[data-hcms-path="${oa(t)}"]`),n=r&&r.querySelector(".hcms-array-items");return n?Array.from(n.children).filter(i=>i.matches&&i.matches("[data-hcms-card], [data-hcms-array-item]")):null}function _i(e,t,r){let n=Ei(e,t);!n||n.length!==r.length||n.forEach((i,o)=>{r[o]&&Si.set(i,r[o])})}function qt(){let e=new Map;return{hooks:{onRowsRead(t,r){e.set(zr(t),r)}},seed(t){for(let[r,n]of e)_i(t,r,n);e.clear()}}}function Ti(e){return{identifyRows(t,r){let n=Ei(e,zr(t));return!n||n.length!==r.length?null:n.map(i=>Si.get(i)||null)},onRowsApplied(t,r){_i(e,zr(t),r)}}}function Q(e){return e&&e.nodeType===9?e.body||e.documentElement:e}function Pt(e,t){if(!t||t.nodeType!==9)return e;return r(e);function r(n){if(typeof n=="string")return n==="."?"body":n.startsWith("@")?`body${n}`:n;if(Array.isArray(n)||!n||typeof n!="object")return n;let i={};for(let[o,s]of Object.entries(n))i[o]=r(s);return i}}var Ci={skip:"[data-hcms-shell]",templateAttr:"cms-template"},Ur="data-hcms-rollback-ui",sa=0;function Ri(e,t,r,n={}){return la(e,t,r,n)}function la(e,t,r,n){let{shellRoot:i,structural:o,structuralPath:s,formRoot:l}=n,a=l?{...Ci,...Ti(l)}:Ci;if(!o)try{return U.apply(e,t,r,a),{ok:!0}}catch(h){return{ok:!1,error:h}}let u=aa(e,t,s),d=u?ua(u):null,p=u?null:ha(Q(e),i);try{return U.apply(e,t,r,a),{ok:!0}}catch(h){return d?da(u,d):p&&ma(Q(e),i,p),{ok:!1,error:h}}}function aa(e,t,r){if(!r||!e)return null;let n=ie(r),i=[],o=t;for(let s of n){if(typeof o=="string"||o==null||Array.isArray(o))break;if(typeof o=="object"&&s in o){if(i.push(s),o=o[s],Array.isArray(o)||typeof o=="string"&&o.endsWith("[]"))break}else return null}return!Array.isArray(o)&&!(typeof o=="string"&&o.endsWith("[]"))?null:ca(e,t,i)}function ca(e,t,r){if(r.length===0)return null;let n=e,i=t;for(let o=0;o<r.length;o++){let s=r[o];if(!i||typeof i!="object"||Array.isArray(i))return null;let l=i[s];if(l==null)return null;if(o===r.length-1){if(Array.isArray(l)){let[a]=l;return n.querySelector?.(a)?.parentElement||null}if(typeof l=="string"&&l.endsWith("[]")){let a=l.slice(0,-2);return n.querySelector?.(a)?.parentElement||null}return null}i=l}return null}function ua(e){let t=[],r=[];for(let n of Array.from(e.childNodes))t.push(Br(n,r));return{nodes:t,retained:r}}function da(e,t){let r=e.cloneNode(!1);for(let n of t.nodes)r.appendChild(n);Oi(e,Array.from(r.childNodes),Ni()),Li(e,t.retained)}function ha(e,t){let r=[],n=[];for(let i of Array.from(e.childNodes))i===t||t&&i.contains?.(t)||r.push(Br(i,n));return{nodes:r,retained:n}}function ma(e,t,r){let n=e.cloneNode(!1);for(let i of r.nodes)n.appendChild(i);Oi(e,Array.from(n.childNodes),Ni()),Li(e,r.retained)}function Br(e,t){let r=e.cloneNode(!1);if(e.nodeType===1&&e.matches('[editor-ui],[clay~="editor-ui"]')){let o=String(++sa);r.setAttribute(Ur,o),t.push({id:o,node:e})}let n=e.nodeType===1&&e.tagName==="TEMPLATE"?e.content:e,i=r.nodeType===1&&r.tagName==="TEMPLATE"?r.content:r;for(let o of Array.from(n.childNodes||[]))i.appendChild(Br(o,t));return r}function Li(e,t){for(let{id:r,node:n}of t){let i=e.querySelector(`[${Ur}="${r}"]`);i===n?n.removeAttribute(Ur):n.isConnected?i?.remove():i?.replaceWith(n)}}function Ni(){return{morphStyle:"innerHTML",policy:"raw",restoreFocus:!1,scripts:{handle:!1,merge:!1}}}var fa=/^--font-(size|weight|style|stretch|variant|feature-settings|variation-settings|optical-sizing|kerning|synthesis|smoothing|palette|size-adjust|display)(-|$)/;function xe(e){return e.replace(/([a-z])([A-Z])/g,"$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g,"$1 $2").replace(/[-_]/g," ").replace(/\s+/g," ").trim().replace(/^./,t=>t.toUpperCase())}var pa='<div class="hcms-drag-handle mirk-sortable__grip" aria-hidden="true"><div class="mirk-sortable__dots"><span class="mirk-sortable__dot"></span><span class="mirk-sortable__dot"></span><span class="mirk-sortable__dot"></span><span class="mirk-sortable__dot"></span><span class="mirk-sortable__dot"></span><span class="mirk-sortable__dot"></span><span class="mirk-sortable__dot"></span><span class="mirk-sortable__dot"></span></div></div>',It='<svg class="hcms-x" viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true"><path d="M4 4 L12 12 M12 4 L4 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square"></path></svg>',Pi={"@scalar":`
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
      ${pa}
      <div class="hcms-card-body mirk-sortable__body">
        <div class="hcms-card-fields"></div>
        <div class="hcms-card-controls">
          <button type="button" class="hcms-move hcms-move-up hcms-sr-only" data-hcms-action="move-up" aria-label="Move up">\u2191</button>
          <button type="button" class="hcms-move hcms-move-down hcms-sr-only" data-hcms-action="move-down" aria-label="Move down">\u2193</button>
          <button type="button" class="hcms-remove hcms-remove--card" data-hcms-action="remove" aria-label="Remove">${It}</button>
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
        <button type="button" class="hcms-upload-clear" data-hcms-action="clear-upload" aria-label="Remove file">${It}</button>
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
          <button type="button" class="hcms-upload-clear hcms-upload-clear--badge" data-hcms-action="clear-upload" aria-label="Remove image">${It}</button>
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
        <button type="button" class="hcms-color-clear" data-hcms-action="color-clear" aria-label="Clear color">${It}</button>
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
  `},ga=["@scalar","@object","@scalar-array","@scalar-array-item","@object-array","@object-array-item"];function $t(e){let t=e.head||e.documentElement;if(t)for(let r of ga)zi(e,t,r)}function Hr(e,t){if(!Pi[t])return null;let r=e&&(e.head||e.documentElement);return r?zi(e,r,t):null}var Mi={src:"@image",checked:"@checkbox",innerHTML:"@richtext"},Ft={image:"@image",file:"@file",checkbox:"@checkbox",toggle:"@toggle",select:"@select",radio:"@radio",textarea:"@textarea",number:"@number",richtext:"@richtext",color:"@color",font:"@font",variant:"@variant"},ba=new Set([...Object.values(Ft),"@chips","@chips-item"]);function he(e,t,r,n){if(typeof e!="string")return"@scalar";let i=q(e),o=Di(e,i,r,n),s=Ut(e,i,r,n,t,"data-hcms-component");if(s&&Ft[s]){let l=Ft[s],a=Array.isArray(r)&&r.some(u=>u==="*"||typeof u=="number");return l==="@number"&&!ji(e,i,t,a,o).every(xa)||(l==="@checkbox"||l==="@toggle")&&(i<0||e.slice(i+1)!=="checked")&&!ji(e,i,t,a,o).every(wa)?"@scalar":l}if(i>=0){let l=e.slice(i+1);if(Mi[l])return Mi[l];if(/^--color(-|$)/.test(l)&&l!=="--color-scheme")return"@color";if(/^--font(-|$)/.test(l)&&!fa.test(l))return"@font"}return"@scalar"}function Ii(e,t,r,n){if(typeof e!="string")return null;let i=q(e),o=Ut(e,i,r,n,t,"data-hcms-component");return o&&Ft[o]||null}var ka=new Set(["@color","@font","@variant"]),ya=new Set(["html","body",":root"]);function pt(e,t,r,n){if(typeof e!="string"||e.endsWith("[]")||!ka.has(he(e,t,r,n)))return null;let i=Array.isArray(r)&&r.some(s=>s==="*"||typeof s=="number"),o=$i(e,q(e)).trim();return!i&&ya.has(o)?"page":"section"}var va=/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;function xa(e){return e==null||e===""?!0:va.test(String(e))}function wa(e){return e==null||e===""||e==="true"||e==="false"}function ji(e,t,r,n,i){if(!r||!r.querySelectorAll)return[];if(!i||i===".")return[];let o=null;try{o=r.querySelectorAll(i)}catch{return[]}let s=t>=0?e.slice(t+1):null,l=[];for(let a of o)if(!(a.closest&&a.closest("[cms-template], [data-hcms-shell]"))&&(s?s==="value"&&"value"in a?l.push(a.value):l.push(a.getAttribute?a.getAttribute(s):null):l.push((a.textContent||"").trim()),!n))break;return l}function Dt(e,t){if(typeof e!="string"||!e.endsWith("[]")||!t||!t.querySelector)return null;let r=e.slice(0,-2).trim();if(!r)return null;let n=null;try{n=t.querySelector(r)}catch{return null}let i=n&&n.closest?n.closest("[data-hcms-component]"):null;return(i&&i.getAttribute?i.getAttribute("data-hcms-component"):null)==="chips"?{array:"@chips",item:"@chips-item"}:null}function we(e,t,r){let n=e.join("."),i=e.map(o=>typeof o=="number"?"*":o).join(".");return n&&X(r,n)||i&&i!==n&&X(r,i)||X(r,t)}function zt(e,t,r){let n=Dt(e,r);if(!n)return null;let i=we(t,n.array,r);return i&&i.getAttribute("data-hcms-tpl")===n.array?n:null}function gt(e,t,r,n){if(typeof e!="string")return null;let i=q(e),o=Ut(e,i,r,n,t,"data-hcms-options");if(o==null)return null;let s=o.trim().split(/\s+/).filter(Boolean);return s.length?s:null}function Fi(e,t,r,n){if(typeof e!="string")return null;let i=q(e);return Ut(e,i,r,n,t,"data-hcms-crop")}function $i(e,t){return t>=0?e.slice(0,t):e}function Di(e,t,r,n){let i=$i(e,t);return i&&i!=="."?i:Aa(n,r)}function Aa(e,t){if(e==null||!Array.isArray(t))return"";let r=[],n=e;for(let i of t){if(n==null||typeof n=="string")break;if(Array.isArray(n)){if(typeof n[0]!="string"||i!=="*"&&typeof i!="number")return"";r.push(n[0]),n=n[1];continue}if(typeof n!="object"||!Object.prototype.hasOwnProperty.call(n,i))return"";n=n[i]}return r.join(" ")}function qi(e,t,r){if(!t||!t.querySelector||!e||e===".")return null;let n=null;try{n=t.querySelector(e)}catch{return null}return n&&n.getAttribute?n.getAttribute(r):null}function Ut(e,t,r,n,i,o){let s=Di(e,t,r,n),l=t>=0?e.slice(t+1):null;if(l){let a=qi(s,i,`${o}:${l}`);if(a!=null)return a;if(l.startsWith("--"))return null}return qi(s,i,o)}function Bt(e,t){if(!e||t==null)return;r(t,[]);function r(n,i){let o=me(n);if(o==="scalar"){let s=he(n,e,i,t);ba.has(s)&&Hr(e,s);return}if(o==="scalar-array"){let s=Dt(n,e);s&&(Hr(e,s.array),Hr(e,s.item));return}if(o==="object"){for(let[s,l]of Object.entries(n))r(l,[...i,s]);return}if(o==="object-array"){let s=n[1],l=[...i,"*"];if(s&&typeof s=="object"&&!Array.isArray(s))for(let[a,u]of Object.entries(s))r(u,[...l,a]);else r(s,l)}}}function zi(e,t,r){let n=X(e,r);if(n)return n;let i=e.createElement("template");return i.setAttribute("data-hcms-tpl",r),i.setAttribute("save-remove",""),i.innerHTML=Pi[r].trim(),t.appendChild(i),i}function X(e,t){return!e||!e.querySelector?null:e.querySelector(`template[data-hcms-tpl="${Sa(t)}"]`)}function Sa(e){return typeof CSS<"u"&&CSS.escape?CSS.escape(e):String(e).replace(/[^a-zA-Z0-9_\-.*]/g,t=>"\\"+t)}function me(e){return typeof e=="string"?e.endsWith("[]")?"scalar-array":"scalar":Array.isArray(e)?"object-array":typeof e=="object"&&e!==null?"object":"scalar"}function Ie(e){return e?!!(e.content||e).querySelector("[data-hcms-field]"):!1}var Ui={IMG:"src",A:"href"};function Ht(e){return e.map(t=>typeof t=="number"||/^[0-9]+$/.test(String(t))?"*":String(t)).join(".")}function Vt(e){if(!e)return"value";let t=(e.tagName||"").toUpperCase();return t==="INPUT"?(e.getAttribute("type")||"text").toLowerCase()==="checkbox"?"checked":"value":t==="TEXTAREA"||t==="SELECT"?"value":Ui[t]?Ui[t]:e.hasAttribute&&e.hasAttribute("contenteditable")?"innerHTML":null}function Bi(e,t){let r=(e.tagName||"").toUpperCase(),n=(e.getAttribute&&e.getAttribute("type")||"").toLowerCase(),i=Vt(e),s=`${Vi(r,n)}[data-hcms-field="${Ae(t)}"]`;return r==="INPUT"&&n==="radio"?`${s}:checked@value`:i?`${s}@${i}`:s}function Ea(e){let t=(e.tagName||"").toUpperCase(),r=(e.getAttribute&&e.getAttribute("type")||"").toLowerCase(),n=Vt(e),o=`${Vi(t,r)}[data-hcms-field]`;return t==="INPUT"&&r==="radio"?`${o}:checked@value`:n?`${o}@${n}`:o}function Vi(e,t){return e==="INPUT"?t?`input[type="${t}"]`:"input":e==="TEXTAREA"?"textarea":e==="SELECT"?"select":e==="IMG"?"img":e==="A"?"a":':not([data-hcms-shape="scalar"]):not([data-hcms-shape="object"]):not([data-hcms-shape="object-array"]):not([data-hcms-shape="scalar-array"])'}function Ae(e){return typeof CSS<"u"&&CSS.escape?CSS.escape(e):String(e).replace(/[^a-zA-Z0-9_\-.*]/g,t=>"\\"+t)}var Hi=new Set(["__proto__","constructor","prototype"]);function _a(e){let t=new Map;return r(e,null),t;function r(n,i){if(typeof n=="string"){typeof i=="string"&&!n.endsWith("[]")&&t.set(i,(t.get(i)||0)+1);return}if(Array.isArray(n)){r(n[1],null);return}if(n&&typeof n=="object")for(let[o,s]of Object.entries(n))r(s,o)}}function Wt(e,t){let r=_a(e);return n(e,[]);function n(p,h){let m=me(p);if(m==="scalar")return i(p,h);if(m==="scalar-array")return s(p,h);if(m==="object-array")return l(p,h);if(m==="object"){let c=Object.create(null);for(let[f,b]of Object.entries(p)){if(Hi.has(f))throw new Error(`hypercms: rule key "${f}" is forbidden at "${h.join(".")||"<root>"}"`);c[f]=n(b,[...h,f])}return c}return null}function i(p,h){let m=h.length?h[h.length-1]:null,c=typeof m=="string"?m:"__value",f=d(h,c);if(f)return o(h,c,Bi(f,c));let b=u(he(p,t,h,e),c);return b?o(h,c,Bi(b,c)):o(h,c,`input[data-hcms-field="${Ae(c)}"]@value`)}function o(p,h,m){if((r.get(h)||0)<2)return m;let c=`[data-hcms-path-shape="${Ae(Ht(p))}"]`,f=m.lastIndexOf("@"),b=f===-1?m:m.slice(0,f),g=f===-1?"":m.slice(f);return`${c} ${b}, ${b}${c}${g}`}function s(p,h){let m=zt(p,h,t),c=m&&u(m.item,null)||u("@scalar-array-item",null),f=c?Ea(c):"input[data-hcms-field]@value";return[a(h,"[data-hcms-array-item]"),f]}function l(p,h){let[,m]=p,c=[...h,"*"],f=a(h,"[data-hcms-card]");if(m&&typeof m=="object"&&!Array.isArray(m)){let b=Object.create(null);for(let[g,k]of Object.entries(m)){if(Hi.has(g))throw new Error(`hypercms: rule key "${g}" is forbidden at "${c.join(".")}"`);b[g]=n(k,[...c,g])}return[f,b]}return[f,n(m,[...c,0])]}function a(p,h){let m=p.length?p[p.length-1]:"",c=p.some(g=>g==="*"),f=p.join(".");return`${c?`[data-hcms-field="${Ae(m)}"]`:`[data-hcms-path="${Ae(f)}"]`} > .hcms-array-items > ${h}`}function u(p,h){if(!t)return null;let m=X(t,p);if(!m)return null;let c=m.content||m;if(h){let f=c.querySelector(`[data-hcms-field="${Ae(h)}"]`);if(f)return f}return c.querySelector("[data-hcms-field]")}function d(p,h){if(!t)return null;let m=p.map(b=>typeof b=="number"?"*":b).join("."),f=[p.join("."),m];for(let b=p.length-1;b>=0;b--){let g=p.slice(0,b).map(k=>typeof k=="number"?"*":k);me(oe(e,g))==="object"&&f.push(g.join(".")),g.push("*"),f.push(g.join("."))}for(let b of f){if(!b)continue;let g=X(t,b);if(!g||!Ie(g))continue;let k=g.content||g,v=k.querySelector(`[data-hcms-field="${Ae(h)}"]`)||k.querySelector("[data-hcms-field]");if(v)return v}return null}}var Wi=["50","100","200","300","400","500","600","700","800","900","950"],Ki=["red","orange","amber","yellow","lime","green","emerald","teal","cyan","sky","blue","indigo","violet","purple","fuchsia","pink","rose","slate","gray","zinc","neutral","stone","mauve","olive","mist","taupe"],Fe=Object.freeze([{id:"red-50",hue:"red",shade:"50",value:"oklch(97.1% 0.013 17.38)"},{id:"red-100",hue:"red",shade:"100",value:"oklch(93.6% 0.032 17.717)"},{id:"red-200",hue:"red",shade:"200",value:"oklch(88.5% 0.062 18.334)"},{id:"red-300",hue:"red",shade:"300",value:"oklch(80.8% 0.114 19.571)"},{id:"red-400",hue:"red",shade:"400",value:"oklch(70.4% 0.191 22.216)"},{id:"red-500",hue:"red",shade:"500",value:"oklch(63.7% 0.237 25.331)"},{id:"red-600",hue:"red",shade:"600",value:"oklch(57.7% 0.245 27.325)"},{id:"red-700",hue:"red",shade:"700",value:"oklch(50.5% 0.213 27.518)"},{id:"red-800",hue:"red",shade:"800",value:"oklch(44.4% 0.177 26.899)"},{id:"red-900",hue:"red",shade:"900",value:"oklch(39.6% 0.141 25.723)"},{id:"red-950",hue:"red",shade:"950",value:"oklch(25.8% 0.092 26.042)"},{id:"orange-50",hue:"orange",shade:"50",value:"oklch(98% 0.016 73.684)"},{id:"orange-100",hue:"orange",shade:"100",value:"oklch(95.4% 0.038 75.164)"},{id:"orange-200",hue:"orange",shade:"200",value:"oklch(90.1% 0.076 70.697)"},{id:"orange-300",hue:"orange",shade:"300",value:"oklch(83.7% 0.128 66.29)"},{id:"orange-400",hue:"orange",shade:"400",value:"oklch(75% 0.183 55.934)"},{id:"orange-500",hue:"orange",shade:"500",value:"oklch(70.5% 0.213 47.604)"},{id:"orange-600",hue:"orange",shade:"600",value:"oklch(64.6% 0.222 41.116)"},{id:"orange-700",hue:"orange",shade:"700",value:"oklch(55.3% 0.195 38.402)"},{id:"orange-800",hue:"orange",shade:"800",value:"oklch(47% 0.157 37.304)"},{id:"orange-900",hue:"orange",shade:"900",value:"oklch(40.8% 0.123 38.172)"},{id:"orange-950",hue:"orange",shade:"950",value:"oklch(26.6% 0.079 36.259)"},{id:"amber-50",hue:"amber",shade:"50",value:"oklch(98.7% 0.022 95.277)"},{id:"amber-100",hue:"amber",shade:"100",value:"oklch(96.2% 0.059 95.617)"},{id:"amber-200",hue:"amber",shade:"200",value:"oklch(92.4% 0.12 95.746)"},{id:"amber-300",hue:"amber",shade:"300",value:"oklch(87.9% 0.169 91.605)"},{id:"amber-400",hue:"amber",shade:"400",value:"oklch(82.8% 0.189 84.429)"},{id:"amber-500",hue:"amber",shade:"500",value:"oklch(76.9% 0.188 70.08)"},{id:"amber-600",hue:"amber",shade:"600",value:"oklch(66.6% 0.179 58.318)"},{id:"amber-700",hue:"amber",shade:"700",value:"oklch(55.5% 0.163 48.998)"},{id:"amber-800",hue:"amber",shade:"800",value:"oklch(47.3% 0.137 46.201)"},{id:"amber-900",hue:"amber",shade:"900",value:"oklch(41.4% 0.112 45.904)"},{id:"amber-950",hue:"amber",shade:"950",value:"oklch(27.9% 0.077 45.635)"},{id:"yellow-50",hue:"yellow",shade:"50",value:"oklch(98.7% 0.026 102.212)"},{id:"yellow-100",hue:"yellow",shade:"100",value:"oklch(97.3% 0.071 103.193)"},{id:"yellow-200",hue:"yellow",shade:"200",value:"oklch(94.5% 0.129 101.54)"},{id:"yellow-300",hue:"yellow",shade:"300",value:"oklch(90.5% 0.182 98.111)"},{id:"yellow-400",hue:"yellow",shade:"400",value:"oklch(85.2% 0.199 91.936)"},{id:"yellow-500",hue:"yellow",shade:"500",value:"oklch(79.5% 0.184 86.047)"},{id:"yellow-600",hue:"yellow",shade:"600",value:"oklch(68.1% 0.162 75.834)"},{id:"yellow-700",hue:"yellow",shade:"700",value:"oklch(55.4% 0.135 66.442)"},{id:"yellow-800",hue:"yellow",shade:"800",value:"oklch(47.6% 0.114 61.907)"},{id:"yellow-900",hue:"yellow",shade:"900",value:"oklch(42.1% 0.095 57.708)"},{id:"yellow-950",hue:"yellow",shade:"950",value:"oklch(28.6% 0.066 53.813)"},{id:"lime-50",hue:"lime",shade:"50",value:"oklch(98.6% 0.031 120.757)"},{id:"lime-100",hue:"lime",shade:"100",value:"oklch(96.7% 0.067 122.328)"},{id:"lime-200",hue:"lime",shade:"200",value:"oklch(93.8% 0.127 124.321)"},{id:"lime-300",hue:"lime",shade:"300",value:"oklch(89.7% 0.196 126.665)"},{id:"lime-400",hue:"lime",shade:"400",value:"oklch(84.1% 0.238 128.85)"},{id:"lime-500",hue:"lime",shade:"500",value:"oklch(76.8% 0.233 130.85)"},{id:"lime-600",hue:"lime",shade:"600",value:"oklch(64.8% 0.2 131.684)"},{id:"lime-700",hue:"lime",shade:"700",value:"oklch(53.2% 0.157 131.589)"},{id:"lime-800",hue:"lime",shade:"800",value:"oklch(45.3% 0.124 130.933)"},{id:"lime-900",hue:"lime",shade:"900",value:"oklch(40.5% 0.101 131.063)"},{id:"lime-950",hue:"lime",shade:"950",value:"oklch(27.4% 0.072 132.109)"},{id:"green-50",hue:"green",shade:"50",value:"oklch(98.2% 0.018 155.826)"},{id:"green-100",hue:"green",shade:"100",value:"oklch(96.2% 0.044 156.743)"},{id:"green-200",hue:"green",shade:"200",value:"oklch(92.5% 0.084 155.995)"},{id:"green-300",hue:"green",shade:"300",value:"oklch(87.1% 0.15 154.449)"},{id:"green-400",hue:"green",shade:"400",value:"oklch(79.2% 0.209 151.711)"},{id:"green-500",hue:"green",shade:"500",value:"oklch(72.3% 0.219 149.579)"},{id:"green-600",hue:"green",shade:"600",value:"oklch(62.7% 0.194 149.214)"},{id:"green-700",hue:"green",shade:"700",value:"oklch(52.7% 0.154 150.069)"},{id:"green-800",hue:"green",shade:"800",value:"oklch(44.8% 0.119 151.328)"},{id:"green-900",hue:"green",shade:"900",value:"oklch(39.3% 0.095 152.535)"},{id:"green-950",hue:"green",shade:"950",value:"oklch(26.6% 0.065 152.934)"},{id:"emerald-50",hue:"emerald",shade:"50",value:"oklch(97.9% 0.021 166.113)"},{id:"emerald-100",hue:"emerald",shade:"100",value:"oklch(95% 0.052 163.051)"},{id:"emerald-200",hue:"emerald",shade:"200",value:"oklch(90.5% 0.093 164.15)"},{id:"emerald-300",hue:"emerald",shade:"300",value:"oklch(84.5% 0.143 164.978)"},{id:"emerald-400",hue:"emerald",shade:"400",value:"oklch(76.5% 0.177 163.223)"},{id:"emerald-500",hue:"emerald",shade:"500",value:"oklch(69.6% 0.17 162.48)"},{id:"emerald-600",hue:"emerald",shade:"600",value:"oklch(59.6% 0.145 163.225)"},{id:"emerald-700",hue:"emerald",shade:"700",value:"oklch(50.8% 0.118 165.612)"},{id:"emerald-800",hue:"emerald",shade:"800",value:"oklch(43.2% 0.095 166.913)"},{id:"emerald-900",hue:"emerald",shade:"900",value:"oklch(37.8% 0.077 168.94)"},{id:"emerald-950",hue:"emerald",shade:"950",value:"oklch(26.2% 0.051 172.552)"},{id:"teal-50",hue:"teal",shade:"50",value:"oklch(98.4% 0.014 180.72)"},{id:"teal-100",hue:"teal",shade:"100",value:"oklch(95.3% 0.051 180.801)"},{id:"teal-200",hue:"teal",shade:"200",value:"oklch(91% 0.096 180.426)"},{id:"teal-300",hue:"teal",shade:"300",value:"oklch(85.5% 0.138 181.071)"},{id:"teal-400",hue:"teal",shade:"400",value:"oklch(77.7% 0.152 181.912)"},{id:"teal-500",hue:"teal",shade:"500",value:"oklch(70.4% 0.14 182.503)"},{id:"teal-600",hue:"teal",shade:"600",value:"oklch(60% 0.118 184.704)"},{id:"teal-700",hue:"teal",shade:"700",value:"oklch(51.1% 0.096 186.391)"},{id:"teal-800",hue:"teal",shade:"800",value:"oklch(43.7% 0.078 188.216)"},{id:"teal-900",hue:"teal",shade:"900",value:"oklch(38.6% 0.063 188.416)"},{id:"teal-950",hue:"teal",shade:"950",value:"oklch(27.7% 0.046 192.524)"},{id:"cyan-50",hue:"cyan",shade:"50",value:"oklch(98.4% 0.019 200.873)"},{id:"cyan-100",hue:"cyan",shade:"100",value:"oklch(95.6% 0.045 203.388)"},{id:"cyan-200",hue:"cyan",shade:"200",value:"oklch(91.7% 0.08 205.041)"},{id:"cyan-300",hue:"cyan",shade:"300",value:"oklch(86.5% 0.127 207.078)"},{id:"cyan-400",hue:"cyan",shade:"400",value:"oklch(78.9% 0.154 211.53)"},{id:"cyan-500",hue:"cyan",shade:"500",value:"oklch(71.5% 0.143 215.221)"},{id:"cyan-600",hue:"cyan",shade:"600",value:"oklch(60.9% 0.126 221.723)"},{id:"cyan-700",hue:"cyan",shade:"700",value:"oklch(52% 0.105 223.128)"},{id:"cyan-800",hue:"cyan",shade:"800",value:"oklch(45% 0.085 224.283)"},{id:"cyan-900",hue:"cyan",shade:"900",value:"oklch(39.8% 0.07 227.392)"},{id:"cyan-950",hue:"cyan",shade:"950",value:"oklch(30.2% 0.056 229.695)"},{id:"sky-50",hue:"sky",shade:"50",value:"oklch(97.7% 0.013 236.62)"},{id:"sky-100",hue:"sky",shade:"100",value:"oklch(95.1% 0.026 236.824)"},{id:"sky-200",hue:"sky",shade:"200",value:"oklch(90.1% 0.058 230.902)"},{id:"sky-300",hue:"sky",shade:"300",value:"oklch(82.8% 0.111 230.318)"},{id:"sky-400",hue:"sky",shade:"400",value:"oklch(74.6% 0.16 232.661)"},{id:"sky-500",hue:"sky",shade:"500",value:"oklch(68.5% 0.169 237.323)"},{id:"sky-600",hue:"sky",shade:"600",value:"oklch(58.8% 0.158 241.966)"},{id:"sky-700",hue:"sky",shade:"700",value:"oklch(50% 0.134 242.749)"},{id:"sky-800",hue:"sky",shade:"800",value:"oklch(44.3% 0.11 240.79)"},{id:"sky-900",hue:"sky",shade:"900",value:"oklch(39.1% 0.09 240.876)"},{id:"sky-950",hue:"sky",shade:"950",value:"oklch(29.3% 0.066 243.157)"},{id:"blue-50",hue:"blue",shade:"50",value:"oklch(97% 0.014 254.604)"},{id:"blue-100",hue:"blue",shade:"100",value:"oklch(93.2% 0.032 255.585)"},{id:"blue-200",hue:"blue",shade:"200",value:"oklch(88.2% 0.059 254.128)"},{id:"blue-300",hue:"blue",shade:"300",value:"oklch(80.9% 0.105 251.813)"},{id:"blue-400",hue:"blue",shade:"400",value:"oklch(70.7% 0.165 254.624)"},{id:"blue-500",hue:"blue",shade:"500",value:"oklch(62.3% 0.214 259.815)"},{id:"blue-600",hue:"blue",shade:"600",value:"oklch(54.6% 0.245 262.881)"},{id:"blue-700",hue:"blue",shade:"700",value:"oklch(48.8% 0.243 264.376)"},{id:"blue-800",hue:"blue",shade:"800",value:"oklch(42.4% 0.199 265.638)"},{id:"blue-900",hue:"blue",shade:"900",value:"oklch(37.9% 0.146 265.522)"},{id:"blue-950",hue:"blue",shade:"950",value:"oklch(28.2% 0.091 267.935)"},{id:"indigo-50",hue:"indigo",shade:"50",value:"oklch(96.2% 0.018 272.314)"},{id:"indigo-100",hue:"indigo",shade:"100",value:"oklch(93% 0.034 272.788)"},{id:"indigo-200",hue:"indigo",shade:"200",value:"oklch(87% 0.065 274.039)"},{id:"indigo-300",hue:"indigo",shade:"300",value:"oklch(78.5% 0.115 274.713)"},{id:"indigo-400",hue:"indigo",shade:"400",value:"oklch(67.3% 0.182 276.935)"},{id:"indigo-500",hue:"indigo",shade:"500",value:"oklch(58.5% 0.233 277.117)"},{id:"indigo-600",hue:"indigo",shade:"600",value:"oklch(51.1% 0.262 276.966)"},{id:"indigo-700",hue:"indigo",shade:"700",value:"oklch(45.7% 0.24 277.023)"},{id:"indigo-800",hue:"indigo",shade:"800",value:"oklch(39.8% 0.195 277.366)"},{id:"indigo-900",hue:"indigo",shade:"900",value:"oklch(35.9% 0.144 278.697)"},{id:"indigo-950",hue:"indigo",shade:"950",value:"oklch(25.7% 0.09 281.288)"},{id:"violet-50",hue:"violet",shade:"50",value:"oklch(96.9% 0.016 293.756)"},{id:"violet-100",hue:"violet",shade:"100",value:"oklch(94.3% 0.029 294.588)"},{id:"violet-200",hue:"violet",shade:"200",value:"oklch(89.4% 0.057 293.283)"},{id:"violet-300",hue:"violet",shade:"300",value:"oklch(81.1% 0.111 293.571)"},{id:"violet-400",hue:"violet",shade:"400",value:"oklch(70.2% 0.183 293.541)"},{id:"violet-500",hue:"violet",shade:"500",value:"oklch(60.6% 0.25 292.717)"},{id:"violet-600",hue:"violet",shade:"600",value:"oklch(54.1% 0.281 293.009)"},{id:"violet-700",hue:"violet",shade:"700",value:"oklch(49.1% 0.27 292.581)"},{id:"violet-800",hue:"violet",shade:"800",value:"oklch(43.2% 0.232 292.759)"},{id:"violet-900",hue:"violet",shade:"900",value:"oklch(38% 0.189 293.745)"},{id:"violet-950",hue:"violet",shade:"950",value:"oklch(28.3% 0.141 291.089)"},{id:"purple-50",hue:"purple",shade:"50",value:"oklch(97.7% 0.014 308.299)"},{id:"purple-100",hue:"purple",shade:"100",value:"oklch(94.6% 0.033 307.174)"},{id:"purple-200",hue:"purple",shade:"200",value:"oklch(90.2% 0.063 306.703)"},{id:"purple-300",hue:"purple",shade:"300",value:"oklch(82.7% 0.119 306.383)"},{id:"purple-400",hue:"purple",shade:"400",value:"oklch(71.4% 0.203 305.504)"},{id:"purple-500",hue:"purple",shade:"500",value:"oklch(62.7% 0.265 303.9)"},{id:"purple-600",hue:"purple",shade:"600",value:"oklch(55.8% 0.288 302.321)"},{id:"purple-700",hue:"purple",shade:"700",value:"oklch(49.6% 0.265 301.924)"},{id:"purple-800",hue:"purple",shade:"800",value:"oklch(43.8% 0.218 303.724)"},{id:"purple-900",hue:"purple",shade:"900",value:"oklch(38.1% 0.176 304.987)"},{id:"purple-950",hue:"purple",shade:"950",value:"oklch(29.1% 0.149 302.717)"},{id:"fuchsia-50",hue:"fuchsia",shade:"50",value:"oklch(97.7% 0.017 320.058)"},{id:"fuchsia-100",hue:"fuchsia",shade:"100",value:"oklch(95.2% 0.037 318.852)"},{id:"fuchsia-200",hue:"fuchsia",shade:"200",value:"oklch(90.3% 0.076 319.62)"},{id:"fuchsia-300",hue:"fuchsia",shade:"300",value:"oklch(83.3% 0.145 321.434)"},{id:"fuchsia-400",hue:"fuchsia",shade:"400",value:"oklch(74% 0.238 322.16)"},{id:"fuchsia-500",hue:"fuchsia",shade:"500",value:"oklch(66.7% 0.295 322.15)"},{id:"fuchsia-600",hue:"fuchsia",shade:"600",value:"oklch(59.1% 0.293 322.896)"},{id:"fuchsia-700",hue:"fuchsia",shade:"700",value:"oklch(51.8% 0.253 323.949)"},{id:"fuchsia-800",hue:"fuchsia",shade:"800",value:"oklch(45.2% 0.211 324.591)"},{id:"fuchsia-900",hue:"fuchsia",shade:"900",value:"oklch(40.1% 0.17 325.612)"},{id:"fuchsia-950",hue:"fuchsia",shade:"950",value:"oklch(29.3% 0.136 325.661)"},{id:"pink-50",hue:"pink",shade:"50",value:"oklch(97.1% 0.014 343.198)"},{id:"pink-100",hue:"pink",shade:"100",value:"oklch(94.8% 0.028 342.258)"},{id:"pink-200",hue:"pink",shade:"200",value:"oklch(89.9% 0.061 343.231)"},{id:"pink-300",hue:"pink",shade:"300",value:"oklch(82.3% 0.12 346.018)"},{id:"pink-400",hue:"pink",shade:"400",value:"oklch(71.8% 0.202 349.761)"},{id:"pink-500",hue:"pink",shade:"500",value:"oklch(65.6% 0.241 354.308)"},{id:"pink-600",hue:"pink",shade:"600",value:"oklch(59.2% 0.249 0.584)"},{id:"pink-700",hue:"pink",shade:"700",value:"oklch(52.5% 0.223 3.958)"},{id:"pink-800",hue:"pink",shade:"800",value:"oklch(45.9% 0.187 3.815)"},{id:"pink-900",hue:"pink",shade:"900",value:"oklch(40.8% 0.153 2.432)"},{id:"pink-950",hue:"pink",shade:"950",value:"oklch(28.4% 0.109 3.907)"},{id:"rose-50",hue:"rose",shade:"50",value:"oklch(96.9% 0.015 12.422)"},{id:"rose-100",hue:"rose",shade:"100",value:"oklch(94.1% 0.03 12.58)"},{id:"rose-200",hue:"rose",shade:"200",value:"oklch(89.2% 0.058 10.001)"},{id:"rose-300",hue:"rose",shade:"300",value:"oklch(81% 0.117 11.638)"},{id:"rose-400",hue:"rose",shade:"400",value:"oklch(71.2% 0.194 13.428)"},{id:"rose-500",hue:"rose",shade:"500",value:"oklch(64.5% 0.246 16.439)"},{id:"rose-600",hue:"rose",shade:"600",value:"oklch(58.6% 0.253 17.585)"},{id:"rose-700",hue:"rose",shade:"700",value:"oklch(51.4% 0.222 16.935)"},{id:"rose-800",hue:"rose",shade:"800",value:"oklch(45.5% 0.188 13.697)"},{id:"rose-900",hue:"rose",shade:"900",value:"oklch(41% 0.159 10.272)"},{id:"rose-950",hue:"rose",shade:"950",value:"oklch(27.1% 0.105 12.094)"},{id:"slate-50",hue:"slate",shade:"50",value:"oklch(98.4% 0.003 247.858)"},{id:"slate-100",hue:"slate",shade:"100",value:"oklch(96.8% 0.007 247.896)"},{id:"slate-200",hue:"slate",shade:"200",value:"oklch(92.9% 0.013 255.508)"},{id:"slate-300",hue:"slate",shade:"300",value:"oklch(86.9% 0.022 252.894)"},{id:"slate-400",hue:"slate",shade:"400",value:"oklch(70.4% 0.04 256.788)"},{id:"slate-500",hue:"slate",shade:"500",value:"oklch(55.4% 0.046 257.417)"},{id:"slate-600",hue:"slate",shade:"600",value:"oklch(44.6% 0.043 257.281)"},{id:"slate-700",hue:"slate",shade:"700",value:"oklch(37.2% 0.044 257.287)"},{id:"slate-800",hue:"slate",shade:"800",value:"oklch(27.9% 0.041 260.031)"},{id:"slate-900",hue:"slate",shade:"900",value:"oklch(20.8% 0.042 265.755)"},{id:"slate-950",hue:"slate",shade:"950",value:"oklch(12.9% 0.042 264.695)"},{id:"gray-50",hue:"gray",shade:"50",value:"oklch(98.5% 0.002 247.839)"},{id:"gray-100",hue:"gray",shade:"100",value:"oklch(96.7% 0.003 264.542)"},{id:"gray-200",hue:"gray",shade:"200",value:"oklch(92.8% 0.006 264.531)"},{id:"gray-300",hue:"gray",shade:"300",value:"oklch(87.2% 0.01 258.338)"},{id:"gray-400",hue:"gray",shade:"400",value:"oklch(70.7% 0.022 261.325)"},{id:"gray-500",hue:"gray",shade:"500",value:"oklch(55.1% 0.027 264.364)"},{id:"gray-600",hue:"gray",shade:"600",value:"oklch(44.6% 0.03 256.802)"},{id:"gray-700",hue:"gray",shade:"700",value:"oklch(37.3% 0.034 259.733)"},{id:"gray-800",hue:"gray",shade:"800",value:"oklch(27.8% 0.033 256.848)"},{id:"gray-900",hue:"gray",shade:"900",value:"oklch(21% 0.034 264.665)"},{id:"gray-950",hue:"gray",shade:"950",value:"oklch(13% 0.028 261.692)"},{id:"zinc-50",hue:"zinc",shade:"50",value:"oklch(98.5% 0 none)"},{id:"zinc-100",hue:"zinc",shade:"100",value:"oklch(96.7% 0.001 286.375)"},{id:"zinc-200",hue:"zinc",shade:"200",value:"oklch(92% 0.004 286.32)"},{id:"zinc-300",hue:"zinc",shade:"300",value:"oklch(87.1% 0.006 286.286)"},{id:"zinc-400",hue:"zinc",shade:"400",value:"oklch(70.5% 0.015 286.067)"},{id:"zinc-500",hue:"zinc",shade:"500",value:"oklch(55.2% 0.016 285.938)"},{id:"zinc-600",hue:"zinc",shade:"600",value:"oklch(44.2% 0.017 285.786)"},{id:"zinc-700",hue:"zinc",shade:"700",value:"oklch(37% 0.013 285.805)"},{id:"zinc-800",hue:"zinc",shade:"800",value:"oklch(27.4% 0.006 286.033)"},{id:"zinc-900",hue:"zinc",shade:"900",value:"oklch(21% 0.006 285.885)"},{id:"zinc-950",hue:"zinc",shade:"950",value:"oklch(14.1% 0.005 285.823)"},{id:"neutral-50",hue:"neutral",shade:"50",value:"oklch(98.5% 0 none)"},{id:"neutral-100",hue:"neutral",shade:"100",value:"oklch(97% 0 none)"},{id:"neutral-200",hue:"neutral",shade:"200",value:"oklch(92.2% 0 none)"},{id:"neutral-300",hue:"neutral",shade:"300",value:"oklch(87% 0 none)"},{id:"neutral-400",hue:"neutral",shade:"400",value:"oklch(70.8% 0 none)"},{id:"neutral-500",hue:"neutral",shade:"500",value:"oklch(55.6% 0 none)"},{id:"neutral-600",hue:"neutral",shade:"600",value:"oklch(43.9% 0 none)"},{id:"neutral-700",hue:"neutral",shade:"700",value:"oklch(37.1% 0 none)"},{id:"neutral-800",hue:"neutral",shade:"800",value:"oklch(26.9% 0 none)"},{id:"neutral-900",hue:"neutral",shade:"900",value:"oklch(20.5% 0 none)"},{id:"neutral-950",hue:"neutral",shade:"950",value:"oklch(14.5% 0 none)"},{id:"stone-50",hue:"stone",shade:"50",value:"oklch(98.5% 0.001 106.423)"},{id:"stone-100",hue:"stone",shade:"100",value:"oklch(97% 0.001 106.424)"},{id:"stone-200",hue:"stone",shade:"200",value:"oklch(92.3% 0.003 48.717)"},{id:"stone-300",hue:"stone",shade:"300",value:"oklch(86.9% 0.005 56.366)"},{id:"stone-400",hue:"stone",shade:"400",value:"oklch(70.9% 0.01 56.259)"},{id:"stone-500",hue:"stone",shade:"500",value:"oklch(55.3% 0.013 58.071)"},{id:"stone-600",hue:"stone",shade:"600",value:"oklch(44.4% 0.011 73.639)"},{id:"stone-700",hue:"stone",shade:"700",value:"oklch(37.4% 0.01 67.558)"},{id:"stone-800",hue:"stone",shade:"800",value:"oklch(26.8% 0.007 34.298)"},{id:"stone-900",hue:"stone",shade:"900",value:"oklch(21.6% 0.006 56.043)"},{id:"stone-950",hue:"stone",shade:"950",value:"oklch(14.7% 0.004 49.25)"},{id:"mauve-50",hue:"mauve",shade:"50",value:"oklch(98.5% 0 none)"},{id:"mauve-100",hue:"mauve",shade:"100",value:"oklch(96% 0.003 325.6)"},{id:"mauve-200",hue:"mauve",shade:"200",value:"oklch(92.2% 0.005 325.62)"},{id:"mauve-300",hue:"mauve",shade:"300",value:"oklch(86.5% 0.012 325.68)"},{id:"mauve-400",hue:"mauve",shade:"400",value:"oklch(71.1% 0.019 323.02)"},{id:"mauve-500",hue:"mauve",shade:"500",value:"oklch(54.2% 0.034 322.5)"},{id:"mauve-600",hue:"mauve",shade:"600",value:"oklch(43.5% 0.029 321.78)"},{id:"mauve-700",hue:"mauve",shade:"700",value:"oklch(36.4% 0.029 323.89)"},{id:"mauve-800",hue:"mauve",shade:"800",value:"oklch(26.3% 0.024 320.12)"},{id:"mauve-900",hue:"mauve",shade:"900",value:"oklch(21.2% 0.019 322.12)"},{id:"mauve-950",hue:"mauve",shade:"950",value:"oklch(14.5% 0.008 326)"},{id:"olive-50",hue:"olive",shade:"50",value:"oklch(98.8% 0.003 106.5)"},{id:"olive-100",hue:"olive",shade:"100",value:"oklch(96.6% 0.005 106.5)"},{id:"olive-200",hue:"olive",shade:"200",value:"oklch(93% 0.007 106.5)"},{id:"olive-300",hue:"olive",shade:"300",value:"oklch(88% 0.011 106.6)"},{id:"olive-400",hue:"olive",shade:"400",value:"oklch(73.7% 0.021 106.9)"},{id:"olive-500",hue:"olive",shade:"500",value:"oklch(58% 0.031 107.3)"},{id:"olive-600",hue:"olive",shade:"600",value:"oklch(46.6% 0.025 107.3)"},{id:"olive-700",hue:"olive",shade:"700",value:"oklch(39.4% 0.023 107.4)"},{id:"olive-800",hue:"olive",shade:"800",value:"oklch(28.6% 0.016 107.4)"},{id:"olive-900",hue:"olive",shade:"900",value:"oklch(22.8% 0.013 107.4)"},{id:"olive-950",hue:"olive",shade:"950",value:"oklch(15.3% 0.006 107.1)"},{id:"mist-50",hue:"mist",shade:"50",value:"oklch(98.7% 0.002 197.1)"},{id:"mist-100",hue:"mist",shade:"100",value:"oklch(96.3% 0.002 197.1)"},{id:"mist-200",hue:"mist",shade:"200",value:"oklch(92.5% 0.005 214.3)"},{id:"mist-300",hue:"mist",shade:"300",value:"oklch(87.2% 0.007 219.6)"},{id:"mist-400",hue:"mist",shade:"400",value:"oklch(72.3% 0.014 214.4)"},{id:"mist-500",hue:"mist",shade:"500",value:"oklch(56% 0.021 213.5)"},{id:"mist-600",hue:"mist",shade:"600",value:"oklch(45% 0.017 213.2)"},{id:"mist-700",hue:"mist",shade:"700",value:"oklch(37.8% 0.015 216)"},{id:"mist-800",hue:"mist",shade:"800",value:"oklch(27.5% 0.011 216.9)"},{id:"mist-900",hue:"mist",shade:"900",value:"oklch(21.8% 0.008 223.9)"},{id:"mist-950",hue:"mist",shade:"950",value:"oklch(14.8% 0.004 228.8)"},{id:"taupe-50",hue:"taupe",shade:"50",value:"oklch(98.6% 0.002 67.8)"},{id:"taupe-100",hue:"taupe",shade:"100",value:"oklch(96% 0.002 17.2)"},{id:"taupe-200",hue:"taupe",shade:"200",value:"oklch(92.2% 0.005 34.3)"},{id:"taupe-300",hue:"taupe",shade:"300",value:"oklch(86.8% 0.007 39.5)"},{id:"taupe-400",hue:"taupe",shade:"400",value:"oklch(71.4% 0.014 41.2)"},{id:"taupe-500",hue:"taupe",shade:"500",value:"oklch(54.7% 0.021 43.1)"},{id:"taupe-600",hue:"taupe",shade:"600",value:"oklch(43.8% 0.017 39.3)"},{id:"taupe-700",hue:"taupe",shade:"700",value:"oklch(36.7% 0.016 35.7)"},{id:"taupe-800",hue:"taupe",shade:"800",value:"oklch(26.8% 0.011 36.5)"},{id:"taupe-900",hue:"taupe",shade:"900",value:"oklch(21.4% 0.009 43.1)"},{id:"taupe-950",hue:"taupe",shade:"950",value:"oklch(14.7% 0.004 49.3)"}]);var Ta=12,Gi=new Map(Fe.map(e=>[e.id,e])),Ca=new Map(Fe.map(e=>[e.value,e])),Oa=/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i,Ra=/^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\(.*\)$/i,La=/[;{}<>\\]|url\s*\(/i,Yi=new WeakMap;function Vr(e){let t=Yi.get(e);return t||Yi.set(e,t=new Set),t}function Xi(e,t){let r=String(e??"").trim();if(!r||La.test(r)||Ir(r))return!1;let n=t?.defaultView?.CSS;return n&&typeof n.supports=="function"?n.supports("color",r):Oa.test(r)||Ra.test(r)||/^[a-z]+$/i.test(r)}function Ji(e){return`${e.hue[0].toUpperCase()}${e.hue.slice(1)} ${e.shade}`}function Kt(e){return{id:e.id,label:Ji(e),value:e.value}}function Zi(e){let t=String(e??"").trim(),r=Ca.get(t);return r?Ji(r):t}function Na(e,t){if(!e||e.length===0)return{swatches:Fe.map(Kt),custom:!0,full:!0};let r=[],n=new Set,i=!1,o=s=>{n.has(s.value)||(n.add(s.value),r.push(s))};for(let s of e)s==="custom"?i=!0:Gi.has(s)?o(Kt(Gi.get(s))):Ki.includes(s)?Fe.filter(l=>l.hue===s).forEach(l=>o(Kt(l))):Wi.includes(s)?Fe.filter(l=>l.shade===s).forEach(l=>o(Kt(l))):Xi(s,t)?o({id:null,label:s,value:s}):console.warn(`[hypercms] color option "${s}" is not a Tailwind color, hue, shade, CSS color or "custom"; ignoring it`);return{swatches:r,custom:i,full:!1}}function Qi(e,{value:t,tokens:r,path:n,doc:i}){let{swatches:o,custom:s,full:l}=Na(r,i),a=t==null?"":String(t).trim();a&&!o.some(h=>h.value===a)&&o.unshift({id:null,label:Zi(a),value:a});let u=o.length<=Ta;e.setAttribute("data-hcms-color-path",n),e.classList.toggle("hcms-color--inline",u);let d=e.querySelector(".hcms-color-grid");if(d){d.classList.toggle("hcms-color-grid--full",l);for(let h of o){let m=i.createElement("button");m.type="button",m.className="hcms-color-swatch",m.setAttribute("data-hcms-action","color-pick"),m.setAttribute("data-hcms-color",h.value),m.setAttribute("aria-label",h.label),m.setAttribute("title",h.id||h.label),m.setAttribute("style",`--hcms-swatch: ${h.value}`),d.appendChild(m)}}s||e.querySelector(".hcms-color-custom")?.remove();let p=e.querySelector(".hcms-color-current");u&&p&&(p.removeAttribute("data-hcms-action"),p.removeAttribute("aria-expanded")),Wr(e,u||Vr(i).has(n)),eo(e,a)}function eo(e,t){let r=t==null?"":String(t).trim();e.toggleAttribute("data-hcms-color-empty",r==="");let n=e.querySelector(".hcms-color-chip");n&&(r?n.setAttribute("style",`--hcms-swatch: ${r}`):n.removeAttribute("style"));let i=e.querySelector(".hcms-color-name");i&&(i.textContent=r?Zi(r):"Not set"),e.querySelectorAll(".hcms-color-swatch").forEach(l=>{l.setAttribute("aria-pressed",String(l.getAttribute("data-hcms-color")===r))});let o=e.querySelector('[data-hcms-color-input="text"]');o&&o.ownerDocument?.activeElement!==o&&(o.value=r);let s=e.querySelector('[data-hcms-color-input="native"]');s&&/^#[0-9a-f]{6}$/i.test(r)&&(s.value=r.toLowerCase())}function Wr(e,t){let r=e.querySelector(".hcms-color-panel");r&&(r.hidden=!t);let n=e.querySelector(".hcms-color-current[data-hcms-action]");n&&n.setAttribute("aria-expanded",String(t))}function Gt(e){return e?.closest?e.closest("[data-hcms-color-path]"):null}function Ma(e){return e.querySelector('input[type="hidden"][data-hcms-field]')}function to(e,t){let r=e.querySelector(":scope > .hcms-error");r&&(r.textContent=t||"",r.hidden=!t)}function Kr(e,t){let r=Ma(e);return!r||(to(e,null),eo(e,t),r.value===t)?null:(r.value=t,r)}function ro(e){let t=Gt(e);return t?(t.classList.contains("hcms-color--inline")||(Vr(t.ownerDocument).delete(t.getAttribute("data-hcms-color-path")),Wr(t,!1)),Kr(t,e.getAttribute("data-hcms-color")||"")):null}function no(e){let t=Gt(e);return t?Kr(t,""):null}function io(e){let t=Gt(e);if(!t)return;let r=t.getAttribute("data-hcms-color-path"),n=Vr(t.ownerDocument),i=!n.has(r);i?n.add(r):n.delete(r),Wr(t,i)}function oo(e){let t=Gt(e);if(!t)return null;let r=String(e.value||"").trim();return r!==""&&!Xi(r,t.ownerDocument)?(to(t,`"${r}" is not a CSS color`),null):Kr(t,r)}var Yr=["sans","serif","display","mono"],I="ui-sans-serif, system-ui, sans-serif",ee="ui-serif, Georgia, serif",$e="ui-monospace, SFMono-Regular, Menlo, monospace",re=Object.freeze([{slug:"inter",family:"Inter",group:"sans",fallback:I,request:"ital,wght@0,100..900;1,100..900"},{slug:"roboto",family:"Roboto",group:"sans",fallback:I,request:"ital,wght@0,100..900;1,100..900"},{slug:"open-sans",family:"Open Sans",group:"sans",fallback:I,request:"ital,wght@0,300..800;1,300..800"},{slug:"lato",family:"Lato",group:"sans",fallback:I,request:"ital,wght@0,100;0,300;0,400;0,700;0,900;1,100;1,300;1,400;1,700;1,900"},{slug:"montserrat",family:"Montserrat",group:"sans",fallback:I,request:"ital,wght@0,100..900;1,100..900"},{slug:"poppins",family:"Poppins",group:"sans",fallback:I,request:"ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,100;1,200;1,300;1,400;1,500;1,600;1,700;1,800;1,900"},{slug:"nunito",family:"Nunito",group:"sans",fallback:I,request:"ital,wght@0,200..1000;1,200..1000"},{slug:"raleway",family:"Raleway",group:"sans",fallback:I,request:"ital,wght@0,100..900;1,100..900"},{slug:"dm-sans",family:"DM Sans",group:"sans",fallback:I,request:"ital,wght@0,100..1000;1,100..1000"},{slug:"work-sans",family:"Work Sans",group:"sans",fallback:I,request:"ital,wght@0,100..900;1,100..900"},{slug:"source-sans-3",family:"Source Sans 3",group:"sans",fallback:I,request:"ital,wght@0,200..900;1,200..900"},{slug:"noto-sans",family:"Noto Sans",group:"sans",fallback:I,request:"ital,wght@0,100..900;1,100..900"},{slug:"plus-jakarta-sans",family:"Plus Jakarta Sans",group:"sans",fallback:I,request:"ital,wght@0,200..800;1,200..800"},{slug:"manrope",family:"Manrope",group:"sans",fallback:I,request:"wght@200..800"},{slug:"outfit",family:"Outfit",group:"sans",fallback:I,request:"wght@100..900"},{slug:"space-grotesk",family:"Space Grotesk",group:"sans",fallback:I,request:"wght@300..700"},{slug:"rubik",family:"Rubik",group:"sans",fallback:I,request:"ital,wght@0,300..900;1,300..900"},{slug:"ubuntu",family:"Ubuntu",group:"sans",fallback:I,request:"ital,wght@0,300;0,400;0,500;0,700;1,300;1,400;1,500;1,700"},{slug:"merriweather",family:"Merriweather",group:"serif",fallback:ee,request:"ital,wght@0,300..900;1,300..900"},{slug:"lora",family:"Lora",group:"serif",fallback:ee,request:"ital,wght@0,400..700;1,400..700"},{slug:"playfair-display",family:"Playfair Display",group:"serif",fallback:ee,request:"ital,wght@0,400..900;1,400..900"},{slug:"libre-baskerville",family:"Libre Baskerville",group:"serif",fallback:ee,request:"ital,wght@0,400..700;1,400..700"},{slug:"source-serif-4",family:"Source Serif 4",group:"serif",fallback:ee,request:"ital,wght@0,200..900;1,200..900"},{slug:"pt-serif",family:"PT Serif",group:"serif",fallback:ee,request:"ital,wght@0,400;0,700;1,400;1,700"},{slug:"noto-serif",family:"Noto Serif",group:"serif",fallback:ee,request:"ital,wght@0,100..900;1,100..900"},{slug:"crimson-pro",family:"Crimson Pro",group:"serif",fallback:ee,request:"ital,wght@0,200..900;1,200..900"},{slug:"eb-garamond",family:"EB Garamond",group:"serif",fallback:ee,request:"ital,wght@0,400..800;1,400..800"},{slug:"cormorant-garamond",family:"Cormorant Garamond",group:"serif",fallback:ee,request:"ital,wght@0,300..700;1,300..700"},{slug:"bebas-neue",family:"Bebas Neue",group:"display",fallback:I,request:"wght@400"},{slug:"oswald",family:"Oswald",group:"display",fallback:I,request:"wght@200..700"},{slug:"anton",family:"Anton",group:"display",fallback:I,request:"wght@400"},{slug:"abril-fatface",family:"Abril Fatface",group:"display",fallback:ee,request:"wght@400"},{slug:"lobster",family:"Lobster",group:"display",fallback:"cursive",request:"wght@400"},{slug:"bungee",family:"Bungee",group:"display",fallback:I,request:"wght@400"},{slug:"roboto-mono",family:"Roboto Mono",group:"mono",fallback:$e,request:"ital,wght@0,100..700;1,100..700"},{slug:"jetbrains-mono",family:"JetBrains Mono",group:"mono",fallback:$e,request:"ital,wght@0,100..800;1,100..800"},{slug:"fira-code",family:"Fira Code",group:"mono",fallback:$e,request:"wght@300..700"},{slug:"source-code-pro",family:"Source Code Pro",group:"mono",fallback:$e,request:"ital,wght@0,200..900;1,200..900"},{slug:"ibm-plex-mono",family:"IBM Plex Mono",group:"mono",fallback:$e,request:"ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;1,100;1,200;1,300;1,400;1,500;1,600;1,700"},{slug:"space-mono",family:"Space Mono",group:"mono",fallback:$e,request:"ital,wght@0,400;0,700;1,400;1,700"}]),De=Object.freeze({slug:"system",family:null,group:"sans",fallback:"system-ui, sans-serif"}),ja=new Map(re.map(e=>[e.family.toLowerCase(),e])),Rm=new Map(re.map(e=>[e.slug,e]));function bt(e){return!e||e.slug==="system"?De.fallback:`'${e.family}', ${e.fallback}`}function so(e){return e==null?null:String(e).split(",")[0].trim().replace(/^['"]|['"]$/g,"")||null}function Gr(e){let t=new Map;if(!e)return t;let r=String(e).split("?")[1]||"";for(let n of r.split("&")){if(!n.startsWith("family="))continue;let i=decodeURIComponent(n.slice(7).split(":")[0].replace(/\+/g," ")).trim();i&&t.set(i.toLowerCase(),n)}return t}function lo(e,t){let r=Gr(e),n=Gr(t);return r.size===n.size&&[...r.keys()].every(i=>n.has(i))}function Xr(e){let t=so(e);return t&&ja.get(t.toLowerCase())||null}function Yt(e,t=null){let r=Gr(t),n=new Map;for(let o of e||[]){let s=Xr(o);if(s){n.set(s.family.toLowerCase(),`family=${s.family.replace(/ /g,"+")}:${s.request}`);continue}let l=so(o),a=l&&r.get(l.toLowerCase());a&&n.set(l.toLowerCase(),a)}return n.size===0?null:`https://fonts.googleapis.com/css2?${[...n.entries()].sort(([o],[s])=>o.localeCompare(s)).map(([,o])=>o).join("&")}&display=swap`}var qa={sans:"Sans",serif:"Serif",display:"Display",mono:"Mono"},Pa="link[data-hcms-font-preview]",ao=new WeakMap;function Zr(e){let t=ao.get(e);return t||ao.set(e,t=new Set),t}function Ia(e){return String(e??"").trim()===De.fallback}function co(e){let t=String(e??"").trim();if(!t)return"Not set";if(Ia(t))return"System";let r=Xr(t);return r?r.family:"Current font"}function Fa(e){if(!e||e.length===0)return{system:!0,fonts:[...re]};let t=!1,r=new Set;for(let n of e)n==="system"?t=!0:Yr.includes(n)?re.filter(i=>i.group===n).forEach(i=>r.add(i)):re.some(i=>i.slug===n)?r.add(re.find(i=>i.slug===n)):console.warn(`[hypercms] font option "${n}" is not a catalog font, a group or "system"; ignoring it`);return{system:t,fonts:re.filter(n=>r.has(n))}}function Jr(e,{value:t,label:r,family:n}){let i=e.createElement("button");return i.type="button",i.className="hcms-font-option",i.setAttribute("role","option"),i.setAttribute("data-hcms-action","font-pick"),i.setAttribute("data-hcms-font",t),i.setAttribute("style",`font-family: ${n}`),i.textContent=r,i}function uo(e,{value:t,tokens:r,path:n,doc:i}){let{system:o,fonts:s}=Fa(r),l=t==null?"":String(t).trim();e.setAttribute("data-hcms-font-path",n);let a=e.querySelector(".hcms-font-list");if(a){let u=new Set([...o?[De.fallback]:[],...s.map(bt)]);l&&!u.has(l)&&a.appendChild(Jr(i,{value:l,label:co(l),family:l})),o&&a.appendChild(Jr(i,{value:De.fallback,label:"System",family:De.fallback}));for(let d of Yr){let p=s.filter(m=>m.group===d);if(!p.length)continue;let h=i.createElement("div");h.className="hcms-font-group",h.textContent=qa[d],a.appendChild(h);for(let m of p)a.appendChild(Jr(i,{value:bt(m),label:m.family,family:bt(m)}))}}Qr(e,Zr(i).has(n)),ho(e,l)}function ho(e,t){let r=t==null?"":String(t).trim(),n=e.querySelector(".hcms-font-name");n&&(n.textContent=co(r),r?n.setAttribute("style",`font-family: ${r}`):n.removeAttribute("style")),e.querySelectorAll(".hcms-font-option").forEach(i=>{i.setAttribute("aria-selected",String(i.getAttribute("data-hcms-font")===r))})}function Qr(e,t){let r=e.querySelector(".hcms-font-panel");r&&(r.hidden=!t),e.querySelector(".hcms-font-current")?.setAttribute("aria-expanded",String(t)),t&&$a(e.ownerDocument)}function $a(e){let t=e?.head;if(!t||t.querySelector(Pa))return;let r=Yt(re.map(bt)),n=[...new Set(re.map(o=>o.family).join(""))].join(""),i=e.createElement("link");i.rel="stylesheet",i.href=`${r}&text=${encodeURIComponent(n)}`,i.setAttribute("data-hcms-font-preview","");for(let o of["editor-ui","no-save","save-remove","snapshot-remove"])i.setAttribute(o,"");t.appendChild(i)}function mo(e){return e?.closest?e.closest("[data-hcms-font-path]"):null}function fo(e){let t=mo(e);if(!t)return;let r=t.getAttribute("data-hcms-font-path"),n=Zr(t.ownerDocument),i=!n.has(r);i?n.add(r):n.delete(r),Qr(t,i)}function po(e){let t=mo(e);if(!t)return null;let r=t.querySelector('input[type="hidden"][data-hcms-field]');if(!r)return null;Zr(t.ownerDocument).delete(t.getAttribute("data-hcms-font-path")),Qr(t,!1);let n=e.getAttribute("data-hcms-font")||"";return ho(t,n),r.value===n?null:(r.value=n,r)}var J=e=>`<svg viewBox="0 0 32 20" width="32" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">${e}</svg>`,$=(e,t,r,n,i="")=>`<rect x="${e}" y="${t}" width="${r}" height="${n}" rx="1"${i}/>`,H=(e,t,r)=>`<path d="M${e} ${t}H${r}"/>`,en=' fill="currentColor" fill-opacity="0.3"',go=Object.freeze({"cols-1":{label:"One column",svg:J($(2,2,28,16))},"cols-2":{label:"Two columns",svg:J($(2,2,13,16)+$(17,2,13,16))},"cols-3":{label:"Three columns",svg:J($(2,2,8,16)+$(12,2,8,16)+$(22,2,8,16))},"cols-4":{label:"Four columns",svg:J($(2,2,5.5,16)+$(9.5,2,5.5,16)+$(17,2,5.5,16)+$(24.5,2,5.5,16))},"media-left":{label:"Image left",svg:J($(2,3,12,14,en)+H(18,6,30)+H(18,10,30)+H(18,14,26))},"media-right":{label:"Image right",svg:J($(18,3,12,14,en)+H(2,6,14)+H(2,10,14)+H(2,14,10))},"media-top":{label:"Image on top",svg:J($(2,2,28,8,en)+H(2,14,30)+H(2,17,22))},list:{label:"List",svg:J(H(3,5,4)+H(8,5,29)+H(3,10,4)+H(8,10,29)+H(3,15,4)+H(8,15,29))},cards:{label:"Cards",svg:J($(2,2,13,7)+$(17,2,13,7)+$(2,11,13,7)+$(17,11,13,7))},centered:{label:"Centered",svg:J(H(6,5,26)+H(9,10,23)+H(11,15,21))},"card-flat":{label:"Flat",svg:J($(5,3,22,14))},"card-raised":{label:"Raised",svg:J($(7,5,22,14,' stroke-opacity="0.35"')+$(4,2,22,14,' fill="var(--mirk-bg, transparent)"'))}});function Da(e){return(e||[]).map(t=>{let r=t.indexOf(":"),n=r===-1?t:t.slice(0,r),i=r===-1?t:t.slice(r+1),o=go[i]||null;return{value:n,icon:o,label:o?o.label:xe(n)}})}function bo(e,{tokens:t,value:r,name:n,doc:i}){let o=Da(t),s=r==null?"":String(r);s!==""&&!o.some(a=>a.value===s)&&o.unshift({value:s,icon:null,label:xe(s)});let l=e.querySelector(".hcms-variant-option");if(!l||!l.parentNode)return o.length;for(let a of o){let u=l.cloneNode(!0),d=u.querySelector('input[type="radio"]');d&&(d.value=a.value,d.name=n);let p=u.querySelector(".hcms-variant-icon");p&&(a.icon?p.innerHTML=a.icon.svg:p.remove());let h=u.querySelector(".hcms-variant-label");h&&(h.textContent=a.label),u.setAttribute("title",a.label),l.parentNode.insertBefore(u,l)}return l.remove(),o.length}function tn(e){if(!e)return"";let t=String(e).split(/[?#]/)[0],r=t.split("/").pop()||t;try{return decodeURIComponent(r)}catch{return r}}function ze({pageRules:e,formRules:t,data:r,doc:n}){let i=n.createDocumentFragment(),o=za(e,r,n);o&&i.appendChild(o);let s=Xt(e,[],r,n,e);return s&&i.appendChild(s),i}function za(e,t,r){let n=[];if(a(e,t,[]),!n.length)return null;let i=X(r,"@object");if(!i)return null;let o=Se(i,r);o.setAttribute("data-hcms-page-style","");let s=o.querySelector("[data-hcms-label]");s&&(s.textContent="Page style");let l=o.querySelector(".hcms-object-fields")||o;for(let[u,d,p]of n){let h=Xt(u,d,p,r,e);h&&l.appendChild(h)}return o;function a(u,d,p){if(typeof u=="string"){p.length&&pt(u,r,p,e)==="page"&&n.push([u,p,d]);return}if(!(!u||typeof u!="object"||Array.isArray(u))){if(p.length){let h=we(p,"@object",r);if(h&&Ie(h))return}for(let[h,m]of Object.entries(u))a(m,d==null?null:d[h],[...p,h])}}}function yo(e,t,r,n){let i=[],o=[];for(let[s,l]of Object.entries(e)){let a=pt(l,r,[...t,s],n);a!=="page"&&(a?i:o).push([s,l])}return[...i,...o]}function vo({shape:e,itemShape:t,pathArr:r,data:n,doc:i,itemKey:o,pageRules:s}){if(e==="object-array-item")return Ao(t,r,n,i,s);if(e==="scalar-array-item")return So(r,n,i,o||null);throw new Error(`hypercms: buildItem called with unknown shape "${e}"`)}function Xt(e,t,r,n,i){let o=me(e);return o==="scalar"?Ua(e,t,r,n,i):o==="object"?Va(e,t,r,n,i):o==="object-array"?Wa(e,t,r,n,i):o==="scalar-array"?Ka(e,t,r,n):null}function Ua(e,t,r,n,i){let o=he(e,n,t,i),s=we(t,o,n);if(!s)throw new Error(`hypercms: missing template for scalar at "${t.join(".")}"`);let l=Ii(e,n,t,i);l==="@number"&&o==="@scalar"&&console.info(`[hypercms] field "${t.join(".")}" declares component "@number" but its value isn't a plain number; rendering a text input so the value is preserved`),(l==="@checkbox"||l==="@toggle")&&o==="@scalar"&&console.info(`[hypercms] field "${t.join(".")}" declares component "${l}" but its value isn't true/false; rendering a text input so the value is preserved`),xo(s,l===o?l:null,t);let a=Se(s,n);Ue(a,t);let u=s.getAttribute?.("data-hcms-tpl");if((o==="@select"||o==="@radio")&&u===o&&Ba(a,e,t,r,n,o,i),o==="@variant"&&u==="@variant"){let d=gt(e,n,t,i);d||wo(a,"data-hcms-options required (value:icon tokens)"),bo(a,{tokens:d,value:r,name:Jt(t.join(".")),doc:n})===0&&a.querySelector(".hcms-variant-option")?.remove()}if(o==="@image"&&u==="@image"){let d=Fi(e,n,t,i);d!=null&&!a.hasAttribute("data-hcms-crop")&&a.setAttribute("data-hcms-crop",d)}return Ga(a,se(t)),Zt(a,se(t)),Qt(a,se(t)),Oo(a,r),o==="@color"&&u==="@color"&&Qi(a,{value:r,tokens:gt(e,n,t,i),path:t.join("."),doc:n}),o==="@font"&&u==="@font"&&uo(a,{value:r,tokens:gt(e,n,t,i),path:t.join("."),doc:n}),o==="@file"&&Ha(a),a}function xo(e,t,r){if(!t)return;let n=e.getAttribute?.("data-hcms-tpl");n&&n!==t&&console.info(`[hypercms] field "${r.join(".")}" declares component "${t}" but custom template "${n}" wins`)}function Ba(e,t,r,n,i,o,s){let l=gt(t,i,r,s),a=l?[...l]:[],u=n==null?"":String(n);if(u!==""&&!a.includes(u)&&a.unshift(u),!l&&(wo(e,"data-hcms-options required (space-separated values)"),a.length===0)){e.querySelector(".mirk-radio")?.remove();return}if(o==="@select"){let h=e.querySelector("select[data-hcms-field]");if(!h)return;for(let m of a){let c=i.createElement("option");c.value=m,c.textContent=xe(m),h.appendChild(c)}return}let d=e.querySelector(".mirk-radio");if(!d||!d.parentNode)return;let p=Jt(r.join("."));for(let h of a){let m=d.cloneNode(!0),c=m.querySelector('input[type="radio"]');c&&(c.value=h,c.name=p);let f=m.querySelector(".mirk-radio__label");f&&(f.textContent=xe(h)),d.parentNode.insertBefore(m,d)}d.remove()}function Jt(e){return"hcms-"+String(e).replace(/[^A-Za-z0-9_-]/g,"-")}function wo(e,t){let r=e.querySelector?e.querySelector(".hcms-error"):null;r&&(r.textContent=t,r.hidden=!1)}function Ha(e){let t=e.querySelector?e.querySelector("a.mirk-file__name[data-hcms-field]"):null;t&&(t.textContent=tn(t.getAttribute("href")))}function Va(e,t,r,n,i){let o=we(t,"@object",n);if(!o)throw new Error(`hypercms: missing template for object at "${t.join(".")}"`);let s=Se(o,n);if(Ue(s,t),Zt(s,se(t)),Qt(s,se(t)),Ie(o))return Lo(s,e,t),Ro(s,e,r),s;let l=er(s,".hcms-object-fields",o,t);for(let[a,u]of yo(e,t,n,i)){let d=r==null?null:r[a],p=Xt(u,[...t,a],d,n,i);p&&l.appendChild(p)}return t.length&&!l.children.length&&Object.keys(e).length?null:s}function Wa(e,t,r,n,i){let o=we(t,"@object-array",n);if(!o)throw new Error(`hypercms: missing template for object-array at "${t.join(".")}"`);let s=Se(o,n);Ue(s,t),Zt(s,se(t)),Qt(s,se(t)),_o(s,o),Co(s,o,t);let l=er(s,".hcms-array-items",o,t),[,a]=e;return(Array.isArray(r)?r:[]).forEach((d,p)=>{let h=Ao(a,[...t,p],d,n,i);h&&l.appendChild(h)}),To(s),s}function Ao(e,t,r,n,i){let o=Eo(t,"object-array-item",n);if(!o)throw new Error(`hypercms: missing item template for "${t.join(".")}"`);let s=Se(o,n);if(s.setAttribute("data-hcms-card",""),s.classList.contains("hcms-card")||s.classList.add("hcms-card"),Ue(s,t),Ie(o))return e&&typeof e=="object"&&!Array.isArray(e)&&(Lo(s,e,t),Ro(s,e,r)),s;let l=er(s,".hcms-card-fields",o,t);if(e&&typeof e=="object"&&!Array.isArray(e))for(let[a,u]of yo(e,t,n,i)){let d=r==null?null:r[a],p=Xt(u,[...t,a],d,n,i);p&&l.appendChild(p)}return s}function Ka(e,t,r,n){let i=Dt(e,n),o=zt(e,t,n),s=i?i.array:"@scalar-array",l=we(t,s,n);if(!l)throw new Error(`hypercms: missing template for scalar-array at "${t.join(".")}"`);xo(l,i?i.array:null,t);let a=Se(l,n);Ue(a,t),Zt(a,se(t)),Qt(a,se(t)),_o(a,l),Co(a,l,t),o&&a.setAttribute("data-hcms-item-tpl",o.item);let u=er(a,".hcms-array-items",l,t);return(Array.isArray(r)?r:[]).forEach((p,h)=>{let m=So([...t,h],p,n,o?o.item:null);m&&u.appendChild(m)}),To(a),a}function So(e,t,r,n){let i=Eo(e,"scalar-array-item",r,n);if(!i)throw new Error(`hypercms: missing item template for "${e.join(".")}"`);let o=Se(i,r);return o.setAttribute("data-hcms-array-item",""),o.classList.contains("hcms-array-item")||o.classList.add("hcms-array-item"),Ue(o,e),Oo(o,t),o}function Eo(e,t,r,n){let i=e.map(o=>typeof o=="number"?"*":o).join(".");return X(r,i)||n&&X(r,n)||X(r,"@"+t)}function Se(e,t){let r=e.content||e,n=t.createElement("div");return n.appendChild(r.cloneNode(!0)),n.firstElementChild||n}function Ue(e,t){e.setAttribute("data-hcms-path",t.join(".")),e.setAttribute("data-hcms-path-shape",Ht(t))}function Ga(e,t){let r=t==null?"":String(t);if(e.matches&&e.matches("[data-hcms-field]")){e.getAttribute("data-hcms-field")||e.setAttribute("data-hcms-field",r);return}(e.querySelectorAll?e.querySelectorAll("[data-hcms-field]"):[]).forEach(i=>{i.getAttribute("data-hcms-field")||i.setAttribute("data-hcms-field",r)})}function Zt(e,t){t==null||t===""||!e.setAttribute||e.hasAttribute?.("data-hcms-field")||e.setAttribute("data-hcms-field",String(t))}function Qt(e,t){if(t==null||t==="")return;(e.querySelectorAll?e.querySelectorAll("[data-hcms-label]"):[]).forEach(n=>{(n.textContent||"").trim()===""&&(n.textContent=xe(String(t)))})}function _o(e,t){["data-hcms-no-add","data-hcms-no-remove","data-hcms-no-reorder"].forEach(r=>{t.hasAttribute(r)&&e.setAttribute(r,"")}),["data-hcms-min-items","data-hcms-max-items"].forEach(r=>{t.hasAttribute(r)&&e.setAttribute(r,t.getAttribute(r))})}function To(e){let t=e.querySelector?e.querySelector(".hcms-array-items"):null;if(!t)return;let r=Array.from(t.querySelectorAll(":scope > [data-hcms-card], :scope > [data-hcms-array-item]")),n=r.length,i=ko(e,"data-hcms-max-items"),o=ko(e,"data-hcms-min-items"),s=e.hasAttribute("data-hcms-no-add"),l=e.hasAttribute("data-hcms-no-remove"),a=e.hasAttribute("data-hcms-no-reorder"),u=e.querySelector('[data-hcms-action="add"]');u&&(u.hidden=s||i!=null&&n>=i),r.forEach((d,p)=>{let h=d.querySelector('[data-hcms-action="remove"]');h&&(h.hidden=l||o!=null&&n<=o);let m=d.querySelector('[data-hcms-action="move-up"]');m&&(m.hidden=a||p===0);let c=d.querySelector('[data-hcms-action="move-down"]');c&&(c.hidden=a||p===n-1)})}function ko(e,t){if(!e||!e.hasAttribute(t))return null;let r=parseInt(e.getAttribute(t),10);return Number.isFinite(r)?r:null}function Co(e,t,r){if(e.hasAttribute("data-hcms-no-reorder")||t.hasAttribute("data-hcms-no-reorder"))return;let n=e.querySelector(".hcms-array-items");if(!n)return;let i="hcms-"+r.join(".");n.setAttribute("sortable",i),n.setAttribute("onsorted","hypercmsCommit && hypercmsCommit()")}function se(e){return e.length?e[e.length-1]:null}function Oo(e,t){let r=Ya(e);if(r.length!==0)for(let n of r)No(n,t)}function Ya(e){if(!e)return[];let t=[];return e.matches?.("[data-hcms-field]")&&Xa(e)&&t.push(e),(e.querySelectorAll?e.querySelectorAll("input[data-hcms-field], textarea[data-hcms-field], select[data-hcms-field], img[data-hcms-field], a[data-hcms-field], [contenteditable][data-hcms-field]"):[]).forEach(n=>t.push(n)),t}function Xa(e){let t=(e.tagName||"").toUpperCase();return!!(t==="INPUT"||t==="TEXTAREA"||t==="SELECT"||t==="IMG"||t==="A"||e.hasAttribute?.("contenteditable"))}function Ro(e,t,r){(e.querySelectorAll?e.querySelectorAll("[data-hcms-field]"):[]).forEach(i=>{let o=i.getAttribute("data-hcms-field");if(!o)return;if(!t||typeof t!="object"||!(o in t)){console.warn(`[hypercms] inline template field "${o}" is not in the rule shape; ignoring`);return}let s=r==null?null:r[o];No(i,s)})}function Lo(e,t,r){if(!e.querySelectorAll)return;e.querySelectorAll("[data-hcms-field]").forEach(i=>{let o=i.getAttribute("data-hcms-field");if(!o||t&&typeof t=="object"&&!(o in t))return;let s=[...r,o].join(".");i.setAttribute("data-hcms-path",s),i.setAttribute("data-hcms-path-shape",Ht([...r,o]))})}function er(e,t,r,n){if(!e.querySelector)return e;let i=e.querySelector(t);if(i)return i;let o=r?.getAttribute?.("data-hcms-tpl")||n.join(".");throw new Error(`hypercms: template "${o}" is in slotted mode but has no ${t} element`)}function No(e,t){let r=Vt(e),n=(e.tagName||"").toUpperCase(),i=(e.getAttribute("type")||"").toLowerCase();if(n==="INPUT"&&i==="radio"){e.checked=e.value!=null&&String(e.value)===String(t??"");return}if(r==="checked"){e.checked=t===!0||t==="true";return}if(r){e[r]=t==null?"":String(t);return}e.textContent=t==null?"":String(t)}var Ja={Mutation:(e,t)=>e?.Mutation??t?.Mutation,undo:(e,t)=>e?.undo??t?.undo,onPrepareForSave:(e,t)=>e?.addDocumentTransform??t?.onPrepareForSave,onSnapshot:(e,t)=>e?.onSnapshot??t?.onSnapshot,consent:(e,t)=>e?.confirm??t?.consent,RichClay:(e,t)=>e?.RichClay??t?.RichClay,quickcrop:(e,t)=>e?.quickcrop??t?.quickcrop,upload:(e,t)=>e?.upload??(t?.uploadFileBasic?Qa(t.uploadFileBasic):null)},Za={402:"payment-required",413:"too-large",415:"unsupported-type",401:"unauthorized",403:"forbidden",404:"not-found"},rn=()=>({ok:!1,msg:"Upload cancelled",msgType:"skipped",code:"aborted",uploads:[]});function Qa(e){return async function(r,{onProgress:n,signal:i}={}){if(i?.aborted)return rn();try{let o=await e(r,{onProgress:l=>{n?.({loaded:null,total:null,percent:l})}});if(i?.aborted)return rn();let s=o&&o.uploads||[];return typeof s[0]?.url!="string"?{ok:!1,msg:"The host accepted the file but did not say where it put it",msgType:"error",code:"bad-response",uploads:[]}:{ok:!0,msg:o.msg||"Uploaded",msgType:o.msgType||"success",code:o.code||null,uploads:s}}catch(o){if(i?.aborted)return rn();let s={};try{s=JSON.parse(o?.response||"{}")}catch{s={}}let l=s.code||Za[o?.status]||"error";return{ok:!1,msg:o&&o.message||"Upload failed",msgType:"error",code:l,uploads:[]}}}}function D(e,t){let r=Ja[e];if(!r)throw new Error(`hypercms: unknown platform capability "${e}"`);let n=t||(typeof window<"u"?window:null);return n&&r(n.clay,n.hyperclay)||null}var Mo=["clay:mutation-ready","hyperclay:mutation-ready"],jo=["clay:sync-applied","hyperclay:livesync-applied"],qo=["clay:ready","hyperclay:ready"];function Be(e,t,r){let n=null,i=o=>{n!==null&&n!==o.type||(n=o.type,queueMicrotask(()=>{n=null}),r(o))};for(let o of t)e.addEventListener(o,i);return()=>{for(let o of t)e.removeEventListener(o,i)}}var te="data-hcms-bound",fe="data-hcms-bound-id",nn=new Map;function Po(e,t){nn.set(e,t)}function Io(e){nn.delete(e)}function Fo(e){let t=e.getAttribute(fe);if(!t)return null;let r=nn.get(t);return!r||!r.restorable()?null:r.originalHTML}var Ee="data-hcms-owns-richclay";function He(e){return e&&e.richclay&&e.richclay.RichClay||D("RichClay",e)||(e&&typeof e.RichClay=="function"?e.RichClay:null)}function $o(e,t,r){!e||typeof e.setAttribute!="function"||(e.setAttribute(te,t?"rich":"plain"),r&&e.setAttribute(Ee,"true"))}function Do(e,t){if(!e||typeof e.querySelectorAll!="function")return;let r=e.querySelectorAll(`[${te}]`);if(!r.length)return;let n=He(t);if(n&&typeof n.stripFromClone=="function")try{n.stripFromClone(e)}catch(i){console.warn("[hypercms] richclay strip failed; editor state may reach the save",i)}for(let i of r)i.getAttribute(Ee)==="true"&&i.removeAttribute("data-richclay"),i.removeAttribute(Ee),i.removeAttribute(te)}function zo(e,t){if(!e||typeof e.removeAttribute!="function")return;let r=He(t);if(r&&typeof r.stripElement=="function")try{r.stripElement(e)}catch(n){console.warn("[hypercms] richclay element strip failed; the clone stays editable",n)}else e.removeAttribute("contenteditable"),e.removeAttribute("no-undo");e.getAttribute(Ee)==="true"&&e.removeAttribute("data-richclay"),e.removeAttribute(Ee),e.removeAttribute(te),e.removeAttribute(fe)}function Uo(e,t){if(!t||e==null)return e;return r(e);function r(n){if(typeof n=="string"){if(n.endsWith("[]")||q(n)!==-1)return n;let i=null;try{i=t.querySelector(n)}catch{return n}return i&&i.children.length>0?n+"@innerHTML":n}if(Array.isArray(n))return n;if(n&&typeof n=="object"){let i=Object.create(null);for(let[o,s]of Object.entries(n))i[o]=r(s);return i}return n}}function Bo(e,t){if(!t||e==null)return e;return r(e,[t]);function r(n,i){if(typeof n=="string")return n.endsWith("[]")||q(n)!==-1?n:i.some(o=>ec(o,n))?n+"@innerHTML":n;if(Array.isArray(n)){let[o,s]=n;if(typeof o!="string"||!o)return n;let l=tc(t,o);return l.length?[o,r(s,l)]:n}if(n&&typeof n=="object"){let o=Object.create(null);for(let[s,l]of Object.entries(n))o[s]=r(l,i);return o}return n}}function ec(e,t){let r=null;try{r=e.querySelector(t)}catch{return!1}return r?r.hasAttribute(te)?r.getAttribute(te)==="rich":r.children.length>0:!1}function tc(e,t){try{return[...e.querySelectorAll(t)]}catch{return[]}}function Ve(e){if(!e||e.tagName!=="TEXTAREA")return;let t=e.ownerDocument.defaultView||(typeof window<"u"?window:null);t&&t.CSS&&t.CSS.supports&&t.CSS.supports("field-sizing: content")||(e.style.height="auto",e.style.height=e.scrollHeight+"px")}function pe(e,t,r=!0){if(!e||!e.querySelectorAll||(e.querySelectorAll("textarea[data-hcms-field]").forEach(Ve),r===!1))return;let n=t&&t.defaultView||(typeof window<"u"?window:null),i=He(n);i&&e.querySelectorAll("[contenteditable][data-hcms-field]").forEach(o=>{if(o.__hcmsRichclay)return;let s;try{s=new i(o,{inline:!0,hyperclay:!1,toolbar:["bold","italic","link","undo","redo"]})}catch(a){console.warn("[hypercms] richclay activation failed; field stays plain contenteditable",a);return}o.__hcmsRichclay=s;let l=s&&s.squire;l&&typeof l.addEventListener=="function"&&l.addEventListener("input",()=>{let a=n&&n.Event||Event;o.dispatchEvent(new a("input",{bubbles:!0}))})})}var Ho="link[data-hcms-fonts]",rc="link[data-hcms-fonts-preconnect]";function nc(e,t,r){let n=[],i=!1;return o(e,t,[]),{stacks:n,found:i};function o(s,l,a){if(typeof s=="string"){if(s.endsWith("[]")||he(s,r,a,e)!=="@font")return;i=!0,l!=null&&l!==""&&n.push(String(l));return}if(Array.isArray(s)){let u=Array.isArray(l)?l:[];u.forEach(d=>o(s[1],d,[...a,"*"])),u.length||o(s[1],void 0,[...a,"*"]);return}if(s&&typeof s=="object")for(let[u,d]of Object.entries(s))o(d,l?.[u],[...a,u])}}function ic(e,t){let r=e?.head;if(!r)return;let n=r.querySelector(Ho),i=r.querySelector(rc);if(!t){n?.remove(),i?.remove();return}i||(i=e.createElement("link"),i.setAttribute("rel","preconnect"),i.setAttribute("href","https://fonts.gstatic.com"),i.setAttribute("crossorigin",""),i.setAttribute("data-hcms-fonts-preconnect",""),i.setAttribute("no-undo",""),r.appendChild(i)),n||(n=e.createElement("link"),n.setAttribute("rel","stylesheet"),n.setAttribute("data-hcms-fonts",""),n.setAttribute("no-undo",""),i.after(n)),n.hasAttribute("no-undo")||n.setAttribute("no-undo",""),i.hasAttribute("no-undo")||i.setAttribute("no-undo",""),n.getAttribute("href")!==t&&n.setAttribute("href",t)}function We(e,t){if(!e?.doc||e.pageRules==null)return;let{stacks:r,found:n}=nc(e.pageRules,t,e.doc);if(!n)return;let i=e.doc.head?.querySelector(Ho)?.getAttribute("href")||null,o=Yt(r,i);o&&i&&lo(i,o)||ic(e.doc,o)}var on=new WeakSet;function _e(e,t){let r=D("undo");if(!r)return t();r.pause();try{let n=t();return n&&n.ok?r.commitCaptured(e):r.discardCaptured(),n}finally{r.resume()}}function ae(e){let t=D("undo");if(!t)return e();t.pause();try{return e()}finally{t.discardCaptured(),t.resume()}}function nr(e){let{formRoot:t}=e;if(!t||on.has(t))return;on.add(t);let r=s=>{let l=s.target;!l||!l.closest||l.closest("[data-hcms-form-root]")&&(l.matches("[data-hcms-color-input]")||l.matches("input, textarea, select, [contenteditable][data-hcms-field]")&&(l.tagName==="TEXTAREA"&&Ve(l),!l.matches('input[type="file"]')&&(!l.closest("[data-hcms-field]")&&!l.hasAttribute?.("data-hcms-field")||kt(l,e))))},n=s=>{let l=s.target;if(!(!l||!l.closest)&&l.closest("[data-hcms-form-root]")){if(l.matches("[data-hcms-color-input]")){let a=oo(l);a&&kt(a,e);return}if(l.matches('input[type="file"][data-hcms-upload]')){hc(l,e);return}l.matches('input[type="checkbox"], input[type="radio"], select')&&kt(l,e)}},i=s=>{let l=s.target;if(!l||!l.closest)return;let a=l.closest("[data-hcms-action]");if(!a)return;let u=a.getAttribute("data-hcms-action");if(u==="add"||u==="remove"||u==="move-up"||u==="move-down"||u==="clear-upload"||u==="color-pick"||u==="color-clear"||u==="color-panel"||u==="font-pick"||u==="font-panel"){if(!a.closest("[data-hcms-form-root]"))return}else if(u==="close"&&!a.closest("[data-hcms-shell]"))return;if(u==="add"){let d=a.closest("[data-hcms-path]");if(!d)return;let p=d.getAttribute("data-hcms-path");yt(p,e)}else if(u==="remove"){let d=a.closest("[data-hcms-card], [data-hcms-array-item]");if(!d)return;an(d,e)}else if(u==="move-up"||u==="move-down"){let d=a.closest("[data-hcms-card], [data-hcms-array-item]");if(!d)return;ln(d,u==="move-up"?-1:1,e)}else if(u==="clear-upload")gc(a,e);else if(u==="color-pick"||u==="color-clear"){let d=u==="color-pick"?ro(a):no(a);d&&kt(d,e)}else if(u==="color-panel")io(a);else if(u==="font-pick"){let d=po(a);d&&kt(d,e)}else u==="font-panel"?fo(a):u==="close"&&e.onCloseRequested?.()},o=t.ownerDocument;o.addEventListener("input",r,!0),o.addEventListener("change",n,!0),o.addEventListener("click",i,!0),e.detachEvents=()=>{o.removeEventListener("input",r,!0),o.removeEventListener("change",n,!0),o.removeEventListener("click",i,!0),on.delete(t)}}var oc=new Set(["value","checked"]);function sc(e,t){if(!t)return null;let r=ie(t);if(r.some(a=>typeof a=="number"||a==="*"))return null;let n=oe(e.pageRules,r);if(typeof n!="string")return null;let i=U.ruleAttrIndex(n);if(i===-1)return null;let o=n.slice(i+1);if(!oc.has(o))return null;let s=n.slice(0,i),l=s?e.pageRoot.querySelector(s):Q(e.pageRoot);return l?{el:l,prop:o,oldValue:l[o]}:null}function kt(e,t){let n=(e.closest("[data-hcms-field]")||e).closest("[data-hcms-path]")?.getAttribute("data-hcms-path")||"",i=sc(t,n);if(G(V(t),{path:n,structural:!1},t),i){let o=D("undo");o&&typeof o.recordValue=="function"&&o.recordValue(i.el,{prop:i.prop,oldValue:i.oldValue,newValue:i.el[i.prop]})}}var lc={type:"image/webp",quality:.85,maxWidth:2048,maxHeight:2048};async function ac(e,t){let r=t&&t.getAttribute?t.getAttribute("data-hcms-crop"):null;if(r==null)return{file:e};let n=D("quickcrop");if(typeof n!="function")return{file:e};try{let i=typeof window<"u"&&(window.clay?.modal??window.themodal)||"auto",o=await n(e,{aspect:cc(r),modal:i,...lc});return o===null?null:{file:uc(o.blob,e.name),dataURL:o.dataURL}}catch(i){return Ge(t,i&&i.message||"Crop failed"),null}}function cc(e){let t=String(e??"").trim().toLowerCase();if(t===""||t==="free")return null;let r=t.match(/^(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)$/);if(!r)return null;let n=parseFloat(r[1]),i=parseFloat(r[2]);return!n||!i?null:n/i}function uc(e,t){let r=e.type==="image/webp"?".webp":e.type==="image/jpeg"?".jpg":".png",n=String(t||"image").replace(/\.[^.]+$/,"");try{return new File([e],n+r,{type:e.type})}catch{return e}}var dc=new Set(["unsupported","payment-required"]);async function hc(e,t){let r=e.files&&e.files[0];if(!r)return;let n=e.closest("[data-hcms-path]");if(!n)return;let i=n.getAttribute("data-hcms-path")||"";Ge(n,null);let o=await ac(r,n);if(!o||t.closed){ge(e);return}let s=o.file,l=o.dataURL||null,a=D("upload");if(typeof a!="function")return sn(e,n,t,i,await Vo(s,l,n),s);Yo(n,l),Wo(n,0);let u=fc(t),d;try{d=await a(s,{signal:u?.signal,onProgress:({percent:h})=>Wo(n,h)})}finally{pc(t,u),kc(n)}if(t.closed){ge(e);return}if(d.code==="aborted"){ge(e);return}if(d.ok)return sn(e,n,t,i,d.uploads[0].url,s);if(!dc.has(d.code)){Ge(n,d.msg||"Upload failed"),t.dispatch?.("hcms:error",{error:new Error(d.msg||"Upload failed"),code:d.code,path:i}),ge(e);return}let p=d.code==="payment-required"?"This file is stored in the page. Add a paid plan to upload files.":null;return sn(e,n,t,i,await Vo(s,l,n),s,p)}function sn(e,t,r,n,i,o,s=null){if(r.closed){ge(e);return}if(Yo(t,null),Ge(t,null),!i){ge(e);return}Go(t,i,o.name),G(V(r),{path:n,structural:!1},r),s&&Ge(t,s,"info"),ge(e)}async function Vo(e,t,r){return t||await mc(e,r)}function mc(e,t){let r=t?.ownerDocument?.defaultView?.FileReader||globalThis.FileReader;return r?new Promise(n=>{let i=new r;i.onload=()=>n(typeof i.result=="string"?i.result:""),i.onerror=()=>n("");try{i.readAsDataURL(e)}catch{n("")}}):Promise.resolve("")}function fc(e){if(typeof AbortController!="function")return null;let t=new AbortController;return(e.uploads||(e.uploads=new Set)).add(t),t}function pc(e,t){t&&e.uploads?.delete(t)}function gc(e,t){let r=e.closest("[data-hcms-path]");if(!r)return;let n=r.getAttribute("data-hcms-path")||"";Go(r,"","");let i=r.querySelector('input[type="file"][data-hcms-upload]');i&&ge(i),Ge(r,null),G(V(t),{path:n,structural:!1},t)}function bc(e){return e.querySelector?e.querySelector("img[data-hcms-field], a[data-hcms-field]"):null}function Go(e,t,r){let n=bc(e);if(!n)return;let i=(n.tagName||"").toUpperCase();i==="IMG"?n.src=t||"":i==="A"&&(n.href=t||"",n.textContent=t?r||tn(t):"")}function ge(e){try{e.value=""}catch{}}function Yo(e,t){let r=e.querySelector?e.querySelector(".mirk-image__frame"):null;r&&(t?r.style.backgroundImage=`url("${t.replace(/"/g,"%22")}")`:r.style.removeProperty("background-image"))}function Wo(e,t){let r=Math.max(0,Math.min(100,Number(t)||0));e.setAttribute("data-hcms-uploading",""),e.style?.setProperty?.("--hcms-upload-progress",`${r}%`)}function kc(e){e.removeAttribute("data-hcms-uploading"),e.style?.removeProperty?.("--hcms-upload-progress")}function Ge(e,t,r="error"){let n=e.querySelector?e.querySelector(":scope > .hcms-error"):null;n&&(n.classList.toggle("hcms-error--info",!!t&&r==="info"),t?(n.textContent=t,n.hidden=!1):(n.textContent="",n.hidden=!0))}function yt(e,t){let{formRoot:r,pageRules:n}=t,i=r.querySelector(`[data-hcms-path="${Te(e)}"]`);if(!i)throw new Error(`hypercms: no element at path "${e}"`);let o=i.querySelector(".hcms-array-items");if(!o)throw new Error(`hypercms: array container missing .hcms-array-items at "${e}"`);let s=ie(e),l=Ac(n,s),a=Array.isArray(l),u=typeof l=="string"&&l.endsWith("[]");if(!a&&!u)throw new Error(`hypercms: path "${e}" is not an array`);let d=rr(i,"data-hcms-max-items"),p=o.querySelectorAll(":scope > [data-hcms-card], :scope > [data-hcms-array-item]");if(i.hasAttribute("data-hcms-no-add")||d!=null&&p.length>=d)return;let h=p.length,m=a?l[1]:l.replace(/\[\]$/,""),c=ft(a?m:"string"),f=vo({shape:a?"object-array-item":"scalar-array-item",itemShape:m,pathArr:[...s,h],data:c,doc:t.doc,itemKey:i.getAttribute("data-hcms-item-tpl")||null,pageRules:n});return o.appendChild(f),pe(f,t.doc,t.view?.enhanceFormRichText!==!1),un(i),_e(`Add ${e}`,()=>G(V(t),{path:e,structural:!0},t))}function ln(e,t,r){let n=e.closest('[data-hcms-shape="object-array"], [data-hcms-shape="scalar-array"]');if(!n||n.hasAttribute("data-hcms-no-reorder"))return;let i=n.querySelector(".hcms-array-items");if(!i)return;let o=Array.from(i.querySelectorAll(":scope > [data-hcms-card], :scope > [data-hcms-array-item]")),s=o.indexOf(e);if(s<0)return;let l=s+t;if(l<0||l>=o.length)return;let a=e.querySelector(`[data-hcms-action="${t<0?"move-up":"move-down"}"]`);return t<0?i.insertBefore(e,o[l]):i.insertBefore(e,o[l].nextSibling),dn(i),un(n),a&&typeof a.focus=="function"&&e.querySelector(`[data-hcms-action="${t<0?"move-up":"move-down"}"]`)?.focus?.(),_e(`Reorder ${n.getAttribute("data-hcms-path")||""}`,()=>G(V(r),{path:n.getAttribute("data-hcms-path")||"",structural:!0},r))}var tr="Delete this item?";function yc(e,t){let r=e&&e.getAttribute("data-hcms-confirm-remove");if(r!=null)return/^(off|false|no|0)$/i.test(r.trim())?null:r||tr;let n=t&&t.confirmRemove;return n===!1?null:typeof n=="string"?n||tr:n===!0||e&&e.getAttribute("data-hcms-shape")==="object-array"?tr:null}function an(e,t){let r=e.closest('[data-hcms-shape="object-array"], [data-hcms-shape="scalar-array"]'),n=yc(r,t);if(n==null)return Ke(e,t);let i=D("consent")||typeof window<"u"&&window.consent;typeof i=="function"?Promise.resolve(i(n)).then(()=>{t.closed||Ke(e,t)},()=>{}):typeof window<"u"&&typeof window.confirm=="function"?window.confirm(n)&&Ke(e,t):Ke(e,t)}function Ke(e,t){let r=e.getAttribute("data-hcms-path")||"",n=e.parentElement,i=e.closest('[data-hcms-shape="object-array"], [data-hcms-shape="scalar-array"]');if(!i?.hasAttribute("data-hcms-no-remove")){if(i){let o=rr(i,"data-hcms-min-items"),s=i.querySelector(".hcms-array-items"),l=s?s.querySelectorAll(":scope > [data-hcms-card], :scope > [data-hcms-array-item]").length:0;if(o!=null&&l<=o)return}return e.remove(),n&&dn(n),i&&un(i),_e(`Remove ${r}`,()=>G(V(t),{path:r,structural:!0},t))}}function G(e,t,r){if(r.closed)return{ok:!1,skipped:!0,closed:!0};let n=vt(e);if(!t.structural&&n===r.lastFingerprint)return{ok:!0,skipped:!0};let i=Object.hasOwn(r,"writeRules")?r.writeRules:r.pageRules,o=Ri(r.pageRoot,i,e,{shellRoot:r.shellRoot,structural:!!t.structural,structuralPath:t.path||null,formRoot:r.formRoot});return o.ok?(r.lastFingerprint=n,r.lastData=e,We(r,e),Ko(r,null),r.dispatch?.("hcms:change",{data:e,path:t.path,structural:!!t.structural}),r.onChange?.(e,t)):(Ko(r,wc(o.error,t.path)),r.dispatch?.("hcms:error",{error:o.error,attemptedData:e}),r.onError?.(o.error)),o}function ir(e,t){let r=Te(t),n=`[data-hcms-path="${r}"] input[data-hcms-field], [data-hcms-path="${r}"] textarea[data-hcms-field], [data-hcms-path="${r}"] select[data-hcms-field], [data-hcms-path="${r}"] img[data-hcms-field], [data-hcms-path="${r}"] a[data-hcms-field], [data-hcms-path="${r}"] [contenteditable][data-hcms-field], input[data-hcms-path="${r}"][data-hcms-field], textarea[data-hcms-path="${r}"][data-hcms-field], select[data-hcms-path="${r}"][data-hcms-field], img[data-hcms-path="${r}"][data-hcms-field], a[data-hcms-path="${r}"][data-hcms-field], [contenteditable][data-hcms-path="${r}"][data-hcms-field]`;return e.querySelector(n)}function or(e,t,r,n){let i=(e.tagName||"").toUpperCase(),o=(e.getAttribute("type")||"").toLowerCase();if(i==="INPUT"&&o==="checkbox"){e.checked=t===!0||t==="true";return}if(i==="INPUT"&&o==="radio"){let s=Te(n),l=r.querySelectorAll(`[data-hcms-path="${s}"][data-hcms-field][type="radio"], [data-hcms-path="${s}"] [data-hcms-field][type="radio"]`);l.length?l.forEach(a=>{a.checked=String(a.value)===String(t??"")}):e.checked=String(e.value)===String(t??"");return}if(i==="IMG"){e.src=t==null?"":String(t);return}if(i==="A"){e.href=t==null?"":String(t);return}if(e.hasAttribute&&e.hasAttribute("contenteditable")){e.innerHTML=t==null?"":String(t);return}if("value"in e){e.value=t==null?"":String(t);return}e.textContent=t==null?"":String(t)}function V(e){let t=U.extract(e.formRoot,e.formRules,{exclude:null});return le(t,e.formRules)}function le(e,t){if(t==null||e==null)return e;if(typeof t=="string")return t.endsWith("@checked")?e===!0||e==="true":e;if(Array.isArray(t)){if(!Array.isArray(e))return e;let[,r]=t;return e.map(n=>le(n,r))}if(typeof t=="object"){if(typeof e!="object"||Array.isArray(e))return e;let r={};for(let[n,i]of Object.entries(t))r[n]=le(e[n],i);return r}return e}function Ko(e,t){e.lastErrors=t&&t.length?t:null,cn(e)}function cn(e){if(vc(e),e.errorEl&&(e.errorEl.textContent="",e.errorEl.hidden=!0),!e.lastErrors)return;let t=[];for(let{message:r,path:n}of e.lastErrors){if(n!=null&&n!==""){let i=xc(e.formRoot,n);if(i){i.textContent=i.textContent?`${i.textContent}
${r}`:r,i.hidden=!1;continue}}t.push(r)}t.length&&e.errorEl&&(e.errorEl.textContent=t.join(`
`),e.errorEl.hidden=!1)}function vc(e){if(e.formRoot)for(let t of e.formRoot.querySelectorAll(".hcms-error"))t.textContent="",t.hidden=!0}function xc(e,t){if(!e)return null;let r=t.split(".");for(;r.length>0;){let n=r.join("."),i=typeof CSS<"u"&&CSS.escape?CSS.escape(n):n.replace(/[^a-zA-Z0-9_\-.*]/g,s=>"\\"+s),o=e.querySelector(`[data-hcms-path="${i}"]`);if(o){for(let s of o.children)if(s.classList&&s.classList.contains("hcms-error"))return s}r.pop()}return null}function wc(e,t){return e?e.name==="EmptyListInsert"?[{message:"Add a seed item in HTML first.",path:t}]:e.name==="ShapeMismatch"&&Array.isArray(e.mismatches)&&e.mismatches.length?e.mismatches.map(r=>({message:`Shape mismatch: expected ${r.expected}, got ${r.got}`,path:r.path})):[{message:e.message||String(e),path:t}]:[{message:"unknown error",path:t}]}function Ac(e,t){let r=e;for(let n of t){if(r==null||typeof r=="string")return;if(Array.isArray(r)){if(typeof n!="number"&&n!=="*")return;r=r[1];continue}if(typeof r=="object"){if(typeof n=="number"||!(n in r))return;r=r[n];continue}return}return r}function rr(e,t){if(!e||!e.hasAttribute(t))return null;let r=parseInt(e.getAttribute(t),10);return Number.isFinite(r)?r:null}function un(e){if(!e)return;let t=e.querySelector(".hcms-array-items");if(!t)return;let r=Array.from(t.querySelectorAll(":scope > [data-hcms-card], :scope > [data-hcms-array-item]")),n=r.length,i=rr(e,"data-hcms-max-items"),o=rr(e,"data-hcms-min-items"),s=e.hasAttribute("data-hcms-no-add"),l=e.hasAttribute("data-hcms-no-remove"),a=e.hasAttribute("data-hcms-no-reorder"),u=e.querySelector(':scope > .hcms-add, :scope > * > .hcms-add, :scope > [data-hcms-action="add"]');u&&(u.hidden=s||i!=null&&n>=i),r.forEach((d,p)=>{let h=d.querySelector('[data-hcms-action="remove"]');h&&(h.hidden=l||o!=null&&n<=o);let m=d.querySelector('[data-hcms-action="move-up"]');m&&(m.hidden=a||p===0);let c=d.querySelector('[data-hcms-action="move-down"]');c&&(c.hidden=a||p===n-1)})}function sr(e){!e||!e.querySelectorAll||e.querySelectorAll(".hcms-array-items").forEach(t=>dn(t))}function dn(e){let t=e.querySelectorAll?Array.from(e.querySelectorAll('input[type="radio"][data-hcms-field]'),n=>[n,n.checked]):[],r=0;for(let n of e.children){if(!n.matches?.("[data-hcms-card], [data-hcms-array-item]"))continue;let i=n.getAttribute("data-hcms-path");if(!i)continue;let o=i.split(".");o[o.length-1]=String(r);let s=o.join(".");s!==i&&Sc(n,i,s),r++}for(let[n,i]of t)n.checked!==i&&(n.checked=i)}function Sc(e,t,r){let n=e.querySelectorAll("[data-hcms-path]");e.setAttribute("data-hcms-path",r);for(let i of n){let o=i.getAttribute("data-hcms-path");o===t?i.setAttribute("data-hcms-path",r):o&&o.startsWith(t+".")&&i.setAttribute("data-hcms-path",r+o.slice(t.length))}Ec(e)}function Ec(e){for(let t of e.querySelectorAll('input[type="radio"][data-hcms-field]')){if(!t.name||!t.name.startsWith("hcms-"))continue;let r=t.closest("[data-hcms-path]");r&&(t.name=Jt(r.getAttribute("data-hcms-path")))}}function vt(e){return JSON.stringify(e,(t,r)=>{if(r&&typeof r=="object"&&!Array.isArray(r)){let n=Object.create(null);for(let i of Object.keys(r).sort())n[i]=r[i];return n}return r})}function Te(e){return typeof CSS<"u"&&CSS.escape?CSS.escape(e):String(e).replace(/[^a-zA-Z0-9_\-.*]/g,t=>"\\"+t)}var lr="hcms-shell-styles",_c="hcms-bundled-styles-installed",ar="hcms-session-open",Tc='a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',Ye=new WeakSet,hn="";function Jo(e){hn=e}function xt(e){e?.body?.classList.add(ar)}function mn(e){e?.body?.classList.remove(ar)}var Cc=0;function Xo(e){return String(e).replace(/[&<>"]/g,t=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[t])}function Zo({mountTo:e,side:t="right",overlay:r=!1,showSaveButton:n=!1,title:i="Page content",eyebrow:o="Edit",theme:s=null,doc:l}){Qo(l);let a=`hcms-shell-title-${++Cc}`,u=l.createElement("div");u.setAttribute("data-hcms-shell",""),u.setAttribute("editor-ui",""),u.setAttribute("save-remove",""),u.setAttribute("save-ignore",""),u.setAttribute("tabindex","-1"),u.setAttribute("role","dialog"),u.setAttribute("aria-modal","true"),u.setAttribute("aria-labelledby",a);let d=s==="dark"?" dark":s==="light"?" light":"";u.className="hcms-shell pixel-quiet hcms-panel hcms-side-"+t+(r?" hcms-overlay":"")+d;let p=Xo(i),h=Xo(o);u.innerHTML=`
    <div class="hcms-shell-minibar" aria-hidden="true">
      <span class="hcms-shell-minibar-title">${p}</span>
      <button type="button" class="hcms-shell-close mirk-button mirk-button--small" data-hcms-action="close" aria-label="Close">
        <span class="mirk-button__label">\xD7</span>
      </button>
    </div>
    <div class="hcms-shell-body">
      <header class="hcms-shell-header">
        <div class="hcms-shell-heading">
          <div class="hcms-shell-eyebrow">${h}</div>
          <h2 class="hcms-shell-title" id="${a}">${p}</h2>
        </div>
        <button type="button" class="hcms-shell-close mirk-button mirk-button--small" data-hcms-action="close" aria-label="Close">
          <span class="mirk-button__label">\xD7</span>
        </button>
      </header>
      <div class="hcms-shell-notice" role="status" hidden></div>
      <div class="hcms-shell-error" role="alert" hidden></div>
      <div data-hcms-form-root class="hcms-form"></div>
      <footer class="hcms-shell-footer"${n?"":" hidden"}>
        <button type="button" class="hcms-shell-save mirk-button" trigger-save>
          <span class="mirk-button__label">Save</span>
        </button>
      </footer>
    </div>
  `,(e||l.body).appendChild(u);let c=l.body;c.classList.add("hcms-open"),xt(l),r&&c.classList.add("hcms-overlay"),t==="left"&&c.classList.add("hcms-side-left");let f=Rc(u,l),b=Oc(u);return{root:u,formRoot:u.querySelector("[data-hcms-form-root]"),noticeEl:u.querySelector(".hcms-shell-notice"),errorEl:u.querySelector(".hcms-shell-error"),saveButton:u.querySelector(".hcms-shell-save"),destroy(){f.detach(),b.detach(),u.remove(),c.classList.remove("hcms-open","hcms-overlay","hcms-side-left"),mn(l)},restoreChrome(){Xe(l),c.classList.add("hcms-open"),xt(l),r&&c.classList.add("hcms-overlay"),t==="left"&&c.classList.add("hcms-side-left")}}}function Xe(e){e&&(e.getElementById(lr)||e.querySelector("style[data-hcms-bundled-styles]")||(Ye.delete(e),Qo(e)))}function Qo(e){if(e&&!Ye.has(e)){if(e[_c]){Ye.add(e);return}if(e.getElementById(lr)||e.querySelector("style[data-hcms-bundled-styles]")){Ye.add(e);return}if(hn){let t=e.createElement("style");t.id=lr,t.setAttribute("save-remove",""),t.setAttribute("save-ignore",""),t.textContent=hn,(e.head||e.documentElement).appendChild(t),Ye.add(e);return}try{let t=new URL("./theme.generated.css",import.meta.url).href,r=e.createElement("link");r.rel="stylesheet",r.id=lr,r.setAttribute("save-remove",""),r.setAttribute("save-ignore",""),r.href=t,(e.head||e.documentElement).appendChild(r),Ye.add(e)}catch{let r=()=>{link.isConnected&&console.warn("hypercms: shell stylesheet not applied \u2014 cssText is empty and the co-located theme fallback is unavailable. Call installStyles(themeText) before opening the CMS.")};e.defaultView?.queueMicrotask?e.defaultView.queueMicrotask(r):r()}}}function Oc(e){let t=e.querySelector(".hcms-shell-body"),r=e.querySelector(".hcms-shell-header");if(!t||!r||typeof t.addEventListener!="function")return{detach(){}};let n=()=>{let i=(r.offsetHeight||0)-12;e.classList.toggle("is-condensed",t.scrollTop>i)};return t.addEventListener("scroll",n,{passive:!0}),n(),{detach(){t.removeEventListener("scroll",n)}}}function Rc(e,t){function r(n){if(n.key!=="Tab"||!e.contains(t.activeElement))return;let i=Array.from(e.querySelectorAll(Tc));if(i.length===0)return;let o=i[0],s=i[i.length-1];n.shiftKey&&t.activeElement===o?(n.preventDefault(),s.focus()):!n.shiftKey&&t.activeElement===s&&(n.preventDefault(),o.focus())}return t.addEventListener("keydown",r),{detach:()=>t.removeEventListener("keydown",r)}}var Lc="[hypercms]",es={skip:"[data-hcms-shell]",templateAttr:"cms-template"},ts={skip:"[data-hcms-shell]",templateAttr:null},fn=class extends Error{constructor(t,r,n){super(`hypercms: rule at "${t}" has an invalid CSS selector: "${r}"`),this.name="InvalidRuleSelector",this.path=t,this.selector=r,this.cause=n}};function ur(e,t){let r=[],n=[],i=[];return gn(ne(e),e,t,[],r,n,i),{missing:rs(r),twins:Pc(n),readOnly:rs(i)}}function dr(e){return pn(e)}function pn(e){if(typeof e=="string")return ns(e)?void 0:e;if(Array.isArray(e)){let[t,r]=e;return[t,pn(r)]}if(e&&typeof e=="object"){let t={};for(let[r,n]of Object.entries(e)){let i=pn(n);i!==void 0&&(t[r]=i)}return t}return e}function gn(e,t,r,n,i,o,s){if(typeof r=="string"){let l=Nc(r),a=l?cr(e,t,l,es,n):[];if(ns(r)){s.push(Je(n));return}if(!l)return;if(r.endsWith("[]")){a.length===0&&cr(e,t,l,ts,n).length===0&&i.push(Je(n));return}a.length===0?i.push(Je(n)):a.length>1&&o.push({path:Je(n),count:a.length});return}if(Array.isArray(r)){let[l,a]=r;if(typeof l!="string"||!l)return;let u=cr(e,t,l,es,n);if(u.length===0){cr(e,t,l,ts,n).length===0&&i.push(Je(n));return}for(let d of u)gn(e,d,a,[...n,"*"],i,o,s);return}if(r&&typeof r=="object")for(let[l,a]of Object.entries(r))gn(e,t,a,[...n,l],i,o,s)}function cr(e,t,r,n,i){try{return e.find(t,r,n)}catch(o){throw new fn(Je(i),r,o)}}function Nc(e){if(e==="."||e.startsWith("@"))return null;if(e.endsWith("[]"))return e.slice(0,-2)||null;let t=q(e);return(t===-1?e:e.slice(0,t))||null}function Mc(e){if(e.endsWith("[]"))return null;let t=q(e);return t===-1?null:e.slice(t+1)||null}function ns(e){let t=Mc(e);return t!=null&&Re.has(t)}function Ze(e){jc(e),qc(e)}function jc(e){let t=e.noticeEl;if(!t)return;let r=e.unresolved&&e.unresolved.missing||[],n=e.unresolved&&e.unresolved.readOnly||[];if(r.length===0&&n.length===0){t.textContent="",t.hidden=!0;return}let i=[];if(r.length){let o=r.length===1?"1 field no longer matches this page":`${r.length} fields no longer match this page`;i.push(`${o}: ${r.join(", ")}`)}if(n.length){let o=n.length===1?"1 field reads a property the browser will not let anything write":`${n.length} fields read properties the browser will not let anything write`;i.push(`${o}: ${n.join(", ")}`)}t.textContent=i.join(`
`),t.hidden=!1}function qc(e){let t=e.unresolved&&e.unresolved.twins||[],r=t.map(n=>`${n.path}:${n.count}`).join("|");if(r!==e.lastTwinSignature){e.lastTwinSignature=r;for(let{path:n,count:i}of t)console.warn(`${Lc} "${n}" matches ${i} elements; edits go to the first one.`)}}function rs(e){return[...new Set(e)]}function Pc(e){let t=new Map;for(let r of e){let n=t.get(r.path);(!n||r.count>n.count)&&t.set(r.path,r)}return[...t.values()]}function Je(e){return e.length?e.join("."):"(whole page)"}var Ic={skip:"[data-hcms-shell]",templateAttr:"cms-template"};function be(e,{ignoreActiveValue:t}={}){return Fc(e,{ignoreActiveValue:t})}function Fc(e,{ignoreActiveValue:t}){let r=U.findRules(e.doc,e.rulesSource||"cms");r&&(e.pageRules=e.view.prepareRules(Pt(r.rules,e.pageRoot)),e.rulesTagNode=r.tagNode),$t(e.doc),Bt(e.doc,e.pageRules),e.formRules=Wt(e.pageRules,e.doc),e.writeRules=dr(e.pageRules),e.unresolved=ur(e.pageRoot,e.pageRules);let n=qt(),i=le(U.extract(e.pageRoot,e.pageRules,{...Ic,...n.hooks}),e.pageRules),o=ze({pageRules:e.pageRules,formRules:e.formRules,data:i,doc:e.doc});jt(e.formRoot,o,{ignoreActiveValue:t}),We(e,i),n.seed(e.formRoot),pe(e.formRoot,e.doc,e.view?.enhanceFormRichText!==!1),cn(e),Ze(e),e.updateFingerprint&&e.updateFingerprint()}function is({debounce:e=100,onRefresh:t}){let r=D("Mutation");if(!r||typeof r.onAnyChange!="function")throw new Error("hypercms: a mutation hub is required (clay.Mutation or hyperclay.Mutation). Load clayjs or hyperclayjs, or just the mutation utility, before initializing hypercms.");let n=r.onAnyChange({debounce:e},i=>{t(i)});return{unsubscribe:typeof n=="function"?n:()=>{}}}var $c='input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])';function os({doc:e,pageRoot:t,opts:r={}}){let n=r.richText!==!1,i=null;return{name:"sidebar",richText:n,enhanceFormRichText:!0,ctx:null,root:null,formRoot:null,errorEl:null,noticeEl:null,prepareRules(o){return n?Uo(o,t):o},mount(o){let s=this.ctx;i=ae(()=>Zo({mountTo:r.mountTo||e.body,side:r.side||"right",overlay:!!r.overlay,showSaveButton:!!r.showSaveButton,title:r.title,eyebrow:r.eyebrow,theme:r.theme,doc:e})),this.root=i.root,this.formRoot=i.formRoot,this.errorEl=i.errorEl,this.noticeEl=i.noticeEl;let l=ze({pageRules:s.pageRules,formRules:s.formRules,data:o,doc:e});i.formRoot.appendChild(l),s.seeder.seed(i.formRoot),pe(i.formRoot,e),Ze(s),nr(s)},refresh(o){if(o==="livesync"){i?.restoreChrome?.(),be(this.ctx,{ignoreActiveValue:!0});return}if(o==="undo"){be(this.ctx,{ignoreActiveValue:!1});return}be(this.ctx)},focusOnOpen(){let o=this.root&&this.root.querySelector($c);o&&typeof o.focus=="function"&&o.focus()},destroy(){i?.destroy(),i=null}}}var Dc="[cms-template], [data-hcms-shell]";function Qe(e){if(!e||typeof e.getBoundingClientRect!="function"||typeof e.closest=="function"&&e.closest(Dc))return!1;let t=e.getBoundingClientRect();return t.width>=8&&t.height>=8}var zc={skip:"[data-hcms-shell]",templateAttr:"cms-template"},Uc={skip:"[data-hcms-shell]",templateAttr:null},Bc="text",Hc="native",ss="handle",Vc=new Set(["INPUT","TEXTAREA","SELECT"]),cs=new Set(["IMG","INPUT","TEXTAREA","SELECT","OPTION","BR","HR","VIDEO","AUDIO","IFRAME","EMBED","OBJECT","CANVAS","SOURCE","TRACK","AREA","COL","PARAM","BUTTON","STYLE","SCRIPT","LINK","META"]);function kn(e,t,r=null){let n=[],i=[],o=ne(e);return bn(o,e,t,[],n,i,r?(l,a)=>pt(l,r,a,t):()=>null),{targets:n,lists:i}}function bn(e,t,r,n,i,o,s){if(typeof r=="string"){if(r.endsWith("[]")){let p=r.slice(0,-2);if(!p)return;let h=hr(e,t,p);h.forEach((m,c)=>{i.push(as([...n,c],m,r,null))}),o.push(ls(e,t,n,p,h,!0));return}let l=q(r),a=l===-1?null:r.slice(l+1),u=l===-1?r:r.slice(0,l),d=!u||u==="."?t:hr(e,t,u)[0];d&&i.push(as(n,d,r,a,s(r,n)));return}if(Array.isArray(r)){let[l,a]=r;if(typeof l!="string"||!l)return;let u=hr(e,t,l);u.forEach((d,p)=>bn(e,d,a,[...n,p],i,o,s)),o.push(ls(e,t,n,l,u,typeof a=="string"));return}if(r&&typeof r=="object")for(let[l,a]of Object.entries(r))bn(e,t,a,[...n,l],i,o,s)}function ls(e,t,r,n,i,o){let s=i[0]?i[0].parentElement:null;if(!s){let l=hr(e,t,n,Uc)[0];s=l?l.parentElement:null}return{path:r,items:i,container:s,scalar:o}}function as(e,t,r,n,i=null){return{path:e,el:t,rule:r,attr:n,kind:Wc(t,n),icon:Gc(t,n),style:i}}function Wc(e,t){let r=(e.tagName||"").toUpperCase();return!t||t==="innerHTML"?cs.has(r)?ss:Bc:t==="value"&&Vc.has(r)&&!e.readOnly&&!Kc(e)?Hc:ss}function Kc(e){return e.disabled?!0:typeof e.matches=="function"&&e.matches(":disabled")}function Gc(e,t){let r=(e.tagName||"").toUpperCase();return(!t||t==="innerHTML")&&!cs.has(r)?null:r==="IMG"||t==="srcset"?"camera":r==="A"&&t==="href"?"paperclip":"pencil"}function hr(e,t,r,n=zc){try{return e.find(t,r,n)}catch{return[]}}function us(e,t){let r=[],n=new Map,i=null;for(let o of e){if(!o.style)continue;let s=o.path.join(".");if(o.style==="page"){i||(i={scope:"page",el:o.el,list:null,paths:[]},r.push(i)),i.paths.push(s);continue}let l=Yc(o.path,t),a=l?l.row:o.el,u=n.get(a);u||(u={scope:l?"row":"section",el:a,list:l?l.list:null,paths:[]},n.set(a,u),r.push(u)),u.paths.push(s)}return r}function Yc(e,t){for(let r=e.length-1;r>=0;r--){if(typeof e[r]!="number")continue;let n=e.slice(0,r).join("."),i=t.find(s=>s.path.join(".")===n),o=i&&i.items[e[r]];if(o)return{list:i,row:o}}return null}var mr=Object.freeze({data:Object.freeze({tokens:["no-data"],bundles:["editor-ui"]}),save:Object.freeze({tokens:["no-save"],bundles:["editor-ui"]}),snapshot:Object.freeze({tokens:["no-snapshot"],bundles:["editor-ui"]}),watch:Object.freeze({tokens:["no-watch"],bundles:["editor-ui"]}),undo:Object.freeze({tokens:["no-undo"],bundles:["editor-ui"]}),history:Object.freeze({tokens:[],bundles:["editor-ui"]})}),Xc=Object.freeze({"editor-ui":Object.freeze(["no-data","no-save","no-snapshot","no-watch","no-undo"])}),zf=Object.freeze(["no-save","no-snapshot","no-trigger-autosave","no-dirty","no-watch","no-undo","no-data","freeze","editor-ui","live"]);function wt(e,t){if(!e||e.nodeType!==1)return!1;let r=e.getAttribute?.("clay");return!!(r&&r.split(/\s+/).includes(t)||e.hasAttribute?.(t))}function yn(e,t){if(wt(e,t))return!0;for(let[r,n]of Object.entries(Xc))if(n.includes(t)&&wt(e,r))return!0;return!1}function At(e){let t=mr[e];if(!t)throw new Error(`Unknown region capability: ${e}`);return[...t.tokens,...t.bundles].flatMap(r=>[`[clay~="${r}"]`,`[${r}]`]).join(", ")}function Jc(e,t){let r=e&&e.nodeType===1?e:e?.parentElement;for(;r&&r.nodeType===1;){let n=mr[t];if(!n)throw new Error(`Unknown region capability: ${t}`);if(n.tokens.some(i=>yn(r,i))||n.bundles.some(i=>wt(r,i)))return r;r=r.parentElement}return null}function ds(e,t){return!!Jc(e,t)}var Zc=/:(?:focus(?:-within|-visible)?|hover|active|visited|defined)\b/i;function Qc(e,t){if(!/^(INPUT|TEXTAREA|SELECT|OPTION)$/.test(e.tagName||""))return;let r=(e.getAttribute?.("type")||"").toLowerCase();"value"in e&&"value"in t&&e.tagName!=="OPTION"&&r!=="checkbox"&&r!=="radio"&&r!=="file"&&(t.value=e.value),e.tagName==="INPUT"&&(r==="checkbox"||r==="radio")&&(t.checked=e.checked),e.tagName==="OPTION"&&(t.selected=e.selected),"indeterminate"in e&&"indeterminate"in t&&(t.indeterminate=e.indeterminate)}function hs(e,t,r,n){if(n)return!!e.closest?.(t);let i=e;for(;i?.nodeType===1;){if(i.matches(t))return!0;if(i===r)break;i=i.parentElement}return!1}function ms(e,t,r,n,i,o){return(o?ds(e,t):hs(e,r,i,!1))||!!(n&&(o&&e!==i?e.matches(n):hs(e,n,i,o)))}function eu(e,t){let r=mr[t];return r.tokens.some(n=>yn(e,n))||r.bundles.some(n=>wt(e,n))}var tu=new Set(["INPUT","TEXTAREA","SELECT","OPTION"]);function fs(e,t,r,n){if(e.nodeType===1&&n(e)){r.dropped.push(t);return}r.cloneToLive.set(t,e),r.liveToClone.set(e,t);let i=e,o=t;if(e.nodeType===1){if(tu.has(e.tagName)&&r.controls.push(e,t),e.tagName==="TEMPLATE"){for(;t.firstChild;)t.removeChild(t.firstChild);i=e.content,o=t.content,r.cloneToLive.set(o,i),r.liveToClone.set(i,o)}}else if(e.nodeType!==11)return;let s=o.firstChild;for(let l=i.firstChild;l&&s;l=l.nextSibling)fs(l,s,r,n),s=s.nextSibling}function vn(e,{capability:t="data",exclude:r=null,inherit:n=!0,provenance:i=null}={}){if(!e)throw new TypeError("createContentView requires a DOM context");let o=e.nodeType===9?e:e.ownerDocument;if(!o?.implementation?.createHTMLDocument)throw new TypeError("createContentView requires an HTML DOM implementation");let s=o.implementation.createHTMLDocument(""),l=i||new WeakMap,a=new WeakMap,u=e.nodeType===9?e.documentElement:e;r&&s.documentElement.matches(r);let d=At(t),p=n?c=>eu(c,t)||!!(r&&c.matches(r)):c=>ms(c,t,d,r,u,!1),h=null;if(u.nodeType!==1||!ms(u,t,d,r,u,n)){h=s.importNode(u,!0);let c={cloneToLive:l,liveToClone:a,dropped:[],controls:[]};fs(u,h,c,p);for(let f of c.dropped)f.remove();for(let f=0;f<c.controls.length;f+=2)Qc(c.controls[f],c.controls[f+1])}e.nodeType===9&&h&&(s.replaceChild(h,s.documentElement),a.set(e,s),l.set(s,e));let m=c=>{if(Zc.test(c))throw new Error(`Filtered content queries do not support stateful selector: ${c}`)};return{root:h,document:s,capability:t,selector:At(t),cloneToLive:l,liveToClone:a,original(c){return l.get(c)||null},cloneOf(c){return a.get(c)||null},query(c,f=h){return m(c),Array.from(f.querySelectorAll(c),b=>l.get(b)||b)},text(c=h){return(c===h?h:a.get(c))?.textContent||""},html(c=h){return(c===h?h:a.get(c))?.innerHTML??""},clone(c=h){let f=c===h?h:a.get(c);return f?s.importNode(f,!0):null}}}import{morph as uu}from"./hyper-morph.vendor.js";var ru=[16,8,0],z=8,nu=4;function ps({anchor:e,bar:t,rail:r=t,viewport:n,current:i=null}){let o=h=>i===h?nu:0;if(e.bottom<=0||e.top>=n.height||e.right<=0||e.left>=n.width)return{mode:"hidden",x:0,y:0};let s=h=>Math.max(z,Math.min(e.left,n.width-h-z)),l=e.top-16-t.height;if(l>=z-o("above"))return{mode:"above",x:s(t.width),y:l};let a=e.bottom+16;if(a+t.height<=n.height-z+o("below"))return{mode:"below",x:s(t.width),y:a};let u=n.width-e.right-z,d=e.left-z,p=u>=d?[["rail-right",u],["rail-left",d]]:[["rail-left",d],["rail-right",u]];for(let[h,m]of p)for(let c of ru){if(r.width+c>m+o(h))continue;let f=h==="rail-right"?Math.min(e.right+c,n.width-r.width-z):Math.max(e.left-c-r.width,z),b=Math.min(e.bottom,n.height-z)-r.height,g=Math.max(z,Math.min(Math.max(e.top,z),b));return{mode:h,x:f,y:g,gap:c}}return{mode:"pinned",x:s(t.width),y:z}}function xn({anchor:e,handle:t,viewport:r,inset:n=6,prefer:i="auto"}){let o=e.height>=t.height*1.5&&e.width>=t.width*2;if(i==="corner"||o){let h=Math.max(z,Math.min(e.right-t.width+n,r.width-t.width-z)),m=Math.max(z,Math.min(e.top-n,r.height-t.height-z));return{x:h,y:m,mode:"over"}}let s=4,l=e.right+s+t.width<=r.width-z,a=l?e.right+s:e.left-s-t.width,u=Math.max(z,a),d=e.top+e.height/2-t.height/2,p=Math.max(z,Math.min(d,r.height-t.height-z));return{x:u,y:p,mode:l?"beside-right":"beside-left"}}var pr=!1;function gs(){if(pr)return;let e=D("onPrepareForSave");typeof e=="function"&&(e(t=>{ks(t),bs(t)}),pr=!0)}function bs(e){let t=e&&e.querySelector&&e.querySelector("body");t&&t.classList.remove("hcms-open","hcms-overlay","hcms-side-left",ar)}function ks(e){if(!(!e||typeof e.querySelectorAll!="function"))for(let t of e.querySelectorAll(`[${fe}]`)){let r=Fo(t);r!==null&&(t.innerHTML=r),t.removeAttribute(fe)}}var gr=!1;function br(){if(gr)return;let e=D("onSnapshot");typeof e=="function"&&(e(t=>{ks(t),Do(t,typeof window<"u"?window:null),bs(t)}),gr=!0)}function ys(){gs(),br(),(!pr||!gr)&&iu()}var fr=null;function iu(){if(fr||typeof document>"u")return;fr=Be(document,qo,()=>{gs(),br(),pr&&gr&&(fr?.(),fr=null)})}var ou={edit:"M8 10h2v6H8zm2 4h4v2h-4zm0-6h2v2h-2zm2-2h2v2h-2zm2-2h2v2h-2zm2-2h2v2h-2zm2 2h2v2h-2zm2 2h2v2h-2zm-2 2h2v2h-2zm-2 2h2v2h-2zm-2 2h2v2h-2zm-4 0h2v2h-2z","move-up":"M11 4h2v2h2v2h2v2h2v2h-4v-2h-2v10h-2V10H9v2H5v-2h2V8h2V6h2z","move-down":"M11 4h2v10h2v-2h4v2h-2v2h-2v2h-2v2h-2v-2H9v-2H7v-2H5v-2h4v2h2z",remove:"M5 5h3v3h3v3h2V8h3V5h3v3h-3v3h-3v2h3v3h3v3h-3v-3h-3v-3h-2v3H8v3H5v-3h3v-3h3v-2H8V8H5z",add:"M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z"};function Ce(e){let t=e==="edit"?"6 0 18 18":"0 0 24 24",r=e==="settings"?'<circle cx="6" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="18" cy="12" r="1.5"/>':`<path d="${ou[e]}"/>`;return`<svg class="hcms-inline-icon" xmlns="http://www.w3.org/2000/svg" viewBox="${t}" width="24" height="24" fill="currentColor" aria-hidden="true" focusable="false">${r}</svg>`}var vs="data-hcms-ghost",su=At("history");function lu(e){let t=e.container,r=null;for(;t&&(t.namespaceURI!=="http://www.w3.org/1999/xhtml"||["SELECT","OPTGROUP","DATALIST"].includes(t.tagName));)r=t,t=t.parentElement;return{parent:t,anchor:r}}function xs({doc:e,themeRoot:t,onAdd:r,onResize:n}){let i=e.defaultView,o=[],s=!1,l=null,a=new Map;function u(m,c,f){m.style[c]!==f&&(m.style[c]=f)}function d(){let m=new Set(o.map(c=>c.node.parentElement));for(let[c,f]of a)m.has(c)&&i?.Sortable?.get(c)===f.instance||(f.instance.option("draggable")===f.selector&&f.instance.option("draggable",f.original),a.delete(c));for(let c of m){let f=i?.Sortable?.get(c);if(!f)continue;let b=f.option("draggable");if(a.get(c)?.selector===b)continue;let g=b,v=`${g.trim().startsWith(">")?"> ":""}:is(${g.trim().replace(/^>\s*/,"")}):not(${su})`;f.option("draggable",v),a.set(c,{instance:f,original:g,selector:v})}}function p(){for(let m of o){let{node:c,slot:f,list:b}=m,g=b.items.filter(k=>k.isConnected).map(k=>k.getBoundingClientRect()).filter(k=>k.width>0&&k.height>0);g.length&&(m.width=g.reduce((k,v)=>k+v.width,0)/g.length,m.height=g.reduce((k,v)=>k+v.height,0)/g.length),u(c,"width",m.width?`${Math.round(m.width)}px`:"100%"),u(f,"height",`${Math.max(48,Math.round(m.height||64))}px`),f!==c&&(f.colSpan=Math.max(1,...b.items.map(k=>[...k.children].reduce((v,A)=>v+(A.colSpan||1),0)))),c.hidden!==s&&(c.hidden=s)}d()}function h(m,c){let f=c.tagName,b=["TBODY","THEAD","TFOOT","TABLE"].includes(f),g=e.createElement(b?"tr":["UL","OL","MENU"].includes(f)?"li":"div");for(let S of[vs,"data-hcms-shell","editor-ui","no-watch","no-save","save-remove","snapshot-remove"])g.setAttribute(S,"");g.setAttribute("draggable","false"),g.setAttribute("contenteditable","false"),g.className="hcms-shell pixel-quiet hcms-inline-ghost";for(let S of["light","dark"])g.classList.toggle(S,!!t?.classList.contains(S));let k=b?e.createElement("td"):g;k!==g&&(k.className="hcms-inline-ghost-cell",g.appendChild(k));let v=e.createElement("button");v.type="button",v.className="hcms-inline-list-button hcms-inline-list-add mirk-button mirk-button--small",v.setAttribute("data-hcms-list-action","add"),v.innerHTML=`<span class="mirk-button__label">${Ce("add")}<span>Add</span></span>`,k.appendChild(v);let A={node:g,slot:k,button:v,list:m,width:0,height:0};v.addEventListener("click",S=>{S.preventDefault(),S.stopPropagation(),r(A.list)});for(let S of["pointerdown","mousedown","touchstart","click"])g.addEventListener(S,E=>E.stopPropagation());return g.addEventListener("dragstart",S=>{S.preventDefault(),S.stopPropagation()}),A}return{setLists(m){let c=new Set(o),f=[],b=new Set(o.map(k=>k.node)),g=new Set;for(let k of m||[]){if(!k.container||!k.container.isConnected)continue;let{parent:v,anchor:A}=lu(k);if(!v)continue;if(!g.has(v)){for(let O of v.querySelectorAll(`:scope > [${vs}]`))b.has(O)||O.remove();g.add(v)}let S=o.find(O=>c.has(O)&&O.list.container===k.container&&O.list.path.join(".")===k.path.join("."))||h(k,v);c.delete(S),S.list=k,S.button.setAttribute("data-hcms-list",k.path.join(".")),S.button.setAttribute("aria-label",`Add to ${k.path.join(".")||"the list"}`);let E=A||k.items.filter(O=>O.parentElement===v).at(-1);E?E.nextSibling!==S.node&&E.after(S.node):S.node.parentElement!==v&&v.appendChild(S.node),f.push(S)}for(let k of c)k.node.remove();o=f,l?.disconnect(),!l&&typeof i?.ResizeObserver=="function"&&(l=new i.ResizeObserver(()=>{p(),n?.()}));for(let k of o)for(let v of k.list.items)l?.observe(v);p()},update:p,setHidden(m){s=!!m,p()},destroy(){l?.disconnect();for(let m of o)m.node.remove();o=[],d()}}}var ws=[["move-up","Move up"],["move-down","Move down"]],au={prefer:"corner",inset:0};function cu(e,t){return t.width<=e.width&&t.height<=e.height}function As({doc:e,layerEl:t,onActivate:r,onListAction:n,onStyle:i}){let o=e.defaultView,s=[],l=new Map,a=0,u=new Map,d=null,p=new Set,h=0,m=!1,c=null,f=null,b=null,g=null,k=new Map,v=!1,A=null,S=xs({doc:e,themeRoot:t.closest("[data-hcms-shell]"),onResize:O,onAdd:y=>n?.({action:"add",list:y,index:y.items.length})}),E=e.createElement("div");E.className="hcms-inline-highlight",E.hidden=!0,E.setAttribute("aria-hidden","true"),t.appendChild(E);function O(){if(!(h||!o)){if(typeof o.requestAnimationFrame!="function")return ce();h=o.requestAnimationFrame(()=>{h=0,ce()})}}let B=()=>b||g;function ce(){if(!o)return;S.update();let y={width:o.innerWidth,height:o.innerHeight},x=B();for(let w of s){if(!w.visible){w.node.hidden=!0;continue}for(let C of w.members)C.node.hidden=v&&C.kind!=="handle";w.node.hidden=!1;let T=w.el.getBoundingClientRect(),_=w.node.getBoundingClientRect(),L=_.width,N=w.kind==="row"&&!cu(T,_);if(N&&w.el!==x){for(let C of w.members)C.kind==="row"&&(C.node.hidden=!0);_=w.node.getBoundingClientRect()}if(w.members.every(C=>C.node.hidden)){w.node.hidden=!0;continue}if(w.kind==="style"){let C=Math.max(8,Math.min(T.left,y.width-_.width-8)),P=Math.max(8,Math.min(T.top,y.height-_.height-8));w.node.style.transform=`translate(${Math.round(C)}px, ${Math.round(P)}px)`;continue}let W=w.kind==="handle"?null:au,{x:M,y:Z}=xn({anchor:T,handle:_,viewport:y,...W}),Oe=w.members.find(C=>C.kind==="handle");if(N&&Oe){let C=Oe.node.getBoundingClientRect(),P=xn({anchor:T,handle:C,viewport:y}),j=w.members.slice(w.members.indexOf(Oe)+1).filter(Ar=>!Ar.node.hidden).reduce((Ar,ol)=>Ar+ol.node.getBoundingClientRect().width+2,0);M=Math.max(8+L,Math.min(y.width-8,P.x+C.width+j))-_.width,Z=P.y}w.node.style.transform=`translate(${Math.round(M)}px, ${Math.round(Z)}px)`}if(A)if(!A.node.isConnected||A.node.closest("[hidden]"))Y();else{let w=A.button.getBoundingClientRect(),T=A.menu.getBoundingClientRect();A.menu.style.left=`${Math.max(8,w.right-T.width)-w.left}px`,A.menu.style.right="auto",A.menu.style.top=w.bottom+6+T.height>y.height-8?"auto":"calc(100% + 6px)",A.menu.style.bottom=w.bottom+6+T.height>y.height-8?"calc(100% + 6px)":"auto"}rt(),c?.()}function K(y){if(y?.closest?.("[data-hcms-ghost]"))return null;for(let x=y;x&&x.nodeType===1;x=x.parentElement){let w=k.get(x);if(w)return w}return null}function ke(y){A&&!A.node.contains(y.target)&&Y();let x=B();g=K(y.target),g&&t.contains(y.target)&&(b=null),B()!==x&&O()}function tt(y){if(y.relatedTarget||!g)return;let x=B();g=null,B()!==x&&O()}function rt(){if(!f||E.hidden)return;let y=f.getBoundingClientRect();E.style.width=`${Math.round(y.width)}px`,E.style.height=`${Math.round(y.height)}px`,E.style.transform=`translate(${Math.round(y.left)}px, ${Math.round(y.top)}px)`}function Ws(){if(!o||typeof o.IntersectionObserver!="function"){for(let x of s)x.visible=!0;return}d||(d=new o.IntersectionObserver(x=>{let w=!1;for(let T of x)for(let _ of l.get(T.target)||[])_.visible!==T.isIntersecting&&(_.visible=T.isIntersecting,w=!0);w&&O()},{threshold:0}));let y=new Set(l.keys());for(let x of p)y.has(x)||d.unobserve(x);for(let x of y)p.has(x)||d.observe(x);p=y}function Ks(){m||!o||(o.addEventListener("scroll",O,{passive:!0,capture:!0}),o.addEventListener("resize",O,{passive:!0}),e.addEventListener("focusin",ke),e.addEventListener("focusout",tt),e.addEventListener("pointerdown",Dn,!0),e.addEventListener("keydown",zn,!0),m=!0)}function Gs(){!m||!o||(o.removeEventListener("scroll",O,{capture:!0}),o.removeEventListener("resize",O),e.removeEventListener("focusin",ke),e.removeEventListener("focusout",tt),e.removeEventListener("pointerdown",Dn,!0),e.removeEventListener("keydown",zn,!0),m=!1)}function qn(y){return`${y.kind}\0${y.attr||""}`}function Pn(y,x){return y.container===x.container&&y.scalar===x.scalar}function Ys(y,x){return y.kind!==x.kind?!1:y.kind==="style"?!0:y.kind==="handle"?qn(y.target)===qn(x.target):y.kind==="row"?y.row===x.row&&Pn(y.list,x.list):Pn(y.list,x.list)}function In(y,x){y.target=x;let w=x.path.join(".");y.node.setAttribute("data-hcms-target",w),x.icon?y.node.setAttribute("data-hcms-icon",x.icon):y.node.removeAttribute("data-hcms-icon"),y.node.setAttribute("aria-label",`Edit ${w}`)}function Xs(y){let x=e.createElement("button");x.type="button",x.className="hcms-inline-handle mirk-button mirk-button--small",x.innerHTML=`<span class="mirk-button__label">${Ce("edit")}</span>`;let w={node:x,kind:"handle",target:y};return In(w,y),x.addEventListener("click",T=>{T.preventDefault(),T.stopPropagation(),r?.(w.target,x)}),w}function Js(y){let x=e.createElement("button");x.type="button",x.className="hcms-inline-style-chip mirk-button mirk-button--small",x.setAttribute("aria-label","Edit style"),x.innerHTML='<span class="mirk-button__label">Style</span>';let w={node:x,kind:"style",group:y.group};return x.addEventListener("click",T=>{T.preventDefault(),T.stopPropagation(),i?.(w.group,x)}),w}function Fn(y,x){let w=e.createElement("button");return w.type="button",w.className="hcms-inline-list-button mirk-button mirk-button--small",w.setAttribute("data-hcms-list-action",y),w.setAttribute("aria-label",x),w.innerHTML=`<span class="mirk-button__label">${Ce(y)}${y==="add"?"<span>Add</span>":""}</span>`,w}function $n(y,{list:x,row:w,rowIndex:T,count:_}){let L=x.path.join(".");y.list=x,y.row=w,y.index=T,y.count=_,y.node.setAttribute("data-hcms-list",L),y.node.setAttribute("data-hcms-row",String(T));for(let N of y.node.querySelectorAll("[data-hcms-list-action]")){let W=N.getAttribute("data-hcms-list-action"),M=ws.find(([Z])=>Z===W)?.[1]||W;N.setAttribute("aria-label",`${M} ${L}.${T}`),N.disabled=W==="move-up"&&T===0||W==="move-down"&&T===_-1}}function Zs(y,x,w,T){let _=e.createElement("div");_.className="hcms-inline-row-controls";let L={node:_,kind:"row",list:y,row:x,index:w,count:T};for(let[N,W]of ws){let M=Fn(N,W);M.addEventListener("click",Z=>{Z.preventDefault(),Z.stopPropagation(),!M.disabled&&n?.({action:N,list:L.list,index:L.index,row:L.row})}),_.appendChild(M)}return $n(L,{list:y,row:x,rowIndex:w,count:T}),L}function Y(y=!1){if(!A)return;let x=A;A=null,x.menu.hidden=!0,x.button.setAttribute("aria-expanded","false"),x.node.parentElement?.classList.remove("has-open-settings"),y&&x.button.isConnected&&x.button.focus({preventScroll:!0})}function Dn(y){A&&!A.node.contains(y.target)&&Y()}function zn(y){if(A){if(y.key==="Escape")y.preventDefault(),y.stopPropagation(),Y(!0);else if(y.key==="Tab")Y(!0);else if(["ArrowDown","ArrowUp","Home","End"].includes(y.key)&&A.menu.contains(y.target)){y.preventDefault();let x=[...A.menu.querySelectorAll('[role="menuitem"]')],w=x.indexOf(y.target),T=y.key==="Home"?0:y.key==="End"?x.length-1:w===-1?0:(w+(y.key==="ArrowDown"?1:-1)+x.length)%x.length;x[T]?.focus({preventScroll:!0})}}}function Un(y,{list:x,row:w,rowIndex:T,style:_=null}){Object.assign(y,{list:x,row:w,index:T,style:_}),y.node.setAttribute("data-hcms-list",x.path.join(".")),y.node.setAttribute("data-hcms-row",String(T)),y.button.setAttribute("aria-label",`Settings ${x.path.join(".")}.${T}`),_&&!y.styleItem.isConnected?y.menu.insertBefore(y.styleItem,y.menu.firstChild):_||y.styleItem.remove()}function Qs(y){let x=e.createElement("div");x.className="hcms-inline-settings";let w=Fn("settings","Settings");w.setAttribute("aria-haspopup","menu"),w.setAttribute("aria-expanded","false");let T=e.createElement("div");T.className="hcms-inline-settings-menu",T.setAttribute("role","menu"),T.setAttribute("aria-label","Item settings"),T.hidden=!0;let _=e.createElement("button");_.type="button",_.setAttribute("role","menuitem"),_.setAttribute("data-hcms-style-action",""),_.textContent="Style";let L=e.createElement("button");L.type="button",L.setAttribute("role","menuitem"),L.setAttribute("data-hcms-list-action","remove"),L.textContent="Delete",T.appendChild(L),x.append(w,T);let N={node:x,button:w,menu:T,styleItem:_,kind:"settings"};Un(N,y);let W=()=>{Y(),A=N,T.hidden=!1,w.setAttribute("aria-expanded","true"),x.parentElement.classList.add("has-open-settings"),T.querySelector('[role="menuitem"]').focus({preventScroll:!0}),O()};return w.addEventListener("click",M=>{M.preventDefault(),M.stopPropagation(),A===N?Y(!0):W()}),w.addEventListener("keydown",M=>{(M.key==="ArrowDown"||M.key==="ArrowUp")&&(M.preventDefault(),W())}),L.addEventListener("click",M=>{M.preventDefault(),M.stopPropagation(),Y(!0),n?.({action:"remove",list:N.list,index:N.index,row:N.row})}),_.addEventListener("click",M=>{M.preventDefault(),M.stopPropagation(),Y(),i?.(N.style,N.button)}),N}function el(y,x){y.kind==="handle"?In(y,x.target):y.kind==="row"?$n(y,x):y.kind==="settings"?Un(y,x):y.kind==="style"&&(y.group=x.group)}function Tt(y,x,w,T,_){let L=x.get(w)?.find(N=>N.category===_);if(!L){L={el:w,category:_,members:[]},y.push(L);let N=x.get(w);N?N.push(L):x.set(w,[L])}L.members.push(T)}function tl(y,x,w,T){let _=w.items||[];_.forEach((L,N)=>{Qe(L)&&(Tt(y,x,L,{kind:"row",list:w,row:L,rowIndex:N,count:_.length},"item"),Tt(y,x,L,{kind:"settings",list:w,row:L,rowIndex:N,style:T.get(L)||null},"item"))})}function rl(y,x){let w=new Set(y.members),T=[];for(let _ of x){let L=y.members.find(N=>w.has(N)&&Ys(N,_))||(_.kind==="handle"?Xs(_.target):_.kind==="row"?Zs(_.list,_.row,_.rowIndex,_.count):_.kind==="style"?Js(_):Qs(_));w.delete(L),el(L,_),v&&L.kind!=="handle"&&(L.node.hidden=!0),T.push(L)}for(let _ of w)_===A&&Y(),_.node.remove();T.sort((_,L)=>["row","handle","settings"].indexOf(_.kind)-["row","handle","settings"].indexOf(L.kind)),T.forEach((_,L)=>{y.node.children[L]!==_.node&&y.node.insertBefore(_.node,y.node.children[L]||null)}),y.members=T}function nl(y,x,w){let T=[],_=new Map,L=new Map,N=0;for(let C of y||[])C.style||(L.has(C.el)||L.set(C.el,C),!(C.kind!=="handle"||!Qe(C.el))&&(Tt(T,_,C.el,{kind:"handle",target:C},"item"),N++));let W=new Map;for(let C of w||[])C.scope==="row"?W.set(C.el,C):C.scope==="section"&&Qe(C.el)&&Tt(T,_,C.el,{kind:"style",group:C},"style");for(let C of x||[])tl(T,_,C,W);let M=new Set(s),Z=new Map;for(let C of s)Z.has(C.el)||Z.set(C.el,C.visible);let Oe=[];for(let C of T){let P=s.find(j=>M.has(j)&&j.el===C.el&&j.category===C.category);if(!P){let j=e.createElement("div");j.className="hcms-inline-item-controls",j.setAttribute("role","group"),P={el:C.el,node:j,category:C.category,kind:C.category==="add"?"add":"handle",members:[],visible:Z.get(C.el)??!1},t.appendChild(j)}M.delete(P),P.el=C.el,P.category=C.category,rl(P,C.members),P.kind=P.members.some(j=>j.kind==="row")?"row":P.members.some(j=>j.kind==="handle")?"handle":P.members.some(j=>j.kind==="style")?"style":"add",P.node.setAttribute("aria-label",P.category==="add"?"List controls":P.category==="style"?"Style controls":"Item controls"),Oe.push(P)}for(let C of M)C.node.remove();s=Oe,l=new Map,k=new Map;for(let C of s){let P=l.get(C.el);P?P.push(C):l.set(C.el,[C]);for(let j of C.members)j.kind!=="row"&&j.kind!=="settings"||(k.set(j.row,j.row),k.set(j.node,j.row),k.set(C.node,j.row))}b&&!k.has(b)&&(b=null),g&&!k.has(g)&&(g=null),u=L,a=N}function il(){Y(),d?.disconnect(),d=null,p=new Set;for(let y of s)y.node.remove();s=[],l=new Map,u=new Map,k=new Map,a=0}return{setTargets(y,x,w=[]){nl(y,x,w),S.setLists(x),Ws(),Ks(),O()},refresh:O,get count(){return a},get controlsHidden(){return v},setControlsHidden(y){if(v=!!y,S.setHidden(v),v){Y();for(let x of s){for(let w of x.members)w.kind!=="handle"&&(w.node.hidden=!0);x.members.every(w=>w.node.hidden)&&(x.node.hidden=!0)}}O()},elementToTarget(y){if(y?.closest?.("[data-hcms-ghost]"))return null;for(let x=y;x&&x.nodeType===1;x=x.parentElement){let w=u.get(x);if(w)return w}return null},setHoveredRow(y){let x=B();b=y?K(y):null,B()!==x&&O()},showHighlight(y){y&&(f=y,E.hidden=!1,rt())},hideHighlight(){f=null,E.hidden=!0},setFollower(y){c=typeof y=="function"?y:null},destroy(){S.destroy(),h&&o&&o.cancelAnimationFrame(h),h=0,c=null,f=null,b=null,g=null,E.remove(),Gs(),il()}}}var du="hypercms-inline",et="is-hcms-inline-active",An="is-hcms-inline-onpath",Ss='input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])',hu=["bold","italic","link","undo","redo"],mu=/^H[1-6]$/,fu=0;function Cs({doc:e,pageRoot:t,opts:r={}}){let n=r.richText!==!1,i=null,o=null,s=null,l=new Map,a=null,u=null,d=[],p=null;function h(m,c,f,b,g){let k=He(e.defaultView);if(typeof k!="function")return null;let v=g||{},A=v.originalHTML??vn(c,{capability:"history"}).html(),S=v.richClayIsOurs??!c.hasAttribute("data-richclay"),E=v.adopted??c.getAttribute("data-richclay-active")==="true",O=St(c,b,"history"),B=pu(m,k,c,b,S);if(!B)return null;$o(c,b==="innerHTML",S);let ce=String(++fu);c.setAttribute(fe,ce),br();let K={el:c,editor:B,path:f,prop:b,boundId:ce,originalHTML:A,oldValue:O,richClayIsOurs:S,adopted:E,dirty:!1,written:!1,restorable(){return!this.adopted&&!this.dirty&&!this.written},lastEdited:void 0};l.set(c,K),Po(ce,K);let ke=B.squire;if(ke&&typeof ke.addEventListener=="function"){let rt=()=>{K.dirty=!0,K.lastEdited=St(c,K.prop,"history"),gu(m,K)};ke.addEventListener("input",rt),K.detachInput=()=>ke.removeEventListener?.("input",rt)}let tt=()=>Os(K);return c.addEventListener("blur",tt),K.detachBlur=()=>c.removeEventListener("blur",tt),K}return{name:"inline",richText:n,ctx:null,root:null,formRoot:null,errorEl:null,noticeEl:null,handoffEl:null,handoffCountEl:null,popEl:null,enhanceFormRichText:!1,prepareRules(m){return n?Bo(m,t):m},bindText(m,c,f,b){return h(this.ctx,m,c,f,b)},mount(m){let c=this.ctx;i=vu(e,r.theme),this.root=i.root,this.formRoot=i.formRoot,this.errorEl=i.errorEl,this.noticeEl=i.noticeEl,this.handoffEl=i.handoffEl,this.handoffCountEl=i.handoffCountEl,this.popEl=i.popEl,ae(()=>xt(e));let f=ze({pageRules:c.pageRules,formRules:c.formRules,data:m,doc:e});i.formRoot.appendChild(f),c.seeder.seed(i.formRoot),pe(i.formRoot,e,this.enhanceFormRichText),Ze(c),nr(c),o=As({doc:e,layerEl:i.layerEl,onActivate:(b,g)=>this.activate(b,g),onListAction:b=>this.listAction(b),onStyle:(b,g)=>this.openStyle(b,g)}),o.setFollower(()=>this.placePopover()),i.closeEl.addEventListener("click",()=>this.deactivate()),i.toggleEl.addEventListener("click",b=>{b.preventDefault(),b.stopPropagation(),this.toggleControls()}),i.pageStyleEl.addEventListener("click",b=>{b.preventDefault(),b.stopPropagation();let g=d.find(k=>k.scope==="page");g&&this.openStyle(g,i.pageStyleEl)}),i.handoffEl.querySelector("[data-hcms-open-view]").addEventListener("click",b=>{b.preventDefault(),b.stopPropagation(),c.onViewRequested?.("sidebar")}),this.bindPage(),this.syncTargets()},listAction({action:m,list:c,index:f,row:b}){let g=this.ctx,k=c.path.join("."),v=g.formRoot.querySelector(`[data-hcms-path="${Te(k)}"]`);if(!v)return;if(m==="add"){yt(k,g);return}let A=b?wu(g,k,b):f;if(A===-1)return;let S=xu(v,A);if(S){if(m==="remove"){an(S,g),this.syncTargets();return}ln(S,m==="move-up"?-1:1,g),this.syncTargets()}},toggleControls(){if(!o||!i)return;let m=!o.controlsHidden;o.setControlsHidden(m),i.toggleEl.setAttribute("aria-pressed",String(m));let c=i.toggleEl.querySelector(".mirk-button__label");c&&(c.textContent=m?"Show controls":"Hide controls")},bindPage(){let m=Q(this.ctx.pageRoot),c=i.root,f=S=>{let E=o&&o.elementToTarget(S.target);E?o.showHighlight(E.el):o?.hideHighlight(),o?.setHoveredRow(S.target)},b=()=>{o?.hideHighlight(),o?.setHoveredRow(null)},g=S=>{if(c.contains(S.target))return;let E=o&&o.elementToTarget(S.target);!E||E.kind!=="text"||l.has(E.el)||h(this.ctx,E.el,E.path.join("."),yr(E))},k=S=>{if(c.contains(S.target))return;let E=o&&o.elementToTarget(S.target);if(!E){this.deactivate();return}(typeof S.target.closest=="function"&&S.target.closest("a[href]")||E.kind!=="text")&&S.preventDefault(),this.activate(E)},v=S=>{S.key==="Escape"&&this.deactivate()},A=S=>{let E=S.detail;if(!(!E||E.pageRoot!==Q(this.ctx.pageRoot)||!E.path))for(let O of l.values())O.path===E.path&&(O.written=!0)};m.addEventListener("pointerover",f),m.addEventListener("pointerleave",b),m.addEventListener("pointerdown",g),m.addEventListener("click",k),c.addEventListener("keydown",v),e.addEventListener("hcms:change",A),s=()=>{m.removeEventListener("pointerover",f),m.removeEventListener("pointerleave",b),m.removeEventListener("pointerdown",g),m.removeEventListener("click",k),c.removeEventListener("keydown",v),e.removeEventListener("hcms:change",A)}},activate(m,c){if(!m||!i||m.kind==="text"&&this.activateText(m))return;let f=Es(this,i,m.path.join("."));if(!f){this.deactivate();return}a=m,u=c||null,p=null,i.popTitleEl.textContent="Edit content",i.popEl.hidden=!1,i.formRoot.querySelectorAll(`.${et}`).forEach(wn),this.placePopover(),Ts(f)},openStyle(m,c){if(!m||!i)return;let f=_s(this,i,m.paths);if(!f){this.deactivate();return}a={kind:"style",scope:m.scope,el:m.scope==="page"?i.pageStyleEl:m.el,path:m.paths[0].split("."),paths:m.paths},u=c||null,p=null,i.popTitleEl.textContent=m.scope==="page"?"Page style":"Style",i.popEl.hidden=!1,i.formRoot.querySelectorAll(`.${et}`).forEach(wn),this.placePopover(),Ts(f)},activateText(m){let c=m.el,f=l.get(c);if(f)return kr(f),!0;let b=h(this.ctx,c,m.path.join("."),yr(m));return b?(kr(b),!0):!1},placePopover(){if(!i||!a||i.popEl.hidden)return;let m=e.defaultView;if(!m)return;let c={width:m.innerWidth,height:m.innerHeight},f=a.el.getBoundingClientRect(),b=i.popEl.getBoundingClientRect(),{mode:g,x:k,y:v}=ps({anchor:f,bar:b,viewport:c,current:p});p=g,i.popEl.style.transform=`translate(${Math.round(k)}px, ${Math.round(v)}px)`},deactivate(){if(!i||!a&&i.popEl.hidden)return;i.popEl.hidden=!0,Sn(i.root);let m=u;if(a=null,u=null,p=null,m&&e.contains(m)&&typeof m.focus=="function")try{m.focus({preventScroll:!0})}catch{m.focus()}},syncTargets(){if(!o)return;let m=this.ctx,c=kn(m.pageRoot,m.pageRules,e),f=c.lists,b=c.targets.filter(v=>!v.style);d=us(c.targets,f),i.pageStyleEl.hidden=!d.some(v=>v.scope==="page"),o.setTargets(c.targets,f,d);let g=bu(this,l,b,e);if(a?.kind==="style"){let v=a.scope==="page"?d.find(A=>A.scope==="page"):d.find(A=>A.el===a.el);v?a={...a,paths:v.paths,path:v.paths[0].split(".")}:this.deactivate()}else if(a){let v=g.get(a.el)||[],A=v.find(S=>ku(S,a))||v.find(S=>S.path.join(".")===a.path.join("."))||(v.length===1?v[0]:null);A?a=A:this.deactivate()}yu(this.ctx,l,e);let k=b.reduce((v,A)=>v+(Qe(A.el)?0:1),0);this.handoffEl&&(this.handoffCountEl.textContent=k===0?"":`${k} ${k===1?"field isn't":"fields aren't"} visible right now.`,this.handoffEl.hidden=k===0)},refresh(m,c){m==="livesync"?(Xe(e),xt(e),be(this.ctx,{ignoreActiveValue:!0})):m==="undo"?be(this.ctx,{ignoreActiveValue:!1}):be(this.ctx),this.syncTargets(),(m==="livesync"||m==="undo")&&this.rebindText(m),this.restoreActive()},rebindText(m){let c=m!=="undo";for(let[f,b]of[...l]){if(!e.contains(f)){Et(this.ctx,b,{restore:!1,record:c}),l.delete(f);continue}if(f.hasAttribute(te)){let v=St(f,b.prop);v!==b.lastEdited&&(b.oldValue=v,b.lastEdited=void 0);continue}let g=e.activeElement===f;Et(this.ctx,b,{restore:!1,record:c}),l.delete(f);let k=h(this.ctx,f,b.path,b.prop,{richClayIsOurs:b.richClayIsOurs,adopted:b.adopted});k&&g&&kr(k)}},restoreActive(){if(!i||!a||i.popEl.hidden)return;if(!e.contains(a.el)){this.deactivate();return}if(!(a.kind==="style"?_s(this,i,a.paths):Es(this,i,a.path.join(".")))){this.deactivate();return}i.formRoot.querySelectorAll(`.${et}`).forEach(wn),this.placePopover()},focusOnOpen(){if(this.root&&typeof this.root.focus=="function")try{this.root.focus({preventScroll:!0})}catch{this.root.focus()}},destroy(){u=null,this.deactivate();for(let m of l.values())Et(this.ctx,m);l.clear(),s?.(),s=null,o?.destroy(),o=null,i?.destroy(),i=null,mn(e),this.popEl=null,this.handoffEl=null,this.handoffCountEl=null}}}function pu(e,t,r,n,i){return ae(()=>{let o=null;try{o=new t(r,{inline:!0,hyperclay:!1,toolbar:n==="innerHTML"?hu:!1,...mu.test(r.tagName)?{singleLine:!0}:null})}catch(s){return console.warn("[hypercms] richclay activation failed; the field falls back to the popover",s),null}if(o.unsupported||!o.active){if(i)try{o.destroy()}catch{}return null}return typeof o.reattach=="function"&&o.reattach(),o})}function gu(e,{path:t,el:r,prop:n}){let i=ir(e.formRoot,t);i&&(or(i,St(r,n),e.formRoot,t),G(V(e),{path:t,structural:!1},e))}function St(e,t,r="data"){let n=vn(e,{capability:r});return t==="innerHTML"?n.html():n.text().trim()}function Os(e){let{el:t,prop:r,oldValue:n,lastEdited:i}=e,o=i;if(o===void 0||o===n)return;e.oldValue=o;let s=D("undo");if(!s||typeof s.recordValue!="function")return;let l={prop:r,oldValue:n,newValue:o,read:a=>St(a,r,"history"),write:(a,u)=>Rs(a,r,u)};s.isPaused?queueMicrotask(()=>{t.isConnected&&s.recordValue(t,l)}):s.recordValue(t,l)}function Rs(e,t,r){let n=e.cloneNode(!1);t==="innerHTML"?n.innerHTML=r:n.textContent=r,uu(e,Array.from(n.childNodes),{morphStyle:"innerHTML",policy:"history",restoreFocus:!1,scripts:{handle:!1,merge:!1}})}function Et(e,t,{restore:r=!0,record:n=!0}={}){n&&Os(t),t.detachInput?.(),t.detachBlur?.(),ae(()=>{if(!t.adopted){try{t.editor.destroy()}catch(i){console.warn("[hypercms] richclay teardown failed; editor state may reach the save",i)}t.richClayIsOurs&&t.el.removeAttribute("data-richclay")}t.el.removeAttribute(te),t.el.removeAttribute(Ee),t.el.removeAttribute(fe),Io(t.boundId),r&&t.restorable()&&Rs(t.el,"innerHTML",t.originalHTML)})}function kr(e){let{editor:t,el:r}=e;if(r.ownerDocument.activeElement!==r)try{typeof t.focus=="function"?t.focus():r.focus()}catch{}}function bu(e,t,r,n){let i=new Map;for(let o of r){let s=i.get(o.el);s?s.push(o):i.set(o.el,[o])}for(let[o,s]of[...t]){let l=i.get(o)||[],a=l.find(h=>yr(h)===s.prop)||l[0];if(!a){Et(e.ctx,s,{restore:!0}),t.delete(o);continue}s.path=a.path.join(".");let u=yr(a);if(u===s.prop)continue;let d=n.activeElement===o;Et(e.ctx,s,{restore:!1}),t.delete(o);let p=e.bindText(o,s.path,u,{richClayIsOurs:s.richClayIsOurs,adopted:s.adopted,originalHTML:s.originalHTML});p&&d&&kr(p)}return i}function ku(e,t){return e.el===t.el&&e.kind===t.kind&&e.attr===t.attr}function yr(e){return e.attr==="innerHTML"?"innerHTML":"textContent"}function yu(e,t,r){for(let n of e.pageRoot.querySelectorAll(`[${te}]`))t.has(n)||ae(()=>zo(n,r.defaultView))}function Es(e,t,r){let n=e.formRoot&&e.formRoot.querySelector(`[data-hcms-path="${Te(r)}"]`);if(Sn(t.root),!n)return null;let i=n.closest("[data-hcms-card]"),o=i?[...i.querySelectorAll('[data-hcms-shape="scalar"][data-hcms-path]')].filter(s=>s.closest("[data-hcms-card]")===i&&s.closest('[data-hcms-shape="object-array"], [data-hcms-shape="scalar-array"]')===i.parentElement.closest('[data-hcms-shape="object-array"]')):[n];o.includes(n)||o.push(n);for(let s of o)Ls(e,s);return n}function _s(e,t,r){Sn(t.root);let n=null;for(let i of r){let o=e.formRoot&&e.formRoot.querySelector(`[data-hcms-path="${Te(i)}"]`);o&&(n=n||o,Ls(e,o))}return n}function Ls(e,t){t.classList.add(et),t.removeAttribute("draggable");for(let r=t.parentElement;r&&(r.classList.add(An),r.removeAttribute("draggable"),r!==e.formRoot);r=r.parentElement);}function Sn(e){if(e)for(let t of e.querySelectorAll(`.${et}, .${An}`))t.classList.remove(et,An)}function wn(e){e.tagName==="TEXTAREA"&&Ve(e),e.querySelectorAll?.("textarea").forEach(Ve)}function Ts(e){let t=e.matches?.(Ss)?e:e.querySelector?.(Ss);if(!(!t||typeof t.focus!="function"))try{t.focus({preventScroll:!0})}catch{t.focus()}}function vu(e,t){Xe(e);let r=e.createElement(du),n=t==="dark"?" dark":t==="light"?" light":"";return r.className="hcms-shell pixel-quiet hcms-inline"+n,r.setAttribute("data-hcms-shell",""),r.setAttribute("editor-ui",""),r.setAttribute("no-save",""),r.setAttribute("save-remove",""),r.setAttribute("snapshot-remove",""),r.setAttribute("no-watch",""),r.setAttribute("tabindex","-1"),r.innerHTML=`
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
          <span class="mirk-button__label">${Ce("remove")}</span>
        </button>
      </div>
      <div data-hcms-form-root class="hcms-form"></div>
    </div>
  `,e.body.appendChild(r),{root:r,formRoot:r.querySelector("[data-hcms-form-root]"),noticeEl:r.querySelector(".hcms-inline-notice"),errorEl:r.querySelector(".hcms-inline-error"),handoffEl:r.querySelector(".hcms-inline-handoff"),handoffCountEl:r.querySelector(".hcms-inline-handoff-count"),layerEl:r.querySelector(".hcms-inline-layer"),popEl:r.querySelector(".hcms-inline-pop"),closeEl:r.querySelector(".hcms-inline-pop-close"),toggleEl:r.querySelector("[data-hcms-controls-toggle]"),pageStyleEl:r.querySelector("[data-hcms-page-style-open]"),popTitleEl:r.querySelector(".hcms-inline-pop-title"),destroy(){r.remove()}}}function xu(e,t){let r=e.querySelector(".hcms-array-items");return r&&r.querySelectorAll(":scope > [data-hcms-card], :scope > [data-hcms-array-item]")[t]||null}function wu(e,t,r){let{lists:n}=kn(e.pageRoot,e.pageRules),i=n.find(o=>o.path.join(".")===t);return i?i.items.indexOf(r):-1}var Au="[hypercms]";function Ns(e,t){if(!e||!e.querySelectorAll||!t)return;let r=Su(t);e.querySelectorAll("template[data-hcms-tpl]").forEach(i=>{let o=i.getAttribute("data-hcms-tpl");o&&(o.startsWith("@")||r.has(o)||console.warn(`${Au} template "${o}" doesn't match any rule path; ignored`))})}function Su(e){let t=new Set;return r([],e),t;function r(n,i){let o=n.join("."),s=n.map(a=>typeof a=="number"?"*":a).join(".");o&&t.add(o),s&&t.add(s);let l=me(i);if(l==="object")for(let[a,u]of Object.entries(i))r([...n,a],u);else if(l==="object-array"||l==="scalar-array"){let a=[...n,"*"],u=a.map(d=>typeof d=="number"?"*":d).join(".");if(t.add(u),l==="object-array"){let d=i[1];if(d&&typeof d=="object"&&!Array.isArray(d))for(let[p,h]of Object.entries(d))r([...a,p],h)}}}}var En={skip:"[data-hcms-shell]",templateAttr:"cms-template"},R={isOpen:!1,ctx:null,opts:null};function js({view:e,doc:t,pageRoot:r,opts:n={},onCloseRequested:i,onViewRequested:o}){let s=n.rules!==void 0?n.rules:"cms",l=U.findRules(t,s);if(!l){let b=typeof s=="string"?`data-rules-name~="${s}"`:"the provided rules object";throw new Error(`hypercms: no rules found for ${b}`)}let a=e.prepareRules(Pt(l.rules,r)),u=l.tagNode;$t(t),Bt(t,a),Ns(t,a);let d=Wt(a,t),p=dr(a),h=ur(r,a),m=qt(),c=le(U.extract(r,a,{...En,...m.hooks}),a),f={doc:t,pageRoot:r,pageRules:a,writeRules:p,formRules:d,rulesTagNode:u,rulesSource:s,richText:e.richText,view:e,seeder:m,initialData:c,get formRoot(){return e.formRoot},get shellRoot(){return e.root},get errorEl(){return e.errorEl},get noticeEl(){return e.noticeEl},unresolved:h,lastTwinSignature:null,lastFingerprint:null,lastData:null,observerHandle:null,undoUnsub:null,livesyncUnsub:null,onChange:n.onChange,onError:n.onError,confirmRemove:n.confirmRemove,previouslyFocused:t.activeElement,quiesced:!1,dispatch(b,g){let k=t.defaultView&&t.defaultView.CustomEvent||(typeof CustomEvent<"u"?CustomEvent:null);if(!k)return;let v={...g||{},pageRoot:Q(r),view:e.name},A=new k(b,{bubbles:!0,cancelable:b==="hcms:change",detail:v});(e.root&&e.root.isConnected!==!1?e.root:Q(r)).dispatchEvent(A)},onCloseRequested:i,onViewRequested:o};return f.updateFingerprint=()=>{f.lastFingerprint=vt(V(f))},e.ctx=f,f}function qs(e){e.updateFingerprint(),We(e,le(U.extract(e.pageRoot,e.pageRules,En),e.pageRules)),e.observerHandle=is({onRefresh:n=>e.view.refresh("observer",n)});let t=D("undo");if(t&&typeof t.on=="function"){let n=()=>{if(R.ctx!==e)return;Ms(e,"undo");let i=le(U.extract(e.pageRoot,e.pageRules,En),e.pageRules);vt(i)!==vt(e.lastData)&&(e.lastData=i,e.onChange?.(i,{path:"",structural:!1}))};t.on("undo",n),t.on("redo",n),e.undoUnsub=()=>{t.off("undo",n),t.off("redo",n)}}let r=()=>Ms(e,"livesync");e.livesyncUnsub=Be(e.doc,jo,r),Cn.ctx=e,Tu(e.doc)}function Ms(e,t){R.ctx===e&&e.view.refresh(t)}function _t(e,{dispatch:t=!0,restoreFocus:r=!0,updateUrl:n=!0,reason:i="close"}={}){if(!e||e.closed)return;e.closed=!0;for(let s of e.uploads||[])try{s.abort()}catch{}e.uploads?.clear();let o=e.previouslyFocused;if(t&&e.dispatch("hcms:close",{reason:i}),n&&Cu(),e.observerHandle?.unsubscribe?.(),e.undoUnsub?.(),e.livesyncUnsub?.(),e.detachEvents?.(),ae(()=>e.view.destroy()),Eu(),r&&typeof o?.focus=="function")try{o.focus()}catch{}}function Eu(){R.isOpen=!1,R.ctx=null,R.opts=null,Cn.ctx=null}function vr(e){let t=e||(typeof window<"u"?window:null),r=t&&t.clay?t.clay.modeLifecycle:null;return r&&typeof r.canWrite=="function"?r:null}function xr(e){let t=vr(e);if(!t)return!0;try{return t.canWrite()!==!1}catch{return!1}}var _u="[data-hcms-uploading]";function Tn(e){if(!e)return[];let t=[];return e.uploads&&e.uploads.size>0&&t.push("upload"),e.pageRoot&&typeof e.pageRoot.querySelector=="function"&&e.pageRoot.querySelector(_u)&&t.push("preview"),t}function Ps(e){if(!e||e.closed)return{ok:!0};let t=Tn(e);return t.length?{ok:!1,code:"pending-input",pending:t}:(e.quiesced=!0,{ok:!0})}function Is(e){!e||e.closed||(e.quiesced=!1)}var Cn={ctx:null};function Tu(e){let t=e.defaultView||(typeof globalThis<"u"?globalThis:null);if(!t)return;let r=function(){let i=Cn.ctx;if(i)return sr(i.formRoot),_e("Reorder",()=>G(V(i),{path:"",structural:!0},i))};typeof t.hypercmsCommit!="function"&&(t.hypercmsCommit=r),typeof globalThis<"u"&&typeof globalThis.hypercmsCommit!="function"&&(globalThis.hypercmsCommit=r)}var _n="cms";function Fs(e){let t=typeof e=="string"?e:"",r=t.indexOf("?"),n=r===-1?t:t.slice(r+1);if(!n)return t;let i=new URLSearchParams(n);return i.get(_n)!=="true"?t:(i.set(_n,"false"),"?"+i.toString())}function $s(e){let t=typeof e=="string"?e:"",r=t.indexOf("?"),n=r===-1?t:t.slice(r+1);return n?new URLSearchParams(n).get(_n)==="true":!1}function Cu(){if(typeof window>"u"||!window.location||!window.history||typeof window.history.replaceState!="function")return;let e=window.location.search,t=Fs(e);t!==e&&window.history.replaceState(window.history.state,"",t+window.location.hash)}function Ds(e){if(Jo(e),typeof document<"u"){let t=document.getElementById("hcms-shell-styles");t?.tagName==="LINK"&&t.remove(),Xe(document)}}var Ln={sidebar:os,inline:Cs};function Ou(e,t){let r=t!==void 0?t:"cms";if(typeof r!="string")return"sidebar";let n=U.findRules(e,r)?.tagNode?.getAttribute?.("data-cms-view");return!n||n==="sidebar"?"sidebar":Ln[n]?n:(console.warn(`hypercms: unknown data-cms-view "${n}" on the rules tag, opening the sidebar`),"sidebar")}function zs(e={}){return Nn(e)}function Ru(e){let t=e&&e.defaultView;if(!vr(t))return null;let r=t.clay&&t.clay.setMode;return typeof r!="function"?null:r.call(t.clay,"view")}function Nn(e={},t=!1){let r=R.isOpen?{...R.opts,...e}:e,n=r.pageRoot||(typeof document<"u"?document:null);if(!n)throw new Error("hypercms: no pageRoot available");let i=(n.nodeType===9?n:n.ownerDocument)||(typeof document<"u"?document:null);if(!i)throw new Error("hypercms: no document available");if(!t&&!xr(i.defaultView))return{ok:!1,code:"not-allowed"};let o=e.view||(R.isOpen?R.ctx.view.name:Ou(i,r.rules)),s=Ln[o];if(!s)throw new Error(`hypercms: unknown view "${o}" (expected ${Object.keys(Ln).join(" or ")})`);let l=R.isOpen?{...r,view:o}:e,a=null,u=null;if(R.isOpen){if(R.ctx.view.name===o)return{ok:!0,view:o};a=R.ctx.previouslyFocused,u=R.ctx.view.name,_t(R.ctx,{restoreFocus:!1,updateUrl:!1,reason:"switch"})}ys();let d=s({doc:i,pageRoot:n,opts:l}),p=js({view:d,doc:i,pageRoot:n,opts:l,onCloseRequested:()=>Ru(i)||Us(),onViewRequested:h=>Nn({view:h},!0)});a&&(p.previouslyFocused=a);try{d.mount(p.initialData),qs(p),d.focusOnOpen(),R.isOpen=!0,R.ctx=p,R.opts=l,p.dispatch("hcms:open",{pageRoot:n,previous:u})}catch(h){throw _t(p,{dispatch:!1,restoreFocus:!!a,updateUrl:!1}),h}return{ok:!0,view:o}}function Us(){if(!R.isOpen)return{ok:!1,code:"no-session"};let e=R.ctx.doc;if(vr(e&&e.defaultView)){let t=Tn(R.ctx);if(t.length)return{ok:!1,code:"pending-input",pending:t};if(!xr(e&&e.defaultView))return{ok:!1,code:"busy"}}return _t(R.ctx),{ok:!0}}function Bs(){R.isOpen&&R.ctx.view.refresh("api")}function Lu(){return R.isOpen&&R.ctx?R.ctx.view.name:null}function Hs({doc:e,pageRoot:t,opts:r={}}={}){let n=null,i=!1;return{ready:Promise.resolve(),enable(){if(i)return;let o={...r};t&&(o.pageRoot=t),o.pageRoot||(o.pageRoot=e&&e.body||e||null),Nn(o,!0),n=R.ctx},quiesce(){return i||!n||R.ctx!==n?{ok:!0}:Ps(n)},resume(){i||!n||R.ctx!==n||Is(n)},dispose(){i||(i=!0,n&&R.ctx===n&&_t(n),n=null)}}}function Nu(e={}){return{id:"hypercms",order:1e3,prepare(){return Hs(e)}}}function On(){if(!R.isOpen)throw new Error("hypercms: cms is not open");if(R.ctx.quiesced)throw new Error("hypercms: the CMS is not admitting new changes")}var Mu={getData(){return R.isOpen?V(R.ctx):null},setValue(e,t){On();let r=R.ctx,n=ie(e),i=oe(r.pageRules,n);if(i===void 0)throw new Error(`hypercms: no rule at path "${e}"`);if(typeof i!="string"||i.endsWith("[]"))throw new Error(`hypercms: setValue requires a leaf scalar path; "${e}" is not a leaf`);let o=ir(r.formRoot,e);if(!o)throw new Error(`hypercms: no field element at path "${e}"`);or(o,t,r.formRoot,e),G(V(r),{path:e,structural:!1},r)},addItem(e){On(),yt(e,R.ctx)},removeItem(e){On();let t=R.ctx,r=ie(e);if(typeof r[r.length-1]!="number")throw new Error(`hypercms: removeItem requires an item path; "${e}" is not an array index`);let i=oe(t.pageRules,r.slice(0,-1));if(!(Array.isArray(i)||typeof i=="string"&&i.endsWith("[]")))throw new Error(`hypercms: removeItem requires an item path; parent of "${e}" is not an array`);let s=t.formRoot.querySelector(`[data-hcms-path="${Fu(e)}"]`);if(!s)throw new Error(`hypercms: no element at path "${e}"`);Ke(s,t)},refresh:Bs,_commit(){if(!R.isOpen||R.ctx.quiesced)return;let e=R.ctx;return sr(e.formRoot),_e("Update",()=>G(V(e),{path:"",structural:!0},e))}},ju=250,qu=1e4;function Pu(){typeof window>"u"||typeof document>"u"||$s(window.location?window.location.search:"")&&(R.isOpen||Iu(()=>{if(!R.isOpen&&xr())try{zs()}catch(e){console.warn("hypercms: auto-open failed",e)}}))}function Rn(){return!!document.body&&!!D("Mutation")}function Iu(e){if(Rn()){queueMicrotask(e);return}let t=Date.now()+qu,r=!1,n=null,i=null,o=()=>{r||(r=!0,n!==null&&clearInterval(n),i&&i())};function s(){if(R.isOpen){o();return}Rn()&&(o(),e())}i=Be(document,Mo,s),n=setInterval(()=>{if(R.isOpen){o();return}if(Rn()){o(),e();return}Date.now()>=t&&(o(),console.warn("hypercms: ?cms=true auto-open gave up \u2014 no mutation hub appeared. Load clayjs or hyperclayjs (or just the mutation utility) so the CMS can initialize."))},ju)}Pu();var Mn={open:zs,close:Us,refresh:Bs,api:Mu,hasRules:(e=document)=>!!U.findRules(e,"cms"),prepareModeLease:Hs,modeParticipant:Nu,get isOpen(){return R.isOpen},currentView:Lu,path:Dr,scaffold:ft,morphForm:jt};function Fu(e){return typeof CSS<"u"&&CSS.escape?CSS.escape(e):String(e).replace(/[^a-zA-Z0-9_\-.*]/g,t=>"\\"+t)}var Vs=`/* GENERATED by scripts/build-theme.js from mirk-interface/mirk.css \u2014 DO NOT EDIT.
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

/* Push the page over so docked content is never hidden underneath. */
body.hcms-open { --hcms-shell-width: 380px; }
body.hcms-open:not(.hcms-overlay) { padding-right: var(--hcms-shell-width); }
body.hcms-open.hcms-side-left:not(.hcms-overlay) { padding-right: 0; padding-left: var(--hcms-shell-width); }
body.hcms-open.hcms-overlay { overflow: hidden; }

@media (max-width: 799px) {
  body.hcms-open { --hcms-shell-width: 100vw; }
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
`;typeof window<"u"&&typeof document<"u"&&(function(){if(window.__mirk)return;window.__mirk=!0;let e='<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4 12 12M12 4 4 12" stroke="currentColor" stroke-width="2" stroke-linecap="square" fill="none"/></svg>';document.addEventListener("click",r=>{let n=r.target.closest(".mirk-number__step");if(!n)return;let i=n.closest(".mirk-number").querySelector("input[type=number]");i&&(n.dataset.step==="up"?i.stepUp():i.stepDown(),i.dispatchEvent(new Event("change",{bubbles:!0})))}),document.addEventListener("input",r=>{let n=r.target.closest(".mirk-slider__input");n&&n.closest(".mirk-slider").style.setProperty("--mirk-value",`${n.value}%`)}),document.addEventListener("change",r=>{let n=r.target.closest(".mirk-file__input");if(!n||!n.files.length)return;let i=n.closest(".mirk-file"),o=i.querySelector(".mirk-file__name");if(!o)return;let s=n.files[0],l=document.createElement("a");if(l.className="mirk-file__name",l.dataset.filled="",l.href=URL.createObjectURL(s),l.target="_blank",l.rel="noopener",l.textContent=s.name,o.replaceWith(l),!i.querySelector(".mirk-file__remove")){let a=document.createElement("button");a.type="button",a.className="mirk-file__remove",a.setAttribute("aria-label","Remove file"),a.innerHTML=e,l.after(a)}}),document.addEventListener("change",r=>{let n=r.target.closest(".mirk-image__input");if(!n||!n.files.length)return;let i=n.closest(".mirk-image"),o=i.querySelector(".mirk-image__preview");if(!o)return;let s=i.querySelector(".mirk-image__placeholder"),l=new FileReader;l.onload=a=>{o.src=a.target.result,o.removeAttribute("hidden"),s&&s.setAttribute("hidden",""),i.querySelector(".mirk-image__thumb")?.removeAttribute("hidden"),i.querySelector(".mirk-image__upload")?.setAttribute("hidden","")},l.readAsDataURL(n.files[0])}),document.addEventListener("click",r=>{let n=r.target.closest(".mirk-file__remove");if(n){let o=n.closest(".mirk-file"),s=o?.querySelector(".mirk-file__input"),l=o?.querySelector(".mirk-file__name");if(s&&(s.value=""),l){let a=document.createElement("span");a.className="mirk-file__name",a.textContent="No file chosen",l.replaceWith(a)}n.remove();return}let i=r.target.closest(".mirk-image__remove");if(i){let o=i.closest(".mirk-image"),s=o?.querySelector(".mirk-image__input"),l=o?.querySelector(".mirk-image__preview");s&&(s.value=""),l&&(l.removeAttribute("src"),l.setAttribute("hidden","")),o?.querySelector(".mirk-image__thumb")?.setAttribute("hidden",""),o?.querySelector(".mirk-image__upload")?.removeAttribute("hidden")}});function t(r,n){let i=document.createElement("span");i.textContent=r;let o=document.createElement("input");o.type="hidden",o.name="tags[]",o.value=r;let s=document.createElement("button");s.type="button",s.className="mirk-tags__remove",s.textContent="\xD7";let l=document.createElement("span");if(l.className="mirk-tags__chip",n){let a=document.createElement("span");a.className="mirk-tags__chip-inner",a.append(i,o,s),l.append(a)}else l.append(i,o,s);return l}document.addEventListener("keydown",r=>{let n=r.target.closest(".mirk-tags__input");if(!n)return;let i=n.closest(".mirk-tags");if(r.key==="Enter"||r.key===","){let o=n.value.trim();if(!o)return;r.preventDefault(),n.before(t(o,i.classList.contains("mirk-tags--round"))),n.value=""}else if(r.key==="Backspace"&&!n.value){let o=i.querySelectorAll(".mirk-tags__chip");o[o.length-1]?.remove()}}),document.addEventListener("click",r=>{let n=r.target.closest(".mirk-tags__remove");if(n){n.closest(".mirk-tags__chip").remove();return}let i=r.target.closest(".mirk-tags");i&&r.target===i&&i.querySelector(".mirk-tags__input")?.focus()}),document.addEventListener("click",r=>{let n=r.target.closest("[data-mirk-chip]");if(!n)return;let i=n.getAttribute("data-mirk-chip");if(i==="open")n.closest(".mirk-chip")?.classList.add("mirk-chip--open");else if(i==="collapse")n.closest(".mirk-chip")?.classList.remove("mirk-chip--open");else if(i==="changes"){let o=n.closest(".mirk-chip__panel")?.classList.toggle("is-changes");n.textContent=o?"(hide changes)":"(view changes)"}}),document.addEventListener("click",r=>{let n=r.target.closest("[data-copy-btn]");if(!n)return;let i=n.closest("[data-copy]");if(!i)return;let o=i.cloneNode(!0);o.querySelectorAll("[data-copy-btn]").forEach(a=>a.remove());let l=i.getAttribute("data-copy")==="text"?o.textContent.replace(/^\s+|\s+$/g,""):o.innerHTML.replace(/\s+data-copy(="[^"]*")?/g,"").replace(/^\s*\n/gm,"").trim();navigator.clipboard.writeText(l).then(()=>{let a=n.textContent;n.textContent="copied",n.dataset.copied="",setTimeout(()=>{n.textContent=a,delete n.dataset.copied},1200)}).catch(()=>{n.textContent="error",setTimeout(()=>{n.textContent="copy"},1200)})})})();Ds(Vs);var wr=Mn,zu={cms:Mn};typeof window<"u"&&!window.__hyperclayNoAutoExport&&(window.hyperclay=window.hyperclay||{},window.hyperclay.hypercms=wr,window.h=window.hyperclay);var Zp=wr,Qp=jn;export{Zp as cms,Qp as default};
