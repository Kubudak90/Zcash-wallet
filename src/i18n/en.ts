// English source strings: the primary language and the key source. tr.ts must have the same keys (type-checked).

export const en = {
  'common.continue': 'Continue',
  'common.back': 'Back',
  'common.cancel': 'Cancel',
  'common.copy': 'Copy',
  'common.copied': 'Copied',
  'common.close': 'Close',
  'common.password': 'Password',
  'common.details': 'Details',
  'common.genericError': 'Something went wrong.',
  'common.viewHistory': 'View in history',
  'common.amountHidden': 'amount hidden',

  'boot.loading': 'Preparing the Zcash engine…',
  'boot.errorTitle': 'Celari could not start',
  'boot.errorIsolation':
    'This browser does not provide the multi-threading support Celari needs (SharedArrayBuffer), or the page is not served with the required security headers. Try a recent Chrome, Firefox, Edge or Safari.',
  'boot.retry': 'Try again',

  'welcome.tagline': 'An open-source, privacy-first browser wallet for Zcash.',
  'welcome.create': 'Create a new wallet',
  'welcome.restore': 'Restore an existing wallet',
  'welcome.pillar1': 'Your keys never leave your browser and are locked with a password',
  'welcome.pillar2': 'Shielded address by default',
  'welcome.pillar3': 'Open source · No token · No airdrop promises',

  'create.seedTitle': 'Your recovery phrase',
  'create.seedIntro': 'These 24 words are the only backup of your wallet. Write them down in order and keep them safe.',
  'create.seedWarn1': 'Never share them. Nobody, Celari included, will ever ask you for these words.',
  'create.seedWarn2': 'Do not screenshot them or save them to the cloud or a chat.',
  'create.seedWarn3': 'If you lose these words, your funds cannot be recovered.',
  'create.reveal': 'Reveal words',
  'create.wroteDown': 'I wrote the words down in order',
  'create.verifyTitle': 'Check your backup',
  'create.verifyIntro': 'Looking at your paper, enter these words:',
  'create.wordN': 'Word #{n}',
  'create.verifyError': 'The words do not match. Check your paper.',

  'password.title': 'Set a password',
  'password.intro':
    'This password locks your wallet in this browser. If you forget it, you can restore the wallet from your recovery phrase.',
  'password.introView':
    'This password locks your wallet in this browser. If you forget it, you can add the wallet again with your viewing key (uview1…).',
  'password.repeat': 'Password (again)',
  'password.mismatch': 'Passwords do not match.',
  'password.tooShort': 'Must be at least {n} characters.',
  'password.strength.weak': 'Weak',
  'password.strength.fair': 'Fair',
  'password.strength.strong': 'Strong',
  'password.finish': 'Create wallet',
  'password.creating': 'Creating wallet…',

  'restore.title': 'Restore a wallet',
  'restore.modeSeed': 'Recovery phrase',
  'restore.modeView': 'View only',
  'restore.seedLabel': 'Recovery phrase (12–24 words, separated by spaces)',
  'restore.seedInvalid': 'This is not a valid recovery phrase. Check the spelling and the number of words.',
  'restore.viewLabel': 'Viewing key (uview1…)',
  'restore.viewHelp':
    'In view-only mode you see your balance and history but cannot send. The key has no spending authority.',
  'restore.viewInvalid': 'This is not a valid mainnet viewing key.',
  'restore.birthdayTitle': 'When did you first use this wallet?',
  'restore.birthdayHelp': 'Sync starts from this date. If unsure, pick a slightly earlier month.',
  'restore.birthdayMonth': 'Month',
  'restore.birthdayPlaceholder': 'YYYY-MM',
  'restore.birthdayInvalid': 'Enter a month such as 2023-05 or 05.2023, between 2018-10 and this month.',
  'restore.longScan':
    'Starting from {month} means scanning about {blocks} blocks. The first scan can take hours (from 2022 or early 2023, about a day) and needs several GB of memory, and it pauses whenever the wallet locks. If you are sure the wallet was not used before a later month, choose the latest month you are sure of.',
  'restore.birthdayUnknown': 'I don’t know',
  'restore.birthdayUnknownHelp':
    'We will first look for the earliest transaction on your transparent address. If none is found we scan from Sapling activation in 2018, which can take hours.',
  'restore.birthdayDetecting': 'Looking for the first transaction…',
  'restore.birthdayHeight': 'Sync will start at block {height}.',
  'restore.historyEnhancementHelp':
    'On: once restored, Celari asks the server for each of your past transactions in full (memos, recipients and fees), so the server learns which transactions are yours. Off: History shows no memos and past payments by their net amount only. You can change this later under Settings > Privacy.',

  'unlock.title': 'Your wallet is locked',
  'unlock.button': 'Unlock',
  'unlock.unlocking': 'Unlocking…',
  'unlock.wrongPassword': 'Wrong password.',
  'unlock.forgot': 'I forgot my password',
  'unlock.forgotHelp':
    'There is no way to recover the password. You can remove the wallet from this browser and restore it from your recovery phrase.',
  'unlock.forgotHelpView':
    'There is no way to recover the password. You can remove the wallet from this browser and add it again with your viewing key (uview1…).',
  'unlock.autoLocked': 'Locked automatically after {n} minutes of inactivity.',
  'unlock.autoLockedHidden': 'Locked automatically because this tab was in the background for 1 minute.',
  'unlock.softLocked': 'The sync keeps running in the background until its progress is saved, so a long restore is not lost.',
  'unlock.upgradeRescan':
    'Celari was updated for the new Zcash network rules and is rescanning this wallet from its starting block. This can take a while, and it goes on while the wallet is unlocked. Your funds are safe.',
  'unlock.dbUnreadable':
    'Celari could not read this wallet’s saved data, so it changed nothing; your funds are safe. Reload the page and try again. If it keeps failing, you can remove the wallet from this browser and restore it from your recovery phrase.',
  'unlock.dbUnreadableView':
    'Celari could not read this wallet’s saved data, so it changed nothing. Reload the page and try again. If it keeps failing, you can remove the wallet from this browser and add it again with your viewing key (uview1…).',
  'unlock.dbNewer':
    'This wallet was saved by a newer version of Celari than the one running now, which cannot open it. Nothing was changed and your funds are safe. Reload the page to get the newer version.',

  'upgrade.rescanning':
    'Celari was updated for the new Zcash network rules and is rescanning this wallet from its starting block. This can take a while, an hour or more for an older wallet, and it runs only while Celari is unlocked: it pauses whenever the wallet locks (after {minutes} minutes without activity, or 1 minute in a background tab) and goes on when you unlock. Keep this tab open and in front, or raise the auto-lock time in Settings until it is done. Your funds are safe; the balance and history fill in as the scan goes on.',

  'nav.home': 'Balance',
  'nav.receive': 'Receive',
  'nav.send': 'Send',
  'nav.history': 'History',
  'nav.settings': 'Settings',
  'nav.lock': 'Lock',

  'sync.starting': 'Connecting…',
  'sync.syncing': 'Syncing · {blocks} blocks left',
  'sync.syncingOne': 'Syncing · 1 block left',
  'sync.upToDate': 'Up to date · block {height}',
  'sync.behindNetwork': 'Scanned to block {height} · behind the network',
  'sync.error': 'Connection problem, will retry',
  'sync.stopped': 'Stopped · reload needed',
  'sync.stalled':
    'Syncing has not moved for 10 minutes. A slow connection can do this; if it stays like this, reload Celari. Everything saved so far is kept.',
  'engine.stopped':
    'Celari’s wallet engine stopped (it ran out of memory or hit an internal error) and cannot go on in this tab. Your funds are safe, and everything saved so far is kept. Reload Celari to continue from there.',
  'engine.reload': 'Reload Celari',
  'sync.firstSyncNote': 'Sync in progress. Your balance may be incomplete until it finishes.',

  'network.outdatedTitle': 'Celari is behind the Zcash network',
  'network.outdatedText':
    'The Zcash network has moved to rules this version of Celari does not support yet: {upgrade}. Sending and shielding are disabled until the update, because the network would reject anything this version builds. Your keys and funds are safe.',
  'network.unreachable': 'Celari could not check the network version. Sending and shielding stay disabled until it can.',
  'network.serverBehind':
    'The server Celari uses is behind the Zcash network. Choose another server in Settings. Sending and shielding stay disabled until then.',
  'network.upcoming':
    'At block {height} the network switches to {upgrade}, which this version of Celari does not support. From then on, sending and shielding stop until Celari is updated.',

  'home.total': 'Total balance',
  'home.hideBalances': 'Hide balances',
  'home.shielded': 'Shielded',
  'home.shieldedHelp': 'Ironwood + Orchard + Sapling. Amounts and parties are hidden on chain.',
  'home.transparent': 'Transparent',
  'home.transparentHelp': 'Public on chain. Shielding it is recommended.',
  'home.pending': 'Awaiting confirmation',
  'home.viewOnly': 'View only',
  'home.shieldTitle': 'You have a transparent balance',
  'home.shieldText':
    '{amount} ZEC sits on a public transparent address. Shield it to protect your future transactions.',
  'home.shieldButton': 'Shield funds',
  'home.shieldBelowThreshold': 'At least {amount} ZEC is needed to shield.',
  'home.outdatedBalance': 'Payments sent to you through the new Ironwood pool are not in this balance yet.',
  'home.orchardNote':
    '{amount} ZEC of your shielded balance is in the Orchard pool and can be spent as usual. Spending from it moves the change into Ironwood, the new shielded pool, and the amount that crosses from Orchard into Ironwood is visible on chain (the ZIP 318 turnstile). Celari does not offer a private, gradual migration to Ironwood yet.',
  'home.orchardNoteViewOnly':
    '{amount} ZEC of this balance is in the Orchard pool. New shielded funds now go to the Ironwood pool; when Orchard funds move into it, the amount that crosses is visible on chain (the ZIP 318 turnstile).',
  'home.orchardMigrateNoticeViewOnly':
    'This wallet watches a balance in the Orchard pool, which Zcash is retiring. Only a wallet that holds the recovery phrase can move it to the new Ironwood pool.',
  'home.orchardMigrateNotice':
    'Your shielded balance is in the Orchard pool, which Zcash is retiring. Moving it to the new Ironwood pool needs an updated Celari. If you need to move it sooner, restore your recovery phrase in a wallet that supports Ironwood, such as Zodl 3.8 or later.',

  'receive.title': 'Receive ZEC',
  'receive.unified': 'Shielded address (recommended)',
  'receive.unifiedHelp':
    'Unified address. If the sender supports it, funds land directly in your shielded balance. You can share this address safely; nobody can spend your funds with it.',
  'receive.transparent': 'Transparent address',
  'receive.transparentHelp':
    'Only for exchanges that do not support unified addresses. Funds sent here are public; shield them once they arrive.',
  'receive.showTransparent': 'Show transparent address',
  'receive.showUnified': 'Back to shielded address',
  'receive.noTransparent': 'This key has no transparent address.',
  'receive.preparing': 'Preparing a new address…',
  'receive.freshNote':
    'For your privacy, Celari shows a new address each time you open this screen. Earlier addresses keep working.',
  'receive.previousNote':
    'This address was shown before and keeps working. Celari shows a new one when it can, usually the next time you open this screen.',
  'receive.outdatedWarn':
    'Payments sent to this address from up-to-date wallets go to the new Ironwood pool, which this version of Celari cannot see yet. They are not lost: they will show up after the update. Do not ask the sender to pay again.',

  'send.title': 'Send ZEC',
  'send.to': 'Recipient address',
  'send.toPlaceholder': 'u1…, zs1…, t1… or a zcash: link',
  'send.amount': 'Amount (ZEC)',
  'send.max': 'Max',
  'send.available': 'Spendable shielded balance: {amount} ZEC',
  'send.fee': 'Network fee about {amount} ZEC',
  'send.review': 'Review',
  'send.confirmTitle': 'Confirm sending',
  'send.confirmTo': 'Recipient',
  'send.confirmAmount': 'Amount',
  'send.confirmFee': 'Estimated fee',
  'send.confirmPassword': 'Enter your password to confirm',
  'send.sendNow': 'Send',
  'send.stage.building': 'Building the transaction…',
  'send.stage.signing': 'Signing…',
  'send.stage.proving': 'Generating zero-knowledge proofs (10–60 s)…',
  'send.stage.broadcasting': 'Broadcasting…',
  'send.doNotClose': 'Do not close this tab until it finishes.',
  'send.waitForSync': 'The wallet is still syncing ({blocks} blocks left). You can continue once it is up to date.',
  'send.waitForSyncOne': 'The wallet is still syncing (1 block left). You can continue once it is up to date.',
  'send.waitForConnect': 'The wallet is still connecting to the network. You can continue once it is up to date.',
  'send.waitForRetry':
    'The wallet is {blocks} blocks behind and its sync stopped on a connection problem; it will retry. You can continue once it is up to date.',
  'send.success': 'The transaction will confirm in a few minutes.',
  'send.another': 'New payment',
  'send.err.address.empty': 'Enter the recipient address.',
  'send.err.address.invalid': 'This is not a valid Zcash address. There may be a typo.',
  'send.err.address.testnet': 'This is a testnet address. Celari runs on mainnet.',
  'send.err.amount.empty': 'Enter an amount.',
  'send.err.amount.invalid': 'Invalid amount.',
  'send.err.amount.tooManyDecimals': 'At most 8 decimal places.',
  'send.err.amount.zero': 'The amount must be greater than zero.',
  'send.err.amount.insufficient': 'Your shielded balance does not cover this amount plus the fee.',
  'send.transparentWarn': 'You are sending to a transparent address: the amount and recipient will be public on chain.',
  'send.texWarn':
    'This is a TEX address (used by some exchanges). Funds reach it through a transparent intermediate step, which is public.',
  'send.viewOnly': 'You are in view-only mode; this wallet cannot send.',
  'send.disabledOutdated': 'Sending is disabled until Celari is updated for the current Zcash network.',
  'send.nothingSent': 'Nothing was sent.',
  'send.failed': 'Sending failed.',
  'send.failedHint': 'The balance may not cover the network fee. Lower the amount slightly and try again.',
  'send.uriFilled': 'Amount filled in from the payment link.',
  'send.sentTitle': '{amount} ZEC sent',
  'send.stageDone': 'done',
  'send.failedRetry': 'Nothing was sent. You can try again.',
  'send.refused.funds':
    'Nothing was sent: the spendable balance does not cover this payment. It needs {required} ZEC including the network fee; {available} ZEC is spendable.',
  'send.refused.upgrade':
    'Nothing was sent. Sending pauses for about {minutes} minutes around a network upgrade: {upgrade} activates at block {height}, {blocks} blocks from now. Try again once it is active.',
  'send.refused.upgradeNext':
    'Nothing was sent. Sending pauses for about {minutes} minutes around a network upgrade: {upgrade} activates with the next block ({height}). Try again in a few minutes.',
  'send.refused.upgradeSoon':
    'Nothing was sent. Sending pauses for about {minutes} minutes around a network upgrade. Try again in a few minutes.',
  'send.refused.theUpgrade': 'the upgrade',
  'send.refused.wrongBranch':
    'Nothing was sent: a network upgrade activated while the transaction was being prepared, so it could never be mined. Try again; a new one is built under the new rules.',
  'send.refused.expired':
    'Nothing was sent: the transaction would have expired before it could be mined. Try again; a new one is built.',
  'send.maybeSent': 'The transaction may have reached the network anyway. Check History before you try again.',
  'send.shieldFirst':
    'You also have {amount} ZEC of transparent funds. Only shielded funds can be sent, so shield them first.',
  'send.err.amount.insufficientShieldFirst':
    'Your shielded balance does not cover this amount plus the fee. Shield your transparent funds first, then send.',
  'send.err.link.multi': 'Payment links with several recipients are not supported.',
  'send.err.link.req':
    'This payment link uses a feature Celari does not support yet, so it cannot be paid. Ask the recipient for a plain address.',
  'send.err.link.memo':
    'This link asks for a memo, but its address cannot receive one: memos only go to shielded addresses. Ask the recipient for a shielded address.',
  'send.err.link.invalid':
    'This payment link is not valid. Celari will not guess what it asks for; ask the recipient for a new link.',
  'send.memo': 'Memo (optional)',
  'send.memoHelp': 'Encrypted; only you and the recipient can read it.',
  'send.memoCount': '{used} / {max} bytes',
  'send.memoFromLink': 'Memo filled in from the payment link.',
  'send.memoUnavailable': 'This address cannot receive a memo: memos only travel with payments to shielded addresses.',
  'send.confirmMemo': 'Memo',
  'send.err.memo.tooLong':
    'The memo is too long: at most 512 bytes. Letters such as é or ü take 2 bytes, emoji 4.',
  'send.err.memo.nul': 'The memo contains an invisible NUL character (usually from a paste). Type it again.',

  'shield.title': 'Shield funds',
  'shield.intro':
    '{amount} ZEC of transparent funds will move to your shielded balance, into the Ironwood pool. The network fee is deducted.',
  'shield.introOrchard': '{amount} ZEC of transparent funds will move to your shielded Orchard balance. The network fee is deducted.',
  'shield.confirm': 'Shield',
  'shield.success': 'It will appear in your shielded balance once confirmed.',
  'shield.sentTitle': '{amount} ZEC is being shielded',
  'shield.disabledOutdated': 'Shielding is disabled until Celari is updated for the current Zcash network.',

  'history.title': 'Transaction history',
  'history.empty': 'No transactions yet.',
  'history.type.received': 'Received',
  'history.type.sent': 'Sent',
  'history.type.shielded': 'Shielded',
  'history.status.confirmed': 'Confirmed',
  'history.status.pending': 'Pending',
  'history.status.expired': 'Expired',
  'history.fee': 'Fee {amount} ZEC',
  'history.copyTxid': 'Copy transaction ID',
  'history.privacyLabel': 'Privacy',
  'history.privacy.shielded': 'Shielded',
  'history.privacy.shielding': 'Shielded · amount public',
  'history.privacy.partial': 'Partly shielded',
  'history.privacy.transparent': 'Transparent · public',
  'history.privacyNote':
    'Labels look only at this wallet’s own outputs (what it received, sent or got back as change), not at the rest of each transaction. Transparent inputs, this wallet’s own included, are always public.',

  'settings.title': 'Settings',
  'settings.language': 'Language',
  'settings.server': 'Server (lightwalletd gRPC-web proxy)',
  'settings.serverHelp':
    'The server can see your IP address and the transactions you broadcast. Unless you turn off “Fetch full transactions for History” under Privacy, Celari also asks it for your own transactions in full (for memos, and for fees and recipients after a restore), so it can tell which transactions are yours. Either way it asks about each payment you sent until it is confirmed. It cannot see your shielded balance or who paid you. You can run your own.',
  'settings.serverSave': 'Save and restart',
  'settings.serverReset': 'Reset to default',
  'settings.serverInvalid': 'Enter a valid address starting with https://.',
  'settings.privacy': 'Privacy',
  'settings.historyEnhancement': 'Fetch full transactions for History',
  'settings.historyEnhancementHelp':
    'On: Celari asks the server for each of your own transactions in full, for their memos and, after a restore, for the recipients and fees of past payments. The server then learns which transactions are yours. Off: it does not learn that this way, but History shows no memos and, after a restore, past payments by their net amount only; turning it on again fetches what is missing. Either way Celari asks the server about a payment you sent until it is confirmed, at most every 5 minutes.',
  'settings.autoLock': 'Auto-lock',
  'settings.minutes': 'after {n} minutes of inactivity',
  'settings.autoLockHidden': 'The wallet also locks once this tab has been in the background for 1 minute.',
  'settings.security': 'Security',
  'settings.showViewingKey': 'Show viewing key',
  'settings.viewingKeyHelp':
    'Anyone with this key can see all your past and future transactions and memos, but cannot spend. It cannot be revoked; share it only with someone you fully trust.',
  'settings.clipboardClear':
    'Celari tries to clear the clipboard 60 seconds after copying. Browsers allow that only while this tab is in front, so it may happen later, when you come back, or not at all if you close the tab first. Anything you copy in another app meanwhile may be cleared instead.',
  'settings.clipboardCleared': 'Clipboard cleared.',
  'settings.showSeed': 'Show recovery phrase',
  'settings.reveal': 'Reveal',
  'settings.danger': 'Danger zone',
  'settings.wipe': 'Remove wallet from this browser',
  'settings.wipeHelp': 'Without your recovery phrase, your funds will be lost for good.',
  'settings.wipeHelpView': 'Without your viewing key you cannot add this wallet again. It cannot spend, so no funds are lost.',
  'settings.wipeConfirm': 'Type {word} to confirm',
  'settings.wipeWord': 'DELETE',
  'settings.about': 'About',
  'settings.aboutText':
    'Celari is open source (MIT / Apache-2.0) and built on ChainSafe’s WebZjs library. No token, no points, no airdrop promises.',
  'settings.source': 'Source code',
  'settings.licenses': 'Third-party licences (wallet engine)',
  'settings.version': 'Version {v}',
} as const;

export type MessageKey = keyof typeof en;
