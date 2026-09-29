import { normalizePhone } from '@/lib/max';
const headers = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' };
const reply = (data: unknown, status = 200) =>
	new Response(JSON.stringify(data), { status, headers });
const methods: Record<string, string> = {
	getStateInstance: 'GET',
	getSettings: 'GET',
	checkAccount: 'POST',
	sendMessage: 'POST',
	receiveNotification: 'GET',
	deleteNotification: 'DELETE',
};
// Allowlisted proxy avoids CORS issues. Credentials are never persisted or logged.
export async function POST(request: Request) {
	if (request.headers.get('sec-fetch-site') === 'cross-site')
		return reply({ error: 'Запрос с другого сайта запрещён.' }, 403);
	try {
		const input = await request.text();
		if (input.length > 20000) return reply({ error: 'Слишком большой запрос.' }, 413);
		const { idInstance, apiTokenInstance, apiUrl, action, payload } = JSON.parse(input);
		if (
			typeof idInstance !== 'string' ||
			!/^\d{6,20}$/.test(idInstance) ||
			typeof apiTokenInstance !== 'string' ||
			!/^[a-zA-Z0-9_-]{10,200}$/.test(apiTokenInstance)
		)
			return reply({ error: 'Проверьте idInstance и apiTokenInstance.' }, 400);
		if (
			typeof apiUrl !== 'string' ||
			!/^https:\/\/(?:\d{4}\.api|api)\.green-api\.com\/?$/.test(apiUrl)
		)
			return reply(
				{ error: 'Укажите apiUrl из GREEN-API: https://3100.api.green-api.com' },
				400,
			);
		if (!Object.hasOwn(methods, action)) return reply({ error: 'Метод недоступен.' }, 400);
		let body: unknown;
		let suffix = '';
		if (action === 'checkAccount') {
			try {
				body = { phoneNumber: Number(normalizePhone(String(payload?.phoneNumber ?? ''))) };
			} catch {
				return reply({ error: 'Некорректный номер телефона.' }, 400);
			}
		}
		if (action === 'sendMessage') {
			if (
				typeof payload?.message !== 'string' ||
				!payload.message.trim() ||
				payload.message.length > 4000 ||
				typeof payload.chatId !== 'string' ||
				!/^-?\d+(?:@c\.us)?$/.test(payload.chatId)
			)
				return reply(
					{ error: 'Введите сообщение до 4000 символов и корректный chatId.' },
					400,
				);
			body = { chatId: payload.chatId, message: payload.message };
		}
		if (action === 'receiveNotification') suffix = '?receiveTimeout=25';
		if (action === 'deleteNotification') {
			if (!Number.isSafeInteger(payload?.receiptId) || payload.receiptId < 0)
				return reply({ error: 'Некорректный идентификатор уведомления.' }, 400);
			suffix = `/${payload.receiptId}`;
		}
		const url = `${apiUrl.replace(/\/$/, '')}/waInstance${idInstance}/${action}/${apiTokenInstance}${suffix}`;
		// Workers supports only manual/follow redirects. Never follow a redirect:
		// GREEN-API credentials are in the URL and must stay on the validated host.
		// Use Workers' cache policy plus HTTP headers, not the compatibility-gated
		// RequestInit.cache field (older deployed Workers reject that field).
		const response = await fetch(url, {
			method: methods[action],
			headers: {
				'Cache-Control': 'no-store',
				...(body ? { 'Content-Type': 'application/json' } : {}),
			},
			body: body ? JSON.stringify(body) : undefined,
			signal: AbortSignal.any([request.signal, AbortSignal.timeout(35000)]),
			redirect: 'manual',
			cf: { cacheTtl: -1, cacheEverything: false },
		});
		if (response.status >= 300 && response.status < 400)
			return reply(
				{
					error: 'GREEN-API вернул перенаправление. Скопируйте точный apiUrl из карточки инстанса.',
					code: 'GREEN_API_REDIRECT',
				},
				502,
			);
		if (!response.ok) {
			const errors: Record<number, string> = {
				400: 'GREEN-API отклонил запрос. Проверьте настройки инстанса и данные запроса.',
				401: 'Неверные учётные данные GREEN-API.',
				403: 'Доступ запрещён. Проверьте токен, тариф и ограничения аккаунта.',
				404: 'Инстанс не найден. Проверьте idInstance и apiUrl.',
				429: 'Превышен лимит GREEN-API. Подождите и повторите попытку.',
			};
			return reply(
				{ error: errors[response.status] || 'Сервис GREEN-API временно недоступен.' },
				response.status >= 500 ? 502 : response.status,
			);
		}
		const raw = await response.text();
		const data = raw ? JSON.parse(raw) : null;
		if (action === 'getSettings')
			return reply({
				incomingWebhook: data?.incomingWebhook,
				webhookUrl: data?.webhookUrl ? 'configured' : '',
			});
		return reply(data);
	} catch (error) {
		if (error instanceof SyntaxError)
			return reply({ error: 'Некорректный JSON в запросе или ответе сервиса.' }, 400);
		if (error instanceof Error && error.name === 'TimeoutError')
			return reply(
				{
					error: 'GREEN-API не ответил за 35 секунд. Повторите попытку позже.',
					code: 'GREEN_API_TIMEOUT',
				},
				504,
			);
		if (error instanceof Error && error.name === 'AbortError')
			return reply(
				{ error: 'Запрос отменён. Повторите подключение.', code: 'REQUEST_ABORTED' },
				408,
			);
		return reply(
			{
				error: 'Сервер приложения не смог подключиться к GREEN-API. Повторите попытку позже; если ошибка сохраняется, сообщите код GREEN_API_NETWORK.',
				code: 'GREEN_API_NETWORK',
			},
			502,
		);
	}
}
