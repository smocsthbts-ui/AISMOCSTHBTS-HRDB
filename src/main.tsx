import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';

// Gracefully filter benign notices (Vite HMR WebSockets, transient Firestore transport retries, quota notices)
if (typeof window !== 'undefined') {
  const origWarn = console.warn;
  console.warn = (...args: any[]) => {
    const text = args
      .map((a) => (typeof a === 'object' && a !== null ? (a.message || JSON.stringify(a)) : String(a)))
      .join(' ');
    if (
      text.includes('@firebase/firestore') ||
      text.includes('WebChannel') ||
      text.includes('GrpcConnection') ||
      text.includes('Could not reach Cloud Firestore backend') ||
      text.includes('offline mode until it is able to successfully connect') ||
      text.includes('hit browser quota limit') ||
      text.includes('LocalStorage quota limit reached') ||
      text.includes('Active data is preserved') ||
      text.includes('high-capacity in-memory cache') ||
      text.includes('app_bundles fetch timeout') ||
      text.includes('Legacy collection fetch warning') ||
      text.includes('listener notice') ||
      text.includes('WebSocket closed without opened') ||
      text.includes('failed to connect to websocket')
    ) {
      return; // Gracefully suppress benign transport/quota notices from polluting console
    }
    origWarn.apply(console, args);
  };

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
