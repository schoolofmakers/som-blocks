import type { ToolboxProfile } from './types';

// Which toolbox to show (docs/adr/0001-starter-toolbox.md). `?toolbox=full` opts into the
// full toolbox; anything else is the starter one. A real switch in the UI comes later.
export function resolveToolboxProfile(search: string | undefined): ToolboxProfile {
  const value = search ? new URLSearchParams(search).get('toolbox') : null;
  return value?.trim().toLowerCase() === 'full' ? 'full' : 'starter';
}

export function detectToolboxProfile(): ToolboxProfile {
  return resolveToolboxProfile(window.location.search);
}
