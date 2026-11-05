/**
 * Feature registry. To add a feature:
 *   1. create src/features/<name>/ with pages and a routes.ts exporting FeatureRoute[]
 *   2. add it to the list below.
 */
import type { FeatureRoute } from './types';
import { dashboardRoutes } from '@/features/dashboard/routes';
import { casesRoutes } from '@/features/cases/routes';
import { inboxRoutes } from '@/features/inbox/routes';
import { uploadRoutes } from '@/features/upload/routes';
import { referencesRoutes } from '@/features/references/routes';
import { settingsRoutes } from '@/features/settings/routes';

export const featureRoutes: FeatureRoute[] = [
  ...dashboardRoutes,
  ...casesRoutes,
  ...inboxRoutes,
  ...uploadRoutes,
  ...referencesRoutes,
  ...settingsRoutes,
];

export const navItems = featureRoutes
  .filter((r) => r.nav)
  .sort((a, b) => a.nav!.order - b.nav!.order);
