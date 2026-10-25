// Tailwind v4 plugin for ClayJS ephemeral state:
//   @plugin "@panphora/clayjs/tailwind";
// ephemeral-selected:ring-2 -> &[ephemeral~="selected"]. matchVariant only
// accepts bare names that `values` lists, so `values` answers for any simple
// word; the bracketed form ephemeral-[selected]: works regardless.
const anyWord = new Proxy({}, {
  get: (_, key) => (typeof key === "string" && /^[a-z0-9_-]+$/i.test(key) ? key : undefined),
});

export default function ephemeralVariant({ matchVariant }) {
  matchVariant("ephemeral", (value) => `&[ephemeral~="${value}"]`, { values: anyWord });
}
