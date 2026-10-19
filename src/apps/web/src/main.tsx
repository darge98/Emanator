import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './styles.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Missing app root element');

createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
