# Celari

**Zcash için açık kaynak, gizlilik öncelikli tarayıcı cüzdanı.**
Token yok, puan yok, "airdrop gelecek" vaadi yok. Sadece iyi çalışan, gizli bir ZEC cüzdanı.

> *Celare* (Latince): saklamak, gizlemek.

> [!WARNING]
> Celari erken aşamada ve **bağımsız bir güvenlik denetiminden geçmedi**. Üzerine kurulduğu WebZjs kütüphanesi de kendi README'sinde henüz denetlenmediğini belirtiyor. Kaybetmeyi göze alamayacağın miktarlar için kullanma.

[English summary below](#english)

## Özellikler

- **Varsayılan olarak gizli:** Alma ekranı önce birleşik (unified) adresi gösterir; para doğrudan Orchard gizli havuzuna düşer.
- **Tek tıkla gizliye aktarma:** Şeffaf (t-adres) bakiye varsa uyarır ve Orchard'a taşır.
- **Anahtarlar tarayıcıdan çıkmaz:** Kurtarma kelimeleri ve cüzdan veritabanı tarayıcıda yalnızca şifreli durur (PBKDF2-SHA256 600.000 tur + AES-256-GCM).
- **Her harcamada şifre:** Kurtarma kelimeleri sadece imzalama anında çözülür, bellekte tutulmaz.
- **Sadece izleme modu:** Görüntüleme anahtarıyla (UFVK) bakiye ve geçmiş takibi. Harcama yetkisi yoktur, ama anahtarı alan herkes tüm geçmişi ve gelecekteki işlemleri görür; yalnızca tamamen güvendiğin biriyle paylaş.
- **Akıllı başlangıç bloğu:** Geri yüklerken "cüzdanı ne zaman açtın?" sorusundan eşitleme bloğunu hesaplar; bilinmiyorsa şeffaf adresteki ilk işlemi arar.
- **Yazım hatası yakalama:** Adresler gönderimden önce bech32/bech32m/base58check sağlama toplamıyla doğrulanır. Test ağı adresleri reddedilir. `zcash:` ödeme bağlantıları (ZIP-321) okunur.
- **Türkçe ve İngilizce** arayüz, Türkçe ondalık virgül desteği (`0,25`).
- **Kendi sunucunu kullan:** lightwalletd vekil adresi ayarlardan değiştirilebilir.
- Otomatik kilit, kurtarma kelimelerini doğrulama adımı, koyu ve açık tema.

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
- [ ] Gönderimde not (memo) desteği
- [ ] Birden çok hesap, çoklu alıcılı ZIP-321
- [ ] Test ağı modu, kendi lightwalletd vekilini kurma rehberi
- [ ] Çevrimdışı kullanım (PWA)

## Lisans

MIT veya Apache-2.0, tercihine göre. WebZjs © ChainSafe Systems, MIT / Apache-2.0.

---

## English

**Celari** is an open-source, privacy-first browser wallet for Zcash, built on ChainSafe's [WebZjs](https://github.com/ChainSafe/WebZjs). No token, no points, no airdrop promises.

- Shielded (unified/Orchard) address by default; one-click shielding of transparent funds.
- Keys and the wallet database are stored only encrypted (PBKDF2-SHA256 600k + AES-256-GCM); the seed is decrypted only to sign and the password is asked on every spend.
- View-only mode with a UFVK, birthday estimation from a month, checksum-validated addresses, ZIP-321 `zcash:` links.
- Turkish and English UI. Configurable lightwalletd gRPC-web proxy.

**Not audited. Use small amounts only.** See the Turkish sections above for commands: `npm run dev:fake` for UI work, `npm run build:webzjs && npm run build` for a real build. Hosting requires COOP/COEP headers (see `public/_headers`).
