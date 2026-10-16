import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { detectLang } from './i18n/lang';
import { t } from './i18n/messages';
import './index.css';

const lang = detectLang();
document.documentElement.lang = lang;
document.title = t('UI_APP_TITLE', lang);

const root = document.getElementById('root');
if (!root) throw new Error('#root element missing from index.html');

createRoot(root).render(
  <StrictMode>
    <App lang={lang} />
  </StrictMode>,
);
