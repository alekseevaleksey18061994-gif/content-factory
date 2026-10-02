# Защита данных News Factory

Что защищает сеть каналов от потери данных и поломок, и что нужно включить руками.

## Что делает приложение само

| Механизм | Что делает | Как включить |
|---|---|---|
| Атомарная запись `workspaces.json` + `.bak` | Файл не может остаться «наполовину записанным»; прежняя копия хранится рядом | всегда включено |
| Снимки состояния в PostgreSQL | До 200 снимков на канал (`app_snapshots`) | всегда включено |
| Восстановление пропавших каналов | При старте возвращает недостающие каналы из снимков (один раз) | `WORKSPACE_RECOVERY_ENABLED=false` отключает |
| Сторож каналов | Раз в 5 минут сверяет список каналов с реестром (`workspace_registry`). Если канал пропал не через админку — сообщение в Telegram и строка `WORKSPACE_MISSING` в логе | `WORKSPACE_WATCHDOG_ENABLED=false` отключает |
| Внешний бэкап | Раз в сутки выгружает хранилище каналов и последние снимки в S3-совместимое хранилище, сжато и зашифровано AES-256-GCM | переменные ниже |

Сообщения приходят в чат из `TELEGRAM_ALERT_CHAT_ID` (или `telegramAlertChatId` основного кабинета).

## Внешний бэкап: переменные окружения (Railway Variables)

| Переменная | Значение |
|---|---|
| `BACKUP_S3_ENDPOINT` | адрес хранилища, например `https://s3.eu-central-003.backblazeb2.com` |
| `BACKUP_S3_BUCKET` | имя бакета |
| `BACKUP_S3_ACCESS_KEY_ID` / `BACKUP_S3_SECRET_ACCESS_KEY` | ключ, у которого есть право только писать в этот бакет |
| `BACKUP_ENCRYPTION_KEY` | пароль шифрования, не короче 16 символов. **Сохраните его отдельно (менеджер паролей): без него бэкап не открыть** |
| `BACKUP_S3_REGION` | необязательно, по умолчанию `auto` (для AWS укажите настоящий регион) |
| `BACKUP_S3_PREFIX` | необязательно, по умолчанию `news-factory/` |
| `BACKUP_INTERVAL_HOURS` | необязательно, по умолчанию 24 (от 1 до 168) |
| `BACKUP_ALLOW_UNENCRYPTED` | `true` разрешает выгрузку без шифрования (не рекомендуется) |
| `BACKUP_ENABLED` | `false` выключает функцию, не удаляя настройки |

Без первых четырёх переменных функция выключена. Без `BACKUP_ENCRYPTION_KEY` бэкап не делается (в логе `OFFSITE_BACKUP_DISABLED`).

Проверка: `GET /api/backup/status` (в админке под вашей сессией) и строка `OFFSITE_BACKUP_OK` в логе. Принудительный запуск: `POST /api/backup/run`.
Старые копии приложение не удаляет: настройте правило жизненного цикла бакета (например, хранить 30–60 дней).

### Как открыть бэкап и восстановить

```
BACKUP_ENCRYPTION_KEY=... node scripts/restore-backup.js news-factory-20261003T000000Z.json.gz.enc
BACKUP_ENCRYPTION_KEY=... node scripts/restore-backup.js <файл> --workspaces-out workspaces.json
```

Скрипт показывает список каналов и объёмы. Файл `workspaces.json` кладут в `/data` при остановленном приложении. Раз в месяц делайте пробное восстановление: бэкап, который ни разу не открывали, ненадёжен.

## Что нужно сделать вручную

1. **GitHub → Settings → Branches → Add rule** для `main`: *Require a pull request before merging*, *Require status checks to pass* (выбрать `tests`), *Do not allow bypassing*, запретить force-push и удаление ветки.
2. **Railway → PostgreSQL → Backups**: включить автоматические бэкапы (если доступны на вашем тарифе); то же для тома `/data`.
3. **Railway → Variables**: `RAILWAY_DEPLOYMENT_OVERLAP_SECONDS=0`, чтобы при выкатке не работали две копии сервиса одновременно.
4. Двухфакторная защита на GitHub, Railway и Telegram-аккаунте владельца.
5. Во всех Telegram-каналах добавить второго администратора-человека.
6. Cloudflare Access (или ограничение по IP) перед админкой.
7. Тестовая среда Railway (staging) с копией базы: сначала выкатывать туда.
