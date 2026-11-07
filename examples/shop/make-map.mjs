// Run: node examples/shop/make-map.mjs
// Builds examples/shop/flows.json (current code) and base.json (the version before free shipping
// and nightly invoicing existed). Every line number is looked up in the real source files.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const cache = {};
const lines = (f) => (cache[f] ||= fs.readFileSync(path.join(ROOT, 'src', f), 'utf8').split('\n'));
const L = (f, snip, from = 0) => {
  const i = lines(f).findIndex((l, k) => k >= from && l.includes(snip));
  if (i < 0) throw new Error(`"${snip}" not found in ${f}`);
  return i + 1;
};
// Range of the block that starts on the line containing `snip` (brace matching).
const R = (f, snip) => {
  const start = L(f, snip);
  let depth = 0, seen = false;
  for (let k = start - 1; k < lines(f).length; k++) {
    for (const ch of lines(f)[k]) { if (ch === '{') { depth++; seen = true; } else if (ch === '}') depth--; }
    if (seen && depth === 0) return [start, k + 1];
  }
  throw new Error(`unbalanced block at ${f}:${start}`);
};
const F = (f) => `src/${f}`;
const S = (f, snip, endSnip) => { const a = L(f, snip); return [a, L(f, endSnip, a - 1)]; };
const call = (fn, f, range, depth, extra = {}) => ({ fn, file: F(f), line: Array.isArray(range) ? range[0] : range, ...(Array.isArray(range) && range[1] !== range[0] ? { endLine: range[1] } : {}), depth, ...extra });
const at = (f, snip) => [{ file: F(f), line: L(f, snip) }];

const APP = 'app.js', AUTH = 'lib/auth.js', PO = 'orders/place-order.js', FO = 'fulfillment/fulfill-order.js', NI = 'invoicing/nightly-invoices.js';
const placeOrder = R(PO, 'export async function placeOrder');

