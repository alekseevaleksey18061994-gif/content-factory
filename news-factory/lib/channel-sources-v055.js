// v0.55.3: стартовый набор источников по рубрикам (подобран вручную; сервер проверяет каждый перед добавлением,
// недоступные отбрасываются, дальше источники ведёт автоматика: пауза слабых, добор новых).
export const SOURCES_V055 = {
 "ai": [
  {
   "name": "эйай ньюз",
   "url": "https://t.me/s/ai_newz",
   "group": "blogger",
   "rubrics": [
    "companies_models"
   ]
  },
  {
   "name": "Сиолошная",
   "url": "https://t.me/s/seeallochnaya",
   "group": "blogger",
   "rubrics": [
    "companies_models",
    "law_ethics"
   ]
  },
  {
   "name": "Data Secrets",
   "url": "https://t.me/s/data_secrets",
   "group": "media",
   "rubrics": [
    "companies_models"
   ]
  },
  {
   "name": "gonzo-ML",
   "url": "https://t.me/s/gonzo_ML",
   "group": "blogger",
   "rubrics": [
    "companies_models"
   ]
  },
  {
   "name": "Denis Sexy IT",
   "url": "https://t.me/s/denissexy",
   "group": "blogger",
   "rubrics": [
    "companies_models",
    "viral_fun"
   ]
  },
  {
   "name": "Hi, AI",
   "url": "https://t.me/s/hiaimedia",
   "group": "media",
   "rubrics": [
    "companies_models"
   ]
  },
  {
   "name": "GPT News",
   "url": "https://t.me/s/gpt_news",
   "group": "media",
   "rubrics": [
    "companies_models"
   ]
  },
  {
   "name": "Джарвис Ньюс",
   "url": "https://t.me/s/JarvisNew",
   "group": "media",
   "rubrics": [
    "companies_models"
   ]
  },
  {
   "name": "OpenAI News",
   "url": "https://openai.com/news/",
   "group": "official",
   "rubrics": [
    "companies_models"
   ]
  },
  {
   "name": "Anthropic News",
   "url": "https://www.anthropic.com/news",
   "group": "official",
   "rubrics": [
    "companies_models"
   ]
  },
  {
   "name": "Google DeepMind Blog",
   "url": "https://deepmind.google/discover/blog/",
   "group": "official",
   "rubrics": [
    "companies_models"
   ]
  },
  {
   "name": "TechCrunch AI",
   "url": "https://techcrunch.com/category/artificial-intelligence/",
   "group": "media",
   "rubrics": [
    "companies_models",
    "law_ethics"
   ]
  },
  {
   "name": "Neural Shit",
   "url": "https://t.me/s/NeuralShit",
   "group": "creator",
   "rubrics": [
    "viral_fun"
   ]
  },
  {
   "name": "Нейродвиж",
   "url": "https://t.me/s/neuraldvig",
   "group": "creator",
   "rubrics": [
    "viral_fun",
    "services_hacks"
   ]
  },
  {
   "name": "CGIT_Vines",
   "url": "https://t.me/s/CGIT_Vines",
   "group": "creator",
   "rubrics": [
    "viral_fun"
   ]
  },
  {
   "name": "Нейроневод",
   "url": "https://t.me/s/neironevod",
   "group": "creator",
   "rubrics": [
    "viral_fun"
   ]
  },
  {
   "name": "Psy Eyes",
   "url": "https://t.me/s/ChatGPT_NeuroNews",
   "group": "creator",
   "rubrics": [
    "viral_fun"
   ]
  },
  {
   "name": "Lama AI",
   "url": "https://t.me/s/lama_channel_gpt",
   "group": "creator",
   "rubrics": [
    "viral_fun"
   ]
  },
  {
   "name": "Stable Diffusion News",
   "url": "https://t.me/s/StableDiffusionBest",
   "group": "creator",
   "rubrics": [
    "viral_fun"
   ]
  },
  {
   "name": "Эксплойт",
   "url": "https://t.me/s/exploitex",
   "group": "media",
   "rubrics": [
    "viral_fun",
    "russia_ai",
    "law_ethics"
   ]
  },
  {
   "name": "Нейропрактика",
   "url": "https://t.me/s/neuro_praxis",
   "group": "creator",
   "rubrics": [
    "services_hacks"
   ]
  },
  {
   "name": "Марти | Нейросети",
   "url": "https://t.me/s/marti",
   "group": "creator",
   "rubrics": [
    "services_hacks"
   ]
  },
  {
   "name": "Нейроканал Tproger",
   "url": "https://t.me/s/neuro_channel",
   "group": "media",
   "rubrics": [
    "services_hacks"
   ]
  },
  {
   "name": "Точки над ИИ",
   "url": "https://t.me/s/TochkiNadAI",
   "group": "media",
   "rubrics": [
    "services_hacks"
   ]
  },
  {
   "name": "ChatGPT | Нейросети",
   "url": "https://t.me/s/gptpublic",
   "group": "creator",
   "rubrics": [
    "services_hacks"
   ]
  },
  {
   "name": "GPT Main News",
   "url": "https://t.me/s/GPTMainNews",
   "group": "media",
   "rubrics": [
    "services_hacks"
   ]
  },
  {
   "name": "Chad GPT",
   "url": "https://t.me/s/AI_Chad",
   "group": "creator",
   "rubrics": [
    "services_hacks"
   ]
  },
  {
   "name": "Не баг, а фича",
   "url": "https://t.me/s/bugfeature",
   "group": "creator",
   "rubrics": [
    "services_hacks"
   ]
  },
  {
   "name": "Habr: ИИ",
   "url": "https://habr.com/ru/hubs/artificial_intelligence/articles/",
   "group": "media",
   "rubrics": [
    "services_hacks",
    "russia_ai"
   ]
  },
  {
   "name": "GigaChat",
   "url": "https://t.me/s/official_gigachat",
   "group": "official",
   "rubrics": [
    "russia_ai"
   ]
  },
  {
   "name": "Цифровой журнал: нейросети",
   "url": "https://t.me/s/cjournal_neyroseti",
   "group": "media",
   "rubrics": [
    "russia_ai"
   ]
  },
  {
   "name": "Код Дурова",
   "url": "https://t.me/s/d_code",
   "group": "media",
   "rubrics": [
    "russia_ai",
    "law_ethics"
   ]
  },
  {
   "name": "TAdviser",
   "url": "https://www.tadviser.ru/",
   "group": "media",
   "rubrics": [
    "russia_ai"
   ]
  },
  {
   "name": "CNews",
   "url": "https://www.cnews.ru/",
   "group": "media",
   "rubrics": [
    "russia_ai"
   ]
  },
  {
   "name": "vc.ru ИИ",
   "url": "https://vc.ru/ai",
   "group": "media",
   "rubrics": [
    "russia_ai",
    "law_ethics"
   ]
  },
  {
   "name": "РБК Технологии",
   "url": "https://www.rbc.ru/technology_and_media/",
   "group": "media",
   "rubrics": [
    "russia_ai"
   ]
  },
  {
   "name": "Хабр новости",
   "url": "https://habr.com/ru/news/",
   "group": "media",
   "rubrics": [
    "russia_ai"
   ]
  },
  {
   "name": "AI Talent Hub",
   "url": "https://t.me/s/aitalenthubnews",
   "group": "media",
   "rubrics": [
    "russia_ai"
   ]
  },
  {
   "name": "Machinelearning",
   "url": "https://t.me/s/ai_machinelearning_big_data",
   "group": "media",
   "rubrics": [
    "russia_ai"
   ]
  },
  {
   "name": "Robotics Channel",
   "url": "https://t.me/s/robotics_channel",
   "group": "media",
   "rubrics": [
    "robots_hardware"
   ]
  },
  {
   "name": "База знаний AI",
   "url": "https://t.me/s/ict_moscow_ai",
   "group": "media",
   "rubrics": [
    "robots_hardware"
   ]
  },
  {
   "name": "Техномотель",
   "url": "https://t.me/s/technomotel",
   "group": "media",
   "rubrics": [
    "robots_hardware"
   ]
  },
  {
   "name": "Футурист",
   "url": "https://t.me/s/futurist_ru",
   "group": "media",
   "rubrics": [
    "robots_hardware"
   ]
  },
  {
   "name": "ServerNews",
   "url": "https://t.me/s/servernewsru",
   "group": "media",
   "rubrics": [
    "robots_hardware"
   ]
  },
  {
   "name": "3DNews",
   "url": "https://t.me/s/ru3dnews",
   "group": "media",
   "rubrics": [
    "robots_hardware"
   ]
  },
  {
   "name": "Милорд",
   "url": "https://t.me/s/milord_q",
   "group": "media",
   "rubrics": [
    "robots_hardware"
   ]
  },
  {
   "name": "The Robot Report",
   "url": "https://www.therobotreport.com/",
   "group": "media",
   "rubrics": [
    "robots_hardware"
   ]
  },
  {
   "name": "IEEE Spectrum Robotics",
   "url": "https://spectrum.ieee.org/topic/robotics/",
   "group": "media",
   "rubrics": [
    "robots_hardware"
   ]
  },
  {
   "name": "Tom's Hardware",
   "url": "https://www.tomshardware.com/news",
   "group": "media",
   "rubrics": [
    "robots_hardware"
   ]
  },
  {
   "name": "3DNews",
   "url": "https://3dnews.ru/news",
   "group": "media",
   "rubrics": [
    "robots_hardware"
   ]
  },
  {
   "name": "Утечки информации",
   "url": "https://t.me/s/dataleak",
   "group": "media",
   "rubrics": [
    "law_ethics"
   ]
  },
  {
   "name": "Информация опасносте",
   "url": "https://t.me/s/alexmakus",
   "group": "blogger",
   "rubrics": [
    "law_ethics"
   ]
  },
  {
   "name": "Брэдецкий: Технологии, медиа и общество",
   "url": "https://t.me/s/brodetsky",
   "group": "blogger",
   "rubrics": [
    "law_ethics"
   ]
  },
  {
   "name": "Roskomsvoboda",
   "url": "https://roskomsvoboda.org/ru/",
   "group": "media",
   "rubrics": [
    "law_ethics"
   ]
  },
  {
   "name": "Ars Technica",
   "url": "https://arstechnica.com/ai/",
   "group": "media",
   "rubrics": [
    "law_ethics"
   ]
  },
  {
   "name": "The Verge AI",
   "url": "https://www.theverge.com/ai-artificial-intelligence",
   "group": "media",
   "rubrics": [
    "law_ethics"
   ]
  }
 ],
 "tech": [
  {
   "name": "apple.inside",
   "url": "https://t.me/s/appleinside",
   "group": "media",
   "rubrics": [
    "smartphones"
   ]
  },
  {
   "name": "iPhones.ru",
   "url": "https://t.me/s/iphonesru",
   "group": "media",
   "rubrics": [
    "smartphones"
   ]
  },
  {
   "name": "Wylsa Pro",
   "url": "https://t.me/s/wylsared",
   "group": "blogger",
   "rubrics": [
    "smartphones",
    "tech_bloggers"
   ]
  },
  {
   "name": "Rozetked",
   "url": "https://t.me/s/rozetked",
   "group": "blogger",
   "rubrics": [
    "smartphones",
    "gadgets",
    "tech_bloggers"
   ]
  },
  {
   "name": "IT-новости",
   "url": "https://t.me/s/it_tg",
   "group": "media",
   "rubrics": [
    "smartphones"
   ]
  },
  {
   "name": "The Geek Log",
   "url": "https://t.me/s/TheGeekLog",
   "group": "media",
   "rubrics": [
    "smartphones",
    "gadgets"
   ]
  },
  {
   "name": "Win1Leaks",
   "url": "https://t.me/s/win1leaks",
   "group": "media",
   "rubrics": [
    "smartphones",
    "pc_hardware"
   ]
  },
  {
   "name": "iPhones.ru",
   "url": "https://www.iphones.ru/",
   "group": "media",
   "rubrics": [
    "smartphones",
    "apps"
   ]
  },
  {
   "name": "AndroidInsider",
   "url": "https://androidinsider.ru/",
   "group": "media",
   "rubrics": [
    "smartphones"
   ]
  },
  {
   "name": "Trashbox",
   "url": "https://trashbox.ru/",
   "group": "media",
   "rubrics": [
    "smartphones",
    "gadgets"
   ]
  },
  {
   "name": "GSMArena news",
   "url": "https://www.gsmarena.com/news.php3",
   "group": "media",
   "rubrics": [
    "smartphones"
   ]
  },
  {
   "name": "9to5Mac",
   "url": "https://9to5mac.com/",
   "group": "media",
   "rubrics": [
    "smartphones"
   ]
  },
  {
   "name": "All-in-One Person",
   "url": "https://t.me/s/themarfa",
   "group": "blogger",
   "rubrics": [
    "apps",
    "tech_bloggers"
   ]
  },
  {
   "name": "Не баг, а фича",
   "url": "https://t.me/s/bugfeature",
   "group": "creator",
   "rubrics": [
    "apps"
   ]
  },
  {
   "name": "Windows 10, etc",
   "url": "https://t.me/s/sterkin_ru",
   "group": "blogger",
   "rubrics": [
    "apps",
    "tech_bloggers"
   ]
  },
  {
   "name": "Office Killer",
   "url": "https://t.me/s/office_killer",
   "group": "creator",
   "rubrics": [
    "apps"
   ]
  },
  {
   "name": "Кухня Яндекс.Дзена",
   "url": "https://t.me/s/zenleaks",
   "group": "media",
   "rubrics": [
    "apps"
   ]
  },
  {
   "name": "БлоGнот",
   "url": "https://t.me/s/blognot",
   "group": "blogger",
   "rubrics": [
    "apps",
    "tech_bloggers"
   ]
  },
  {
   "name": "Community",
   "url": "https://t.me/s/thecommunity_channel",
   "group": "media",
   "rubrics": [
    "apps"
   ]
  },
  {
   "name": "Эксплойт",
   "url": "https://t.me/s/exploitex",
   "group": "media",
   "rubrics": [
    "apps",
    "internet_russia"
   ]
  },
  {
   "name": "Hi-Tech Mail",
   "url": "https://hi-tech.mail.ru/",
   "group": "media",
   "rubrics": [
    "apps",
    "internet_russia"
   ]
  },
  {
   "name": "TechCrunch Apps",
   "url": "https://techcrunch.com/category/apps/",
   "group": "media",
   "rubrics": [
    "apps"
   ]
  },
  {
   "name": "Хай-теч вам в бок",
   "url": "https://t.me/s/ht_vbok",
   "group": "media",
   "rubrics": [
    "gadgets",
    "unusual_tech"
   ]
  },
  {
   "name": "Техномотель",
   "url": "https://t.me/s/technomotel",
   "group": "media",
   "rubrics": [
    "gadgets",
    "unusual_tech"
   ]
  },
  {
   "name": "ForGeeks",
   "url": "https://t.me/s/forgeeks",
   "group": "media",
   "rubrics": [
    "gadgets"
   ]
  },
  {
   "name": "Geeks",
   "url": "https://t.me/s/g33ks",
   "group": "media",
   "rubrics": [
    "gadgets",
    "pc_hardware"
   ]
  },
  {
   "name": "TechSparks",
   "url": "https://t.me/s/techsparks",
   "group": "media",
   "rubrics": [
    "gadgets"
   ]
  },
  {
   "name": "IT News",
   "url": "https://t.me/s/techno_news_tg",
   "group": "media",
   "rubrics": [
    "gadgets"
   ]
  },
  {
   "name": "iGuides",
   "url": "https://www.iguides.ru/",
   "group": "media",
   "rubrics": [
    "gadgets"
   ]
  },
  {
   "name": "Engadget",
   "url": "https://www.engadget.com/",
   "group": "media",
   "rubrics": [
    "gadgets"
   ]
  },
  {
   "name": "The Verge",
   "url": "https://www.theverge.com/tech",
   "group": "media",
   "rubrics": [
    "gadgets"
   ]
  },
  {
   "name": "3DNews",
   "url": "https://t.me/s/ru3dnews",
   "group": "media",
   "rubrics": [
    "pc_hardware",
    "internet_russia"
   ]
  },
  {
   "name": "ServerNews",
   "url": "https://t.me/s/servernewsru",
   "group": "media",
   "rubrics": [
    "pc_hardware"
   ]
  },
  {
   "name": "The Verge",
   "url": "https://t.me/s/thevergechannel",
   "group": "media",
   "rubrics": [
    "pc_hardware"
   ]
  },
  {
   "name": "3DNews",
   "url": "https://3dnews.ru/news",
   "group": "media",
   "rubrics": [
    "pc_hardware",
    "internet_russia"
   ]
  },
  {
   "name": "iXBT news",
   "url": "https://www.ixbt.com/news/",
   "group": "media",
   "rubrics": [
    "pc_hardware"
   ]
  },
  {
   "name": "Overclockers.ru",
   "url": "https://overclockers.ru/",
   "group": "media",
   "rubrics": [
    "pc_hardware"
   ]
  },
  {
   "name": "Tom's Hardware",
   "url": "https://www.tomshardware.com/news",
   "group": "media",
   "rubrics": [
    "pc_hardware"
   ]
  },
  {
   "name": "VideoCardz",
   "url": "https://videocardz.com/",
   "group": "media",
   "rubrics": [
    "pc_hardware"
   ]
  },
  {
   "name": "ServerNews",
   "url": "https://servernews.ru/",
   "group": "media",
   "rubrics": [
    "pc_hardware"
   ]
  },
  {
   "name": "ЗаТелеком",
   "url": "https://t.me/s/zatelecom",
   "group": "media",
   "rubrics": [
    "internet_russia"
   ]
  },
  {
   "name": "OpenNET",
   "url": "https://t.me/s/opennet_ru",
   "group": "media",
   "rubrics": [
    "internet_russia",
    "security"
   ]
  },
  {
   "name": "Код Дурова",
   "url": "https://t.me/s/d_code",
   "group": "media",
   "rubrics": [
    "internet_russia"
   ]
  },
  {
   "name": "Roskomsvoboda",
   "url": "https://roskomsvoboda.org/ru/",
   "group": "media",
   "rubrics": [
    "internet_russia"
   ]
  },
  {
   "name": "Habr новости",
   "url": "https://habr.com/ru/news/",
   "group": "media",
   "rubrics": [
    "internet_russia"
   ]
  },
  {
   "name": "CNews",
   "url": "https://www.cnews.ru/",
   "group": "media",
   "rubrics": [
    "internet_russia"
   ]
  },
  {
   "name": "ComNews",
   "url": "https://www.comnews.ru/",
   "group": "media",
   "rubrics": [
    "internet_russia"
   ]
  },
  {
   "name": "РБК Технологии",
   "url": "https://www.rbc.ru/technology_and_media/",
   "group": "media",
   "rubrics": [
    "internet_russia"
   ]
  },
  {
   "name": "SecurityLab",
   "url": "https://t.me/s/SecLabNews",
   "group": "media",
   "rubrics": [
    "security"
   ]
  },
  {
   "name": "Утечки информации",
   "url": "https://t.me/s/dataleak",
   "group": "media",
   "rubrics": [
    "security"
   ]
  },
  {
   "name": "Информация опасносте",
   "url": "https://t.me/s/alexmakus",
   "group": "blogger",
   "rubrics": [
    "security",
    "tech_bloggers"
   ]
  },
  {
   "name": "Темная Сторона Интернета",
   "url": "https://t.me/s/deeptoweb",
   "group": "media",
   "rubrics": [
    "security"
   ]
  },
  {
   "name": "SecurityLab",
   "url": "https://www.securitylab.ru/news/",
   "group": "media",
   "rubrics": [
    "security"
   ]
  },
  {
   "name": "Xakep.ru",
   "url": "https://xakep.ru/",
   "group": "media",
   "rubrics": [
    "security"
   ]
  },
  {
   "name": "BleepingComputer",
   "url": "https://www.bleepingcomputer.com/",
   "group": "media",
   "rubrics": [
    "security"
   ]
  },
  {
   "name": "Krebs on Security",
   "url": "https://krebsonsecurity.com/",
   "group": "media",
   "rubrics": [
    "security"
   ]
  },
  {
   "name": "The Hacker News",
   "url": "https://thehackernews.com/",
   "group": "media",
   "rubrics": [
    "security"
   ]
  },
  {
   "name": "Anti-Malware",
   "url": "https://www.anti-malware.ru/news",
   "group": "media",
   "rubrics": [
    "security"
   ]
  },
  {
   "name": "Футурист",
   "url": "https://t.me/s/futurist_ru",
   "group": "media",
   "rubrics": [
    "unusual_tech"
   ]
  },
  {
   "name": "Nplus1",
   "url": "https://t.me/s/nplusone",
   "group": "media",
   "rubrics": [
    "unusual_tech"
   ]
  },
  {
   "name": "Naked Science",
   "url": "https://t.me/s/nsmag",
   "group": "media",
   "rubrics": [
    "unusual_tech"
   ]
  },
  {
   "name": "GunFreak",
   "url": "https://t.me/s/GunFreak",
   "group": "media",
   "rubrics": [
    "unusual_tech"
   ]
  },
  {
   "name": "Funscience",
   "url": "https://t.me/s/funscience",
   "group": "media",
   "rubrics": [
    "unusual_tech"
   ]
  },
  {
   "name": "SciTopus",
   "url": "https://t.me/s/scitopus",
   "group": "media",
   "rubrics": [
    "unusual_tech"
   ]
  },
  {
   "name": "concertzaal",
   "url": "https://t.me/s/concertzaal",
   "group": "media",
   "rubrics": [
    "unusual_tech"
   ]
  },
  {
   "name": "N+1",
   "url": "https://nplus1.ru/",
   "group": "media",
   "rubrics": [
    "unusual_tech"
   ]
  },
  {
   "name": "New Atlas",
   "url": "https://newatlas.com/",
   "group": "media",
   "rubrics": [
    "unusual_tech"
   ]
  },
  {
   "name": "Interesting Engineering",
   "url": "https://interestingengineering.com/",
   "group": "media",
   "rubrics": [
    "unusual_tech"
   ]
  },
  {
   "name": "Denis Sexy IT",
   "url": "https://t.me/s/denissexy",
   "group": "blogger",
   "rubrics": [
    "tech_bloggers"
   ]
  },
  {
   "name": "Брэдецкий: Технологии, медиа и общество",
   "url": "https://t.me/s/brodetsky",
   "group": "blogger",
   "rubrics": [
    "tech_bloggers"
   ]
  },
  {
   "name": "Милорд",
   "url": "https://t.me/s/milord_q",
   "group": "blogger",
   "rubrics": [
    "tech_bloggers"
   ]
  },
  {
   "name": "BeardyCast",
   "url": "https://t.me/s/beardycast",
   "group": "blogger",
   "rubrics": [
    "tech_bloggers"
   ]
  },
  {
   "name": "Намочи манту",
   "url": "https://t.me/s/namochimanturu",
   "group": "blogger",
   "rubrics": [
    "tech_bloggers"
   ]
  }
 ],
 "business": [
  {
   "name": "Inc. Russia",
   "url": "https://t.me/s/incrussia",
   "group": "media",
   "rubrics": [
    "founder_stories",
    "unusual_models",
    "startups_money"
   ]
  },
  {
   "name": "Секрет фирмы",
   "url": "https://t.me/s/secretmag",
   "group": "media",
   "rubrics": [
    "founder_stories",
    "unusual_models",
    "failures"
   ]
  },
  {
   "name": "Forbes Russia",
   "url": "https://t.me/s/forbesrussia",
   "group": "media",
   "rubrics": [
    "founder_stories",
    "failures",
    "brands_marketing"
   ]
  },
  {
   "name": "Бизнес-секреты (Т-Банк)",
   "url": "https://t.me/s/bs_business",
   "group": "media",
   "rubrics": [
    "founder_stories",
    "business_bloggers"
   ]
  },
  {
   "name": "Тёмная сторона / Темнографика",
   "url": "https://t.me/s/temno",
   "group": "blogger",
   "rubrics": [
    "founder_stories",
    "unusual_models",
    "business_bloggers"
   ]
  },
  {
   "name": "Стартап дня. Александр Горный",
   "url": "https://t.me/s/startupoftheday",
   "group": "blogger",
   "rubrics": [
    "founder_stories",
    "unusual_models",
    "startups_money"
   ]
  },
  {
   "name": "Дневник предпринимателя",
   "url": "https://t.me/s/dnevnikbogacha",
   "group": "blogger",
   "rubrics": [
    "founder_stories",
    "business_bloggers"
   ]
  },
  {
   "name": "Секрет фирмы",
   "url": "https://secretmag.ru/",
   "group": "media",
   "rubrics": [
    "founder_stories",
    "brands_marketing"
   ]
  },
  {
   "name": "Inc. Russia",
   "url": "https://incrussia.ru/",
   "group": "media",
   "rubrics": [
    "founder_stories",
    "startups_money"
   ]
  },
  {
   "name": "Forbes.ru",
   "url": "https://www.forbes.ru/",
   "group": "media",
   "rubrics": [
    "founder_stories",
    "failures"
   ]
  },
  {
   "name": "Деньги есть везде",
   "url": "https://t.me/s/dengivezde",
   "group": "blogger",
   "rubrics": [
    "unusual_models",
    "business_bloggers"
   ]
  },
  {
   "name": "Современный Бизнес",
   "url": "https://t.me/s/truebusiness",
   "group": "creator",
   "rubrics": [
    "unusual_models",
    "business_bloggers"
   ]
  },
  {
   "name": "Маркетинговый ход",
   "url": "https://t.me/s/MarketingPloy",
   "group": "creator",
   "rubrics": [
    "unusual_models",
    "brands_marketing",
    "business_bloggers"
   ]
  },
  {
   "name": "vc.ru",
   "url": "https://t.me/s/vcru",
   "group": "media",
   "rubrics": [
    "unusual_models",
    "failures",
    "startups_money"
   ]
  },
  {
   "name": "vc.ru",
   "url": "https://vc.ru/",
   "group": "media",
   "rubrics": [
    "unusual_models",
    "failures",
    "startups_money"
   ]
  },
  {
   "name": "RB.ru",
   "url": "https://rb.ru/",
   "group": "media",
   "rubrics": [
    "unusual_models",
    "startups_money",
    "brands_marketing"
   ]
  },
  {
   "name": "The Bell",
   "url": "https://t.me/s/thebell_io",
   "group": "media",
   "rubrics": [
    "failures",
    "startups_money"
   ]
  },
  {
   "name": "The Bell",
   "url": "https://thebell.io/",
   "group": "media",
   "rubrics": [
    "failures",
    "startups_money"
   ]
  },
  {
   "name": "Коммерсантъ",
   "url": "https://t.me/s/kommersant",
   "group": "media",
   "rubrics": [
    "failures",
    "startups_money",
    "marketplaces"
   ]
  },
  {
   "name": "Ведомости",
   "url": "https://t.me/s/Vedomosti",
   "group": "media",
   "rubrics": [
    "failures",
    "startups_money",
    "marketplaces"
   ]
  },
  {
   "name": "РБК",
   "url": "https://t.me/s/rbc_news",
   "group": "media",
   "rubrics": [
    "failures",
    "startups_money",
    "marketplaces"
   ]
  },
  {
   "name": "Retail.ru",
   "url": "https://www.retail.ru/news/",
   "group": "media",
   "rubrics": [
    "failures",
    "marketplaces",
    "brands_marketing"
   ]
  },
  {
   "name": "Жирные коты",
   "url": "https://t.me/s/FatCat18",
   "group": "media",
   "rubrics": [
    "startups_money",
    "business_bloggers"
   ]
  },
  {
   "name": "Оборот.ру",
   "url": "https://oborot.ru/news/",
   "group": "media",
   "rubrics": [
    "marketplaces"
   ]
  },
  {
   "name": "Uniseller блог",
   "url": "https://uniseller.io/blog/tema/seller/",
   "group": "creator",
   "rubrics": [
    "marketplaces"
   ]
  },
  {
   "name": "Яндекс для предпринимателей",
   "url": "https://t.me/s/yandexbusiness",
   "group": "official",
   "rubrics": [
    "marketplaces"
   ]
  },
  {
   "name": "Налоги, законы и бизнес. Марат Самитов",
   "url": "https://t.me/s/oooavirta",
   "group": "blogger",
   "rubrics": [
    "marketplaces",
    "business_bloggers"
   ]
  },
  {
   "name": "Cossa",
   "url": "https://www.cossa.ru/",
   "group": "media",
   "rubrics": [
    "brands_marketing"
   ]
  },
  {
   "name": "Sostav",
   "url": "https://www.sostav.ru/",
   "group": "media",
   "rubrics": [
    "brands_marketing"
   ]
  },
  {
   "name": "AdIndex",
   "url": "https://adindex.ru/",
   "group": "media",
   "rubrics": [
    "brands_marketing"
   ]
  },
  {
   "name": "Заметки продавца B2B",
   "url": "https://t.me/s/Salesnotes",
   "group": "blogger",
   "rubrics": [
    "business_bloggers"
   ]
  },
  {
   "name": "Executive.ru",
   "url": "https://www.e-xecutive.ru/",
   "group": "media",
   "rubrics": [
    "brands_marketing"
   ]
  },
  {
   "name": "AdAge",
   "url": "https://adage.com/",
   "group": "media",
   "rubrics": [
    "brands_marketing"
   ]
  },
  {
   "name": "Marketing.by",
   "url": "https://marketing.by/",
   "group": "media",
   "rubrics": [
    "brands_marketing"
   ]
  },
  {
   "name": "Sostav Telegram",
   "url": "https://t.me/s/sostav_ru",
   "group": "media",
   "rubrics": [
    "brands_marketing"
   ]
  },
  {
   "name": "ADPASS",
   "url": "https://adpass.ru/",
   "group": "media",
   "rubrics": [
    "brands_marketing"
   ]
  },
  {
   "name": "MPStats Блог",
   "url": "https://mpstats.io/media",
   "group": "media",
   "rubrics": [
    "marketplaces"
   ]
  },
  {
   "name": "Seller-online",
   "url": "https://seller-online.com/",
   "group": "media",
   "rubrics": [
    "marketplaces"
   ]
  },
  {
   "name": "MPGO",
   "url": "https://mpgo.su/",
   "group": "media",
   "rubrics": [
    "marketplaces"
   ]
  },
  {
   "name": "Ozon Seller News",
   "url": "https://seller-edu.ozon.ru/",
   "group": "official",
   "rubrics": [
    "marketplaces"
   ]
  },
  {
   "name": "Wildberries Partners",
   "url": "https://seller.wildberries.ru/",
   "group": "official",
   "rubrics": [
    "marketplaces"
   ]
  },
  {
   "name": "Oborot.ru",
   "url": "https://oborot.ru/",
   "group": "media",
   "rubrics": [
    "marketplaces"
   ]
  },
  {
   "name": "Sellerboard",
   "url": "https://moneyplace.io/blog/",
   "group": "media",
   "rubrics": [
    "marketplaces"
   ]
  },
  {
   "name": "Яндекс Маркет Партнёры",
   "url": "https://partner.market.yandex.ru/news",
   "group": "official",
   "rubrics": [
    "marketplaces"
   ]
  },
  {
   "name": "Spbexchange",
   "url": "https://e-pepper.ru/news/",
   "group": "media",
   "rubrics": [
    "marketplaces"
   ]
  },
  {
   "name": "Инвестиции Тинькофф",
   "url": "https://t.me/s/tinkoffinvestments",
   "group": "official",
   "rubrics": [
    "business_bloggers",
    "startups_money"
   ]
  },
  {
   "name": "Пётр Осипов",
   "url": "https://t.me/s/petr_osipov_biz",
   "group": "blogger",
   "rubrics": [
    "business_bloggers"
   ]
  },
  {
   "name": "Тинькофф Журнал",
   "url": "https://journal.tinkoff.ru/",
   "group": "media",
   "rubrics": [
    "business_bloggers"
   ]
  },
  {
   "name": "Хозяин Бизнеса",
   "url": "https://t.me/s/biznesbro",
   "group": "blogger",
   "rubrics": [
    "business_bloggers"
   ]
  },
  {
   "name": "Бизнес Молодость",
   "url": "https://t.me/s/bm_business",
   "group": "blogger",
   "rubrics": [
    "business_bloggers"
   ]
  },
  {
   "name": "Mad Marketing",
   "url": "https://t.me/s/madmarketing",
   "group": "blogger",
   "rubrics": [
    "business_bloggers"
   ]
  },
  {
   "name": "Бизнес-завтрак",
   "url": "https://t.me/s/breakfastbusiness",
   "group": "blogger",
   "rubrics": [
    "business_bloggers"
   ]
  },
  {
   "name": "Деловой Петербург",
   "url": "https://www.dp.ru/",
   "group": "media",
   "rubrics": [
    "business_bloggers"
   ]
  },
  {
   "name": "Rusbase Стартапы",
   "url": "https://rb.ru/news/",
   "group": "media",
   "rubrics": [
    "startups_money"
   ]
  },
  {
   "name": "Банкста",
   "url": "https://t.me/s/banksta",
   "group": "media",
   "rubrics": [
    "startups_money"
   ]
  },
  {
   "name": "Frank RG",
   "url": "https://frankrg.com/",
   "group": "media",
   "rubrics": [
    "startups_money"
   ]
  },
  {
   "name": "Smart-lab",
   "url": "https://smart-lab.ru/",
   "group": "media",
   "rubrics": [
    "startups_money"
   ]
  },
  {
   "name": "Investing.com RU",
   "url": "https://ru.investing.com/news/",
   "group": "media",
   "rubrics": [
    "startups_money"
   ]
  },
  {
   "name": "РБК Инвестиции",
   "url": "https://www.rbc.ru/quote/",
   "group": "media",
   "rubrics": [
    "startups_money"
   ]
  },
  {
   "name": "Crunchbase News",
   "url": "https://news.crunchbase.com/",
   "group": "media",
   "rubrics": [
    "startups_money"
   ]
  },
  {
   "name": "TechCrunch Startups",
   "url": "https://techcrunch.com/category/startups/",
   "group": "media",
   "rubrics": [
    "startups_money"
   ]
  }
 ],
 "crypto": [
  {
   "name": "ForkLog",
   "url": "https://t.me/s/forklog",
   "group": "media",
   "rubrics": [
    "bitcoin_market",
    "eth_ton",
    "hacks_scams"
   ]
  },
  {
   "name": "ForkLog",
   "url": "https://forklog.com/news/",
   "group": "media",
   "rubrics": [
    "bitcoin_market",
    "eth_ton",
    "hacks_scams"
   ]
  },
  {
   "name": "Incrypted",
   "url": "https://t.me/s/incrypted",
   "group": "media",
   "rubrics": [
    "bitcoin_market",
    "hacks_scams",
    "crypto_services"
   ]
  },
  {
   "name": "Incrypted",
   "url": "https://incrypted.com/news/",
   "group": "media",
   "rubrics": [
    "bitcoin_market",
    "eth_ton",
    "hacks_scams"
   ]
  },
  {
   "name": "Bits.media",
   "url": "https://t.me/s/bitsmedia",
   "group": "media",
   "rubrics": [
    "bitcoin_market",
    "eth_ton",
    "regulation"
   ]
  },
  {
   "name": "Bits.media",
   "url": "https://bits.media/news/",
   "group": "media",
   "rubrics": [
    "bitcoin_market",
    "eth_ton",
    "hacks_scams"
   ]
  },
  {
   "name": "BeInCrypto Russia",
   "url": "https://ru.beincrypto.com/",
   "group": "media",
   "rubrics": [
    "bitcoin_market",
    "eth_ton",
    "hacks_scams"
   ]
  },
  {
   "name": "CoinDesk Russia",
   "url": "https://www.coindesk.com/ru/",
   "group": "media",
   "rubrics": [
    "bitcoin_market",
    "hacks_scams",
    "regulation"
   ]
  },
  {
   "name": "Cryptonews.net",
   "url": "https://cryptonews.net/ru/",
   "group": "media",
   "rubrics": [
    "bitcoin_market",
    "hacks_scams",
    "regulation"
   ]
  },
  {
   "name": "РБК Крипто",
   "url": "https://www.rbc.ru/crypto/",
   "group": "media",
   "rubrics": [
    "bitcoin_market",
    "regulation"
   ]
  },
  {
   "name": "Wallet в Telegram",
   "url": "https://t.me/s/wallet",
   "group": "official",
   "rubrics": [
    "eth_ton",
    "crypto_services"
   ]
  },
  {
   "name": "The Open Network (RU)",
   "url": "https://t.me/s/toncoin_rus",
   "group": "official",
   "rubrics": [
    "eth_ton"
   ]
  },
  {
   "name": "Павел Дуров",
   "url": "https://t.me/s/durov",
   "group": "blogger",
   "rubrics": [
    "eth_ton",
    "crypto_services",
    "crypto_bloggers"
   ]
  },
  {
   "name": "TON",
   "url": "https://ton.org/ru",
   "group": "official",
   "rubrics": [
    "eth_ton"
   ]
  },
  {
   "name": "Coinspot",
   "url": "https://coinspot.io/",
   "group": "media",
   "rubrics": [
    "hacks_scams",
    "crypto_services",
    "crypto_unusual"
   ]
  },
  {
   "name": "Коммерсантъ",
   "url": "https://www.kommersant.ru/finance",
   "group": "media",
   "rubrics": [
    "regulation"
   ]
  },
  {
   "name": "РБК",
   "url": "https://t.me/s/rbc_news",
   "group": "media",
   "rubrics": [
    "regulation"
   ]
  },
  {
   "name": "Binance блог RU",
   "url": "https://www.binance.com/ru/blog",
   "group": "official",
   "rubrics": [
    "crypto_services"
   ]
  },
  {
   "name": "Bitkogan",
   "url": "https://t.me/s/bitkogan",
   "group": "blogger",
   "rubrics": [
    "crypto_bloggers"
   ]
  },
  {
   "name": "Incrypted",
   "url": "https://incrypted.com/",
   "group": "creator",
   "rubrics": [
    "crypto_bloggers"
   ]
  },
  {
   "name": "ForkLog",
   "url": "https://forklog.com/",
   "group": "creator",
   "rubrics": [
    "crypto_bloggers"
   ]
  },
  {
   "name": "Cointelegraph RU взломы",
   "url": "https://ru.cointelegraph.com/tags/hacks",
   "group": "media",
   "rubrics": [
    "hacks_scams"
   ]
  },
  {
   "name": "Rekt News",
   "url": "https://rekt.news/",
   "group": "media",
   "rubrics": [
    "hacks_scams"
   ]
  },
  {
   "name": "Chainalysis Blog",
   "url": "https://www.chainalysis.com/blog/",
   "group": "official",
   "rubrics": [
    "hacks_scams"
   ]
  },
  {
   "name": "CertiK Blog",
   "url": "https://www.certik.com/resources/blog",
   "group": "official",
   "rubrics": [
    "hacks_scams"
   ]
  },
  {
   "name": "Group-IB Блог",
   "url": "https://www.group-ib.ru/blog/",
   "group": "official",
   "rubrics": [
    "hacks_scams"
   ]
  },
  {
   "name": "Kaspersky Daily",
   "url": "https://www.kaspersky.ru/blog/",
   "group": "official",
   "rubrics": [
    "hacks_scams"
   ]
  },
  {
   "name": "ZachXBT",
   "url": "https://t.me/s/zachxbt",
   "group": "creator",
   "rubrics": [
    "hacks_scams"
   ]
  },
  {
   "name": "BleepingComputer Crypto",
   "url": "https://www.bleepingcomputer.com/tag/cryptocurrency/",
   "group": "media",
   "rubrics": [
    "hacks_scams"
   ]
  },
  {
   "name": "The Hacker News Crypto",
   "url": "https://thehackernews.com/search/label/Cryptocurrency",
   "group": "media",
   "rubrics": [
    "hacks_scams"
   ]
  },
  {
   "name": "Bankrollo",
   "url": "https://t.me/s/bankrollo",
   "group": "media",
   "rubrics": [
    "hacks_scams"
   ]
  },
  {
   "name": "Банк России пресс-центр",
   "url": "https://www.cbr.ru/press/",
   "group": "official",
   "rubrics": [
    "regulation"
   ]
  },
  {
   "name": "Минфин России",
   "url": "https://minfin.gov.ru/ru/press-center/",
   "group": "official",
   "rubrics": [
    "regulation"
   ]
  },
  {
   "name": "Банк России Telegram",
   "url": "https://t.me/s/centralbank_rus",
   "group": "official",
   "rubrics": [
    "regulation"
   ]
  },
  {
   "name": "Госдума новости",
   "url": "https://duma.gov.ru/news/",
   "group": "official",
   "rubrics": [
    "regulation"
   ]
  },
  {
   "name": "SEC Press Releases",
   "url": "https://www.sec.gov/newsroom/press-releases",
   "group": "official",
   "rubrics": [
    "regulation"
   ]
  },
  {
   "name": "ESMA News",
   "url": "https://www.esma.europa.eu/press-news",
   "group": "official",
   "rubrics": [
    "regulation"
   ]
  },
  {
   "name": "FATF Publications",
   "url": "https://www.fatf-gafi.org/en/publications.html",
   "group": "official",
   "rubrics": [
    "regulation"
   ]
  },
  {
   "name": "CoinDesk Policy",
   "url": "https://www.coindesk.com/policy/",
   "group": "media",
   "rubrics": [
    "regulation"
   ]
  },
  {
   "name": "Cointelegraph RU регулирование",
   "url": "https://ru.cointelegraph.com/tags/regulation",
   "group": "media",
   "rubrics": [
    "regulation"
   ]
  },
  {
   "name": "КонсультантПлюс Новости права",
   "url": "https://www.consultant.ru/legalnews/",
   "group": "media",
   "rubrics": [
    "regulation"
   ]
  },
  {
   "name": "Binance Russian",
   "url": "https://t.me/s/binance_russian",
   "group": "official",
   "rubrics": [
    "crypto_services"
   ]
  },
  {
   "name": "TON Blockchain",
   "url": "https://t.me/s/tonblockchain",
   "group": "media",
   "rubrics": [
    "crypto_services"
   ]
  },
  {
   "name": "Bybit Blog",
   "url": "https://learn.bybit.com/",
   "group": "official",
   "rubrics": [
    "crypto_services"
   ]
  },
  {
   "name": "Ledger Blog",
   "url": "https://www.ledger.com/blog",
   "group": "official",
   "rubrics": [
    "crypto_services"
   ]
  },
  {
   "name": "Trust Wallet Blog",
   "url": "https://trustwallet.com/blog",
   "group": "official",
   "rubrics": [
    "crypto_services"
   ]
  },
  {
   "name": "MetaMask News",
   "url": "https://metamask.io/news",
   "group": "official",
   "rubrics": [
    "crypto_services"
   ]
  },
  {
   "name": "Kraken Blog",
   "url": "https://blog.kraken.com/",
   "group": "official",
   "rubrics": [
    "crypto_services"
   ]
  },
  {
   "name": "Coinbase Blog",
   "url": "https://www.coinbase.com/blog",
   "group": "official",
   "rubrics": [
    "crypto_services"
   ]
  },
  {
   "name": "TON Blog",
   "url": "https://ton.org/en/blog",
   "group": "official",
   "rubrics": [
    "crypto_services"
   ]
  },
  {
   "name": "Crypto Emergency",
   "url": "https://t.me/s/cryptoemergency",
   "group": "media",
   "rubrics": [
    "crypto_unusual"
   ]
  },
  {
   "name": "Decrypt",
   "url": "https://decrypt.co/news",
   "group": "media",
   "rubrics": [
    "crypto_unusual"
   ]
  },
  {
   "name": "CryptoSlate",
   "url": "https://cryptoslate.com/",
   "group": "media",
   "rubrics": [
    "crypto_unusual"
   ]
  },
  {
   "name": "Bitcoin Magazine",
   "url": "https://bitcoinmagazine.com/",
   "group": "media",
   "rubrics": [
    "crypto_unusual"
   ]
  },
  {
   "name": "U.Today",
   "url": "https://u.today/",
   "group": "media",
   "rubrics": [
    "crypto_unusual"
   ]
  },
  {
   "name": "The Daily Hodl",
   "url": "https://dailyhodl.com/",
   "group": "media",
   "rubrics": [
    "crypto_unusual"
   ]
  },
  {
   "name": "NewsBTC",
   "url": "https://www.newsbtc.com/",
   "group": "media",
   "rubrics": [
    "crypto_unusual"
   ]
  },
  {
   "name": "CryptoNews.com",
   "url": "https://cryptonews.com/news/",
   "group": "media",
   "rubrics": [
    "crypto_unusual"
   ]
  },
  {
   "name": "Cointelegraph",
   "url": "https://cointelegraph.com/",
   "group": "media",
   "rubrics": [
    "crypto_unusual"
   ]
  },
  {
   "name": "The Block",
   "url": "https://www.theblock.co/",
   "group": "media",
   "rubrics": [
    "crypto_unusual"
   ]
  },
  {
   "name": "Мысли Вайкоффа",
   "url": "https://t.me/s/WYCKOFF_COMPANY",
   "group": "blogger",
   "rubrics": [
    "crypto_bloggers"
   ]
  },
  {
   "name": "Trader 80/20",
   "url": "https://t.me/s/tradertrend",
   "group": "blogger",
   "rubrics": [
    "crypto_bloggers"
   ]
  },
  {
   "name": "Алиев Азиз",
   "url": "https://t.me/s/alievtrade",
   "group": "blogger",
   "rubrics": [
    "crypto_bloggers"
   ]
  },
  {
   "name": "Трейдер отвечает",
   "url": "https://t.me/s/traderanswers",
   "group": "blogger",
   "rubrics": [
    "crypto_bloggers"
   ]
  },
  {
   "name": "Криптоаналитик",
   "url": "https://t.me/s/crypto_an",
   "group": "blogger",
   "rubrics": [
    "crypto_bloggers"
   ]
  },
  {
   "name": "Григорий Полежаев",
   "url": "https://t.me/s/homakill",
   "group": "blogger",
   "rubrics": [
    "crypto_bloggers"
   ]
  },
  {
   "name": "Криптофилы",
   "url": "https://t.me/s/cryptophilos",
   "group": "blogger",
   "rubrics": [
    "crypto_bloggers"
   ]
  },
  {
   "name": "Кит",
   "url": "https://t.me/s/cryptokitta",
   "group": "blogger",
   "rubrics": [
    "crypto_bloggers"
   ]
  },
  {
   "name": "Kotov Invest",
   "url": "https://t.me/s/kotov_invest",
   "group": "blogger",
   "rubrics": [
    "crypto_bloggers"
   ]
  },
  {
   "name": "Крипто Лимон",
   "url": "https://t.me/s/CryptoLemon777",
   "group": "blogger",
   "rubrics": [
    "crypto_bloggers"
   ]
  }
 ],
 "stars": [
  {
   "name": "Starhit Звёзды",
   "url": "https://starhit.ru/novosti/",
   "group": "media",
   "rubrics": [
    "relationships"
   ]
  },
  {
   "name": "Woman.ru Звёзды",
   "url": "https://www.woman.ru/stars/",
   "group": "media",
   "rubrics": [
    "relationships"
   ]
  },
  {
   "name": "Super.ru",
   "url": "https://www.super.ru/",
   "group": "media",
   "rubrics": [
    "relationships"
   ]
  },
  {
   "name": "Леди Mail Звёзды",
   "url": "https://lady.mail.ru/stars/",
   "group": "media",
   "rubrics": [
    "relationships"
   ]
  },
  {
   "name": "Hello.ru",
   "url": "https://hello.ru/",
   "group": "media",
   "rubrics": [
    "relationships"
   ]
  },
  {
   "name": "Passion.ru Звёзды",
   "url": "https://www.passion.ru/news/",
   "group": "media",
   "rubrics": [
    "relationships",
    "social_events"
   ]
  },
  {
   "name": "Дни.ру Звёзды",
   "url": "https://7days.ru/news/",
   "group": "media",
   "rubrics": [
    "relationships"
   ]
  },
  {
   "name": "Eg.ru Звёзды",
   "url": "https://www.eg.ru/showbiz/",
   "group": "media",
   "rubrics": [
    "relationships"
   ]
  },
  {
   "name": "Теленеделя",
   "url": "https://www.teleprogramma.pro/",
   "group": "media",
   "rubrics": [
    "relationships",
    "shows_performances"
   ]
  },
  {
   "name": "Лента.ру Звёзды",
   "url": "https://lenta.ru/rubrics/culture/",
   "group": "media",
   "rubrics": [
    "relationships"
   ]
  },
  {
   "name": "Peopletalk Звёзды",
   "url": "https://www.peopletalk.ru/news/",
   "group": "media",
   "rubrics": [
    "celeb_fun"
   ]
  },
  {
   "name": "Cosmo.ru Звёзды",
   "url": "https://www.cosmo.ru/stars/",
   "group": "media",
   "rubrics": [
    "celeb_fun"
   ]
  },
  {
   "name": "Elle Звёзды",
   "url": "https://www.elle.ru/celebrity/",
   "group": "media",
   "rubrics": [
    "celeb_fun"
   ]
  },
  {
   "name": "Woman.ru Юмор",
   "url": "https://www.woman.ru/",
   "group": "media",
   "rubrics": [
    "celeb_fun"
   ]
  },
  {
   "name": "Мир Говорит Show",
   "url": "https://tvrain.ru/",
   "group": "media",
   "rubrics": [
    "celeb_fun"
   ]
  },
  {
   "name": "КП Звёзды",
   "url": "https://www.kp.ru/daily/stars/",
   "group": "media",
   "rubrics": [
    "celeb_fun"
   ]
  },
  {
   "name": "MK Шоубиз",
   "url": "https://www.mk.ru/culture/",
   "group": "media",
   "rubrics": [
    "celeb_fun"
   ]
  },
  {
   "name": "Show.ru",
   "url": "https://www.7days.ru/stars/",
   "group": "media",
   "rubrics": [
    "celeb_fun"
   ]
  },
  {
   "name": "Joy-Pup",
   "url": "https://joyreactor.cc/",
   "group": "media",
   "rubrics": [
    "celeb_fun"
   ]
  },
  {
   "name": "Dni.ru",
   "url": "https://www.dni.ru/showbiz",
   "group": "media",
   "rubrics": [
    "celeb_fun"
   ]
  },
  {
   "name": "Muz-TV",
   "url": "https://t.me/s/muztv",
   "group": "official",
   "rubrics": [
    "music"
   ]
  },
  {
   "name": "Яндекс Музыка",
   "url": "https://t.me/s/yandexmusic_live",
   "group": "official",
   "rubrics": [
    "music"
   ]
  },
  {
   "name": "Radio Record",
   "url": "https://t.me/s/radiorecord",
   "group": "official",
   "rubrics": [
    "music"
   ]
  },
  {
   "name": "Европа Плюс",
   "url": "https://t.me/s/europaplus_radio",
   "group": "official",
   "rubrics": [
    "music"
   ]
  },
  {
   "name": "Авторадио",
   "url": "https://t.me/s/avtoradioru",
   "group": "official",
   "rubrics": [
    "music"
   ]
  },
  {
   "name": "Rap.ru",
   "url": "https://www.rap.ru/",
   "group": "media",
   "rubrics": [
    "music"
   ]
  },
  {
   "name": "The Flow",
   "url": "https://www.the-flow.ru/",
   "group": "media",
   "rubrics": [
    "music"
   ]
  },
  {
   "name": "Афиша Музыка",
   "url": "https://daily.afisha.ru/music/",
   "group": "media",
   "rubrics": [
    "music"
   ]
  },
  {
   "name": "Billboard",
   "url": "https://www.billboard.com/",
   "group": "media",
   "rubrics": [
    "music"
   ]
  },
  {
   "name": "Rolling Stone Russia",
   "url": "https://rollingstone.ru/",
   "group": "media",
   "rubrics": [
    "music"
   ]
  },
  {
   "name": "Vogue Russia",
   "url": "https://www.vogue.ru/",
   "group": "media",
   "rubrics": [
    "looks"
   ]
  },
  {
   "name": "Elle Fashion",
   "url": "https://www.elle.ru/moda/",
   "group": "media",
   "rubrics": [
    "looks"
   ]
  },
  {
   "name": "Harper's Bazaar RU",
   "url": "https://harpersbazaar.ru/",
   "group": "media",
   "rubrics": [
    "looks"
   ]
  },
  {
   "name": "Glamour Russia",
   "url": "https://www.glamour.ru/",
   "group": "media",
   "rubrics": [
    "looks"
   ]
  },
  {
   "name": "Cosmo Мода",
   "url": "https://www.cosmo.ru/fashion/",
   "group": "media",
   "rubrics": [
    "looks"
   ]
  },
  {
   "name": "Lime",
   "url": "https://lime-shop.com/blog",
   "group": "media",
   "rubrics": [
    "looks"
   ]
  },
  {
   "name": "Buro 24/7",
   "url": "https://www.buro247.ru/fashion/",
   "group": "media",
   "rubrics": [
    "looks"
   ]
  },
  {
   "name": "L'Officiel",
   "url": "https://www.lofficiel.ru/",
   "group": "media",
   "rubrics": [
    "looks"
   ]
  },
  {
   "name": "Marie Claire",
   "url": "https://www.marieclaire.ru/",
   "group": "media",
   "rubrics": [
    "looks"
   ]
  },
  {
   "name": "Woman Мода",
   "url": "https://www.womanhit.ru/",
   "group": "media",
   "rubrics": [
    "looks"
   ]
  },
  {
   "name": "Starhit",
   "url": "https://www.starhit.ru/novosti/",
   "group": "media",
   "rubrics": [
    "social_events"
   ]
  },
  {
   "name": "7Дней",
   "url": "https://7days.ru/stars/",
   "group": "media",
   "rubrics": [
    "social_events",
    "shows_performances",
    "celeb_fun"
   ]
  },
  {
   "name": "WMJ",
   "url": "https://www.wmj.ru/",
   "group": "media",
   "rubrics": [
    "social_events",
    "shows_performances",
    "looks"
   ]
  },
  {
   "name": "PeopleTalk",
   "url": "https://peopletalk.ru/",
   "group": "media",
   "rubrics": [
    "social_events",
    "shows_performances",
    "looks"
   ]
  },
  {
   "name": "Вокруг ТВ",
   "url": "https://www.vokrug.tv/",
   "group": "media",
   "rubrics": [
    "social_events",
    "shows_performances",
    "celeb_fun"
   ]
  },
  {
   "name": "Life.ru Шоубиз",
   "url": "https://life.ru/s/shoubiz",
   "group": "media",
   "rubrics": [
    "social_events",
    "shows_performances",
    "celeb_fun"
   ]
  },
  {
   "name": "Super.ru",
   "url": "https://super.ru/",
   "group": "media",
   "rubrics": [
    "social_events",
    "shows_performances",
    "celeb_fun"
   ]
  },
  {
   "name": "Starhit (Telegram)",
   "url": "https://t.me/s/starhit",
   "group": "media",
   "rubrics": [
    "social_events",
    "relationships"
   ]
  },
  {
   "name": "Газета.ру Шоубиз",
   "url": "https://www.gazeta.ru/culture/",
   "group": "media",
   "rubrics": [
    "social_events",
    "music"
   ]
  },
  {
   "name": "Starhit",
   "url": "https://www.starhit.ru/",
   "group": "media",
   "rubrics": [
    "shows_performances",
    "looks",
    "celeb_fun"
   ]
  },
  {
   "name": "Passion.ru",
   "url": "https://www.passion.ru/",
   "group": "media",
   "rubrics": [
    "shows_performances",
    "celeb_fun",
    "relationships"
   ]
  },
  {
   "name": "Афиша",
   "url": "https://www.afisha.ru/",
   "group": "media",
   "rubrics": [
    "shows_performances"
   ]
  },
  {
   "name": "Harper's Bazaar",
   "url": "https://www.harpersbazaar.ru/",
   "group": "media",
   "rubrics": [
    "looks"
   ]
  },
  {
   "name": "InStyle",
   "url": "https://www.instyle.ru/",
   "group": "media",
   "rubrics": [
    "looks"
   ]
  },
  {
   "name": "Elle",
   "url": "https://www.elle.ru/",
   "group": "media",
   "rubrics": [
    "looks"
   ]
  },
  {
   "name": "Cosmopolitan",
   "url": "https://www.cosmo.ru/",
   "group": "media",
   "rubrics": [
    "looks"
   ]
  },
  {
   "name": "Buro 24/7",
   "url": "https://www.buro247.ru/",
   "group": "media",
   "rubrics": [
    "looks"
   ]
  },
  {
   "name": "Газета.ру",
   "url": "https://www.gazeta.ru/social/",
   "group": "media",
   "rubrics": [
    "celeb_fun"
   ]
  },
  {
   "name": "Rap.ru",
   "url": "https://rap.ru/",
   "group": "media",
   "rubrics": [
    "music"
   ]
  },
  {
   "name": "Муз-ТВ",
   "url": "https://muz-tv.ru/",
   "group": "media",
   "rubrics": [
    "music"
   ]
  },
  {
   "name": "Europa Plus",
   "url": "https://www.europaplus.ru/",
   "group": "media",
   "rubrics": [
    "music"
   ]
  },
  {
   "name": "ТАСС Культура",
   "url": "https://tass.ru/kultura",
   "group": "media",
   "rubrics": [
    "music"
   ]
  }
 ],
 "sport": [
  {
   "name": "Матч ТВ Шоу",
   "url": "https://matchtv.ru/",
   "group": "media",
   "rubrics": [
    "sport_shows"
   ]
  },
  {
   "name": "Eurosport Ru",
   "url": "https://www.eurosport.ru/",
   "group": "media",
   "rubrics": [
    "sport_shows"
   ]
  },
  {
   "name": "RSport Другие виды",
   "url": "https://rsport.ria.ru/",
   "group": "media",
   "rubrics": [
    "sport_shows",
    "sport_viral"
   ]
  },
  {
   "name": "Top Dog FC",
   "url": "https://t.me/s/topdogfc",
   "group": "official",
   "rubrics": [
    "sport_shows"
   ]
  },
  {
   "name": "Hardcore MMA",
   "url": "https://t.me/s/hardcorefc",
   "group": "official",
   "rubrics": [
    "sport_shows"
   ]
  },
  {
   "name": "ACA MMA",
   "url": "https://t.me/s/acamma",
   "group": "official",
   "rubrics": [
    "sport_shows"
   ]
  },
  {
   "name": "Лига Ставок Медиа",
   "url": "https://t.me/s/ligastavok_media",
   "group": "media",
   "rubrics": [
    "sport_shows"
   ]
  },
  {
   "name": "Sports.ru Cyber",
   "url": "https://cyber.sports.ru/",
   "group": "media",
   "rubrics": [
    "sport_shows"
   ]
  },
  {
   "name": "UFC",
   "url": "https://www.ufc.com/news",
   "group": "official",
   "rubrics": [
    "sport_shows",
    "ufc_mma"
   ]
  },
  {
   "name": "WWE",
   "url": "https://www.wwe.com/",
   "group": "official",
   "rubrics": [
    "sport_shows"
   ]
  },
  {
   "name": "Sports.ru Tribuna",
   "url": "https://tribuna.com/ru/",
   "group": "blogger",
   "rubrics": [
    "sport_bloggers"
   ]
  },
  {
   "name": "Матч ТВ",
   "url": "https://t.me/s/matchtv",
   "group": "media",
   "rubrics": [
    "sport_bloggers",
    "football",
    "pop_mma"
   ]
  },
  {
   "name": "Олег Романцев",
   "url": "https://t.me/s/sportsru",
   "group": "media",
   "rubrics": [
    "sport_bloggers"
   ]
  },
  {
   "name": "Алексей Андронов",
   "url": "https://t.me/s/andronovlive",
   "group": "blogger",
   "rubrics": [
    "sport_bloggers"
   ]
  },
  {
   "name": "Игорь Рабинер",
   "url": "https://t.me/s/rabinerigor",
   "group": "blogger",
   "rubrics": [
    "sport_bloggers"
   ]
  },
  {
   "name": "Георгий Черданцев",
   "url": "https://t.me/s/cherdantsev",
   "group": "blogger",
   "rubrics": [
    "sport_bloggers"
   ]
  },
  {
   "name": "Дмитрий Губерниев",
   "url": "https://t.me/s/guberniev",
   "group": "blogger",
   "rubrics": [
    "sport_bloggers"
   ]
  },
  {
   "name": "Василий Уткин",
   "url": "https://t.me/s/vasilyutkin",
   "group": "blogger",
   "rubrics": [
    "sport_bloggers"
   ]
  },
  {
   "name": "СЭ Блоги",
   "url": "https://www.sport-express.ru/blogs/",
   "group": "blogger",
   "rubrics": [
    "sport_bloggers"
   ]
  },
  {
   "name": "Чемпионат Блоги",
   "url": "https://www.championat.com/blogs/",
   "group": "blogger",
   "rubrics": [
    "sport_bloggers"
   ]
  },
  {
   "name": "Sports.ru Футбол",
   "url": "https://www.sports.ru/football/",
   "group": "media",
   "rubrics": [
    "football",
    "media_football"
   ]
  },
  {
   "name": "Чемпионат Футбол",
   "url": "https://www.championat.com/football/",
   "group": "media",
   "rubrics": [
    "football"
   ]
  },
  {
   "name": "Sport24 Футбол",
   "url": "https://sport24.ru/football",
   "group": "media",
   "rubrics": [
    "football",
    "media_football"
   ]
  },
  {
   "name": "Спорт-Экспресс Футбол",
   "url": "https://www.sport-express.ru/football/",
   "group": "media",
   "rubrics": [
    "football",
    "media_football"
   ]
  },
  {
   "name": "Советский спорт Футбол",
   "url": "https://www.sovsport.ru/football",
   "group": "media",
   "rubrics": [
    "football",
    "media_football"
   ]
  },
  {
   "name": "РСпорт Футбол",
   "url": "https://rsport.ria.ru/football/",
   "group": "media",
   "rubrics": [
    "football",
    "media_football"
   ]
  },
  {
   "name": "Газета.ру Футбол",
   "url": "https://www.gazeta.ru/sport/football/",
   "group": "media",
   "rubrics": [
    "football",
    "media_football"
   ]
  },
  {
   "name": "Матч ТВ Футбол",
   "url": "https://matchtv.ru/football",
   "group": "media",
   "rubrics": [
    "football"
   ]
  },
  {
   "name": "РФС новости",
   "url": "https://rfs.ru/news/",
   "group": "official",
   "rubrics": [
    "football"
   ]
  },
  {
   "name": "Чемпионат (Telegram)",
   "url": "https://t.me/s/championat",
   "group": "media",
   "rubrics": [
    "football",
    "media_football",
    "sport_viral"
   ]
  },
  {
   "name": "Sports.ru Хоккей",
   "url": "https://www.sports.ru/hockey/",
   "group": "media",
   "rubrics": [
    "hockey"
   ]
  },
  {
   "name": "Чемпионат Хоккей",
   "url": "https://www.championat.com/hockey/",
   "group": "media",
   "rubrics": [
    "hockey"
   ]
  },
  {
   "name": "Sport24 Хоккей",
   "url": "https://sport24.ru/hockey",
   "group": "media",
   "rubrics": [
    "hockey"
   ]
  },
  {
   "name": "Спорт-Экспресс Хоккей",
   "url": "https://www.sport-express.ru/hockey/",
   "group": "media",
   "rubrics": [
    "hockey"
   ]
  },
  {
   "name": "Советский спорт Хоккей",
   "url": "https://www.sovsport.ru/hockey",
   "group": "media",
   "rubrics": [
    "hockey"
   ]
  },
  {
   "name": "РСпорт Хоккей",
   "url": "https://rsport.ria.ru/hockey/",
   "group": "media",
   "rubrics": [
    "hockey"
   ]
  },
  {
   "name": "Газета.ру Хоккей",
   "url": "https://www.gazeta.ru/sport/hockey/",
   "group": "media",
   "rubrics": [
    "hockey"
   ]
  },
  {
   "name": "КХЛ новости",
   "url": "https://www.khl.ru/news/",
   "group": "official",
   "rubrics": [
    "hockey"
   ]
  },
  {
   "name": "Матч ТВ Хоккей",
   "url": "https://matchtv.ru/hockey",
   "group": "media",
   "rubrics": [
    "hockey"
   ]
  },
  {
   "name": "НХЛ на русском",
   "url": "https://www.nhl.com/ru",
   "group": "official",
   "rubrics": [
    "hockey"
   ]
  },
  {
   "name": "Sports.ru ММА",
   "url": "https://www.sports.ru/mma/",
   "group": "media",
   "rubrics": [
    "ufc_mma",
    "pop_mma",
    "sport_shows"
   ]
  },
  {
   "name": "Sport24 ММА",
   "url": "https://sport24.ru/mma",
   "group": "blogger",
   "rubrics": [
    "ufc_mma",
    "pop_mma",
    "sport_shows"
   ]
  },
  {
   "name": "Спорт-Экспресс ММА",
   "url": "https://www.sport-express.ru/mma/",
   "group": "media",
   "rubrics": [
    "ufc_mma",
    "pop_mma"
   ]
  },
  {
   "name": "Советский спорт ММА",
   "url": "https://www.sovsport.ru/mma",
   "group": "media",
   "rubrics": [
    "ufc_mma",
    "pop_mma"
   ]
  },
  {
   "name": "РСпорт ММА",
   "url": "https://rsport.ria.ru/mma/",
   "group": "media",
   "rubrics": [
    "ufc_mma",
    "pop_mma"
   ]
  },
  {
   "name": "Газета.ру ММА",
   "url": "https://www.gazeta.ru/sport/martial_arts/",
   "group": "media",
   "rubrics": [
    "ufc_mma",
    "pop_mma"
   ]
  },
  {
   "name": "Чемпионат ММА и единоборства",
   "url": "https://www.championat.com/boxing/",
   "group": "media",
   "rubrics": [
    "ufc_mma",
    "boxing",
    "pop_mma"
   ]
  },
  {
   "name": "UFC Russia",
   "url": "https://www.ufc.ru",
   "group": "official",
   "rubrics": [
    "ufc_mma"
   ]
  },
  {
   "name": "Sports.ru Поп-ММА",
   "url": "https://www.sports.ru/pop-mma/news/",
   "group": "blogger",
   "rubrics": [
    "ufc_mma",
    "pop_mma",
    "sport_shows"
   ]
  },
  {
   "name": "Sports.ru Бокс",
   "url": "https://www.sports.ru/boxing/",
   "group": "media",
   "rubrics": [
    "boxing"
   ]
  },
  {
   "name": "Sport24 Бокс",
   "url": "https://sport24.ru/boxing",
   "group": "media",
   "rubrics": [
    "boxing"
   ]
  },
  {
   "name": "Спорт-Экспресс Бокс",
   "url": "https://www.sport-express.ru/boxing/",
   "group": "media",
   "rubrics": [
    "boxing"
   ]
  },
  {
   "name": "Советский спорт Бокс",
   "url": "https://www.sovsport.ru/boxing",
   "group": "media",
   "rubrics": [
    "boxing"
   ]
  },
  {
   "name": "РСпорт Бокс",
   "url": "https://rsport.ria.ru/boxing/",
   "group": "media",
   "rubrics": [
    "boxing"
   ]
  },
  {
   "name": "Газета.ру Бокс",
   "url": "https://www.gazeta.ru/sport/boxing/",
   "group": "media",
   "rubrics": [
    "boxing"
   ]
  },
  {
   "name": "Матч ТВ Бокс",
   "url": "https://matchtv.ru/boxing",
   "group": "media",
   "rubrics": [
    "boxing"
   ]
  },
  {
   "name": "Boxing Scene",
   "url": "https://www.boxingscene.com",
   "group": "media",
   "rubrics": [
    "boxing"
   ]
  },
  {
   "name": "Ring Magazine",
   "url": "https://ringmagazine.com",
   "group": "media",
   "rubrics": [
    "boxing"
   ]
  },
  {
   "name": "Чемпионат Медиафутбол",
   "url": "https://www.championat.com/football/_mediafootball.html",
   "group": "blogger",
   "rubrics": [
    "media_football",
    "sport_shows",
    "sport_bloggers"
   ]
  },
  {
   "name": "Sports.ru блоги",
   "url": "https://www.sports.ru/blogs/",
   "group": "blogger",
   "rubrics": [
    "media_football",
    "sport_bloggers"
   ]
  },
  {
   "name": "Спорт-Экспресс",
   "url": "https://www.sport-express.ru/",
   "group": "media",
   "rubrics": [
    "sport_shows",
    "sport_viral"
   ]
  },
  {
   "name": "Советский спорт",
   "url": "https://www.sovsport.ru/",
   "group": "media",
   "rubrics": [
    "sport_shows",
    "sport_viral"
   ]
  },
  {
   "name": "Газета.ру Спорт",
   "url": "https://www.gazeta.ru/sport/",
   "group": "media",
   "rubrics": [
    "sport_shows",
    "sport_viral"
   ]
  },
  {
   "name": "Sports.ru Видео",
   "url": "https://www.sports.ru/video/",
   "group": "media",
   "rubrics": [
    "sport_viral"
   ]
  },
  {
   "name": "Sport24",
   "url": "https://sport24.ru/",
   "group": "media",
   "rubrics": [
    "sport_viral"
   ]
  },
  {
   "name": "Sports.ru",
   "url": "https://www.sports.ru/",
   "group": "media",
   "rubrics": [
    "sport_viral"
   ]
  },
  {
   "name": "Чемпионат",
   "url": "https://www.championat.com/",
   "group": "media",
   "rubrics": [
    "sport_viral"
   ]
  },
  {
   "name": "Sports.ru Футбол блоги",
   "url": "https://www.sports.ru/football/blogs/",
   "group": "blogger",
   "rubrics": [
    "sport_bloggers"
   ]
  },
  {
   "name": "Sports.ru Хоккей блоги",
   "url": "https://www.sports.ru/hockey/blogs/",
   "group": "blogger",
   "rubrics": [
    "sport_bloggers"
   ]
  },
  {
   "name": "Sports.ru ММА блоги",
   "url": "https://www.sports.ru/mma/blogs/",
   "group": "blogger",
   "rubrics": [
    "sport_bloggers"
   ]
  },
  {
   "name": "Sports.ru Бокс блоги",
   "url": "https://www.sports.ru/boxing/blogs/",
   "group": "blogger",
   "rubrics": [
    "sport_bloggers"
   ]
  }
 ],
 "kino": [
  {
   "name": "Film.ru Новости",
   "url": "https://www.film.ru/articles",
   "group": "media",
   "rubrics": [
    "backstage_casting"
   ]
  },
  {
   "name": "Кинопоиск Журнал",
   "url": "https://www.kinopoisk.ru/media/news/",
   "group": "media",
   "rubrics": [
    "backstage_casting"
   ]
  },
  {
   "name": "Variety",
   "url": "https://variety.com/",
   "group": "media",
   "rubrics": [
    "backstage_casting"
   ]
  },
  {
   "name": "Hollywood Reporter",
   "url": "https://www.hollywoodreporter.com/",
   "group": "media",
   "rubrics": [
    "backstage_casting"
   ]
  },
  {
   "name": "Deadline Casting",
   "url": "https://deadline.com/tag/casting/",
   "group": "media",
   "rubrics": [
    "backstage_casting"
   ]
  },
  {
   "name": "Collider",
   "url": "https://collider.com/",
   "group": "media",
   "rubrics": [
    "backstage_casting"
   ]
  },
  {
   "name": "IndieWire",
   "url": "https://www.indiewire.com/",
   "group": "media",
   "rubrics": [
    "backstage_casting"
   ]
  },
  {
   "name": "Empire",
   "url": "https://www.empireonline.com/movies/news/",
   "group": "media",
   "rubrics": [
    "backstage_casting",
    "premieres",
    "trailers"
   ]
  },
  {
   "name": "ComingSoon",
   "url": "https://www.comingsoon.net/",
   "group": "media",
   "rubrics": [
    "backstage_casting"
   ]
  },
  {
   "name": "Кино-театр Новости",
   "url": "https://www.kino-teatr.ru/news/",
   "group": "media",
   "rubrics": [
    "backstage_casting",
    "premieres"
   ]
  },
  {
   "name": "Кинопоиск Подборки",
   "url": "https://www.kinopoisk.ru/lists/",
   "group": "media",
   "rubrics": [
    "what_to_watch"
   ]
  },
  {
   "name": "Афиша Кино",
   "url": "https://www.afisha.ru/cinema/",
   "group": "media",
   "rubrics": [
    "what_to_watch"
   ]
  },
  {
   "name": "Кинопоиск Новости",
   "url": "https://t.me/s/kinopoisk",
   "group": "official",
   "rubrics": [
    "what_to_watch"
   ]
  },
  {
   "name": "Кинобизнес",
   "url": "https://t.me/s/kinoprotebya",
   "group": "blogger",
   "rubrics": [
    "what_to_watch",
    "kino_bloggers"
   ]
  },
  {
   "name": "Letterboxd Journal",
   "url": "https://letterboxd.com/journal/",
   "group": "media",
   "rubrics": [
    "what_to_watch"
   ]
  },
  {
   "name": "IMDb News",
   "url": "https://www.imdb.com/news/movie/",
   "group": "media",
   "rubrics": [
    "what_to_watch"
   ]
  },
  {
   "name": "What's on Netflix",
   "url": "https://www.whats-on-netflix.com/news/",
   "group": "media",
   "rubrics": [
    "what_to_watch"
   ]
  },
  {
   "name": "Rotten Tomatoes",
   "url": "https://editorial.rottentomatoes.com/",
   "group": "media",
   "rubrics": [
    "what_to_watch"
   ]
  },
  {
   "name": "Okko",
   "url": "https://t.me/s/okko_tv",
   "group": "official",
   "rubrics": [
    "what_to_watch"
   ]
  },
  {
   "name": "Иви",
   "url": "https://t.me/s/ivi_ru",
   "group": "official",
   "rubrics": [
    "what_to_watch"
   ]
  },
  {
   "name": "Новости кинопроизводства",
   "url": "https://t.me/s/filmres",
   "group": "media",
   "rubrics": [
    "premieres",
    "series_streaming",
    "backstage_casting"
   ]
  },
  {
   "name": "Кинопоиск Медиа",
   "url": "https://www.kinopoisk.ru/media/",
   "group": "media",
   "rubrics": [
    "premieres",
    "series_streaming",
    "what_to_watch"
   ]
  },
  {
   "name": "Film.ru",
   "url": "https://www.film.ru/news",
   "group": "media",
   "rubrics": [
    "premieres",
    "trailers",
    "what_to_watch"
   ]
  },
  {
   "name": "Киноафиша",
   "url": "https://www.kinoafisha.info/news/",
   "group": "media",
   "rubrics": [
    "premieres",
    "series_streaming"
   ]
  },
  {
   "name": "КГ-Портал",
   "url": "https://kg-portal.ru/news/",
   "group": "media",
   "rubrics": [
    "premieres"
   ]
  },
  {
   "name": "Variety Film",
   "url": "https://variety.com/v/film/news/",
   "group": "media",
   "rubrics": [
    "premieres",
    "trailers",
    "backstage_casting"
   ]
  },
  {
   "name": "Deadline Film",
   "url": "https://deadline.com/category/film/",
   "group": "media",
   "rubrics": [
    "premieres",
    "backstage_casting"
   ]
  },
  {
   "name": "THR Movies",
   "url": "https://www.hollywoodreporter.com/c/movies/movie-news/",
   "group": "media",
   "rubrics": [
    "premieres"
   ]
  },
  {
   "name": "КиноПоиск YouTube",
   "url": "https://www.youtube.com/@KinoPoisk",
   "group": "official",
   "rubrics": [
    "trailers"
   ]
  },
  {
   "name": "Trailers YouTube",
   "url": "https://www.youtube.com/@FilmTrailerRu",
   "group": "official",
   "rubrics": [
    "trailers"
   ]
  },
  {
   "name": "Movieclips Trailers",
   "url": "https://www.youtube.com/@Movieclips",
   "group": "official",
   "rubrics": [
    "trailers"
   ]
  },
  {
   "name": "IGN Movie Trailers",
   "url": "https://www.youtube.com/@IGNMovieTrailers",
   "group": "official",
   "rubrics": [
    "trailers"
   ]
  },
  {
   "name": "Marvel",
   "url": "https://www.youtube.com/@MarvelEntertainment",
   "group": "official",
   "rubrics": [
    "trailers"
   ]
  },
  {
   "name": "Warner Bros",
   "url": "https://www.youtube.com/@WarnerBrosPictures",
   "group": "official",
   "rubrics": [
    "trailers"
   ]
  },
  {
   "name": "into the streaming-verse",
   "url": "https://t.me/s/streamingverse",
   "group": "media",
   "rubrics": [
    "series_streaming"
   ]
  },
  {
   "name": "VODоворOTT",
   "url": "https://t.me/s/vodott",
   "group": "media",
   "rubrics": [
    "series_streaming"
   ]
  },
  {
   "name": "Культурные русские сериалы",
   "url": "https://t.me/s/kingofyantar",
   "group": "media",
   "rubrics": [
    "series_streaming"
   ]
  },
  {
   "name": "Deadline TV",
   "url": "https://deadline.com/category/tv/",
   "group": "media",
   "rubrics": [
    "series_streaming"
   ]
  },
  {
   "name": "Variety TV",
   "url": "https://variety.com/v/tv/",
   "group": "media",
   "rubrics": [
    "series_streaming"
   ]
  },
  {
   "name": "THR TV",
   "url": "https://www.hollywoodreporter.com/c/tv/",
   "group": "media",
   "rubrics": [
    "series_streaming"
   ]
  },
  {
   "name": "Call me by your meme",
   "url": "https://t.me/s/memehunter",
   "group": "creator",
   "rubrics": [
    "reactions"
   ]
  },
  {
   "name": "Дима SuperVHS: мемы и кино",
   "url": "https://t.me/s/supervhs",
   "group": "blogger",
   "rubrics": [
    "reactions",
    "kino_bloggers"
   ]
  },
  {
   "name": "КиноПесик",
   "url": "https://t.me/s/kinopesik",
   "group": "creator",
   "rubrics": [
    "reactions"
   ]
  },
  {
   "name": "КиноКотик",
   "url": "https://t.me/s/kinokotik",
   "group": "creator",
   "rubrics": [
    "reactions"
   ]
  },
  {
   "name": "Кроненберг нефильтрованный",
   "url": "https://t.me/s/Cronenberg1664",
   "group": "blogger",
   "rubrics": [
    "reactions",
    "kino_bloggers"
   ]
  },
  {
   "name": "Daily tropes",
   "url": "https://t.me/s/dailytropes",
   "group": "creator",
   "rubrics": [
    "reactions"
   ]
  },
  {
   "name": "4 Word Film Review",
   "url": "https://t.me/s/fourword",
   "group": "creator",
   "rubrics": [
    "reactions"
   ]
  },
  {
   "name": "Киношка",
   "url": "https://t.me/s/Kinohkaa",
   "group": "creator",
   "rubrics": [
    "reactions",
    "what_to_watch"
   ]
  },
  {
   "name": "r/movies",
   "url": "https://www.reddit.com/r/movies/top/.rss?t=week",
   "group": "creator",
   "rubrics": [
    "reactions"
   ]
  },
  {
   "name": "Hollyweed",
   "url": "https://t.me/s/LAHollyweed",
   "group": "media",
   "rubrics": [
    "backstage_casting"
   ]
  },
  {
   "name": "Студент в Голливуде",
   "url": "https://t.me/s/student_hollywood",
   "group": "media",
   "rubrics": [
    "backstage_casting"
   ]
  },
  {
   "name": "Кинокостюм для чайников",
   "url": "https://t.me/s/kinocostume",
   "group": "media",
   "rubrics": [
    "backstage_casting"
   ]
  },
  {
   "name": "Cinemagraphie",
   "url": "https://t.me/s/cinemagraphie",
   "group": "media",
   "rubrics": [
    "backstage_casting"
   ]
  },
  {
   "name": "Федор, Бонд и Чук",
   "url": "https://t.me/s/fbchu",
   "group": "blogger",
   "rubrics": [
    "backstage_casting",
    "kino_bloggers"
   ]
  },
  {
   "name": "Запасаемся попкорном",
   "url": "https://t.me/s/zapasaemsyapopkornom",
   "group": "media",
   "rubrics": [
    "what_to_watch"
   ]
  },
  {
   "name": "Смотреть и видеть",
   "url": "https://t.me/s/watchandsee",
   "group": "blogger",
   "rubrics": [
    "what_to_watch",
    "kino_bloggers"
   ]
  },
  {
   "name": "Кино и вино",
   "url": "https://t.me/s/kinowino",
   "group": "media",
   "rubrics": [
    "what_to_watch"
   ]
  },
  {
   "name": "Ремизорро",
   "url": "https://t.me/s/remizorro",
   "group": "blogger",
   "rubrics": [
    "what_to_watch",
    "kino_bloggers"
   ]
  },
  {
   "name": "Комендант кинокрепости",
   "url": "https://t.me/s/textortexel",
   "group": "blogger",
   "rubrics": [
    "what_to_watch",
    "kino_bloggers"
   ]
  },
  {
   "name": "Cut the Crap",
   "url": "https://t.me/s/cutterpool",
   "group": "blogger",
   "rubrics": [
    "kino_bloggers"
   ]
  },
  {
   "name": "BadComedian",
   "url": "https://www.youtube.com/@BadComedian",
   "group": "blogger",
   "rubrics": [
    "kino_bloggers"
   ]
  }
 ],
 "games": [
  {
   "name": "StopGame",
   "url": "https://t.me/s/stopgameru",
   "group": "media",
   "rubrics": [
    "releases",
    "scandals"
   ]
  },
  {
   "name": "iXBT Games",
   "url": "https://t.me/s/ixbt_games",
   "group": "media",
   "rubrics": [
    "releases"
   ]
  },
  {
   "name": "Геймер",
   "url": "https://t.me/s/gamer",
   "group": "media",
   "rubrics": [
    "releases"
   ]
  },
  {
   "name": "StopGame новости",
   "url": "https://stopgame.ru/news",
   "group": "media",
   "rubrics": [
    "releases"
   ]
  },
  {
   "name": "VGTimes",
   "url": "https://vgtimes.ru/news/",
   "group": "media",
   "rubrics": [
    "releases",
    "scandals"
   ]
  },
  {
   "name": "Игромания",
   "url": "https://www.igromania.ru/news/",
   "group": "media",
   "rubrics": [
    "releases"
   ]
  },
  {
   "name": "Gematsu",
   "url": "https://gematsu.com/",
   "group": "media",
   "rubrics": [
    "releases",
    "rumors"
   ]
  },
  {
   "name": "VGC",
   "url": "https://www.videogameschronicle.com/category/news/",
   "group": "media",
   "rubrics": [
    "releases",
    "scandals",
    "rumors"
   ]
  },
  {
   "name": "Eurogamer",
   "url": "https://www.eurogamer.net/archive/news",
   "group": "media",
   "rubrics": [
    "releases"
   ]
  },
  {
   "name": "Bum's Corner",
   "url": "https://t.me/s/bums_official",
   "group": "creator",
   "rubrics": [
    "community_memes"
   ]
  },
  {
   "name": "CS2NEWS",
   "url": "https://t.me/s/newcsgo",
   "group": "media",
   "rubrics": [
    "community_memes",
    "updates"
   ]
  },
  {
   "name": "DTF Games",
   "url": "https://dtf.ru/games",
   "group": "media",
   "rubrics": [
    "community_memes",
    "scandals"
   ]
  },
  {
   "name": "Pikabu Игры",
   "url": "https://pikabu.ru/community/games",
   "group": "creator",
   "rubrics": [
    "community_memes"
   ]
  },
  {
   "name": "r/gaming",
   "url": "https://www.reddit.com/r/gaming/top/.rss?t=week",
   "group": "creator",
   "rubrics": [
    "community_memes"
   ]
  },
  {
   "name": "r/pcmasterrace",
   "url": "https://www.reddit.com/r/pcmasterrace/top/.rss?t=week",
   "group": "creator",
   "rubrics": [
    "community_memes"
   ]
  },
  {
   "name": "r/GamingCirclejerk",
   "url": "https://www.reddit.com/r/GamingCirclejerk/top/.rss?t=week",
   "group": "creator",
   "rubrics": [
    "community_memes"
   ]
  },
  {
   "name": "Kanobu",
   "url": "https://kanobu.ru/news/",
   "group": "media",
   "rubrics": [
    "community_memes"
   ]
  },
  {
   "name": "PlayGround.ru",
   "url": "https://www.playground.ru/news",
   "group": "media",
   "rubrics": [
    "community_memes"
   ]
  },
  {
   "name": "Kuplinov Play",
   "url": "https://www.youtube.com/@KuplinovPlay",
   "group": "blogger",
   "rubrics": [
    "game_bloggers"
   ]
  },
  {
   "name": "BRAINDIT",
   "url": "https://www.youtube.com/@TheBrainDit",
   "group": "blogger",
   "rubrics": [
    "game_bloggers"
   ]
  },
  {
   "name": "Братишкин",
   "url": "https://www.youtube.com/@Bratishkin",
   "group": "blogger",
   "rubrics": [
    "game_bloggers"
   ]
  },
  {
   "name": "Mazellovvv",
   "url": "https://www.youtube.com/@Mazellovvv",
   "group": "blogger",
   "rubrics": [
    "game_bloggers"
   ]
  },
  {
   "name": "StopGame YouTube",
   "url": "https://www.youtube.com/@StopGameRu",
   "group": "blogger",
   "rubrics": [
    "game_bloggers"
   ]
  },
  {
   "name": "Игромания YouTube",
   "url": "https://www.youtube.com/@Igromania",
   "group": "blogger",
   "rubrics": [
    "game_bloggers"
   ]
  },
  {
   "name": "Kanobu YouTube",
   "url": "https://www.youtube.com/@Kanobu",
   "group": "blogger",
   "rubrics": [
    "game_bloggers"
   ]
  },
  {
   "name": "PlayGround YouTube",
   "url": "https://www.youtube.com/@PlayGroundRU",
   "group": "blogger",
   "rubrics": [
    "game_bloggers"
   ]
  },
  {
   "name": "VGTimes YouTube",
   "url": "https://www.youtube.com/@VGTimes",
   "group": "blogger",
   "rubrics": [
    "game_bloggers"
   ]
  },
  {
   "name": "Standoff 2",
   "url": "https://t.me/s/play_standoff2",
   "group": "official",
   "rubrics": [
    "updates"
   ]
  },
  {
   "name": "BLACK RUSSIA",
   "url": "https://t.me/s/br_dev",
   "group": "official",
   "rubrics": [
    "updates"
   ]
  },
  {
   "name": "Mobile Legends CIS",
   "url": "https://t.me/s/mlbbcis",
   "group": "official",
   "rubrics": [
    "updates"
   ]
  },
  {
   "name": "Counter-Strike news",
   "url": "https://www.counter-strike.net/news",
   "group": "official",
   "rubrics": [
    "updates"
   ]
  },
  {
   "name": "Dota 2 news",
   "url": "https://www.dota2.com/news",
   "group": "official",
   "rubrics": [
    "updates"
   ]
  },
  {
   "name": "Steam News",
   "url": "https://store.steampowered.com/news/",
   "group": "official",
   "rubrics": [
    "updates"
   ]
  },
  {
   "name": "SteamDB patchnotes",
   "url": "https://steamdb.info/patchnotes/",
   "group": "media",
   "rubrics": [
    "updates"
   ]
  },
  {
   "name": "Valorant news",
   "url": "https://playvalorant.com/en-us/news/",
   "group": "official",
   "rubrics": [
    "updates"
   ]
  },
  {
   "name": "LoL updates",
   "url": "https://www.leagueoflegends.com/en-us/news/game-updates/",
   "group": "official",
   "rubrics": [
    "updates"
   ]
  },
  {
   "name": "Epic Free Games",
   "url": "https://store.epicgames.com/ru/free-games",
   "group": "official",
   "rubrics": [
    "discounts"
   ]
  },
  {
   "name": "Steam Specials",
   "url": "https://store.steampowered.com/specials",
   "group": "official",
   "rubrics": [
    "discounts"
   ]
  },
  {
   "name": "SteamDB Sales",
   "url": "https://steamdb.info/sales/",
   "group": "media",
   "rubrics": [
    "discounts"
   ]
  },
  {
   "name": "gg.deals",
   "url": "https://gg.deals/deals/",
   "group": "media",
   "rubrics": [
    "discounts"
   ]
  },
  {
   "name": "IsThereAnyDeal",
   "url": "https://isthereanydeal.com/deals/",
   "group": "media",
   "rubrics": [
    "discounts"
   ]
  },
  {
   "name": "r/GameDeals",
   "url": "https://www.reddit.com/r/GameDeals/new/.rss",
   "group": "creator",
   "rubrics": [
    "discounts"
   ]
  },
  {
   "name": "r/FreeGameFindings",
   "url": "https://www.reddit.com/r/FreeGameFindings/new/.rss",
   "group": "creator",
   "rubrics": [
    "discounts"
   ]
  },
  {
   "name": "Humble Store",
   "url": "https://www.humblebundle.com/store",
   "group": "official",
   "rubrics": [
    "discounts"
   ]
  },
  {
   "name": "GamesIndustry.biz",
   "url": "https://www.gamesindustry.biz/news",
   "group": "media",
   "rubrics": [
    "scandals"
   ]
  },
  {
   "name": "Kotaku",
   "url": "https://kotaku.com/",
   "group": "media",
   "rubrics": [
    "scandals"
   ]
  },
  {
   "name": "Polygon",
   "url": "https://www.polygon.com/news",
   "group": "media",
   "rubrics": [
    "scandals"
   ]
  },
  {
   "name": "PC Gamer",
   "url": "https://www.pcgamer.com/news/",
   "group": "media",
   "rubrics": [
    "scandals"
   ]
  },
  {
   "name": "Insider Gaming",
   "url": "https://insider-gaming.com/",
   "group": "media",
   "rubrics": [
    "scandals",
    "rumors"
   ]
  },
  {
   "name": "Wccftech Gaming",
   "url": "https://wccftech.com/topic/gaming/",
   "group": "media",
   "rubrics": [
    "rumors"
   ]
  },
  {
   "name": "Pure Xbox",
   "url": "https://www.purexbox.com/news",
   "group": "media",
   "rubrics": [
    "rumors"
   ]
  },
  {
   "name": "Push Square",
   "url": "https://www.pushsquare.com/news",
   "group": "media",
   "rubrics": [
    "rumors"
   ]
  },
  {
   "name": "Nintendo Life",
   "url": "https://www.nintendolife.com/news",
   "group": "media",
   "rubrics": [
    "rumors"
   ]
  },
  {
   "name": "r/GamingLeaksAndRumours",
   "url": "https://www.reddit.com/r/GamingLeaksAndRumours/new/.rss",
   "group": "creator",
   "rubrics": [
    "rumors"
   ]
  },
  {
   "name": "IGN",
   "url": "https://www.ign.com/news",
   "group": "media",
   "rubrics": [
    "rumors"
   ]
  }
 ],
 "travel": [
  {
   "name": "Путешествуем.РФ",
   "url": "https://t.me/s/puteshestvuem_rf",
   "group": "official",
   "rubrics": [
    "destinations"
   ]
  },
  {
   "name": "Туту",
   "url": "https://t.me/s/tutu_travel",
   "group": "media",
   "rubrics": [
    "destinations",
    "visas"
   ]
  },
  {
   "name": "Travelhacks",
   "url": "https://t.me/s/travelhacks",
   "group": "creator",
   "rubrics": [
    "destinations",
    "travel_practice"
   ]
  },
  {
   "name": "Интерфакс-Туризм",
   "url": "https://t.me/s/InterfaxTourism",
   "group": "media",
   "rubrics": [
    "destinations",
    "visas"
   ]
  },
  {
   "name": "Венгрия, Будапешт и не только",
   "url": "https://t.me/s/tripandme",
   "group": "blogger",
   "rubrics": [
    "destinations",
    "travel_bloggers"
   ]
  },
  {
   "name": "Больше, чем путешествие",
   "url": "https://t.me/s/morethantrip_ru",
   "group": "official",
   "rubrics": [
    "destinations"
   ]
  },
  {
   "name": "Travelbelka",
   "url": "https://t.me/s/travelbelka",
   "group": "media",
   "rubrics": [
    "destinations",
    "hotels"
   ]
  },
  {
   "name": "YouTravel.me",
   "url": "https://t.me/s/youtravelme",
   "group": "media",
   "rubrics": [
    "destinations",
    "unusual_places"
   ]
  },
  {
   "name": "Наша Планета - Самые красивые места Земли",
   "url": "https://t.me/s/naplaneta",
   "group": "media",
   "rubrics": [
    "unusual_places"
   ]
  },
  {
   "name": "Необычные путешествия",
   "url": "https://t.me/s/mikearoundtheworld",
   "group": "blogger",
   "rubrics": [
    "unusual_places",
    "travel_bloggers"
   ]
  },
  {
   "name": "Аномальные места планеты",
   "url": "https://t.me/s/planeta_mistiki",
   "group": "media",
   "rubrics": [
    "unusual_places"
   ]
  },
  {
   "name": "Tripster",
   "url": "https://t.me/s/tripsterofficial",
   "group": "official",
   "rubrics": [
    "unusual_places",
    "travel_practice"
   ]
  },
  {
   "name": "Вандроуки",
   "url": "https://t.me/s/vandroukiru",
   "group": "creator",
   "rubrics": [
    "unusual_places",
    "tickets_prices"
   ]
  },
  {
   "name": "Travel Forever",
   "url": "https://t.me/s/travelforeveryoutube",
   "group": "blogger",
   "rubrics": [
    "unusual_places",
    "travel_practice"
   ]
  },
  {
   "name": "Andrey Burenok",
   "url": "https://t.me/s/andrey_burenok",
   "group": "blogger",
   "rubrics": [
    "unusual_places",
    "travel_bloggers"
   ]
  },
  {
   "name": "Авиасейлс",
   "url": "https://t.me/s/aviasales",
   "group": "official",
   "rubrics": [
    "tickets_prices",
    "visas"
   ]
  },
  {
   "name": "TravelRadar",
   "url": "https://t.me/s/travelradar",
   "group": "media",
   "rubrics": [
    "tickets_prices",
    "visas"
   ]
  },
  {
   "name": "Путешествуй дешево Piratesru",
   "url": "https://t.me/s/piratesru",
   "group": "creator",
   "rubrics": [
    "tickets_prices"
   ]
  },
  {
   "name": "Biletix",
   "url": "https://t.me/s/biletixru",
   "group": "official",
   "rubrics": [
    "tickets_prices"
   ]
  },
  {
   "name": "OneTwoTrip",
   "url": "https://t.me/s/OneTwoTrip",
   "group": "official",
   "rubrics": [
    "tickets_prices",
    "hotels"
   ]
  },
  {
   "name": "S7 Airlines",
   "url": "https://t.me/s/s7airlines",
   "group": "official",
   "rubrics": [
    "tickets_prices"
   ]
  },
  {
   "name": "Уральские авиалинии",
   "url": "https://t.me/s/uralairlines",
   "group": "official",
   "rubrics": [
    "tickets_prices"
   ]
  },
  {
   "name": "А виза нужна?",
   "url": "https://t.me/s/visa_required",
   "group": "media",
   "rubrics": [
    "visas"
   ]
  },
  {
   "name": "Консульский департамент МИД России",
   "url": "https://t.me/s/kd_mid",
   "group": "official",
   "rubrics": [
    "visas"
   ]
  },
  {
   "name": "Турпром",
   "url": "https://t.me/s/tourprom",
   "group": "media",
   "rubrics": [
    "visas",
    "hotels"
   ]
  },
  {
   "name": "Nomad",
   "url": "https://t.me/s/astonspassport",
   "group": "creator",
   "rubrics": [
    "visas",
    "travel_practice"
   ]
  },
  {
   "name": "Tophotels.Agent",
   "url": "https://t.me/s/tophotels_agent",
   "group": "media",
   "rubrics": [
    "hotels"
   ]
  },
  {
   "name": "Отели в Telegram",
   "url": "https://t.me/s/otelivtelege",
   "group": "media",
   "rubrics": [
    "hotels"
   ]
  },
  {
   "name": "Островок!",
   "url": "https://t.me/s/ostrovok_travel",
   "group": "official",
   "rubrics": [
    "hotels"
   ]
  },
  {
   "name": "Горящие туры",
   "url": "https://t.me/s/goryashchie",
   "group": "media",
   "rubrics": [
    "hotels"
   ]
  },
  {
   "name": "Туроператор АЛЕАН",
   "url": "https://t.me/s/aleanru",
   "group": "official",
   "rubrics": [
    "hotels"
   ]
  },
  {
   "name": "Cyprus_iT",
   "url": "https://t.me/s/cyprusit",
   "group": "blogger",
   "rubrics": [
    "travel_practice",
    "travel_bloggers"
   ]
  },
  {
   "name": "Твой друг серб",
   "url": "https://t.me/s/tvojdrugserb",
   "group": "blogger",
   "rubrics": [
    "travel_practice",
    "travel_bloggers"
   ]
  },
  {
   "name": "Привет, не хочешь сходить?",
   "url": "https://t.me/s/privetpoidem",
   "group": "blogger",
   "rubrics": [
    "travel_practice",
    "travel_bloggers"
   ]
  },
  {
   "name": "elivosk",
   "url": "https://t.me/s/elivosk",
   "group": "blogger",
   "rubrics": [
    "travel_practice",
    "travel_bloggers"
   ]
  },
  {
   "name": "gaponspb",
   "url": "https://t.me/s/gaponspb1",
   "group": "blogger",
   "rubrics": [
    "travel_bloggers"
   ]
  }
 ],
 "food": [
  {
   "name": "Кухня наизнанку",
   "url": "https://t.me/s/min2ru",
   "group": "creator",
   "rubrics": [
    "viral_dishes",
    "easy_recipes"
   ]
  },
  {
   "name": "Едим Дома",
   "url": "https://t.me/s/edimdomaru",
   "group": "media",
   "rubrics": [
    "viral_dishes",
    "food_hacks"
   ]
  },
  {
   "name": "Food.ru",
   "url": "https://t.me/s/foodrumedia",
   "group": "media",
   "rubrics": [
    "viral_dishes"
   ]
  },
  {
   "name": "Eda.ru",
   "url": "https://t.me/s/edaruofficial",
   "group": "media",
   "rubrics": [
    "viral_dishes",
    "easy_recipes"
   ]
  },
  {
   "name": "Кулинария Вкусные Рецепты",
   "url": "https://t.me/s/kulinariya_retsept",
   "group": "media",
   "rubrics": [
    "viral_dishes",
    "easy_recipes"
   ]
  },
  {
   "name": "Карательная кулинария",
   "url": "https://t.me/s/punitivecooking01",
   "group": "blogger",
   "rubrics": [
    "viral_dishes",
    "unusual_food"
   ]
  },
  {
   "name": "FOODISCOVERY",
   "url": "https://t.me/s/FooDiscovery",
   "group": "media",
   "rubrics": [
    "viral_dishes",
    "unusual_food"
   ]
  },
  {
   "name": "Веганские рецепты",
   "url": "https://t.me/s/vegbestrecipe",
   "group": "creator",
   "rubrics": [
    "viral_dishes",
    "unusual_food"
   ]
  },
  {
   "name": "Всегда Вкусно!",
   "url": "https://t.me/s/vsegdavkusno",
   "group": "creator",
   "rubrics": [
    "easy_recipes",
    "world_cuisines"
   ]
  },
  {
   "name": "Вкусняшки к чаю",
   "url": "https://t.me/s/kollekciya_receptov",
   "group": "creator",
   "rubrics": [
    "easy_recipes",
    "desserts"
   ]
  },
  {
   "name": "Юлия Высоцкая Official",
   "url": "https://t.me/s/vysotskayaofficial",
   "group": "blogger",
   "rubrics": [
    "easy_recipes",
    "food_bloggers"
   ]
  },
  {
   "name": "Люба Кузьмичева РЕЦЕПТЫ",
   "url": "https://t.me/s/lubovicveti",
   "group": "blogger",
   "rubrics": [
    "easy_recipes",
    "desserts"
   ]
  },
  {
   "name": "DEMIAND Рецепты для аэрогриля",
   "url": "https://t.me/s/demiand_grill",
   "group": "creator",
   "rubrics": [
    "easy_recipes",
    "food_hacks"
   ]
  },
  {
   "name": "Superbaker",
   "url": "https://t.me/s/superbaker",
   "group": "media",
   "rubrics": [
    "desserts"
   ]
  },
  {
   "name": "Кондитерский клуб",
   "url": "https://t.me/s/konditerskiy_club",
   "group": "creator",
   "rubrics": [
    "desserts"
   ]
  },
  {
   "name": "Кондитерский Клуб Мария Селянина",
   "url": "https://t.me/s/pastryclub_mariaselyanina",
   "group": "blogger",
   "rubrics": [
    "desserts"
   ]
  },
  {
   "name": "HomeBaked",
   "url": "https://t.me/s/homebakedru",
   "group": "creator",
   "rubrics": [
    "desserts",
    "food_hacks"
   ]
  },
  {
   "name": "КЕЙКО",
   "url": "https://t.me/s/pauline_s",
   "group": "blogger",
   "rubrics": [
    "desserts",
    "food_bloggers"
   ]
  },
  {
   "name": "BeautifulFood",
   "url": "https://t.me/s/kolbasina_food",
   "group": "creator",
   "rubrics": [
    "desserts",
    "food_bloggers"
   ]
  },
  {
   "name": "Шаверно",
   "url": "https://t.me/s/shaverno_ru",
   "group": "media",
   "rubrics": [
    "unusual_food",
    "food_new_prices"
   ]
  },
  {
   "name": "Макс Галишников",
   "url": "https://t.me/s/makcgalishnikov",
   "group": "blogger",
   "rubrics": [
    "unusual_food",
    "food_bloggers"
   ]
  },
  {
   "name": "Телеканал Еда",
   "url": "https://t.me/s/tveda",
   "group": "media",
   "rubrics": [
    "unusual_food"
   ]
  },
  {
   "name": "Узбекская Кухня",
   "url": "https://t.me/s/uzfood",
   "group": "creator",
   "rubrics": [
    "unusual_food",
    "world_cuisines"
   ]
  },
  {
   "name": "Ведущий Фуд-блогер",
   "url": "https://t.me/s/foodblogger",
   "group": "blogger",
   "rubrics": [
    "unusual_food",
    "food_bloggers"
   ]
  },
  {
   "name": "FoodKor",
   "url": "https://t.me/s/foodkorchannel",
   "group": "blogger",
   "rubrics": [
    "food_bloggers",
    "world_cuisines"
   ]
  },
  {
   "name": "Андрей Сулима шеф-повар",
   "url": "https://t.me/s/Sulimastudio",
   "group": "blogger",
   "rubrics": [
    "food_bloggers",
    "world_cuisines"
   ]
  },
  {
   "name": "Оксана Лаврентьева",
   "url": "https://t.me/s/oxanalavretieva",
   "group": "blogger",
   "rubrics": [
    "food_bloggers"
   ]
  },
  {
   "name": "Кухни мира",
   "url": "https://t.me/s/cuisines_of_the_world",
   "group": "creator",
   "rubrics": [
    "world_cuisines"
   ]
  },
  {
   "name": "Китайская кухня",
   "url": "https://t.me/s/chinesefood_recipes",
   "group": "creator",
   "rubrics": [
    "world_cuisines"
   ]
  },
  {
   "name": "Кухня с Акцентом",
   "url": "https://t.me/s/zuriskitchen",
   "group": "blogger",
   "rubrics": [
    "world_cuisines"
   ]
  },
  {
   "name": "Тбилиси. Еда.",
   "url": "https://t.me/s/tbilisieda",
   "group": "creator",
   "rubrics": [
    "world_cuisines"
   ]
  },
  {
   "name": "Кристина Оловянникова",
   "url": "https://t.me/s/kris_oli",
   "group": "blogger",
   "rubrics": [
    "food_hacks"
   ]
  },
  {
   "name": "Гриль-барбекю Клуб",
   "url": "https://t.me/s/grillbbqclub",
   "group": "creator",
   "rubrics": [
    "food_hacks"
   ]
  },
  {
   "name": "Кухня неУмелой хозяйки",
   "url": "https://t.me/s/kukhnyaneUmeloykhozyayki",
   "group": "blogger",
   "rubrics": [
    "food_hacks"
   ]
  },
  {
   "name": "Amylco",
   "url": "https://t.me/s/amylco_pro",
   "group": "creator",
   "rubrics": [
    "food_hacks"
   ]
  },
  {
   "name": "Покашеварим",
   "url": "https://t.me/s/pokashevarim",
   "group": "creator",
   "rubrics": [
    "food_hacks"
   ]
  },
  {
   "name": "Едадил",
   "url": "https://t.me/s/edadeal_official",
   "group": "official",
   "rubrics": [
    "food_new_prices"
   ]
  },
  {
   "name": "Пятёрочка",
   "url": "https://t.me/s/tspyaterochka",
   "group": "official",
   "rubrics": [
    "food_new_prices"
   ]
  },
  {
   "name": "ОКЕЙ",
   "url": "https://t.me/s/okmarketofficial",
   "group": "official",
   "rubrics": [
    "food_new_prices"
   ]
  },
  {
   "name": "FMCG Report",
   "url": "https://t.me/s/fmcg_ru",
   "group": "media",
   "rubrics": [
    "food_new_prices"
   ]
  },
  {
   "name": "Скидки и обзоры на еду",
   "url": "https://t.me/s/pizza_suchi_channel",
   "group": "creator",
   "rubrics": [
    "food_new_prices"
   ]
  },
  {
   "name": "Чижик",
   "url": "https://t.me/s/chizhikmagazin",
   "group": "official",
   "rubrics": [
    "food_new_prices"
   ]
  },
  {
   "name": "Ресторанные Ведомости",
   "url": "https://t.me/s/restovedofficial",
   "group": "media",
   "rubrics": [
    "food_new_prices"
   ]
  }
 ],
 "money": [
  {
   "name": "Банки.ру — новости",
   "url": "https://www.banki.ru/xml/news.rss",
   "group": "media",
   "rubrics": [
    "cards_banks"
   ]
  },
  {
   "name": "Сравни.ру — новости",
   "url": "https://www.sravni.ru/novosti/",
   "group": "media",
   "rubrics": [
    "cards_banks"
   ]
  },
  {
   "name": "Т—Ж — деньги",
   "url": "https://journal.tbank.ru/",
   "group": "media",
   "rubrics": [
    "cards_banks"
   ]
  },
  {
   "name": "Frank RG — банки и финансы",
   "url": "https://frankrg.com/",
   "group": "media",
   "rubrics": [
    "cards_banks"
   ]
  },
  {
   "name": "РБК — финансы",
   "url": "https://www.rbc.ru/finances/",
   "group": "media",
   "rubrics": [
    "cards_banks"
   ]
  },
  {
   "name": "Банки.ру — тема дня",
   "url": "https://www.banki.ru/news/daytheme/",
   "group": "media",
   "rubrics": [
    "deposits"
   ]
  },
  {
   "name": "Сравни.ру — вклады",
   "url": "https://www.sravni.ru/vklady/info/",
   "group": "media",
   "rubrics": [
    "deposits"
   ]
  },
  {
   "name": "АСВ — новости",
   "url": "https://www.asv.org.ru/news/",
   "group": "official",
   "rubrics": [
    "deposits"
   ]
  },
  {
   "name": "Ведомости — финансы",
   "url": "https://www.vedomosti.ru/rss/rubric/finance",
   "group": "media",
   "rubrics": [
    "deposits"
   ]
  },
  {
   "name": "Интерфакс — деньги",
   "url": "https://www.interfax.ru/business/",
   "group": "media",
   "rubrics": [
    "deposits"
   ]
  },
  {
   "name": "Банк России — пресс-релизы",
   "url": "https://www.cbr.ru/rss/RssPress",
   "group": "official",
   "rubrics": [
    "ruble_inflation_cb"
   ]
  },
  {
   "name": "Банк России — новости",
   "url": "https://www.cbr.ru/press/",
   "group": "official",
   "rubrics": [
    "ruble_inflation_cb"
   ]
  },
  {
   "name": "Росстат — новости",
   "url": "https://rosstat.gov.ru/folder/313",
   "group": "official",
   "rubrics": [
    "ruble_inflation_cb"
   ]
  },
  {
   "name": "ТАСС — экономика",
   "url": "https://tass.ru/ekonomika",
   "group": "media",
   "rubrics": [
    "ruble_inflation_cb"
   ]
  },
  {
   "name": "Коммерсантъ — финансы",
   "url": "https://www.kommersant.ru/finance",
   "group": "media",
   "rubrics": [
    "ruble_inflation_cb"
   ]
  }
 ],
 "home": [
  {
   "name": "iCHIP — техника для дома",
   "url": "https://ichip.ru/",
   "group": "media",
   "rubrics": [
    "home_appliances"
   ]
  },
  {
   "name": "Яндекс Маркет — журнал",
   "url": "https://market.yandex.ru/journal/",
   "group": "media",
   "rubrics": [
    "home_appliances"
   ]
  },
  {
   "name": "Ferra — гаджеты",
   "url": "https://ferra.ru/",
   "group": "media",
   "rubrics": [
    "home_appliances"
   ]
  },
  {
   "name": "iXBT — новости",
   "url": "https://www.ixbt.com/news/",
   "group": "media",
   "rubrics": [
    "home_appliances"
   ]
  },
  {
   "name": "3DNews — новости",
   "url": "https://3dnews.ru/",
   "group": "media",
   "rubrics": [
    "home_appliances"
   ]
  },
  {
   "name": "Elle Decoration",
   "url": "https://www.elledecoration.ru/",
   "group": "media",
   "rubrics": [
    "interior_trends"
   ]
  },
  {
   "name": "AD Magazine",
   "url": "https://www.admagazine.ru/",
   "group": "media",
   "rubrics": [
    "interior_trends"
   ]
  },
  {
   "name": "Designmag",
   "url": "https://www.designmag.ru/",
   "group": "media",
   "rubrics": [
    "interior_trends"
   ]
  },
  {
   "name": "Houzz — Россия",
   "url": "https://www.houzz.ru/",
   "group": "media",
   "rubrics": [
    "interior_trends"
   ]
  },
  {
   "name": "Интерьер.ру",
   "url": "https://www.interior.ru/",
   "group": "media",
   "rubrics": [
    "interior_trends"
   ]
  },
  {
   "name": "Еда.ру — кухня",
   "url": "https://eda.ru/",
   "group": "media",
   "rubrics": [
    "kitchen"
   ]
  },
  {
   "name": "Едим Дома",
   "url": "https://www.edimdoma.ru/",
   "group": "media",
   "rubrics": [
    "kitchen"
   ]
  },
  {
   "name": "Povar.ru",
   "url": "https://povar.ru/",
   "group": "media",
   "rubrics": [
    "kitchen"
   ]
  },
  {
   "name": "Гастроном.ру",
   "url": "https://www.gastronom.ru/",
   "group": "media",
   "rubrics": [
    "kitchen"
   ]
  },
  {
   "name": "Кухня на районе",
   "url": "https://kuking.net/",
   "group": "media",
   "rubrics": [
    "kitchen"
   ]
  }
 ]
};

