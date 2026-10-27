// easily convert a form into a JS object
function getDataFromForm(container) {
  const formData = {};

  // Helper function to process a single element
  const processElement = (elem) => {
    const name = elem.getAttribute('name');
    const value = elem.value ?? elem.getAttribute('value');

    // Skip elements without a name or with a disabled attribute
    if (!name || elem.disabled) return;

    // Handle different element types
    switch (elem.type) {
      case 'checkbox':
        if (!formData[name]) {
          formData[name] = [];
        }
        if (elem.checked) {
          formData[name].push(value);
        }
        break;
      case 'radio':
        if (elem.checked) {
          formData[name] = value;
        }
        break;
      case 'select-multiple':
        formData[name] = Array.from(elem.selectedOptions, option => option.value);
        break;
      case 'button':
      case 'submit':
      case 'reset':
        // Only include buttons if they have both name and value attributes
        if (name && value) {
          formData[name] = value;
        }
        break;
      default:
        formData[name] = value;
    }
  };

  // If container is a form, use elements property
  if (container instanceof HTMLFormElement) {
    Array.from(container.elements).forEach(processElement);
  }
  // Otherwise, process container itself and then query for elements with name attribute
  else {
    // Process container element if it has a name attribute
    if (container.hasAttribute('name')) {
      processElement(container);
    }
    // Process all child elements with name attributes
    const elements = container.querySelectorAll('[name]');
    elements.forEach(processElement);
  }

  return formData;
}

export default getDataFromForm;
