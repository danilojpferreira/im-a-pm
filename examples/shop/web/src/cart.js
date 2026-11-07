// The cart lives in the browser until checkout.
export function useCart() {
  return JSON.parse(localStorage.getItem('cart') || '{"items":[],"total":0}');
}
