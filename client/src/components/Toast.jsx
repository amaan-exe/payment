import React, { createContext, useContext, useState, useCallback } from 'react';
import { X, CheckCircle, AlertCircle, Info } from 'lucide-react';

const ToastContext = createContext(null);

let toastId = 0;

export function ToastProvider({ children }) {
    const [toasts, setToasts] = useState([]);

    const addToast = useCallback((message, type = 'info', duration = 4000) => {
        const id = ++toastId;
        setToasts(prev => [...prev, { id, message, type }]);
        setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== id));
        }, duration);
    }, []);

    const removeToast = useCallback((id) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    const toast = {
        success: (msg) => addToast(msg, 'success'),
        error: (msg) => addToast(msg, 'error'),
        info: (msg) => addToast(msg, 'info'),
    };

    return (
        <ToastContext.Provider value={toast}>
            {children}
            <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-3 pointer-events-none" style={{ minWidth: '320px' }}>
                {toasts.map((t) => (
                    <ToastItem key={t.id} toast={t} onClose={() => removeToast(t.id)} />
                ))}
            </div>
        </ToastContext.Provider>
    );
}

export function useToast() {
    const ctx = useContext(ToastContext);
    if (!ctx) throw new Error('useToast must be used within <ToastProvider>');
    return ctx;
}

function ToastItem({ toast, onClose }) {
    const config = {
        success: {
            bg: 'bg-gradient-to-r from-emerald-500 to-green-600',
            icon: <CheckCircle className="h-5 w-5 text-white shrink-0" />,
        },
        error: {
            bg: 'bg-gradient-to-r from-red-500 to-rose-600',
            icon: <AlertCircle className="h-5 w-5 text-white shrink-0" />,
        },
        info: {
            bg: 'bg-gradient-to-r from-rose-500 to-red-600',
            icon: <Info className="h-5 w-5 text-white shrink-0" />,
        },
    };

    const c = config[toast.type] || config.info;

    return (
        <div
            className={`${c.bg} text-white px-5 py-3.5 rounded-xl shadow-2xl flex items-center gap-3 pointer-events-auto animate-slide-in`}
            role="alert"
        >
            {c.icon}
            <span className="text-sm font-medium flex-1">{toast.message}</span>
            <button onClick={onClose} className="hover:bg-white/20 rounded-full p-1 transition">
                <X className="h-4 w-4" />
            </button>
        </div>
    );
}
