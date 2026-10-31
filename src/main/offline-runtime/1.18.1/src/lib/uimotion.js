export const ease = {
  standard: [0.33, 0, 0.67, 1],
  out: [0.17, 0.17, 0.4, 1],
  snap: [0.87, 0, 0.38, 1],
  in: [0.69, 0, 0.83, 0.83],
  pop: [0.27, 0, 0.73, 1],
  settle: [0.17, 0, 0.83, 1],
  linear: [0, 0, 1, 1],
}

const defaults = {
  rise: { distance: 14, duration: 270, stagger: 125, fade: 0.2, fadeDuration: 210, ease: 'standard' },
  cascade: { dx: 27, dy: 43, duration: 460, stagger: 167, fade: 0.7, fadeDuration: 290, ease: 'out' },
  pop: { from: 0.9, duration: 210, ease: 'pop', overshoot: false, peak: 1.07, up: 275, down: 210, fade: 0, fadeDuration: 100 },
  exit: { distance: 57, duration: 330, opacity: 0, ease: 'standard' },
  slideOff: { dx: 150, dy: 0, duration: 460, stagger: 0, ease: 'in' },
  hover: { scale: 1.03, lift: 4, rotate: 1, duration: 250, hold: 0, back: 290, ease: 'standard' },
  press: { scale: 1.08, up: 125, down: 125 },
  click: { settle: 160, cursorScale: 1.18, up: 125, down: 167, targetScale: 1.08, press: true },
  move: { ease: 'standard', arc: 0.12, offset: [0.5, 0.5] },
  ripple: { from: [0.94, 0.68], duration: 500, fade: 0.3, fadeAt: 290, fadeDuration: 210, ease: 'out' },
  flip: { deg: 180, duration: 125, ease: 'standard' },
  grow: { from: 0, duration: 600, ease: 'out', axis: 'x', stagger: 0 },
  zoom: { scale: 1.28, focus: [0.5, 0.5], duration: 700, ease: 'snap' },
  zoomOut: { duration: 420, ease: 'settle' },
  reset: { duration: 420, ease: 'standard' },
}

const IDENTITY = { translate: [0, 0], scale: [1, 1], rotate: [0], opacity: [1] }
const round = n => Math.round(n * 1000) / 1000
const FORMAT = {
  translate: v => `${round(v[0])}px ${round(v[1])}px`,
  scale: v => `${round(v[0])} ${round(v[1])}`,
  rotate: v => `${round(v[0])}deg`,
  opacity: v => `${round(v[0])}`,
}
const CURSOR_SVG = '<svg viewBox="136 60 330 400" width="20" height="24" aria-hidden="true"><path d="M142 118C142 84 180 58 214 84L440 268C472 294 455 338 418 338L335 338C310 338 290 348 274 368L226 432C202 462 158 448 156 412Z" fill="currentColor"/></svg>'

function toBezier(e) {
  const a = typeof e === 'string' ? ease[e] : e
  if (!Array.isArray(a) || a.length !== 4) throw new Error(`uimotion: unknown ease "${e}"`)
  return a
}

function cssEase(a) {
  return a[0] === 0 && a[1] === 0 && a[2] === 1 && a[3] === 1 ? 'linear' : `cubic-bezier(${a.join(', ')})`
}

function bezierAt([x1, y1, x2, y2], x) {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const curve = (a, b, t) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3
  let lo = 0
  let hi = 1
  let t = x
  for (let i = 0; i < 40; i++) {
    const v = curve(x1, x2, t)
    if (Math.abs(v - x) < 1e-6) break
    if (v < x) lo = t
    else hi = t
    t = (lo + hi) / 2
  }
  return curve(y1, y2, t)
}

function vec(prop, v) {
  if (Array.isArray(v)) return v
  if (prop === 'scale') return [v, v]
  if (prop === 'translate') throw new Error('uimotion: translate takes [x, y]')
  return [v]
}

const same = (a, b) => a.every((n, i) => Math.abs(n - b[i]) < 1e-9)
const lerp = (a, b, u) => a.map((n, i) => n + (b[i] - n) * u)
const quad = (a, c, b, u) => a.map((n, i) => (1 - u) ** 2 * n + 2 * u * (1 - u) * c[i] + u * u * b[i])
const SAMPLES = 24
const EPSILON = 1e-6

