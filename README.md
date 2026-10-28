# Celari

> [!CAUTION]
> **Bu sürüm Zcash ağının NU6.3 (Ironwood) yükseltmesini desteklemiyor.** Ana ağ 28 Temmuz 2026'da, 3.428.143. blokta Ironwood kurallarına geçti; Celari'nin içindeki WebZjs motoru NU6.1'de kaldı. Sıradaki yükseltme NU7 (3.543.405. blok, Kasım 2026 başı) de bu sürümde desteklenmiyor.
>
> - **Gönderme ve gizliye aktarma kapalı.** Ağ, bu sürümün hazırladığı her işlemi reddeder. Celari ağın kurallarını açılışta ve her eşitlemede sunucuya sorar; motor desteklemiyorsa ya da cevap gelmezse hiçbir işlemi ağa göndermez ve nedenini ekranda söyler.
> - **Birleşik (unified) adresine gelen gizli ödemeler motor güncellenene kadar görünmez.** Güncel cüzdanların bu adrese gönderdiği para yeni Ironwood havuzuna düşer; bu sürüm o havuzu göremez. **Para kaybolmaz**, güncellemeden sonra görünür; gönderenden tekrar ödeme isteme. Şeffaf (`t1…`) adrese gelen ödemeler bugün de görünür.
> - **Paranı şimdi kullanman gerekiyorsa:** kurtarma kelimelerini Ironwood destekleyen bir cüzdana (örneğin Zodl 3.8.0 ve üzeri) geri yükle; başlangıç olarak cüzdanı ilk kullandığın tarihi ya da biraz öncesini ver. O cüzdan Ironwood'a gelen ödemeleri gösterir ve Orchard'daki gizli bakiyeni Ironwood'a taşıyabilir. Kelimeler aynı cüzdanı açar; Celari'deki kopya şifreli ve güvende kalır, ama oradan Ironwood'a taşıdığın para da bu Celari sürümünde görünmez.
>
> **This release does not support Zcash's NU6.3 (Ironwood) network upgrade.** Mainnet moved to Ironwood on 28 July 2026 at block 3,428,143, and the WebZjs engine inside Celari stops at NU6.1. The next upgrade, NU7 (block 3,543,405, early November 2026), is not supported either.
>
> - **Sending and shielding are disabled.** The network rejects every transaction this release builds. Celari asks the server which rules the network runs at start-up and on every sync; if the engine does not support them, or no answer comes, nothing is broadcast and the app says why.
> - **Shielded payments to your unified address do not show until the engine is updated.** Up-to-date wallets paying that address put the funds in the new Ironwood pool, which this release cannot see. **The funds are not lost** and will show after the update; do not ask the sender to pay again. Payments to your transparent (`t1…`) address still show.
> - **If you need your funds now:** restore your recovery phrase in a wallet that supports Ironwood (for example Zodl 3.8.0 or later), giving the date you first used the wallet, or a little earlier, as its start. That wallet shows payments received in Ironwood and can move your Orchard balance to Ironwood. The phrase opens the same wallet; the copy in Celari stays encrypted and safe, but funds you move to Ironwood there will not show in this release of Celari either.

**Zcash için açık kaynak, gizlilik öncelikli tarayıcı cüzdanı.**
Token yok, puan yok, "airdrop gelecek" vaadi yok. Sadece iyi çalışan, gizli bir ZEC cüzdanı.

> *Celare* (Latince): saklamak, gizlemek.

> [!WARNING]
> Celari erken aşamada ve **bağımsız bir güvenlik denetiminden geçmedi**. Üzerine kurulduğu WebZjs kütüphanesi de kendi README'sinde henüz denetlenmediğini belirtiyor. Kaybetmeyi göze alamayacağın miktarlar için kullanma.

