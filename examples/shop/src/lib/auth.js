import { sessions } from './services.js';

export async function requireCustomer(req, res, next) {
  const customer = await sessions.customerFor(req.headers.authorization);
  if (!customer) {
    return res.status(401).json({ error: 'Sign in to place an order' });
  }
  req.customer = customer;
  next();
}
