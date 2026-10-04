// Channel DNA v2: each channel has its own editorial type, target content mix,
// preferred source classes and scoring signals. The scheduler uses these values;
// they are not just prompt instructions.

export const SOURCE_CLASSES = ["OFFICIAL", "MEDIA", "CREATOR", "COMMUNITY", "SOCIAL"];

export const CHANNEL_DNA = {
  ai: {
    type: "trends",
    topic: "искусственный интеллект: новости нейросетей и вирусные ИИ-находки — что люди сделали с ИИ, ролики и фото, которые разлетелись, новые ИИ-фильтры и приложения",
    focus: "Кроме новостей компаний оставляй вирусные ИИ-видео и фото, необычные эксперименты людей с нейросетями, новые сервисы, которые все пробуют, приколы с ИИ. Скучные корпоративные пресс-релизы и отчёты о выручке оценивай низко.",
    mix: { important_news: 0.35, viral_find: 0.35, useful: 0.20, fun: 0.10 },
    preferredSources: ["SOCIAL", "COMMUNITY", "CREATOR", "OFFICIAL", "MEDIA"],
    scoreWeights: { virality: 0.28, utility: 0.20, discussion: 0.16, visual: 0.16, wow: 0.20 }
  },
  auto: {
    type: "news_fun",
    topic: "всё интересное про автомобили для российской аудитории: премьеры, авторынок России, китайские машины, электро и гибриды, автотехнологии, блогеры и владельцы, вирусные автомобильные истории, важное водителю",
    focus: "Не превращай канал в сухое автомобильное СМИ. Бери сильные премьеры и новости рынка, но также реальные истории владельцев, тесты российских автоблогеров, хорошие видео, необычные машины и вирусные автомобильные сюжеты. Лучше сильный материал чуть старше, чем свежая слабая новость. Слухи без нормального источника, мелкие ДТП и дилерский рекламный шум отсеивай.",
    mix: { premieres: 0.20, russia_market: 0.20, china: 0.133, ev_hybrid: 0.067, auto_tech: 0.067, bloggers_tests: 0.133, viral_unusual: 0.133, driver_important: 0.067 },
    rubrics: [
      { id: "premieres", label: "Премьеры и новинки", hint: "новые модели, рестайлинги, официальные премьеры, старт продаж и важные характеристики" },
      { id: "russia_market", label: "Авторынок России", hint: "российские продажи, цены и поставки, локальные бренды, рынок новых и подержанных автомобилей" },
      { id: "china", label: "Китайские авто", hint: "Geely, Haval, Chery, Changan, Omoda, Exeed, BYD, Zeekr и другие китайские марки, особенно важные для России" },
      { id: "ev_hybrid", label: "Электро и гибриды", hint: "электромобили, гибриды, батареи, зарядка, запас хода и новые силовые установки" },
      { id: "auto_tech", label: "Автотехнологии", hint: "ADAS, автопилот, мультимедиа, безопасность, новые автомобильные технологии и инженерные решения" },
      { id: "bloggers_tests", label: "Блогеры / тесты / владельцы", hint: "российские автоблогеры, сильные тесты, разборы, реальные истории владельцев; только самостоятельный инфоповод" },
      { id: "viral_unusual", label: "Вирусное и необычное", hint: "необычные машины, рекорды, яркие видео, редкие проекты и автомобильные истории, которые хочется переслать" },
      { id: "driver_important", label: "Важно водителю", hint: "изменения правил, штрафов, ОСАГО, техосмотра, топлива и другое, что реально влияет на водителя в России" }
    ],
    rubricMinSources: 5,
    rubricMaxSources: 6,
    slotHours: [8,9,10,11,12,13,14,15,16,17,18,19,20,21,22],
    slotSchedule: [
      { time: "08:00", rubric: "driver_important" },
      { time: "09:00", rubric: "russia_market" },
      { time: "10:00", rubric: "premieres" },
      { time: "11:00", rubric: "china" },
      { time: "12:00", rubric: "bloggers_tests" },
      { time: "13:00", rubric: "russia_market" },
      { time: "14:00", rubric: "premieres" },
      { time: "15:00", rubric: "ev_hybrid" },
      { time: "16:00", rubric: "viral_unusual" },
      { time: "17:00", rubric: "china" },
      { time: "18:00", rubric: "russia_market" },
      { time: "19:00", rubric: "premieres" },
      { time: "20:00", rubric: "bloggers_tests" },
      { time: "21:00", rubric: "auto_tech" },
      { time: "22:00", rubric: "viral_unusual" }
    ],
    preferredSources: ["MEDIA", "CREATOR", "OFFICIAL", "COMMUNITY", "SOCIAL"],
    scoreWeights: { utility: 0.22, local: 0.20, discussion: 0.16, visual: 0.16, wow: 0.14, virality: 0.12 }
  },
  money: {
    type: "news",
    topic: "личные финансы обычного человека в России: банковские карты и переводы, вклады и накопления, кредиты и ипотека, налоги, рубль и инфляция, ставка Банка России, зарплаты, пенсии и выплаты, финансовое мошенничество, практические денежные правила",
    focus: "Только то, что прямо влияет на личные деньги человека. Не тащи сюда корпоративные сделки, отчётность компаний, мировые сырьевые рынки, новости продавцов маркетплейсов, криптовалюты и макроэкономику без понятного эффекта для кошелька. Подача: что произошло → кого касается → сколько в ₽/% → что делать.",
    mix: {
      cards_banks: 0.125,
      deposits: 0.125,
      credits_mortgage: 0.125,
      taxes: 0.125,
      ruble_inflation_cb: 0.125,
      income_benefits: 0.125,
      financial_scams: 0.125,
      money_howto: 0.125
    },
    rubrics: [
      { id: "cards_banks", label: "Карты и банки", hint: "карты, переводы, комиссии, блокировки, новые правила банков и платёжных сервисов для физических лиц" },
      { id: "deposits", label: "Вклады и накопления", hint: "ставки и условия вкладов и накопительных счетов, страхование сбережений, важные изменения у крупных банков" },
      { id: "credits_mortgage", label: "Кредиты и ипотека", hint: "ставки, требования банков, льготные программы, досрочное погашение, изменения кредита и ипотеки для физлиц" },
      { id: "taxes", label: "Налоги", hint: "НДФЛ, налог на проценты по вкладам, имущество, вычеты, сроки и правила ФНС для физических лиц" },
      { id: "ruble_inflation_cb", label: "Рубль, инфляция и ставка ЦБ", hint: "курс рубля, инфляция и решения Банка России только когда понятно влияние на цены, кредиты или сбережения" },
      { id: "income_benefits", label: "Зарплаты, пенсии и выплаты", hint: "зарплаты, МРОТ, индексации, пенсии, пособия, маткапитал и иные выплаты обычным людям" },
      { id: "financial_scams", label: "Финансовые мошенники", hint: "новые массовые схемы обмана, карты и переводы, дропперы, фишинг и практическая защита денег" },
      { id: "money_howto", label: "Полезно знать", hint: "практические правила: возвраты, страховки, банковские права, ошибки списаний и полезная финансовая грамотность" }
    ],
    rubricMinSources: 5,
    rubricMaxSources: 6,
    // Six regular hourly slots; 14:30 and 21:30 are added by the channel's extra lane in server.js.
    slotHours: [9, 11, 13, 16, 18, 20],
    preferredSources: ["OFFICIAL", "MEDIA", "CREATOR", "COMMUNITY", "SOCIAL"],
    // Channel-fit layer. The visible/auto-publish 100-point score has its own money formula in post-rating.js.
    scoreWeights: { utility: 0.42, local: 0.28, deal: 0.16, discussion: 0.08, virality: 0.06 }
  },
  tech: {
    type: "news",
    topic: "технологии и гаджеты: смартфоны, Apple, Android, приложения, интернет, связь",
    focus: "Не дублируй общий ИИ-канал. ИИ сюда попадает, только если это функция конкретного продукта, приложения или устройства.",
    mix: { product: 0.35, apps: 0.25, useful: 0.20, unusual: 0.10, industry: 0.10 },
    preferredSources: ["OFFICIAL", "MEDIA", "CREATOR", "COMMUNITY", "SOCIAL"],
    scoreWeights: { utility: 0.28, discussion: 0.18, visual: 0.14, wow: 0.14, local: 0.14, virality: 0.12 }
  },
  games: {
    type: "blogger",
    topic: "видеоигры: релизы, трейлеры, обновления, скидки, слухи и жизнь игрового сообщества",
    focus: "Оставляй и то, что обсуждают игроки: баги, мемы, находки сообщества, скандалы вокруг игр. Голос — игровой блогер для своих, не СМИ.",
    mix: { release: 0.30, community: 0.30, video: 0.15, drama: 0.15, deal: 0.10 },
    preferredSources: ["COMMUNITY", "CREATOR", "SOCIAL", "OFFICIAL", "MEDIA"],
    scoreWeights: { discussion: 0.28, virality: 0.22, visual: 0.18, wow: 0.14, utility: 0.10, deal: 0.08 }
  },
  kino: {
    type: "blogger",
    topic: "кино и сериалы: премьеры, трейлеры, стриминги, сборы, кастинг, реакции зрителей",
    focus: "Подача как у своего человека: трейлеры, первые реакции, провалы, неожиданные кастинги, съёмки, мемы и что посмотреть.",
    mix: { release: 0.25, reaction: 0.25, trailer: 0.20, backstage: 0.15, recommendation: 0.15 },
    preferredSources: ["SOCIAL", "CREATOR", "COMMUNITY", "OFFICIAL", "MEDIA"],
    scoreWeights: { discussion: 0.26, virality: 0.20, visual: 0.20, wow: 0.16, utility: 0.10, local: 0.08 }
  },
  science: {
    type: "news_fun",
    topic: "наука: космос, животные, медицина, археология, необычные открытия",
    focus: "Смещай ленту к вау-науке. Материал должен быть интересен человеку без научного образования и быстро объяснять, почему открытие удивляет или касается его самого (тело, здоровье, еда, сон, животные, космос, который можно увидеть). Сухие отчёты, гранты, конференции, рейтинги вузов, «учёные разработали методику» без понятного эффекта — отсеивай.",
    mix: { wow: 0.45, space: 0.15, animals: 0.15, human: 0.15, future: 0.10 },
    preferredSources: ["OFFICIAL", "MEDIA", "CREATOR", "COMMUNITY", "SOCIAL"],
    scoreWeights: { wow: 0.30, visual: 0.18, utility: 0.16, discussion: 0.14, virality: 0.12, local: 0.10 }
  },
  sport: {
    type: "news_fun",
    topic: "спорт: российский медийный спорт (поп-ММА — Hardcore, Top Dog, RCC, ACA, Наше Дело, Fight Nights; шоу «Титаны»; медиафутбол — Медиалига, Амкал, 2DROTS; бои блогеров), футбол, хоккей, UFC, бокс",
    focus: "30–40% ленты — российский медийный спорт: поп-ММА, медиафутбол, шоу, бои блогеров, конфликты и вирусные моменты. Ставки и букмекеров отсеивай.",
    mix: { mainstream: 0.50, media_sport: 0.35, viral: 0.15 },
    preferredSources: ["CREATOR", "SOCIAL", "MEDIA", "OFFICIAL", "COMMUNITY"],
    scoreWeights: { discussion: 0.24, virality: 0.20, local: 0.20, visual: 0.16, wow: 0.12, utility: 0.08 }
  },
  world: {
    type: "trends",
    topic: "вирусное в интернете: ролики и истории, которые все пересылают, мемы, тренды TikTok, Reels и YouTube, челленджи, интернет-феномены, вирусные приложения; без политики",
    focus: "Это канал «Что там в интернете?». Оставляй вирусные истории, мемы с историей (что за мем, откуда взялся), тренды соцсетей, челленджи. Политику, войны, криминал с пострадавшими и обычные мировые новости отсеивай.",
    mix: { viral_story: 0.45, meme_trend: 0.25, video: 0.20, app_phenomenon: 0.10 },
    preferredSources: ["SOCIAL", "COMMUNITY", "CREATOR", "MEDIA", "OFFICIAL"],
    scoreWeights: { virality: 0.34, discussion: 0.24, visual: 0.20, wow: 0.16, utility: 0.06 }
  },
  stars: {
    type: "blogger",
    topic: "знаменитости и шоу-бизнес: выступления, проекты, соцсети звёзд, образы, подтверждённые новости об отношениях",
    focus: "Коротко и эмоционально, как знакомый рассказывает, что произошло. Больше фото/видео, соцсетей, образов, выступлений и смешных эпизодов, без жёлтой агрессии.",
    mix: { social: 0.30, performance: 0.20, funny: 0.20, style: 0.15, relationship: 0.15 },
    preferredSources: ["SOCIAL", "CREATOR", "MEDIA", "COMMUNITY", "OFFICIAL"],
    scoreWeights: { discussion: 0.26, virality: 0.24, visual: 0.20, wow: 0.16, local: 0.08, utility: 0.06 }
  },
  travel: {
    type: "news_fun",
    topic: "путешествия для туристов из России: направления, визы и въезд, авиабилеты, необычные места, цены",
    focus: "Не только правила въезда: необычные места, новые отели, выгодные направления, красивые маршруты, вирусные локации и полезные travel-фишки.",
    mix: { practical: 0.35, unusual_place: 0.25, viral_location: 0.15, deal: 0.15, rules: 0.10 },
    preferredSources: ["CREATOR", "MEDIA", "OFFICIAL", "SOCIAL", "COMMUNITY"],
    scoreWeights: { utility: 0.26, visual: 0.22, local: 0.18, wow: 0.14, deal: 0.12, virality: 0.08 }
  },
  shopping: {
    type: "trends",
    topic: "интересные товарные находки для обычного покупателя: Wildberries, Ozon, Яндекс Маркет, AliExpress и вирусные товары",
    focus: "Это не канал новостей маркетплейсов и не канал для продавцов. Источник нужен, чтобы найти сильный товар. Даже рекламный исходник допустим: убери рекламу, ссылки, промокоды и продавца и сделай обычный редакционный пост о самом товаре. Не пытайся проверять карточку маркетплейса с сервера: цену, рейтинг, число отзывов и наличие в публичный пост не переносить. Никаких выдуманных характеристик.",
    mix: { wildberries: 0.25, ozon: 0.25, yandex_market: 0.15, aliexpress: 0.15, viral_products: 0.20 },
    rubrics: [
      { id: "wildberries", label: "Находки Wildberries", hint: "Telegram-каналы и сайты с конкретными интересными товарами и находками Wildberries", minSources: 5 },
      { id: "ozon", label: "Находки Ozon", hint: "Telegram-каналы и сайты с конкретными интересными товарами и находками Ozon", minSources: 5 },
      { id: "yandex_market", label: "Находки Яндекс Маркета", hint: "Telegram-каналы и сайты с конкретными интересными товарами и находками Яндекс Маркета", minSources: 5 },
      { id: "aliexpress", label: "Находки AliExpress", hint: "Telegram-каналы и сайты с конкретными интересными товарами и находками AliExpress", minSources: 5 },
      { id: "viral_products", label: "Вирусные товары", hint: "товары, которые активно расходятся по соцсетям и нескольким независимым подборкам; важен сам товар и хорошее медиа", minSources: 7 }
    ],
    rubricMinSources: 5,
    rubricMaxSources: 7,
    slotSchedule: [
      { time: "08:00", rubric: "viral_products" },
      { time: "08:45", rubric: "wildberries" },
      { time: "09:30", rubric: "ozon" },
      { time: "10:15", rubric: "yandex_market" },
      { time: "11:00", rubric: "wildberries" },
      { time: "11:45", rubric: "aliexpress" },
      { time: "12:30", rubric: "ozon" },
      { time: "13:15", rubric: "viral_products" },
      { time: "14:00", rubric: "wildberries" },
      { time: "14:45", rubric: "yandex_market" },
      { time: "15:30", rubric: "ozon" },
      { time: "16:15", rubric: "aliexpress" },
      { time: "17:00", rubric: "wildberries" },
      { time: "17:45", rubric: "viral_products" },
      { time: "18:30", rubric: "ozon" },
      { time: "19:15", rubric: "yandex_market" },
      { time: "20:00", rubric: "wildberries" },
      { time: "20:45", rubric: "aliexpress" },
      { time: "21:30", rubric: "ozon" },
      { time: "22:15", rubric: "viral_products" }
    ],
    preferredSources: ["COMMUNITY", "SOCIAL", "CREATOR", "MEDIA", "OFFICIAL"],
    scoreWeights: { utility: 0.22, virality: 0.20, visual: 0.20, wow: 0.16, discussion: 0.12, local: 0.10 }
  },
  home: {
    type: "trends",
    // v0.51.3 (editor, 2026-10-04): not news, not real estate, not ЖКХ — 10 themes, one post a day each, the way the
    // biggest home channels do it (finds, before/after of ordinary flats, storage and cleaning hacks).
    topic: "дом и уют: находки и трендовые товары для дома, до/после, техника для дома, хранение, мебель для маленьких квартир, бюджетный уют, лайфхаки уборки, ремонт своими руками, тренды интерьера, кухня и посуда",
    focus: "Канал не новостной. Нужны находки и подборки товаров для дома (что это, чем удобно, сколько стоит, где искать), вирусные и необычные вещи для квартиры, до/после обычных квартир, идеи для маленьких метров, хранение, уборка, ремонт своими руками, техника для дома в продаже, тренды интерьера, кухня. Находка товара или подборка — НЕ реклама, если нет явных признаков платной интеграции (промокод, «на правах рекламы», erid). Отсеивай: ЖКХ, тарифы, управляющие компании и законы; рынок недвижимости, цены новостроек и ипотеку; слухи и анонсы IT-компаний (это канал технологий), если это не конкретное устройство для дома в продаже; интерьеры баров, ресторанов, офисов и отелей; городские новости и благоустройство; выставки, конкурсы и книги о дизайне.",
    // content_bucket = theme: the writer picks one key; the scheduler posts one theme a day each (see rubrics)
    mix: { marketplace_finds: 0.1, before_after: 0.1, home_appliances: 0.1, storage: 0.1, small_space_furniture: 0.1, budget_cozy: 0.1, cleaning_hacks: 0.1, diy_repair: 0.1, interior_trends: 0.1, kitchen: 0.1 },
    rubrics: [
      { id: "marketplace_finds", label: "Находки с маркетплейсов", hint: "Telegram-каналы и сайты с находками товаров для дома на Wildberries, Ozon, AliExpress: вирусные и необычные вещи для квартиры" },
      { id: "before_after", label: "До/после", hint: "Telegram-каналы и сайты с преображениями обычных квартир до/после: маленькие кухни, ванные, комнаты, бюджетный ремонт" },
      { id: "home_appliances", label: "Техника для дома", hint: "сайты и Telegram-каналы об обзорах и новинках бытовой техники для дома: роботы-пылесосы, увлажнители, кухонная техника, умные устройства в продаже" },
      { id: "storage", label: "Хранение и порядок", hint: "Telegram-каналы и сайты про системы хранения и организацию пространства: шкафы, кухня, прихожая, минимализм" },
      { id: "small_space_furniture", label: "Мебель и маленькие квартиры", hint: "Telegram-каналы и сайты про мебель-трансформер, зонирование студий и решения для маленьких квартир" },
      { id: "budget_cozy", label: "Бюджетный уют", hint: "Telegram-каналы с бюджетными находками для уюта: Фикс Прайс, IKEA, супермаркеты, аналоги дорогих вещей «как на Pinterest»" },
      { id: "cleaning_hacks", label: "Лайфхаки уборки", hint: "Telegram-каналы и сайты с лайфхаками уборки и быта: как отмыть, чем почистить, как сэкономить время" },
      { id: "diy_repair", label: "Ремонт своими руками", hint: "Telegram-каналы и сайты про ремонт своими руками: простые работы без мастера, материалы, ошибки ремонта" },
      { id: "interior_trends", label: "Тренды интерьера", hint: "сайты и Telegram-каналы о трендах интерьера: цвета, декор, мебель сезона, что устарело" },
      { id: "kitchen", label: "Кухня и посуда", hint: "сайты и Telegram-каналы про кухню: гаджеты, посуда, организация кухни, кухонные находки" }
    ],
    rubricMinSources: 5,
    rubricMaxSources: 6,
    // 10 posts a day (Moscow hours), one per theme
    slotHours: [9, 10, 12, 13, 15, 17, 18, 19, 21, 22],
    // never picked for a slot in this channel, whatever the editor scored
    excludeBuckets: ["real_estate", "zhkh", "smart_home"],
    preferredSources: ["CREATOR", "SOCIAL", "COMMUNITY", "MEDIA", "OFFICIAL"],
    scoreWeights: { visual: 0.26, virality: 0.20, utility: 0.20, wow: 0.14, deal: 0.12, discussion: 0.08 }
  },
  food: {
    type: "blogger",
    topic: "еда: вирусные блюда и рецепты-тренды, новинки меню сетей и ресторанов, необычная еда, фуд-блогеры, цены на продукты",
    focus: "Больше интересного и развлекательного: вирусные блюда, необычные продукты, рестораны, фуд-блогеры, тесты, рецепты-тренды и смешные видео. Голос лёгкий и аппетитный.",
    mix: { viral_food: 0.30, restaurant: 0.20, unusual: 0.20, creator: 0.15, prices: 0.15 },
    preferredSources: ["SOCIAL", "CREATOR", "COMMUNITY", "MEDIA", "OFFICIAL"],
    scoreWeights: { visual: 0.26, virality: 0.24, wow: 0.16, discussion: 0.14, utility: 0.12, deal: 0.08 }
  },
  business: {
    type: "news",
    topic: "бизнес: компании, сделки, предприниматели, маркетплейсы для продавцов, бренды",
    focus: "Не перепечатка деловых СМИ: деньги, масштаб, предпринимательские истории, необычные бизнес-модели, провалы, стартапы и практический вывод.",
    mix: { money_scale: 0.30, founder_story: 0.20, market: 0.20, startup: 0.15, failure: 0.15 },
    preferredSources: ["OFFICIAL", "MEDIA", "CREATOR", "COMMUNITY", "SOCIAL"],
    scoreWeights: { deal: 0.26, utility: 0.22, local: 0.16, discussion: 0.14, wow: 0.12, virality: 0.10 }
  },
  crypto: {
    type: "news",
    topic: "криптовалюты для обычных людей: биткоин, Ethereum, TON, крупные движения, взломы, регулирование",
    focus: "Для обычного читателя: крупные движения BTC/ETH/TON, взломы, регулирование и полезные сервисы. Не забивай ленту мелкими токенами.",
    mix: { major_market: 0.40, hack: 0.20, regulation: 0.15, useful: 0.15, unusual: 0.10 },
    preferredSources: ["OFFICIAL", "MEDIA", "CREATOR", "COMMUNITY", "SOCIAL"],
    scoreWeights: { deal: 0.24, utility: 0.22, discussion: 0.18, local: 0.14, virality: 0.12, wow: 0.10 }
  }
};

