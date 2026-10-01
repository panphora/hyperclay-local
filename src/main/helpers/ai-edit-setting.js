// AI editing is on unless the person turned it off: a settings file written
// before the setting existed reads as on, and an explicit false stays off.
function aiEditEnabled(settings) {
  return settings?.aiEdit?.enabled !== false;
}

function toggledAiEdit(settings) {
  return { ...settings?.aiEdit, enabled: !aiEditEnabled(settings) };
}

module.exports = { aiEditEnabled, toggledAiEdit };
