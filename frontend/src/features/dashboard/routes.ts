import { lazy } from 'react';
import type { FeatureRoute } from '@/app/types';

export const dashboardRoutes: FeatureRoute[] = [
  { path: '', component: lazy(() => import('./DashboardPage')), nav: { label: 'Dashboard', order: 0, end: true } },
];