export function channelTopic(channelId) {
  return (CHANNEL_DNA[channelId] && CHANNEL_DNA[channelId].topic) || "";
}

export function channelFocus(channelId) {
  return (CHANNEL_DNA[channelId] && CHANNEL_DNA[channelId].focus) || "";
}

export function channelStrategy(channelId) {
  const dna = CHANNEL_DNA[channelId] || {};
  return {
    type: dna.type || "news",
    mix: Object.assign({}, dna.mix || {}),
    excludeBuckets: Array.isArray(dna.excludeBuckets) ? dna.excludeBuckets.slice() : [],
    rubrics: Array.isArray(dna.rubrics) ? dna.rubrics.map(function(r){ return Object.assign({}, r); }) : [],
    rubricMinSources: Number(dna.rubricMinSources || 0) || 0,
    rubricMaxSources: Number(dna.rubricMaxSources || 0) || 0,
    slotHours: Array.isArray(dna.slotHours) ? dna.slotHours.slice() : null,
    slotSchedule: Array.isArray(dna.slotSchedule) ? dna.slotSchedule.map(function(s){ return Object.assign({}, s); }) : null,
    preferredSources: Array.isArray(dna.preferredSources) ? dna.preferredSources.slice() : SOURCE_CLASSES.slice(),
    scoreWeights: Object.assign({}, dna.scoreWeights || {})
  };
}

