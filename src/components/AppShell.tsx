import { type ReactNode, Suspense } from 'react';
import { NavigationProvider } from '../contexts/NavigationContext';
import { SettingsProvider } from '../contexts/SettingsContext';
import { ClockInProvider } from '../contexts/ClockInContext';
import { useApp } from '../AppContext';
import { ClockOutCompletionGate } from '../features/jobs/components/ClockOutCompletionGate';
import { MaterialUsageModal } from '../features/jobs/components/MaterialUsageModal';

function AppViewFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background-dark">
      <p className="text-muted">Loading view...</p>
    </div>
  );
}

/**
 * Hosts the clock-out completion popup inside SettingsProvider so it reads the org's real
 * cncAbleCategories. The pending job + resolver live on AppContext (above SettingsProvider).
 */
function ClockOutPromptHost() {
  const { clockOutPromptJob, completeClockOutPrompt } = useApp();
  if (!clockOutPromptJob) return null;
  return <ClockOutCompletionGate job={clockOutPromptJob} onComplete={completeClockOutPrompt} />;
}

/** Hosts the In Progress -> QC "used more than estimate?" material-usage popup. */
function QcMaterialPromptHost() {
  const { qcMaterialPromptJob, completeQcMaterialPrompt } = useApp();
  if (!qcMaterialPromptJob) return null;
  return <MaterialUsageModal job={qcMaterialPromptJob} onComplete={completeQcMaterialPrompt} />;
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <NavigationProvider>
      <SettingsProvider>
        <ClockInProvider>
          <Suspense fallback={<AppViewFallback />}>{children}</Suspense>
          <ClockOutPromptHost />
          <QcMaterialPromptHost />
        </ClockInProvider>
      </SettingsProvider>
    </NavigationProvider>
  );
}