function initialValue(keys) {
  if (keys[0].t > 0) return keys[0].v
  let i = 0
  while (i < keys.length - 1 && keys[i + 1].t === keys[0].t) i++
  return keys[i].v
}

function resolve(tweens, resets = []) {
  if (!tweens.length) return []
  const firstStart = Math.min(...tweens.map(t => t.start))
  const list = [
    ...tweens,
    ...resets.filter(r => r.start >= firstStart).map(r => ({ ...r, toInitial: true })),
  ].sort((a, b) => a.start - b.start)
  const keys = []
  let cur = IDENTITY[tweens[0].prop]
  let lastEnd = -Infinity
  let lastTween = null
  for (const tw of list) {
    if (tw.start < lastEnd - EPSILON) {
      throw new Error(`uimotion: two ${tweens[0].prop} tweens overlap on the same element at ${Math.round(tw.start)} ms (the earlier one ends at ${Math.round(lastEnd)} ms, from ${lastTween.source ?? 'a step'})`)
    }
    const start = Math.max(tw.start, lastEnd)
    const from = tw.from ?? cur
    const to = tw.toInitial ? initialValue(keys) : tw.to ?? from
    const last = keys[keys.length - 1]
    if (keys.length && !same(from, cur)) keys.push({ t: start, v: cur, ease: ease.linear })
    if (!(last && last.t === start && same(last.v, from))) keys.push({ t: start, v: from, ease: ease.linear })
    const head = keys[keys.length - 1]
    if (tw.path) {
      for (let i = 1; i <= SAMPLES; i++) {
        const u = i / SAMPLES
        keys.push({ t: start + tw.dur * u, v: tw.path(bezierAt(tw.ease, u)), ease: ease.linear })
      }
    } else {
      head.ease = tw.ease
      keys.push({ t: start + tw.dur, v: to, ease: ease.linear })
    }
    cur = keys[keys.length - 1].v
    lastEnd = start + tw.dur
    lastTween = tw
  }
  return keys
}

function valueAt(keys, t, prop) {
  if (!keys.length) return IDENTITY[prop]
  if (t < keys[0].t) return keys[0].v
  let i = 0
  while (i < keys.length - 1 && keys[i + 1].t <= t) i++
  const a = keys[i]
  const b = keys[i + 1]
  if (!b) return a.v
  return lerp(a.v, b.v, bezierAt(a.ease, (t - a.t) / (b.t - a.t)))
}

function keyframes(keys, prop, total) {
  const frames = keys.map(k => ({
    offset: Math.min(1, Math.max(0, k.t / total)),
    [prop]: FORMAT[prop](k.v),
    easing: cssEase(k.ease),
  }))
  if (frames[0].offset > 0) frames.unshift({ ...frames[0], offset: 0, easing: 'linear' })
  if (frames[frames.length - 1].offset < 1) frames.push({ ...frames[frames.length - 1], offset: 1, easing: 'linear' })
  return frames
}

export function scene(stage, options) {
  return new Scene(stage, options)
}

class Scene {
  constructor(stage, { loop = true, cursor, still } = {}) {
    this.stage = typeof stage === 'string' ? document.querySelector(stage) : stage
    if (!this.stage) throw new Error(`uimotion: no stage "${stage}"`)
    this.loop = loop
    this.cursorStart = cursor
    this.stillAt = still
    this.tweens = []
    this.resets = []
    this.t = 0
    this.last = { start: 0, end: 0 }
    this.mode = null
    this.rects = new Map()
    this.animations = null
    this.playing = false
    this.rate = 1
    const view = this.stage.ownerDocument?.defaultView
    if (view && view.getComputedStyle(this.stage).position === 'static') this.stage.style.position = 'relative'
  }

  get duration() {
    return Math.max(this.t, 1)
  }

  els(target) {
    if (typeof target === 'string') {
      const list = [...this.stage.querySelectorAll(target)]
      if (!list.length) throw new Error(`uimotion: nothing matches "${target}"`)
      return list
    }
    if (Array.isArray(target)) return target
    if (target && typeof target.length === 'number' && !target.nodeType) return [...target]
    return [target]
  }

  el(target) {
    return this.els(target)[0]
  }

  nextStart() {
    if (this.mode?.with != null) return this.last.start + this.mode.with
    return this.mode?.at ?? this.t
  }

