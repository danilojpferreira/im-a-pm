import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate, Link } from 'react-router-dom';
import { useCart } from '../cart.js';
import { addressSchema } from '../checkout-schema.js';
import { placeOrder } from '../api.js';
import { toast } from '../toast.js';

const FREE_SHIPPING_FROM = 99;

export function CheckoutPage() {
  const cart = useCart();
  const navigate = useNavigate();
  const [sending, setSending] = useState(false);
  const form = useForm({ resolver: zodResolver(addressSchema) });

  if (cart.items.length === 0) {
    return <p>Your cart is empty. <Link to="/">Keep shopping</Link></p>;
  }

  const freeShipping = cart.total >= FREE_SHIPPING_FROM;

  async function pay(address) {
    if (sending) return;
    setSending(true);
    const { status, body } = await placeOrder(address);
    setSending(false);

    if (status === 201) return navigate(`/orders/${body.id}/confirmation`);
    if (status === 401) return navigate('/login?next=/checkout');
    if (status === 402) return toast.error('Your card was declined. Try another card.');
    if (status === 409) return toast.error(body.error);
    return toast.error('Something went wrong, please try again.');
  }

  return (
    <form onSubmit={form.handleSubmit(pay)}>
      {freeShipping
        ? <p className="banner">Free shipping on this order</p>
        : <p className="banner">Add ${(FREE_SHIPPING_FROM - cart.total).toFixed(2)} for free shipping</p>}
      {/* address fields; validation errors show under each field */}
      <button type="submit" disabled={sending}>Pay ${cart.total.toFixed(2)}</button>
    </form>
  );
}
