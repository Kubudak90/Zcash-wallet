import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';

import type { WalletController, WalletState } from './controller';

const ControllerContext = createContext<WalletController | null>(null);

export function WalletProvider({ controller, children }: { controller: WalletController; children: ReactNode }) {
  return <ControllerContext.Provider value={controller}>{children}</ControllerContext.Provider>;
}

export function useController(): WalletController {
  const controller = useContext(ControllerContext);
  if (!controller) throw new Error('useController outside WalletProvider');
  return controller;
}

export function useWallet(): WalletState {
  const controller = useController();
  return useSyncExternalStore(controller.subscribe, controller.getState);
}
