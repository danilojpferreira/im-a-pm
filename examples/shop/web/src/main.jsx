import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { requireCustomer } from './auth.js';
import { CheckoutPage } from './pages/Checkout.jsx';
import { ConfirmationPage } from './pages/Confirmation.jsx';
import { LoginPage } from './pages/Login.jsx';

const router = createBrowserRouter([
  { path: '/checkout', loader: requireCustomer, element: <CheckoutPage /> },
  { path: '/orders/:id/confirmation', loader: requireCustomer, element: <ConfirmationPage /> },
  { path: '/login', element: <LoginPage /> },
]);

createRoot(document.getElementById('root')).render(<RouterProvider router={router} />);
