import * as Y from "../../vendor/yjs.vendor.js";
import { parseModel } from "../projection.js";
import { blockFromItem } from "../adopt.js";
import { seedClientId } from "./migrate.js";
import { entriesOf } from "./parts.js";
import { digestHex } from "./recovery-proof.js";

// The seed client of an article: the Yjs client id seedPageFromArticle would write,
// without building the seed. Two articles with the same blocks share it.
export function seedLineage(article) {
  const items = parseModel(article, { seed: article.getAttribute("data-rev") ?? "" });
  if (!items.length) return { client: null };
  const blocks = {};
  items.forEach((item, i) => {
    const block = blockFromItem(item, null);
    block.pos = String(i + 1).padStart(8, "0");
    blocks[item.id] = block;
  });
  return { client: seedClientId(blocks) };
}

export function valueClients(value) {
  const clients = new Set();
  for (const [, text] of entriesOf(value?.y ?? {})) {
    try {
      for (const client of Y.decodeStateVector(Y.encodeStateVectorFromUpdateV2(Y.fromBase64(text))).keys()) clients.add(client);
    } catch {}
  }
  return clients;
}

export function sharesLineage(stored, incoming) {
  const theirs = valueClients(stored);
  const mine = valueClients(incoming);
  if (!theirs.size || !mine.size || [...mine].some((client) => theirs.has(client))) return true;
  const kept = new Map(entriesOf(stored?.y ?? {}));
  return entriesOf(incoming?.y ?? {}).some(([key, text]) => kept.get(key) === text);
}

// May a journal written under `a` be replayed into a page under `b`? Same page
// generation, and the same base bytes: an externally replaced article is another
// generation even when it shows the same text.
export function sameLineage(a, b) {
  if (!a || !b || !a.generation || !b.generation) return false;
  return a.generation === b.generation && a.baseDigest === b.baseDigest;
}

// The lineage a capsule records for its immutable base: the digest the host persists
// and the state vector the page's own document had at the same moment.
export async function lineageOf(generation, base) {
  const bytes = base instanceof Uint8Array ? base : new Uint8Array(0);
  return {
    generation,
    baseDigest: await digestHex(bytes),
    baseVector: bytes.length ? Y.encodeStateVectorFromUpdateV2(bytes) : new Uint8Array(0),
  };
}

// The existing ancestry check, with the empty case refused: an update with no client of
// its own shares lineage with nothing, and neither does a page with no clients.
export function sharesAncestry(stored, incoming) {
  const theirs = valueClients(stored);
  const mine = valueClients(incoming);
  if (!theirs.size || !mine.size) return false;
  return sharesLineage(stored, incoming);
}

export function seedOnly(doc, client) {
  for (const id of Y.decodeStateVector(Y.encodeStateVector(doc)).keys()) if (id !== client) return false;
  return Y.createDeleteSetFromStructStore(doc.store).clients.size === 0;
}
