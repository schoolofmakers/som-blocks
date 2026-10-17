import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { detectToolboxProfile } from './blocks/toolbox-profile';
import { detectLang } from './i18n/lang';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root element missing from index.html');

// `<html lang>` and the tab title follow the language from App (it owns the live switch).
createRoot(root).render(
  <StrictMode>
    <App lang={detectLang()} toolboxProfile={detectToolboxProfile()} />
  </StrictMode>,
);
