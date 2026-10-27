// A function of one string that remembers its last few answers. A save hands the
// same document to several readers in turn, and each would otherwise parse it again.
export function recent(size, fn) {
  const answers = new Map();
  return (html) => {
    if (typeof html !== 'string') return fn(html);
    if (answers.has(html)) {
      const answer = answers.get(html);
      answers.delete(html);
      answers.set(html, answer);
      return answer;
    }
    const answer = fn(html);
    answers.set(html, answer);
    if (answers.size > size) answers.delete(answers.keys().next().value);
    return answer;
  };
}