// v0.43.0 source rework after the owner's review of the channels.
// add: candidates (validated on the server before adding).
// disable: URLs of off-topic sources to pause (kept in the list, not deleted).
export const SOURCE_REWORK_V0430 = {
  ai: {
    add: [
      { name: "Метаверсище и ИИще (Telegram)", url: "https://t.me/s/cgevent", group: "creator" },
      { name: "Neural Shit (Telegram)", url: "https://t.me/s/NeuralShit", group: "creator" },
      { name: "Psy Eyes (Telegram)", url: "https://t.me/s/Psy_Eyes", group: "creator" },
      { name: "Data Secrets (Telegram)", url: "https://t.me/s/data_secrets", group: "creator" },
      { name: "эйай ньюз (Telegram)", url: "https://t.me/s/ai_newz", group: "creator" },
      { name: "Denis Sexy IT (Telegram)", url: "https://t.me/s/denissexy", group: "creator" },
      { name: "404 Media", url: "https://www.404media.co/", group: "media" },
      { name: "Futurism", url: "https://futurism.com/", group: "media" },
      { name: "Know Your Meme — News", url: "https://knowyourmeme.com/news", group: "media" },
      { name: "Reddit — r/aivideo", url: "https://www.reddit.com/r/aivideo/top/?t=day", group: "media" },
      { name: "Reddit — r/ChatGPT", url: "https://www.reddit.com/r/ChatGPT/top/?t=day", group: "media" }
    ],
    disable: []
  },
  world: {
    add: [
      { name: "Пикабу — горячее", url: "https://pikabu.ru/hot", group: "media" },
      { name: "Memepedia", url: "https://memepedia.ru/", group: "media" },
      { name: "Know Your Meme — News", url: "https://knowyourmeme.com/news", group: "media" },
      { name: "Daily Dot", url: "https://www.dailydot.com/", group: "media" },
      { name: "Distractify", url: "https://www.distractify.com/", group: "media" },
      { name: "BuzzFeed — Trending", url: "https://www.buzzfeed.com/trending", group: "media" },
      { name: "Dexerto — Entertainment", url: "https://www.dexerto.com/entertainment/", group: "media" },
      { name: "DTF", url: "https://dtf.ru/", group: "media" },
      { name: "vc.ru — Соцсети", url: "https://vc.ru/social", group: "media" },
      { name: "Твиттота (Telegram)", url: "https://t.me/s/twitt_ota", group: "creator" },
      { name: "REELS | МЕМЫ (Telegram)", url: "https://t.me/s/reels_memes", group: "creator" },
      { name: "Кругляшики (Telegram)", url: "https://t.me/s/kruglyashiki", group: "creator" },
      { name: "МЕМАЧ (Telegram)", url: "https://t.me/s/memachh", group: "creator" },
      { name: "Убойный юмор (Telegram)", url: "https://t.me/s/community_memy", group: "creator" },
      { name: "Афиша Daily (Telegram)", url: "https://t.me/s/afishadaily", group: "creator" },
      { name: "Reddit — r/interestingasfuck", url: "https://www.reddit.com/r/interestingasfuck/top/?t=day", group: "media" },
      { name: "Reddit — r/BeAmazed", url: "https://www.reddit.com/r/BeAmazed/top/?t=day", group: "media" },
      { name: "Reddit — r/popular", url: "https://www.reddit.com/r/popular/top/?t=day", group: "media" },
      { name: "Reddit — r/nextfuckinglevel", url: "https://www.reddit.com/r/nextfuckinglevel/top/?t=day", group: "media" },
      { name: "Reddit — r/Damnthatsinteresting", url: "https://www.reddit.com/r/Damnthatsinteresting/top/?t=day", group: "media" },
      { name: "Reddit — r/Unexpected", url: "https://www.reddit.com/r/Unexpected/top/?t=day", group: "media" },
      { name: "Tubefilter", url: "https://www.tubefilter.com/", group: "media" },
      { name: "Social Media Today", url: "https://www.socialmediatoday.com/", group: "media" },
      { name: "The Verge — Social Media", url: "https://www.theverge.com/social-media", group: "media" },
      { name: "Bored Panda", url: "https://www.boredpanda.com/", group: "media" }
    ],
    disable: [
      "https://www.smithsonianmag.com/smart-news/",
      "https://www.mentalfloss.com/",
      "https://www.neatorama.com/",
      "https://www.bbc.com/culture",
      "https://www.nationalgeographic.com/animals",
      "https://www.openculture.com/",
      "https://www.thisiscolossal.com/",
      "https://www.messynessychic.com/",
      "https://www.euronews.com/culture",
      "https://www.vokrugsveta.ru/news/",
      "https://hightech.fm/",
      "https://www.atlasobscura.com/articles"
    ]
  },
  sport: {
    add: [
      { name: "POP MMA", url: "https://popmma.ru/news", group: "media" },
      { name: "Sports.ru — Поп-ММА", url: "https://www.sports.ru/pop-mma/news/", group: "media" },
      { name: "Sports.ru — ММА", url: "https://www.sports.ru/mma/", group: "media" },
      { name: "Sports.ru — Медиафутбол", url: "https://www.sports.ru/mediafootball/", group: "media" },
      { name: "Sports.ru — Бокс", url: "https://www.sports.ru/boxing/", group: "media" },
      { name: "Top Dog (Telegram)", url: "https://t.me/s/topdogfc", group: "creator" },
      { name: "RCC Hard (Telegram)", url: "https://t.me/s/rcc_hard", group: "creator" }
    ],
    disable: []
  },
  food: {
    add: [
      { name: "Афиша Рестораны", url: "https://www.afisha.ru/msk/restaurants/", group: "media" },
      { name: "Едим дома", url: "https://www.edimdoma.ru/", group: "media" },
      { name: "Рамблер/еда", url: "https://eda.rambler.ru/", group: "media" },
      { name: "Food.ru", url: "https://food.ru/", group: "media" },
      { name: "TODAY Food", url: "https://www.today.com/food", group: "media" },
      { name: "Allrecipes", url: "https://www.allrecipes.com/", group: "media" }
    ],
    disable: [
      "https://www.restaurantbusinessonline.com/",
      "https://www.nrn.com/",
      "https://www.foodnavigator.com/",
      "https://vc.ru/retail",
      "https://www.kommersant.ru/rubric/4",
      "https://ria.ru/society/",
      "https://iz.ru/rubric/obshchestvo",
      "https://www.euronews.com/culture"
    ]
  },
  shopping: {
    add: [
      { name: "Ozon (Telegram)", url: "https://t.me/s/ozonru", group: "creator" },
      { name: "Авито (Telegram)", url: "https://t.me/s/avito", group: "creator" },
      { name: "WB Sniper (Telegram)", url: "https://t.me/s/wbsniper", group: "creator" },
      { name: "Роскачество", url: "https://roskachestvo.gov.ru/news/", group: "official" },
      { name: "Лайфхакер", url: "https://lifehacker.ru/", group: "media" },
      { name: "Т—Ж", url: "https://t-j.ru/", group: "media" }
    ],
    disable: [
      "https://vc.ru/marketplace",
      "https://lenta.ru/rubrics/economics/",
      "https://ria.ru/economy/",
      "https://hightech.fm/",
      "https://3dnews.ru/news/",
      "https://www.theverge.com/tech",
      "https://www.engadget.com/",
      "https://www.digitalcommerce360.com/",
      "https://www.modernretail.co/",
      "https://techcrunch.com/category/commerce/",
      "https://iz.ru/rubric/ekonomika",
      "https://www.interfax.ru/business/",
      "https://www.cnews.ru/news",
      "https://overclockers.ru/",
      "https://www.iphones.ru/",
      "https://www.computerra.ru/",
      "https://www.wired.com/category/gear/",
      "https://www.androidauthority.com/news/",
      "https://9to5google.com/",
      "https://www.businessinsider.com/retail",
      "https://t.me/s/rozetked",
      "https://t.me/s/wylsared"
    ]
  },
  home: {
    add: [
      { name: "Идеи вашего дома", url: "https://www.ivd.ru/", group: "media" },
      { name: "INMYROOM (Telegram)", url: "https://t.me/s/inmyroom", group: "creator" },
      { name: "Идеи вашего дома (Telegram)", url: "https://t.me/s/ivd_ru", group: "creator" },
      { name: "Старший по дому | ЖКХ (Telegram)", url: "https://t.me/s/starshijpodomu", group: "creator" },
      { name: "ЖКХ Ньюс (Telegram)", url: "https://t.me/s/gkhnewsru", group: "creator" }
    ],
    disable: [
      "https://realty.yandex.ru/journal/",
      "https://iz.ru/rubric/nedvizhimost",
      "https://www.vedomosti.ru/realty",
      "https://www.kommersant.ru/rubric/5",
      "https://t.me/s/domclick"
    ]
  }
};

