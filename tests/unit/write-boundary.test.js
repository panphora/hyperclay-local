const {
  withDocumentWrite,
  withStructureChange,
  assertWriteContext,
  assertStructureContext,
  pendingKeys,
} = require('../../src/main/utils/write-queue');
const { attachLane } = require('../../src/sync-engine/state/sync-lane');

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

const target = canonicalPath => async () => ({ canonicalPath });

test('independent document writers enter together, while a second writer for A waits', async () => {
  const a = deferred();
  const b = deferred();
  const entered = deferred();
  const order = [];
  let active = 0;
  const first = withDocumentWrite(target('/a'), async () => {
    order.push('A1');
    if (++active === 2) entered.resolve();
    await a.promise;
    active--;
  });
  const second = withDocumentWrite(target('/b'), async () => {
    order.push('B');
    if (++active === 2) entered.resolve();
    await b.promise;
    active--;
  });
  const third = withDocumentWrite(target('/a'), async () => { order.push('A2'); });

  await entered.promise;
  expect(active).toBe(2);
  expect(order).toEqual(['A1', 'B']);
  b.resolve();
  await second;
  expect(order).toEqual(['A1', 'B']);
  a.resolve();
  await Promise.all([first, third]);
  expect(order).toEqual(['A1', 'B', 'A2']);
  expect(pendingKeys()).toEqual([]);
});

test('queued structure change runs before later document writers', async () => {
  const heldA = deferred();
  const heldStructure = deferred();
  const enteredA = deferred();
  const enteredStructure = deferred();
  const order = [];
  const a = withDocumentWrite(target('/a'), async () => {
    order.push('A');
    enteredA.resolve();
    await heldA.promise;
  });
  await enteredA.promise;
  const structure = withStructureChange(async token => {
    assertStructureContext(token);
    order.push('X');
    enteredStructure.resolve();
    await heldStructure.promise;
  });
  const b = withDocumentWrite(target('/b'), async () => { order.push('B'); });
  await Promise.resolve();
  expect(order).toEqual(['A']);
  heldA.resolve();
  await enteredStructure.promise;
  expect(order).toEqual(['A', 'X']);
  heldStructure.resolve();
  await Promise.all([a, structure, b]);
  expect(order).toEqual(['A', 'X', 'B']);
  expect(pendingKeys()).toEqual([]);
});

test('resolver and callback failures release the gate and file queue', async () => {
  let entered = 0;
  await expect(withDocumentWrite(async () => { throw new Error('resolver'); }, () => {}))
    .rejects.toThrow('resolver');
  await expect(withDocumentWrite(target('/failure'), async () => { throw new Error('callback'); }))
    .rejects.toThrow('callback');
  await withDocumentWrite(target('/failure'), async () => { entered++; });
  expect(entered).toBe(1);
  expect(pendingKeys()).toEqual([]);
});

test('nested acquisition and engine lane reject, and forged or foreign ownership fails', async () => {
  const engine = {};
  attachLane(engine);
  const foreign = {};
  let owned;
  await withDocumentWrite(target('/owned'), async (_target, token) => {
    owned = token;
    assertWriteContext(token, '/owned');
    expect(() => assertWriteContext(token, '/elsewhere')).toThrow('ownership');
    expect(() => assertWriteContext(foreign, '/owned')).toThrow('ownership');
    expect(() => assertStructureContext(token)).toThrow('ownership');
    await expect(withDocumentWrite(target('/nested'), () => {})).rejects.toThrow('Nested');
    await expect(withStructureChange(() => {})).rejects.toThrow('Nested');
    expect(() => engine.serial(() => {})).toThrow('Nested');
    expect(engine._lanePending).toBe(0);
  });
  expect(() => assertWriteContext(owned, '/owned')).toThrow('ownership');
  await withStructureChange(token => {
    assertStructureContext(token);
    assertWriteContext(token, '/any');
  });
});

test('detached continuation has released ownership but may acquire a new boundary', async () => {
  const resume = deferred();
  let stale;
  let detached;
  await withDocumentWrite(target('/old'), async (_target, token) => {
    stale = token;
    detached = resume.promise.then(async () => {
      expect(() => assertWriteContext(stale, '/old')).toThrow('ownership');
      await withDocumentWrite(target('/new'), (_current, next) => {
        assertWriteContext(next, '/new');
      });
    });
  });
  resume.resolve();
  await detached;
  expect(pendingKeys()).toEqual([]);
});

test('stalled fetch outside the gate does not block a document save', async () => {
  const network = deferred();
  const fetched = network.promise.then(() => withDocumentWrite(target('/remote'), () => {}));
  let saves = 0;
  await withDocumentWrite(target('/browser'), () => { saves++; });
  expect(saves).toBe(1);
  network.resolve();
  await fetched;
  expect(pendingKeys()).toEqual([]);
});
