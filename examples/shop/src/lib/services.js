// Clients for the systems this sample talks to. Left abstract on purpose.
export const sessions = { customerFor: async (token) => null };
export const carts = { get: async (customerId) => ({ items: [], total: 0 }), clear: async (customerId) => {} };
export const inventory = { available: async (sku) => 0 };
export const payments = { charge: async (customer, amount) => ({ id: '', status: 'declined' }) };
export const orders = {
  create: async (data) => ({ id: '', ...data }),
  get: async (id) => ({ id, status: 'paid', items: [] }),
  update: async (id, changes) => {},
  listUninvoiced: async ({ after, limit }) => [],
  markInvoiced: async (ids) => {},
};
export const warehouses = { createShipment: async (warehouse, items) => ({ trackingNumber: '', trackingUrl: '' }) };
export const invoices = { issue: async (order) => {} };
export const mailer = { send: async (to, template, data) => {} };
