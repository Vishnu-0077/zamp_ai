import type { ComponentType, LazyExoticComponent } from 'react';

/**
 * Contract every feature module exports. The shell builds both the router and
 * the sidebar from these, so a new feature never edits the layout or router.
 */
export interface FeatureRoute {
  /** Router path, e.g. "cases/:id". Relative to the app root. */
  path: string;
  component: LazyExoticComponent<ComponentType> | ComponentType;
  /** Present when the route should appear in the sidebar. */
  nav?: {
    label: string;
    /** Lower numbers appear first. */
    order: number;
    /** Optional small component rendered next to the label (e.g. a count). */
    badge?: ComponentType;
    /** Match child paths as active (default true). */
    end?: boolean;
  };
}
