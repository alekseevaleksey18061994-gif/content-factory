// Extracted from server.js (v0.62.0 module split). Behaviour is unchanged.
import { APPROVED_AUTO_BLOGGER_SOURCES } from "./channel-curated-sources.js";

export const CURATED_SOURCES = [
  { id: "openai", name: "OpenAI News", type: "web", group: "official", priority: 1, url: "https://openai.com/news/", enabled: true },
  { id: "anthropic", name: "Anthropic News", type: "web", group: "official", priority: 1, url: "https://www.anthropic.com/news", enabled: true },
  { id: "google-deepmind", name: "Google DeepMind", type: "web", group: "official", priority: 1, url: "https://deepmind.google/blog/", enabled: true },
  { id: "google-ai", name: "Google AI", type: "web", group: "official", priority: 1, url: "https://blog.google/technology/ai/", enabled: true },
  { id: "meta-ai", name: "Meta AI", type: "web", group: "official", priority: 1, url: "https://ai.meta.com/blog/", enabled: true },
  { id: "microsoft-ai", name: "Microsoft AI", type: "web", group: "official", priority: 1, url: "https://blogs.microsoft.com/ai/", enabled: true },
  { id: "nvidia-ai", name: "NVIDIA AI", type: "web", group: "official", priority: 1, url: "https://blogs.nvidia.com/blog/category/generative-ai/", enabled: true },
  { id: "xai", name: "xAI News", type: "web", group: "official", priority: 1, url: "https://x.ai/news", enabled: true },
  { id: "mistral", name: "Mistral AI", type: "web", group: "official", priority: 1, url: "https://mistral.ai/news/", enabled: true },
  { id: "huggingface", name: "Hugging Face", type: "web", group: "official", priority: 1, url: "https://huggingface.co/blog", enabled: true },
  { id: "perplexity", name: "Perplexity", type: "web", group: "official", priority: 1, url: "https://www.perplexity.ai/hub/blog", enabled: true },
  { id: "stability-ai", name: "Stability AI", type: "web", group: "official", priority: 1, url: "https://stability.ai/news-updates", enabled: true },

  { id: "techcrunch-ai", name: "TechCrunch AI", type: "web", group: "media", priority: 2, url: "https://techcrunch.com/category/artificial-intelligence/", enabled: true },
  { id: "the-verge-ai", name: "The Verge AI", type: "web", group: "media", priority: 2, url: "https://www.theverge.com/ai-artificial-intelligence", enabled: true },
  { id: "ars-ai", name: "Ars Technica AI", type: "web", group: "media", priority: 2, url: "https://arstechnica.com/ai/", enabled: true },
  { id: "venturebeat-ai", name: "VentureBeat AI", type: "web", group: "media", priority: 2, url: "https://venturebeat.com/category/ai/", enabled: true },
  { id: "wired-ai", name: "WIRED AI", type: "web", group: "media", priority: 2, url: "https://www.wired.com/category/artificial-intelligence/", enabled: true },
  { id: "mit-tech-ai", name: "MIT Technology Review AI", type: "web", group: "media", priority: 2, url: "https://www.technologyreview.com/topic/artificial-intelligence/", enabled: true },
  { id: "the-decoder", name: "The Decoder", type: "web", group: "media", priority: 2, url: "https://the-decoder.com/", enabled: true },
  { id: "the-batch", name: "DeepLearning.AI — The Batch", type: "web", group: "media", priority: 2, url: "https://www.deeplearning.ai/the-batch", enabled: true }
];

