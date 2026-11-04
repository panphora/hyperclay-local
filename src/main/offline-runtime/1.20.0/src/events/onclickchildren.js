function init() {
  document.addEventListener('click', function(event) {
    const parent = event.target.closest('[onclickchildren]');
    if (parent && event.target !== parent) {
      const directChild = event.composedPath().find(el => el.parentNode === parent);
      new Function(parent.getAttribute('onclickchildren')).call(directChild);
    }
  });
}

export { init };
export default init;
