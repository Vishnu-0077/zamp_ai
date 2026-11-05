import { lazy } from 'react';
import type { FeatureRoute } from '@/app/types';
import { ReviewCountBadge } from './ReviewCountBadge';

export const casesRoutes: FeatureRoute[] = [
  { path: 'cases', component: lazy(() => import('./CasesPage')), nav: { label: 'Cases', order: 10, badge: ReviewCountBadge } },
  { path: 'cases/:id', component: lazy(() => import('./CaseDetailPage')) },
];
