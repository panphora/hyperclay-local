/*! quickcrop v1.2.1 | MIT-0 | https://github.com/panphora/quickcrop
 *
 *  const result = await quickcrop(file, { aspect: 1 });
 *  // result: { blob, dataURL, width, height } on confirm, null on cancel
 *
 *  Uses your modal system (themodal, or any adapter) or brings its own.
 */

const CSS = `:root{--qc-surface:#f7f2ea;--qc-surface-hover:#efe7d8;--qc-border:#cdbfa6;--qc-text:#2b241b;--qc-text-hover:#463c2e;--qc-on-dark:#efe7d8;--qc-overlay:rgba(43,36,27,.6);--qc-dim:rgba(0,0,0,.55);--qc-radius:8px;--qc-crop-line:#fff;--qc-font:ui-sans-serif,system-ui,sans-serif;}.qc-css-probe{position:absolute;}.qc-backdrop{position:fixed;inset:0;background:var(--qc-overlay);display:grid;place-items:center;z-index:1000;animation:qc-fade .15s ease;}@keyframes qc-fade{from{opacity:0}}.qc-modal{background:var(--qc-surface);border:1px solid var(--qc-border);border-radius:var(--qc-radius);padding:16px;max-width:92vw;font-family:var(--qc-font);}.qc-bar{display:flex;justify-content:flex-end;gap:10px;margin-top:12px;}.qc-btn{font:inherit;font-family:var(--qc-font);font-size:.85rem;padding:.3rem .75rem;border:1px solid var(--qc-border);border-radius:6px;background:var(--qc-surface);color:var(--qc-text);cursor:pointer;}.qc-btn:hover{background:var(--qc-surface-hover);}.qc-btn-primary{background:var(--qc-text);border-color:var(--qc-text);color:var(--qc-on-dark);font-weight:600;}.qc-btn-primary:hover{background:var(--qc-text-hover);border-color:var(--qc-text-hover);}.qc-stage{position:relative;line-height:0;user-select:none;-webkit-user-select:none;touch-action:none;}.qc-stage img{display:block;max-width:100%;pointer-events:none;}.qc-dim{position:absolute;inset:0;background:var(--qc-dim);pointer-events:none;}.qc-box{position:absolute;cursor:move;outline:1px solid var(--qc-crop-line);background:linear-gradient(var(--qc-crop-line),var(--qc-crop-line)) 0 33.33%/100% 1px no-repeat,linear-gradient(var(--qc-crop-line),var(--qc-crop-line)) 0 66.66%/100% 1px no-repeat,linear-gradient(var(--qc-crop-line),var(--qc-crop-line)) 33.33% 0/1px 100% no-repeat,linear-gradient(var(--qc-crop-line),var(--qc-crop-line)) 66.66% 0/1px 100% no-repeat;background-blend-mode:overlay;}.qc-handle{position:absolute;box-sizing:border-box;width:28px;height:28px;border:7px solid transparent;background:var(--qc-crop-line);background-clip:padding-box;border-radius:9px;}.qc-nw{left:-14px;top:-14px;cursor:nwse-resize;}.qc-ne{right:-14px;top:-14px;cursor:nesw-resize;}.qc-sw{left:-14px;bottom:-14px;cursor:nesw-resize;}.qc-se{right:-14px;bottom:-14px;cursor:nwse-resize;}.qc-mount{line-height:0;}`;

const ENCODABLE = ['image/jpeg', 'image/png', 'image/webp'];

// iOS Safari silently produces a blank bitmap above ~16.7M canvas pixels
// (getContext still succeeds, toBlob still returns a blob), so cap the
// output area and downscale instead.
const MAX_AREA = 16777216;

let active = false;

function el(tag, cls = '', text = '') {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  return n;
}