  step(name, build) {
    const resume = this.animations ? { time: this.time, playing: this.playing } : null
    this.animations?.forEach(a => a.cancel())
    this.animations = null
    const start = this.nextStart()
    this.mode = null
    this.source = `${name} at ${Math.round(start)} ms`
    const before = this.tweens.length
    let end = start + build(start)
    for (const tw of this.tweens.slice(before)) end = Math.max(end, tw.start + tw.dur)
    this.last = { start, end }
    this.t = Math.max(this.t, end)
    if (resume) {
      this.seek(resume.time)
      if (resume.playing) this.play()
    }
    return this
  }

  add(el, prop, start, dur, to, { from, ease: e = 'standard', path } = {}) {
    this.tweens.push({
      el,
      prop,
      start,
      dur,
      from: from == null ? undefined : vec(prop, from),
      to: to == null ? undefined : vec(prop, to),
      ease: toBezier(e),
      path,
      source: this.source,
    })
  }

  current(el, prop, t) {
    const keys = resolve(this.tweens.filter(tw => tw.el === el && tw.prop === prop), this.resets)
    return valueAt(keys, t, prop)
  }

  rect(el) {
    if (!this.rects.has(el)) {
      const s = this.stage.getBoundingClientRect()
      const r = el.getBoundingClientRect()
      const k = this.stageScale()
      const x = (r.left - s.left) / k - (this.stage.clientLeft || 0)
      const y = (r.top - s.top) / k - (this.stage.clientTop || 0)
      const w = r.width / k
      const h = r.height / k
      const origin = this.stage.ownerDocument?.defaultView?.getComputedStyle(el).transformOrigin
      const [ox, oy] = (origin ?? '').split(' ').map(parseFloat)
      this.rects.set(el, {
        x, y, w, h,
        origin: [x + (Number.isFinite(ox) ? ox : w / 2), y + (Number.isFinite(oy) ? oy : h / 2)],
      })
    }
    return this.rects.get(el)
  }

  stageScale() {
    const w = this.stage.getBoundingClientRect().width
    return this.stage.offsetWidth ? w / this.stage.offsetWidth : 1
  }

  stageSize() {
    const r = this.stage.getBoundingClientRect()
    const k = this.stageScale()
    return [r.width / k, r.height / k]
  }

  chain(el, until = this.stage) {
    const nodes = []
    for (let n = el; n && n !== until && n !== this.stage; n = n.parentElement) {
      if (this.tweens.some(tw => tw.el === n)) nodes.push(n)
    }
    return nodes
  }

  transformAt(n, t) {
    return {
      o: this.rect(n).origin,
      s: this.current(n, 'scale', t),
      r: this.current(n, 'rotate', t)[0] * Math.PI / 180,
      d: this.current(n, 'translate', t),
    }
  }

  transformPoint(n, p, t) {
    const { o, s, r, d } = this.transformAt(n, t)
    const x = (p[0] - o[0]) * s[0]
    const y = (p[1] - o[1]) * s[1]
    return [o[0] + x * Math.cos(r) - y * Math.sin(r) + d[0], o[1] + x * Math.sin(r) + y * Math.cos(r) + d[1]]
  }

  untransformPoint(n, p, t) {
    const { o, s, r, d } = this.transformAt(n, t)
    const x = p[0] - o[0] - d[0]
    const y = p[1] - o[1] - d[1]
    return [o[0] + (x * Math.cos(r) + y * Math.sin(r)) / s[0], o[1] + (-x * Math.sin(r) + y * Math.cos(r)) / s[1]]
  }

  pointAt(el, t, [fx, fy] = [0.5, 0.5], until = this.stage) {
    const r = this.rect(el)
    let p = [r.x + r.w * fx, r.y + r.h * fy]
    for (const n of this.chain(el, until)) p = this.transformPoint(n, p, t)
    return p
  }

  cursorEl() {
    if (this.cursor) return this.cursor
    const doc = this.stage.ownerDocument
    const el = doc.createElement('div')
    el.className = 'uimotion-cursor'
    el.setAttribute('aria-hidden', 'true')
    el.setAttribute('clay', 'editor-ui')
    el.innerHTML = CURSOR_SVG
    Object.assign(el.style, {
      position: 'absolute', left: '-1px', top: '-2px', width: '20px', height: '24px',
      pointerEvents: 'none', zIndex: '10', transformOrigin: '1px 2px',
    })
    this.stage.append(el)
    this.cursor = el
    const [w, h] = this.stageSize()
    const start = this.cursorStart ?? [w * 0.7, h * 0.85]
    this.tweens.push({ el, prop: 'translate', start: 0, dur: 0, to: start, from: start, ease: ease.linear, source: 'cursor start' })
    return el
  }

