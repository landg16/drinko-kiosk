import { createBrowserRouter, Navigate } from 'react-router-dom';
import { WelcomePage } from '@/pages/welcome-page.tsx';
import { MenuPage } from '@/pages/menu-page.tsx';
import { BasketPage } from '@/pages/basket-page.tsx';
import { PaymentPage } from '@/pages/payment-page.tsx';
import { PouringPage } from '@/pages/pouring-page.tsx';
import { CompletionPage } from '@/pages/completion-page.tsx';
import { Layout } from '@/components/shared/layout.tsx';

export const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      {
        path: '/',
        element: <WelcomePage />,
      },
      {
        path: '/menu',
        element: <MenuPage />,
      },
      {
        path: '/basket',
        element: <BasketPage />,
      },
      {
        path: '/payment',
        element: <PaymentPage />,
      },
      {
        path: '/pouring',
        element: <PouringPage />,
      },
      {
        path: '/completion',
        element: <CompletionPage />,
      },
      {
        path: '*',
        element: <Navigate to='/' replace />,
      },
    ],
  },
]);
