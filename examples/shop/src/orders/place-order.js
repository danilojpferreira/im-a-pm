import { carts, inventory, payments, orders } from '../lib/services.js';
import { fulfillmentQueue } from '../app.js';

const MAX_PAYMENT_ATTEMPTS = 3;
const FREE_SHIPPING_FROM = 100;
const SHIPPING_FEE = 7.9;

export async function placeOrder(req, res) {
  const cart = await carts.get(req.customer.id);
  if (cart.items.length === 0) {
    return res.status(400).json({ error: 'Your cart is empty' });
  }

  // No try/catch: if the inventory service times out, Express answers 500.
  for (const item of cart.items) {
    const available = await inventory.available(item.sku);
    if (available < item.quantity) {
      return res.status(409).json({ error: `${item.name} is out of stock` });
    }
  }

  const shipping = cart.total >= FREE_SHIPPING_FROM ? 0 : SHIPPING_FEE;

  let attempt = 0;
  let charge;
  while (true) {
    attempt++;
    charge = await payments.charge(req.customer, cart.total + shipping);
    if (charge.status === 'approved') break;
    if (charge.status === 'declined') {
      return res.status(402).json({ error: 'Your card was declined' });
    }
    if (attempt >= MAX_PAYMENT_ATTEMPTS) {
      return res.status(503).json({ error: 'Payments are unavailable, try again later' });
    }
    await sleep(500 * 2 ** attempt);
  }

  // Not wrapped: if saving fails here, the card is already charged.
  const order = await orders.create({
    customerId: req.customer.id,
    items: cart.items,
    shipping,
    total: cart.total + shipping,
    chargeId: charge.id,
    status: 'paid',
  });

  await fulfillmentQueue.add('fulfill', { orderId: order.id });
  await carts.clear(req.customer.id);
  return res.status(201).json(order);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
