import { orders, invoices } from '../lib/services.js';

const BATCH_SIZE = 100;

export async function invoiceNightly() {
  let cursor = null;
  while (true) {
    const batch = await orders.listUninvoiced({ after: cursor, limit: BATCH_SIZE });
    if (batch.length === 0) break;

    // Every invoice in the batch is issued at the same time.
    await Promise.all(batch.map((order) => invoices.issue(order)));
    await orders.markInvoiced(batch.map((order) => order.id));

    cursor = batch[batch.length - 1].id;
  }
}
