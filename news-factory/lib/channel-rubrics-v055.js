// v0.55.0: «по группам» — подтемы (рубрики) для десяти каналов, утверждённые владельцем.
//
// perDay — сколько постов в сутки получает рубрика; сумма по каналу = число слотов в сутки (slotHours).
// Квота мягкая: планировщик сначала берёт рубрики, у которых за сегодня ещё не набран perDay, но канал
// никогда не остаётся без поста из-за пустой рубрики (в отличие от жёстких slotRubrics у «Тачек»).
// keywords — только для разовой раскладки УЖЕ существующих источников по рубрикам (имя + URL, нижний регистр).
// Источники без совпадения остаются как есть (без рубрики): они продолжают работать, ничего не теряется.

export const RUBRICS_V055_MIGRATION = "v0.55.0-rubrics";

// Каналы на удаление (по просьбе владельца): архив состояния в /data, затем снятие с кабинета.
// Сами Telegram-каналы не затрагиваются.
export const REMOVED_CHANNELS_V055 = ["chtotampokupki", "chtotamnauka", "chtotamnews"];
// v0.60.3: «Деньги» закрыт владельцем (группы в VK и Telegram удалены).
export const REMOVED_CHANNELS_V060 = ["chtotamdengi"];
// v0.71.6: «Бизнес», «Еда», «Дом» убраны владельцем (слабые, неинтересные). Архив состояния в /data, Telegram-каналы не трогаем.
export const REMOVED_CHANNELS_V0716 = ["chtotambusiness", "chtotameda", "chtotamdom"];

// Хвост полного названия: «<прежнее название> | <тема>». Голова (до « | ») не меняется — по ней сопоставляется VK.
export const CHANNEL_NAME_TAILS_V055 = {
  ai: "нейросети и ИИ",
  tech: "смартфоны, гаджеты, приложения",
  games: "игры и игровое сообщество",
  kino: "кино и сериалы",
  sport: "футбол, хоккей, UFC и ММА",
  stars: "звёзды, шоу и музыка",
  travel: "путешествия и поездки",
  food: "еда, рецепты и вирусные блюда",
  business: "бизнес и предприниматели",
  crypto: "криптовалюты для обычных людей"
};

function hours(drop) {
  const skip = new Set(drop || []);
  const out = [];
  for (let h = 8; h <= 23; h += 1) if (!skip.has(h)) out.push(h);
  return out;
}

function r(id, label, perDay, hint, keywords) {
  return { rubric: { id: id, label: label, hint: hint, perDay: perDay }, keywords: keywords || [] };
}

const BLOGGERS = ["блогер", "creator", "youtube", "ютуб"];