// ------------------------------------------------------------------ checkout
const checkout = {
  id: 'place-order', title: 'Place an order', domain: 'Checkout', actor: 'Customer',
  trigger: { kind: 'http', signature: 'POST /orders', anchors: at(APP, "app.post('/orders'") },
  summary: 'A signed-in customer checks out their cart. Stock is checked, shipping is added, the card is charged (with retries), the order is saved and sent to shipping.',
  nodes: [
    { id: 'start', type: 'start', label: 'Customer places an order', calls: [call('app.post /orders', APP, L(APP, "app.post('/orders'"), 0, { kind: 'framework', note: 'Express route, runs requireCustomer then placeOrder' })] },
    { id: 'signed-in', type: 'decision', label: 'Is the customer signed in?', rule: 'Only a signed-in customer can place an order.', anchors: at(AUTH, 'if (!customer)'), confidence: 'high',
      calls: [call('requireCustomer', AUTH, R(AUTH, 'export async function requireCustomer'), 0, { kind: 'framework', note: 'middleware' })] },
    { id: 'has-items', type: 'decision', label: 'Does the cart have items?', rule: 'An empty cart cannot be ordered.', anchors: at(PO, 'cart.items.length === 0'), confidence: 'high',
      calls: [call('placeOrder', PO, placeOrder, 0), call('carts.get', PO, L(PO, 'carts.get('), 1)] },
    { id: 'in-stock', type: 'decision', label: 'Is every item in stock?', rule: 'Each item is checked one by one with the inventory service. The first item without enough stock stops the order. Stock is only checked, not reserved.', anchors: at(PO, 'available < item.quantity'), confidence: 'high',
      calls: [call('placeOrder (stock loop)', PO, R(PO, 'for (const item of cart.items)'), 1), call('inventory.available', PO, L(PO, 'inventory.available('), 2)] },
    { id: 'free-shipping', type: 'decision', label: 'Is the order $100 or more?', rule: 'Orders of $100 or more ship for free.', anchors: at(PO, 'const shipping ='), confidence: 'high',
      calls: [call('placeOrder (shipping)', PO, L(PO, 'const shipping ='), 1)] },
    { id: 'no-fee', type: 'action', label: 'Ship for free', rule: 'Shipping is $0.', anchors: at(PO, 'const shipping ='), confidence: 'high', calls: [call('placeOrder (shipping)', PO, L(PO, 'const shipping ='), 1)] },
    { id: 'add-fee', type: 'action', label: 'Add $7.90 shipping', rule: 'Orders under $100 pay $7.90 shipping.', anchors: at(PO, 'const SHIPPING_FEE'), confidence: 'high', calls: [call('placeOrder (shipping)', PO, L(PO, 'const shipping ='), 1)] },
    { id: 'charge', type: 'external', label: 'Charge the card', system: 'Payment provider', rule: 'Charges the cart total plus shipping.', anchors: at(PO, 'payments.charge('), confidence: 'high',
      calls: [call('placeOrder (payment loop)', PO, R(PO, 'while (true)'), 1), call('payments.charge', PO, L(PO, 'payments.charge('), 2)] },
    { id: 'approved', type: 'decision', label: 'Was the payment approved?', rule: 'Approved continues. Declined stops the order. Any other answer from the provider is treated as a temporary failure and retried.', anchors: at(PO, "charge.status === 'approved'"), confidence: 'high',
      calls: [call('placeOrder (payment status)', PO, [L(PO, "charge.status === 'approved'"), L(PO, "return res.status(402)") + 1], 2)] },
    { id: 'attempts-left', type: 'decision', label: 'Any payment attempts left?', rule: 'Up to 3 attempts in total.', anchors: at(PO, 'const MAX_PAYMENT_ATTEMPTS'), confidence: 'high',
      calls: [call('placeOrder (attempt limit)', PO, R(PO, 'if (attempt >= MAX_PAYMENT_ATTEMPTS)'), 2)] },
    { id: 'wait', type: 'action', label: 'Wait, then try again', rule: 'Waits 1 second after the first failure and 2 seconds after the second.', anchors: at(PO, 'await sleep('), confidence: 'high',
      calls: [call('sleep', PO, L(PO, 'await sleep('), 2)] },
    { id: 'save-order', type: 'data', label: 'Save the order as paid', data: { op: 'write', entity: 'Order', fields: ['items', 'shipping', 'total', 'chargeId', 'status'] }, anchors: at(PO, 'orders.create('), confidence: 'high',
      calls: [call('orders.create', PO, R(PO, 'const order = await orders.create('), 1)] },
    { id: 'queue-shipping', type: 'action', label: 'Send the order to shipping', anchors: at(PO, 'fulfillmentQueue.add('), confidence: 'high',
      calls: [call('fulfillmentQueue.add', PO, L(PO, 'fulfillmentQueue.add('), 1, { kind: 'event' })], emits: [{ channel: 'queue:fulfillment', label: 'one job per order' }] },
    { id: 'clear-cart', type: 'data', label: 'Empty the cart', data: { op: 'delete', entity: 'Cart' }, anchors: at(PO, 'carts.clear('), confidence: 'high', calls: [call('carts.clear', PO, L(PO, 'carts.clear('), 1)] },
    { id: 'placed', type: 'outcome', label: 'Order placed', result: 'success', response: '201 · the order', anchors: at(PO, 'res.status(201)'), confidence: 'high' },
    { id: 'not-signed-in', type: 'outcome', label: 'Asked to sign in', result: 'rejected', response: '401 · Sign in to place an order', anchors: at(AUTH, 'res.status(401)'), confidence: 'high' },
    { id: 'empty-cart', type: 'outcome', label: 'Refused: the cart is empty', result: 'rejected', response: '400 · Your cart is empty', anchors: at(PO, 'res.status(400)'), confidence: 'high' },
    { id: 'out-of-stock', type: 'outcome', label: 'Refused: an item is out of stock', result: 'rejected', response: '409 · <item> is out of stock', anchors: at(PO, 'res.status(409)'), confidence: 'high' },
    { id: 'inventory-down', type: 'outcome', label: 'Generic error: inventory did not answer', result: 'error', response: '500 · Internal Server Error (Express default)', implicit: true,
      rule: 'The code does not handle an inventory timeout. The error escapes and Express answers with its default 500 page.', anchors: at(PO, 'No try/catch'), confidence: 'medium' },
    { id: 'declined', type: 'outcome', label: 'Refused: card declined', result: 'rejected', response: '402 · Your card was declined', anchors: at(PO, 'res.status(402)'), confidence: 'high' },
    { id: 'payments-down', type: 'outcome', label: 'Payments unavailable', result: 'error', response: '503 · Payments are unavailable, try again later', anchors: at(PO, 'res.status(503)'), confidence: 'high' },
    { id: 'charged-no-order', type: 'outcome', label: 'Card charged, but no order saved', result: 'error', response: '500 · Internal Server Error (Express default)', implicit: true,
      rule: 'If saving the order fails, the card has already been charged. Nothing refunds it and the customer sees a generic error.', anchors: at(PO, 'Not wrapped'), confidence: 'medium' },
  ],
  edges: [
    { from: 'start', to: 'signed-in' },
    { from: 'signed-in', to: 'has-items', label: 'Yes' }, { from: 'signed-in', to: 'not-signed-in', label: 'No' },
    { from: 'has-items', to: 'in-stock', label: 'Yes' }, { from: 'has-items', to: 'empty-cart', label: 'No' },
    { from: 'in-stock', to: 'free-shipping', label: 'Yes' }, { from: 'in-stock', to: 'out-of-stock', label: 'No' },
    { from: 'in-stock', to: 'inventory-down', label: 'Times out', implicit: true },
    { from: 'free-shipping', to: 'no-fee', label: 'Yes' }, { from: 'free-shipping', to: 'add-fee', label: 'No' },
    { from: 'no-fee', to: 'charge' }, { from: 'add-fee', to: 'charge' },
    { from: 'charge', to: 'approved' },
    { from: 'approved', to: 'save-order', label: 'Approved' }, { from: 'approved', to: 'declined', label: 'Declined' },
    { from: 'approved', to: 'attempts-left', label: 'Other' },
    { from: 'attempts-left', to: 'wait', label: 'Yes' }, { from: 'attempts-left', to: 'payments-down', label: 'No' },
    { from: 'wait', to: 'charge', label: 'retry', loop: true },
    { from: 'save-order', to: 'queue-shipping' }, { from: 'save-order', to: 'charged-no-order', label: 'Save fails', implicit: true },
    { from: 'queue-shipping', to: 'clear-cart' }, { from: 'clear-cart', to: 'placed' },
  ],
  happyPath: 'placed',
  outcomes: { 'not-signed-in': 'Not signed in', 'empty-cart': 'Empty cart', 'out-of-stock': 'Out of stock', 'inventory-down': 'Inventory times out', declined: 'Card declined', 'payments-down': 'Payments unavailable', 'charged-no-order': 'Charged but not saved' },
  findings: [
    { kind: 'risk', text: 'If saving the order fails after the card is charged, the customer pays and gets no order. Nothing refunds them.', nodes: ['charged-no-order', 'save-order'] },
    { kind: 'gap', text: 'Stock is checked but not reserved, so two customers can both buy the last unit.', nodes: ['in-stock'] },
    { kind: 'risk', text: 'Any payment answer other than "approved" or "declined" (for example "pending review") is retried, which may charge the customer again.', nodes: ['approved'] },
    { kind: 'gap', text: 'An inventory timeout shows the customer a generic error page instead of a message.', nodes: ['inventory-down'] },
  ],
};

