import { CHANNEL_DNA, SOURCE_CLASSES } from "./channel-dna.js";

const SIGNALS = ["virality", "utility", "discussion", "visual", "wow", "local", "deal"];

function clamp(n, min, max) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : min;
}

function textOf(item) {
  return [item && item.title, item && item.text, item && item.sourceOriginalTitle, item && item.sourceOriginalText]
    .filter(Boolean).join(" ").toLowerCase();
}

function hit(text, re) { return re.test(text) ? 1 : 0; }

export function normalizeSourceClass(value) {
  const v = String(value || "").trim().toUpperCase();
  return SOURCE_CLASSES.includes(v) ? v : "";
}

export function sourceClassFor(source) {
  const s = source || {};
  const explicit = normalizeSourceClass(s.sourceClass || s.source_class || s.editorialClass);
  if (explicit) return explicit;
  const group = String(s.group || s.sourceGroup || "").toLowerCase();
  const url = String(s.url || s.sourceUrl || s.originalUrl || "").toLowerCase();
  const name = String(s.name || s.sourceName || "").toLowerCase();

  if (group === "official") return "OFFICIAL";
  if (group === "community") return "COMMUNITY";
  if (group === "social") return "SOCIAL";
  if (/reddit\.com|pikabu\.ru|4pda\.to\/forum|forum\./.test(url) || /reddit|пикабу|форум|community|комьюнити/.test(name)) return "COMMUNITY";
  if ((/t\.me|telegram\.me/.test(url) && /мем|юмор|твиттота|reels|кругляш|прикол|сообщество/.test(name))) return "COMMUNITY";
  if (/tiktok\.com|youtube\.com|youtu\.be|x\.com|twitter\.com|instagram\.com|vk\.com\/clip|vkvideo\.ru/.test(url)) return "SOCIAL";
  if (group === "blogger" || group === "creator") return "CREATOR";
  if (group === "media") return "MEDIA";
  if (group === "story") return "MEDIA";
  return "MEDIA";
}