// v0.45.1 — «Что там в интернете?»: sources that tell viral stories with context
// instead of bare memes. Disable: meme-only channels (no story → skipped by the
// editor, each skip still costs a model call), social-media industry news (off-topic).
export const INTERNET_SOURCE_FIX_V0451 = {
  add: [
    { name: "Лента.ру — Интернет и СМИ", url: "https://lenta.ru/rubrics/media/", group: "media" },
    { name: "Афиша Daily — новости", url: "https://daily.afisha.ru/news/", group: "media" },
    { name: "Газета.Ru — Социальные сети", url: "https://www.gazeta.ru/social/", group: "media" },
    { name: "Пикабу — лучшее за сутки", url: "https://pikabu.ru/best", group: "media" },
    { name: "UNILAD", url: "https://www.unilad.com/news", group: "media" },
    { name: "LADbible", url: "https://www.ladbible.com/news", group: "media" },
    { name: "indy100", url: "https://www.indy100.com/", group: "media" },
    { name: "Dexerto — TikTok", url: "https://www.dexerto.com/tiktok/", group: "media" },
    { name: "Mashable — Culture", url: "https://mashable.com/culture", group: "media" },
    { name: "Metro — Weird", url: "https://metro.co.uk/news/weird/", group: "media" },
    { name: "Oddity Central", url: "https://www.odditycentral.com/", group: "media" },
    { name: "UPI — Odd News", url: "https://www.upi.com/Odd_News/", group: "media" }
  ],
  disable: [
    "https://t.me/s/reels_memes",
    "https://t.me/s/kruglyashiki",
    "https://t.me/s/memachh",
    "https://t.me/s/community_memy",
    "https://t.me/s/twitt_ota",
    "https://www.tubefilter.com/",
    "https://www.socialmediatoday.com/",
    "https://www.theverge.com/social-media",
    "https://www.boredpanda.com/"
  ]
};

