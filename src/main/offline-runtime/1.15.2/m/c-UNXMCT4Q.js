import{a as me}from"./c-XNNW2CWK.js";import{b as ge}from"./c-OTBOUTLE.js";import"./c-54NBR4CW.js";import"./c-P7KNDG34.js";import"./c-CYWLPPUS.js";import"./c-N7JPUPGC.js";import"./c-HA6INT6J.js";import"./c-WRBKEJD4.js";import"./c-VHNSBD2M.js";var Ke=/^[a-z][a-z0-9+.-]*:/i,$e=["noindex","nofollow"],Ge=["ogTitle","ogDescription","ogImage","ogImageAlt","siteName"],y=e=>e==null?"":String(e),E=e=>y(e).trim()!=="",I=e=>e.head||e.querySelector("head"),A=(e,o,t)=>Array.from(I(e).querySelectorAll("meta")).filter(i=>y(i.getAttribute(o)).trim().toLowerCase()===t),$=(e,o)=>Array.from(I(e).querySelectorAll("link")).filter(t=>y(t.getAttribute("rel")).trim().toLowerCase().split(/\s+/).includes(o)),G=e=>Array.from(I(e).querySelectorAll("title")),Q=e=>A(e,"name","robots"),x=e=>e.remove();function H(e,o,t){let i=e.createElement("meta");return i.setAttribute(o,t),I(e).appendChild(i),i}function Je(e,o){let t=e.createElement("link");return t.setAttribute("rel",o),I(e).appendChild(t),t}function J(e,o,t,i){(A(e,o,t)[0]||H(e,o,t)).setAttribute("content",i)}function v(e,o,{trim:t=!1}={}){let i=c=>A(c,e,o);return{find:i,read(c){let l=i(c)[0];return l?y(l.getAttribute("content")):""},write(c,l){let p=i(c),u=y(l);if(!E(u)){p.forEach(x);return}(p[0]||H(c,e,o)).setAttribute("content",t?u.trim():u),p.slice(1).forEach(x)}}}var be=e=>y(e.getAttribute("content")).split(",").map(o=>o.trim()).filter(Boolean);function Qe(e,o){let t=Q(e),i=(t[0]?be(t[0]):[]).filter(u=>!$e.includes(u.toLowerCase())),c=[];o.index===!1&&c.push("noindex"),o.follow===!1&&c.push("nofollow");let l=c.concat(i);if(!l.length){t.forEach(x);return}(t[0]||H(e,"name","robots")).setAttribute("content",l.join(", ")),t.slice(1).forEach(x)}function he(e){let o=e==="noindex"?"index":"follow",t=o==="index"?"follow":"index";return{find:Q,read(i){let c=Q(i)[0];return c?!be(c).some(l=>l.toLowerCase()===e):!0},write(i,c){let l={index:!0,follow:!0};l[o]=!!c,l[t]=b[t].read(i),Qe(i,l)}}}var Xe={find:G,read(e){let o=G(e)[0];return o?y(o.textContent):""},write(e,o){let t=G(e),i=y(o);if(!E(i)){t.forEach(x);return}let c=t[0]||e.createElement("title");t.length||I(e).appendChild(c),c.textContent=i,t.slice(1).forEach(x)}},Ze={find(e){let o=e.documentElement;return o&&o.hasAttribute("lang")?[o]:[]},read(e){let o=e.documentElement;return o&&o.hasAttribute("lang")?y(o.getAttribute("lang")):""},write(e,o){let t=e.documentElement;if(!t)return;let i=y(o);if(!E(i)){t.removeAttribute("lang");return}t.setAttribute("lang",i.trim())}},et={find:e=>$(e,"canonical"),read(e){let o=$(e,"canonical")[0];return o?y(o.getAttribute("href")):""},write(e,o){let t=$(e,"canonical"),i=y(o);if(!E(i)){t.forEach(x);return}(t[0]||Je(e,"canonical")).setAttribute("href",i.trim()),t.slice(1).forEach(x)}},P="clay-seo-title-mode",tt={find:e=>A(e,"name",P),read(e){return A(e,"name",P).some(t=>y(t.getAttribute("content")).trim().toLowerCase()==="custom")?"custom":"derived"},write(e,o){let t=A(e,"name",P);if(y(o).trim().toLowerCase()!=="custom"){t.forEach(x);return}(t[0]||H(e,"name",P)).setAttribute("content","custom"),t.slice(1).forEach(x)}},b={title:Xe,description:v("name","description"),lang:Ze,canonical:et,index:he("noindex"),follow:he("nofollow"),ogTitle:v("property","og:title"),ogDescription:v("property","og:description"),ogImage:v("property","og:image",{trim:!0}),ogImageAlt:v("property","og:image:alt"),siteName:v("property","og:site_name"),twitterSite:v("name","twitter:site"),titleMode:tt},xe=Object.fromEntries(Object.keys(b).map(e=>[e,{read:b[e].read,write:b[e].write}]));function we(e){let o=e.hostname.toLowerCase();return o==="localhost"||o.endsWith(".localhost")||o==="127.0.0.1"}function X(e){try{return new URL(e)}catch{return null}}function Z(e){return e.protocol==="http:"||e.protocol==="https:"}function ke(e){let o=e.location&&e.location.href||e.URL||e.baseURI||"",t=X(o);return!t||!Z(t)||we(t)?"":t.origin+t.pathname}function ve(e){let o=y(e).trim();if(!o)return"";let t=X(o);return!t||!Z(t)?"Enter a full http: or https: address.":we(t)?"A localhost address cannot be a canonical URL.":""}function ot(e,o){let t=y(e).trim();if(!t)return"";if(Ke.test(t)){let i=X(t);return!i||!Z(i)?"Use an http: or https: image address.":""}if(o)try{new URL(t,o)}catch{return"Use an http: or https: image address."}return""}function Ee(e,o){let t=("canonical"in o?y(o.canonical).trim():b.canonical.read(e)).trim();return t&&!ve(t)?t:""}function nt(e,o){let t=Ge.some(l=>l in o&&E(o[l])),i="canonical"in o&&E(o.canonical);if(!t&&!i&&!("ogImage"in o))return;if(t||i){A(e,"property","og:type").length||J(e,"property","og:type","website");let l=Ee(e,o)||ke(e);l&&J(e,"property","og:url",l)}let c="ogImage"in o?o.ogImage:b.ogImage.read(e);J(e,"name","twitter:card",E(c)?"summary_large_image":"summary")}function N(e){let o={},t={};for(let i of Object.keys(b)){let c=b[i];o[i]=c.read(e),t[i]=c.find(e).length>0}return{values:o,present:t}}function Ae(e,o){let t=o||{},i=Object.keys(b).filter(u=>u in t),c={};if(i.includes("canonical")){let u=ve(t.canonical);u&&(c.canonical=u)}if(i.includes("ogImage")){let u=Ee(e,t)||ke(e),m=ot(t.ogImage,u);m&&(c.ogImage=m)}if(Object.keys(c).length)return{normalized:[],errors:c};let l=[],p=new Set;for(let u of i){let m=b[u].find;m(e).length>1&&!p.has(m)&&(p.add(m),l.push(u))}for(let u of i)b[u].write(e,t[u]);return nt(e,t),{normalized:l,errors:{}}}var Le="clay-seo-style",Se="reopen-seo",Ce="SEO settings",ze=/^[a-z][a-z0-9+.-]*:/i,rt="This site is hidden from search engines in your account settings, so this page stays hidden whatever you choose here.",it="Uploaded images are public to anyone with the link.",at="Paste the address of an image on the web.",ct=[{legend:"Basics",fields:[{key:"title",label:"Title",kind:"text"},{key:"description",label:"Description",kind:"textarea"},{key:"lang",label:"Language",kind:"text"},{key:"canonical",label:"Canonical URL",kind:"text"}]},{legend:"Search",fields:[{key:"index",label:"Show in search results",kind:"checkbox"},{key:"follow",label:"Let search engines follow links",kind:"checkbox"}]},{legend:"Link preview",fields:[{key:"ogTitle",label:"Preview title",kind:"text"},{key:"ogDescription",label:"Preview description",kind:"textarea"},{key:"ogImage",label:"Preview image",kind:"text"},{key:"ogImageAlt",label:"Image alt text",kind:"text"},{key:"siteName",label:"Site name",kind:"text"}]},{legend:"Social card",fields:[{key:"twitterSite",label:"Handle",kind:"text"}]}],st=`.clay-seo {
  position: fixed;
  top: 0;
  right: 0;
  left: 0;
  z-index: 2147482100;
  box-sizing: border-box;
  width: 100%;
  max-height: 100vh;
  margin: 0;
  padding: 16px;
  overflow-y: auto;
  border-bottom: 1px solid rgba(23, 28, 36, .16);
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  font-size: 14px;
  line-height: 1.4;
  color: var(--clay-ui-fg, #1F2328);
  background: var(--clay-ui-bg, #F4F4F5);
  box-shadow: 0 18px 40px -24px rgba(23, 28, 36, .55);
  animation: clay-seo-slide 200ms ease-out;
}
@keyframes clay-seo-slide {
  from { transform: translateY(-100%); }
  to { transform: translateY(0); }
}
.clay-seo-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.clay-seo-heading {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.2;
}
.clay-seo-x {
  width: 32px;
  height: 32px;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 50%;
  font: inherit;
  font-size: 18px;
  line-height: 1;
  color: inherit;
  background: none;
  cursor: pointer;
}
.clay-seo-x:hover,
.clay-seo-x:focus-visible { background: rgba(23, 28, 36, .08); outline: none; }
.clay-seo-preview {
  display: flex;
  gap: 12px;
  margin: 12px 0;
  padding: 10px;
  border: 1px solid rgba(23, 28, 36, .16);
  border-radius: 8px;
}
.clay-seo-preview-image {
  flex: none;
  width: 88px;
  height: 62px;
  border-radius: 6px;
  object-fit: cover;
}
.clay-seo-preview-text { min-width: 0; }
.clay-seo-preview-title {
  margin: 0;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.clay-seo-preview-description,
.clay-seo-preview-host {
  margin: 2px 0 0;
  font-size: 12px;
  opacity: .8;
}
.clay-seo-group {
  margin: 0 0 14px;
  padding: 0;
  border: 0;
}
.clay-seo-legend {
  padding: 0;
  margin-bottom: 6px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: .04em;
  text-transform: uppercase;
  opacity: .7;
}
.clay-seo-row {
  display: block;
  margin-bottom: 8px;
}
.clay-seo-caption {
  display: block;
  margin-bottom: 4px;
  font-size: 12px;
  opacity: .8;
}
.clay-seo-row-check {
  display: flex;
  align-items: center;
  gap: 8px;
}
.clay-seo-row-check .clay-seo-caption { margin-bottom: 0; }
.clay-seo-input {
  box-sizing: border-box;
  width: 100%;
  margin: 0;
  padding: 7px 9px;
  border: 1px solid rgba(23, 28, 36, .24);
  border-radius: 6px;
  font: inherit;
  color: inherit;
  background: rgba(250, 251, 252, .7);
}
.clay-seo-input:focus-visible { outline: 2px solid var(--clay-ui-accent, #2F6FEB); outline-offset: 1px; }
textarea.clay-seo-input { min-height: 64px; resize: vertical; }
.clay-seo-note {
  margin: 4px 0 0;
  font-size: 12px;
  opacity: .8;
}
.clay-seo-error {
  margin: 4px 0 0;
  font-size: 12px;
  color: #A63A2B;
}
.clay-seo-derived {
  margin: 4px 0 0;
  padding: 0;
  border: 0;
  font: inherit;
  font-size: 12px;
  color: var(--clay-ui-accent, #2F6FEB);
  background: none;
  text-decoration: underline;
  cursor: pointer;
}
.clay-seo-conflict {
  margin: 6px 0 0;
  padding: 8px;
  border: 1px solid rgba(23, 28, 36, .16);
  border-radius: 6px;
  font-size: 12px;
}
.clay-seo-conflict p { margin: 0 0 6px; }
.clay-seo-upload {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 4px 0 8px;
}
.clay-seo-upload .clay-seo-note { flex: 1 1 100%; margin: 0; }
.clay-seo-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}
.clay-seo-actions button {
  padding: 8px 14px;
  border: 1px solid rgba(23, 28, 36, .24);
  border-radius: 6px;
  font: inherit;
  color: inherit;
  background: none;
  cursor: pointer;
}
.clay-seo-actions button:hover,
.clay-seo-actions button:focus-visible { outline: none; background: rgba(23, 28, 36, .08); }
.clay-seo-apply,
.clay-seo-edit {
  border-color: transparent;
  color: #F7F8FA;
  background: var(--clay-ui-accent, #2F6FEB);
}
.clay-seo-actions .clay-seo-apply:hover,
.clay-seo-actions .clay-seo-apply:focus-visible,
.clay-seo-actions .clay-seo-edit:hover,
.clay-seo-actions .clay-seo-edit:focus-visible { background: var(--clay-ui-accent, #2F6FEB); opacity: .9; }
.clay-seo-upload-button {
  padding: 6px 10px;
  border: 1px solid rgba(23, 28, 36, .24);
  border-radius: 6px;
  font: inherit;
  font-size: 12px;
  color: inherit;
  background: none;
  cursor: pointer;
}
@media (min-width: 600px) {
  .clay-seo {
    width: 560px;
    margin: 0 auto;
    padding: 16px;
    border: 1px solid rgba(23, 28, 36, .16);
    border-top: 0;
    border-radius: 0 0 12px 12px;
  }
}
@media (pointer: coarse) {
  .clay-seo-actions button,
  .clay-seo-upload-button { min-height: 44px; }
}
@media (prefers-color-scheme: dark) {
  .clay-seo {
    color: var(--clay-ui-fg, #E9E9EC);
    background: var(--clay-ui-bg, #26282C);
    border-color: rgba(233, 233, 236, .16);
  }
  .clay-seo-preview { border-color: rgba(233, 233, 236, .16); }
  .clay-seo-input {
    border-color: rgba(233, 233, 236, .16);
    background: rgba(233, 233, 236, .08);
  }
  .clay-seo-x:hover,
  .clay-seo-x:focus-visible,
  .clay-seo-actions button:hover,
  .clay-seo-actions button:focus-visible { background: rgba(233, 233, 236, .12); }
  .clay-seo-actions button { border-color: rgba(233, 233, 236, .24); }
  .clay-seo-conflict { border-color: rgba(233, 233, 236, .16); }
  .clay-seo-error { color: #F0A192; }
}
@media (prefers-reduced-motion: reduce) {
  .clay-seo { animation: none; }
}`,h=e=>e==null?"":String(e);function s(e,o,t){let i=document.createElement(e);return o&&(i.className=o),t!=null&&(i.textContent=t),i}function lt(){if(document.getElementById(Le))return;let e=document.createElement("style");e.id=Le,e.setAttribute("clay","editor-ui"),e.textContent=st,document.head.append(e)}var ee=e=>{try{return new URL(e)}catch{return null}},Be=e=>!!e&&(e.protocol==="http:"||e.protocol==="https:"),dt=e=>{let o=e.hostname.toLowerCase();return o==="localhost"||o.endsWith(".localhost")||o==="127.0.0.1"};function Ie(e){let o=h(e).trim();if(!o)return"";let t=ee(o);return!t||!Be(t)?"Enter a full http: or https: address.":dt(t)?"A localhost address cannot be a canonical URL.":""}function Fe(e,o){let t=h(e).trim();if(!t)return"";if(ze.test(t)){let i=ee(t);return!i||!Be(i)?"Use an http: or https: image address.":""}if(o)try{new URL(t,o)}catch{return"Use an http: or https: image address."}return""}function ut(){try{let e=new URL(location.href);return e.origin+e.pathname}catch{return""}}function Ue(){return document.querySelectorAll("article[data-page]").length===1}var Te="\uFFFC",Oe=e=>[{t:"heading",level:1,parent:null,c:e}];function pt(e){if(e&&!e.isDestroyed){let l=e.state.doc;for(let p=0;p<l.childCount;p++){let u=l.child(p);if(u.type.name!=="heading"||u.attrs.level!==1||(u.attrs.parent??null)!==null)continue;let m="";return u.forEach(g=>{m+=g.isText?g.text:g.type.name==="hard_break"?Te:""}),Oe(m)}return[]}let o=document.querySelector("article[data-page]"),t=o&&[...o.children].find(l=>l.tagName==="H1");if(!t)return[];let i="",c=l=>{for(let p of l.childNodes)p.nodeType===3?i+=p.data:p.tagName==="BR"?i+=Te:c(p)};return c(t),Oe(i)}function ft(){let e=window.clay&&window.clay.page&&window.clay.page.view;return me(pt(e))}function yt(e){let o=ee(h(e).trim());return o?o.hostname:""}function gt(e,o){return typeof o=="boolean"?e==="index"?o?"Shown in search":"Hidden from search":e==="follow"?o?"Links followed":"Links not followed":o?"Yes":"No":h(o).trim()||"(empty)"}function mt(e,o){let t=window.clay&&window.clay.undo;return t&&typeof t.commit=="function"?t.commit(e,o):o()}function kt(){if(document.querySelector(".clay-seo"))return;lt();let e=N(document).values,o=document.activeElement,t=new Map,i=new Map,c=new Map,l=new Set,p=!1,u=!1,m="",g=s("div","clay-seo");g.setAttribute("clay","editor-ui"),g.setAttribute("role","dialog"),g.setAttribute("aria-modal","true"),g.setAttribute("aria-labelledby","clay-seo-heading");let te=s("h2","clay-seo-heading",Ce);te.id="clay-seo-heading";let z=s("button","clay-seo-x","\xD7");z.type="button",z.setAttribute("aria-label","Close");let oe=s("div","clay-seo-top");oe.append(te,z);let L=s("img","clay-seo-preview-image");L.alt="";let ne=s("p","clay-seo-preview-title"),j=s("p","clay-seo-preview-description"),re=s("p","clay-seo-preview-host"),ie=s("div","clay-seo-preview-text");ie.append(ne,j,re);let ae=s("div","clay-seo-preview");ae.append(L,ie);let _=s("div","clay-seo-form"),B=s("p","clay-seo-note");B.hidden=!0;let ce=s("p","clay-seo-note");function Re(n){let r=s("div","clay-seo-field"),a=s("label","clay-seo-row"),d=s("span","clay-seo-caption",n.label),f=n.kind==="textarea"?s("textarea","clay-seo-input"):s("input",n.kind==="checkbox"?"clay-seo-check":"clay-seo-input");n.kind==="checkbox"?(a.classList.add("clay-seo-row-check"),f.type="checkbox",f.checked=e[n.key]!==!1,a.append(f,d)):(n.kind!=="textarea"&&(f.type="text"),f.value=h(e[n.key]),a.append(d,f)),f.dataset.key=n.key,window.clay&&window.clay.unsent&&f.setAttribute("unsent",`seo-${n.key}`),t.set(n.key,f);let O=s("p","clay-seo-error");O.hidden=!0,i.set(n.key,O);let C=s("div","clay-seo-conflict");C.hidden=!0;let pe=s("p"),fe=s("span","clay-seo-theirs");pe.append("Changed elsewhere: ",fe);let Y=s("button","clay-seo-theirs-button","Use theirs");Y.type="button";let K=s("button","clay-seo-mine-button","Keep mine");return K.type="button",C.append(pe,Y,K),c.set(n.key,{row:C,theirs:fe}),Y.addEventListener("click",()=>{let ye=N(document).values[n.key];n.kind==="checkbox"?f.checked=ye!==!1:f.value=h(ye),l.add(n.key),C.hidden=!0,U()}),K.addEventListener("click",()=>{l.add(n.key),C.hidden=!0}),r.append(a,O,C),r}for(let n of ct){let r=s("fieldset","clay-seo-group");r.append(s("legend","clay-seo-legend",n.legend));for(let a of n.fields)r.append(Re(a));n.legend==="Search"&&r.append(B),n.legend==="Social card"&&r.append(ce),_.append(r)}let F=s("button","clay-seo-derived","Use the first heading");F.type="button",F.hidden=!0,t.get("title").closest(".clay-seo-field").append(F);let De=t.get("ogImage"),S=s("button","clay-seo-upload-button","Upload image");S.type="button";let w=s("input","clay-seo-file");w.type="file",w.accept="image/*",w.hidden=!0,w.tabIndex=-1;let q=s("p","clay-seo-note",it);q.hidden=!0;let se=s("p","clay-seo-note",at),V=s("div","clay-seo-upload");V.append(S,w,se,q),De.closest(".clay-seo-field").append(V);let R=s("button","clay-seo-edit","Edit these settings");R.type="button";let D=s("button","clay-seo-cancel","Cancel");D.type="button";let M=s("button","clay-seo-apply","Apply");M.type="button";let le=s("div","clay-seo-actions");le.append(R,D,M),g.append(oe,ae,_,le);let k=n=>{let r=t.get(n);return r.type==="checkbox"?r.checked:r.value};function W(){let n=h(k("canonical")).trim();return n&&!Ie(n)?n:ut()}function Me(){let n=h(k("ogImage")).trim();if(!n||Fe(n,W()))return"";if(ze.test(n))return n;try{return new URL(n,W()||location.href).href}catch{return""}}function U(){let n=h(k("title")).trim(),r=h(k("description")).trim();t.get("ogTitle").placeholder=n,t.get("ogDescription").placeholder=r;let a=Me();a?(L.src=a,L.hidden=!1):(L.removeAttribute("src"),L.hidden=!0),ne.textContent=h(k("ogTitle")).trim()||n||"Untitled page";let d=h(k("ogDescription")).trim()||r;j.textContent=d,j.hidden=!d,re.textContent=yt(k("canonical"))||location.host||"",ce.textContent=a?"Card size: Summary with a large image":"Card size: Summary",F.hidden=!(Ue()&&xe.titleMode.read(document)==="custom")}function Pe(){let n={};for(let[r,a]of t){let d=a.type==="checkbox"?a.checked:a.value;d!==e[r]&&(n[r]=d)}return n}function He(n){let r={};if("canonical"in n){let a=Ie(n.canonical);a&&(r.canonical=a)}if("ogImage"in n){let a=Fe(n.ogImage,W());a&&(r.ogImage=a)}return r}function Ne(n){let r=N(document).values,a={};for(let d of Object.keys(n))l.has(d)||r[d]!==e[d]&&r[d]!==n[d]&&(a[d]=r[d]);return a}function de(n){for(let[r,a]of i){let d=n[r]||"";a.textContent=d,a.hidden=!d}}function je(n){for(let[r,a]of c){let d=n[r],f=d!==void 0;a.row.hidden=!f,a.theirs.textContent=f?gt(r,d):""}}function _e(){let n=Pe(),a=Ue()?m||("title"in n?"custom":""):"";for(let O of c.values())O.row.hidden=!0;if(de({}),!Object.keys(n).length&&!a){T();return}let d=He(n);if(Object.keys(d).length){de(d);return}let f=Ne(n);if(Object.keys(f).length){je(f);return}mt(Ce,()=>Ae(document,a?{...n,titleMode:a}:n)),T()}function qe(){S.hidden=!u,se.hidden=u,q.hidden=!u||!/(^|\.)hyperclay\.com$/i.test(location.hostname)}function ue(){let n=!!(window.clay&&window.clay.mode==="edit");for(let r of t.values())r.type==="checkbox"?r.disabled=!n:r.readOnly=!n;R.hidden=n,D.hidden=!n,M.hidden=!n,V.hidden=!n||!u,qe()}function T(){p||(p=!0,g.remove(),o&&o.isConnected&&typeof o.focus=="function"&&o.focus())}async function Ve(){let n;try{n=await fetch(location.href,{method:"HEAD"})}catch{return}if(p||!g.isConnected)return;let r=n&&n.headers&&typeof n.headers.get=="function"?n.headers.get("x-robots-tag"):"";!r||!/noindex/i.test(r)||(B.textContent=rt,B.hidden=!1)}async function We(){if(typeof(window.clay&&window.clay.upload)!="function")return;let r=null;try{r=await ge()}catch{r=null}p||!g.isConnected||(u=!!(r&&Array.isArray(r.extensions)&&r.extensions.includes("upload")),ue())}function Ye(){return Array.from(g.querySelectorAll("button, input, textarea")).filter(n=>!n.disabled&&!n.hidden&&n.tabIndex>=0&&!n.closest("[hidden]"))}_.addEventListener("input",U),t.get("title").addEventListener("input",()=>{m=""}),F.addEventListener("click",()=>{m="derived",t.get("title").value=ft(),U()}),S.addEventListener("click",()=>w.click()),w.addEventListener("change",async()=>{let n=w.files&&w.files[0];if(!n)return;let r=window.clay&&window.clay.upload;if(typeof r!="function")return;S.disabled=!0;let a;try{a=await r(n)}catch{a=null}if(S.disabled=!1,p||!g.isConnected)return;let d=a&&a.ok&&Array.isArray(a.uploads)?a.uploads[0]:null;!d||!d.url||(t.get("ogImage").value=d.url,U())}),M.addEventListener("click",_e),D.addEventListener("click",T),z.addEventListener("click",T),R.addEventListener("click",async()=>{let n=window.clay;if(!n||typeof n.setMode!="function")return;let r=n.storage&&n.storage.session;r&&r.set(Se,!0);let a;try{a=await n.setMode("edit")}catch{a=null}(!a||a.ok===!1||!a.reloading)&&r&&r.remove(Se)}),g.addEventListener("keydown",n=>{if(n.key==="Escape"){n.preventDefault(),T();return}if(n.key!=="Tab")return;let r=Ye();if(!r.length)return;let a=r[0],d=r[r.length-1];n.shiftKey&&document.activeElement===a?(n.preventDefault(),d.focus()):!n.shiftKey&&document.activeElement===d&&(n.preventDefault(),a.focus())}),document.body.append(g),U(),ue(),t.get("title").focus(),Ve(),We()}export{kt as open};
