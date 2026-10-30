import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { defaultSettings, storage } from './lib/storage';
import { WalletController } from './state/controller';
import { WalletProvider } from './state/wallet';
// Fonts first: their own file, see the note in fonts.css.
import './fonts.css';
import './styles.css';

// IndexedDB can be unavailable (e.g. some private-browsing modes); boot still
// runs and reports the storage error instead of leaving a blank page.
const settings = await storage.getSettings().catch(() => defaultSettings());
const controller = new WalletController(settings);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WalletProvider controller={controller}>
      <App />
    </WalletProvider>
  </StrictMode>,
);

void controller.boot();
