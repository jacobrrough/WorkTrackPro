import { describe, it, expect } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

import { useInAppBack } from './useInAppBack';

/**
 * Harness: exposes the hook's back() and renders the live pathname.
 * MemoryRouter mirrors React Router's real key semantics — the FIRST entry
 * gets location.key === 'default'; every later entry gets a generated key.
 * window.history.state stays null under MemoryRouter (jsdom), so these tests
 * exercise exactly the `location.key !== 'default'` branch that fixed the
 * always-null history.state.idx bug (Back previously never stepped back).
 */
let back: () => void = () => {};
function Harness() {
  back = useInAppBack('/app');
  const location = useLocation();
  return <div data-testid="path">{location.pathname}</div>;
}

function renderAt(entries: (string | { pathname: string; state?: unknown })[], index?: number) {
  return render(
    <MemoryRouter initialEntries={entries} initialIndex={index}>
      <Harness />
    </MemoryRouter>
  );
}

describe('useInAppBack', () => {
  it('cold start (no in-app history): goes to the fallback', () => {
    renderAt(['/app/tools']);
    act(() => back());
    expect(screen.getByTestId('path').textContent).toBe('/app');
  });

  it('cold start with a stamped origin: goes to state.from, not the fallback', () => {
    renderAt([{ pathname: '/app/tools', state: { from: '/app/inventory' } }]);
    act(() => back());
    expect(screen.getByTestId('path').textContent).toBe('/app/inventory');
  });

  it('with real in-app history (non-default key): steps back ONE entry', () => {
    renderAt(['/app', '/app/inventory', '/app/tools'], 2);
    act(() => back());
    expect(screen.getByTestId('path').textContent).toBe('/app/inventory');
  });

  it('steps back repeatedly through the stack, then falls back at the root', () => {
    renderAt(['/app/inventory', '/app/tools'], 1);
    act(() => back()); // real history -> one step back
    expect(screen.getByTestId('path').textContent).toBe('/app/inventory');
    act(() => back()); // now at the 'default' first entry -> fallback
    expect(screen.getByTestId('path').textContent).toBe('/app');
  });
});
