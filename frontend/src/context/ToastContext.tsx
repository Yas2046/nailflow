import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

type ToastType = 'success' | 'error' | 'info';
interface ToastItem { id: number; message: string; type: ToastType; }
interface ToastContextValue { toast: (message: string, type?: ToastType) => void; }

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });

let _id = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const toast = useCallback((message: string, type: ToastType = 'success') => {
    const id = ++_id;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3500);
  }, []);

  const typeStyles: Record<ToastType, string> = {
    success: 'bg-wine-700 text-cream',
    error:   'bg-rose-600 text-white',
    info:    'bg-ink/80 text-white',
  };

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {/* portal de toasts — fixo no canto inferior */}
      <div
        aria-live='polite'
        className='fixed bottom-24 left-1/2 -translate-x-1/2 md:bottom-6 md:left-auto md:right-6 md:translate-x-0 z-50 flex flex-col gap-2 items-center md:items-end pointer-events-none'
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`px-4 py-2.5 rounded-xl shadow-lg text-sm font-medium max-w-xs text-center md:text-left animate-fade-in-up ${typeStyles[t.type]}`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
