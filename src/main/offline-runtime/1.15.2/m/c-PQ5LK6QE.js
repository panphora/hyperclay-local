import"./c-VHNSBD2M.js";var It=Object.defineProperty,ni=(e,t,i)=>t in e?It(e,t,{enumerable:!0,configurable:!0,writable:!0,value:i}):e[t]=i,oi=(e,t)=>{for(var i in t)It(e,i,{get:t[i],enumerable:!0})},C=(e,t,i)=>(ni(e,typeof t!="symbol"?t+"":t,i),i);function ct(e){var t,i;let r=/^( {0,3})(#{1,6})(?:([\t ]+)(.*)|$)/.exec(e);if(!r||r[2].length>3)return null;let n=r[1],o=r[2],a=(t=r[3])!=null?t:"",s=(i=r[4])!=null?i:"",p=/^(#+)[\t ]*$/.exec(s),l=/([\t ]+)(#+)([\t ]*)$/.exec(s),c=p||l;return{type:"heading",level:o.length,indent:n,marker:o,separator:a,content:p?"":c?s.slice(0,l.index):s,closing:p?s:c?l[0]:""}}function me(e){let t=/^( {0,3})([*_-])([\t *_-]*)$/.exec(e);if(!t)return null;let i=t[2],r=t[3];return[...r].some(n=>n!==i&&n!==" "&&n!=="	")||1+[...r].filter(n=>n===i).length<3?null:{type:"thematic-break",marker:i,source:e}}function dt(e){let t=/^( {0,3})>([\t ]?)(.*)$/.exec(e);return!t||t[2]===""&&t[3].startsWith(">")?null:{type:"blockquote",indent:t[1],marker:">",separator:t[2],content:t[3]}}function ve(e){let t=/^( *)([-*+])([\t ]+)(.*)$/.exec(e);if(t)return{type:"list-item",listType:"bullet",indent:t[1],marker:t[2],separator:t[3],content:t[4]};let i=/^( *)([-*+])$/.exec(e);if(i)return{type:"list-item",listType:"bullet",indent:i[1],marker:i[2],separator:"",content:""};let r=/^( *)(\d{1,9}\.)([\t ]+)(.*)$/.exec(e);if(r)return{type:"list-item",listType:"ordered",indent:r[1],marker:r[2],separator:r[3],content:r[4]};let n=/^( *)(\d{1,9}\.)$/.exec(e);return n?{type:"list-item",listType:"ordered",indent:n[1],marker:n[2],separator:"",content:""}:null}function le(e){let t=/^( {0,3})(`{3,})([^`]*)$/.exec(e);return t?{type:"fence-open",indent:t[1],marker:t[2],length:t[2].length,info:t[3].trim(),source:e}:null}function Ue(e,t){let i=/^( {0,3})(`{3,})[\t ]*$/.exec(e);return!i||i[2].length<t.length?null:{type:"fence-close",indent:i[1],marker:i[2],length:i[2].length,source:e}}var ye=/[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/,ai=/^&(?:amp|lt|gt|quot|#39);/,si={"&amp;":"&","&lt;":"<","&gt;":">","&quot;":'"',"&#39;":"'"};function li(e,t){return function(i){if(i>=e.length)return[null,0];if(t&&e.charCodeAt(i)===38){let r=ai.exec(e.slice(i,i+6));if(r)return[si[r[0]],r[0].length]}return[e[i],1]}}function _t(e,t){let i=0;for(;t>0&&e[--t]==="\\";)i++;return i%2===1}var ge=e=>e===" "||e==="	",pi=e=>e!==null&&(e.charCodeAt(0)<32||e.charCodeAt(0)===127);function ci(e,t,i,r){let[n,o]=i(t);if(n!=="(")return null;for(t+=o;ge(n=i(t)[0]);)t+=i(t)[1];let a=null;if([n,o]=i(t),n==="<"){let l=t,c="";for(t+=o;;){if([n,o]=i(t),n===null||n==="<"||n===`
`)return null;if(n==="\\"){let[d,h]=i(t+o);if(d!==null&&ye.test(d)){c+=d,t+=o+h;continue}}if(n===">"){t+=o;break}c+=n,t+=o}a={start:l,end:t,raw:e.slice(l,t),value:c}}else if(n!==")"){let l=t,c=0,d="";for(;[n,o]=i(t),!(n===null||n===`
`||ge(n));){if(pi(n))return null;if(n==="\\"){let[h,u]=i(t+o);if(h!==null&&ye.test(h)){d+=h,t+=o+u;continue}d+=n,t+=o;continue}if(n==="("){if(c++,c>r)return null;d+=n,t+=o;continue}if(n===")"){if(c===0)break;c--,d+=n,t+=o;continue}d+=n,t+=o}if(c!==0)return null;a={start:l,end:t,raw:e.slice(l,t),value:d}}let s=t;for(;ge(n=i(t)[0]);)t+=i(t)[1];let p=null;if([n,o]=i(t),n==='"'||n==="'"||n==="("){if(a&&t===s)return null;let l=n==="("?")":n,c=t,d="";for(t+=o;;){if([n,o]=i(t),n===null||n===`
`)return null;if(n==="\\"){let[h,u]=i(t+o);if(h!==null&&ye.test(h)){d+=h,t+=o+u;continue}d+=n,t+=o;continue}if(n===l){t+=o;break}if(l===")"&&n==="(")return null;d+=n,t+=o}for(p={start:c,end:t,raw:e.slice(c,t),value:d,delimiter:l===")"?"(":l};ge(n=i(t)[0]);)t+=i(t)[1]}return[n,o]=i(t),n!==")"?null:{end:t+o,destination:a,title:p}}function di(e,t,i){for(;i<e.length&&e[i].end<=t;)i++;let r=e[i];return{range:r&&r.start<=t&&t<r.end?r:null,rangeIndex:i}}function Fe(e,{htmlEntities:t=!1,maxParenDepth:i=32,ignoreRanges:r=[]}={}){let n=li(e,t),o=[...r].sort((c,d)=>c.start-d.start),a=[],s=[],p=0,l=0;for(;l<e.length;){let c=di(o,l,p);if(p=c.rangeIndex,c.range){l=c.range.end;continue}let[d,h]=n(l);if(d==="\\"){let[u,f]=n(l+h);l+=u!==null&&ye.test(u)?h+f:h;continue}if(d===`
`){s.length=0,l+=h;continue}if(d==="["){let u=l>0&&e[l-1]==="!"&&!_t(e,l-1);s.push({index:l,image:u}),l+=h;continue}if(d==="]"){let u=s.pop();if(u){let f=ci(e,l+h,n,i);if(f){a.push({start:u.index,end:f.end,image:u.image,text:{start:u.index+1,end:l,raw:e.slice(u.index+1,l)},destination:f.destination,title:f.title}),s.length=0,l=f.end;continue}}}l+=h}return a}function Re(e,t=[]){let i=[],r=[],n=0;for(;n<e.length;){if(e[n]!=="`"){n++;continue}let s=n;for(;e[n]==="`";)n++;i.push({start:s,end:n,length:n-s})}let o=new Array(i.length),a=new Map;for(let s=i.length-1;s>=0;s--){let p=i[s];o[s]=a.get(p.length),a.set(p.length,s)}for(let s=0;s<i.length;){let p=i[s],l=_t(e,p.start)||t.some(h=>p.start>=h.start&&p.start<h.end),c=o[s];if(l||c===void 0){s++;continue}let d=i[c];r.push({start:p.start,end:d.end,raw:e.slice(p.start,d.end),openTicks:e.slice(p.start,p.end),content:e.slice(p.end,d.start),closeTicks:e.slice(d.start,d.end)}),s=c+1}return r}function ui(e,t){return{...e,start:e.start+t,end:e.end+t,text:{...e.text,start:e.text.start+t,end:e.text.end+t},destination:e.destination&&{...e.destination,start:e.destination.start+t,end:e.destination.end+t},title:e.title&&{...e.title,start:e.title.start+t,end:e.title.end+t}}}function hi(e,t){if(!e.includes("["))return[];let i=Fe(e,t),r=new Set;for(;;){let n=i.map(p=>`${p.start}:${p.end}`).join(",");if(r.has(n))return i;r.add(n);let o=i.map(p=>({start:p.text.end,end:p.end})),a=Re(e,o),s=Fe(e,{...t,ignoreRanges:a});if(s.map(p=>`${p.start}:${p.end}`).join(",")===n)return s;i=s}}function fi(e,t={}){let i=[],r=e.split(`
`),n=null,o=0;for(let a of r){if(n)Ue(a,n)&&(n=null);else{let s=le(a);s?n=s:i.push(...hi(a,t).map(p=>ui(p,o)))}o+=a.length+1}return i}var mi={"&amp;":"&","&lt;":"<","&gt;":">","&quot;":'"',"&#39;":"'"},vi=/^&(amp|lt|gt|quot|#39);/,gi=/^[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]$/,yi=/^[\u00a1-\u00a9\u00ab-\u00ac\u00ae-\u00b1\u00b4\u00b6-\u00b8\u00bb\u00bf\u00d7\u00f7\u02c2-\u02c5\u02d2-\u02df\u02e5-\u02eb\u02ed\u02ef-\u02ff\u0375\u037e\u0384-\u0385\u0387\u03f6\u0482\u055a-\u055f\u0589-\u058a\u058d-\u058f\u05be\u05c0\u05c3\u05c6\u05f3-\u05f4\u0606-\u060f\u061b\u061d-\u061f\u066a-\u066d\u06d4\u06de\u06e9\u06fd-\u06fe\u0700-\u070d\u07f6-\u07f9\u07fe-\u07ff\u0830-\u083e\u085e\u0888\u0964-\u0965\u0970\u09f2-\u09f3\u09fa-\u09fb\u09fd\u0a76\u0af0-\u0af1\u0b70\u0bf3-\u0bfa\u0c77\u0c7f\u0c84\u0d4f\u0d79\u0df4\u0e3f\u0e4f\u0e5a-\u0e5b\u0f01-\u0f17\u0f1a-\u0f1f\u0f34\u0f36\u0f38\u0f3a-\u0f3d\u0f85\u0fbe-\u0fc5\u0fc7-\u0fcc\u0fce-\u0fda\u104a-\u104f\u109e-\u109f\u10fb\u1360-\u1368\u1390-\u1399\u1400\u166d-\u166e\u169b-\u169c\u16eb-\u16ed\u1735-\u1736\u17d4-\u17d6\u17d8-\u17db\u1800-\u180a\u1940\u1944-\u1945\u19de-\u19ff\u1a1e-\u1a1f\u1aa0-\u1aa6\u1aa8-\u1aad\u1b4e-\u1b4f\u1b5a-\u1b6a\u1b74-\u1b7f\u1bfc-\u1bff\u1c3b-\u1c3f\u1c7e-\u1c7f\u1cc0-\u1cc7\u1cd3\u1fbd\u1fbf-\u1fc1\u1fcd-\u1fcf\u1fdd-\u1fdf\u1fed-\u1fef\u1ffd-\u1ffe\u2010-\u2027\u2030-\u205e\u207a-\u207e\u208a-\u208e\u20a0-\u20c0\u2100-\u2101\u2103-\u2106\u2108-\u2109\u2114\u2116-\u2118\u211e-\u2123\u2125\u2127\u2129\u212e\u213a-\u213b\u2140-\u2144\u214a-\u214d\u214f\u218a-\u218b\u2190-\u2429\u2440-\u244a\u249c-\u24e9\u2500-\u2775\u2794-\u2b73\u2b76-\u2b95\u2b97-\u2bff\u2ce5-\u2cea\u2cf9-\u2cfc\u2cfe-\u2cff\u2d70\u2e00-\u2e2e\u2e30-\u2e5d\u2e80-\u2e99\u2e9b-\u2ef3\u2f00-\u2fd5\u2ff0-\u2fff\u3001-\u3004\u3008-\u3020\u3030\u3036-\u3037\u303d-\u303f\u309b-\u309c\u30a0\u30fb\u3190-\u3191\u3196-\u319f\u31c0-\u31e5\u31ef\u3200-\u321e\u322a-\u3247\u3250\u3260-\u327f\u328a-\u32b0\u32c0-\u33ff\u4dc0-\u4dff\ua490-\ua4c6\ua4fe-\ua4ff\ua60d-\ua60f\ua673\ua67e\ua6f2-\ua6f7\ua700-\ua716\ua720-\ua721\ua789-\ua78a\ua828-\ua82b\ua836-\ua839\ua874-\ua877\ua8ce-\ua8cf\ua8f8-\ua8fa\ua8fc\ua92e-\ua92f\ua95f\ua9c1-\ua9cd\ua9de-\ua9df\uaa5c-\uaa5f\uaa77-\uaa79\uaade-\uaadf\uaaf0-\uaaf1\uab5b\uab6a-\uab6b\uabeb\ufb29\ufbb2-\ufbc2\ufd3e-\ufd4f\ufdcf\ufdfc-\ufdff\ufe10-\ufe19\ufe30-\ufe52\ufe54-\ufe66\ufe68-\ufe6b\uff01-\uff0f\uff1a-\uff20\uff3b-\uff40\uff5b-\uff65\uffe0-\uffe6\uffe8-\uffee\ufffc-\ufffd]$/,bi=/^\uE000\d+\uE001/;function wi(){try{return new RegExp("^[\\p{P}\\p{S}]$","u")}catch{return yi}}var xi=wi();function ut(e){return e!==null&&(gi.test(e)||xi.test(e))}function Mt(e,t,i){if(t>=e.length)return[null,0];if(e[t]==="\uE000"){let n=bi.exec(e.slice(t));if(n)return["`",n[0].length]}if(i&&e[t]==="&"){let n=vi.exec(e.slice(t,t+6));if(n)return[mi[n[0]],n[0].length]}let r=String.fromCodePoint(e.codePointAt(t));return[r,r.length]}function ht(e,t){let i=0;for(;t>0&&e[--t]==="\\";)i++;return i%2===1}function Dt(e,t){if(e[t]!=="<")return t;let i=e.indexOf(">",t+1);return i===-1?t:i+1}function ki(e,t,i){let r=t;for(;r<e.length;){let n=Dt(e,r);if(n!==r){r=n;continue}return Mt(e,r,i)[0]}return`
`}function Ei(e,t,i){let r=/\s/u.test(t),n=/\s/u.test(i),o=ut(t),a=ut(i),s=!n&&(!a||r||o),p=!r&&(!o||n||a);return e==="_"?{canOpen:s&&(!p||o),canClose:p&&(!s||a)}:{canOpen:s,canClose:p}}function Si(e,t){let i=[],r=`
`,n=0;for(;n<e.length;){let o=Dt(e,n);if(o!==n){n=o;continue}let[a,s]=Mt(e,n,t);if((a==="*"||a==="_")&&!ht(e,n)){let p=n,l=0;for(;e[n]===a&&!ht(e,n);)l++,n++;let c=Ei(a,r,ki(e,n,t)),d={marker:a,start:p,original:l,remaining:l,usedAsOpener:0,usedAsCloser:0,...c,previous:i.length>0?i[i.length-1]:null,next:null};d.previous&&(d.previous.next=d),i.push(d),r=a;continue}r=a,n+=s}return i}function _e(e,t){t.previous?t.previous.next=t.next:e.head=t.next,t.next&&(t.next.previous=t.previous),t.previous=null,t.next=null}function Li(e,t){let i=e.next;for(;i&&i!==t;){let r=i.next;i.previous=null,i.next=null,i=r}e.next=t,t.previous=e}function Ti(e,{htmlEntities:t=!1}={}){var i;let r={head:(i=Si(e,t)[0])!=null?i:null},n=[],o=r.head;for(;o;){if(!o.canClose){o=o.next;continue}let a=o.previous;for(;a;){let d=(o.canOpen||a.canClose)&&(a.original%3!==0||o.original%3!==0)&&(a.original+o.original)%3===0;if(a.marker===o.marker&&a.canOpen&&!d)break;a=a.previous}if(!a){let d=o.next;o.canOpen||_e(r,o),o=d;continue}let s=a.remaining>=2&&o.remaining>=2?2:1,p=a.start+a.original-a.usedAsOpener-s,l=o.start+o.usedAsCloser;n.push({type:s===2?"strong":"em",openStart:p,openEnd:p+s,closeStart:l,closeEnd:l+s}),a.remaining-=s,o.remaining-=s,a.usedAsOpener+=s,o.usedAsCloser+=s,Li(a,o);let c=o.next;a.remaining===0&&_e(r,a),o.remaining===0&&(_e(r,o),o=c)}return n.sort((a,s)=>a.openStart-s.openStart||s.closeEnd-a.closeEnd)}function Me(e,t={}){let{includeEm:i=!0,includeStrong:r=!0}=t,n=Ti(e,t).filter(l=>l.type==="em"?i:r);if(n.length===0)return e;let o=new Map,a=l=>(o.has(l)||o.set(l,{openEnd:[],closeEnd:[],openStart:[],closeStart:[]}),o.get(l));for(let l of n){let c=l.type;a(l.openStart).openStart.push(`<${c}><span class="syntax-marker">`),a(l.openEnd).openEnd.push("</span>"),a(l.closeStart).closeStart.push('<span class="syntax-marker">'),a(l.closeEnd).closeEnd.push(`</span></${c}>`)}let s="",p=0;for(let l of[...o.keys()].sort((c,d)=>c-d)){s+=e.slice(p,l);let c=o.get(l);s+=c.openEnd.join(""),s+=c.closeEnd.join(""),s+=c.openStart.join(""),s+=c.closeStart.join(""),p=l}return s+e.slice(p)}function Q(e){return e.replace(/&nbsp;/g," ").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&amp;/g,"&")}var T=class{static resetLinkIndex(){this.linkIndex=0}static setCodeHighlighter(e){this.codeHighlighter=e}static setCustomSyntax(e){this.customSyntax=e}static applyCustomSyntax(e){return this.customSyntax?this.customSyntax(e):e}static escapeHtml(e){let t={"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"};return e.replace(/[&<>"']/g,i=>t[i])}static preserveIndentation(e,t){let i=t.match(/^(\s*)/)[1].replace(/ /g,"&nbsp;");return e.replace(/^\s*/,i)}static parseHeader(e){let t=ct(Q(e));if(!t)return e;let i=t.indent.replace(/ /g,"&nbsp;"),r=this.escapeHtml(t.marker+t.separator),n=this.parseInlineElements(this.escapeHtml(t.content)),o=t.closing?`<span class="syntax-marker">${this.escapeHtml(t.closing)}</span>`:"";return`<h${t.level}>${i}<span class="syntax-marker">${r}</span>${n}${o}</h${t.level}>`}static parseHorizontalRule(e){let t=Q(e);return me(t)?`<div><span class="hr-marker">${this.preserveIndentation(this.escapeHtml(t),t)}</span></div>`:null}static parseBlockquote(e){let t=dt(Q(e));if(!t)return e;let i=t.indent.replace(/ /g,"&nbsp;"),r=this.escapeHtml(t.marker),n=this.escapeHtml(t.separator),o=this.parseInlineElements(this.escapeHtml(t.content));return`${i}<span class="blockquote"><span class="syntax-marker">${r}</span>${n}${o}</span>`}static parseBulletList(e){let t=Q(e);if(me(t))return e;let i=ve(t);if(!i||i.listType!=="bullet")return e;let r=i.indent.replace(/ /g,"&nbsp;"),n=this.escapeHtml(i.marker+i.separator),o=this.parseInlineElements(this.escapeHtml(i.content));return`${r}<li class="bullet-list"><span class="syntax-marker">${n}</span>${o}</li>`}static parseTaskList(e,t=!1){return e.replace(/^((?:&nbsp;)*)-(\s+)\[([ xX])\](\s*)(.*)$/,(i,r,n,o,a,s)=>{if(a===""&&s!=="")return i;if(s=this.parseInlineElements(s),t){let p=o.toLowerCase()==="x";return`<li class="task-list">${r}<input type="checkbox" ${p?"checked":""}> ${s}</li>`}else return`<li class="task-list">${r}<span class="syntax-marker">-${n}[${o}]${a}</span>${s}</li>`})}static parseNumberedList(e){let t=ve(Q(e));if(!t||t.listType!=="ordered")return e;let i=t.indent.replace(/ /g,"&nbsp;"),r=this.escapeHtml(t.marker+t.separator),n=this.parseInlineElements(this.escapeHtml(t.content));return`${i}<li class="ordered-list"><span class="syntax-marker">${r}</span>${n}</li>`}static parseCodeBlock(e){let t=le(Q(e));return t?this.renderFence(t):null}static renderFence(e,t=!1){let i=this.preserveIndentation(this.escapeHtml(e.source),e.source);return`<div${t?' class="raw-line"':""}><span class="code-fence">${i}</span></div>`}static renderCodeContent(e,t,i,r=0,n=-1){let o=e.map(u=>{let f=0;for(;f<r&&u[f]===" ";)f++;return{source:u,prefix:u.slice(0,f),content:u.slice(f)}}),a=o.map(u=>u.content).join(`
`),s=u=>u?`<span class="syntax-marker">${this.escapeHtml(u)}</span>`:"",p=o.map((u,f)=>f===n?`<span class="raw-line">${this.escapeHtml(u.source)||"&nbsp;"}</span>`:u.prefix===""&&u.content===""?'<span class="syntax-marker">&nbsp;</span>':s(u.prefix)+this.escapeHtml(u.content)).join(`
`),l=t.split(/[\t ]/,1)[0],c=l?` class="language-${this.escapeHtml(l)}"`:"",d=i||this.codeHighlighter,h=p;if(d)try{let u=d(a,l);if(u&&typeof u.then=="function")console.warn("Async highlighters are not supported in parse() because it returns an HTML string. Use synchronous highlighters only.");else if(u&&typeof u=="string"&&u.trim()){let f=u.split(`
`);f.length===o.length+1&&f[f.length-1]===""&&f.pop(),f.length===o.length?h=f.map((m,v)=>v===n?`<span class="raw-line">${this.escapeHtml(o[v].source)||"&nbsp;"}</span>`:s(o[v].prefix)+m).join(`
`):console.warn("Code highlighter output line count does not match the source. Using unhighlighted code to preserve alignment.")}}catch(u){console.warn("Code highlighting failed:",u)}return`<pre class="code-block"><code${c}>${h}</code></pre>`}static parseBold(e){return Me(e,{htmlEntities:!0,includeEm:!1})}static parseItalic(e){return Me(e,{htmlEntities:!0,includeStrong:!1})}static parseEmphasis(e){return Me(e,{htmlEntities:!0})}static parseStrikethrough(e){return e=e.replace(new RegExp("(?<!~)~~(?!~)(.+?)(?<!~)~~(?!~)","g"),'<del><span class="syntax-marker">~~</span>$1<span class="syntax-marker">~~</span></del>'),e=e.replace(new RegExp("(?<!~)~(?!~)(.+?)(?<!~)~(?!~)","g"),'<del><span class="syntax-marker">~</span>$1<span class="syntax-marker">~</span></del>'),e}static parseInlineCode(e){let t=Re(e);for(let i of t.reverse()){let r=`<code><span class="syntax-marker">${i.openTicks}</span>${i.content}<span class="syntax-marker">${i.closeTicks}</span></code>`;e=e.slice(0,i.start)+r+e.slice(i.end)}return e}static sanitizeUrl(e){let t=e.trim(),i=t.toLowerCase(),r=["http://","https://","mailto:","ftp://","ftps://"].some(o=>i.startsWith(o)),n=t.startsWith("/")||t.startsWith("#")||t.startsWith("?")||t.startsWith(".")||!t.includes(":")&&!t.includes("//");return r||n?e:"#"}static findLinks(e,t={}){let{allowEmptyText:i=!1,...r}=t;return Fe(e,r).filter(n=>(i||n.text.raw.length>0)&&n.destination!==null&&n.destination.value.length>0)}static findRenderableLinks(e,t={}){let{allowEmptyText:i=!1,...r}=t;return fi(e,r).filter(n=>(i||n.text.raw.length>0)&&n.destination!==null&&n.destination.value.length>0)}static parseLinks(e){let t=this.findLinks(e,{htmlEntities:!0});t.forEach(i=>{i.anchorName=`--link-${this.linkIndex++}`});for(let i of t.reverse()){let r=this.escapeHtml(this.sanitizeUrl(i.destination.value)),n=i.title===null?"":` title="${this.escapeHtml(i.title.value)}"`,o=e.slice(i.text.start,i.text.end),a=e.slice(i.text.end,i.end),s=`<a href="${r}"${n} style="anchor-name: ${i.anchorName}"><span class="syntax-marker">[</span>${o}<span class="syntax-marker url-part">${a}</span></a>`;e=e.slice(0,i.start)+s+e.slice(i.end)}return e}static identifyAndProtectSanctuaries(e){let t=new Map,i=0,r=e,n=(e.includes("[")?this.findRenderableLinks(e,{htmlEntities:!0}):[]).map(s=>({start:s.text.end,end:s.end})),o=Re(e,n);o.sort((s,p)=>p.start-s.start),o.forEach(s=>{let p=`\uE000${i++}\uE001`;t.set(p,{type:"code",original:s.raw,openTicks:s.openTicks,content:s.content,closeTicks:s.closeTicks}),r=r.substring(0,s.start)+p+r.substring(s.end)});let a=[...t.keys()];return(r.includes("[")?this.findLinks(r,{htmlEntities:!0}):[]).filter(s=>{let p=r.slice(s.text.end,s.end);return a.every(l=>!p.includes(l))}).sort((s,p)=>p.start-s.start).forEach(s=>{var p,l;let c=`\uE000${i++}\uE001`;t.set(c,{type:"link",original:r.slice(s.start,s.end),linkText:r.slice(s.text.start,s.text.end),tail:r.slice(s.text.end,s.end),url:s.destination.value,title:(l=(p=s.title)==null?void 0:p.value)!=null?l:null}),r=r.slice(0,s.start)+c+r.slice(s.end)}),{protectedText:r,sanctuaries:t}}static restoreAndTransformSanctuaries(e,t){return Array.from(t.keys()).sort((i,r)=>{let n=e.indexOf(i),o=e.indexOf(r);return n-o}).forEach(i=>{let r=t.get(i),n;if(r.type==="code")n=`<code><span class="syntax-marker">${r.openTicks}</span>${r.content}<span class="syntax-marker">${r.closeTicks}</span></code>`;else if(r.type==="link"){let o=r.linkText;o=this.parseStrikethrough(o),o=this.parseEmphasis(o),t.forEach((l,c)=>{if(o.includes(c)&&l.type==="code"){let d=`<code><span class="syntax-marker">${l.openTicks}</span>${l.content}<span class="syntax-marker">${l.closeTicks}</span></code>`;o=o.replace(c,()=>d)}});let a=`--link-${this.linkIndex++}`,s=this.escapeHtml(this.sanitizeUrl(r.url)),p=r.title===null?"":` title="${this.escapeHtml(r.title)}"`;n=`<a href="${s}"${p} style="anchor-name: ${a}"><span class="syntax-marker">[</span>${o}<span class="syntax-marker url-part">${r.tail}</span></a>`}e=e.replace(i,()=>n)}),e}static parseInlineElements(e){let{protectedText:t,sanctuaries:i}=this.identifyAndProtectSanctuaries(e),r=t;return r=this.parseStrikethrough(r),r=this.parseEmphasis(r),r=this.restoreAndTransformSanctuaries(r,i),r}static parseLine(e,t=!1){if(e==="")return"<div>&nbsp;</div>";if(me(e))return`<div><span class="hr-marker">${this.preserveIndentation(this.escapeHtml(e),e)}</span></div>`;let i=le(e);if(i)return this.renderFence(i);let r=ct(e);if(r){let l=r.indent.replace(/ /g,"&nbsp;"),c=this.escapeHtml(r.marker+r.separator),d=this.parseInlineElements(this.escapeHtml(r.content)),h=r.closing?`<span class="syntax-marker">${this.escapeHtml(r.closing)}</span>`:"";return`<div><h${r.level}>${l}<span class="syntax-marker">${c}</span>${d}${h}</h${r.level}></div>`}let n=dt(e);if(n){let l=n.indent.replace(/ /g,"&nbsp;"),c=this.escapeHtml(n.marker),d=this.escapeHtml(n.separator),h=this.parseInlineElements(this.escapeHtml(n.content));return`<div>${l}<span class="blockquote"><span class="syntax-marker">${c}</span>${d}${h}</span></div>`}let o=this.preserveIndentation(this.escapeHtml(e),e),a=this.parseTaskList(o,t);if(a!==o)return`<div>${a}</div>`;let s=ve(e);if(s){let l=s.indent.replace(/ /g,"&nbsp;"),c=this.escapeHtml(s.marker+s.separator),d=this.parseInlineElements(this.escapeHtml(s.content)),h=s.listType==="bullet"?"bullet-list":"ordered-list";return`<div>${l}<li class="${h}"><span class="syntax-marker">${c}</span>${d}</li></div>`}let p=/^[\t ]*/.exec(e)[0];return o=p.replace(/ /g,"&nbsp;")+this.parseInlineElements(this.escapeHtml(e.slice(p.length))),`<div>${o}</div>`}static parse(e,t=-1,i=!1,r,n=!1){this.resetLinkIndex();let o=e.split(`
`),a=[],s=null,p=[],l=-1;for(let d=0;d<o.length;d++){let h=o[d],u=i&&d===t;if(s){let m=Ue(h,s);if(m){a.push(this.renderCodeContent(p,s.info,r,s.indent.length,l));let v=this.renderFence(m,u);a.push(u?v:this.applyCustomSyntax(v)),s=null,p=[],l=-1}else u&&(l=p.length),p.push(h);continue}let f=le(h);if(f){s=f;let m=this.renderFence(f,u);a.push(u?m:this.applyCustomSyntax(m));continue}if(u){let m=this.escapeHtml(h)||"&nbsp;";a.push(`<div class="raw-line">${m}</div>`);continue}a.push(this.applyCustomSyntax(this.parseLine(h,n)))}s&&p.length>0&&a.push(this.renderCodeContent(p,s.info,r,s.indent.length,l));let c=a.join("");return this.postProcessHTML(c,r,!1)}static postProcessHTML(e,t,i=!0){return this.postProcessHTMLManual(e,t,i)}static postProcessHTMLManual(e,t,i=!0){let r=e;r=r.replace(/((?:<div(?:\s[^>]*)?>(?:&nbsp;)*<li class="bullet-list">.*?<\/li><\/div>\s*)+)/gs,o=>{let a=o.match(/<div(?:\s[^>]*)?>(?:&nbsp;)*<li class="bullet-list">.*?<\/li><\/div>/gs)||[];return a.length>0?"<ul>"+a.map(s=>{let p=s.match(/<div(?:\s[^>]*)?>((?:&nbsp;)*)<li/),l=s.match(/<li class="bullet-list">.*?<\/li>/);if(p&&l){let c=p[1];return l[0].replace(/<li class="bullet-list">/,`<li class="bullet-list">${c}`)}return l?l[0]:""}).filter(Boolean).join("")+"</ul>":o}),r=r.replace(/((?:<div(?:\s[^>]*)?>(?:&nbsp;)*<li class="ordered-list">.*?<\/li><\/div>\s*)+)/gs,o=>{let a=o.match(/<div(?:\s[^>]*)?>(?:&nbsp;)*<li class="ordered-list">.*?<\/li><\/div>/gs)||[];if(a.length>0){let s=a.map(c=>{let d=c.match(/<div(?:\s[^>]*)?>((?:&nbsp;)*)<li/),h=c.match(/<li class="ordered-list">.*?<\/li>/);if(d&&h){let u=d[1];return h[0].replace(/<li class="ordered-list">/,`<li class="ordered-list">${u}`)}return h?h[0]:""}).filter(Boolean),p=a[0].match(/<span class="syntax-marker">(\d+)\./),l=p?Number.parseInt(p[1],10):1;return`<ol${l===1?"":` start="${l}"`}>`+s.join("")+"</ol>"}return o});let n=/<div><span class="code-fence">(```[^<]*)<\/span><\/div>(.*?)<div><span class="code-fence">(```)<\/span><\/div>/gs;return i&&(r=r.replace(n,(o,a,s,p)=>{if(s.includes('<pre class="code-block">'))return o;let l=(s.match(/<div>(.*?)<\/div>/gs)||[]).map(y=>y.replace(/<div>(.*?)<\/div>/s,"$1")),c=l.map(y=>y==="&nbsp;"?"":y.replace(/&nbsp;/g," ")).join(`
`),d=l.join(`
`),h=a.slice(3).trim(),u=h?` class="language-${h}"`:"",f=d,m=t||this.codeHighlighter;if(m)try{let y=c.replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&amp;/g,"&"),b=m(y,h);b&&typeof b.then=="function"?console.warn("Async highlighters are not supported in Node.js (non-DOM) context. Use synchronous highlighters for server-side rendering."):b&&typeof b=="string"&&b.trim()&&(f=b)}catch(y){console.warn("Code highlighting failed:",y)}let v=`<div><span class="code-fence">${a}</span></div>`;return v+=`<pre class="code-block"><code${u}>${f}</code></pre>`,v+=`<div><span class="code-fence">${p}</span></div>`,v})),r}static getListContext(e,t){let i=e.split(`
`),r=0,n=0,o=0;for(let d=0;d<i.length;d++){let h=i[d].length;if(r+h>=t){n=d,o=r;break}r+=h+1}let a=i[n],s=o+a.length,p={inList:!1,listType:null,indent:"",marker:null,content:a,lineStart:o,lineEnd:s,markerEndPos:o};if(me(a))return p;let l=ve(a);if(!l)return p;let c=l.listType==="bullet"&&l.marker==="-"?/^\[([ xX])\]([\t ]*)(.*)$/.exec(l.content):null;return c&&(c[2]!==""||c[3]==="")?{inList:!0,listType:"checkbox",indent:l.indent,marker:"-",checked:c[1].toLowerCase()==="x",content:c[3],lineStart:o,lineEnd:s,markerEndPos:o+l.indent.length+l.marker.length+l.separator.length+3+c[2].length}:l.listType==="bullet"?{inList:!0,listType:"bullet",indent:l.indent,marker:l.marker,content:l.content,lineStart:o,lineEnd:s,markerEndPos:o+l.indent.length+l.marker.length+l.separator.length}:{inList:!0,listType:"numbered",indent:l.indent,marker:Number.parseInt(l.marker,10),content:l.content,lineStart:o,lineEnd:s,markerEndPos:o+l.indent.length+l.marker.length+l.separator.length}}static createNewListItem(e){switch(e.listType){case"bullet":return`${e.indent}${e.marker} `;case"numbered":return`${e.indent}${e.marker+1}. `;case"checkbox":return`${e.indent}- [ ] `;default:return""}}static renumberLists(e){let t=e.split(`
`),i=new Map,r=!1;return t.map(n=>{let o=n.match(this.LIST_PATTERNS.numbered);if(o){let a=o[1],s=a.length,p=o[3];r||i.clear();let l=(i.get(s)||0)+1;i.set(s,l);for(let[c]of i)c>s&&i.delete(c);return r=!0,`${a}${l}. ${p}`}else return(n.trim()===""||!n.match(/^\s/))&&(r=!1,i.clear()),n}).join(`
`)}};C(T,"linkIndex",0);C(T,"codeHighlighter",null);C(T,"customSyntax",null);C(T,"LIST_PATTERNS",{bullet:/^( *)([-*+])[\t ]+(.*)$/,numbered:/^( *)(\d{1,9})\.[\t ]+(.*)$/,checkbox:/^( *)-[\t ]+\[([ xX])\][\t ]+(.*)$/});var Pt=class{constructor(e){this.editor=e}handleKeydown(e){if(!(navigator.platform.toLowerCase().includes("mac")?e.metaKey:e.ctrlKey))return!1;if(e.key==="]")return e.preventDefault(),this.editor.indentSelection(),!0;if(e.key==="[")return e.preventDefault(),this.editor.outdentSelection(),!0;let t=null;switch(e.key.toLowerCase()){case"b":e.shiftKey||(t="toggleBold");break;case"i":e.shiftKey||(t="toggleItalic");break;case"k":e.shiftKey||(t="insertLink");break;case"7":e.shiftKey&&(t="toggleNumberedList");break;case"8":e.shiftKey&&(t="toggleBulletList");break}return t?(e.preventDefault(),this.editor.performAction(t,e),!0):!1}destroy(){}},U={name:"solar",colors:{bgPrimary:"#faf0ca",bgSecondary:"#ffffff",text:"#0d3b66",textPrimary:"#0d3b66",textSecondary:"#5a7a9b",h1:"#f95738",h2:"#ee964b",h3:"#3d8a51",strong:"#ee964b",em:"#f95738",del:"#ee964b",link:"#0d3b66",code:"#0d3b66",codeBg:"rgba(244, 211, 94, 0.4)",blockquote:"#5a7a9b",hr:"#5a7a9b",syntaxMarker:"rgba(13, 59, 102, 0.52)",syntax:"#999999",cursor:"#f95738",selection:"rgba(244, 211, 94, 0.4)",listMarker:"#ee964b",rawLine:"#5a7a9b",border:"#e0e0e0",hoverBg:"#f0f0f0",primary:"#0d3b66",toolbarBg:"#ffffff",toolbarIcon:"#0d3b66",toolbarHover:"#f5f5f5",toolbarActive:"#faf0ca",placeholder:"#999999"},previewColors:{text:"#0d3b66",h1:"inherit",h2:"inherit",h3:"inherit",strong:"inherit",em:"inherit",link:"#0d3b66",code:"#0d3b66",codeBg:"rgba(244, 211, 94, 0.4)",blockquote:"#5a7a9b",hr:"#5a7a9b",bg:"transparent"}},ft={name:"cave",colors:{bgPrimary:"#141E26",bgSecondary:"#1D2D3E",text:"#c5dde8",textPrimary:"#c5dde8",textSecondary:"#9fcfec",h1:"#d4a5ff",h2:"#f6ae2d",h3:"#9fcfec",strong:"#f6ae2d",em:"#9fcfec",del:"#f6ae2d",link:"#9fcfec",code:"#c5dde8",codeBg:"#1a232b",blockquote:"#9fcfec",hr:"#c5dde8",syntaxMarker:"rgba(159, 207, 236, 0.73)",syntax:"#7a8c98",cursor:"#f26419",selection:"rgba(51, 101, 138, 0.4)",listMarker:"#f6ae2d",rawLine:"#9fcfec",border:"#2a3f52",hoverBg:"#243546",primary:"#9fcfec",toolbarBg:"#1D2D3E",toolbarIcon:"#c5dde8",toolbarHover:"#243546",toolbarActive:"#2a3f52",placeholder:"#6a7a88"},previewColors:{text:"#c5dde8",h1:"inherit",h2:"inherit",h3:"inherit",strong:"inherit",em:"inherit",link:"#9fcfec",code:"#c5dde8",codeBg:"#1a232b",blockquote:"#9fcfec",hr:"#c5dde8",bg:"transparent"}},mt={solar:U,cave:ft,auto:U,light:U,dark:ft};function K(e){return typeof e=="string"?{...mt[e]||mt.solar,name:e}:e}function vt(e){return e!=="auto"?e:(window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)"))?.matches?"cave":"solar"}function se(e,t){let i=[];for(let[r,n]of Object.entries(e)){let o=r.replace(/([A-Z])/g,"-$1").toLowerCase();i.push(`--${o}: ${n};`)}if(t)for(let[r,n]of Object.entries(t)){let o=r.replace(/([A-Z])/g,"-$1").toLowerCase();i.push(`--preview-${o}-default: ${n};`)}return i.join(`
`)}function Ci(e,t={},i={}){return{...e,colors:{...e.colors,...t},previewColors:{...e.previewColors,...i}}}var N={fontSize:"14px",lineHeight:1.6,fontFamily:'"SF Mono", SFMono-Regular, Menlo, Monaco, "Cascadia Code", Consolas, "Roboto Mono", "Noto Sans Mono", "Droid Sans Mono", "Ubuntu Mono", "DejaVu Sans Mono", "Liberation Mono", "Courier New", Courier, monospace',padding:"20px"};function Ai(e={}){let{fontSize:t=N.fontSize,lineHeight:i=N.lineHeight,fontFamily:r=N.fontFamily,padding:n=N.padding,theme:o=null,mobile:a={}}=e,s=Object.keys(a).length>0?`
    @media (max-width: 640px) {
      .overtype-wrapper .overtype-input,
      .overtype-wrapper .overtype-preview {
        ${Object.entries(a).map(([l,c])=>`${l.replace(/([A-Z])/g,"-$1").toLowerCase()}: ${c} !important;`).join(`
        `)}
      }
    }
  `:"",p=o&&o.colors?se(o.colors,o.previewColors):"";return`
    /* OverType Editor Styles */
    
    /* Middle-ground CSS Reset - Prevent parent styles from leaking in */
    .overtype-container * {
      /* Box model - these commonly leak */
      margin: 0 !important;
      padding: 0 !important;
      border: 0 !important;
      
      /* Layout - these can break our layout */
      /* Don't reset position - it breaks dropdowns */
      float: none !important;
      clear: none !important;
      
      /* Typography - only reset decorative aspects */
      text-decoration: none !important;
      text-transform: none !important;
      letter-spacing: normal !important;
      
      /* Visual effects that can interfere */
      box-shadow: none !important;
      text-shadow: none !important;
      
      /* Ensure box-sizing is consistent */
      box-sizing: border-box !important;
      
      /* Keep inheritance for these */
      /* font-family, color, line-height, font-size - inherit */
    }
    
    /* Container base styles after reset */
    .overtype-container {
      display: flex !important;
      flex-direction: column !important;
      width: 100% !important;
      height: 100% !important;
      position: relative !important; /* Override reset - needed for absolute children */
      overflow: visible !important; /* Allow dropdown to overflow container */
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
      text-align: left !important;
      ${p?`
      /* Theme Variables */
      ${p}`:""}
    }
    
    /* Force left alignment for all elements in the editor */
    .overtype-container .overtype-wrapper * {
      text-align: left !important;
    }
    
    /* Auto-resize mode styles */
    .overtype-container.overtype-auto-resize {
      height: auto !important;
    }

    .overtype-container.overtype-auto-resize .overtype-wrapper {
      flex: 0 0 auto !important; /* Don't grow/shrink, use explicit height */
      height: auto !important;
      min-height: 60px !important;
      overflow: visible !important;
    }
    
    .overtype-wrapper {
      position: relative !important; /* Override reset - needed for absolute children */
      width: 100% !important;
      flex: 1 1 0 !important; /* Grow to fill remaining space, with flex-basis: 0 */
      min-height: 60px !important; /* Minimum usable height */
      overflow: hidden !important;
      background: var(--bg-secondary, #ffffff) !important;
      z-index: 1; /* Below toolbar and dropdown */
    }

    /* Critical alignment styles - must be identical for both layers */
    .overtype-wrapper .overtype-input,
    .overtype-wrapper .overtype-preview {
      /* Positioning - must be identical */
      position: absolute !important; /* Override reset - required for overlay */
      top: 0 !important;
      left: 0 !important;
      width: 100% !important;
      height: 100% !important;

      /* Font properties - any difference breaks alignment */
      font-family: var(--instance-font-family, ${r}) !important;
      font-variant-ligatures: none !important; /* keep metrics stable for code */
      font-size: var(--instance-font-size, ${t}) !important;
      line-height: var(--instance-line-height, ${i}) !important;
      font-weight: normal !important;
      font-style: normal !important;
      font-variant: normal !important;
      font-stretch: normal !important;
      font-kerning: none !important;
      font-feature-settings: normal !important;
      
      /* Box model - must match exactly */
      padding: var(--instance-padding, ${n}) !important;
      margin: 0 !important;
      border: none !important;
      outline: none !important;
      box-sizing: border-box !important;
      
      /* Text layout - critical for character positioning */
      white-space: pre-wrap !important;
      word-wrap: break-word !important;
      word-break: normal !important;
      overflow-wrap: break-word !important;
      tab-size: 2 !important;
      -moz-tab-size: 2 !important;
      text-align: left !important;
      text-indent: 0 !important;
      letter-spacing: normal !important;
      word-spacing: normal !important;
      
      /* Text rendering */
      text-transform: none !important;
      text-rendering: auto !important;
      -webkit-font-smoothing: auto !important;
      -webkit-text-size-adjust: 100% !important;
      
      /* Direction and writing */
      direction: ltr !important;
      writing-mode: horizontal-tb !important;
      unicode-bidi: normal !important;
      text-orientation: mixed !important;
      
      /* Visual effects that could shift perception */
      text-shadow: none !important;
      filter: none !important;
      transform: none !important;
      zoom: 1 !important;
      
      /* Vertical alignment */
      vertical-align: baseline !important;
      
      /* Size constraints */
      min-width: 0 !important;
      min-height: 0 !important;
      max-width: none !important;
      max-height: none !important;
      
      /* Overflow */
      overflow-y: auto !important;
      overflow-x: auto !important;
      /* overscroll-behavior removed to allow scroll-through to parent */
      scrollbar-width: auto !important;
      scrollbar-gutter: auto !important;
      
      /* Animation/transition - disabled to prevent movement */
      animation: none !important;
      transition: none !important;
    }

    /* Input layer styles */
    .overtype-wrapper .overtype-input {
      /* Layer positioning */
      z-index: 1 !important;
      
      /* Text visibility */
      color: transparent !important;
      caret-color: var(--cursor, #f95738) !important;
      background-color: transparent !important;
      
      /* Textarea-specific */
      resize: none !important;
      appearance: none !important;
      -webkit-appearance: none !important;
      -moz-appearance: none !important;
      
      /* Prevent mobile zoom on focus */
      touch-action: manipulation !important;
      
      /* Disable autofill */
      autocomplete: off !important;
      autocorrect: off !important;
      autocapitalize: off !important;
    }

    .overtype-wrapper .overtype-input::selection {
      background-color: var(--selection, rgba(244, 211, 94, 0.4));
    }

    .overtype-wrapper .overtype-input::placeholder {
      color: transparent !important;
    }

    /* Placeholder shim - visible when textarea is empty */
    .overtype-wrapper .overtype-placeholder {
      position: absolute !important;
      top: 0 !important;
      left: 0 !important;
      width: 100% !important;
      z-index: 0 !important;
      pointer-events: none !important;
      user-select: none !important;
      font-family: var(--instance-font-family, ${r}) !important;
      font-size: var(--instance-font-size, ${t}) !important;
      line-height: var(--instance-line-height, ${i}) !important;
      padding: var(--instance-padding, ${n}) !important;
      box-sizing: border-box !important;
      color: var(--placeholder, #999) !important;
    }

    /* Preview layer styles */
    .overtype-wrapper .overtype-preview {
      /* Layer positioning */
      z-index: 0 !important;
      pointer-events: none !important;
      color: var(--text, #0d3b66) !important;
      background-color: transparent !important;
      
      /* Prevent text selection */
      user-select: none !important;
      -webkit-user-select: none !important;
      -moz-user-select: none !important;
      -ms-user-select: none !important;
    }

    /* Prevent external resets (Tailwind, Bootstrap, etc.) from breaking alignment.
       Any element whose font metrics differ from the textarea causes the CSS "strut"
       to inflate line boxes, drifting the overlay. Force inheritance so every element
       inside the preview matches the textarea exactly. */
    .overtype-wrapper .overtype-preview * {
      font-family: inherit !important;
      font-size: inherit !important;
      line-height: inherit !important;
    }

    /* Defensive styles for preview child divs */
    .overtype-wrapper .overtype-preview div {
      /* Reset any inherited styles */
      margin: 0 !important;
      padding: 0 !important;
      border: none !important;
      text-align: left !important;
      text-indent: 0 !important;
      display: block !important;
      position: static !important;
      transform: none !important;
      min-height: 0 !important;
      max-height: none !important;
      line-height: inherit !important;
      font-size: inherit !important;
      font-family: inherit !important;
    }

    /* Markdown element styling - NO SIZE CHANGES */
    .overtype-wrapper .overtype-preview .header {
      font-weight: bold !important;
    }

    /* Header colors */
    .overtype-wrapper .overtype-preview .h1 { 
      color: var(--h1, #f95738) !important; 
    }
    .overtype-wrapper .overtype-preview .h2 { 
      color: var(--h2, #ee964b) !important; 
    }
    .overtype-wrapper .overtype-preview .h3 { 
      color: var(--h3, #3d8a51) !important; 
    }

    /* Semantic headers - flatten in edit mode */
    .overtype-wrapper .overtype-preview h1,
    .overtype-wrapper .overtype-preview h2,
    .overtype-wrapper .overtype-preview h3 {
      font-size: inherit !important;
      font-weight: bold !important;
      margin: 0 !important;
      padding: 0 !important;
      display: inline !important;
      line-height: inherit !important;
    }

    /* Header colors for semantic headers */
    .overtype-wrapper .overtype-preview h1 { 
      color: var(--h1, #f95738) !important; 
    }
    .overtype-wrapper .overtype-preview h2 { 
      color: var(--h2, #ee964b) !important; 
    }
    .overtype-wrapper .overtype-preview h3 { 
      color: var(--h3, #3d8a51) !important; 
    }

    /* Lists - remove styling in edit mode */
    .overtype-wrapper .overtype-preview ul,
    .overtype-wrapper .overtype-preview ol {
      list-style: none !important;
      margin: 0 !important;
      padding: 0 !important;
      display: block !important; /* Lists need to be block for line breaks */
    }

    .overtype-wrapper .overtype-preview li {
      display: block !important; /* Each item on its own line */
      margin: 0 !important;
      padding: 0 !important;
      /* Don't set list-style here - let ul/ol control it */
    }

    /* Bold text */
    .overtype-wrapper .overtype-preview strong {
      color: var(--strong, #ee964b) !important;
      font-weight: bold !important;
    }

    /* Italic text */
    .overtype-wrapper .overtype-preview em {
      color: var(--em, #f95738) !important;
      text-decoration-color: var(--em, #f95738) !important;
      text-decoration-thickness: 1px !important;
      font-style: italic !important;
    }

    /* Strikethrough text */
    .overtype-wrapper .overtype-preview del {
      color: var(--del, #ee964b) !important;
      text-decoration: line-through !important;
      text-decoration-color: var(--del, #ee964b) !important;
      text-decoration-thickness: 1px !important;
    }

    /* Inline code */
    .overtype-wrapper .overtype-preview code {
      background: var(--code-bg, rgba(244, 211, 94, 0.4)) !important;
      color: var(--code, #0d3b66) !important;
      padding: 0 !important;
      border-radius: 2px !important;
      font-family: inherit !important;
      font-size: inherit !important;
      line-height: inherit !important;
      font-weight: normal !important;
    }

    /* Code blocks - consolidated pre blocks */
    .overtype-wrapper .overtype-preview pre {
      padding: 0 !important;
      margin: 0 !important;
      border-radius: 4px !important;
      overflow-x: auto !important;
    }
    
    /* Code block styling in normal mode - yellow background */
    .overtype-wrapper .overtype-preview pre.code-block {
      background: var(--code-bg, rgba(244, 211, 94, 0.4)) !important;
      white-space: break-spaces !important; /* Prevent horizontal scrollbar that breaks alignment */
    }

    /* Code inside pre blocks - remove background */
    .overtype-wrapper .overtype-preview pre code {
      background: transparent !important;
      color: var(--code, #0d3b66) !important;
      font-family: var(--instance-font-family, ${r}) !important; /* Match textarea font exactly for alignment */
    }

    /* Blockquotes */
    .overtype-wrapper .overtype-preview .blockquote {
      color: var(--blockquote, #5a7a9b) !important;
      padding: 0 !important;
      margin: 0 !important;
      border: none !important;
    }

    /* Links */
    .overtype-wrapper .overtype-preview a {
      color: var(--link, #0d3b66) !important;
      text-decoration: underline !important;
      font-weight: normal !important;
    }

    .overtype-wrapper .overtype-preview a:hover {
      text-decoration: underline !important;
      color: var(--link, #0d3b66) !important;
    }

    /* Lists - no list styling */
    .overtype-wrapper .overtype-preview ul,
    .overtype-wrapper .overtype-preview ol {
      list-style: none !important;
      margin: 0 !important;
      padding: 0 !important;
    }


    /* Horizontal rules */
    .overtype-wrapper .overtype-preview hr {
      border: none !important;
      color: var(--hr, #5a7a9b) !important;
      margin: 0 !important;
      padding: 0 !important;
    }

    .overtype-wrapper .overtype-preview .hr-marker {
      color: var(--hr, #5a7a9b) !important;
      opacity: 0.6 !important;
    }

    /* Code fence markers - with background when not in code block */
    .overtype-wrapper .overtype-preview .code-fence {
      color: var(--code, #0d3b66) !important;
      background: var(--code-bg, rgba(244, 211, 94, 0.4)) !important;
    }
    
    /* Code block lines - background for entire code block */
    .overtype-wrapper .overtype-preview .code-block-line {
      background: var(--code-bg, rgba(244, 211, 94, 0.4)) !important;
    }
    
    /* Remove background from code fence when inside code block line */
    .overtype-wrapper .overtype-preview .code-block-line .code-fence {
      background: transparent !important;
    }

    /* Raw markdown line */
    .overtype-wrapper .overtype-preview .raw-line {
      color: var(--raw-line, #5a7a9b) !important;
      font-style: normal !important;
      font-weight: normal !important;
    }

    /* Syntax markers */
    .overtype-wrapper .overtype-preview .syntax-marker {
      color: var(--syntax-marker, rgba(13, 59, 102, 0.52)) !important;
      opacity: 0.7 !important;
    }

    /* List markers */
    .overtype-wrapper .overtype-preview .list-marker {
      color: var(--list-marker, #ee964b) !important;
    }

    /* Stats bar */
    
    /* Stats bar - positioned by flexbox */
    .overtype-stats {
      height: 40px !important;
      padding: 0 20px !important;
      background: var(--bg-secondary, #f8f9fa) !important;
      border-top: 1px solid var(--border, #e0e0e0) !important;
      display: flex !important;
      justify-content: space-between !important;
      align-items: center !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
      font-size: 0.85rem !important;
      color: var(--text-secondary, #666) !important;
      flex-shrink: 0 !important; /* Don't shrink */
      z-index: 10001 !important; /* Above link tooltip */
      position: relative !important; /* Enable z-index */
    }


    .overtype-stats .overtype-stat {
      display: flex !important;
      align-items: center !important;
      gap: 5px !important;
      white-space: nowrap !important;
    }
    
    .overtype-stats .live-dot {
      width: 8px !important;
      height: 8px !important;
      background: #4caf50 !important;
      border-radius: 50% !important;
      animation: overtype-pulse 2s infinite !important;
    }
    
    @keyframes overtype-pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.6; transform: scale(1.2); }
    }
    

    /* Toolbar Styles */
    .overtype-toolbar.overtype-toolbar-hidden {
      display: none !important;
    }

    .overtype-toolbar {
      display: flex !important;
      align-items: center !important;
      gap: 4px !important;
      padding: 8px !important; /* Override reset */
      background: var(--toolbar-bg, var(--bg-primary, #f8f9fa)) !important; /* Override reset */
      border-bottom: 1px solid var(--toolbar-border, transparent) !important; /* Override reset */
      overflow-x: auto !important; /* Allow horizontal scrolling */
      overflow-y: hidden !important; /* Hide vertical overflow */
      -webkit-overflow-scrolling: touch !important;
      flex-shrink: 0 !important;
      height: auto !important;
      position: relative !important; /* Override reset */
      z-index: 100 !important; /* Ensure toolbar is above wrapper */
      scrollbar-width: thin; /* Thin scrollbar on Firefox */
    }
    
    /* Thin scrollbar styling */
    .overtype-toolbar::-webkit-scrollbar {
      height: 4px;
    }
    
    .overtype-toolbar::-webkit-scrollbar-track {
      background: transparent;
    }
    
    .overtype-toolbar::-webkit-scrollbar-thumb {
      background: rgba(0, 0, 0, 0.2);
      border-radius: 2px;
    }

    .overtype-toolbar-button {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      padding: 0;
      border: none;
      border-radius: 6px;
      background: transparent;
      color: var(--toolbar-icon, var(--text-secondary, #666));
      cursor: pointer;
      transition: all 0.2s ease;
      flex-shrink: 0;
    }

    .overtype-toolbar-button svg {
      width: 20px;
      height: 20px;
      fill: currentColor;
    }

    .overtype-toolbar-button:hover {
      background: var(--toolbar-hover, var(--bg-secondary, #e9ecef));
      color: var(--toolbar-icon, var(--text-primary, #333));
    }

    .overtype-toolbar-button:active {
      transform: scale(0.95);
    }

    .overtype-toolbar-button.active {
      background: var(--toolbar-active, var(--primary, #007bff));
      color: var(--toolbar-icon, var(--text-primary, #333));
    }

    .overtype-toolbar-button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .overtype-toolbar-separator {
      width: 1px;
      height: 24px;
      background: var(--border, #e0e0e0);
      margin: 0 4px;
      flex-shrink: 0;
    }

    /* Adjust wrapper when toolbar is present */
    /* Mobile toolbar adjustments */
    @media (max-width: 640px) {
      .overtype-toolbar {
        padding: 6px;
        gap: 2px;
      }

      .overtype-toolbar-button {
        width: 36px;
        height: 36px;
      }

      .overtype-toolbar-separator {
        margin: 0 2px;
      }
    }
    
    /* Plain mode - hide preview and show textarea text */
    .overtype-container[data-mode="plain"] .overtype-preview {
      display: none !important;
    }
    
    .overtype-container[data-mode="plain"] .overtype-input {
      color: var(--text, #0d3b66) !important;
      /* Use system font stack for better plain text readability */
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, 
                   "Helvetica Neue", Arial, sans-serif !important;
    }
    
    /* Ensure textarea remains transparent in overlay mode */
    .overtype-container:not([data-mode="plain"]) .overtype-input {
      color: transparent !important;
    }

    /* Dropdown menu styles */
    .overtype-toolbar-button {
      position: relative !important; /* Override reset - needed for dropdown */
    }

    .overtype-toolbar-button.dropdown-active {
      background: var(--toolbar-active, var(--hover-bg, #f0f0f0));
    }

    .overtype-dropdown-menu {
      position: fixed !important; /* Fixed positioning relative to viewport */
      background: var(--bg-secondary, white) !important; /* Override reset */
      border: 1px solid var(--border, #e0e0e0) !important; /* Override reset */
      border-radius: 6px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1) !important; /* Override reset */
      z-index: 10000; /* Very high z-index to ensure visibility */
      min-width: 150px;
      padding: 4px 0 !important; /* Override reset */
      /* Position will be set via JavaScript based on button position */
    }

    .overtype-dropdown-item {
      display: flex;
      align-items: center;
      width: 100%;
      padding: 8px 12px;
      border: none;
      background: none;
      text-align: left;
      cursor: pointer;
      font-size: 14px;
      color: var(--text, #333);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }

    .overtype-dropdown-item:hover {
      background: var(--hover-bg, #f0f0f0);
    }

    .overtype-dropdown-item.active {
      font-weight: 600;
    }

    .overtype-dropdown-check {
      width: 16px;
      margin-right: 8px;
      color: var(--h1, #007bff);
    }

    .overtype-dropdown-icon {
      width: 20px;
      margin-right: 8px;
      text-align: center;
    }

    /* Preview mode styles */
    .overtype-container[data-mode="preview"] .overtype-input {
      display: none !important;
    }

    .overtype-container[data-mode="preview"] .overtype-preview {
      pointer-events: auto !important;
      user-select: text !important;
      cursor: text !important;
    }

    .overtype-container.overtype-auto-resize[data-mode="preview"] .overtype-preview {
      position: static !important;
      height: auto !important;
    }

    /* Hide syntax markers in preview mode */
    .overtype-container[data-mode="preview"] .syntax-marker {
      display: none !important;
    }
    
    /* Hide URL part of links in preview mode - extra specificity */
    .overtype-container[data-mode="preview"] .syntax-marker.url-part,
    .overtype-container[data-mode="preview"] .url-part {
      display: none !important;
    }
    
    /* Hide all syntax markers inside links too */
    .overtype-container[data-mode="preview"] a .syntax-marker {
      display: none !important;
    }

    /* Headers - restore proper sizing in preview mode */
    .overtype-container[data-mode="preview"] .overtype-wrapper .overtype-preview h1,
    .overtype-container[data-mode="preview"] .overtype-wrapper .overtype-preview h2,
    .overtype-container[data-mode="preview"] .overtype-wrapper .overtype-preview h3 {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
      font-weight: 600 !important;
      margin: 0 !important;
      display: block !important;
      line-height: 1 !important;
    }

    .overtype-container[data-mode="preview"] .overtype-wrapper .overtype-preview h1 {
      font-size: 2em !important;
      color: var(--preview-h1, var(--preview-h1-default)) !important;
    }

    .overtype-container[data-mode="preview"] .overtype-wrapper .overtype-preview h2 {
      font-size: 1.5em !important;
      color: var(--preview-h2, var(--preview-h2-default)) !important;
    }

    .overtype-container[data-mode="preview"] .overtype-wrapper .overtype-preview h3 {
      font-size: 1.17em !important;
      color: var(--preview-h3, var(--preview-h3-default)) !important;
    }

    /* Lists - restore list styling in preview mode */
    .overtype-container[data-mode="preview"] .overtype-wrapper .overtype-preview ul {
      display: block !important;
      list-style: disc !important;
      padding-left: 2em !important;
      margin: 1em 0 !important;
    }

    .overtype-container[data-mode="preview"] .overtype-wrapper .overtype-preview ol {
      display: block !important;
      list-style: decimal !important;
      padding-left: 2em !important;
      margin: 1em 0 !important;
    }
    
    .overtype-container[data-mode="preview"] .overtype-wrapper .overtype-preview li {
      display: list-item !important;
      margin: 0 !important;
      padding: 0 !important;
    }

    /* Task list checkboxes - only in preview mode */
    .overtype-container[data-mode="preview"] .overtype-wrapper .overtype-preview li.task-list {
      list-style: none !important;
      position: relative !important;
    }

    .overtype-container[data-mode="preview"] .overtype-wrapper .overtype-preview li.task-list input[type="checkbox"] {
      margin-right: 0.5em !important;
      cursor: default !important;
      vertical-align: middle !important;
    }

    /* Task list in normal mode - keep syntax visible */
    .overtype-container:not([data-mode="preview"]) .overtype-wrapper .overtype-preview li.task-list {
      list-style: none !important;
    }

    .overtype-container:not([data-mode="preview"]) .overtype-wrapper .overtype-preview li.task-list .syntax-marker {
      color: var(--syntax, #999999) !important;
      font-weight: normal !important;
    }

    /* Links - make clickable in preview mode */
    .overtype-container[data-mode="preview"] .overtype-wrapper .overtype-preview a {
      pointer-events: auto !important;
      cursor: pointer !important;
      color: var(--preview-link, var(--preview-link-default)) !important;
      text-decoration: underline !important;
    }

    /* Code blocks - proper pre/code styling in preview mode */
    .overtype-container[data-mode="preview"] .overtype-wrapper .overtype-preview pre.code-block {
      background: var(--preview-code-bg, var(--preview-code-bg-default)) !important;
      color: var(--preview-code, var(--preview-code-default)) !important;
      padding: 1.2em !important;
      border-radius: 3px !important;
      overflow-x: auto !important;
      margin: 0 !important;
      display: block !important;
    }

    .overtype-container[data-mode="preview"] .overtype-wrapper .overtype-preview pre.code-block code {
      background: transparent !important;
      color: inherit !important;
      padding: 0 !important;
      font-family: ${r} !important;
      font-size: 0.9em !important;
      line-height: 1.4 !important;
    }

    /* Hide old code block lines and fences in preview mode */
    .overtype-container[data-mode="preview"] .overtype-wrapper .overtype-preview .code-block-line {
      display: none !important;
    }

    .overtype-container[data-mode="preview"] .overtype-wrapper .overtype-preview .code-fence {
      display: none !important;
    }

    /* Blockquotes - enhanced styling in preview mode */
    .overtype-container[data-mode="preview"] .overtype-wrapper .overtype-preview .blockquote {
      display: block !important;
      border-left: 4px solid var(--preview-blockquote, var(--preview-blockquote-default)) !important;
      color: var(--preview-blockquote, var(--preview-blockquote-default)) !important;
      padding-left: 1em !important;
      margin: 1em 0 !important;
      font-style: italic !important;
    }

    /* Typography improvements in preview mode */
    .overtype-container[data-mode="preview"] .overtype-wrapper .overtype-preview {
      font-family: Georgia, 'Times New Roman', serif !important;
      font-size: 16px !important;
      line-height: 1.8 !important;
      color: var(--preview-text, var(--preview-text-default)) !important;
      background: var(--preview-bg, var(--preview-bg-default)) !important;
    }

    /* Inline code in preview mode - keep monospace */
    .overtype-container[data-mode="preview"] .overtype-wrapper .overtype-preview code {
      font-family: ${r} !important;
      font-size: 0.9em !important;
      background: var(--preview-code-bg, var(--preview-code-bg-default)) !important;
      color: var(--preview-code, var(--preview-code-default)) !important;
      padding: 0.2em 0.4em !important;
      border-radius: 3px !important;
    }

    /* Strong and em elements in preview mode */
    .overtype-container[data-mode="preview"] .overtype-wrapper .overtype-preview strong {
      font-weight: 700 !important;
      color: var(--preview-strong, var(--preview-strong-default)) !important;
    }

    .overtype-container[data-mode="preview"] .overtype-wrapper .overtype-preview em {
      font-style: italic !important;
      color: var(--preview-em, var(--preview-em-default)) !important;
    }

    /* HR in preview mode */
    .overtype-container[data-mode="preview"] .overtype-wrapper .overtype-preview .hr-marker {
      display: block !important;
      border-top: 2px solid var(--preview-hr, var(--preview-hr-default)) !important;
      text-indent: -9999px !important;
      height: 2px !important;
    }

    /* Link Tooltip */
    .overtype-link-tooltip {
      background: #333 !important;
      color: white !important;
      padding: 6px 10px !important;
      border-radius: 16px !important;
      font-size: 12px !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
      display: flex !important;
      visibility: hidden !important;
      pointer-events: none !important;
      z-index: 10000 !important;
      cursor: pointer !important;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3) !important;
      max-width: 300px !important;
      white-space: nowrap !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      position: fixed;
      top: 0;
      left: 0;
    }

    .overtype-link-tooltip.visible {
      visibility: visible !important;
      pointer-events: auto !important;
    }

    ${s}
  `}var Hi={};oi(Hi,{applyCustomFormat:()=>qt,default:()=>ji,expandSelection:()=>Ut,getActiveFormats:()=>nt,getDebugMode:()=>qe,hasFormat:()=>Vt,insertHeader:()=>de,insertLink:()=>Qe,preserveSelection:()=>zt,setDebugMode:()=>Ft,setUndoMethod:()=>Ot,toggleBold:()=>Ze,toggleBulletList:()=>Xe,toggleCode:()=>Je,toggleH1:()=>tt,toggleH2:()=>it,toggleH3:()=>rt,toggleItalic:()=>Ge,toggleNumberedList:()=>Ye,toggleQuote:()=>et,toggleTaskList:()=>we});var $i=Object.defineProperty,gt=Object.getOwnPropertySymbols,Ii=Object.prototype.hasOwnProperty,_i=Object.prototype.propertyIsEnumerable,yt=(e,t,i)=>t in e?$i(e,t,{enumerable:!0,configurable:!0,writable:!0,value:i}):e[t]=i,bt=(e,t)=>{for(var i in t||(t={}))Ii.call(t,i)&&yt(e,i,t[i]);if(gt)for(var i of gt(t))_i.call(t,i)&&yt(e,i,t[i]);return e},D={bold:{prefix:"**",suffix:"**",trimFirst:!0},italic:{prefix:"_",suffix:"_",trimFirst:!0},code:{prefix:"`",suffix:"`",blockPrefix:"```",blockSuffix:"```"},link:{prefix:"[",suffix:"](url)",replaceNext:"url",scanFor:"https?://"},bulletList:{prefix:"- ",multiline:!0,unorderedList:!0},numberedList:{prefix:"1. ",multiline:!0,orderedList:!0},quote:{prefix:"> ",multiline:!0,surroundWithNewlines:!0},taskList:{prefix:"- [ ] ",multiline:!0,surroundWithNewlines:!0},header1:{prefix:"# "},header2:{prefix:"## "},header3:{prefix:"### "},header4:{prefix:"#### "},header5:{prefix:"##### "},header6:{prefix:"###### "}};function Mi(){return{prefix:"",suffix:"",blockPrefix:"",blockSuffix:"",multiline:!1,replaceNext:"",prefixSpace:!1,scanFor:"",surroundWithNewlines:!1,orderedList:!1,unorderedList:!1,trimFirst:!1}}function F(e){return bt(bt({},Mi()),e)}var ce=!1;function Ft(e){ce=e}function qe(){return ce}function x(e,t,i){ce&&(console.group(`\u{1F50D} ${e}`),console.log(t),i&&console.log("Data:",i),console.groupEnd())}function be(e,t){if(!ce)return;let i=e.value.slice(e.selectionStart,e.selectionEnd);console.group(`\u{1F4CD} Selection: ${t}`),console.log("Position:",`${e.selectionStart}-${e.selectionEnd}`),console.log("Selected text:",JSON.stringify(i)),console.log("Length:",i.length);let r=e.value.slice(Math.max(0,e.selectionStart-10),e.selectionStart),n=e.value.slice(e.selectionEnd,Math.min(e.value.length,e.selectionEnd+10));console.log("Context:",JSON.stringify(r)+"[SELECTION]"+JSON.stringify(n)),console.groupEnd()}function Rt(e){ce&&(console.group("\u{1F4DD} Result"),console.log("Text to insert:",JSON.stringify(e.text)),console.log("New selection:",`${e.selectionStart}-${e.selectionEnd}`),console.groupEnd())}var H=null;function O(e,{text:t,selectionStart:i,selectionEnd:r}){let n=qe();n&&(console.group("\u{1F527} insertText"),console.log("Current selection:",`${e.selectionStart}-${e.selectionEnd}`),console.log("Text to insert:",JSON.stringify(t)),console.log("New selection to set:",i,"-",r)),e.focus();let o=e.selectionStart,a=e.selectionEnd,s=e.value.slice(0,o),p=e.value.slice(a);n&&(console.log("Before text (last 20):",JSON.stringify(s.slice(-20))),console.log("After text (first 20):",JSON.stringify(p.slice(0,20))),console.log("Selected text being replaced:",JSON.stringify(e.value.slice(o,a))));let l=e.value,c=o!==a;if(H===null||H===!0){e.contentEditable="true";try{H=document.execCommand("insertText",!1,t),n&&console.log("execCommand returned:",H,"for text with",t.split(`
`).length,"lines")}catch(d){H=!1,n&&console.log("execCommand threw error:",d)}e.contentEditable="false"}if(n&&(console.log("canInsertText before:",H),console.log("execCommand result:",H)),H){let d=s+t+p,h=e.value;n&&(console.log("Expected length:",d.length),console.log("Actual length:",h.length)),h!==d&&n&&(console.log("execCommand changed the value but not as expected"),console.log("Expected:",JSON.stringify(d.slice(0,100))),console.log("Actual:",JSON.stringify(h.slice(0,100))))}if(!H)if(n&&console.log("Using manual insertion"),e.value===l){n&&console.log("Value unchanged, doing manual replacement");try{document.execCommand("ms-beginUndoUnit")}catch{}e.value=s+t+p;try{document.execCommand("ms-endUndoUnit")}catch{}e.dispatchEvent(new CustomEvent("input",{bubbles:!0,cancelable:!0}))}else n&&console.log("Value was changed by execCommand, skipping manual insertion");n&&console.log("Setting selection range:",i,r),i!=null&&r!=null?e.setSelectionRange(i,r):e.setSelectionRange(o,e.selectionEnd),n&&(console.log("Final value length:",e.value.length),console.groupEnd())}function Ot(e){switch(e){case"native":H=!0;break;case"manual":H=!1;break;case"auto":H=null;break}}function Oe(e){return e.trim().split(`
`).length>1}function Di(e,t){let i=t;for(;e[i]&&e[i-1]!=null&&!e[i-1].match(/\s/);)i--;return i}function Pi(e,t,i){let r=t,n=i?/\n/:/\s/;for(;e[r]&&!e[r].match(n);)r++;return r}function Bt(e){let t=e.value.split(`
`),i=0;for(let r=0;r<t.length;r++){let n=t[r].length+1;e.selectionStart>=i&&e.selectionStart<i+n&&(e.selectionStart=i),e.selectionEnd>=i&&e.selectionEnd<i+n&&(r===t.length-1?e.selectionEnd=Math.min(i+t[r].length,e.value.length):e.selectionEnd=i+n-1),i+=n}}function Fi(e,t,i,r=!1){if(e.selectionStart===e.selectionEnd)e.selectionStart=Di(e.value,e.selectionStart),e.selectionEnd=Pi(e.value,e.selectionEnd,r);else{let n=e.selectionStart-t.length,o=e.selectionEnd+i.length,a=e.value.slice(n,e.selectionStart)===t,s=e.value.slice(e.selectionEnd,o)===i;a&&s&&(e.selectionStart=n,e.selectionEnd=o)}return e.value.slice(e.selectionStart,e.selectionEnd)}function We(e){let t=e.value.slice(0,e.selectionStart),i=e.value.slice(e.selectionEnd),r=t.match(/\n*$/),n=i.match(/^\n*/),o=r?r[0].length:0,a=n?n[0].length:0,s="",p="";return t.match(/\S/)&&o<2&&(s=`
`.repeat(2-o)),i.match(/\S/)&&a<2&&(p=`
`.repeat(2-a)),{newlinesToAppend:s,newlinesToPrepend:p}}function zt(e,t){let i=e.selectionStart,r=e.selectionEnd,n=e.scrollTop;t(),e.selectionStart=i,e.selectionEnd=r,e.scrollTop=n}function Se(e,t,i={}){let r=e.selectionStart,n=e.selectionEnd,o=r===n,a=e.value,s=r;for(;s>0&&a[s-1]!==`
`;)s--;if(o){let l=r;for(;l<a.length&&a[l]!==`
`;)l++;e.selectionStart=s,e.selectionEnd=l}else Bt(e);let p=t(e);if(i.adjustSelection){let l=e.value.slice(e.selectionStart,e.selectionEnd).startsWith(i.prefix),c=i.adjustSelection(l,r,n,s);p.selectionStart=c.start,p.selectionEnd=c.end}else if(i.prefix){let l=e.value.slice(e.selectionStart,e.selectionEnd).startsWith(i.prefix);o?l?(p.selectionStart=Math.max(r-i.prefix.length,s),p.selectionEnd=p.selectionStart):(p.selectionStart=r+i.prefix.length,p.selectionEnd=p.selectionStart):l?(p.selectionStart=Math.max(r-i.prefix.length,s),p.selectionEnd=Math.max(n-i.prefix.length,s)):(p.selectionStart=r+i.prefix.length,p.selectionEnd=n+i.prefix.length)}return p}function ee(e,t){let i,r,{prefix:n,suffix:o,blockPrefix:a,blockSuffix:s,replaceNext:p,prefixSpace:l,scanFor:c,surroundWithNewlines:d,trimFirst:h}=t,u=e.selectionStart,f=e.selectionEnd,m=e.value.slice(e.selectionStart,e.selectionEnd),v=Oe(m)&&a&&a.length>0?`${a}
`:n,y=Oe(m)&&s&&s.length>0?`
${s}`:o;if(l){let E=e.value[e.selectionStart-1];e.selectionStart!==0&&E!=null&&!E.match(/\s/)&&(v=` ${v}`)}m=Fi(e,v,y,t.multiline);let b=e.selectionStart,w=e.selectionEnd,k=p&&p.length>0&&y.indexOf(p)>-1&&m.length>0;if(d){let E=We(e);i=E.newlinesToAppend,r=E.newlinesToPrepend,v=i+n,y+=r}if(m.startsWith(v)&&m.endsWith(y)){let E=m.slice(v.length,m.length-y.length);if(u===f){let L=u-v.length;L=Math.max(L,b),L=Math.min(L,b+E.length),b=w=L}else w=b+E.length;return{text:E,selectionStart:b,selectionEnd:w}}else if(k)if(c&&c.length>0&&m.match(c)){y=y.replace(p,m);let E=v+y;return b=w=b+v.length,{text:E,selectionStart:b,selectionEnd:w}}else{let E=v+m+y;return b=b+v.length+m.length+y.indexOf(p),w=b+p.length,{text:E,selectionStart:b,selectionEnd:w}}else{let E=v+m+y;b=u+v.length,w=f+v.length;let L=m.match(/^\s*|\s*$/g);if(h&&L){let he=L[0]||"",G=L[1]||"";E=he+v+m.trim()+y+G,b+=he.length,w-=G.length}return{text:E,selectionStart:b,selectionEnd:w}}}function Ke(e,t){let{prefix:i,suffix:r,surroundWithNewlines:n}=t,o=e.value.slice(e.selectionStart,e.selectionEnd),a=e.selectionStart,s=e.selectionEnd,p=o.split(`
`);if(p.every(l=>l.startsWith(i)&&(!r||l.endsWith(r))))o=p.map(l=>{let c=l.slice(i.length);return r&&(c=c.slice(0,c.length-r.length)),c}).join(`
`),s=a+o.length;else if(o=p.map(l=>i+l+(r||"")).join(`
`),n){let{newlinesToAppend:l,newlinesToPrepend:c}=We(e);a+=l.length,s=a+o.length,o=l+o+c}return{text:o,selectionStart:a,selectionEnd:s}}function wt(e){let t=e.split(`
`),i=/^\d+\.\s+/,r=t.every(o=>i.test(o)),n=t;return r&&(n=t.map(o=>o.replace(i,""))),{text:n.join(`
`),processed:r}}function xt(e){let t=e.split(`
`),i="- ",r=t.every(o=>o.startsWith(i)),n=t;return r&&(n=t.map(o=>o.slice(i.length))),{text:n.join(`
`),processed:r}}function oe(e,t){return t?"- ":`${e+1}. `}function Ri(e,t){let i,r,n;return e.orderedList?(i=wt(t),r=xt(i.text),n=r.text):(i=xt(t),r=wt(i.text),n=r.text),[i,r,n]}function Oi(e,t){let i=e.selectionStart===e.selectionEnd,r=e.selectionStart,n=e.selectionEnd;Bt(e);let o=e.value.slice(e.selectionStart,e.selectionEnd),[a,s,p]=Ri(t,o),l=p.split(`
`).map((m,v)=>`${oe(v,t.unorderedList)}${m}`),c=l.reduce((m,v,y)=>m+oe(y,t.unorderedList).length,0),d=l.reduce((m,v,y)=>m+oe(y,!t.unorderedList).length,0);if(a.processed)return i?(r=Math.max(r-oe(0,t.unorderedList).length,0),n=r):(r=e.selectionStart,n=e.selectionEnd-c),{text:p,selectionStart:r,selectionEnd:n};let{newlinesToAppend:h,newlinesToPrepend:u}=We(e),f=h+l.join(`
`)+u;return i?(r=Math.max(r+oe(0,t.unorderedList).length+h.length,0),n=r):s.processed?(r=Math.max(e.selectionStart+h.length,0),n=e.selectionEnd+h.length+c-d):(r=Math.max(e.selectionStart+h.length,0),n=e.selectionEnd+h.length+c),{text:f,selectionStart:r,selectionEnd:n}}function jt(e,t){let i=Se(e,r=>Oi(r,t),{adjustSelection:(r,n,o,a)=>{let s=e.value.slice(a,e.selectionEnd),p=/^\d+\.\s+/,l=/^- /,c=p.test(s),d=l.test(s),h=t.orderedList&&c||t.unorderedList&&d;if(n===o)if(h){let u=s.match(t.orderedList?p:l),f=u?u[0].length:0;return{start:Math.max(n-f,a),end:Math.max(n-f,a)}}else if(c||d){let u=s.match(c?p:l),f=u?u[0].length:0,m=(t.unorderedList?2:3)-f;return{start:n+m,end:n+m}}else{let u=t.unorderedList?2:3;return{start:n+u,end:n+u}}else if(h){let u=s.match(t.orderedList?p:l),f=u?u[0].length:0;return{start:Math.max(n-f,a),end:Math.max(o-f,a)}}else if(c||d){let u=s.match(c?p:l),f=u?u[0].length:0,m=(t.unorderedList?2:3)-f;return{start:n+m,end:o+m}}else{let u=t.unorderedList?2:3;return{start:n+u,end:o+u}}}});O(e,i)}function Nt(e){if(!e)return[];let t=[],{selectionStart:i,selectionEnd:r,value:n}=e,o=n.split(`
`),a=0,s="";for(let d of o){if(i>=a&&i<=a+d.length){s=d;break}a+=d.length+1}s.startsWith("- ")&&(s.startsWith("- [ ] ")||s.startsWith("- [x] ")?t.push("task-list"):t.push("bullet-list")),/^\d+\.\s/.test(s)&&t.push("numbered-list"),s.startsWith("> ")&&t.push("quote"),s.startsWith("# ")&&t.push("header"),s.startsWith("## ")&&t.push("header-2"),s.startsWith("### ")&&t.push("header-3");let p=Math.max(0,i-10),l=Math.min(n.length,r+10),c=n.slice(p,l);if(c.includes("**")){let d=n.slice(Math.max(0,i-100),i),h=n.slice(r,Math.min(n.length,r+100)),u=d.lastIndexOf("**"),f=h.indexOf("**");u!==-1&&f!==-1&&t.push("bold")}if(c.includes("_")){let d=n.slice(Math.max(0,i-100),i),h=n.slice(r,Math.min(n.length,r+100)),u=d.lastIndexOf("_"),f=h.indexOf("_");u!==-1&&f!==-1&&t.push("italic")}if(c.includes("`")){let d=n.slice(Math.max(0,i-100),i),h=n.slice(r,Math.min(n.length,r+100));d.includes("`")&&h.includes("`")&&t.push("code")}if(c.includes("[")&&c.includes("]")){let d=n.slice(Math.max(0,i-100),i),h=n.slice(r,Math.min(n.length,r+100)),u=d.lastIndexOf("["),f=h.indexOf("]");u!==-1&&f!==-1&&n.slice(r+f+1,r+f+10).startsWith("(")&&t.push("link")}return t}function Bi(e,t){return Nt(e).includes(t)}function zi(e,t={}){if(!e)return;let{toWord:i,toLine:r,toFormat:n}=t,{selectionStart:o,selectionEnd:a,value:s}=e;if(r){let p=s.split(`
`),l=0,c=0,d=0;for(let h of p){if(o>=d&&o<=d+h.length){l=d,c=d+h.length;break}d+=h.length+1}e.selectionStart=l,e.selectionEnd=c}else if(i&&o===a){let p=o,l=a;for(;p>0&&!/\s/.test(s[p-1]);)p--;for(;l<s.length&&!/\s/.test(s[l]);)l++;e.selectionStart=p,e.selectionEnd=l}}function Ze(e){if(!e||e.disabled||e.readOnly)return;x("toggleBold","Starting"),be(e,"Before");let t=F(D.bold),i=ee(e,t);Rt(i),O(e,i),be(e,"After")}function Ge(e){if(!e||e.disabled||e.readOnly)return;let t=F(D.italic),i=ee(e,t);O(e,i)}function Je(e){if(!e||e.disabled||e.readOnly)return;let t=F(D.code),i=ee(e,t);O(e,i)}function Qe(e,t={}){if(!e||e.disabled||e.readOnly)return;let i=e.value.slice(e.selectionStart,e.selectionEnd),r=F(D.link);if(i&&i.match(/^https?:\/\//)&&!t.url?(r.suffix=`](${i})`,r.replaceNext=""):t.url&&(r.suffix=`](${t.url})`,r.replaceNext=""),t.text&&!i){let o=e.selectionStart;e.value=e.value.slice(0,o)+t.text+e.value.slice(o),e.selectionStart=o,e.selectionEnd=o+t.text.length}let n=ee(e,r);O(e,n)}function Xe(e){if(!e||e.disabled||e.readOnly)return;let t=F(D.bulletList);jt(e,t)}function Ye(e){if(!e||e.disabled||e.readOnly)return;let t=F(D.numberedList);jt(e,t)}function et(e){if(!e||e.disabled||e.readOnly)return;x("toggleQuote","Starting"),be(e,"Initial");let t=F(D.quote),i=Se(e,r=>Ke(r,t),{prefix:t.prefix});Rt(i),O(e,i),be(e,"Final")}function we(e){if(!e||e.disabled||e.readOnly)return;let t=F(D.taskList),i=Se(e,r=>Ke(r,t),{prefix:t.prefix});O(e,i)}function de(e,t=1,i=!1){if(!e||e.disabled||e.readOnly)return;(t<1||t>6)&&(t=1),x("insertHeader","============ START ============"),x("insertHeader",`Level: ${t}, Toggle: ${i}`),x("insertHeader",`Initial cursor: ${e.selectionStart}-${e.selectionEnd}`);let r=`header${t===1?"1":t}`,n=F(D[r]||D.header1);x("insertHeader",`Style prefix: "${n.prefix}"`);let o=e.value,a=e.selectionStart,s=e.selectionEnd,p=a;for(;p>0&&o[p-1]!==`
`;)p--;let l=s;for(;l<o.length&&o[l]!==`
`;)l++;let c=o.slice(p,l);x("insertHeader",`Current line (before): "${c}"`);let d=c.match(/^(#{1,6})\s*/),h=d?d[1].length:0,u=d?d[0].length:0;x("insertHeader","Existing header check:"),x("insertHeader",`  - Match: ${d?`"${d[0]}"`:"none"}`),x("insertHeader",`  - Existing level: ${h}`),x("insertHeader",`  - Existing prefix length: ${u}`),x("insertHeader",`  - Target level: ${t}`);let f=i&&h===t;x("insertHeader",`Should toggle OFF: ${f} (toggle=${i}, existingLevel=${h}, level=${t})`);let m=Se(e,v=>{let y=v.value.slice(v.selectionStart,v.selectionEnd);x("insertHeader",`Line in operation: "${y}"`);let b=y.replace(/^#{1,6}\s*/,"");x("insertHeader",`Cleaned line: "${b}"`);let w;return f?(x("insertHeader","ACTION: Toggling OFF - removing header"),w=b):h>0?(x("insertHeader",`ACTION: Replacing H${h} with H${t}`),w=n.prefix+b):(x("insertHeader","ACTION: Adding new header"),w=n.prefix+b),x("insertHeader",`New line: "${w}"`),{text:w,selectionStart:v.selectionStart,selectionEnd:v.selectionEnd}},{prefix:n.prefix,adjustSelection:(v,y,b,w)=>{if(x("insertHeader","Adjusting selection:"),x("insertHeader",`  - isRemoving param: ${v}`),x("insertHeader",`  - shouldToggleOff: ${f}`),x("insertHeader",`  - selStart: ${y}, selEnd: ${b}`),x("insertHeader",`  - lineStartPos: ${w}`),f){let k=Math.max(y-u,w);return x("insertHeader",`  - Removing header, adjusting by -${u}`),{start:k,end:y===b?k:Math.max(b-u,w)}}else if(u>0){let k=n.prefix.length-u;return x("insertHeader",`  - Replacing header, adjusting by ${k}`),{start:y+k,end:b+k}}else return x("insertHeader",`  - Adding header, adjusting by +${n.prefix.length}`),{start:y+n.prefix.length,end:b+n.prefix.length}}});x("insertHeader",`Final result: text="${m.text}", cursor=${m.selectionStart}-${m.selectionEnd}`),x("insertHeader","============ END ============"),O(e,m)}function tt(e){de(e,1,!0)}function it(e){de(e,2,!0)}function rt(e){de(e,3,!0)}function nt(e){return Nt(e)}function Vt(e,t){return Bi(e,t)}function Ut(e,t={}){zi(e,t)}function qt(e,t){if(!e||e.disabled||e.readOnly)return;let i=F(t),r;if(i.multiline){let n=e.value.slice(e.selectionStart,e.selectionEnd);Oe(n)?r=Ke(e,i):r=ee(e,i)}else r=ee(e,i);O(e,r)}var ji={toggleBold:Ze,toggleItalic:Ge,toggleCode:Je,insertLink:Qe,toggleBulletList:Xe,toggleNumberedList:Ye,toggleQuote:et,toggleTaskList:we,insertHeader:de,toggleH1:tt,toggleH2:it,toggleH3:rt,getActiveFormats:nt,hasFormat:Vt,expandSelection:Ut,applyCustomFormat:qt,preserveSelection:zt,setUndoMethod:Ot,setDebugMode:Ft,getDebugMode:qe},Ni=class{constructor(e,t={}){this.editor=e,this.container=null,this.buttons={},this.currentItemIndex=0,this.handleDocumentClick=null,this.activeDropdown=null,this.activeDropdownButton=null,this.toolbarButtons=t.toolbarButtons||[]}create(){this.container=document.createElement("div"),this.container.className="overtype-toolbar",this.editor._markChrome(this.container),this.container.id=this.getInstanceElementId("toolbar"),this.container.setAttribute("role","toolbar"),this.container.setAttribute("aria-label","Formatting toolbar"),this.container.setAttribute("aria-controls",this.editor.textarea.id),this.toolbarButtons.forEach(e=>{if(e.name==="separator"){let t=this.createSeparator();this.container.appendChild(t)}else{let t=this.createButton(e);this.buttons[e.name]=t,this.container.appendChild(t)}}),this.setupRovingTabIndex(),this.updateButtonStates(),this.editor.container.insertBefore(this.container,this.editor.wrapper)}getInstanceElementId(e){return`overtype-${this.editor.instanceId}-${e}`}setupRovingTabIndex(){this.getToolbarItems().length!==0&&(this.currentItemIndex=this.getValidItemIndex(this.currentItemIndex),this.updateTabIndexes(),this.container.addEventListener("keydown",e=>{this.onToolbarKeydown(e)}),this.container.addEventListener("focusin",e=>{this.onToolbarFocusin(e)}))}getToolbarItems(){return this.container?Array.from(this.container.querySelectorAll(".overtype-toolbar-button")):[]}onToolbarKeydown(e){let t=this.getToolbarItems();if(t.includes(e.target))switch(e.key){case"ArrowRight":e.preventDefault(),this.focusItem(this.currentItemIndex+1);break;case"ArrowLeft":e.preventDefault(),this.focusItem(this.currentItemIndex-1);break;case"Home":e.preventDefault(),this.focusItem(0);break;case"End":e.preventDefault(),this.focusItem(t.length-1);break}}onToolbarFocusin(e){let t=this.getToolbarItems().indexOf(e.target);t!==-1&&(this.currentItemIndex=t,this.updateTabIndexes())}focusItem(e){let t=this.getToolbarItems();t.length!==0&&(this.currentItemIndex=this.getValidItemIndex(e,t),this.updateTabIndexes(),t[this.currentItemIndex].focus())}getValidItemIndex(e,t=this.getToolbarItems()){let i=t.length;return i===0?0:e<0?i-1:e>=i?0:e}updateTabIndexes(){this.getToolbarItems().forEach((e,t)=>{e.tabIndex=t===this.currentItemIndex?0:-1})}createSeparator(){let e=document.createElement("div");return e.className="overtype-toolbar-separator",e.setAttribute("role","separator"),e}createButton(e){let t=document.createElement("button");return t.className="overtype-toolbar-button",t.type="button",t.setAttribute("data-button",e.name),t.title=e.title||"",t.setAttribute("aria-label",e.title||e.name),t.innerHTML=this.sanitizeSVG(e.icon||""),e.name==="viewMode"?(t.classList.add("has-dropdown"),t.dataset.dropdown="true",t.setAttribute("aria-haspopup","menu"),t.setAttribute("aria-expanded","false"),t._clickHandler=i=>{i.preventDefault(),this.toggleViewModeDropdown(t)},t._keydownHandler=i=>{if(!["ArrowDown","ArrowUp","Enter"," "].includes(i.key))return;i.preventDefault();let r=i.key==="ArrowUp"?"last":"current";this.openViewModeDropdown(t,r)},t.addEventListener("click",t._clickHandler),t.addEventListener("keydown",t._keydownHandler),t):(t._clickHandler=i=>{i.preventDefault();let r=e.actionId||e.name;this.editor.performAction(r,i)},t.addEventListener("click",t._clickHandler),t)}async handleAction(e){if(e&&typeof e=="object"&&typeof e.action=="function"){this.editor.textarea.focus();try{return await e.action({editor:this.editor,getValue:()=>this.editor.getValue(),setValue:t=>this.editor.setValue(t),event:null}),!0}catch(t){return console.error(`Action "${e.name}" error:`,t),this.editor.wrapper.dispatchEvent(new CustomEvent("button-error",{detail:{buttonName:e.name,error:t}})),!1}}return typeof e=="string"?this.editor.performAction(e,null):!1}sanitizeSVG(e){return typeof e!="string"?"":e.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,"").replace(/\son\w+\s*=\s*["'][^"']*["']/gi,"").replace(/\son\w+\s*=\s*[^\s>]*/gi,"")}toggleViewModeDropdown(e){if(this.activeDropdown){this.closeViewModeDropdown(e);return}this.openViewModeDropdown(e)}openViewModeDropdown(e,t=null){this.closeViewModeDropdown(e),e.classList.add("dropdown-active");let i=this.createViewModeDropdown(e),r=e.getBoundingClientRect();i.style.position="absolute",i.style.top=`${r.bottom+5}px`,i.style.left=`${r.left}px`,document.body.appendChild(i),this.activeDropdown=i,this.activeDropdownButton=e,e.setAttribute("aria-controls",i.id),e.setAttribute("aria-expanded","true"),this.handleDocumentClick=n=>{!i.contains(n.target)&&!e.contains(n.target)&&this.closeViewModeDropdown(e)},setTimeout(()=>{document.addEventListener("click",this.handleDocumentClick)},0),t&&this.focusViewModeMenuItem(i,t)}closeViewModeDropdown(e=this.activeDropdownButton,t=!1){this.activeDropdown&&(this.activeDropdown.remove(),this.activeDropdown=null),e&&(e.classList.remove("dropdown-active"),e.setAttribute("aria-expanded","false")),this.handleDocumentClick&&(document.removeEventListener("click",this.handleDocumentClick),this.handleDocumentClick=null),this.activeDropdownButton=null,t&&e&&e.focus()}createViewModeDropdown(e){let t=document.createElement("div");t.className="overtype-dropdown-menu",this.editor._markChrome(t),t.id=this.getInstanceElementId("toolbar-view-mode-menu"),t.setAttribute("role","menu"),t.setAttribute("aria-label","View mode"),t.addEventListener("keydown",n=>{this.onViewModeMenuKeydown(n,e)});let i=[{id:"normal",label:"Normal Edit",icon:"\u2713"},{id:"plain",label:"Plain Textarea",icon:"\u2713"},{id:"preview",label:"Preview Mode",icon:"\u2713"}],r=this.editor.container.dataset.mode||"normal";return i.forEach(n=>{let o=document.createElement("button");if(o.className="overtype-dropdown-item",o.type="button",o.tabIndex=-1,o.setAttribute("role","menuitemradio"),o.setAttribute("aria-checked",String(n.id===r)),o.textContent=n.label,n.id===r){o.classList.add("active");let a=document.createElement("span");a.className="overtype-dropdown-icon",a.setAttribute("aria-hidden","true"),a.textContent=n.icon,o.prepend(a)}o.addEventListener("click",a=>{switch(a.preventDefault(),n.id){case"plain":this.editor.showPlainTextarea();break;case"preview":this.editor.showPreviewMode();break;default:this.editor.showNormalEditMode();break}this.closeViewModeDropdown(e,!0)}),t.appendChild(o)}),t}onViewModeMenuKeydown(e,t){let i=this.getViewModeMenuItems().indexOf(e.target);if(i!==-1)switch(e.key){case"ArrowDown":e.preventDefault(),this.focusViewModeMenuItem(this.activeDropdown,i+1);break;case"ArrowUp":e.preventDefault(),this.focusViewModeMenuItem(this.activeDropdown,i-1);break;case"Home":e.preventDefault(),this.focusViewModeMenuItem(this.activeDropdown,"first");break;case"End":e.preventDefault(),this.focusViewModeMenuItem(this.activeDropdown,"last");break;case"Escape":e.preventDefault(),this.closeViewModeDropdown(t,!0);break}}focusViewModeMenuItem(e,t){let i=this.getViewModeMenuItems(e);if(i.length===0)return;let r=t;t==="first"?r=0:t==="last"?r=i.length-1:t==="current"&&(r=i.findIndex(n=>n.getAttribute("aria-checked")==="true")),r<0&&(r=i.length-1),r>=i.length&&(r=0),i[r].focus()}getViewModeMenuItems(e=this.activeDropdown){return e?Array.from(e.querySelectorAll('[role="menuitemradio"]')):[]}updateButtonStates(){var e;try{let t=((e=nt)==null?void 0:e(this.editor.textarea,this.editor.textarea.selectionStart))||[];Object.entries(this.buttons).forEach(([i,r])=>{if(i==="viewMode")return;let n=this.toolbarButtons.find(a=>a.name===i);if(!n?.isActive)return;let o=!!n.isActive({editor:this.editor,activeFormats:t});r.classList.toggle("active",o),r.setAttribute("aria-pressed",o.toString())})}catch{}}show(){this.container&&this.container.classList.remove("overtype-toolbar-hidden")}hide(){this.container&&this.container.classList.add("overtype-toolbar-hidden")}destroy(){this.container&&(this.activeDropdown?this.closeViewModeDropdown():this.handleDocumentClick&&(document.removeEventListener("click",this.handleDocumentClick),this.handleDocumentClick=null),Object.values(this.buttons).forEach(e=>{e._clickHandler&&(e.removeEventListener("click",e._clickHandler),delete e._clickHandler),e._keydownHandler&&(e.removeEventListener("keydown",e._keydownHandler),delete e._keydownHandler)}),this.container.remove(),this.container=null,this.buttons={})}},Be=Math.min,X=Math.max,xe=Math.round,M=e=>({x:e,y:e}),Vi={left:"right",right:"left",bottom:"top",top:"bottom"},Ui={start:"end",end:"start"};function kt(e,t,i){return X(e,Be(t,i))}function Le(e,t){return typeof e=="function"?e(t):e}function Z(e){return e.split("-")[0]}function Te(e){return e.split("-")[1]}function Wt(e){return e==="x"?"y":"x"}function Kt(e){return e==="y"?"height":"width"}var qi=new Set(["top","bottom"]);function V(e){return qi.has(Z(e))?"y":"x"}function Zt(e){return Wt(V(e))}function Wi(e,t,i){i===void 0&&(i=!1);let r=Te(e),n=Zt(e),o=Kt(n),a=n==="x"?r===(i?"end":"start")?"right":"left":r==="start"?"bottom":"top";return t.reference[o]>t.floating[o]&&(a=ke(a)),[a,ke(a)]}function Ki(e){let t=ke(e);return[ze(e),t,ze(t)]}function ze(e){return e.replace(/start|end/g,t=>Ui[t])}var Et=["left","right"],St=["right","left"],Zi=["top","bottom"],Gi=["bottom","top"];function Ji(e,t,i){switch(e){case"top":case"bottom":return i?t?St:Et:t?Et:St;case"left":case"right":return t?Zi:Gi;default:return[]}}function Qi(e,t,i,r){let n=Te(e),o=Ji(Z(e),i==="start",r);return n&&(o=o.map(a=>a+"-"+n),t&&(o=o.concat(o.map(ze)))),o}function ke(e){return e.replace(/left|right|bottom|top/g,t=>Vi[t])}function Xi(e){return{top:0,right:0,bottom:0,left:0,...e}}function Yi(e){return typeof e!="number"?Xi(e):{top:e,right:e,bottom:e,left:e}}function Ee(e){let{x:t,y:i,width:r,height:n}=e;return{width:r,height:n,top:i,left:t,right:t+r,bottom:i+n,x:t,y:i}}function Lt(e,t,i){let{reference:r,floating:n}=e,o=V(t),a=Zt(t),s=Kt(a),p=Z(t),l=o==="y",c=r.x+r.width/2-n.width/2,d=r.y+r.height/2-n.height/2,h=r[s]/2-n[s]/2,u;switch(p){case"top":u={x:c,y:r.y-n.height};break;case"bottom":u={x:c,y:r.y+r.height};break;case"right":u={x:r.x+r.width,y:d};break;case"left":u={x:r.x-n.width,y:d};break;default:u={x:r.x,y:r.y}}switch(Te(t)){case"start":u[a]-=h*(i&&l?-1:1);break;case"end":u[a]+=h*(i&&l?-1:1);break}return u}async function er(e,t){var i;t===void 0&&(t={});let{x:r,y:n,platform:o,rects:a,elements:s,strategy:p}=e,{boundary:l="clippingAncestors",rootBoundary:c="viewport",elementContext:d="floating",altBoundary:h=!1,padding:u=0}=Le(t,e),f=Yi(u),m=s[h?d==="floating"?"reference":"floating":d],v=Ee(await o.getClippingRect({element:(i=await(o.isElement==null?void 0:o.isElement(m)))==null||i?m:m.contextElement||await(o.getDocumentElement==null?void 0:o.getDocumentElement(s.floating)),boundary:l,rootBoundary:c,strategy:p})),y=d==="floating"?{x:r,y:n,width:a.floating.width,height:a.floating.height}:a.reference,b=await(o.getOffsetParent==null?void 0:o.getOffsetParent(s.floating)),w=await(o.isElement==null?void 0:o.isElement(b))?await(o.getScale==null?void 0:o.getScale(b))||{x:1,y:1}:{x:1,y:1},k=Ee(o.convertOffsetParentRelativeRectToViewportRelativeRect?await o.convertOffsetParentRelativeRectToViewportRelativeRect({elements:s,rect:y,offsetParent:b,strategy:p}):y);return{top:(v.top-k.top+f.top)/w.y,bottom:(k.bottom-v.bottom+f.bottom)/w.y,left:(v.left-k.left+f.left)/w.x,right:(k.right-v.right+f.right)/w.x}}var tr=async(e,t,i)=>{let{placement:r="bottom",strategy:n="absolute",middleware:o=[],platform:a}=i,s=o.filter(Boolean),p=await(a.isRTL==null?void 0:a.isRTL(t)),l=await a.getElementRects({reference:e,floating:t,strategy:n}),{x:c,y:d}=Lt(l,r,p),h=r,u={},f=0;for(let v=0;v<s.length;v++){var m;let{name:y,fn:b}=s[v],{x:w,y:k,data:E,reset:L}=await b({x:c,y:d,initialPlacement:r,placement:h,strategy:n,middlewareData:u,rects:l,platform:{...a,detectOverflow:(m=a.detectOverflow)!=null?m:er},elements:{reference:e,floating:t}});c=w??c,d=k??d,u={...u,[y]:{...u[y],...E}},L&&f<=50&&(f++,typeof L=="object"&&(L.placement&&(h=L.placement),L.rects&&(l=L.rects===!0?await a.getElementRects({reference:e,floating:t,strategy:n}):L.rects),{x:c,y:d}=Lt(l,h,p)),v=-1)}return{x:c,y:d,placement:h,strategy:n,middlewareData:u}},ir=function(e){return e===void 0&&(e={}),{name:"flip",options:e,async fn(t){var i,r;let{placement:n,middlewareData:o,rects:a,initialPlacement:s,platform:p,elements:l}=t,{mainAxis:c=!0,crossAxis:d=!0,fallbackPlacements:h,fallbackStrategy:u="bestFit",fallbackAxisSideDirection:f="none",flipAlignment:m=!0,...v}=Le(e,t);if((i=o.arrow)!=null&&i.alignmentOffset)return{};let y=Z(n),b=V(s),w=Z(s)===s,k=await(p.isRTL==null?void 0:p.isRTL(l.floating)),E=h||(w||!m?[ke(s)]:Ki(s)),L=f!=="none";!h&&L&&E.push(...Qi(s,m,f,k));let he=[s,...E],G=await p.detectOverflow(t,v),fe=[],J=((r=o.flip)==null?void 0:r.overflows)||[];if(c&&fe.push(G[y]),d){let W=Wi(n,a,k);fe.push(G[W[0]],G[W[1]])}if(J=[...J,{placement:n,overflows:fe}],!fe.every(W=>W<=0)){var st,lt;let W=(((st=o.flip)==null?void 0:st.index)||0)+1,Ie=he[W];if(Ie&&(!(d==="alignment"&&b!==V(Ie))||J.every(R=>V(R.placement)===b?R.overflows[0]>0:!0)))return{data:{index:W,overflows:J},reset:{placement:Ie}};let ne=(lt=J.filter(R=>R.overflows[0]<=0).sort((R,z)=>R.overflows[1]-z.overflows[1])[0])==null?void 0:lt.placement;if(!ne)switch(u){case"bestFit":{var pt;let R=(pt=J.filter(z=>{if(L){let j=V(z.placement);return j===b||j==="y"}return!0}).map(z=>[z.placement,z.overflows.filter(j=>j>0).reduce((j,ri)=>j+ri,0)]).sort((z,j)=>z[1]-j[1])[0])==null?void 0:pt[0];R&&(ne=R);break}case"initialPlacement":ne=s;break}if(n!==ne)return{reset:{placement:ne}}}return{}}}},rr=new Set(["left","top"]);async function nr(e,t){let{placement:i,platform:r,elements:n}=e,o=await(r.isRTL==null?void 0:r.isRTL(n.floating)),a=Z(i),s=Te(i),p=V(i)==="y",l=rr.has(a)?-1:1,c=o&&p?-1:1,d=Le(t,e),{mainAxis:h,crossAxis:u,alignmentAxis:f}=typeof d=="number"?{mainAxis:d,crossAxis:0,alignmentAxis:null}:{mainAxis:d.mainAxis||0,crossAxis:d.crossAxis||0,alignmentAxis:d.alignmentAxis};return s&&typeof f=="number"&&(u=s==="end"?f*-1:f),p?{x:u*c,y:h*l}:{x:h*l,y:u*c}}var or=function(e){return e===void 0&&(e=0),{name:"offset",options:e,async fn(t){var i,r;let{x:n,y:o,placement:a,middlewareData:s}=t,p=await nr(t,e);return a===((i=s.offset)==null?void 0:i.placement)&&(r=s.arrow)!=null&&r.alignmentOffset?{}:{x:n+p.x,y:o+p.y,data:{...p,placement:a}}}}},ar=function(e){return e===void 0&&(e={}),{name:"shift",options:e,async fn(t){let{x:i,y:r,placement:n,platform:o}=t,{mainAxis:a=!0,crossAxis:s=!1,limiter:p={fn:y=>{let{x:b,y:w}=y;return{x:b,y:w}}},...l}=Le(e,t),c={x:i,y:r},d=await o.detectOverflow(t,l),h=V(Z(n)),u=Wt(h),f=c[u],m=c[h];if(a){let y=u==="y"?"top":"left",b=u==="y"?"bottom":"right",w=f+d[y],k=f-d[b];f=kt(w,f,k)}if(s){let y=h==="y"?"top":"left",b=h==="y"?"bottom":"right",w=m+d[y],k=m-d[b];m=kt(w,m,k)}let v=p.fn({...t,[u]:f,[h]:m});return{...v,data:{x:v.x-i,y:v.y-r,enabled:{[u]:a,[h]:s}}}}}};function Ce(){return typeof window<"u"}function ie(e){return Gt(e)?(e.nodeName||"").toLowerCase():"#document"}function A(e){var t;return(e==null||(t=e.ownerDocument)==null?void 0:t.defaultView)||window}function B(e){var t;return(t=(Gt(e)?e.ownerDocument:e.document)||window.document)==null?void 0:t.documentElement}function Gt(e){return Ce()?e instanceof Node||e instanceof A(e).Node:!1}function $(e){return Ce()?e instanceof Element||e instanceof A(e).Element:!1}function P(e){return Ce()?e instanceof HTMLElement||e instanceof A(e).HTMLElement:!1}function Tt(e){return!Ce()||typeof ShadowRoot>"u"?!1:e instanceof ShadowRoot||e instanceof A(e).ShadowRoot}var sr=new Set(["inline","contents"]);function ue(e){let{overflow:t,overflowX:i,overflowY:r,display:n}=I(e);return/auto|scroll|overlay|hidden|clip/.test(t+r+i)&&!sr.has(n)}var lr=new Set(["table","td","th"]);function pr(e){return lr.has(ie(e))}var cr=[":popover-open",":modal"];function Ae(e){return cr.some(t=>{try{return e.matches(t)}catch{return!1}})}var dr=["transform","translate","scale","rotate","perspective"],ur=["transform","translate","scale","rotate","perspective","filter"],hr=["paint","layout","strict","content"];function ot(e){let t=at(),i=$(e)?I(e):e;return dr.some(r=>i[r]?i[r]!=="none":!1)||(i.containerType?i.containerType!=="normal":!1)||!t&&(i.backdropFilter?i.backdropFilter!=="none":!1)||!t&&(i.filter?i.filter!=="none":!1)||ur.some(r=>(i.willChange||"").includes(r))||hr.some(r=>(i.contain||"").includes(r))}function fr(e){let t=q(e);for(;P(t)&&!te(t);){if(ot(t))return t;if(Ae(t))return null;t=q(t)}return null}function at(){return typeof CSS>"u"||!CSS.supports?!1:CSS.supports("-webkit-backdrop-filter","none")}var mr=new Set(["html","body","#document"]);function te(e){return mr.has(ie(e))}function I(e){return A(e).getComputedStyle(e)}function He(e){return $(e)?{scrollLeft:e.scrollLeft,scrollTop:e.scrollTop}:{scrollLeft:e.scrollX,scrollTop:e.scrollY}}function q(e){if(ie(e)==="html")return e;let t=e.assignedSlot||e.parentNode||Tt(e)&&e.host||B(e);return Tt(t)?t.host:t}function Jt(e){let t=q(e);return te(t)?e.ownerDocument?e.ownerDocument.body:e.body:P(t)&&ue(t)?t:Jt(t)}function je(e,t,i){var r;t===void 0&&(t=[]),i===void 0&&(i=!0);let n=Jt(e),o=n===((r=e.ownerDocument)==null?void 0:r.body),a=A(n);if(o){let s=Ne(a);return t.concat(a,a.visualViewport||[],ue(n)?n:[],s&&i?je(s):[])}return t.concat(n,je(n,[],i))}function Ne(e){return e.parent&&Object.getPrototypeOf(e.parent)?e.frameElement:null}function Qt(e){let t=I(e),i=parseFloat(t.width)||0,r=parseFloat(t.height)||0,n=P(e),o=n?e.offsetWidth:i,a=n?e.offsetHeight:r,s=xe(i)!==o||xe(r)!==a;return s&&(i=o,r=a),{width:i,height:r,$:s}}function Xt(e){return $(e)?e:e.contextElement}function Y(e){let t=Xt(e);if(!P(t))return M(1);let i=t.getBoundingClientRect(),{width:r,height:n,$:o}=Qt(t),a=(o?xe(i.width):i.width)/r,s=(o?xe(i.height):i.height)/n;return(!a||!Number.isFinite(a))&&(a=1),(!s||!Number.isFinite(s))&&(s=1),{x:a,y:s}}var vr=M(0);function Yt(e){let t=A(e);return!at()||!t.visualViewport?vr:{x:t.visualViewport.offsetLeft,y:t.visualViewport.offsetTop}}function gr(e,t,i){return t===void 0&&(t=!1),!i||t&&i!==A(e)?!1:t}function pe(e,t,i,r){t===void 0&&(t=!1),i===void 0&&(i=!1);let n=e.getBoundingClientRect(),o=Xt(e),a=M(1);t&&(r?$(r)&&(a=Y(r)):a=Y(e));let s=gr(o,i,r)?Yt(o):M(0),p=(n.left+s.x)/a.x,l=(n.top+s.y)/a.y,c=n.width/a.x,d=n.height/a.y;if(o){let h=A(o),u=r&&$(r)?A(r):r,f=h,m=Ne(f);for(;m&&r&&u!==f;){let v=Y(m),y=m.getBoundingClientRect(),b=I(m),w=y.left+(m.clientLeft+parseFloat(b.paddingLeft))*v.x,k=y.top+(m.clientTop+parseFloat(b.paddingTop))*v.y;p*=v.x,l*=v.y,c*=v.x,d*=v.y,p+=w,l+=k,f=A(m),m=Ne(f)}}return Ee({width:c,height:d,x:p,y:l})}function $e(e,t){let i=He(e).scrollLeft;return t?t.left+i:pe(B(e)).left+i}function ei(e,t){let i=e.getBoundingClientRect(),r=i.left+t.scrollLeft-$e(e,i),n=i.top+t.scrollTop;return{x:r,y:n}}function yr(e){let{elements:t,rect:i,offsetParent:r,strategy:n}=e,o=n==="fixed",a=B(r),s=t?Ae(t.floating):!1;if(r===a||s&&o)return i;let p={scrollLeft:0,scrollTop:0},l=M(1),c=M(0),d=P(r);if((d||!d&&!o)&&((ie(r)!=="body"||ue(a))&&(p=He(r)),P(r))){let u=pe(r);l=Y(r),c.x=u.x+r.clientLeft,c.y=u.y+r.clientTop}let h=a&&!d&&!o?ei(a,p):M(0);return{width:i.width*l.x,height:i.height*l.y,x:i.x*l.x-p.scrollLeft*l.x+c.x+h.x,y:i.y*l.y-p.scrollTop*l.y+c.y+h.y}}function br(e){return Array.from(e.getClientRects())}function wr(e){let t=B(e),i=He(e),r=e.ownerDocument.body,n=X(t.scrollWidth,t.clientWidth,r.scrollWidth,r.clientWidth),o=X(t.scrollHeight,t.clientHeight,r.scrollHeight,r.clientHeight),a=-i.scrollLeft+$e(e),s=-i.scrollTop;return I(r).direction==="rtl"&&(a+=X(t.clientWidth,r.clientWidth)-n),{width:n,height:o,x:a,y:s}}var Ct=25;function xr(e,t){let i=A(e),r=B(e),n=i.visualViewport,o=r.clientWidth,a=r.clientHeight,s=0,p=0;if(n){o=n.width,a=n.height;let c=at();(!c||c&&t==="fixed")&&(s=n.offsetLeft,p=n.offsetTop)}let l=$e(r);if(l<=0){let c=r.ownerDocument,d=c.body,h=getComputedStyle(d),u=c.compatMode==="CSS1Compat"&&parseFloat(h.marginLeft)+parseFloat(h.marginRight)||0,f=Math.abs(r.clientWidth-d.clientWidth-u);f<=Ct&&(o-=f)}else l<=Ct&&(o+=l);return{width:o,height:a,x:s,y:p}}var kr=new Set(["absolute","fixed"]);function Er(e,t){let i=pe(e,!0,t==="fixed"),r=i.top+e.clientTop,n=i.left+e.clientLeft,o=P(e)?Y(e):M(1),a=e.clientWidth*o.x,s=e.clientHeight*o.y,p=n*o.x,l=r*o.y;return{width:a,height:s,x:p,y:l}}function At(e,t,i){let r;if(t==="viewport")r=xr(e,i);else if(t==="document")r=wr(B(e));else if($(t))r=Er(t,i);else{let n=Yt(e);r={x:t.x-n.x,y:t.y-n.y,width:t.width,height:t.height}}return Ee(r)}function ti(e,t){let i=q(e);return i===t||!$(i)||te(i)?!1:I(i).position==="fixed"||ti(i,t)}function Sr(e,t){let i=t.get(e);if(i)return i;let r=je(e,[],!1).filter(s=>$(s)&&ie(s)!=="body"),n=null,o=I(e).position==="fixed",a=o?q(e):e;for(;$(a)&&!te(a);){let s=I(a),p=ot(a);!p&&s.position==="fixed"&&(n=null),(o?!p&&!n:!p&&s.position==="static"&&n&&kr.has(n.position)||ue(a)&&!p&&ti(e,a))?r=r.filter(l=>l!==a):n=s,a=q(a)}return t.set(e,r),r}function Lr(e){let{element:t,boundary:i,rootBoundary:r,strategy:n}=e,o=[...i==="clippingAncestors"?Ae(t)?[]:Sr(t,this._c):[].concat(i),r],a=o[0],s=o.reduce((p,l)=>{let c=At(t,l,n);return p.top=X(c.top,p.top),p.right=Be(c.right,p.right),p.bottom=Be(c.bottom,p.bottom),p.left=X(c.left,p.left),p},At(t,a,n));return{width:s.right-s.left,height:s.bottom-s.top,x:s.left,y:s.top}}function Tr(e){let{width:t,height:i}=Qt(e);return{width:t,height:i}}function Cr(e,t,i){let r=P(t),n=B(t),o=i==="fixed",a=pe(e,!0,o,t),s={scrollLeft:0,scrollTop:0},p=M(0);function l(){p.x=$e(n)}if(r||!r&&!o)if((ie(t)!=="body"||ue(n))&&(s=He(t)),r){let u=pe(t,!0,o,t);p.x=u.x+t.clientLeft,p.y=u.y+t.clientTop}else n&&l();o&&!r&&n&&l();let c=n&&!r&&!o?ei(n,s):M(0),d=a.left+s.scrollLeft-p.x-c.x,h=a.top+s.scrollTop-p.y-c.y;return{x:d,y:h,width:a.width,height:a.height}}function De(e){return I(e).position==="static"}function Ht(e,t){if(!P(e)||I(e).position==="fixed")return null;if(t)return t(e);let i=e.offsetParent;return B(e)===i&&(i=i.ownerDocument.body),i}function ii(e,t){let i=A(e);if(Ae(e))return i;if(!P(e)){let n=q(e);for(;n&&!te(n);){if($(n)&&!De(n))return n;n=q(n)}return i}let r=Ht(e,t);for(;r&&pr(r)&&De(r);)r=Ht(r,t);return r&&te(r)&&De(r)&&!ot(r)?i:r||fr(e)||i}var Ar=async function(e){let t=this.getOffsetParent||ii,i=this.getDimensions,r=await i(e.floating);return{reference:Cr(e.reference,await t(e.floating),e.strategy),floating:{x:0,y:0,width:r.width,height:r.height}}};function Hr(e){return I(e).direction==="rtl"}var $r={convertOffsetParentRelativeRectToViewportRelativeRect:yr,getDocumentElement:B,getClippingRect:Lr,getOffsetParent:ii,getElementRects:Ar,getClientRects:br,getDimensions:Tr,getScale:Y,isElement:$,isRTL:Hr},Ir=or,_r=ar,Mr=ir,Dr=(e,t,i)=>{let r=new Map,n={platform:$r,...i},o={...n.platform,_c:r};return tr(e,t,{...n,platform:o})},Pr=class{constructor(e){this.editor=e,this.tooltip=null,this.currentLink=null,this.hideTimeout=null,this.visibilityChangeHandler=null,this.isTooltipHovered=!1,this.linkCacheText=null,this.linkCache=[],this.init()}init(){this.createTooltip(),this.textareaListeners={selectionchange:()=>this.checkCursorPosition(),keyup:e=>{(e.key.includes("Arrow")||e.key==="Home"||e.key==="End")&&this.checkCursorPosition()},input:()=>this.hide(),scroll:()=>{this.currentLink&&this.positionTooltip(this.currentLink)},blur:()=>{this.isTooltipHovered||this.hide()}};for(let[e,t]of Object.entries(this.textareaListeners))this.editor.textarea.addEventListener(e,t);this.visibilityChangeHandler=()=>{document.hidden&&this.hide()},document.addEventListener("visibilitychange",this.visibilityChangeHandler),this.tooltip.addEventListener("mouseenter",()=>{this.isTooltipHovered=!0,this.cancelHide()}),this.tooltip.addEventListener("mouseleave",()=>{this.isTooltipHovered=!1,this.scheduleHide()})}createTooltip(){this.tooltip=document.createElement("div"),this.tooltip.className="overtype-link-tooltip",this.editor._markChrome(this.tooltip),this.tooltip.innerHTML=`
      <span style="display: flex; align-items: center; gap: 6px;">
        <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor" style="flex-shrink: 0;">
          <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z"></path>
          <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z"></path>
        </svg>
        <span class="overtype-link-tooltip-url"></span>
      </span>
    `,this.tooltip.addEventListener("click",e=>{if(e.preventDefault(),e.stopPropagation(),this.currentLink){let t=T.sanitizeUrl(this.currentLink.url);t!=="#"&&window.open(t,"_blank"),this.hide()}}),this.editor.container.appendChild(this.tooltip)}checkCursorPosition(){let e=this.editor.textarea.selectionStart,t=this.editor.textarea.value,i=this.findLinkAtPosition(t,e);i?(!this.currentLink||this.currentLink.url!==i.url||this.currentLink.index!==i.index)&&this.show(i):this.scheduleHide()}findLinkAtPosition(e,t){if(this.editor.options.showActiveLineRaw)return null;this.linkCacheText!==e&&(this.linkCacheText=e,this.linkCache=T.findRenderableLinks(e));let i=this.linkCache;for(let[r,n]of i.entries()){let o=n.start,a=n.end;if(t>=o&&t<=a)return{text:n.text.raw,url:this.transformUrl(n.destination.value),index:r,start:o,end:a}}return null}transformUrl(e){let t=this.editor.options.transformLinkUrl;if(typeof t!="function")return e;try{let i=t(e);return typeof i=="string"?i:e}catch(i){return console.warn("transformLinkUrl threw:",i),e}}async show(e){this.currentLink=e,this.cancelHide();let t=this.tooltip.querySelector(".overtype-link-tooltip-url");t.textContent=e.url,await this.positionTooltip(e),this.currentLink===e&&this.tooltip.classList.add("visible")}async positionTooltip(e){let t=this.findAnchorElement(e.index);if(!t)return;let i=t.getBoundingClientRect();if(!(i.width===0||i.height===0))try{let{x:r,y:n}=await Dr(t,this.tooltip,{strategy:"fixed",placement:"bottom",middleware:[Ir(8),_r({padding:8}),Mr()]});Object.assign(this.tooltip.style,{left:`${r}px`,top:`${n}px`,position:"fixed"})}catch(r){console.warn("Floating UI positioning failed:",r)}}findAnchorElement(e){return this.editor.preview.querySelector(`a[style*="--link-${e}"]`)}hide(){this.tooltip.classList.remove("visible"),this.currentLink=null,this.isTooltipHovered=!1}scheduleHide(){this.cancelHide(),this.hideTimeout=setTimeout(()=>this.hide(),300)}cancelHide(){this.hideTimeout&&(clearTimeout(this.hideTimeout),this.hideTimeout=null)}destroy(){if(this.cancelHide(),this.textareaListeners){for(let[e,t]of Object.entries(this.textareaListeners))this.editor.textarea.removeEventListener(e,t);this.textareaListeners=null}this.visibilityChangeHandler&&(document.removeEventListener("visibilitychange",this.visibilityChangeHandler),this.visibilityChangeHandler=null),this.tooltip&&this.tooltip.parentNode&&this.tooltip.parentNode.removeChild(this.tooltip),this.tooltip=null,this.currentLink=null,this.isTooltipHovered=!1}},Fr=`<svg viewBox="0 0 18 18">
  <path stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5,4H9.5A2.5,2.5,0,0,1,12,6.5v0A2.5,2.5,0,0,1,9.5,9H5A0,0,0,0,1,5,9V4A0,0,0,0,1,5,4Z"></path>
  <path stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5,9h5.5A2.5,2.5,0,0,1,13,11.5v0A2.5,2.5,0,0,1,10.5,14H5a0,0,0,0,1,0,0V9A0,0,0,0,1,5,9Z"></path>
</svg>`,Rr=`<svg viewBox="0 0 18 18">
  <line stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="7" x2="13" y1="4" y2="4"></line>
  <line stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="5" x2="11" y1="14" y2="14"></line>
  <line stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="8" x2="10" y1="14" y2="4"></line>
</svg>`,Or=`<svg viewBox="0 0 18 18">
  <path fill="currentColor" d="M10,4V14a1,1,0,0,1-2,0V10H3v4a1,1,0,0,1-2,0V4A1,1,0,0,1,3,4V8H8V4a1,1,0,0,1,2,0Zm6.06787,9.209H14.98975V7.59863a.54085.54085,0,0,0-.605-.60547h-.62744a1.01119,1.01119,0,0,0-.748.29688L11.645,8.56641a.5435.5435,0,0,0-.022.8584l.28613.30762a.53861.53861,0,0,0,.84717.0332l.09912-.08789a1.2137,1.2137,0,0,0,.2417-.35254h.02246s-.01123.30859-.01123.60547V13.209H12.041a.54085.54085,0,0,0-.605.60547v.43945a.54085.54085,0,0,0,.605.60547h4.02686a.54085.54085,0,0,0,.605-.60547v-.43945A.54085.54085,0,0,0,16.06787,13.209Z"></path>
</svg>`,Br=`<svg viewBox="0 0 18 18">
  <path fill="currentColor" d="M16.73975,13.81445v.43945a.54085.54085,0,0,1-.605.60547H11.855a.58392.58392,0,0,1-.64893-.60547V14.0127c0-2.90527,3.39941-3.42187,3.39941-4.55469a.77675.77675,0,0,0-.84717-.78125,1.17684,1.17684,0,0,0-.83594.38477c-.2749.26367-.561.374-.85791.13184l-.4292-.34082c-.30811-.24219-.38525-.51758-.1543-.81445a2.97155,2.97155,0,0,1,2.45361-1.17676,2.45393,2.45393,0,0,1,2.68408,2.40918c0,2.45312-3.1792,2.92676-3.27832,3.93848h2.79443A.54085.54085,0,0,1,16.73975,13.81445ZM9,3A.99974.99974,0,0,0,8,4V8H3V4A1,1,0,0,0,1,4V14a1,1,0,0,0,2,0V10H8v4a1,1,0,0,0,2,0V4A.99974.99974,0,0,0,9,3Z"></path>
</svg>`,zr=`<svg viewBox="0 0 18 18">
  <path fill="currentColor" d="M16.65186,12.30664a2.6742,2.6742,0,0,1-2.915,2.68457,3.96592,3.96592,0,0,1-2.25537-.6709.56007.56007,0,0,1-.13232-.83594L11.64648,13c.209-.34082.48389-.36328.82471-.1543a2.32654,2.32654,0,0,0,1.12256.33008c.71484,0,1.12207-.35156,1.12207-.78125,0-.61523-.61621-.86816-1.46338-.86816H13.2085a.65159.65159,0,0,1-.68213-.41895l-.05518-.10937a.67114.67114,0,0,1,.14307-.78125l.71533-.86914a8.55289,8.55289,0,0,1,.68213-.7373V8.58887a3.93913,3.93913,0,0,1-.748.05469H11.9873a.54085.54085,0,0,1-.605-.60547V7.59863a.54085.54085,0,0,1,.605-.60547h3.75146a.53773.53773,0,0,1,.60547.59375v.17676a1.03723,1.03723,0,0,1-.27539.748L14.74854,10.0293A2.31132,2.31132,0,0,1,16.65186,12.30664ZM9,3A.99974.99974,0,0,0,8,4V8H3V4A1,1,0,0,0,1,4V14a1,1,0,0,0,2,0V10H8v4a1,1,0,0,0,2,0V4A.99974.99974,0,0,0,9,3Z"></path>
</svg>`,jr=`<svg viewBox="0 0 18 18">
  <line stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="7" x2="11" y1="7" y2="11"></line>
  <path stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.9,4.577a3.476,3.476,0,0,1,.36,4.679A3.476,3.476,0,0,1,4.577,8.9C3.185,7.5,2.035,6.4,4.217,4.217S7.5,3.185,8.9,4.577Z"></path>
  <path stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.423,9.1a3.476,3.476,0,0,0-4.679-.36,3.476,3.476,0,0,0,.36,4.679c1.392,1.392,2.5,2.542,4.679.36S14.815,10.5,13.423,9.1Z"></path>
</svg>`,Nr=`<svg viewBox="0 0 18 18">
  <polyline stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" points="5 7 3 9 5 11"></polyline>
  <polyline stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" points="13 7 15 9 13 11"></polyline>
  <line stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="10" x2="8" y1="5" y2="13"></line>
</svg>`,Vr=`<svg viewBox="0 0 18 18">
  <line stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="6" x2="15" y1="4" y2="4"></line>
  <line stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="6" x2="15" y1="9" y2="9"></line>
  <line stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="6" x2="15" y1="14" y2="14"></line>
  <line stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="3" x2="3" y1="4" y2="4"></line>
  <line stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="3" x2="3" y1="9" y2="9"></line>
  <line stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="3" x2="3" y1="14" y2="14"></line>
</svg>`,Ur=`<svg viewBox="0 0 18 18">
  <line stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="7" x2="15" y1="4" y2="4"></line>
  <line stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="7" x2="15" y1="9" y2="9"></line>
  <line stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="7" x2="15" y1="14" y2="14"></line>
  <line stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="1" x1="2.5" x2="4.5" y1="5.5" y2="5.5"></line>
  <path fill="currentColor" d="M3.5,6A0.5,0.5,0,0,1,3,5.5V3.085l-0.276.138A0.5,0.5,0,0,1,2.053,3c-0.124-.247-0.023-0.324.224-0.447l1-.5A0.5,0.5,0,0,1,4,2.5v3A0.5,0.5,0,0,1,3.5,6Z"></path>
  <path stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M4.5,10.5h-2c0-.234,1.85-1.076,1.85-2.234A0.959,0.959,0,0,0,2.5,8.156"></path>
  <path stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M2.5,14.846a0.959,0.959,0,0,0,1.85-.109A0.7,0.7,0,0,0,3.75,14a0.688,0.688,0,0,0,.6-0.736,0.959,0.959,0,0,0-1.85-.109"></path>
</svg>`,qr=`<svg viewBox="2 2 20 20">
  <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 10.8182L9 10.8182C8.80222 10.8182 8.60888 10.7649 8.44443 10.665C8.27998 10.5651 8.15181 10.4231 8.07612 10.257C8.00043 10.0909 7.98063 9.90808 8.01922 9.73174C8.0578 9.55539 8.15304 9.39341 8.29289 9.26627C8.43275 9.13913 8.61093 9.05255 8.80491 9.01747C8.99889 8.98239 9.19996 9.00039 9.38268 9.0692C9.56541 9.13801 9.72159 9.25453 9.83147 9.40403C9.94135 9.55353 10 9.72929 10 9.90909L10 12.1818C10 12.664 9.78929 13.1265 9.41421 13.4675C9.03914 13.8084 8.53043 14 8 14"></path>
  <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 10.8182L15 10.8182C14.8022 10.8182 14.6089 10.7649 14.4444 10.665C14.28 10.5651 14.1518 10.4231 14.0761 10.257C14.0004 10.0909 13.9806 9.90808 14.0192 9.73174C14.0578 9.55539 14.153 9.39341 14.2929 9.26627C14.4327 9.13913 14.6109 9.05255 14.8049 9.01747C14.9989 8.98239 15.2 9.00039 15.3827 9.0692C15.5654 9.13801 15.7216 9.25453 15.8315 9.40403C15.9414 9.55353 16 9.72929 16 9.90909L16 12.1818C16 12.664 15.7893 13.1265 15.4142 13.4675C15.0391 13.8084 14.5304 14 14 14"></path>
</svg>`,Wr=`<svg viewBox="0 0 18 18">
  <line stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="8" x2="16" y1="4" y2="4"></line>
  <line stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="8" x2="16" y1="9" y2="9"></line>
  <line stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="8" x2="16" y1="14" y2="14"></line>
  <rect stroke="currentColor" fill="none" stroke-width="1.5" x="2" y="3" width="3" height="3" rx="0.5"></rect>
  <rect stroke="currentColor" fill="none" stroke-width="1.5" x="2" y="13" width="3" height="3" rx="0.5"></rect>
  <polyline stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" points="2.65 9.5 3.5 10.5 5 8.5"></polyline>
</svg>`,Kr=`<svg viewBox="0 0 18 18">
  <path stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.25 12.375v1.688A1.688 1.688 0 0 0 3.938 15.75h10.124a1.688 1.688 0 0 0 1.688-1.688V12.375"></path>
  <path stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5.063 6.188L9 2.25l3.938 3.938"></path>
  <path stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 2.25v10.125"></path>
</svg>`,Zr=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" fill="none"></path>
  <circle cx="12" cy="12" r="3" fill="none"></circle>
</svg>`,S={bold:{name:"bold",actionId:"toggleBold",icon:Fr,title:"Bold (Ctrl+B)",isActive:({activeFormats:e})=>e.includes("bold"),action:({editor:e})=>{Ze(e.textarea),e.textarea.dispatchEvent(new Event("input",{bubbles:!0}))}},italic:{name:"italic",actionId:"toggleItalic",icon:Rr,title:"Italic (Ctrl+I)",isActive:({activeFormats:e})=>e.includes("italic"),action:({editor:e})=>{Ge(e.textarea),e.textarea.dispatchEvent(new Event("input",{bubbles:!0}))}},code:{name:"code",actionId:"toggleCode",icon:Nr,title:"Inline Code",isActive:()=>!1,action:({editor:e})=>{Je(e.textarea),e.textarea.dispatchEvent(new Event("input",{bubbles:!0}))}},separator:{name:"separator"},link:{name:"link",actionId:"insertLink",icon:jr,title:"Insert Link",action:({editor:e})=>{Qe(e.textarea),e.textarea.dispatchEvent(new Event("input",{bubbles:!0}))}},h1:{name:"h1",actionId:"toggleH1",icon:Or,title:"Heading 1",isActive:({activeFormats:e})=>e.includes("header"),action:({editor:e})=>{tt(e.textarea),e.textarea.dispatchEvent(new Event("input",{bubbles:!0}))}},h2:{name:"h2",actionId:"toggleH2",icon:Br,title:"Heading 2",isActive:({activeFormats:e})=>e.includes("header-2"),action:({editor:e})=>{it(e.textarea),e.textarea.dispatchEvent(new Event("input",{bubbles:!0}))}},h3:{name:"h3",actionId:"toggleH3",icon:zr,title:"Heading 3",isActive:({activeFormats:e})=>e.includes("header-3"),action:({editor:e})=>{rt(e.textarea),e.textarea.dispatchEvent(new Event("input",{bubbles:!0}))}},bulletList:{name:"bulletList",actionId:"toggleBulletList",icon:Vr,title:"Bullet List",isActive:({activeFormats:e})=>e.includes("bullet-list"),action:({editor:e})=>{Xe(e.textarea),e.textarea.dispatchEvent(new Event("input",{bubbles:!0}))}},orderedList:{name:"orderedList",actionId:"toggleNumberedList",icon:Ur,title:"Numbered List",isActive:({activeFormats:e})=>e.includes("numbered-list"),action:({editor:e})=>{Ye(e.textarea),e.textarea.dispatchEvent(new Event("input",{bubbles:!0}))}},taskList:{name:"taskList",actionId:"toggleTaskList",icon:Wr,title:"Task List",isActive:({activeFormats:e})=>e.includes("task-list"),action:({editor:e})=>{we&&(we(e.textarea),e.textarea.dispatchEvent(new Event("input",{bubbles:!0})))}},quote:{name:"quote",actionId:"toggleQuote",icon:qr,title:"Quote",isActive:({activeFormats:e})=>e.includes("quote"),action:({editor:e})=>{et(e.textarea),e.textarea.dispatchEvent(new Event("input",{bubbles:!0}))}},upload:{name:"upload",actionId:"uploadFile",icon:Kr,title:"Upload File",action:({editor:e})=>{var t,i;if(!((t=e.options.fileUpload)!=null&&t.enabled))return;let r=document.createElement("input");r.type="file",r.multiple=!0,((i=e.options.fileUpload.mimeTypes)==null?void 0:i.length)>0&&(r.accept=e.options.fileUpload.mimeTypes.join(",")),r.onchange=()=>{var n;if(!((n=r.files)!=null&&n.length))return;let o=new DataTransfer;for(let a of r.files)o.items.add(a);e._handleDataTransfer(o)},r.click()}},viewMode:{name:"viewMode",icon:Zr,title:"View mode"}},Ve=[S.bold,S.italic,S.code,S.separator,S.link,S.separator,S.h1,S.h2,S.h3,S.separator,S.bulletList,S.orderedList,S.taskList,S.separator,S.quote,S.separator,S.viewMode],ae;function Gr(){if(ae!==void 0)return ae;if(ae=!1,typeof navigator<"u"){let e=navigator.userAgent||"";ae=/^((?!chrome|android|crios|fxios|edg|opr).)*safari/i.test(e)||/iPad|iPhone|iPod/.test(e)||navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1&&/Safari/.test(e)}return ae}function Pe(e){let t={};return(e||[]).forEach(i=>{if(!i||i.name==="separator")return;let r=i.actionId||i.name;i.action&&(t[r]=i.action)}),t}function $t(e){let t=e||Ve;return Array.isArray(t)?t.map(i=>({name:i?.name||null,actionId:i?.actionId||i?.name||null,icon:i?.icon||null,title:i?.title||null})):null}function Jr(e,t){let i=$t(e),r=$t(t);if(i===null||r===null)return i!==r;if(i.length!==r.length)return!0;for(let n=0;n<i.length;n++){let o=i[n],a=r[n];if(o.name!==a.name||o.actionId!==a.actionId||o.icon!==a.icon||o.title!==a.title)return!0}return!1}var _=class g{constructor(t,i={}){let r=g._resolveTargets(t);if(typeof t=="string"&&r.length===0)throw new Error(`No elements found for selector: ${t}`);return r.map(n=>{if(n.overTypeInstance)return n.overTypeInstance.reinit(i),n.overTypeInstance;let o=Object.create(g.prototype);return o._init(n,i),n.overTypeInstance=o,g.instances.set(n,o),o})}_init(t,i={}){var r;this.element=t,this.instanceTheme=i.theme||null,this.options=this._mergeOptions(i),this.instanceId=++g.instanceCount,this.initialized=!1,this._isSafari=Gr(),this._safariReflowRaf=null,this.options.persist&&!g.stylesChrome&&(g.stylesChrome=!0,(r=document.querySelector("style.overtype-styles"))==null||r.setAttribute("clay","editor-ui")),g.injectStyles(),g.initGlobalListeners();let n=t.querySelector(".overtype-container"),o=t.querySelector(".overtype-wrapper");n||o?this._recoverFromDOM(n,o):this._buildFromScratch(),this.instanceTheme==="auto"&&this.setTheme("auto"),this.shortcuts=new Pt(this),this._rebuildActionsMap(),this.linkTooltip=new Pr(this),requestAnimationFrame(()=>{requestAnimationFrame(()=>{this.textarea.scrollTop=this.preview.scrollTop,this.textarea.scrollLeft=this.preview.scrollLeft})}),this.initialized=!0,this.options.onChange&&this._notifyChange()}_mergeOptions(t){let i={fontSize:"14px",lineHeight:1.6,fontFamily:'"SF Mono", SFMono-Regular, Menlo, Monaco, "Cascadia Code", Consolas, "Roboto Mono", "Noto Sans Mono", "Droid Sans Mono", "Ubuntu Mono", "DejaVu Sans Mono", "Liberation Mono", "Courier New", Courier, monospace',padding:"16px",mobile:{fontSize:"16px",padding:"12px",lineHeight:1.5},textareaProps:{},autofocus:!1,autoResize:!1,minHeight:"100px",maxHeight:null,placeholder:"Start typing...",value:"",onChange:null,onKeydown:null,onRender:null,onFocus:null,onBlur:null,showActiveLineRaw:!1,showStats:!1,toolbar:!1,toolbarButtons:null,statsFormatter:null,smartLists:!0,clickToToggleTasks:!1,codeHighlighter:null,spellcheck:!1,persist:!1,transformLinkUrl:null},{theme:r,colors:n,...o}=t;return{...i,...o}}_recoverFromDOM(t,i){let r=this._extractContent();if(t&&t.classList.contains("overtype-container"))this.container=t,this.wrapper=t.querySelector(".overtype-wrapper");else if(i){if(this.wrapper=i,this.container=document.createElement("div"),this.container.className="overtype-container",this.instanceTheme){let a=typeof this.instanceTheme=="string"?K(this.instanceTheme):this.instanceTheme;a&&a.colors&&(this.container.style.cssText+=se(a.colors))}i.parentNode.insertBefore(this.container,i),this.container.appendChild(i)}if(this.textarea=this.wrapper?this.wrapper.querySelector(".overtype-input"):null,!this.textarea){t&&t.remove(),i&&i.remove(),this._buildFromScratch(r);return}let n=this.instanceTheme||g.currentTheme||U,o=typeof n=="string"?n:n.name;o&&this.container.setAttribute("data-theme",o),this.container.querySelectorAll(".overtype-toolbar, .overtype-link-tooltip, .overtype-stats, .overtype-placeholder, .overtype-preview").forEach(a=>a.remove()),this.container.classList.remove("overtype-auto-resize"),[this.wrapper,this.textarea].forEach(a=>{a.style.removeProperty("height"),a.style.removeProperty("overflow-y")}),this._createOverlay(),this.options.showStats&&this._createStatsBar(),this.wrapper._instance=this,this._applyInstanceCSSVars(),this._configureTextarea(),this._ensureTextareaId(),this._syncPreviewInteractivity(),this._applyOptions()}_buildFromScratch(t=this._extractContent()){this.element.innerHTML="",this._createDOM(),(t||this.options.value)&&this.setValue(t||this.options.value),this._applyOptions()}_extractContent(){let t=this.element.querySelector(".overtype-input");return t?t.value:this.element.textContent||""}_createDOM(){this.container=document.createElement("div"),this.container.className="overtype-container";let t=this.instanceTheme||g.currentTheme||U,i=typeof t=="string"?t:t.name;if(i&&this.container.setAttribute("data-theme",i),this.instanceTheme){let r=typeof this.instanceTheme=="string"?K(this.instanceTheme):this.instanceTheme;if(r&&r.colors){let n=se(r.colors);this.container.style.cssText+=n}}this.wrapper=document.createElement("div"),this.wrapper.className="overtype-wrapper",this._applyInstanceCSSVars(),this.wrapper._instance=this,this.textarea=document.createElement("textarea"),this.textarea.className="overtype-input",this.textarea.placeholder=this.options.placeholder,this._configureTextarea(),this.options.textareaProps&&Object.entries(this.options.textareaProps).forEach(([r,n])=>{r==="className"||r==="class"?this.textarea.className+=" "+n:r==="style"&&typeof n=="object"?Object.assign(this.textarea.style,n):this.textarea.setAttribute(r,n)}),this._ensureTextareaId(),this.wrapper.appendChild(this.textarea),this._createOverlay(),this.container.appendChild(this.wrapper),this.options.showStats&&this._createStatsBar(),this.element.appendChild(this.container),this.options.autoResize?this._setupAutoResize():this.container.classList.remove("overtype-auto-resize"),this._syncPreviewInteractivity()}_createOverlay(){this.preview=document.createElement("div"),this.preview.className="overtype-preview",this.preview.setAttribute("aria-hidden","true"),this.placeholderEl=document.createElement("div"),this.placeholderEl.className="overtype-placeholder",this.placeholderEl.setAttribute("aria-hidden","true"),this.placeholderEl.textContent=this.options.placeholder,this.wrapper.appendChild(this.preview),this.wrapper.appendChild(this.placeholderEl),this._markChrome(this.preview),this._markChrome(this.placeholderEl)}_createStatsBar(){this.statsBar=document.createElement("div"),this.statsBar.className="overtype-stats",this._markChrome(this.statsBar),this.container.appendChild(this.statsBar),this._updateStats()}_markChrome(t){this.options.persist&&t&&t.setAttribute("clay","editor-ui")}_configureTextarea(){this.textarea.setAttribute("autocomplete","off"),this.textarea.setAttribute("autocorrect","off"),this.textarea.setAttribute("autocapitalize","off"),this.textarea.setAttribute("spellcheck",String(this.options.spellcheck)),this.textarea.setAttribute("data-gramm","false"),this.textarea.setAttribute("data-gramm_editor","false"),this.textarea.setAttribute("data-enable-grammarly","false"),this.options.persist&&this.textarea.setAttribute("persist","")}_ensureTextareaId(){let t=this.textarea.id,i=/^overtype-\d+-input$/.test(t);if(t&&!(i&&document.querySelectorAll(`[id="${t}"]`).length>1))return;let r=this.instanceId;for(;document.getElementById(`overtype-${r}-input`);)r++;this.textarea.id=`overtype-${r}-input`}_syncPreviewInteractivity(){if(!this.preview||!this.container)return;let t=this.container.dataset.mode==="preview";if(this.preview.inert=!t,this.preview.toggleAttribute("inert",!t),t){this.preview.removeAttribute("aria-hidden");return}this.preview.setAttribute("aria-hidden","true")}_createToolbar(){var t;let i=this.options.toolbarButtons||Ve;if((t=this.options.fileUpload)!=null&&t.enabled&&!i.some(r=>r?.name==="upload")){let r=i.findIndex(n=>n?.name==="viewMode");r!==-1?(i=[...i],i.splice(r,0,S.separator,S.upload)):i=[...i,S.separator,S.upload]}this.toolbar=new Ni(this,{toolbarButtons:i}),this.toolbar.create(),this._toolbarSelectionListener=()=>{this.toolbar&&this.toolbar.updateButtonStates()},this._toolbarInputListener=()=>{this.toolbar&&this.toolbar.updateButtonStates()},this.textarea.addEventListener("selectionchange",this._toolbarSelectionListener),this.textarea.addEventListener("input",this._toolbarInputListener)}_cleanupToolbarListeners(){this._toolbarSelectionListener&&(this.textarea.removeEventListener("selectionchange",this._toolbarSelectionListener),this._toolbarSelectionListener=null),this._toolbarInputListener&&(this.textarea.removeEventListener("input",this._toolbarInputListener),this._toolbarInputListener=null)}_rebuildActionsMap(){var t;this.actionsById=Pe(Ve),this.options.toolbarButtons&&Object.assign(this.actionsById,Pe(this.options.toolbarButtons)),(t=this.options.fileUpload)!=null&&t.enabled&&Object.assign(this.actionsById,Pe([S.upload]))}_applyInstanceCSSVars(){if(!this.wrapper)return;let t=[["--instance-font-size",this.options.fontSize,N.fontSize],["--instance-line-height",this.options.lineHeight,N.lineHeight],["--instance-padding",this.options.padding,N.padding],["--instance-font-family",this.options.fontFamily,N.fontFamily]];for(let[i,r,n]of t)r&&String(r)!==String(n)?this.wrapper.style.setProperty(i,String(r)):this.wrapper.style.removeProperty(i)}_applyOptions(){this._applyInstanceCSSVars(),this.options.autofocus&&this.textarea.focus(),this.options.autoResize?this.container.classList.contains("overtype-auto-resize")?this._updateAutoHeight():this._setupAutoResize():this.container.classList.remove("overtype-auto-resize"),this.options.toolbar&&!this.toolbar?this._createToolbar():!this.options.toolbar&&this.toolbar&&(this._cleanupToolbarListeners(),this.toolbar.destroy(),this.toolbar=null),this.placeholderEl&&(this.placeholderEl.textContent=this.options.placeholder),this.options.fileUpload&&!this.fileUploadInitialized?this._initFileUpload():!this.options.fileUpload&&this.fileUploadInitialized&&this._destroyFileUpload(),this.updatePreview()}_initFileUpload(){let t=this.options.fileUpload;if(!(!t||!t.enabled)){if(t.maxSize=t.maxSize||10*1024*1024,t.mimeTypes=t.mimeTypes||[],t.batch=t.batch||!1,!t.onInsertFile||typeof t.onInsertFile!="function"){console.warn("OverType: fileUpload.onInsertFile callback is required for file uploads.");return}this._fileUploadCounter=0,this._uploadedFiles=new Map,this._boundHandleFilePaste=this._handleFilePaste.bind(this),this._boundHandleFileDrop=this._handleFileDrop.bind(this),this._boundHandleDragOver=this._handleDragOver.bind(this),this.textarea.addEventListener("paste",this._boundHandleFilePaste),this.textarea.addEventListener("drop",this._boundHandleFileDrop),this.textarea.addEventListener("dragover",this._boundHandleDragOver),this.fileUploadInitialized=!0}}_extractMarkdownUrls(t){return T.findLinks(t,{allowEmptyText:!0}).map(i=>i.destination.value)}_trackInsertedUrls(t,i){if(!this._uploadedFiles||!i||!t)return;let r=T.findLinks(t,{allowEmptyText:!0});for(let n of r)this._uploadedFiles.set(n.destination.value,{filename:i.name,file:i,markdownDestination:n.destination.raw})}_checkForRemovedUploads(){var t;if(!this._uploadedFiles||this._uploadedFiles.size===0)return;let i=(t=this.options.fileUpload)==null?void 0:t.onRemoveFile,r=this.textarea.value,n=new Set(this._extractMarkdownUrls(this.textarea.value)),o=[];for(let[a,s]of this._uploadedFiles){let p=s.markdownDestination||a;!n.has(a)&&!r.includes(p)&&o.push({url:a,info:s})}for(let{url:a,info:s}of o)this._uploadedFiles.delete(a),i&&i({url:a,filename:s.filename,file:s.file})}_handleFilePaste(t){var i,r;(r=(i=t?.clipboardData)==null?void 0:i.files)!=null&&r.length&&(t.preventDefault(),this._handleDataTransfer(t.clipboardData))}_handleFileDrop(t){var i,r;(r=(i=t?.dataTransfer)==null?void 0:i.files)!=null&&r.length&&(t.preventDefault(),this._handleDataTransfer(t.dataTransfer))}_handleDataTransfer(t){let i=[];for(let r of t.files){if(r.size>this.options.fileUpload.maxSize||this.options.fileUpload.mimeTypes.length>0&&!this.options.fileUpload.mimeTypes.includes(r.type))continue;let n=++this._fileUploadCounter,o=`${r.type.startsWith("image/")?"!":""}[Uploading ${r.name} (#${n})...]()`;if(this.insertAtCursor(`${o}
`),this.options.fileUpload.batch){i.push({file:r,placeholder:o});continue}this.options.fileUpload.onInsertFile(r).then(a=>{this.textarea.value=this.textarea.value.replace(o,a),this._trackInsertedUrls(a,r),this.textarea.dispatchEvent(new Event("input",{bubbles:!0}))},a=>{console.error("OverType: File upload failed",a),this.textarea.value=this.textarea.value.replace(o,"[Upload failed]()"),this.textarea.dispatchEvent(new Event("input",{bubbles:!0}))})}this.options.fileUpload.batch&&i.length>0&&this.options.fileUpload.onInsertFile(i.map(r=>r.file)).then(r=>{(Array.isArray(r)?r:[r]).forEach((n,o)=>{this.textarea.value=this.textarea.value.replace(i[o].placeholder,n),this._trackInsertedUrls(n,i[o].file)}),this.textarea.dispatchEvent(new Event("input",{bubbles:!0}))},r=>{console.error("OverType: File upload failed",r),i.forEach(({placeholder:n})=>{this.textarea.value=this.textarea.value.replace(n,"[Upload failed]()")}),this.textarea.dispatchEvent(new Event("input",{bubbles:!0}))})}_handleDragOver(t){t.preventDefault()}_destroyFileUpload(){this.textarea.removeEventListener("paste",this._boundHandleFilePaste),this.textarea.removeEventListener("drop",this._boundHandleFileDrop),this.textarea.removeEventListener("dragover",this._boundHandleDragOver),this._boundHandleFilePaste=null,this._boundHandleFileDrop=null,this._boundHandleDragOver=null,this._uploadedFiles=null,this.fileUploadInitialized=!1}_handleTaskClick(t){if(!this.options.clickToToggleTasks||t.button!==0||!this._canEditTextarea()||this.container.dataset.mode==="preview")return;let i=[...this.preview.querySelectorAll("li.task-list, div.raw-line")].filter(a=>a.matches("li.task-list")||/^ *-\s+\[[ xX]\](?:\s|$)/.test(a.textContent)),r=0,n=0,o=null;for(let a of this.textarea.value.split(`
`)){if(o){Ue(a,o)&&(o=null),n+=a.length+1;continue}if(o=le(a),o){n+=a.length+1;continue}let s=/^( *-\s+\[)([ xX])\](?:\s|$)/.exec(a);if(!s||!T.parseLine(a).includes('<li class="task-list">')){n+=a.length+1;continue}let p=i[r++],l=p?.matches("li.task-list")?p.querySelector(":scope > .syntax-marker"):p,c=l?.firstChild;if(c?.nodeType===3){let d=c.textContent.indexOf("[")+1;if(!/^\[[ xX]\]$/.test(c.textContent.slice(d-1,d+2))){n+=a.length+1;continue}let h=document.createRange();if(h.setStart(c,d-1),h.setEnd(c,d+2),[...h.getClientRects()].some(u=>t.clientX>=u.left&&t.clientX<u.right&&t.clientY>=u.top&&t.clientY<u.bottom)){let u=this.textarea,f=u.selectionStart,m=u.selectionEnd,v=u.selectionDirection,y=n+s[1].length;u.focus(),u.setSelectionRange(y,y+1);let b=s[2]===" "?"x":" ",w=!1,k=()=>{w=!0};u.addEventListener("input",k);let E=!1;try{E=document.execCommand("insertText",!1,b)}catch{}finally{u.removeEventListener("input",k)}E||u.setRangeText(b,y,y+1,"preserve"),w||u.dispatchEvent(new Event("input",{bubbles:!0})),u.setSelectionRange(f,m,v);return}}n+=a.length+1}}insertAtCursor(t){let i=this.textarea.selectionStart,r=this.textarea.selectionEnd,n=!1;try{n=document.execCommand("insertText",!1,t)}catch{}if(!n){let o=this.textarea.value.slice(0,i),a=this.textarea.value.slice(r);this.textarea.value=o+t+a,this.textarea.setSelectionRange(i+t.length,i+t.length)}this.textarea.dispatchEvent(new Event("input",{bubbles:!0}))}updatePreview(){let t=this.textarea.value,i=this.textarea.selectionStart,r=this._getCurrentLine(t,i),n=this.container.dataset.mode==="preview",o=T.parse(t,r,this.options.showActiveLineRaw,this.options.codeHighlighter,n);this.preview.innerHTML=o,this.placeholderEl&&(this.placeholderEl.style.display=t?"none":""),this._applyCodeBlockBackgrounds(),this.options.showStats&&this.statsBar&&this._updateStats(),this.options.onRender&&this.options.onRender(this.preview,n?"preview":"normal",this)}_notifyChange(){this.initialized&&(this._checkForRemovedUploads(),this.options.onChange&&this.options.onChange(this.textarea.value,this))}_applyCodeBlockBackgrounds(){let t=this.preview.querySelectorAll(".code-fence");for(let i=0;i<t.length-1;i+=2){let r=t[i],n=t[i+1],o=r.parentElement,a=n.parentElement;!o||!a||(r.style.display="block",n.style.display="block",o.classList.add("code-block-line"),a.classList.add("code-block-line"))}}_getCurrentLine(t,i){return t.substring(0,i).split(`
`).length-1}handleInput(t){this.updatePreview(),this._notifyChange(),this._scheduleSafariReflow()}_scheduleSafariReflow(){!this._isSafari||this._safariReflowRaf||(this._safariReflowRaf=requestAnimationFrame(()=>{this._safariReflowRaf=null;let t=this.textarea;t&&(t.style.setProperty("letter-spacing","-0.001px","important"),t.offsetHeight,t.style.removeProperty("letter-spacing"))}))}handleFocus(t){this.options.onFocus&&this.options.onFocus(t,this)}handleBlur(t){this.options.onBlur&&this.options.onBlur(t,this)}handleKeydown(t){if(t.key==="Tab"){let i=this.textarea.selectionStart,r=this.textarea.selectionEnd;if(i!==r&&this._canEditTextarea()){t.preventDefault(),t.shiftKey?this.outdentSelection():this.indentSelection();return}}if(t.key==="Enter"&&!t.shiftKey&&!t.metaKey&&!t.ctrlKey&&this.options.smartLists&&this.handleSmartListContinuation()){t.preventDefault();return}!this.shortcuts.handleKeydown(t)&&this.options.onKeydown&&this.options.onKeydown(t,this)}handleSmartListContinuation(){let t=this.textarea,i=t.selectionStart,r=T.getListContext(t.value,i);return!r||!r.inList?!1:r.content.trim()===""&&i>=r.markerEndPos?(this.deleteListMarker(r),!0):(i>r.markerEndPos&&i<r.lineEnd?this.splitListItem(r,i):this.insertNewListItem(r),r.listType==="numbered"&&this.scheduleNumberedListUpdate(),!0)}deleteListMarker(t){this.textarea.setSelectionRange(t.lineStart,t.markerEndPos),document.execCommand("delete"),this.textarea.dispatchEvent(new Event("input",{bubbles:!0}))}insertNewListItem(t){let i=T.createNewListItem(t);document.execCommand("insertText",!1,`
`+i),this.textarea.dispatchEvent(new Event("input",{bubbles:!0}))}splitListItem(t,i){let r=t.content.substring(i-t.markerEndPos);this.textarea.setSelectionRange(i,t.lineEnd),document.execCommand("delete");let n=T.createNewListItem(t);document.execCommand("insertText",!1,`
`+n+r);let o=this.textarea.selectionStart-r.length;this.textarea.setSelectionRange(o,o),this.textarea.dispatchEvent(new Event("input",{bubbles:!0}))}scheduleNumberedListUpdate(){this.numberUpdateTimeout&&clearTimeout(this.numberUpdateTimeout),this.numberUpdateTimeout=setTimeout(()=>{this.updateNumberedLists()},10)}updateNumberedLists(){let t=this.textarea.value,i=this.textarea.selectionStart,r=T.renumberLists(t);if(r!==t){let n=0,o=t.split(`
`),a=r.split(`
`),s=0;for(let l=0;l<o.length&&s<i;l++){if(o[l]!==a[l]){let c=a[l].length-o[l].length;s+o[l].length<i&&(n+=c)}s+=o[l].length+1}this.textarea.value=r;let p=i+n;this.textarea.setSelectionRange(p,p),this.textarea.dispatchEvent(new Event("input",{bubbles:!0}))}}handleScroll(t){this.preview.scrollTop=this.textarea.scrollTop,this.preview.scrollLeft=this.textarea.scrollLeft}getValue(){return this.textarea.value}setValue(t){let i=this.textarea.value!==t;this.textarea.value=t,this.updatePreview(),this.options.autoResize&&this._updateAutoHeight(),i&&(this._notifyChange(),this._scheduleSafariReflow())}async performAction(t,i=null){var r;let n=this.textarea;if(!n)return!1;let o=(r=this.actionsById)==null?void 0:r[t];if(!o)return console.warn(`OverType: Unknown action "${t}"`),!1;n.focus();try{return await o({editor:this,getValue:()=>this.getValue(),setValue:a=>this.setValue(a),event:i}),!0}catch(a){return console.error(`OverType: Action "${t}" error:`,a),this.wrapper.dispatchEvent(new CustomEvent("button-error",{detail:{actionId:t,error:a}})),!1}}getRenderedHTML(t={}){let i=this.getValue(),r=T.parse(i,-1,!1,this.options.codeHighlighter);return t.cleanHTML&&(r=r.replace(/<span class="syntax-marker[^"]*">.*?<\/span>/g,""),r=r.replace(/\sclass="(bullet-list|ordered-list|code-fence|hr-marker|blockquote|url-part)"/g,""),r=r.replace(/\sclass=""/g,"")),r}getPreviewHTML(){return this.preview.innerHTML}indentSelection(){this._replaceSelectedLines(t=>`  ${t}`)}outdentSelection(){this._replaceSelectedLines(t=>t.replace(/^( {1,2}|\t)/,""))}_replaceSelectedLines(t){if(!this._canEditTextarea())return!1;let i=this.textarea,{selectionStart:r,selectionEnd:n,value:o}=i,a=o.lastIndexOf(`
`,r-1)+1,s=this._effectiveSelectionEnd(o,r,n),p=o.indexOf(`
`,s),l=p===-1?o.length:p,c=o.slice(a,l),d=c.split(`
`).map(t).join(`
`);if(d===c)return!1;i.setSelectionRange(a,l);let h=!1;try{h=document.execCommand("insertText",!1,d)}catch{}return h||i.setRangeText(d,a,l,"preserve"),i.setSelectionRange(a,a+d.length),i.dispatchEvent(new Event("input",{bubbles:!0})),!0}_effectiveSelectionEnd(t,i,r){return r>i&&t[r-1]===`
`?r-1:r}_canEditTextarea(){return this.textarea&&!this.textarea.disabled&&!this.textarea.readOnly}getCleanHTML(){return this.getRenderedHTML({cleanHTML:!0})}focus(){this.textarea.focus()}blur(){this.textarea.blur()}isInitialized(){return this.initialized}reinit(t={}){var i;let r=(i=this.options)==null?void 0:i.toolbarButtons;this.options=this._mergeOptions({...this.options,...t});let n=this.toolbar&&this.options.toolbar&&Jr(r,this.options.toolbarButtons);this._rebuildActionsMap(),n&&(this._cleanupToolbarListeners(),this.toolbar.destroy(),this.toolbar=null,this._createToolbar()),this.fileUploadInitialized&&this._destroyFileUpload(),this.options.fileUpload&&this._initFileUpload(),this._applyOptions(),this.updatePreview()}showToolbar(){this.toolbar?this.toolbar.show():this._createToolbar()}hideToolbar(){this.toolbar&&this.toolbar.hide()}setTheme(t){if(g._autoInstances.delete(this),this.instanceTheme=t,t==="auto")g._autoInstances.add(this),g._startAutoListener(),this._applyResolvedTheme(vt("auto"));else{let i=typeof t=="string"?K(t):t,r=typeof i=="string"?i:i.name;if(r&&this.container.setAttribute("data-theme",r),i&&i.colors){let n=se(i.colors,i.previewColors);this.container.style.cssText+=n}this.updatePreview()}return g._stopAutoListener(),this}_applyResolvedTheme(t){let i=K(t);this.container.setAttribute("data-theme",t),i&&i.colors&&(this.container.style.cssText=se(i.colors,i.previewColors)),this.updatePreview()}setCodeHighlighter(t){this.options.codeHighlighter=t,this.updatePreview()}_updateStats(){if(!this.statsBar)return;let t=this.textarea.value,i=t.split(`
`),r=t.length,n=t.split(/\s+/).filter(l=>l.length>0).length,o=this.textarea.selectionStart,a=t.substring(0,o).split(`
`),s=a.length,p=a[a.length-1].length+1;this.options.statsFormatter?this.statsBar.innerHTML=this.options.statsFormatter({chars:r,words:n,lines:i.length,line:s,column:p}):this.statsBar.innerHTML=`
          <div class="overtype-stat">
            <span class="live-dot"></span>
            <span>${r} chars, ${n} words, ${i.length} lines</span>
          </div>
          <div class="overtype-stat">Line ${s}, Col ${p}</div>
        `}_setupAutoResize(){this.container.classList.add("overtype-auto-resize"),this.previousHeight=null,this._updateAutoHeight(),this._autoResizeHandler||(this._autoResizeHandler=()=>this._updateAutoHeight(),this.textarea.addEventListener("input",this._autoResizeHandler),window.addEventListener("resize",this._autoResizeHandler))}_updateAutoHeight(){if(!this.options.autoResize)return;let t=this.textarea,i=this.preview,r=this.wrapper;if(this.container.dataset.mode==="preview"){r.style.removeProperty("height"),i.style.removeProperty("height"),i.style.removeProperty("overflow-y"),t.style.removeProperty("height"),t.style.removeProperty("overflow-y");return}let n=t.scrollTop;r.style.setProperty("height","auto","important"),t.style.setProperty("height","auto","important");let o=t.scrollHeight;if(this.options.minHeight){let p=parseInt(this.options.minHeight);o=Math.max(o,p)}let a="hidden";if(this.options.maxHeight){let p=parseInt(this.options.maxHeight);o>p&&(o=p,a="auto")}let s=o+"px";t.style.setProperty("height",s,"important"),t.style.setProperty("overflow-y",a,"important"),i.style.setProperty("height",s,"important"),i.style.setProperty("overflow-y",a,"important"),r.style.setProperty("height",s,"important"),t.scrollTop=n,i.scrollTop=n,this.previousHeight!==o&&(this.previousHeight=o)}showStats(t){this.options.showStats=t,t&&!this.statsBar?this._createStatsBar():t&&this.statsBar?this._updateStats():!t&&this.statsBar&&(this.statsBar.remove(),this.statsBar=null)}showNormalEditMode(){return this.container.dataset.mode="normal",this._syncPreviewInteractivity(),this.updatePreview(),this._updateAutoHeight(),requestAnimationFrame(()=>{this.textarea.scrollTop=this.preview.scrollTop,this.textarea.scrollLeft=this.preview.scrollLeft}),this}showPlainTextarea(){if(this.container.dataset.mode="plain",this._syncPreviewInteractivity(),this._updateAutoHeight(),this.toolbar){let t=this.container.querySelector('[data-action="toggle-plain"]');t&&(t.classList.remove("active"),t.title="Show markdown preview")}return this}showPreviewMode(){return this.container.dataset.mode="preview",this._syncPreviewInteractivity(),this.updatePreview(),this._updateAutoHeight(),this}destroy(){if(g._autoInstances.delete(this),g._stopAutoListener(),this.fileUploadInitialized&&this._destroyFileUpload(),this.element.overTypeInstance=null,g.instances.delete(this.element),this.shortcuts&&this.shortcuts.destroy(),this._safariReflowRaf&&(cancelAnimationFrame(this._safariReflowRaf),this._safariReflowRaf=null),this.linkTooltip&&(this.linkTooltip.destroy(),this.linkTooltip=null),this.toolbar&&(this._cleanupToolbarListeners(),this.toolbar.destroy(),this.toolbar=null),this._autoResizeHandler&&(this.textarea.removeEventListener("input",this._autoResizeHandler),window.removeEventListener("resize",this._autoResizeHandler),this._autoResizeHandler=null),this.wrapper)if(this.options.persist)[this.preview,this.placeholderEl,this.statsBar].forEach(t=>t?.remove()),this.statsBar=null,this.wrapper._instance=null;else{let t=this.getValue();this.wrapper.remove(),this.element.textContent=t}this.initialized=!1}static init(t,i={}){return new g(t,i)}static initFromData(t,i={}){return g._resolveTargets(t).map(r=>{let n={...i};for(let o of r.attributes){if(!o.name.startsWith("data-ot-"))continue;let a=o.name.slice(8);if(a.startsWith("textarea-")&&a!=="textarea-props"){let p=a.slice(9).replace(/-([a-z])/g,(l,c)=>c.toUpperCase());n.textareaProps={...n.textareaProps||{},[p]:g._parseDataValue(o.value)};continue}let s=a.replace(/-([a-z])/g,(p,l)=>l.toUpperCase());n[s]=g._parseDataValue(o.value)}return new g(r,n)[0]})}static _resolveTargets(t){if(t==null)throw new Error("Invalid target: must be selector string, Element, NodeList, or Array");if(typeof t=="string")return Array.from(document.querySelectorAll(t));if(t instanceof Element)return[t];if(t instanceof NodeList)return Array.from(t);if(Array.isArray(t))return t;if(typeof t.length=="number")return Array.from(t);throw new Error("Invalid target: must be selector string, Element, NodeList, or Array")}static _parseDataValue(t){if(t==="true")return!0;if(t==="false")return!1;if(t==="null")return null;if(t!==""&&!isNaN(Number(t)))return Number(t);let i=t.trim();if(i[0]==="{"||i[0]==="[")try{return JSON.parse(i)}catch{return t}return t}static getInstance(t){let i;return t instanceof Element?i=t:i=g._resolveTargets(t)[0],i&&(i.overTypeInstance||g.instances.get(i))||null}static destroyAll(){document.querySelectorAll("[data-overtype-instance]").forEach(t=>{let i=g.getInstance(t);i&&i.destroy()})}static injectStyles(t=!1){if(g.stylesInjected&&!t)return;let i=document.querySelector("style.overtype-styles");i&&i.remove();let r=g.currentTheme||U,n=Ai({theme:r}),o=document.createElement("style");o.className="overtype-styles",g.stylesChrome&&o.setAttribute("clay","editor-ui"),o.textContent=n,document.head.appendChild(o),g.stylesInjected=!0}static setTheme(t,i=null){if(g._globalAutoTheme=!1,g._globalAutoCustomColors=null,t==="auto"){g._globalAutoTheme=!0,g._globalAutoCustomColors=i,g._startAutoListener(),g._applyGlobalTheme(vt("auto"),i);return}g._stopAutoListener(),g._applyGlobalTheme(t,i)}static _applyGlobalTheme(t,i=null){let r=typeof t=="string"?K(t):t;i&&(r=Ci(r,i)),g.currentTheme=r,g.injectStyles(!0);let n=typeof r=="string"?r:r.name;document.querySelectorAll(".overtype-container").forEach(o=>{let a=o.querySelector(".overtype-wrapper");n&&a&&a._instance&&o.setAttribute("data-theme",n)}),document.querySelectorAll(".overtype-wrapper").forEach(o=>{o.closest(".overtype-container")||n&&o.setAttribute("data-theme",n);let a=o._instance;a&&a.updatePreview()}),document.querySelectorAll("overtype-editor").forEach(o=>{n&&typeof o.setAttribute=="function"&&o.setAttribute("theme",n),typeof o.refreshTheme=="function"&&o.refreshTheme()})}static _startAutoListener(){g._autoMediaQuery||window.matchMedia&&(g._autoMediaQuery=window.matchMedia("(prefers-color-scheme: dark)"),g._autoMediaListener=t=>{let i=t.matches?"cave":"solar";g._globalAutoTheme&&g._applyGlobalTheme(i,g._globalAutoCustomColors),g._autoInstances.forEach(r=>r._applyResolvedTheme(i))},g._autoMediaQuery.addEventListener("change",g._autoMediaListener))}static _stopAutoListener(){g._autoInstances.size>0||g._globalAutoTheme||g._autoMediaQuery&&(g._autoMediaQuery.removeEventListener("change",g._autoMediaListener),g._autoMediaQuery=null,g._autoMediaListener=null)}static setCodeHighlighter(t){T.setCodeHighlighter(t),document.querySelectorAll(".overtype-wrapper").forEach(i=>{let r=i._instance;r&&r.updatePreview&&r.updatePreview()}),document.querySelectorAll("overtype-editor").forEach(i=>{if(typeof i.getEditor=="function"){let r=i.getEditor();r&&r.updatePreview&&r.updatePreview()}})}static setCustomSyntax(t){T.setCustomSyntax(t),document.querySelectorAll(".overtype-wrapper").forEach(i=>{let r=i._instance;r&&r.updatePreview&&r.updatePreview()}),document.querySelectorAll("overtype-editor").forEach(i=>{if(typeof i.getEditor=="function"){let r=i.getEditor();r&&r.updatePreview&&r.updatePreview()}})}static initGlobalListeners(){let t=typeof window<"u"?window:globalThis,i="__overtypeGlobalListenersInitialized";if(g.globalListenersInitialized||t[i]){g.globalListenersInitialized=!0;return}t[i]=!0,document.addEventListener("input",r=>{if(r.target&&r.target.classList&&r.target.classList.contains("overtype-input")){let n=r.target.closest(".overtype-wrapper"),o=n?._instance;o&&o.handleInput(r)}}),document.addEventListener("keydown",r=>{if(r.target&&r.target.classList&&r.target.classList.contains("overtype-input")){let n=r.target.closest(".overtype-wrapper"),o=n?._instance;o&&o.handleKeydown(r)}}),document.addEventListener("click",r=>{if(r.target&&r.target.classList&&r.target.classList.contains("overtype-input")){let n=r.target.closest(".overtype-wrapper"),o=n?._instance;o&&o._handleTaskClick(r)}}),document.addEventListener("focus",r=>{if(r.target&&r.target.classList&&r.target.classList.contains("overtype-input")){let n=r.target.closest(".overtype-wrapper"),o=n?._instance;o&&o.handleFocus(r)}},!0),document.addEventListener("blur",r=>{if(r.target&&r.target.classList&&r.target.classList.contains("overtype-input")){let n=r.target.closest(".overtype-wrapper"),o=n?._instance;o&&o.handleBlur(r)}},!0),document.addEventListener("scroll",r=>{if(r.target&&r.target.classList&&r.target.classList.contains("overtype-input")){let n=r.target.closest(".overtype-wrapper"),o=n?._instance;o&&o.handleScroll(r)}},!0),document.addEventListener("selectionchange",r=>{let n=document.activeElement;if(n&&n.classList.contains("overtype-input")){let o=n.closest(".overtype-wrapper"),a=o?._instance;a&&(a.options.showStats&&a.statsBar&&a._updateStats(),clearTimeout(a._selectionTimeout),a._selectionTimeout=setTimeout(()=>{a.updatePreview()},50))}}),g.globalListenersInitialized=!0}};C(_,"instances",new WeakMap);C(_,"stylesInjected",!1);C(_,"stylesChrome",!1);C(_,"globalListenersInitialized",!1);C(_,"instanceCount",0);C(_,"_autoMediaQuery",null);C(_,"_autoMediaListener",null);C(_,"_autoInstances",new Set);C(_,"_globalAutoTheme",!1);C(_,"_globalAutoCustomColors",null);var re=_;re.MarkdownParser=T;re.ShortcutsManager=Pt;re.themes={solar:U,cave:K("cave")};re.getTheme=K;re.currentTheme=U;var Qr=re;export{Qr as default,S as toolbarButtons};
