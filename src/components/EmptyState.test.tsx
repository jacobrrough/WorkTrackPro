import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  it('renders the icon, title, and hint', () => {
    render(
      <EmptyState icon="inventory_2" title="No inventory items yet" hint="Add your first part." />
    );

    expect(screen.getByText('No inventory items yet')).toBeTruthy();
    expect(screen.getByText('Add your first part.')).toBeTruthy();
    // Icon is rendered via the Material Symbols ligature text and hidden from a11y.
    const icon = screen.getByText('inventory_2');
    expect(icon.getAttribute('aria-hidden')).toBe('true');
  });

  it('exposes a polite status region so screen readers announce the empty state', () => {
    render(<EmptyState icon="work_off" title="No active jobs" />);
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('No active jobs');
  });

  it('omits the hint paragraph when no hint is provided', () => {
    render(<EmptyState icon="work_off" title="No active jobs" />);
    // Only the title text node should be present (no hint).
    expect(screen.queryByText('No active jobs')).toBeTruthy();
    const status = screen.getByRole('status');
    // title + icon ligature only — no extra hint <p>.
    expect(status.querySelectorAll('p').length).toBe(1);
  });

  it('renders an optional action node', () => {
    render(
      <EmptyState
        icon="view_kanban"
        title="No jobs yet"
        action={<button type="button">Create job</button>}
      />
    );
    expect(screen.getByRole('button', { name: 'Create job' })).toBeTruthy();
  });
});