const BUCKET_RULES = {
  ai: [
    ["viral_find", /вирус|завирус|ролик|видео|фото|картин|мем|тренд|filter|фильтр|reels|shorts|tiktok|сделал|сгенер/],
    ["useful", /как |инструмент|сервис|приложен|помога|автоматиз|промпт|workflow|бесплатн|доступен/],
    ["fun", /смешн|прикол|странн|курьез|курьёз|абсурд|мем/],
    ["important_news", /.*/]
  ],
  auto: [
    ["driver_important", /штраф|пдд|осаго|техосмотр|топлив|бензин|дизел|водител|правил.*дорог|гибдд|дорог.*правил/],
    ["bloggers_owners", /блогер|владел|отзыв|пробег|эксплуатац|тест-драйв|гараж 54|academeg|булкин|дубровск|ильдар/],
    ["china", /китай|byd|geely|chery|haval|changan|omoda|zeekr|nio|xpeng|gwm/],
    ["ev_hybrid", /электромоб|электрокар|гибрид|батаре|зарядк|запас хода|bev|phev/],
    ["auto_tech", /автопилот|adas|лидар|мультимеди|ассистент.*водител|автотехнолог|безопасност.*систем/],
    ["viral_unusual", /вирус|разлетел|необыч|странн|редк|рекорд|безумн|дрифт|заезд|эксперимент/],
    ["russia_market", /росси|авторынок|продаж.*авто|цена.*авто|локализац|автостат/],
    ["premieres", /.*/]
  ],
  money: [
    ["financial_scams", /мошенн|схем.*обман|фишинг|дроппер|украл|краж|звон.*банк|перев[её]л.*мошенн/],
    ["taxes", /налог|ндфл|фнс|вычет|декларац|имущественн.*налог|транспортн.*налог/],
    ["income_benefits", /зарплат|мрот|пенси|пособ|выплат|маткапитал|больничн|отпускн|индексац/],
    ["credits_mortgage", /ипотек|кредит|за[её]м|досрочн.*погаш|первоначальн.*взнос/],
    ["deposits", /вклад|депозит|накопительн.*сч[её]т|сбережен|страхован.*вклад/],
    ["ruble_inflation_cb", /ключев.*ставк|банк россии|центробанк|цб\b|инфляц|курс.*руб|доллар|евро|юан|рубл.*курс/],
    ["cards_banks", /карт|перевод|комисси|банкомат|сбп|блокиров|банк|плат[её]ж/],
    ["money_howto", /.*/]
  ],
  tech: [
    ["apps", /приложен|app|telegram|android|ios|обновлен|функц/],
    ["useful", /как |фишка|настройк|полезн|режим|совет/],
    ["unusual", /необыч|странн|концепт|прототип|рекорд/],
    ["industry", /рынок|выручк|поставк|производств|завод|доля/],
    ["product", /.*/]
  ],
  games: [
    ["community", /игрок|сообществ|мем|баг|мод|спидран|нашли|форум|reddit/],
    ["video", /трейлер|геймплей|видео|ролик|тизер/],
    ["deal", /скидк|распродаж|бесплатн|раздач|цена/],
    ["drama", /скандал|конфликт|суд|увол|критик|негатив|бойкот/],
    ["release", /.*/]
  ],
  kino: [
    ["trailer", /трейлер|тизер|видео|ролик/],
    ["reaction", /реакц|оценк|рейтинг|зрител|критик|обсужда/],
    ["backstage", /съём|съем|за кадр|кастинг|площадк|production/],
    ["recommendation", /что посмотреть|подборк|топ-|лучшие|вечер/],
    ["release", /.*/]
  ],
  science: [
    ["space", /космос|луна|марс|планет|звезд|астероид|nasa|роскосмос|телескоп/],
    ["animals", /животн|птиц|динозавр|насеком|рыб|вид |эволюц/],
    ["human", /человек|мозг|здоров|медицин|организм|сон|генет/],
    ["future", /материал|квант|энерги|технолог|батаре|робот|будущ/],
    ["wow", /.*/]
  ],
  sport: [
    ["media_sport", /hardcore|top dog|rcc|aca|наше дело|fight nights|титаны|медиалиг|амкал|2drots|блогер/],
    ["viral", /вирус|ролик|видео|конфликт|драка|момент|мем|разлетел/],
    ["mainstream", /.*/]
  ],
  world: [
    ["meme_trend", /мем|тренд|челлендж|шаблон|звук|хэштег/],
    ["video", /ролик|видео|reels|shorts|tiktok|youtube/],
    ["app_phenomenon", /приложен|сервис|сайт|бот|игра|фильтр/],
    ["viral_story", /.*/]
  ],
  stars: [
    ["style", /образ|наряд|плать|стиль|лук|красн.*дорож/],
    ["performance", /концерт|выступ|премьер|шоу|клип|песня|альбом/],
    ["funny", /смешн|курьез|курьёз|мем|шутк|забав/],
    ["relationship", /отношен|роман|свадьб|развод|пара/],
    ["social", /.*/]
  ],
  travel: [
    ["unusual_place", /необыч|место|остров|маршрут|отель|пляж|город|деревн/],
    ["viral_location", /вирус|tiktok|instagram|reels|фото|локац|разлетел/],
    ["deal", /дешев|скидк|билет|тариф|цена|акци/],
    ["rules", /виз|въезд|правил|ограничен|документ|границ/],
    ["practical", /.*/]
  ],
  shopping: [
    ["wildberries", /wildberries|вайлдберриз|\bwb\b/],
    ["ozon", /\bozon\b|озон/],
    ["yandex_market", /яндекс.*маркет|yandex.*market/],
    ["aliexpress", /aliexpress|алиэкспресс|алиэкспрес/],
    ["viral_products", /.*/]
  ],
  home: [
    ["renovation", /ремонт|краск|обои|пол |плитк|сануз|кухн/],
    ["organization", /хранен|организац|порядок|уборк|шкаф|пространств/],
    ["appliance", /техник|холодиль|стирал|пылесос|духов|кофемаш/],
    ["smart_home", /умн.*дом|датчик|ламп|камера|колонк|matter|homekit/],
    ["real_estate", /квартир|недвиж|ипотек|застрой|жиль/],
    ["interior", /.*/]
  ],
  food: [
    ["viral_food", /вирус|тренд|рецепт|tiktok|reels|готовят|блюдо/],
    ["restaurant", /ресторан|кафе|меню|шеф|открыл|мишел/],
    ["unusual", /необыч|странн|новинк|вкус|продукт|гигант/],
    ["creator", /блогер|шеф|автор|канал|видео|ролик/],
    ["prices", /.*/]
  ],
  business: [
    ["founder_story", /основател|предпринимател|истори|запустил|с нуля/],
    ["startup", /стартап|раунд|инвестиц|венчур|оценк/],
    ["failure", /банкрот|закрыл|провал|убыт|сокращен|увол/],
    ["money_scale", /млрд|миллиард|сделк|выручк|прибыл|купил|продал/],
    ["market", /.*/]
  ],
  crypto: [
    ["hack", /взлом|украл|эксплойт|хакер|потерял|утечк/],
    ["regulation", /регулир|закон|запрет|лиценз|налог|цб|sec/],
    ["useful", /сервис|кошелек|кошелёк|перевод|комисси|как /],
    ["unusual", /необыч|странн|рекорд|мем|истори/],
    ["major_market", /.*/]
  ]
};