// v0.51.3 — «Что там для дома?»: 10 themes, sources tagged by theme (rubric). Off-topic sources (real-estate market,
// gadget/IT news, city/agency news, ЖКХ) are paused and blocked for discovery; the niche's biggest Telegram channels
// and home media are added per theme; sources already kept get their theme by URL (assign).
export const HOME_RUBRIC_SOURCES_V0513 = {
  add: [
    { rubric: "marketplace_finds", name: "Alexis_home (Telegram)", url: "https://t.me/s/alexis_home", group: "creator" },
    { rubric: "marketplace_finds", name: "Уютиль — интересные находки (Telegram)", url: "https://t.me/s/ahuytno", group: "creator" },
    { rubric: "marketplace_finds", name: "Нам такое надо! (Telegram)", url: "https://t.me/s/gdekupilakatya", group: "creator" },
    { rubric: "marketplace_finds", name: "Находки для дома с WB и ОЗОН (Telegram)", url: "https://t.me/s/pin_room", group: "creator" },
    { rubric: "marketplace_finds", name: "MY HOME (Telegram)", url: "https://t.me/s/MyHomeFinds", group: "creator" },
    { rubric: "before_after", name: "Квартира в порядке (Telegram)", url: "https://t.me/s/laifkhaky_remont_interero", group: "creator" },
    { rubric: "before_after", name: "Идеи дизайна интерьера (Telegram)", url: "https://t.me/s/dsgn_interior", group: "creator" },
    { rubric: "before_after", name: "Дизигн интерьера (Telegram)", url: "https://t.me/s/desingokey", group: "creator" },
    { rubric: "before_after", name: "Идеи дизайна интерьера 🏡 (Telegram)", url: "https://t.me/s/interdizru", group: "creator" },
    { rubric: "before_after", name: "INMYROOM (Telegram)", url: "https://t.me/s/inmyroom", group: "creator" },
    { rubric: "home_appliances", name: "Хитрости дизайна и уюта (Telegram)", url: "https://t.me/s/HomeDesignLife", group: "creator" },
    { rubric: "home_appliances", name: "The Verge — Smart Home", url: "https://www.theverge.com/smart-home", group: "media" },
    { rubric: "storage", name: "Дом минималиста (Telegram)", url: "https://t.me/s/minimalist_dom", group: "creator" },
    { rubric: "storage", name: "Идеи вашего дома (Telegram)", url: "https://t.me/s/ivd_ru", group: "creator" },
    { rubric: "storage", name: "Real Simple — Organizing", url: "https://www.realsimple.com/home-organizing", group: "media" },
    { rubric: "storage", name: "Дом Mail", url: "https://dom.mail.ru/", group: "media" },
    { rubric: "small_space_furniture", name: "Идеи дизайна (Telegram)", url: "https://t.me/s/ideas_of_design", group: "creator" },
    { rubric: "small_space_furniture", name: "Эстетика в деталях (Telegram)", url: "https://t.me/s/design_andrey", group: "creator" },
    { rubric: "budget_cozy", name: "торшерчики & фужерчики (Telegram)", url: "https://t.me/s/not_ikea", group: "creator" },
    { rubric: "budget_cozy", name: "COZY HOME (Telegram)", url: "https://t.me/s/cozyhomerus", group: "creator" },
    { rubric: "budget_cozy", name: "Алиэкспресс Home (Telegram)", url: "https://t.me/s/aliehome", group: "creator" },
    { rubric: "budget_cozy", name: "Home Look (Telegram)", url: "https://t.me/s/homelook", group: "creator" },
    { rubric: "budget_cozy", name: "Home Wish List (Telegram)", url: "https://t.me/s/homewishlist", group: "creator" },
    { rubric: "cleaning_hacks", name: "Лайфхакер", url: "https://lifehacker.ru/", group: "media" },
    { rubric: "cleaning_hacks", name: "Домашний очаг — Дом", url: "https://www.goodhouse.ru/home/", group: "media" },
    { rubric: "cleaning_hacks", name: "Real Simple — Cleaning", url: "https://www.realsimple.com/home-organizing/cleaning", group: "media" },
    { rubric: "diy_repair", name: "Дизайн и ремонт (Telegram)", url: "https://t.me/s/decor_journal", group: "creator" },
    { rubric: "diy_repair", name: "материал, найдись! (Telegram)", url: "https://t.me/s/mtrl_mag", group: "creator" },
    { rubric: "diy_repair", name: "Bob Vila", url: "https://www.bobvila.com/", group: "media" },
    { rubric: "interior_trends", name: "Design Mate (Telegram)", url: "https://t.me/s/designmate", group: "creator" },
    { rubric: "interior_trends", name: "Идеи вашего дома", url: "https://www.ivd.ru/", group: "media" },
    { rubric: "kitchen", name: "The Kitchn", url: "https://www.thekitchn.com/", group: "media" }
  ],
  // sources the channel already has: theme by URL
  assign: {
    "https://www.salon.ru/news": "interior_trends",
    "https://design-mate.ru/read": "interior_trends",
    "https://www.homesandgardens.com/news": "interior_trends",
    "https://www.inmyroom.ru/news": "before_after",
    "https://www.realhomes.com/news": "kitchen",
    "https://www.idealhome.co.uk/news": "kitchen",
    "https://www.tomsguide.com/home/smart-home/news": "home_appliances",
    "https://www.engadget.com/home/": "home_appliances",
    "https://www.wired.com/tag/smart-home/": "home_appliances",
    "https://www.ikea.com/global/en/newsroom/": "small_space_furniture",
    "https://www.dwell.com/": "small_space_furniture",
    "https://www.housebeautiful.com/home-remodeling/": "diy_repair",
    "https://www.homebuilding.co.uk/news": "diy_repair"
  },
  disable: [
    "https://realty.rbc.ru/news/", "https://realty.ria.ru/", "https://realty.yandex.ru/journal/", "https://iz.ru/rubric/nedvizhimost",
    "https://www.vedomosti.ru/realty", "https://www.kommersant.ru/rubric/5", "https://lenta.ru/rubrics/realty/", "https://t.me/s/domclick",
    "https://t.me/s/cian_ru", "https://t.me/s/yandexrealty", "https://tass.ru/nedvizhimost", "https://asninfo.ru/news", "https://aif.ru/realty",
    "https://archi.ru/news/", "https://hi-tech.mail.ru/news/", "https://3dnews.ru/news/", "https://4pda.to/news/", "https://ichip.ru/novosti",
    "https://news.samsung.com/global/", "https://www.mvideoeldorado.ru/ru/press-center", "https://www.company.rt.ru/press/news/",
    "https://www.tadviser.ru/index.php/Новости", "https://csa-iot.org/newsroom/", "https://www.the-ambient.com/news", "https://www.retail.ru/news/",
    "https://www.mos.ru/news/", "https://mchs.gov.ru/deyatelnost/press-centr/novosti", "https://t.me/s/mchs_official", "https://t.me/s/fasrussia",
    "https://t.me/s/minstroyrf", "https://minstroyrf.gov.ru/press/", "https://rosreestr.gov.ru/press/archive/",
    // ЖКХ is out of the channel (editor, 2026-10-04)
    "https://riamo.ru/tag/zhkh/", "https://gkhnews.ru/", "https://t.me/s/gkhnewsru", "https://t.me/s/starshijpodomu", "https://www.reformagkh.ru/news",
    "https://rg.ru/tema/ekonomika/zhkh", "https://xn--b1agapfwapgcl.xn--p1ai/news/", "https://всеостройке.рф/news/"
  ]
};


