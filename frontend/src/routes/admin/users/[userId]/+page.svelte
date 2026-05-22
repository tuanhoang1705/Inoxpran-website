<script>
	import { onMount } from 'svelte';
	import { pushToast } from '$lib/stores/adminToast.js';
	import { locale, t } from '$lib/i18n/admin/index.js';

	let { data, form } = $props();

	const user = $derived.by(() => form?.user || data?.user);
	const loadError = $derived.by(() => data?.apiError || '');
	const telemetry = $derived(user?.telemetry || user?.activityTelemetry || user?.analytics || null);
	const viewedProducts = $derived.by(() => {
		const list =
			telemetry?.viewedProducts ||
			telemetry?.productsViewed ||
			telemetry?.recentProducts ||
			[];
		return Array.isArray(list) ? list : [];
	});
	const recommendedProducts = $derived.by(() => {
		const list = telemetry?.recommendedProducts || telemetry?.recommended || [];
		return Array.isArray(list) ? list : [];
	});
	const recentClicks = $derived.by(() => {
		const list = telemetry?.recentClicks || telemetry?.clicksRecent || [];
		return Array.isArray(list) ? list : [];
	});
	const dailyActiveTime = $derived.by(() => {
		const list = telemetry?.dailyActiveTime || telemetry?.dailyUsage || [];
		return Array.isArray(list) ? list : [];
	});
	const visitedPaths = $derived.by(() => {
		const list = telemetry?.visitedPaths || telemetry?.paths || [];
		return Array.isArray(list) ? list : [];
	});
	const telemetryUnavailableTitle = $derived(
		$locale === 'en' ? 'Telemetry is not enabled yet' : 'Chưa bật theo dõi hành vi'
	);
	const telemetryUnavailableDesc = $derived(
		$locale === 'en'
			? 'This user account does not have IP/activity tracking data yet. Add tracking collection on frontend + backend to populate this panel.'
			: 'Tài khoản này chưa có dữ liệu IP/hành vi. Cần bổ sung hệ thống tracking ở frontend + backend để hiển thị panel này.'
	);
	const resetActionLabel = $derived(
		$locale === 'en' ? 'Send password reset email' : 'Gửi mail cấp lại mật khẩu'
	);
	const deleteActionLabel = $derived($locale === 'en' ? 'Delete user' : 'Xóa người dùng');
	const deleteActionHint = $derived(
		$locale === 'en'
			? 'This permanently removes the user account.'
			: 'Thao tác này sẽ xóa vĩnh viễn tài khoản người dùng.'
	);
	const confirmDeleteText = $derived(
		$locale === 'en'
			? 'Are you sure you want to delete this user?'
			: 'Bạn có chắc muốn xóa người dùng này không?'
	);
	const formatDate = (value) => {
		if (!value) return '—';
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return '—';
		return date.toLocaleString($locale === 'en' ? 'en-US' : 'vi-VN');
	};
	const formatBool = (value) =>
		value ? ($locale === 'en' ? 'Yes' : 'Có') : ($locale === 'en' ? 'No' : 'Không');
	const formatDuration = (seconds) => {
		const total = Number(seconds);
		if (!Number.isFinite(total) || total <= 0) return '0m';
		const hours = Math.floor(total / 3600);
		const minutes = Math.round((total % 3600) / 60);
		if (hours <= 0) return `${minutes}m`;
		return `${hours}h ${minutes}m`;
	};
	const localeLabel = (value) => {
		if (!value) return '—';
		const normalized = String(value).toLowerCase();
		if (normalized.startsWith('vi')) return $locale === 'en' ? 'Vietnamese' : 'Tiếng Việt';
		if (normalized.startsWith('en')) return $locale === 'en' ? 'English' : 'Tiếng Anh';
		return value;
	};

	const statusOptions = $derived([
		{ value: 'active', label: $t('admin.users.status.active') },
		{ value: 'inactive', label: $t('admin.users.status.inactive') },
		{ value: 'blocked', label: $t('admin.users.status.blocked') }
	]);

	const statusLabels = $derived({
		active: $t('admin.users.status.active'),
		inactive: $t('admin.users.status.inactive'),
		blocked: $t('admin.users.status.blocked')
	});

	const resolveStatusLabel = (value) => statusLabels[value] || value;

	onMount(() => {
		if (form?.toast) {
			pushToast(form.toast);
		}
	});