export function channelMix(channelId) {
  const dna = CHANNEL_DNA[channelId] || {};
  return Object.assign({}, dna.mix || {});
}

export function classifyContentBucket(channelId, item) {
  const mix = channelMix(channelId);
  const explicit = String(
    item && (item.contentBucket || item.content_bucket || (item.editorialV2 && item.editorialV2.contentBucket)) || ""
  ).trim();
  if (explicit && Object.prototype.hasOwnProperty.call(mix, explicit)) return explicit;

  const text = textOf(item);
  const rules = BUCKET_RULES[channelId] || [];
  for (const pair of rules) {
    if (pair[1].test(text)) return pair[0];
  }
  return Object.keys(mix)[0] || "general";
}

export function normalizeChannelSignals(raw, item) {
  const src = raw && typeof raw === "object" ? raw : {};
  const text = textOf(item);
  const media = Boolean(item && (item.videoUrl || item.imageUrl || item.generatedImageUrl || item.originalVideoUrl || item.originalImageUrl));
  const out = {};
  for (const key of SIGNALS) {
    const n = Number(src[key]);
    out[key] = Number.isFinite(n) ? clamp(Math.round(n), 0, 10) : null;
  }

  if (out.virality == null) out.virality = clamp(2 + 3*hit(text,/вирус|завирус|тренд|мем|разлетел|миллион.*просмотр|tiktok|reels|shorts/) + 2*hit(text,/видео|ролик|челлендж/),0,10);
  if (out.utility == null) out.utility = clamp(2 + 3*hit(text,/как |полез|что делать|инструк|совет|доступ|скидк|эконом|выгод|правил|цена/) + 2*hit(text,/для россиян|в россии|россия/),0,10);
  if (out.discussion == null) out.discussion = clamp(2 + 3*hit(text,/обсужда|скандал|конфликт|реакц|спор|бойкот|мем/) + 2*hit(text,/игрок|зрител|пользовател|фанат/),0,10);
  if (out.visual == null) out.visual = clamp((media?5:2) + 3*hit(text,/видео|ролик|фото|трейлер|кадр|дизайн|интерьер|еда|машин|образ/),0,10);
  if (out.wow == null) out.wow = clamp(2 + 3*hit(text,/впервые|рекорд|необыч|удив|невозмож|гигант|самый|новый вид|открыли/) + 2*hit(text,/космос|динозавр|квант|робот/),0,10);
  if (out.local == null) out.local = clamp(2 + 5*hit(text,/росси|москв|рубл|₽|рф\b|для россиян/) + 2*hit(text,/ozon|wildberries|яндекс|авито/),0,10);
  if (out.deal == null) out.deal = clamp(1 + 4*hit(text,/скидк|дешев|выгод|цена|₽|рубл|доллар|млрд|миллиард|сделк|выручк|прибыл/) + 2*hit(text,/акци|распродаж|купил|продал/),0,10);
  return out;
}

