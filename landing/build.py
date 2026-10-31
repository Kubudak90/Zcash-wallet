#!/usr/bin/env python3
"""Writes the celariwallet.com landing page, in English (public/index.html) and
Turkish (public/tr/index.html), from the one template and the texts below, so the
two stay the same page. Run it after changing either: python3 landing/build.py

The page has no scripts and loads nothing from another origin (vercel.json's
CSP refuses both). The logo's paths are the wallet's (src/components/Brand.tsx).
Facts on the page come from README.md and docs/engine-port.md; keep them in step.
"""

import html
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
APP = 'https://app.celariwallet.com'
SOURCE = 'https://github.com/Kubudak90/Zcash-wallet'

brand = (ROOT / 'src' / 'components' / 'Brand.tsx').read_text()
WORDMARK = re.search(r"const WORDMARK =\s*'([^']+)'", brand).group(1)
full = re.search(r"full: \{\s*body: '([^']+)',\s*facet: '([^']+)',\s*crop: '([^']+)'", brand)
MARK_BODY, MARK_FACET, MARK_CROP = full.group(1), full.group(2), full.group(3)

TEXT = {
    'en': {
        'lang': 'en',
        'title': 'Celari: a private Zcash wallet in your browser',
        'description': 'Celari is an open-source, privacy-first Zcash wallet that runs in your browser. Shielded by default, keys encrypted on your device. No token, no account.',
        'skip': 'Skip to content',
        'nav': ['Features', 'How it works', 'Before you start'],
        'other_lang': ('Türkçe', '/tr/', 'tr'),
        'open': 'Open the wallet',
        'eyebrow': ['Zcash', 'Ironwood (NU6.3)', 'Ready for NU7'],
        'h1': 'Private money,<br />kept in <em>your</em> browser.',
        'lede': 'Celari is an open-source Zcash wallet that runs entirely in your browser. Payments go to the shielded pool by default, your keys are encrypted on your own device, and there is no account to make. No token, no points, no airdrop promises.',
        'source': 'Read the source',
        'caution': 'Early software, not yet independently audited. Use amounts you can afford to lose.',
        'card_label': 'Shielded balance',
        'card_hidden': 'Hidden',
        'card_tag': 'Shielded · Ironwood',
        'card_addr_label': 'A new address every time you open Receive',
        'card_foot': ['Shielded only', 'Older ones keep working'],
        'features_h': 'Privacy you can check.',
        'features_p': 'Every claim on this page is in the source, and the build that reaches your browser is pinned file by file.',
        'features': [
            ('Shielded by default', 'Receive shows a fresh shielded-only address every time, so payers cannot link their payments through it. Transparent funds are one click from the shielded pool.'),
            ('Keys stay on your device', 'The recovery phrase and the wallet database are stored only encrypted (PBKDF2-SHA256, 600,000 rounds, and AES-256-GCM). The phrase is decrypted to sign and asked for with your password on every spend.'),
            ('Knows the network rules', 'Before every spend and again before every broadcast, Celari asks which consensus rules the network runs. Around an upgrade such as NU7 it pauses instead of sending a transaction the network would reject.'),
            ('Honest labels', 'Each payment says whether it is shielded, partly shielded or public, and why. A payment that crosses from an older pool, and so shows its amount on chain, is never called shielded.'),
            ('Locks itself', 'An idle wallet, or a tab left in the background for a minute, locks. A copied viewing key or recovery phrase is cleared from the clipboard after a minute, as far as the browser allows.'),
            ('Open and reproducible', 'MIT or Apache-2.0. The wallet engine is built from source in CI, and the WebAssembly that ships must match a list of SHA-256 hashes kept in the repository.'),
        ],
        'how_h': 'How it works',
        'how_p': 'A light client in the browser: blocks are downloaded from a lightwalletd server and scanned on your device, in WebAssembly.',
        'stays_h': 'What stays with you',
        'stays': [
            'Your shielded balance, and who pays you in the shielded pool.',
            'Your recovery phrase and spending keys: they never leave the browser.',
            'Your memos: only you and the recipient can read them.',
        ],
        'sees_h': 'What the server sees',
        'sees': [
            'Your IP address, your transparent addresses and the transactions you broadcast.',
            'Which transactions are yours, while History fetches them in full (you can turn that off).',
            'It decides which blocks Celari sees: use a server you trust, or run your own.',
        ],
        'flow': ['Create', 'Sign', 'Prove', 'Broadcast'],
        'flow_note': 'Every payment is a PCZT, proved in your browser.',
        'before_h': 'Before you start',
        'before': [
            ('Not audited yet', 'Celari and the WebZjs engine it is built on have not had an independent security audit. Start with small amounts.'),
            ('Your recovery phrase is the only backup', 'Celari keeps the wallet only in this browser, and browsers can delete site data on their own (Safari after 7 days without a visit, unless Celari is on the Home Screen). Write the 24 words down.'),
            ('Restoring takes time', 'Restoring a wallet scans the chain from the month you give. From January 2025 it took about 50 minutes when measured; a start in the 2022-2023 spam era can take a day and several GB of memory.'),
            ('Some payments are not supported yet', 'TEX addresses (used by some exchanges) need two linked transactions the engine cannot build yet; the form refuses them rather than failing later.'),
        ],
        'closing_h': 'A Zcash wallet that keeps your business your own.',
        'closing_p': 'Create a wallet in a minute, or restore one from its recovery phrase or a viewing key.',
        'footer': 'Celari is open source (MIT or Apache-2.0) and built on ChainSafe’s WebZjs and the Zcash librustzcash crates. Not affiliated with the Electric Coin Company or the Zcash Foundation.',
        'footer_links': [('Source', SOURCE), ('Wallet', APP)],
        'warn_icon': 'Caution',
    },
    'tr': {
        'lang': 'tr',
        'title': 'Celari: tarayıcında gizli bir Zcash cüzdanı',
        'description': 'Celari, tarayıcıda çalışan, açık kaynak ve gizlilik öncelikli bir Zcash cüzdanı. Varsayılan olarak gizli, anahtarlar kendi cihazında şifreli. Token yok, hesap yok.',
        'skip': 'İçeriğe geç',
        'nav': ['Özellikler', 'Nasıl çalışır', 'Başlamadan önce'],
        'other_lang': ('English', '/', 'en'),
        'open': 'Cüzdanı aç',
        'eyebrow': ['Zcash', 'Ironwood (NU6.3)', 'NU7’ye hazır'],
        'h1': 'Gizli para,<br /><em>senin</em> tarayıcında.',
        'lede': 'Celari, tamamen tarayıcında çalışan açık kaynak bir Zcash cüzdanı. Ödemeler varsayılan olarak gizli havuza gider, anahtarların kendi cihazında şifreli durur ve açılacak bir hesap yoktur. Token yok, puan yok, “airdrop gelecek” vaadi yok.',
        'source': 'Kaynak kodu oku',
        'caution': 'Erken aşamada ve henüz bağımsız bir güvenlik denetiminden geçmedi. Kaybetmeyi göze alabileceğin tutarlar kullan.',
        'card_label': 'Gizli bakiye',
        'card_hidden': 'Gizli',
        'card_tag': 'Gizli · Ironwood',
        'card_addr_label': 'Al ekranını her açışında yeni bir adres',
        'card_foot': ['Yalnızca gizli', 'Eskiler çalışmaya devam eder'],
        'features_h': 'Doğrulanabilen gizlilik.',
        'features_p': 'Bu sayfadaki her iddia kaynak kodda; tarayıcına ulaşan derleme de dosya dosya sabitlenmiş.',
        'features': [
            ('Varsayılan olarak gizli', 'Al ekranı her seferinde yeni, yalnızca gizli bir adres gösterir; ödeme yapanlar ödemelerini adres üzerinden birbirine bağlayamaz. Şeffaf bakiye tek tıkla gizli havuza aktarılır.'),
            ('Anahtarlar cihazında kalır', 'Kurtarma kelimeleri ve cüzdan veritabanı yalnızca şifreli saklanır (PBKDF2-SHA256, 600.000 tur ve AES-256-GCM). Kelimeler yalnızca imzalamak için çözülür; her harcamada şifren sorulur.'),
            ('Ağın kurallarını bilir', 'Celari her harcamadan önce ve her yayından hemen önce ağın hangi kurallarla çalıştığını sorar. NU7 gibi bir yükseltmenin çevresinde, ağın reddedeceği bir işlemi göndermek yerine bekler.'),
            ('Dürüst etiketler', 'Her ödeme gizli mi, kısmen gizli mi, herkese açık mı, nedeniyle söyler. Eski bir havuzdan geçip tutarını zincirde gösteren bir ödemeye asla gizli denmez.'),
            ('Kendini kilitler', 'Boşta kalan ya da bir dakika arka planda kalan sekmedeki cüzdan kilitlenir. Kopyalanan görüntüleme anahtarı ve kurtarma kelimeleri, tarayıcının izin verdiği ölçüde bir dakika sonra panodan silinir.'),
            ('Açık ve yeniden üretilebilir', 'MIT ya da Apache-2.0. Cüzdan motoru CI’da kaynaktan derlenir; yayına giren WebAssembly, depoda tutulan SHA-256 listesiyle birebir aynı olmak zorundadır.'),
        ],
        'how_h': 'Nasıl çalışır',
        'how_p': 'Tarayıcıda bir hafif istemci: bloklar bir lightwalletd sunucusundan indirilir ve WebAssembly ile senin cihazında taranır.',
        'stays_h': 'Sende kalanlar',
        'stays': [
            'Gizli bakiyen ve sana gizli havuzda ödeme yapanlar.',
            'Kurtarma kelimelerin ve harcama anahtarların: tarayıcıdan hiç çıkmazlar.',
            'Notların (memo): yalnızca sen ve alıcı okuyabilirsiniz.',
        ],
        'sees_h': 'Sunucunun gördükleri',
        'sees': [
            'IP adresin, şeffaf adreslerin ve yayınladığın işlemler.',
            'Geçmiş işlemlerin tamamını getirdiği sürece hangi işlemlerin senin olduğu (bunu kapatabilirsin).',
            'Celari’nin hangi blokları göreceğine o karar verir: güvendiğin bir sunucu kullan ya da kendininkini çalıştır.',
        ],
        'flow': ['Oluştur', 'İmzala', 'Kanıtla', 'Yayınla'],
        'flow_note': 'Her ödeme tarayıcında kanıtlanan bir PCZT’dir.',
        'before_h': 'Başlamadan önce',
        'before': [
            ('Henüz denetlenmedi', 'Celari ve üzerine kurulduğu WebZjs motoru bağımsız bir güvenlik denetiminden geçmedi. Küçük tutarlarla başla.'),
            ('Tek yedek kurtarma kelimelerin', 'Celari cüzdanı yalnızca bu tarayıcıda tutar ve tarayıcılar site verisini kendiliğinden silebilir (Safari, 7 gün ziyaret edilmezse; Celari Ana Ekran’da değilse). 24 kelimeyi yaz.'),
            ('Geri yükleme zaman alır', 'Geri yükleme zinciri verdiğin aydan itibaren tarar. Ocak 2025’ten başlayan bir geri yükleme ölçümde yaklaşık 50 dakika sürdü; 2022-2023’teki yoğun dönemden bir başlangıç bir gün ve birkaç GB bellek isteyebilir.'),
            ('Bazı ödemeler henüz yok', 'TEX adresleri (bazı borsalar kullanır) motorun henüz kuramadığı, birbirine bağlı iki işlem ister; form bunları sonradan düşmek yerine baştan reddeder.'),
        ],
        'closing_h': 'İşini kendine saklayan bir Zcash cüzdanı.',
        'closing_p': 'Bir dakikada cüzdan oluştur ya da kurtarma kelimelerinden veya bir görüntüleme anahtarından geri yükle.',
        'footer': 'Celari açık kaynaktır (MIT ya da Apache-2.0); ChainSafe’in WebZjs’i ve Zcash’in librustzcash kütüphaneleri üzerine kuruludur. Electric Coin Company ya da Zcash Foundation ile bağı yoktur.',
        'footer_links': [('Kaynak kod', SOURCE), ('Cüzdan', APP)],
        'warn_icon': 'Dikkat',
    },
}