// v0.52.6: approved source structure for «Что там с деньгами?».
// A physical source may feed several rubrics; the rubrics array avoids fetching the same Telegram channel several times.
export const MONEY_RUBRIC_SOURCES_V0526 = {
  add: [
    { name: "Банки.ру", url: "https://t.me/s/bankiruofficial", group: "media", rubrics: ["cards_banks","deposits","credits_mortgage","ruble_inflation_cb","money_howto"] },
    { name: "Frank Media", url: "https://t.me/s/frank_media", group: "media", rubrics: ["cards_banks"] },
    { name: "Банк России", url: "https://t.me/s/centralbank_russia", group: "official", rubrics: ["cards_banks","deposits","ruble_inflation_cb","financial_scams"] },
    { name: "MarketOverview", url: "https://t.me/s/MarketOverview", group: "media", rubrics: ["cards_banks","deposits","ruble_inflation_cb"] },
    { name: "Финуслуги", url: "https://t.me/s/MoexFinuslugi", group: "media", rubrics: ["cards_banks","deposits","money_howto"] },
    { name: "Банкир — вклады и банки", url: "https://t.me/s/blogbankir", group: "creator", rubrics: ["deposits"] },

    { name: "Домклик", url: "https://t.me/s/domclick", group: "official", rubrics: ["credits_mortgage"] },
    { name: "Ипотека и недвижимость", url: "https://t.me/s/ipotekahouse", group: "creator", rubrics: ["credits_mortgage"] },
    { name: "СПРОСИ.ДОМ.РФ", url: "https://t.me/s/sprosidomrf", group: "official", rubrics: ["credits_mortgage"] },
    { name: "IT + банки: ипотека", url: "https://t.me/s/IT_ipoteka", group: "creator", rubrics: ["credits_mortgage"] },

    { name: "ФНС России", url: "https://t.me/s/nalog_gov_ru", group: "official", rubrics: ["taxes"] },
    { name: "ЛИЧНЫЕ НАЛОГИ", url: "https://t.me/s/persontaxes", group: "creator", rubrics: ["taxes"] },
    { name: "Минфин России", url: "https://t.me/s/minfin", group: "official", rubrics: ["taxes"] },
    { name: "Мои финансы", url: "https://t.me/s/FinZozhExpert", group: "official", rubrics: ["taxes","income_benefits","money_howto"] },
    { name: "Госуслуги", url: "https://t.me/s/gosuslugi", group: "official", rubrics: ["taxes","income_benefits","money_howto"] },

    { name: "Твердые цифры", url: "https://t.me/s/xtxixty", group: "creator", rubrics: ["ruble_inflation_cb"] },
    { name: "MMI", url: "https://t.me/s/russianmacro", group: "creator", rubrics: ["ruble_inflation_cb"] },
    { name: "Простая экономика", url: "https://t.me/s/prostoecon", group: "creator", rubrics: ["ruble_inflation_cb"] },

    { name: "Социальный фонд России", url: "https://t.me/s/sfr_gov", group: "official", rubrics: ["income_benefits"] },
    { name: "Соцфонд.Контекст", url: "https://t.me/s/socfond_kontekst", group: "official", rubrics: ["income_benefits"] },
    { name: "Минтруд России", url: "https://t.me/s/mintrudrf", group: "official", rubrics: ["income_benefits"] },
    { name: "Роструд", url: "https://t.me/s/rostrud_official", group: "official", rubrics: ["income_benefits"] },
    { name: "Объясняем.рф", url: "https://t.me/s/obyasnayemrf", group: "official", rubrics: ["income_benefits"] },

    { name: "Вестник Киберполиции России", url: "https://t.me/s/cyberpolice_rus", group: "official", rubrics: ["financial_scams"] },
    { name: "МОШЕЛОВКА.РФ", url: "https://t.me/s/moshelovka", group: "creator", rubrics: ["financial_scams"] },
    { name: "Финансовая культура", url: "https://t.me/s/fincult_info", group: "official", rubrics: ["financial_scams","money_howto"] },
    { name: "МВД МЕДИА", url: "https://t.me/s/mediamvd", group: "official", rubrics: ["financial_scams"] }
  ],
  disable: [
    "https://t.me/s/forbesrussia",
    "https://t.me/s/rian_ru",
    "https://svpressa.ru/economy/",
    "https://nsn.fm/economy"
  ]
};

