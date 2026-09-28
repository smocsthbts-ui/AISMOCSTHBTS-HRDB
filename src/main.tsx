import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary fallbackTitle="Siemens Shift Roster - กู้คืนระบบ (System Recovery)">
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
