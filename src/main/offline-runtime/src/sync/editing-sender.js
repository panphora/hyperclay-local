import { blockOf, pathOf } from './editing-path.js';

const INTERVAL_MS = 250;
const RETRY_MS = 2000;
const EVENTS = ['focusin', 'focusout', 'selectionchange', 'clay:sync-applied', 'clay:workspace-background', 'clay:workspace-foreground'];

export class EditingSender {
  constructor({ send, now = () => Date.now() }) {
    this.send = send;
    this.now = now;
    this.others = false;
    this.background = false;
    this.sent = null;
    this.lastAt = -Infinity;
    this.timer = null;
    this.poked = null;
    this.inflight = false;
    this.retry = null;
    this.stopped = false;
    this._onEvent = (event) => {
      if (event.type === 'clay:workspace-background') this.background = true;
      if (event.type === 'clay:workspace-foreground') this.background = false;
      this.poke();
    };
  }

  start() {
    this.stopped = false;
    for (const type of EVENTS) document.addEventListener(type, this._onEvent);
  }

  stop() {
    this.stopped = true;
    for (const type of EVENTS) document.removeEventListener(type, this._onEvent);
    clearTimeout(this.timer);
    clearTimeout(this.poked);
    clearTimeout(this.retry);
    this.timer = null;
    this.poked = null;
    this.retry = null;
  }

  roster(frame) {
    const people = frame && Array.isArray(frame.people) ? frame.people : [];
    const others = people.some((person) => person && person.you !== true);
    if (others === this.others) return;
    this.others = others;
    this.schedule();
  }

  reconnected() {
    this.sent = null;
    this.schedule();
  }

  wanted() {
    if (!this.others || this.background) return null;
    return pathOf(blockOf(document.activeElement));
  }

  poke() {
    if (this.poked !== null) return;
    this.poked = setTimeout(() => {
      this.poked = null;
      this.schedule();
    }, 0);
  }

  schedule() {
    if (this.stopped || this.timer !== null || this.inflight || this.wanted() === this.sent) return;
    const wait = Math.max(0, this.lastAt + INTERVAL_MS - this.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, wait);
  }

  flush() {
    if (this.inflight) return;
    const value = this.wanted();
    if (value === this.sent) return;
    this.sent = value;
    this.lastAt = this.now();
    this.inflight = true;
    const settle = (ok) => {
      this.inflight = false;
      if (this.stopped) return;
      if (ok) {
        clearTimeout(this.retry);
        this.retry = null;
      } else if (this.sent === value) {
        this.sent = undefined;
        if (this.retry === null) this.retry = setTimeout(() => { this.retry = null; this.schedule(); }, RETRY_MS);
        return;
      }
      this.schedule();
    };
    Promise.resolve(this.send(value)).then((ok) => settle(Boolean(ok)), () => settle(false));
  }
}
