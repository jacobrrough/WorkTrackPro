import { type ReactNode, Suspense } from 'react';
import { NavigationProvider } from '../contexts/NavigationContext';
import { SettingsProvider } from '../contexts/SettingsContext';
import { ClockInProvider } from '../contexts/ClockInContext';

function AppViewFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background-dark">
      <p className="text-slate-400">Loading view...</p>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <NavigationProvider>
      <SettingsProvider>
        <ClockInProvider>
          <Suspense fallback={<AppViewFallback />}>{children}</Suspense>
        </ClockInProvider>
      </SettingsProvider>
    </NavigationProvider>
  );
}