  with(offset = 0) {
    this.mode = { with: offset }
    return this
  }

  at(ms) {
    this.mode = { at: ms }
    return this
  }

  wait(ms) {
    return this.step('wait', () => ms)
  }

  set(target, values) {
    return this.step('set', start => {
      for (const el of this.els(target)) {
        for (const [prop, v] of Object.entries(values)) this.add(el, prop, start, 0, v, { ease: 'linear' })
      }
      return 0
    })
  }

  tween(target, prop, to, { duration = 300, delay = 0, stagger = 0, ...opts } = {}) {
    return this.step('tween', start => {
      const list = this.els(target)
      list.forEach((el, i) => this.add(el, prop, start + delay + i * stagger, duration, to, opts))
      return delay + (list.length - 1) * stagger + duration
    })
  }

  rise(target, opts) {
    const o = { ...defaults.rise, ...opts }
    return this.step('rise', start => {
      const list = this.els(target)
      list.forEach((el, i) => {
        const t = start + i * o.stagger
        this.add(el, 'translate', t, o.duration, [0, 0], { from: [0, o.distance], ease: o.ease })
        this.add(el, 'opacity', t, o.fadeDuration, 1, { from: o.fade, ease: 'linear' })
      })
      return (list.length - 1) * o.stagger + o.duration
    })
  }

  cascade(target, opts) {
    const o = { ...defaults.cascade, ...opts }
    return this.step('cascade', start => {
      const list = this.els(target)
      list.forEach((el, i) => {
        const t = start + i * o.stagger
        this.add(el, 'translate', t, o.duration, [0, 0], { from: [-o.dx, -o.dy], ease: o.ease })
        this.add(el, 'opacity', t, o.fadeDuration, 1, { from: o.fade, ease: 'out' })
      })
      return (list.length - 1) * o.stagger + o.duration
    })
  }

  pop(target, opts) {
    const o = { ...defaults.pop, ...opts }
    return this.step('pop', start => {
      for (const el of this.els(target)) {
        if (o.fade !== false) this.add(el, 'opacity', start, o.fadeDuration, 1, { from: o.fade, ease: 'linear' })
        if (o.overshoot) {
          this.add(el, 'scale', start, o.up, o.peak, { from: o.from, ease: 'linear' })
          this.add(el, 'scale', start + o.up, o.down, 1, { ease: 'linear' })
        } else {
          this.add(el, 'scale', start, o.duration, 1, { from: o.from, ease: o.ease })
        }
      }
      return o.overshoot ? o.up + o.down : o.duration
    })
  }

  exit(target, opts) {
    const o = { ...defaults.exit, ...opts }
    return this.step('exit', start => {
      for (const el of this.els(target)) {
        const d = this.current(el, 'translate', start)
        this.add(el, 'translate', start, o.duration, [d[0], d[1] - o.distance], { ease: o.ease })
        this.add(el, 'opacity', start, o.duration, o.opacity, { ease: 'linear' })
      }
      return o.duration
    })
  }

  slideOff(target, opts) {
    const o = { ...defaults.slideOff, ...opts }
    return this.step('slideOff', start => {
      const list = this.els(target)
      list.forEach((el, i) => {
        const t = start + i * o.stagger
        const d = this.current(el, 'translate', t)
        this.add(el, 'translate', t, o.duration, [d[0] + o.dx, d[1] + o.dy], { ease: o.ease })
        this.add(el, 'opacity', t, o.duration, 0, { ease: 'linear' })
      })
      return (list.length - 1) * o.stagger + o.duration
    })
  }

