import { lazy } from 'react';
import type { FeatureRoute } from '@/app/types';

export const referencesRoutes: FeatureRoute[] = [
  { path: 'references', component: lazy(() => import('./ReferencesPage')), nav: { label: 'Reference data', order: 40 } },
];
