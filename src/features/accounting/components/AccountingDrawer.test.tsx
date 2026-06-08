import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AccountingDrawer } from './AccountingDrawer';

describe('AccountingDrawer', () => {
  it('renders nothing when closed', () => {
    render(
      <AccountingDrawer open={false} onClose={() => {}} title="Closed">
        <p>hidden body</p>
      </AccountingDrawer>
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('hidden body')).toBeNull();
  });

  it('renders a labelled dialog with its title, body, and footer when open', () => {
    render(
      <AccountingDrawer
        open
        onClose={() => {}}
        title="Record Payment"
        footer={<button type="button">Save</button>}
      >
        <p>body content</p>
      </AccountingDrawer>
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toBe('Record Payment');
    // Title + body + footer are all present.
    screen.getByRole('heading', { name: 'Record Payment' });
    screen.getByText('body content');
    screen.getByRole('button', { name: 'Save' });
  });

  it('moves focus into the dialog on open', () => {
    render(
      <AccountingDrawer open onClose={() => {}} title="Focus">
        <input aria-label="field" />
      </AccountingDrawer>
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(
      <AccountingDrawer open onClose={onClose} title="Esc">
        <p>x</p>
      </AccountingDrawer>
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes when the backdrop is clicked, but not when the panel is clicked', () => {
    const onClose = vi.fn();
    render(
      <AccountingDrawer open onClose={onClose} title="Backdrop">
        <p>x</p>
      </AccountingDrawer>
    );
    const dialog = screen.getByRole('dialog');
    const backdrop = dialog.parentElement as HTMLElement;
    // A mousedown that originates on the panel must NOT close.
    fireEvent.mouseDown(dialog);
    expect(onClose).not.toHaveBeenCalled();
    // A mousedown on the backdrop itself closes.
    fireEvent.mouseDown(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes via the header close button', () => {
    const onClose = vi.fn();
    render(
      <AccountingDrawer open onClose={onClose} title="CloseBtn">
        <p>x</p>
      </AccountingDrawer>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
