import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { ApiError } from '@/api/client';
import { AppShell } from './AppShell';
import { featureRoutes } from './registry';
import { NotFoundPage } from './NotFoundPage';

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5_000,
        refetchOnWindowFocus: true,
        // Do not retry client errors (4xx); they will not fix themselves.
        retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
      },
    },
  });
}

export function createAppRouter() {
  return createBrowserRouter(
    [
      {
        path: '/',
        element: <AppShell />,
        children: [
          ...featureRoutes.map(({ path, component: Component }) =>
            path === '' ? { index: true, element: <Component /> } : { path, element: <Component /> },
          ),
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
    { basename: import.meta.env.BASE_URL.replace(/\/$/, '') || '/' },
  );
}

export function App() {
  const [queryClient] = useState(createQueryClient);
  const [router] = useState(createAppRouter);
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
