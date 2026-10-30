// Türkçe metinler. Anahtarların kaynağı en.ts; bu dosya hepsini içermek zorundadır (tip denetimi).

import type { MessageKey } from './en';

export const tr: Record<MessageKey, string> = {
  'common.continue': 'Devam',
  'common.back': 'Geri',
  'common.cancel': 'Vazgeç',
  'common.copy': 'Kopyala',
  'common.copied': 'Kopyalandı',
  'common.close': 'Kapat',
  'common.password': 'Şifre',
  'common.details': 'Ayrıntılar',
  'common.genericError': 'Bir şeyler ters gitti.',
  'common.viewHistory': 'Geçmişte gör',
  'common.amountHidden': 'tutar gizlendi',
  'common.on': 'Açık',
  'common.off': 'Kapalı',

  'boot.loading': 'Zcash motoru hazırlanıyor…',
  'boot.errorTitle': 'Celari başlatılamadı',
  'boot.errorIsolation':
    'Bu tarayıcı Celari’nin ihtiyaç duyduğu çoklu iş parçacığı desteğini (SharedArrayBuffer) sunmuyor ya da sayfa gerekli güvenlik başlıklarıyla sunulmuyor. Güncel bir Chrome, Firefox, Edge veya Safari deneyin.',
  'boot.retry': 'Tekrar dene',

  'welcome.tagline': 'Zcash için açık kaynak, gizlilik öncelikli tarayıcı cüzdanı.',
  'welcome.create': 'Yeni cüzdan oluştur',
  'welcome.restore': 'Var olan cüzdanı geri yükle',
  'welcome.pillar1': 'Anahtarların tarayıcından çıkmaz, şifreyle kilitlenir',
  'welcome.pillar2': 'Varsayılan olarak gizli (shielded) adres',
  'welcome.pillar3': 'Açık kaynak · Token yok · Airdrop vaadi yok',

  'create.seedTitle': 'Kurtarma kelimelerin',
  'create.seedIntro': 'Bu 24 kelime cüzdanının tek yedeği. Sırasıyla kağıda yaz ve güvenli bir yerde sakla.',
  'create.seedWarn1': 'Kimseyle paylaşma. Celari dahil hiç kimse bu kelimeleri senden istemez.',
  'create.seedWarn2': 'Ekran görüntüsü alma, buluta veya mesajlara kaydetme.',
  'create.seedWarn3': 'Kelimeleri kaybedersen paran kurtarılamaz.',
  'create.reveal': 'Kelimeleri göster',
  'create.wroteDown': 'Kelimeleri sırasıyla kağıda yazdım',
  'create.verifyTitle': 'Yedeğini doğrula',
  'create.verifyIntro': 'Yazdığın kağıda bakarak şu kelimeleri gir:',
  'create.wordN': '{n}. kelime',
  'create.verifyError': 'Kelimeler eşleşmedi. Kağıdını kontrol et.',

  'password.title': 'Şifre belirle',
  'password.intro':
    'Bu şifre cüzdanını bu tarayıcıda kilitler. Unutursan cüzdanı kurtarma kelimelerinle yeniden yükleyebilirsin.',
  'password.introView':
    'Bu şifre cüzdanını bu tarayıcıda kilitler. Unutursan cüzdanı görüntüleme anahtarınla (uview1…) yeniden ekleyebilirsin.',
  'password.repeat': 'Şifre (tekrar)',
  'password.mismatch': 'Şifreler aynı değil.',
  'password.tooShort': 'En az {n} karakter olmalı.',
  'password.strength.weak': 'Zayıf',
  'password.strength.fair': 'Orta',
  'password.strength.strong': 'Güçlü',
  'password.finish': 'Cüzdanı oluştur',
  'password.creating': 'Cüzdan oluşturuluyor…',

  'restore.title': 'Cüzdanı geri yükle',
  'restore.modeSeed': 'Kurtarma kelimeleri',
  'restore.modeView': 'Sadece izleme',
  'restore.seedLabel': 'Kurtarma kelimeleri (12–24 kelime, boşlukla ayrılmış)',
  'restore.seedInvalid': 'Bu geçerli bir kurtarma kelimesi dizisi değil. Yazımı ve kelime sayısını kontrol et.',
  'restore.viewLabel': 'Görüntüleme anahtarı (uview1…)',
  'restore.viewHelp':
    'Sadece izleme modunda bakiyeni ve geçmişini görürsün ama para gönderemezsin. Bu anahtarın harcama yetkisi yoktur.',
  'restore.viewInvalid': 'Bu geçerli bir ana ağ görüntüleme anahtarı değil.',
  'restore.birthdayTitle': 'Cüzdanı ilk ne zaman kullandın?',
  'restore.birthdayHelp': 'Eşitleme bu tarihten başlar. Emin değilsen biraz daha eski bir ay seç.',
  'restore.birthdayMonth': 'Ay',
  'restore.birthdayPlaceholder': 'YYYY-AA',
  'restore.birthdayInvalid': 'Ayı 2023-05 ya da 05.2023 biçiminde, 2018-10 ile bu ay arasında gir.',
  'restore.longScan':
    '{month} ile başlamak yaklaşık {blocks} blok taramak demek. İlk tarama saatler sürebilir (2022’den ya da 2023 başından yaklaşık bir gün) ve birkaç GB bellek ister; cüzdan her kilitlendiğinde de duraklar. Cüzdanın daha sonraki bir aydan önce kullanılmadığından eminsen, emin olduğun en son ayı seç.',
  'restore.birthdayUnknown': 'Bilmiyorum',
  'restore.birthdayUnknownHelp':
    'Önce şeffaf adresindeki ilk işlemi arayacağız. Bulamazsak Sapling’in başladığı 2018’den itibaren tararız; bu saatler sürebilir.',
  'restore.birthdayDetecting': 'İlk işlem aranıyor…',
  'restore.birthdayHeight': 'Eşitleme {height}. bloktan başlayacak.',
  'restore.historyEnhancementHelp':
    'Açıkken geri yüklemeden sonra Celari geçmiş işlemlerinin her birini sunucudan tam olarak ister (notlar, alıcılar ve ücretler); sunucu böylece hangi işlemlerin senin olduğunu öğrenir. Kapalıyken Geçmiş’te notlar görünmez ve geçmiş ödemeler yalnızca net tutarlarıyla görünür. Bunu daha sonra Ayarlar > Gizlilik’ten değiştirebilirsin.',

  'unlock.title': 'Cüzdanın kilitli',
  'unlock.button': 'Kilidi aç',
  'unlock.unlocking': 'Açılıyor…',
  'unlock.wrongPassword': 'Şifre yanlış.',
  'unlock.forgot': 'Şifremi unuttum',
  'unlock.forgotHelp':
    'Şifreyi kurtarmanın yolu yok. Cüzdanı bu tarayıcıdan silip kurtarma kelimelerinle yeniden yükleyebilirsin.',
  'unlock.forgotHelpView':
    'Şifreyi kurtarmanın yolu yok. Cüzdanı bu tarayıcıdan silip görüntüleme anahtarınla (uview1…) yeniden ekleyebilirsin.',
  'unlock.autoLocked': '{n} dakika işlem yapılmadığı için otomatik olarak kilitlendi.',
  'unlock.autoLockedHidden': 'Bu sekme 1 dakika arka planda kaldığı için otomatik olarak kilitlendi.',
  'unlock.softLocked':
    'Eşitleme, ilerlemesi kaydedilene kadar arka planda sürüyor; böylece uzun bir geri yükleme boşa gitmez.',
  'unlock.upgradeRescan':
    'Celari yeni Zcash ağ kuralları için güncellendi ve bu cüzdanı başlangıç bloğundan itibaren yeniden tarıyor. Bu biraz sürebilir; tarama cüzdan açıkken sürer. Paran güvende.',
  'unlock.dbUnreadable':
    'Celari bu cüzdanın kayıtlı verilerini okuyamadı, bu yüzden hiçbir şeyi değiştirmedi; paran güvende. Sayfayı yenileyip tekrar dene. Sorun sürerse cüzdanı bu tarayıcıdan silip kurtarma kelimelerinle yeniden yükleyebilirsin.',
  'unlock.dbUnreadableView':
    'Celari bu cüzdanın kayıtlı verilerini okuyamadı, bu yüzden hiçbir şeyi değiştirmedi. Sayfayı yenileyip tekrar dene. Sorun sürerse cüzdanı bu tarayıcıdan silip görüntüleme anahtarınla (uview1…) yeniden ekleyebilirsin.',
  'unlock.dbNewer':
    'Bu cüzdan, şu an çalışan sürümden daha yeni bir Celari sürümüyle kaydedilmiş; bu sürüm onu açamıyor. Hiçbir şey değiştirilmedi, paran güvende. Yeni sürümü almak için sayfayı yenile.',

  'upgrade.rescanning':
    'Celari yeni Zcash ağ kuralları için güncellendi ve bu cüzdanı başlangıç bloğundan itibaren yeniden tarıyor. Bu biraz sürebilir, eski bir cüzdanda bir saati aşabilir; tarama yalnızca Celari’nin kilidi açıkken ilerler: cüzdan kilitlendiğinde ({minutes} dakika işlem yapılmayınca ya da sekme 1 dakika arka planda kalınca) durur, kilidi açınca devam eder. Bitene kadar bu sekmeyi açık ve önde tut ya da Ayarlar’dan otomatik kilit süresini uzat. Paran güvende; bakiye ve geçmiş tarama ilerledikçe tamamlanır.',

  'nav.home': 'Bakiye',
  'nav.receive': 'Al',
  'nav.send': 'Gönder',
  'nav.history': 'Geçmiş',
  'nav.settings': 'Ayarlar',
  'nav.lock': 'Kilitle',
  'nav.network': 'Ana ağ',

  'sync.starting': 'Ağa bağlanılıyor…',
  'sync.syncing': 'Eşitleniyor · {blocks} blok kaldı',
  'sync.syncingOne': 'Eşitleniyor · 1 blok kaldı',
  'sync.upToDate': 'Güncel · blok {height}',
  'sync.behindNetwork': '{height}. bloğa kadar tarandı · ağın gerisinde',
  'sync.error': 'Bağlantı sorunu, yeniden denenecek',
  'sync.stopped': 'Durdu · yeniden yüklemek gerekiyor',
  'sync.stalled':
    'Eşitleme 10 dakikadır ilerlemiyor. Yavaş bir bağlantı buna yol açabilir; böyle sürerse Celari’yi yeniden yükle. Şimdiye kadar kaydedilen her şey duruyor.',
  'engine.stopped':
    'Celari’nin cüzdan motoru durdu (belleği yetmedi ya da iç bir hata oluştu) ve bu sekmede devam edemiyor. Paran güvende; şimdiye kadar kaydedilen her şey duruyor. Kaldığı yerden sürmesi için Celari’yi yeniden yükle.',
  'engine.reload': 'Celari’yi yeniden yükle',
  'sync.firstSyncNote': 'Eşitleme sürüyor. Bitene kadar bakiye eksik görünebilir.',

  'network.outdatedTitle': 'Celari Zcash ağının gerisinde kaldı',
  'network.outdatedText':
    'Zcash ağı, Celari’nin bu sürümünün henüz desteklemediği kurallara geçti: {upgrade}. Güncelleme gelene kadar gönderme ve gizliye aktarma kapalı, çünkü bu sürümün hazırladığı her işlemi ağ reddeder. Anahtarların ve paran güvende.',
  'network.unreachable': 'Celari ağ sürümünü doğrulayamadı. Doğrulayana kadar gönderme ve gizliye aktarma kapalı kalır.',
  'network.serverBehind':
    'Celari’nin kullandığı sunucu Zcash ağının gerisinde. Ayarlar’dan başka bir sunucu seç. O zamana kadar gönderme ve gizliye aktarma kapalı kalır.',
  'network.upcoming':
    '{height}. blokta ağ {upgrade} kurallarına geçiyor; Celari’nin bu sürümü bunu desteklemiyor. O andan itibaren Celari güncellenene kadar gönderme ve gizliye aktarma kapanır.',

  'home.total': 'Toplam bakiye',
  'home.balanceWaiting': 'Bakiyen eşitleme ilerledikçe görünür',
  'home.hideBalances': 'Bakiyeleri gizle',
  'home.shielded': 'Gizli',
  'home.shieldedHelp': 'Ironwood + Orchard + Sapling. Tutar ve taraflar zincirde görünmez.',
  'home.transparent': 'Şeffaf',
  'home.transparentHelp': 'Zincirde herkese açık. Gizliye aktarman önerilir.',
  'home.pending': 'Onay bekleyen',
  'home.viewOnly': 'Sadece izleme',
  'home.shieldTitle': 'Şeffaf bakiyen var',
  'home.shieldText':
    '{amount} ZEC herkesin görebildiği şeffaf adreste duruyor. Gizliye aktararak gelecekteki işlemlerini koruyabilirsin.',
  'home.shieldButton': 'Gizliye aktar',
  'home.shieldBelowThreshold': 'Gizliye aktarmak için en az {amount} ZEC gerekir.',
  'home.outdatedBalance': 'Yeni Ironwood havuzu üzerinden sana gönderilen ödemeler henüz bu bakiyede yok.',
  'home.orchardNote':
    'Gizli bakiyenin {amount} ZEC’lik kısmı Orchard havuzunda ve her zamanki gibi harcanabilir. Ondan harcadığında para üstü yeni gizli havuz Ironwood’a geçer; Orchard’dan Ironwood’a geçen tutar zincirde görünür (ZIP 318 turnike kuralı). Celari henüz Ironwood’a gizli ve kademeli bir taşıma sunmuyor.',
  'home.orchardNoteViewOnly':
    'Bu bakiyenin {amount} ZEC’lik kısmı Orchard havuzunda. Yeni gizli para artık Ironwood havuzuna gidiyor; Orchard’daki para Ironwood’a geçtiğinde geçen tutar zincirde görünür (ZIP 318 turnike kuralı).',
  'home.orchardMigrateNoticeViewOnly':
    'Bu cüzdan, Zcash’in kullanımdan kaldırdığı Orchard havuzundaki bir bakiyeyi izliyor. Onu yeni Ironwood havuzuna yalnızca kurtarma kelimelerini tutan bir cüzdan taşıyabilir.',
  'home.orchardMigrateNotice':
    'Gizli bakiyen, Zcash’in kullanımdan kaldırdığı Orchard havuzunda. Yeni Ironwood havuzuna taşımak için güncel bir Celari gerekiyor. Daha erken taşıman gerekiyorsa kurtarma kelimelerini Ironwood destekleyen bir cüzdana (örneğin Zodl 3.8 ve üzeri) yükle.',
  'home.recent': 'Son işlemler',
  'home.allTransactions': 'Tüm işlemler',
  'home.privacyTitle': 'Gizlilik ve bağlantı',
  'home.openSettings': 'Ayarları aç',
  'home.server': 'Sunucu',
  'home.autoLockValue': '{n} dk',
  'home.freshAddress': 'Gizli adres',
  'home.freshAddressValue': 'Her açılışta yeni',
  'home.serverSees':
    'Sunucu IP adresini ve gönderdiğin işlemleri görür. Gizli bakiyeni ve kimden para aldığını göremez.',
  'home.serverSeesHistory':
    'Sunucu IP adresini, gönderdiğin işlemleri ve Geçmiş için işlemlerin tamamı getirildiğinden hangi işlemlerin senin olduğunu görür. Gizli bakiyeni ve kimden para aldığını göremez.',

  'receive.title': 'ZEC al',
  'receive.unified': 'Gizli adres (önerilen)',
  'receive.unifiedHelp':
    'Birleşik (unified) adres. Gönderen cüzdan destekliyorsa para doğrudan gizli bakiyene düşer. Bu adresi güvenle paylaşabilirsin; kimse bununla paranı harcayamaz.',
  'receive.transparent': 'Şeffaf adres',
  'receive.transparentHelp':
    'Sadece birleşik adresi desteklemeyen borsalar için. Bu adrese gelen para herkese açıktır; geldikten sonra gizliye aktar.',
  'receive.showTransparent': 'Şeffaf adresi göster',
  'receive.showUnified': 'Gizli adrese dön',
  'receive.noTransparent': 'Bu anahtarın şeffaf adresi yok.',
  'receive.preparing': 'Yeni bir adres hazırlanıyor…',
  'receive.freshNote':
    'Gizliliğin için Celari bu ekranı her açtığında yeni bir adres gösterir. Önceki adreslerin de çalışmaya devam eder.',
  'receive.previousNote':
    'Bu adres daha önce gösterildi ve çalışmaya devam ediyor. Celari yeni bir adresi gösterebildiğinde gösterir; genelde bu ekranı bir sonraki açışında.',
  'receive.outdatedWarn':
    'Güncel cüzdanlardan bu adrese gönderilen ödemeler yeni Ironwood havuzuna düşer; Celari’nin bu sürümü onları henüz göremez. Para kaybolmaz, güncellemeden sonra görünür. Gönderenden tekrar ödeme isteme.',

  'send.title': 'ZEC gönder',
  'send.to': 'Alıcı adresi',
  'send.toPlaceholder': 'u1…, zs1…, t1… veya zcash: bağlantısı',
  'send.amount': 'Tutar (ZEC)',
  'send.max': 'Tümü',
  'send.available': 'Gönderilebilir gizli bakiye: {amount} ZEC',
  'send.fee': 'Ağ ücreti yaklaşık {amount} ZEC',
  'send.review': 'Gözden geçir',
  'send.confirmTitle': 'Gönderimi onayla',
  'send.confirmTo': 'Alıcı',
  'send.confirmAmount': 'Tutar',
  'send.confirmFee': 'Tahmini ücret',
  'send.confirmPassword': 'Onaylamak için şifreni gir',
  'send.sendNow': 'Gönder',
  'send.stage.building': 'İşlem hazırlanıyor…',
  'send.stage.signing': 'İmzalanıyor…',
  'send.stage.proving': 'Sıfır bilgi kanıtı üretiliyor (10–60 sn)…',
  'send.stage.broadcasting': 'Ağa gönderiliyor…',
  'send.doNotClose': 'İşlem bitene kadar bu sekmeyi kapatma.',
  'send.waitForSync': 'Cüzdan hâlâ eşitleniyor ({blocks} blok kaldı). Güncel olunca devam edebilirsin.',
  'send.waitForSyncOne': 'Cüzdan hâlâ eşitleniyor (1 blok kaldı). Güncel olunca devam edebilirsin.',
  'send.waitForConnect': 'Cüzdan hâlâ ağa bağlanıyor. Güncel olunca devam edebilirsin.',
  'send.waitForRetry':
    'Cüzdan {blocks} blok geride ve eşitleme bağlantı sorunu yüzünden durdu; yeniden denenecek. Güncel olunca devam edebilirsin.',
  'send.success': 'İşlem birkaç dakika içinde onaylanır.',
  'send.another': 'Yeni gönderim',
  'send.err.address.empty': 'Alıcı adresini gir.',
  'send.err.address.invalid': 'Bu geçerli bir Zcash adresi değil. Bir harf hatası olabilir.',
  'send.err.address.testnet': 'Bu bir test ağı adresi. Celari ana ağda çalışır.',
  'send.err.amount.empty': 'Tutarı gir.',
  'send.err.amount.invalid': 'Geçersiz tutar.',
  'send.err.amount.tooManyDecimals': 'En fazla 8 ondalık basamak girebilirsin.',
  'send.err.amount.zero': 'Tutar sıfırdan büyük olmalı.',
  'send.err.amount.insufficient': 'Gizli bakiyen bu tutarı ve ücreti karşılamıyor.',
  'send.transparentWarn': 'Şeffaf bir adrese gönderiyorsun: tutar ve alıcı zincirde herkese açık görünecek.',
  'send.texWarn':
    'Bu bir TEX adresi (bazı borsalar kullanır). Para buraya şeffaf bir ara adım üzerinden gider ve bu adım herkese açıktır.',
  'send.viewOnly': 'Sadece izleme modundasın; bu cüzdandan para gönderilemez.',
  'send.disabledOutdated': 'Celari güncel Zcash ağı için güncellenene kadar gönderme kapalı.',
  'send.nothingSent': 'Hiçbir şey gönderilmedi.',
  'send.failed': 'Gönderim başarısız.',
  'send.failedHint': 'Bakiye ağ ücretini karşılamıyor olabilir. Tutarı biraz azaltıp tekrar dene.',
  'send.uriFilled': 'Tutar ödeme bağlantısından dolduruldu.',
  'send.sentTitle': '{amount} ZEC gönderildi',
  'send.stageDone': 'tamamlandı',
  'send.failedRetry': 'Hiçbir şey gönderilmedi. Tekrar deneyebilirsin.',
  'send.refused.funds':
    'Hiçbir şey gönderilmedi: harcanabilir bakiye bu ödemeyi karşılamıyor. Gereken (ağ ücreti dahil) {required} ZEC, harcanabilir {available} ZEC.',
  'send.refused.upgrade':
    'Hiçbir şey gönderilmedi. Bir ağ yükseltmesi sırasında gönderim yaklaşık {minutes} dakika duraklar: {upgrade} {height} numaralı blokta, {blocks} blok sonra etkinleşiyor. Etkinleşince tekrar dene.',
  'send.refused.upgradeNext':
    'Hiçbir şey gönderilmedi. Bir ağ yükseltmesi sırasında gönderim yaklaşık {minutes} dakika duraklar: {upgrade} bir sonraki blokta ({height}) etkinleşiyor. Birkaç dakika sonra tekrar dene.',
  'send.refused.upgradeSoon':
    'Hiçbir şey gönderilmedi. Bir ağ yükseltmesi sırasında gönderim yaklaşık {minutes} dakika duraklar. Birkaç dakika sonra tekrar dene.',
  'send.refused.theUpgrade': 'yükseltme',
  'send.refused.wrongBranch':
    'Hiçbir şey gönderilmedi: işlem hazırlanırken bir ağ yükseltmesi etkinleşti, bu yüzden bu işlem hiçbir bloğa giremezdi. Tekrar dene; yeni kurallarla yeni bir işlem oluşturulur.',
  'send.refused.expired':
    'Hiçbir şey gönderilmedi: işlemin süresi bir bloğa giremeden dolacaktı. Tekrar dene; yeni bir işlem oluşturulur.',
  'send.maybeSent': 'İşlem yine de ağa ulaşmış olabilir. Tekrar denemeden önce Geçmiş’e bak.',
  'send.shieldFirst':
    '{amount} ZEC şeffaf bakiyen de var. Yalnızca gizli bakiye gönderilebilir; göndermek için önce gizliye aktar.',
  'send.err.amount.insufficientShieldFirst':
    'Gizli bakiyen bu tutarı ve ücreti karşılamıyor. Önce şeffaf bakiyeni gizliye aktar, sonra gönder.',
  'send.err.link.multi': 'Çok alıcılı ödeme bağlantıları desteklenmiyor.',
  'send.err.link.req':
    'Bu ödeme bağlantısı Celari’nin henüz desteklemediği bir özellik kullanıyor; bu yüzden ödenemez. Alıcıdan yalnızca adresini iste.',
  'send.err.link.memo':
    'Bu bağlantı bir not (memo) istiyor ama adresi not alamaz; not yalnızca gizli adreslere gider. Alıcıdan gizli bir adres iste.',
  'send.err.link.invalid':
    'Bu ödeme bağlantısı geçersiz. Celari ne istendiğini tahmin edip ödeme yapmaz; alıcıdan yeni bir bağlantı iste.',
  'send.memo': 'Not (isteğe bağlı)',
  'send.memoHelp': 'Şifreli; yalnızca sen ve alıcı okuyabilir.',
  'send.memoCount': '{used} / {max} bayt',
  'send.memoFromLink': 'Not ödeme bağlantısından dolduruldu.',
  'send.memoUnavailable': 'Bu adres not alamaz: not (memo) yalnızca gizli adreslere giden ödemelerle gider.',
  'send.confirmMemo': 'Not',
  'send.err.memo.tooLong':
    'Not çok uzun: en fazla 512 bayt olabilir. ç, ğ, ş gibi harfler 2, emojiler 4 bayt yer kaplar.',
  'send.err.memo.nul': 'Notta görünmeyen bir NUL karakteri var (genelde yapıştırınca gelir). Notu yeniden yaz.',

  'shield.title': 'Gizliye aktar',
  'shield.intro': '{amount} ZEC şeffaf bakiyen gizli bakiyene, Ironwood havuzuna aktarılacak. Ağ ücreti bu tutardan düşülür.',
  'shield.introOrchard': '{amount} ZEC şeffaf bakiyen gizli Orchard bakiyene aktarılacak. Ağ ücreti bu tutardan düşülür.',
  'shield.confirm': 'Aktar',
  'shield.success': 'Onaylanınca gizli bakiyende görünecek.',
  'shield.sentTitle': '{amount} ZEC gizliye aktarılıyor',
  'shield.disabledOutdated': 'Celari güncel Zcash ağı için güncellenene kadar gizliye aktarma kapalı.',

  'history.title': 'İşlem geçmişi',
  'history.empty': 'Henüz işlem yok.',
  'history.type.received': 'Alındı',
  'history.type.sent': 'Gönderildi',
  'history.type.shielded': 'Gizliye aktarıldı',
  'history.status.confirmed': 'Onaylandı',
  'history.status.pending': 'Bekliyor',
  'history.status.expired': 'Süresi doldu',
  'history.fee': 'Ücret {amount} ZEC',
  'history.copyTxid': 'İşlem kimliğini kopyala',
  'history.privacyLabel': 'Gizlilik',
  'history.privacy.shielded': 'Gizli',
  'history.privacy.shielding': 'Gizliye aktarıldı · tutar herkese açık',
  'history.privacy.partial': 'Kısmen gizli',
  'history.privacy.transparent': 'Şeffaf · herkese açık',
  'history.privacyNote':
    'Etiketler yalnızca bu cüzdanın kendi çıktılarına bakar (aldığı, gönderdiği ya da para üstü olarak geri aldığı tutarlar), işlemin geri kalanına bakmaz. Şeffaf girdiler, bu cüzdanınkiler de dahil, her zaman herkese açıktır.',

  'settings.title': 'Ayarlar',
  'settings.language': 'Dil',
  'settings.server': 'Sunucu (lightwalletd gRPC-web proxy)',
  'settings.serverHelp':
    'Sunucu IP adresini ve gönderdiğin işlemleri görebilir. Gizlilik altındaki “Geçmiş için işlemlerin tamamını getir” kapalı değilse Celari kendi işlemlerinin tamamını da ondan ister (notlar için, geri yüklemeden sonra ücret ve alıcılar için); bu yüzden sunucu hangi işlemlerin senin olduğunu anlayabilir. Her iki durumda da gönderdiğin her ödemeyi onaylanana kadar ona sorar. Gizli bakiyeni ve kimden para aldığını göremez. Kendi sunucunu da çalıştırabilirsin.',
  'settings.serverSave': 'Kaydet ve yeniden başlat',
  'settings.serverReset': 'Varsayılana dön',
  'settings.serverInvalid': 'https:// ile başlayan geçerli bir adres gir.',
  'settings.privacy': 'Gizlilik',
  'settings.historyEnhancement': 'Geçmiş için işlemlerin tamamını getir',
  'settings.historyEnhancementHelp':
    'Açıkken Celari kendi işlemlerinin her birini sunucudan tam olarak ister: notları için ve geri yüklemeden sonra geçmiş ödemelerin alıcıları ve ücretleri için. Sunucu böylece hangi işlemlerin senin olduğunu öğrenir. Kapalıyken bunu bu yoldan öğrenmez, ama Geçmiş’te notlar görünmez ve geri yüklemeden sonra geçmiş ödemeler yalnızca net tutarlarıyla görünür; yeniden açınca eksikler getirilir. Her iki durumda da Celari gönderdiğin bir ödemeyi onaylanana kadar sunucuya sorar, en fazla 5 dakikada bir.',
  'settings.autoLock': 'Otomatik kilit',
  'settings.minutes': '{n} dakika işlem yapılmazsa',
  'settings.autoLockHidden': 'Cüzdan, bu sekme 1 dakika arka planda kalınca da kilitlenir.',
  'settings.security': 'Güvenlik',
  'settings.showViewingKey': 'Görüntüleme anahtarını göster',
  'settings.viewingKeyHelp':
    'Bu anahtara sahip olan herkes geçmiş ve gelecekteki tüm işlemlerini ve notlarını görebilir ama harcama yapamaz. Geri alınamaz; yalnızca tamamen güvendiğin biriyle paylaş.',
  'settings.clipboardClear':
    'Celari panoyu kopyalamadan 60 saniye sonra temizlemeye çalışır. Tarayıcılar buna yalnızca bu sekme öndeyken izin verir; bu yüzden temizlik sekmeye döndüğünde olabilir, sekmeyi önce kapatırsan hiç olmaz. Bu arada başka bir uygulamada kopyaladığın bir şey de temizlenebilir.',
  'settings.clipboardCleared': 'Pano temizlendi.',
  'settings.showSeed': 'Kurtarma kelimelerini göster',
  'settings.reveal': 'Göster',
  'settings.danger': 'Tehlikeli bölge',
  'settings.wipe': 'Cüzdanı bu tarayıcıdan sil',
  'settings.wipeHelp': 'Kurtarma kelimelerin yanında değilse paran kalıcı olarak kaybolur.',
  'settings.wipeHelpView':
    'Görüntüleme anahtarın yanında değilse bu cüzdanı yeniden ekleyemezsin. Harcama yetkisi olmadığı için para kaybı olmaz.',
  'settings.wipeConfirm': 'Onaylamak için {word} yaz',
  'settings.wipeWord': 'SİL',
  'settings.about': 'Hakkında',
  'settings.aboutText':
    'Celari açık kaynaktır (MIT / Apache-2.0) ve ChainSafe’in WebZjs kütüphanesi üzerine kuruludur. Token yok, puan yok, airdrop vaadi yok.',
  'settings.source': 'Kaynak kod',
  'settings.licenses': 'Üçüncü taraf lisansları (cüzdan motoru)',
  'settings.fontLicenses': 'Yazı tipi lisansları',
  'settings.version': 'Sürüm {v}',
};
