// The line Send and Shield show when the engine refused a spend (SpendRefusedError).
// Kept pure, so the texts can be unit-tested in both languages.

import type { SpendRefusal } from '../engine/types';
import type { Lang, Translate } from '../i18n';
import { NU7_ACTIVATION_HEIGHT } from './birthday';
import { formatZec } from './zec';

/** Blocks without sends around an upgrade: the last 10 before it and its first one (docs/engine-port.md, Decision 7). */
const UPGRADE_PAUSE_BLOCKS = 11;

/** The line that says why the engine refused a spend; each one says that nothing was sent. */
export function refusalText(refusal: SpendRefusal, t: Translate, lang: Lang): string {
  const n = (x: number) => x.toLocaleString(lang === 'tr' ? 'tr-TR' : 'en-US');
  switch (refusal.reason) {
    case 'insufficientFunds':
      return t('send.refused.funds', {
        required: formatZec(refusal.requiredZats, { locale: lang }),
        available: formatZec(refusal.availableZats, { locale: lang }),
      });
    case 'upgradePending': {
      const { activationHeight: height, blocksLeft: blocks } = refusal;
      // Blocks are 75 s apart before NU7, 25 s from it on.
      const seconds = UPGRADE_PAUSE_BLOCKS * (height !== null && height > NU7_ACTIVATION_HEIGHT ? 25 : 75);
      const vars = { minutes: Math.round(seconds / 60), upgrade: refusal.upgrade ?? t('send.refused.theUpgrade') };
      if (height === null || blocks === null) return t('send.refused.upgradeSoon', vars);
      if (blocks === 0) return t('send.refused.upgradeNext', { ...vars, height: n(height) });
      return t('send.refused.upgrade', { ...vars, height: n(height), blocks: n(blocks) });
    }
    case 'wrongBranch':
      return t('send.refused.wrongBranch');
    case 'expired':
      return t('send.refused.expired');
  }
}

