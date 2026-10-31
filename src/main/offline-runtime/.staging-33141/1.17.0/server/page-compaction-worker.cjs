// src/server/rooms/page-compaction-worker.js
var import_node_worker_threads = require("node:worker_threads");

// src/vendor/yjs.vendor.js
var Gi = Object.defineProperty;
var zi = (e19, t, n) => t in e19 ? Gi(e19, t, { enumerable: true, configurable: true, writable: true, value: n }) : e19[t] = n;
var Ge = (e19, t, n) => zi(e19, typeof t != "symbol" ? t + "" : t, n);
var A = () => /* @__PURE__ */ new Map();
var ze = (e19) => {
  let t = A();
  return e19.forEach((n, r) => {
    t.set(r, n);
  }), t;
};
var L = (e19, t, n) => {
  let r = e19.get(t);
  return r === void 0 && e19.set(t, r = n()), r;
};
var Kr = (e19, t) => {
  let n = [];
  for (let [r, s] of e19) n.push(t(s, r));
  return n;
};
var Yr = (e19, t) => {
  for (let [n, r] of e19) if (t(r, n)) return true;
  return false;
};
var rt = () => /* @__PURE__ */ new Set();
var He = (e19) => e19[e19.length - 1];
var Wr = (e19, t) => {
  for (let n = 0; n < t.length; n++) e19.push(t[n]);
};
var Y = Array.from;
var Je = (e19, t) => {
  for (let n = 0; n < e19.length; n++) if (!t(e19[n], n, e19)) return false;
  return true;
};
var de = (e19, t) => {
  for (let n = 0; n < e19.length; n++) if (t(e19[n], n, e19)) return true;
  return false;
};
var Zr = (e19, t) => {
  let n = new Array(e19);
  for (let r = 0; r < e19; r++) n[r] = t(r, n);
  return n;
};
var st = Array.isArray;
var Dt = class {
  constructor() {
    this._observers = A();
  }
  on(t, n) {
    return L(this._observers, t, rt).add(n), n;
  }
  once(t, n) {
    let r = (...s) => {
      this.off(t, r), n(...s);
    };
    this.on(t, r);
  }
  off(t, n) {
    let r = this._observers.get(t);
    r !== void 0 && (r.delete(n), r.size === 0 && this._observers.delete(t));
  }
  emit(t, n) {
    return Y((this._observers.get(t) || A()).values()).forEach((r) => r(...n));
  }
  destroy() {
    this._observers = A();
  }
};
var B = Math.floor;
var yt = Math.abs;
var Xe = (e19, t) => e19 < t ? e19 : t;
var it = (e19, t) => e19 > t ? e19 : t;
var Ol = Number.isNaN;
var Pe = (e19) => e19 !== 0 ? e19 < 0 : 1 / e19 < 0;
var Tt = Number.MAX_SAFE_INTEGER;
var Fn = Number.MIN_SAFE_INTEGER;
var Nl = 1 << 31;
var Qr = Number.isInteger || ((e19) => typeof e19 == "number" && isFinite(e19) && B(e19) === e19);
var Ll = Number.isNaN;
var Bl = Number.parseInt;
var ge = String.fromCharCode;
var Hi = String.fromCodePoint;
var Ml = ge(65535);
var Ji = (e19) => e19.toLowerCase();
var Xi = /^\s*/g;
var Pi = (e19) => e19.replace(Xi, "");
var Ki = /([A-Z])/g;
var qn = (e19, t) => Pi(e19.replace(Ki, (n) => `${t}${Ji(n)}`));
var Yi = (e19) => {
  let t = unescape(encodeURIComponent(e19)), n = t.length, r = new Uint8Array(n);
  for (let s = 0; s < n; s++) r[s] = t.codePointAt(s);
  return r;
};
var Vt = typeof TextEncoder < "u" ? new TextEncoder() : null;
var Wi = (e19) => Vt.encode(e19);
var ts = Vt ? Wi : Yi;
var vt = typeof TextDecoder > "u" ? null : new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
vt && vt.decode(new Uint8Array()).length === 1 && (vt = null);
var Ke = (e19, t) => Zr(t, () => e19).join("");
var xt = class {
  constructor() {
    this.cpos = 0, this.cbuf = new Uint8Array(100), this.bufs = [];
  }
};
var kt = () => new xt();
var Zi = (e19) => {
  let t = e19.cpos;
  for (let n = 0; n < e19.bufs.length; n++) t += e19.bufs[n].length;
  return t;
};
var q = (e19) => {
  let t = new Uint8Array(Zi(e19)), n = 0;
  for (let r = 0; r < e19.bufs.length; r++) {
    let s = e19.bufs[r];
    t.set(s, n), n += s.length;
  }
  return t.set(new Uint8Array(e19.cbuf.buffer, 0, e19.cpos), n), t;
};
var Qi = (e19, t) => {
  let n = e19.cbuf.length;
  n - e19.cpos < t && (e19.bufs.push(new Uint8Array(e19.cbuf.buffer, 0, e19.cpos)), e19.cbuf = new Uint8Array(it(n, t) * 2), e19.cpos = 0);
};
var D = (e19, t) => {
  let n = e19.cbuf.length;
  e19.cpos === n && (e19.bufs.push(e19.cbuf), e19.cbuf = new Uint8Array(n * 2), e19.cpos = 0), e19.cbuf[e19.cpos++] = t;
};
var Mt = D;
var g = (e19, t) => {
  for (; t > 127; ) D(e19, 128 | 127 & t), t = B(t / 128);
  D(e19, 127 & t);
};
var we = (e19, t) => {
  let n = Pe(t);
  for (n && (t = -t), D(e19, (t > 63 ? 128 : 0) | (n ? 64 : 0) | 63 & t), t = B(t / 64); t > 0; ) D(e19, (t > 127 ? 128 : 0) | 127 & t), t = B(t / 128);
};
var Gn = new Uint8Array(3e4);
var to = Gn.length / 3;
var eo = (e19, t) => {
  if (t.length < to) {
    let n = Vt.encodeInto(t, Gn).written || 0;
    g(e19, n);
    for (let r = 0; r < n; r++) D(e19, Gn[r]);
  } else $(e19, ts(t));
};
var no = (e19, t) => {
  let n = unescape(encodeURIComponent(t)), r = n.length;
  g(e19, r);
  for (let s = 0; s < r; s++) D(e19, n.codePointAt(s));
};
var lt = Vt && Vt.encodeInto ? eo : no;
var Rt = (e19, t) => {
  let n = e19.cbuf.length, r = e19.cpos, s = Xe(n - r, t.length), i = t.length - s;
  e19.cbuf.set(t.subarray(0, s), r), e19.cpos += s, i > 0 && (e19.bufs.push(e19.cbuf), e19.cbuf = new Uint8Array(it(n * 2, i)), e19.cbuf.set(t.subarray(s)), e19.cpos = i);
};
var $ = (e19, t) => {
  g(e19, t.byteLength), Rt(e19, t);
};
var zn = (e19, t) => {
  Qi(e19, t);
  let n = new DataView(e19.cbuf.buffer, e19.cpos, t);
  return e19.cpos += t, n;
};
var ro = (e19, t) => zn(e19, 4).setFloat32(0, t, false);
var so = (e19, t) => zn(e19, 8).setFloat64(0, t, false);
var io = (e19, t) => zn(e19, 8).setBigInt64(0, t, false);
var ns = new DataView(new ArrayBuffer(4));
var oo = (e19) => (ns.setFloat32(0, e19), ns.getFloat32(0) === e19);
var Lt = (e19, t) => {
  switch (typeof t) {
    case "string":
      D(e19, 119), lt(e19, t);
      break;
    case "number":
      Qr(t) && yt(t) <= 2147483647 ? (D(e19, 125), we(e19, t)) : oo(t) ? (D(e19, 124), ro(e19, t)) : (D(e19, 123), so(e19, t));
      break;
    case "bigint":
      D(e19, 122), io(e19, t);
      break;
    case "object":
      if (t === null) D(e19, 126);
      else if (st(t)) {
        D(e19, 117), g(e19, t.length);
        for (let n = 0; n < t.length; n++) Lt(e19, t[n]);
      } else if (t instanceof Uint8Array) D(e19, 116), $(e19, t);
      else {
        D(e19, 118);
        let n = Object.keys(t);
        g(e19, n.length);
        for (let r = 0; r < n.length; r++) {
          let s = n[r];
          lt(e19, s), Lt(e19, t[s]);
        }
      }
      break;
    case "boolean":
      D(e19, t ? 120 : 121);
      break;
    default:
      D(e19, 127);
  }
};
var me = class extends xt {
  constructor(t) {
    super(), this.w = t, this.s = null, this.count = 0;
  }
  write(t) {
    this.s === t ? this.count++ : (this.count > 0 && g(this, this.count - 1), this.count = 1, this.w(this, t), this.s = t);
  }
};
var rs = (e19) => {
  e19.count > 0 && (we(e19.encoder, e19.count === 1 ? e19.s : -e19.s), e19.count > 1 && g(e19.encoder, e19.count - 2));
};
var bt = class {
  constructor() {
    this.encoder = new xt(), this.s = 0, this.count = 0;
  }
  write(t) {
    this.s === t ? this.count++ : (rs(this), this.count = 1, this.s = t);
  }
  toUint8Array() {
    return rs(this), q(this.encoder);
  }
};
var ss = (e19) => {
  if (e19.count > 0) {
    let t = e19.diff * 2 + (e19.count === 1 ? 0 : 1);
    we(e19.encoder, t), e19.count > 1 && g(e19.encoder, e19.count - 2);
  }
};
var Bt = class {
  constructor() {
    this.encoder = new xt(), this.s = 0, this.count = 0, this.diff = 0;
  }
  write(t) {
    this.diff === t - this.s ? (this.s = t, this.count++) : (ss(this), this.count = 1, this.diff = t - this.s, this.s = t);
  }
  toUint8Array() {
    return ss(this), q(this.encoder);
  }
};
var Ye = class {
  constructor() {
    this.sarr = [], this.s = "", this.lensE = new bt();
  }
  write(t) {
    this.s += t, this.s.length > 19 && (this.sarr.push(this.s), this.s = ""), this.lensE.write(t.length);
  }
  toUint8Array() {
    let t = new xt();
    return this.sarr.push(this.s), this.s = "", lt(t, this.sarr.join("")), Rt(t, this.lensE.toUint8Array()), q(t);
  }
};
var G = (e19) => new Error(e19);
var z = () => {
  throw G("Method unimplemented");
};
var T = () => {
  throw G("Unexpected case");
};
var Ze = G("Unexpected end of array");
var os = G("Integer out of Range");
var lo = (e19, t, n) => {
  if (t < 0 || n < 0 || t + n > e19.length) throw Ze;
  return new Uint8Array(e19.buffer, e19.byteOffset + t, n);
};
var ao = (e19, t, n) => {
  if (t < 0 || n < 0 || t + n > e19.length) throw Ze;
  return new DataView(e19.buffer, e19.byteOffset + t, n);
};
var $t = class {
  constructor(t) {
    this.arr = t, this.pos = 0;
  }
};
var V = (e19) => new $t(e19);
var Jn = (e19) => e19.pos !== e19.arr.length;
var ho = (e19, t) => {
  let n = lo(e19.arr, e19.pos, t);
  return e19.pos += t, n;
};
var F = (e19) => ho(e19, w(e19));
var St = (e19) => e19.arr[e19.pos++];
var w = (e19) => {
  let t = 0, n = 1, r = e19.arr.length;
  for (; e19.pos < r; ) {
    let s = e19.arr[e19.pos++];
    if (t = t + (s & 127) * n, n *= 128, s < 128) return t;
    if (t > Tt) throw os;
  }
  throw Ze;
};
var xe = (e19) => {
  let t = e19.arr[e19.pos++], n = t & 63, r = 64, s = (t & 64) > 0 ? -1 : 1;
  if ((t & 128) === 0) return s * n;
  let i = e19.arr.length;
  for (; e19.pos < i; ) {
    if (t = e19.arr[e19.pos++], n = n + (t & 127) * r, r *= 128, t < 128) return s * n;
    if (n > Tt) throw os;
  }
  throw Ze;
};
var uo = (e19) => {
  let t = w(e19);
  if (t === 0) return "";
  {
    let n = String.fromCodePoint(St(e19));
    if (--t < 100) for (; t--; ) n += String.fromCodePoint(St(e19));
    else for (; t > 0; ) {
      let r = t < 1e4 ? t : 1e4, s = e19.arr.subarray(e19.pos, e19.pos + r);
      e19.pos += r, n += String.fromCodePoint.apply(null, s), t -= r;
    }
    return decodeURIComponent(escape(n));
  }
};
var fo = (e19) => vt.decode(F(e19));
var ht = vt ? fo : uo;
var Xn = (e19, t) => {
  let n = ao(e19.arr, e19.pos, t);
  return e19.pos += t, n;
};
var po = (e19) => Xn(e19, 4).getFloat32(0, false);
var go = (e19) => Xn(e19, 8).getFloat64(0, false);
var mo = (e19) => Xn(e19, 8).getBigInt64(0, false);
var wo = [(e19) => {
}, (e19) => null, xe, po, go, mo, (e19) => false, (e19) => true, ht, (e19) => {
  let t = w(e19), n = {};
  for (let r = 0; r < t; r++) {
    let s = ht(e19);
    n[s] = Ft(e19);
  }
  return n;
}, (e19) => {
  let t = w(e19), n = [];
  for (let r = 0; r < t; r++) n.push(Ft(e19));
  return n;
}, F];
var Ft = (e19) => wo[127 - St(e19)](e19);
var ye = class extends $t {
  constructor(t, n) {
    super(t), this.reader = n, this.s = null, this.count = 0;
  }
  read() {
    return this.count === 0 && (this.s = this.reader(this), Jn(this) ? this.count = w(this) + 1 : this.count = -1), this.count--, this.s;
  }
};
var _t = class extends $t {
  constructor(t) {
    super(t), this.s = 0, this.count = 0;
  }
  read() {
    if (this.count === 0) {
      this.s = xe(this);
      let t = Pe(this.s);
      this.count = 1, t && (this.s = -this.s, this.count = w(this) + 2);
    }
    return this.count--, this.s;
  }
};
var jt = class extends $t {
  constructor(t) {
    super(t), this.s = 0, this.count = 0, this.diff = 0;
  }
  read() {
    if (this.count === 0) {
      let t = xe(this), n = t & 1;
      this.diff = B(t / 2), this.count = 1, n && (this.count = w(this) + 2);
    }
    return this.s += this.diff, this.count--, this.s;
  }
};
var We = class {
  constructor(t) {
    this.decoder = new _t(t), this.str = ht(this.decoder), this.spos = 0;
  }
  read() {
    let t = this.spos + this.decoder.read(), n = this.str.slice(this.spos, t);
    return this.spos = t, n;
  }
};
var Fl = crypto.subtle;
var cs = crypto.getRandomValues.bind(crypto);
var Pn = () => cs(new Uint32Array(1))[0];
var xo = "10000000-1000-4000-8000" + -1e11;
var ls = () => xo.replace(/[018]/g, (e19) => (e19 ^ Pn() & 15 >> e19 / 4).toString(16));
var Qe = Date.now;
var Kn = (e19) => new Promise(e19);
var Gl = Promise.all.bind(Promise);
var Yn = (e19) => e19 === void 0 ? null : e19;
var Wn = class {
  constructor() {
    this.map = /* @__PURE__ */ new Map();
  }
  setItem(t, n) {
    this.map.set(t, n);
  }
  getItem(t) {
    return this.map.get(t);
  }
};
var hs = new Wn();
var _o = true;
try {
  typeof localStorage < "u" && localStorage && (hs = localStorage, _o = false);
} catch {
}
var us = hs;
var Et = /* @__PURE__ */ Symbol("Equality");
var tn = (e19, t) => e19 === t || !!e19?.[Et]?.(t) || false;
var ds = (e19) => typeof e19 == "object";
var fs = Object.assign;
var Uo = Object.keys;
var ps = (e19, t) => {
  for (let n in e19) t(e19[n], n);
};
var be = (e19) => Uo(e19).length;
var gs = (e19) => {
  for (let t in e19) return false;
  return true;
};
var qt = (e19, t) => {
  for (let n in e19) if (!t(e19[n], n)) return false;
  return true;
};
var ke = (e19, t) => Object.prototype.hasOwnProperty.call(e19, t);
var Qn = (e19, t) => e19 === t || be(e19) === be(t) && qt(e19, (n, r) => (n !== void 0 || ke(t, r)) && tn(t[r], n));
var Co = Object.freeze;
var tr = (e19) => {
  for (let t in e19) {
    let n = e19[t];
    (typeof n == "object" || typeof n == "function") && tr(e19[t]);
  }
  return Co(e19);
};
var _e = (e19, t, n = 0) => {
  try {
    for (; n < e19.length; n++) e19[n](...t);
  } finally {
    n < e19.length && _e(e19, t, n + 1);
  }
};
var nr = (e19) => e19;
var Se = (e19, t) => {
  if (e19 === t) return true;
  if (e19 == null || t == null || e19.constructor !== t.constructor && (e19.constructor || Object) !== (t.constructor || Object)) return false;
  if (e19[Et] != null) return e19[Et](t);
  switch (e19.constructor) {
    case ArrayBuffer:
      e19 = new Uint8Array(e19), t = new Uint8Array(t);
    case Uint8Array: {
      if (e19.byteLength !== t.byteLength) return false;
      for (let n = 0; n < e19.length; n++) if (e19[n] !== t[n]) return false;
      break;
    }
    case Set: {
      if (e19.size !== t.size) return false;
      for (let n of e19) if (!t.has(n)) return false;
      break;
    }
    case Map: {
      if (e19.size !== t.size) return false;
      for (let n of e19.keys()) if (!t.has(n) || !Se(e19.get(n), t.get(n))) return false;
      break;
    }
    case void 0:
    case Object:
      if (be(e19) !== be(t)) return false;
      for (let n in e19) if (!ke(e19, n) || !Se(e19[n], t[n])) return false;
      break;
    case Array:
      if (e19.length !== t.length) return false;
      for (let n = 0; n < e19.length; n++) if (!Se(e19[n], t[n])) return false;
      break;
    default:
      return false;
  }
  return true;
};
var ms = (e19, t) => t.includes(e19);
var Gt = typeof process < "u" && process.release && /node|io\.js/.test(process.release.name) && Object.prototype.toString.call(typeof process < "u" ? process : 0) === "[object process]";
var en = typeof window < "u" && typeof document < "u" && !Gt;
var zl = typeof navigator < "u" ? /Mac/.test(navigator.platform) : false;
var W;
var Ao = [];
var Io = () => {
  if (W === void 0) if (Gt) {
    W = A();
    let e19 = process.argv, t = null;
    for (let n = 0; n < e19.length; n++) {
      let r = e19[n];
      r[0] === "-" ? (t !== null && W.set(t, ""), t = r) : t !== null ? (W.set(t, r), t = null) : Ao.push(r);
    }
    t !== null && W.set(t, "");
  } else typeof location == "object" ? (W = A(), (location.search || "?").slice(1).split("&").forEach((e19) => {
    if (e19.length !== 0) {
      let [t, n] = e19.split("=");
      W.set(`--${qn(t, "-")}`, n), W.set(`-${qn(t, "-")}`, n);
    }
  })) : W = A();
  return W;
};
var sr = (e19) => Io().has(e19);
var Ee = (e19) => Gt ? Yn(process.env[e19.toUpperCase().replaceAll("-", "_")]) : Yn(us.getItem(e19));
var ws = (e19) => sr("--" + e19) || Ee(e19) !== null;
var ys = ws("production");
var Do = Gt && ms(process.env.FORCE_COLOR, ["true", "1", "2"]);
var xs = Do || !sr("--no-colors") && !ws("no-color") && (!Gt || process.stdout.isTTY) && (!Gt || sr("--color") || Ee("COLORTERM") !== null || (Ee("TERM") || "").includes("color"));
var bs = (e19) => new Uint8Array(e19);
var To = (e19) => {
  let t = "";
  for (let n = 0; n < e19.byteLength; n++) t += ge(e19[n]);
  return btoa(t);
};
var vo = (e19) => Buffer.from(e19.buffer, e19.byteOffset, e19.byteLength).toString("base64");
var Vo = (e19) => {
  let t = atob(e19), n = bs(t.length);
  for (let r = 0; r < t.length; r++) n[r] = t.charCodeAt(r);
  return n;
};
var Oo = (e19) => new Uint8Array(Buffer.from(e19, "base64"));
var No = en ? To : vo;
var Lo = en ? Vo : Oo;
var ks = (e19) => {
  let t = bs(e19.byteLength);
  return t.set(e19), t;
};
var ir = class {
  constructor(t, n) {
    this.left = t, this.right = n;
  }
};
var Z = (e19, t) => new ir(e19, t);
var or = (e19) => e19.next() >= 0.5;
var rn = (e19, t, n) => B(e19.next() * (n + 1 - t) + t);
var cr = (e19, t, n) => B(e19.next() * (n + 1 - t) + t);
var lr = (e19, t, n) => cr(e19, t, n);
var Ro = (e19) => ge(lr(e19, 97, 122));
var Ss = (e19, t = 0, n = 20) => {
  let r = lr(e19, t, n), s = "";
  for (let i = 0; i < r; i++) s += Ro(e19);
  return s;
};
var sn = (e19, t) => t[lr(e19, 0, t.length - 1)];
var Fo = /* @__PURE__ */ Symbol("0schema");
var ar = class {
  constructor() {
    this._rerrs = [];
  }
  extend(t, n, r, s = null) {
    this._rerrs.push({ path: t, expected: n, has: r, message: s });
  }
  toString() {
    let t = [];
    for (let n = this._rerrs.length - 1; n > 0; n--) {
      let r = this._rerrs[n];
      t.push(Ke(" ", (this._rerrs.length - n) * 2) + `${r.path != null ? `[${r.path}] ` : ""}${r.has} doesn't match ${r.expected}. ${r.message}`);
    }
    return t.join(`
`);
  }
};
var hr = (e19, t) => e19 === t ? true : e19 == null || t == null || e19.constructor !== t.constructor ? false : e19[Et] ? tn(e19, t) : st(e19) ? Je(e19, (n) => de(t, (r) => hr(n, r))) : ds(e19) ? qt(e19, (n, r) => hr(n, t[r])) : false;
var v = class {
  extends(t) {
    let [n, r] = [this.shape, t.shape];
    return this.constructor._dilutes && ([r, n] = [n, r]), hr(n, r);
  }
  equals(t) {
    return this.constructor === t.constructor && Se(this.shape, t.shape);
  }
  [Fo]() {
    return true;
  }
  [Et](t) {
    return this.equals(t);
  }
  validate(t) {
    return this.check(t);
  }
  check(t, n) {
    z();
  }
  get nullable() {
    return Kt(this, yn);
  }
  get optional() {
    return new on(this);
  }
  cast(t) {
    return _s(t, this), t;
  }
  expect(t) {
    return _s(t, this), t;
  }
};
Ge(v, "_dilutes", false);
var Ue = class extends v {
  constructor(t, n) {
    super(), this.shape = t, this._c = n;
  }
  check(t, n = void 0) {
    let r = t?.constructor === this.shape && (this._c == null || this._c(t));
    return !r && n?.extend(null, this.shape.name, t?.constructor.name, t?.constructor !== this.shape ? "Constructor match failed" : "Check failed"), r;
  }
};
var E = (e19, t = null) => new Ue(e19, t);
var Jl = E(Ue);
var Ce = class extends v {
  constructor(t) {
    super(), this.shape = t;
  }
  check(t, n) {
    let r = this.shape(t);
    return !r && n?.extend(null, "custom prop", t?.constructor.name, "failed to check custom prop"), r;
  }
};
var I = (e19) => new Ce(e19);
var Xl = E(Ce);
var Xt = class extends v {
  constructor(t) {
    super(), this.shape = t;
  }
  check(t, n) {
    let r = this.shape.some((s) => s === t);
    return !r && n?.extend(null, this.shape.join(" | "), t.toString()), r;
  }
};
var mn = (...e19) => new Xt(e19);
var Es = E(Xt);
var jo = RegExp.escape || ((e19) => e19.replace(/[().|&,$^[\]]/g, (t) => "\\" + t));
var Us = (e19) => {
  if (Pt.check(e19)) return [jo(e19)];
  if (Es.check(e19)) return e19.shape.map((t) => t + "");
  if (Ts.check(e19)) return ["[+-]?\\d+.?\\d*"];
  if (vs.check(e19)) return [".*"];
  if (fn.check(e19)) return e19.shape.map(Us).flat(1);
  T();
};
var ur = class extends v {
  constructor(t) {
    super(), this.shape = t, this._r = new RegExp("^" + t.map(Us).map((n) => `(${n.join("|")})`).join("") + "$");
  }
  check(t, n) {
    let r = this._r.exec(t) != null;
    return !r && n?.extend(null, this._r.toString(), t.toString(), "String doesn't match string template."), r;
  }
};
var Pl = E(ur);
var qo = /* @__PURE__ */ Symbol("optional");
var on = class extends v {
  constructor(t) {
    super(), this.shape = t;
  }
  check(t, n) {
    let r = t === void 0 || this.shape.check(t);
    return !r && n?.extend(null, "undefined (optional)", "()"), r;
  }
  get [qo]() {
    return true;
  }
};
var Go = E(on);
var cn = class extends v {
  check(t, n) {
    return n?.extend(null, "never", typeof t), false;
  }
};
var Kl = new cn();
var Yl = E(cn);
var gn = class gn2 extends v {
  constructor(t, n = false) {
    super(), this.shape = t, this._isPartial = n;
  }
  get partial() {
    return new gn2(this.shape, true);
  }
  check(t, n) {
    return t == null ? (n?.extend(null, "object", "null"), false) : qt(this.shape, (r, s) => {
      let i = this._isPartial && !ke(t, s) || r.check(t[s], n);
      return !i && n?.extend(s.toString(), r.toString(), typeof t[s], "Object property does not match"), i;
    });
  }
};
Ge(gn, "_dilutes", true);
var ln = gn;
var zo = (e19) => new ln(e19);
var Ho = E(ln);
var Jo = I((e19) => e19 != null && (e19.constructor === Object || e19.constructor == null));
var an = class extends v {
  constructor(t, n) {
    super(), this.shape = { keys: t, values: n };
  }
  check(t, n) {
    return t != null && qt(t, (r, s) => {
      let i = this.shape.keys.check(s, n);
      return !i && n?.extend(s + "", "Record", typeof t, i ? "Key doesn't match schema" : "Value doesn't match value"), i && this.shape.values.check(r, n);
    });
  }
};
var Cs = (e19, t) => new an(e19, t);
var Xo = E(an);
var hn = class extends v {
  constructor(t) {
    super(), this.shape = t;
  }
  check(t, n) {
    return t != null && qt(this.shape, (r, s) => {
      let i = r.check(t[s], n);
      return !i && n?.extend(s.toString(), "Tuple", typeof r), i;
    });
  }
};
var Po = (...e19) => new hn(e19);
var Wl = E(hn);
var un = class extends v {
  constructor(t) {
    super(), this.shape = t.length === 1 ? t[0] : new Ht(t);
  }
  check(t, n) {
    let r = st(t) && Je(t, (s) => this.shape.check(s));
    return !r && n?.extend(null, "Array", ""), r;
  }
};
var As = (...e19) => new un(e19);
var Ko = E(un);
var Yo = I((e19) => st(e19));
var dn = class extends v {
  constructor(t, n) {
    super(), this.shape = t, this._c = n;
  }
  check(t, n) {
    let r = t instanceof this.shape && (this._c == null || this._c(t));
    return !r && n?.extend(null, this.shape.name, t?.constructor.name), r;
  }
};
var Wo = (e19, t = null) => new dn(e19, t);
var Zl = E(dn);
var Zo = Wo(v);
var dr = class extends v {
  constructor(t) {
    super(), this.len = t.length - 1, this.args = Po(...t.slice(-1)), this.res = t[this.len];
  }
  check(t, n) {
    let r = t.constructor === Function && t.length <= this.len;
    return !r && n?.extend(null, "function", typeof t), r;
  }
};
var Qo = E(dr);
var tc = I((e19) => typeof e19 == "function");
var fr = class extends v {
  constructor(t) {
    super(), this.shape = t;
  }
  check(t, n) {
    let r = Je(this.shape, (s) => s.check(t, n));
    return !r && n?.extend(null, "Intersectinon", typeof t), r;
  }
};
var Ql = E(fr, (e19) => e19.shape.length > 0);
var Ht = class extends v {
  constructor(t) {
    super(), this.shape = t;
  }
  check(t, n) {
    let r = de(this.shape, (s) => s.check(t, n));
    return n?.extend(null, "Union", typeof t), r;
  }
};
Ge(Ht, "_dilutes", true);
var Kt = (...e19) => e19.findIndex((t) => fn.check(t)) >= 0 ? Kt(...e19.map((t) => Ae(t)).map((t) => fn.check(t) ? t.shape : [t]).flat(1)) : e19.length === 1 ? e19[0] : new Ht(e19);
var fn = E(Ht);
var Is = () => true;
var pn = I(Is);
var ec = E(Ce, (e19) => e19.shape === Is);
var gr = I((e19) => typeof e19 == "bigint");
var nc = I((e19) => e19 === gr);
var Ds = I((e19) => typeof e19 == "symbol");
var ta = I((e19) => e19 === Ds);
var Jt = I((e19) => typeof e19 == "number");
var Ts = I((e19) => e19 === Jt);
var Pt = I((e19) => typeof e19 == "string");
var vs = I((e19) => e19 === Pt);
var wn = I((e19) => typeof e19 == "boolean");
var rc = I((e19) => e19 === wn);
var Vs = mn(void 0);
var ea = E(Xt, (e19) => e19.shape.length === 1 && e19.shape[0] === void 0);
var na = mn(void 0);
var yn = mn(null);
var sc = E(Xt, (e19) => e19.shape.length === 1 && e19.shape[0] === null);
var ra = E(Uint8Array);
var sa = E(Ue, (e19) => e19.shape === Uint8Array);
var ic = Kt(Jt, Pt, yn, Vs, gr, wn, Ds);
var ia = (() => {
  let e19 = As(pn), t = Cs(Pt, pn), n = Kt(Jt, Pt, yn, wn, e19, t);
  return e19.shape = n, t.shape.values = n, n;
})();
var Ae = (e19) => {
  if (Zo.check(e19)) return e19;
  if (Jo.check(e19)) {
    let t = {};
    for (let n in e19) t[n] = Ae(e19[n]);
    return zo(t);
  } else {
    if (Yo.check(e19)) return Kt(...e19.map(Ae));
    if (ic.check(e19)) return mn(e19);
    if (tc.check(e19)) return E(e19);
  }
  T();
};
var _s = ys ? () => {
} : (e19, t) => {
  let n = new ar();
  if (!t.check(e19, n)) throw G(`Expected value to be of type ${t.constructor.name}.
${n.toString()}`);
};
var pr = class {
  constructor(t) {
    this.patterns = [], this.$state = t;
  }
  if(t, n) {
    return this.patterns.push({ if: Ae(t), h: n }), this;
  }
  else(t) {
    return this.if(pn, t);
  }
  done() {
    return (t, n) => {
      for (let r = 0; r < this.patterns.length; r++) {
        let s = this.patterns[r];
        if (s.if.check(t)) return s.h(t, n);
      }
      throw G("Unhandled pattern");
    };
  }
};
var oc = (e19) => new pr(e19);
var Os = oc(pn).if(Ts, (e19, t) => rn(t, Fn, Tt)).if(vs, (e19, t) => Ss(t)).if(rc, (e19, t) => or(t)).if(nc, (e19, t) => BigInt(rn(t, Fn, Tt))).if(fn, (e19, t) => zt(t, sn(t, e19.shape))).if(Ho, (e19, t) => {
  let n = {};
  for (let r in e19.shape) {
    let s = e19.shape[r];
    if (Go.check(s)) {
      if (or(t)) continue;
      s = s.shape;
    }
    n[r] = Os(s, t);
  }
  return n;
}).if(Ko, (e19, t) => {
  let n = [], r = cr(t, 0, 42);
  for (let s = 0; s < r; s++) n.push(zt(t, e19.shape));
  return n;
}).if(Es, (e19, t) => sn(t, e19.shape)).if(sc, (e19, t) => null).if(Qo, (e19, t) => {
  let n = zt(t, e19.res);
  return () => n;
}).if(ec, (e19, t) => zt(t, sn(t, [Jt, Pt, yn, Vs, gr, wn, As(Jt), Cs(Kt("a", "b", "c"), Jt)]))).if(Xo, (e19, t) => {
  let n = {}, r = rn(t, 0, 3);
  for (let s = 0; s < r; s++) {
    let i = zt(t, e19.shape.keys), o = zt(t, e19.shape.values);
    n[i] = o;
  }
  return n;
}).done();
var zt = (e19, t) => Os(Ae(t), e19);
var Ut = typeof document < "u" ? document : {};
var ca = I((e19) => e19.nodeType === uc);
var la = typeof DOMParser < "u" ? new DOMParser() : null;
var aa = I((e19) => e19.nodeType === lc);
var ha = I((e19) => e19.nodeType === ac);
var Ns = (e19) => Kr(e19, (t, n) => `${n}:${t};`).join("");
var lc = Ut.ELEMENT_NODE;
var ac = Ut.TEXT_NODE;
var ua = Ut.CDATA_SECTION_NODE;
var da = Ut.COMMENT_NODE;
var hc = Ut.DOCUMENT_NODE;
var fa = Ut.DOCUMENT_TYPE_NODE;
var uc = Ut.DOCUMENT_FRAGMENT_NODE;
var pa = I((e19) => e19.nodeType === hc);
var Q = Symbol;
var Ie = Q();
var De = Q();
var mr = Q();
var wr = Q();
var yr = Q();
var Te = Q();
var xr = Q();
var Yt = Q();
var br = Q();
var Ls = (e19) => {
  e19.length === 1 && e19[0]?.constructor === Function && (e19 = e19[0]());
  let t = [], n = [], r = 0;
  for (; r < e19.length; r++) {
    let s = e19[r];
    if (s === void 0) break;
    if (s.constructor === String || s.constructor === Number) t.push(s);
    else if (s.constructor === Object) break;
  }
  for (r > 0 && n.push(t.join("")); r < e19.length; r++) {
    let s = e19[r];
    s instanceof Symbol || n.push(s);
  }
  return n;
};
var ga = Qe();
var gc = { [Ie]: Z("font-weight", "bold"), [De]: Z("font-weight", "normal"), [mr]: Z("color", "blue"), [yr]: Z("color", "green"), [wr]: Z("color", "grey"), [Te]: Z("color", "red"), [xr]: Z("color", "purple"), [Yt]: Z("color", "orange"), [br]: Z("color", "black") };
var mc = (e19) => {
  e19.length === 1 && e19[0]?.constructor === Function && (e19 = e19[0]());
  let t = [], n = [], r = A(), s = [], i = 0;
  for (; i < e19.length; i++) {
    let o = e19[i], c = gc[o];
    if (c !== void 0) r.set(c.left, c.right);
    else {
      if (o === void 0) break;
      if (o.constructor === String || o.constructor === Number) {
        let l = Ns(r);
        i > 0 || l.length > 0 ? (t.push("%c" + o), n.push(l)) : t.push(o);
      } else break;
    }
  }
  for (i > 0 && (s = n, s.unshift(t.join(""))); i < e19.length; i++) {
    let o = e19[i];
    o instanceof Symbol || s.push(o);
  }
  return s;
};
var Bs = xs ? mc : Ls;
var xn = (...e19) => {
  console.log(...Bs(e19)), Ms.forEach((t) => t.print(e19));
};
var kr = (...e19) => {
  console.warn(...Bs(e19)), e19.unshift(Yt), Ms.forEach((t) => t.print(e19));
};
var Ms = rt();
var Rs = (e19) => ({ [Symbol.iterator]() {
  return this;
}, next: e19 });
var $s = (e19, t) => Rs(() => {
  let n;
  do
    n = e19.next();
  while (!n.done && !t(n.value));
  return n;
});
var bn = (e19, t) => Rs(() => {
  let { done: n, value: r } = e19.next();
  return { done: n, value: n ? void 0 : t(r) };
});
var Ve = class {
  constructor(t, n) {
    this.clock = t, this.len = n;
  }
};
var gt = class {
  constructor() {
    this.clients = /* @__PURE__ */ new Map();
  }
};
var Qt = (e19, t, n) => t.clients.forEach((r, s) => {
  let i = e19.doc.store.clients.get(s);
  if (i != null) {
    let o = i[i.length - 1], c = o.id.clock + o.length;
    for (let l = 0, h = r[l]; l < r.length && h.clock < c; h = r[++l]) mi(e19, i, h.clock, h.len, n);
  }
});
var kc = (e19, t) => {
  let n = 0, r = e19.length - 1;
  for (; n <= r; ) {
    let s = B((n + r) / 2), i = e19[s], o = i.clock;
    if (o <= t) {
      if (t < o + i.len) return s;
      n = s + 1;
    } else r = s - 1;
  }
  return null;
};
var ae = (e19, t) => {
  let n = e19.clients.get(t.client);
  return n !== void 0 && kc(n, t.clock) !== null;
};
var Mr = (e19) => {
  e19.clients.forEach((t) => {
    t.sort((s, i) => s.clock - i.clock);
    let n, r;
    for (n = 1, r = 1; n < t.length; n++) {
      let s = t[r - 1], i = t[n];
      s.clock + s.len >= i.clock ? s.len = it(s.len, i.clock + i.len - s.clock) : (r < n && (t[r] = i), r++);
    }
    t.length = r;
  });
};
var te = (e19) => {
  let t = new gt();
  for (let n = 0; n < e19.length; n++) e19[n].clients.forEach((r, s) => {
    if (!t.clients.has(s)) {
      let i = r.slice();
      for (let o = n + 1; o < e19.length; o++) Wr(i, e19[o].clients.get(s) || []);
      t.clients.set(s, i);
    }
  });
  return Mr(t), t;
};
var Oe = (e19, t, n, r) => {
  L(e19.clients, t, () => []).push(new Ve(n, r));
};
var Rr = () => new gt();
var ci = (e19) => {
  let t = Rr();
  return e19.clients.forEach((n, r) => {
    let s = [];
    for (let i = 0; i < n.length; i++) {
      let o = n[i];
      if (o.deleted) {
        let c = o.id.clock, l = o.length;
        if (i + 1 < n.length) for (let h = n[i + 1]; i + 1 < n.length && h.deleted; h = n[++i + 1]) l += h.length;
        s.push(new Ve(c, l));
      }
    }
    s.length > 0 && t.clients.set(r, s);
  }), t;
};
var tt = (e19, t) => {
  g(e19.restEncoder, t.clients.size), Y(t.clients.entries()).sort((n, r) => r[0] - n[0]).forEach(([n, r]) => {
    e19.resetDsCurVal(), g(e19.restEncoder, n);
    let s = r.length;
    g(e19.restEncoder, s);
    for (let i = 0; i < s; i++) {
      let o = r[i];
      e19.writeDsClock(o.clock), e19.writeDsLen(o.len);
    }
  });
};
var ot = (e19) => {
  let t = new gt(), n = w(e19.restDecoder);
  for (let r = 0; r < n; r++) {
    e19.resetDsCurVal();
    let s = w(e19.restDecoder), i = w(e19.restDecoder);
    if (i > 0) {
      let o = L(t.clients, s, () => []);
      for (let c = 0; c < i; c++) o.push(new Ve(e19.readDsClock(), e19.readDsLen()));
    }
  }
  return t;
};
var Gs = (e19, t, n) => {
  let r = new gt(), s = w(e19.restDecoder);
  for (let i = 0; i < s; i++) {
    e19.resetDsCurVal();
    let o = w(e19.restDecoder), c = w(e19.restDecoder), l = n.clients.get(o) || [], h = _(n, o);
    for (let a = 0; a < c; a++) {
      let u = e19.readDsClock(), d = u + e19.readDsLen();
      if (u < h) {
        h < d && Oe(r, o, h, d - h);
        let f = P(l, u), p = l[f];
        for (!p.deleted && p.id.clock < u && (l.splice(f + 1, 0, Ln(t, p, u - p.id.clock)), f++); f < l.length && (p = l[f++], p.id.clock < d); ) p.deleted || (d < p.id.clock + p.length && l.splice(f, 0, Ln(t, p, d - p.id.clock)), p.delete(t));
      } else Oe(r, o, u, d - u);
    }
  }
  if (r.clients.size > 0) {
    let i = new X();
    return g(i.restEncoder, 0), tt(i, r), i.toUint8Array();
  }
  return null;
};
var li = Pn;
var Ct = class e extends Dt {
  constructor({ guid: t = ls(), collectionid: n = null, gc: r = true, gcFilter: s = () => true, meta: i = null, autoLoad: o = false, shouldLoad: c = true } = {}) {
    super(), this.gc = r, this.gcFilter = s, this.clientID = li(), this.guid = t, this.collectionid = n, this.share = /* @__PURE__ */ new Map(), this.store = new Dn(), this._transaction = null, this._transactionCleanups = [], this.subdocs = /* @__PURE__ */ new Set(), this._item = null, this.shouldLoad = c, this.autoLoad = o, this.meta = i, this.isLoaded = false, this.isSynced = false, this.isDestroyed = false, this.whenLoaded = Kn((h) => {
      this.on("load", () => {
        this.isLoaded = true, h(this);
      });
    });
    let l = () => Kn((h) => {
      let a = (u) => {
        (u === void 0 || u === true) && (this.off("sync", a), h());
      };
      this.on("sync", a);
    });
    this.on("sync", (h) => {
      h === false && this.isSynced && (this.whenSynced = l()), this.isSynced = h === void 0 || h === true, this.isSynced && !this.isLoaded && this.emit("load", [this]);
    }), this.whenSynced = l();
  }
  load() {
    let t = this._item;
    t !== null && !this.shouldLoad && x(t.parent.doc, (n) => {
      n.subdocsLoaded.add(this);
    }, null, true), this.shouldLoad = true;
  }
  getSubdocs() {
    return this.subdocs;
  }
  getSubdocGuids() {
    return new Set(Y(this.subdocs).map((t) => t.guid));
  }
  transact(t, n = null) {
    return x(this, t, n);
  }
  get(t, n = U) {
    let r = L(this.share, t, () => {
      let i = new n();
      return i._integrate(this, null), i;
    }), s = r.constructor;
    if (n !== U && s !== n) if (s === U) {
      let i = new n();
      i._map = r._map, r._map.forEach((o) => {
        for (; o !== null; o = o.left) o.parent = i;
      }), i._start = r._start;
      for (let o = i._start; o !== null; o = o.right) o.parent = i;
      return i._length = r._length, this.share.set(t, i), i._integrate(this, null), i;
    } else throw new Error(`Type with the name ${t} has already been defined with a different constructor`);
    return r;
  }
  getArray(t = "") {
    return this.get(t, re);
  }
  getText(t = "") {
    return this.get(t, $e);
  }
  getMap(t = "") {
    return this.get(t, se);
  }
  getXmlElement(t = "") {
    return this.get(t, oe);
  }
  getXmlFragment(t = "") {
    return this.get(t, ie);
  }
  toJSON() {
    let t = {};
    return this.share.forEach((n, r) => {
      t[r] = n.toJSON();
    }), t;
  }
  destroy() {
    this.isDestroyed = true, Y(this.subdocs).forEach((n) => n.destroy());
    let t = this._item;
    if (t !== null) {
      this._item = null;
      let n = t.content;
      n.doc = new e({ guid: this.guid, ...n.opts, shouldLoad: false }), n.doc._item = t, x(t.parent.doc, (r) => {
        let s = n.doc;
        t.deleted || r.subdocsAdded.add(s), r.subdocsRemoved.add(this);
      }, null, true);
    }
    this.emit("destroyed", [true]), this.emit("destroy", [this]), super.destroy();
  }
};
var At = class {
  constructor(t) {
    this.restDecoder = t;
  }
  resetDsCurVal() {
  }
  readDsClock() {
    return w(this.restDecoder);
  }
  readDsLen() {
    return w(this.restDecoder);
  }
};
var H = class extends At {
  readLeftID() {
    return m(w(this.restDecoder), w(this.restDecoder));
  }
  readRightID() {
    return m(w(this.restDecoder), w(this.restDecoder));
  }
  readClient() {
    return w(this.restDecoder);
  }
  readInfo() {
    return St(this.restDecoder);
  }
  readString() {
    return ht(this.restDecoder);
  }
  readParentInfo() {
    return w(this.restDecoder) === 1;
  }
  readTypeRef() {
    return w(this.restDecoder);
  }
  readLen() {
    return w(this.restDecoder);
  }
  readAny() {
    return Ft(this.restDecoder);
  }
  readBuf() {
    return ks(F(this.restDecoder));
  }
  readJSON() {
    return JSON.parse(ht(this.restDecoder));
  }
  readKey() {
    return ht(this.restDecoder);
  }
};
var Cn = class {
  constructor(t) {
    this.dsCurrVal = 0, this.restDecoder = t;
  }
  resetDsCurVal() {
    this.dsCurrVal = 0;
  }
  readDsClock() {
    return this.dsCurrVal += w(this.restDecoder), this.dsCurrVal;
  }
  readDsLen() {
    let t = w(this.restDecoder) + 1;
    return this.dsCurrVal += t, t;
  }
};
var j = class extends Cn {
  constructor(t) {
    super(t), this.keys = [], w(t), this.keyClockDecoder = new jt(F(t)), this.clientDecoder = new _t(F(t)), this.leftClockDecoder = new jt(F(t)), this.rightClockDecoder = new jt(F(t)), this.infoDecoder = new ye(F(t), St), this.stringDecoder = new We(F(t)), this.parentInfoDecoder = new ye(F(t), St), this.typeRefDecoder = new _t(F(t)), this.lenDecoder = new _t(F(t));
  }
  readLeftID() {
    return new pt(this.clientDecoder.read(), this.leftClockDecoder.read());
  }
  readRightID() {
    return new pt(this.clientDecoder.read(), this.rightClockDecoder.read());
  }
  readClient() {
    return this.clientDecoder.read();
  }
  readInfo() {
    return this.infoDecoder.read();
  }
  readString() {
    return this.stringDecoder.read();
  }
  readParentInfo() {
    return this.parentInfoDecoder.read() === 1;
  }
  readTypeRef() {
    return this.typeRefDecoder.read();
  }
  readLen() {
    return this.lenDecoder.read();
  }
  readAny() {
    return Ft(this.restDecoder);
  }
  readBuf() {
    return F(this.restDecoder);
  }
  readJSON() {
    return Ft(this.restDecoder);
  }
  readKey() {
    let t = this.keyClockDecoder.read();
    if (t < this.keys.length) return this.keys[t];
    {
      let n = this.stringDecoder.read();
      return this.keys.push(n), n;
    }
  }
};
var mt = class {
  constructor() {
    this.restEncoder = kt();
  }
  toUint8Array() {
    return q(this.restEncoder);
  }
  resetDsCurVal() {
  }
  writeDsClock(t) {
    g(this.restEncoder, t);
  }
  writeDsLen(t) {
    g(this.restEncoder, t);
  }
};
var ct = class extends mt {
  writeLeftID(t) {
    g(this.restEncoder, t.client), g(this.restEncoder, t.clock);
  }
  writeRightID(t) {
    g(this.restEncoder, t.client), g(this.restEncoder, t.clock);
  }
  writeClient(t) {
    g(this.restEncoder, t);
  }
  writeInfo(t) {
    Mt(this.restEncoder, t);
  }
  writeString(t) {
    lt(this.restEncoder, t);
  }
  writeParentInfo(t) {
    g(this.restEncoder, t ? 1 : 0);
  }
  writeTypeRef(t) {
    g(this.restEncoder, t);
  }
  writeLen(t) {
    g(this.restEncoder, t);
  }
  writeAny(t) {
    Lt(this.restEncoder, t);
  }
  writeBuf(t) {
    $(this.restEncoder, t);
  }
  writeJSON(t) {
    lt(this.restEncoder, JSON.stringify(t));
  }
  writeKey(t) {
    lt(this.restEncoder, t);
  }
};
var ee = class {
  constructor() {
    this.restEncoder = kt(), this.dsCurrVal = 0;
  }
  toUint8Array() {
    return q(this.restEncoder);
  }
  resetDsCurVal() {
    this.dsCurrVal = 0;
  }
  writeDsClock(t) {
    let n = t - this.dsCurrVal;
    this.dsCurrVal = t, g(this.restEncoder, n);
  }
  writeDsLen(t) {
    t === 0 && T(), g(this.restEncoder, t - 1), this.dsCurrVal += t;
  }
};
var X = class extends ee {
  constructor() {
    super(), this.keyMap = /* @__PURE__ */ new Map(), this.keyClock = 0, this.keyClockEncoder = new Bt(), this.clientEncoder = new bt(), this.leftClockEncoder = new Bt(), this.rightClockEncoder = new Bt(), this.infoEncoder = new me(Mt), this.stringEncoder = new Ye(), this.parentInfoEncoder = new me(Mt), this.typeRefEncoder = new bt(), this.lenEncoder = new bt();
  }
  toUint8Array() {
    let t = kt();
    return g(t, 0), $(t, this.keyClockEncoder.toUint8Array()), $(t, this.clientEncoder.toUint8Array()), $(t, this.leftClockEncoder.toUint8Array()), $(t, this.rightClockEncoder.toUint8Array()), $(t, q(this.infoEncoder)), $(t, this.stringEncoder.toUint8Array()), $(t, q(this.parentInfoEncoder)), $(t, this.typeRefEncoder.toUint8Array()), $(t, this.lenEncoder.toUint8Array()), Rt(t, q(this.restEncoder)), q(t);
  }
  writeLeftID(t) {
    this.clientEncoder.write(t.client), this.leftClockEncoder.write(t.clock);
  }
  writeRightID(t) {
    this.clientEncoder.write(t.client), this.rightClockEncoder.write(t.clock);
  }
  writeClient(t) {
    this.clientEncoder.write(t);
  }
  writeInfo(t) {
    this.infoEncoder.write(t);
  }
  writeString(t) {
    this.stringEncoder.write(t);
  }
  writeParentInfo(t) {
    this.parentInfoEncoder.write(t ? 1 : 0);
  }
  writeTypeRef(t) {
    this.typeRefEncoder.write(t);
  }
  writeLen(t) {
    this.lenEncoder.write(t);
  }
  writeAny(t) {
    Lt(this.restEncoder, t);
  }
  writeBuf(t) {
    $(this.restEncoder, t);
  }
  writeJSON(t) {
    Lt(this.restEncoder, t);
  }
  writeKey(t) {
    let n = this.keyMap.get(t);
    n === void 0 ? (this.keyClockEncoder.write(this.keyClock++), this.stringEncoder.write(t)) : this.keyClockEncoder.write(n);
  }
};
var _c = (e19, t, n, r) => {
  r = it(r, t[0].id.clock);
  let s = P(t, r);
  g(e19.restEncoder, t.length - s), e19.writeClient(n), g(e19.restEncoder, r);
  let i = t[s];
  i.write(e19, r - i.id.clock);
  for (let o = s + 1; o < t.length; o++) t[o].write(e19, 0);
};
var $r = (e19, t, n) => {
  let r = /* @__PURE__ */ new Map();
  n.forEach((s, i) => {
    _(t, i) > s && r.set(i, s);
  }), qe(t).forEach((s, i) => {
    n.has(i) || r.set(i, 0);
  }), g(e19.restEncoder, r.size), Y(r.entries()).sort((s, i) => i[0] - s[0]).forEach(([s, i]) => {
    _c(e19, t.clients.get(s), s, i);
  });
};
var Ec = (e19, t) => {
  let n = A(), r = w(e19.restDecoder);
  for (let s = 0; s < r; s++) {
    let i = w(e19.restDecoder), o = new Array(i), c = e19.readClient(), l = w(e19.restDecoder);
    n.set(c, { i: 0, refs: o });
    for (let h = 0; h < i; h++) {
      let a = e19.readInfo();
      switch (31 & a) {
        case 0: {
          let u = e19.readLen();
          o[h] = new R(m(c, l), u), l += u;
          break;
        }
        case 10: {
          let u = w(e19.restDecoder);
          o[h] = new N(m(c, l), u), l += u;
          break;
        }
        default: {
          let u = (a & 192) === 0, d = new b(m(c, l), null, (a & 128) === 128 ? e19.readLeftID() : null, null, (a & 64) === 64 ? e19.readRightID() : null, u ? e19.readParentInfo() ? t.get(e19.readString()) : e19.readLeftID() : null, u && (a & 32) === 32 ? e19.readString() : null, Fi(e19, a));
          o[h] = d, l += d.length;
        }
      }
    }
  }
  return n;
};
var Uc = (e19, t, n) => {
  let r = [], s = Y(n.keys()).sort((f, p) => f - p);
  if (s.length === 0) return null;
  let i = () => {
    if (s.length === 0) return null;
    let f = n.get(s[s.length - 1]);
    for (; f.refs.length === f.i; ) if (s.pop(), s.length > 0) f = n.get(s[s.length - 1]);
    else return null;
    return f;
  }, o = i();
  if (o === null) return null;
  let c = new Dn(), l = /* @__PURE__ */ new Map(), h = (f, p) => {
    let y = l.get(f);
    (y == null || y > p) && l.set(f, p);
  }, a = o.refs[o.i++], u = /* @__PURE__ */ new Map(), d = () => {
    for (let f of r) {
      let p = f.id.client, y = n.get(p);
      y ? (y.i--, c.clients.set(p, y.refs.slice(y.i)), n.delete(p), y.i = 0, y.refs = []) : c.clients.set(p, [f]), s = s.filter((k) => k !== p);
    }
    r.length = 0;
  };
  for (; ; ) {
    if (a.constructor !== N) {
      let p = L(u, a.id.client, () => _(t, a.id.client)) - a.id.clock;
      if (p < 0) r.push(a), h(a.id.client, a.id.clock - 1), d();
      else {
        let y = a.getMissing(e19, t);
        if (y !== null) {
          r.push(a);
          let k = n.get(y) || { refs: [], i: 0 };
          if (k.refs.length === k.i) h(y, _(t, y)), d();
          else {
            a = k.refs[k.i++];
            continue;
          }
        } else (p === 0 || p < a.length) && (a.integrate(e19, p), u.set(a.id.client, a.id.clock + a.length));
      }
    }
    if (r.length > 0) a = r.pop();
    else if (o !== null && o.i < o.refs.length) a = o.refs[o.i++];
    else {
      if (o = i(), o === null) break;
      a = o.refs[o.i++];
    }
  }
  if (c.clients.size > 0) {
    let f = new X();
    return $r(f, c, /* @__PURE__ */ new Map()), g(f.restEncoder, 0), { missing: l, update: f.toUint8Array() };
  }
  return null;
};
var Cc = (e19, t) => $r(e19, t.doc.store, t.beforeState);
var ai = (e19, t, n, r = new j(e19)) => x(t, (s) => {
  s.local = false;
  let i = false, o = s.doc, c = o.store, l = Ec(r, o), h = Uc(s, c, l), a = c.pendingStructs;
  if (a) {
    for (let [d, f] of a.missing) if (f < _(c, d)) {
      i = true;
      break;
    }
    if (h) {
      for (let [d, f] of h.missing) {
        let p = a.missing.get(d);
        (p == null || p > f) && a.missing.set(d, f);
      }
      a.update = Tn([a.update, h.update]);
    }
  } else c.pendingStructs = h;
  let u = Gs(r, s, c);
  if (c.pendingDs) {
    let d = new j(V(c.pendingDs));
    w(d.restDecoder);
    let f = Gs(d, s, c);
    u && f ? c.pendingDs = Tn([u, f]) : c.pendingDs = u || f;
  } else c.pendingDs = u;
  if (i) {
    let d = c.pendingStructs.update;
    c.pendingStructs = null, Fr(s.doc, d);
  }
}, n, false);
var Fr = (e19, t, n, r = j) => {
  let s = V(t);
  ai(s, e19, n, new r(s));
};
var Ac = (e19, t, n = /* @__PURE__ */ new Map()) => {
  $r(e19, t.store, n), tt(e19, ci(t.store));
};
var Ic = (e19, t = new Uint8Array([0]), n = new X()) => {
  let r = ui(t);
  Ac(n, e19, r);
  let s = [n.toUint8Array()];
  if (e19.store.pendingDs && s.push(e19.store.pendingDs), e19.store.pendingStructs && s.push(bi(e19.store.pendingStructs.update, t)), s.length > 1) {
    if (n.constructor === ct) return Gc(s.map((i, o) => o === 0 ? i : Xc(i)));
    if (n.constructor === X) return Tn(s);
  }
  return s[0];
};
var hi = (e19) => {
  let t = /* @__PURE__ */ new Map(), n = w(e19.restDecoder);
  for (let r = 0; r < n; r++) {
    let s = w(e19.restDecoder), i = w(e19.restDecoder);
    t.set(s, i);
  }
  return t;
};
var ui = (e19) => hi(new At(V(e19)));
var _r = class {
  constructor() {
    this.l = [];
  }
};
var zs = () => new _r();
var Hs = (e19, t) => e19.l.push(t);
var Js = (e19, t) => {
  let n = e19.l, r = n.length;
  e19.l = n.filter((s) => t !== s), r === e19.l.length && console.error("[yjs] Tried to remove event handler that doesn't exist.");
};
var di = (e19, t, n) => _e(e19.l, [t, n]);
var pt = class {
  constructor(t, n) {
    this.client = t, this.clock = n;
  }
};
var Wt = (e19, t) => e19 === t || e19 !== null && t !== null && e19.client === t.client && e19.clock === t.clock;
var m = (e19, t) => new pt(e19, t);
var fi = (e19) => {
  for (let [t, n] of e19.doc.share.entries()) if (n === e19) return t;
  throw T();
};
var In = class {
  constructor(t, n) {
    this.ds = t, this.sv = n;
  }
};
var pi = (e19, t) => new In(e19, t);
var $a = pi(Rr(), /* @__PURE__ */ new Map());
var ut = (e19, t) => t === void 0 ? !e19.deleted : t.sv.has(e19.id.client) && (t.sv.get(e19.id.client) || 0) > e19.id.clock && !ae(t.ds, e19.id);
var Ur = (e19, t) => {
  let n = L(e19.meta, Ur, rt), r = e19.doc.store;
  n.has(t) || (t.sv.forEach((s, i) => {
    s < _(r, i) && M(e19, m(i, s));
  }), Qt(e19, t.ds, (s) => {
  }), n.add(t));
};
var Dn = class {
  constructor() {
    this.clients = /* @__PURE__ */ new Map(), this.pendingStructs = null, this.pendingDs = null;
  }
};
var qe = (e19) => {
  let t = /* @__PURE__ */ new Map();
  return e19.clients.forEach((n, r) => {
    let s = n[n.length - 1];
    t.set(r, s.id.clock + s.length);
  }), t;
};
var _ = (e19, t) => {
  let n = e19.clients.get(t);
  if (n === void 0) return 0;
  let r = n[n.length - 1];
  return r.id.clock + r.length;
};
var gi = (e19, t) => {
  let n = e19.clients.get(t.id.client);
  if (n === void 0) n = [], e19.clients.set(t.id.client, n);
  else {
    let r = n[n.length - 1];
    if (r.id.clock + r.length !== t.id.clock) throw T();
  }
  n.push(t);
};
var P = (e19, t) => {
  let n = 0, r = e19.length - 1, s = e19[r], i = s.id.clock;
  if (i === t) return r;
  let o = B(t / (i + s.length - 1) * r);
  for (; n <= r; ) {
    if (s = e19[o], i = s.id.clock, i <= t) {
      if (t < i + s.length) return o;
      n = o + 1;
    } else r = o - 1;
    o = B((n + r) / 2);
  }
  throw T();
};
var Rc = (e19, t) => {
  let n = e19.clients.get(t.client);
  return n[P(n, t.clock)];
};
var Zt = Rc;
var Cr = (e19, t, n) => {
  let r = P(t, n), s = t[r];
  return s.id.clock < n && s instanceof b ? (t.splice(r + 1, 0, Ln(e19, s, n - s.id.clock)), r + 1) : r;
};
var M = (e19, t) => {
  let n = e19.doc.store.clients.get(t.client);
  return n[Cr(e19, n, t.clock)];
};
var Ys = (e19, t, n) => {
  let r = t.clients.get(n.client), s = P(r, n.clock), i = r[s];
  return n.clock !== i.id.clock + i.length - 1 && i.constructor !== R && r.splice(s + 1, 0, Ln(e19, i, n.clock - i.id.clock + 1)), i;
};
var $c = (e19, t, n) => {
  let r = e19.clients.get(t.id.client);
  r[P(r, t.id.clock)] = n;
};
var mi = (e19, t, n, r, s) => {
  if (r === 0) return;
  let i = n + r, o = Cr(e19, t, n), c;
  do
    c = t[o++], i < c.id.clock + c.length && Cr(e19, t, i), s(c);
  while (o < t.length && t[o].id.clock < i);
};
var Ar = class {
  constructor(t, n, r) {
    this.doc = t, this.deleteSet = new gt(), this.beforeState = qe(t.store), this.afterState = /* @__PURE__ */ new Map(), this.changed = /* @__PURE__ */ new Map(), this.changedParentTypes = /* @__PURE__ */ new Map(), this._mergeStructs = [], this.origin = n, this.meta = /* @__PURE__ */ new Map(), this.local = r, this.subdocsAdded = /* @__PURE__ */ new Set(), this.subdocsRemoved = /* @__PURE__ */ new Set(), this.subdocsLoaded = /* @__PURE__ */ new Set(), this._needFormattingCleanup = false;
  }
};
var Ws = (e19, t) => t.deleteSet.clients.size === 0 && !Yr(t.afterState, (n, r) => t.beforeState.get(r) !== n) ? false : (Mr(t.deleteSet), Cc(e19, t), tt(e19, t.deleteSet), true);
var Zs = (e19, t, n) => {
  let r = t._item;
  (r === null || r.id.clock < (e19.beforeState.get(r.id.client) || 0) && !r.deleted) && L(e19.changed, t, rt).add(n);
};
var En = (e19, t) => {
  let n = e19[t], r = e19[t - 1], s = t;
  for (; s > 0; n = r, r = e19[--s - 1]) {
    if (r.deleted === n.deleted && r.constructor === n.constructor && r.mergeWith(n)) {
      n instanceof b && n.parentSub !== null && n.parent._map.get(n.parentSub) === n && n.parent._map.set(n.parentSub, r);
      continue;
    }
    break;
  }
  let i = t - s;
  return i && e19.splice(t + 1 - i, i), i;
};
var wi = (e19, t, n) => {
  for (let [r, s] of e19.clients.entries()) {
    let i = t.clients.get(r);
    for (let o = s.length - 1; o >= 0; o--) {
      let c = s[o], l = c.clock + c.len;
      for (let h = P(i, c.clock), a = i[h]; h < i.length && a.id.clock < l; a = i[++h]) {
        let u = i[h];
        if (c.clock + c.len <= u.id.clock) break;
        u instanceof b && u.deleted && !u.keep && n(u) && u.gc(t, false);
      }
    }
  }
};
var yi = (e19, t) => {
  e19.clients.forEach((n, r) => {
    let s = t.clients.get(r);
    for (let i = n.length - 1; i >= 0; i--) {
      let o = n[i], c = Xe(s.length - 1, 1 + P(s, o.clock + o.len - 1));
      for (let l = c, h = s[l]; l > 0 && h.id.clock >= o.clock; h = s[l]) l -= 1 + En(s, l);
    }
  });
};
var xi = (e19, t) => {
  if (t < e19.length) {
    let n = e19[t], r = n.doc, s = r.store, i = n.deleteSet, o = n._mergeStructs;
    try {
      Mr(i), n.afterState = qe(n.doc.store), r.emit("beforeObserverCalls", [n, r]);
      let c = [];
      n.changed.forEach((l, h) => c.push(() => {
        (h._item === null || !h._item.deleted) && h._callObserver(n, l);
      })), c.push(() => {
        n.changedParentTypes.forEach((l, h) => {
          h._dEH.l.length > 0 && (h._item === null || !h._item.deleted) && (l = l.filter((a) => a.target._item === null || !a.target._item.deleted), l.forEach((a) => {
            a.currentTarget = h, a._path = null;
          }), l.sort((a, u) => a.path.length - u.path.length), di(h._dEH, l, n));
        });
      }), c.push(() => r.emit("afterTransaction", [n, r])), _e(c, []), n._needFormattingCleanup && sl(n);
    } finally {
      r.gc && wi(i, s, r.gcFilter), yi(i, s), n.afterState.forEach((a, u) => {
        let d = n.beforeState.get(u) || 0;
        if (d !== a) {
          let f = s.clients.get(u), p = it(P(f, d), 1);
          for (let y = f.length - 1; y >= p; ) y -= 1 + En(f, y);
        }
      });
      for (let a = o.length - 1; a >= 0; a--) {
        let { client: u, clock: d } = o[a].id, f = s.clients.get(u), p = P(f, d);
        p + 1 < f.length && En(f, p + 1) > 1 || p > 0 && En(f, p);
      }
      if (!n.local && n.afterState.get(r.clientID) !== n.beforeState.get(r.clientID) && (xn(Yt, Ie, "[yjs] ", De, Te, "Changed the client-id because another client seems to be using it."), r.clientID = li()), r.emit("afterTransactionCleanup", [n, r]), r._observers.has("update")) {
        let a = new ct();
        Ws(a, n) && r.emit("update", [a.toUint8Array(), n.origin, r, n]);
      }
      if (r._observers.has("updateV2")) {
        let a = new X();
        Ws(a, n) && r.emit("updateV2", [a.toUint8Array(), n.origin, r, n]);
      }
      let { subdocsAdded: c, subdocsLoaded: l, subdocsRemoved: h } = n;
      (c.size > 0 || h.size > 0 || l.size > 0) && (c.forEach((a) => {
        a.clientID = r.clientID, a.collectionid == null && (a.collectionid = r.collectionid), r.subdocs.add(a);
      }), h.forEach((a) => r.subdocs.delete(a)), r.emit("subdocs", [{ loaded: l, added: c, removed: h }, r, n]), h.forEach((a) => a.destroy())), e19.length <= t + 1 ? (r._transactionCleanups = [], r.emit("afterAllTransactions", [r, e19])) : xi(e19, t + 1);
    }
  }
};
var x = (e19, t, n = null, r = true) => {
  let s = e19._transactionCleanups, i = false, o = null;
  e19._transaction === null && (i = true, e19._transaction = new Ar(e19, n, r), s.push(e19._transaction), s.length === 1 && e19.emit("beforeAllTransactions", [e19]), e19.emit("beforeTransaction", [e19._transaction, e19]));
  try {
    o = t(e19._transaction);
  } finally {
    if (i) {
      let c = e19._transaction === s[0];
      e19._transaction = null, c && xi(s, 0);
    }
  }
  return o;
};
function* Fc(e19) {
  let t = w(e19.restDecoder);
  for (let n = 0; n < t; n++) {
    let r = w(e19.restDecoder), s = e19.readClient(), i = w(e19.restDecoder);
    for (let o = 0; o < r; o++) {
      let c = e19.readInfo();
      if (c === 10) {
        let l = w(e19.restDecoder);
        yield new N(m(s, i), l), i += l;
      } else if ((31 & c) !== 0) {
        let l = (c & 192) === 0, h = new b(m(s, i), null, (c & 128) === 128 ? e19.readLeftID() : null, null, (c & 64) === 64 ? e19.readRightID() : null, l ? e19.readParentInfo() ? e19.readString() : e19.readLeftID() : null, l && (c & 32) === 32 ? e19.readString() : null, Fi(e19, c));
        yield h, i += h.length;
      } else {
        let l = e19.readLen();
        yield new R(m(s, i), l), i += l;
      }
    }
  }
}
var et = class {
  constructor(t, n) {
    this.gen = Fc(t), this.curr = null, this.done = false, this.filterSkips = n, this.next();
  }
  next() {
    do
      this.curr = this.gen.next().value || null;
    while (this.filterSkips && this.curr !== null && this.curr.constructor === N);
    return this.curr;
  }
};
var qc = (e19, t = j) => {
  let n = [], r = new t(V(e19)), s = new et(r, false);
  for (let i = s.curr; i !== null; i = s.next()) n.push(i);
  return { structs: n, ds: ot(r) };
};
var Le = class {
  constructor(t) {
    this.currClient = 0, this.startClock = 0, this.written = 0, this.encoder = t, this.clientStructs = [];
  }
};
var Gc = (e19) => Tn(e19, H, ct);
var Jc = (e19, t) => {
  if (e19.constructor === R) {
    let { client: n, clock: r } = e19.id;
    return new R(m(n, r + t), e19.length - t);
  } else if (e19.constructor === N) {
    let { client: n, clock: r } = e19.id;
    return new N(m(n, r + t), e19.length - t);
  } else {
    let n = e19, { client: r, clock: s } = n.id;
    return new b(m(r, s + t), null, m(r, s + t - 1), null, n.rightOrigin, n.parent, n.parentSub, n.content.splice(t));
  }
};
var Tn = (e19, t = j, n = X) => {
  if (e19.length === 1) return e19[0];
  let r = e19.map((a) => new t(V(a))), s = r.map((a) => new et(a, true)), i = null, o = new n(), c = new Le(o);
  for (; s = s.filter((d) => d.curr !== null), s.sort((d, f) => {
    if (d.curr.id.client === f.curr.id.client) {
      let p = d.curr.id.clock - f.curr.id.clock;
      return p === 0 ? d.curr.constructor === f.curr.constructor ? 0 : d.curr.constructor === N ? 1 : -1 : p;
    } else return f.curr.id.client - d.curr.id.client;
  }), s.length !== 0; ) {
    let a = s[0], u = a.curr.id.client;
    if (i !== null) {
      let d = a.curr, f = false;
      for (; d !== null && d.id.clock + d.length <= i.struct.id.clock + i.struct.length && d.id.client >= i.struct.id.client; ) d = a.next(), f = true;
      if (d === null || d.id.client !== u || f && d.id.clock > i.struct.id.clock + i.struct.length) continue;
      if (u !== i.struct.id.client) dt(c, i.struct, i.offset), i = { struct: d, offset: 0 }, a.next();
      else if (i.struct.id.clock + i.struct.length < d.id.clock) if (i.struct.constructor === N) i.struct.length = d.id.clock + d.length - i.struct.id.clock;
      else {
        dt(c, i.struct, i.offset);
        let p = d.id.clock - i.struct.id.clock - i.struct.length;
        i = { struct: new N(m(u, i.struct.id.clock + i.struct.length), p), offset: 0 };
      }
      else {
        let p = i.struct.id.clock + i.struct.length - d.id.clock;
        p > 0 && (i.struct.constructor === N ? i.struct.length -= p : d = Jc(d, p)), i.struct.mergeWith(d) || (dt(c, i.struct, i.offset), i = { struct: d, offset: 0 }, a.next());
      }
    } else i = { struct: a.curr, offset: 0 }, a.next();
    for (let d = a.curr; d !== null && d.id.client === u && d.id.clock === i.struct.id.clock + i.struct.length && d.constructor !== N; d = a.next()) dt(c, i.struct, i.offset), i = { struct: d, offset: 0 };
  }
  i !== null && (dt(c, i.struct, i.offset), i = null), qr(c);
  let l = r.map((a) => ot(a)), h = te(l);
  return tt(o, h), o.toUint8Array();
};
var bi = (e19, t, n = j, r = X) => {
  let s = ui(t), i = new r(), o = new Le(i), c = new n(V(e19)), l = new et(c, false);
  for (; l.curr; ) {
    let a = l.curr, u = a.id.client, d = s.get(u) || 0;
    if (l.curr.constructor === N) {
      l.next();
      continue;
    }
    if (a.id.clock + a.length > d) for (dt(o, a, it(d - a.id.clock, 0)), l.next(); l.curr && l.curr.id.client === u; ) dt(o, l.curr, 0), l.next();
    else for (; l.curr && l.curr.id.client === u && l.curr.id.clock + l.curr.length <= d; ) l.next();
  }
  qr(o);
  let h = ot(c);
  return tt(i, h), i.toUint8Array();
};
var ki = (e19) => {
  e19.written > 0 && (e19.clientStructs.push({ written: e19.written, restEncoder: q(e19.encoder.restEncoder) }), e19.encoder.restEncoder = kt(), e19.written = 0);
};
var dt = (e19, t, n) => {
  e19.written > 0 && e19.currClient !== t.id.client && ki(e19), e19.written === 0 && (e19.currClient = t.id.client, e19.encoder.writeClient(t.id.client), g(e19.encoder.restEncoder, t.id.clock + n)), t.write(e19.encoder, n), e19.written++;
};
var qr = (e19) => {
  ki(e19);
  let t = e19.encoder.restEncoder;
  g(t, e19.clientStructs.length);
  for (let n = 0; n < e19.clientStructs.length; n++) {
    let r = e19.clientStructs[n];
    g(t, r.written), Rt(t, r.restEncoder);
  }
};
var Bn = (e19, t, n, r) => {
  let s = new n(V(e19)), i = new et(s, false), o = new r(), c = new Le(o);
  for (let h = i.curr; h !== null; h = i.next()) dt(c, t(h), 0);
  qr(c);
  let l = ot(s);
  return tt(o, l), o.toUint8Array();
};
var Xc = (e19) => Bn(e19, nr, j, ct);
var ni = "You must not compute changes after the event-handler fired.";
var ne = class {
  constructor(t, n) {
    this.target = t, this.currentTarget = t, this.transaction = n, this._changes = null, this._keys = null, this._delta = null, this._path = null;
  }
  get path() {
    return this._path || (this._path = Pc(this.currentTarget, this.target));
  }
  deletes(t) {
    return ae(this.transaction.deleteSet, t.id);
  }
  get keys() {
    if (this._keys === null) {
      if (this.transaction.doc._transactionCleanups.length === 0) throw G(ni);
      let t = /* @__PURE__ */ new Map(), n = this.target;
      this.transaction.changed.get(n).forEach((s) => {
        if (s !== null) {
          let i = n._map.get(s), o, c;
          if (this.adds(i)) {
            let l = i.left;
            for (; l !== null && this.adds(l); ) l = l.left;
            if (this.deletes(i)) if (l !== null && this.deletes(l)) o = "delete", c = He(l.content.getContent());
            else return;
            else l !== null && this.deletes(l) ? (o = "update", c = He(l.content.getContent())) : (o = "add", c = void 0);
          } else if (this.deletes(i)) o = "delete", c = He(i.content.getContent());
          else return;
          t.set(s, { action: o, oldValue: c });
        }
      }), this._keys = t;
    }
    return this._keys;
  }
  get delta() {
    return this.changes.delta;
  }
  adds(t) {
    return t.id.clock >= (this.transaction.beforeState.get(t.id.client) || 0);
  }
  get changes() {
    let t = this._changes;
    if (t === null) {
      if (this.transaction.doc._transactionCleanups.length === 0) throw G(ni);
      let n = this.target, r = rt(), s = rt(), i = [];
      if (t = { added: r, deleted: s, delta: i, keys: this.keys }, this.transaction.changed.get(n).has(null)) {
        let c = null, l = () => {
          c && i.push(c);
        };
        for (let h = n._start; h !== null; h = h.right) h.deleted ? this.deletes(h) && !this.adds(h) && ((c === null || c.delete === void 0) && (l(), c = { delete: 0 }), c.delete += h.length, s.add(h)) : this.adds(h) ? ((c === null || c.insert === void 0) && (l(), c = { insert: [] }), c.insert = c.insert.concat(h.content.getContent()), r.add(h)) : ((c === null || c.retain === void 0) && (l(), c = { retain: 0 }), c.retain += h.length);
        c !== null && c.retain === void 0 && l();
      }
      this._changes = t;
    }
    return t;
  }
};
var Pc = (e19, t) => {
  let n = [];
  for (; t._item !== null && t !== e19; ) {
    if (t._item.parentSub !== null) n.unshift(t._item.parentSub);
    else {
      let r = 0, s = t._item.parent._start;
      for (; s !== t._item && s !== null; ) !s.deleted && s.countable && (r += s.length), s = s.right;
      n.unshift(r);
    }
    t = t._item.parent;
  }
  return n;
};
var O = () => {
  kr("Invalid access: Add Yjs type to a document before reading data.");
};
var _i = 80;
var Gr = 0;
var Dr = class {
  constructor(t, n) {
    t.marker = true, this.p = t, this.index = n, this.timestamp = Gr++;
  }
};
var Kc = (e19) => {
  e19.timestamp = Gr++;
};
var Ei = (e19, t, n) => {
  e19.p.marker = false, e19.p = t, t.marker = true, e19.index = n, e19.timestamp = Gr++;
};
var Yc = (e19, t, n) => {
  if (e19.length >= _i) {
    let r = e19.reduce((s, i) => s.timestamp < i.timestamp ? s : i);
    return Ei(r, t, n), r;
  } else {
    let r = new Dr(t, n);
    return e19.push(r), r;
  }
};
var Mn = (e19, t) => {
  if (e19._start === null || t === 0 || e19._searchMarker === null) return null;
  let n = e19._searchMarker.length === 0 ? null : e19._searchMarker.reduce((i, o) => yt(t - i.index) < yt(t - o.index) ? i : o), r = e19._start, s = 0;
  for (n !== null && (r = n.p, s = n.index, Kc(n)); r.right !== null && s < t; ) {
    if (!r.deleted && r.countable) {
      if (t < s + r.length) break;
      s += r.length;
    }
    r = r.right;
  }
  for (; r.left !== null && s > t; ) r = r.left, !r.deleted && r.countable && (s -= r.length);
  for (; r.left !== null && r.left.id.client === r.id.client && r.left.id.clock + r.left.length === r.id.clock; ) r = r.left, !r.deleted && r.countable && (s -= r.length);
  return n !== null && yt(n.index - s) < r.parent.length / _i ? (Ei(n, r, s), n) : Yc(e19._searchMarker, r, s);
};
var Be = (e19, t, n) => {
  for (let r = e19.length - 1; r >= 0; r--) {
    let s = e19[r];
    if (n > 0) {
      let i = s.p;
      for (i.marker = false; i && (i.deleted || !i.countable); ) i = i.left, i && !i.deleted && i.countable && (s.index -= i.length);
      if (i === null || i.marker === true) {
        e19.splice(r, 1);
        continue;
      }
      s.p = i, i.marker = true;
    }
    (t < s.index || n > 0 && t === s.index) && (s.index = it(t, s.index + n));
  }
};
var Rn = (e19, t, n) => {
  let r = e19, s = t.changedParentTypes;
  for (; L(s, e19, () => []).push(n), e19._item !== null; ) e19 = e19._item.parent;
  di(r._eH, n, t);
};
var U = class {
  constructor() {
    this._item = null, this._map = /* @__PURE__ */ new Map(), this._start = null, this.doc = null, this._length = 0, this._eH = zs(), this._dEH = zs(), this._searchMarker = null;
  }
  get parent() {
    return this._item ? this._item.parent : null;
  }
  _integrate(t, n) {
    this.doc = t, this._item = n;
  }
  _copy() {
    throw z();
  }
  clone() {
    throw z();
  }
  _write(t) {
  }
  get _first() {
    let t = this._start;
    for (; t !== null && t.deleted; ) t = t.right;
    return t;
  }
  _callObserver(t, n) {
    !t.local && this._searchMarker && (this._searchMarker.length = 0);
  }
  observe(t) {
    Hs(this._eH, t);
  }
  observeDeep(t) {
    Hs(this._dEH, t);
  }
  unobserve(t) {
    Js(this._eH, t);
  }
  unobserveDeep(t) {
    Js(this._dEH, t);
  }
  toJSON() {
  }
};
var Ui = (e19, t, n) => {
  e19.doc ?? O(), t < 0 && (t = e19._length + t), n < 0 && (n = e19._length + n);
  let r = n - t, s = [], i = e19._start;
  for (; i !== null && r > 0; ) {
    if (i.countable && !i.deleted) {
      let o = i.content.getContent();
      if (o.length <= t) t -= o.length;
      else {
        for (let c = t; c < o.length && r > 0; c++) s.push(o[c]), r--;
        t = 0;
      }
    }
    i = i.right;
  }
  return s;
};
var Ci = (e19) => {
  e19.doc ?? O();
  let t = [], n = e19._start;
  for (; n !== null; ) {
    if (n.countable && !n.deleted) {
      let r = n.content.getContent();
      for (let s = 0; s < r.length; s++) t.push(r[s]);
    }
    n = n.right;
  }
  return t;
};
var Me = (e19, t) => {
  let n = 0, r = e19._start;
  for (e19.doc ?? O(); r !== null; ) {
    if (r.countable && !r.deleted) {
      let s = r.content.getContent();
      for (let i = 0; i < s.length; i++) t(s[i], n++, e19);
    }
    r = r.right;
  }
};
var Ai = (e19, t) => {
  let n = [];
  return Me(e19, (r, s) => {
    n.push(t(r, s, e19));
  }), n;
};
var Wc = (e19) => {
  let t = e19._start, n = null, r = 0;
  return { [Symbol.iterator]() {
    return this;
  }, next: () => {
    if (n === null) {
      for (; t !== null && t.deleted; ) t = t.right;
      if (t === null) return { done: true, value: void 0 };
      n = t.content.getContent(), r = 0, t = t.right;
    }
    let s = n[r++];
    return n.length <= r && (n = null), { done: false, value: s };
  } };
};
var Ii = (e19, t) => {
  e19.doc ?? O();
  let n = Mn(e19, t), r = e19._start;
  for (n !== null && (r = n.p, t -= n.index); r !== null; r = r.right) if (!r.deleted && r.countable) {
    if (t < r.length) return r.content.getContent()[t];
    t -= r.length;
  }
};
var vn = (e19, t, n, r) => {
  let s = n, i = e19.doc, o = i.clientID, c = i.store, l = n === null ? t._start : n.right, h = [], a = () => {
    h.length > 0 && (s = new b(m(o, _(c, o)), s, s && s.lastId, l, l && l.id, t, null, new It(h)), s.integrate(e19, 0), h = []);
  };
  r.forEach((u) => {
    if (u === null) h.push(u);
    else switch (u.constructor) {
      case Number:
      case Object:
      case Boolean:
      case Array:
      case String:
        h.push(u);
        break;
      default:
        switch (a(), u.constructor) {
          case Uint8Array:
          case ArrayBuffer:
            s = new b(m(o, _(c, o)), s, s && s.lastId, l, l && l.id, t, null, new ce(new Uint8Array(u))), s.integrate(e19, 0);
            break;
          case Ct:
            s = new b(m(o, _(c, o)), s, s && s.lastId, l, l && l.id, t, null, new le(u)), s.integrate(e19, 0);
            break;
          default:
            if (u instanceof U) s = new b(m(o, _(c, o)), s, s && s.lastId, l, l && l.id, t, null, new K(u)), s.integrate(e19, 0);
            else throw new Error("Unexpected content type in insert operation");
        }
    }
  }), a();
};
var Di = () => G("Length exceeded!");
var Ti = (e19, t, n, r) => {
  if (n > t._length) throw Di();
  if (n === 0) return t._searchMarker && Be(t._searchMarker, n, r.length), vn(e19, t, null, r);
  let s = n, i = Mn(t, n), o = t._start;
  for (i !== null && (o = i.p, n -= i.index, n === 0 && (o = o.prev, n += o && o.countable && !o.deleted ? o.length : 0)); o !== null; o = o.right) if (!o.deleted && o.countable) {
    if (n <= o.length) {
      n < o.length && M(e19, m(o.id.client, o.id.clock + n));
      break;
    }
    n -= o.length;
  }
  return t._searchMarker && Be(t._searchMarker, s, r.length), vn(e19, t, o, r);
};
var Zc = (e19, t, n) => {
  let s = (t._searchMarker || []).reduce((i, o) => o.index > i.index ? o : i, { index: 0, p: t._start }).p;
  if (s) for (; s.right; ) s = s.right;
  return vn(e19, t, s, n);
};
var vi = (e19, t, n, r) => {
  if (r === 0) return;
  let s = n, i = r, o = Mn(t, n), c = t._start;
  for (o !== null && (c = o.p, n -= o.index); c !== null && n > 0; c = c.right) !c.deleted && c.countable && (n < c.length && M(e19, m(c.id.client, c.id.clock + n)), n -= c.length);
  for (; r > 0 && c !== null; ) c.deleted || (r < c.length && M(e19, m(c.id.client, c.id.clock + r)), c.delete(e19), r -= c.length), c = c.right;
  if (r > 0) throw Di();
  t._searchMarker && Be(t._searchMarker, s, -i + r);
};
var Vn = (e19, t, n) => {
  let r = t._map.get(n);
  r !== void 0 && r.delete(e19);
};
var zr = (e19, t, n, r) => {
  let s = t._map.get(n) || null, i = e19.doc, o = i.clientID, c;
  if (r == null) c = new It([r]);
  else switch (r.constructor) {
    case Number:
    case Object:
    case Boolean:
    case Array:
    case String:
    case Date:
    case BigInt:
      c = new It([r]);
      break;
    case Uint8Array:
      c = new ce(r);
      break;
    case Ct:
      c = new le(r);
      break;
    default:
      if (r instanceof U) c = new K(r);
      else throw new Error("Unexpected content type");
  }
  new b(m(o, _(i.store, o)), s, s && s.lastId, null, null, t, n, c).integrate(e19, 0);
};
var Hr = (e19, t) => {
  e19.doc ?? O();
  let n = e19._map.get(t);
  return n !== void 0 && !n.deleted ? n.content.getContent()[n.length - 1] : void 0;
};
var Vi = (e19) => {
  let t = {};
  return e19.doc ?? O(), e19._map.forEach((n, r) => {
    n.deleted || (t[r] = n.content.getContent()[n.length - 1]);
  }), t;
};
var Oi = (e19, t) => {
  e19.doc ?? O();
  let n = e19._map.get(t);
  return n !== void 0 && !n.deleted;
};
var Qc = (e19, t) => {
  let n = {};
  return e19._map.forEach((r, s) => {
    let i = r;
    for (; i !== null && (!t.sv.has(i.id.client) || i.id.clock >= (t.sv.get(i.id.client) || 0)); ) i = i.left;
    i !== null && ut(i, t) && (n[s] = i.content.getContent()[i.length - 1]);
  }), n;
};
var Sn = (e19) => (e19.doc ?? O(), $s(e19._map.entries(), (t) => !t[1].deleted));
var Tr = class extends ne {
};
var re = class e2 extends U {
  constructor() {
    super(), this._prelimContent = [], this._searchMarker = [];
  }
  static from(t) {
    let n = new e2();
    return n.push(t), n;
  }
  _integrate(t, n) {
    super._integrate(t, n), this.insert(0, this._prelimContent), this._prelimContent = null;
  }
  _copy() {
    return new e2();
  }
  clone() {
    let t = new e2();
    return t.insert(0, this.toArray().map((n) => n instanceof U ? n.clone() : n)), t;
  }
  get length() {
    return this.doc ?? O(), this._length;
  }
  _callObserver(t, n) {
    super._callObserver(t, n), Rn(this, t, new Tr(this, t));
  }
  insert(t, n) {
    this.doc !== null ? x(this.doc, (r) => {
      Ti(r, this, t, n);
    }) : this._prelimContent.splice(t, 0, ...n);
  }
  push(t) {
    this.doc !== null ? x(this.doc, (n) => {
      Zc(n, this, t);
    }) : this._prelimContent.push(...t);
  }
  unshift(t) {
    this.insert(0, t);
  }
  delete(t, n = 1) {
    this.doc !== null ? x(this.doc, (r) => {
      vi(r, this, t, n);
    }) : this._prelimContent.splice(t, n);
  }
  get(t) {
    return Ii(this, t);
  }
  toArray() {
    return Ci(this);
  }
  slice(t = 0, n = this.length) {
    return Ui(this, t, n);
  }
  toJSON() {
    return this.map((t) => t instanceof U ? t.toJSON() : t);
  }
  map(t) {
    return Ai(this, t);
  }
  forEach(t) {
    Me(this, t);
  }
  [Symbol.iterator]() {
    return Wc(this);
  }
  _write(t) {
    t.writeTypeRef(kl);
  }
};
var tl = (e19) => new re();
var vr = class extends ne {
  constructor(t, n, r) {
    super(t, n), this.keysChanged = r;
  }
};
var se = class e3 extends U {
  constructor(t) {
    super(), this._prelimContent = null, t === void 0 ? this._prelimContent = /* @__PURE__ */ new Map() : this._prelimContent = new Map(t);
  }
  _integrate(t, n) {
    super._integrate(t, n), this._prelimContent.forEach((r, s) => {
      this.set(s, r);
    }), this._prelimContent = null;
  }
  _copy() {
    return new e3();
  }
  clone() {
    let t = new e3();
    return this.forEach((n, r) => {
      t.set(r, n instanceof U ? n.clone() : n);
    }), t;
  }
  _callObserver(t, n) {
    Rn(this, t, new vr(this, t, n));
  }
  toJSON() {
    this.doc ?? O();
    let t = {};
    return this._map.forEach((n, r) => {
      if (!n.deleted) {
        let s = n.content.getContent()[n.length - 1];
        t[r] = s instanceof U ? s.toJSON() : s;
      }
    }), t;
  }
  get size() {
    return [...Sn(this)].length;
  }
  keys() {
    return bn(Sn(this), (t) => t[0]);
  }
  values() {
    return bn(Sn(this), (t) => t[1].content.getContent()[t[1].length - 1]);
  }
  entries() {
    return bn(Sn(this), (t) => [t[0], t[1].content.getContent()[t[1].length - 1]]);
  }
  forEach(t) {
    this.doc ?? O(), this._map.forEach((n, r) => {
      n.deleted || t(n.content.getContent()[n.length - 1], r, this);
    });
  }
  [Symbol.iterator]() {
    return this.entries();
  }
  delete(t) {
    this.doc !== null ? x(this.doc, (n) => {
      Vn(n, this, t);
    }) : this._prelimContent.delete(t);
  }
  set(t, n) {
    return this.doc !== null ? x(this.doc, (r) => {
      zr(r, this, t, n);
    }) : this._prelimContent.set(t, n), n;
  }
  get(t) {
    return Hr(this, t);
  }
  has(t) {
    return Oi(this, t);
  }
  clear() {
    this.doc !== null ? x(this.doc, (t) => {
      this.forEach(function(n, r, s) {
        Vn(t, s, r);
      });
    }) : this._prelimContent.clear();
  }
  _write(t) {
    t.writeTypeRef(Sl);
  }
};
var el = (e19) => new se();
var ft = (e19, t) => e19 === t || typeof e19 == "object" && typeof t == "object" && e19 && t && Qn(e19, t);
var Re = class {
  constructor(t, n, r, s) {
    this.left = t, this.right = n, this.index = r, this.currentAttributes = s;
  }
  forward() {
    this.right === null && T(), this.right.content.constructor === C ? this.right.deleted || he(this.currentAttributes, this.right.content) : this.right.deleted || (this.index += this.right.length), this.left = this.right, this.right = this.right.right;
  }
};
var ri = (e19, t, n) => {
  for (; t.right !== null && n > 0; ) t.right.content.constructor === C ? t.right.deleted || he(t.currentAttributes, t.right.content) : t.right.deleted || (n < t.right.length && M(e19, m(t.right.id.client, t.right.id.clock + n)), t.index += t.right.length, n -= t.right.length), t.left = t.right, t.right = t.right.right;
  return t;
};
var _n = (e19, t, n, r) => {
  let s = /* @__PURE__ */ new Map(), i = r ? Mn(t, n) : null;
  if (i) {
    let o = new Re(i.p.left, i.p, i.index, s);
    return ri(e19, o, n - i.index);
  } else {
    let o = new Re(null, t._start, 0, s);
    return ri(e19, o, n);
  }
};
var Ni = (e19, t, n, r) => {
  for (; n.right !== null && (n.right.deleted === true || n.right.content.constructor === C && ft(r.get(n.right.content.key), n.right.content.value)); ) n.right.deleted || r.delete(n.right.content.key), n.forward();
  let s = e19.doc, i = s.clientID;
  r.forEach((o, c) => {
    let l = n.left, h = n.right, a = new b(m(i, _(s.store, i)), l, l && l.lastId, h, h && h.id, t, null, new C(c, o));
    a.integrate(e19, 0), n.right = a, n.forward();
  });
};
var he = (e19, t) => {
  let { key: n, value: r } = t;
  r === null ? e19.delete(n) : e19.set(n, r);
};
var Li = (e19, t) => {
  for (; e19.right !== null; ) {
    if (!(e19.right.deleted || e19.right.content.constructor === C && ft(t[e19.right.content.key] ?? null, e19.right.content.value))) break;
    e19.forward();
  }
};
var Bi = (e19, t, n, r) => {
  let s = e19.doc, i = s.clientID, o = /* @__PURE__ */ new Map();
  for (let c in r) {
    let l = r[c], h = n.currentAttributes.get(c) ?? null;
    if (!ft(h, l)) {
      o.set(c, h);
      let { left: a, right: u } = n;
      n.right = new b(m(i, _(s.store, i)), a, a && a.lastId, u, u && u.id, t, null, new C(c, l)), n.right.integrate(e19, 0), n.forward();
    }
  }
  return o;
};
var Sr = (e19, t, n, r, s) => {
  n.currentAttributes.forEach((d, f) => {
    s[f] === void 0 && (s[f] = null);
  });
  let i = e19.doc, o = i.clientID;
  Li(n, s);
  let c = Bi(e19, t, n, s), l = r.constructor === String ? new nt(r) : r instanceof U ? new K(r) : new wt(r), { left: h, right: a, index: u } = n;
  t._searchMarker && Be(t._searchMarker, n.index, l.getLength()), a = new b(m(o, _(i.store, o)), h, h && h.lastId, a, a && a.id, t, null, l), a.integrate(e19, 0), n.right = a, n.index = u, n.forward(), Ni(e19, t, n, c);
};
var si = (e19, t, n, r, s) => {
  let i = e19.doc, o = i.clientID;
  Li(n, s);
  let c = Bi(e19, t, n, s);
  t: for (; n.right !== null && (r > 0 || c.size > 0 && (n.right.deleted || n.right.content.constructor === C)); ) {
    if (!n.right.deleted) switch (n.right.content.constructor) {
      case C: {
        let { key: l, value: h } = n.right.content, a = s[l];
        if (a !== void 0) {
          if (ft(a, h)) c.delete(l);
          else {
            if (r === 0) break t;
            c.set(l, h);
          }
          n.right.delete(e19);
        } else n.currentAttributes.set(l, h);
        break;
      }
      default:
        r < n.right.length && M(e19, m(n.right.id.client, n.right.id.clock + r)), r -= n.right.length;
        break;
    }
    n.forward();
  }
  if (r > 0) {
    let l = "";
    for (; r > 0; r--) l += `
`;
    n.right = new b(m(o, _(i.store, o)), n.left, n.left && n.left.lastId, n.right, n.right && n.right.id, t, null, new nt(l)), n.right.integrate(e19, 0), n.forward();
  }
  Ni(e19, t, n, c);
};
var Mi = (e19, t, n, r, s) => {
  let i = t, o = A();
  for (; i && (!i.countable || i.deleted); ) {
    if (!i.deleted && i.content.constructor === C) {
      let h = i.content;
      o.set(h.key, h);
    }
    i = i.right;
  }
  let c = 0, l = false;
  for (; t !== i; ) {
    if (n === t && (l = true), !t.deleted) {
      let h = t.content;
      if (h.constructor === C) {
        let { key: a, value: u } = h, d = r.get(a) ?? null;
        (o.get(a) !== h || d === u) && (t.delete(e19), c++, !l && (s.get(a) ?? null) === u && d !== u && (d === null ? s.delete(a) : s.set(a, d))), !l && !t.deleted && he(s, h);
      }
    }
    t = t.right;
  }
  return c;
};
var nl = (e19, t) => {
  for (; t && t.right && (t.right.deleted || !t.right.countable); ) t = t.right;
  let n = /* @__PURE__ */ new Set();
  for (; t && (t.deleted || !t.countable); ) {
    if (!t.deleted && t.content.constructor === C) {
      let r = t.content.key;
      n.has(r) ? t.delete(e19) : n.add(r);
    }
    t = t.left;
  }
};
var rl = (e19) => {
  let t = 0;
  return x(e19.doc, (n) => {
    let r = e19._start, s = e19._start, i = A(), o = ze(i);
    for (; s; ) s.deleted === false && (s.content.constructor === C ? he(o, s.content) : (t += Mi(n, r, s, i, o), i = ze(o), r = s)), s = s.right;
  }), t;
};
var sl = (e19) => {
  let t = /* @__PURE__ */ new Set(), n = e19.doc;
  for (let [r, s] of e19.afterState.entries()) {
    let i = e19.beforeState.get(r) || 0;
    s !== i && mi(e19, n.store.clients.get(r), i, s, (o) => {
      !o.deleted && o.content.constructor === C && o.constructor !== R && t.add(o.parent);
    });
  }
  x(n, (r) => {
    Qt(e19, e19.deleteSet, (s) => {
      if (s instanceof R || !s.parent._hasFormatting || t.has(s.parent)) return;
      let i = s.parent;
      s.content.constructor === C ? t.add(i) : nl(r, s);
    });
    for (let s of t) rl(s);
  });
};
var ii = (e19, t, n) => {
  let r = n, s = ze(t.currentAttributes), i = t.right;
  for (; n > 0 && t.right !== null; ) {
    if (t.right.deleted === false) switch (t.right.content.constructor) {
      case K:
      case wt:
      case nt:
        n < t.right.length && M(e19, m(t.right.id.client, t.right.id.clock + n)), n -= t.right.length, t.right.delete(e19);
        break;
    }
    t.forward();
  }
  i && Mi(e19, i, t.right, s, t.currentAttributes);
  let o = (t.left || t.right).parent;
  return o._searchMarker && Be(o._searchMarker, t.index, -r + n), t;
};
var Vr = class extends ne {
  constructor(t, n, r) {
    super(t, n), this.childListChanged = false, this.keysChanged = /* @__PURE__ */ new Set(), r.forEach((s) => {
      s === null ? this.childListChanged = true : this.keysChanged.add(s);
    });
  }
  get changes() {
    if (this._changes === null) {
      let t = { keys: this.keys, delta: this.delta, added: /* @__PURE__ */ new Set(), deleted: /* @__PURE__ */ new Set() };
      this._changes = t;
    }
    return this._changes;
  }
  get delta() {
    if (this._delta === null) {
      let t = this.target.doc, n = [];
      x(t, (r) => {
        let s = /* @__PURE__ */ new Map(), i = /* @__PURE__ */ new Map(), o = this.target._start, c = null, l = {}, h = "", a = 0, u = 0, d = () => {
          if (c !== null) {
            let f = null;
            switch (c) {
              case "delete":
                u > 0 && (f = { delete: u }), u = 0;
                break;
              case "insert":
                (typeof h == "object" || h.length > 0) && (f = { insert: h }, s.size > 0 && (f.attributes = {}, s.forEach((p, y) => {
                  p !== null && (f.attributes[y] = p);
                }))), h = "";
                break;
              case "retain":
                a > 0 && (f = { retain: a }, gs(l) || (f.attributes = fs({}, l))), a = 0;
                break;
            }
            f && n.push(f), c = null;
          }
        };
        for (; o !== null; ) {
          switch (o.content.constructor) {
            case K:
            case wt:
              this.adds(o) ? this.deletes(o) || (d(), c = "insert", h = o.content.getContent()[0], d()) : this.deletes(o) ? (c !== "delete" && (d(), c = "delete"), u += 1) : o.deleted || (c !== "retain" && (d(), c = "retain"), a += 1);
              break;
            case nt:
              this.adds(o) ? this.deletes(o) || (c !== "insert" && (d(), c = "insert"), h += o.content.str) : this.deletes(o) ? (c !== "delete" && (d(), c = "delete"), u += o.length) : o.deleted || (c !== "retain" && (d(), c = "retain"), a += o.length);
              break;
            case C: {
              let { key: f, value: p } = o.content;
              if (this.adds(o)) {
                if (!this.deletes(o)) {
                  let y = s.get(f) ?? null;
                  ft(y, p) ? p !== null && o.delete(r) : (c === "retain" && d(), ft(p, i.get(f) ?? null) ? delete l[f] : l[f] = p);
                }
              } else if (this.deletes(o)) {
                i.set(f, p);
                let y = s.get(f) ?? null;
                ft(y, p) || (c === "retain" && d(), l[f] = y);
              } else if (!o.deleted) {
                i.set(f, p);
                let y = l[f];
                y !== void 0 && (ft(y, p) ? y !== null && o.delete(r) : (c === "retain" && d(), p === null ? delete l[f] : l[f] = p));
              }
              o.deleted || (c === "insert" && d(), he(s, o.content));
              break;
            }
          }
          o = o.right;
        }
        for (d(); n.length > 0; ) {
          let f = n[n.length - 1];
          if (f.retain !== void 0 && f.attributes === void 0) n.pop();
          else break;
        }
      }), this._delta = n;
    }
    return this._delta;
  }
};
var $e = class e4 extends U {
  constructor(t) {
    super(), this._pending = t !== void 0 ? [() => this.insert(0, t)] : [], this._searchMarker = [], this._hasFormatting = false;
  }
  get length() {
    return this.doc ?? O(), this._length;
  }
  _integrate(t, n) {
    super._integrate(t, n);
    try {
      this._pending.forEach((r) => r());
    } catch (r) {
      console.error(r);
    }
    this._pending = null;
  }
  _copy() {
    return new e4();
  }
  clone() {
    let t = new e4();
    return t.applyDelta(this.toDelta()), t;
  }
  _callObserver(t, n) {
    super._callObserver(t, n);
    let r = new Vr(this, t, n);
    Rn(this, t, r), !t.local && this._hasFormatting && (t._needFormattingCleanup = true);
  }
  toString() {
    this.doc ?? O();
    let t = "", n = this._start;
    for (; n !== null; ) !n.deleted && n.countable && n.content.constructor === nt && (t += n.content.str), n = n.right;
    return t;
  }
  toJSON() {
    return this.toString();
  }
  applyDelta(t, { sanitize: n = true } = {}) {
    this.doc !== null ? x(this.doc, (r) => {
      let s = new Re(null, this._start, 0, /* @__PURE__ */ new Map());
      for (let i = 0; i < t.length; i++) {
        let o = t[i];
        if (o.insert !== void 0) {
          let c = !n && typeof o.insert == "string" && i === t.length - 1 && s.right === null && o.insert.slice(-1) === `
` ? o.insert.slice(0, -1) : o.insert;
          (typeof c != "string" || c.length > 0) && Sr(r, this, s, c, o.attributes || {});
        } else o.retain !== void 0 ? si(r, this, s, o.retain, o.attributes || {}) : o.delete !== void 0 && ii(r, s, o.delete);
      }
    }) : this._pending.push(() => this.applyDelta(t));
  }
  toDelta(t, n, r) {
    this.doc ?? O();
    let s = [], i = /* @__PURE__ */ new Map(), o = this.doc, c = "", l = this._start;
    function h() {
      if (c.length > 0) {
        let u = {}, d = false;
        i.forEach((p, y) => {
          d = true, u[y] = p;
        });
        let f = { insert: c };
        d && (f.attributes = u), s.push(f), c = "";
      }
    }
    let a = () => {
      for (; l !== null; ) {
        if (ut(l, t) || n !== void 0 && ut(l, n)) switch (l.content.constructor) {
          case nt: {
            let u = i.get("ychange");
            t !== void 0 && !ut(l, t) ? (u === void 0 || u.user !== l.id.client || u.type !== "removed") && (h(), i.set("ychange", r ? r("removed", l.id) : { type: "removed" })) : n !== void 0 && !ut(l, n) ? (u === void 0 || u.user !== l.id.client || u.type !== "added") && (h(), i.set("ychange", r ? r("added", l.id) : { type: "added" })) : u !== void 0 && (h(), i.delete("ychange")), c += l.content.str;
            break;
          }
          case K:
          case wt: {
            h();
            let u = { insert: l.content.getContent()[0] };
            if (i.size > 0) {
              let d = {};
              u.attributes = d, i.forEach((f, p) => {
                d[p] = f;
              });
            }
            s.push(u);
            break;
          }
          case C:
            ut(l, t) && (h(), he(i, l.content));
            break;
        }
        l = l.right;
      }
      h();
    };
    return t || n ? x(o, (u) => {
      t && Ur(u, t), n && Ur(u, n), a();
    }, "cleanup") : a(), s;
  }
  insert(t, n, r) {
    if (n.length <= 0) return;
    let s = this.doc;
    s !== null ? x(s, (i) => {
      let o = _n(i, this, t, !r);
      r || (r = {}, o.currentAttributes.forEach((c, l) => {
        r[l] = c;
      })), Sr(i, this, o, n, r);
    }) : this._pending.push(() => this.insert(t, n, r));
  }
  insertEmbed(t, n, r) {
    let s = this.doc;
    s !== null ? x(s, (i) => {
      let o = _n(i, this, t, !r);
      Sr(i, this, o, n, r || {});
    }) : this._pending.push(() => this.insertEmbed(t, n, r || {}));
  }
  delete(t, n) {
    if (n === 0) return;
    let r = this.doc;
    r !== null ? x(r, (s) => {
      ii(s, _n(s, this, t, true), n);
    }) : this._pending.push(() => this.delete(t, n));
  }
  format(t, n, r) {
    if (n === 0) return;
    let s = this.doc;
    s !== null ? x(s, (i) => {
      let o = _n(i, this, t, false);
      o.right !== null && si(i, this, o, n, r);
    }) : this._pending.push(() => this.format(t, n, r));
  }
  removeAttribute(t) {
    this.doc !== null ? x(this.doc, (n) => {
      Vn(n, this, t);
    }) : this._pending.push(() => this.removeAttribute(t));
  }
  setAttribute(t, n) {
    this.doc !== null ? x(this.doc, (r) => {
      zr(r, this, t, n);
    }) : this._pending.push(() => this.setAttribute(t, n));
  }
  getAttribute(t) {
    return Hr(this, t);
  }
  getAttributes() {
    return Vi(this);
  }
  _write(t) {
    t.writeTypeRef(_l);
  }
};
var il = (e19) => new $e();
var ve = class {
  constructor(t, n = () => true) {
    this._filter = n, this._root = t, this._currentNode = t._start, this._firstCall = true, t.doc ?? O();
  }
  [Symbol.iterator]() {
    return this;
  }
  next() {
    let t = this._currentNode, n = t && t.content && t.content.type;
    if (t !== null && (!this._firstCall || t.deleted || !this._filter(n))) do
      if (n = t.content.type, !t.deleted && (n.constructor === oe || n.constructor === ie) && n._start !== null) t = n._start;
      else for (; t !== null; ) {
        let r = t.next;
        if (r !== null) {
          t = r;
          break;
        } else t.parent === this._root ? t = null : t = t.parent._item;
      }
    while (t !== null && (t.deleted || !this._filter(t.content.type)));
    return this._firstCall = false, t === null ? { value: void 0, done: true } : (this._currentNode = t, { value: t.content.type, done: false });
  }
};
var ie = class e5 extends U {
  constructor() {
    super(), this._prelimContent = [];
  }
  get firstChild() {
    let t = this._first;
    return t ? t.content.getContent()[0] : null;
  }
  _integrate(t, n) {
    super._integrate(t, n), this.insert(0, this._prelimContent), this._prelimContent = null;
  }
  _copy() {
    return new e5();
  }
  clone() {
    let t = new e5();
    return t.insert(0, this.toArray().map((n) => n instanceof U ? n.clone() : n)), t;
  }
  get length() {
    return this.doc ?? O(), this._prelimContent === null ? this._length : this._prelimContent.length;
  }
  createTreeWalker(t) {
    return new ve(this, t);
  }
  querySelector(t) {
    t = t.toUpperCase();
    let r = new ve(this, (s) => s.nodeName && s.nodeName.toUpperCase() === t).next();
    return r.done ? null : r.value;
  }
  querySelectorAll(t) {
    return t = t.toUpperCase(), Y(new ve(this, (n) => n.nodeName && n.nodeName.toUpperCase() === t));
  }
  _callObserver(t, n) {
    Rn(this, t, new Or(this, n, t));
  }
  toString() {
    return Ai(this, (t) => t.toString()).join("");
  }
  toJSON() {
    return this.toString();
  }
  toDOM(t = document, n = {}, r) {
    let s = t.createDocumentFragment();
    return r !== void 0 && r._createAssociation(s, this), Me(this, (i) => {
      s.insertBefore(i.toDOM(t, n, r), null);
    }), s;
  }
  insert(t, n) {
    this.doc !== null ? x(this.doc, (r) => {
      Ti(r, this, t, n);
    }) : this._prelimContent.splice(t, 0, ...n);
  }
  insertAfter(t, n) {
    if (this.doc !== null) x(this.doc, (r) => {
      let s = t && t instanceof U ? t._item : t;
      vn(r, this, s, n);
    });
    else {
      let r = this._prelimContent, s = t === null ? 0 : r.findIndex((i) => i === t) + 1;
      if (s === 0 && t !== null) throw G("Reference item not found");
      r.splice(s, 0, ...n);
    }
  }
  delete(t, n = 1) {
    this.doc !== null ? x(this.doc, (r) => {
      vi(r, this, t, n);
    }) : this._prelimContent.splice(t, n);
  }
  toArray() {
    return Ci(this);
  }
  push(t) {
    this.insert(this.length, t);
  }
  unshift(t) {
    this.insert(0, t);
  }
  get(t) {
    return Ii(this, t);
  }
  slice(t = 0, n = this.length) {
    return Ui(this, t, n);
  }
  forEach(t) {
    Me(this, t);
  }
  _write(t) {
    t.writeTypeRef(Ul);
  }
};
var ol = (e19) => new ie();
var oe = class e6 extends ie {
  constructor(t = "UNDEFINED") {
    super(), this.nodeName = t, this._prelimAttrs = /* @__PURE__ */ new Map();
  }
  get nextSibling() {
    let t = this._item ? this._item.next : null;
    return t ? t.content.type : null;
  }
  get prevSibling() {
    let t = this._item ? this._item.prev : null;
    return t ? t.content.type : null;
  }
  _integrate(t, n) {
    super._integrate(t, n), this._prelimAttrs.forEach((r, s) => {
      this.setAttribute(s, r);
    }), this._prelimAttrs = null;
  }
  _copy() {
    return new e6(this.nodeName);
  }
  clone() {
    let t = new e6(this.nodeName), n = this.getAttributes();
    return ps(n, (r, s) => {
      typeof r == "string" && t.setAttribute(s, r);
    }), t.insert(0, this.toArray().map((r) => r instanceof U ? r.clone() : r)), t;
  }
  toString() {
    let t = this.getAttributes(), n = [], r = [];
    for (let c in t) r.push(c);
    r.sort();
    let s = r.length;
    for (let c = 0; c < s; c++) {
      let l = r[c];
      n.push(l + '="' + t[l] + '"');
    }
    let i = this.nodeName.toLocaleLowerCase(), o = n.length > 0 ? " " + n.join(" ") : "";
    return `<${i}${o}>${super.toString()}</${i}>`;
  }
  removeAttribute(t) {
    this.doc !== null ? x(this.doc, (n) => {
      Vn(n, this, t);
    }) : this._prelimAttrs.delete(t);
  }
  setAttribute(t, n) {
    this.doc !== null ? x(this.doc, (r) => {
      zr(r, this, t, n);
    }) : this._prelimAttrs.set(t, n);
  }
  getAttribute(t) {
    return Hr(this, t);
  }
  hasAttribute(t) {
    return Oi(this, t);
  }
  getAttributes(t) {
    return t ? Qc(this, t) : Vi(this);
  }
  toDOM(t = document, n = {}, r) {
    let s = t.createElement(this.nodeName), i = this.getAttributes();
    for (let o in i) {
      let c = i[o];
      typeof c == "string" && s.setAttribute(o, c);
    }
    return Me(this, (o) => {
      s.appendChild(o.toDOM(t, n, r));
    }), r !== void 0 && r._createAssociation(s, this), s;
  }
  _write(t) {
    t.writeTypeRef(El), t.writeKey(this.nodeName);
  }
};
var cl = (e19) => new oe(e19.readKey());
var Or = class extends ne {
  constructor(t, n, r) {
    super(t, r), this.childListChanged = false, this.attributesChanged = /* @__PURE__ */ new Set(), n.forEach((s) => {
      s === null ? this.childListChanged = true : this.attributesChanged.add(s);
    });
  }
};
var On = class e7 extends se {
  constructor(t) {
    super(), this.hookName = t;
  }
  _copy() {
    return new e7(this.hookName);
  }
  clone() {
    let t = new e7(this.hookName);
    return this.forEach((n, r) => {
      t.set(r, n);
    }), t;
  }
  toDOM(t = document, n = {}, r) {
    let s = n[this.hookName], i;
    return s !== void 0 ? i = s.createDom(this) : i = document.createElement(this.hookName), i.setAttribute("data-yjs-hook", this.hookName), r !== void 0 && r._createAssociation(i, this), i;
  }
  _write(t) {
    t.writeTypeRef(Cl), t.writeKey(this.hookName);
  }
};
var ll = (e19) => new On(e19.readKey());
var Nr = class e8 extends $e {
  get nextSibling() {
    let t = this._item ? this._item.next : null;
    return t ? t.content.type : null;
  }
  get prevSibling() {
    let t = this._item ? this._item.prev : null;
    return t ? t.content.type : null;
  }
  _copy() {
    return new e8();
  }
  clone() {
    let t = new e8();
    return t.applyDelta(this.toDelta()), t;
  }
  toDOM(t = document, n, r) {
    let s = t.createTextNode(this.toString());
    return r !== void 0 && r._createAssociation(s, this), s;
  }
  toString() {
    return this.toDelta().map((t) => {
      let n = [];
      for (let s in t.attributes) {
        let i = [];
        for (let o in t.attributes[s]) i.push({ key: o, value: t.attributes[s][o] });
        i.sort((o, c) => o.key < c.key ? -1 : 1), n.push({ nodeName: s, attrs: i });
      }
      n.sort((s, i) => s.nodeName < i.nodeName ? -1 : 1);
      let r = "";
      for (let s = 0; s < n.length; s++) {
        let i = n[s];
        r += `<${i.nodeName}`;
        for (let o = 0; o < i.attrs.length; o++) {
          let c = i.attrs[o];
          r += ` ${c.key}="${c.value}"`;
        }
        r += ">";
      }
      r += t.insert;
      for (let s = n.length - 1; s >= 0; s--) r += `</${n[s].nodeName}>`;
      return r;
    }).join("");
  }
  toJSON() {
    return this.toString();
  }
  _write(t) {
    t.writeTypeRef(Al);
  }
};
var al = (e19) => new Nr();
var Fe = class {
  constructor(t, n) {
    this.id = t, this.length = n;
  }
  get deleted() {
    throw z();
  }
  mergeWith(t) {
    return false;
  }
  write(t, n, r) {
    throw z();
  }
  integrate(t, n) {
    throw z();
  }
};
var hl = 0;
var R = class extends Fe {
  get deleted() {
    return true;
  }
  delete() {
  }
  mergeWith(t) {
    return this.constructor !== t.constructor ? false : (this.length += t.length, true);
  }
  integrate(t, n) {
    n > 0 && (this.id.clock += n, this.length -= n), gi(t.doc.store, this);
  }
  write(t, n) {
    t.writeInfo(hl), t.writeLen(this.length - n);
  }
  getMissing(t, n) {
    return null;
  }
};
var ce = class e9 {
  constructor(t) {
    this.content = t;
  }
  getLength() {
    return 1;
  }
  getContent() {
    return [this.content];
  }
  isCountable() {
    return true;
  }
  copy() {
    return new e9(this.content);
  }
  splice(t) {
    throw z();
  }
  mergeWith(t) {
    return false;
  }
  integrate(t, n) {
  }
  delete(t) {
  }
  gc(t) {
  }
  write(t, n) {
    t.writeBuf(this.content);
  }
  getRef() {
    return 3;
  }
};
var ul = (e19) => new ce(e19.readBuf());
var je = class e10 {
  constructor(t) {
    this.len = t;
  }
  getLength() {
    return this.len;
  }
  getContent() {
    return [];
  }
  isCountable() {
    return false;
  }
  copy() {
    return new e10(this.len);
  }
  splice(t) {
    let n = new e10(this.len - t);
    return this.len = t, n;
  }
  mergeWith(t) {
    return this.len += t.len, true;
  }
  integrate(t, n) {
    Oe(t.deleteSet, n.id.client, n.id.clock, this.len), n.markDeleted();
  }
  delete(t) {
  }
  gc(t) {
  }
  write(t, n) {
    t.writeLen(this.len - n);
  }
  getRef() {
    return 1;
  }
};
var dl = (e19) => new je(e19.readLen());
var Ri = (e19, t) => new Ct({ guid: e19, ...t, shouldLoad: t.shouldLoad || t.autoLoad || false });
var le = class e11 {
  constructor(t) {
    t._item && console.error("This document was already integrated as a sub-document. You should create a second instance instead with the same guid."), this.doc = t;
    let n = {};
    this.opts = n, t.gc || (n.gc = false), t.autoLoad && (n.autoLoad = true), t.meta !== null && (n.meta = t.meta);
  }
  getLength() {
    return 1;
  }
  getContent() {
    return [this.doc];
  }
  isCountable() {
    return true;
  }
  copy() {
    return new e11(Ri(this.doc.guid, this.opts));
  }
  splice(t) {
    throw z();
  }
  mergeWith(t) {
    return false;
  }
  integrate(t, n) {
    this.doc._item = n, t.subdocsAdded.add(this.doc), this.doc.shouldLoad && t.subdocsLoaded.add(this.doc);
  }
  delete(t) {
    t.subdocsAdded.has(this.doc) ? t.subdocsAdded.delete(this.doc) : t.subdocsRemoved.add(this.doc);
  }
  gc(t) {
  }
  write(t, n) {
    t.writeString(this.doc.guid), t.writeAny(this.opts);
  }
  getRef() {
    return 9;
  }
};
var fl = (e19) => new le(Ri(e19.readString(), e19.readAny()));
var wt = class e12 {
  constructor(t) {
    this.embed = t;
  }
  getLength() {
    return 1;
  }
  getContent() {
    return [this.embed];
  }
  isCountable() {
    return true;
  }
  copy() {
    return new e12(this.embed);
  }
  splice(t) {
    throw z();
  }
  mergeWith(t) {
    return false;
  }
  integrate(t, n) {
  }
  delete(t) {
  }
  gc(t) {
  }
  write(t, n) {
    t.writeJSON(this.embed);
  }
  getRef() {
    return 5;
  }
};
var pl = (e19) => new wt(e19.readJSON());
var C = class e13 {
  constructor(t, n) {
    this.key = t, this.value = n;
  }
  getLength() {
    return 1;
  }
  getContent() {
    return [];
  }
  isCountable() {
    return false;
  }
  copy() {
    return new e13(this.key, this.value);
  }
  splice(t) {
    throw z();
  }
  mergeWith(t) {
    return false;
  }
  integrate(t, n) {
    let r = n.parent;
    r._searchMarker = null, r._hasFormatting = true;
  }
  delete(t) {
  }
  gc(t) {
  }
  write(t, n) {
    t.writeKey(this.key), t.writeJSON(this.value);
  }
  getRef() {
    return 6;
  }
};
var gl = (e19) => new C(e19.readKey(), e19.readJSON());
var Nn = class e14 {
  constructor(t) {
    this.arr = t;
  }
  getLength() {
    return this.arr.length;
  }
  getContent() {
    return this.arr;
  }
  isCountable() {
    return true;
  }
  copy() {
    return new e14(this.arr);
  }
  splice(t) {
    let n = new e14(this.arr.slice(t));
    return this.arr = this.arr.slice(0, t), n;
  }
  mergeWith(t) {
    return this.arr = this.arr.concat(t.arr), true;
  }
  integrate(t, n) {
  }
  delete(t) {
  }
  gc(t) {
  }
  write(t, n) {
    let r = this.arr.length;
    t.writeLen(r - n);
    for (let s = n; s < r; s++) {
      let i = this.arr[s];
      t.writeString(i === void 0 ? "undefined" : JSON.stringify(i));
    }
  }
  getRef() {
    return 2;
  }
};
var ml = (e19) => {
  let t = e19.readLen(), n = [];
  for (let r = 0; r < t; r++) {
    let s = e19.readString();
    s === "undefined" ? n.push(void 0) : n.push(JSON.parse(s));
  }
  return new Nn(n);
};
var wl = Ee("node_env") === "development";
var It = class e15 {
  constructor(t) {
    this.arr = t, wl && tr(t);
  }
  getLength() {
    return this.arr.length;
  }
  getContent() {
    return this.arr;
  }
  isCountable() {
    return true;
  }
  copy() {
    return new e15(this.arr);
  }
  splice(t) {
    let n = new e15(this.arr.slice(t));
    return this.arr = this.arr.slice(0, t), n;
  }
  mergeWith(t) {
    return this.arr = this.arr.concat(t.arr), true;
  }
  integrate(t, n) {
  }
  delete(t) {
  }
  gc(t) {
  }
  write(t, n) {
    let r = this.arr.length;
    t.writeLen(r - n);
    for (let s = n; s < r; s++) {
      let i = this.arr[s];
      t.writeAny(i);
    }
  }
  getRef() {
    return 8;
  }
};
var yl = (e19) => {
  let t = e19.readLen(), n = [];
  for (let r = 0; r < t; r++) n.push(e19.readAny());
  return new It(n);
};
var nt = class e16 {
  constructor(t) {
    this.str = t;
  }
  getLength() {
    return this.str.length;
  }
  getContent() {
    return this.str.split("");
  }
  isCountable() {
    return true;
  }
  copy() {
    return new e16(this.str);
  }
  splice(t) {
    let n = new e16(this.str.slice(t));
    this.str = this.str.slice(0, t);
    let r = this.str.charCodeAt(t - 1);
    return r >= 55296 && r <= 56319 && (this.str = this.str.slice(0, t - 1) + "\uFFFD", n.str = "\uFFFD" + n.str.slice(1)), n;
  }
  mergeWith(t) {
    return this.str += t.str, true;
  }
  integrate(t, n) {
  }
  delete(t) {
  }
  gc(t) {
  }
  write(t, n) {
    t.writeString(n === 0 ? this.str : this.str.slice(n));
  }
  getRef() {
    return 4;
  }
};
var xl = (e19) => new nt(e19.readString());
var bl = [tl, el, il, cl, ol, ll, al];
var kl = 0;
var Sl = 1;
var _l = 2;
var El = 3;
var Ul = 4;
var Cl = 5;
var Al = 6;
var K = class e17 {
  constructor(t) {
    this.type = t;
  }
  getLength() {
    return 1;
  }
  getContent() {
    return [this.type];
  }
  isCountable() {
    return true;
  }
  copy() {
    return new e17(this.type._copy());
  }
  splice(t) {
    throw z();
  }
  mergeWith(t) {
    return false;
  }
  integrate(t, n) {
    this.type._integrate(t.doc, n);
  }
  delete(t) {
    let n = this.type._start;
    for (; n !== null; ) n.deleted ? n.id.clock < (t.beforeState.get(n.id.client) || 0) && t._mergeStructs.push(n) : n.delete(t), n = n.right;
    this.type._map.forEach((r) => {
      r.deleted ? r.id.clock < (t.beforeState.get(r.id.client) || 0) && t._mergeStructs.push(r) : r.delete(t);
    }), t.changed.delete(this.type);
  }
  gc(t) {
    let n = this.type._start;
    for (; n !== null; ) n.gc(t, true), n = n.right;
    this.type._start = null, this.type._map.forEach((r) => {
      for (; r !== null; ) r.gc(t, true), r = r.left;
    }), this.type._map = /* @__PURE__ */ new Map();
  }
  write(t, n) {
    this.type._write(t);
  }
  getRef() {
    return 7;
  }
};
var Il = (e19) => new K(bl[e19.readTypeRef()](e19));
var Ln = (e19, t, n) => {
  let { client: r, clock: s } = t.id, i = new b(m(r, s + n), t, m(r, s + n - 1), t.right, t.rightOrigin, t.parent, t.parentSub, t.content.splice(n));
  return t.deleted && i.markDeleted(), t.keep && (i.keep = true), t.redone !== null && (i.redone = m(t.redone.client, t.redone.clock + n)), t.right = i, i.right !== null && (i.right.left = i), e19._mergeStructs.push(i), i.parentSub !== null && i.right === null && i.parent._map.set(i.parentSub, i), t.length = n, i;
};
var b = class e18 extends Fe {
  constructor(t, n, r, s, i, o, c, l) {
    super(t, l.getLength()), this.origin = r, this.left = n, this.right = s, this.rightOrigin = i, this.parent = o, this.parentSub = c, this.redone = null, this.content = l, this.info = this.content.isCountable() ? 2 : 0;
  }
  set marker(t) {
    (this.info & 8) > 0 !== t && (this.info ^= 8);
  }
  get marker() {
    return (this.info & 8) > 0;
  }
  get keep() {
    return (this.info & 1) > 0;
  }
  set keep(t) {
    this.keep !== t && (this.info ^= 1);
  }
  get countable() {
    return (this.info & 2) > 0;
  }
  get deleted() {
    return (this.info & 4) > 0;
  }
  set deleted(t) {
    this.deleted !== t && (this.info ^= 4);
  }
  markDeleted() {
    this.info |= 4;
  }
  getMissing(t, n) {
    if (this.origin && this.origin.client !== this.id.client && this.origin.clock >= _(n, this.origin.client)) return this.origin.client;
    if (this.rightOrigin && this.rightOrigin.client !== this.id.client && this.rightOrigin.clock >= _(n, this.rightOrigin.client)) return this.rightOrigin.client;
    if (this.parent && this.parent.constructor === pt && this.id.client !== this.parent.client && this.parent.clock >= _(n, this.parent.client)) return this.parent.client;
    if (this.origin && (this.left = Ys(t, n, this.origin), this.origin = this.left.lastId), this.rightOrigin && (this.right = M(t, this.rightOrigin), this.rightOrigin = this.right.id), this.left && this.left.constructor === R || this.right && this.right.constructor === R) this.parent = null;
    else if (!this.parent) this.left && this.left.constructor === e18 ? (this.parent = this.left.parent, this.parentSub = this.left.parentSub) : this.right && this.right.constructor === e18 && (this.parent = this.right.parent, this.parentSub = this.right.parentSub);
    else if (this.parent.constructor === pt) {
      let r = Zt(n, this.parent);
      r.constructor === R ? this.parent = null : this.parent = r.content.type;
    }
    return null;
  }
  integrate(t, n) {
    if (n > 0 && (this.id.clock += n, this.left = Ys(t, t.doc.store, m(this.id.client, this.id.clock - 1)), this.origin = this.left.lastId, this.content = this.content.splice(n), this.length -= n), this.parent) {
      if (!this.left && (!this.right || this.right.left !== null) || this.left && this.left.right !== this.right) {
        let r = this.left, s;
        if (r !== null) s = r.right;
        else if (this.parentSub !== null) for (s = this.parent._map.get(this.parentSub) || null; s !== null && s.left !== null; ) s = s.left;
        else s = this.parent._start;
        let i = /* @__PURE__ */ new Set(), o = /* @__PURE__ */ new Set();
        for (; s !== null && s !== this.right; ) {
          if (o.add(s), i.add(s), Wt(this.origin, s.origin)) {
            if (s.id.client < this.id.client) r = s, i.clear();
            else if (Wt(this.rightOrigin, s.rightOrigin)) break;
          } else if (s.origin !== null && o.has(Zt(t.doc.store, s.origin))) i.has(Zt(t.doc.store, s.origin)) || (r = s, i.clear());
          else break;
          s = s.right;
        }
        this.left = r;
      }
      if (this.left !== null) {
        let r = this.left.right;
        this.right = r, this.left.right = this;
      } else {
        let r;
        if (this.parentSub !== null) for (r = this.parent._map.get(this.parentSub) || null; r !== null && r.left !== null; ) r = r.left;
        else r = this.parent._start, this.parent._start = this;
        this.right = r;
      }
      this.right !== null ? this.right.left = this : this.parentSub !== null && (this.parent._map.set(this.parentSub, this), this.left !== null && this.left.delete(t)), this.parentSub === null && this.countable && !this.deleted && (this.parent._length += this.length), gi(t.doc.store, this), this.content.integrate(t, this), Zs(t, this.parent, this.parentSub), (this.parent._item !== null && this.parent._item.deleted || this.parentSub !== null && this.right !== null) && this.delete(t);
    } else new R(this.id, this.length).integrate(t, 0);
  }
  get next() {
    let t = this.right;
    for (; t !== null && t.deleted; ) t = t.right;
    return t;
  }
  get prev() {
    let t = this.left;
    for (; t !== null && t.deleted; ) t = t.left;
    return t;
  }
  get lastId() {
    return this.length === 1 ? this.id : m(this.id.client, this.id.clock + this.length - 1);
  }
  mergeWith(t) {
    if (this.constructor === t.constructor && Wt(t.origin, this.lastId) && this.right === t && Wt(this.rightOrigin, t.rightOrigin) && this.id.client === t.id.client && this.id.clock + this.length === t.id.clock && this.deleted === t.deleted && this.redone === null && t.redone === null && this.content.constructor === t.content.constructor && this.content.mergeWith(t.content)) {
      let n = this.parent._searchMarker;
      return n && n.forEach((r) => {
        r.p === t && (r.p = this, !this.deleted && this.countable && (r.index -= this.length));
      }), t.keep && (this.keep = true), this.right = t.right, this.right !== null && (this.right.left = this), this.length += t.length, true;
    }
    return false;
  }
  delete(t) {
    if (!this.deleted) {
      let n = this.parent;
      this.countable && this.parentSub === null && (n._length -= this.length), this.markDeleted(), Oe(t.deleteSet, this.id.client, this.id.clock, this.length), Zs(t, n, this.parentSub), this.content.delete(t);
    }
  }
  gc(t, n) {
    if (!this.deleted) throw T();
    this.content.gc(t), n ? $c(t, this, new R(this.id, this.length)) : this.content = new je(this.length);
  }
  write(t, n) {
    let r = n > 0 ? m(this.id.client, this.id.clock + n - 1) : this.origin, s = this.rightOrigin, i = this.parentSub, o = this.content.getRef() & 31 | (r === null ? 0 : 128) | (s === null ? 0 : 64) | (i === null ? 0 : 32);
    if (t.writeInfo(o), r !== null && t.writeLeftID(r), s !== null && t.writeRightID(s), r === null && s === null) {
      let c = this.parent;
      if (c._item !== void 0) {
        let l = c._item;
        if (l === null) {
          let h = fi(c);
          t.writeParentInfo(true), t.writeString(h);
        } else t.writeParentInfo(false), t.writeLeftID(l.id);
      } else c.constructor === String ? (t.writeParentInfo(true), t.writeString(c)) : c.constructor === pt ? (t.writeParentInfo(false), t.writeLeftID(c)) : T();
      i !== null && t.writeString(i);
    }
    this.content.write(t, n);
  }
};
var Fi = (e19, t) => Dl[t & 31](e19);
var Dl = [() => {
  T();
}, dl, ml, ul, xl, pl, gl, Il, yl, fl, () => {
  T();
}];
var Tl = 10;
var N = class extends Fe {
  get deleted() {
    return true;
  }
  delete() {
  }
  mergeWith(t) {
    return this.constructor !== t.constructor ? false : (this.length += t.length, true);
  }
  integrate(t, n) {
    T();
  }
  write(t, n) {
    t.writeInfo(Tl), g(t.restEncoder, this.length - n);
  }
  getMissing(t, n) {
    return null;
  }
};
var ji = typeof globalThis < "u" ? globalThis : typeof window < "u" ? window : typeof global < "u" ? global : {};
var qi = "__ $YJS$ __";
ji[qi] === true && console.error("Yjs was already imported. This breaks constructor checks and will lead to issues! - https://github.com/yjs/yjs/issues/438");
ji[qi] = true;

