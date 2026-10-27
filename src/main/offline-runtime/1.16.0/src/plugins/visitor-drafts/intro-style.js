export const INTRO_CSS = `html:has(> body > .clay-intro) { height: auto !important; overflow-y: auto !important; }
body:has(> .clay-intro) { height: auto !important; overflow: visible !important; }
.clay-intro {
  position: relative;
  display: block;
}
.clay-intro__close {
  position: absolute; top: 10px; right: 10px; z-index: 1;
  display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; min-height: 0; margin: 0; padding: 0;
  border: 0; border-radius: 4px; background: none; box-shadow: none;
  color: inherit; opacity: .55; cursor: pointer; line-height: 1;
}
.clay-intro .clay-intro__close:hover { opacity: 1; background: none; color: inherit; }
.clay-intro__close:focus-visible { opacity: 1; outline: 2px solid currentColor; outline-offset: 2px; }
.clay-intro__close svg { display: block; width: 12px; height: 12px; fill: currentColor; stroke: none; }
@media (pointer: coarse) { .clay-intro__close { width: 44px; height: 44px; top: 4px; right: 4px; } }
@media print { .clay-intro { display: none; } }
`;
