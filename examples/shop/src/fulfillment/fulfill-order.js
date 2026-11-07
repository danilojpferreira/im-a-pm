import { orders, warehouses, mailer } from '../lib/services.js';

export async function fulfillOrder(job) {
  const order = await orders.get(job.data.orderId);
  if (order.status === 'cancelled') {
    return { skipped: 'cancelled' };
  }

  // One shipment per warehouse, all requested at the same time.
  const byWarehouse = groupBy(order.items, (item) => item.warehouse);
  const shipments = await Promise.all(
    Object.entries(byWarehouse).map(([warehouse, items]) => warehouses.createShipment(warehouse, items)),
  );
  // If any warehouse rejects, Promise.all throws, the job fails and the queue retries it.

  await orders.update(order.id, {
    status: 'shipped',
    tracking: shipments.map((s) => s.trackingNumber),
  });
  await mailer.send(order.customerEmail, 'order-shipped', { tracking: shipments.map((s) => s.trackingUrl) });
  return { shipped: shipments.length };
}

function groupBy(list, key) {
  return list.reduce((groups, item) => {
    (groups[key(item)] ||= []).push(item);
    return groups;
  }, {});
}
