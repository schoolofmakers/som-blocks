import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('App shell', () => {
  it('renders the title and Spanish copy by default', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: 'SoM Blocks' })).toBeInTheDocument();
    expect(screen.getByText('Programa tu placa con bloques')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-placeholder')).toHaveTextContent(
      'Aquí aparecerá tu espacio de bloques',
    );
  });

  it('renders English copy when asked', () => {
    render(<App lang="en" />);
    expect(screen.getByRole('heading', { level: 1, name: 'SoM Blocks' })).toBeInTheDocument();
    expect(screen.getByText('Program your board with blocks')).toBeInTheDocument();
    expect(screen.queryByText('Programa tu placa con bloques')).not.toBeInTheDocument();
  });
});