function historyBucket(channelId, item) {
  return classifyContentBucket(channelId, item);
}

export function contentMixBalance(channelId, candidate, recentHistory, windowSize) {
  const mix = channelMix(channelId);
  const keys = Object.keys(mix);
  const bucket = classifyContentBucket(channelId, candidate);
  if (!keys.length || !Object.prototype.hasOwnProperty.call(mix, bucket)) {
    return { bucket, bonus: 0, target: null, actual: null, counts: {} };
  }
  const recent = (Array.isArray(recentHistory) ? recentHistory : [])
    .filter(function(x){
      if (!x || x.isDigest || x.publicationOrigin === "digest") return false;
      const format = String(x.contentFormat || x.contentFormatLabel || (x.editorialV2 && x.editorialV2.format) || "").toLowerCase();
      return format !== "дайджест";
    })
    .slice(0, Math.max(4, Number(windowSize || 24)));
  if (recent.length < 4) {
    return { bucket, bonus: 0, target: mix[bucket], actual: null, counts: {} };
  }
  const counts = {};
  keys.forEach(function(k){ counts[k]=0; });
  recent.forEach(function(item){
    const b = historyBucket(channelId, item);
    if (Object.prototype.hasOwnProperty.call(counts,b)) counts[b]+=1;
  });
  const actual = Number(counts[bucket] || 0) / recent.length;
  const target = Number(mix[bucket] || 0);
  const deficit = target - actual;
  const bonus = deficit >= 0
    ? Math.min(14, Math.round(deficit * 38))
    : Math.max(-14, Math.round(deficit * 26));
  return { bucket, bonus, target, actual, counts, sampleSize: recent.length };
}

export function sourcePreferenceBonus(channelId, source) {
  const dna = CHANNEL_DNA[channelId] || {};
  const order = Array.isArray(dna.preferredSources) ? dna.preferredSources : SOURCE_CLASSES;
  const sourceClass = sourceClassFor(source);
  const idx = order.indexOf(sourceClass);
  if (idx < 0) return { sourceClass, bonus: 0 };
  const bonuses = [4,3,2,1,0];
  return { sourceClass, bonus: bonuses[idx] == null ? 0 : bonuses[idx] };
}

export function channelFit(channelId, item) {
  const dna = CHANNEL_DNA[channelId] || {};
  const weights = dna.scoreWeights || {};
  const explicit = item && (item.channelSignals || item.channel_signals || (item.editorialV2 && item.editorialV2.channelSignals));
  const signals = normalizeChannelSignals(explicit, item);
  let weightSum=0, weighted=0;
  for (const [key, weightRaw] of Object.entries(weights)) {
    const weight = Number(weightRaw);
    if (!Number.isFinite(weight) || weight <= 0) continue;
    weighted += signals[key] * weight;
    weightSum += weight;
  }
  const score = weightSum ? weighted / weightSum : 5;
  return {
    score: Math.round(score * 10) / 10,
    bonus: Math.max(-10, Math.min(10, Math.round((score - 5) * 2))),
    signals
  };
}

export function channelStrategyScore(channelId, item, recentHistory, source) {
  const mix = contentMixBalance(channelId, item, recentHistory, 24);
  const fit = channelFit(channelId, item);
  const sourcePref = sourcePreferenceBonus(channelId, source || item);
  const totalBonus = Math.max(-24, Math.min(28, mix.bonus + fit.bonus + sourcePref.bonus));
  const reasons = [];
  if (mix.bonus) reasons.push("баланс " + mix.bucket + " " + (mix.bonus>0?"+":"") + mix.bonus);
  if (fit.bonus) reasons.push("Channel Score " + fit.score + "/10 " + (fit.bonus>0?"+":"") + fit.bonus);
  if (sourcePref.bonus) reasons.push(sourcePref.sourceClass + " +" + sourcePref.bonus);
  return {
    channelId,
    bucket: mix.bucket,
    mix,
    fit,
    sourceClass: sourcePref.sourceClass,
    sourceBonus: sourcePref.bonus,
    totalBonus,
    reasons
  };
}
