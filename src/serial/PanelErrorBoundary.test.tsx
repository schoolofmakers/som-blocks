import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PanelErrorBoundary } from './PanelErrorBoundary';

function ChunkFailed(): never {
  throw new TypeError('Failed to fetch dynamically imported module');
}

describe('PanelErrorBoundary', () => {
  it('keeps a failed chunk inside the panel and offers a reload', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <div>
        <p>editor</p>
        <PanelErrorBoundary lang="es">
          <ChunkFailed />
        </PanelErrorBoundary>
      </div>,
    );
    expect(screen.getByText('editor')).toBeInTheDocument();
    expect(screen.getByTestId('serial-load-failed')).toHaveTextContent('No se pudo cargar');
    expect(screen.getByRole('button', { name: 'Recargar' })).toBeInTheDocument();
    vi.restoreAllMocks();
  });
});
