// Channel DNA: what each channel of the network is, beyond "a news channel".
// type: news | news_fun | blogger | trends (see prompts/chto-tam.md, section 9).
// topic: short topic for the headline pre-filter and source discovery.
// focus: extra pre-filter guidance — what besides plain news is worth keeping.

export const CHANNEL_DNA = {
  ai: {
    type: "trends",
    topic: "искусственный интеллект: новости нейросетей и вирусные ИИ-находки — что люди сделали с ИИ, ролики и фото, которые разлетелись, новые ИИ-фильтры и приложения",
    focus: "Кроме новостей компаний оставляй вирусные ИИ-видео и фото, необычные эксперименты людей с нейросетями, новые сервисы, которые все пробуют, приколы с ИИ. Скучные корпоративные пресс-релизы и отчёты о выручке оценивай низко."
  },
  auto: { type: "news_fun", topic: "автомобили, авторынок России и мира" },
  money: { type: "news", topic: "личные финансы в России: курс рубля, ставка ЦБ, вклады, кредиты и ипотека, налоги, цены и инфляция, пенсии" },
  tech: { type: "news", topic: "технологии и гаджеты: смартфоны, Apple, Android, приложения, интернет, связь" },
  games: {
    type: "blogger",
    topic: "видеоигры: релизы, трейлеры, обновления, скидки, слухи и жизнь игрового сообщества",
    focus: "Оставляй и то, что обсуждают игроки: баги, мемы, находки сообщества, скандалы вокруг игр."
  },
  kino: {
    type: "blogger",
    topic: "кино и сериалы: премьеры, трейлеры, стриминги, сборы, кастинг, реакции зрителей",
    focus: "Оставляй и обсуждаемое: первые реакции, провалы и рекорды, неожиданный кастинг, кадры со съёмок, что посмотреть вечером."
  },
  science: { type: "news_fun", topic: "наука: космос, животные, медицина, археология, необычные открытия" },
  sport: {
    type: "news_fun",
    topic: "спорт: российский медийный спорт (поп-ММА — Hardcore, Top Dog, RCC, ACA, Наше Дело, Fight Nights; шоу «Титаны»; медиафутбол — Медиалига, Амкал, 2DROTS; бои блогеров), футбол, хоккей, UFC, бокс",
    focus: "Поп-ММА, медиафутбол, бои блогеров, конфликты бойцов и вирусные спортивные моменты — по теме. Прогнозы на матчи с коэффициентами, промокоды и всё про ставки — отсеивай."
  },
  world: {
    type: "trends",
    topic: "вирусное в интернете: ролики и истории, которые все пересылают, мемы, тренды TikTok, Reels и YouTube, челленджи, интернет-феномены, вирусные приложения; без политики",
    focus: "Это канал «Что там в сети?». Оставляй вирусные истории, мемы с историей, тренды соцсетей, челленджи. Политику, войны, криминал с пострадавшими и обычные мировые новости отсеивай."
  },
  stars: {
    type: "blogger",
    topic: "знаменитости и шоу-бизнес: выступления, проекты, соцсети звёзд, образы, подтверждённые новости об отношениях",
    focus: "Оставляй и то, что звёзды выложили в соцсетях и что обсуждают поклонники. Слухи о здоровье, беременности и детях звёзд отсеивай."
  },
  travel: { type: "news_fun", topic: "путешествия для туристов из России: направления, визы и въезд, авиабилеты, необычные места, цены" },
  shopping: {
    type: "trends",
    topic: "покупки глазами обычного покупателя: распродажи и реальные скидки, интересные и вирусные товары, Ozon, Wildberries, Яндекс Маркет, Авито для покупателей (возвраты, доставка, ПВЗ), магазины, права потребителя, мошенники",
    focus: "Только то, что важно покупателю. Новости для продавцов маркетплейсов (комиссии селлеров, логистика, выручка площадок), обзоры гаджетов и макроэкономику отсеивай."
  },
  home: {
    type: "trends",
    topic: "дом: интерьер, ремонт, организация пространства, бытовая техника, умный дом, ЖКХ для жильцов; недвижимость — немного",
    focus: "Интерьеры, ремонт, до/после, полезные вещи и ЖКХ для жильцов — по теме. Рынок недвижимости для инвесторов и застройщиков (сделки, выручка девелоперов) отсеивай; ипотеку и цены на жильё для людей оставляй, но оценивай ниже."
  },
  food: {
    type: "blogger",
    topic: "еда: вирусные блюда и рецепты-тренды, новинки меню сетей и ресторанов, необычная еда, фуд-блогеры, цены на продукты",
    focus: "Оставляй вирусные рецепты, новинки в меню, необычные продукты и гастротренды. Отраслевые новости (поставки, отчёты ресторанных компаний, регулирование) оценивай низко."
  },
  business: { type: "news", topic: "бизнес: компании, сделки, предприниматели, маркетплейсы для продавцов, бренды" },
  crypto: { type: "news", topic: "криптовалюты для обычных людей: биткоин, Ethereum, TON, крупные движения, взломы, регулирование" }
};

export function channelTopic(channelId) {
  return (CHANNEL_DNA[channelId] && CHANNEL_DNA[channelId].topic) || "";
}

export function channelFocus(channelId) {
  return (CHANNEL_DNA[channelId] && CHANNEL_DNA[channelId].focus) || "";
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
      { name: "Reddit — r/BeAmazed", url: "https://www.reddit.com/r/BeAmazed/top/?t=day", group: "media" }
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