export const RUBRIC_PLAN_V055 = {
  ai: {
    slotHours: hours([8, 13, 16, 23]), // 12
    rubrics: [
      r("companies_models", "Компании и модели", 3, "новые модели и версии, OpenAI, Anthropic, Google, Meta, xAI, DeepSeek и другие; что изменилось для обычного человека", ["openai", "anthropic", "google", "gemini", "deepmind", "nvidia", "meta", "deepseek", "ai_newz", "data_secrets", "techcrunch", "verge"]),
      r("viral_fun", "Вирусное и приколы", 3, "ИИ-ролики и фото, которые разлетелись, эксперименты людей с нейросетями, смешное", ["neuralshit", "cgevent", "psy_eyes", "aivideo", "chatgpt", "meme", "futurism", "404media", "knowyourmeme", "вирус", "завирус", "ролик", "мем", "тренд"]),
      r("services_hacks", "Сервисы и лайфхаки", 2, "новые ИИ-сервисы и приложения, как их использовать, полезные приёмы с нейросетями", ["lifehacker", "denissexy", "tool", "prompt", "app"]),
      r("russia_ai", "ИИ в России", 2, "GigaChat, YandexGPT, Алиса, ИИ в российских компаниях и госструктурах, российские стартапы", ["yandex", "яндекс", "gigachat", "сбер", "sber", "россии", "russia", "tadviser", "cnews", "vc.ru"]),
      r("robots_hardware", "Роботы и железо", 1, "роботы, гуманоиды, чипы для ИИ, ИИ-устройства", ["robot", "робот", "nvidia", "чип", "hardware"]),
      r("law_ethics", "Законы, этика, скандалы", 1, "регулирование ИИ, иски, дипфейки, утечки, споры об этике", ["law", "закон", "ethic", "этик", "регулир"])
    ]
  },
  tech: {
    slotHours: hours([14]), // 15
    rubrics: [
      r("smartphones", "Смартфоны", 3, "новые смартфоны, обновления iOS и Android, утечки, сравнения", ["iphone", "apple", "samsung", "xiaomi", "смартфон", "android", "ios", "gsmarena", "4pda"]),
      r("apps", "Приложения", 2, "приложения и сервисы, обновления, новые функции, что стоит поставить", ["app", "прилож", "telegram", "whatsapp", "max"]),
      r("gadgets", "Гаджеты", 2, "наушники, часы, умный дом, необычные гаджеты, тесты", ["gadget", "гаджет", "ixbt", "overclockers", "wearable"]),
      r("pc_hardware", "Железо и ПК", 1, "процессоры, видеокарты, ноутбуки, комплектующие", ["nvidia", "amd", "intel", "ноутбук", "железо", "overclockers", "3dnews", "hardware"]),
      r("internet_russia", "Интернет и связь в России", 2, "мобильная связь, интернет, блокировки, ограничения, тарифы, операторы", ["мтс", "мегафон", "билайн", "роскомнадзор", "связь", "интернет", "tele2", "cnews"]),
      r("security", "Безопасность", 1, "уязвимости, утечки, мошенничество в сети, защита аккаунтов", ["secur", "безопас", "антивирус", "kaspersky", "лаборатория", "habr"]),
      r("unusual_tech", "Необычное", 1, "странные и неожиданные технологии, эксперименты, необычные изобретения", ["unusual", "необыч", "interesting", "futurism"]),
      r("tech_bloggers", "Блогеры", 3, "обзоры и истории технических блогеров, их тесты и мнения, самостоятельные инфоповоды", BLOGGERS)
    ]
  },
  games: {
    slotHours: hours([8, 15]), // 14
    rubrics: [
      r("releases", "Релизы", 3, "выходы игр, даты, трейлеры, оценки, первые впечатления", ["релиз", "выход", "вышла", "вышел", "stopgame", "playground", "gamespot", "ign.com", "dtf"]),
      r("community_memes", "Сообщество и мемы", 3, "мемы и истории игрового сообщества, что обсуждают игроки", ["meme", "мем", "reddit", "pikabu", "пикабу", "community"]),
      r("game_bloggers", "Блогеры", 4, "стримеры и ютуберы про игры, их истории, ролики и события", BLOGGERS),
      r("updates", "Обновления", 1, "патчи, сезоны, крупные обновления популярных игр", ["patch", "обновл", "update"]),
      r("discounts", "Скидки", 1, "распродажи, раздачи, подарки в магазинах игр", ["скидк", "sale", "раздач", "deal", "steam"]),
      r("scandals", "Скандалы", 1, "скандалы в индустрии, увольнения, споры игроков и студий", ["scandal", "скандал"]),
      r("rumors", "Слухи", 1, "утечки и слухи о новых играх и консолях", ["leak", "утечк", "слух", "rumor"])
    ]
  },
  kino: {
    slotHours: hours([9, 23]), // 14
    rubrics: [
      r("premieres", "Премьеры", 2, "выход фильмов в прокате и онлайн, даты, кассовые сборы", ["kinopoisk", "кинопоиск", "premier", "премьер", "афиша", "kinoafisha", "boxoffice"]),
      r("trailers", "Трейлеры", 2, "новые трейлеры и тизеры, что в них показали", ["trailer", "трейлер", "teaser"]),
      r("series_streaming", "Сериалы и стриминги", 2, "новые сериалы, сезоны, Netflix, Кинопоиск, Иви и другие платформы", ["netflix", "сериал", "series", "ivi", "иви", "okko", "стриминг", "hbo"]),
      r("reactions", "Реакции", 2, "реакции зрителей и критиков, споры о фильмах, мемы про кино", ["meme", "мем", "reaction", "реакци", "reddit"]),
      r("backstage_casting", "Закулисье и кастинг", 2, "съёмки, кастинг, интервью, истории создания фильмов", ["variety", "deadline", "hollywood", "кастинг", "съёмк", "empire"]),
      r("what_to_watch", "Что посмотреть", 2, "подборки и рекомендации на вечер", ["подборк", "что посмотреть", "watch"]),
      r("kino_bloggers", "Блогеры", 2, "киноблогеры и обзорщики, их разборы и мнения", BLOGGERS)
    ]
  },
  sport: {
    slotHours: hours([]), // 16
    rubrics: [
      r("football", "Футбол", 3, "РПЛ, еврокубки, сборные, трансферы, громкие матчи", ["футбол", "football", "рпл", "sports.ru", "championat", "чемпионат", "uefa", "fifa"]),
      r("hockey", "Хоккей", 2, "КХЛ, НХЛ, сборные, громкие матчи", ["хоккей", "hockey", "кхл", "нхл", "nhl"]),
      r("ufc_mma", "UFC и ММА", 3, "UFC, бои, кард, интервью бойцов, скандалы и громкие нокауты", ["ufc", "mma", "ммa", "мма", "нокаут", "боец", "бойц"]),
      r("boxing", "Бокс", 1, "громкие бои, чемпионы, анонсы", ["бокс", "boxing"]),
      r("pop_mma", "Поп-ММА", 2, "Хардкор, TOP DOG, Бойцовский клуб, поп-бои блогеров и их скандалы", ["hardcore", "хардкор", "top dog", "поп-ммa", "поп-мма", "наказание"]),
      r("media_football", "Медиафутбол", 2, "медийные лиги и турниры, блогеры-футболисты", ["медиа", "amkal", "амкал", "2drots", "ligue", "лига"]),
      r("sport_shows", "Шоу", 1, "спортивные шоу и необычные форматы", ["show", "шоу"]),
      r("sport_viral", "Вирусное", 1, "вирусные спортивные видео, курьёзы, необычные моменты", ["viral", "вирус", "курьёз", "fail"]),
      r("sport_bloggers", "Блогеры", 1, "спортивные блогеры и их истории", BLOGGERS)
    ]
  },
  stars: {
    slotHours: hours([8, 16]), // 14
    rubrics: [
      r("social_events", "Соцсети, блогеры и события", 4, "что звёзды и блогеры выложили и сделали, громкие события и светская хроника", ["instagram", "соцсет", "блогер", "creator", "светск", "starhit", "woman.ru", "teleprogramma"]),
      r("shows_performances", "Выступления и шоу", 2, "концерты, телешоу, выступления, номинации", ["шоу", "show", "концерт", "tnt", "тнт", "первый", "ctc", "стс"]),
      r("looks", "Образы", 2, "наряды, красные дорожки, стиль и причёски звёзд", ["look", "образ", "style", "стиль", "vogue", "fashion", "красн"]),
      r("celeb_fun", "Смешное", 2, "забавные случаи со звёздами, мемы, неловкие моменты", ["meme", "мем", "fun", "смешн", "юмор"]),
      r("relationships", "Отношения", 1, "романы, свадьбы, разводы публичных людей", ["отношен", "роман", "свадьб", "развод", "love"]),
      r("music", "Музыка", 3, "новые треки и альбомы, клипы, чарты, события музыкантов", ["music", "музык", "трек", "клип", "чарт", "billboard", "афиша"])
    ]
  },
  travel: {
    slotHours: hours([12, 23]), // 14
    rubrics: [
      r("destinations", "Направления", 2, "куда поехать, сезон, что посмотреть в стране или городе", ["tourism", "travel", "путешеств", "tripadvisor", "tutu", "туту", "lonely", "tourprom", "турпром"]),
      r("unusual_places", "Необычные места", 3, "странные, красивые и малоизвестные места мира", ["unusual", "необыч", "atlas", "obscura", "интересн", "geo"]),
      r("tickets_prices", "Билеты и цены", 2, "авиабилеты, цены, акции, перелёты, новые рейсы", ["авиа", "aviasales", "билет", "flight", "air", "аэро", "ticket"]),
      r("visas", "Визы", 2, "визы, правила въезда, ограничения, документы", ["виз", "visa", "mid.ru", "мид", "въезд"]),
      r("hotels", "Отели", 1, "отели, курорты, новые места проживания, сервисы бронирования", ["hotel", "отел", "booking", "курорт", "ostrovok", "суточно"]),
      r("travel_practice", "Практика", 1, "практические советы: как не ошибиться в поездке, деньги, связь, страховки", ["совет", "лайфхак", "практик", "tips"]),
      r("travel_bloggers", "Блогеры", 3, "тревел-блогеры и их истории, маршруты, находки", BLOGGERS)
    ]
  },
  food: {
    slotHours: hours([10]), // 15
    rubrics: [
      r("viral_dishes", "Вирусные блюда", 3, "блюда и рецепты, которые разлетелись в сети: что приготовили и почему все повторяют", ["viral", "вирус", "tiktok", "тикток", "food", "foodie"]),
      r("easy_recipes", "Простые рецепты", 3, "быстрые и понятные рецепты на каждый день", ["рецепт", "recipe", "povar", "povarenok", "готов", "eda.ru", "1000.menu"]),
      r("desserts", "Десерты", 2, "десерты, выпечка, сладкое", ["десерт", "dessert", "выпечк", "кондитер", "торт", "sweet"]),
      r("unusual_food", "Необычная еда", 2, "странные сочетания, редкие блюда, необычные продукты", ["unusual", "необыч", "странн", "weird"]),
      r("food_bloggers", "Фуд-блогеры", 2, "кулинарные блогеры и их находки, рецепты и эксперименты", BLOGGERS),
      r("world_cuisines", "Кухни мира", 1, "блюда и кухни разных стран", ["cuisine", "кухн", "национальн"]),
      r("food_hacks", "Лайфхаки", 1, "кухонные приёмы и лайфхаки", ["лайфхак", "hack", "совет"]),
      r("food_new_prices", "Новинки и цены", 1, "новые продукты и блюда в магазинах и ресторанах, цены на еду", ["новинк", "цены", "ресторан", "магазин", "price"])
    ]
  },
  business: {
    slotHours: hours([8, 12, 15, 22]), // 12
    rubrics: [
      r("founder_stories", "Истории предпринимателей", 3, "как люди начинали и выросли, неожиданные пути, цифры и выводы", ["founder", "предпринимат", "story", "истори", "forbes", "rb.ru"]),
      r("unusual_models", "Необычные модели", 2, "нестандартные бизнес-модели и идеи, которые неожиданно работают", ["unusual", "необыч", "модел", "idea", "иде"]),
      r("failures", "Провалы", 1, "громкие провалы, закрытия и ошибки компаний, из которых можно извлечь урок", ["fail", "провал", "банкрот", "закрыт"]),
      r("startups_money", "Стартапы и деньги", 2, "инвестиции, раунды, стартапы, сделки и их смысл", ["startup", "стартап", "венчур", "инвест", "techcrunch", "vc.ru"]),
      r("marketplaces", "Маркетплейсы и продавцы", 2, "Wildberries, Ozon, Яндекс Маркет: правила, комиссии, истории продавцов", ["wildberries", "ozon", "озон", "маркетплейс", "селлер", "seller"]),
      r("brands_marketing", "Бренды и маркетинг", 1, "сильные кампании, ребрендинги, спорная реклама", ["бренд", "brand", "маркетинг", "marketing", "реклам"]),
      r("business_bloggers", "Блогеры", 1, "бизнес-блогеры и их находки", BLOGGERS)
    ]
  },
  crypto: {
    slotHours: hours([13, 16, 20, 23]), // 12
    rubrics: [
      r("bitcoin_market", "Биткоин и рынок", 3, "движение биткоина и рынка, крупные покупки и продажи, прогнозы без воды", ["bitcoin", "биткоин", "btc", "рынок", "market", "coindesk", "cointelegraph", "forklog"]),
      r("eth_ton", "ETH и TON", 2, "Ethereum, TON и экосистемы, обновления, крупные события", ["ethereum", "ethereum", "toncoin", "telegram"]),
      r("hacks_scams", "Взломы и мошенничество", 2, "взломы бирж и протоколов, схемы обмана, как не потерять деньги", ["hack", "взлом", "scam", "мошен", "rekt", "security"]),
      r("regulation", "Регулирование", 1, "законы и ограничения по крипте в России и мире", ["regul", "регул", "закон", "минфин", "sec.gov"]),
      r("crypto_services", "Сервисы", 2, "кошельки, биржи, платёжные сервисы, полезные инструменты", ["wallet", "кошел", "биржа", "exchange", "сервис", "bybit", "binance"]),
      r("crypto_unusual", "Необычное", 1, "странные и неожиданные истории из мира крипты", ["unusual", "необыч", "странн"]),
      r("crypto_bloggers", "Блогеры", 1, "крипто-блогеры и их мнения", BLOGGERS)
    ]
  },
  money: {
    keepSourceLimits: true, // свои лимиты источников (5…6) остаются
    slotHours: hours([8, 12, 14, 15, 17, 19, 21, 23]), // 8
    rubrics: [
      r("cards_banks", "Карты и банки", 1, "карты, переводы, комиссии, блокировки, новые правила банков и платёжных сервисов для физических лиц", ["карт","банк","сбер","тинькофф","т-банк","альфа","втб","перевод","bank"]),
      r("deposits", "Вклады и накопления", 1, "ставки и условия вкладов и накопительных счетов, страхование сбережений, важные изменения у крупных банков", ["вклад","депозит","накоплен","сбережен"]),
      r("credits_mortgage", "Кредиты и ипотека", 1, "ставки, требования банков, льготные программы, досрочное погашение, изменения кредита и ипотеки для физлиц", ["кредит","ипотек","займ","рефинанс"]),
      r("taxes", "Налоги", 1, "НДФЛ, налог на проценты по вкладам, имущество, вычеты, сроки и правила ФНС для физических лиц", ["налог","ндфл","фнс","вычет"]),
      r("ruble_inflation_cb", "Рубль, инфляция и ставка ЦБ", 1, "курс рубля, инфляция и решения Банка России только когда понятно влияние на цены, кредиты или сбережения", ["рубл","инфляц","цб","центробанк","ключев","курс"]),
      r("income_benefits", "Зарплаты, пенсии и выплаты", 1, "зарплаты, МРОТ, индексации, пенсии, пособия, маткапитал и иные выплаты обычным людям", ["зарплат","пенси","пособи","выплат","мрот","маткапитал"]),
      r("financial_scams", "Финансовые мошенники", 1, "новые массовые схемы обмана, карты и переводы, дропперы, фишинг и практическая защита денег", ["мошенник","обман","фишинг","дроппер","схем"]),
      r("money_howto", "Полезно знать", 1, "практические правила: возвраты, страховки, банковские права, ошибки списаний и полезная финансовая грамотность", ["возврат","страхов","права","списан","финансов"])
    ]
  },
  home: {
    keepSourceLimits: true,
    slotHours: hours([8, 11, 14, 16, 20, 23]), // 10
    rubrics: [
      r("marketplace_finds", "Находки с маркетплейсов", 1, "Telegram-каналы и сайты с находками товаров для дома на Wildberries, Ozon, AliExpress: вирусные и необычные вещи для квартиры", ["wildberries","ozon","aliexpress","находк"]),
      r("before_after", "До/после", 1, "Telegram-каналы и сайты с преображениями обычных квартир до/после: маленькие кухни, ванные, комнаты, бюджетный ремонт", ["до и после","преображен","before"]),
      r("home_appliances", "Техника для дома", 1, "сайты и Telegram-каналы об обзорах и новинках бытовой техники для дома: роботы-пылесосы, увлажнители, кухонная техника, умные устройства в продаже", ["техник","пылесос","увлажнител","робот"]),
      r("storage", "Хранение и порядок", 1, "Telegram-каналы и сайты про системы хранения и организацию пространства: шкафы, кухня, прихожая, минимализм", ["хранен","порядок","шкаф","organiz"]),
      r("small_space_furniture", "Мебель и маленькие квартиры", 1, "Telegram-каналы и сайты про мебель-трансформер, зонирование студий и решения для маленьких квартир", ["мебел","трансформер","студи"]),
      r("budget_cozy", "Бюджетный уют", 1, "Telegram-каналы с бюджетными находками для уюта: Фикс Прайс, IKEA, супермаркеты, аналоги дорогих вещей «как на Pinterest»", ["бюджет","икея","ikea","фикс","уют"]),
      r("cleaning_hacks", "Лайфхаки уборки", 1, "Telegram-каналы и сайты с лайфхаками уборки и быта: как отмыть, чем почистить, как сэкономить время", ["уборк","отмыть","чистк","лайфхак"]),
      r("diy_repair", "Ремонт своими руками", 1, "Telegram-каналы и сайты про ремонт своими руками: простые работы без мастера, материалы, ошибки ремонта", ["ремонт","своими руками","diy"]),
      r("interior_trends", "Тренды интерьера", 1, "сайты и Telegram-каналы о трендах интерьера: цвета, декор, мебель сезона, что устарело", ["интерьер","декор","тренд"]),
      r("kitchen", "Кухня и посуда", 1, "сайты и Telegram-каналы про кухню: гаджеты, посуда, организация кухни, кухонные находки", ["кухн","посуд"])
    ]
  }
};

