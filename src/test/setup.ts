import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// jsdom doesn't implement scrollIntoView; components that auto-scroll (e.g. MessageList)
// call it on mount, so stub it to a no-op to keep those component tests from throwing.
if (typeof Element !== 'undefined') {
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || (() => {});
}

afterEach(() => {
  cleanup();
});
