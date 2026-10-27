import * as Y from "../../vendor/yjs.vendor.js";
import { REMOTE } from "../model.js";

export const LOCAL = "page-local";
export const NET = "page-net";
export const SEED = "page-seed";
export const REMOTE_META = REMOTE;
export const HISTORY_META = Symbol("page-history");
export const PAGE_ROOTS = Object.freeze(["flow", "attrs", "gone", "boardFields", "tableFields", "origins"]);

const SKIP = new Set(["id", "pos"]);
export const attrKeys = (type) => [...Object.keys(type.spec.attrs || {}).filter((k) => !SKIP.has(k)), ...(type.name === "table" ? ["rows"] : [])];
export const defaultOf = (type, k) => type.name === "table" && k === "rows" ? {} : type.spec.attrs[k].default;
export const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const idKey = (id) => `${id.client}.${id.clock}`;
export const parseKey = (k) => { const i = k.indexOf("."); return { client: +k.slice(0, i), clock: +k.slice(i + 1) }; };
export const isHigh = (u) => u >= 0xd800 && u <= 0xdbff;
export const isLow = (u) => u >= 0xdc00 && u <= 0xdfff;

let opCounter = 0;
export const mintOp = (pd) => `${pd.ydoc.clientID.toString(36)}-${(opCounter++).toString(36)}`;
let idCounter = 0;
export const mintId = (pd) => `b${pd.ydoc.clientID.toString(36)}${(idCounter++).toString(36)}`;

export function createPageDoc(ydoc = new Y.Doc()) {
  return { ydoc, flow: ydoc.getText("flow"), attrs: ydoc.getMap("attrs"), gone: ydoc.getMap("gone"), boardFields: ydoc.getMap("boardFields"), tableFields: ydoc.getMap("tableFields"), origins: ydoc.getMap("origins") };
}
