import type { ZcashEngine } from './types';

export * from './types';

export async function loadEngine(): Promise<ZcashEngine> {
  // `import.meta.env.DEV` is false in production builds, so the fake engine is
  // dropped from the bundle entirely; it only exists for UI tests.
  if (import.meta.env.DEV && import.meta.env.VITE_FAKE_ENGINE === '1') {
    const { FakeEngine } = await import('./fake');
    return new FakeEngine();
  }
  const { WebzjsEngine } = await import('./webzjs');
  return new WebzjsEngine();
}
