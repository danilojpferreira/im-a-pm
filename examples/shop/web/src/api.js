import { session } from './session.js';

export async function placeOrder(address) {
  const res = await fetch('/orders', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${session.token()}` },
    body: JSON.stringify({ address }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}
