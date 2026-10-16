import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Unit tests have no network. Blockly preloads its sounds with fetch() on inject; with a
// relative media URL Node's fetch rejects ("Invalid URL") outside any test. Leave such
// requests pending instead; tests that need fetch can stub it themselves.
vi.stubGlobal(
  'fetch',
  vi.fn(() => new Promise<Response>(() => {})),
);

afterEach(() => {
  cleanup();
});