// v0.58.0: добор слабых подрубрик. В v0.55.3 часть кандидатов не прошла проверку (сайт не открылся или без списка
// статей), и техника/интерьер в «Доме» остались на 4 и 2 источниках при минимуме 5. Это запасные кандидаты:
// сервер так же проверяет каждый перед добавлением, недоступные отбрасываются, уже добавленные пропускаются.
export const SOURCES_TOPUP_V058 = {
 "home": [
  { "name": "DNS Club — техника", "url": "https://club.dns-shop.ru/", "group": "media", "rubrics": ["home_appliances"] },
  { "name": "Ситилинк — блог", "url": "https://www.citilink.ru/blog/", "group": "media", "rubrics": ["home_appliances"] },
  { "name": "М.Видео — блог", "url": "https://www.mvideo.ru/blog", "group": "media", "rubrics": ["home_appliances"] },
  { "name": "iXBT — Home", "url": "https://www.ixbt.com/home/", "group": "media", "rubrics": ["home_appliances"] },
  { "name": "Hi-Tech Mail", "url": "https://hi-tech.mail.ru/", "group": "media", "rubrics": ["home_appliances"] },
  { "name": "Ivd.ru — интерьер и дизайн", "url": "https://www.ivd.ru/", "group": "media", "rubrics": ["interior_trends"] },
  { "name": "Dezeen — интерьеры", "url": "https://www.dezeen.com/interiors/", "group": "media", "rubrics": ["interior_trends"] },
  { "name": "ArchDaily", "url": "https://www.archdaily.com/", "group": "media", "rubrics": ["interior_trends"] },
  { "name": "Architectural Digest", "url": "https://www.architecturaldigest.com/", "group": "media", "rubrics": ["interior_trends"] },
  { "name": "Homes & Gardens", "url": "https://www.homesandgardens.com/news", "group": "media", "rubrics": ["interior_trends"] },
  { "name": "Elle — дом", "url": "https://www.elle.ru/dom/", "group": "media", "rubrics": ["interior_trends"] }
 ],
 // v0.60.1: «Деньги» голодали: Banki.ru отдаёт 0 новостей, Telegram-источники старые. Резерв: открытые RSS крупных изданий,
 // тематику (личные финансы) отбирает префильтр канала.
 "money": [
  { "name": "РИА Новости — Экономика", "url": "https://ria.ru/export/rss2/economy/index.xml", "group": "media", "rubrics": ["cards_banks", "credits_mortgage", "income_benefits"] },
  { "name": "Коммерсантъ — Деньги (RSS)", "url": "https://www.kommersant.ru/RSS/money.xml", "group": "media", "rubrics": ["cards_banks", "deposits", "ruble_inflation_cb"] },
  { "name": "Ведомости — новости (RSS)", "url": "https://www.vedomosti.ru/rss/news", "group": "media", "rubrics": ["cards_banks", "taxes", "ruble_inflation_cb"] },
  { "name": "Интерфакс — лента (RSS)", "url": "https://www.interfax.ru/rss.asp", "group": "media", "rubrics": ["ruble_inflation_cb", "cards_banks", "taxes"] },
  { "name": "ТАСС — лента (RSS)", "url": "https://tass.ru/rss/v2.xml", "group": "media", "rubrics": ["income_benefits", "taxes", "ruble_inflation_cb"] },
  { "name": "РБК — лента (RSS)", "url": "https://rssexport.rbc.ru/rbcnews/news/30/full.rss", "group": "media", "rubrics": ["cards_banks", "credits_mortgage", "deposits"] },
  { "name": "Финмаркет — новости (RSS)", "url": "https://www.finmarket.ru/rss/mainnews.asp", "group": "media", "rubrics": ["ruble_inflation_cb", "deposits"] },
  { "name": "Известия — Экономика (RSS)", "url": "https://iz.ru/xml/rss/all.xml", "group": "media", "rubrics": ["income_benefits", "financial_scams", "taxes"] },
  { "name": "Российская газета — Экономика (RSS)", "url": "https://rg.ru/xml/index.xml", "group": "media", "rubrics": ["income_benefits", "taxes", "financial_scams"] },
  { "name": "Лента.ру — Экономика (RSS)", "url": "https://lenta.ru/rss/news", "group": "media", "rubrics": ["cards_banks", "financial_scams", "money_howto"] }
 ]
};

// v0.60.3: после подключения российского прокси часть сайтов, не открывавшихся из-за границы (Банки.ру, ЦБ, РБК, Т—Ж…),
// проверяется заново. Берём все стартовые и резервные кандидаты по каналам без дублей по URL; сервер добавляет только отсутствующие.
export function proxyRetryLists() {
  const out = {};
  const key = function(url) { return String(url || "").trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/\/+$/, ""); };
  for (const src of [SOURCES_V055, SOURCES_TOPUP_V058]) {
    for (const channelId of Object.keys(src)) {
      const seen = out[channelId] ? new Set(out[channelId].map(function(x) { return key(x.url); })) : new Set();
      out[channelId] = out[channelId] || [];
      for (const item of src[channelId]) {
        if (!item || !item.url || seen.has(key(item.url))) continue;
        seen.add(key(item.url));
        out[channelId].push(item);
      }
    }
  }
  return out;
}
