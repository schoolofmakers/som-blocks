import { describe, expect, it } from 'vitest';
import { resolveToolboxProfile } from './toolbox-profile';

describe('resolveToolboxProfile', () => {
  it.each([
    [undefined, 'starter'],
    ['', 'starter'],
    ['?lang=en', 'starter'],
    ['?toolbox=starter', 'starter'],
    ['?toolbox=nonsense', 'starter'],
    ['?toolbox=full', 'full'],
    ['?lang=es&toolbox=FULL', 'full'],
  ])('%j → %s', (search, expected) => {
    expect(resolveToolboxProfile(search)).toBe(expected);
  });
});
