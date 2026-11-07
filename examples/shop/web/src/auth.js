import { redirect } from 'react-router-dom';
import { session } from './session.js';

// Route guard: signed-out visitors are sent to sign in, then back to where they were going.
export function requireCustomer({ request }) {
  if (!session.token()) {
    const next = new URL(request.url).pathname;
    return redirect(`/login?next=${encodeURIComponent(next)}`);
  }
  return null;
}
