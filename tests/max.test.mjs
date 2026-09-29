import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhone, applyNotification, api, pollNotifications } from '../lib/max.ts';
const credentials = {
	idInstance: '3100000001',
	apiTokenInstance: 'test-token-not-real',
	apiUrl: 'https://3100.api.green-api.com',
};
const incoming = {
	typeWebhook: 'incomingMessageReceived',
	idMessage: 'm1',
	timestamp: 1750000000,
	senderData: { chatId: '12345', senderName: 'Анна' },
	messageData: { typeMessage: 'textMessage', textMessageData: { textMessage: 'Привет 👋' } },
};
test('RF/BY phone normalization and rejection', () => {
	assert.equal(normalizePhone('8 (999) 123-45-67'), '79991234567');
	assert.equal(normalizePhone('+375 29 123-45-67'), '375291234567');
	assert.throws(() => normalizePhone('123'));
	assert.throws(() => normalizePhone('+7abc9991234567'));
});
test('incoming response joins the canonical MAX chat and deduplicates redelivery', () => {
	const chats = [
		{ id: '12345', name: '+7 999 123-45-67', phone: '79991234567', unread: 0, messages: [] },
	];
	const result = applyNotification(chats, incoming, '12345');
	assert.equal(result.length, 1);
	assert.equal(result[0].messages[0].text, 'Привет 👋');
	assert.equal(result[0].unread, 0);
	assert.equal(applyNotification(result, incoming, null)[0].messages.length, 1);
});
test('new incoming chat has unread counter; URLs are treated as text', () => {
	const result = applyNotification(
		[],
		{
			...incoming,
			messageData: {
				typeMessage: 'extendedTextMessage',
				extendedTextMessageData: { text: 'https://example.com' },
			},
		},
		null,
	);
	assert.equal(result[0].unread, 1);
	assert.equal(result[0].messages[0].text, 'https://example.com');
});
test('unsupported media and service events do not create text messages', () => {
	assert.deepEqual(
		applyNotification([], { ...incoming, messageData: { typeMessage: 'imageMessage' } }, null),
		[],
	);
	assert.deepEqual(applyNotification([], { typeWebhook: 'stateInstanceChanged' }, null), []);
});
test('delivery status does not regress after out-of-order events', () => {
	const chats = [
		{
			id: '12345',
			name: 'MAX',
			unread: 0,
			messages: [{ id: 'm1', outgoing: true, text: 'hi', time: 1, status: 'read' }],
		},
	];
	assert.equal(
		applyNotification(
			chats,
			{ typeWebhook: 'outgoingMessageStatus', idMessage: 'm1', status: 'sent' },
			null,
		)[0].messages[0].status,
		'read',
	);
});
test('send uses a POST body without credentials in the browser URL', async (t) => {
	t.mock.method(globalThis, 'fetch', async (url, options) => {
		assert.equal(url, '/api/green');
		assert.equal(options.method, 'POST');
		const body = JSON.parse(options.body);
		assert.equal(body.action, 'sendMessage');
		assert.deepEqual(body.payload, { chatId: '12345', message: 'Текст' });
		return Response.json({ idMessage: 'sent1' });
	});
	assert.deepEqual(await api(credentials, 'sendMessage', { chatId: '12345', message: 'Текст' }), {
		idMessage: 'sent1',
	});
});
test('poll processes before DELETE; failed ACK is retried without duplicate messages; abort stops polling', async (t) => {
	const controller = new AbortController();
	const calls = [];
	let acks = 0;
	let chats = [];
	t.mock.method(globalThis, 'fetch', async (_url, options) => {
		const { action } = JSON.parse(options.body);
		calls.push(action);
		if (action === 'receiveNotification')
			return Response.json({ receiptId: 77, body: incoming });
		assert.equal(chats[0].messages.length, 1);
		if (++acks === 1) return Response.json({ error: 'temporary' }, { status: 502 });
		controller.abort();
		return Response.json({ result: true });
	});
	await pollNotifications(
		credentials,
		controller.signal,
		(body) => {
			chats = applyNotification(chats, body, null);
		},
		() => {},
	);
	assert.deepEqual(calls, [
		'receiveNotification',
		'deleteNotification',
		'receiveNotification',
		'deleteNotification',
	]);
	assert.equal(chats[0].messages.length, 1);
});
