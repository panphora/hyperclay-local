const START_TIMEOUT = 5000;
const HIDDEN_DELAY = 5000;
const PING_INTERVAL = 15000;

let workspaceBackground = window.__clayWorkspaceBackground === true;
document.addEventListener('clay:workspace-background', () => { workspaceBackground = true; });
document.addEventListener('clay:workspace-foreground', () => { workspaceBackground = false; });

const pageHidden = () => document.hidden || workspaceBackground;

export class SyncStream extends EventTarget {
  constructor(url, { shared = false, sharedData = false, documentURL, lane, clientId, startupCheck = false, keepAliveWhenHidden = false } = {}) {
    super();
    this.url = url;
    this.readyState = 0;
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this._shared = shared && typeof SharedWorker === 'function';
    this._sharedData = sharedData;
    this._documentURL = documentURL;
    this._lane = lane;
    this._clientId = clientId;
    this._keepAliveWhenHidden = keepAliveWhenHidden;
    this._since = 0;
    this._closed = false;
    this._suspended = false;
    // Two different questions, asked once each at the first subscription and
    // never again: `_repair` is a real reconnect whose replay the host could not
    // retain, and `_startup` is the caller's own check of a page that was served
    // before this stream existed. Only the caller can know whether the response
    // it was served named a version, so the startup check is opt-in and off by
    // default: a stream nobody told about provenance must not manufacture one.
    this._repair = false;
    this._startup = startupCheck;
    this._worker = null;
    this._source = null;
    this._visibility = () => {
      clearTimeout(this._hiddenTimer);
      if (pageHidden()) {
        if (this._worker) this._postWorker(this._worker, 'hidden');
        if (!this._keepAliveWhenHidden) this._hiddenTimer = setTimeout(() => this._suspend(), HIDDEN_DELAY);
      } else {
        if (this._suspended) this._resume();
        else if (this._worker) {
          this._postWorker(this._worker, 'visible');
        }
      }
    };
    this._pagehide = () => this._suspend(true);
    this._pageshow = () => { if (!pageHidden() || this._keepAliveWhenHidden) this._resume(); };
    document.addEventListener('visibilitychange', this._visibility);
    document.addEventListener('clay:workspace-background', this._visibility);
    document.addEventListener('clay:workspace-foreground', this._visibility);
    window.addEventListener('pagehide', this._pagehide);
    window.addEventListener('pageshow', this._pageshow);
    this._open();
    if (pageHidden()) this._visibility();
  }

  _emit(type, data) {
    if (this._closed) return;
    const event = data === undefined ? new Event(type) : new MessageEvent(type, { data });
    this.dispatchEvent(event);
    this[`on${type}`]?.(event);
  }

  _postWorker(worker, type, fields = {}) {
    worker.port.postMessage({ v: this._sharedData ? 2 : 1, type, ...fields });
  }