// v0.53.0: approved source structures for «Что там у тачек?» and «Что там с покупками?».
// Sources may feed several rubrics; production validates every new URL before enabling it.
export const AUTO_RUBRIC_SOURCES_V0530 = {
  add: [
    { name: "Autonews.ru", url: "https://www.autonews.ru/", group: "media", rubrics: ["premieres","russia_market","china","driver_important"] },
    { name: "Motor.ru", url: "https://motor.ru/", group: "media", rubrics: ["premieres","russia_market","china","viral_unusual"] },
    { name: "Drom Новости", url: "https://news.drom.ru/", group: "media", rubrics: ["russia_market","china","driver_important"] },
    { name: "За рулём", url: "https://www.zr.ru/", group: "media", rubrics: ["premieres","russia_market","driver_important","auto_tech"] },
    { name: "Автостат", url: "https://www.autostat.ru/news/", group: "media", rubrics: ["russia_market","china"] },
    { name: "Колёса.ру", url: "https://www.kolesa.ru/news", group: "media", rubrics: ["premieres","russia_market","driver_important"] },
    { name: "Авторевю", url: "https://autoreview.ru/news", group: "media", rubrics: ["premieres","russia_market","china","auto_tech"] },
    { name: "CarNewsChina", url: "https://carnewschina.com/", group: "media", rubrics: ["china","premieres","ev_hybrid","auto_tech"] },
    { name: "CnEVPost", url: "https://cnevpost.com/", group: "media", rubrics: ["china","ev_hybrid","auto_tech"] },
    { name: "Electrek", url: "https://electrek.co/", group: "media", rubrics: ["ev_hybrid","auto_tech"] },
    { name: "InsideEVs", url: "https://insideevs.com/news/", group: "media", rubrics: ["ev_hybrid","premieres","auto_tech"] },
    { name: "Carscoops", url: "https://www.carscoops.com/category/news/", group: "media", rubrics: ["premieres","viral_unusual","auto_tech"] },
    { name: "Top Gear", url: "https://www.topgear.com/car-news", group: "media", rubrics: ["premieres","viral_unusual"] },
    { name: "The Drive", url: "https://www.thedrive.com/news", group: "media", rubrics: ["viral_unusual","auto_tech","premieres"] },
    { name: "BYD Global", url: "https://www.bydglobal.com/en/news", group: "official", rubrics: ["china","ev_hybrid","premieres"] },
    { name: "Geely Newsroom", url: "https://newsroom.geely.com/", group: "official", rubrics: ["china","premieres","auto_tech"] },
    { name: "Chery International", url: "https://www.cheryinternational.com/", group: "official", rubrics: ["china","premieres"] },
    { name: "GWM Global", url: "https://www.gwm-global.com/news/", group: "official", rubrics: ["china","premieres"] },

    { name: "Ильдар Авто-подбор", url: "https://t.me/s/ildar_auto_podbor", group: "creator", rubrics: ["bloggers_tests","viral_unusual"] },
    { name: "Александр Булкин", url: "https://t.me/s/bulkin_live", group: "creator", rubrics: ["bloggers_tests","viral_unusual"] },
    { name: "Михеев и Павлов", url: "https://t.me/s/miheevpavlov_pro", group: "creator", rubrics: ["bloggers_tests"] },
    { name: "Туман", url: "https://t.me/s/sashatyman", group: "creator", rubrics: ["bloggers_tests","viral_unusual"] },
    { name: "AcademeG", url: "https://t.me/s/academeg_true_original", group: "creator", rubrics: ["bloggers_tests","viral_unusual"] },
    { name: "Клубный Сервис", url: "https://t.me/s/klubniy_servis", group: "creator", rubrics: ["bloggers_tests","russia_market"] },
    { name: "Гараж 54", url: "https://t.me/s/garage54official", group: "creator", rubrics: ["bloggers_tests","viral_unusual"] },
    { name: "Жекич Дубровский", url: "https://t.me/s/dubrovskiy_444", group: "creator", rubrics: ["bloggers_tests","viral_unusual"] },
    { name: "Иван Зенкевич", url: "https://t.me/s/ivanzenkevich0", group: "creator", rubrics: ["bloggers_tests"] },
    { name: "Денис Механик", url: "https://t.me/s/denismehanik", group: "creator", rubrics: ["bloggers_tests","driver_important"] }
  ],
  disable: [
    "https://t.me/s/Strekalovsky",
    "https://t.me/s/pel_video",
    "https://t.me/s/lisacars",
    "https://t.me/s/anton_avtoman"
  ]
};

