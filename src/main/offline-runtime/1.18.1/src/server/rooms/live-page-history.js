import { randomUUID } from 'node:crypto';
import { cloneJson, serializeLive } from './live-data-ops.js';

export function makePageTransition({ room = null, format = 'yjs', sources = [], receipts = new Map() } = {}) {
  const archived = new Map([...receipts].map(([key, receipt]) => [key, cloneJson(receipt)]));
  const history = [...(room?.pageTransition?.history ?? [])];
  if (archived.size) history.push({
    epoch: room.epoch,
    generation: room.pageTransition?.id ?? null,
    receiptGeneration: room.receiptGeneration ?? 0,
    sources: [...sources],
    receipts: archived,
  });
  const transition = { v: 2, id: randomUUID(), format, sources: [...sources], receipts: archived, history };
  transition.receiptCount = history.reduce((count, entry) => count + entry.receipts.size, 0);
  const entries = history.map(({ epoch, generation, receiptGeneration, sources, receipts }) =>
    [epoch, generation, receiptGeneration, sources, [...receipts]]);
  transition.historyBytes = entries.reduce((bytes, entry) => bytes + Buffer.byteLength(serializeLive(entry), 'utf8'), 0);
  transition.bytes = Buffer.byteLength(serializeLive([transition.v, transition.id, format, transition.sources, entries]), 'utf8');
  return transition;
}

function ownReceipts(receipts, clientId) {
  const mine = {};
  if (clientId) for (const [key, receipt] of receipts) {
    const split = key.indexOf('\n');
    if (key.slice(split + 1) !== clientId) continue;
    mine[key.slice(0, split)] = { seen: { [clientId]: receipt.n }, ...(receipt.saved?.length && { saved: receipt.saved }) };
  }
  return mine;
}

export function pageTransitionState(transition, clientId) {
  const { v, id, format, sources, receipts, history } = transition;
  return {
    v, id, format, sources, receipts: ownReceipts(receipts, clientId),
    history: history.map(({ epoch, generation, receiptGeneration, sources, receipts }) => ({
      epoch, generation, receiptGeneration, sources, receipts: ownReceipts(receipts, clientId),
    })),
  };
}
