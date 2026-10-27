import{b as ke}from"./c-HAWFNBYG.js";import{a as we}from"./c-AQLFEATB.js";import{a as xe}from"./c-2SPVQSHC.js";import{d as be}from"./c-VRZN56XY.js";import"./c-OW5QIGG3.js";import"./c-BPF2NSPV.js";import"./c-P7KNDG34.js";import"./c-CYWLPPUS.js";import"./c-N7JPUPGC.js";import"./c-HA6INT6J.js";import"./c-WRBKEJD4.js";import"./c-VHNSBD2M.js";var Qe=/^[a-z][a-z0-9+.-]*:/i,Xe=["noindex","nofollow"],Ze=["ogTitle","ogDescription","ogImage","ogImageAlt","siteName"],y=e=>e==null?"":String(e),E=e=>y(e).trim()!=="",F=e=>e.head||e.querySelector("head"),A=(e,o,t)=>Array.from(F(e).querySelectorAll("meta")).filter(i=>y(i.getAttribute(o)).trim().toLowerCase()===t),J=(e,o)=>Array.from(F(e).querySelectorAll("link")).filter(t=>y(t.getAttribute("rel")).trim().toLowerCase().split(/\s+/).includes(o)),Q=e=>Array.from(F(e).querySelectorAll("title")),Z=e=>A(e,"name","robots"),x=e=>e.remove();function j(e,o,t){let i=e.createElement("meta");return i.setAttribute(o,t),F(e).appendChild(i),i}function et(e,o){let t=e.createElement("link");return t.setAttribute("rel",o),F(e).appendChild(t),t}function X(e,o,t,i){(A(e,o,t)[0]||j(e,o,t)).setAttribute("content",i)}function v(e,o,{trim:t=!1}={}){let i=c=>A(c,e,o);return{find:i,read(c){let l=i(c)[0];return l?y(l.getAttribute("content")):""},write(c,l){let p=i(c),u=y(l);if(!E(u)){p.forEach(x);return}(p[0]||j(c,e,o)).setAttribute("content",t?u.trim():u),p.slice(1).forEach(x)}}}var Ee=e=>y(e.getAttribute("content")).split(",").map(o=>o.trim()).filter(Boolean);function tt(e,o){let t=Z(e),i=(t[0]?Ee(t[0]):[]).filter(u=>!Xe.includes(u.toLowerCase())),c=[];o.index===!1&&c.push("noindex"),o.follow===!1&&c.push("nofollow");let l=c.concat(i);if(!l.length){t.forEach(x);return}(t[0]||j(e,"name","robots")).setAttribute("content",l.join(", ")),t.slice(1).forEach(x)}function ve(e){let o=e==="noindex"?"index":"follow",t=o==="index"?"follow":"index";return{find:Z,read(i){let c=Z(i)[0];return c?!Ee(c).some(l=>l.toLowerCase()===e):!0},write(i,c){let l={index:!0,follow:!0};l[o]=!!c,l[t]=b[t].read(i),tt(i,l)}}}var ot={find:Q,read(e){let o=Q(e)[0];return o?y(o.textContent):""},write(e,o){let t=Q(e),i=y(o);if(!E(i)){t.forEach(x);return}let c=t[0]||e.createElement("title");t.length||F(e).appendChild(c),c.textContent=i,t.slice(1).forEach(x)}},nt={find(e){let o=e.documentElement;return o&&o.hasAttribute("lang")?[o]:[]},read(e){let o=e.documentElement;return o&&o.hasAttribute("lang")?y(o.getAttribute("lang")):""},write(e,o){let t=e.documentElement;if(!t)return;let i=y(o);if(!E(i)){t.removeAttribute("lang");return}t.setAttribute("lang",i.trim())}},rt={find:e=>J(e,"canonical"),read(e){let o=J(e,"canonical")[0];return o?y(o.getAttribute("href")):""},write(e,o){let t=J(e,"canonical"),i=y(o);if(!E(i)){t.forEach(x);return}(t[0]||et(e,"canonical")).setAttribute("href",i.trim()),t.slice(1).forEach(x)}},N="clay-seo-title-mode",it={find:e=>A(e,"name",N),read(e){return A(e,"name",N).some(t=>y(t.getAttribute("content")).trim().toLowerCase()==="custom")?"custom":"derived"},write(e,o){let t=A(e,"name",N);if(y(o).trim().toLowerCase()!=="custom"){t.forEach(x);return}(t[0]||j(e,"name",N)).setAttribute("content","custom"),t.slice(1).forEach(x)}},b={title:ot,description:v("name","description"),lang:nt,canonical:rt,index:ve("noindex"),follow:ve("nofollow"),ogTitle:v("property","og:title"),ogDescription:v("property","og:description"),ogImage:v("property","og:image",{trim:!0}),ogImageAlt:v("property","og:image:alt"),siteName:v("property","og:site_name"),twitterSite:v("name","twitter:site"),titleMode:it},Ae=Object.fromEntries(Object.keys(b).map(e=>[e,{read:b[e].read,write:b[e].write}]));function Le(e){let o=e.hostname.toLowerCase();return o==="localhost"||o.endsWith(".localhost")||o==="127.0.0.1"}function ee(e){try{return new URL(e)}catch{return null}}function te(e){return e.protocol==="http:"||e.protocol==="https:"}function Se(e){let o=e.location&&e.location.href||e.URL||e.baseURI||"",t=ee(o);return!t||!te(t)||Le(t)?"":t.origin+t.pathname}function Ce(e){let o=y(e).trim();if(!o)return"";let t=ee(o);return!t||!te(t)?"Enter a full http: or https: address.":Le(t)?"A localhost address cannot be a canonical URL.":""}function at(e,o){let t=y(e).trim();if(!t)return"";if(Qe.test(t)){let i=ee(t);return!i||!te(i)?"Use an http: or https: image address.":""}if(o)try{new URL(t,o)}catch{return"Use an http: or https: image address."}return""}function Ie(e,o){let t=("canonical"in o?y(o.canonical).trim():b.canonical.read(e)).trim();return t&&!Ce(t)?t:""}function ct(e,o){let t=Ze.some(l=>l in o&&E(o[l])),i="canonical"in o&&E(o.canonical);if(!t&&!i&&!("ogImage"in o))return;if(t||i){A(e,"property","og:type").length||X(e,"property","og:type","website");let l=Ie(e,o)||Se(e);l&&X(e,"property","og:url",l)}let c="ogImage"in o?o.ogImage:b.ogImage.read(e);X(e,"name","twitter:card",E(c)?"summary_large_image":"summary")}function _(e){let o={},t={};for(let i of Object.keys(b)){let c=b[i];o[i]=c.read(e),t[i]=c.find(e).length>0}return{values:o,present:t}}function Fe(e,o){let t=o||{},i=Object.keys(b).filter(u=>u in t),c={};if(i.includes("canonical")){let u=Ce(t.canonical);u&&(c.canonical=u)}if(i.includes("ogImage")){let u=Ie(e,t)||Se(e),g=at(t.ogImage,u);g&&(c.ogImage=g)}if(Object.keys(c).length)return{normalized:[],errors:c};let l=[],p=new Set;for(let u of i){let g=b[u].find;g(e).length>1&&!p.has(g)&&(p.add(g),l.push(u))}for(let u of i)b[u].write(e,t[u]);return ct(e,t),{normalized:l,errors:{}}}var Ue="clay-seo-style",Te="reopen-seo",Oe="SEO settings",De=/^[a-z][a-z0-9+.-]*:/i,st="This site is hidden from search engines in your account settings, so this page stays hidden whatever you choose here.",lt="Uploaded images are public to anyone with the link.",dt="Paste the address of an image on the web.",ut=[{legend:"Basics",fields:[{key:"title",label:"Title",kind:"text"},{key:"description",label:"Description",kind:"textarea"},{key:"lang",label:"Language",kind:"text"},{key:"canonical",label:"Canonical URL",kind:"text"}]},{legend:"Search",fields:[{key:"index",label:"Show in search results",kind:"checkbox"},{key:"follow",label:"Let search engines follow links",kind:"checkbox"}]},{legend:"Link preview",fields:[{key:"ogTitle",label:"Preview title",kind:"text"},{key:"ogDescription",label:"Preview description",kind:"textarea"},{key:"ogImage",label:"Preview image",kind:"text"},{key:"ogImageAlt",label:"Image alt text",kind:"text"},{key:"siteName",label:"Site name",kind:"text"}]},{legend:"Social card",fields:[{key:"twitterSite",label:"Handle",kind:"text"}]}],pt=`.clay-seo {
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
}`,h=e=>e==null?"":String(e);function s(e,o,t){let i=document.createElement(e);return o&&(i.className=o),t!=null&&(i.textContent=t),i}function ft(){if(document.getElementById(Ue))return;let e=document.createElement("style");e.id=Ue,e.setAttribute("clay","editor-ui"),e.textContent=pt,document.head.append(e)}var oe=e=>{try{return new URL(e)}catch{return null}},He=e=>!!e&&(e.protocol==="http:"||e.protocol==="https:"),yt=e=>{let o=e.hostname.toLowerCase();return o==="localhost"||o.endsWith(".localhost")||o==="127.0.0.1"};function ze(e){let o=h(e).trim();if(!o)return"";let t=oe(o);return!t||!He(t)?"Enter a full http: or https: address.":yt(t)?"A localhost address cannot be a canonical URL.":""}function Be(e,o){let t=h(e).trim();if(!t)return"";if(De.test(t)){let i=oe(t);return!i||!He(i)?"Use an http: or https: image address.":""}if(o)try{new URL(t,o)}catch{return"Use an http: or https: image address."}return""}function gt(){try{let e=new URL(location.href);return e.origin+e.pathname}catch{return""}}function Re(){return document.querySelectorAll("article[data-page]").length===1}var Me="\uFFFC",Pe=e=>[{t:"heading",level:1,parent:null,c:e}];function mt(e){if(e&&!e.isDestroyed){let l=e.state.doc;for(let p=0;p<l.childCount;p++){let u=l.child(p);if(u.type.name!=="heading"||u.attrs.level!==1||(u.attrs.parent??null)!==null)continue;let g="";return u.forEach(L=>{g+=L.isText?L.text:L.type.name==="hard_break"?Me:""}),Pe(g)}return[]}let o=document.querySelector("article[data-page]"),t=o&&[...o.children].find(l=>l.tagName==="H1");if(!t)return[];let i="",c=l=>{for(let p of l.childNodes)p.nodeType===3?i+=p.data:p.tagName==="BR"?i+=Me:c(p)};return c(t),Pe(i)}function ht(){let e=window.clay&&window.clay.page&&window.clay.page.view;return ke(mt(e))}function bt(e){let o=oe(h(e).trim());return o?o.hostname:""}function xt(e,o){return typeof o=="boolean"?e==="index"?o?"Shown in search":"Hidden from search":e==="follow"?o?"Links followed":"Links not followed":o?"Yes":"No":h(o).trim()||"(empty)"}function wt(e,o){let t=window.clay&&window.clay.undo;return t&&typeof t.commit=="function"?t.commit(e,o):o()}function Ct(){if(document.querySelector(".clay-seo"))return;ft();let e=_(document).values,o=document.activeElement,t=new Map,i=new Map,c=new Map,l=new Set,p=!1,u=!1,g="",L=xe({id:"seo",isPending:()=>!p&&Object.keys(pe()).length>0}),m=s("div","clay-seo");m.setAttribute("clay","editor-ui"),m.setAttribute("role","dialog"),m.setAttribute("aria-modal","true"),m.setAttribute("aria-labelledby","clay-seo-heading");let ne=s("h2","clay-seo-heading",Oe);ne.id="clay-seo-heading";let B=s("button","clay-seo-x","\xD7");B.type="button",B.setAttribute("aria-label","Close");let re=s("div","clay-seo-top");re.append(ne,B);let S=s("img","clay-seo-preview-image");S.alt="";let ie=s("p","clay-seo-preview-title"),q=s("p","clay-seo-preview-description"),ae=s("p","clay-seo-preview-host"),ce=s("div","clay-seo-preview-text");ce.append(ie,q,ae);let se=s("div","clay-seo-preview");se.append(S,ce);let V=s("div","clay-seo-form"),R=s("p","clay-seo-note");R.hidden=!0;let le=s("p","clay-seo-note");function Ne(n){let r=s("div","clay-seo-field"),a=s("label","clay-seo-row"),d=s("span","clay-seo-caption",n.label),f=n.kind==="textarea"?s("textarea","clay-seo-input"):s("input",n.kind==="checkbox"?"clay-seo-check":"clay-seo-input");n.kind==="checkbox"?(a.classList.add("clay-seo-row-check"),f.type="checkbox",f.checked=e[n.key]!==!1,a.append(f,d)):(n.kind!=="textarea"&&(f.type="text"),f.value=h(e[n.key]),a.append(d,f)),f.dataset.key=n.key,window.clay&&window.clay.unsent&&f.setAttribute("unsent",`seo-${n.key}`),t.set(n.key,f);let z=s("p","clay-seo-error");z.hidden=!0,i.set(n.key,z);let I=s("div","clay-seo-conflict");I.hidden=!0;let ge=s("p"),me=s("span","clay-seo-theirs");ge.append("Changed elsewhere: ",me);let $=s("button","clay-seo-theirs-button","Use theirs");$.type="button";let G=s("button","clay-seo-mine-button","Keep mine");return G.type="button",I.append(ge,$,G),c.set(n.key,{row:I,theirs:me}),$.addEventListener("click",()=>{let he=_(document).values[n.key];n.kind==="checkbox"?f.checked=he!==!1:f.value=h(he),l.add(n.key),I.hidden=!0,T()}),G.addEventListener("click",()=>{l.add(n.key),I.hidden=!0}),r.append(a,z,I),r}for(let n of ut){let r=s("fieldset","clay-seo-group");r.append(s("legend","clay-seo-legend",n.legend));for(let a of n.fields)r.append(Ne(a));n.legend==="Search"&&r.append(R),n.legend==="Social card"&&r.append(le),V.append(r)}let U=s("button","clay-seo-derived","Use the first heading");U.type="button",U.hidden=!0,t.get("title").closest(".clay-seo-field").append(U);let je=t.get("ogImage"),C=s("button","clay-seo-upload-button","Upload image");C.type="button";let w=s("input","clay-seo-file");w.type="file",w.accept="image/*",w.hidden=!0,w.tabIndex=-1;let W=s("p","clay-seo-note",lt);W.hidden=!0;let de=s("p","clay-seo-note",dt),Y=s("div","clay-seo-upload");Y.append(C,w,de,W),je.closest(".clay-seo-field").append(Y);let M=s("button","clay-seo-edit","Edit these settings");M.type="button";let P=s("button","clay-seo-cancel","Cancel");P.type="button";let D=s("button","clay-seo-apply","Apply");D.type="button";let ue=s("div","clay-seo-actions");ue.append(M,P,D),m.append(re,se,V,ue);let k=n=>{let r=t.get(n);return r.type==="checkbox"?r.checked:r.value};function K(){let n=h(k("canonical")).trim();return n&&!ze(n)?n:gt()}function _e(){let n=h(k("ogImage")).trim();if(!n||Be(n,K()))return"";if(De.test(n))return n;try{return new URL(n,K()||location.href).href}catch{return""}}function T(){let n=h(k("title")).trim(),r=h(k("description")).trim();t.get("ogTitle").placeholder=n,t.get("ogDescription").placeholder=r;let a=_e();a?(S.src=a,S.hidden=!1):(S.removeAttribute("src"),S.hidden=!0),ie.textContent=h(k("ogTitle")).trim()||n||"Untitled page";let d=h(k("ogDescription")).trim()||r;q.textContent=d,q.hidden=!d,ae.textContent=bt(k("canonical"))||location.host||"",le.textContent=a?"Card size: Summary with a large image":"Card size: Summary",U.hidden=!(Re()&&Ae.titleMode.read(document)==="custom")}function pe(){let n={};for(let[r,a]of t){let d=a.type==="checkbox"?a.checked:a.value;d!==e[r]&&(n[r]=d)}return n}function qe(n){let r={};if("canonical"in n){let a=ze(n.canonical);a&&(r.canonical=a)}if("ogImage"in n){let a=Be(n.ogImage,K());a&&(r.ogImage=a)}return r}function Ve(n){let r=_(document).values,a={};for(let d of Object.keys(n))l.has(d)||r[d]!==e[d]&&r[d]!==n[d]&&(a[d]=r[d]);return a}function fe(n){for(let[r,a]of i){let d=n[r]||"";a.textContent=d,a.hidden=!d}}function We(n){for(let[r,a]of c){let d=n[r],f=d!==void 0;a.row.hidden=!f,a.theirs.textContent=f?xt(r,d):""}}function Ye(){let n=pe(),a=Re()?g||("title"in n?"custom":""):"";for(let z of c.values())z.row.hidden=!0;if(fe({}),!Object.keys(n).length&&!a){O();return}let d=qe(n);if(Object.keys(d).length){fe(d);return}let f=Ve(n);if(Object.keys(f).length){We(f);return}wt(Oe,()=>Fe(document,a?{...n,titleMode:a}:n)),O()}function Ke(){C.hidden=!u,de.hidden=u,W.hidden=!u||!/(^|\.)hyperclay\.com$/i.test(location.hostname)}function H(){let n=!!(window.clay&&window.clay.mode==="edit");for(let r of t.values())r.type==="checkbox"?r.disabled=!n:r.readOnly=!n;M.hidden=n,P.hidden=!n,D.hidden=!n,Y.hidden=!n||!u,Ke()}function ye(){p||H()}function O(){p||(p=!0,L.dispose(),document.removeEventListener("clay:modechange",ye),m.remove(),o&&o.isConnected&&typeof o.focus=="function"&&o.focus())}async function $e(){let n;try{n=await fetch(location.href,{method:"HEAD"})}catch{return}if(p||!m.isConnected)return;let r=n&&n.headers&&typeof n.headers.get=="function"?n.headers.get("x-robots-tag"):"";!r||!/noindex/i.test(r)||(R.textContent=st,R.hidden=!1)}async function Ge(){if(typeof(window.clay&&window.clay.upload)!="function")return;let r=null;try{r=await be()}catch{r=null}p||!m.isConnected||(u=!!(r&&Array.isArray(r.extensions)&&r.extensions.includes("upload")),H())}function Je(){return Array.from(m.querySelectorAll("button, input, textarea")).filter(n=>!n.disabled&&!n.hidden&&n.tabIndex>=0&&!n.closest("[hidden]"))}V.addEventListener("input",()=>{T(),L.changed()}),t.get("title").addEventListener("input",()=>{g=""}),U.addEventListener("click",()=>{g="derived",t.get("title").value=ht(),T()}),C.addEventListener("click",()=>w.click()),w.addEventListener("change",async()=>{let n=w.files&&w.files[0];if(!n)return;let r=window.clay&&window.clay.upload;if(typeof r!="function")return;C.disabled=!0;let a;try{a=await r(n)}catch{a=null}if(C.disabled=!1,p||!m.isConnected)return;let d=a&&a.ok&&Array.isArray(a.uploads)?a.uploads[0]:null;!d||!d.url||(t.get("ogImage").value=d.url,T())}),D.addEventListener("click",Ye),P.addEventListener("click",O),B.addEventListener("click",O),M.addEventListener("click",async()=>{let n=window.clay;if(!n||typeof n.setMode!="function")return;let r=n.storage&&n.storage.session;r&&r.set(Te,!0);let a;try{a=await n.setMode("edit")}catch{a=null}if(p||!!a&&a.ok!==!1&&!!a.reloading)return;r&&r.remove(Te);let f=we(a);f&&window.clay?.toast?.(f,"error"),a&&a.ok!==!1&&H()}),m.addEventListener("keydown",n=>{if(n.key==="Escape"){n.preventDefault(),O();return}if(n.key!=="Tab")return;let r=Je();if(!r.length)return;let a=r[0],d=r[r.length-1];n.shiftKey&&document.activeElement===a?(n.preventDefault(),d.focus()):!n.shiftKey&&document.activeElement===d&&(n.preventDefault(),a.focus())}),document.addEventListener("clay:modechange",ye),document.body.append(m),T(),H(),t.get("title").focus(),$e(),Ge()}export{Ct as open};
