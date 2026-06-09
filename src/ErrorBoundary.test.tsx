import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import ErrorBoundary from './ErrorBoundary';

function Boom(): React.ReactElement {
  throw new Error('kaboom');
}

describe('ErrorBoundary', () => {
  // The boundary logs the caught error via console.error; silence it so the test
  // output stays clean (and assert it is actually reported).
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('renders its children when nothing throws', () => {
    render(
      <ErrorBoundary>
        <p>safe child</p>
      </ErrorBoundary>
    );
    expect(screen.getByText('safe child')).toBeTruthy();
  });

  it('renders the default fallback (not the children) when a child throws', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );
    expect(screen.getByText('Something went wrong')).toBeTruthy();
    // The thrown error is surfaced and logged.
    expect(screen.getByText(/kaboom/)).toBeTruthy();
    expect(errorSpy).toHaveBeenCalled();
  });

  it('renders a custom fallback when provided', () => {
    render(
      <ErrorBoundary fallback={<p>scoped fallback</p>}>
        <Boom />
      </ErrorBoundary>
    );
    expect(screen.getByText('scoped fallback')).toBeTruthy();
    // The default fallback heading must not appear when a custom one is given.
    expect(screen.queryByText('The application encountered an error')).toBeNull();
  });

  it('isolates a crashing subtree from a sibling boundary (one fallback, one healthy)', () => {
    // Mirrors the per-route wrapping in AppRouter: each route gets its own boundary,
    // so one crashing route does not blank a sibling route.
    render(
      <>
        <ErrorBoundary fallback={<p>route A crashed</p>}>
          <Boom />
        </ErrorBoundary>
        <ErrorBoundary fallback={<p>route B crashed</p>}>
          <p>route B ok</p>
        </ErrorBoundary>
      </>
    );
    expect(screen.getByText('route A crashed')).toBeTruthy();
    expect(screen.getByText('route B ok')).toBeTruthy();
    expect(screen.queryByText('route B crashed')).toBeNull();
  });
});
