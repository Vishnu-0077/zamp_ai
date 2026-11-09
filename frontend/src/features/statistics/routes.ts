import { lazy } from 'react';
import type { FeatureRoute } from '@/app/types';

export const statisticsRoutes: FeatureRoute[] = [
  { path: 'statistics', component: lazy(() => import('./StatisticsPage')), nav: { label: 'Statistics', order: 15 } },
];
