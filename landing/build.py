#!/usr/bin/env python3
"""Writes the celariwallet.com landing page, in English (public/index.html) and
Turkish (public/tr/index.html), from the one template and the texts below, so the
two stay the same page. Run it after changing either: python3 landing/build.py

The page has no scripts and loads nothing from another origin (vercel.json's
CSP refuses both, and inline style attributes and <style> blocks too): every
animation is CSS in site.css, and stops for prefers-reduced-motion. The look is
the wallet's own (src/styles.css, src/styles/account.css): its light and dark
tokens, its fonts and its engraved "C" (EngravedC in src/screens/AccountLayout.tsx,
redrawn below from the same numbers). The logo's paths are read from
src/components/Brand.tsx, the icons copied from src/components/icons.tsx.
Facts on the page come from README.md and docs/engine-port.md; keep them in step.
"""

import html
import math
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
small = re.search(r"'16': \{\s*body: '([^']+)',(?:\s*//[^\n]*)*\s*facet: '([^']+)'", brand)
SILHOUETTE, SMALL_FACET = small.group(1), small.group(2)

# --- The engraved C --------------------------------------------------------
# The wallet's EngravedC (src/screens/AccountLayout.tsx), the same construction:
# the logo's hexagonal C as fine lines, its silhouette filled with lines that
# follow the outer edge inwards, echoed outside by wider, fading hexagons open
# to the right like its mouth. Worked out in the logo's 64 box and shown in a
# 1200 box, 4 px to a unit, the hexagon's centre at (600, 600). The echoes are
# written in the 1200 box itself, so CSS can scale each one about that centre.

O = (33.1545, 32.0)
SN, CS = math.sin(math.radians(32)), math.cos(math.radians(32))
N = [(SN, -CS), (-SN, -CS), (-1.0, 0.0), (-SN, CS), (SN, CS), (1.0, 0.0)]
P = [25.252, 25.252, 25.1545, 25.252, 25.252, 25.1545]
R = [13.41, 4.866, 4.866, 13.41]
CUT_AT = (44.225, 28.373)
CUT_DIR = (10.39, -9.031)
PLACE = f'translate(600 600) scale(4) translate({-O[0]} {-O[1]})'


def meet(a, da, b, db):
    det = a[0] * b[1] - a[1] * b[0]
    return ((da * b[1] - db * a[1]) / det, (a[0] * db - b[0] * da) / det)


def add(p, n, k):
    return (p[0] + n[0] * k, p[1] + n[1] * k)


def num(n: float) -> str:
    return f'{n:.2f}'.rstrip('0').rstrip('.')


def at(p, box: bool) -> str:
    """A point relative to O, in the 64 box or (box=True) the 1200 one."""
    if box:
        return f'{num(600 + 4 * p[0])} {num(600 + 4 * p[1])}'
    return f'{num(O[0] + p[0])} {num(O[1] + p[1])}'


def on_cut(i, d, below):
    q = (CUT_AT[0] - O[0], O[1] - CUT_AT[1] if below else CUT_AT[1] - O[1])
    w = (CUT_DIR[0], -CUT_DIR[1] if below else CUT_DIR[1])
    n = N[i]
    t = (d - (n[0] * q[0] + n[1] * q[1])) / (n[0] * w[0] + n[1] * w[1])
    return add(q, w, t)


def contour(dist, radii, start, end, box):
    k = 4 if box else 1
    d = f'M{at(start, box)}'
    for i in range(4):
        r = radii[i]
        a, b = N[i], N[i + 1]
        c = meet(a, dist[i] - r, b, dist[i + 1] - r)
        d += f'L{at(add(c, a, r), box)}A{num(r * k)} {num(r * k)} 0 0 0 {at(add(c, b, r), box)}'
    return d + f'L{at(end, box)}'


def inset(s):
    dist = [p - s for p in P]
    radii = [max(r - s, 0.6) for r in R]
    return contour(dist, radii, meet(N[5], dist[5], N[0], dist[0]), meet(N[4], dist[4], N[5], dist[5]), False)


