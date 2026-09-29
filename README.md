# MAX Chat — тестовое задание


## Запуск

```bash
npm ci
npm run dev
```

Откройте адрес из терминала (обычно http://localhost:5173).

```bash
npm run typecheck
npm test
npm run build
npm start
```

Сборка использует Cloudflare Workers через Vinext. `npm start` запускает собранное приложение локально через Wrangler. Для разработки аккаунт Cloudflare не нужен.



## API и структура

- `app/page.tsx` — подключение, список чатов, создание чата, переписка и форма отправки.
- `app/globals.css` — оформление, мобильная компоновка, состояния элементов.
- `lib/max.ts` — типы, API-клиент, нормализация телефонов, обработчик уведомлений и цикл получения.
- `app/api/green/route.ts` — серверный прокси с белым списком методов и доменов GREEN-API. Исключает проблемы CORS; токен передаётся браузером в POST-теле, а не в URL.
- `tests/max.test.mjs` — проверки нормализации, сопоставления чатов, повторных уведомлений, статусов, отправки, порядка Receive/Delete, восстановления после сбоя и отмены.

Используемые методы: `getStateInstance`, `getSettings`, `checkAccount`, `sendMessage`, `receiveNotification`, `deleteNotification`.
