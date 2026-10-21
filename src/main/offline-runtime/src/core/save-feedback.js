// Which save feedback is on the page, so the indicator chip and the automatic toasts
// never report the same save twice: the chip owns saving and saved, the toasts own a
// save that failed or went offline. Each side sets its own flag when it loads; both
// read them only when an event arrives, so load order does not matter. savedToast is
// the page's `clay.saveToast` switch: Saved goes to a toast instead of the chip.
export const saveFeedback = { chip: false, toasts: false, savedToast: false };
