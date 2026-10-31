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
  'common.on': 'On',
  'common.off': 'Off',
  'common.otherTab':
    'Celari has a wallet open in another tab or window of this browser. Lock or close it there, then try again. Nothing was changed.',

  'boot.loading': 'Preparing the Zcash engine…',
  'boot.errorTitle': 'Celari could not start',
  'boot.errorIsolation':
    'This browser does not provide the multi-threading support Celari needs (SharedArrayBuffer), or the page is not served with the required security headers. Try a recent Chrome, Firefox, Edge or Safari.',
  'boot.retry': 'Try again',

  'welcome.eyebrow': 'Zcash wallet',
  // The words between the stars are set in italic.
  'welcome.tagline': 'An open-source, *privacy-first* browser wallet for Zcash.',
  'welcome.create': 'Create a new wallet',
  'welcome.restore': 'Restore an existing wallet',
  'welcome.pillar1': 'Your keys never leave your browser and are locked with a password',
  'welcome.pillar2': 'Shielded address by default',
  'welcome.pillar3': 'Open source · No token · No airdrop promises',
  'welcome.getStarted': 'Get started',
  'welcome.getStartedSub': 'Set up Celari in this browser.',
  'welcome.createSub': 'A new 24-word recovery phrase, locked with your password.',
  'welcome.restoreSub': 'Recovery phrase · View only',
  'welcome.footer': 'MIT / Apache-2.0 · Built on ChainSafe’s WebZjs',

  'flow.step': 'Step {n} of {total}',

  'create.seedTitle': 'Your recovery phrase',
  'create.seedIntro': 'These 24 words are the only backup of your wallet. Write them down in order and keep them safe.',
  'create.seedWarn1': 'Never share them. Nobody, Celari included, will ever ask you for these words.',
  'create.seedWarn2': 'Do not screenshot them or save them to the cloud or a chat.',
  'create.seedWarn3': 'If you lose these words, your funds cannot be recovered.',
  'create.seedWarn4':
    'Celari keeps this wallet only in this browser, and the browser can delete it on its own: Safari after 7 days of use without opening Celari (unless Celari is added to the Home Screen), any browser when the disk is full or when site data is cleared. These words are then the only way back to your funds.',
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
  'password.walletExists':
    'Another tab added a wallet to this browser meanwhile, so this one was not saved and nothing was changed. Reload the page to open that wallet. To replace it, remove it first, from its lock screen or in Settings.',

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
    'Celari will scan from Sapling activation in October 2018, so no payment is missed. The first scan can take a day and needs several GB of memory, and it pauses whenever the wallet locks.',
  'restore.birthdayHeight': 'Sync will start at block {height}.',
  'restore.storageNote':
    'Celari keeps this wallet only in this browser, and the browser can delete it on its own: Safari after 7 days of use without opening Celari (unless Celari is added to the Home Screen), any browser when the disk is full or when site data is cleared. Keep your recovery phrase: it is then the only way back.',
  'restore.storageNoteView':
    'Celari keeps this wallet only in this browser, and the browser can delete it on its own: Safari after 7 days of use without opening Celari (unless Celari is added to the Home Screen), any browser when the disk is full or when site data is cleared. Keep your viewing key: it is then the only way to add the wallet again.',
  'restore.historyEnhancementHelp':
    'On: once restored, Celari asks the server for each of your past transactions in full (memos, recipients and fees), so the server learns which transactions are yours. Off: History shows no memos and past payments by their net amount only. You can change this later under Settings > Privacy.',

  'unlock.title': 'Your wallet is locked',
  'unlock.button': 'Unlock',
  'unlock.unlocking': 'Unlocking…',
  'unlock.wrongPassword': 'Wrong password.',
  'unlock.forgot': 'I forgot my password',
  'unlock.enterHint': 'Press {key} to unlock',
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
  // The chain the engine is built for, shown once a server check has confirmed it is on it.
  'nav.network': 'Mainnet',

  'sync.starting': 'Connecting…',
  'sync.syncing': 'Syncing · {blocks} blocks left',
  'sync.syncingOne': 'Syncing · 1 block left',
  'sync.upToDate': 'Up to date · block {height}',
  'sync.behindNetwork': 'Scanned to block {height} · behind the network',
  'sync.error': 'Connection problem · will retry',
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
    'The server Celari uses is behind the Zcash network. Choose another server you trust in Settings. Sending and shielding stay disabled until then.',
  'network.upcoming':
    'At block {height} the network switches to {upgrade}, which this version of Celari does not support. From then on, sending and shielding stop until Celari is updated.',

  'home.total': 'Total balance',
  'home.balanceWaiting': 'Your balance appears as the sync goes on',
  'home.balanceStopped': 'Your balance shows after Celari reloads',
  'home.hideBalances': 'Hide balances',
  'home.shielded': 'Shielded',
  'home.shieldedHelp':
    'Ironwood + Orchard + Sapling. Amounts and parties are hidden on chain, except value that moves from one pool to another.',
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
    '{amount} ZEC of your shielded balance is in the Orchard pool and can be spent as usual. A payment from it crosses into Ironwood, the new shielded pool, and the amount that crosses is visible on chain (the ZIP 318 turnstile). The change stays in Orchard, so each later payment from it crosses again. Celari does not offer a private, gradual migration to Ironwood yet.',
  'home.saplingNote':
    '{amount} ZEC of your shielded balance is in the older Sapling pool. A payment Celari pays from it moves the whole value of each Sapling note it spends into Ironwood, and that value is visible on chain. Payments that Ironwood alone covers do not touch it.',
  'home.saplingNoteViewOnly':
    '{amount} ZEC of this balance is in the older Sapling pool. When it moves into Ironwood, its value is visible on chain.',
  'home.orchardNoteViewOnly':
    '{amount} ZEC of this balance is in the Orchard pool. New shielded funds now go to the Ironwood pool; when Orchard funds move into it, the amount that crosses is visible on chain (the ZIP 318 turnstile).',
  'home.orchardMigrateNoticeViewOnly':
    'This wallet watches a balance in the Orchard pool, which Zcash is retiring. Only a wallet that holds the recovery phrase can move it to the new Ironwood pool.',
  'home.orchardMigrateNotice':
    'Your shielded balance is in the Orchard pool, which Zcash is retiring. Moving it to the new Ironwood pool needs an updated Celari. If you need to move it sooner, restore your recovery phrase in a wallet that supports Ironwood, such as Zodl 3.8 or later.',
  'home.recent': 'Recent activity',
  'home.allTransactions': 'All transactions',
  'home.privacyTitle': 'Privacy & connection',
  'home.openSettings': 'Open Settings',
  'home.server': 'Server',
  'home.autoLockValue': '{n} min',
  'home.freshAddress': 'Address on Receive',
  'home.freshAddressValue': 'New each time',
  'home.serverSees':
    'The server sees your IP address, your transparent addresses and the transactions you broadcast. It cannot see your shielded balance or who sends you shielded payments.',
  'home.serverSeesHistory':
    'The server sees your IP address, your transparent addresses and the transactions you broadcast and, because full transactions are fetched for History, which transactions are yours. It cannot see your shielded balance or who sends you shielded payments.',

  'receive.title': 'Receive ZEC',
  'receive.unified': 'Shielded address (recommended)',
  'receive.unifiedHelp':
    'If the sender supports it, funds land directly in your shielded balance. You can share this address safely; nobody can spend your funds with it.',
  'receive.unifiedTitle': 'Unified address',
  'receive.safeToShare': 'You can share this address safely; nobody can spend your funds with it.',
  'receive.verifyHint': 'Wherever you paste it, check that its first and last characters match the ones shown here.',
  'receive.about': 'About these addresses',
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
  'send.fee':
    'Network fee at least {amount} ZEC: ZIP 317 adds 0.00005 ZEC for each further note the payment spends or creates. History shows the fee paid.',
  'send.atLeast': 'at least {amount} ZEC',
  'send.review': 'Review',
  'send.confirmTitle': 'Confirm sending',
  'send.confirmTo': 'Recipient',
  'send.confirmAmount': 'Amount',
  'send.confirmFee': 'Network fee',
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
  'send.err.address.texUnsupported':
    'Celari cannot pay TEX addresses yet: such a payment needs two linked transactions, which its engine cannot build. Nothing is sent; ask the exchange for a t1 or unified address.',
  'send.err.amount.empty': 'Enter an amount.',
  'send.err.amount.invalid': 'Invalid amount.',
  'send.err.amount.tooManyDecimals': 'At most 8 decimal places.',
  'send.err.amount.zero': 'The amount must be greater than zero.',
  'send.err.amount.insufficient': 'Your shielded balance does not cover this amount plus the fee.',
  'send.transparentWarn': 'You are sending to a transparent address: the amount and recipient will be public on chain.',
  'send.viewOnly': 'You are in view-only mode; this wallet cannot send.',
  'send.disabledOutdated': 'Sending is disabled until Celari is updated for the current Zcash network.',
  'send.nothingSent': 'Nothing was sent.',
  'send.failed': 'Sending failed.',
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
  'send.maybeSent':
    'The transaction is saved in the wallet and may have reached the network anyway. Celari sends it again every few minutes until it is mined, so do not pay again. If it is never mined, the funds become spendable again when it expires (after some payments from Orchard, only weeks later).',
  'send.sendFit': 'Send {amount} ZEC instead',
  'send.fitNote': 'That is the spendable balance less the fee this payment needs. You review and confirm it again.',
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
  'send.kind.unifiedShielded': 'Unified · shielded',
  'send.kind.unifiedPublic': 'Unified · public',
  'send.kind.unifiedPartial': 'Unified · partly shielded',
  'send.kind.unified': 'Unified address',
  'send.kind.sapling': 'Sapling · partly shielded',
  'send.kind.transparent': 'Transparent · public',
  'send.kind.tex': 'TEX · public',
  'send.previewTitle': 'Payment summary',
  'send.total': 'Total',
  'send.outcome.shielded': 'Shielded payment: the recipient and the memo stay private on chain.',
  'send.outcome.partial':
    'Partly shielded payment: the recipient and the memo stay private, but the amount entering the older Sapling pool can be seen on chain.',
  'send.outcome.fromOrchard':
    'Partly shielded payment: the recipient and the memo stay private, but it is paid from your Orchard funds, and the amount that crosses from Orchard into Ironwood is visible on chain (the ZIP 318 turnstile).',
  'send.outcome.fromSapling':
    'Partly shielded payment: the recipient and the memo stay private, but it spends notes from the older Sapling pool, and their whole value moving into Ironwood is visible on chain, not only this amount.',
  'send.outcome.public': 'Public payment: the amount and the recipient will be visible on chain.',
  'send.outcome.none': 'How private this payment is shows here once Celari can read the recipient address.',
  'send.outcome.unknown': 'Celari cannot tell from this address how private the payment will be.',
  'send.previewNote': 'Review shows the payment once more; you confirm it there with your password.',
  'send.confirmNote': 'Nothing is sent until you confirm with your password.',
  'send.privacy': 'Privacy',
  'send.privacy.shielded': 'Shielded',
  'send.privacy.partial': 'Partly shielded',
  'send.privacy.public': 'Public',
  'send.showAddress': 'Show full address',
  'send.hideAddress': 'Hide full address',

  'shield.title': 'Shield funds',
  'shield.intro':
    '{amount} ZEC of transparent funds will move to your shielded balance, into the Ironwood pool. The network fee is deducted. The amount and your transparent address are visible on chain. If your transparent funds are on more than one address (for example after restoring a phrase from another wallet), they move in one transaction, which shows publicly that those addresses belong to the same wallet.',
  'shield.introOrchard':
    '{amount} ZEC of transparent funds will move to your shielded Orchard balance. The network fee is deducted. The amount and your transparent address are visible on chain. If your transparent funds are on more than one address (for example after restoring a phrase from another wallet), they move in one transaction, which shows publicly that those addresses belong to the same wallet.',
  'shield.confirm': 'Shield',
  'shield.success': 'It will appear in your shielded balance once confirmed.',
  'shield.sentTitle': '{amount} ZEC is being shielded',
  'shield.disabledOutdated': 'Shielding is disabled until Celari is updated for the current Zcash network.',
  'shield.amount': 'Amount to shield',
  'shield.from': 'From',
  'shield.to': 'To',
  'shield.fromValue': 'Transparent balance',
  'shield.toIronwood': 'Shielded balance · Ironwood',
  'shield.toOrchard': 'Shielded balance · Orchard',
  'shield.fee': 'Estimated fee, taken from this amount',
  'shield.confirmNote': 'Nothing moves until you confirm with your password.',

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
  'history.emptyHelp': 'Payments you send and receive show up here.',
  'history.col.transaction': 'Transaction',
  'history.col.date': 'Date',
  'history.col.privacy': 'Privacy',
  'history.col.amount': 'Amount',
  'history.txid': 'Transaction ID',
  'history.undated': 'Not in a block',

  'settings.title': 'Settings',
  'settings.sections': 'On this page',
  'settings.general': 'General',
  'settings.language': 'Language',
  'settings.server': 'Server (lightwalletd gRPC-web proxy)',
  'settings.serverHelp':
    'The server can see your IP address, your transparent addresses (checked on every sync) and the transactions you broadcast. Unless you turn off “Fetch full transactions for History” under Privacy, Celari also asks it for your own transactions in full (for memos, and for fees and recipients after a restore), so it can tell which transactions are yours. Either way it asks about each payment you sent until it is confirmed. It cannot see your shielded balance or who sends you shielded payments. You can run your own. The server also decides which blocks Celari sees: a dishonest server can show payments that never happened, hide real ones, or not pass on what you send. Use only a server you trust, and check a large incoming payment on another server or a block explorer before you rely on it.',
  'settings.serverTrust':
    'Celari believes what this server says about the chain: a dishonest server can show payments that never happened, hide real ones, or not pass on what you send. Save it only if you trust it, and check a large incoming payment on another server or a block explorer before you rely on it.',
  'settings.serverShort': 'Server',
  'settings.serverSave': 'Save and restart',
  'settings.serverReset': 'Reset to default',
  'settings.serverInvalid': 'Enter a valid address starting with https://.',
  'settings.privacy': 'Privacy',
  'settings.historyEnhancement': 'Fetch full transactions for History',
  'settings.historyEnhancementHelp':
    'On: Celari asks the server for each of your own transactions in full, for their memos and, after a restore, for the recipients and fees of past payments. The server then learns which transactions are yours. Off: it does not learn that this way, but History shows no memos and, after a restore, past payments by their net amount only; turning it on again fetches what is missing. Either way Celari asks the server about a payment you sent until it is confirmed, at most every 5 minutes.',
  'settings.autoLock': 'Auto-lock',
  'settings.autoLockHelp':
    'How long Celari waits without activity before it locks. It also locks once this tab has been in the background for 1 minute.',
  'settings.minutesShort': '{n} minutes',
  'settings.security': 'Security',
  'settings.viewingKey': 'Viewing key',
  'settings.showViewingKey': 'Show viewing key',
  'settings.viewingKeyHelp':
    'Anyone with this key can see all your past and future transactions and memos, but cannot spend. It cannot be revoked; share it only with someone you fully trust.',
  'settings.clipboardClear':
    'Celari tries to clear the clipboard 60 seconds after copying. Browsers allow that only while this tab is in front, so it may happen later, when you come back, or not at all if you close the tab first. Anything you copy in another app meanwhile may be cleared instead.',
  'settings.clipboardCleared': 'Clipboard cleared.',
  'settings.seed': 'Recovery phrase',
  'settings.seedHelp': 'The words that restore this wallet. Anyone who has them can spend your funds.',
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
  'settings.fontLicenses': 'Font licences',
  'settings.version': 'Version {v}',
} as const;

export type MessageKey = keyof typeof en;