// src/page/ybind/containment.js
function merged(map) {
  for (const [client, list] of map) {
    list.sort((a, b2) => a[0] - b2[0]);
    const out = [];
    for (const range of list) {
      const last = out[out.length - 1];
      if (last && range[0] <= last[1]) {
        if (range[1] > last[1]) last[1] = range[1];
      } else out.push([range[0], range[1]]);
    }
    map.set(client, out);
  }
  return map;
}
var add = (map, client, from, to2) => {
  if (to2 <= from) return;
  const list = map.get(client);
  if (list) list.push([from, to2]);
  else map.set(client, [[from, to2]]);
};
function rangesOf(update) {
  const { structs, ds: ds2 } = qc(update);
  const items = /* @__PURE__ */ new Map();
  for (const struct of structs) if (!(struct instanceof N)) add(items, struct.id.client, struct.id.clock, struct.id.clock + struct.length);
  const deletes = /* @__PURE__ */ new Map();
  for (const [client, list] of ds2.clients) for (const { clock, len } of list) add(deletes, client, clock, clock + len);
  return { items: merged(items), deletes: merged(deletes) };
}
function inside(spans, from, to2) {
  if (!spans) return false;
  let lo2 = 0, hi2 = spans.length - 1;
  while (lo2 <= hi2) {
    const mid = lo2 + hi2 >> 1;
    const span = spans[mid];
    if (from < span[0]) hi2 = mid - 1;
    else if (from >= span[1]) lo2 = mid + 1;
    else return to2 <= span[1];
  }
  return false;
}
function within(state, ranges) {
  if (state.complete === false) return false;
  for (const [client, spans] of ranges.items) for (const [from, to2] of spans) if (!inside(state.items.get(client), from, to2)) return false;
  for (const [client, spans] of ranges.deletes) for (const [from, to2] of spans) if (!inside(state.deletes.get(client), from, to2)) return false;
  return true;
}
function docRanges(doc) {
  if (doc.store.pendingStructs || doc.store.pendingDs) return { complete: false };
  const items = /* @__PURE__ */ new Map();
  for (const [client, structs] of doc.store.clients) {
    const last = structs[structs.length - 1];
    add(items, client, 0, last.id.clock + last.length);
  }
  const deletes = /* @__PURE__ */ new Map();
  for (const [client, list] of ci(doc.store).clients) for (const { clock, len } of list) add(deletes, client, clock, clock + len);
  return { complete: true, items, deletes: merged(deletes) };
}

