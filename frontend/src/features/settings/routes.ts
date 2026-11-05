import { lazy } from 'react';
import type { FeatureRoute } from '@/app/types';

export const settingsRoutes: FeatureRoute[] = [
  { path: 'settings', component: lazy(() => import('./SettingsPage')), nav: { label: 'Settings', order: 90 } },
];
