import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { projectRoot } from './runtime-env.mjs';

const [command, ...extra] = process.argv.slice(2);
if (!['login', 'whoami', 'deploy'].includes(command)) {
	throw new Error('Expected login, whoami or deploy.');
}

// Keep OAuth credentials in an ignored local directory, never in source archives.
const authHome = path.join(projectRoot, '.wrangler', 'cloudflare-auth');
mkdirSync(authHome, { recursive: true });
const result = spawnSync(
	process.execPath,
	[
		path.join(projectRoot, 'node_modules/wrangler/bin/wrangler.js'),
		command,
		...(command === 'login'
			? [
					'--callback-host',
					'127.0.0.1',
					'--scopes',
					'account:read',
					'user:read',
					'workers:write',
					'workers_scripts:write',
					'workers_routes:write',
				]
			: []),
		...(command === 'deploy' ? ['--config', 'dist/server/wrangler.json'] : []),
		...extra,
	],
	{
		cwd: projectRoot,
		stdio: 'inherit',
		env: { ...process.env, XDG_CONFIG_HOME: authHome },
	},
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
