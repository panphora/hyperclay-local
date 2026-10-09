/**
 * An in-memory stand-in for the platform's /sync/nodes API.
 *
 * It holds node ids, paths, bytes, parent and name constraints, cascade delete,
 * `listNodes` and `getNodeContent`; it records every call, and it can apply a
 * call and then lose the response. `install()` wires it through the api-client
 * `jest.mock` the sync-engine suites already use, and any method it does not
 * implement throws instead of silently answering `undefined`.
 */

const crypto = require('crypto');

const checksumOf = (content) => crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);

function httpError(statusCode, message, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

function networkError(message = 'socket hang up') {
  const error = new Error(message);
  error.code = 'ECONNRESET';
  return error;
}

function asBuffer(content) {
  if (Buffer.isBuffer(content)) return content;
  return Buffer.from(content === undefined || content === null ? '' : String(content), 'utf8');
}

class FakeServer {
  /**
   * @param {Array<{id:number,type:string,name:string,parentId:number,content?:string|Buffer}>} nodes
   * @param {{delay?:() => Promise<void>}} [options]
   */
  constructor(nodes = [], { delay } = {}) {
    this.nodes = new Map();
    this.calls = [];
    this.onCall = null;
    this.delay = delay || (async () => {});
    this.loseAfter = null;
    this.failContent = false;
    this.nextId = 1;
    for (const node of nodes) {
      const id = Number(node.id);
      this.nextId = Math.max(this.nextId, id + 1);
      this.nodes.set(id, {
        id,
        type: node.type,
        name: node.name,
        parentId: node.parentId === undefined || node.parentId === null ? 0 : Number(node.parentId),
        content: node.type === 'folder' ? null : asBuffer(node.content),
        modifiedAt: node.modifiedAt || null,
        version: 1
      });
    }
  }

  // --- Reads ---

  get(id) {
    return this.nodes.get(Number(id)) || null;
  }

  /** The directory path a node sits in ('' at the root). */
  dirOf(id) {
    const node = this.get(id);
    if (!node) return null;
    const parts = [];
    let current = node;
    let guard = 0;
    while (current && current.parentId && guard++ < 100) {
      const parent = this.get(current.parentId);
      if (!parent) break;
      parts.unshift(parent.name);
      current = parent;
    }
    return parts.join('/');
  }

  /** The node's own relative path, or null when it does not exist. */
  relPathOf(id) {
    const node = this.get(id);
    if (!node) return null;
    const dir = this.dirOf(id);
    return dir ? `${dir}/${node.name}` : node.name;
  }

  descendantsOf(id) {
    const out = [];
    const stack = [Number(id)];
    while (stack.length) {
      const parent = stack.pop();
      for (const node of this.nodes.values()) {
        if (node.parentId === parent) {
          out.push(node.id);
          stack.push(node.id);
        }
      }
    }
    return out;
  }

  hasPath(rel) {
    for (const id of this.nodes.keys()) {
      if (this.relPathOf(id) === rel) return true;
    }
    return false;
  }

  paths() {
    return [...this.nodes.keys()].map((id) => this.relPathOf(id));
  }

  inventory() {
    const nodes = [...this.nodes.keys()].map((id) => {
      const node = this.get(id);
      const checksum = node.content ? checksumOf(node.content) : null;
      return {
        id: node.id,
        type: node.type,
        name: node.name,
        path: this.dirOf(id),
        parentId: node.parentId,
        etag: checksum,
        checksum,
        size: node.content ? node.content.length : 0,
        modifiedAt: node.modifiedAt,
        structureVersion: `${node.id}-${node.version}`
      };
    });
    Object.defineProperty(nodes, 'complete', { value: true, enumerable: false, configurable: true });
    return nodes;
  }

  // --- Call plumbing ---

  async record(name, args, targetId) {
    const call = {
      name,
      args,
      nodeId: targetId === undefined || targetId === null ? null : Number(targetId),
      pathBefore: targetId === undefined || targetId === null ? null : this.relPathOf(targetId),
    };
    this.calls.push(call);
    // The observer runs when the request leaves, not when the answer lands, so
    // a lane that started before a catch-up pass is not blamed on the pass.
    if (this.onCall) this.onCall(call);
    await this.delay();
    return call;
  }

  /** Apply the next call of this name, then lose the response. */
  loseResponseFor(name) {
    this.loseAfter = name;
  }

  maybeLose(name) {
    if (this.loseAfter !== name) return;
    this.loseAfter = null;
    throw networkError();
  }

  // --- API methods (conn is accepted and ignored) ---

  async listNodes() {
    await this.record('listNodes', []);
    return this.inventory();
  }

  async getServerStatus() {
    await this.record('getServerStatus', []);
    return { serverTime: new Date().toISOString(), success: true };
  }

  async getNodeContent(conn, id) {
    await this.record('getNodeContent', [id], id);
    if (this.failContent) throw networkError('download failed');
    const node = this.get(id);
    if (!node) throw httpError(404, `Node ${id} not found`);
    const checksum = node.content ? checksumOf(node.content) : null;
    return {
      content: node.type === 'upload' ? Buffer.from(node.content) : node.content.toString('utf8'),
      nodeType: node.type,
      modifiedAt: node.modifiedAt,
      checksum,
      etag: checksum,
      size: node.content ? node.content.length : 0,
      structureVersion: `${node.id}-${node.version}`
    };
  }

  async createNode(conn, { type, name, parentId, content, modifiedAt } = {}) {
    await this.record('createNode', [name, parentId], null);
    if (!name) throw httpError(400, 'A node needs a name');
    const parent = this._parentOf(parentId);
    this._assertFreeName(parent, name, null);
    const id = this.nextId++;
    this.nodes.set(id, {
      id,
      type,
      name,
      parentId: parent,
      content: type === 'folder' ? null : asBuffer(content),
      modifiedAt: modifiedAt || null,
      version: 1
    });
    this.calls[this.calls.length - 1].nodeId = id;
    const node = this.get(id);
    const checksum = node.content ? checksumOf(node.content) : null;
    return {
      id,
      type,
      name,
      parentId: parent,
      path: this.dirOf(id),
      etag: checksum,
      checksum,
      size: node.content ? node.content.length : 0,
      structureVersion: `${id}-1`
    };
  }

  async renameNode(conn, id, newName) {
    await this.record('renameNode', [id, newName], id);
    const node = this.get(id);
    if (!node) throw httpError(404, `Node ${id} not found`);
    this._assertFreeName(node.parentId, newName, node.id);
    node.name = newName;
    node.version++;
    this.maybeLose('renameNode');
    return { nodeId: node.id, newName, structureVersion: `${node.id}-${node.version}` };
  }

  async moveNode(conn, id, targetParentId, newName = null) {
    await this.record('moveNode', [id, targetParentId, newName], id);
    const node = this.get(id);
    if (!node) throw httpError(404, `Node ${id} not found`);
    const parent = this._parentOf(targetParentId);
    this._assertFreeName(parent, newName || node.name, node.id);
    node.parentId = parent;
    if (newName) node.name = newName;
    node.version++;
    this.maybeLose('moveNode');
    return { nodeId: node.id, newName: node.name, structureVersion: `${node.id}-${node.version}` };
  }

  async deleteNode(conn, id, { cascade = false } = {}) {
    await this.record('deleteNode', [id, { cascade }], id);
    const node = this.get(id);
    if (!node) throw httpError(404, `Node ${id} not found`);
    const descendants = this.descendantsOf(id);
    if (node.type === 'folder' && descendants.length && !cascade) {
      throw httpError(400, 'Folder is not empty');
    }
    for (const childId of descendants) this.nodes.delete(childId);
    this.nodes.delete(Number(id));
    this.maybeLose('deleteNode');
    return { nodeId: Number(id), type: node.type };
  }

  async putNodeContent(conn, id, content) {
    await this.record('putNodeContent', [id], id);
    const node = this.get(id);
    if (!node) throw httpError(404, `Node ${id} not found`);
    node.content = asBuffer(content);
    node.version++;
    this.maybeLose('putNodeContent');
    return { nodeId: node.id, checksum: checksumOf(node.content), size: node.content.length };
  }

  _parentOf(parentId) {
    if (parentId === 0 || parentId === 'root' || parentId === null || parentId === undefined) return 0;
    const parent = this.get(parentId);
    if (!parent) throw httpError(404, `Parent ${parentId} not found`);
    if (parent.type !== 'folder') throw httpError(400, `Parent ${parentId} is not a folder`);
    return parent.id;
  }

  _assertFreeName(parentId, name, ignoreId) {
    for (const node of this.nodes.values()) {
      if (node.id === ignoreId) continue;
      if (node.parentId !== Number(parentId)) continue;
      if (node.name === name) throw httpError(409, `A node named ${name} is already here`, 'name-conflict');
    }
  }
}

/**
 * Point every api-client export at this server. A method the server does not
 * implement throws, so a missing implementation cannot pass as a no-op.
 */
function install(apiClient, server) {
  for (const name of Object.keys(apiClient)) {
    const fn = apiClient[name];
    if (!fn || typeof fn.mockImplementation !== 'function') continue;
    const impl = typeof server[name] === 'function' ? server[name].bind(server) : null;
    fn.mockImplementation(async (...args) => {
      if (!impl) throw new Error(`sync-fake-server: ${name} is not implemented`);
      return impl(...args);
    });
  }
  return server;
}

module.exports = { FakeServer, install };