def echo(k):
    dist = [p * k for p in P]
    return contour(dist, [r * k for r in R], on_cut(0, dist[0], False), on_cut(4, dist[4], True), True)


BAND = [(inset(2 + i * 2), 0.3 - i * 0.018) for i in range(9)]
ECHOES = []
# The pulse of light: the echo 128 px out (in the 1200 box) from the letter, which CSS scales.
PULSE = echo((P[0] + 128 / 4) / P[0])
for i in range(20):
    gap = (26 + i * 24 + i * i * 0.6) / 4
    ECHOES.append((echo((P[0] + gap) / P[0]), 0.14 * 0.87**i))


# Lines stay one device pixel wide whatever size the motif is drawn at (not inherited: on every path).
NSS = ' vector-effect="non-scaling-stroke"'


def engraved(cls: str) -> str:
    """The motif, decorative, in layers that move without being drawn again.

    The lines (painted once; echo i has class i{i}, which site.css staggers their
    entrance by); two pulses of gold light shaped like an echo, which site.css only
    scales and fades, so the browser moves them without repainting; and the facet
    lit up, which it only fades.
    """
    band = ''.join(f'<path d="{d}" stroke-opacity="{o:.3f}"{NSS} />' for d, o in BAND)
    echoes = ''.join(f'<path class="i{i}" d="{d}" stroke-opacity="{o:.3f}"{NSS} />' for i, (d, o) in enumerate(ECHOES))
    svg = 'viewBox="0 0 1200 1200" aria-hidden="true" focusable="false"'
    lines = 'fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1"'
    pulse = PULSE
    return f'''<div class="{cls}" aria-hidden="true">
        <svg class="engraved" {svg}>
          <defs><clipPath id="engraved-clip" clipPathUnits="userSpaceOnUse"><path d="{SILHOUETTE}" /></clipPath></defs>
          <g {lines}>
            <g class="echoes">{echoes}</g>
            <g class="letter" transform="{PLACE}">
              <path d="{SILHOUETTE}" stroke-opacity="0.34" stroke-width="1.25"{NSS} />
              <g clip-path="url(#engraved-clip)">{band}</g>
            </g>
          </g>
          <g transform="{PLACE}"><path class="engraved-facet" d="{SMALL_FACET}" stroke-width="1" stroke-linejoin="round"{NSS} /></g>
        </svg>
        <svg class="engraved pulse p0" {svg}><path d="{pulse}" /></svg>
        <svg class="engraved pulse p1" {svg}><path d="{pulse}" /></svg>
        <svg class="engraved glint" {svg}><g transform="{PLACE}"><path d="{SMALL_FACET}" /></g></svg>
      </div>'''


# --- Icons (src/components/icons.tsx): 24 grid, 1.5 stroke, currentColor ------

