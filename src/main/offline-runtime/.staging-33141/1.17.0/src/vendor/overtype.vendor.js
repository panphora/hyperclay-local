/* overtype 2.6.1, bundled for clayjs: regenerate with npm run vendor:optional */
var Mt=Object.defineProperty,on=(e,t,n)=>t in e?Mt(e,t,{enumerable:!0,configurable:!0,writable:!0,value:n}):e[t]=n,sn=(e,t)=>{for(var n in t)Mt(e,n,{get:t[n],enumerable:!0})},C=(e,t,n)=>(on(e,typeof t!="symbol"?t+"":t,n),n);function pt(e){var t,n;let i=/^( {0,3})(#{1,6})(?:([\t ]+)(.*)|$)/.exec(e);if(!i||i[2].length>3)return null;let r=i[1],o=i[2],s=(t=i[3])!=null?t:"",a=(n=i[4])!=null?n:"",c=/^(#+)[\t ]*$/.exec(a),l=/([\t ]+)(#+)([\t ]*)$/.exec(a),u=c||l;return{type:"heading",level:o.length,indent:r,marker:o,separator:s,content:c?"":u?a.slice(0,l.index):a,closing:c?a:u?l[0]:""}}function me(e){let t=/^( {0,3})([*_-])([\t *_-]*)$/.exec(e);if(!t)return null;let n=t[2],i=t[3];return[...i].some(o=>o!==n&&o!==" "&&o!=="	")||1+[...i].filter(o=>o===n).length<3?null:{type:"thematic-break",marker:n,source:e}}function ut(e){let t=/^( {0,3})>([\t ]?)(.*)$/.exec(e);return!t||t[2]===""&&t[3].startsWith(">")?null:{type:"blockquote",indent:t[1],marker:">",separator:t[2],content:t[3]}}function ve(e){let t=/^( *)([-*+])([\t ]+)(.*)$/.exec(e);if(t)return{type:"list-item",listType:"bullet",indent:t[1],marker:t[2],separator:t[3],content:t[4]};let n=/^( *)([-*+])$/.exec(e);if(n)return{type:"list-item",listType:"bullet",indent:n[1],marker:n[2],separator:"",content:""};let i=/^( *)(\d{1,9}\.)([\t ]+)(.*)$/.exec(e);if(i)return{type:"list-item",listType:"ordered",indent:i[1],marker:i[2],separator:i[3],content:i[4]};let r=/^( *)(\d{1,9}\.)$/.exec(e);return r?{type:"list-item",listType:"ordered",indent:r[1],marker:r[2],separator:"",content:""}:null}function ce(e){let t=/^( {0,3})(`{3,})([^`]*)$/.exec(e);return t?{type:"fence-open",indent:t[1],marker:t[2],length:t[2].length,info:t[3].trim(),source:e}:null}function Ue(e,t){let n=/^( {0,3})(`{3,})[\t ]*$/.exec(e);return!n||n[2].length<t.length?null:{type:"fence-close",indent:n[1],marker:n[2],length:n[2].length,source:e}}var ye=/[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/,an=/^&(?:amp|lt|gt|quot|#39);/,ln={"&amp;":"&","&lt;":"<","&gt;":">","&quot;":'"',"&#39;":"'"};function cn(e,t){return function(i){if(i>=e.length)return[null,0];if(t&&e.charCodeAt(i)===38){let r=an.exec(e.slice(i,i+6));if(r)return[ln[r[0]],r[0].length]}return[e[i],1]}}function Ht(e,t){let n=0;for(;t>0&&e[--t]==="\\";)n++;return n%2===1}var ge=e=>e===" "||e==="	",pn=e=>e!==null&&(e.charCodeAt(0)<32||e.charCodeAt(0)===127);function un(e,t,n,i){let[r,o]=n(t);if(r!=="(")return null;for(t+=o;ge(r=n(t)[0]);)t+=n(t)[1];let s=null;if([r,o]=n(t),r==="<"){let l=t,u="";for(t+=o;;){if([r,o]=n(t),r===null||r==="<"||r===`
`)return null;if(r==="\\"){let[p,h]=n(t+o);if(p!==null&&ye.test(p)){u+=p,t+=o+h;continue}}if(r===">"){t+=o;break}u+=r,t+=o}s={start:l,end:t,raw:e.slice(l,t),value:u}}else if(r!==")"){let l=t,u=0,p="";for(;[r,o]=n(t),!(r===null||r===`
`||ge(r));){if(pn(r))return null;if(r==="\\"){let[h,d]=n(t+o);if(h!==null&&ye.test(h)){p+=h,t+=o+d;continue}p+=r,t+=o;continue}if(r==="("){if(u++,u>i)return null;p+=r,t+=o;continue}if(r===")"){if(u===0)break;u--,p+=r,t+=o;continue}p+=r,t+=o}if(u!==0)return null;s={start:l,end:t,raw:e.slice(l,t),value:p}}let a=t;for(;ge(r=n(t)[0]);)t+=n(t)[1];let c=null;if([r,o]=n(t),r==='"'||r==="'"||r==="("){if(s&&t===a)return null;let l=r==="("?")":r,u=t,p="";for(t+=o;;){if([r,o]=n(t),r===null||r===`
`)return null;if(r==="\\"){let[h,d]=n(t+o);if(h!==null&&ye.test(h)){p+=h,t+=o+d;continue}p+=r,t+=o;continue}if(r===l){t+=o;break}if(l===")"&&r==="(")return null;p+=r,t+=o}for(c={start:u,end:t,raw:e.slice(u,t),value:p,delimiter:l===")"?"(":l};ge(r=n(t)[0]);)t+=n(t)[1]}return[r,o]=n(t),r!==")"?null:{end:t+o,destination:s,title:c}}function dn(e,t,n){for(;n<e.length&&e[n].end<=t;)n++;let i=e[n];return{range:i&&i.start<=t&&t<i.end?i:null,rangeIndex:n}}function Re(e,{htmlEntities:t=!1,maxParenDepth:n=32,ignoreRanges:i=[]}={}){let r=cn(e,t),o=[...i].sort((u,p)=>u.start-p.start),s=[],a=[],c=0,l=0;for(;l<e.length;){let u=dn(o,l,c);if(c=u.rangeIndex,u.range){l=u.range.end;continue}let[p,h]=r(l);if(p==="\\"){let[d,f]=r(l+h);l+=d!==null&&ye.test(d)?h+f:h;continue}if(p===`
`){a.length=0,l+=h;continue}if(p==="["){let d=l>0&&e[l-1]==="!"&&!Ht(e,l-1);a.push({index:l,image:d}),l+=h;continue}if(p==="]"){let d=a.pop();if(d){let f=un(e,l+h,r,n);if(f){s.push({start:d.index,end:f.end,image:d.image,text:{start:d.index+1,end:l,raw:e.slice(d.index+1,l)},destination:f.destination,title:f.title}),a.length=0,l=f.end;continue}}}l+=h}return s}function De(e,t=[]){let n=[],i=[],r=0;for(;r<e.length;){if(e[r]!=="`"){r++;continue}let a=r;for(;e[r]==="`";)r++;n.push({start:a,end:r,length:r-a})}let o=new Array(n.length),s=new Map;for(let a=n.length-1;a>=0;a--){let c=n[a];o[a]=s.get(c.length),s.set(c.length,a)}for(let a=0;a<n.length;){let c=n[a],l=Ht(e,c.start)||t.some(h=>c.start>=h.start&&c.start<h.end),u=o[a];if(l||u===void 0){a++;continue}let p=n[u];i.push({start:c.start,end:p.end,raw:e.slice(c.start,p.end),openTicks:e.slice(c.start,c.end),content:e.slice(c.end,p.start),closeTicks:e.slice(p.start,p.end)}),a=u+1}return i}function hn(e,t){return{...e,start:e.start+t,end:e.end+t,text:{...e.text,start:e.text.start+t,end:e.text.end+t},destination:e.destination&&{...e.destination,start:e.destination.start+t,end:e.destination.end+t},title:e.title&&{...e.title,start:e.title.start+t,end:e.title.end+t}}}function fn(e,t){if(!e.includes("["))return[];let n=Re(e,t),i=new Set;for(;;){let r=n.map(l=>`${l.start}:${l.end}`).join(",");if(i.has(r))return n;i.add(r);let o=n.map(l=>({start:l.text.end,end:l.end})),s=De(e,o),a=Re(e,{...t,ignoreRanges:s});if(a.map(l=>`${l.start}:${l.end}`).join(",")===r)return a;n=a}}function mn(e,t={}){let n=[],i=e.split(`
`),r=null,o=0;for(let s of i){if(r)Ue(s,r)&&(r=null);else{let a=ce(s);a?r=a:n.push(...fn(s,t).map(c=>hn(c,o)))}o+=s.length+1}return n}var vn={"&amp;":"&","&lt;":"<","&gt;":">","&quot;":'"',"&#39;":"'"},gn=/^&(amp|lt|gt|quot|#39);/,yn=/^[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]$/,wn=/^[\u00a1-\u00a9\u00ab-\u00ac\u00ae-\u00b1\u00b4\u00b6-\u00b8\u00bb\u00bf\u00d7\u00f7\u02c2-\u02c5\u02d2-\u02df\u02e5-\u02eb\u02ed\u02ef-\u02ff\u0375\u037e\u0384-\u0385\u0387\u03f6\u0482\u055a-\u055f\u0589-\u058a\u058d-\u058f\u05be\u05c0\u05c3\u05c6\u05f3-\u05f4\u0606-\u060f\u061b\u061d-\u061f\u066a-\u066d\u06d4\u06de\u06e9\u06fd-\u06fe\u0700-\u070d\u07f6-\u07f9\u07fe-\u07ff\u0830-\u083e\u085e\u0888\u0964-\u0965\u0970\u09f2-\u09f3\u09fa-\u09fb\u09fd\u0a76\u0af0-\u0af1\u0b70\u0bf3-\u0bfa\u0c77\u0c7f\u0c84\u0d4f\u0d79\u0df4\u0e3f\u0e4f\u0e5a-\u0e5b\u0f01-\u0f17\u0f1a-\u0f1f\u0f34\u0f36\u0f38\u0f3a-\u0f3d\u0f85\u0fbe-\u0fc5\u0fc7-\u0fcc\u0fce-\u0fda\u104a-\u104f\u109e-\u109f\u10fb\u1360-\u1368\u1390-\u1399\u1400\u166d-\u166e\u169b-\u169c\u16eb-\u16ed\u1735-\u1736\u17d4-\u17d6\u17d8-\u17db\u1800-\u180a\u1940\u1944-\u1945\u19de-\u19ff\u1a1e-\u1a1f\u1aa0-\u1aa6\u1aa8-\u1aad\u1b4e-\u1b4f\u1b5a-\u1b6a\u1b74-\u1b7f\u1bfc-\u1bff\u1c3b-\u1c3f\u1c7e-\u1c7f\u1cc0-\u1cc7\u1cd3\u1fbd\u1fbf-\u1fc1\u1fcd-\u1fcf\u1fdd-\u1fdf\u1fed-\u1fef\u1ffd-\u1ffe\u2010-\u2027\u2030-\u205e\u207a-\u207e\u208a-\u208e\u20a0-\u20c0\u2100-\u2101\u2103-\u2106\u2108-\u2109\u2114\u2116-\u2118\u211e-\u2123\u2125\u2127\u2129\u212e\u213a-\u213b\u2140-\u2144\u214a-\u214d\u214f\u218a-\u218b\u2190-\u2429\u2440-\u244a\u249c-\u24e9\u2500-\u2775\u2794-\u2b73\u2b76-\u2b95\u2b97-\u2bff\u2ce5-\u2cea\u2cf9-\u2cfc\u2cfe-\u2cff\u2d70\u2e00-\u2e2e\u2e30-\u2e5d\u2e80-\u2e99\u2e9b-\u2ef3\u2f00-\u2fd5\u2ff0-\u2fff\u3001-\u3004\u3008-\u3020\u3030\u3036-\u3037\u303d-\u303f\u309b-\u309c\u30a0\u30fb\u3190-\u3191\u3196-\u319f\u31c0-\u31e5\u31ef\u3200-\u321e\u322a-\u3247\u3250\u3260-\u327f\u328a-\u32b0\u32c0-\u33ff\u4dc0-\u4dff\ua490-\ua4c6\ua4fe-\ua4ff\ua60d-\ua60f\ua673\ua67e\ua6f2-\ua6f7\ua700-\ua716\ua720-\ua721\ua789-\ua78a\ua828-\ua82b\ua836-\ua839\ua874-\ua877\ua8ce-\ua8cf\ua8f8-\ua8fa\ua8fc\ua92e-\ua92f\ua95f\ua9c1-\ua9cd\ua9de-\ua9df\uaa5c-\uaa5f\uaa77-\uaa79\uaade-\uaadf\uaaf0-\uaaf1\uab5b\uab6a-\uab6b\uabeb\ufb29\ufbb2-\ufbc2\ufd3e-\ufd4f\ufdcf\ufdfc-\ufdff\ufe10-\ufe19\ufe30-\ufe52\ufe54-\ufe66\ufe68-\ufe6b\uff01-\uff0f\uff1a-\uff20\uff3b-\uff40\uff5b-\uff65\uffe0-\uffe6\uffe8-\uffee\ufffc-\ufffd]$/,bn=/^\uE000\d+\uE001/;function xn(){try{return new RegExp("^[\\p{P}\\p{S}]$","u")}catch{return wn}}var kn=xn();function dt(e){return e!==null&&(yn.test(e)||kn.test(e))}function $t(e,t,n){if(t>=e.length)return[null,0];if(e[t]==="\uE000"){let r=bn.exec(e.slice(t));if(r)return["`",r[0].length]}if(n&&e[t]==="&"){let r=gn.exec(e.slice(t,t+6));if(r)return[vn[r[0]],r[0].length]}let i=String.fromCodePoint(e.codePointAt(t));return[i,i.length]}function ht(e,t){let n=0;for(;t>0&&e[--t]==="\\";)n++;return n%2===1}function Pt(e,t){if(e[t]!=="<")return t;let n=e.indexOf(">",t+1);return n===-1?t:n+1}function Ln(e,t,n){let i=t;for(;i<e.length;){let r=Pt(e,i);if(r!==i){i=r;continue}return $t(e,i,n)[0]}return`
`}function Sn(e,t,n){let i=/\s/u.test(t),r=/\s/u.test(n),o=dt(t),s=dt(n),a=!r&&(!s||i||o),c=!i&&(!o||r||s);return e==="_"?{canOpen:a&&(!c||o),canClose:c&&(!a||s)}:{canOpen:a,canClose:c}}function En(e,t){let n=[],i=`
`,r=0;for(;r<e.length;){let o=Pt(e,r);if(o!==r){r=o;continue}let[s,a]=$t(e,r,t);if((s==="*"||s==="_")&&!ht(e,r)){let c=r,l=0;for(;e[r]===s&&!ht(e,r);)l++,r++;let u=Sn(s,i,Ln(e,r,t)),p={marker:s,start:c,original:l,remaining:l,usedAsOpener:0,usedAsCloser:0,...u,previous:n.length>0?n[n.length-1]:null,next:null};p.previous&&(p.previous.next=p),n.push(p),i=s;continue}i=s,r+=a}return n}function He(e,t){t.previous?t.previous.next=t.next:e.head=t.next,t.next&&(t.next.previous=t.previous),t.previous=null,t.next=null}function Tn(e,t){let n=e.next;for(;n&&n!==t;){let i=n.next;n.previous=null,n.next=null,n=i}e.next=t,t.previous=e}function Cn(e,{htmlEntities:t=!1}={}){var n;let r={head:(n=En(e,t)[0])!=null?n:null},o=[],s=r.head;for(;s;){if(!s.canClose){s=s.next;continue}let a=s.previous;for(;a;){let h=(s.canOpen||a.canClose)&&(a.original%3!==0||s.original%3!==0)&&(a.original+s.original)%3===0;if(a.marker===s.marker&&a.canOpen&&!h)break;a=a.previous}if(!a){let h=s.next;s.canOpen||He(r,s),s=h;continue}let c=a.remaining>=2&&s.remaining>=2?2:1,l=a.start+a.original-a.usedAsOpener-c,u=s.start+s.usedAsCloser;o.push({type:c===2?"strong":"em",openStart:l,openEnd:l+c,closeStart:u,closeEnd:u+c}),a.remaining-=c,s.remaining-=c,a.usedAsOpener+=c,s.usedAsCloser+=c,Tn(a,s);let p=s.next;a.remaining===0&&He(r,a),s.remaining===0&&(He(r,s),s=p)}return o.sort((a,c)=>a.openStart-c.openStart||c.closeEnd-a.closeEnd)}function $e(e,t={}){let{includeEm:n=!0,includeStrong:i=!0}=t,r=Cn(e,t).filter(l=>l.type==="em"?n:i);if(r.length===0)return e;let o=new Map,s=l=>(o.has(l)||o.set(l,{openEnd:[],closeEnd:[],openStart:[],closeStart:[]}),o.get(l));for(let l of r){let u=l.type;s(l.openStart).openStart.push(`<${u}><span class="syntax-marker">`),s(l.openEnd).openEnd.push("</span>"),s(l.closeStart).closeStart.push('<span class="syntax-marker">'),s(l.closeEnd).closeEnd.push(`</span></${u}>`)}let a="",c=0;for(let l of[...o.keys()].sort((u,p)=>u-p)){a+=e.slice(c,l);let u=o.get(l);a+=u.openEnd.join(""),a+=u.closeEnd.join(""),a+=u.openStart.join(""),a+=u.closeStart.join(""),c=l}return a+e.slice(c)}function J(e){return e.replace(/&nbsp;/g," ").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&amp;/g,"&")}var T=class{static resetLinkIndex(){this.linkIndex=0}static setCodeHighlighter(e){this.codeHighlighter=e}static setCustomSyntax(e){this.customSyntax=e}static applyCustomSyntax(e){return this.customSyntax?this.customSyntax(e):e}static escapeHtml(e){let t={"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"};return e.replace(/[&<>"']/g,n=>t[n])}static preserveIndentation(e,t){let i=t.match(/^(\s*)/)[1].replace(/ /g,"&nbsp;");return e.replace(/^\s*/,i)}static parseHeader(e){let t=pt(J(e));if(!t)return e;let n=t.indent.replace(/ /g,"&nbsp;"),i=this.escapeHtml(t.marker+t.separator),r=this.parseInlineElements(this.escapeHtml(t.content)),o=t.closing?`<span class="syntax-marker">${this.escapeHtml(t.closing)}</span>`:"";return`<h${t.level}>${n}<span class="syntax-marker">${i}</span>${r}${o}</h${t.level}>`}static parseHorizontalRule(e){let t=J(e);return me(t)?`<div><span class="hr-marker">${this.preserveIndentation(this.escapeHtml(t),t)}</span></div>`:null}static parseBlockquote(e){let t=ut(J(e));if(!t)return e;let n=t.indent.replace(/ /g,"&nbsp;"),i=this.escapeHtml(t.marker),r=this.escapeHtml(t.separator),o=this.parseInlineElements(this.escapeHtml(t.content));return`${n}<span class="blockquote"><span class="syntax-marker">${i}</span>${r}${o}</span>`}static parseBulletList(e){let t=J(e);if(me(t))return e;let n=ve(t);if(!n||n.listType!=="bullet")return e;let i=n.indent.replace(/ /g,"&nbsp;"),r=this.escapeHtml(n.marker+n.separator),o=this.parseInlineElements(this.escapeHtml(n.content));return`${i}<li class="bullet-list"><span class="syntax-marker">${r}</span>${o}</li>`}static parseTaskList(e,t=!1){return e.replace(/^((?:&nbsp;)*)-(\s+)\[([ xX])\](\s*)(.*)$/,(n,i,r,o,s,a)=>{if(s===""&&a!=="")return n;if(a=this.parseInlineElements(a),t){let c=o.toLowerCase()==="x";return`<li class="task-list">${i}<input type="checkbox" ${c?"checked":""}> ${a}</li>`}else return`<li class="task-list">${i}<span class="syntax-marker">-${r}[${o}]${s}</span>${a}</li>`})}static parseNumberedList(e){let t=ve(J(e));if(!t||t.listType!=="ordered")return e;let n=t.indent.replace(/ /g,"&nbsp;"),i=this.escapeHtml(t.marker+t.separator),r=this.parseInlineElements(this.escapeHtml(t.content));return`${n}<li class="ordered-list"><span class="syntax-marker">${i}</span>${r}</li>`}static parseCodeBlock(e){let t=ce(J(e));return t?this.renderFence(t):null}static renderFence(e,t=!1){let n=this.preserveIndentation(this.escapeHtml(e.source),e.source);return`<div${t?' class="raw-line"':""}><span class="code-fence">${n}</span></div>`}static renderCodeContent(e,t,n,i=0,r=-1){let o=e.map(d=>{let f=0;for(;f<i&&d[f]===" ";)f++;return{source:d,prefix:d.slice(0,f),content:d.slice(f)}}),s=o.map(d=>d.content).join(`
`),a=d=>d?`<span class="syntax-marker">${this.escapeHtml(d)}</span>`:"",c=o.map((d,f)=>f===r?`<span class="raw-line">${this.escapeHtml(d.source)||"&nbsp;"}</span>`:d.prefix===""&&d.content===""?'<span class="syntax-marker">&nbsp;</span>':a(d.prefix)+this.escapeHtml(d.content)).join(`
`),l=t.split(/[\t ]/,1)[0],u=l?` class="language-${this.escapeHtml(l)}"`:"",p=n||this.codeHighlighter,h=c;if(p)try{let d=p(s,l);if(d&&typeof d.then=="function")console.warn("Async highlighters are not supported in parse() because it returns an HTML string. Use synchronous highlighters only.");else if(d&&typeof d=="string"&&d.trim()){let f=d.split(`
`);f.length===o.length+1&&f[f.length-1]===""&&f.pop(),f.length===o.length?h=f.map((m,v)=>v===r?`<span class="raw-line">${this.escapeHtml(o[v].source)||"&nbsp;"}</span>`:a(o[v].prefix)+m).join(`
`):console.warn("Code highlighter output line count does not match the source. Using unhighlighted code to preserve alignment.")}}catch(d){console.warn("Code highlighting failed:",d)}return`<pre class="code-block"><code${u}>${h}</code></pre>`}static parseBold(e){return $e(e,{htmlEntities:!0,includeEm:!1})}static parseItalic(e){return $e(e,{htmlEntities:!0,includeStrong:!1})}static parseEmphasis(e){return $e(e,{htmlEntities:!0})}static parseStrikethrough(e){return e=e.replace(new RegExp("(?<!~)~~(?!~)(.+?)(?<!~)~~(?!~)","g"),'<del><span class="syntax-marker">~~</span>$1<span class="syntax-marker">~~</span></del>'),e=e.replace(new RegExp("(?<!~)~(?!~)(.+?)(?<!~)~(?!~)","g"),'<del><span class="syntax-marker">~</span>$1<span class="syntax-marker">~</span></del>'),e}static parseInlineCode(e){let t=De(e);for(let n of t.reverse()){let i=`<code><span class="syntax-marker">${n.openTicks}</span>${n.content}<span class="syntax-marker">${n.closeTicks}</span></code>`;e=e.slice(0,n.start)+i+e.slice(n.end)}return e}static sanitizeUrl(e){let t=e.trim(),n=t.toLowerCase(),r=["http://","https://","mailto:","ftp://","ftps://"].some(s=>n.startsWith(s)),o=t.startsWith("/")||t.startsWith("#")||t.startsWith("?")||t.startsWith(".")||!t.includes(":")&&!t.includes("//");return r||o?e:"#"}static findLinks(e,t={}){let{allowEmptyText:n=!1,...i}=t;return Re(e,i).filter(r=>(n||r.text.raw.length>0)&&r.destination!==null&&r.destination.value.length>0)}static findRenderableLinks(e,t={}){let{allowEmptyText:n=!1,...i}=t;return mn(e,i).filter(r=>(n||r.text.raw.length>0)&&r.destination!==null&&r.destination.value.length>0)}static parseLinks(e){let t=this.findLinks(e,{htmlEntities:!0});t.forEach(n=>{n.anchorName=`--link-${this.linkIndex++}`});for(let n of t.reverse()){let i=this.escapeHtml(this.sanitizeUrl(n.destination.value)),r=n.title===null?"":` title="${this.escapeHtml(n.title.value)}"`,o=e.slice(n.text.start,n.text.end),s=e.slice(n.text.end,n.end),a=`<a href="${i}"${r} style="anchor-name: ${n.anchorName}"><span class="syntax-marker">[</span>${o}<span class="syntax-marker url-part">${s}</span></a>`;e=e.slice(0,n.start)+a+e.slice(n.end)}return e}static identifyAndProtectSanctuaries(e){let t=new Map,n=0,i=e,o=(e.includes("[")?this.findRenderableLinks(e,{htmlEntities:!0}):[]).map(l=>({start:l.text.end,end:l.end})),s=De(e,o);s.sort((l,u)=>u.start-l.start),s.forEach(l=>{let u=`\uE000${n++}\uE001`;t.set(u,{type:"code",original:l.raw,openTicks:l.openTicks,content:l.content,closeTicks:l.closeTicks}),i=i.substring(0,l.start)+u+i.substring(l.end)});let a=[...t.keys()];return(i.includes("[")?this.findLinks(i,{htmlEntities:!0}):[]).filter(l=>{let u=i.slice(l.text.end,l.end);return a.every(p=>!u.includes(p))}).sort((l,u)=>u.start-l.start).forEach(l=>{var u,p;let h=`\uE000${n++}\uE001`;t.set(h,{type:"link",original:i.slice(l.start,l.end),linkText:i.slice(l.text.start,l.text.end),tail:i.slice(l.text.end,l.end),url:l.destination.value,title:(p=(u=l.title)==null?void 0:u.value)!=null?p:null}),i=i.slice(0,l.start)+h+i.slice(l.end)}),{protectedText:i,sanctuaries:t}}static restoreAndTransformSanctuaries(e,t){return Array.from(t.keys()).sort((i,r)=>{let o=e.indexOf(i),s=e.indexOf(r);return o-s}).forEach(i=>{let r=t.get(i),o;if(r.type==="code")o=`<code><span class="syntax-marker">${r.openTicks}</span>${r.content}<span class="syntax-marker">${r.closeTicks}</span></code>`;else if(r.type==="link"){let s=r.linkText;s=this.parseStrikethrough(s),s=this.parseEmphasis(s),t.forEach((u,p)=>{if(s.includes(p)&&u.type==="code"){let h=`<code><span class="syntax-marker">${u.openTicks}</span>${u.content}<span class="syntax-marker">${u.closeTicks}</span></code>`;s=s.replace(p,()=>h)}});let a=`--link-${this.linkIndex++}`,c=this.escapeHtml(this.sanitizeUrl(r.url)),l=r.title===null?"":` title="${this.escapeHtml(r.title)}"`;o=`<a href="${c}"${l} style="anchor-name: ${a}"><span class="syntax-marker">[</span>${s}<span class="syntax-marker url-part">${r.tail}</span></a>`}e=e.replace(i,()=>o)}),e}static parseInlineElements(e){let{protectedText:t,sanctuaries:n}=this.identifyAndProtectSanctuaries(e),i=t;return i=this.parseStrikethrough(i),i=this.parseEmphasis(i),i=this.restoreAndTransformSanctuaries(i,n),i}static parseLine(e,t=!1){if(e==="")return"<div>&nbsp;</div>";if(me(e))return`<div><span class="hr-marker">${this.preserveIndentation(this.escapeHtml(e),e)}</span></div>`;let i=ce(e);if(i)return this.renderFence(i);let r=pt(e);if(r){let p=r.indent.replace(/ /g,"&nbsp;"),h=this.escapeHtml(r.marker+r.separator),d=this.parseInlineElements(this.escapeHtml(r.content)),f=r.closing?`<span class="syntax-marker">${this.escapeHtml(r.closing)}</span>`:"";return`<div><h${r.level}>${p}<span class="syntax-marker">${h}</span>${d}${f}</h${r.level}></div>`}let o=ut(e);if(o){let p=o.indent.replace(/ /g,"&nbsp;"),h=this.escapeHtml(o.marker),d=this.escapeHtml(o.separator),f=this.parseInlineElements(this.escapeHtml(o.content));return`<div>${p}<span class="blockquote"><span class="syntax-marker">${h}</span>${d}${f}</span></div>`}let s=this.preserveIndentation(this.escapeHtml(e),e),a=this.parseTaskList(s,t);if(a!==s)return`<div>${a}</div>`;let c=ve(e);if(c){let p=c.indent.replace(/ /g,"&nbsp;"),h=this.escapeHtml(c.marker+c.separator),d=this.parseInlineElements(this.escapeHtml(c.content)),f=c.listType==="bullet"?"bullet-list":"ordered-list";return`<div>${p}<li class="${f}"><span class="syntax-marker">${h}</span>${d}</li></div>`}let l=/^[\t ]*/.exec(e)[0];return s=l.replace(/ /g,"&nbsp;")+this.parseInlineElements(this.escapeHtml(e.slice(l.length))),`<div>${s}</div>`}static parse(e,t=-1,n=!1,i,r=!1){this.resetLinkIndex();let o=e.split(`
`),s=[],a=null,c=[],l=-1;for(let p=0;p<o.length;p++){let h=o[p],d=n&&p===t;if(a){let m=Ue(h,a);if(m){s.push(this.renderCodeContent(c,a.info,i,a.indent.length,l));let v=this.renderFence(m,d);s.push(d?v:this.applyCustomSyntax(v)),a=null,c=[],l=-1}else d&&(l=c.length),c.push(h);continue}let f=ce(h);if(f){a=f;let m=this.renderFence(f,d);s.push(d?m:this.applyCustomSyntax(m));continue}if(d){let m=this.escapeHtml(h)||"&nbsp;";s.push(`<div class="raw-line">${m}</div>`);continue}s.push(this.applyCustomSyntax(this.parseLine(h,r)))}a&&c.length>0&&s.push(this.renderCodeContent(c,a.info,i,a.indent.length,l));let u=s.join("");return this.postProcessHTML(u,i,!1)}static postProcessHTML(e,t,n=!0){return this.postProcessHTMLManual(e,t,n)}static postProcessHTMLManual(e,t,n=!0){let i=e;i=i.replace(/((?:<div(?:\s[^>]*)?>(?:&nbsp;)*<li class="bullet-list">.*?<\/li><\/div>\s*)+)/gs,o=>{let s=o.match(/<div(?:\s[^>]*)?>(?:&nbsp;)*<li class="bullet-list">.*?<\/li><\/div>/gs)||[];return s.length>0?"<ul>"+s.map(c=>{let l=c.match(/<div(?:\s[^>]*)?>((?:&nbsp;)*)<li/),u=c.match(/<li class="bullet-list">.*?<\/li>/);if(l&&u){let p=l[1];return u[0].replace(/<li class="bullet-list">/,`<li class="bullet-list">${p}`)}return u?u[0]:""}).filter(Boolean).join("")+"</ul>":o}),i=i.replace(/((?:<div(?:\s[^>]*)?>(?:&nbsp;)*<li class="ordered-list">.*?<\/li><\/div>\s*)+)/gs,o=>{let s=o.match(/<div(?:\s[^>]*)?>(?:&nbsp;)*<li class="ordered-list">.*?<\/li><\/div>/gs)||[];if(s.length>0){let a=s.map(p=>{let h=p.match(/<div(?:\s[^>]*)?>((?:&nbsp;)*)<li/),d=p.match(/<li class="ordered-list">.*?<\/li>/);if(h&&d){let f=h[1];return d[0].replace(/<li class="ordered-list">/,`<li class="ordered-list">${f}`)}return d?d[0]:""}).filter(Boolean),c=s[0].match(/<span class="syntax-marker">(\d+)\./),l=c?Number.parseInt(c[1],10):1;return`<ol${l===1?"":` start="${l}"`}>`+a.join("")+"</ol>"}return o});let r=/<div><span class="code-fence">(```[^<]*)<\/span><\/div>(.*?)<div><span class="code-fence">(```)<\/span><\/div>/gs;return n&&(i=i.replace(r,(o,s,a,c)=>{if(a.includes('<pre class="code-block">'))return o;let u=(a.match(/<div>(.*?)<\/div>/gs)||[]).map(y=>y.replace(/<div>(.*?)<\/div>/s,"$1")),p=u.map(y=>y==="&nbsp;"?"":y.replace(/&nbsp;/g," ")).join(`
`),h=u.join(`
`),d=s.slice(3).trim(),f=d?` class="language-${d}"`:"",m=h,v=t||this.codeHighlighter;if(v)try{let y=p.replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&amp;/g,"&"),b=v(y,d);b&&typeof b.then=="function"?console.warn("Async highlighters are not supported in Node.js (non-DOM) context. Use synchronous highlighters for server-side rendering."):b&&typeof b=="string"&&b.trim()&&(m=b)}catch(y){console.warn("Code highlighting failed:",y)}let w=`<div><span class="code-fence">${s}</span></div>`;return w+=`<pre class="code-block"><code${f}>${m}</code></pre>`,w+=`<div><span class="code-fence">${c}</span></div>`,w})),i}static getListContext(e,t){let n=e.split(`
`),i=0,r=0,o=0;for(let p=0;p<n.length;p++){let h=n[p].length;if(i+h>=t){r=p,o=i;break}i+=h+1}let s=n[r],a=o+s.length,c={inList:!1,listType:null,indent:"",marker:null,content:s,lineStart:o,lineEnd:a,markerEndPos:o};if(me(s))return c;let l=ve(s);if(!l)return c;let u=l.listType==="bullet"&&l.marker==="-"?/^\[([ xX])\]([\t ]*)(.*)$/.exec(l.content):null;return u&&(u[2]!==""||u[3]==="")?{inList:!0,listType:"checkbox",indent:l.indent,marker:"-",checked:u[1].toLowerCase()==="x",content:u[3],lineStart:o,lineEnd:a,markerEndPos:o+l.indent.length+l.marker.length+l.separator.length+3+u[2].length}:l.listType==="bullet"?{inList:!0,listType:"bullet",indent:l.indent,marker:l.marker,content:l.content,lineStart:o,lineEnd:a,markerEndPos:o+l.indent.length+l.marker.length+l.separator.length}:{inList:!0,listType:"numbered",indent:l.indent,marker:Number.parseInt(l.marker,10),content:l.content,lineStart:o,lineEnd:a,markerEndPos:o+l.indent.length+l.marker.length+l.separator.length}}static createNewListItem(e){switch(e.listType){case"bullet":return`${e.indent}${e.marker} `;case"numbered":return`${e.indent}${e.marker+1}. `;case"checkbox":return`${e.indent}- [ ] `;default:return""}}static renumberLists(e){let t=e.split(`
`),n=new Map,i=!1;return t.map(o=>{let s=o.match(this.LIST_PATTERNS.numbered);if(s){let a=s[1],c=a.length,l=s[3];i||n.clear();let u=(n.get(c)||0)+1;n.set(c,u);for(let[p]of n)p>c&&n.delete(p);return i=!0,`${a}${u}. ${l}`}else return(o.trim()===""||!o.match(/^\s/))&&(i=!1,n.clear()),o}).join(`
`)}};C(T,"linkIndex",0);C(T,"codeHighlighter",null);C(T,"customSyntax",null);C(T,"LIST_PATTERNS",{bullet:/^( *)([-*+])[\t ]+(.*)$/,numbered:/^( *)(\d{1,9})\.[\t ]+(.*)$/,checkbox:/^( *)-[\t ]+\[([ xX])\][\t ]+(.*)$/});var Ot=class{constructor(e){this.editor=e}handleKeydown(e){if(!(navigator.platform.toLowerCase().includes("mac")?e.metaKey:e.ctrlKey))return!1;if(e.key==="]")return e.preventDefault(),this.editor.indentSelection(),!0;if(e.key==="[")return e.preventDefault(),this.editor.outdentSelection(),!0;let i=null;switch(e.key.toLowerCase()){case"b":e.shiftKey||(i="toggleBold");break;case"i":e.shiftKey||(i="toggleItalic");break;case"k":e.shiftKey||(i="insertLink");break;case"7":e.shiftKey&&(i="toggleNumberedList");break;case"8":e.shiftKey&&(i="toggleBulletList");break}return i?(e.preventDefault(),this.editor.performAction(i,e),!0):!1}destroy(){}},j={name:"solar",colors:{bgPrimary:"#faf0ca",bgSecondary:"#ffffff",text:"#0d3b66",textPrimary:"#0d3b66",textSecondary:"#5a7a9b",h1:"#f95738",h2:"#ee964b",h3:"#3d8a51",strong:"#ee964b",em:"#f95738",del:"#ee964b",link:"#0d3b66",code:"#0d3b66",codeBg:"rgba(244, 211, 94, 0.4)",blockquote:"#5a7a9b",hr:"#5a7a9b",syntaxMarker:"rgba(13, 59, 102, 0.52)",syntax:"#999999",cursor:"#f95738",selection:"rgba(244, 211, 94, 0.4)",listMarker:"#ee964b",rawLine:"#5a7a9b",border:"#e0e0e0",hoverBg:"#f0f0f0",primary:"#0d3b66",toolbarBg:"#ffffff",toolbarIcon:"#0d3b66",toolbarHover:"#f5f5f5",toolbarActive:"#faf0ca",placeholder:"#999999"},previewColors:{text:"#0d3b66",h1:"inherit",h2:"inherit",h3:"inherit",strong:"inherit",em:"inherit",link:"#0d3b66",code:"#0d3b66",codeBg:"rgba(244, 211, 94, 0.4)",blockquote:"#5a7a9b",hr:"#5a7a9b",bg:"transparent"}},ft={name:"cave",colors:{bgPrimary:"#141E26",bgSecondary:"#1D2D3E",text:"#c5dde8",textPrimary:"#c5dde8",textSecondary:"#9fcfec",h1:"#d4a5ff",h2:"#f6ae2d",h3:"#9fcfec",strong:"#f6ae2d",em:"#9fcfec",del:"#f6ae2d",link:"#9fcfec",code:"#c5dde8",codeBg:"#1a232b",blockquote:"#9fcfec",hr:"#c5dde8",syntaxMarker:"rgba(159, 207, 236, 0.73)",syntax:"#7a8c98",cursor:"#f26419",selection:"rgba(51, 101, 138, 0.4)",listMarker:"#f6ae2d",rawLine:"#9fcfec",border:"#2a3f52",hoverBg:"#243546",primary:"#9fcfec",toolbarBg:"#1D2D3E",toolbarIcon:"#c5dde8",toolbarHover:"#243546",toolbarActive:"#2a3f52",placeholder:"#6a7a88"},previewColors:{text:"#c5dde8",h1:"inherit",h2:"inherit",h3:"inherit",strong:"inherit",em:"inherit",link:"#9fcfec",code:"#c5dde8",codeBg:"#1a232b",blockquote:"#9fcfec",hr:"#c5dde8",bg:"transparent"}},mt={solar:j,cave:ft,auto:j,light:j,dark:ft};function K(e){return typeof e=="string"?{...mt[e]||mt.solar,name:e}:e}function vt(e){if(e!=="auto")return e;let t=window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)");return t?.matches?"cave":"solar"}function le(e,t){let n=[];for(let[i,r]of Object.entries(e)){let o=i.replace(/([A-Z])/g,"-$1").toLowerCase();n.push(`--${o}: ${r};`)}if(t)for(let[i,r]of Object.entries(t)){let o=i.replace(/([A-Z])/g,"-$1").toLowerCase();n.push(`--preview-${o}-default: ${r};`)}return n.join(`
`)}function An(e,t={},n={}){return{...e,colors:{...e.colors,...t},previewColors:{...e.previewColors,...n}}}var V={fontSize:"14px",lineHeight:1.6,fontFamily:'"SF Mono", SFMono-Regular, Menlo, Monaco, "Cascadia Code", Consolas, "Roboto Mono", "Noto Sans Mono", "Droid Sans Mono", "Ubuntu Mono", "DejaVu Sans Mono", "Liberation Mono", "Courier New", Courier, monospace',padding:"20px"};function _n(e={}){let{fontSize:t=V.fontSize,lineHeight:n=V.lineHeight,fontFamily:i=V.fontFamily,padding:r=V.padding,theme:o=null,mobile:s={}}=e,a=Object.keys(s).length>0?`
    @media (max-width: 640px) {
      .overtype-wrapper .overtype-input,
      .overtype-wrapper .overtype-preview {
        ${Object.entries(s).map(([l,u])=>`${l.replace(/([A-Z])/g,"-$1").toLowerCase()}: ${u} !important;`).join(`
        `)}
      }
    }
  `:"",c=o&&o.colors?le(o.colors,o.previewColors):"";return`
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
      ${c?`
      /* Theme Variables */
      ${c}`:""}
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
      font-family: var(--instance-font-family, ${i}) !important;
      font-variant-ligatures: none !important; /* keep metrics stable for code */
      font-size: var(--instance-font-size, ${t}) !important;
      line-height: var(--instance-line-height, ${n}) !important;
      font-weight: normal !important;
      font-style: normal !important;
      font-variant: normal !important;
      font-stretch: normal !important;
      font-kerning: none !important;
      font-feature-settings: normal !important;
      
      /* Box model - must match exactly */
      padding: var(--instance-padding, ${r}) !important;
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
      font-family: var(--instance-font-family, ${i}) !important;
      font-size: var(--instance-font-size, ${t}) !important;
      line-height: var(--instance-line-height, ${n}) !important;
      padding: var(--instance-padding, ${r}) !important;
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
      font-family: var(--instance-font-family, ${i}) !important; /* Match textarea font exactly for alignment */
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
      font-family: ${i} !important;
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
      font-family: ${i} !important;
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

    ${a}
  `}var In={};sn(In,{applyCustomFormat:()=>qt,default:()=>zn,expandSelection:()=>Ut,getActiveFormats:()=>rt,getDebugMode:()=>qe,hasFormat:()=>jt,insertHeader:()=>de,insertLink:()=>Je,preserveSelection:()=>Nt,setDebugMode:()=>Rt,setUndoMethod:()=>Bt,toggleBold:()=>Xe,toggleBulletList:()=>Qe,toggleCode:()=>Ge,toggleH1:()=>tt,toggleH2:()=>nt,toggleH3:()=>it,toggleItalic:()=>Ze,toggleNumberedList:()=>Ye,toggleQuote:()=>et,toggleTaskList:()=>be});var Mn=Object.defineProperty,gt=Object.getOwnPropertySymbols,Hn=Object.prototype.hasOwnProperty,$n=Object.prototype.propertyIsEnumerable,yt=(e,t,n)=>t in e?Mn(e,t,{enumerable:!0,configurable:!0,writable:!0,value:n}):e[t]=n,wt=(e,t)=>{for(var n in t||(t={}))Hn.call(t,n)&&yt(e,n,t[n]);if(gt)for(var n of gt(t))$n.call(t,n)&&yt(e,n,t[n]);return e},O={bold:{prefix:"**",suffix:"**",trimFirst:!0},italic:{prefix:"_",suffix:"_",trimFirst:!0},code:{prefix:"`",suffix:"`",blockPrefix:"```",blockSuffix:"```"},link:{prefix:"[",suffix:"](url)",replaceNext:"url",scanFor:"https?://"},bulletList:{prefix:"- ",multiline:!0,unorderedList:!0},numberedList:{prefix:"1. ",multiline:!0,orderedList:!0},quote:{prefix:"> ",multiline:!0,surroundWithNewlines:!0},taskList:{prefix:"- [ ] ",multiline:!0,surroundWithNewlines:!0},header1:{prefix:"# "},header2:{prefix:"## "},header3:{prefix:"### "},header4:{prefix:"#### "},header5:{prefix:"##### "},header6:{prefix:"###### "}};function Pn(){return{prefix:"",suffix:"",blockPrefix:"",blockSuffix:"",multiline:!1,replaceNext:"",prefixSpace:!1,scanFor:"",surroundWithNewlines:!1,orderedList:!1,unorderedList:!1,trimFirst:!1}}function D(e){return wt(wt({},Pn()),e)}var ue=!1;function Rt(e){ue=e}function qe(){return ue}function k(e,t,n){ue&&(console.group(`\u{1F50D} ${e}`),console.log(t),n&&console.log("Data:",n),console.groupEnd())}function we(e,t){if(!ue)return;let n=e.value.slice(e.selectionStart,e.selectionEnd);console.group(`\u{1F4CD} Selection: ${t}`),console.log("Position:",`${e.selectionStart}-${e.selectionEnd}`),console.log("Selected text:",JSON.stringify(n)),console.log("Length:",n.length);let i=e.value.slice(Math.max(0,e.selectionStart-10),e.selectionStart),r=e.value.slice(e.selectionEnd,Math.min(e.value.length,e.selectionEnd+10));console.log("Context:",JSON.stringify(i)+"[SELECTION]"+JSON.stringify(r)),console.groupEnd()}function Dt(e){ue&&(console.group("\u{1F4DD} Result"),console.log("Text to insert:",JSON.stringify(e.text)),console.log("New selection:",`${e.selectionStart}-${e.selectionEnd}`),console.groupEnd())}var _=null;function B(e,{text:t,selectionStart:n,selectionEnd:i}){let r=qe();r&&(console.group("\u{1F527} insertText"),console.log("Current selection:",`${e.selectionStart}-${e.selectionEnd}`),console.log("Text to insert:",JSON.stringify(t)),console.log("New selection to set:",n,"-",i)),e.focus();let o=e.selectionStart,s=e.selectionEnd,a=e.value.slice(0,o),c=e.value.slice(s);r&&(console.log("Before text (last 20):",JSON.stringify(a.slice(-20))),console.log("After text (first 20):",JSON.stringify(c.slice(0,20))),console.log("Selected text being replaced:",JSON.stringify(e.value.slice(o,s))));let l=e.value,u=o!==s;if(_===null||_===!0){e.contentEditable="true";try{_=document.execCommand("insertText",!1,t),r&&console.log("execCommand returned:",_,"for text with",t.split(`
`).length,"lines")}catch(p){_=!1,r&&console.log("execCommand threw error:",p)}e.contentEditable="false"}if(r&&(console.log("canInsertText before:",_),console.log("execCommand result:",_)),_){let p=a+t+c,h=e.value;r&&(console.log("Expected length:",p.length),console.log("Actual length:",h.length)),h!==p&&r&&(console.log("execCommand changed the value but not as expected"),console.log("Expected:",JSON.stringify(p.slice(0,100))),console.log("Actual:",JSON.stringify(h.slice(0,100))))}if(!_)if(r&&console.log("Using manual insertion"),e.value===l){r&&console.log("Value unchanged, doing manual replacement");try{document.execCommand("ms-beginUndoUnit")}catch{}e.value=a+t+c;try{document.execCommand("ms-endUndoUnit")}catch{}e.dispatchEvent(new CustomEvent("input",{bubbles:!0,cancelable:!0}))}else r&&console.log("Value was changed by execCommand, skipping manual insertion");r&&console.log("Setting selection range:",n,i),n!=null&&i!=null?e.setSelectionRange(n,i):e.setSelectionRange(o,e.selectionEnd),r&&(console.log("Final value length:",e.value.length),console.groupEnd())}function Bt(e){switch(e){case"native":_=!0;break;case"manual":_=!1;break;case"auto":_=null;break}}function Be(e){return e.trim().split(`
`).length>1}function On(e,t){let n=t;for(;e[n]&&e[n-1]!=null&&!e[n-1].match(/\s/);)n--;return n}function Rn(e,t,n){let i=t,r=n?/\n/:/\s/;for(;e[i]&&!e[i].match(r);)i++;return i}function Ft(e){let t=e.value.split(`
`),n=0;for(let i=0;i<t.length;i++){let r=t[i].length+1;e.selectionStart>=n&&e.selectionStart<n+r&&(e.selectionStart=n),e.selectionEnd>=n&&e.selectionEnd<n+r&&(i===t.length-1?e.selectionEnd=Math.min(n+t[i].length,e.value.length):e.selectionEnd=n+r-1),n+=r}}function Dn(e,t,n,i=!1){if(e.selectionStart===e.selectionEnd)e.selectionStart=On(e.value,e.selectionStart),e.selectionEnd=Rn(e.value,e.selectionEnd,i);else{let r=e.selectionStart-t.length,o=e.selectionEnd+n.length,s=e.value.slice(r,e.selectionStart)===t,a=e.value.slice(e.selectionEnd,o)===n;s&&a&&(e.selectionStart=r,e.selectionEnd=o)}return e.value.slice(e.selectionStart,e.selectionEnd)}function We(e){let t=e.value.slice(0,e.selectionStart),n=e.value.slice(e.selectionEnd),i=t.match(/\n*$/),r=n.match(/^\n*/),o=i?i[0].length:0,s=r?r[0].length:0,a="",c="";return t.match(/\S/)&&o<2&&(a=`
`.repeat(2-o)),n.match(/\S/)&&s<2&&(c=`
`.repeat(2-s)),{newlinesToAppend:a,newlinesToPrepend:c}}function Nt(e,t){let n=e.selectionStart,i=e.selectionEnd,r=e.scrollTop;t(),e.selectionStart=n,e.selectionEnd=i,e.scrollTop=r}function Se(e,t,n={}){let i=e.selectionStart,r=e.selectionEnd,o=i===r,s=e.value,a=i;for(;a>0&&s[a-1]!==`
`;)a--;if(o){let l=i;for(;l<s.length&&s[l]!==`
`;)l++;e.selectionStart=a,e.selectionEnd=l}else Ft(e);let c=t(e);if(n.adjustSelection){let u=e.value.slice(e.selectionStart,e.selectionEnd).startsWith(n.prefix),p=n.adjustSelection(u,i,r,a);c.selectionStart=p.start,c.selectionEnd=p.end}else if(n.prefix){let u=e.value.slice(e.selectionStart,e.selectionEnd).startsWith(n.prefix);o?u?(c.selectionStart=Math.max(i-n.prefix.length,a),c.selectionEnd=c.selectionStart):(c.selectionStart=i+n.prefix.length,c.selectionEnd=c.selectionStart):u?(c.selectionStart=Math.max(i-n.prefix.length,a),c.selectionEnd=Math.max(r-n.prefix.length,a)):(c.selectionStart=i+n.prefix.length,c.selectionEnd=r+n.prefix.length)}return c}function ee(e,t){let n,i,{prefix:r,suffix:o,blockPrefix:s,blockSuffix:a,replaceNext:c,prefixSpace:l,scanFor:u,surroundWithNewlines:p,trimFirst:h}=t,d=e.selectionStart,f=e.selectionEnd,m=e.value.slice(e.selectionStart,e.selectionEnd),v=Be(m)&&s&&s.length>0?`${s}
`:r,w=Be(m)&&a&&a.length>0?`
${a}`:o;if(l){let x=e.value[e.selectionStart-1];e.selectionStart!==0&&x!=null&&!x.match(/\s/)&&(v=` ${v}`)}m=Dn(e,v,w,t.multiline);let y=e.selectionStart,b=e.selectionEnd,L=c&&c.length>0&&w.indexOf(c)>-1&&m.length>0;if(p){let x=We(e);n=x.newlinesToAppend,i=x.newlinesToPrepend,v=n+r,w+=i}if(m.startsWith(v)&&m.endsWith(w)){let x=m.slice(v.length,m.length-w.length);if(d===f){let S=d-v.length;S=Math.max(S,y),S=Math.min(S,y+x.length),y=b=S}else b=y+x.length;return{text:x,selectionStart:y,selectionEnd:b}}else if(L)if(u&&u.length>0&&m.match(u)){w=w.replace(c,m);let x=v+w;return y=b=y+v.length,{text:x,selectionStart:y,selectionEnd:b}}else{let x=v+m+w;return y=y+v.length+m.length+w.indexOf(c),b=y+c.length,{text:x,selectionStart:y,selectionEnd:b}}else{let x=v+m+w;y=d+v.length,b=f+v.length;let S=m.match(/^\s*|\s*$/g);if(h&&S){let re=S[0]||"",Z=S[1]||"";x=re+v+m.trim()+w+Z,y+=re.length,b-=Z.length}return{text:x,selectionStart:y,selectionEnd:b}}}function Ke(e,t){let{prefix:n,suffix:i,surroundWithNewlines:r}=t,o=e.value.slice(e.selectionStart,e.selectionEnd),s=e.selectionStart,a=e.selectionEnd,c=o.split(`
`);if(c.every(u=>u.startsWith(n)&&(!i||u.endsWith(i))))o=c.map(u=>{let p=u.slice(n.length);return i&&(p=p.slice(0,p.length-i.length)),p}).join(`
`),a=s+o.length;else if(o=c.map(u=>n+u+(i||"")).join(`
`),r){let{newlinesToAppend:u,newlinesToPrepend:p}=We(e);s+=u.length,a=s+o.length,o=u+o+p}return{text:o,selectionStart:s,selectionEnd:a}}function bt(e){let t=e.split(`
`),n=/^\d+\.\s+/,i=t.every(o=>n.test(o)),r=t;return i&&(r=t.map(o=>o.replace(n,""))),{text:r.join(`
`),processed:i}}function xt(e){let t=e.split(`
`),n="- ",i=t.every(o=>o.startsWith(n)),r=t;return i&&(r=t.map(o=>o.slice(n.length))),{text:r.join(`
`),processed:i}}function se(e,t){return t?"- ":`${e+1}. `}function Bn(e,t){let n,i,r;return e.orderedList?(n=bt(t),i=xt(n.text),r=i.text):(n=xt(t),i=bt(n.text),r=i.text),[n,i,r]}function Fn(e,t){let n=e.selectionStart===e.selectionEnd,i=e.selectionStart,r=e.selectionEnd;Ft(e);let o=e.value.slice(e.selectionStart,e.selectionEnd),[s,a,c]=Bn(t,o),l=c.split(`
`).map((m,v)=>`${se(v,t.unorderedList)}${m}`),u=l.reduce((m,v,w)=>m+se(w,t.unorderedList).length,0),p=l.reduce((m,v,w)=>m+se(w,!t.unorderedList).length,0);if(s.processed)return n?(i=Math.max(i-se(0,t.unorderedList).length,0),r=i):(i=e.selectionStart,r=e.selectionEnd-u),{text:c,selectionStart:i,selectionEnd:r};let{newlinesToAppend:h,newlinesToPrepend:d}=We(e),f=h+l.join(`
`)+d;return n?(i=Math.max(i+se(0,t.unorderedList).length+h.length,0),r=i):a.processed?(i=Math.max(e.selectionStart+h.length,0),r=e.selectionEnd+h.length+u-p):(i=Math.max(e.selectionStart+h.length,0),r=e.selectionEnd+h.length+u),{text:f,selectionStart:i,selectionEnd:r}}function Vt(e,t){let n=Se(e,i=>Fn(i,t),{adjustSelection:(i,r,o,s)=>{let a=e.value.slice(s,e.selectionEnd),c=/^\d+\.\s+/,l=/^- /,u=c.test(a),p=l.test(a),h=t.orderedList&&u||t.unorderedList&&p;if(r===o)if(h){let d=a.match(t.orderedList?c:l),f=d?d[0].length:0;return{start:Math.max(r-f,s),end:Math.max(r-f,s)}}else if(u||p){let d=a.match(u?c:l),f=d?d[0].length:0,v=(t.unorderedList?2:3)-f;return{start:r+v,end:r+v}}else{let d=t.unorderedList?2:3;return{start:r+d,end:r+d}}else if(h){let d=a.match(t.orderedList?c:l),f=d?d[0].length:0;return{start:Math.max(r-f,s),end:Math.max(o-f,s)}}else if(u||p){let d=a.match(u?c:l),f=d?d[0].length:0,v=(t.unorderedList?2:3)-f;return{start:r+v,end:o+v}}else{let d=t.unorderedList?2:3;return{start:r+d,end:o+d}}}});B(e,n)}function zt(e){if(!e)return[];let t=[],{selectionStart:n,selectionEnd:i,value:r}=e,o=r.split(`
`),s=0,a="";for(let p of o){if(n>=s&&n<=s+p.length){a=p;break}s+=p.length+1}a.startsWith("- ")&&(a.startsWith("- [ ] ")||a.startsWith("- [x] ")?t.push("task-list"):t.push("bullet-list")),/^\d+\.\s/.test(a)&&t.push("numbered-list"),a.startsWith("> ")&&t.push("quote"),a.startsWith("# ")&&t.push("header"),a.startsWith("## ")&&t.push("header-2"),a.startsWith("### ")&&t.push("header-3");let c=Math.max(0,n-10),l=Math.min(r.length,i+10),u=r.slice(c,l);if(u.includes("**")){let p=r.slice(Math.max(0,n-100),n),h=r.slice(i,Math.min(r.length,i+100)),d=p.lastIndexOf("**"),f=h.indexOf("**");d!==-1&&f!==-1&&t.push("bold")}if(u.includes("_")){let p=r.slice(Math.max(0,n-100),n),h=r.slice(i,Math.min(r.length,i+100)),d=p.lastIndexOf("_"),f=h.indexOf("_");d!==-1&&f!==-1&&t.push("italic")}if(u.includes("`")){let p=r.slice(Math.max(0,n-100),n),h=r.slice(i,Math.min(r.length,i+100));p.includes("`")&&h.includes("`")&&t.push("code")}if(u.includes("[")&&u.includes("]")){let p=r.slice(Math.max(0,n-100),n),h=r.slice(i,Math.min(r.length,i+100)),d=p.lastIndexOf("["),f=h.indexOf("]");d!==-1&&f!==-1&&r.slice(i+f+1,i+f+10).startsWith("(")&&t.push("link")}return t}function Nn(e,t){return zt(e).includes(t)}function Vn(e,t={}){if(!e)return;let{toWord:n,toLine:i,toFormat:r}=t,{selectionStart:o,selectionEnd:s,value:a}=e;if(i){let c=a.split(`
`),l=0,u=0,p=0;for(let h of c){if(o>=p&&o<=p+h.length){l=p,u=p+h.length;break}p+=h.length+1}e.selectionStart=l,e.selectionEnd=u}else if(n&&o===s){let c=o,l=s;for(;c>0&&!/\s/.test(a[c-1]);)c--;for(;l<a.length&&!/\s/.test(a[l]);)l++;e.selectionStart=c,e.selectionEnd=l}}function Xe(e){if(!e||e.disabled||e.readOnly)return;k("toggleBold","Starting"),we(e,"Before");let t=D(O.bold),n=ee(e,t);Dt(n),B(e,n),we(e,"After")}function Ze(e){if(!e||e.disabled||e.readOnly)return;let t=D(O.italic),n=ee(e,t);B(e,n)}function Ge(e){if(!e||e.disabled||e.readOnly)return;let t=D(O.code),n=ee(e,t);B(e,n)}function Je(e,t={}){if(!e||e.disabled||e.readOnly)return;let n=e.value.slice(e.selectionStart,e.selectionEnd),i=D(O.link);if(n&&n.match(/^https?:\/\//)&&!t.url?(i.suffix=`](${n})`,i.replaceNext=""):t.url&&(i.suffix=`](${t.url})`,i.replaceNext=""),t.text&&!n){let s=e.selectionStart;e.value=e.value.slice(0,s)+t.text+e.value.slice(s),e.selectionStart=s,e.selectionEnd=s+t.text.length}let o=ee(e,i);B(e,o)}function Qe(e){if(!e||e.disabled||e.readOnly)return;let t=D(O.bulletList);Vt(e,t)}function Ye(e){if(!e||e.disabled||e.readOnly)return;let t=D(O.numberedList);Vt(e,t)}function et(e){if(!e||e.disabled||e.readOnly)return;k("toggleQuote","Starting"),we(e,"Initial");let t=D(O.quote),n=Se(e,i=>Ke(i,t),{prefix:t.prefix});Dt(n),B(e,n),we(e,"Final")}function be(e){if(!e||e.disabled||e.readOnly)return;let t=D(O.taskList),n=Se(e,i=>Ke(i,t),{prefix:t.prefix});B(e,n)}function de(e,t=1,n=!1){if(!e||e.disabled||e.readOnly)return;(t<1||t>6)&&(t=1),k("insertHeader","============ START ============"),k("insertHeader",`Level: ${t}, Toggle: ${n}`),k("insertHeader",`Initial cursor: ${e.selectionStart}-${e.selectionEnd}`);let i=`header${t===1?"1":t}`,r=D(O[i]||O.header1);k("insertHeader",`Style prefix: "${r.prefix}"`);let o=e.value,s=e.selectionStart,a=e.selectionEnd,c=s;for(;c>0&&o[c-1]!==`
`;)c--;let l=a;for(;l<o.length&&o[l]!==`
`;)l++;let u=o.slice(c,l);k("insertHeader",`Current line (before): "${u}"`);let p=u.match(/^(#{1,6})\s*/),h=p?p[1].length:0,d=p?p[0].length:0;k("insertHeader","Existing header check:"),k("insertHeader",`  - Match: ${p?`"${p[0]}"`:"none"}`),k("insertHeader",`  - Existing level: ${h}`),k("insertHeader",`  - Existing prefix length: ${d}`),k("insertHeader",`  - Target level: ${t}`);let f=n&&h===t;k("insertHeader",`Should toggle OFF: ${f} (toggle=${n}, existingLevel=${h}, level=${t})`);let m=Se(e,v=>{let w=v.value.slice(v.selectionStart,v.selectionEnd);k("insertHeader",`Line in operation: "${w}"`);let y=w.replace(/^#{1,6}\s*/,"");k("insertHeader",`Cleaned line: "${y}"`);let b;return f?(k("insertHeader","ACTION: Toggling OFF - removing header"),b=y):h>0?(k("insertHeader",`ACTION: Replacing H${h} with H${t}`),b=r.prefix+y):(k("insertHeader","ACTION: Adding new header"),b=r.prefix+y),k("insertHeader",`New line: "${b}"`),{text:b,selectionStart:v.selectionStart,selectionEnd:v.selectionEnd}},{prefix:r.prefix,adjustSelection:(v,w,y,b)=>{if(k("insertHeader","Adjusting selection:"),k("insertHeader",`  - isRemoving param: ${v}`),k("insertHeader",`  - shouldToggleOff: ${f}`),k("insertHeader",`  - selStart: ${w}, selEnd: ${y}`),k("insertHeader",`  - lineStartPos: ${b}`),f){let L=Math.max(w-d,b);return k("insertHeader",`  - Removing header, adjusting by -${d}`),{start:L,end:w===y?L:Math.max(y-d,b)}}else if(d>0){let L=r.prefix.length-d;return k("insertHeader",`  - Replacing header, adjusting by ${L}`),{start:w+L,end:y+L}}else return k("insertHeader",`  - Adding header, adjusting by +${r.prefix.length}`),{start:w+r.prefix.length,end:y+r.prefix.length}}});k("insertHeader",`Final result: text="${m.text}", cursor=${m.selectionStart}-${m.selectionEnd}`),k("insertHeader","============ END ============"),B(e,m)}function tt(e){de(e,1,!0)}function nt(e){de(e,2,!0)}function it(e){de(e,3,!0)}function rt(e){return zt(e)}function jt(e,t){return Nn(e,t)}function Ut(e,t={}){Vn(e,t)}function qt(e,t){if(!e||e.disabled||e.readOnly)return;let n=D(t),i;if(n.multiline){let r=e.value.slice(e.selectionStart,e.selectionEnd);Be(r)?i=Ke(e,n):i=ee(e,n)}else i=ee(e,n);B(e,i)}var zn={toggleBold:Xe,toggleItalic:Ze,toggleCode:Ge,insertLink:Je,toggleBulletList:Qe,toggleNumberedList:Ye,toggleQuote:et,toggleTaskList:be,insertHeader:de,toggleH1:tt,toggleH2:nt,toggleH3:it,getActiveFormats:rt,hasFormat:jt,expandSelection:Ut,applyCustomFormat:qt,preserveSelection:Nt,setUndoMethod:Bt,setDebugMode:Rt,getDebugMode:qe},jn=class{constructor(e,t={}){this.editor=e,this.container=null,this.buttons={},this.currentItemIndex=0,this.handleDocumentClick=null,this.activeDropdown=null,this.activeDropdownButton=null,this.toolbarButtons=t.toolbarButtons||[]}create(){this.container=document.createElement("div"),this.container.className="overtype-toolbar",this.editor._markChrome(this.container),this.container.id=this.getInstanceElementId("toolbar"),this.container.setAttribute("role","toolbar"),this.container.setAttribute("aria-label","Formatting toolbar"),this.container.setAttribute("aria-controls",this.editor.textarea.id),this.toolbarButtons.forEach(e=>{if(e.name==="separator"){let t=this.createSeparator();this.container.appendChild(t)}else{let t=this.createButton(e);this.buttons[e.name]=t,this.container.appendChild(t)}}),this.setupRovingTabIndex(),this.updateButtonStates(),this.editor.container.insertBefore(this.container,this.editor.wrapper)}getInstanceElementId(e){return`overtype-${this.editor.instanceId}-${e}`}setupRovingTabIndex(){this.getToolbarItems().length!==0&&(this.currentItemIndex=this.getValidItemIndex(this.currentItemIndex),this.updateTabIndexes(),this.container.addEventListener("keydown",t=>{this.onToolbarKeydown(t)}),this.container.addEventListener("focusin",t=>{this.onToolbarFocusin(t)}))}getToolbarItems(){return this.container?Array.from(this.container.querySelectorAll(".overtype-toolbar-button")):[]}onToolbarKeydown(e){let t=this.getToolbarItems();if(t.includes(e.target))switch(e.key){case"ArrowRight":e.preventDefault(),this.focusItem(this.currentItemIndex+1);break;case"ArrowLeft":e.preventDefault(),this.focusItem(this.currentItemIndex-1);break;case"Home":e.preventDefault(),this.focusItem(0);break;case"End":e.preventDefault(),this.focusItem(t.length-1);break}}onToolbarFocusin(e){let t=this.getToolbarItems().indexOf(e.target);t!==-1&&(this.currentItemIndex=t,this.updateTabIndexes())}focusItem(e){let t=this.getToolbarItems();t.length!==0&&(this.currentItemIndex=this.getValidItemIndex(e,t),this.updateTabIndexes(),t[this.currentItemIndex].focus())}getValidItemIndex(e,t=this.getToolbarItems()){let n=t.length;return n===0?0:e<0?n-1:e>=n?0:e}updateTabIndexes(){this.getToolbarItems().forEach((e,t)=>{e.tabIndex=t===this.currentItemIndex?0:-1})}createSeparator(){let e=document.createElement("div");return e.className="overtype-toolbar-separator",e.setAttribute("role","separator"),e}createButton(e){let t=document.createElement("button");return t.className="overtype-toolbar-button",t.type="button",t.setAttribute("data-button",e.name),t.title=e.title||"",t.setAttribute("aria-label",e.title||e.name),t.innerHTML=this.sanitizeSVG(e.icon||""),e.name==="viewMode"?(t.classList.add("has-dropdown"),t.dataset.dropdown="true",t.setAttribute("aria-haspopup","menu"),t.setAttribute("aria-expanded","false"),t._clickHandler=n=>{n.preventDefault(),this.toggleViewModeDropdown(t)},t._keydownHandler=n=>{if(!["ArrowDown","ArrowUp","Enter"," "].includes(n.key))return;n.preventDefault();let i=n.key==="ArrowUp"?"last":"current";this.openViewModeDropdown(t,i)},t.addEventListener("click",t._clickHandler),t.addEventListener("keydown",t._keydownHandler),t):(t._clickHandler=n=>{n.preventDefault();let i=e.actionId||e.name;this.editor.performAction(i,n)},t.addEventListener("click",t._clickHandler),t)}async handleAction(e){if(e&&typeof e=="object"&&typeof e.action=="function"){this.editor.textarea.focus();try{return await e.action({editor:this.editor,getValue:()=>this.editor.getValue(),setValue:t=>this.editor.setValue(t),event:null}),!0}catch(t){return console.error(`Action "${e.name}" error:`,t),this.editor.wrapper.dispatchEvent(new CustomEvent("button-error",{detail:{buttonName:e.name,error:t}})),!1}}return typeof e=="string"?this.editor.performAction(e,null):!1}sanitizeSVG(e){return typeof e!="string"?"":e.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,"").replace(/\son\w+\s*=\s*["'][^"']*["']/gi,"").replace(/\son\w+\s*=\s*[^\s>]*/gi,"")}toggleViewModeDropdown(e){if(this.activeDropdown){this.closeViewModeDropdown(e);return}this.openViewModeDropdown(e)}openViewModeDropdown(e,t=null){this.closeViewModeDropdown(e),e.classList.add("dropdown-active");let n=this.createViewModeDropdown(e),i=e.getBoundingClientRect();n.style.position="absolute",n.style.top=`${i.bottom+5}px`,n.style.left=`${i.left}px`,document.body.appendChild(n),this.activeDropdown=n,this.activeDropdownButton=e,e.setAttribute("aria-controls",n.id),e.setAttribute("aria-expanded","true"),this.handleDocumentClick=r=>{!n.contains(r.target)&&!e.contains(r.target)&&this.closeViewModeDropdown(e)},setTimeout(()=>{document.addEventListener("click",this.handleDocumentClick)},0),t&&this.focusViewModeMenuItem(n,t)}closeViewModeDropdown(e=this.activeDropdownButton,t=!1){this.activeDropdown&&(this.activeDropdown.remove(),this.activeDropdown=null),e&&(e.classList.remove("dropdown-active"),e.setAttribute("aria-expanded","false")),this.handleDocumentClick&&(document.removeEventListener("click",this.handleDocumentClick),this.handleDocumentClick=null),this.activeDropdownButton=null,t&&e&&e.focus()}createViewModeDropdown(e){let t=document.createElement("div");t.className="overtype-dropdown-menu",this.editor._markChrome(t),t.id=this.getInstanceElementId("toolbar-view-mode-menu"),t.setAttribute("role","menu"),t.setAttribute("aria-label","View mode"),t.addEventListener("keydown",r=>{this.onViewModeMenuKeydown(r,e)});let n=[{id:"normal",label:"Normal Edit",icon:"\u2713"},{id:"plain",label:"Plain Textarea",icon:"\u2713"},{id:"preview",label:"Preview Mode",icon:"\u2713"}],i=this.editor.container.dataset.mode||"normal";return n.forEach(r=>{let o=document.createElement("button");if(o.className="overtype-dropdown-item",o.type="button",o.tabIndex=-1,o.setAttribute("role","menuitemradio"),o.setAttribute("aria-checked",String(r.id===i)),o.textContent=r.label,r.id===i){o.classList.add("active");let s=document.createElement("span");s.className="overtype-dropdown-icon",s.setAttribute("aria-hidden","true"),s.textContent=r.icon,o.prepend(s)}o.addEventListener("click",s=>{switch(s.preventDefault(),r.id){case"plain":this.editor.showPlainTextarea();break;case"preview":this.editor.showPreviewMode();break;default:this.editor.showNormalEditMode();break}this.closeViewModeDropdown(e,!0)}),t.appendChild(o)}),t}onViewModeMenuKeydown(e,t){let i=this.getViewModeMenuItems().indexOf(e.target);if(i!==-1)switch(e.key){case"ArrowDown":e.preventDefault(),this.focusViewModeMenuItem(this.activeDropdown,i+1);break;case"ArrowUp":e.preventDefault(),this.focusViewModeMenuItem(this.activeDropdown,i-1);break;case"Home":e.preventDefault(),this.focusViewModeMenuItem(this.activeDropdown,"first");break;case"End":e.preventDefault(),this.focusViewModeMenuItem(this.activeDropdown,"last");break;case"Escape":e.preventDefault(),this.closeViewModeDropdown(t,!0);break}}focusViewModeMenuItem(e,t){let n=this.getViewModeMenuItems(e);if(n.length===0)return;let i=t;t==="first"?i=0:t==="last"?i=n.length-1:t==="current"&&(i=n.findIndex(r=>r.getAttribute("aria-checked")==="true")),i<0&&(i=n.length-1),i>=n.length&&(i=0),n[i].focus()}getViewModeMenuItems(e=this.activeDropdown){return e?Array.from(e.querySelectorAll('[role="menuitemradio"]')):[]}updateButtonStates(){var e;try{let t=((e=rt)==null?void 0:e(this.editor.textarea,this.editor.textarea.selectionStart))||[];Object.entries(this.buttons).forEach(([n,i])=>{if(n==="viewMode")return;let r=this.toolbarButtons.find(s=>s.name===n);if(!r?.isActive)return;let o=!!r.isActive({editor:this.editor,activeFormats:t});i.classList.toggle("active",o),i.setAttribute("aria-pressed",o.toString())})}catch{}}show(){this.container&&this.container.classList.remove("overtype-toolbar-hidden")}hide(){this.container&&this.container.classList.add("overtype-toolbar-hidden")}destroy(){this.container&&(this.activeDropdown?this.closeViewModeDropdown():this.handleDocumentClick&&(document.removeEventListener("click",this.handleDocumentClick),this.handleDocumentClick=null),Object.values(this.buttons).forEach(e=>{e._clickHandler&&(e.removeEventListener("click",e._clickHandler),delete e._clickHandler),e._keydownHandler&&(e.removeEventListener("keydown",e._keydownHandler),delete e._keydownHandler)}),this.container.remove(),this.container=null,this.buttons={})}},Fe=Math.min,Q=Math.max,xe=Math.round,P=e=>({x:e,y:e}),Un={left:"right",right:"left",bottom:"top",top:"bottom"},qn={start:"end",end:"start"};function kt(e,t,n){return Q(e,Fe(t,n))}function Ee(e,t){return typeof e=="function"?e(t):e}function X(e){return e.split("-")[0]}function Te(e){return e.split("-")[1]}function Wt(e){return e==="x"?"y":"x"}function Kt(e){return e==="y"?"height":"width"}var Wn=new Set(["top","bottom"]);function z(e){return Wn.has(X(e))?"y":"x"}function Xt(e){return Wt(z(e))}function Kn(e,t,n){n===void 0&&(n=!1);let i=Te(e),r=Xt(e),o=Kt(r),s=r==="x"?i===(n?"end":"start")?"right":"left":i==="start"?"bottom":"top";return t.reference[o]>t.floating[o]&&(s=ke(s)),[s,ke(s)]}function Xn(e){let t=ke(e);return[Ne(e),t,Ne(t)]}function Ne(e){return e.replace(/start|end/g,t=>qn[t])}var Lt=["left","right"],St=["right","left"],Zn=["top","bottom"],Gn=["bottom","top"];function Jn(e,t,n){switch(e){case"top":case"bottom":return n?t?St:Lt:t?Lt:St;case"left":case"right":return t?Zn:Gn;default:return[]}}function Qn(e,t,n,i){let r=Te(e),o=Jn(X(e),n==="start",i);return r&&(o=o.map(s=>s+"-"+r),t&&(o=o.concat(o.map(Ne)))),o}function ke(e){return e.replace(/left|right|bottom|top/g,t=>Un[t])}function Yn(e){return{top:0,right:0,bottom:0,left:0,...e}}function ei(e){return typeof e!="number"?Yn(e):{top:e,right:e,bottom:e,left:e}}function Le(e){let{x:t,y:n,width:i,height:r}=e;return{width:i,height:r,top:n,left:t,right:t+i,bottom:n+r,x:t,y:n}}function Et(e,t,n){let{reference:i,floating:r}=e,o=z(t),s=Xt(t),a=Kt(s),c=X(t),l=o==="y",u=i.x+i.width/2-r.width/2,p=i.y+i.height/2-r.height/2,h=i[a]/2-r[a]/2,d;switch(c){case"top":d={x:u,y:i.y-r.height};break;case"bottom":d={x:u,y:i.y+i.height};break;case"right":d={x:i.x+i.width,y:p};break;case"left":d={x:i.x-r.width,y:p};break;default:d={x:i.x,y:i.y}}switch(Te(t)){case"start":d[s]-=h*(n&&l?-1:1);break;case"end":d[s]+=h*(n&&l?-1:1);break}return d}async function ti(e,t){var n;t===void 0&&(t={});let{x:i,y:r,platform:o,rects:s,elements:a,strategy:c}=e,{boundary:l="clippingAncestors",rootBoundary:u="viewport",elementContext:p="floating",altBoundary:h=!1,padding:d=0}=Ee(t,e),f=ei(d),v=a[h?p==="floating"?"reference":"floating":p],w=Le(await o.getClippingRect({element:(n=await(o.isElement==null?void 0:o.isElement(v)))==null||n?v:v.contextElement||await(o.getDocumentElement==null?void 0:o.getDocumentElement(a.floating)),boundary:l,rootBoundary:u,strategy:c})),y=p==="floating"?{x:i,y:r,width:s.floating.width,height:s.floating.height}:s.reference,b=await(o.getOffsetParent==null?void 0:o.getOffsetParent(a.floating)),L=await(o.isElement==null?void 0:o.isElement(b))?await(o.getScale==null?void 0:o.getScale(b))||{x:1,y:1}:{x:1,y:1},x=Le(o.convertOffsetParentRelativeRectToViewportRelativeRect?await o.convertOffsetParentRelativeRectToViewportRelativeRect({elements:a,rect:y,offsetParent:b,strategy:c}):y);return{top:(w.top-x.top+f.top)/L.y,bottom:(x.bottom-w.bottom+f.bottom)/L.y,left:(w.left-x.left+f.left)/L.x,right:(x.right-w.right+f.right)/L.x}}var ni=async(e,t,n)=>{let{placement:i="bottom",strategy:r="absolute",middleware:o=[],platform:s}=n,a=o.filter(Boolean),c=await(s.isRTL==null?void 0:s.isRTL(t)),l=await s.getElementRects({reference:e,floating:t,strategy:r}),{x:u,y:p}=Et(l,i,c),h=i,d={},f=0;for(let v=0;v<a.length;v++){var m;let{name:w,fn:y}=a[v],{x:b,y:L,data:x,reset:S}=await y({x:u,y:p,initialPlacement:i,placement:h,strategy:r,middlewareData:d,rects:l,platform:{...s,detectOverflow:(m=s.detectOverflow)!=null?m:ti},elements:{reference:e,floating:t}});u=b??u,p=L??p,d={...d,[w]:{...d[w],...x}},S&&f<=50&&(f++,typeof S=="object"&&(S.placement&&(h=S.placement),S.rects&&(l=S.rects===!0?await s.getElementRects({reference:e,floating:t,strategy:r}):S.rects),{x:u,y:p}=Et(l,h,c)),v=-1)}return{x:u,y:p,placement:h,strategy:r,middlewareData:d}},ii=function(e){return e===void 0&&(e={}),{name:"flip",options:e,async fn(t){var n,i;let{placement:r,middlewareData:o,rects:s,initialPlacement:a,platform:c,elements:l}=t,{mainAxis:u=!0,crossAxis:p=!0,fallbackPlacements:h,fallbackStrategy:d="bestFit",fallbackAxisSideDirection:f="none",flipAlignment:m=!0,...v}=Ee(e,t);if((n=o.arrow)!=null&&n.alignmentOffset)return{};let w=X(r),y=z(a),b=X(a)===a,L=await(c.isRTL==null?void 0:c.isRTL(l.floating)),x=h||(b||!m?[ke(a)]:Xn(a)),S=f!=="none";!h&&S&&x.push(...Qn(a,m,f,L));let re=[a,...x],Z=await c.detectOverflow(t,v),fe=[],G=((i=o.flip)==null?void 0:i.overflows)||[];if(u&&fe.push(Z[w]),p){let q=Kn(r,s,L);fe.push(Z[q[0]],Z[q[1]])}if(G=[...G,{placement:r,overflows:fe}],!fe.every(q=>q<=0)){var at,lt;let q=(((at=o.flip)==null?void 0:at.index)||0)+1,Me=re[q];if(Me&&(!(p==="alignment"?y!==z(Me):!1)||G.every(I=>z(I.placement)===y?I.overflows[0]>0:!0)))return{data:{index:q,overflows:G},reset:{placement:Me}};let oe=(lt=G.filter(W=>W.overflows[0]<=0).sort((W,I)=>W.overflows[1]-I.overflows[1])[0])==null?void 0:lt.placement;if(!oe)switch(d){case"bestFit":{var ct;let W=(ct=G.filter(I=>{if(S){let N=z(I.placement);return N===y||N==="y"}return!0}).map(I=>[I.placement,I.overflows.filter(N=>N>0).reduce((N,rn)=>N+rn,0)]).sort((I,N)=>I[1]-N[1])[0])==null?void 0:ct[0];W&&(oe=W);break}case"initialPlacement":oe=a;break}if(r!==oe)return{reset:{placement:oe}}}return{}}}},ri=new Set(["left","top"]);async function oi(e,t){let{placement:n,platform:i,elements:r}=e,o=await(i.isRTL==null?void 0:i.isRTL(r.floating)),s=X(n),a=Te(n),c=z(n)==="y",l=ri.has(s)?-1:1,u=o&&c?-1:1,p=Ee(t,e),{mainAxis:h,crossAxis:d,alignmentAxis:f}=typeof p=="number"?{mainAxis:p,crossAxis:0,alignmentAxis:null}:{mainAxis:p.mainAxis||0,crossAxis:p.crossAxis||0,alignmentAxis:p.alignmentAxis};return a&&typeof f=="number"&&(d=a==="end"?f*-1:f),c?{x:d*u,y:h*l}:{x:h*l,y:d*u}}var si=function(e){return e===void 0&&(e=0),{name:"offset",options:e,async fn(t){var n,i;let{x:r,y:o,placement:s,middlewareData:a}=t,c=await oi(t,e);return s===((n=a.offset)==null?void 0:n.placement)&&(i=a.arrow)!=null&&i.alignmentOffset?{}:{x:r+c.x,y:o+c.y,data:{...c,placement:s}}}}},ai=function(e){return e===void 0&&(e={}),{name:"shift",options:e,async fn(t){let{x:n,y:i,placement:r,platform:o}=t,{mainAxis:s=!0,crossAxis:a=!1,limiter:c={fn:w=>{let{x:y,y:b}=w;return{x:y,y:b}}},...l}=Ee(e,t),u={x:n,y:i},p=await o.detectOverflow(t,l),h=z(X(r)),d=Wt(h),f=u[d],m=u[h];if(s){let w=d==="y"?"top":"left",y=d==="y"?"bottom":"right",b=f+p[w],L=f-p[y];f=kt(b,f,L)}if(a){let w=h==="y"?"top":"left",y=h==="y"?"bottom":"right",b=m+p[w],L=m-p[y];m=kt(b,m,L)}let v=c.fn({...t,[d]:f,[h]:m});return{...v,data:{x:v.x-n,y:v.y-i,enabled:{[d]:s,[h]:a}}}}}};function Ce(){return typeof window<"u"}function ne(e){return Zt(e)?(e.nodeName||"").toLowerCase():"#document"}function A(e){var t;return(e==null||(t=e.ownerDocument)==null?void 0:t.defaultView)||window}function F(e){var t;return(t=(Zt(e)?e.ownerDocument:e.document)||window.document)==null?void 0:t.documentElement}function Zt(e){return Ce()?e instanceof Node||e instanceof A(e).Node:!1}function M(e){return Ce()?e instanceof Element||e instanceof A(e).Element:!1}function R(e){return Ce()?e instanceof HTMLElement||e instanceof A(e).HTMLElement:!1}function Tt(e){return!Ce()||typeof ShadowRoot>"u"?!1:e instanceof ShadowRoot||e instanceof A(e).ShadowRoot}var li=new Set(["inline","contents"]);function he(e){let{overflow:t,overflowX:n,overflowY:i,display:r}=H(e);return/auto|scroll|overlay|hidden|clip/.test(t+i+n)&&!li.has(r)}var ci=new Set(["table","td","th"]);function pi(e){return ci.has(ne(e))}var ui=[":popover-open",":modal"];function Ae(e){return ui.some(t=>{try{return e.matches(t)}catch{return!1}})}var di=["transform","translate","scale","rotate","perspective"],hi=["transform","translate","scale","rotate","perspective","filter"],fi=["paint","layout","strict","content"];function ot(e){let t=st(),n=M(e)?H(e):e;return di.some(i=>n[i]?n[i]!=="none":!1)||(n.containerType?n.containerType!=="normal":!1)||!t&&(n.backdropFilter?n.backdropFilter!=="none":!1)||!t&&(n.filter?n.filter!=="none":!1)||hi.some(i=>(n.willChange||"").includes(i))||fi.some(i=>(n.contain||"").includes(i))}function mi(e){let t=U(e);for(;R(t)&&!te(t);){if(ot(t))return t;if(Ae(t))return null;t=U(t)}return null}function st(){return typeof CSS>"u"||!CSS.supports?!1:CSS.supports("-webkit-backdrop-filter","none")}var vi=new Set(["html","body","#document"]);function te(e){return vi.has(ne(e))}function H(e){return A(e).getComputedStyle(e)}function _e(e){return M(e)?{scrollLeft:e.scrollLeft,scrollTop:e.scrollTop}:{scrollLeft:e.scrollX,scrollTop:e.scrollY}}function U(e){if(ne(e)==="html")return e;let t=e.assignedSlot||e.parentNode||Tt(e)&&e.host||F(e);return Tt(t)?t.host:t}function Gt(e){let t=U(e);return te(t)?e.ownerDocument?e.ownerDocument.body:e.body:R(t)&&he(t)?t:Gt(t)}function Ve(e,t,n){var i;t===void 0&&(t=[]),n===void 0&&(n=!0);let r=Gt(e),o=r===((i=e.ownerDocument)==null?void 0:i.body),s=A(r);if(o){let a=ze(s);return t.concat(s,s.visualViewport||[],he(r)?r:[],a&&n?Ve(a):[])}return t.concat(r,Ve(r,[],n))}function ze(e){return e.parent&&Object.getPrototypeOf(e.parent)?e.frameElement:null}function Jt(e){let t=H(e),n=parseFloat(t.width)||0,i=parseFloat(t.height)||0,r=R(e),o=r?e.offsetWidth:n,s=r?e.offsetHeight:i,a=xe(n)!==o||xe(i)!==s;return a&&(n=o,i=s),{width:n,height:i,$:a}}function Qt(e){return M(e)?e:e.contextElement}function Y(e){let t=Qt(e);if(!R(t))return P(1);let n=t.getBoundingClientRect(),{width:i,height:r,$:o}=Jt(t),s=(o?xe(n.width):n.width)/i,a=(o?xe(n.height):n.height)/r;return(!s||!Number.isFinite(s))&&(s=1),(!a||!Number.isFinite(a))&&(a=1),{x:s,y:a}}var gi=P(0);function Yt(e){let t=A(e);return!st()||!t.visualViewport?gi:{x:t.visualViewport.offsetLeft,y:t.visualViewport.offsetTop}}function yi(e,t,n){return t===void 0&&(t=!1),!n||t&&n!==A(e)?!1:t}function pe(e,t,n,i){t===void 0&&(t=!1),n===void 0&&(n=!1);let r=e.getBoundingClientRect(),o=Qt(e),s=P(1);t&&(i?M(i)&&(s=Y(i)):s=Y(e));let a=yi(o,n,i)?Yt(o):P(0),c=(r.left+a.x)/s.x,l=(r.top+a.y)/s.y,u=r.width/s.x,p=r.height/s.y;if(o){let h=A(o),d=i&&M(i)?A(i):i,f=h,m=ze(f);for(;m&&i&&d!==f;){let v=Y(m),w=m.getBoundingClientRect(),y=H(m),b=w.left+(m.clientLeft+parseFloat(y.paddingLeft))*v.x,L=w.top+(m.clientTop+parseFloat(y.paddingTop))*v.y;c*=v.x,l*=v.y,u*=v.x,p*=v.y,c+=b,l+=L,f=A(m),m=ze(f)}}return Le({width:u,height:p,x:c,y:l})}function Ie(e,t){let n=_e(e).scrollLeft;return t?t.left+n:pe(F(e)).left+n}function en(e,t){let n=e.getBoundingClientRect(),i=n.left+t.scrollLeft-Ie(e,n),r=n.top+t.scrollTop;return{x:i,y:r}}function wi(e){let{elements:t,rect:n,offsetParent:i,strategy:r}=e,o=r==="fixed",s=F(i),a=t?Ae(t.floating):!1;if(i===s||a&&o)return n;let c={scrollLeft:0,scrollTop:0},l=P(1),u=P(0),p=R(i);if((p||!p&&!o)&&((ne(i)!=="body"||he(s))&&(c=_e(i)),R(i))){let d=pe(i);l=Y(i),u.x=d.x+i.clientLeft,u.y=d.y+i.clientTop}let h=s&&!p&&!o?en(s,c):P(0);return{width:n.width*l.x,height:n.height*l.y,x:n.x*l.x-c.scrollLeft*l.x+u.x+h.x,y:n.y*l.y-c.scrollTop*l.y+u.y+h.y}}function bi(e){return Array.from(e.getClientRects())}function xi(e){let t=F(e),n=_e(e),i=e.ownerDocument.body,r=Q(t.scrollWidth,t.clientWidth,i.scrollWidth,i.clientWidth),o=Q(t.scrollHeight,t.clientHeight,i.scrollHeight,i.clientHeight),s=-n.scrollLeft+Ie(e),a=-n.scrollTop;return H(i).direction==="rtl"&&(s+=Q(t.clientWidth,i.clientWidth)-r),{width:r,height:o,x:s,y:a}}var Ct=25;function ki(e,t){let n=A(e),i=F(e),r=n.visualViewport,o=i.clientWidth,s=i.clientHeight,a=0,c=0;if(r){o=r.width,s=r.height;let u=st();(!u||u&&t==="fixed")&&(a=r.offsetLeft,c=r.offsetTop)}let l=Ie(i);if(l<=0){let u=i.ownerDocument,p=u.body,h=getComputedStyle(p),d=u.compatMode==="CSS1Compat"&&parseFloat(h.marginLeft)+parseFloat(h.marginRight)||0,f=Math.abs(i.clientWidth-p.clientWidth-d);f<=Ct&&(o-=f)}else l<=Ct&&(o+=l);return{width:o,height:s,x:a,y:c}}var Li=new Set(["absolute","fixed"]);function Si(e,t){let n=pe(e,!0,t==="fixed"),i=n.top+e.clientTop,r=n.left+e.clientLeft,o=R(e)?Y(e):P(1),s=e.clientWidth*o.x,a=e.clientHeight*o.y,c=r*o.x,l=i*o.y;return{width:s,height:a,x:c,y:l}}function At(e,t,n){let i;if(t==="viewport")i=ki(e,n);else if(t==="document")i=xi(F(e));else if(M(t))i=Si(t,n);else{let r=Yt(e);i={x:t.x-r.x,y:t.y-r.y,width:t.width,height:t.height}}return Le(i)}function tn(e,t){let n=U(e);return n===t||!M(n)||te(n)?!1:H(n).position==="fixed"||tn(n,t)}function Ei(e,t){let n=t.get(e);if(n)return n;let i=Ve(e,[],!1).filter(a=>M(a)&&ne(a)!=="body"),r=null,o=H(e).position==="fixed",s=o?U(e):e;for(;M(s)&&!te(s);){let a=H(s),c=ot(s);!c&&a.position==="fixed"&&(r=null),(o?!c&&!r:!c&&a.position==="static"&&!!r&&Li.has(r.position)||he(s)&&!c&&tn(e,s))?i=i.filter(u=>u!==s):r=a,s=U(s)}return t.set(e,i),i}function Ti(e){let{element:t,boundary:n,rootBoundary:i,strategy:r}=e,s=[...n==="clippingAncestors"?Ae(t)?[]:Ei(t,this._c):[].concat(n),i],a=s[0],c=s.reduce((l,u)=>{let p=At(t,u,r);return l.top=Q(p.top,l.top),l.right=Fe(p.right,l.right),l.bottom=Fe(p.bottom,l.bottom),l.left=Q(p.left,l.left),l},At(t,a,r));return{width:c.right-c.left,height:c.bottom-c.top,x:c.left,y:c.top}}function Ci(e){let{width:t,height:n}=Jt(e);return{width:t,height:n}}function Ai(e,t,n){let i=R(t),r=F(t),o=n==="fixed",s=pe(e,!0,o,t),a={scrollLeft:0,scrollTop:0},c=P(0);function l(){c.x=Ie(r)}if(i||!i&&!o)if((ne(t)!=="body"||he(r))&&(a=_e(t)),i){let d=pe(t,!0,o,t);c.x=d.x+t.clientLeft,c.y=d.y+t.clientTop}else r&&l();o&&!i&&r&&l();let u=r&&!i&&!o?en(r,a):P(0),p=s.left+a.scrollLeft-c.x-u.x,h=s.top+a.scrollTop-c.y-u.y;return{x:p,y:h,width:s.width,height:s.height}}function Pe(e){return H(e).position==="static"}function _t(e,t){if(!R(e)||H(e).position==="fixed")return null;if(t)return t(e);let n=e.offsetParent;return F(e)===n&&(n=n.ownerDocument.body),n}function nn(e,t){let n=A(e);if(Ae(e))return n;if(!R(e)){let r=U(e);for(;r&&!te(r);){if(M(r)&&!Pe(r))return r;r=U(r)}return n}let i=_t(e,t);for(;i&&pi(i)&&Pe(i);)i=_t(i,t);return i&&te(i)&&Pe(i)&&!ot(i)?n:i||mi(e)||n}var _i=async function(e){let t=this.getOffsetParent||nn,n=this.getDimensions,i=await n(e.floating);return{reference:Ai(e.reference,await t(e.floating),e.strategy),floating:{x:0,y:0,width:i.width,height:i.height}}};function Ii(e){return H(e).direction==="rtl"}var Mi={convertOffsetParentRelativeRectToViewportRelativeRect:wi,getDocumentElement:F,getClippingRect:Ti,getOffsetParent:nn,getElementRects:_i,getClientRects:bi,getDimensions:Ci,getScale:Y,isElement:M,isRTL:Ii},Hi=si,$i=ai,Pi=ii,Oi=(e,t,n)=>{let i=new Map,r={platform:Mi,...n},o={...r.platform,_c:i};return ni(e,t,{...r,platform:o})},Ri=class{constructor(e){this.editor=e,this.tooltip=null,this.currentLink=null,this.hideTimeout=null,this.visibilityChangeHandler=null,this.isTooltipHovered=!1,this.linkCacheText=null,this.linkCache=[],this.init()}init(){this.createTooltip(),this.textareaListeners={selectionchange:()=>this.checkCursorPosition(),keyup:e=>{(e.key.includes("Arrow")||e.key==="Home"||e.key==="End")&&this.checkCursorPosition()},input:()=>this.hide(),scroll:()=>{this.currentLink&&this.positionTooltip(this.currentLink)},blur:()=>{this.isTooltipHovered||this.hide()}};for(let[e,t]of Object.entries(this.textareaListeners))this.editor.textarea.addEventListener(e,t);this.visibilityChangeHandler=()=>{document.hidden&&this.hide()},document.addEventListener("visibilitychange",this.visibilityChangeHandler),this.tooltip.addEventListener("mouseenter",()=>{this.isTooltipHovered=!0,this.cancelHide()}),this.tooltip.addEventListener("mouseleave",()=>{this.isTooltipHovered=!1,this.scheduleHide()})}createTooltip(){this.tooltip=document.createElement("div"),this.tooltip.className="overtype-link-tooltip",this.editor._markChrome(this.tooltip),this.tooltip.innerHTML=`
      <span style="display: flex; align-items: center; gap: 6px;">
        <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor" style="flex-shrink: 0;">
          <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z"></path>
          <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z"></path>
        </svg>
        <span class="overtype-link-tooltip-url"></span>
      </span>
    `,this.tooltip.addEventListener("click",e=>{if(e.preventDefault(),e.stopPropagation(),this.currentLink){let t=T.sanitizeUrl(this.currentLink.url);t!=="#"&&window.open(t,"_blank"),this.hide()}}),this.editor.container.appendChild(this.tooltip)}checkCursorPosition(){let e=this.editor.textarea.selectionStart,t=this.editor.textarea.value,n=this.findLinkAtPosition(t,e);n?(!this.currentLink||this.currentLink.url!==n.url||this.currentLink.index!==n.index)&&this.show(n):this.scheduleHide()}findLinkAtPosition(e,t){if(this.editor.options.showActiveLineRaw)return null;this.linkCacheText!==e&&(this.linkCacheText=e,this.linkCache=T.findRenderableLinks(e));let n=this.linkCache;for(let[i,r]of n.entries()){let o=r.start,s=r.end;if(t>=o&&t<=s)return{text:r.text.raw,url:this.transformUrl(r.destination.value),index:i,start:o,end:s}}return null}transformUrl(e){let t=this.editor.options.transformLinkUrl;if(typeof t!="function")return e;try{let n=t(e);return typeof n=="string"?n:e}catch(n){return console.warn("transformLinkUrl threw:",n),e}}async show(e){this.currentLink=e,this.cancelHide();let t=this.tooltip.querySelector(".overtype-link-tooltip-url");t.textContent=e.url,await this.positionTooltip(e),this.currentLink===e&&this.tooltip.classList.add("visible")}async positionTooltip(e){let t=this.findAnchorElement(e.index);if(!t)return;let n=t.getBoundingClientRect();if(!(n.width===0||n.height===0))try{let{x:i,y:r}=await Oi(t,this.tooltip,{strategy:"fixed",placement:"bottom",middleware:[Hi(8),$i({padding:8}),Pi()]});Object.assign(this.tooltip.style,{left:`${i}px`,top:`${r}px`,position:"fixed"})}catch(i){console.warn("Floating UI positioning failed:",i)}}findAnchorElement(e){return this.editor.preview.querySelector(`a[style*="--link-${e}"]`)}hide(){this.tooltip.classList.remove("visible"),this.currentLink=null,this.isTooltipHovered=!1}scheduleHide(){this.cancelHide(),this.hideTimeout=setTimeout(()=>this.hide(),300)}cancelHide(){this.hideTimeout&&(clearTimeout(this.hideTimeout),this.hideTimeout=null)}destroy(){if(this.cancelHide(),this.textareaListeners){for(let[e,t]of Object.entries(this.textareaListeners))this.editor.textarea.removeEventListener(e,t);this.textareaListeners=null}this.visibilityChangeHandler&&(document.removeEventListener("visibilitychange",this.visibilityChangeHandler),this.visibilityChangeHandler=null),this.tooltip&&this.tooltip.parentNode&&this.tooltip.parentNode.removeChild(this.tooltip),this.tooltip=null,this.currentLink=null,this.isTooltipHovered=!1}},Di=`<svg viewBox="0 0 18 18">
  <path stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5,4H9.5A2.5,2.5,0,0,1,12,6.5v0A2.5,2.5,0,0,1,9.5,9H5A0,0,0,0,1,5,9V4A0,0,0,0,1,5,4Z"></path>
  <path stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5,9h5.5A2.5,2.5,0,0,1,13,11.5v0A2.5,2.5,0,0,1,10.5,14H5a0,0,0,0,1,0,0V9A0,0,0,0,1,5,9Z"></path>
</svg>`,Bi=`<svg viewBox="0 0 18 18">
  <line stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="7" x2="13" y1="4" y2="4"></line>
  <line stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="5" x2="11" y1="14" y2="14"></line>
  <line stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="8" x2="10" y1="14" y2="4"></line>
</svg>`,Fi=`<svg viewBox="0 0 18 18">
  <path fill="currentColor" d="M10,4V14a1,1,0,0,1-2,0V10H3v4a1,1,0,0,1-2,0V4A1,1,0,0,1,3,4V8H8V4a1,1,0,0,1,2,0Zm6.06787,9.209H14.98975V7.59863a.54085.54085,0,0,0-.605-.60547h-.62744a1.01119,1.01119,0,0,0-.748.29688L11.645,8.56641a.5435.5435,0,0,0-.022.8584l.28613.30762a.53861.53861,0,0,0,.84717.0332l.09912-.08789a1.2137,1.2137,0,0,0,.2417-.35254h.02246s-.01123.30859-.01123.60547V13.209H12.041a.54085.54085,0,0,0-.605.60547v.43945a.54085.54085,0,0,0,.605.60547h4.02686a.54085.54085,0,0,0,.605-.60547v-.43945A.54085.54085,0,0,0,16.06787,13.209Z"></path>
</svg>`,Ni=`<svg viewBox="0 0 18 18">
  <path fill="currentColor" d="M16.73975,13.81445v.43945a.54085.54085,0,0,1-.605.60547H11.855a.58392.58392,0,0,1-.64893-.60547V14.0127c0-2.90527,3.39941-3.42187,3.39941-4.55469a.77675.77675,0,0,0-.84717-.78125,1.17684,1.17684,0,0,0-.83594.38477c-.2749.26367-.561.374-.85791.13184l-.4292-.34082c-.30811-.24219-.38525-.51758-.1543-.81445a2.97155,2.97155,0,0,1,2.45361-1.17676,2.45393,2.45393,0,0,1,2.68408,2.40918c0,2.45312-3.1792,2.92676-3.27832,3.93848h2.79443A.54085.54085,0,0,1,16.73975,13.81445ZM9,3A.99974.99974,0,0,0,8,4V8H3V4A1,1,0,0,0,1,4V14a1,1,0,0,0,2,0V10H8v4a1,1,0,0,0,2,0V4A.99974.99974,0,0,0,9,3Z"></path>
</svg>`,Vi=`<svg viewBox="0 0 18 18">
  <path fill="currentColor" d="M16.65186,12.30664a2.6742,2.6742,0,0,1-2.915,2.68457,3.96592,3.96592,0,0,1-2.25537-.6709.56007.56007,0,0,1-.13232-.83594L11.64648,13c.209-.34082.48389-.36328.82471-.1543a2.32654,2.32654,0,0,0,1.12256.33008c.71484,0,1.12207-.35156,1.12207-.78125,0-.61523-.61621-.86816-1.46338-.86816H13.2085a.65159.65159,0,0,1-.68213-.41895l-.05518-.10937a.67114.67114,0,0,1,.14307-.78125l.71533-.86914a8.55289,8.55289,0,0,1,.68213-.7373V8.58887a3.93913,3.93913,0,0,1-.748.05469H11.9873a.54085.54085,0,0,1-.605-.60547V7.59863a.54085.54085,0,0,1,.605-.60547h3.75146a.53773.53773,0,0,1,.60547.59375v.17676a1.03723,1.03723,0,0,1-.27539.748L14.74854,10.0293A2.31132,2.31132,0,0,1,16.65186,12.30664ZM9,3A.99974.99974,0,0,0,8,4V8H3V4A1,1,0,0,0,1,4V14a1,1,0,0,0,2,0V10H8v4a1,1,0,0,0,2,0V4A.99974.99974,0,0,0,9,3Z"></path>
</svg>`,zi=`<svg viewBox="0 0 18 18">
  <line stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="7" x2="11" y1="7" y2="11"></line>
  <path stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.9,4.577a3.476,3.476,0,0,1,.36,4.679A3.476,3.476,0,0,1,4.577,8.9C3.185,7.5,2.035,6.4,4.217,4.217S7.5,3.185,8.9,4.577Z"></path>
  <path stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.423,9.1a3.476,3.476,0,0,0-4.679-.36,3.476,3.476,0,0,0,.36,4.679c1.392,1.392,2.5,2.542,4.679.36S14.815,10.5,13.423,9.1Z"></path>
</svg>`,ji=`<svg viewBox="0 0 18 18">
  <polyline stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" points="5 7 3 9 5 11"></polyline>
  <polyline stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" points="13 7 15 9 13 11"></polyline>
  <line stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="10" x2="8" y1="5" y2="13"></line>
</svg>`,Ui=`<svg viewBox="0 0 18 18">
  <line stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="6" x2="15" y1="4" y2="4"></line>
  <line stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="6" x2="15" y1="9" y2="9"></line>
  <line stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="6" x2="15" y1="14" y2="14"></line>
  <line stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="3" x2="3" y1="4" y2="4"></line>
  <line stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="3" x2="3" y1="9" y2="9"></line>
  <line stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="3" x2="3" y1="14" y2="14"></line>
</svg>`,qi=`<svg viewBox="0 0 18 18">
  <line stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="7" x2="15" y1="4" y2="4"></line>
  <line stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="7" x2="15" y1="9" y2="9"></line>
  <line stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="7" x2="15" y1="14" y2="14"></line>
  <line stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="1" x1="2.5" x2="4.5" y1="5.5" y2="5.5"></line>
  <path fill="currentColor" d="M3.5,6A0.5,0.5,0,0,1,3,5.5V3.085l-0.276.138A0.5,0.5,0,0,1,2.053,3c-0.124-.247-0.023-0.324.224-0.447l1-.5A0.5,0.5,0,0,1,4,2.5v3A0.5,0.5,0,0,1,3.5,6Z"></path>
  <path stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M4.5,10.5h-2c0-.234,1.85-1.076,1.85-2.234A0.959,0.959,0,0,0,2.5,8.156"></path>
  <path stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M2.5,14.846a0.959,0.959,0,0,0,1.85-.109A0.7,0.7,0,0,0,3.75,14a0.688,0.688,0,0,0,.6-0.736,0.959,0.959,0,0,0-1.85-.109"></path>
</svg>`,Wi=`<svg viewBox="2 2 20 20">
  <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 10.8182L9 10.8182C8.80222 10.8182 8.60888 10.7649 8.44443 10.665C8.27998 10.5651 8.15181 10.4231 8.07612 10.257C8.00043 10.0909 7.98063 9.90808 8.01922 9.73174C8.0578 9.55539 8.15304 9.39341 8.29289 9.26627C8.43275 9.13913 8.61093 9.05255 8.80491 9.01747C8.99889 8.98239 9.19996 9.00039 9.38268 9.0692C9.56541 9.13801 9.72159 9.25453 9.83147 9.40403C9.94135 9.55353 10 9.72929 10 9.90909L10 12.1818C10 12.664 9.78929 13.1265 9.41421 13.4675C9.03914 13.8084 8.53043 14 8 14"></path>
  <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 10.8182L15 10.8182C14.8022 10.8182 14.6089 10.7649 14.4444 10.665C14.28 10.5651 14.1518 10.4231 14.0761 10.257C14.0004 10.0909 13.9806 9.90808 14.0192 9.73174C14.0578 9.55539 14.153 9.39341 14.2929 9.26627C14.4327 9.13913 14.6109 9.05255 14.8049 9.01747C14.9989 8.98239 15.2 9.00039 15.3827 9.0692C15.5654 9.13801 15.7216 9.25453 15.8315 9.40403C15.9414 9.55353 16 9.72929 16 9.90909L16 12.1818C16 12.664 15.7893 13.1265 15.4142 13.4675C15.0391 13.8084 14.5304 14 14 14"></path>
</svg>`,Ki=`<svg viewBox="0 0 18 18">
  <line stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="8" x2="16" y1="4" y2="4"></line>
  <line stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="8" x2="16" y1="9" y2="9"></line>
  <line stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="8" x2="16" y1="14" y2="14"></line>
  <rect stroke="currentColor" fill="none" stroke-width="1.5" x="2" y="3" width="3" height="3" rx="0.5"></rect>
  <rect stroke="currentColor" fill="none" stroke-width="1.5" x="2" y="13" width="3" height="3" rx="0.5"></rect>
  <polyline stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" points="2.65 9.5 3.5 10.5 5 8.5"></polyline>
</svg>`,Xi=`<svg viewBox="0 0 18 18">
  <path stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.25 12.375v1.688A1.688 1.688 0 0 0 3.938 15.75h10.124a1.688 1.688 0 0 0 1.688-1.688V12.375"></path>
  <path stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5.063 6.188L9 2.25l3.938 3.938"></path>
  <path stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 2.25v10.125"></path>
</svg>`,Zi=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" fill="none"></path>
  <circle cx="12" cy="12" r="3" fill="none"></circle>
</svg>`,E={bold:{name:"bold",actionId:"toggleBold",icon:Di,title:"Bold (Ctrl+B)",isActive:({activeFormats:e})=>e.includes("bold"),action:({editor:e})=>{Xe(e.textarea),e.textarea.dispatchEvent(new Event("input",{bubbles:!0}))}},italic:{name:"italic",actionId:"toggleItalic",icon:Bi,title:"Italic (Ctrl+I)",isActive:({activeFormats:e})=>e.includes("italic"),action:({editor:e})=>{Ze(e.textarea),e.textarea.dispatchEvent(new Event("input",{bubbles:!0}))}},code:{name:"code",actionId:"toggleCode",icon:ji,title:"Inline Code",isActive:()=>!1,action:({editor:e})=>{Ge(e.textarea),e.textarea.dispatchEvent(new Event("input",{bubbles:!0}))}},separator:{name:"separator"},link:{name:"link",actionId:"insertLink",icon:zi,title:"Insert Link",action:({editor:e})=>{Je(e.textarea),e.textarea.dispatchEvent(new Event("input",{bubbles:!0}))}},h1:{name:"h1",actionId:"toggleH1",icon:Fi,title:"Heading 1",isActive:({activeFormats:e})=>e.includes("header"),action:({editor:e})=>{tt(e.textarea),e.textarea.dispatchEvent(new Event("input",{bubbles:!0}))}},h2:{name:"h2",actionId:"toggleH2",icon:Ni,title:"Heading 2",isActive:({activeFormats:e})=>e.includes("header-2"),action:({editor:e})=>{nt(e.textarea),e.textarea.dispatchEvent(new Event("input",{bubbles:!0}))}},h3:{name:"h3",actionId:"toggleH3",icon:Vi,title:"Heading 3",isActive:({activeFormats:e})=>e.includes("header-3"),action:({editor:e})=>{it(e.textarea),e.textarea.dispatchEvent(new Event("input",{bubbles:!0}))}},bulletList:{name:"bulletList",actionId:"toggleBulletList",icon:Ui,title:"Bullet List",isActive:({activeFormats:e})=>e.includes("bullet-list"),action:({editor:e})=>{Qe(e.textarea),e.textarea.dispatchEvent(new Event("input",{bubbles:!0}))}},orderedList:{name:"orderedList",actionId:"toggleNumberedList",icon:qi,title:"Numbered List",isActive:({activeFormats:e})=>e.includes("numbered-list"),action:({editor:e})=>{Ye(e.textarea),e.textarea.dispatchEvent(new Event("input",{bubbles:!0}))}},taskList:{name:"taskList",actionId:"toggleTaskList",icon:Ki,title:"Task List",isActive:({activeFormats:e})=>e.includes("task-list"),action:({editor:e})=>{be&&(be(e.textarea),e.textarea.dispatchEvent(new Event("input",{bubbles:!0})))}},quote:{name:"quote",actionId:"toggleQuote",icon:Wi,title:"Quote",isActive:({activeFormats:e})=>e.includes("quote"),action:({editor:e})=>{et(e.textarea),e.textarea.dispatchEvent(new Event("input",{bubbles:!0}))}},upload:{name:"upload",actionId:"uploadFile",icon:Xi,title:"Upload File",action:({editor:e})=>{var t,n;if(!((t=e.options.fileUpload)!=null&&t.enabled))return;let i=document.createElement("input");i.type="file",i.multiple=!0,((n=e.options.fileUpload.mimeTypes)==null?void 0:n.length)>0&&(i.accept=e.options.fileUpload.mimeTypes.join(",")),i.onchange=()=>{var r;if(!((r=i.files)!=null&&r.length))return;let o=new DataTransfer;for(let s of i.files)o.items.add(s);e._handleDataTransfer(o)},i.click()}},viewMode:{name:"viewMode",icon:Zi,title:"View mode"}},je=[E.bold,E.italic,E.code,E.separator,E.link,E.separator,E.h1,E.h2,E.h3,E.separator,E.bulletList,E.orderedList,E.taskList,E.separator,E.quote,E.separator,E.viewMode],ae;function Gi(){if(ae!==void 0)return ae;if(ae=!1,typeof navigator<"u"){let e=navigator.userAgent||"";ae=/^((?!chrome|android|crios|fxios|edg|opr).)*safari/i.test(e)||/iPad|iPhone|iPod/.test(e)||navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1&&/Safari/.test(e)}return ae}function Oe(e){let t={};return(e||[]).forEach(n=>{if(!n||n.name==="separator")return;let i=n.actionId||n.name;n.action&&(t[i]=n.action)}),t}function It(e){let t=e||je;return Array.isArray(t)?t.map(n=>({name:n?.name||null,actionId:n?.actionId||n?.name||null,icon:n?.icon||null,title:n?.title||null})):null}function Ji(e,t){let n=It(e),i=It(t);if(n===null||i===null)return n!==i;if(n.length!==i.length)return!0;for(let r=0;r<n.length;r++){let o=n[r],s=i[r];if(o.name!==s.name||o.actionId!==s.actionId||o.icon!==s.icon||o.title!==s.title)return!0}return!1}var $=class g{constructor(t,n={}){let i=g._resolveTargets(t);if(typeof t=="string"&&i.length===0)throw new Error(`No elements found for selector: ${t}`);return i.map(o=>{if(o.overTypeInstance)return o.overTypeInstance.reinit(n),o.overTypeInstance;let s=Object.create(g.prototype);return s._init(o,n),o.overTypeInstance=s,g.instances.set(o,s),s})}_init(t,n={}){var i;this.element=t,this.instanceTheme=n.theme||null,this.options=this._mergeOptions(n),this.instanceId=++g.instanceCount,this.initialized=!1,this._isSafari=Gi(),this._safariReflowRaf=null,this.options.persist&&!g.stylesChrome&&(g.stylesChrome=!0,(i=document.querySelector("style.overtype-styles"))==null||i.setAttribute("clay","editor-ui")),g.injectStyles(),g.initGlobalListeners();let r=t.querySelector(".overtype-container"),o=t.querySelector(".overtype-wrapper");r||o?this._recoverFromDOM(r,o):this._buildFromScratch(),this.instanceTheme==="auto"&&this.setTheme("auto"),this.shortcuts=new Ot(this),this._rebuildActionsMap(),this.linkTooltip=new Ri(this),requestAnimationFrame(()=>{requestAnimationFrame(()=>{this.textarea.scrollTop=this.preview.scrollTop,this.textarea.scrollLeft=this.preview.scrollLeft})}),this.initialized=!0,this.options.onChange&&this._notifyChange()}_mergeOptions(t){let n={fontSize:"14px",lineHeight:1.6,fontFamily:'"SF Mono", SFMono-Regular, Menlo, Monaco, "Cascadia Code", Consolas, "Roboto Mono", "Noto Sans Mono", "Droid Sans Mono", "Ubuntu Mono", "DejaVu Sans Mono", "Liberation Mono", "Courier New", Courier, monospace',padding:"16px",mobile:{fontSize:"16px",padding:"12px",lineHeight:1.5},textareaProps:{},autofocus:!1,autoResize:!1,minHeight:"100px",maxHeight:null,placeholder:"Start typing...",value:"",onChange:null,onKeydown:null,onRender:null,onFocus:null,onBlur:null,showActiveLineRaw:!1,showStats:!1,toolbar:!1,toolbarButtons:null,statsFormatter:null,smartLists:!0,clickToToggleTasks:!1,codeHighlighter:null,spellcheck:!1,persist:!1,transformLinkUrl:null},{theme:i,colors:r,...o}=t;return{...n,...o}}_recoverFromDOM(t,n){let i=this._extractContent();if(t&&t.classList.contains("overtype-container"))this.container=t,this.wrapper=t.querySelector(".overtype-wrapper");else if(n){if(this.wrapper=n,this.container=document.createElement("div"),this.container.className="overtype-container",this.instanceTheme){let s=typeof this.instanceTheme=="string"?K(this.instanceTheme):this.instanceTheme;s&&s.colors&&(this.container.style.cssText+=le(s.colors))}n.parentNode.insertBefore(this.container,n),this.container.appendChild(n)}if(this.textarea=this.wrapper?this.wrapper.querySelector(".overtype-input"):null,!this.textarea){t&&t.remove(),n&&n.remove(),this._buildFromScratch(i);return}let r=this.instanceTheme||g.currentTheme||j,o=typeof r=="string"?r:r.name;o&&this.container.setAttribute("data-theme",o),this.container.querySelectorAll(".overtype-toolbar, .overtype-link-tooltip, .overtype-stats, .overtype-placeholder, .overtype-preview").forEach(s=>s.remove()),this.container.classList.remove("overtype-auto-resize"),[this.wrapper,this.textarea].forEach(s=>{s.style.removeProperty("height"),s.style.removeProperty("overflow-y")}),this._createOverlay(),this.options.showStats&&this._createStatsBar(),this.wrapper._instance=this,this._applyInstanceCSSVars(),this._configureTextarea(),this._ensureTextareaId(),this._syncPreviewInteractivity(),this._applyOptions()}_buildFromScratch(t=this._extractContent()){this.element.innerHTML="",this._createDOM(),(t||this.options.value)&&this.setValue(t||this.options.value),this._applyOptions()}_extractContent(){let t=this.element.querySelector(".overtype-input");return t?t.value:this.element.textContent||""}_createDOM(){this.container=document.createElement("div"),this.container.className="overtype-container";let t=this.instanceTheme||g.currentTheme||j,n=typeof t=="string"?t:t.name;if(n&&this.container.setAttribute("data-theme",n),this.instanceTheme){let i=typeof this.instanceTheme=="string"?K(this.instanceTheme):this.instanceTheme;if(i&&i.colors){let r=le(i.colors);this.container.style.cssText+=r}}this.wrapper=document.createElement("div"),this.wrapper.className="overtype-wrapper",this._applyInstanceCSSVars(),this.wrapper._instance=this,this.textarea=document.createElement("textarea"),this.textarea.className="overtype-input",this.textarea.placeholder=this.options.placeholder,this._configureTextarea(),this.options.textareaProps&&Object.entries(this.options.textareaProps).forEach(([i,r])=>{i==="className"||i==="class"?this.textarea.className+=" "+r:i==="style"&&typeof r=="object"?Object.assign(this.textarea.style,r):this.textarea.setAttribute(i,r)}),this._ensureTextareaId(),this.wrapper.appendChild(this.textarea),this._createOverlay(),this.container.appendChild(this.wrapper),this.options.showStats&&this._createStatsBar(),this.element.appendChild(this.container),this.options.autoResize?this._setupAutoResize():this.container.classList.remove("overtype-auto-resize"),this._syncPreviewInteractivity()}_createOverlay(){this.preview=document.createElement("div"),this.preview.className="overtype-preview",this.preview.setAttribute("aria-hidden","true"),this.placeholderEl=document.createElement("div"),this.placeholderEl.className="overtype-placeholder",this.placeholderEl.setAttribute("aria-hidden","true"),this.placeholderEl.textContent=this.options.placeholder,this.wrapper.appendChild(this.preview),this.wrapper.appendChild(this.placeholderEl),this._markChrome(this.preview),this._markChrome(this.placeholderEl)}_createStatsBar(){this.statsBar=document.createElement("div"),this.statsBar.className="overtype-stats",this._markChrome(this.statsBar),this.container.appendChild(this.statsBar),this._updateStats()}_markChrome(t){this.options.persist&&t&&t.setAttribute("clay","editor-ui")}_configureTextarea(){this.textarea.setAttribute("autocomplete","off"),this.textarea.setAttribute("autocorrect","off"),this.textarea.setAttribute("autocapitalize","off"),this.textarea.setAttribute("spellcheck",String(this.options.spellcheck)),this.textarea.setAttribute("data-gramm","false"),this.textarea.setAttribute("data-gramm_editor","false"),this.textarea.setAttribute("data-enable-grammarly","false"),this.options.persist&&this.textarea.setAttribute("persist","")}_ensureTextareaId(){let t=this.textarea.id,n=/^overtype-\d+-input$/.test(t);if(t&&!(n&&document.querySelectorAll(`[id="${t}"]`).length>1))return;let i=this.instanceId;for(;document.getElementById(`overtype-${i}-input`);)i++;this.textarea.id=`overtype-${i}-input`}_syncPreviewInteractivity(){if(!this.preview||!this.container)return;let t=this.container.dataset.mode==="preview";if(this.preview.inert=!t,this.preview.toggleAttribute("inert",!t),t){this.preview.removeAttribute("aria-hidden");return}this.preview.setAttribute("aria-hidden","true")}_createToolbar(){var t;let n=this.options.toolbarButtons||je;if((t=this.options.fileUpload)!=null&&t.enabled&&!n.some(i=>i?.name==="upload")){let i=n.findIndex(r=>r?.name==="viewMode");i!==-1?(n=[...n],n.splice(i,0,E.separator,E.upload)):n=[...n,E.separator,E.upload]}this.toolbar=new jn(this,{toolbarButtons:n}),this.toolbar.create(),this._toolbarSelectionListener=()=>{this.toolbar&&this.toolbar.updateButtonStates()},this._toolbarInputListener=()=>{this.toolbar&&this.toolbar.updateButtonStates()},this.textarea.addEventListener("selectionchange",this._toolbarSelectionListener),this.textarea.addEventListener("input",this._toolbarInputListener)}_cleanupToolbarListeners(){this._toolbarSelectionListener&&(this.textarea.removeEventListener("selectionchange",this._toolbarSelectionListener),this._toolbarSelectionListener=null),this._toolbarInputListener&&(this.textarea.removeEventListener("input",this._toolbarInputListener),this._toolbarInputListener=null)}_rebuildActionsMap(){var t;this.actionsById=Oe(je),this.options.toolbarButtons&&Object.assign(this.actionsById,Oe(this.options.toolbarButtons)),(t=this.options.fileUpload)!=null&&t.enabled&&Object.assign(this.actionsById,Oe([E.upload]))}_applyInstanceCSSVars(){if(!this.wrapper)return;let t=[["--instance-font-size",this.options.fontSize,V.fontSize],["--instance-line-height",this.options.lineHeight,V.lineHeight],["--instance-padding",this.options.padding,V.padding],["--instance-font-family",this.options.fontFamily,V.fontFamily]];for(let[n,i,r]of t)i&&String(i)!==String(r)?this.wrapper.style.setProperty(n,String(i)):this.wrapper.style.removeProperty(n)}_applyOptions(){this._applyInstanceCSSVars(),this.options.autofocus&&this.textarea.focus(),this.options.autoResize?this.container.classList.contains("overtype-auto-resize")?this._updateAutoHeight():this._setupAutoResize():this.container.classList.remove("overtype-auto-resize"),this.options.toolbar&&!this.toolbar?this._createToolbar():!this.options.toolbar&&this.toolbar&&(this._cleanupToolbarListeners(),this.toolbar.destroy(),this.toolbar=null),this.placeholderEl&&(this.placeholderEl.textContent=this.options.placeholder),this.options.fileUpload&&!this.fileUploadInitialized?this._initFileUpload():!this.options.fileUpload&&this.fileUploadInitialized&&this._destroyFileUpload(),this.updatePreview()}_initFileUpload(){let t=this.options.fileUpload;if(!(!t||!t.enabled)){if(t.maxSize=t.maxSize||10*1024*1024,t.mimeTypes=t.mimeTypes||[],t.batch=t.batch||!1,!t.onInsertFile||typeof t.onInsertFile!="function"){console.warn("OverType: fileUpload.onInsertFile callback is required for file uploads.");return}this._fileUploadCounter=0,this._uploadedFiles=new Map,this._boundHandleFilePaste=this._handleFilePaste.bind(this),this._boundHandleFileDrop=this._handleFileDrop.bind(this),this._boundHandleDragOver=this._handleDragOver.bind(this),this.textarea.addEventListener("paste",this._boundHandleFilePaste),this.textarea.addEventListener("drop",this._boundHandleFileDrop),this.textarea.addEventListener("dragover",this._boundHandleDragOver),this.fileUploadInitialized=!0}}_extractMarkdownUrls(t){return T.findLinks(t,{allowEmptyText:!0}).map(n=>n.destination.value)}_trackInsertedUrls(t,n){if(!this._uploadedFiles||!n||!t)return;let i=T.findLinks(t,{allowEmptyText:!0});for(let r of i)this._uploadedFiles.set(r.destination.value,{filename:n.name,file:n,markdownDestination:r.destination.raw})}_checkForRemovedUploads(){var t;if(!this._uploadedFiles||this._uploadedFiles.size===0)return;let n=(t=this.options.fileUpload)==null?void 0:t.onRemoveFile,i=this.textarea.value,r=new Set(this._extractMarkdownUrls(this.textarea.value)),o=[];for(let[s,a]of this._uploadedFiles){let c=a.markdownDestination||s;!r.has(s)&&!i.includes(c)&&o.push({url:s,info:a})}for(let{url:s,info:a}of o)this._uploadedFiles.delete(s),n&&n({url:s,filename:a.filename,file:a.file})}_handleFilePaste(t){var n,i;(i=(n=t?.clipboardData)==null?void 0:n.files)!=null&&i.length&&(t.preventDefault(),this._handleDataTransfer(t.clipboardData))}_handleFileDrop(t){var n,i;(i=(n=t?.dataTransfer)==null?void 0:n.files)!=null&&i.length&&(t.preventDefault(),this._handleDataTransfer(t.dataTransfer))}_handleDataTransfer(t){let n=[];for(let i of t.files){if(i.size>this.options.fileUpload.maxSize||this.options.fileUpload.mimeTypes.length>0&&!this.options.fileUpload.mimeTypes.includes(i.type))continue;let r=++this._fileUploadCounter,s=`${i.type.startsWith("image/")?"!":""}[Uploading ${i.name} (#${r})...]()`;if(this.insertAtCursor(`${s}
`),this.options.fileUpload.batch){n.push({file:i,placeholder:s});continue}this.options.fileUpload.onInsertFile(i).then(a=>{this.textarea.value=this.textarea.value.replace(s,a),this._trackInsertedUrls(a,i),this.textarea.dispatchEvent(new Event("input",{bubbles:!0}))},a=>{console.error("OverType: File upload failed",a),this.textarea.value=this.textarea.value.replace(s,"[Upload failed]()"),this.textarea.dispatchEvent(new Event("input",{bubbles:!0}))})}this.options.fileUpload.batch&&n.length>0&&this.options.fileUpload.onInsertFile(n.map(i=>i.file)).then(i=>{(Array.isArray(i)?i:[i]).forEach((o,s)=>{this.textarea.value=this.textarea.value.replace(n[s].placeholder,o),this._trackInsertedUrls(o,n[s].file)}),this.textarea.dispatchEvent(new Event("input",{bubbles:!0}))},i=>{console.error("OverType: File upload failed",i),n.forEach(({placeholder:r})=>{this.textarea.value=this.textarea.value.replace(r,"[Upload failed]()")}),this.textarea.dispatchEvent(new Event("input",{bubbles:!0}))})}_handleDragOver(t){t.preventDefault()}_destroyFileUpload(){this.textarea.removeEventListener("paste",this._boundHandleFilePaste),this.textarea.removeEventListener("drop",this._boundHandleFileDrop),this.textarea.removeEventListener("dragover",this._boundHandleDragOver),this._boundHandleFilePaste=null,this._boundHandleFileDrop=null,this._boundHandleDragOver=null,this._uploadedFiles=null,this.fileUploadInitialized=!1}_handleTaskClick(t){if(!this.options.clickToToggleTasks||t.button!==0||!this._canEditTextarea()||this.container.dataset.mode==="preview")return;let n=[...this.preview.querySelectorAll("li.task-list, div.raw-line")].filter(s=>s.matches("li.task-list")||/^ *-\s+\[[ xX]\](?:\s|$)/.test(s.textContent)),i=0,r=0,o=null;for(let s of this.textarea.value.split(`
`)){if(o){Ue(s,o)&&(o=null),r+=s.length+1;continue}if(o=ce(s),o){r+=s.length+1;continue}let a=/^( *-\s+\[)([ xX])\](?:\s|$)/.exec(s);if(!a||!T.parseLine(s).includes('<li class="task-list">')){r+=s.length+1;continue}let c=n[i++],l=c?.matches("li.task-list")?c.querySelector(":scope > .syntax-marker"):c,u=l?.firstChild;if(u?.nodeType===3){let p=u.textContent.indexOf("[")+1;if(!/^\[[ xX]\]$/.test(u.textContent.slice(p-1,p+2))){r+=s.length+1;continue}let h=document.createRange();if(h.setStart(u,p-1),h.setEnd(u,p+2),[...h.getClientRects()].some(f=>t.clientX>=f.left&&t.clientX<f.right&&t.clientY>=f.top&&t.clientY<f.bottom)){let f=this.textarea,m=f.selectionStart,v=f.selectionEnd,w=f.selectionDirection,y=r+a[1].length;f.focus(),f.setSelectionRange(y,y+1);let b=a[2]===" "?"x":" ",L=!1,x=()=>{L=!0};f.addEventListener("input",x);let S=!1;try{S=document.execCommand("insertText",!1,b)}catch{}finally{f.removeEventListener("input",x)}S||f.setRangeText(b,y,y+1,"preserve"),L||f.dispatchEvent(new Event("input",{bubbles:!0})),f.setSelectionRange(m,v,w);return}}r+=s.length+1}}insertAtCursor(t){let n=this.textarea.selectionStart,i=this.textarea.selectionEnd,r=!1;try{r=document.execCommand("insertText",!1,t)}catch{}if(!r){let o=this.textarea.value.slice(0,n),s=this.textarea.value.slice(i);this.textarea.value=o+t+s,this.textarea.setSelectionRange(n+t.length,n+t.length)}this.textarea.dispatchEvent(new Event("input",{bubbles:!0}))}updatePreview(){let t=this.textarea.value,n=this.textarea.selectionStart,i=this._getCurrentLine(t,n),r=this.container.dataset.mode==="preview",o=T.parse(t,i,this.options.showActiveLineRaw,this.options.codeHighlighter,r);this.preview.innerHTML=o,this.placeholderEl&&(this.placeholderEl.style.display=t?"none":""),this._applyCodeBlockBackgrounds(),this.options.showStats&&this.statsBar&&this._updateStats(),this.options.onRender&&this.options.onRender(this.preview,r?"preview":"normal",this)}_notifyChange(){this.initialized&&(this._checkForRemovedUploads(),this.options.onChange&&this.options.onChange(this.textarea.value,this))}_applyCodeBlockBackgrounds(){let t=this.preview.querySelectorAll(".code-fence");for(let n=0;n<t.length-1;n+=2){let i=t[n],r=t[n+1],o=i.parentElement,s=r.parentElement;!o||!s||(i.style.display="block",r.style.display="block",o.classList.add("code-block-line"),s.classList.add("code-block-line"))}}_getCurrentLine(t,n){return t.substring(0,n).split(`
`).length-1}handleInput(t){this.updatePreview(),this._notifyChange(),this._scheduleSafariReflow()}_scheduleSafariReflow(){!this._isSafari||this._safariReflowRaf||(this._safariReflowRaf=requestAnimationFrame(()=>{this._safariReflowRaf=null;let t=this.textarea;t&&(t.style.setProperty("letter-spacing","-0.001px","important"),t.offsetHeight,t.style.removeProperty("letter-spacing"))}))}handleFocus(t){this.options.onFocus&&this.options.onFocus(t,this)}handleBlur(t){this.options.onBlur&&this.options.onBlur(t,this)}handleKeydown(t){if(t.key==="Tab"){let i=this.textarea.selectionStart,r=this.textarea.selectionEnd;if(i!==r&&this._canEditTextarea()){t.preventDefault(),t.shiftKey?this.outdentSelection():this.indentSelection();return}}if(t.key==="Enter"&&!t.shiftKey&&!t.metaKey&&!t.ctrlKey&&this.options.smartLists&&this.handleSmartListContinuation()){t.preventDefault();return}!this.shortcuts.handleKeydown(t)&&this.options.onKeydown&&this.options.onKeydown(t,this)}handleSmartListContinuation(){let t=this.textarea,n=t.selectionStart,i=T.getListContext(t.value,n);return!i||!i.inList?!1:i.content.trim()===""&&n>=i.markerEndPos?(this.deleteListMarker(i),!0):(n>i.markerEndPos&&n<i.lineEnd?this.splitListItem(i,n):this.insertNewListItem(i),i.listType==="numbered"&&this.scheduleNumberedListUpdate(),!0)}deleteListMarker(t){this.textarea.setSelectionRange(t.lineStart,t.markerEndPos),document.execCommand("delete"),this.textarea.dispatchEvent(new Event("input",{bubbles:!0}))}insertNewListItem(t){let n=T.createNewListItem(t);document.execCommand("insertText",!1,`
`+n),this.textarea.dispatchEvent(new Event("input",{bubbles:!0}))}splitListItem(t,n){let i=t.content.substring(n-t.markerEndPos);this.textarea.setSelectionRange(n,t.lineEnd),document.execCommand("delete");let r=T.createNewListItem(t);document.execCommand("insertText",!1,`
`+r+i);let o=this.textarea.selectionStart-i.length;this.textarea.setSelectionRange(o,o),this.textarea.dispatchEvent(new Event("input",{bubbles:!0}))}scheduleNumberedListUpdate(){this.numberUpdateTimeout&&clearTimeout(this.numberUpdateTimeout),this.numberUpdateTimeout=setTimeout(()=>{this.updateNumberedLists()},10)}updateNumberedLists(){let t=this.textarea.value,n=this.textarea.selectionStart,i=T.renumberLists(t);if(i!==t){let r=0,o=t.split(`
`),s=i.split(`
`),a=0;for(let l=0;l<o.length&&a<n;l++){if(o[l]!==s[l]){let u=s[l].length-o[l].length;a+o[l].length<n&&(r+=u)}a+=o[l].length+1}this.textarea.value=i;let c=n+r;this.textarea.setSelectionRange(c,c),this.textarea.dispatchEvent(new Event("input",{bubbles:!0}))}}handleScroll(t){this.preview.scrollTop=this.textarea.scrollTop,this.preview.scrollLeft=this.textarea.scrollLeft}getValue(){return this.textarea.value}setValue(t){let n=this.textarea.value!==t;this.textarea.value=t,this.updatePreview(),this.options.autoResize&&this._updateAutoHeight(),n&&(this._notifyChange(),this._scheduleSafariReflow())}async performAction(t,n=null){var i;let r=this.textarea;if(!r)return!1;let o=(i=this.actionsById)==null?void 0:i[t];if(!o)return console.warn(`OverType: Unknown action "${t}"`),!1;r.focus();try{return await o({editor:this,getValue:()=>this.getValue(),setValue:s=>this.setValue(s),event:n}),!0}catch(s){return console.error(`OverType: Action "${t}" error:`,s),this.wrapper.dispatchEvent(new CustomEvent("button-error",{detail:{actionId:t,error:s}})),!1}}getRenderedHTML(t={}){let n=this.getValue(),i=T.parse(n,-1,!1,this.options.codeHighlighter);return t.cleanHTML&&(i=i.replace(/<span class="syntax-marker[^"]*">.*?<\/span>/g,""),i=i.replace(/\sclass="(bullet-list|ordered-list|code-fence|hr-marker|blockquote|url-part)"/g,""),i=i.replace(/\sclass=""/g,"")),i}getPreviewHTML(){return this.preview.innerHTML}indentSelection(){this._replaceSelectedLines(t=>`  ${t}`)}outdentSelection(){this._replaceSelectedLines(t=>t.replace(/^( {1,2}|\t)/,""))}_replaceSelectedLines(t){if(!this._canEditTextarea())return!1;let n=this.textarea,{selectionStart:i,selectionEnd:r,value:o}=n,s=o.lastIndexOf(`
`,i-1)+1,a=this._effectiveSelectionEnd(o,i,r),c=o.indexOf(`
`,a),l=c===-1?o.length:c,u=o.slice(s,l),p=u.split(`
`).map(t).join(`
`);if(p===u)return!1;n.setSelectionRange(s,l);let h=!1;try{h=document.execCommand("insertText",!1,p)}catch{}return h||n.setRangeText(p,s,l,"preserve"),n.setSelectionRange(s,s+p.length),n.dispatchEvent(new Event("input",{bubbles:!0})),!0}_effectiveSelectionEnd(t,n,i){return i>n&&t[i-1]===`
`?i-1:i}_canEditTextarea(){return this.textarea&&!this.textarea.disabled&&!this.textarea.readOnly}getCleanHTML(){return this.getRenderedHTML({cleanHTML:!0})}focus(){this.textarea.focus()}blur(){this.textarea.blur()}isInitialized(){return this.initialized}reinit(t={}){var n;let i=(n=this.options)==null?void 0:n.toolbarButtons;this.options=this._mergeOptions({...this.options,...t});let r=this.toolbar&&this.options.toolbar&&Ji(i,this.options.toolbarButtons);this._rebuildActionsMap(),r&&(this._cleanupToolbarListeners(),this.toolbar.destroy(),this.toolbar=null,this._createToolbar()),this.fileUploadInitialized&&this._destroyFileUpload(),this.options.fileUpload&&this._initFileUpload(),this._applyOptions(),this.updatePreview()}showToolbar(){this.toolbar?this.toolbar.show():this._createToolbar()}hideToolbar(){this.toolbar&&this.toolbar.hide()}setTheme(t){if(g._autoInstances.delete(this),this.instanceTheme=t,t==="auto")g._autoInstances.add(this),g._startAutoListener(),this._applyResolvedTheme(vt("auto"));else{let n=typeof t=="string"?K(t):t,i=typeof n=="string"?n:n.name;if(i&&this.container.setAttribute("data-theme",i),n&&n.colors){let r=le(n.colors,n.previewColors);this.container.style.cssText+=r}this.updatePreview()}return g._stopAutoListener(),this}_applyResolvedTheme(t){let n=K(t);this.container.setAttribute("data-theme",t),n&&n.colors&&(this.container.style.cssText=le(n.colors,n.previewColors)),this.updatePreview()}setCodeHighlighter(t){this.options.codeHighlighter=t,this.updatePreview()}_updateStats(){if(!this.statsBar)return;let t=this.textarea.value,n=t.split(`
`),i=t.length,r=t.split(/\s+/).filter(u=>u.length>0).length,o=this.textarea.selectionStart,a=t.substring(0,o).split(`
`),c=a.length,l=a[a.length-1].length+1;this.options.statsFormatter?this.statsBar.innerHTML=this.options.statsFormatter({chars:i,words:r,lines:n.length,line:c,column:l}):this.statsBar.innerHTML=`
          <div class="overtype-stat">
            <span class="live-dot"></span>
            <span>${i} chars, ${r} words, ${n.length} lines</span>
          </div>
          <div class="overtype-stat">Line ${c}, Col ${l}</div>
        `}_setupAutoResize(){this.container.classList.add("overtype-auto-resize"),this.previousHeight=null,this._updateAutoHeight(),this._autoResizeHandler||(this._autoResizeHandler=()=>this._updateAutoHeight(),this.textarea.addEventListener("input",this._autoResizeHandler),window.addEventListener("resize",this._autoResizeHandler))}_updateAutoHeight(){if(!this.options.autoResize)return;let t=this.textarea,n=this.preview,i=this.wrapper;if(this.container.dataset.mode==="preview"){i.style.removeProperty("height"),n.style.removeProperty("height"),n.style.removeProperty("overflow-y"),t.style.removeProperty("height"),t.style.removeProperty("overflow-y");return}let o=t.scrollTop;i.style.setProperty("height","auto","important"),t.style.setProperty("height","auto","important");let s=t.scrollHeight;if(this.options.minHeight){let l=parseInt(this.options.minHeight);s=Math.max(s,l)}let a="hidden";if(this.options.maxHeight){let l=parseInt(this.options.maxHeight);s>l&&(s=l,a="auto")}let c=s+"px";t.style.setProperty("height",c,"important"),t.style.setProperty("overflow-y",a,"important"),n.style.setProperty("height",c,"important"),n.style.setProperty("overflow-y",a,"important"),i.style.setProperty("height",c,"important"),t.scrollTop=o,n.scrollTop=o,this.previousHeight!==s&&(this.previousHeight=s)}showStats(t){this.options.showStats=t,t&&!this.statsBar?this._createStatsBar():t&&this.statsBar?this._updateStats():!t&&this.statsBar&&(this.statsBar.remove(),this.statsBar=null)}showNormalEditMode(){return this.container.dataset.mode="normal",this._syncPreviewInteractivity(),this.updatePreview(),this._updateAutoHeight(),requestAnimationFrame(()=>{this.textarea.scrollTop=this.preview.scrollTop,this.textarea.scrollLeft=this.preview.scrollLeft}),this}showPlainTextarea(){if(this.container.dataset.mode="plain",this._syncPreviewInteractivity(),this._updateAutoHeight(),this.toolbar){let t=this.container.querySelector('[data-action="toggle-plain"]');t&&(t.classList.remove("active"),t.title="Show markdown preview")}return this}showPreviewMode(){return this.container.dataset.mode="preview",this._syncPreviewInteractivity(),this.updatePreview(),this._updateAutoHeight(),this}destroy(){if(g._autoInstances.delete(this),g._stopAutoListener(),this.fileUploadInitialized&&this._destroyFileUpload(),this.element.overTypeInstance=null,g.instances.delete(this.element),this.shortcuts&&this.shortcuts.destroy(),this._safariReflowRaf&&(cancelAnimationFrame(this._safariReflowRaf),this._safariReflowRaf=null),this.linkTooltip&&(this.linkTooltip.destroy(),this.linkTooltip=null),this.toolbar&&(this._cleanupToolbarListeners(),this.toolbar.destroy(),this.toolbar=null),this._autoResizeHandler&&(this.textarea.removeEventListener("input",this._autoResizeHandler),window.removeEventListener("resize",this._autoResizeHandler),this._autoResizeHandler=null),this.wrapper)if(this.options.persist)[this.preview,this.placeholderEl,this.statsBar].forEach(t=>t?.remove()),this.statsBar=null,this.wrapper._instance=null;else{let t=this.getValue();this.wrapper.remove(),this.element.textContent=t}this.initialized=!1}static init(t,n={}){return new g(t,n)}static initFromData(t,n={}){return g._resolveTargets(t).map(r=>{let o={...n};for(let s of r.attributes){if(!s.name.startsWith("data-ot-"))continue;let a=s.name.slice(8);if(a.startsWith("textarea-")&&a!=="textarea-props"){let l=a.slice(9).replace(/-([a-z])/g,(u,p)=>p.toUpperCase());o.textareaProps={...o.textareaProps||{},[l]:g._parseDataValue(s.value)};continue}let c=a.replace(/-([a-z])/g,(l,u)=>u.toUpperCase());o[c]=g._parseDataValue(s.value)}return new g(r,o)[0]})}static _resolveTargets(t){if(t==null)throw new Error("Invalid target: must be selector string, Element, NodeList, or Array");if(typeof t=="string")return Array.from(document.querySelectorAll(t));if(t instanceof Element)return[t];if(t instanceof NodeList)return Array.from(t);if(Array.isArray(t))return t;if(typeof t.length=="number")return Array.from(t);throw new Error("Invalid target: must be selector string, Element, NodeList, or Array")}static _parseDataValue(t){if(t==="true")return!0;if(t==="false")return!1;if(t==="null")return null;if(t!==""&&!isNaN(Number(t)))return Number(t);let n=t.trim();if(n[0]==="{"||n[0]==="[")try{return JSON.parse(n)}catch{return t}return t}static getInstance(t){let n;return t instanceof Element?n=t:n=g._resolveTargets(t)[0],n&&(n.overTypeInstance||g.instances.get(n))||null}static destroyAll(){document.querySelectorAll("[data-overtype-instance]").forEach(n=>{let i=g.getInstance(n);i&&i.destroy()})}static injectStyles(t=!1){if(g.stylesInjected&&!t)return;let n=document.querySelector("style.overtype-styles");n&&n.remove();let i=g.currentTheme||j,r=_n({theme:i}),o=document.createElement("style");o.className="overtype-styles",g.stylesChrome&&o.setAttribute("clay","editor-ui"),o.textContent=r,document.head.appendChild(o),g.stylesInjected=!0}static setTheme(t,n=null){if(g._globalAutoTheme=!1,g._globalAutoCustomColors=null,t==="auto"){g._globalAutoTheme=!0,g._globalAutoCustomColors=n,g._startAutoListener(),g._applyGlobalTheme(vt("auto"),n);return}g._stopAutoListener(),g._applyGlobalTheme(t,n)}static _applyGlobalTheme(t,n=null){let i=typeof t=="string"?K(t):t;n&&(i=An(i,n)),g.currentTheme=i,g.injectStyles(!0);let r=typeof i=="string"?i:i.name;document.querySelectorAll(".overtype-container").forEach(o=>{let s=o.querySelector(".overtype-wrapper");r&&s&&s._instance&&o.setAttribute("data-theme",r)}),document.querySelectorAll(".overtype-wrapper").forEach(o=>{o.closest(".overtype-container")||r&&o.setAttribute("data-theme",r);let s=o._instance;s&&s.updatePreview()}),document.querySelectorAll("overtype-editor").forEach(o=>{r&&typeof o.setAttribute=="function"&&o.setAttribute("theme",r),typeof o.refreshTheme=="function"&&o.refreshTheme()})}static _startAutoListener(){g._autoMediaQuery||window.matchMedia&&(g._autoMediaQuery=window.matchMedia("(prefers-color-scheme: dark)"),g._autoMediaListener=t=>{let n=t.matches?"cave":"solar";g._globalAutoTheme&&g._applyGlobalTheme(n,g._globalAutoCustomColors),g._autoInstances.forEach(i=>i._applyResolvedTheme(n))},g._autoMediaQuery.addEventListener("change",g._autoMediaListener))}static _stopAutoListener(){g._autoInstances.size>0||g._globalAutoTheme||g._autoMediaQuery&&(g._autoMediaQuery.removeEventListener("change",g._autoMediaListener),g._autoMediaQuery=null,g._autoMediaListener=null)}static setCodeHighlighter(t){T.setCodeHighlighter(t),document.querySelectorAll(".overtype-wrapper").forEach(n=>{let i=n._instance;i&&i.updatePreview&&i.updatePreview()}),document.querySelectorAll("overtype-editor").forEach(n=>{if(typeof n.getEditor=="function"){let i=n.getEditor();i&&i.updatePreview&&i.updatePreview()}})}static setCustomSyntax(t){T.setCustomSyntax(t),document.querySelectorAll(".overtype-wrapper").forEach(n=>{let i=n._instance;i&&i.updatePreview&&i.updatePreview()}),document.querySelectorAll("overtype-editor").forEach(n=>{if(typeof n.getEditor=="function"){let i=n.getEditor();i&&i.updatePreview&&i.updatePreview()}})}static initGlobalListeners(){let t=typeof window<"u"?window:globalThis,n="__overtypeGlobalListenersInitialized";if(g.globalListenersInitialized||t[n]){g.globalListenersInitialized=!0;return}t[n]=!0,document.addEventListener("input",i=>{if(i.target&&i.target.classList&&i.target.classList.contains("overtype-input")){let r=i.target.closest(".overtype-wrapper"),o=r?._instance;o&&o.handleInput(i)}}),document.addEventListener("keydown",i=>{if(i.target&&i.target.classList&&i.target.classList.contains("overtype-input")){let r=i.target.closest(".overtype-wrapper"),o=r?._instance;o&&o.handleKeydown(i)}}),document.addEventListener("click",i=>{if(i.target&&i.target.classList&&i.target.classList.contains("overtype-input")){let r=i.target.closest(".overtype-wrapper"),o=r?._instance;o&&o._handleTaskClick(i)}}),document.addEventListener("focus",i=>{if(i.target&&i.target.classList&&i.target.classList.contains("overtype-input")){let r=i.target.closest(".overtype-wrapper"),o=r?._instance;o&&o.handleFocus(i)}},!0),document.addEventListener("blur",i=>{if(i.target&&i.target.classList&&i.target.classList.contains("overtype-input")){let r=i.target.closest(".overtype-wrapper"),o=r?._instance;o&&o.handleBlur(i)}},!0),document.addEventListener("scroll",i=>{if(i.target&&i.target.classList&&i.target.classList.contains("overtype-input")){let r=i.target.closest(".overtype-wrapper"),o=r?._instance;o&&o.handleScroll(i)}},!0),document.addEventListener("selectionchange",i=>{let r=document.activeElement;if(r&&r.classList.contains("overtype-input")){let o=r.closest(".overtype-wrapper"),s=o?._instance;s&&(s.options.showStats&&s.statsBar&&s._updateStats(),clearTimeout(s._selectionTimeout),s._selectionTimeout=setTimeout(()=>{s.updatePreview()},50))}}),g.globalListenersInitialized=!0}};C($,"instances",new WeakMap);C($,"stylesInjected",!1);C($,"stylesChrome",!1);C($,"globalListenersInitialized",!1);C($,"instanceCount",0);C($,"_autoMediaQuery",null);C($,"_autoMediaListener",null);C($,"_autoInstances",new Set);C($,"_globalAutoTheme",!1);C($,"_globalAutoCustomColors",null);var ie=$;ie.MarkdownParser=T;ie.ShortcutsManager=Ot;ie.themes={solar:j,cave:K("cave")};ie.getTheme=K;ie.currentTheme=j;var Qi=ie;export{Qi as default,E as toolbarButtons};
