import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { detectToolboxProfile } from './blocks/toolbox-profile';
import { detectLang } from './i18n/lang';
import { takePairingFromLocation } from './wifi/pairing';
import './index.css';

// A pairing link (`/pair?device=…&token=…`) leaves the address bar before anything renders,
// so the token is never kept in the URL, the history entry or a bookmark.
const pairing = takePairingFromLocation();

const root = document.getElementById('root');
if (!root) throw new Error('#root element missing from index.html');

// `<html lang>` and the tab title follow the language from App (it owns the live switch).
createRoot(root).render(
  <StrictMode>
    <App lang={detectLang()} toolboxProfile={detectToolboxProfile()} pairing={pairing} />
  </StrictMode>,
);
