function init () {

  // the code inside `onclickaway` attributes will be executed whenever that element is NOT clicked
  document.addEventListener('click', function(event) {
    const elementsWithOnClickAway = document.querySelectorAll('[onclickaway]');

    elementsWithOnClickAway.forEach(element => {
      let targetElement = event.target; // clicked element

      do {
        if (targetElement === element) {
          // Click inside, do nothing
          return;
        }
        // Go up the DOM
        targetElement = targetElement.parentNode;
      } while (targetElement);

      // Click outside the element, execute onclickaway
      new Function(element.getAttribute('onclickaway')).call(element);
    });
  });

}

export { init };
export default init;
