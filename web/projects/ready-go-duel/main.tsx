import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { moduleReady } from '../../account-module.js';

moduleReady().then(() => createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
));