  hover(target, opts) {
    const o = { ...defaults.hover, ...opts }
    return this.step('hover', start => {
      for (const el of this.els(target)) {
        const d = this.current(el, 'translate', start)
        const s = this.current(el, 'scale', start)
        const r = this.current(el, 'rotate', start)
        const back = start + o.duration + o.hold
        this.add(el, 'translate', start, o.duration, [d[0], d[1] - o.lift], { ease: o.ease })
        this.add(el, 'scale', start, o.duration, [s[0] * o.scale, s[1] * o.scale], { ease: o.ease })
        this.add(el, 'rotate', start, o.duration, [r[0] + o.rotate], { ease: o.ease })
        this.add(el, 'translate', back, o.back, d, { ease: o.ease })
        this.add(el, 'scale', back, o.back, s, { ease: o.ease })
        this.add(el, 'rotate', back, o.back, r, { ease: o.ease })
      }
      return o.duration + o.hold + o.back
    })
  }

  pulse(el, t, factor, up, down) {
    const s = this.current(el, 'scale', t)
    this.add(el, 'scale', t, up, [s[0] * factor, s[1] * factor], { ease: 'linear' })
    this.add(el, 'scale', t + up, down, s, { ease: 'linear' })
  }

  press(target, opts) {
    const o = { ...defaults.press, ...opts }
    return this.step('press', start => {
      for (const el of this.els(target)) this.pulse(el, start, o.scale, o.up, o.down)
      return o.up + o.down
    })
  }

  move(target, opts) {
    const o = { ...defaults.move, ...opts }
    return this.step('move', start => {
      const c = this.cursorEl()
      const a = this.current(c, 'translate', start)
      const el = Array.isArray(target) ? null : this.el(target)
      const aim = t => el ? this.pointAt(el, t, o.offset) : target
      const timeFor = d => o.duration ?? (d < 120 ? 290 : Math.min(1000, 400 + d * 1.2))
      let b = aim(start)
      let dur = 0
      for (let i = 0; i < 3; i++) {
        dur = timeFor(Math.hypot(b[0] - a[0], b[1] - a[1]))
        b = aim(start + dur)
      }
      const dist = Math.hypot(b[0] - a[0], b[1] - a[1])
      if (dist < 1) return 0
      const bow = dist < 120 ? 0 : o.arc * dist
      let n = [-(b[1] - a[1]) / dist, (b[0] - a[0]) / dist]
      if (n[1] < 0) n = [-n[0], -n[1]]
      const ctrl = [(a[0] + b[0]) / 2 + n[0] * bow, (a[1] + b[1]) / 2 + n[1] * bow]
      this.add(c, 'translate', start, dur, b, { ease: o.ease, path: u => quad(a, ctrl, b, u) })
      return dur
    })
  }

  click(target, opts = {}) {
    const o = { ...defaults.click, ...opts }
    if (target != null) {
      const at = this.nextStart()
      const p = Array.isArray(target) ? target : this.pointAt(this.el(target), at, o.offset)
      const c = this.current(this.cursorEl(), 'translate', at)
      if (Math.hypot(p[0] - c[0], p[1] - c[1]) > 2) {
        this.move(target, { offset: o.offset, ...o.move })
        this.mode = { at: this.last.end }
      }
    }
    return this.step('click', start => {
      const t = start + o.settle
      this.pulse(this.cursorEl(), t, o.cursorScale, o.up, o.down)
      if (target != null && !Array.isArray(target) && o.press) this.pulse(this.el(target), t, o.targetScale, o.up, o.up)
      return o.settle + o.up + o.down
    })
  }

  ripple(target, opts) {
    const o = { ...defaults.ripple, ...opts }
    return this.step('ripple', start => {
      for (const el of this.els(target)) {
        this.add(el, 'scale', start, o.duration, 1, { from: o.from, ease: o.ease })
        this.add(el, 'opacity', start, 0, o.fade, { from: 0, ease: 'linear' })
        this.add(el, 'opacity', start + o.fadeAt, o.fadeDuration, 0, { ease: 'linear' })
      }
      return Math.max(o.duration, o.fadeAt + o.fadeDuration)
    })
  }

  flip(target, opts) {
    const o = { ...defaults.flip, ...opts }
    return this.step('flip', start => {
      for (const el of this.els(target)) {
        const r = this.current(el, 'rotate', start)
        this.add(el, 'rotate', start, o.duration, [r[0] + o.deg], { ease: o.ease })
      }
      return o.duration
    })
  }