ICONS = {
    'shield': '<path d="M12 3.75 18.5 6v5.25c0 4.1-2.7 7.3-6.5 8.9-3.8-1.6-6.5-4.8-6.5-8.9V6Z" /><path d="m9.25 11.75 2 2 3.5-3.75" />',
    'lock': '<rect x="5" y="10.5" width="14" height="9.5" rx="2.25" /><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" /><path d="M12 14.25v2" />',
    'sync': '<path d="M19.25 12A7.25 7.25 0 0 1 6.4 16.6M4.75 12A7.25 7.25 0 0 1 17.6 7.4" /><path d="M18 3.75v3.9h-3.9M6 20.25v-3.9h3.9" />',
    'eye': '<path d="M2.75 12C4.6 8.2 8 6 12 6s7.4 2.2 9.25 6C19.4 15.8 16 18 12 18s-7.4-2.2-9.25-6Z" /><circle cx="12" cy="12" r="2.75" />',
    'clock': '<circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" />',
    'code': '<path d="m8.5 8-4 4 4 4M15.5 8l4 4-4 4M13.25 5.5l-2.5 13" />',
    'server': '<rect x="4" y="4.5" width="16" height="6" rx="1.75" /><rect x="4" y="13.5" width="16" height="6" rx="1.75" /><path d="M7.75 7.5h.5M7.75 16.5h.5" />',
    'globe': '<circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.25 2.4 3.4 5.25 3.4 8.5s-1.15 6.1-3.4 8.5c-2.25-2.4-3.4-5.25-3.4-8.5S9.75 5.9 12 3.5Z" />',
    'alert': '<path d="M10.7 4.75a1.5 1.5 0 0 1 2.6 0l7.1 12.5a1.5 1.5 0 0 1-1.3 2.25H4.9a1.5 1.5 0 0 1-1.3-2.25Z" /><path d="M12 9.75v3.75" /><circle cx="12" cy="16.4" r=".9" fill="currentColor" stroke="none" />',
    'arrowRight': '<path d="M5 12h14M13.5 6.5 19 12l-5.5 5.5" />',
    'check': '<path d="m5 12.5 4.25 4.25L19 7" />',
    'key': '<circle cx="8" cy="15.5" r="3.75" /><path d="m10.75 12.75 8.25-8.25M16 7.5l2.5 2.5M13.75 9.75l2 2" />',
}


def icon(name: str, cls: str = 'icon') -> str:
    return (
        f'<svg class="{cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" '
        f'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">{ICONS[name]}</svg>'
    )