export const RUSSIAN_AI_SOURCES = [
  { id: "ru-yandex-ai", name: "Яндекс на Хабре", type: "web", group: "official", priority: 1, url: "https://habr.com/ru/companies/yandex/news/", enabled: true },
  { id: "ru-sber-ai", name: "Sber AI / GigaChat", type: "web", group: "official", priority: 1, url: "https://habr.com/ru/companies/sberbank/news/page1/", enabled: true },
  { id: "ru-mws-ai", name: "MWS AI", type: "web", group: "official", priority: 1, url: "https://mts.ai/news/", enabled: true },
  { id: "ru-vk-ai", name: "VK AI", type: "web", group: "official", priority: 1, url: "https://vk.company.ru/ru/press/releases/", enabled: true },
  { id: "ru-habr-ai", name: "Хабр: ИИ (новости)", type: "web", group: "media", priority: 2, url: "https://habr.com/ru/hubs/artificial_intelligence/news/", enabled: true },
  { id: "ru-just-ai", name: "Just AI", type: "web", group: "official", priority: 1, url: "https://just-ai.com/blog/news", enabled: true },
  { id: "ru-vc-ai", name: "vc.ru: ИИ", type: "web", group: "media", priority: 2, url: "https://vc.ru/ai", enabled: true },
  { id: "ru-airi", name: "Институт AIRI", type: "web", group: "creator", priority: 1, url: "https://t.me/s/airi_research_institute", enabled: true },
  { id: "ru-zheltyi-ai", name: "Жёлтый AI", type: "web", group: "creator", priority: 2, url: "https://t.me/s/zheltyi_ai", enabled: true },
  { id: "ru-ai-happens", name: "AI Happens", type: "web", group: "creator", priority: 2, url: "https://t.me/s/AIhappens", enabled: true }
];