export const SHOPPING_RUBRIC_SOURCES_V0530 = {
  add: [
    { name: "Wildberries", url: "https://t.me/s/wildberriesru_official", group: "official", rubrics: ["wildberries","viral_products"] },
    { name: "Wildberries Халява", url: "https://t.me/s/wildberries_xalyava", group: "creator", rubrics: ["wildberries","viral_products"] },
    { name: "Находки с Wildberries", url: "https://t.me/s/HaxoDkiWBs", group: "creator", rubrics: ["wildberries","viral_products"] },
    { name: "Империя Wildberries", url: "https://t.me/s/imperia_wb", group: "creator", rubrics: ["wildberries"] },
    { name: "Скидки Ozon/WB", url: "https://t.me/s/skidki_ozon_wb_mm", group: "creator", rubrics: ["wildberries","ozon","viral_products"] },

    { name: "Ozon", url: "https://t.me/s/ozonru", group: "official", rubrics: ["ozon","viral_products"] },
    { name: "Ozon скидки", url: "https://t.me/s/ozon_skidki0", group: "creator", rubrics: ["ozon","viral_products"] },
    { name: "Промокоды и находки Ozon", url: "https://t.me/s/promokody_ozon", group: "creator", rubrics: ["ozon"] },

    { name: "Яндекс Маркет", url: "https://t.me/s/yndx_market", group: "official", rubrics: ["yandex_market","viral_products"] },
    { name: "Яндекс Маркет — акции и находки", url: "https://t.me/s/yandex_market_proms", group: "creator", rubrics: ["yandex_market"] },
    { name: "Путеводитель Яндекс Маркет", url: "https://t.me/s/putevoditel_yandeksmarket", group: "creator", rubrics: ["yandex_market"] },
    { name: "Беру на всё", url: "https://t.me/s/berunavse", group: "creator", rubrics: ["yandex_market","viral_products"] },

    { name: "AliExpress Россия", url: "https://t.me/s/AliExpressofficial_channel", group: "official", rubrics: ["aliexpress","viral_products"] },
    { name: "AliExpress — Лайфхакер", url: "https://t.me/s/aliexprs", group: "creator", rubrics: ["aliexpress","viral_products"] },
    { name: "Халявщики AliExpress", url: "https://t.me/s/HalyavshikiAli", group: "creator", rubrics: ["aliexpress"] },
    { name: "AliExpress обзоры", url: "https://t.me/s/alliobzor", group: "creator", rubrics: ["aliexpress"] },

    { name: "Pepper", url: "https://www.pepper.ru/", group: "community", rubrics: ["wildberries","ozon","yandex_market","aliexpress","viral_products"] }
  ],
  disable: [
    "https://www.retail.ru/news/",
    "https://vc.ru/marketplace",
    "https://vc.ru/retail",
    "https://www.rbc.ru/business/",
    "https://www.vedomosti.ru/business/consumer",
    "https://www.kommersant.ru/rubric/4",
    "https://www.sostav.ru/news/",
    "https://rb.ru/tag/e-commerce/",
    "https://www.marketplacepulse.com/articles"
  ]
};