// ------------------------------------------------------------------ fulfillment (parallel)
const fulfill = {
  id: 'ship-order', title: 'Ship a paid order', domain: 'Shipping', actor: 'Queue worker',
  trigger: { kind: 'job', signature: 'Worker "fulfillment" (5 attempts, exponential backoff)', channel: 'queue:fulfillment', anchors: at(APP, "new Worker('fulfillment'") },
  summary: 'Runs for every paid order. Each warehouse holding items gets its shipment request at the same time. When all have accepted, the order is marked shipped and the customer gets the tracking links.',
  nodes: [
    { id: 'start', type: 'start', label: 'Shipping job starts', calls: [call('new Worker(fulfillment)', APP, L(APP, "new Worker('fulfillment'"), 0, { kind: 'framework', note: 'queue worker; attempts: 5' })] },
    { id: 'cancelled', type: 'decision', label: 'Was the order cancelled?', rule: 'Cancelled orders are skipped.', anchors: at(FO, "order.status === 'cancelled'"), confidence: 'high',
      calls: [call('fulfillOrder', FO, R(FO, 'export async function fulfillOrder'), 0), call('orders.get', FO, L(FO, 'orders.get('), 1)] },
    { id: 'split', type: 'action', label: 'Split the order by warehouse', rule: 'One shipment per warehouse that holds items of the order. All are requested at the same time.', anchors: at(FO, 'groupBy(order.items'), confidence: 'high',
      fanout: { mode: 'parallel', over: 'one shipment per warehouse, all at once' },
      calls: [call('groupBy', FO, L(FO, 'groupBy(order.items'), 1), call('Promise.all', FO, S(FO, 'const shipments = await Promise.all(', ');'), 1)] },
    { id: 'request-shipment', type: 'external', label: 'Ask the warehouse to ship its items', system: 'Warehouse API', anchors: at(FO, 'warehouses.createShipment('), confidence: 'high',
      calls: [call('warehouses.createShipment', FO, L(FO, 'warehouses.createShipment('), 2)] },
    { id: 'all-accepted', type: 'decision', label: 'Did every warehouse accept?', rule: 'Waits for every warehouse. A single rejection fails the whole job.', anchors: at(FO, 'If any warehouse rejects'), confidence: 'high',
      join: { mode: 'all' }, calls: [call('Promise.all (join)', FO, S(FO, 'const shipments = await Promise.all(', ');'), 1)] },
    { id: 'retries-left', type: 'decision', label: 'Does the queue have retries left?', rule: 'The queue runs the whole job again, up to 5 attempts in total, waiting longer each time (about 1, 2, 4 and 8 minutes).', anchors: at(APP, "new Worker('fulfillment'"), confidence: 'medium',
      calls: [call('Worker options', APP, L(APP, "new Worker('fulfillment'"), 0, { kind: 'config', note: 'attempts: 5, exponential backoff from 60 s' })] },
    { id: 'mark-shipped', type: 'data', label: 'Mark the order as shipped', data: { op: 'write', entity: 'Order', fields: ['status', 'tracking'] }, anchors: at(FO, 'orders.update('), confidence: 'high',
      calls: [call('orders.update', FO, R(FO, 'await orders.update('), 1)] },
    { id: 'email', type: 'external', label: 'Email the tracking links', system: 'Email', anchors: at(FO, 'mailer.send('), confidence: 'high', calls: [call('mailer.send', FO, L(FO, 'mailer.send('), 1)] },
    { id: 'shipped', type: 'outcome', label: 'Order shipped', result: 'success', anchors: at(FO, 'return { shipped'), confidence: 'high' },
    { id: 'skipped', type: 'outcome', label: 'Nothing shipped: order cancelled', result: 'rejected', anchors: at(FO, "return { skipped: 'cancelled' }"), confidence: 'high' },
    { id: 'gave-up', type: 'outcome', label: 'Job fails for good; nobody is told', result: 'error', implicit: true,
      rule: 'After the 5th failure the job stays in the queue\'s failed list. The order stays "paid", and no one is alerted.', anchors: at(APP, "new Worker('fulfillment'"), confidence: 'medium' },
  ],
  edges: [
    { from: 'start', to: 'cancelled' },
    { from: 'cancelled', to: 'split', label: 'No' }, { from: 'cancelled', to: 'skipped', label: 'Yes' },
    { from: 'split', to: 'request-shipment', label: 'each warehouse' },
    { from: 'request-shipment', to: 'all-accepted' },
    { from: 'all-accepted', to: 'mark-shipped', label: 'Yes' }, { from: 'all-accepted', to: 'retries-left', label: 'No', implicit: true },
    { from: 'retries-left', to: 'cancelled', label: 'run the whole job again', loop: true }, { from: 'retries-left', to: 'gave-up', label: 'No', implicit: true },
    { from: 'mark-shipped', to: 'email' }, { from: 'email', to: 'shipped' },
  ],
  happyPath: 'shipped',
  outcomes: { skipped: 'Order was cancelled', 'gave-up': 'Gives up after 5 attempts' },
  findings: [
    { kind: 'risk', text: 'A retry asks every warehouse again, including the ones that already accepted. One failing warehouse can create up to 5 duplicate shipments elsewhere.', nodes: ['retries-left', 'request-shipment'] },
    { kind: 'gap', text: 'When the job gives up, the order stays "paid" forever and nobody is alerted.', nodes: ['gave-up'] },
  ],
};

