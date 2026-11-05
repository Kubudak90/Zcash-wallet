# Celari: tanıtım ve kullanım videosu / promo and how-to video

1920x1080, 30 fps, dark ("Obsidian & Gold"), silent with on-screen text (a narration script per scene is in
`storyboard.json`, `vo`). Turkish is the primary language, English the second render of the same scenes.
Total about 2:30; it is cut three ways from the same scene clips:
**promo** (s01-s04, s15, about 55 s) · **tutorial** (s05-s14, s15, about 2 min) · **full**.

Tone: calm, exact, a little austere, like the wallet itself ("No token, no points, no airdrop promises").
No hype words, no exclamation marks. Honesty is part of the brand: the closing says what Celari is not yet.

Act 1 is free-form (`_template-promo`), act 2 uses the shared window layout (`_template-tutorial`), act 3 is free-form.
Durations are targets (+/- 1.5 s); the assembler uses the real clip lengths.

Scene groups (one builder per group): **A** s01 s02 · **B** s03 s04 · **C** s05 s06 s07 s08 s09 · **D** s10 s11 ·
**E** s12 s13 · **F** s14 s15.

---------------------------------------------------------------------------------------------------------

## ACT 1: TANITIM / PROMO

### s01-open (8.2 s) · free-form
The engraved C draws itself (silhouette and inner lines draw in, the echoes expand outward, the gold facet lights
last), the lockup rises in the middle, then the tagline. Dark, quiet, no UI.
- 0.0-2.6 C draws in; 1.9 facet lights; 2.2-3.2 lockup (mark + wordmark, `lockupHTML`) fades up, centred.
- 4.0-7.7 tagline in Fraunces ~84 px, centred under the lockup (the lockup rises ~160 px by 4.2 s to make room; word stagger 0.10 s, complete at 5.4 s so it can be read for ~2.5 s before the dissolve).
  TR: `Zcash için açık kaynak, *gizlilik öncelikli* tarayıcı cüzdanı.` (landing/welcome copy; italic gold for the emphasised words)
  EN: `An open-source, *privacy-first* browser wallet for Zcash.`
