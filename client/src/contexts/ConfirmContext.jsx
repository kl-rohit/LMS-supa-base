// Global confirm dialog — replaces window.confirm() across the app
// so all destructive prompts use our styled ConfirmDialog component.
//
// Usage in any page:
//   import { useConfirm } from '../contexts/ConfirmContext';
//   const confirm = useConfirm();
//   if (!(await confirm({ title: 'Delete?', message: '...' }))) return;
//
// confirm() returns a Promise<boolean>: true if user confirms, false on cancel.

import { createContext, useCallback, useContext, useState } from 'react';
import ConfirmDialog from '../components/ConfirmDialog';

const ConfirmContext = createContext(null);

export function ConfirmProvider({ children }) {
  const [state, setState] = useState({
    isOpen: false,
    title: 'Are you sure?',
    message: '',
    confirmText: 'Confirm',
    danger: false,
    resolver: null,
  });

  const confirm = useCallback((opts = {}) => {
    return new Promise((resolve) => {
      setState({
        isOpen: true,
        title: opts.title || 'Are you sure?',
        message: opts.message || '',
        confirmText: opts.confirmText || 'Confirm',
        danger: opts.danger !== undefined ? opts.danger : true,
        resolver: resolve,
      });
    });
  }, []);

  const handleClose = (result) => {
    state.resolver?.(result);
    setState((s) => ({ ...s, isOpen: false, resolver: null }));
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <ConfirmDialog
        isOpen={state.isOpen}
        onClose={() => handleClose(false)}
        onConfirm={() => handleClose(true)}
        title={state.title}
        message={state.message}
        confirmText={state.confirmText}
        danger={state.danger}
      />
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used inside <ConfirmProvider>');
  return ctx;
}
