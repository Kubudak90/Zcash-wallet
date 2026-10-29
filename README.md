# Celari

> [!IMPORTANT]
> **Bu sürüm Zcash ağının NU6.3 (Ironwood) kurallarıyla çalışıyor ve NU7'yi biliyor, ama ana ağda gerçek parayla henüz denenmedi.** Ana ağ 28 Temmuz 2026'da, 3.428.143. blokta Ironwood'a geçti; NU7 3.543.405. blokta (Kasım 2026 başı) geliyor. Celari'nin motoru artık librustzcash'in bu yükseltmeleri bilen sürümleriyle derleniyor.
>
> - **Ne denendi, ne denenmedi:** Ana ağda, hiçbir şeye sahip olmayan cüzdanlarla: Ironwood bloklarının taranması (motorun saydığı Ironwood çıktıları sunucunun bildirdiği ağaç boyutlarıyla birebir tuttu), adresler, ağ denetimi ve eski sürümden yükseltme. Ironwood'a para alma, Ironwood'dan ve Orchard'dan harcama, gizliye aktarma ve NU7 sınırı yalnızca yerel testlerde, sahte notlarla denendi. Gerçek parayla deneme yapılana kadar yalnızca kaybetmeyi göze alabileceğin küçük tutarlar kullan.
> - **Güncellemeden sonra tek seferlik yeniden tarama:** Yeni motor eski cüzdan veritabanını okuyamaz. Güncellemeden sonraki ilk kilit açılışında cüzdan kurtarma kelimelerinden (görüntüleme cüzdanında anahtardan) ve başlangıç bloğundan yeniden kurulur ve baştan taranır; eski kayıt, tarama ağın ucuna ulaşana kadar dokunulmadan saklanır. Tarama yalnızca kilit açıkken sürer, her kilitte duraklar ve kilidi açınca kaldığı yerden devam eder; uygulama bunu ekranda söyler. Ölçümde bir aylık aralık (yaklaşık 48.000 blok) 11 dakika kadar sürdü; çok eski bir başlangıç bloğu (özellikle 2022-2023) saatler sürebilir ve tarayıcı sekmesi birkaç GB bellek kullanabilir. Geçmişteki gönderimlerin alıcısı, notu ve ücreti tarama sırasında sunucudan yeniden istenir (Ayarlar > Gizlilik'teki anahtar açıksa; varsayılan açık).
> - **Eski bir başlangıç ayı pahalıdır:** Geri yüklemede seçilen ay yaklaşık 500.000 bloktan fazlasını taramak demekse (güvenlik payıyla ~14 ay) uygulama bunu o adımda söyler; geri yüklemeyi engellemez. Ölçüm, yalnızca motorla (uygulama olmadan): Ocak 2025'ten geri yükleme (784.000 blok) 51 dakika sürdü ve tarayıcı süreci en çok ~1 GB bellek kullandı. 2022-2023'teki yoğun (spam) dönemden bir başlangıç tahminen bir gün kadar sürer ve birkaç GB bellek isteyebilir; bu bellek düzeltmesinden sonra ölçülmedi. Emin olduğun en son ayı seç.
> - **Gönderme ve gizliye aktarma açık.** Ironwood'a gelen ödemeler bakiyede görünür; para üstü ve gizliye aktarılan para Ironwood'a gider. Orchard bakiyesi her zamanki gibi harcanabilir: harcarken para üstü Ironwood'a geçer ve Orchard'dan çıkan tutar zincirde görünür (ZIP 318). Celari henüz Orchard'dan Ironwood'a kademeli, gizli bir geçiş sunmuyor. NU7'nin etkinleşme bloğunda ve ondan önceki son 10 blokta (yaklaşık 14 dakika) işlem hazırlanmaz; o sırada hazırlanmış bir işlem yanlış kurallarla ağa gönderilmez.
> - **Her açılışta yeni adres:** Al ekranı her açılışta yeni, yalnızca gizli bir birleşik adres gösterir (Orchard ve Sapling alıcılı, şeffaf alıcısız; Ironwood'a ödeme Orchard alıcısına yapılır). Daha önce gösterilen adresler çalışmaya devam eder. Şeffaf (`t1…`) adres ayrı gösterilir ve değişmez.
>
> **This release runs on Zcash's NU6.3 (Ironwood) rules and knows NU7, but it has not been tried with real funds on mainnet yet.** Mainnet moved to Ironwood on 28 July 2026 at block 3,428,143; NU7 activates at block 3,543,405 (early November 2026). Celari's engine is now built with the librustzcash releases that implement these upgrades.
>
> - **What was tested, and what was not:** on mainnet, with wallets that own nothing: scanning Ironwood blocks (the engine's count of Ironwood outputs matched the server's tree sizes exactly), addresses, the network check and the upgrade from the previous release. Receiving into Ironwood, spending from Ironwood and Orchard, shielding and the NU7 boundary were tested only locally, with fake notes. Until real-funds tests are done, use only small amounts you can afford to lose.
> - **A one-time rescan after the update:** the new engine cannot read the old wallet database. On the first unlock after the update the wallet is rebuilt from the recovery phrase (a view-only wallet from its key) and its starting block, and rescanned; the old copy is kept untouched until the rescan reaches the network tip. The rescan runs only while the wallet is unlocked, pauses at every lock and continues after the next unlock; the app says so. A month of blocks (about 48,000) took about 11 minutes when measured; a very old starting block (especially 2022-2023) can take hours and several GB of memory in the browser tab. The recipients, memos and fees of past sends are fetched again from the server during the rescan (while the switch under Settings > Privacy is on, the default).
> - **An old starting month is costly:** if the month chosen for a restore means scanning more than about 500,000 blocks (~14 months with the safety margin), the app says so at that step; it does not stop the restore. Measured with the engine alone (without the app): a restore from January 2025 (784,000 blocks) took 51 minutes and the browser process peaked at ~1 GB. A start in the 2022-2023 spam era is estimated at about a day and can need several GB; it was not measured after the memory fix. Choose the latest month you are sure of.
> - **Sending and shielding are on.** Payments received in Ironwood show in the balance; change and shielded funds go to Ironwood. An Orchard balance stays spendable: spending it moves the change into Ironwood, and the amount leaving Orchard is visible on chain (ZIP 318). Celari does not offer a gradual, private Orchard-to-Ironwood migration yet. No transaction is built for the NU7 activation block or the 10 blocks before it (about 14 minutes), and one built just before is not sent under the wrong rules.
> - **A fresh address on every opening:** Receive shows a new shielded-only unified address each time (Orchard and Sapling receivers, no transparent receiver; Ironwood payments go to the Orchard receiver). Addresses shown before keep working. The transparent (`t1…`) address is shown separately and stays the same.

**Zcash için açık kaynak, gizlilik öncelikli tarayıcı cüzdanı.**
Token yok, puan yok, "airdrop gelecek" vaadi yok. Sadece iyi çalışan, gizli bir ZEC cüzdanı.

> *Celare* (Latince): saklamak, gizlemek.

> [!WARNING]
> Celari erken aşamada ve **bağımsız bir güvenlik denetiminden geçmedi**. Üzerine kurulduğu WebZjs kütüphanesi de kendi README'sinde henüz denetlenmediğini belirtiyor. Kaybetmeyi göze alamayacağın miktarlar için kullanma.

[English summary below](#english)

## Özellikler

- **Varsayılan olarak gizli:** Alma ekranı her açılışta yeni, yalnızca gizli bir birleşik (unified) adres gösterir; gönderen cüzdan destekliyorsa para gizli bir havuza, bugün Ironwood'a gider. Eski adresler çalışmaya devam eder; şeffaf adres ayrı durur.
- **Tek tıkla gizliye aktarma:** Şeffaf (t-adres) bakiye varsa uyarır ve gizli bakiyeye, Ironwood'a aktarır.
- **Ağ sürümü denetimi:** Celari ağın hangi kurallarla çalıştığını açılışta ve her eşitlemede sunucuya sorar (lightwalletd `GetLightdInfo`), harcamadan önce ve yayından hemen önce bir kez daha. Motor bu kuralları desteklemiyorsa ya da cevap gelmezse gönderme ve gizliye aktarma kapanır, ekranda nedeni yazar; duyurulmuş ama desteklenmeyen bir sonraki yükseltme de önceden gösterilir.
- **Yükseltme sınırında dikkat:** Motor bir yükseltmenin etkinleşme bloğunda ve ondan önceki son 10 blokta işlem hazırlamaz; ağ yeni kurallara geçtiyse eski kurallarla hazırlanmış bir işlemi hiçbir şey kaydetmeden reddeder.
- **Anahtarlar tarayıcıdan çıkmaz:** Kurtarma kelimeleri ve cüzdan veritabanı tarayıcıda yalnızca şifreli durur (PBKDF2-SHA256 600.000 tur + AES-256-GCM).
- **Her harcamada şifre:** Kurtarma kelimeleri sadece imzalama anında çözülür, bellekte tutulmaz.
- **Sadece izleme modu:** Görüntüleme anahtarıyla (UFVK) bakiye ve geçmiş takibi. Harcama yetkisi yoktur, ama anahtarı alan herkes tüm geçmişi ve gelecekteki işlemleri görür; yalnızca tamamen güvendiğin biriyle paylaş.
- **Akıllı başlangıç bloğu:** Geri yüklerken "cüzdanı ne zaman açtın?" sorusundan eşitleme bloğunu hesaplar; bilinmiyorsa şeffaf adresteki ilk işlemi arar.
- **Yazım hatası yakalama:** Adresler gönderimden önce bech32/bech32m/base58check sağlama toplamıyla doğrulanır. Test ağı adresleri reddedilir. `zcash:` ödeme bağlantıları (ZIP-321) okunur; istedikleri not da doldurulur, ZIP-321'e uymayan bağlantılar tahmin edilmeden reddedilir.
- **Geçmişte gizlilik etiketi:** Her işlem "Gizli", "Kısmen gizli" ya da "Şeffaf · herkese açık" diye işaretlenir (yazıyla ve şekille, yalnızca renkle değil). Etiket, WebZjs'in söylediği gibi yalnızca cüzdanın kendi çıktılarına bakar; havuzu belli olmayan işlem etiketsiz kalır.
- **Şifreli not (memo):** Gizli adreslere giden ödemeye 512 bayta kadar not eklenebilir; yalnızca sen ve alıcı okuyabilir. Şeffaf ve TEX adresleri not alamaz, form bunu söyler.
- **Türkçe ve İngilizce** arayüz, Türkçe ondalık virgül desteği (`0,25`).
- **Kendi sunucunu kullan:** lightwalletd vekil adresi ayarlardan değiştirilebilir.
- **Göz önünde gizlilik:** Ana sayfadaki göz düğmesi bakiye ve geçmiş tutarlarını gizler (tercih kalıcıdır; onay ve sonuç ekranlarında gönderilen tutar her zaman görünür). Kopyalanan görüntüleme anahtarı 60 saniye sonra panodan silinir (tarayıcının izin verdiği ölçüde).
- **Otomatik kilit:** Belirlenen süre işlem yapılmazsa ya da sekme 1 dakika arka planda kalırsa cüzdan kilitlenir; uyku süresi de sayılır. Uzun bir geri yükleme taraması sürerken kilit ekranı hemen gelir, o anki tarama turu (tur yaklaşık 5 dakikada bir biter) kaydedilince sayfa yeniden yüklenir; tarama bir sonraki kilit açılışında devam eder.
- **Motor durursa söyler:** Motorda bir çökme (örneğin bellek yetmemesi) olursa uygulama "Eşitleniyor"da takılı kalmaz; durduğunu söyler ve yeniden yüklemeyi önerir. Yeniden yükleme son kayıttan devam eder.
- Kurtarma kelimelerini doğrulama adımı, koyu ve açık tema, geniş ekranda çerçeveli düzen.

## Nasıl çalışır?

```
Tarayıcı ─────────────────────────────────────────────┐
│  React arayüzü (src/screens)                        │
│      │                                              │
│  WalletController (src/state) ── şifreli IndexedDB  │
│      │                                              │
│  ZcashEngine arayüzü (src/engine/types.ts)          │
│      │                                              │
│  WebZjs (Rust → WebAssembly, çok iş parçacıklı)     │
│    + engine/zcash_client_memory (cüzdan arka ucu)   │
└──────┼──────────────────────────────────────────────┘
       │ gRPC-web
  lightwalletd vekili (varsayılan: zcash-mainnet.chainsafe.dev)
```

- Motor: ChainSafe WebZjs (sabitlenmiş commit) + `patches/webzjs/` altındaki Celari yamaları + `engine/zcash_client_memory` (cüzdanın bellek içi arka ucu, okunabilir kaynak olarak bu depoda; kökeni `UPSTREAM.md`'de), librustzcash'in 2026-10 sürümleriyle (zcash_client_backend 0.25, zcash_protocol 0.11: NU6.2, NU6.3 Ironwood, NU7).
- Bloklar tarayıcıda taranır; sunucu gizli bakiyeni veya kimden para aldığını göremez. **IP adresini ve yayınladığın işlemleri görebilir.** Celari, notlar için ve geri yüklemeden sonra ücret ve alıcı bilgisi için kendi işlemlerinin tamamını da sunucudan ister; bu yüzden **sunucu hangi işlemlerin senin olduğunu anlayabilir.** Bunu Ayarlar > Gizlilik > **Geçmiş için işlemlerin tamamını getir** ile kapatabilirsin (varsayılan açık): o zaman sunucu bunu bu yoldan öğrenmez, ama Geçmiş'te notlar görünmez ve geri yüklemeden sonra geçmiş ödemeler yalnızca net tutarlarıyla görünür; yeniden açınca eksikler getirilir. Gönderdiğin bir ödemenin durumu her iki durumda da onaylanana kadar en fazla 5 dakikada bir sorulur. Daha fazla gizlilik için kendi vekilini çalıştır veya VPN/Tor kullan.
- İşlemler PCZT akışıyla kurulur: *oluştur → imzala (webzjs-keys) → kanıt üret → yayınla*.
- Tohum kelimeler WebZjs'in `generate_seed_phrase` fonksiyonuyla değil, tarayıcının güvenli rastgele sayı üretecini kullanan denetlenmiş `@scure/bip39` ile üretilir. WebZjs kendi belgesinde bu fonksiyonun tarayıcıda güvenli rastgelelik kullanmayabileceğini söylüyor.

## Geliştirme

Gereksinimler: Node 22. WebZjs'i derlemek için ek olarak rustup, curl, clang 17+ ve wasm-pack. Rust araç zinciri (`nightly-2026-10-28`), wasm-bindgen CLI'ı (kilit dosyasındaki sürüm, `cargo install --locked`) ve x86_64 Linux'ta binaryen'in wasm-opt'u (sağlama toplamıyla doğrulanarak) betik tarafından kurulur.

```bash
npm install

# Sahte motorla arayüz geliştirme (wasm veya ağ gerekmez)
npm run dev:fake

# Testler
npm run typecheck
npm test               # birim testleri
npm run test:e2e       # arayüz akışları (Playwright, sahte motor)

# Gerçek motor: WebZjs'i sabitlenmiş commit'ten derle, sonra çalıştır
npm run build:webzjs   # vendor/ klasörüne wasm paketlerini üretir
npm run dev            # http://localhost:5173
npm run build          # dist/
npm run test:e2e:real  # üretim derlemesiyle ana ağda duman testi
```

Sahte motor (`src/engine/fake.ts`) sadece geliştirme sunucusunda `VITE_FAKE_ENGINE=1` ile açılır ve üretim paketine hiç girmez.

`build:webzjs`, sabitlenmiş commit'in üstüne `patches/webzjs/` altındaki yamaları sırayla uygular (tarama ilerlemesi sayaçları, kilit düzeltmesi, not/memo desteği, librustzcash 2026-10 sürümleri ve Ironwood/NU7), `engine/webzjs.Cargo.lock`'u kilit dosyası olarak kopyalar ve `--locked` derler; uygulanamayan bir yama ya da `patches/webzjs/` veya `engine/` altında işlenmemiş bir değişiklik derlemeyi durdurur. Ayrıntılar: [`patches/webzjs/README.md`](patches/webzjs/README.md).

Motorun yerel (wasm olmayan) testleri, depodaki sabit sürümlerle (`--locked`):

```bash
scripts/test-engine-native.sh          # cüzdan arka ucu (engine/zcash_client_memory), ~15 dk
scripts/test-engine-native.sh glue     # webzjs-wallet yapıştırıcısı, build:webzjs'ten sonra
scripts/audit-engine.sh                # RustSec uyarıları, kaynaklar ve lisanslar (cargo-deny)
scripts/gen-licenses.sh                # public/THIRD_PARTY_LICENSES.txt'yi yeniden üretir
```

Motorun tasarım kararları, bilerek yapılmayanlar (açık hatalar), gerçek parayla yapılması gereken denemeler ve derlemenin nasıl yeniden üretildiği: [`docs/engine-port.md`](docs/engine-port.md).

### CI

CI, WebZjs'i kaynaktan derler ve `vendor/` içindeki her dosyanın SHA-256 özetini `scripts/webzjs-vendor.sha256` listesiyle karşılaştırır. `main`'e gönderimler, haftalık çalışma ve `full_rebuild` ile elle başlatılan çalışmalar her zaman kaynaktan derler, liste tutmazsa başarısız olur ve ancak tutunca `vendor/`'u önbelleğe yazar. PR'lar önbellekteki `vendor/`'u aynı listeyle doğrular; tutmazsa kullanmaz, kaynaktan derler. `WEBZJS_COMMIT`'i, `patches/webzjs/` altındaki bir yamayı, `engine/` altındaki bir dosyayı veya bir araç sürümünü değiştiren PR listeyi de güncellemeli: CI yeni listeyi `webzjs-vendor-sha256` artifact'ı olarak yükler (`gh run download <run-id> -n webzjs-vendor-sha256 -D scripts`). Derleme betiği bu makinenin yollarını wasm'dan çıkarır, araçları sabitler, derlemeyi yalnızca izin verilen ortam değişkenleriyle çalıştırır ve çıktıyı değiştirmek için verilmiş ayarları (başka bir araç zinciri, rustc sarmalayıcıları, ek rustflags, `CARGO_INCREMENTAL`, wasm hedefi için C derleyicisi ve wasm-bindgen ayarları, yamalı çalışma alanı dışından cargo yapılandırması) reddeder; x86_64 Ubuntu 24.04'te clang-18 (1:18.1.3-1ubuntu1) ile yapılan yerel derlemenin CI'dakiyle aynı listeyi vermesi amaçlanıyor, ama karar CI'nın: kendi derlemesi listeyle tutmazsa başarısız olur. Ayrıntılar `.github/workflows/ci.yml` içindeki açıklamada.

## Yayınlama

WebZjs, `SharedArrayBuffer` kullandığı için sayfanın **cross-origin isolated** olması gerekir. Sunucunun şu başlıkları göndermesi şart:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

`public/_headers` dosyası Netlify ve Cloudflare Pages için bunu hazır yapar. GitHub Pages özel başlık desteklemediğinden uygun değil. Üretim derlemesine katı bir Content-Security-Policy de eklenir.

## Yol haritası

- [ ] Bağımsız güvenlik denetimi
- [ ] Ledger / Keystone donanım cüzdanı ile imzalama (PCZT akışı buna hazır)
- [ ] Tarayıcı eklentisi (anahtarları sayfadan ayrı süreçte tutmak için)
- [x] NU6.3 (Ironwood) ve NU7 desteği (librustzcash 2026-10 sürümleri)
- [ ] Ironwood ve NU7 ile gerçek parayla ana ağ denemeleri (NU7'den önce ve sonra)
- [ ] Orchard'dan Ironwood'a kademeli, gizli geçiş
- [x] Gönderimde not (memo) desteği
- [ ] Birden çok hesap, çoklu alıcılı ZIP-321
- [ ] Test ağı modu, kendi lightwalletd vekilini kurma rehberi
- [ ] Çevrimdışı kullanım (PWA)

## Lisans

MIT veya Apache-2.0, tercihine göre. WebZjs © ChainSafe Systems, MIT / Apache-2.0. `engine/zcash_client_memory` © Electric Coin Company, MIT / Apache-2.0 (lisans dosyaları ve köken dizinin içinde). Cüzdan motoruna derlenen Rust sandıklarının lisansları ve telif bildirimleri `public/THIRD_PARTY_LICENSES.txt`'de; uygulama bunu `/THIRD_PARTY_LICENSES.txt` adresinde sunar (Ayarlar > Hakkında).

---

## English

**Celari** is an open-source, privacy-first browser wallet for Zcash, built on ChainSafe's [WebZjs](https://github.com/ChainSafe/WebZjs). No token, no points, no airdrop promises.

- Supports NU6.3 (Ironwood) and knows NU7 (see the note at the top: real-funds mainnet tests are still pending; the update rescans the wallet once).
- A fresh shielded-only unified address on every opening of Receive; one-click shielding of transparent funds into Ironwood.
- Network version guard: the app asks the server which consensus rules the network runs (lightwalletd `GetLightdInfo`) at start-up, on every sync and before every broadcast, and keeps sending and shielding off while the engine does not support them or the answer does not come. No transaction is built for an upgrade's activation block or the 10 blocks before it.
- Keys and the wallet database are stored only encrypted (PBKDF2-SHA256 600k + AES-256-GCM); the seed is decrypted only to sign and the password is asked on every spend.
- History rows say whether they were shielded, partly shielded or transparent, judged from the wallet's own outputs only.
- View-only mode with a UFVK, birthday estimation from a month, checksum-validated addresses, ZIP-321 `zcash:` links, encrypted memos to shielded addresses.
- Turkish and English UI. Configurable lightwalletd gRPC-web proxy. The server cannot see shielded balances or senders, but it sees your IP address and what you broadcast, and since Celari fetches its own transactions in full (memos, and fees and recipients after a restore) it can tell which transactions are yours. Settings > Privacy > **Fetch full transactions for History** (on by default) turns that off, at the cost of memos and, after a restore, of past payments showing by their net amount only; the status of a payment you sent is still asked about, at most every 5 minutes, until it confirms. Run your own proxy or use a VPN/Tor for more privacy.

The engine is ChainSafe WebZjs at a pinned commit, Celari's patches in `patches/webzjs/`, and the wallet backend as readable source in `engine/zcash_client_memory` (origin and licence in its `UPSTREAM.md`), built with the October 2026 librustzcash releases (zcash_client_backend 0.25, zcash_protocol 0.11).

**Not audited. Use small amounts only.** See the Turkish sections above for commands: `npm run dev:fake` for UI work, `npm run build:webzjs && npm run build` for a real build. Hosting requires COOP/COEP headers (see `public/_headers`). CI pins the WebZjs build output by SHA-256 in `scripts/webzjs-vendor.sha256`; changing the WebZjs commit, its patches, `engine/` or a tool version needs a new list, which CI uploads as the `webzjs-vendor-sha256` artifact (see `.github/workflows/ci.yml`). The build script trims machine paths, pins its tools, runs the build with an environment of its own (an allow-list) and refuses anything meant to change the output (another toolchain, rustc wrappers, extra rustflags, `CARGO_INCREMENTAL`, C compiler and wasm-bindgen settings for the wasm target, cargo configuration from outside the patched workspace); a local build on x86_64 Ubuntu 24.04 with clang-18 is meant to reproduce CI's list and says whether it does, but CI's own build decides. The engine's native tests run with `scripts/test-engine-native.sh` (backend) and `scripts/test-engine-native.sh glue`, its dependency audit with `scripts/audit-engine.sh` (cargo-deny, also in CI); the licence notices of the crates in the wasm are in `public/THIRD_PARTY_LICENSES.txt`, served by the app and linked from Settings > About. The engine's design record, its known gaps and the real-funds checklist: [`docs/engine-port.md`](docs/engine-port.md).