// ------------------------------------------------------------------ invoicing (batches + loop)
const invoicing = {
  id: 'invoice-nightly', title: 'Invoice the day\'s orders', domain: 'Billing', actor: 'Scheduler',
  trigger: { kind: 'cron', signature: '0 2 * * * (every day at 02:00)', anchors: at(APP, 'cron.schedule(') },
  summary: 'Every night, orders without an invoice are invoiced in batches of 100. Within a batch, all invoices are issued at the same time.',
  nodes: [
    { id: 'start', type: 'start', label: 'Nightly invoicing starts at 02:00', calls: [call('cron.schedule', APP, L(APP, 'cron.schedule('), 0, { kind: 'framework' })] },
    { id: 'read-batch', type: 'data', label: 'Read the next 100 orders without an invoice', data: { op: 'read', entity: 'Order' }, anchors: at(NI, 'const BATCH_SIZE'), confidence: 'high',
      fanout: { mode: 'batch', over: 'uninvoiced orders, 100 per batch, one batch after another' },
      calls: [call('invoiceNightly', NI, R(NI, 'export async function invoiceNightly'), 0), call('orders.listUninvoiced', NI, L(NI, 'orders.listUninvoiced('), 1)] },
    { id: 'any-left', type: 'decision', label: 'Any orders left?', rule: 'The run ends when a batch comes back empty.', anchors: at(NI, 'batch.length === 0'), confidence: 'high', calls: [call('invoiceNightly (loop exit)', NI, L(NI, 'batch.length === 0'), 1)] },
    { id: 'issue-all', type: 'action', label: 'Issue the batch\'s invoices at the same time', anchors: at(NI, 'Promise.all(batch.map'), confidence: 'high',
      fanout: { mode: 'parallel', over: 'every order in the batch (up to 100)' }, calls: [call('Promise.all', NI, L(NI, 'Promise.all(batch.map'), 1)] },
    { id: 'issue-one', type: 'external', label: 'Issue one invoice', system: 'Invoicing service', anchors: at(NI, 'invoices.issue('), confidence: 'high', calls: [call('invoices.issue', NI, L(NI, 'invoices.issue('), 2)] },
    { id: 'all-issued', type: 'decision', label: 'Were all invoices in the batch issued?', rule: 'Waits for every invoice in the batch. One failure stops the whole run.', anchors: at(NI, 'Promise.all(batch.map'), confidence: 'high',
      join: { mode: 'all' }, calls: [call('Promise.all (join)', NI, L(NI, 'Promise.all(batch.map'), 1)] },
    { id: 'mark-invoiced', type: 'data', label: 'Mark the batch as invoiced', data: { op: 'write', entity: 'Order', fields: ['invoiced'] }, anchors: at(NI, 'orders.markInvoiced('), confidence: 'high',
      calls: [call('orders.markInvoiced', NI, L(NI, 'orders.markInvoiced('), 1), call('invoiceNightly (cursor)', NI, L(NI, 'cursor = batch['), 1)] },
    { id: 'done', type: 'outcome', label: 'All of the day\'s orders are invoiced', result: 'success', anchors: at(NI, 'if (batch.length === 0) break'), confidence: 'high' },
    { id: 'run-stops', type: 'outcome', label: 'Run stops halfway', result: 'error', implicit: true,
      rule: 'An invoice failure is not handled. The run stops, the remaining orders wait until the next night, and the batch is not marked as invoiced.', anchors: at(NI, 'Promise.all(batch.map'), confidence: 'high' },
  ],
  edges: [
    { from: 'start', to: 'read-batch' },
    { from: 'read-batch', to: 'any-left' },
    { from: 'any-left', to: 'issue-all', label: 'Yes' }, { from: 'any-left', to: 'done', label: 'No' },
    { from: 'issue-all', to: 'issue-one', label: 'each order' },
    { from: 'issue-one', to: 'all-issued' },
    { from: 'all-issued', to: 'mark-invoiced', label: 'Yes' }, { from: 'all-issued', to: 'run-stops', label: 'No', implicit: true },
    { from: 'mark-invoiced', to: 'read-batch', label: 'next batch', loop: true },
  ],
  happyPath: 'done',
  outcomes: { 'run-stops': 'An invoice fails' },
  findings: [
    { kind: 'risk', text: 'When one invoice fails, the others in its batch were already issued but are not marked. The next night issues them again: customers get duplicate invoices.', nodes: ['run-stops', 'all-issued'] },
    { kind: 'gap', text: 'Nobody is alerted when the run stops halfway.', nodes: ['run-stops'] },
  ],
};

