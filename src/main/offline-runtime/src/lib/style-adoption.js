let adopter = () => {};

export function registerStyleAdoption(fn) {
  adopter = fn;
}

export function adoptStyleComparisons(identity) {
  adopter(identity);
}
