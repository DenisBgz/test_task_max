import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
	title: 'MAX — сообщения',
	description: 'Текстовые сообщения MAX через GREEN-API.',
	icons: {
		icon: '/favicon.svg',
		shortcut: '/favicon.svg',
	},
};

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html lang="ru">
			<head>
				<meta name="viewport" content="width=device-width, initial-scale=1" />
			</head>
			<body className="antialiased">{children}</body>
		</html>
	);
}
