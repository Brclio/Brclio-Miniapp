import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { moduleReady } from '../../../account-module.js';
import { prepareCompletionSync } from './game/history';
import './styles.css';
import './curriculum.css';

moduleReady().then(() => {
  void prepareCompletionSync().catch(() => {});
  ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
});
