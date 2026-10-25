import Mutation from "../lib/mutation.js";
import onLoad from "../lib/on-load.js";

function init() {
  const executeRender = async (element) => {
    try {
      const code = element.getAttribute('onrender');
      const asyncFn = new Function(`return (async function() { ${code} })`)();
      await asyncFn.call(element);
    } catch (error) {
      console.error('Error in onrender execution:', error);
    }
  };

  // Execute onrender on page load
  onLoad(() => {
    document.querySelectorAll('[onrender]').forEach(executeRender);
  });

  // Execute onrender when new elements are added
  Mutation.onAddElement({
    selectorFilter: "[onrender]",
    debounce: 200,
    require: 'observed',
    pausable: false
  }, (changes) => {
    changes.forEach(({ element }) => executeRender(element));
  });
}

export { init };
export default init;