  grow(target, opts) {
    const o = { ...defaults.grow, ...opts }
    return this.step('grow', start => {
      const list = this.els(target)
      const from = o.axis === 'x' ? [o.from, 1] : [1, o.from]
      list.forEach((el, i) => this.add(el, 'scale', start + i * o.stagger, o.duration, [1, 1], { from, ease: o.ease }))
      return (list.length - 1) * o.stagger + o.duration
    })
  }

  zoom(target, opts) {
    const o = { ...defaults.zoom, ...opts }
    return this.step('zoom', start => {
      const el = this.el(target)
      const end = start + o.duration
      const s = vec('scale', o.scale)
      let d = [0, 0]
      if (o.to) {
        const p = Array.isArray(o.to) ? o.to : this.pointAt(this.el(o.to), end, [0.5, 0.5], el)
        const st = this.stageSize()
        let f = [st[0] * o.focus[0], st[1] * o.focus[1]]
        for (const n of this.chain(el.parentElement).reverse()) f = this.untransformPoint(n, f, end)
        const c = this.rect(el).origin
        const r = this.current(el, 'rotate', end)[0] * Math.PI / 180
        const x = (p[0] - c[0]) * s[0]
        const y = (p[1] - c[1]) * s[1]
        d = [f[0] - c[0] - (x * Math.cos(r) - y * Math.sin(r)), f[1] - c[1] - (x * Math.sin(r) + y * Math.cos(r))]
      }
      this.add(el, 'scale', start, o.duration, s, { ease: o.ease })
      this.add(el, 'translate', start, o.duration, d, { ease: o.ease })
      return o.duration
    })
  }

  zoomOut(target, opts) {
    const o = { ...defaults.zoomOut, ...opts }
    return this.step('zoomOut', start => {
      const el = this.el(target)
      this.add(el, 'scale', start, o.duration, 1, { ease: o.ease })
      this.add(el, 'translate', start, o.duration, [0, 0], { ease: o.ease })
      return o.duration
    })
  }

  reset(opts) {
    const o = { ...defaults.reset, ...opts }
    return this.step('reset', start => {
      if (this.stillAt == null) this.stillAt = start
      this.resets.push({ start, dur: o.duration, ease: toBezier(o.ease), source: `reset at ${Math.round(start)} ms` })
      return o.duration
    })
  }

  build() {
    if (this.animations) return this.animations
    const total = this.duration
    const groups = new Map()
    for (const tw of this.tweens) {
      const key = groups.get(tw.el) ?? new Map()
      groups.set(tw.el, key)
      if (!key.has(tw.prop)) key.set(tw.prop, [])
      key.get(tw.prop).push(tw)
    }
    const animations = []
    try {
      for (const [el, props] of groups) {
        for (const [prop, list] of props) {
          const keys = resolve(list, this.resets)
          if (this.loop && this.resets.length && !same(keys[keys.length - 1].v, initialValue(keys))) {
            const late = list.reduce((a, b) => (b.start > a.start ? b : a))
            throw new Error(`uimotion: ${prop} on an element still changes after the last reset() (${late.source}), so the loop jumps. Move reset() to the end, or return it to its start value.`)
          }
          const anim = el.animate(keyframes(keys, prop, total), { duration: total, iterations: this.loop ? Infinity : 1, fill: 'both' })
          anim.pause()
          anim.playbackRate = this.rate
          animations.push(anim)
        }
      }
    } catch (error) {
      animations.forEach(a => a.cancel())
      throw error
    }
    this.animations = animations
    if (this.stage.dataset) this.stage.dataset.uimotion = 'ready'
    return animations
  }

