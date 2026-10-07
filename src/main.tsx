import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';

// Gracefully handle benign Vite HMR WebSocket connection notices in cloud/sandboxed environments
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason?.message || String(event.reason || '');
    if (reason.includes('WebSocket closed without opened') || reason.includes('failed to connect to websocket')) {
      event.preventDefault(); // Suppress noisy unhandled rejection console logs
    }
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary fallbackTitle="Siemens Shift Roster - กู้คืนระบบ (System Recovery)">
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