export const CAR_SOURCES = [
  { id: "cars-tesla", name: "Tesla Blog", type: "web", group: "official", priority: 1, url: "https://www.tesla.com/blog", enabled: true },
  { id: "cars-byd", name: "BYD Global", type: "web", group: "official", priority: 1, url: "https://www.bydglobal.com/en/news", enabled: true },
  { id: "cars-geely", name: "Geely Newsroom", type: "web", group: "official", priority: 1, url: "https://newsroom.geely.com/", enabled: true },
  { id: "cars-chery", name: "Chery International", type: "web", group: "official", priority: 1, url: "https://www.cheryinternational.com/", enabled: true },
  { id: "cars-nio", name: "NIO Newsroom", type: "web", group: "official", priority: 1, url: "https://www.nio.com/news", enabled: true },
  { id: "cars-xpeng", name: "XPENG Pressroom", type: "web", group: "official", priority: 1, url: "https://www.xpeng.com/nl/pressroom", enabled: true },
  { id: "cars-zeekr", name: "ZEEKR Global", type: "web", group: "official", priority: 1, url: "https://www.zeekrglobal.com/", enabled: true },
  { id: "cars-gwm", name: "GWM Global", type: "web", group: "official", priority: 1, url: "https://www.gwm-global.com/news/", enabled: true },
  { id: "cars-toyota", name: "Toyota Global Newsroom", type: "web", group: "official", priority: 1, url: "https://global.toyota/en/newsroom/", enabled: true },
  { id: "cars-vw", name: "Volkswagen Newsroom", type: "web", group: "official", priority: 1, url: "https://www.volkswagen-newsroom.com/en/press-releases", enabled: true },
  { id: "cars-bmw", name: "BMW Group PressClub", type: "web", group: "official", priority: 1, url: "https://www.press.bmwgroup.com/global/", enabled: true },
  { id: "cars-mercedes", name: "Mercedes-Benz Media", type: "web", group: "official", priority: 1, url: "https://media.mercedes-benz.com/", enabled: true },

  { id: "cars-reuters", name: "Reuters Autos & Transportation", type: "web", group: "media", priority: 2, url: "https://www.reuters.com/business/autos-transportation/", enabled: true },
  { id: "cars-carnewschina", name: "CarNewsChina", type: "web", group: "media", priority: 2, url: "https://carnewschina.com/", enabled: true },
  { id: "cars-cnevpost", name: "CnEVPost", type: "web", group: "media", priority: 2, url: "https://cnevpost.com/", enabled: true },
  { id: "cars-gasgoo", name: "Gasgoo Auto News", type: "web", group: "media", priority: 2, url: "https://autonews.gasgoo.com/", enabled: true },
  { id: "cars-electrek", name: "Electrek", type: "web", group: "media", priority: 2, url: "https://electrek.co/", enabled: true },
  { id: "cars-insideevs", name: "InsideEVs", type: "web", group: "media", priority: 2, url: "https://insideevs.com/news/", enabled: true },
  { id: "cars-motor1", name: "Motor1", type: "web", group: "media", priority: 2, url: "https://www.motor1.com/news/", enabled: true },
  { id: "cars-carscoops", name: "Carscoops", type: "web", group: "media", priority: 2, url: "https://www.carscoops.com/category/news/", enabled: true },
  { id: "cars-autocar", name: "Autocar", type: "web", group: "media", priority: 2, url: "https://www.autocar.co.uk/car-news", enabled: true },
  { id: "cars-topgear", name: "Top Gear", type: "web", group: "media", priority: 2, url: "https://www.topgear.com/car-news", enabled: true },
  { id: "cars-caranddriver", name: "Car and Driver", type: "web", group: "media", priority: 2, url: "https://www.caranddriver.com/news/", enabled: true },
  { id: "cars-thedrive", name: "The Drive", type: "web", group: "media", priority: 2, url: "https://www.thedrive.com/news", enabled: true },
  { id: "cars-jalopnik", name: "Jalopnik", type: "web", group: "media", priority: 2, url: "https://www.jalopnik.com/", enabled: true },
  { id: "cars-autonews-ru", name: "Autonews.ru", type: "web", group: "media", priority: 2, url: "https://www.autonews.ru/", enabled: true },
  { id: "cars-motor-ru", name: "Motor.ru", type: "web", group: "media", priority: 2, url: "https://motor.ru/", enabled: true },
  { id: "cars-drom", name: "Drom Новости", type: "web", group: "media", priority: 2, url: "https://news.drom.ru/", enabled: true },
  { id: "cars-quto", name: "Quto", type: "web", group: "media", priority: 2, url: "https://quto.ru/news/", enabled: true },
  { id: "cars-autoevolution", name: "Autoevolution", type: "web", group: "media", priority: 2, url: "https://www.autoevolution.com/news/", enabled: true },
  { id: "cars-zr", name: "За рулём", type: "web", group: "media", priority: 2, url: "https://www.zr.ru/", enabled: true },
  { id: "cars-autostat", name: "Автостат", type: "web", group: "media", priority: 1, url: "https://www.autostat.ru/news/", enabled: true },
  { id: "cars-kolesa", name: "Колёса.ру", type: "web", group: "media", priority: 2, url: "https://www.kolesa.ru/news", enabled: true },
  { id: "cars-autoreview", name: "Авторевю", type: "web", group: "media", priority: 2, url: "https://autoreview.ru/news", enabled: true }
];

export const BLOGGER_SOURCES = APPROVED_AUTO_BLOGGER_SOURCES;

export const BLOGGER_SLOTS = ["10:30", "12:30", "15:30", "18:30", "21:30"];

export const BLOGGER_DAILY_TARGET = 5;

// Extra :30 lane per channel (the "blogger" lane, generalised). stars: three extra posts a day taken from all its
// sources; kino: three posts a day from Telegram channels with film memes (group "blogger", found by discovery).
export const CHANNEL_EXTRA_LANES = {
  stars: { slots: ["12:30", "18:30", "21:30"], anySource: true, label: "Доп. посты" },
  kino: { slots: ["12:30", "16:30", "20:30"], anySource: false, label: "Кино-мемы" },
  // Approved money cadence: six :00 slots + these two flexible :30 slots = max 8 normal posts/day.
  money: { slots: ["14:30", "21:30"], targetPerDay: 2, anySource: true, label: "Личные финансы" },
  shopping: { slots: ["08:45","09:30","10:15","11:45","12:30","13:15","14:45","15:30","16:15","17:45","18:30","19:15","20:45","21:30","22:15"], targetPerDay: 15, anySource: true, label: "Покупки" }
};

