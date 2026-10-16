import { ioFamily } from './families/io';
import { rawFamily } from './families/raw';
import { serialFamily } from './families/serial';
import { timeFamily } from './families/time';
import { registerFamily } from './registry';
import type { BlockFamily } from './types';

/** Every family the editor ships, in toolbox order. B3/B4 append here. */
export const BUILT_IN_FAMILIES: readonly BlockFamily[] = [
  ioFamily, // Entrada/Salida
  timeFamily, // Tiempo
  serialFamily, // Puerto Serie
  rawFamily, // Código (always last)
];

export function registerBuiltInFamilies(): void {
  for (const family of BUILT_IN_FAMILIES) registerFamily(family);
}
