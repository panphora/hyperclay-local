/**
 * Searches for elements matching a CSS selector by exploring the DOM tree outward from a starting point,
 * checking nearby elements first before moving to more distant parts of the document.
 *
 * Unlike `element.closest()` which only searches ancestors, this explores the DOM tree in a
 * unique pattern designed to find nearby elements in the visual layout:
 *
 * TRAVERSAL ORDER (for each level):
 * 1. Current element
 * 2. All children of current element (deeply)
 * 3. All previous siblings (right-to-left), exploring each fully with descendants
 * 4. All next siblings (left-to-right), exploring each fully with descendants
 * 5. Move to parent and repeat from step 1
 *
 * KEY FEATURES:
 * - Global visited cache prevents revisiting nodes (big performance boost)
 * - Searches "outward" from start position, checking nearby elements first
 * - Explores each sibling's entire subtree before moving to next sibling
 * - Continues up the ancestor chain until document.body
 *
 * USE CASES:
 * - Finding related UI elements that might be siblings or cousins
 * - Locating the "next" instance of something in reading order
 * - Finding nearby form fields, buttons, or other interactive elements
 *
 * @param {Element} startElem - Starting element for the search
 * @param {string} selector - CSS selector to match
 * @param {Function} elementFoundReturnValue - Transform function for the found element
 * @returns {*} Transformed element if found, null otherwise
 */
export default function nearest (startElem, selector, elementFoundReturnValue = x => x) {
  const visited = new Set();

  // Returns the matched ELEMENT, not the transformed value: a transform yielding
  // "" or false used to read as not-found here, so the search walked past a real
  // match (an empty input, an unchecked box) and could report a farther element.
  function checkDeep(root) {
    if (!root || visited.has(root)) return null;

    const queue = [root];
    const localVisited = new Set(); // Prevent cycles within this BFS

    while (queue.length > 0) {
      const node = queue.shift();
      if (!node || localVisited.has(node) || visited.has(node)) continue;

      visited.add(node);
      localVisited.add(node);

      if (node.matches(selector)) {
        return node;
      }

      queue.push(...node.children);
    }
    return null;
  }

  // Check siblings in a direction
  function checkSiblings(start, direction) {
    let sibling = start[direction];
    while (sibling) {
      const found = checkDeep(sibling);
      if (found) return found;
      sibling = sibling[direction];
    }
    return null;
  }

  // Main traversal
  // check current → children → siblings → move up
  let current = startElem;

  while (current) {
    // Check current node (shallow)
    if (!visited.has(current)) {
      visited.add(current);
      if (current.matches(selector)) {
        return elementFoundReturnValue(current);
      }
    }

    // Check children deeply
    for (const child of current.children) {
      const found = checkDeep(child);
      if (found) return elementFoundReturnValue(found);
    }

    // Check siblings deeply
    const found = checkSiblings(current, 'previousElementSibling') ||
                  checkSiblings(current, 'nextElementSibling');
    if (found) return elementFoundReturnValue(found);

    // Move up to parent
    current = current.parentElement;
  }

  return null;
}
