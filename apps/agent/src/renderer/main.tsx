import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './globals.css';

window.api.onNotificationSound(() => {
  const audio = new Audio('./sounds/notification.wav');
  audio.volume = 0.35;
  audio.play().catch(() => {});
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
