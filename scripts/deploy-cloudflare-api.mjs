// Direct upload of the existing Vinext build. No bundler or parent-directory scans.
// https://developers.cloudflare.com/workers/static-assets/direct-upload/
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const statePath = path.join(root, '.wrangler/direct-deployment.json');
const authPath = path.join(root, '.wrangler/cloudflare-auth/.wrangler/config/default.toml');
const token =
	process.env.CLOUDFLARE_API_TOKEN ||
	readFileSync(authPath, 'utf8').match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
if (!token) throw new Error('Run npm run login:cloudflare first.');
const mode = process.argv[2];
if (!['inspect', 'deploy'].includes(mode)) throw new Error('Expected inspect or deploy.');
async function api(endpoint, { method = 'GET', json, body, bearer = token } = {}) {
	const response = await fetch(`https://api.cloudflare.com/client/v4${endpoint}`, {
		method,
		headers: {
			Authorization: `Bearer ${bearer}`,
			...(json ? { 'Content-Type': 'application/json' } : {}),
		},
		body: json ? JSON.stringify(json) : body,
		redirect: 'error',
		signal: AbortSignal.timeout(120000),
	});
	const data = await response.json();
	if (!response.ok || !data.success) {
		throw new Error(
			`Cloudflare ${response.status}: ${JSON.stringify(data.errors || []).replaceAll(token, '[redacted]')}`,
		);
	}
	return data.result;
}
const accounts = await api('/accounts');
const accountId =
	process.env.CLOUDFLARE_ACCOUNT_ID || (accounts.length === 1 ? accounts[0].id : null);
if (!accountId || !accounts.some((a) => a.id === accountId))
	throw new Error('Select a permitted CLOUDFLARE_ACCOUNT_ID.');
const base = `/accounts/${accountId}/workers`;
const scripts = await api(`${base}/scripts`);
let subdomain;
try {
	subdomain = (await api(`${base}/subdomain`)).subdomain;
} catch (error) {
	if (!String(error).includes('10007')) throw error;
}
const saved = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : null;
const name = saved?.accountId === accountId ? saved.name : 'max-green-api-chat';
if (mode === 'inspect') {
	const live = scripts.some((s) => s.id === name)
		? await api(`${base}/scripts/${name}/subdomain`)
		: null;
	console.log(
		JSON.stringify({ accountId, subdomain, scripts: scripts.map((s) => s.id), name, live }),
	);
	process.exit(0);
}
if (
	scripts.some((s) => s.id === name) &&
	!(saved?.accountId === accountId && saved.name === name)
) {
	throw new Error('Worker name already exists; refusing to overwrite an unrelated application.');
}
function files(dir, prefix = '') {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		if (entry.name.startsWith('.') || entry.isSymbolicLink()) return [];
		const rel = `${prefix}${entry.name}`;
		return entry.isDirectory() ? files(path.join(dir, entry.name), `${rel}/`) : [rel];
	});
}
const serverDir = path.join(root, 'dist/server');
const clientDir = path.join(root, 'dist/client');
const config = JSON.parse(readFileSync(path.join(serverDir, 'wrangler.json'), 'utf8'));
const manifest = {},
	byHash = new Map();
const mime = {
	'.js': 'application/javascript',
	'.css': 'text/css',
	'.svg': 'image/svg+xml',
	'.json': 'application/json',
	'.woff2': 'font/woff2',
	'.html': 'text/html',
};
for (const rel of files(clientDir)) {
	if (['_headers', '_redirects', 'wrangler.json'].includes(rel)) continue;
	const content = readFileSync(path.join(clientDir, rel));
	const hash = createHash('sha256')
		.update(content.toString('base64') + path.extname(rel).slice(1))
		.digest('hex')
		.slice(0, 32);
	manifest[`/${rel}`] = { hash, size: content.length };
	byHash.set(hash, { content, type: mime[path.extname(rel)] || 'application/octet-stream' });
}
console.log(`Preparing ${Object.keys(manifest).length} static assets.`);
const session = await api(`${base}/scripts/${name}/assets-upload-session`, {
	method: 'POST',
	json: { manifest },
});
let completionJwt = session.buckets.length ? null : session.jwt;
for (const bucket of session.buckets) {
	const form = new FormData();
	for (const hash of bucket) {
		const asset = byHash.get(hash);
		if (!asset) throw new Error('Unexpected asset requested by Cloudflare.');
		form.append(hash, new File([asset.content.toString('base64')], hash, { type: asset.type }));
	}
	const uploaded = await api(`${base}/assets/upload?base64=true`, {
		method: 'POST',
		body: form,
		bearer: session.jwt,
	});
	if (uploaded.jwt) completionJwt = uploaded.jwt;
	console.log(`Uploaded ${bucket.length} assets.`);
}
if (!completionJwt) throw new Error('Missing asset completion token.');
const metadata = {
	main_module: config.main,
	compatibility_date: config.compatibility_date,
	compatibility_flags: config.compatibility_flags,
	assets: {
		jwt: completionJwt,
		config: {
			...(existsSync(path.join(clientDir, '_headers'))
				? { _headers: readFileSync(path.join(clientDir, '_headers'), 'utf8') }
				: {}),
		},
	},
	bindings: [],
};
const form = new FormData();
form.append('metadata', JSON.stringify(metadata));
const modules = files(serverDir).filter((rel) => /\.(mjs|js)$/.test(rel));
for (const rel of modules)
	form.append(
		rel,
		new File([readFileSync(path.join(serverDir, rel))], rel, {
			type: 'application/javascript+module',
		}),
	);
console.log(`Uploading ${modules.length} Worker modules.`);
const deployed = await api(`${base}/scripts/${name}`, { method: 'PUT', body: form });
writeFileSync(
	statePath,
	JSON.stringify({ accountId, name, versionId: deployed.version_id }, null, 2),
);
if (!subdomain) {
	subdomain = `max-chat-${accountId.slice(0, 8)}`;
	await api(`${base}/subdomain`, { method: 'PUT', json: { subdomain } });
}
await api(`${base}/scripts/${name}/subdomain`, {
	method: 'POST',
	json: { enabled: true, previews_enabled: false },
});
console.log(
	JSON.stringify({
		url: `https://${name}.${subdomain}.workers.dev`,
		versionId: deployed.version_id,
	}),
);