[English summary below](#english)

## Özellikler

- **Varsayılan olarak gizli:** Alma ekranı önce birleşik (unified) adresi gösterir; gönderen cüzdan destekliyorsa para gizli bir havuza gider. Ironwood'dan beri güncel cüzdanlar için bu havuz Ironwood ve bu sürüm onu henüz göremez (yukarıdaki uyarı); ekran bunu adresin üstünde söyler.
- **Tek tıkla gizliye aktarma:** Şeffaf (t-adres) bakiye varsa uyarır ve gizli bakiyeye aktarır. Bu sürümde kapalı: Ironwood'dan beri ağ Orchard'a yeni para almıyor ve motor Ironwood'a aktaramıyor.
- **Ağ sürümü denetimi:** Celari ağın hangi kurallarla çalıştığını açılışta ve her eşitlemede sunucuya sorar (lightwalletd `GetLightdInfo`), harcamadan önce ve yayından hemen önce bir kez daha. Motor bu kuralları desteklemiyorsa ya da cevap gelmezse gönderme ve gizliye aktarma kapanır, ekranda nedeni yazar; duyurulmuş ama desteklenmeyen bir sonraki yükseltme de önceden gösterilir.
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
- **Otomatik kilit:** Belirlenen süre işlem yapılmazsa ya da sekme 1 dakika arka planda kalırsa cüzdan kilitlenir; uyku süresi de sayılır. Uzun bir geri yükleme taraması sürerken kilit ekranı hemen gelir, tarama bitip kaydedilince sayfa yeniden yüklenir.
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
└──────┼──────────────────────────────────────────────┘
       │ gRPC-web
  lightwalletd vekili (varsayılan: zcash-mainnet.chainsafe.dev)
```

- Bloklar tarayıcıda taranır; sunucu gizli bakiyeni veya kimden para aldığını göremez. **IP adresini ve yayınladığın işlemleri görebilir.** Daha fazla gizlilik için kendi vekilini çalıştır veya VPN/Tor kullan.
- İşlemler PCZT akışıyla kurulur: *oluştur → imzala (webzjs-keys) → kanıt üret → yayınla*.
- Tohum kelimeler WebZjs'in `generate_seed_phrase` fonksiyonuyla değil, tarayıcının güvenli rastgele sayı üretecini kullanan denetlenmiş `@scure/bip39` ile üretilir. WebZjs kendi belgesinde bu fonksiyonun tarayıcıda güvenli rastgelelik kullanmayabileceğini söylüyor.

## Geliştirme

Gereksinimler: Node 22. WebZjs'i derlemek için ek olarak rustup, clang 17+ ve wasm-pack.

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

`build:webzjs`, sabitlenmiş commit'in üstüne `patches/webzjs/` altındaki yamaları sırayla uygular (tarama ilerlemesi sayaçları, kilit düzeltmesi, not/memo desteği); uygulanamayan bir yama derlemeyi durdurur. Ayrıntılar: [`patches/webzjs/README.md`](patches/webzjs/README.md).

### CI

CI, WebZjs'i kaynaktan derler ve `vendor/` içindeki her dosyanın SHA-256 özetini `scripts/webzjs-vendor.sha256` listesiyle karşılaştırır. `main`'e gönderimler, haftalık çalışma ve `full_rebuild` ile elle başlatılan çalışmalar her zaman kaynaktan derler, liste tutmazsa başarısız olur ve ancak tutunca `vendor/`'u önbelleğe yazar. PR'lar önbellekteki `vendor/`'u aynı listeyle doğrular; tutmazsa kullanmaz, kaynaktan derler. `WEBZJS_COMMIT`'i, `patches/webzjs/` altındaki bir yamayı veya wasm-pack sürümünü değiştiren PR listeyi de güncellemeli: CI yeni listeyi `webzjs-vendor-sha256` artifact'ı olarak yükler (`gh run download <run-id> -n webzjs-vendor-sha256 -D scripts`). Listeyi yerelde üretme; derleme cargo yollarını wasm'a gömdüğü için yerel çıktı CI'dakinden farklıdır. Ayrıntılar `.github/workflows/ci.yml` içindeki açıklamada.

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
- [ ] NU6.3 (Ironwood) ve NU7 desteği: güncel bir WebZjs/librustzcash, Orchard'dan Ironwood'a taşıma
- [x] Gönderimde not (memo) desteği
- [ ] Birden çok hesap, çoklu alıcılı ZIP-321
- [ ] Test ağı modu, kendi lightwalletd vekilini kurma rehberi
- [ ] Çevrimdışı kullanım (PWA)

## Lisans

MIT veya Apache-2.0, tercihine göre. WebZjs © ChainSafe Systems, MIT / Apache-2.0.

---

## English

**Celari** is an open-source, privacy-first browser wallet for Zcash, built on ChainSafe's [WebZjs](https://github.com/ChainSafe/WebZjs). No token, no points, no airdrop promises.

- Unified (shielded) address by default; one-click shielding of transparent funds. Both are limited in this release: shielding is disabled, and shielded payments that arrive through the Ironwood pool do not show yet (see the warning at the top).
- Network version guard: the app asks the server which consensus rules the network runs (lightwalletd `GetLightdInfo`) at start-up, on every sync and before every broadcast, and keeps sending and shielding off while the engine does not support them or the answer does not come.
- Keys and the wallet database are stored only encrypted (PBKDF2-SHA256 600k + AES-256-GCM); the seed is decrypted only to sign and the password is asked on every spend.
- History rows say whether they were shielded, partly shielded or transparent, judged from the wallet's own outputs only.
- View-only mode with a UFVK, birthday estimation from a month, checksum-validated addresses, ZIP-321 `zcash:` links, encrypted memos to shielded addresses.
- Turkish and English UI. Configurable lightwalletd gRPC-web proxy.

**Not audited. Use small amounts only.** See the Turkish sections above for commands: `npm run dev:fake` for UI work, `npm run build:webzjs && npm run build` for a real build. Hosting requires COOP/COEP headers (see `public/_headers`). CI pins the WebZjs build output by SHA-256 in `scripts/webzjs-vendor.sha256`; changing the WebZjs commit, its patches or wasm-pack needs a new list, which CI uploads as the `webzjs-vendor-sha256` artifact (see `.github/workflows/ci.yml`).
