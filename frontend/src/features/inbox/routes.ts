import { lazy } from 'react';
import type { FeatureRoute } from '@/app/types';

export const inboxRoutes: FeatureRoute[] = [
  { path: 'inbox', component: lazy(() => import('./InboxPage')), nav: { label: 'Inbox', order: 20 } },
];