IDS = ['features', 'how', 'before']


def e(s: str) -> str:
    return html.escape(s, quote=True)


def page(t: dict) -> str:
    other_name, other_href, other_code = t['other_lang']
    self_href = '/' if t['lang'] == 'en' else '/tr/'
    nav = '\n'.join(
        f'        <a class="section-link" href="#{i}">{e(name)}</a>' for i, name in zip(IDS, t['nav'])
    )
    eyebrow = ''.join(
        f'<span{" class=\"gold\"" if n == len(t["eyebrow"]) - 1 else ""}>{e(x)}</span>' for n, x in enumerate(t['eyebrow'])
    )
    features = '\n'.join(
        f'''        <article class="feature">
          <span class="num">{n + 1:02d}</span>
          <h3>{e(h)}</h3>
          <p>{e(p)}</p>
        </article>'''
        for n, (h, p) in enumerate(t['features'])
    )
    stays = '\n'.join(f'            <li>{e(x)}</li>' for x in t['stays'])
    sees = '\n'.join(f'            <li>{e(x)}</li>' for x in t['sees'])
    flow = ' <i aria-hidden="true">→</i> '.join(f'<span>{e(x)}</span>' for x in t['flow'])
    before = '\n'.join(
        f'''        <div class="note">
          <h3>{e(h)}</h3>
          <p>{e(p)}</p>
        </div>'''
        for h, p in t['before']
    )
    footer_links = ''.join(f'<a href="{e(href)}">{e(name)}</a>' for name, href in t['footer_links'])
    lockup = f'''<a class="lockup" href="{self_href}" aria-label="Celari">
        <svg class="mark" viewBox="{MARK_CROP}" aria-hidden="true" focusable="false"><path fill="currentColor" d="{MARK_BODY}" /><path class="facet" d="{MARK_FACET}" /></svg>
        <svg class="word" viewBox="0 0 359.11 104.29" aria-hidden="true" focusable="false"><path fill="currentColor" d="{WORDMARK}" /></svg>
      </a>'''
    warn = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" d="M8 1.75 15 14.25H1L8 1.75Z" /><path stroke="currentColor" stroke-width="1.5" stroke-linecap="round" d="M8 6.5v3.5M8 12.1v.1" /></svg>'
    return f'''<!doctype html>
<!-- Written by landing/build.py; edit that, not this file. -->
<html lang="{t['lang']}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="referrer" content="no-referrer" />
    <meta name="color-scheme" content="dark" />
    <meta name="theme-color" content="#0d0c0a" />
    <title>{e(t['title'])}</title>
    <meta name="description" content="{e(t['description'])}" />
    <link rel="canonical" href="https://celariwallet.com{self_href}" />
    <link rel="alternate" hreflang="en" href="https://celariwallet.com/" />
    <link rel="alternate" hreflang="tr" href="https://celariwallet.com/tr/" />
    <link rel="alternate" hreflang="x-default" href="https://celariwallet.com/" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="{e(t['title'])}" />
    <meta property="og:description" content="{e(t['description'])}" />
    <meta property="og:url" content="https://celariwallet.com{self_href}" />
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
    <link rel="icon" type="image/svg+xml" sizes="any" href="/favicon.svg" />
    <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
    <link rel="preload" href="/fonts/fraunces-latin-opsz-normal.woff2" as="font" type="font/woff2" crossorigin />
    <link rel="stylesheet" href="/site.css" />
  </head>
  <body>
    <a class="skip" href="#main">{e(t['skip'])}</a>
    <header class="top">
      <div class="wrap">
      {lockup}
      <nav aria-label="Celari">
{nav}
        <a class="lang" href="{other_href}" hreflang="{other_code}" lang="{other_code}">{e(other_name)}</a>
      </nav>
      <a class="button primary small" href="{APP}">{e(t['open'])}</a>
      </div>
    </header>

    <main id="main">
      <div class="hero">
        <div class="wrap">
          <div>
            <p class="eyebrow">{eyebrow}</p>
            <h1>{t['h1']}</h1>
            <p class="lede">{e(t['lede'])}</p>
            <div class="actions">
              <a class="button primary" href="{APP}">{e(t['open'])}</a>
              <a class="button secondary" href="{SOURCE}">{e(t['source'])}</a>
            </div>
            <p class="caution">{warn}<span><span class="visually-hidden">{e(t['warn_icon'])}: </span>{e(t['caution'])}</span></p>
          </div>
          <div class="card" aria-hidden="true">
            <div class="card-label">{e(t['card_label'])}</div>
            <div class="card-figure">•••• <small>ZEC</small></div>
            <span class="tag">{e(t['card_tag'])}</span>
            <div class="card-label addr-label">{e(t['card_addr_label'])}</div>
            <div class="address">u1q8m4w7…h2x93ka9</div>
            <div class="card-foot"><span>{e(t['card_foot'][0])}</span><span>{e(t['card_foot'][1])}</span></div>
          </div>
        </div>
      </div>

      <section id="features">
        <div class="wrap">
          <div class="section-head">
            <h2>{e(t['features_h'])}</h2>
            <p>{e(t['features_p'])}</p>
          </div>
          <div class="grid">
{features}
          </div>
        </div>
      </section>

      <section id="how">
        <div class="wrap">
          <div class="section-head">
            <h2>{e(t['how_h'])}</h2>
            <p>{e(t['how_p'])}</p>
          </div>
          <div class="split">
            <div class="panel">
              <h3>{e(t['stays_h'])}</h3>
              <ul>
{stays}
              </ul>
            </div>
            <div class="panel sees">
              <h3>{e(t['sees_h'])}</h3>
              <ul>
{sees}
              </ul>
            </div>
          </div>
          <p class="flow">{flow}</p>
          <p class="flow-note">{e(t['flow_note'])}</p>
        </div>
      </section>

      <section id="before">
        <div class="wrap">
          <div class="section-head">
            <h2>{e(t['before_h'])}</h2>
          </div>
          <div class="notes">
{before}
          </div>
        </div>
      </section>

      <section class="closing">
        <div class="wrap">
          <h2>{e(t['closing_h'])}</h2>
          <p>{e(t['closing_p'])}</p>
          <div class="actions">
            <a class="button primary" href="{APP}">{e(t['open'])}</a>
            <a class="button secondary" href="{SOURCE}">{e(t['source'])}</a>
          </div>
        </div>
      </section>
    </main>

    <footer>
      <div class="wrap">
        <p>{e(t['footer'])}</p>
        <nav aria-label="Links">{footer_links}</nav>
      </div>
    </footer>
  </body>
</html>
'''


def main() -> None:
    out = HERE / 'public'
    (out / 'index.html').write_text(page(TEXT['en']))
    (out / 'tr').mkdir(exist_ok=True)
    (out / 'tr' / 'index.html').write_text(page(TEXT['tr']))


if __name__ == '__main__':
    main()
