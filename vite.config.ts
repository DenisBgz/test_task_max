import vinext from 'vinext';
import { defineConfig } from 'vite';
import './scripts/runtime-env.mjs';

export default defineConfig(async () => {
	const { cloudflare } = await import('@cloudflare/vite-plugin');
	return {
		plugins: [
			vinext(),
			cloudflare({
				viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
				inspectorPort: false,
				config: {
					name: 'max-green-api-chat',
					main: 'vinext/server/fetch-handler',
					compatibility_date: '2026-05-15',
					compatibility_flags: ['nodejs_compat'],
				},
			}),
		],
	};
});