// src/live/page-compaction.js
var COMPACTION = Object.freeze({
  version: 1,
  loose: 32,
  soft: 16,
  activeBytes: 3840 * 1024,
  deleteReserve: 64 * 1024,
  newPerFrame: 4,
  tailFloor: 64 * 1024,
  leaseMs: 60 * 1e3,
  retired: 8192
});
var ROOM_ERROR_STATUS = Object.freeze({
  "checkpoint-required": 503,
  "page-full": 409,
  "compaction-failed": 409,
  "page-immutable": 409,
  "page-batch": 409,
  "page-update-invalid": 422,
  "page-upgrade": 404
});
function buildCandidate({ kind, sources, encode = Ic }) {
  const updates = sources.map(([, v2]) => Lo(v2));
  if (kind === "tail") {
    const merged2 = Tn(updates);
    const index = rangesOf(merged2);
    for (const update of updates) if (!within(index, rangesOf(update))) return { failure: "not-covered" };
    return { update: No(merged2) };
  }
  const doc = new Ct({ gc: true });
  try {
    for (const update of updates) Fr(doc, update);
    if (doc.store.pendingStructs || doc.store.pendingDs) {
      const merged2 = Tn(updates);
      const index2 = rangesOf(merged2);
      for (const update of updates) if (!within(index2, rangesOf(update))) return { failure: "not-covered" };
      return { update: No(merged2), pending: true };
    }
    const index = docRanges(doc);
    for (const update of updates) if (!within(index, rangesOf(update))) return { failure: "not-covered" };
    const out = No(encode(doc));
    const check = new Ct({ gc: true });
    try {
      Fr(check, Lo(out));
      const stored = docRanges(check);
      if (!stored.complete) return { failure: "not-covered" };
      for (const update of updates) if (!within(stored, rangesOf(update))) return { failure: "not-covered" };
    } finally {
      check.destroy();
    }
    return { update: out };
  } catch (error) {
    return { failure: "invalid-update", message: error?.message || String(error) };
  } finally {
    doc.destroy();
  }
}

// src/server/rooms/page-compaction-worker.js
import_node_worker_threads.parentPort.on("message", ({ id, kind, sources }) => {
  let result;
  try {
    result = buildCandidate({ kind, sources });
  } catch (error) {
    result = { failure: "crashed", message: error?.message || String(error) };
  }
  import_node_worker_threads.parentPort.postMessage({ id, ...result });
});