export function isRubricsV055Channel(channelId) {
  return Object.prototype.hasOwnProperty.call(RUBRIC_PLAN_V055, String(channelId || ""));
}

// Один раз при загрузке: рубрики, мягкие квоты, часы слотов и «единый поток» (без отдельных :30-линий)
// записываются в профиль канала. Сами слоты и рубрики в работу включает миграция v0.55.0 (см. server.js).
// money/home: рубрики и теги источников существовали до v0.55 — их текстовый классификатор и разметку источников не трогаем
export function isLegacyThemeChannelV055(channelId) {
  const plan = RUBRIC_PLAN_V055[String(channelId || "")];
  return !!(plan && plan.keepSourceLimits);
}
export function applyRubricPlanV055(channelDna) {
  for (const channelId of Object.keys(RUBRIC_PLAN_V055)) {
    const dna = channelDna[channelId];
    const plan = RUBRIC_PLAN_V055[channelId];
    if (!dna || !plan) continue;
    const total = plan.rubrics.reduce(function(sum, item){ return sum + item.rubric.perDay; }, 0) || 1;
    dna.rubrics = plan.rubrics.map(function(item){ return Object.assign({}, item.rubric); });
    dna.mix = {};
    for (const item of plan.rubrics) dna.mix[item.rubric.id] = item.rubric.perDay / total;
    if (!plan.keepSourceLimits) {
      dna.rubricMinSources = 5;      // минимум 5 источников на рубрику
      dna.rubricMaxSources = 1000;   // максимум не ставим
    }
    dna.slotHours = plan.slotHours.slice();
    dna.unifiedSlots = true;       // блогеры и «российский ИИ» идут в обычных слотах, а не в отдельной :30-линии
    delete dna.slotRubrics;        // жёсткой привязки рубрики к часу нет: квоты мягкие
  }
  return channelDna;
}