- 5.3 small line, Geist 28 px muted, eyebrow style: TR `Celare (Latince): gizlemek.` EN `Celare (Latin): to hide.` (README)
- The echoes keep a slow outward drift to the end; hold calm for the last 2 s (the end state is s02's start state).

### s02-default (11.5 s) · free-form
Idea: privacy is the default, not a setting. Two payment rows styled like the wallet's History rows
(plate `history` shows the real look; rebuild the rows in HTML with the same proportions, tokens and chips, this is
motion graphics, not a UI screenshot) contrasted:
- Headline (Fraunces ~96 px, left): TR `Gizlilik bir ayar değil, *varsayılan*.` EN `Privacy isn’t a setting. It’s the *default*.`
- Row A, copper chip with hollow dot `Şeffaf · herkese açık` / `Transparent · public`: label "Gönderildi" / "Sent", amount `−0,5001 ZEC`,
  a full t1… address in Geist Mono, all plainly visible; an open-eye icon. Caption under it: TR `Zincirde herkese açık.` EN `Public on chain.` (en.ts home.transparentHelp)
- Row B, sage chip with dot TR `Gizli (shielded)` (the first-use gloss; the app label is `Gizli`) / EN `Shielded`: same layout, but amount and address are replaced by masked dots (`●●●●`) that never
  resolve; eye-off icon. Caption: TR `Tutar ve taraflar zincirde görünmez.` EN `Amounts and parties are not visible on chain.`
  with a quiet footnote: TR `Bir havuzdan diğerine geçen değer hariç.` EN `Except value that crosses between pools.` (en.ts home.shieldedHelp)
- Motion: row A in (0.6), its fields "read" by a thin gold scan line sweeping left to right (2.2) and each field underlined;
  row B in (3.9, scan 5.0), the same sweep finds nothing: the masks stay. From 7.1 s the bottom line (it stays up ~3.5 s before the dissolve at 11.0 s), TR `Al ekranı her açılışta yeni, yalnızca gizli bir adres gösterir.` EN `Receive shows a new, shielded-only address every time you open it.` (README Features)
- Layout: headline top-left, rows stacked on the right 60% or below the headline: your call, but both rows must be readable at once at the end.

### s03-promises (13 s) · free-form
Title (Fraunces ~72): TR `Doğrulanabilen gizlilik.` EN `Privacy you can check.` (landing features_h)
Four cards rising in sequence (2x2 grid or a row of four), each: wallet icon (`iconSVG`), a title (Geist 600, 34 px), one line of text (28 px muted).
1. `lock`: TR `Anahtarlar cihazında kalır` / `Kurtarma kelimeleri ve cüzdan veritabanı yalnızca şifreli saklanır: PBKDF2-SHA256 (600.000 tur) ve AES-256-GCM.`
   EN `Keys stay on your device` / `The recovery phrase and the wallet database are stored only encrypted: PBKDF2-SHA256 (600,000 rounds) and AES-256-GCM.` (landing features[1])
2. `shield`: TR `Varsayılan olarak gizli` / `Şeffaf bakiye tek tıkla gizli havuza aktarılır.` EN `Shielded by default` / `Transparent funds are one click from the shielded pool.` (landing features[0])
3. `eye`: TR `Dürüst etiketler` / `Her ödeme gizli mi, kısmen gizli mi, herkese açık mı olduğunu ve nedenini söyler.` (smoothed from the site's `…, nedeniyle söyler.`) EN `Honest labels` / `Each payment says whether it is shielded, partly shielded or public, and why.` (landing features[3])
4. `code`: TR `Açık kaynak` / `MIT ya da Apache-2.0. Token yok, hesap yok, airdrop vaadi yok.` EN `Open source` / `MIT or Apache-2.0. No token, no account, no airdrop promises.` (landing ticker, features[5])
Then a stats strip (counters counting up, Fraunces ~88 px, gold): `600.000` PBKDF2-SHA256 turu / rounds · `24` kelime: tek yedeğin / words: your only backup · `256` bit AES-GCM (landing stats).
Shorten the card text if it does not fit at >= 28 px; keep the facts. Cards appear ~0.6 s apart; each is on screen >= 5 s.

### s04-how (14 s) · free-form
Title: TR `Bloklar tarayıcında taranır.` EN `Blocks are scanned in your browser.` (landing how_p)
Diagram (0.8-6): left node `lightwalletd` (server icon) → animated dots/blocks travelling along a line labelled TR `kompakt bloklar` EN `compact blocks` →
right node TR `Senin tarayıcın` EN `Your browser` with sub-label TR `WebAssembly ile tarar` EN `Scans them in WebAssembly` (landing diagram).
Then two columns (6-12.5), each three short lines with a header:
- sage header TR `Sende kalanlar` EN `What stays with you`: TR `Gizli bakiyen ve sana gizli ödeme yapanlar` · `Kurtarma kelimelerin ve harcama anahtarların` · `Notların: yalnızca sen ve alıcı okuyabilirsiniz`
  EN `Your shielded balance, and who pays you in the shielded pool` · `Your recovery phrase and spending keys` · `Your memos: only you and the recipient can read them` (landing stays)
- copper header TR `Sunucunun gördükleri` EN `What the server sees`: TR `IP adresin, şeffaf adreslerin ve yayınladığın işlemler` · `Geçmiş için işlemlerin tamamı getirildiği sürece hangi işlemlerin senin olduğu (bunu kapatabilirsin)` · `Celari’nin hangi blokları göreceğine o karar verir: güvendiğin sunucuyu kullan`
  EN `Your IP address, your transparent addresses and the transactions you broadcast` · `Which transactions are yours, while History fetches them in full` · `It decides which blocks Celari sees: use a server you trust` (landing sees)
Last 2 s (12-14): one line, TR `Her ödeme tarayıcında oluşturulur, imzalanır, kanıtlanır ve yayınlanır.` EN `Every payment is created, signed, proved and broadcast from your browser.` as a 4-step chip pipeline (Oluştur → İmzala → Kanıtla → Yayınla / Create → Sign → Prove → Broadcast; landing flow). Honest and balanced: the copper column is as legible as the sage one.

---------------------------------------------------------------------------------------------------------

## ACT 2: KULLANIM / HOW TO USE (8 steps, shared layout `tutorialShell`, `total: 8`, plates `desktop`)

The panel shows step badge, title (<= 3 words), one sentence (`sub`), and 1-3 `note` cards. The window shows the real plates
with a cursor that clicks through them. Do not narrate the obvious: the cursor shows, the panel tells why it matters.

### s05-bumper (5 s) · free-form
Chapter card. TR `Nasıl kullanılır` / `Sekiz adımda Celari.` EN `How to use it` / `Celari in eight steps.` The eight step names appear as a
numbered list (gold numerals 01-08 in Geist Mono, names in Geist 30 px), stagger 0.15 s:
TR Cüzdanı aç · 24 kelimeyi yaz · Yedeğini doğrula · Şifre belirle · ZEC al · ZEC gönder · Gizliye aktar · Geçmiş, ayarlar, kilit
EN Open the wallet · Write the 24 words · Verify the backup · Set a password · Receive ZEC · Send ZEC · Shield funds · History, settings, lock.
(Each name is exactly the panel title of the scene it introduces.)
A chip bottom-left: TR `Gerçek arayüz · demo verisi` EN `Real interface · demo data`. The engraved C sits large and faint behind (about 750 px wide, centred between the headline and the card). The lockup, title and sub are composed from t=0 (the first 0.5 s dissolves with s04); the card and its rows arrive after 0.5 s.

### s06-open-wallet (10 s) · step 1 · composed from t=0 (the shell without `first`: the window stands from t=0, the panel text comes in at 0.3 s after s05's text has faded)
Title TR `Cüzdanı aç` EN `Open the wallet`. Sub TR `app.celariwallet.com adresini aç. Hesap açmana gerek yok.` EN `Go to app.celariwallet.com. There is no account to make.`
Plates: `welcome` -> `create-seed-hidden`. Ring + callout on the URL bar (real address; the bar is part of the shell; use `sh.WIN` coordinates), then cursor to
`welcome.create` and click, plates swap. Notes: TR `Dil sağ üstten değişir: English / Türkçe` EN `Switch language top right: English / Türkçe` (target `welcome.language`) ·
TR `Anahtarların tarayıcından çıkmaz` EN `Your keys never leave your browser` (welcome pillar).

### s07-recovery (10 s) · step 2
Title TR `24 kelimeyi yaz` EN `Write the 24 words`. Sub TR `Bu kelimeler cüzdanının tek yedeği. Sırasıyla kağıda yaz.` EN `These words are the only backup of your wallet. Write them down in order.` (create.seedIntro)
Plates: `create-seed-hidden` -> `create-seed-revealed` -> `create-seed-checked`. Cursor clicks `create-seed-hidden.reveal`; the words appear; camera pushes onto
`grid`; words readable ~2 s, then they blur (demo-word rule) with a chip TR `Demo kelimeleri` EN `Demo words`; cursor ticks the checkbox (`create-seed-revealed.check`), then `create-seed-checked.next`.
Notes (appear one by one): TR `Kimseyle paylaşma` · `Ekran görüntüsü alma` · `Kaybedersen paran kurtarılamaz` EN `Never share them` · `Do not screenshot them` · `If you lose them, your funds cannot be recovered` (create.seedWarn1-3).

### s08-verify (9 s) · step 3
Title TR `Yedeğini doğrula` EN `Verify the backup`. Sub TR `Celari kağıttan üç kelimeyi tekrar ister.` EN `Celari asks for three of the words again.` (paraphrase of create.verifyIntro; three fields)
Plates: `create-verify` -> `create-verify-filled`; `s.reveal` the filled plate over each of the three fields left to right with a caret (typing imitation; field boxes are inside `create-verify.form`, find the three inputs visually and use sub-rects of `form`), then the `next` button gets a ring and a click.
Note: TR `Yanlışsa devam edemezsin: kağıdına bak` EN `A wrong word stops you: check your paper` (create.verifyError: "Kelimeler eşleşmedi. Kağıdını kontrol et." / "The words did not match. Check your paper.").

### s09-password (11 s) · step 4
Title TR `Şifre belirle` EN `Set a password`. Sub TR `Şifre cüzdanını bu tarayıcıda kilitler.` EN `The password locks the wallet in this browser.` (password.intro)
Plates: `password` -> `password-filled` -> `home`. Type the password (dots appear via `s.reveal` of the filled plate over `pw1` then `pw2`), the strength bar shows `Güçlü`/`Strong`, click `submit`; the Home plate fades in (balance visible).
Notes: TR `Unutursan kurtarma kelimelerinle yeniden yüklersin` EN `If you forget it, restore from your recovery phrase` (password.intro) · TR `Her harcamada şifren sorulur` EN `Your password is asked on every spend` (landing features[1]).
End on `home` with a ring around `home.total`.

### s10-receive (12 s) · step 5
Title TR `ZEC al` EN `Receive ZEC`. Sub TR `Al ekranı varsayılan olarak yeni, yalnızca gizli bir adres gösterir.` EN `Receive shows a new, shielded-only address by default.`
Plates: `home` -> `receive` -> `receive-transparent` -> `receive-second` (the second is the same screen opened again: a new address). Cursor clicks `home.navReceive`;
ring on `receive.address` and the QR; callout TR `Güvenle paylaşabilirsin: kimse bununla paranı harcayamaz` EN `Safe to share: nobody can spend your money with it` (receive.safeToShare);
click `receive.showTransparent`; callout TR `Sadece birleşik adresi desteklemeyen borsalar için; gelen para herkese açıktır` EN `Only for exchanges that do not support unified addresses; money sent there is public` (receive.transparentHelp, shortened);
click `receive-transparent.showUnified`, then `navHistory` and back to `navReceive` quickly: the address changes (`receive-second`), note TR `Her açışta yeni adres. Eskileri de çalışır.` EN `A new address every time. Earlier ones keep working.` (receive.freshNote).
Make the two different addresses visibly different (the first characters are highlighted gold for a second each).

### s11-send (17 s) · step 6
Title TR `ZEC gönder` EN `Send ZEC`. Sub TR `Adresi ve tutarı gir, istersen şifreli bir not ekle.` EN `Enter an address and an amount, and add an encrypted memo if you like.`
Plates: `send-empty` -> `send-filled` -> `send-confirm` -> `send-confirm-filled` -> `send-proving` -> `send-success`.
Beats: cursor to `to`, the address types in (`s.reveal` of `send-filled` over `to`), then `amount`, then `memo`; the right-hand "Ödeme özeti / Payment summary" appears with a sage `Birleşik · gizli` chip;
ring on `review`, click -> `send-confirm` (ring `amount`, `memo`), type password, click `send` -> `send-proving`: zoom onto `stages`, the four stages tick one after another
(`İşlem hazırlanıyor… İmzalanıyor… Sıfır bilgi kanıtı üretiliyor… Ağa gönderiliyor…`; the plate shows one frame; animate a tick list of your own with the real wording from `send.stage.*` next to it) -> `send-success` (`0,50 ZEC gönderildi`).
Notes: TR `Adres yerine zcash: bağlantısı da yapıştırabilirsin` EN `zcash: payment links are read` (hint only, short) · TR `Not şifrelidir: yalnızca sen ve alıcı okuyabilir` EN `The memo is encrypted: only you and the recipient can read it` (send.memoHelp) ·
TR `Şifrenle onaylayana kadar hiçbir şey gönderilmez` EN `Nothing is sent until you confirm with your password` (send.confirmNote) · TR `Sıfır bilgi kanıtı tarayıcında üretilir` EN `The zero-knowledge proof is generated in your browser` (send.stage.proving; landing flow).

---------------------------------------------------------------------------------------------------------

### s12-shield (11 s) · step 7
Title TR `Gizliye aktar` EN `Shield funds`. Sub TR `Şeffaf bakiye herkese açıktır. Tek tıkla gizli havuza taşı.` EN `A transparent balance is public. Move it to the shielded pool in one click.` (home.transparentHelp, landing features[0])
Plates: `home-after-send` -> `shield-confirm` -> `shield-confirm-filled` -> `shield-success` -> `home-final`.
Beats: ring on `home-after-send.transparent` and the notice (`notice`), click `shieldButton`; the confirm screen: ring `form` (Kaynak: Şeffaf bakiye → Hedef: Gizli bakiye · Ironwood), type password, click `confirm`; success; end on `home-final` where `transparent` shows 0,00 and the bar is all sage.
Notes: TR `Hepsi tek işlemde, Ironwood havuzuna` EN `All of it, in one transaction, into the Ironwood pool` (README) · TR `Ücret bu tutardan düşülür` EN `The fee comes out of that amount` (shield.intro) · TR `Bu işlemde tutar ve şeffaf adres zincirde görünür` EN `In this transaction the amount and the transparent address are visible on chain` (shield.intro; honesty note, copper tone).

### s13-history-settings (17.3 s) · step 8
Title TR `Geçmiş, ayarlar, kilit` EN `History, settings, lock`. Sub TR `Gizliliğini buradan görür ve yönetirsin.` EN `Here you see and manage your privacy.`
Plates: `home` -> `home-hidden` -> `history` -> `settings` -> `settings-privacy` -> `settings-bottom` -> `unlock` (all `desktop`).
Beats: (1) cursor clicks `home.eye` (TR `Bakiyeleri gizle`): amounts turn to dots (`home-hidden`), note TR `Göz düğmesi bakiyeleri ve tutarları gizler` EN `The eye button hides balances and amounts`. (2) click `navHistory`: ring on the three rows' privacy column; callouts for the real labels
TR `Gizli` · `Gizliye aktarıldı · tutar herkese açık` · `Şeffaf · herkese açık` EN `Shielded` · `Shielded · amount public` · `Transparent · public` (history.privacy.*); read what the three rows actually say in the plate and match them.
(3) click `navSettings`: scroll to Privacy/Server: ring `autoLock` (TR `Boşta kalınca kendini kilitler` EN `Locks itself when idle`), `server` (TR `İstersen kendi sunucunu kullan` EN `Use your own server if you like`), `viewingKey` (TR `Görüntüleme anahtarı: harcayamaz, sadece izler` EN `Viewing key: can watch, cannot spend`), `seed` (TR `Kurtarma kelimeleri şifreyle açılır` EN `The recovery phrase opens only with your password`).
(4) click `lock`: `unlock` plate, title TR `Cüzdanın kilitli` stays as the last frame; note TR `Kilitle’ye bas ya da bekle: cüzdan kendiliğinden kilitlenir` EN `Press Lock, or just wait: it locks itself`. The second panel note now reads TR `Her ödeme gizli, kısmen gizli ya da herkese açık diye etiketlenir` EN `Each payment is labelled shielded, partly shielded or public` (the History rows show labels, not reasons).
Plates `settings-privacy` and `settings-bottom` are scrolled screenshots: crossfade or slide between them like a scroll.

---------------------------------------------------------------------------------------------------------

## ACT 3

### s14-phone (7 s) · free-form
TR `Telefonda da aynı cüzdan.` EN `The same wallet on your phone.` sub TR `Geniş ekranda kenar çubuğu, telefonda alt sekmeler.` EN `A sidebar on wide screens, bottom tabs on phones.` (README)
Three phone mockups (`.phone` frame, 390x844 screens from the `phone` plates: `home`, `receive`, `send-filled`) in a gentle staggered arrangement with slow parallax drift; a faint desktop window silhouette behind
them is optional. Only the top 844 px of each plate is shown (that is the viewport). Cursor/tap not needed; one tap ripple on a bottom tab is a nice touch.
Note: TR `Telefonunun tarayıcısında çalışır; uygulama mağazası yok.` is NOT backed by the README: do not write it. Keep to the two claims above.

### s15-closing (10 s) · free-form
Calm landing. The engraved C large and faint; lockup; headline TR `İşini *kendine* saklayan bir Zcash cüzdanı.` EN `A Zcash wallet that keeps your business *your own*.` (landing closing_h);
then three lines as quiet "buttons": `app.celariwallet.com` (gold primary, TR `Cüzdanı aç` / EN `Open the wallet` label) · `celariwallet.com` · `github.com/Kubudak90/Zcash-wallet` (TR `Kaynak kod` / EN `Source`).
Below, a card with a caution icon (`alert`) in the `--warn` sand tone: TR `Erken aşamada ve henüz bağımsız bir güvenlik denetiminden geçmedi. Kaybetmeyi göze alabileceğin tutarlar kullan.`
EN `Early software, not yet independently audited. Use amounts you can afford to lose.` (landing caution) and a second small line: TR `Kurtarma kelimelerin tek yedeğin.` EN `Your recovery phrase is the only backup.`
Last 2.5 s: everything but the lockup and the URL settles; hold. Footer line (small, muted): TR `MIT / Apache-2.0 · ChainSafe WebZjs tabanlı · Electric Coin Company ya da Zcash Foundation ile bağı yoktur.` EN `MIT / Apache-2.0 · Built on ChainSafe’s WebZjs · Not affiliated with the Electric Coin Company or the Zcash Foundation.` (welcome.footer + the website footer's non-affiliation sentence; it comes in at 4.0 s so it can be read).
