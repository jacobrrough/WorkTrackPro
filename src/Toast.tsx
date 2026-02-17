import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
  ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

type ToastType = 'success' | 'error' | 'info' | 'warning';

interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
}

interface ToastContextType {
  showToast: (message: string, type: ToastType, duration?: number) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const ToastProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const showToast = useCallback(
    (message: string, type: ToastType = 'info', duration: number = 3000) => {
      const id = Math.random().toString(36).substr(2, 9);
      const toast: Toast = { id, message, type, duration };

      setToasts((prev) => [...prev, toast]);

      if (duration > 0) {
        setTimeout(() => {
          if (mountedRef.current) {
            setToasts((prev) => prev.filter((x) => x.id !== id));
          }
        }, duration);
      }
    },
    []
  );

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toastContainer = (
    <div
      className="pointer-events-none fixed bottom-20 right-4 z-[9999] space-y-2"
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`pointer-events-auto flex min-w-[280px] max-w-md animate-slide-in-right items-center gap-3 rounded-xl px-4 py-3 shadow-lg ${
            toast.type === 'success'
              ? 'bg-green-500 text-white'
              : toast.type === 'error'
                ? 'bg-red-500 text-white'
                : toast.type === 'warning'
                  ? 'bg-orange-500 text-white'
                  : 'bg-blue-500 text-white'
          }`}
          onClick={() => removeToast(toast.id)}
        >
          <span className="material-symbols-outlined">
            {toast.type === 'success'
              ? 'check_circle'
              : toast.type === 'error'
                ? 'error'
                : toast.type === 'warning'
                  ? 'warning'
                  : 'info'}
          </span>
          <span className="flex-1 font-medium">{toast.message}</span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              removeToast(toast.id);
            }}
            className="opacity-70 hover:opacity-100"
          >
            <span className="material-symbols-outlined text-sm">close</span>
          </button>
        </div>
      ))}
    </div>
  );

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {typeof document !== 'undefined' && document.body
        ? createPortal(toastContainer, document.body)
        : toastContainer}
    </ToastContext.Provider>
  );
};

/* eslint-disable react-refresh/only-export-components -- useToast is the public API for ToastProvider */
export const useToast = (): ToastContextType => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return context;
};
