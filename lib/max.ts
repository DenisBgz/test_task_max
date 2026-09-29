export type Credentials = { idInstance: string; apiTokenInstance: string; apiUrl: string };
export type Message = {
	id: string;
	text: string;
	time: number;
	outgoing: boolean;
	status?: string;
};
export type Chat = {
	id: string;
	name: string;
	phone?: string;
	messages: Message[];
	unread: number;
};
export type NotificationBody = {
	typeWebhook: string;
	idMessage?: string;
	timestamp?: number;
	chatId?: string;
	status?: string;
	senderData?: {
		chatId: string;
		chatName?: string;
		senderName?: string;
		senderPhoneNumber?: number;
	};
	messageData?: {
		typeMessage: string;
		textMessageData?: { textMessage: string };
		extendedTextMessageData?: { text: string };
	};
};
export type Notification = { receiptId: number; body: NotificationBody };

export function normalizePhone(input: string): string {
	if (/[^\d\s()+-]/.test(input)) throw new Error('Введите номер телефона без букв.');
	let phone = input.replace(/\D/g, '');
	if (phone.length === 11 && phone.startsWith('8')) phone = '7' + phone.slice(1);
	if (!/^(7\d{10}|375\d{9})$/.test(phone))
		throw new Error('Укажите номер РФ (+7) или Беларуси (+375) в международном формате.');
	return phone;
}
export function formatPhone(phone: string): string {
	return /^7\d{10}$/.test(phone)
		? `+7 ${phone.slice(1, 4)} ${phone.slice(4, 7)}-${phone.slice(7, 9)}-${phone.slice(9)}`
		: `+${phone}`;
}
// Queue delivery is at least once: deduplicate before acknowledging.
export function applyNotification(
	chats: Chat[],
	body: NotificationBody,
	activeId: string | null,
): Chat[] {
	if (body.typeWebhook === 'outgoingMessageStatus') {
		const ranks: Record<string, number> = {
			queued: 0,
			sent: 1,
			delivered: 2,
			read: 3,
			failed: 4,
		};
		return chats.map((chat) => ({
			...chat,
			messages: chat.messages.map((m) =>
				m.id === body.idMessage &&
				(ranks[body.status ?? ''] ?? -1) >= (ranks[m.status ?? 'queued'] ?? 0)
					? { ...m, status: body.status }
					: m,
			),
		}));
	}
	const outgoing = ['outgoingMessageReceived', 'outgoingAPIMessageReceived'].includes(
		body.typeWebhook,
	);
	if (body.typeWebhook !== 'incomingMessageReceived' && !outgoing) return chats;
	const data = body.messageData;
	const text =
		data?.typeMessage === 'textMessage'
			? data.textMessageData?.textMessage
			: data?.typeMessage === 'extendedTextMessage'
				? data.extendedTextMessageData?.text
				: undefined;
	const sender = body.senderData;
	if (typeof text !== 'string' || !sender?.chatId || !body.idMessage) return chats;
	const existing = chats.find((c) => c.id === sender.chatId);
	if (existing?.messages.some((m) => m.id === body.idMessage)) return chats;
	const phone = sender.senderPhoneNumber ? String(sender.senderPhoneNumber) : undefined;
	const chat = existing ?? {
		id: sender.chatId,
		name: sender.chatName || sender.senderName || (phone ? formatPhone(phone) : sender.chatId),
		phone,
		messages: [],
		unread: 0,
	};
	const updated: Chat = {
		...chat,
		messages: [
			...chat.messages,
			{
				id: body.idMessage,
				text,
				outgoing,
				time: (body.timestamp ?? Date.now() / 1000) * 1000,
				status: outgoing ? 'sent' : undefined,
			},
		],
		unread: chat.unread + (!outgoing && activeId !== chat.id ? 1 : 0),
	};
	return existing ? chats.map((c) => (c.id === chat.id ? updated : c)) : [...chats, updated];
}
export class ApiError extends Error {
	status: number;
	constructor(message: string, status: number) {
		super(message);
		this.status = status;
	}
}
export async function api<T>(
	credentials: Credentials,
	action: string,
	payload?: unknown,
	signal?: AbortSignal,
): Promise<T> {
	const response = await fetch('/api/green', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ ...credentials, action, payload }),
		signal,
	});
	const data = await response.json();
	if (!response.ok)
		throw new ApiError(
			(data as { error?: string })?.error || 'Не удалось выполнить запрос.',
			response.status,
		);
	return data as T;
}
export function errorMessage(error: unknown): string {
	return error instanceof ApiError
		? error.message
		: 'Не удалось связаться с сервером. Проверьте соединение и повторите попытку.';
}
export async function pollNotifications(
	credentials: Credentials,
	signal: AbortSignal,
	onNotification: (body: NotificationBody) => void,
	onStatus: (error: string | null) => void,
) {
	let delay = 1000;
	const pause = (ms: number) =>
		new Promise<void>((resolve) => {
			if (signal.aborted) return resolve();
			const finish = () => {
				clearTimeout(timer);
				signal.removeEventListener('abort', finish);
				resolve();
			};
			const timer = setTimeout(finish, ms);
			signal.addEventListener('abort', finish, { once: true });
		});
	while (!signal.aborted) {
		try {
			const event = await api<Notification | null>(
				credentials,
				'receiveNotification',
				undefined,
				signal,
			);
			if (signal.aborted) break;
			if (event) {
				onNotification(event.body);
				const ack = await api<{ result: boolean }>(
					credentials,
					'deleteNotification',
					{ receiptId: event.receiptId },
					signal,
				);
				if (!ack.result)
					throw new ApiError('Не удалось подтвердить получение. Повторяем запрос…', 502);
			}
			onStatus(null);
			delay = 1000;
			await pause(event ? 150 : 350);
		} catch (error) {
			if (signal.aborted) break;
			onStatus(errorMessage(error));
			await pause(delay);
			delay = Math.min(delay * 2, 30000);
		}
	}
}
