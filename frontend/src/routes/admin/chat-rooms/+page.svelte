<script>
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import { locale, t } from '$lib/i18n/admin/index.js';

	let { data } = $props();
 
	let roomsState = $state(Array.isArray(data?.rooms) ? data.rooms : []);
	let paginationState = $state(
		data?.pagination || {
			page: 1,
			limit: 20,
			total: 0,
			totalPages: 1,
			hasPrevPage: false,
			hasNextPage: false
		}
	);
	let statusCountsState = $state(data?.statusCounts || { all: 0, open: 0, handoff: 0, closed: 0 });
	let filtersState = $state(data?.filters || { status: '', q: '', mine: false, unreadOnly: false });
	let apiErrorState = $state(data?.apiError || '');
	let currentAdmin = $state(data?.currentAdmin || null);
	let copiedRoomCode = $state('');
	let nowTs = $state(Date.now());
	let streamError = $state(false);
	let selectedRoomIds = $state(new Set());
	let selectAllMatching = $state(false);
	let bulkDeleteBusy = $state(false);
	let roomRefreshInFlight = false;
	let roomRefreshQueued = false;

	const rooms = $derived(Array.isArray(roomsState) ? roomsState : []);
	const filters = $derived(filtersState || { status: '', q: '', mine: false, unreadOnly: false });
	const pagination = $derived(
		paginationState || {
			page: 1,
			limit: 20,
			total: 0,
			totalPages: 1,
			hasPrevPage: false,
			hasNextPage: false
		}
	);
	const statusCounts = $derived(statusCountsState || { all: 0, open: 0, handoff: 0, closed: 0 });
	const returnTo = $derived(data?.returnTo || '/admin/chat-rooms');
	const apiError = $derived(apiErrorState || '');

	const roomCode = (sessionId) => String(sessionId || '').replace(/^chat_?/, '') || '--';
	const roomActivityAt = (room) =>
		room?.latestMessage?.createdAt ||
		room?.lastActiveAt ||
		room?.updatedAt ||
		room?.createdAt ||
		null;
	const guestCustomerLabel = 'Kh\u00e1ch h\u00e0ng L\u1ea1';
	const hasAuthenticatedCustomerAccount = (room) => Boolean(room?.context?.authenticatedCustomer);
	const roomTitle = (room) =>
		room?.latestLead?.phone ||
		(hasAuthenticatedCustomerAccount(room) ? room?.user?.name : null) ||
		(room?.handoff?.requestedAt ? guestCustomerLabel : $t('common.customer'));

	const formatDate = (value) => {
		if (!value) return '--';
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return '--';
		return date.toLocaleString($locale === 'en' ? 'en-US' : 'vi-VN');
	};

	const statusLabel = (value) => {
		const key = String(value || '').toLowerCase();
		if (key === 'open') return $t('admin.chatRooms.status.open');
		if (key === 'handoff') return $t('admin.chatRooms.status.handoff');
		if (key === 'closed') return $t('admin.chatRooms.status.closed');
		return key || '--';
	};

	const presenceLabel = (room) => {
		const key = String(room?.customerPresence?.state || '').toLowerCase();
		return key === 'left'
			? $t('admin.chatRooms.presence.left')
			: $t('admin.chatRooms.presence.active');
	};

	const latestText = (room) => {
		const text = String(room?.latestMessage?.text || '').trim();
		if (!text) return room?.sourcePath || '/';
		return text.length > 140 ? `${text.slice(0, 137)}...` : text;
	};

	const formatSidebarTime = (value) => {
		if (!value) return '--';
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return '--';
		const diff = Math.abs(nowTs - date.getTime());
		if (diff < 86400000) {
			return date.toLocaleTimeString($locale === 'en' ? 'en-US' : 'vi-VN', {
				hour: '2-digit',
				minute: '2-digit'
			});
		}
		return date.toLocaleDateString($locale === 'en' ? 'en-US' : 'vi-VN', {
			day: '2-digit',
			month: '2-digit'
		});
	};

	const formatRoomGroupLabel = (value) => {
		if (!value) return '--';
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return '--';
		const target = new Date(date);
		target.setHours(0, 0, 0, 0);
		const today = new Date(nowTs);
		today.setHours(0, 0, 0, 0);
		const yesterday = new Date(today);
		yesterday.setDate(yesterday.getDate() - 1);
		if (target.getTime() === today.getTime()) return $t('common.today');
		if (target.getTime() === yesterday.getTime()) return $t('common.yesterday');
		return date.toLocaleDateString($locale === 'en' ? 'en-US' : 'vi-VN', {
			weekday: 'short',
			day: '2-digit',
			month: '2-digit'
		});
	};

	const groupedRooms = $derived.by(() => {
		const sorted = [...rooms].sort(
			(left, right) =>
				new Date(roomActivityAt(right) || 0).getTime() -
				new Date(roomActivityAt(left) || 0).getTime()
		);
		const groups = [];
		for (const room of sorted) {
			const activityAt = roomActivityAt(room);
			const date = activityAt ? new Date(activityAt) : null;
			const key =
				date && !Number.isNaN(date.getTime())
					? new Date(date.setHours(0, 0, 0, 0)).toISOString()
					: 'unknown';
			const label = formatRoomGroupLabel(activityAt);
			const existing = groups.find((group) => group.key === key);
			if (existing) {
				existing.items.push(room);
				continue;
			}
			groups.push({ key, label, items: [room] });
		}
		return groups;
	});

	const unreadLabel = (count) => {
		if (!count) return '';
		return count > 99 ? '99+' : String(count);
	};

	const formatElapsed = (milliseconds) => {
		const totalSeconds = Math.max(Math.floor(Number(milliseconds || 0) / 1000), 0);
		const hours = Math.floor(totalSeconds / 3600);
		const minutes = Math.floor((totalSeconds % 3600) / 60);
		const seconds = totalSeconds % 60;
		if (hours > 0) return `${hours}h ${minutes}m`;
		if (minutes > 0) return `${minutes}m ${seconds}s`;
		return `${seconds}s`;
	};

	const slaTone = (room) => {
		if (!room?.sla) return 'neutral';
		if (room.sla.state === 'closed') return 'neutral';
		if (room.sla.level === 'critical') return 'critical';
		if (room.sla.level === 'warning') return 'warning';
		if (room.sla.state === 'waiting') return 'waiting';
		return 'active';
	};

	const slaLabel = (room) => {
		if (!room?.sla) return '--';
		const elapsed = nowTs - new Date(room.sla.startedAt || nowTs).getTime();
		const tonePrefix =
			room.sla.level === 'critical'
				? $t('admin.chatRooms.sla.critical')
				: room.sla.level === 'warning'
					? $t('admin.chatRooms.sla.warning')
					: '';
		if (room.sla.state === 'waiting')
			return `${tonePrefix ? `${tonePrefix} · ` : ''}${$t('admin.chatRooms.sla.waiting', { time: formatElapsed(elapsed) })}`;
		if (room.sla.state === 'active')
			return `${tonePrefix ? `${tonePrefix} · ` : ''}${$t('admin.chatRooms.sla.active', { time: formatElapsed(elapsed) })}`;
		if (room.sla.state === 'closed') return $t('admin.chatRooms.sla.closed');
		return `${tonePrefix ? `${tonePrefix} · ` : ''}${$t('admin.chatRooms.sla.open', { time: formatElapsed(elapsed) })}`;
	};

	const roomOwnedByCurrentAdmin = (room) => {
		if (!currentAdmin?.userId) return false;
		return (
			String(currentAdmin.userId) === String(room?.assignedTo?._id || '') ||
			String(currentAdmin.email || '').toLowerCase() ===
				String(room?.liveSupport?.adminEmail || '').toLowerCase()
		);
	};
	const isRootAdmin = $derived(Array.isArray(currentAdmin?.roles) && currentAdmin.roles.includes('SUPER_ADMIN'));
	const roomHandledByOtherAdmin = (room) =>
		Boolean(room?.liveSupport?.active && !roomOwnedByCurrentAdmin(room));
	const selectedCount = $derived(
		selectAllMatching ? Math.max(Number(pagination.total) || 0, rooms.length) : selectedRoomIds.size
	);
	const allVisibleSelected = $derived(
		rooms.length > 0 &&
			(selectAllMatching ||
				rooms.every((room) => selectedRoomIds.has(String(room?.sessionId || ''))))
	);
	const anySelected = $derived(selectedCount > 0);

	const buildQuery = (overrides = {}) => {
		const next = {
			status: overrides.status ?? filters.status,
			q: overrides.q ?? filters.q,
			page: overrides.page ?? pagination.page,
			limit: overrides.limit ?? pagination.limit,
			mine: overrides.mine ?? filters.mine,
			unreadOnly: overrides.unreadOnly ?? filters.unreadOnly
		};
		const params = new URLSearchParams();
		if (next.status) params.set('status', next.status);
		if (next.q) params.set('q', next.q);
		if (next.page && Number(next.page) > 1) params.set('page', String(next.page));
		if (next.limit) params.set('limit', String(next.limit));
		if (next.mine) params.set('mine', '1');
		if (next.unreadOnly) params.set('unreadOnly', '1');
		return params.toString();
	};

	const buildHref = (overrides = {}) => {
		const query = buildQuery(overrides);
		return query ? `/admin/chat-rooms?${query}` : '/admin/chat-rooms';
	};

	const roomHref = (sessionId) =>
		`/admin/chat-rooms/${sessionId}?${new URLSearchParams({ returnTo }).toString()}`;

	const copyRoomCode = async (sessionId) => {
		const value = roomCode(sessionId);
		if (!browser || !value || value === '--' || !navigator?.clipboard) return;
		await navigator.clipboard.writeText(value);
		copiedRoomCode = value;
		window.setTimeout(() => {
			if (copiedRoomCode === value) copiedRoomCode = '';
		}, 1800);
	};

	const refreshRooms = async () => {
		if (!browser) return;
		if (roomRefreshInFlight) {
			roomRefreshQueued = true;
			return;
		}
		roomRefreshInFlight = true;
		const query = buildQuery();
		try {
			const response = await fetch(`/admin/api/chat-rooms${query ? `?${query}` : ''}`, {
				headers: { 'cache-control': 'no-store' }
			});
			const payload = await response.json().catch(() => null);
			if (!response.ok) {
				apiErrorState = payload?.error || $t('admin.chatRooms.errors.listLoad');
				return;
			}
			const metadata = payload?.metadata || {};
			roomsState = Array.isArray(metadata.items) ? metadata.items : [];
			paginationState = metadata?.pagination || paginationState;
			statusCountsState = metadata?.statusCounts || statusCountsState;
			filtersState = {
				status: metadata?.filters?.status || '',
				q: metadata?.filters?.q || '',
				mine: Boolean(metadata?.filters?.mine),
				unreadOnly: Boolean(metadata?.filters?.unreadOnly)
			};
			apiErrorState = '';
			streamError = false;
			selectedRoomIds = selectAllMatching
				? new Set(roomsState.map((room) => String(room?.sessionId || '')))
				: new Set(
						[...selectedRoomIds].filter((id) =>
							roomsState.some((room) => String(room?.sessionId || '') === id)
						)
					);
		} catch {
			apiErrorState = $t('admin.chatRooms.errors.listLoad');
		} finally {
			roomRefreshInFlight = false;
			if (roomRefreshQueued) {
				roomRefreshQueued = false;
				void refreshRooms();
			}
		}
	};

	const toggleRoomSelection = (roomId, checked) => {
		selectAllMatching = false;
		const next = new Set(selectedRoomIds);
		if (checked) next.add(String(roomId));
		else next.delete(String(roomId));
		selectedRoomIds = next;
	};

	const toggleSelectAll = (checked) => {
		selectAllMatching = checked;
		selectedRoomIds = checked ? new Set(rooms.map((room) => String(room?.sessionId || ''))) : new Set();
	};

	const deleteSelectedRooms = async () => {
		if (!browser || bulkDeleteBusy || !selectedRoomIds.size || !isRootAdmin) return;
		const roomIds = [...selectedRoomIds];
		const confirmed = window.confirm(`Xóa ${roomIds.length} phòng chat đã chọn? Hành động này không thể hoàn tác.`);
		if (!confirmed) return;

		bulkDeleteBusy = true;
		try {
			const response = await fetch('/admin/api/chat-rooms/bulk-delete', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					sessionIds: roomIds,
					selectAllMatching,
					filters: {
						status: filters.status,
						q: filters.q,
						mine: filters.mine,
						unreadOnly: filters.unreadOnly
					}
				})
			});
			const payload = await response.json().catch(() => null);
			if (!response.ok && !Array.isArray(payload?.results)) {
				apiErrorState = payload?.error || 'Không thể xóa phòng chat.';
				return;
			}
			const results = Array.isArray(payload?.results) ? payload.results : [];
			const failed = results.filter((item) => !item?.ok);
			if (failed.length) {
				apiErrorState = `Không xóa được ${failed.length}/${roomIds.length} phòng chat.`;
			} else {
				apiErrorState = '';
			}
			selectAllMatching = false;
			selectedRoomIds = new Set();
			await refreshRooms();
		} finally {
			bulkDeleteBusy = false;
		}
	};

	onMount(() => {
		if (!browser) return undefined;
		const clock = window.setInterval(() => {
			nowTs = Date.now();
		}, 1000);
		const stream = new EventSource('/admin/api/chat-rooms/stream');
		stream.addEventListener('room', () => {
			void refreshRooms();
		});
		stream.addEventListener('ready', () => {
			streamError = false;
		});
		stream.onerror = () => {
			streamError = true;
		};
		return () => {
			window.clearInterval(clock);
			stream.close();
		};
	});
