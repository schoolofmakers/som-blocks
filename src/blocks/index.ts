import { bleFamily } from './families/ble';
import { controlFamily } from './families/control';
import { espnowFamily } from './families/espnow';
import { functionsFamily } from './families/functions';
import { ioFamily } from './families/io';
import { listsFamily } from './families/lists';
import { logicFamily } from './families/logic';
import { mathFamily } from './families/math';
import { rawFamily } from './families/raw';
import { serialFamily } from './families/serial';
import { textFamily } from './families/text';
import { timeFamily } from './families/time';
import { variablesFamily } from './families/variables';
import { wifiFamily } from './families/wifi';
import { registerFamily } from './registry';
import type { BlockFamily } from './types';

/** Every family the editor ships, in toolbox order. */
export const BUILT_IN_FAMILIES: readonly BlockFamily[] = [
  logicFamily, // Lógica
  controlFamily, // Control
  mathFamily, // Matemáticas
  textFamily, // Texto
  variablesFamily, // Variables
  listsFamily, // Listas (full toolbox)
  functionsFamily, // Funciones
  ioFamily, // Entrada/Salida
  timeFamily, // Tiempo
  serialFamily, // Puerto Serie
  wifiFamily, // WiFi (ESP32 only)
  espnowFamily, // ESP-NOW (ESP32 only)
  bleFamily, // Bluetooth (full toolbox)
  rawFamily, // Código (always last, full toolbox)
];

export function registerBuiltInFamilies(): void {
  for (const family of BUILT_IN_FAMILIES) registerFamily(family);
}
