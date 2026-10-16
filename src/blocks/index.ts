import { rawFamily } from './families/raw';
import { registerFamily } from './registry';
import type { BlockFamily } from './types';

/** Every family the editor ships, in toolbox order. B3/B4 append here. */
export const BUILT_IN_FAMILIES: readonly BlockFamily[] = [rawFamily];

export function registerBuiltInFamilies(): void {
  for (const family of BUILT_IN_FAMILIES) registerFamily(family);
}
