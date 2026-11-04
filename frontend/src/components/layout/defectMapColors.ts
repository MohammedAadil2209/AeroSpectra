import type { Category } from '@/types';

/**
 * Airframe Defect Map palette: red wine, navy blue, grey blue.
 * Shades are lifted so they stay visible on the dark navy (#092635) hero card (>= 3:1 for graphics).
 * Used only by the Overview defect map; the rest of the app keeps the validated CATEGORY_COLOR palette.
 */
export const DEFECT_MAP_COLOR: Record<Category, string> = {
  crack: '#c0394f', // red wine
  corrosion: '#4a78b5', // navy blue
  dent: '#a9bccd', // grey blue
};

/**
 * Same three colours in their true deep shades, for white cards (Detection trend, Defect distribution).
 * Each is >= 3:1 against white; hue order matches DEFECT_MAP_COLOR so a category reads the same everywhere.
 */
export const DEFECT_CHART_COLOR: Record<Category, string> = {
  crack: '#8e1f33', // red wine
  corrosion: '#1f3f66', // navy blue
  dent: '#7f97ad', // grey blue
};