  _open() {
    if (this._closed || this._suspended) return;
    this.readyState = 0;
    if (!this._shared) return this._openDirect();
    try {
      const worker = new SharedWorker(
        new URL(this._sharedData ? '/_/sync/data-worker.js' : '/_/sync/worker.js', window.location.origin).href,
        this._sharedData ? 'clay-sync-data' : 'clay-sync'
      );
      this._worker = worker;
      let lastReply = Date.now();
      let greeted = false;
      worker.onerror = () => {
        if (this._worker !== worker) return;
        this._shared = false;
        this._repair = true;
        this._reopen();
      };
      this._startTimer = setTimeout(worker.onerror, START_TIMEOUT);
      worker.port.onmessage = ({ data }) => {
        if (this._worker !== worker || data?.v !== (this._sharedData ? 2 : 1)) return;
        if (this._sharedData) {
          if (data.type === 'unsupported') {
            worker.onerror();
            return;
          }
          if (data.type === 'gone') {
            this.readyState = 2;
            this._emit('error');
            this.close();
            return;
          }
          if (!greeted) {
            if (data.type !== 'hello') return;
            if (!Array.isArray(data.features) || !data.features.includes('live-data')) {
              worker.onerror();
              return;
            }
            greeted = true;
            clearTimeout(this._startTimer);
            lastReply = Date.now();
            return;
          }
          if (data.type === 'hello') return;
        }
        lastReply = Date.now();
        if (!this._sharedData && ['status', 'pong', 'cursor', 'frame', 'gone'].includes(data.type)) clearTimeout(this._startTimer);
        if (data.type === 'status') {
          if (data.state === 'open') {
            if (!this._sharedData || this.readyState !== 1) {
              this.readyState = 1;
              this._emit('open');
            }
          } else if (data.state === 'connecting') {
            this.readyState = 0;
            this._emit('error');
          }
        } else if (data.type === 'cursor') {
          clearTimeout(this._startTimer);
          if (Number.isSafeInteger(data.seq)) this._since = Math.max(this._since, data.seq);
          const resync = data.resync === true || this._repair;
          const startup = this._startup;
          this._repair = false;
          this._startup = false;
          this._emit('cursor', JSON.stringify({ ...data, resync, startup }));
        } else if (data.type === 'frame' && typeof data.data === 'string') {
          this._remember(data.data);
          this._emit('message', data.data);
        } else if (this._sharedData && data.type === 'event' && ['data', 'data-state', 'data-writer'].includes(data.event)
          && data.data !== null && typeof data.data === 'object' && !Array.isArray(data.data)) {
          try { this._emit(data.event, JSON.stringify(data.data)); } catch {}
        } else if (data.type === 'gone') {
          this.readyState = 2;
          this._emit('error');
          this.close();
        }
      };
      worker.port.start();
      this._postWorker(worker, pageHidden() ? 'hidden' : 'visible');
      const subscription = { document: this._documentURL, lane: this._lane, since: this._since };
      if (this._sharedData && this._lane === 'live') subscription.clientId = this._clientId;
      this._postWorker(worker, 'subscribe', subscription);
      this._pingTimer = setInterval(() => {
        if (this._worker !== worker) return;
        if (Date.now() - lastReply > PING_INTERVAL * 3) {
          this._repair = true;
          this._reopen();
        } else this._postWorker(worker, 'ping');
      }, PING_INTERVAL);
    } catch {
      this._shared = false;
      this._reopen();
    }
  }

  _openDirect() {
    const source = new EventSource(this.url);
    this._source = source;
    source.onopen = () => {
      if (this._source !== source) return;
      this.readyState = 1;
      this._emit('open');
      if (this._repair || this._startup) {
        const resync = this._repair;
        const startup = this._startup;
        this._repair = false;
        this._startup = false;
        this._emit('cursor', JSON.stringify({ resync, startup }));
      }
    };
    source.onerror = () => {
      if (this._source !== source) return;
      this.readyState = source.readyState;
      this._emit('error');
    };
    source.onmessage = event => {
      if (this._source !== source) return;
      this._remember(event.data);
      this._emit('message', event.data);
    };
    // `data`, `data-state` and `data-writer` are clay.live's fast lane (stream-bridge.js).
    for (const type of ['cursor', 'presence', 'data', 'data-state', 'data-writer']) {
      source.addEventListener(type, event => {
        if (this._source === source) this._emit(type, event.data);
      });
    }
  }

  _remember(data) {
    try {
      const { seq } = JSON.parse(data);
      if (Number.isSafeInteger(seq)) this._since = Math.max(this._since, seq);
    } catch {}
  }

  _disconnect() {
    clearTimeout(this._startTimer);
    clearInterval(this._pingTimer);
    if (this._worker) {
      const worker = this._worker;
      this._worker = null;
      worker.onerror = null;
      worker.port.onmessage = null;
      try { this._postWorker(worker, 'unsubscribe'); } catch {}
      worker.port.close();
    }
    if (this._source) {
      this._source.close();
      this._source = null;
    }
  }

  _reopen() {
    const notify = (this._sharedData || this._keepAliveWhenHidden) && this.readyState === 1;
    this.readyState = 0;
    if (notify) this._emit('error');
    this._disconnect();
    this._open();
  }

  _suspend(pageExit = false) {
    clearTimeout(this._hiddenTimer);
    if (this._closed || this._suspended) return;
    this._suspended = true;
    this._repair = true;
    this.readyState = 0;
    if (pageExit && this._keepAliveWhenHidden) this._emit('error');
    this._disconnect();
  }

  _resume() {
    clearTimeout(this._hiddenTimer);
    if (this._closed || !this._suspended) return;
    this._suspended = false;
    this._open();
  }

  close() {
    this._closed = true;
    this.readyState = 2;
    clearTimeout(this._hiddenTimer);
    this._disconnect();
    document.removeEventListener('visibilitychange', this._visibility);
    document.removeEventListener('clay:workspace-background', this._visibility);
    document.removeEventListener('clay:workspace-foreground', this._visibility);
    window.removeEventListener('pagehide', this._pagehide);
    window.removeEventListener('pageshow', this._pageshow);
  }
}
