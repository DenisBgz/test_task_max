import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
const source = (
	await readFile(new URL('../app/api/green/route.ts', import.meta.url), 'utf8')
).replace("'@/lib/max'", JSON.stringify(new URL('../lib/max.ts', import.meta.url).href));
const compiled = ts.transpileModule(source, {
	compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const { POST } = await import(
	'data:text/javascript;base64,' + Buffer.from(compiled).toString('base64')
);
const credentials = {
	idInstance: '3100000001',
	apiTokenInstance: 'test-token-not-real',
	apiUrl: 'https://3100.api.green-api.com',
};
const request = (extra, headers = {}) =>
	new Request('http://localhost/api/green', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...headers },
		body: JSON.stringify({ ...credentials, ...extra }),
	});
test('proxy rejects untrusted hosts, unsupported actions and invalid messages without network', async (t) => {
	t.mock.method(globalThis, 'fetch', () => {
		throw Error('must not fetch');
	});
	for (const extra of [
		{ apiUrl: 'https://evil.example', action: 'getStateInstance' },
		{ action: 'reboot' },
		{ action: 'sendMessage', payload: { chatId: '123', message: ' ' } },
		{ action: 'sendMessage', payload: { chatId: '123', message: 'a'.repeat(4001) } },
		{ action: 'deleteNotification', payload: { receiptId: '../secret' } },
	])
		assert.equal((await POST(request(extra))).status, 400);
	assert.equal(
		(await POST(request({ action: 'getStateInstance' }, { 'sec-fetch-site': 'cross-site' })))
			.status,
		403,
	);
});
test('proxy calls the documented send endpoint and forwards only supported fields', async (t) => {
	t.mock.method(globalThis, 'fetch', async (url, options) => {
		assert.equal(
			url,
			'https://3100.api.green-api.com/waInstance3100000001/sendMessage/test-token-not-real',
		);
		assert.equal(options.method, 'POST');
		assert.equal(options.redirect, 'manual');
		assert.equal(options.cache, undefined);
		assert.equal(options.cf.cacheTtl, -1);
		assert.equal(options.headers['Cache-Control'], 'no-store');
		assert.deepEqual(JSON.parse(options.body), { chatId: '12345', message: 'Привет' });
		return Response.json({ idMessage: 'm2' });
	});
	const response = await POST(
		request({
			action: 'sendMessage',
			payload: { chatId: '12345', message: 'Привет', ignored: 'x' },
		}),
	);
	assert.deepEqual(await response.json(), { idMessage: 'm2' });
	assert.equal(response.headers.get('cache-control'), 'no-store');
});
test('proxy rejects upstream redirects without following or exposing the Location', async (t) => {
	const mock = t.mock.method(
		globalThis,
		'fetch',
		async () =>
			new Response(null, {
				status: 302,
				headers: { Location: 'https://evil.example/secret-token' },
			}),
	);
	const result = await POST(request({ action: 'getStateInstance' }));
	assert.equal(result.status, 502);
	assert.equal((await result.json()).code, 'GREEN_API_REDIRECT');
	assert.equal(mock.mock.callCount(), 1);
});
test('proxy distinguishes timeout from connectivity errors without leaking details', async (t) => {
	t.mock.method(globalThis, 'fetch', async () => {
		throw new DOMException('secret-token', 'TimeoutError');
	});
	const timeout = await POST(request({ action: 'getStateInstance' }));
	assert.equal(timeout.status, 504);
	assert.equal((await timeout.json()).code, 'GREEN_API_TIMEOUT');
	t.mock.method(globalThis, 'fetch', async () => {
		throw new TypeError('secret-token');
	});
	const network = await POST(request({ action: 'getStateInstance' }));
	assert.equal(network.status, 502);
	const body = await network.text();
	assert.ok(body.includes('GREEN_API_NETWORK'));
	assert.ok(!body.includes('secret-token'));
});
test('proxy redacts settings and does not expose upstream errors with tokens', async (t) => {
	t.mock.method(globalThis, 'fetch', async () =>
		Response.json({ incomingWebhook: 'yes', webhookUrl: '', apiTokenInstance: 'secret' }),
	);
	assert.deepEqual(await (await POST(request({ action: 'getSettings' }))).json(), {
		incomingWebhook: 'yes',
		webhookUrl: '',
	});
	t.mock.method(globalThis, 'fetch', async () => new Response('secret token', { status: 401 }));
	const result = await POST(request({ action: 'getStateInstance' }));
	assert.equal(result.status, 401);
	assert.ok(!(await result.text()).includes('secret'));
});
