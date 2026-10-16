import * as Blockly from 'blockly/core';
import { expect } from 'vitest';
import { arduinoGenerator } from '../arduino-generator';
import { registerBuiltInFamilies } from '../index';
import { applyLocale } from '../registry';

// Golden-test harness (_config/standards.md → Quality gates): a workspace JSON fixture is
// loaded into a headless workspace (no DOM), run through the ArduinoGenerator and compared
// byte-for-byte with `fixtures/<name>.ino`. `pnpm test:golden:update` (UPDATE_GOLDEN=1)
// rewrites the .ino files; review the diff before committing.

const workspaceFixtures = import.meta.glob<Record<string, unknown>>('./fixtures/*.workspace.json', {
  eager: true,
  import: 'default',
});

const FIXTURE_PATTERN = /\/([^/]+)\.workspace\.json$/;

/** Names of every `fixtures/<name>.workspace.json`, sorted. */
export function goldenFixtureNames(): string[] {
  return Object.keys(workspaceFixtures)
    .map((path) => FIXTURE_PATTERN.exec(path)?.[1])
    .filter((name): name is string => Boolean(name))
    .sort();
}

/** Generate the sketch for a fixture workspace. */
export function generateGolden(fixtureName: string): string {
  const state = workspaceFixtures[`./fixtures/${fixtureName}.workspace.json`];
  if (!state) throw new Error(`No golden fixture "${fixtureName}.workspace.json"`);

  registerBuiltInFamilies();
  applyLocale('es');
  const workspace = new Blockly.Workspace();
  try {
    Blockly.serialization.workspaces.load(state, workspace);
    return arduinoGenerator.workspaceToCode(workspace);
  } finally {
    workspace.dispose();
  }
}

/** Assert a fixture generates exactly its `.ino` (call from a test in this directory). */
export async function runGolden(fixtureName: string): Promise<void> {
  await expect(generateGolden(fixtureName)).toMatchFileSnapshot(`./fixtures/${fixtureName}.ino`);
}
