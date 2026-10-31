export function deepActiveElement(scope = document) {
  let active = scope.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}
