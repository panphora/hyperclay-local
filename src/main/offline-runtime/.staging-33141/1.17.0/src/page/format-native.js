// The four formats this release adds: underline, text color, highlight and the
// quote block.
//
// Each is written as the named descriptor an older runtime already keeps as an
// opaque mark, `x["text_color",{"color":"red"}]`, so R reads back exactly what F
// wrote. The palette is fixed and its keys are the only colors a descriptor may
// name: one naming any other color stays opaque rather than being read as a
// style, and no command accepts arbitrary CSS.
//
// This half is the reading one: what the schema, inline.js and the projection need
// to read a descriptor back and draw it. The commands that write one are in
// format-native-commands.js, which a page loads the first time one runs.
export const NATIVE_NAMES = new Set(["underline", "text_color", "highlight"]);

export const PALETTE = ["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"];
const COLORS = new Set(PALETTE);

// The descriptor attrs of a native mark, or null when this name and these attrs
// are not one of the formats this runtime writes.
export function nativeAttrs(name, attrs) {
  const plain = attrs !== null && typeof attrs === "object" && !Array.isArray(attrs);
  if (name === "underline") return plain && Object.keys(attrs).length === 0 ? {} : null;
  if (name === "text_color" || name === "highlight") {
    const keys = plain ? Object.keys(attrs) : [];
    return keys.length === 1 && keys[0] === "color" && COLORS.has(attrs.color) ? { color: attrs.color } : null;
  }
  return null;
}

// Whether this selection holds text the mark may be added to: a code block takes
// no marks, and a block selection is not text at all. It stays here, beside the
// reading half, because the keyboard decides whether Mod-u is its own before any
// command is loaded.
export function markable(st, type) {
  const { $from, $to, empty } = st.selection;
  if (empty) return $from.parent.type.allowsMarkType(type);
  let ok = false;
  st.doc.nodesBetween($from.pos, $to.pos, (node, _at, parent) => {
    if (!ok && node.isText && parent?.type.allowsMarkType(type)) ok = true;
  });
  return ok;
}
