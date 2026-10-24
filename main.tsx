import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/limelight/latin-400.css';
import '@fontsource/libre-franklin/latin-400.css';
import '@fontsource/libre-franklin/latin-500.css';
import '@fontsource/libre-franklin/latin-600.css';
import '@fontsource/libre-franklin/latin-700.css';
import { App } from './App';
import { enregistrerServiceWorker, suivreVisibilite } from './appli';
import './styles.css';

enregistrerServiceWorker();
suivreVisibilite();

createRoot(document.getElementById('racine') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