</script>

<svelte:head>
	<title>{$t('admin.chatRooms.pageTitle')} | Admin</title>
</svelte:head>

<section class="chat-room-list">
	<div class="chat-room-list__hero">
		<div>
			<h1>{$t('admin.chatRooms.pageTitle')}</h1>
			<p>{$t('admin.chatRooms.lede')}</p>
		</div>
		{#if apiError}
			<div class="chat-room-list__error">{apiError}</div>
		{/if}
		{#if streamError && !apiError}
			<div class="chat-room-list__error">
				Kết nối realtime đang gián đoạn. Hệ thống sẽ tự kết nối lại.
			</div>
		{/if}
	</div>

	<div class="chat-room-list__stats">
		<a class:active={!filters.status} href={buildHref({ status: '', page: 1 })}>
			<span>{$t('admin.chatRooms.filters.all')}</span>
			<strong>{statusCounts.all}</strong>
		</a>
		<a class:active={filters.status === 'open'} href={buildHref({ status: 'open', page: 1 })}>
			<span>{$t('admin.chatRooms.status.open')}</span>
			<strong>{statusCounts.open}</strong>
		</a>
		<a class:active={filters.status === 'handoff'} href={buildHref({ status: 'handoff', page: 1 })}>
			<span>{$t('admin.chatRooms.status.handoff')}</span>
			<strong>{statusCounts.handoff}</strong>
		</a>
		<a class:active={filters.status === 'closed'} href={buildHref({ status: 'closed', page: 1 })}>
			<span>{$t('admin.chatRooms.status.closed')}</span>
			<strong>{statusCounts.closed}</strong>
		</a>
	</div>

	<div class="chat-room-list__toolbar">
		<form method="GET" class="chat-room-list__filters">
			<div class="chat-room-list__search">
				<label for="chat-room-search">{$t('admin.chatRooms.filters.search')}</label>
				<input
					id="chat-room-search"
					type="search"
					name="q"
					value={filters.q}
					placeholder={$t('admin.chatRooms.filters.searchPlaceholder')}
				/>
			</div>

			<div class="chat-room-list__field">
				<label for="chat-room-status">{$t('admin.chatRooms.filters.status')}</label>
				<select id="chat-room-status" name="status">
					<option value="">{$t('admin.chatRooms.filters.all')}</option>
					<option value="open" selected={filters.status === 'open'}
						>{$t('admin.chatRooms.status.open')}</option
					>
					<option value="handoff" selected={filters.status === 'handoff'}
						>{$t('admin.chatRooms.status.handoff')}</option
					>
					<option value="closed" selected={filters.status === 'closed'}
						>{$t('admin.chatRooms.status.closed')}</option
					>
				</select>
			</div>

			<div class="chat-room-list__field chat-room-list__field--limit">
				<label for="chat-room-limit">{$t('admin.chatRooms.filters.limit')}</label>
				<select id="chat-room-limit" name="limit">
					<option value="10" selected={pagination.limit === 10}>10</option>
					<option value="20" selected={pagination.limit === 20}>20</option>
					<option value="50" selected={pagination.limit === 50}>50</option>
				</select>
			</div>

			<label class="chat-room-list__toggle">
				<input type="checkbox" name="mine" value="1" checked={filters.mine} />
				<span>{$t('admin.chatRooms.filters.onlyMine')}</span>
			</label>

			<label class="chat-room-list__toggle">
				<input type="checkbox" name="unreadOnly" value="1" checked={filters.unreadOnly} />
				<span>{$t('admin.chatRooms.filters.unreadOnlyCheckbox')}</span>
			</label>

			<button type="submit">{$t('admin.chatRooms.filters.apply')}</button>
		</form>
	</div>

	<div class="chat-room-list__chips">
		<a class:active={filters.mine} href={buildHref({ mine: !filters.mine, page: 1 })}
			>{$t('admin.chatRooms.filters.mine')}</a
		>
		<a
			class:active={filters.unreadOnly}
			href={buildHref({ unreadOnly: !filters.unreadOnly, page: 1 })}
			>{$t('admin.chatRooms.filters.unreadOnly')}</a
		>
	</div>

	<div class="chat-room-list__bulk">
		<label class="chat-room-list__bulk-select">
			<input
				type="checkbox"
				checked={allVisibleSelected}
				disabled={!isRootAdmin}
				onchange={(event) => toggleSelectAll(event.currentTarget.checked)}
			/>
			<span>Chọn tất cả phòng đang hiển thị</span>
		</label>
		{#if selectAllMatching}
			<span class="chat-room-list__bulk-note">Đang áp dụng cho toàn bộ danh sách theo bộ lọc hiện tại ({pagination.total} phòng).</span>
		{/if}
		<button
			type="button"
			class="chat-room-list__bulk-delete"
			disabled={!isRootAdmin || !anySelected || bulkDeleteBusy}
			onclick={deleteSelectedRooms}
		>
			{bulkDeleteBusy
				? 'Đang xóa...'
				: selectAllMatching
					? `Xóa toàn bộ ${selectedCount} phòng`
					: `Xóa ${selectedCount} phòng`}
		</button>
	</div>

	<div class="chat-room-list__stack">
		{#if groupedRooms.length}
			{#each groupedRooms as group (group.key)}
				<section class="chat-room-group">
					<header class="chat-room-group__label">{group.label}</header>
					<div class="chat-room-inbox">
						{#each group.items as room (room.sessionId)}
							<article class="chat-room-row">
								<div class="chat-room-row__select">
									<input
										type="checkbox"
										checked={selectedRoomIds.has(String(room.sessionId))}
										disabled={!isRootAdmin}
										onchange={(event) => toggleRoomSelection(room.sessionId, event.currentTarget.checked)}
										aria-label={`Chọn phòng ${roomCode(room.sessionId)}`}
									/>
								</div>
								<a
									class="chat-room-row__main"
									href={roomHref(room.sessionId)}
									data-sveltekit-preload-data="hover"
								>
									<div class="chat-room-row__avatar">
										{String(roomTitle(room) || 'K')
											.slice(0, 1)
											.toUpperCase()}
									</div>
									<div class="chat-room-row__body">
										<div class="chat-room-row__top">
											<strong>{roomTitle(room)}</strong>
											<time>{formatSidebarTime(roomActivityAt(room))}</time>
										</div>
										<div class="chat-room-row__middle">
											<p>{latestText(room)}</p>
											{#if room.unreadCount}
												<span class="chat-room-row__unread">{unreadLabel(room.unreadCount)}</span>
											{/if}
										</div>
										<div class="chat-room-row__meta">
											<span
												class={`chat-room-row__status chat-room-row__status--${String(room.status || 'open').toLowerCase()}`}
												>{statusLabel(room.status)}</span
											>
											<span class={`chat-room-row__sla chat-room-row__sla--${slaTone(room)}`}
												>{slaLabel(room)}</span
											>
											<span class="chat-room-row__code">{roomCode(room.sessionId)}</span>
											{#if roomHandledByOtherAdmin(room)}
												<span class="chat-room-row__locked"
													>{$t('admin.chatRooms.detail.otherConsultantBadge')}</span
												>
											{/if}
											{#if roomOwnedByCurrentAdmin(room)}
												<span class="chat-room-row__mine">{$t('admin.chatRooms.filters.mine')}</span
												>
											{/if}
										</div>
										<div class="chat-room-row__detail">
											<span
												>{room.liveSupport?.accountLabel ||
													room.liveSupport?.adminName ||
													$t('admin.chatRooms.detail.noConsultantAssigned')}</span
											>
											<span>{presenceLabel(room)}</span>
										</div>
									</div>
								</a>
								<div class="chat-room-row__actions">
									<button
										type="button"
										class="chat-room-row__copy"
										onclick={() => copyRoomCode(room.sessionId)}
									>
										{copiedRoomCode === roomCode(room.sessionId)
											? $t('admin.chatRooms.table.copied')
											: $t('admin.chatRooms.detail.copyCodeShort')}
									</button>
									<a
										class="chat-room-row__open"
										href={roomHref(room.sessionId)}
										data-sveltekit-preload-data="hover"
									>
										{$t('admin.chatRooms.table.detail')}
									</a>
								</div>
							</article>
						{/each}
					</div>
				</section>
			{/each}
		{:else}
			<div class="chat-room-list__empty">{$t('admin.chatRooms.table.noRooms')}</div>
		{/if}
	</div>

	{#if pagination.totalPages > 1}
		<div class="chat-room-list__pagination">
			<span>{$t('admin.chatRooms.pagination.page')} {pagination.page}/{pagination.totalPages}</span>
			<div>
				{#if pagination.hasPrevPage}
					<a href={buildHref({ page: (pagination.page || 1) - 1 })}
						>{$t('admin.chatRooms.pagination.previous')}</a
					>
				{/if}
				{#if pagination.hasNextPage}
					<a href={buildHref({ page: (pagination.page || 1) + 1 })}
						>{$t('admin.chatRooms.pagination.next')}</a
					>
				{/if}
			</div>
		</div>
	{/if}
</section>

<style>
	.chat-room-list {
		display: grid;
		gap: 1rem;
	}

	.chat-room-list__hero,
	.chat-room-list__toolbar,
	.chat-room-list__stack,
	.chat-room-list__pagination {
		background: #fff;
		border: 1px solid rgba(15, 23, 42, 0.08);
		border-radius: 24px;
		box-shadow: 0 16px 40px rgba(15, 23, 42, 0.06);
	}

	.chat-room-list__hero {
		padding: 1.5rem;
		display: grid;
		gap: 0.75rem;
	}

	.chat-room-list__hero h1 {
		margin: 0;
		font-size: clamp(1.45rem, 2vw, 2rem);
		font-weight: 800;
		color: #0f172a;
	}

	.chat-room-list__hero p {
		margin: 0;
		max-width: 70ch;
		color: #475569;
		line-height: 1.6;
	}

	.chat-room-list__error {
		padding: 0.9rem 1rem;
		border-radius: 16px;
		background: #fff1f2;
		color: #b91c1c;
		font-weight: 600;
	}

	.chat-room-list__stats {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 0.85rem;
	}

	.chat-room-list__stats a {
		padding: 1rem 1.1rem;
		border-radius: 20px;
		background: #fff;
		border: 1px solid rgba(15, 23, 42, 0.08);
		color: #334155;
		text-decoration: none;
		display: grid;
		gap: 0.35rem;
		box-shadow: 0 12px 30px rgba(15, 23, 42, 0.05);
	}

	.chat-room-list__stats a.active {
		background: linear-gradient(135deg, #0f766e, #0f766e 45%, #115e59);
		color: #fff;
		border-color: transparent;
	}

	.chat-room-list__stats span {
		font-size: 0.84rem;
		font-weight: 600;
		opacity: 0.82;
	}

	.chat-room-list__stats strong {
		font-size: 1.45rem;
		font-weight: 800;
	}

	.chat-room-list__toolbar {
		padding: 1.15rem;
	}

	.chat-room-list__filters {
		display: grid;
		grid-template-columns: minmax(0, 2fr) repeat(2, minmax(150px, 0.7fr)) repeat(2, auto) auto;
		gap: 0.85rem;
		align-items: end;
	}

	.chat-room-list__search,
	.chat-room-list__field {
		display: grid;
		gap: 0.35rem;
	}

	.chat-room-list__search label,
	.chat-room-list__field label {
		font-size: 0.82rem;
		font-weight: 700;
		color: #475569;
	}

	.chat-room-list__search input,
	.chat-room-list__field select {
		height: 46px;
		border-radius: 14px;
		border: 1px solid rgba(148, 163, 184, 0.45);
		padding: 0 0.95rem;
		background: #f8fafc;
		color: #0f172a;
	}

	.chat-room-list__toggle {
		height: 46px;
		padding: 0 1rem;
		border-radius: 14px;
		border: 1px solid rgba(148, 163, 184, 0.35);
		background: #f8fafc;
		display: inline-flex;
		align-items: center;
		gap: 0.55rem;
		font-size: 0.88rem;
		font-weight: 600;
		color: #334155;
	}

	.chat-room-list__filters button {
		height: 46px;
		padding: 0 1.25rem;
		border: 0;
		border-radius: 14px;
		background: #0f172a;
		color: #fff;
		font-weight: 700;
	}

	.chat-room-list__chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.65rem;
	}

	.chat-room-list__chips a {
		padding: 0.65rem 0.95rem;
		border-radius: 999px;
		background: #fff;
		border: 1px solid rgba(148, 163, 184, 0.35);
		color: #334155;
		text-decoration: none;
		font-size: 0.88rem;
		font-weight: 700;
	}

	.chat-room-list__chips a.active {
		background: #0f172a;
		border-color: #0f172a;
		color: #fff;
	}

	.chat-room-list__stack {
		padding: 1rem;
		display: grid;
		gap: 1rem;
	}

	.chat-room-list__bulk {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.85rem;
		padding: 0.9rem 1rem;
		background: #fff;
		border: 1px solid rgba(15, 23, 42, 0.08);
		border-radius: 20px;
		box-shadow: 0 12px 30px rgba(15, 23, 42, 0.05);
	}

	.chat-room-list__bulk-select {
		display: inline-flex;
		align-items: center;
		gap: 0.55rem;
		font-weight: 700;
		color: #334155;
	}

	.chat-room-list__bulk-note {
		font-size: 0.82rem;
		font-weight: 600;
		color: #64748b;
	}

	.chat-room-list__bulk-delete {
		height: 42px;
		padding: 0 1rem;
		border-radius: 999px;
		border: 0;
		background: #b91c1c;
		color: #fff;
		font-weight: 800;
	}

	.chat-room-list__bulk-delete:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.chat-room-group {
		display: grid;
		gap: 0.55rem;
	}

	.chat-room-group__label {
		padding: 0 0.25rem;
		font-size: 0.74rem;
		font-weight: 800;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: #64748b;
	}

	.chat-room-inbox {
		border-radius: 24px;
		border: 1px solid rgba(148, 163, 184, 0.18);
		background: linear-gradient(180deg, rgba(248, 250, 252, 0.78), rgba(255, 255, 255, 0.98));
		overflow: hidden;
	}

	.chat-room-row {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: stretch;
		border-bottom: 1px solid rgba(226, 232, 240, 0.82);
		background: rgba(255, 255, 255, 0.96);
	}

	.chat-room-row__select {
		display: flex;
		align-items: center;
		justify-content: center;
		padding-left: 0.9rem;
	}

	.chat-room-row__select input {
		width: 18px;
		height: 18px;
	}

	.chat-room-list__bulk-select input:disabled,
	.chat-room-row__select input:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.chat-room-inbox .chat-room-row:last-child {
		border-bottom: none;
	}

	.chat-room-row:hover {
		background: #f8fafc;
	}

	.chat-room-row__main {
		padding: 0.95rem 1rem;
		display: grid;
		grid-template-columns: 52px minmax(0, 1fr);
		gap: 0.85rem;
		text-decoration: none;
		color: inherit;
		min-width: 0;
	}

	.chat-room-row__avatar {
		width: 52px;
		height: 52px;
		border-radius: 50%;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: linear-gradient(135deg, #0f766e, #0ea5e9);
		color: #fff;
		font-size: 1rem;
		font-weight: 800;
		box-shadow: 0 8px 18px rgba(15, 118, 110, 0.16);
	}

	.chat-room-row__body {
		display: grid;
		gap: 0.35rem;
		min-width: 0;
	}

	.chat-room-row__top,
	.chat-room-row__middle {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		min-width: 0;
	}

	.chat-room-row__top strong {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 1rem;
		color: #0f172a;
	}

	.chat-room-row__top time {
		flex: 0 0 auto;
		font-size: 0.78rem;
		font-weight: 600;
		color: #64748b;
	}

	.chat-room-row__middle p {
		margin: 0;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.86rem;
		color: #475569;
	}

	.chat-room-row__unread {
		flex: 0 0 auto;
		min-width: 22px;
		height: 22px;
		padding: 0 0.4rem;
		border-radius: 999px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: #ef4444;
		color: #fff;
		font-size: 0.72rem;
		font-weight: 800;
	}

	.chat-room-row__meta,
	.chat-room-row__detail {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex-wrap: wrap;
	}

	.chat-room-row__detail {
		gap: 0.55rem;
		font-size: 0.78rem;
		color: #64748b;
	}

	.chat-room-row__detail span {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.chat-room-row__status,
	.chat-room-row__sla,
	.chat-room-row__code,
	.chat-room-row__mine,
	.chat-room-row__locked {
		display: inline-flex;
		align-items: center;
		height: 22px;
		padding: 0 0.52rem;
		border-radius: 999px;
		font-size: 0.68rem;
		font-weight: 700;
	}

	.chat-room-row__status--open {
		background: #dcfce7;
		color: #166534;
	}

	.chat-room-row__status--handoff {
		background: #dbeafe;
		color: #1d4ed8;
	}

	.chat-room-row__status--closed {
		background: #e2e8f0;
		color: #475569;
	}

	.chat-room-row__sla--neutral {
		background: #e2e8f0;
		color: #475569;
	}

	.chat-room-row__sla--waiting {
		background: #dbeafe;
		color: #1d4ed8;
	}

	.chat-room-row__sla--active {
		background: #ccfbf1;
		color: #115e59;
	}

	.chat-room-row__sla--warning {
		background: #fef3c7;
		color: #b45309;
	}

	.chat-room-row__sla--critical {
		background: #fee2e2;
		color: #b91c1c;
	}

	.chat-room-row__code {
		background: #f1f5f9;
		color: #334155;
	}

	.chat-room-row__mine {
		background: #fef3c7;
		color: #92400e;
	}

	.chat-room-row__locked {
		background: #fee2e2;
		color: #b91c1c;
	}

	.chat-room-row__actions {
		padding: 0.95rem 1rem 0.95rem 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		align-items: flex-end;
		gap: 0.55rem;
	}

	.chat-room-row__copy,
	.chat-room-row__open {
		height: 34px;
		padding: 0 0.85rem;
		border-radius: 999px;
		font-size: 0.78rem;
		font-weight: 700;
	}

	.chat-room-row__copy {
		border: 1px solid rgba(148, 163, 184, 0.35);
		background: #fff;
		color: #334155;
	}

	.chat-room-row__open {
		border: none;
		background: rgba(15, 118, 110, 0.1);
		color: #0f766e;
		text-decoration: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	.chat-room-list__empty {
		padding: 2rem;
		border-radius: 18px;
		background: #f8fafc;
		text-align: center;
		color: #64748b;
		font-weight: 600;
	}

	.chat-room-list__pagination {
		padding: 1rem 1.2rem;
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
	}

	.chat-room-list__pagination span {
		color: #64748b;
		font-weight: 600;
	}

	.chat-room-list__pagination div {
		display: inline-flex;
		gap: 0.7rem;
		flex-wrap: wrap;
	}

	.chat-room-list__pagination a {
		padding: 0.65rem 0.95rem;
		border-radius: 12px;
		background: #f8fafc;
		border: 1px solid rgba(148, 163, 184, 0.35);
		color: #0f172a;
		text-decoration: none;
		font-weight: 700;
	}

	@media (max-width: 1080px) {
		.chat-room-list__filters {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	@media (max-width: 900px) {
		.chat-room-list__stats {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	@media (max-width: 700px) {
		.chat-room-list__filters {
			grid-template-columns: 1fr;
		}

		.chat-room-row {
			grid-template-columns: 1fr;
		}

		.chat-room-row__select {
			padding: 0.85rem 0.9rem 0;
			justify-content: flex-start;
		}

		.chat-room-row__main {
			grid-template-columns: 44px minmax(0, 1fr);
			padding: 0.8rem 0.9rem;
		}

		.chat-room-row__avatar {
			width: 44px;
			height: 44px;
		}

		.chat-room-row__actions {
			padding: 0 0.9rem 0.85rem;
			flex-direction: row;
			justify-content: flex-start;
			align-items: center;
		}

		.chat-room-list__bulk {
			flex-direction: column;
			align-items: stretch;
		}

		.chat-room-list__bulk-delete {
			width: 100%;
		}

		.chat-room-list__pagination {
			flex-direction: column;
			align-items: flex-start;
		}
	}

	@media (max-width: 520px) {
		.chat-room-list__stats {
			grid-template-columns: 1fr;
		}
	}
</style>