</script>
<svelte:head>
	<title>{$t('admin.users.detailTitle')} | Admin</title>
</svelte:head>

<section>
	<a class="btn btn-link mb-3" href="/admin/users">{$t('admin.users.back')}</a>
	<h2 class="mb-4">{$t('admin.users.detailTitle')}</h2>

	{#if loadError}
		<div class="alert alert-danger">{loadError}</div>
	{/if}

	{#if user}
		<div class="border rounded-3 p-4 bg-white">
			<div class="row g-3">
				<div class="col-md-6">
					<div class="text-black-50 small">{$t('admin.users.name')}</div>
					<div class="fw-semibold">{user.name}</div>
				</div>
				<div class="col-md-6">
					<div class="text-black-50 small">{$t('admin.users.email')}</div>
					<div class="fw-semibold">{user.email}</div>
				</div>
				<div class="col-md-6">
					<div class="text-black-50 small">{$t('admin.users.statusLabel')}</div>
					<div class="fw-semibold">{resolveStatusLabel(user.status)}</div>
				</div>
				<div class="col-md-6">
					<div class="text-black-50 small">{$t('admin.users.roles')}</div>
					<div class="fw-semibold">{Array.isArray(user.roles) ? user.roles.join(', ') : user.roles}</div>
				</div>
				<div class="col-md-6">
					<div class="text-black-50 small">{$locale === 'en' ? 'Phone' : 'Số điện thoại'}</div>
					<div class="fw-semibold">{user.phone || '—'}</div>
				</div>
				<div class="col-md-6">
					<div class="text-black-50 small">{$locale === 'en' ? 'Email verified' : 'Đã xác minh email'}</div>
					<div class="fw-semibold">{formatBool(Boolean(user.verify))}</div>
				</div>
				<div class="col-md-6">
					<div class="text-black-50 small">{$locale === 'en' ? 'Preferred language' : 'Ngôn ngữ ưu tiên'}</div>
					<div class="fw-semibold">{localeLabel(user.preferredLocale)}</div>
				</div>
				<div class="col-md-6">
					<div class="text-black-50 small">ID</div>
					<div class="fw-semibold text-break">{user._id}</div>
				</div>
				<div class="col-md-6">
					<div class="text-black-50 small">{$locale === 'en' ? 'Created at' : 'Ngày tạo'}</div>
					<div class="fw-semibold">{formatDate(user.createdAt)}</div>
				</div>
				<div class="col-md-6">
					<div class="text-black-50 small">{$locale === 'en' ? 'Updated at' : 'Cập nhật gần nhất'}</div>
					<div class="fw-semibold">{formatDate(user.updatedAt)}</div>
				</div>
			</div>

			<form method="post" action="?/updateStatus" class="mt-4 d-flex gap-2 align-items-end">
				<div>
					<label class="form-label" for="admin-user-status">{$t('admin.users.updateStatus')}</label>
					<select class="form-select" id="admin-user-status" name="status">
						{#each statusOptions as option}
							<option value={option.value}>{option.label}</option>
						{/each}
					</select>
				</div>
				<button class="btn btn-dark" type="submit">{$t('admin.users.save')}</button>
			</form>

			<div class="mt-4 pt-4 border-top">
				<h3 class="h6 mb-3">{$locale === 'en' ? 'Security actions' : 'Thao tác bảo mật'}</h3>
				<div class="d-flex flex-wrap gap-2">
					<form method="post" action="?/sendResetPassword">
						<button class="btn btn-outline-dark" type="submit">{resetActionLabel}</button>
					</form>
					<form method="post" action="?/deleteUser">
						<button
							class="btn btn-outline-danger"
							type="submit"
							onclick={(event) => {
								if (!confirm(confirmDeleteText)) event.preventDefault();
							}}
						>
							{deleteActionLabel}
						</button>
					</form>
				</div>
				<p class="small text-black-50 mt-2 mb-0">{deleteActionHint}</p>
			</div>
		</div>

		<div class="border rounded-3 p-4 bg-white mt-3">
			<div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
				<h3 class="h6 mb-0">{$locale === 'en' ? 'Customer telemetry' : 'Hành vi truy cập khách hàng'}</h3>
				<span class="badge text-bg-light border">
					{$locale === 'en' ? 'Admin insight' : 'Phân tích nội bộ'}
				</span>
			</div>

			{#if telemetry}
				<div class="row g-3">
					<div class="col-md-6">
						<div class="text-black-50 small">IP</div>
						<div class="fw-semibold text-break">{telemetry.lastIp || telemetry.ip || '—'}</div>
					</div>
					<div class="col-md-6">
						<div class="text-black-50 small">{$locale === 'en' ? 'Last seen' : 'Truy cập gần nhất'}</div>
						<div class="fw-semibold">{formatDate(telemetry.lastSeenAt || telemetry.lastSeen)}</div>
					</div>
					<div class="col-md-4">
						<div class="text-black-50 small">{$locale === 'en' ? 'Clicks' : 'Số lượt click'}</div>
						<div class="fw-semibold">{telemetry.clickCount ?? telemetry.clicks ?? '—'}</div>
					</div>
					<div class="col-md-4">
						<div class="text-black-50 small">{$locale === 'en' ? 'Scroll depth' : 'Độ sâu cuộn'}</div>
						<div class="fw-semibold">
							{telemetry.maxScrollDepthPercent ?? telemetry.scrollDepthPercent ?? '—'}
							{#if telemetry.maxScrollDepthPercent || telemetry.scrollDepthPercent}%{/if}
						</div>
					</div>
					<div class="col-md-4">
						<div class="text-black-50 small">{$locale === 'en' ? 'Time on site' : 'Thời gian trên web'}</div>
						<div class="fw-semibold">
							{telemetry.totalTimeSeconds ?? telemetry.totalDurationSeconds ?? '—'}
							{#if telemetry.totalTimeSeconds || telemetry.totalDurationSeconds}s{/if}
						</div>
					</div>
				</div>

				<div class="mt-3">
					<div class="text-black-50 small mb-2">
						{$locale === 'en' ? 'Viewed products / recommended push list' : 'Sản phẩm đã xem / gợi ý nên đẩy'}
					</div>
					{#if viewedProducts.length}
						<div class="d-flex flex-wrap gap-2">
							{#each viewedProducts as item}
								<span class="badge text-bg-light border">
									{item?.name || item?.product_name || item?.title || item?.slug || item?._id || item}
								</span>
							{/each}
						</div>
					{:else}
						<div class="text-black-50 small">
							{$locale === 'en'
								? 'No viewed-product telemetry captured yet.'
								: 'Chưa có dữ liệu sản phẩm đã xem để gợi ý.'}
						</div>
					{/if}
				</div>

				<div class="row g-3 mt-1">
					<div class="col-lg-6">
						<div class="text-black-50 small mb-2">
							{$locale === 'en' ? 'Suggested products to push' : 'Gợi ý sản phẩm nên đẩy'}
						</div>
						{#if recommendedProducts.length}
							<div class="list-group list-group-flush border rounded-3 overflow-hidden">
								{#each recommendedProducts as item}
									<div class="list-group-item">
										<div class="fw-semibold">
											{item?.name || item?.product_name || item?.slug || item?._id || '—'}
										</div>
										<div class="small text-black-50 d-flex flex-wrap gap-2">
											<span>{$locale === 'en' ? 'Views' : 'Lượt xem'}: {item?.count ?? item?.views ?? '—'}</span>
											{#if item?.reason}<span>• {item.reason}</span>{/if}
										</div>
									</div>
								{/each}
							</div>
						{:else}
							<div class="text-black-50 small">
								{$locale === 'en'
									? 'No recommendation candidates yet (need product-view events).'
									: 'Chưa có gợi ý (cần dữ liệu xem sản phẩm).'}
							</div>
						{/if}
					</div>

					<div class="col-lg-6">
						<div class="text-black-50 small mb-2">
							{$locale === 'en' ? 'Daily time on site (30 days)' : 'Thời gian truy cập theo ngày (30 ngày)'}
						</div>
						{#if dailyActiveTime.length}
							<div class="list-group list-group-flush border rounded-3 overflow-hidden">
								{#each dailyActiveTime as item}
									<div class="list-group-item d-flex justify-content-between gap-3 align-items-center">
										<div class="fw-semibold">{item?.date || '—'}</div>
										<div class="small text-black-50 text-end">
											<div>{formatDuration(item?.totalDurationSeconds)}</div>
											<div>{$locale === 'en' ? 'Events' : 'Su kien'}: {item?.eventCount ?? 0}</div>
										</div>
									</div>
								{/each}
							</div>
						{:else}
							<div class="text-black-50 small">
								{$locale === 'en' ? 'No daily time data yet.' : 'Chưa có dữ liệu thời gian theo ngày.'}
							</div>
						{/if}
					</div>
				</div>

				<div class="row g-3 mt-1">
					<div class="col-lg-6">
						<div class="text-black-50 small mb-2">{$locale === 'en' ? 'Recent clicks' : 'Click gần đây'}</div>
						{#if recentClicks.length}
							<div class="list-group list-group-flush border rounded-3 overflow-hidden">
								{#each recentClicks as item}
									<div class="list-group-item">
										<div class="fw-semibold text-break">
											{item?.label || item?.trackName || item?.href || '—'}
										</div>
										<div class="small text-black-50 text-break">
											{item?.path || '—'}{#if item?.href}<span> • {item.href}</span>{/if}
										</div>
										<div class="small text-black-50">{formatDate(item?.at)}</div>
									</div>
								{/each}
							</div>
						{:else}
							<div class="text-black-50 small">
								{$locale === 'en' ? 'No click events yet.' : 'Chưa có dữ liệu click.'}
							</div>
						{/if}
					</div>

					<div class="col-lg-6">
						<div class="text-black-50 small mb-2">
							{$locale === 'en' ? 'Visited pages (recent)' : 'Trang đã truy cập (gần đây)'}
						</div>
						{#if visitedPaths.length}
							<div class="list-group list-group-flush border rounded-3 overflow-hidden">
								{#each visitedPaths as item}
									<div class="list-group-item d-flex justify-content-between gap-3">
										<div class="fw-semibold text-break">{item?.path || '—'}</div>
										<div class="small text-black-50 text-end">
											<div>x{item?.count ?? 0}</div>
											<div>{formatDate(item?.lastSeenAt)}</div>
										</div>
									</div>
								{/each}
							</div>
						{:else}
							<div class="text-black-50 small">
								{$locale === 'en' ? 'No page history captured yet.' : 'Chưa có lịch sử trang truy cập.'}
							</div>
						{/if}
					</div>
				</div>
			{:else}
				<div class="alert alert-light border mb-0">
					<div class="fw-semibold mb-1">{telemetryUnavailableTitle}</div>
					<div class="small text-black-50">{telemetryUnavailableDesc}</div>
				</div>
			{/if}
		</div>
	{:else}
		<p class="text-black-50">{$t('admin.users.notFound')}</p>
	{/if}
</section>
