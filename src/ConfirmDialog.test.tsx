import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ConfirmDialog from './ConfirmDialog';

describe('ConfirmDialog', () => {
  it('renders nothing when closed', () => {
    render(
      <ConfirmDialog
        isOpen={false}
        title="Delete?"
        message="hidden body"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.queryByText('hidden body')).toBeNull();
  });

  it('renders an alertdialog labelled and described by the title and message when open', () => {
    render(
      <ConfirmDialog
        isOpen
        title="Delete this job?"
        message="This cannot be undone."
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    const dialog = screen.getByRole('alertdialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    // aria-labelledby / aria-describedby point at the heading and message nodes.
    const labelId = dialog.getAttribute('aria-labelledby');
    const describeId = dialog.getAttribute('aria-describedby');
    expect(document.getElementById(labelId ?? '')?.textContent).toBe('Delete this job?');
    expect(document.getElementById(describeId ?? '')?.textContent).toBe('This cannot be undone.');
  });

  it('moves focus inside the dialog (onto Cancel) on open', () => {
    render(
      <ConfirmDialog
        isOpen
        title="Focus"
        message="x"
        cancelText="Cancel"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    const dialog = screen.getByRole('alertdialog');
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
  });

  it('closes (calls onCancel, not onConfirm) on Escape', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog isOpen title="Esc" message="x" onConfirm={onConfirm} onCancel={onCancel} />
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('restores focus to the previously focused element on close', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { rerender } = render(
      <ConfirmDialog isOpen title="Restore" message="x" onConfirm={() => {}} onCancel={() => {}} />
    );
    // Focus moved into the dialog while open.
    expect(document.activeElement).not.toBe(trigger);

    rerender(
      <ConfirmDialog
        isOpen={false}
        title="Restore"
        message="x"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it('traps Tab focus within the dialog (wraps from last to first)', () => {
    render(
      <ConfirmDialog
        isOpen
        title="Trap"
        message="x"
        confirmText="Confirm"
        cancelText="Cancel"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    const confirm = screen.getByRole('button', { name: 'Confirm' });
    const cancel = screen.getByRole('button', { name: 'Cancel' });

    // From the last focusable, a forward Tab wraps back to the first.
    confirm.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(cancel);

    // From the first focusable, Shift+Tab wraps to the last.
    cancel.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(confirm);
  });
});
