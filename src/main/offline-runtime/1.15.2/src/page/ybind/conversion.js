import { cloneJson } from "../../live/ops.js";
import { canon } from "../projection.js";
import { migrateHybridValues, YMigrationError } from "./migrate.js";

const PAGE = /^page(\.[0-9]+)?$/;

export async function prepareHybridConversion(tags) {
  try {
    if (!Array.isArray(tags) || !tags.length) throw new YMigrationError("Expected named hybrid page tags");
    const names = new Set();
    const source = tags.map((tag) => {
      if (!Array.isArray(tag) || tag.length !== 2 || typeof tag[0] !== "string" || !PAGE.test(tag[0]) || names.has(tag[0])) {
        throw new YMigrationError("Expected unique page tag names");
      }
      names.add(tag[0]);
      return [tag[0], cloneJson(tag[1])];
    });
    const value = migrateHybridValues(source.map(([, value]) => value));
    const bytes = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canon(source)));
    const baseline = Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
    return { baseline, value };
  } catch (error) {
    if (error instanceof YMigrationError) throw error;
    throw new YMigrationError(`Cannot prepare hybrid conversion: ${error.message}`);
  }
}