TEXT = {
    'en': {
        'lang': 'en',
        'title': 'Celari: a private Zcash wallet in your browser',
        'description': 'Celari is an open-source, privacy-first Zcash wallet that runs in your browser. Shielded by default, keys encrypted on your device. No token, no account.',
        'skip': 'Skip to content',
        'nav': ['Features', 'How it works', 'Before you start'],
        'other_lang': ('Türkçe', '/tr/', 'tr'),
        'open': 'Open the wallet',
        'eyebrow': 'Zcash wallet',
        'badges': ['Ironwood (NU6.3)', 'Ready for NU7'],
        'h1': ['Private money,', 'kept in <em>your</em> browser.'],
        'lede': 'Celari is an open-source Zcash wallet that runs entirely in your browser. Payments go to the shielded pool by default, your keys are encrypted on your own device, and there is no account to make. No token, no points, no airdrop promises.',
        'source': 'Read the source',
        'caution': 'Early software, not yet independently audited. Use amounts you can afford to lose.',
        'card_label': 'Total balance',
        'card_hide': 'Hide balances',
        'card_shielded': 'Shielded',
        'card_transparent': 'Transparent',
        'card_done': 'All shielded',
        'card_addr_label': 'A new address every time you open Receive',
        'card_foot': ['Shielded only', 'Older ones keep working'],
        'chips': ['Keys stay on this device', 'Proved in your browser'],
        'ticker': ['Shielded by default', 'PBKDF2-SHA256 · 600,000 rounds', 'AES-256-GCM', 'Ironwood (NU6.3)', 'Ready for NU7', 'PCZT', 'WebAssembly', 'lightwalletd', 'MIT / Apache-2.0', 'No token', 'No account', 'No airdrop'],
        'stats_label': 'Celari in numbers',
        'stats': [
            ('600', ',000', '600,000', 'PBKDF2-SHA256 rounds between your password and your keys'),
            ('24', '', '24', 'words in your recovery phrase, the only backup'),
            ('256', '', '256', 'bit AES-GCM on the phrase and the wallet database'),
            ('0', '', '0', 'scripts on this page: its security policy refuses them'),
        ],
        'features_eyebrow': 'Why Celari',
        'features_h': 'Privacy you can check.',
        'features_p': 'Every claim on this page is in the source, and the build that reaches your browser is pinned file by file.',
        'features': [
            ('shield', 'Shielded by default', 'Receive shows a fresh shielded-only address every time, so payers cannot link their payments through it. Transparent funds are one click from the shielded pool.'),
            ('lock', 'Keys stay on your device', 'The recovery phrase and the wallet database are stored only encrypted (PBKDF2-SHA256, 600,000 rounds, and AES-256-GCM). The phrase is decrypted to sign and asked for with your password on every spend.'),
            ('sync', 'Knows the network rules', 'Before every spend and again before every broadcast, Celari asks which consensus rules the network runs. Around an upgrade such as NU7 it pauses instead of sending a transaction the network would reject.'),
            ('eye', 'Honest labels', 'Each payment says whether it is shielded, partly shielded or public, and why. A payment that crosses from an older pool, and so shows its amount on chain, is never called shielded.'),
            ('clock', 'Locks itself', 'An idle wallet, or a tab left in the background for a minute, locks. A copied viewing key or recovery phrase is cleared from the clipboard after a minute, as far as the browser allows.'),
            ('code', 'Open and reproducible', 'MIT or Apache-2.0. The wallet engine is built from source in CI, and the WebAssembly that ships must match a list of SHA-256 hashes kept in the repository.'),
        ],
        'how_eyebrow': 'Under the hood',
        'how_h': 'How it works',
        'how_p': 'A light client in the browser: blocks are downloaded from a lightwalletd server and scanned on your device, in WebAssembly.',
        'diagram_label': 'Blocks travel from a lightwalletd server to your browser, which scans them itself.',
        'diagram': [('lightwalletd', 'Sends compact blocks'), ('Compact blocks', ''), ('Your browser', 'Scans them in WebAssembly')],
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
        'flow_h': 'The life of a payment',
        'flow': [('Create', 'A PCZT from your notes'), ('Sign', 'With your password'), ('Prove', 'In your browser'), ('Broadcast', 'Through your server')],
        'flow_note': 'Every payment is a PCZT, proved in your browser.',
        'before_eyebrow': 'Read this first',
        'before_h': 'Before you start',
        'before': [
            ('Not audited yet', 'Celari and the WebZjs engine it is built on have not had an independent security audit. Start with small amounts.'),
            ('Your recovery phrase is the only backup', 'Celari keeps the wallet only in this browser, and browsers can delete site data on their own (Safari after 7 days without a visit, unless Celari is on the Home Screen). Write the 24 words down.'),
            ('Restoring takes time', 'Restoring a wallet scans the chain from the month you give. From January 2025 it took about 50 minutes when measured; a start in the 2022-2023 spam era can take a day and several GB of memory.'),
            ('Some payments are not supported yet', 'TEX addresses (used by some exchanges) need two linked transactions the engine cannot build yet; the form refuses them rather than failing later.'),
        ],
        'closing_eyebrow': 'Ready when you are',
        'closing_h': 'A Zcash wallet that keeps your business <em>your own</em>.',
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
        'eyebrow': 'Zcash cüzdanı',
        'badges': ['Ironwood (NU6.3)', 'NU7’ye hazır'],
        'h1': ['Gizli para,', '<em>senin</em> tarayıcında.'],
        'lede': 'Celari, tamamen tarayıcında çalışan açık kaynak bir Zcash cüzdanı. Ödemeler varsayılan olarak gizli havuza gider, anahtarların kendi cihazında şifreli durur ve açılacak bir hesap yoktur. Token yok, puan yok, “airdrop gelecek” vaadi yok.',
        'source': 'Kaynak kodu oku',
        'caution': 'Erken aşamada ve henüz bağımsız bir güvenlik denetiminden geçmedi. Kaybetmeyi göze alabileceğin tutarlar kullan.',
        'card_label': 'Toplam bakiye',
        'card_hide': 'Bakiyeleri gizle',
        'card_shielded': 'Gizli',
        'card_transparent': 'Şeffaf',
        'card_done': 'Hepsi gizli',
        'card_addr_label': 'Al ekranını her açışında yeni bir adres',
        'card_foot': ['Yalnızca gizli', 'Eskiler çalışmaya devam eder'],
        'chips': ['Anahtarlar bu cihazda kalır', 'Tarayıcında kanıtlanır'],
        'ticker': ['Varsayılan olarak gizli', 'PBKDF2-SHA256 · 600.000 tur', 'AES-256-GCM', 'Ironwood (NU6.3)', 'NU7’ye hazır', 'PCZT', 'WebAssembly', 'lightwalletd', 'MIT / Apache-2.0', 'Token yok', 'Hesap yok', 'Airdrop yok'],
        'stats_label': 'Rakamlarla Celari',
        'stats': [
            ('600', '.000', '600.000', 'PBKDF2-SHA256 turu: şifrenle anahtarların arasında'),
            ('24', '', '24', 'kelime: kurtarma ifaden, tek yedeğin'),
            ('256', '', '256', 'bit AES-GCM: kelimelerin ve cüzdan veritabanın üzerinde'),
            ('0', '', '0', 'script bu sayfada: güvenlik politikası hepsini reddeder'),
        ],
        'features_eyebrow': 'Neden Celari',
        'features_h': 'Doğrulanabilen gizlilik.',
        'features_p': 'Bu sayfadaki her iddia kaynak kodda; tarayıcına ulaşan derleme de dosya dosya sabitlenmiş.',
        'features': [
            ('shield', 'Varsayılan olarak gizli', 'Al ekranı her seferinde yeni, yalnızca gizli bir adres gösterir; ödeme yapanlar ödemelerini adres üzerinden birbirine bağlayamaz. Şeffaf bakiye tek tıkla gizli havuza aktarılır.'),
            ('lock', 'Anahtarlar cihazında kalır', 'Kurtarma kelimeleri ve cüzdan veritabanı yalnızca şifreli saklanır (PBKDF2-SHA256, 600.000 tur ve AES-256-GCM). Kelimeler yalnızca imzalamak için çözülür; her harcamada şifren sorulur.'),
            ('sync', 'Ağın kurallarını bilir', 'Celari her harcamadan önce ve her yayından hemen önce ağın hangi kurallarla çalıştığını sorar. NU7 gibi bir yükseltmenin çevresinde, ağın reddedeceği bir işlemi göndermek yerine bekler.'),
            ('eye', 'Dürüst etiketler', 'Her ödeme gizli mi, kısmen gizli mi, herkese açık mı, nedeniyle söyler. Eski bir havuzdan geçip tutarını zincirde gösteren bir ödemeye asla gizli denmez.'),
            ('clock', 'Kendini kilitler', 'Boşta kalan ya da bir dakika arka planda kalan sekmedeki cüzdan kilitlenir. Kopyalanan görüntüleme anahtarı ve kurtarma kelimeleri, tarayıcının izin verdiği ölçüde bir dakika sonra panodan silinir.'),
            ('code', 'Açık ve yeniden üretilebilir', 'MIT ya da Apache-2.0. Cüzdan motoru CI’da kaynaktan derlenir; yayına giren WebAssembly, depoda tutulan SHA-256 listesiyle birebir aynı olmak zorundadır.'),
        ],
        'how_eyebrow': 'Kaputun altında',
        'how_h': 'Nasıl çalışır',
        'how_p': 'Tarayıcıda bir hafif istemci: bloklar bir lightwalletd sunucusundan indirilir ve WebAssembly ile senin cihazında taranır.',
        'diagram_label': 'Bloklar bir lightwalletd sunucusundan tarayıcına gelir; onları tarayıcın kendisi tarar.',
        'diagram': [('lightwalletd', 'Kompakt blokları gönderir'), ('Kompakt bloklar', ''), ('Senin tarayıcın', 'WebAssembly ile tarar')],
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
        'flow_h': 'Bir ödemenin yolculuğu',
        'flow': [('Oluştur', 'Notlarından bir PCZT'), ('İmzala', 'Şifrenle'), ('Kanıtla', 'Tarayıcında'), ('Yayınla', 'Sunucun üzerinden')],
        'flow_note': 'Her ödeme tarayıcında kanıtlanan bir PCZT’dir.',
        'before_eyebrow': 'Önce bunu oku',
        'before_h': 'Başlamadan önce',
        'before': [
            ('Henüz denetlenmedi', 'Celari ve üzerine kurulduğu WebZjs motoru bağımsız bir güvenlik denetiminden geçmedi. Küçük tutarlarla başla.'),
            ('Tek yedek kurtarma kelimelerin', 'Celari cüzdanı yalnızca bu tarayıcıda tutar ve tarayıcılar site verisini kendiliğinden silebilir (Safari, 7 gün ziyaret edilmezse; Celari Ana Ekran’da değilse). 24 kelimeyi yaz.'),
            ('Geri yükleme zaman alır', 'Geri yükleme zinciri verdiğin aydan itibaren tarar. Ocak 2025’ten başlayan bir geri yükleme ölçümde yaklaşık 50 dakika sürdü; 2022-2023’teki yoğun dönemden bir başlangıç bir gün ve birkaç GB bellek isteyebilir.'),
            ('Bazı ödemeler henüz yok', 'TEX adresleri (bazı borsalar kullanır) motorun henüz kuramadığı, birbirine bağlı iki işlem ister; form bunları sonradan düşmek yerine baştan reddeder.'),
        ],
        'closing_eyebrow': 'Hazır olduğunda',
        'closing_h': 'İşini <em>kendine</em> saklayan bir Zcash cüzdanı.',
        'closing_p': 'Bir dakikada cüzdan oluştur ya da kurtarma kelimelerinden veya bir görüntüleme anahtarından geri yükle.',
        'footer': 'Celari açık kaynaktır (MIT ya da Apache-2.0); ChainSafe’in WebZjs’i ve Zcash’in librustzcash kütüphaneleri üzerine kuruludur. Electric Coin Company ya da Zcash Foundation ile bağı yoktur.',
        'footer_links': [('Kaynak kod', SOURCE), ('Cüzdan', APP)],
        'warn_icon': 'Dikkat',
    },
}

