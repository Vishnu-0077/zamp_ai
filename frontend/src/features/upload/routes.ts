import { lazy } from 'react';
import type { FeatureRoute } from '@/app/types';

export const uploadRoutes: FeatureRoute[] = [
  { path: 'upload', component: lazy(() => import('./UploadPage')), nav: { label: 'Upload', order: 30 } },
];