const head = {
  version: 1,
  app: { name: 'Shop', summary: 'Customers check out a cart and pay by card. Paid orders ship from one or more warehouses, and every night the day\'s orders are invoiced.', repo: 'examples/shop', ref: 'main', commit: null, generatedAt: '2026-11-08T10:00:00Z' },
  glossary: [
    { term: 'Order', meaning: 'A paid cart. Created only after the card is charged.' },
    { term: 'Shipment', meaning: 'What one warehouse sends for an order. An order can have several.' },
    { term: 'Invoice', meaning: 'Issued every night for the previous day\'s orders.' },
  ],
  excluded: [],
  flows: [checkout, fulfill, invoicing],
};

// The previous version: flat $7.90 shipping, and no nightly invoicing yet.
const base = JSON.parse(JSON.stringify(head));
base.app.ref = 'v1';
base.flows = base.flows.filter((f) => f.id !== 'invoice-nightly');
const c = base.flows[0];
c.nodes = c.nodes.filter((n) => !['free-shipping', 'no-fee'].includes(n.id));
c.nodes.find((n) => n.id === 'add-fee').rule = 'Every order pays $7.90 shipping.';
c.edges = c.edges.filter((e) => !['free-shipping', 'no-fee'].includes(e.from) && e.to !== 'free-shipping');
c.edges.splice(c.edges.findIndex((e) => e.from === 'in-stock' && e.label === 'Yes'), 0, { from: 'in-stock', to: 'add-fee', label: 'Yes' });
c.summary = 'A signed-in customer checks out their cart. Stock is checked, shipping is added, the card is charged (with retries), the order is saved and sent to shipping.';

fs.writeFileSync(path.join(ROOT, 'flows.json'), JSON.stringify(head, null, 2) + '\n');
fs.writeFileSync(path.join(ROOT, 'base.json'), JSON.stringify(base, null, 2) + '\n');
console.log('wrote flows.json and base.json');
