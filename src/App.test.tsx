import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('App shell', () => {
  it('renders the title, the workspace and Spanish copy by default', async () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: 'SoM Blocks' })).toBeInTheDocument();
    expect(screen.getByText('Programa tu placa con bloques')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Espacio de bloques' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Código generado' })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId('generated-code')).toHaveTextContent('void loop()'),
    );
  });

  it('renders English copy when asked', () => {
    render(<App lang="en" />);
    expect(screen.getByRole('heading', { level: 1, name: 'SoM Blocks' })).toBeInTheDocument();
    expect(screen.getByText('Program your board with blocks')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Generated code' })).toBeInTheDocument();
    expect(screen.queryByText('Programa tu placa con bloques')).not.toBeInTheDocument();
  });
});