IDS = ['features', 'how', 'before']
# Made-up receive addresses for the illustration, in the bech32 alphabet.
ADDRESSES = ['u1q8m4w7…h2x93ka9', 'u1zt3kq0…p7vr2mdx', 'u17h6yd9…4cw8nl5u']


def e(s: str) -> str:
    return html.escape(s, quote=True)


def em(s: str) -> str:
    """Escapes a text whose only markup is <em>…</em>."""
    return e(s).replace('&lt;em&gt;', '<em>').replace('&lt;/em&gt;', '</em>')


def lockup(href: str) -> str:
    return f'''<a class="lockup" href="{href}" aria-label="Celari">
        <svg class="mark" viewBox="{MARK_CROP}" aria-hidden="true" focusable="false"><path fill="currentColor" d="{MARK_BODY}" /><path class="facet" d="{MARK_FACET}" /></svg>
        <svg class="word" viewBox="0 0 359.11 104.29" aria-hidden="true" focusable="false"><path fill="currentColor" d="{WORDMARK}" /></svg>
      </a>'''


def page(t: dict) -> str:
    other_name, other_href, other_code = t['other_lang']
    self_href = '/' if t['lang'] == 'en' else '/tr/'
    nav = '\n'.join(
        f'        <a class="section-link" href="#{i}">{e(name)}</a>' for i, name in zip(IDS, t['nav'])
    )
    badges = ''.join(
        f'<span class="badge{" live" if n == len(t["badges"]) - 1 else ""}">{e(x)}</span>' for n, x in enumerate(t['badges'])
    )
    h1 = ' '.join(f'<span class="line l{n}">{em(x)}</span>' for n, x in enumerate(t['h1']))
    arrow = icon('arrowRight', 'icon go')
    addresses = ''.join(f'<span class="a{n}">{e(a)}</span>' for n, a in enumerate(ADDRESSES))
    ticker_items = ''.join(f'<li>{e(x)}</li>' for x in t['ticker'])
    stats = '\n'.join(
        f'''          <div class="stat reveal">
            <dt><span class="count n{shown}" aria-hidden="true">{e(rest)}</span><span class="visually-hidden">{e(spoken)}</span></dt>
            <dd>{e(label)}</dd>
          </div>'''
        for shown, rest, spoken, label in t['stats']
    )
    features = '\n'.join(
        f'''          <article class="feature reveal">
            <div class="feature-top"><span class="feature-icon">{icon(ic)}</span><span class="num">{n + 1:02d}</span></div>
            <h3>{e(h)}</h3>
            <p>{e(p)}</p>
          </article>'''
        for n, (ic, h, p) in enumerate(t['features'])
    )
    stays = '\n'.join(f'                <li>{e(x)}</li>' for x in t['stays'])
    sees = '\n'.join(f'                <li>{e(x)}</li>' for x in t['sees'])
    (server_h, server_p), (blocks_h, _), (browser_h, browser_p) = t['diagram']
    blocks = ''.join(f'<span class="b{n}"></span>' for n in range(6))
    flow = '\n'.join(
        f'''              <li class="step s{n}"><span class="step-dot" aria-hidden="true"></span><span class="step-n" aria-hidden="true">{n + 1:02d}</span><strong>{e(h)}</strong><span class="step-sub">{e(p)}</span></li>'''
        for n, (h, p) in enumerate(t['flow'])
    )
    before = '\n'.join(
        f'''          <div class="note reveal">
            {icon('alert', 'icon note-icon')}
            <div><h3>{e(h)}</h3>
            <p>{e(p)}</p></div>
          </div>'''
        for h, p in t['before']
    )
    footer_links = ''.join(f'<a href="{e(href)}">{e(name)}</a>' for name, href in t['footer_links'])
    warn = icon('alert')
    return f'''<!doctype html>
<!-- Written by landing/build.py; edit that, not this file. -->
<html lang="{t['lang']}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="referrer" content="no-referrer" />
    <meta name="color-scheme" content="light dark" />
    <meta name="theme-color" media="(prefers-color-scheme: light)" content="#f4f1ea" />
    <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0d0c0a" />
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
    <link rel="preload" href="/fonts/fraunces-latin-opsz-italic.woff2" as="font" type="font/woff2" crossorigin />
    <link rel="stylesheet" href="/site.css" />
  </head>
  <body>
    <a class="skip" href="#main">{e(t['skip'])}</a>
    <header class="top">
      <div class="wrap">
      {lockup(self_href)}
      <nav aria-label="Celari">
{nav}
        <a class="lang" href="{other_href}" hreflang="{other_code}" lang="{other_code}">{e(other_name)}</a>
      </nav>
      <a class="button primary small" href="{APP}">{e(t['open'])}</a>
      </div>
      <span class="progress" aria-hidden="true"></span>
    </header>

    <main id="main">
      <div class="hero">
        <div class="glow" aria-hidden="true"></div>
        {engraved('hero-motif')}
        <div class="wrap hero-grid">
          <div class="hero-copy">
            <p class="eyebrow rise r0"><span class="rule" aria-hidden="true"></span>{e(t['eyebrow'])}<span class="badges">{badges}</span></p>
            <h1>{h1}</h1>
            <p class="lede rise r3">{e(t['lede'])}</p>
            <div class="actions rise r4">
              <a class="button primary" href="{APP}">{e(t['open'])}{arrow}</a>
              <a class="button secondary" href="{SOURCE}">{icon('code')}{e(t['source'])}</a>
            </div>
            <p class="caution rise r5">{warn}<span><span class="visually-hidden">{e(t['warn_icon'])}: </span>{e(t['caution'])}</span></p>
          </div>
          <div class="hero-visual" aria-hidden="true">
            <div class="float">
              <div class="card">
                <div class="card-top">
                  <span class="card-label">{e(t['card_label'])}</span>
                  <span class="toggle">{e(t['card_hide'])}<span class="switch"><span></span></span></span>
                </div>
                <div class="card-figure"><span class="fig"><span class="show">1.75</span><span class="hide">••••</span></span> <small>ZEC</small></div>
                <div class="bar"><span class="seg-s"></span><span class="seg-t"></span></div>
                <div class="legend">
                  <span class="s"><i></i>{e(t['card_shielded'])}</span>
                  <span class="t"><i></i>{e(t['card_transparent'])}</span>
                  <span class="done">{icon('check')}{e(t['card_done'])}</span>
                </div>
                <div class="addr-label">{e(t['card_addr_label'])}</div>
                <div class="address">{addresses}</div>
                <div class="card-foot"><span>{e(t['card_foot'][0])}</span><span>{e(t['card_foot'][1])}</span></div>
              </div>
            </div>
            <span class="chip c0">{icon('lock')}{e(t['chips'][0])}</span>
            <span class="chip c1">{icon('shield')}{e(t['chips'][1])}</span>
          </div>
        </div>
      </div>

      <div class="ticker" aria-hidden="true">
        <ul>{ticker_items}</ul><ul>{ticker_items}</ul>
      </div>

      <section class="stats-band" aria-label="{e(t['stats_label'])}">
        <div class="wrap">
          <dl class="stats">
{stats}
          </dl>
        </div>
      </section>

      <section id="features">
        <div class="wrap">
          <div class="section-head reveal">
            <p class="eyebrow"><span class="rule" aria-hidden="true"></span>{e(t['features_eyebrow'])}</p>
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
          <div class="section-head reveal">
            <p class="eyebrow"><span class="rule" aria-hidden="true"></span>{e(t['how_eyebrow'])}</p>
            <h2>{e(t['how_h'])}</h2>
            <p>{e(t['how_p'])}</p>
          </div>
          <figure class="pipe reveal" role="img" aria-label="{e(t['diagram_label'])}">
            <div class="node server" aria-hidden="true"><span class="node-icon">{icon('server')}</span><strong>{e(server_h)}</strong><span>{e(server_p)}</span></div>
            <div class="track" aria-hidden="true"><span class="track-label">{e(blocks_h)}</span><span class="blocks">{blocks}</span></div>
            <div class="node device" aria-hidden="true"><span class="node-icon">{icon('lock')}<span class="scan"></span></span><strong>{e(browser_h)}</strong><span>{e(browser_p)}</span></div>
          </figure>
          <div class="split">
            <div class="panel reveal">
              <h3>{e(t['stays_h'])}</h3>
              <ul>
{stays}
              </ul>
            </div>
            <div class="panel sees reveal">
              <h3>{e(t['sees_h'])}</h3>
              <ul>
{sees}
              </ul>
            </div>
          </div>
          <div class="journey reveal">
            <h3>{e(t['flow_h'])}</h3>
            <ol class="steps">
{flow}
            </ol>
            <p class="flow-note">{e(t['flow_note'])}</p>
          </div>
        </div>
      </section>

      <section id="before">
        <div class="wrap">
          <div class="section-head reveal">
            <p class="eyebrow"><span class="rule" aria-hidden="true"></span>{e(t['before_eyebrow'])}</p>
            <h2>{e(t['before_h'])}</h2>
          </div>
          <div class="notes">
{before}
          </div>
        </div>
      </section>

      <section class="closing">
        <div class="wrap">
          <div class="closing-panel reveal">
            <p class="eyebrow"><span class="rule" aria-hidden="true"></span>{e(t['closing_eyebrow'])}<span class="rule" aria-hidden="true"></span></p>
            <h2>{em(t['closing_h'])}</h2>
            <p>{e(t['closing_p'])}</p>
            <div class="actions">
              <a class="button primary" href="{APP}">{e(t['open'])}{arrow}</a>
              <a class="button secondary" href="{SOURCE}">{icon('code')}{e(t['source'])}</a>
            </div>
          </div>
        </div>
      </section>
    </main>

    <footer>
      <div class="wrap">
        {lockup(self_href)}
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
