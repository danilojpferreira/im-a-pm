import { z } from 'zod';

export const SHIPPING_COUNTRIES = ['US', 'CA'];

export const addressSchema = z.object({
  name: z.string().min(1, 'Enter the name for the delivery'),
  street: z.string().min(3, 'Enter a street address'),
  postalCode: z.string().regex(/^\d{5}$/, 'Postal code must have 5 digits'),
  country: z.enum(SHIPPING_COUNTRIES, { errorMap: () => ({ message: 'We only ship to the US and Canada' }) }),
});