// Geometry goes on inline and !important: a host page's `img { width: auto !important }`
// beats a plain inline style, and the crop math assumes the sizes written here.
function pin(node, prop, value) {
  node.style.setProperty(prop, value, 'important');
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function ensureStyles() {
  if (document.querySelector('style[data-quickcrop]')) return;
  const probe = el('div', 'qc-css-probe');
  probe.style.display = 'none';
  document.body.append(probe);
  const linked = getComputedStyle(probe).position === 'absolute';
  probe.remove();
  if (linked) return;
  const style = document.createElement('style');
  style.setAttribute('data-quickcrop', '');
  style.setAttribute('save-remove', '');
  style.setAttribute('snapshot-remove', '');
  style.textContent = CSS;
  document.head.append(style);
}

// ---------------------------------------------------------------------------
//  Modal adapters
//
//  An adapter normalizes any modal system to:
//    open({ content, confirmLabel, onConfirm, onCancel }) -> { close() }
//    fit?() -> { width, height }   optional: max content size the modal can host
//  Dismissal affordances (Esc, backdrop, a close button) are the adapter's
//  concern. onConfirm/onCancel must only fire from user interaction, never
//  during open().
// ---------------------------------------------------------------------------

const builtinAdapter = {
  open({ content, confirmLabel, onConfirm, onCancel }) {
    ensureStyles();
    const backdrop = el('div', 'qc-backdrop');
    backdrop.setAttribute('save-remove', '');
    backdrop.setAttribute('snapshot-remove', '');
    const modal = el('div', 'qc-modal');
    const bar = el('div', 'qc-bar');
    const confirmBtn = el('button', 'qc-btn qc-btn-primary', confirmLabel);
    confirmBtn.type = 'button';
    bar.append(confirmBtn);
    modal.append(content, bar);
    backdrop.append(modal);
    document.body.append(backdrop);

    const onKey = e => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', onKey);
    confirmBtn.onclick = () => onConfirm();
    backdrop.onclick = e => { if (e.target === backdrop) onCancel(); };
    confirmBtn.focus();

    return {
      close() {
        document.removeEventListener('keydown', onKey);
        backdrop.remove();
      },
    };
  },
};

function isThemodal(m) {
  return !!m && typeof m === 'object' &&
    typeof m.open === 'function' &&
    typeof m.close === 'function' &&
    typeof m.onYes === 'function' &&
    'html' in m;
}

const THEMODAL_CLOSE_X = '<svg viewBox="0 0 134 134" xmlns="http://www.w3.org/2000/svg">' +
  '<path class="micromodal__close-bg" d="M132 132.5 1 1.5h131v131Z"/>' +
  '<path d="M83 27l24 24M107 27L83 51" stroke="#fff" stroke-width="6"/></svg>';

function wrapThemodal(tm) {
  // an already-open themodal dialog is a singleton collision: opening again
  // would cross-fire that dialog's callbacks, so fall back to the built-in modal
  const busy = () => tm.isShowing && !!document.querySelector('.micromodal-parent');
  return {
    // themodal's container is min(550px, 100vw - 2rem) with a 2px border and
    // 40px/64px side padding; leave room for the button row below the stage
    fit() {
      if (busy()) return null;
      const pad = window.innerWidth >= 640 ? 128 : 80;
      return {
        width: Math.max(120, Math.min(550, window.innerWidth - 32) - 4 - pad),
        height: Math.max(120, window.innerHeight - 220),
      };
    },
    open(opts) {
      if (busy()) return builtinAdapter.open(opts);
      const { content, confirmLabel, onConfirm, onCancel } = opts;
      ensureStyles();
      let done = false; // true once themodal is closing through its own paths
      const finish = fn => {
        if (done) return;
        done = true;
        document.removeEventListener('keydown', onKey, true);
        fn();
      };
      // themodal's Esc goes straight through MicroModal without firing onNo,
      // so intercept it in capture and run the cancel path ourselves
      const onKey = e => {
        if (e.key !== 'Escape') return;
        e.stopPropagation();
        onCancel();
      };

      tm.html = '<div class="qc-mount"></div>';
      tm.yes = escapeHtml(confirmLabel);
      tm.no = ''; // no cancel button; dismissal is the close X, backdrop, or Esc
      tm.closeHtml = THEMODAL_CLOSE_X;
      tm.disableFocus = true; // themodal would focus the cancel button; focus confirm instead
      tm.onOpen(() => {
        document.querySelector('.micromodal__content .qc-mount')?.append(content);
        document.querySelector('.micromodal-parent .micromodal__yes')?.focus();
        document.addEventListener('keydown', onKey, true);
      });
      tm.onYes(() => { finish(onConfirm); return true; });
      tm.onNo(() => { finish(onCancel); });
      tm.open();

      return {
        close() {
          if (done) return;
          done = true;
          document.removeEventListener('keydown', onKey, true);
          tm.close();
        },
      };
    },
  };
}

function resolveAdapter(modal) {
  if (modal === 'builtin') return builtinAdapter;
  if (modal && typeof modal === 'object') {
    if (isThemodal(modal)) return wrapThemodal(modal);
    if (typeof modal.open === 'function') return modal;
    throw new TypeError('quickcrop: modal must be "auto", "builtin", a themodal instance, or an adapter with open()');
  }
  if (modal === 'auto') {
    return isThemodal(window.themodal) ? wrapThemodal(window.themodal) : builtinAdapter;
  }
  throw new TypeError('quickcrop: modal must be "auto", "builtin", a themodal instance, or an adapter with open()');
}

// ---------------------------------------------------------------------------
//  quickcrop(file, options) -> Promise<{ blob, dataURL, width, height } | null>
// ---------------------------------------------------------------------------

function quickcrop(file, options = {}) {
  const {
    aspect = null,
    type,
    quality = 0.92,
    maxWidth = null,
    maxHeight = null,
    minSize = 40,
    labels = {},
    modal = 'auto',
  } = options;
  const { confirm: confirmLabel = 'Crop' } = labels;

  if (!(file instanceof Blob)) {
    return Promise.reject(new TypeError('quickcrop: expected a File or Blob'));
  }
  if (active) {
    return Promise.reject(new Error('quickcrop: already open'));
  }

  let adapter;
  try {
    adapter = resolveAdapter(modal);
  } catch (err) {
    return Promise.reject(err);
  }

  active = true;
  const outType = type || (ENCODABLE.includes(file.type) ? file.type : 'image/png');
  const url = URL.createObjectURL(file);
  const img = new Image();

  return new Promise((resolve, reject) => {
    img.onerror = () => {
      URL.revokeObjectURL(url);
      active = false;
      reject(new Error('quickcrop: could not decode image'));
    };

    function mount() {
      // Fit the image inside the host for display. The crop math works in
      // these *display* pixels, then scales back up to the source resolution.
      const fit = adapter.fit ? adapter.fit() : null;
      const fitW = Math.max(1, Math.min(fit?.width ?? window.innerWidth * 0.86, img.naturalWidth));
      const fitH = Math.max(1, fit?.height ?? window.innerHeight * 0.72);
      const scale = Math.min(fitW / img.naturalWidth, fitH / img.naturalHeight, 1);
      const dispW = Math.max(1, Math.round(img.naturalWidth * scale));
      const dispH = Math.max(1, Math.round(img.naturalHeight * scale));
      const min = Math.min(minSize, dispW, dispH);

      ensureStyles();

      const stage = el('div', 'qc-stage');
      pin(img, 'width', dispW + 'px');
      pin(img, 'height', dispH + 'px');
      const dim = el('div', 'qc-dim');
      const box = el('div', 'qc-box');
      for (const c of ['nw', 'ne', 'sw', 'se']) box.appendChild(el('div', 'qc-handle qc-' + c));
      stage.append(img, dim, box);

      // initial crop box: locked aspect -> largest centered rect; free -> whole image
      let w, h;
      if (aspect) {
        w = Math.min(dispW, dispH * aspect);
        h = w / aspect;
        if (h > dispH) { h = dispH; w = h * aspect; }
      } else {
        w = dispW;
        h = dispH;
      }
      let x = (dispW - w) / 2;
      let y = (dispH - h) / 2;
      render();

      function render() {
        pin(box, 'left', x + 'px');
        pin(box, 'top', y + 'px');
        pin(box, 'width', w + 'px');
        pin(box, 'height', h + 'px');
        // dim the image outside the box: one donut polygon. The outer ring winds
        // clockwise and the inner counter-clockwise, so the default nonzero fill
        // rule punches the hole without the (less supported) evenodd keyword.
        pin(dim, 'clip-path', `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, ` +
          `${x}px ${y}px, ${x}px ${y + h}px, ${x + w}px ${y + h}px, ${x + w}px ${y}px, ${x}px ${y}px)`);
      }
      const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

      // one pointer handler drives both moving and resizing
      stage.addEventListener('pointerdown', e => {
        const handle = e.target.closest('.qc-handle');
        const onBox = e.target === box;
        if (!handle && !onBox) return;
        e.preventDefault();
        stage.setPointerCapture(e.pointerId);

        const start = { px: e.clientX, py: e.clientY, x, y, w, h };
        const corner = handle && [...handle.classList].find(c => /^qc-(nw|ne|sw|se)$/.test(c))?.slice(3);

        const move = ev => {
          if (!corner) {                                 // --- drag to move ---
            x = clamp(start.x + (ev.clientX - start.px), 0, dispW - w);
            y = clamp(start.y + (ev.clientY - start.py), 0, dispH - h);
          } else {                                       // --- drag to resize ---
            // Anchor = the corner diagonally opposite the one being dragged; it
            // stays pinned while the dragged corner follows the pointer.
            const ax = corner.includes('w') ? start.x + start.w : start.x;
            const ay = corner.includes('n') ? start.y + start.h : start.y;
            const goingE = corner.includes('e'), goingS = corner.includes('s');
            const rect = stage.getBoundingClientRect();
            const dx = Math.abs(ev.clientX - (rect.left + ax));
            const dy = Math.abs(ev.clientY - (rect.top + ay));

            if (aspect) {
              // room before an image edge, in width units, so the lock holds in both axes
              const roomW = Math.min(goingE ? dispW - ax : ax, (goingS ? dispH - ay : ay) * aspect);
              const minW = Math.min(Math.max(min, min * aspect), roomW);
              w = clamp(Math.max(dx, dy * aspect), minW, roomW);
              h = w / aspect;
            } else {
              w = clamp(dx, min, goingE ? dispW - ax : ax);
              h = clamp(dy, min, goingS ? dispH - ay : ay);
            }
            x = goingE ? ax : ax - w;
            y = goingS ? ay : ay - h;
          }
          render();
        };
        const up = () => {
          stage.removeEventListener('pointermove', move);
          stage.removeEventListener('pointerup', up);
          stage.removeEventListener('pointercancel', up);
        };
        stage.addEventListener('pointermove', move);
        stage.addEventListener('pointerup', up);
        stage.addEventListener('pointercancel', up);
      });

      function renderCrop() {
        // display -> source scale, per axis: dispW/dispH round independently,
        // so a shared scale would distort or overrun the source on one axis
        const sx = img.naturalWidth / dispW;
        const sy = img.naturalHeight / dispH;
        const outW = Math.round(w * sx);
        const outH = Math.round(h * sy);
        let shrink = 1;
        if (maxWidth && outW > maxWidth) shrink = maxWidth / outW;
        if (maxHeight && outH * shrink > maxHeight) shrink = maxHeight / outH;
        if (outW * shrink * outH * shrink > MAX_AREA) shrink = Math.sqrt(MAX_AREA / (outW * outH));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(outW * shrink));
        canvas.height = Math.max(1, Math.round(outH * shrink));
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('quickcrop: crop too large for a canvas');
        if (outType === 'image/jpeg') {                  // jpeg has no alpha; avoid black fill
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(
          img, x * sx, y * sy, w * sx, h * sy,           // source rect
          0, 0, canvas.width, canvas.height              // dest rect
        );
        return canvas;
      }

      let settled = false;
      const finishOnce = () => {
        if (settled) return false;
        settled = true;
        host.close();
        URL.revokeObjectURL(url);
        active = false;
        return true;
      };
      const host = adapter.open({
        content: stage,
        confirmLabel,
        onConfirm() {
          if (settled) return;
          let canvas, dataURL;
          try {
            canvas = renderCrop();
            dataURL = canvas.toDataURL(outType, quality);
          } catch (err) {
            if (finishOnce()) reject(err);
            return;
          }
          if (!finishOnce()) return;
          canvas.toBlob(blob => {
            if (!blob) {
              reject(new Error('quickcrop: image encoding failed'));
              return;
            }
            resolve({ blob, dataURL, width: canvas.width, height: canvas.height });
          }, outType, quality);
        },
        onCancel() {
          if (finishOnce()) resolve(null);
        },
      });
    }

    // an adapter that throws during fit()/open() must not strand the cropper
    img.onload = () => {
      try {
        mount();
      } catch (err) {
        URL.revokeObjectURL(url);
        active = false;
        reject(err);
      }
    };
    img.src = url;
  });
}

// __QC_EXPORT_START__
// clayjs assembles window.clay in its loader and writes no auto-export globals,
// so this copy only exports. The loader attaches it as clay.quickcrop, which is
// where the vendored hypercms bundle looks for the cropper.
export { quickcrop };
// __QC_EXPORT_END__
export default quickcrop;