  play() {
    this.build()
    const reduce = this.stage.ownerDocument.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduce) return this.seek(this.stillAt ?? (this.loop ? this.duration - 0.01 : this.duration))
    this.animations.forEach(a => a.play())
    this.playing = true
    return this
  }

  pause() {
    this.build().forEach(a => a.pause())
    this.playing = false
    return this
  }

  seek(ms) {
    this.build().forEach(a => {
      a.pause()
      a.currentTime = ms
    })
    this.playing = false
    return this
  }

  speed(rate) {
    this.rate = rate
    this.build().forEach(a => { a.playbackRate = rate })
    return this
  }

  get time() {
    const t = this.build()[0]?.currentTime ?? 0
    return this.loop ? t % this.duration : Math.min(t, this.duration)
  }

  debug() {
    const doc = this.stage.ownerDocument
    const bar = doc.createElement('div')
    bar.className = 'uimotion-debug'
    bar.setAttribute('clay', 'editor-ui')
    bar.style.cssText = 'display:flex;gap:8px;align-items:center;margin-top:8px;font:12px/1.4 ui-monospace,monospace'
    bar.innerHTML = '<button type="button">Pause</button><input type="range" min="0" step="1" style="flex:1"><select><option>0.25</option><option>0.5</option><option selected>1</option></select><span></span>'
    const [button, range, select, label] = bar.children
    range.max = Math.round(this.duration)
    this.stage.after(bar)
    let playing = true
    const show = t => { label.textContent = `${Math.round(t)} / ${Math.round(this.duration)} ms` }
    button.onclick = () => {
      playing = !playing
      if (playing) this.play()
      else this.pause()
      button.textContent = playing ? 'Pause' : 'Play'
    }
    range.oninput = () => {
      playing = false
      button.textContent = 'Play'
      this.seek(+range.value)
      show(+range.value)
    }
    select.onchange = () => this.speed(+select.value)
    const tick = () => {
      if (playing) {
        range.value = this.time
        show(this.time)
      }
      doc.defaultView.requestAnimationFrame(tick)
    }
    tick()
    return this
  }
}

// A step that returns every animated property to its start value at this point, except
// opacity on `keep`, which the scene fades itself.
export function rewind(s, keep = []) {
  return s.step('rewind', start => {
    const groups = new Map()
    for (const tw of s.tweens) {
      if (tw.prop === 'opacity' && keep.includes(tw.el)) continue
      const props = groups.get(tw.el) ?? new Map()
      groups.set(tw.el, props)
      if (!props.has(tw.prop)) props.set(tw.prop, [])
      props.get(tw.prop).push(tw)
    }
    for (const [el, props] of groups) {
      for (const [prop, list] of props) {
        const keys = resolve(list, s.resets)
        const v = initialValue(keys)
        if (!same(valueAt(keys, start, prop), v)) s.add(el, prop, start, 0, v, { ease: 'linear' })
      }
    }
    return 0
  })
}

// Plays a scene in a stage while the stage is in the page: rebuilt when its width changes
// or the fonts arrive (keeping its place in the loop), paused while the tab is hidden or
// the stage is off screen, and stopped for good once the stage leaves the page.
export function mount(stage, build, { watch = stage, teardown, debug = false } = {}) {
  const doc = stage.ownerDocument
  let s = null
  let width = 0
  let onScreen = true
  let queued = false
  let queuedForce = false
  let done = false
  const shown = () => onScreen && doc.visibilityState !== 'hidden'
  const sync = () => { if (s) shown() ? s.play() : s.pause() }
  const clear = () => {
    if (!s) return
    s.animations?.forEach(a => a.cancel())
    s.cursor?.remove()
    if (stage.nextElementSibling?.classList.contains('uimotion-debug')) stage.nextElementSibling.remove()
    teardown?.(stage)
    delete stage.dataset.uimotion
    delete stage.uimotionScene
    s = null
    width = 0
  }
  const stop = () => {
    if (done) return
    done = true
    clear()
    ro.disconnect()
    io?.disconnect()
    doc.removeEventListener('visibilitychange', sync)
  }
  const start = force => {
    if (done) return
    if (!stage.isConnected) return stop()
    const w = stage.offsetWidth
    if (!force && w === width) return
    const time = s ? s.time : 0
    clear()
    if (!w) return
    try {
      s = build(stage)
      width = w
      stage.uimotionScene = s
      s.seek(time)
      sync()
      if (debug) s.debug()
    } catch (error) {
      console.error(error)
      clear()
    }
  }
  const queue = force => {
    queuedForce = queuedForce || force
    if (queued) return
    queued = true
    requestAnimationFrame(() => {
      queued = false
      const f = queuedForce
      queuedForce = false
      start(f)
    })
  }
  const ro = new ResizeObserver(() => (stage.isConnected ? queue(false) : stop()))
  ro.observe(watch)
  const io = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver(entries => { onScreen = entries[entries.length - 1].isIntersecting; sync() })
    : null
  io?.observe(stage)
  doc.addEventListener('visibilitychange', sync)
  if (doc.fonts && doc.fonts.status !== 'loaded') doc.fonts.ready.then(() => queue(true))
  start(false)
  return { stop, get scene() { return s } }
}
