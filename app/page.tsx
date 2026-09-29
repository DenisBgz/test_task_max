'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
	ArrowLeft,
	ArrowRight,
	Check,
	CheckCheck,
	ChevronDown,
	CircleAlert,
	Eye,
	EyeOff,
	KeyRound,
	LoaderCircle,
	LockKeyhole,
	LogOut,
	MessageCircle,
	Plus,
	Send,
	ShieldCheck,
	Smartphone,
	X,
} from 'lucide-react';
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from '@/components/ui/dialog';
import { Empty, EmptyDescription, EmptyTitle } from '@/components/ui/empty';
import {
	api,
	applyNotification,
	errorMessage,
	formatPhone,
	normalizePhone,
	pollNotifications,
	type Chat,
	type Credentials,
} from '@/lib/max';

const time = (value: number) =>
	new Date(value).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
const statusLabel: Record<string, string> = {
	queued: 'В очереди',
	sent: 'Отправлено',
	delivered: 'Доставлено',
	read: 'Прочитано',
	failed: 'Не доставлено',
};
function Brand({ large = false }: { large?: boolean }) {
	return (
		<span className={`brand ${large ? 'large' : ''}`} aria-label="MAX">
			<MessageCircle aria-hidden="true" strokeWidth={3} />
		</span>
	);
}
export default function Home() {
	const [credentials, setCredentials] = useState<Credentials | null>(null);
	const [id, setId] = useState('');
	const [token, setToken] = useState('');
	const [url, setUrl] = useState('https://3100.api.green-api.com');
	const [visibleToken, setVisibleToken] = useState(false);
	const [connecting, setConnecting] = useState(false);
	const [loginError, setLoginError] = useState('');
	const [chats, setChats] = useState<Chat[]>([]);
	const chatsRef = useRef<Chat[]>([]);
	const [activeId, setActiveId] = useState<string | null>(null);
	const activeRef = useRef<string | null>(null);
	const [drafts, setDrafts] = useState<Record<string, string>>({});
	const [sending, setSending] = useState(false);
	const sendingRef = useRef(false);
	const [sendError, setSendError] = useState('');
	const [pollError, setPollError] = useState<string | null>(null);
	const [newChat, setNewChat] = useState(false);
	const [phone, setPhone] = useState('');
	const [chatError, setChatError] = useState('');
	const [creating, setCreating] = useState(false);
	const generation = useRef(0);
	const endRef = useRef<HTMLDivElement>(null);
	const textRef = useRef<HTMLTextAreaElement>(null);
	const active = chats.find((c) => c.id === activeId);
	const draft = activeId ? (drafts[activeId] ?? '') : '';
	function updateChats(update: (old: Chat[]) => Chat[]) {
		chatsRef.current = update(chatsRef.current);
		setChats(chatsRef.current);
	}
	function selectChat(id: string | null) {
		activeRef.current = id;
		setActiveId(id);
		setSendError('');
		updateChats((old) => old.map((c) => (c.id === id ? { ...c, unread: 0 } : c)));
	}
	useEffect(() => {
		if (!credentials) return;
		const controller = new AbortController();
		void pollNotifications(
			credentials,
			controller.signal,
			(body) => {
				updateChats((old) => applyNotification(old, body, activeRef.current));
			},
			setPollError,
		);
		return () => controller.abort();
	}, [credentials]);
	useEffect(() => {
		endRef.current?.scrollIntoView({ block: 'end' });
	}, [activeId, active?.messages.length]);
	async function connect(event: FormEvent) {
		event.preventDefault();
		setLoginError('');
		setConnecting(true);
		const value = {
			idInstance: id.trim(),
			apiTokenInstance: token.trim(),
			apiUrl: url.trim().replace(/\/$/, ''),
		};
		try {
			const state = await api<{ stateInstance: string }>(value, 'getStateInstance');
			if (state.stateInstance !== 'authorized')
				throw new Error('Сначала авторизуйте инстанс MAX в личном кабинете GREEN-API.');
			const settings = await api<{ incomingWebhook: string; webhookUrl: string }>(
				value,
				'getSettings',
			);
			if (settings.incomingWebhook !== 'yes' || settings.webhookUrl)
				throw new Error(
					'В настройках GREEN-API включите входящие уведомления и очистите Webhook URL. Сохраните настройки, подождите минуту и подключитесь снова.',
				);
			setCredentials(value);
			setToken('');
			setPollError(null);
		} catch (error) {
			setLoginError(error instanceof Error ? error.message : errorMessage(error));
		} finally {
			setConnecting(false);
		}
	}
	function logout() {
		generation.current++;
		setCredentials(null);
		updateChats(() => []);
		selectChat(null);
		setDrafts({});
		setSendError('');
		setPollError(null);
		setNewChat(false);
		setPhone('');
		setToken('');
	}
	async function createChat(event: FormEvent) {
		event.preventDefault();
		if (!credentials || creating) return;
		setChatError('');
		const current = generation.current;
		try {
			const number = normalizePhone(phone);
			const known = chatsRef.current.find((c) => c.phone === number);
			if (known) {
				selectChat(known.id);
				setNewChat(false);
				setPhone('');
				return;
			}
			setCreating(true);
			const result = await api<{ exist?: boolean; chatId?: string; status?: boolean }>(
				credentials,
				'checkAccount',
				{ phoneNumber: Number(number) },
			);
			if (current !== generation.current) return;
			if (result.status === false)
				throw new Error(
					'Не удалось проверить номер. Проверьте состояние инстанса и лимиты GREEN-API.',
				);
			if (!result.exist || !result.chatId)
				throw new Error('Аккаунт MAX не найден или недоступен для поиска по номеру.');
			updateChats((old) =>
				old.some((c) => c.id === result.chatId)
					? old.map((c) => (c.id === result.chatId ? { ...c, phone: number } : c))
					: [
							...old,
							{
								id: result.chatId!,
								name: formatPhone(number),
								phone: number,
								messages: [],
								unread: 0,
							},
						],
			);
			selectChat(result.chatId);
			setNewChat(false);
			setPhone('');
		} catch (error) {
			if (current === generation.current)
				setChatError(error instanceof Error ? error.message : errorMessage(error));
		} finally {
			setCreating(false);
		}
	}
	async function send(event?: FormEvent) {
		event?.preventDefault();
		if (!credentials || !activeId || !draft.trim() || draft.length > 4000 || sendingRef.current)
			return;
		const chatId = activeId;
		const message = draft;
		const current = generation.current;
		sendingRef.current = true;
		setSending(true);
		setSendError('');
		try {
			const result = await api<{ idMessage: string }>(credentials, 'sendMessage', {
				chatId,
				message,
			});
			if (current !== generation.current) return;
			if (!result.idMessage)
				throw new Error(
					'Сервис не подтвердил отправку. Проверьте переписку в MAX перед повторной попыткой.',
				);
			updateChats((old) =>
				old.map((c) =>
					c.id !== chatId || c.messages.some((m) => m.id === result.idMessage)
						? c
						: {
								...c,
								messages: [
									...c.messages,
									{
										id: result.idMessage,
										text: message,
										outgoing: true,
										time: Date.now(),
										status: 'queued',
									},
								],
							},
				),
			);
			setDrafts((old) => ({ ...old, [chatId]: old[chatId] === message ? '' : old[chatId] }));
			textRef.current?.focus();
		} catch (error) {
			if (current === generation.current)
				setSendError(
					`${errorMessage(error)} Текст сохранён. При обрыве связи проверьте MAX перед повторной отправкой.`,
				);
		} finally {
			sendingRef.current = false;
			setSending(false);
		}
	}
	return (
		<main className={`workspace ${active ? 'has-chat' : ''} ${credentials ? 'signed-in' : ''}`}>
			<aside className="chat-sidebar" aria-label="Чаты">
				<header className="sidebar-heading">
					<div className="wordmark">
						<Brand />
						<span>MAX</span>
					</div>
					<span className="web-label">Веб-чат</span>
				</header>
				<div className="list-heading">
					<h1>Сообщения</h1>
					<button
						className="icon-button new-button"
						aria-label="Новый чат"
						title="Новый чат"
						disabled={!credentials}
						onClick={() => {
							setChatError('');
							setNewChat(true);
						}}
					>
						<Plus size={22} />
					</button>
				</div>
				<div className="chat-list">
					{chats.length ? (
						[...chats]
							.sort(
								(a, b) =>
									(b.messages.at(-1)?.time ?? 0) - (a.messages.at(-1)?.time ?? 0),
							)
							.map((chat) => (
								<button
									key={chat.id}
									className={`chat-row ${activeId === chat.id ? 'selected' : ''}`}
									onClick={() => selectChat(chat.id)}
								>
									<span className="avatar">
										<Smartphone size={23} />
									</span>
									<span className="chat-row-copy">
										<span className="chat-row-title">{chat.name}</span>
										<span className="last-message">
											{chat.messages.at(-1)?.outgoing ? 'Вы: ' : ''}
											{chat.messages.at(-1)?.text ??
												'Напишите первое сообщение'}
										</span>
									</span>
									<span className="chat-row-meta">
										{chat.messages.at(-1) && (
											<time>{time(chat.messages.at(-1)!.time)}</time>
										)}
										{chat.unread > 0 && (
											<span className="unread">{chat.unread}</span>
										)}
									</span>
								</button>
							))
					) : (
						<Empty className="sidebar-empty">
							<span className="empty-small">
								<MessageCircle size={26} />
							</span>
							<EmptyTitle>Здесь будут ваши чаты</EmptyTitle>
							<EmptyDescription>
								{credentials
									? 'Создайте чат, чтобы начать общение'
									: 'Подключитесь, чтобы начать общение'}
							</EmptyDescription>
						</Empty>
					)}
				</div>
				<footer className="sidebar-footer">
					<span className={`connection-dot ${credentials ? 'connected' : ''}`} />
					<span>{credentials ? 'GREEN-API подключён' : 'Нет подключения'}</span>
					{credentials && (
						<button
							className="icon-button"
							title="Выйти и очистить переписку в этой вкладке"
							aria-label="Выйти"
							onClick={logout}
						>
							<LogOut size={18} />
						</button>
					)}
				</footer>
			</aside>
			<section
				className={`main-panel ${credentials ? '' : 'login-panel'}`}
				aria-label="Переписка"
			>
				{!credentials ? (
					<>
						<div className="panel-top">
							<span>
								MAX <span className="divider">/</span> Подключение
							</span>
							<span className="integration-label">
								<span className="green-square" /> GREEN-API
							</span>
						</div>
						<div className="login-content">
							<div className="login-card">
								<Brand large />
								<h2>
									Ваш MAX.
									<br />В одном окне.
								</h2>
								<p className="intro">
									Подключите аккаунт GREEN-API,
									<br />
									чтобы отправлять и получать сообщения.
								</p>
								<form onSubmit={connect} className="login-form">
									<label htmlFor="instance">idInstance</label>
									<div className="input-wrap">
										<Smartphone size={19} />
										<input
											id="instance"
											inputMode="numeric"
											autoComplete="off"
											placeholder="Например, 3100000001"
											value={id}
											onChange={(e) => setId(e.target.value)}
											required
											pattern="[0-9]{6,20}"
											disabled={connecting}
										/>
									</div>
									<label htmlFor="token">apiTokenInstance</label>
									<div className="input-wrap">
										<KeyRound size={19} />
										<input
											id="token"
											type={visibleToken ? 'text' : 'password'}
											autoComplete="off"
											placeholder="Ваш токен доступа"
											value={token}
											onChange={(e) => setToken(e.target.value)}
											required
											minLength={10}
											disabled={connecting}
										/>
										<button
											type="button"
											className="icon-button"
											aria-label={
												visibleToken ? 'Скрыть токен' : 'Показать токен'
											}
											onClick={() => setVisibleToken(!visibleToken)}
										>
											{visibleToken ? (
												<EyeOff size={19} />
											) : (
												<Eye size={19} />
											)}
										</button>
									</div>
									<details className="advanced">
										<summary>
											Адрес API <ChevronDown size={14} />
										</summary>
										<label htmlFor="api-url">apiUrl из личного кабинета</label>
										<input
											className="plain-input"
											id="api-url"
											type="url"
											value={url}
											onChange={(e) => setUrl(e.target.value)}
											required
											disabled={connecting}
										/>
										<p>По умолчанию: 3100.api.green-api.com</p>
									</details>
									{loginError && (
										<p className="error-box" role="alert">
											<CircleAlert size={18} />
											<span>{loginError}</span>
										</p>
									)}
									<button
										className="primary-button connect-button"
										disabled={connecting || !id.trim() || !token.trim()}
									>
										{connecting ? (
											<>
												<LoaderCircle className="spin" size={19} />{' '}
												Подключаемся…
											</>
										) : (
											<>
												Подключиться <ArrowRight size={19} />
											</>
										)}
									</button>
								</form>
								<div className="credential-help">
									Где взять данные?{' '}
									<a
										href="https://console.green-api.com/"
										target="_blank"
										rel="noreferrer"
									>
										Личный кабинет GREEN-API <ArrowRight size={13} />
									</a>
								</div>
								<div className="privacy-note">
									<ShieldCheck size={18} />
									<span>
										Токен хранится только в этой вкладке
										<br />и удаляется при выходе или обновлении.
									</span>
								</div>
							</div>
						</div>
						<footer className="login-footer">
							<span>
								<LockKeyhole size={14} /> Только текстовые сообщения
							</span>
							<span>MAX × GREEN-API</span>
						</footer>
					</>
				) : active ? (
					<>
						<header className="conversation-heading">
							<button
								className="icon-button back-button"
								aria-label="Назад к чатам"
								onClick={() => selectChat(null)}
							>
								<ArrowLeft />
							</button>
							<span className="avatar">
								<Smartphone size={23} />
							</span>
							<div>
								<h2>{active.name}</h2>
								<p>
									{active.phone ? formatPhone(active.phone) : 'Переписка в MAX'}
								</p>
							</div>
							<span className="channel-label">MAX</span>
						</header>
						{pollError && (
							<p className="poll-error" role="status">
								<CircleAlert size={17} />
								{pollError} Получение возобновится автоматически.
							</p>
						)}
						<div
							className="message-list"
							role="log"
							aria-label="Сообщения"
							aria-live="polite"
						>
							{active.messages.length === 0 && (
								<Empty className="conversation-empty">
									<MessageCircle size={32} />
									<EmptyTitle>Начните разговор</EmptyTitle>
									<EmptyDescription>
										Отправьте первое сообщение.
										<br />
										Ответ из MAX появится здесь.
									</EmptyDescription>
								</Empty>
							)}
							{active.messages.map((message, index) => (
								<div key={message.id}>
									{(index === 0 ||
										new Date(message.time).toDateString() !==
											new Date(
												active.messages[index - 1].time,
											).toDateString()) && (
										<div className="day-divider">
											<span>
												{new Date(message.time).toLocaleDateString(
													'ru-RU',
													{ day: 'numeric', month: 'long' },
												)}
											</span>
										</div>
									)}
									<div
										className={`message-row ${message.outgoing ? 'outgoing' : 'incoming'}`}
									>
										<div
											className={`message-bubble ${message.status === 'failed' ? 'failed' : ''}`}
										>
											<p>{message.text}</p>
											<div className="message-meta">
												<time>{time(message.time)}</time>
												{message.outgoing && (
													<span
														title={
															statusLabel[message.status ?? 'queued']
														}
														aria-label={
															statusLabel[message.status ?? 'queued']
														}
													>
														{message.status === 'failed' ? (
															<CircleAlert size={14} />
														) : ['delivered', 'read'].includes(
																message.status ?? '',
														  ) ? (
															<CheckCheck size={16} />
														) : message.status === 'sent' ? (
															<Check size={15} />
														) : (
															<span className="queued-label">
																в очереди
															</span>
														)}
													</span>
												)}
											</div>
										</div>
									</div>
								</div>
							))}
							<div ref={endRef} />
						</div>
						<div className="composer-area">
							{sendError && (
								<p className="error-box" role="alert">
									<CircleAlert size={18} />
									<span>{sendError}</span>
								</p>
							)}
							<form className="composer" onSubmit={send}>
								<textarea
									ref={textRef}
									aria-label="Сообщение"
									placeholder="Написать сообщение…"
									value={draft}
									maxLength={4000}
									rows={1}
									onChange={(e) =>
										setDrafts((old) => ({
											...old,
											[active.id]: e.target.value,
										}))
									}
									onKeyDown={(e) => {
										if (
											e.key === 'Enter' &&
											!e.shiftKey &&
											!e.nativeEvent.isComposing
										) {
											e.preventDefault();
											void send();
										}
									}}
								/>
								<button
									className="send-button"
									title="Отправить"
									aria-label="Отправить сообщение"
									disabled={!draft.trim() || sending}
								>
									{sending ? (
										<LoaderCircle className="spin" size={22} />
									) : (
										<Send size={21} />
									)}
								</button>
							</form>
							<div className="composer-hint">
								<span>Enter — отправить · Shift + Enter — новая строка</span>
								<span>{draft.length} / 4000</span>
							</div>
						</div>
					</>
				) : (
					<>
						<div className="panel-top">
							<span>Ваши сообщения</span>
							<span className="integration-label">
								<span className="green-square" /> GREEN-API
							</span>
						</div>
						{pollError && (
							<p className="poll-error" role="status">
								{pollError} Повторяем подключение…
							</p>
						)}
						<Empty className="welcome-empty">
							<Brand large />
							<EmptyTitle>Всё начинается с сообщения</EmptyTitle>
							<EmptyDescription>
								Создайте новый чат по номеру телефона
								<br />
								или выберите переписку слева.
							</EmptyDescription>
							<button
								className="primary-button"
								onClick={() => {
									setChatError('');
									setNewChat(true);
								}}
							>
								<Plus size={19} /> Новый чат
							</button>
						</Empty>
						<footer className="login-footer">
							<span>Переписка хранится до обновления вкладки</span>
							<span>MAX × GREEN-API</span>
						</footer>
					</>
				)}
			</section>
			<Dialog
				open={newChat}
				onOpenChange={(value) => {
					if (!creating) setNewChat(value);
				}}
			>
				<DialogContent className="new-chat-dialog" showCloseButton={false}>
					<DialogClose
						className="icon-button dialog-close"
						aria-label="Закрыть"
						disabled={creating}
					>
						<X size={20} />
					</DialogClose>
					<span className="dialog-icon">
						<MessageCircle size={26} />
					</span>
					<DialogTitle>Новый чат</DialogTitle>
					<DialogDescription>Введите номер телефона получателя в MAX.</DialogDescription>
					<form onSubmit={createChat}>
						<label htmlFor="phone">Номер телефона</label>
						<div className="input-wrap">
							<Smartphone size={19} />
							<input
								id="phone"
								type="tel"
								autoComplete="tel"
								placeholder="+7 999 123-45-67"
								value={phone}
								onChange={(e) => setPhone(e.target.value)}
								required
								disabled={creating}
							/>
						</div>
						<p className="field-help">Номера России (+7) и Беларуси (+375)</p>
						{chatError && (
							<p className="error-box" role="alert">
								{chatError}
							</p>
						)}
						<button className="primary-button" disabled={creating || !phone.trim()}>
							{creating ? (
								<>
									<LoaderCircle className="spin" size={18} /> Проверяем номер…
								</>
							) : (
								<>
									Создать чат <ArrowRight size={18} />
								</>
							)}
						</button>
					</form>
				</DialogContent>
			</Dialog>
		</main>
	);
}
