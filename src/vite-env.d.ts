/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FAKE_ENGINE?: string;
  readonly VITE_DEFAULT_LIGHTWALLETD?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const __APP_VERSION__: string;
