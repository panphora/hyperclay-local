// The sapjs core, for a page with a [sap] root and no full sapjs. It paints the
// presentations the page declares from its records (text, show, attr:, class:,
// css:), and ClayJS treats what it paints as derived (lib/derived.js). Markup
// that needs more is a mount error that names full sapjs. Full sapjs, loaded by
// its own script tag, takes the page over, and this plugin stays idle.

function fullSapjs() {
  const sap = window.Sap;
  return Boolean((sap && !sap.core) || window.clay?.loaded?.sap);
}

export const ready = fullSapjs() ? null : import("../vendor/sap-core.vendor.js").then(() => {});
