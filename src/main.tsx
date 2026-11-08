import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Register public shell service worker for installable PWA
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('PWA service worker registration skipped:', err);
    });
  });
}

createRoot(document.getElementById('root')!).render(<App />);
