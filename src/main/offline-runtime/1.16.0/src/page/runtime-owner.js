// One runtime owns an article at a time. A reader owns the article it projects;
// the editor owns it from the moment it mounts, including the noneditable period
// while saved feature views are still arriving. A mode flag is not enough: two
// runtimes both think they may write, and a late frame lands over a mounted tool.
//
// The kind is diagnostic, not permission to share. A second claim on the same
// article throws even when it names the same kind, so a double start fails loudly
// instead of leaving two listeners on one article.

const owners = new WeakMap();

export function claim(article, kind) {
  if (!article || article.nodeType !== 1) throw new TypeError("clayjs: claim needs an element to own");
  if (owners.has(article)) throw new Error(`clayjs: the article already has a ${owners.get(article).kind} runtime`);
  const token = { kind: String(kind ?? "runtime"), active: true };
  owners.set(article, token);
  return function release() {
    if (!token.active) return false;
    token.active = false;
    if (owners.get(article) === token) owners.delete(article);
    return true;
  };
}

export function ownerOf(article) {
  return owners.get(article)?.kind ?? null;
}
