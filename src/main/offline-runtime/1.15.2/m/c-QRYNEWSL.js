import{b as ge}from"./c-YAIGE6V2.js";import"./c-72P6BIQH.js";import"./c-P7KNDG34.js";import"./c-CYWLPPUS.js";import"./c-N7JPUPGC.js";import"./c-HA6INT6J.js";import"./c-WRBKEJD4.js";import"./c-VHNSBD2M.js";var Ve=/^[a-z][a-z0-9+.-]*:/i,We=["noindex","nofollow"],Ye=["ogTitle","ogDescription","ogImage","ogImageAlt","siteName"],f=e=>e==null?"":String(e),E=e=>f(e).trim()!=="",I=e=>e.head||e.querySelector("head"),A=(e,t,o)=>Array.from(I(e).querySelectorAll("meta")).filter(i=>f(i.getAttribute(t)).trim().toLowerCase()===o),$=(e,t)=>Array.from(I(e).querySelectorAll("link")).filter(o=>f(o.getAttribute("rel")).trim().toLowerCase().split(/\s+/).includes(t)),G=e=>Array.from(I(e).querySelectorAll("title")),Q=e=>A(e,"name","robots"),x=e=>e.remove();function H(e,t,o){let i=e.createElement("meta");return i.setAttribute(t,o),I(e).appendChild(i),i}function Ke(e,t){let o=e.createElement("link");return o.setAttribute("rel",t),I(e).appendChild(o),o}function J(e,t,o,i){(A(e,t,o)[0]||H(e,t,o)).setAttribute("content",i)}function v(e,t,{trim:o=!1}={}){let i=s=>A(s,e,t);return{find:i,read(s){let d=i(s)[0];return d?f(d.getAttribute("content")):""},write(s,d){let y=i(s),u=f(d);if(!E(u)){y.forEach(x);return}(y[0]||H(s,e,t)).setAttribute("content",o?u.trim():u),y.slice(1).forEach(x)}}}var he=e=>f(e.getAttribute("content")).split(",").map(t=>t.trim()).filter(Boolean);function $e(e,t){let o=Q(e),i=(o[0]?he(o[0]):[]).filter(u=>!We.includes(u.toLowerCase())),s=[];t.index===!1&&s.push("noindex"),t.follow===!1&&s.push("nofollow");let d=s.concat(i);if(!d.length){o.forEach(x);return}(o[0]||H(e,"name","robots")).setAttribute("content",d.join(", ")),o.slice(1).forEach(x)}function me(e){let t=e==="noindex"?"index":"follow",o=t==="index"?"follow":"index";return{find:Q,read(i){let s=Q(i)[0];return s?!he(s).some(d=>d.toLowerCase()===e):!0},write(i,s){let d={index:!0,follow:!0};d[t]=!!s,d[o]=b[o].read(i),$e(i,d)}}}var Ge={find:G,read(e){let t=G(e)[0];return t?f(t.textContent):""},write(e,t){let o=G(e),i=f(t);if(!E(i)){o.forEach(x);return}let s=o[0]||e.createElement("title");o.length||I(e).appendChild(s),s.textContent=i,o.slice(1).forEach(x)}},Je={find(e){let t=e.documentElement;return t&&t.hasAttribute("lang")?[t]:[]},read(e){let t=e.documentElement;return t&&t.hasAttribute("lang")?f(t.getAttribute("lang")):""},write(e,t){let o=e.documentElement;if(!o)return;let i=f(t);if(!E(i)){o.removeAttribute("lang");return}o.setAttribute("lang",i.trim())}},Qe={find:e=>$(e,"canonical"),read(e){let t=$(e,"canonical")[0];return t?f(t.getAttribute("href")):""},write(e,t){let o=$(e,"canonical"),i=f(t);if(!E(i)){o.forEach(x);return}(o[0]||Ke(e,"canonical")).setAttribute("href",i.trim()),o.slice(1).forEach(x)}},M="clay-seo-title-mode",Xe={find:e=>A(e,"name",M),read(e){let t=A(e,"name",M)[0];return t&&f(t.getAttribute("content")).trim().toLowerCase()==="custom"?"custom":"derived"},write(e,t){let o=A(e,"name",M);if(f(t).trim().toLowerCase()!=="custom"){o.forEach(x);return}(o[0]||H(e,"name",M)).setAttribute("content","custom"),o.slice(1).forEach(x)}},b={title:Ge,description:v("name","description"),lang:Je,canonical:Qe,index:me("noindex"),follow:me("nofollow"),ogTitle:v("property","og:title"),ogDescription:v("property","og:description"),ogImage:v("property","og:image",{trim:!0}),ogImageAlt:v("property","og:image:alt"),siteName:v("property","og:site_name"),twitterSite:v("name","twitter:site"),titleMode:Xe},be=Object.fromEntries(Object.keys(b).map(e=>[e,{read:b[e].read,write:b[e].write}]));function xe(e){let t=e.hostname.toLowerCase();return t==="localhost"||t.endsWith(".localhost")||t==="127.0.0.1"}function X(e){try{return new URL(e)}catch{return null}}function Z(e){return e.protocol==="http:"||e.protocol==="https:"}function we(e){let t=e.location&&e.location.href||e.URL||e.baseURI||"",o=X(t);return!o||!Z(o)||xe(o)?"":o.origin+o.pathname}function ke(e){let t=f(e).trim();if(!t)return"";let o=X(t);return!o||!Z(o)?"Enter a full http: or https: address.":xe(o)?"A localhost address cannot be a canonical URL.":""}function Ze(e,t){let o=f(e).trim();if(!o)return"";if(Ve.test(o)){let i=X(o);return!i||!Z(i)?"Use an http: or https: image address.":""}if(t)try{new URL(o,t)}catch{return"Use an http: or https: image address."}return""}function ve(e,t){let o=("canonical"in t?f(t.canonical).trim():b.canonical.read(e)).trim();return o&&!ke(o)?o:""}function et(e,t){let o=Ye.some(d=>d in t&&E(t[d])),i="canonical"in t&&E(t.canonical);if(!o&&!i&&!("ogImage"in t))return;if(o||i){A(e,"property","og:type").length||J(e,"property","og:type","website");let d=ve(e,t)||we(e);d&&J(e,"property","og:url",d)}let s="ogImage"in t?t.ogImage:b.ogImage.read(e);J(e,"name","twitter:card",E(s)?"summary_large_image":"summary")}function j(e){let t={},o={};for(let i of Object.keys(b)){let s=b[i];t[i]=s.read(e),o[i]=s.find(e).length>0}return{values:t,present:o}}function Ee(e,t){let o=t||{},i=Object.keys(b).filter(u=>u in o),s={};if(i.includes("canonical")){let u=ke(o.canonical);u&&(s.canonical=u)}if(i.includes("ogImage")){let u=ve(e,o)||we(e),h=Ze(o.ogImage,u);h&&(s.ogImage=h)}if(Object.keys(s).length)return{normalized:[],errors:s};let d=[],y=new Set;for(let u of i){let h=b[u].find;h(e).length>1&&!y.has(h)&&(y.add(h),d.push(u))}for(let u of i)b[u].write(e,o[u]);return et(e,o),{normalized:d,errors:{}}}var Ae="clay-seo-style",Le="reopen-seo",Se="SEO settings",Fe=/^[a-z][a-z0-9+.-]*:/i,tt="This site is hidden from search engines in your account settings, so this page stays hidden whatever you choose here.",ot="Uploaded images are public to anyone with the link.",nt="Paste the address of an image on the web.",rt=[{legend:"Basics",fields:[{key:"title",label:"Title",kind:"text"},{key:"description",label:"Description",kind:"textarea"},{key:"lang",label:"Language",kind:"text"},{key:"canonical",label:"Canonical URL",kind:"text"}]},{legend:"Search",fields:[{key:"index",label:"Show in search results",kind:"checkbox"},{key:"follow",label:"Let search engines follow links",kind:"checkbox"}]},{legend:"Link preview",fields:[{key:"ogTitle",label:"Preview title",kind:"text"},{key:"ogDescription",label:"Preview description",kind:"textarea"},{key:"ogImage",label:"Preview image",kind:"text"},{key:"ogImageAlt",label:"Image alt text",kind:"text"},{key:"siteName",label:"Site name",kind:"text"}]},{legend:"Social card",fields:[{key:"twitterSite",label:"Handle",kind:"text"}]}],it=`.clay-seo {
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
}`,g=e=>e==null?"":String(e);function c(e,t,o){let i=document.createElement(e);return t&&(i.className=t),o!=null&&(i.textContent=o),i}function at(){if(document.getElementById(Ae))return;let e=document.createElement("style");e.id=Ae,e.setAttribute("clay","editor-ui"),e.textContent=it,document.head.append(e)}var ee=e=>{try{return new URL(e)}catch{return null}},Oe=e=>!!e&&(e.protocol==="http:"||e.protocol==="https:"),ct=e=>{let t=e.hostname.toLowerCase();return t==="localhost"||t.endsWith(".localhost")||t==="127.0.0.1"};function Ce(e){let t=g(e).trim();if(!t)return"";let o=ee(t);return!o||!Oe(o)?"Enter a full http: or https: address.":ct(o)?"A localhost address cannot be a canonical URL.":""}function Ie(e,t){let o=g(e).trim();if(!o)return"";if(Fe.test(o)){let i=ee(o);return!i||!Oe(i)?"Use an http: or https: image address.":""}if(t)try{new URL(o,t)}catch{return"Use an http: or https: image address."}return""}function st(){try{let e=new URL(location.href);return e.origin+e.pathname}catch{return""}}function Ue(){return document.querySelectorAll("article[data-page]").length===1}function lt(){let e=document.querySelector("article[data-page]");if(!e)return"";let t=e.querySelector("h1")||e.querySelector("h1, h2, h3, h4, h5, h6");return t?g(t.textContent).trim():""}function dt(e){let t=ee(g(e).trim());return t?t.hostname:""}function ut(e,t){return typeof t=="boolean"?e==="index"?t?"Shown in search":"Hidden from search":e==="follow"?t?"Links followed":"Links not followed":t?"Yes":"No":g(t).trim()||"(empty)"}function pt(e,t){let o=window.clay&&window.clay.undo;return o&&typeof o.commit=="function"?o.commit(e,t):t()}function mt(){if(document.querySelector(".clay-seo"))return;at();let e=j(document).values,t=document.activeElement,o=new Map,i=new Map,s=new Map,d=new Set,y=!1,u=!1,h="",m=c("div","clay-seo");m.setAttribute("clay","editor-ui"),m.setAttribute("role","dialog"),m.setAttribute("aria-modal","true"),m.setAttribute("aria-labelledby","clay-seo-heading");let te=c("h2","clay-seo-heading",Se);te.id="clay-seo-heading";let T=c("button","clay-seo-x","\xD7");T.type="button",T.setAttribute("aria-label","Close");let oe=c("div","clay-seo-top");oe.append(te,T);let L=c("img","clay-seo-preview-image");L.alt="";let ne=c("p","clay-seo-preview-title"),N=c("p","clay-seo-preview-description"),re=c("p","clay-seo-preview-host"),ie=c("div","clay-seo-preview-text");ie.append(ne,N,re);let ae=c("div","clay-seo-preview");ae.append(L,ie);let _=c("div","clay-seo-form"),B=c("p","clay-seo-note");B.hidden=!0;let ce=c("p","clay-seo-note");function ze(n){let r=c("div","clay-seo-field"),a=c("label","clay-seo-row"),l=c("span","clay-seo-caption",n.label),p=n.kind==="textarea"?c("textarea","clay-seo-input"):c("input",n.kind==="checkbox"?"clay-seo-check":"clay-seo-input");n.kind==="checkbox"?(a.classList.add("clay-seo-row-check"),p.type="checkbox",p.checked=e[n.key]!==!1,a.append(p,l)):(n.kind!=="textarea"&&(p.type="text"),p.value=g(e[n.key]),a.append(l,p)),p.dataset.key=n.key,window.clay&&window.clay.unsent&&p.setAttribute("unsent",`seo-${n.key}`),o.set(n.key,p);let z=c("p","clay-seo-error");z.hidden=!0,i.set(n.key,z);let C=c("div","clay-seo-conflict");C.hidden=!0;let pe=c("p"),fe=c("span","clay-seo-theirs");pe.append("Changed elsewhere: ",fe);let Y=c("button","clay-seo-theirs-button","Use theirs");Y.type="button";let K=c("button","clay-seo-mine-button","Keep mine");return K.type="button",C.append(pe,Y,K),s.set(n.key,{row:C,theirs:fe}),Y.addEventListener("click",()=>{let ye=j(document).values[n.key];n.kind==="checkbox"?p.checked=ye!==!1:p.value=g(ye),d.add(n.key),C.hidden=!0,F()}),K.addEventListener("click",()=>{d.add(n.key),C.hidden=!0}),r.append(a,z,C),r}for(let n of rt){let r=c("fieldset","clay-seo-group");r.append(c("legend","clay-seo-legend",n.legend));for(let a of n.fields)r.append(ze(a));n.legend==="Search"&&r.append(B),n.legend==="Social card"&&r.append(ce),_.append(r)}let U=c("button","clay-seo-derived","Use the first heading");U.type="button",U.hidden=!0,o.get("title").closest(".clay-seo-field").append(U);let Te=o.get("ogImage"),S=c("button","clay-seo-upload-button","Upload image");S.type="button";let w=c("input","clay-seo-file");w.type="file",w.accept="image/*",w.hidden=!0,w.tabIndex=-1;let q=c("p","clay-seo-note",ot);q.hidden=!0;let se=c("p","clay-seo-note",nt),V=c("div","clay-seo-upload");V.append(S,w,se,q),Te.closest(".clay-seo-field").append(V);let R=c("button","clay-seo-edit","Edit these settings");R.type="button";let P=c("button","clay-seo-cancel","Cancel");P.type="button";let D=c("button","clay-seo-apply","Apply");D.type="button";let le=c("div","clay-seo-actions");le.append(R,P,D),m.append(oe,ae,_,le);let k=n=>{let r=o.get(n);return r.type==="checkbox"?r.checked:r.value};function W(){let n=g(k("canonical")).trim();return n&&!Ce(n)?n:st()}function Be(){let n=g(k("ogImage")).trim();if(!n||Ie(n,W()))return"";if(Fe.test(n))return n;try{return new URL(n,W()||location.href).href}catch{return""}}function F(){let n=g(k("title")).trim(),r=g(k("description")).trim();o.get("ogTitle").placeholder=n,o.get("ogDescription").placeholder=r;let a=Be();a?(L.src=a,L.hidden=!1):(L.removeAttribute("src"),L.hidden=!0),ne.textContent=g(k("ogTitle")).trim()||n||"Untitled page";let l=g(k("ogDescription")).trim()||r;N.textContent=l,N.hidden=!l,re.textContent=dt(k("canonical"))||location.host||"",ce.textContent=a?"Card size: Summary with a large image":"Card size: Summary",U.hidden=!(Ue()&&be.titleMode.read(document)==="custom")}function Re(){let n={};for(let[r,a]of o){let l=a.type==="checkbox"?a.checked:a.value;l!==e[r]&&(n[r]=l)}return n}function Pe(n){let r={};if("canonical"in n){let a=Ce(n.canonical);a&&(r.canonical=a)}if("ogImage"in n){let a=Ie(n.ogImage,W());a&&(r.ogImage=a)}return r}function De(n){let r=j(document).values,a={};for(let l of Object.keys(n))d.has(l)||r[l]!==e[l]&&r[l]!==n[l]&&(a[l]=r[l]);return a}function de(n){for(let[r,a]of i){let l=n[r]||"";a.textContent=l,a.hidden=!l}}function Me(n){for(let[r,a]of s){let l=n[r],p=l!==void 0;a.row.hidden=!p,a.theirs.textContent=p?ut(r,l):""}}function He(){let n=Re(),a=Ue()?h||("title"in n?"custom":""):"";for(let z of s.values())z.row.hidden=!0;if(de({}),!Object.keys(n).length&&!a){O();return}let l=Pe(n);if(Object.keys(l).length){de(l);return}let p=De(n);if(Object.keys(p).length){Me(p);return}pt(Se,()=>Ee(document,a?{...n,titleMode:a}:n)),O()}function je(){S.hidden=!u,se.hidden=u,q.hidden=!u||!/(^|\.)hyperclay\.com$/i.test(location.hostname)}function ue(){let n=!!(window.clay&&window.clay.mode==="edit");for(let r of o.values())r.type==="checkbox"?r.disabled=!n:r.readOnly=!n;R.hidden=n,P.hidden=!n,D.hidden=!n,V.hidden=!n||!u,je()}function O(){y||(y=!0,m.remove(),t&&t.isConnected&&typeof t.focus=="function"&&t.focus())}async function Ne(){let n;try{n=await fetch(location.href,{method:"HEAD"})}catch{return}if(y||!m.isConnected)return;let r=n&&n.headers&&typeof n.headers.get=="function"?n.headers.get("x-robots-tag"):"";!r||!/noindex/i.test(r)||(B.textContent=tt,B.hidden=!1)}async function _e(){if(typeof(window.clay&&window.clay.upload)!="function")return;let r=null;try{r=await ge()}catch{r=null}y||!m.isConnected||(u=!!(r&&Array.isArray(r.extensions)&&r.extensions.includes("upload")),ue())}function qe(){return Array.from(m.querySelectorAll("button, input, textarea")).filter(n=>!n.disabled&&!n.hidden&&n.tabIndex>=0&&!n.closest("[hidden]"))}_.addEventListener("input",F),o.get("title").addEventListener("input",()=>{h=""}),U.addEventListener("click",()=>{h="derived",o.get("title").value=lt(),F()}),S.addEventListener("click",()=>w.click()),w.addEventListener("change",async()=>{let n=w.files&&w.files[0];if(!n)return;let r=window.clay&&window.clay.upload;if(typeof r!="function")return;S.disabled=!0;let a;try{a=await r(n)}catch{a=null}if(S.disabled=!1,y||!m.isConnected)return;let l=a&&a.ok&&Array.isArray(a.uploads)?a.uploads[0]:null;!l||!l.url||(o.get("ogImage").value=l.url,F())}),D.addEventListener("click",He),P.addEventListener("click",O),T.addEventListener("click",O),R.addEventListener("click",async()=>{let n=window.clay;if(!n||typeof n.setMode!="function")return;let r=n.storage&&n.storage.session;r&&r.set(Le,!0);let a;try{a=await n.setMode("edit")}catch{a=null}(!a||a.ok===!1||!a.reloading)&&r&&r.remove(Le)}),m.addEventListener("keydown",n=>{if(n.key==="Escape"){n.preventDefault(),O();return}if(n.key!=="Tab")return;let r=qe();if(!r.length)return;let a=r[0],l=r[r.length-1];n.shiftKey&&document.activeElement===a?(n.preventDefault(),l.focus()):!n.shiftKey&&document.activeElement===l&&(n.preventDefault(),a.focus())}),document.body.append(m),F(),ue(),o.get("title").focus(),Ne(),_e()}export{mt as open};