// Совпадение с началом слова/токена (после не-буквы), чтобы «ton» не находился в «Washington», а «eth» — в «method».
function escapeRe(text) { return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
export function hasKeywordV055(haystack, word, minLength) {
  const w = String(word || "").toLowerCase();
  if (!w || w.length < (minLength || 3)) return false;
  return new RegExp("(^|[^a-zа-яё0-9])" + escapeRe(w), "i").test(String(haystack || "").toLowerCase());
}

function haystack(source) {
  return (String(source && source.name || "") + " " + String(source && source.url || "")).toLowerCase();
}

// Рубрики для уже существующего источника: блогерские — по группе, остальные — по ключевым словам.
// Пустой результат = источник остаётся без рубрики (продолжает работать).
export function classifySourceV055(channelId, source) {
  const plan = RUBRIC_PLAN_V055[String(channelId || "")];
  if (!plan || !source) return [];
  const text = haystack(source);
  const matched = [];
  const bloggerRubric = plan.rubrics.find(function(item){ return /bloggers$/.test(item.rubric.id) || item.rubric.id === "social_events"; });
  if (source.group === "blogger" && bloggerRubric) return [bloggerRubric.rubric.id];
  for (const item of plan.rubrics) {
    if (item.keywords === BLOGGERS) continue;
    if (item.keywords.some(function(word){ return hasKeywordV055(text, word, 3); })) matched.push(item.rubric.id);
  }
  return matched.slice(0, 3);
}

// Автопауза, снятая после «OpenAI без денег» (балл/ошибки), а не по теме: такие источники возвращаем.
export function shouldRestoreAutoPausedV055(source, nowMs, windowMs) {
  const paused = source && source.autoPaused;
  if (!source || source.enabled || !paused) return false;
  const at = Date.parse(paused.at || "");
  if (!Number.isFinite(at) || nowMs - at > windowMs) return false;
  const reason = String(paused.reason || "");
  if (/не по теме|нет рубрики|не открывается|заменён|каталог без дат|v0\.\d+/i.test(reason)) return false;
  return true;
}

// Рубрика по тексту материала, когда писатель не назвал content_bucket: первая рубрика с совпадением, иначе null.
export function classifyTextV055(channelId, text) {
  const plan = RUBRIC_PLAN_V055[String(channelId || "")];
  if (!plan) return null;
  const hay = String(text || "").toLowerCase();
  for (const item of plan.rubrics) {
    if (item.keywords === BLOGGERS) continue;
    if (item.keywords.some(function(word){ return hasKeywordV055(hay, word, /[а-яё]/.test(word) ? 3 : 4); })) return item.rubric.id;
  }
  return null;
}
