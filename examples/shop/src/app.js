import express from 'express';
import cron from 'node-cron';
import { Queue, Worker } from './lib/queue.js';
import { requireCustomer } from './lib/auth.js';
import { placeOrder } from './orders/place-order.js';
import { fulfillOrder } from './fulfillment/fulfill-order.js';
import { invoiceNightly } from './invoicing/nightly-invoices.js';

export const fulfillmentQueue = new Queue('fulfillment');

const app = express();
app.use(express.json());

// Checkout
app.post('/orders', requireCustomer, placeOrder);

// Ships paid orders. A failed job is retried by the queue, up to 5 times.
new Worker('fulfillment', fulfillOrder, { attempts: 5, backoff: { type: 'exponential', delay: 60_000 } });

// Invoices every order from the day, at 02:00.
cron.schedule('0 2 * * *', invoiceNightly);

app.listen(3000);
