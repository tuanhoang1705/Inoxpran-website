<script>
	import { enhance } from '$app/forms';
	import { locale, t } from '$lib/i18n/admin/index.js';

	let { data } = $props();

	const users = $derived(Array.isArray(data?.users) ? data.users : []);
	const anonymousVisitors = $derived(
		Array.isArray(data?.anonymousVisitors) ? data.anonymousVisitors : []
	);
	const adminAccounts = $derived(Array.isArray(data?.adminAccounts) ? data.adminAccounts : []);
	const adminAuditLogs = $derived(Array.isArray(data?.adminAuditLogs) ? data.adminAuditLogs : []);
	const canManageAdminAccounts = $derived(Boolean(data?.canManageAdminAccounts));
	const adminAccountsApiError = $derived(data?.adminAccountsApiError || '');
	const adminAuditLogsApiError = $derived(data?.adminAuditLogsApiError || '');
	const returnTo = $derived(data?.returnTo || '/admin/users');

	const pagination = $derived(
		data?.pagination || {
			page: 1,
			limit: 20,
			total: users.length,
			totalPages: 1,
			hasPrevPage: false,
			hasNextPage: false
		}
	);
	const anonymousPagination = $derived(
		data?.anonymousPagination || {
			page: 1,
			limit: 20,
			total: anonymousVisitors.length,
			totalPages: 1,
			hasPrevPage: false,
			hasNextPage: false
		}
	);
	const adminAccountsPagination = $derived(
		data?.adminAccountsPagination || {
			page: 1,
			limit: 10,
			total: adminAccounts.length,
			totalPages: 1,
			hasPrevPage: false,
			hasNextPage: false
		}
	);

	const currentPage = $derived(Math.max(Number(pagination.page) || 1, 1));
	const totalPages = $derived(Math.max(Number(pagination.totalPages) || 1, 1));
	const currentLimit = $derived(Math.max(Number(pagination.limit) || 20, 1));
	const activeStatus = $derived(String(data?.filters?.status || ''));

	const anonCurrentPage = $derived(Math.max(Number(anonymousPagination.page) || 1, 1));
	const anonTotalPages = $derived(Math.max(Number(anonymousPagination.totalPages) || 1, 1));
	const anonCurrentLimit = $derived(Math.max(Number(anonymousPagination.limit) || 20, 1));
	const anonMapped = $derived(String(data?.anonymousFilters?.mapped || ''));
	const adminCurrentPage = $derived(Math.max(Number(adminAccountsPagination.page) || 1, 1));
	const adminTotalPages = $derived(Math.max(Number(adminAccountsPagination.totalPages) || 1, 1));
	const adminCurrentLimit = $derived(Math.max(Number(adminAccountsPagination.limit) || 10, 1));
	const adminStatus = $derived(String(data?.adminAccountsFilters?.status || ''));
	const adminQuery = $derived(String(data?.adminAccountsFilters?.q || ''));

	const pageNumbers = $derived.by(() => {
		const numbers = [];
		const start = Math.max(1, currentPage - 2);
		const end = Math.min(totalPages, currentPage + 2);
		for (let page = start; page <= end; page += 1) numbers.push(page);
		return numbers;
	});
	const anonPageNumbers = $derived.by(() => {
		const numbers = [];
		const start = Math.max(1, anonCurrentPage - 2);
		const end = Math.min(anonTotalPages, anonCurrentPage + 2);
		for (let page = start; page <= end; page += 1) numbers.push(page);
		return numbers;
	});
	const adminPageNumbers = $derived.by(() => {
		const numbers = [];
		const start = Math.max(1, adminCurrentPage - 2);
		const end = Math.min(adminTotalPages, adminCurrentPage + 2);
		for (let page = start; page <= end; page += 1) numbers.push(page);
		return numbers;
	});

	const paginationSummary = $derived(
		$locale === 'en'
			? `Showing ${users.length} / ${pagination.total || 0} users`
			: `Hiển thị ${users.length} / ${pagination.total || 0} người dùng`
	);
	const anonymousPaginationSummary = $derived(
		$locale === 'en'
			? `Showing ${anonymousVisitors.length} / ${anonymousPagination.total || 0} anonymous visitors`
			: `Hiển thị ${anonymousVisitors.length} / ${anonymousPagination.total || 0} khách lạ`
	);
	const adminAccountsPaginationSummary = $derived(
		$locale === 'en'
			? `Showing ${adminAccounts.length} / ${adminAccountsPagination.total || 0} admin accounts`
			: `Hiển thị ${adminAccounts.length} / ${adminAccountsPagination.total || 0} tài khoản admin`
	);

	const buildBaseParams = () => {
		const params = new URLSearchParams();
		params.set('page', String(currentPage));
		params.set('limit', String(currentLimit));
		if (activeStatus) params.set('status', activeStatus);
		params.set('anonPage', String(anonCurrentPage));
		params.set('anonLimit', String(anonCurrentLimit));
		if (anonMapped) params.set('anonMapped', anonMapped);
		params.set('adminPage', String(adminCurrentPage));
		params.set('adminLimit', String(adminCurrentLimit));
		if (adminStatus) params.set('adminStatus', adminStatus);
		if (adminQuery) params.set('adminQ', adminQuery);
		return params;
	};

	const buildPageHref = (page) => {
		const params = buildBaseParams();
		params.set('page', String(Math.max(1, page)));
		return `/admin/users?${params.toString()}`;
	};

	const buildAnonymousPageHref = (page) => {
		const params = buildBaseParams();
		params.set('anonPage', String(Math.max(1, page)));
		return `/admin/users?${params.toString()}`;
	};
	const buildAdminPageHref = (page) => {
		const params = buildBaseParams();
		params.set('adminPage', String(Math.max(1, page)));
		return `/admin/users?${params.toString()}`;
	};

	const statusOptions = $derived([
		{ value: '', label: $t('admin.users.statusAll') },
		{ value: 'active', label: $t('admin.users.status.active') },
		{ value: 'inactive', label: $t('admin.users.status.inactive') },
		{ value: 'blocked', label: $t('admin.users.status.blocked') }
	]);
	const adminAccountStatusOptions = $derived(
		$locale === 'en'
			? [
					{ value: '', label: 'All statuses' },
					{ value: 'active', label: 'Active' },
					{ value: 'inactive', label: 'Inactive' },
					{ value: 'blocked', label: 'Blocked' },
					{ value: 'pending', label: 'Pending' }
				]
			: [
					{ value: '', label: 'Tất cả trạng thái' },
					{ value: 'active', label: 'Hoạt động' },
					{ value: 'inactive', label: 'Tạm ngưng' },
					{ value: 'blocked', label: 'Bị khóa' },
					{ value: 'pending', label: 'Chờ duyệt' }
				]
	);
	const adminRoleOptions = $derived(
		$locale === 'en'
			? [
					{ value: 'ADMIN', label: 'Admin' },
					{ value: 'SUPER_ADMIN', label: 'Root / Super admin' },
					// Hidden with admin chat rooms by request.
					// { value: 'CHAT_MANAGER', label: 'Chat manager' },
					{ value: 'LEAD_MANAGER', label: 'Lead manager' },
					{ value: 'CONTACT_MANAGER', label: 'Contact manager' },
					{ value: 'SLIDE_MANAGER', label: 'Slide manager' }
				]
			: [
					{ value: 'ADMIN', label: 'Quản trị' },
					{ value: 'SUPER_ADMIN', label: 'Root / Super admin' },
					// Hidden with admin chat rooms by request.
					// { value: 'CHAT_MANAGER', label: 'Quản lý chatbox' },
					{ value: 'LEAD_MANAGER', label: 'Quản lý lead' },
					{ value: 'CONTACT_MANAGER', label: 'Quản lý liên hệ' },
					{ value: 'SLIDE_MANAGER', label: 'Quản lý slide' }
				]
	);

	const anonymousMappedOptions = $derived([
		{ value: '', label: $locale === 'en' ? 'All visitors' : 'Tất cả khách lạ' },
		{ value: 'unmapped', label: $locale === 'en' ? 'Unmapped only' : 'Chưa map' },
		{ value: 'mapped', label: $locale === 'en' ? 'Mapped to users' : 'Đã map sang tài khoản' }
	]);

	const statusLabels = $derived({
		active: $t('admin.users.status.active'),
		inactive: $t('admin.users.status.inactive'),
		blocked: $t('admin.users.status.blocked')
	});
	const adminStatusLabels = $derived(
		$locale === 'en'
			? {
					active: 'Active',
					inactive: 'Inactive',
					blocked: 'Blocked',
					pending: 'Pending'
				}
			: {
					active: 'Hoạt động',
					inactive: 'Tạm ngưng',
					blocked: 'Bị khóa',
					pending: 'Chờ duyệt'
				}
	);

	const resolveStatusLabel = (value) => statusLabels[value] || value;
	const resolveStatusTone = (value) => {
		if (value === 'active') return 'success';
		if (value === 'inactive') return 'warning';
		if (value === 'blocked') return 'danger';
		return 'secondary';
	};
	const resolveAdminStatusLabel = (value) => adminStatusLabels[value] || value;
	const resolveAdminStatusTone = (value) => {
		if (value === 'active') return 'success';
		if (value === 'inactive') return 'warning';
		if (value === 'blocked') return 'danger';
		return 'secondary';
	};
	const resolveAdminAuditActionLabel = (action) => {
		if (action === 'admin_account.roles_updated') {
			return $locale === 'en' ? 'Roles updated' : 'Đổi quyền';
		}
		if (action === 'admin_account.status_updated') {
			return $locale === 'en' ? 'Status updated' : 'Đổi trạng thái';
		}
		if (action === 'admin_account.routing_updated') {
			return $locale === 'en' ? 'Routing updated' : 'Đổi định tuyến CSKH';
		}
		if (action === 'admin_account.deleted') {
			return $locale === 'en' ? 'Account deleted' : 'Đã xóa tài khoản';
		}
		return action || '—';
	};
	const resolveAdminAuditActionTone = (action) => {
		if (action === 'admin_account.deleted') return 'danger';
		if (action === 'admin_account.status_updated') return 'warning';
		if (action === 'admin_account.routing_updated') return 'info';
		return 'info';
	};

	const formatDate = (value) => {
		if (!value) return '—';
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return '—';
		return date.toLocaleString($locale === 'en' ? 'en-US' : 'vi-VN');
	};

	const formatDuration = (seconds) => {
		const total = Math.max(Number(seconds) || 0, 0);
		if (total <= 0) return '0m';
		const hours = Math.floor(total / 3600);
		const minutes = Math.round((total % 3600) / 60);
		if (hours <= 0) return `${minutes}m`;
		return `${hours}h ${minutes}m`;
	};

	const resolveUserMappedIp = (user) =>
		user?.telemetrySummary?.lastIp || user?.lastLoginIp || user?.telemetryIdentity?.lastMappedIp || '—';

	const resolveUserMapText = (user) => {
		const mappedCount =
			Number(user?.telemetrySummary?.anonymousMappedSessions) ||
			Number(user?.telemetryIdentity?.mappedSessionsCount) ||
			0;
		if (mappedCount <= 0) return $locale === 'en' ? 'No mapping yet' : 'Chưa map';
		return $locale === 'en'
			? `${mappedCount} anonymous session(s)`
			: `${mappedCount} phiên khách lạ`;
	};

	const resolveVisitorCardTone = (visitor) => (visitor?.user ? 'mapped' : 'unmapped');
	const resolveVisitorLink = (visitor) =>
		visitor?.user?._id ? `/admin/users/${visitor.user._id}` : `/admin/users/anonymous/${visitor.sessionId}`;
	const resolveVisitorLinkLabel = (visitor) =>
		visitor?.user?._id
			? $locale === 'en'
				? 'Open user'
				: 'Mở tài khoản'
			: $locale === 'en'
				? 'Open detail'
				: 'Xem chi tiết';
	const resolveVisitorMapLine = (visitor) => {
		if (!visitor?.mappedUserAt) return $locale === 'en' ? 'Anonymous only' : 'Chỉ khách lạ';
		return $locale === 'en'
			? `Mapped via ${visitor.mappedUserStrategy || 'n/a'}`
			: `Đã map qua ${visitor.mappedUserStrategy || 'n/a'}`;
	};
	const isRootAdmin = (admin) => Boolean(admin?.isConfiguredRoot);
	const adminRoleChecked = (admin, role) =>
		Array.isArray(admin?.roles) ? admin.roles.includes(role) : false;
</script>

<svelte:head>
	<title>{$t('admin.users.title')} | Inoxpran</title>
</svelte:head>

<section class="admin-users-page">
	<div class="page-head card-shell">
		<div class="page-head__title">
			<h2 class="mb-0">{$t('admin.users.title')}</h2>
			<p class="mb-0 text-black-50 small">
				{$locale === 'en'
					? 'Manage registered users and anonymous visitor tracking mapping.'
					: 'Quản lý người dùng đã đăng ký và đối chiếu dữ liệu khách lạ (anonymous) với tài khoản.'}
			</p>
		</div>
		<form method="get" class="toolbar-form">
			<select class="form-select" name="status" value={activeStatus}>
				{#each statusOptions as option}
					<option value={option.value} selected={option.value === activeStatus}>{option.label}</option>
				{/each}
			</select>
			<input type="hidden" name="page" value="1" />
			<input type="hidden" name="limit" value={currentLimit} />
			<input type="hidden" name="anonPage" value={anonCurrentPage} />
			<input type="hidden" name="anonLimit" value={anonCurrentLimit} />
			{#if anonMapped}
				<input type="hidden" name="anonMapped" value={anonMapped} />
			{/if}
			<button class="btn btn-outline-dark" type="submit">{$t('admin.users.filter')}</button>
		</form>
	</div>

	{#if data?.apiError}
		<div class="alert alert-danger">{data.apiError}</div>
	{/if}
	{#if data?.anonymousApiError}
		<div class="alert alert-warning">{data.anonymousApiError}</div>
	{/if}
	{#if data?.deleted}
		<div class="alert alert-success">
			{$locale === 'en' ? 'User deleted successfully.' : 'Đã xóa người dùng thành công.'}
		</div>
	{/if}
	{#if data?.adminDeleted}
		<div class="alert alert-success">
			{$locale === 'en' ? 'Admin account deleted successfully.' : 'Đã xóa tài khoản admin thành công.'}
		</div>
	{/if}

	<div class="card-shell section-panel">
		<div class="section-panel__head">
			<div>
				<div class="section-panel__title">{$t('admin.users.title')}</div>
				<div class="text-black-50 small">{paginationSummary}</div>
			</div>
			<div class="text-black-50 small">
				{$locale === 'en' ? 'Page' : 'Trang'} {currentPage} / {totalPages}
			</div>
		</div>

		{#if users.length}
			<div class="card-list card-list--users">
				{#each users as user}
					<article class="entity-card">
						<div class="entity-card__top">
							<div class="entity-card__identity">
								<h3 class="entity-card__title">{user.name}</h3>
								<div class="entity-card__sub break-anywhere">{user.email}</div>
							</div>
							<div class="entity-card__actions">
								<span class={`badge text-bg-${resolveStatusTone(user.status)}`}>
									{resolveStatusLabel(user.status)}
								</span>
								<a class="btn btn-sm btn-outline-dark" href={`/admin/users/${user._id}`}>
									{$t('admin.users.view')}
								</a>
							</div>
						</div>

						<div class="entity-card__grid">
							<div class="entity-meta-block">
								<div class="entity-meta-block__label">{$t('admin.users.roles')}</div>
								<div class="entity-meta-block__value break-anywhere">
									{Array.isArray(user.roles) ? user.roles.join(', ') : user.roles || '—'}
								</div>
							</div>
							<div class="entity-meta-block">
								<div class="entity-meta-block__label">
									{$locale === 'en' ? 'Mapped IP / telemetry' : 'IP map / telemetry'}
								</div>
								<div class="entity-meta-block__value break-anywhere">{resolveUserMappedIp(user)}</div>
								<div class="entity-meta-block__hint">{resolveUserMapText(user)}</div>
							</div>
							<div class="entity-meta-block entity-meta-block--compact">
								<div class="entity-meta-block__label">
									{$locale === 'en' ? 'Login count' : 'Số lần đăng nhập'}
								</div>
								<div class="entity-meta-block__value">{Number(user.loginCount) || 0}</div>
							</div>
							<div class="entity-meta-block">
								<div class="entity-meta-block__label">
									{$locale === 'en' ? 'Created' : 'Ngày tạo'}
								</div>
								<div class="entity-meta-block__value">{formatDate(user.createdAt)}</div>
							</div>
						</div>
					</article>
				{/each}
			</div>
		{:else}
			<div class="empty-state">{$t('admin.users.empty')}</div>
		{/if}
	</div>

	{#if totalPages > 1}
		<nav class="pagination-bar" aria-label="Users pagination">
			<a
				class="btn btn-sm btn-outline-dark"
				href={buildPageHref(currentPage - 1)}
				aria-disabled={!pagination.hasPrevPage}
				class:disabled={!pagination.hasPrevPage}
			>
				{$locale === 'en' ? 'Previous' : 'Trước'}
			</a>
			{#each pageNumbers as pageNumber}
				<a
					class="btn btn-sm"
					class:btn-dark={pageNumber === currentPage}
					class:btn-outline-dark={pageNumber !== currentPage}
					href={buildPageHref(pageNumber)}
					aria-current={pageNumber === currentPage ? 'page' : undefined}
				>
					{pageNumber}
				</a>
			{/each}
			<a
				class="btn btn-sm btn-outline-dark"
				href={buildPageHref(currentPage + 1)}
				aria-disabled={!pagination.hasNextPage}
				class:disabled={!pagination.hasNextPage}
			>
				{$locale === 'en' ? 'Next' : 'Sau'}
			</a>
		</nav>
	{/if}

	{#if canManageAdminAccounts}
		<div class="card-shell section-panel">
			<div class="section-panel__head section-panel__head--stack-mobile">
				<div>
					<div class="section-panel__title">
						{$locale === 'en' ? 'Admin accounts' : 'Tài khoản admin'}
					</div>
					<div class="text-black-50 small">{adminAccountsPaginationSummary}</div>
				</div>
				<form method="get" class="toolbar-form">
					<input
						class="form-control"
						type="search"
						name="adminQ"
						value={adminQuery}
						placeholder={$locale === 'en'
							? 'Search by name, email, phone...'
							: 'Tìm theo tên, email, số điện thoại...'}
					/>
					<select class="form-select" name="adminStatus" value={adminStatus}>
						{#each adminAccountStatusOptions as option}
							<option value={option.value} selected={option.value === adminStatus}>{option.label}</option>
						{/each}
					</select>
					<input type="hidden" name="page" value={currentPage} />
					<input type="hidden" name="limit" value={currentLimit} />
					{#if activeStatus}
						<input type="hidden" name="status" value={activeStatus} />
					{/if}
					<input type="hidden" name="anonPage" value={anonCurrentPage} />
					<input type="hidden" name="anonLimit" value={anonCurrentLimit} />
					{#if anonMapped}
						<input type="hidden" name="anonMapped" value={anonMapped} />
					{/if}
					<input type="hidden" name="adminPage" value="1" />
					<input type="hidden" name="adminLimit" value={adminCurrentLimit} />
					<button class="btn btn-outline-dark" type="submit">{$t('admin.users.filter')}</button>
				</form>
			</div>

			{#if adminAccountsApiError}
				<div class="alert alert-warning mx-3 mt-3 mb-0">{adminAccountsApiError}</div>
			{/if}

			{#if adminAccounts.length}
				<div class="card-list card-list--admins">
					{#each adminAccounts as admin}
						<article class="entity-card entity-card--admin">
							<div class="entity-card__top">
								<div class="entity-card__identity">
									<h3 class="entity-card__title">{admin.name}</h3>
									<div class="entity-card__sub break-anywhere">{admin.email}</div>
								</div>
								<div class="entity-card__actions">
									<span class={`badge text-bg-${resolveAdminStatusTone(admin.status)}`}>
										{resolveAdminStatusLabel(admin.status)}
									</span>
									{#if isRootAdmin(admin)}
										<span class="badge text-bg-dark">
											{$locale === 'en' ? 'Root account' : 'Tài khoản root'}
										</span>
									{/if}
								</div>
							</div>

							<form method="post" action="?/updateAdminAccount" class="admin-account-form" use:enhance>
								<input type="hidden" name="adminId" value={admin._id} />
								<input type="hidden" name="returnTo" value={returnTo} />

								<div class="entity-card__grid">
									<div class="entity-meta-block">
										<div class="entity-meta-block__label">
											{$locale === 'en' ? 'Status' : 'Trạng thái'}
										</div>
										<select class="form-select mt-2" name="status">
											{#each adminAccountStatusOptions.slice(1) as option}
												<option
													value={option.value}
													selected={option.value === admin.status}
													disabled={isRootAdmin(admin) && option.value !== 'active'}
												>
													{option.label}
												</option>
											{/each}
										</select>
									</div>

									<div class="entity-meta-block entity-meta-block--roles">
										<div class="entity-meta-block__label">
											{$locale === 'en' ? 'Roles / permissions' : 'Vai trò / quyền hạn'}
										</div>
										<div class="admin-role-grid mt-2">
											{#each adminRoleOptions as role}
												<label class="admin-role-option">
													<input
														type="checkbox"
														name="roles"
														value={role.value}
														checked={adminRoleChecked(admin, role.value)}
														disabled={isRootAdmin(admin) && role.value === 'SUPER_ADMIN'}
													/>
													<span>{role.label}</span>
												</label>
											{/each}
										</div>
									</div>

									<div class="entity-meta-block">
										<div class="entity-meta-block__label">
											{$locale === 'en' ? 'Created' : 'Ngày tạo'}
										</div>
										<div class="entity-meta-block__value">{formatDate(admin.createdAt)}</div>
										<div class="entity-meta-block__hint">
											{$locale === 'en' ? 'Updated' : 'Cập nhật'}: {formatDate(admin.updatedAt)}
										</div>
									</div>
								</div>

								<div class="admin-account-actions mt-3">
									<button class="btn btn-dark btn-sm" type="submit">
										{$locale === 'en' ? 'Save admin account' : 'Lưu tài khoản admin'}
									</button>
									{#if isRootAdmin(admin)}
										<div class="small text-black-50">
											{$locale === 'en'
												? 'This root account is protected from disable/delete actions.'
												: 'Tài khoản root này được bảo vệ, không thể khóa hoặc xóa.'}
										</div>
									{/if}
								</div>
							</form>

							<div class="admin-account-danger">
								<form method="post" action="?/deleteAdminAccount" use:enhance>
									<input type="hidden" name="adminId" value={admin._id} />
									<input type="hidden" name="returnTo" value={returnTo} />
									<button
										class="btn btn-outline-danger btn-sm"
										type="submit"
										disabled={isRootAdmin(admin)}
										onclick={(event) => {
											const confirmed = confirm(
												$locale === 'en'
													? 'Delete this admin account permanently?'
													: 'Xóa vĩnh viễn tài khoản admin này?'
											);
											if (!confirmed) event.preventDefault();
										}}
									>
										{$locale === 'en' ? 'Delete admin account' : 'Xóa tài khoản admin'}
									</button>
								</form>
							</div>
						</article>
					{/each}
				</div>
			{:else}
				<div class="empty-state">
					{$locale === 'en' ? 'No admin accounts found.' : 'Không tìm thấy tài khoản admin nào.'}
				</div>
			{/if}
		</div>

		{#if adminTotalPages > 1}
			<nav class="pagination-bar" aria-label="Admin accounts pagination">
				<a
					class="btn btn-sm btn-outline-dark"
					href={buildAdminPageHref(adminCurrentPage - 1)}
					aria-disabled={!adminAccountsPagination.hasPrevPage}
					class:disabled={!adminAccountsPagination.hasPrevPage}
				>
					{$locale === 'en' ? 'Previous' : 'Trước'}
				</a>
				{#each adminPageNumbers as pageNumber}
					<a
						class="btn btn-sm"
						class:btn-dark={pageNumber === adminCurrentPage}
						class:btn-outline-dark={pageNumber !== adminCurrentPage}
						href={buildAdminPageHref(pageNumber)}
						aria-current={pageNumber === adminCurrentPage ? 'page' : undefined}
					>
						{pageNumber}
					</a>
				{/each}
				<a
					class="btn btn-sm btn-outline-dark"
					href={buildAdminPageHref(adminCurrentPage + 1)}
					aria-disabled={!adminAccountsPagination.hasNextPage}
					class:disabled={!adminAccountsPagination.hasNextPage}
				>
					{$locale === 'en' ? 'Next' : 'Sau'}
				</a>
			</nav>
		{/if}

		<div class="card-shell section-panel">
			<div class="section-panel__head">
				<div>
					<div class="section-panel__title">
						{$locale === 'en' ? 'Admin audit log' : 'Nhật ký audit admin'}
					</div>
					<div class="text-black-50 small">
						{$locale === 'en'
							? 'Recent actions: role changes, account lock/disable, delete.'
							: 'Ghi lại các thao tác gần đây: đổi quyền, khóa/vô hiệu hóa, xóa tài khoản.'}
					</div>
				</div>
			</div>

			{#if adminAuditLogsApiError}
				<div class="alert alert-warning mx-3 mt-3 mb-0">{adminAuditLogsApiError}</div>
			{/if}

			{#if adminAuditLogs.length}
				<div class="audit-log-list">
					{#each adminAuditLogs as log}
						<article class="audit-log-card">
							<div class="audit-log-card__top">
								<div>
									<div class="audit-log-card__title">{log.summary}</div>
									<div class="audit-log-card__meta">
										{$locale === 'en' ? 'Time' : 'Thời gian'}: {formatDate(log.createdAt)}
									</div>
								</div>
								<span class={`badge text-bg-${resolveAdminAuditActionTone(log.action)}`}>
									{resolveAdminAuditActionLabel(log.action)}
								</span>
							</div>

							<div class="audit-log-card__grid">
								<div class="entity-meta-block">
									<div class="entity-meta-block__label">{$locale === 'en' ? 'Actor' : 'Người thực hiện'}</div>
									<div class="entity-meta-block__value break-anywhere">
										{log.actorSnapshot?.name || '—'}
									</div>
									<div class="entity-meta-block__hint break-anywhere">
										{log.actorSnapshot?.email || '—'}
									</div>
								</div>
								<div class="entity-meta-block">
									<div class="entity-meta-block__label">{$locale === 'en' ? 'Target' : 'Tài khoản bị tác động'}</div>
									<div class="entity-meta-block__value break-anywhere">
										{log.targetSnapshot?.name || '—'}
									</div>
									<div class="entity-meta-block__hint break-anywhere">
										{log.targetSnapshot?.email || '—'}
									</div>
								</div>
							</div>

							{#if log.metadata?.previousRoles || log.metadata?.nextRoles || log.metadata?.previousStatus || log.metadata?.nextStatus || log.metadata?.previousRouting || log.metadata?.nextRouting}
								<div class="audit-log-diff">
									{#if log.metadata?.previousRoles || log.metadata?.nextRoles}
										<div class="audit-log-diff__row">
											<span class="audit-log-diff__label">
												{$locale === 'en' ? 'Roles' : 'Quyền'}
											</span>
											<span class="audit-log-diff__value break-anywhere">
												{(log.metadata?.previousRoles || []).join(', ') || '—'}
												<span class="audit-log-diff__arrow">→</span>
												{(log.metadata?.nextRoles || []).join(', ') || '—'}
											</span>
										</div>
									{/if}
									{#if log.metadata?.previousStatus || log.metadata?.nextStatus}
										<div class="audit-log-diff__row">
											<span class="audit-log-diff__label">
												{$locale === 'en' ? 'Status' : 'Trạng thái'}
											</span>
											<span class="audit-log-diff__value break-anywhere">
												{log.metadata?.previousStatus || '—'}
												<span class="audit-log-diff__arrow">→</span>
												{log.metadata?.nextStatus || '—'}
											</span>
										</div>
									{/if}
									{#if log.metadata?.previousRouting || log.metadata?.nextRouting}
										<div class="audit-log-diff__row">
											<span class="audit-log-diff__label">
												{$locale === 'en' ? 'Routing' : 'Định tuyến'}
											</span>
											<span class="audit-log-diff__value break-anywhere">
												{log.metadata?.previousRouting?.enabled ? 'enabled' : 'disabled'}
												{#if log.metadata?.previousRouting?.autoAssign}
													<span> · auto</span>
												{/if}
												{#if log.metadata?.previousRouting?.shiftEnabled}
													<span> · {log.metadata.previousRouting.shiftStart || '--'}-{log.metadata.previousRouting.shiftEnd || '--'}</span>
												{/if}
												<span class="audit-log-diff__arrow">→</span>
												{log.metadata?.nextRouting?.enabled ? 'enabled' : 'disabled'}
												{#if log.metadata?.nextRouting?.autoAssign}
													<span> · auto</span>
												{/if}
												{#if log.metadata?.nextRouting?.shiftEnabled}
													<span> · {log.metadata.nextRouting.shiftStart || '--'}-{log.metadata.nextRouting.shiftEnd || '--'}</span>
												{/if}
											</span>
										</div>
									{/if}
								</div>
							{/if}
						</article>
					{/each}
				</div>
			{:else}
				<div class="empty-state">
					{$locale === 'en' ? 'No admin audit logs yet.' : 'Chưa có audit log admin nào.'}
				</div>
			{/if}
		</div>
	{/if}

	<div class="card-shell section-panel">
		<div class="section-panel__head section-panel__head--stack-mobile">
			<div>
				<div class="section-panel__title">
					{$locale === 'en' ? 'Anonymous visitors (tracked)' : 'Khách lạ truy cập (đã track)'}
				</div>
				<div class="text-black-50 small">{anonymousPaginationSummary}</div>
			</div>
			<form method="get" class="toolbar-form">
				<select class="form-select" name="anonMapped" value={anonMapped}>
					{#each anonymousMappedOptions as option}
						<option value={option.value} selected={option.value === anonMapped}>{option.label}</option>
					{/each}
				</select>
				<input type="hidden" name="page" value={currentPage} />
				<input type="hidden" name="limit" value={currentLimit} />
				{#if activeStatus}
					<input type="hidden" name="status" value={activeStatus} />
				{/if}
				<input type="hidden" name="anonPage" value="1" />
				<input type="hidden" name="anonLimit" value={anonCurrentLimit} />
				<button class="btn btn-outline-dark" type="submit">{$t('admin.users.filter')}</button>
			</form>
		</div>

		{#if anonymousVisitors.length}
			<div class="card-list card-list--anonymous">
				{#each anonymousVisitors as visitor}
					<article class={`entity-card entity-card--${resolveVisitorCardTone(visitor)}`}>
						<div class="entity-card__top">
							<div class="entity-card__identity">
								<h3 class="entity-card__title break-anywhere">{visitor.sessionId}</h3>
								<div class="entity-card__sub">{resolveVisitorMapLine(visitor)}</div>
							</div>
							<div class="entity-card__actions">
								{#if visitor.user}
									<span class="badge text-bg-info">{$locale === 'en' ? 'Mapped' : 'Đã map'}</span>
								{:else}
									<span class="badge text-bg-secondary">{$locale === 'en' ? 'Anonymous' : 'Khách lạ'}</span>
								{/if}
								<a class="btn btn-sm btn-outline-dark" href={resolveVisitorLink(visitor)}>
									{resolveVisitorLinkLabel(visitor)}
								</a>
							</div>
						</div>

						<div class="entity-card__grid">
							<div class="entity-meta-block">
								<div class="entity-meta-block__label">IP</div>
								<div class="entity-meta-block__value break-anywhere">
									{visitor.lastIp || visitor.firstIp || '—'}
								</div>
								<div class="entity-meta-block__hint">{visitor.locale || '—'}</div>
							</div>

							<div class="entity-meta-block">
								<div class="entity-meta-block__label">
									{$locale === 'en' ? 'Behavior summary' : 'Tóm tắt hành vi'}
								</div>
								<div class="entity-meta-block__value">
									{$locale === 'en' ? 'Clicks' : 'Click'}: {visitor.clickCount ?? 0} ·
									{$locale === 'en' ? 'Products' : 'Sản phẩm'}: {visitor.productViewCount ?? 0} ·
									{$locale === 'en' ? 'Scroll' : 'Cuộn'}: {visitor.maxScrollDepthPercent ?? 0}%
								</div>
								<div class="entity-meta-block__hint break-anywhere">
									{$locale === 'en' ? 'Time' : 'Thời gian'}: {formatDuration(visitor.totalTimeSeconds)}
									{#if visitor.lastPath}<span> · {visitor.lastPath}</span>{/if}
								</div>
							</div>

							<div class="entity-meta-block">
								<div class="entity-meta-block__label">
									{$locale === 'en' ? 'Mapped account' : 'Tài khoản map'}
								</div>
								{#if visitor.user}
									<a class="entity-link break-anywhere" href={`/admin/users/${visitor.user._id}`}>
										{visitor.user.name || visitor.user.email || visitor.user._id}
									</a>
									<div class="entity-meta-block__hint break-anywhere">
										{visitor.user.email || visitor.user._id}
									</div>
								{:else}
									<div class="entity-meta-block__value text-black-50">
										{$locale === 'en' ? 'Not mapped' : 'Chưa map'}
									</div>
								{/if}
							</div>

							<div class="entity-meta-block">
								<div class="entity-meta-block__label">
									{$locale === 'en' ? 'Last seen' : 'Lần cuối truy cập'}
								</div>
								<div class="entity-meta-block__value">{formatDate(visitor.lastSeenAt)}</div>
								{#if visitor.mappedUserAt}
									<div class="entity-meta-block__hint break-anywhere">
										{$locale === 'en' ? 'Mapped at' : 'Map lúc'}: {formatDate(visitor.mappedUserAt)}
										{#if visitor.mappingConfidence}
											 · {$locale === 'en' ? 'Confidence' : 'Độ tin cậy'}: {visitor.mappingConfidence}
										{/if}
									</div>
								{/if}
							</div>
						</div>
					</article>
				{/each}
			</div>
		{:else}
			<div class="empty-state">
				{$locale === 'en'
					? 'No anonymous telemetry sessions found.'
					: 'Chưa có phiên khách lạ nào được theo dõi.'}
			</div>
		{/if}
	</div>

	{#if anonTotalPages > 1}
		<nav class="pagination-bar" aria-label="Anonymous visitors pagination">
			<a
				class="btn btn-sm btn-outline-dark"
				href={buildAnonymousPageHref(anonCurrentPage - 1)}
				aria-disabled={!anonymousPagination.hasPrevPage}
				class:disabled={!anonymousPagination.hasPrevPage}
			>
				{$locale === 'en' ? 'Previous' : 'Trước'}
			</a>
			{#each anonPageNumbers as pageNumber}
				<a
					class="btn btn-sm"
					class:btn-dark={pageNumber === anonCurrentPage}
					class:btn-outline-dark={pageNumber !== anonCurrentPage}
					href={buildAnonymousPageHref(pageNumber)}
					aria-current={pageNumber === anonCurrentPage ? 'page' : undefined}
				>
					{pageNumber}
				</a>
			{/each}
			<a
				class="btn btn-sm btn-outline-dark"
				href={buildAnonymousPageHref(anonCurrentPage + 1)}
				aria-disabled={!anonymousPagination.hasNextPage}
				class:disabled={!anonymousPagination.hasNextPage}
			>
				{$locale === 'en' ? 'Next' : 'Sau'}
			</a>
		</nav>
	{/if}
</section>

<style>
	.admin-users-page {
		display: grid;
		gap: 1rem;
	}

	.card-shell {
		background: #fff;
		border: 1px solid #e7ebf0;
		border-radius: 16px;
	}

	.page-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		padding: 1rem;
	}

	.page-head__title {
		min-width: 0;
	}

	.toolbar-form {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.toolbar-form .form-select {
		min-width: 190px;
		max-width: 280px;
	}

	.section-panel {
		overflow: hidden;
	}

	.section-panel__head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.75rem;
		padding: 1rem;
		border-bottom: 1px solid #eef1f5;
	}

	.section-panel__title {
		font-weight: 700;
		color: #111827;
	}

	.card-list {
		display: grid;
		gap: 0.9rem;
		padding: 1rem;
	}

	.card-list--users,
	.card-list--anonymous,
	.card-list--admins {
		grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
	}

	.entity-card {
		border: 1px solid #e9edf3;
		border-radius: 14px;
		padding: 0.9rem;
		background: #fff;
		min-width: 0;
	}

	.entity-card--mapped {
		background: linear-gradient(180deg, #ffffff 0%, #f7fbff 100%);
		border-color: #d8e8ff;
	}

	.entity-card--admin {
		background: linear-gradient(180deg, #ffffff 0%, #fcfcff 100%);
	}

	.entity-card__top {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 0.75rem;
		margin-bottom: 0.75rem;
	}

	.entity-card__identity {
		min-width: 0;
	}

	.entity-card__title {
		margin: 0;
		font-size: 0.98rem;
		font-weight: 700;
		line-height: 1.35;
		color: #111827;
	}

	.entity-card__sub {
		margin-top: 0.2rem;
		font-size: 0.84rem;
		color: #6b7280;
	}

	.entity-card__actions {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.4rem;
		flex-wrap: wrap;
		min-width: 0;
	}

	.entity-card__grid {
		display: grid;
		gap: 0.7rem;
		grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
		min-width: 0;
	}

	.entity-meta-block {
		min-width: 0;
		padding: 0.65rem;
		border-radius: 10px;
		background: #f8fafc;
		border: 1px solid #edf2f7;
	}

	.entity-meta-block--compact {
		text-align: center;
	}

	.entity-meta-block--roles {
		grid-column: span 2;
	}

	.entity-meta-block__label {
		font-size: 0.74rem;
		font-weight: 600;
		color: #64748b;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.entity-meta-block__value {
		margin-top: 0.2rem;
		font-size: 0.88rem;
		font-weight: 600;
		color: #0f172a;
		line-height: 1.35;
	}

	.entity-meta-block__hint {
		margin-top: 0.25rem;
		font-size: 0.78rem;
		color: #64748b;
		line-height: 1.35;
	}

	.entity-link {
		display: inline-block;
		margin-top: 0.2rem;
		font-weight: 600;
		text-decoration: none;
	}

	.entity-link:hover {
		text-decoration: underline;
	}

	.pagination-bar {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		align-items: center;
		gap: 0.45rem;
	}

	.empty-state {
		padding: 1.25rem;
		text-align: center;
		color: #6b7280;
	}

	.admin-account-form {
		display: grid;
		gap: 0.75rem;
	}

	.admin-role-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
		gap: 0.5rem 0.75rem;
	}

	.admin-telegram-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 0.75rem;
	}

	.entity-meta-block--telegram {
		grid-column: 1 / -1;
	}

	.admin-role-option {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.85rem;
		color: #111827;
	}

	.admin-role-option--single {
		grid-column: 1 / -1;
	}

	.telegram-mapping-card {
		display: grid;
		gap: 0.9rem;
		padding: 1rem;
		border: 1px solid #d8e7ef;
		border-radius: 16px;
		background: linear-gradient(180deg, rgba(244, 250, 253, 0.96) 0%, rgba(255, 255, 255, 0.98) 100%);
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.75);
	}

	.telegram-mapping-card__head {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.telegram-mapping-card__title-group {
		min-width: 0;
		display: grid;
		gap: 0.5rem;
	}

	.telegram-mapping-card__summary {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.telegram-status-badge,
	.telegram-handle-pill {
		display: inline-flex;
		align-items: center;
		border-radius: 999px;
		padding: 0.35rem 0.7rem;
		font-size: 0.78rem;
		font-weight: 700;
		letter-spacing: 0.01em;
	}

	.telegram-status-badge--enabled {
		background: #dff6ea;
		color: #176b43;
	}

	.telegram-status-badge--disabled {
		background: #f1f5f9;
		color: #475569;
	}

	.telegram-handle-pill {
		background: #e8f2ff;
		color: #1d4f91;
		max-width: 100%;
		word-break: break-word;
	}

	.telegram-toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.7rem;
		padding: 0.55rem 0.7rem;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.9);
		border: 1px solid #dce7ef;
		cursor: pointer;
	}

	.telegram-toggle--row {
		width: 100%;
		justify-content: space-between;
	}

	.telegram-toggle input {
		position: absolute;
		opacity: 0;
		pointer-events: none;
	}

	.telegram-toggle__track {
		position: relative;
		width: 44px;
		height: 24px;
		border-radius: 999px;
		background: #cbd5e1;
		transition: background-color 0.18s ease;
		flex: 0 0 auto;
	}

	.telegram-toggle__thumb {
		position: absolute;
		top: 3px;
		left: 3px;
		width: 18px;
		height: 18px;
		border-radius: 50%;
		background: #ffffff;
		box-shadow: 0 1px 3px rgba(15, 23, 42, 0.18);
		transition: transform 0.18s ease;
	}

	.telegram-toggle input:checked + .telegram-toggle__track {
		background: #1d9a6c;
	}

	.telegram-toggle input:checked + .telegram-toggle__track .telegram-toggle__thumb {
		transform: translateX(20px);
	}

	.telegram-toggle__text {
		font-size: 0.84rem;
		font-weight: 600;
		color: #0f172a;
	}

	.telegram-mapping-card__meta {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 0.75rem;
	}

	.telegram-meta-chip {
		padding: 0.8rem 0.9rem;
		border-radius: 14px;
		border: 1px solid #e0ebf2;
		background: rgba(255, 255, 255, 0.9);
		display: grid;
		gap: 0.25rem;
	}

	.telegram-meta-chip__label {
		font-size: 0.74rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #64748b;
		font-weight: 700;
	}

	.telegram-field {
		display: grid;
		gap: 0.38rem;
		padding: 0.85rem;
		border-radius: 14px;
		border: 1px solid #dfe8ef;
		background: rgba(255, 255, 255, 0.88);
	}

	.telegram-field__label {
		font-size: 0.8rem;
		font-weight: 700;
		color: #0f172a;
	}

	.telegram-field__hint {
		font-size: 0.76rem;
		line-height: 1.4;
		color: #64748b;
	}

	.telegram-mapping-card__note {
		padding: 0.8rem 0.9rem;
		border-radius: 14px;
		background: #fff6df;
		border: 1px solid #f3df9b;
		color: #7c5b08;
		font-size: 0.8rem;
		line-height: 1.5;
	}

	.telegram-routing-card {
		display: grid;
		gap: 0.85rem;
		padding: 0.9rem;
		border: 1px solid #d9e4ee;
		border-radius: 16px;
		background: rgba(248, 251, 255, 0.85);
	}

	.telegram-routing-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 0.75rem;
	}

	.routing-days-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(72px, 1fr));
		gap: 0.55rem;
	}

	.routing-day-option {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.6rem 0.7rem;
		border: 1px solid #d7e4ef;
		border-radius: 12px;
		background: #fff;
		font-size: 0.82rem;
		font-weight: 600;
		color: #0f172a;
	}

	.admin-account-actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.admin-account-danger {
		margin-top: 0.75rem;
		padding-top: 0.75rem;
		border-top: 1px solid #eef1f5;
	}

	.audit-log-list {
		display: grid;
		gap: 0.9rem;
		padding: 1rem;
	}

	.audit-log-card {
		border: 1px solid #e9edf3;
		border-radius: 14px;
		padding: 0.9rem;
		background: linear-gradient(180deg, #ffffff 0%, #fbfcfe 100%);
	}

	.audit-log-card__top {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 0.75rem;
		margin-bottom: 0.75rem;
	}

	.audit-log-card__title {
		font-weight: 700;
		color: #111827;
		line-height: 1.4;
	}

	.audit-log-card__meta {
		margin-top: 0.2rem;
		font-size: 0.8rem;
		color: #64748b;
	}

	.audit-log-card__grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 0.75rem;
	}

	.audit-log-diff {
		margin-top: 0.75rem;
		padding-top: 0.75rem;
		border-top: 1px solid #eef1f5;
		display: grid;
		gap: 0.5rem;
	}

	.audit-log-diff__row {
		display: grid;
		grid-template-columns: 110px 1fr;
		gap: 0.75rem;
		align-items: start;
	}

	.audit-log-diff__label {
		font-size: 0.78rem;
		font-weight: 700;
		color: #64748b;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.audit-log-diff__value {
		font-size: 0.88rem;
		font-weight: 600;
		color: #0f172a;
	}

	.audit-log-diff__arrow {
		padding: 0 0.4rem;
		color: #64748b;
	}

	.break-anywhere {
		overflow-wrap: anywhere;
		word-break: break-word;
	}

	@media (max-width: 992px) {
		.page-head,
		.section-panel__head {
			align-items: stretch;
			flex-direction: column;
		}

		.toolbar-form {
			width: 100%;
		}

		.toolbar-form .form-select,
		.toolbar-form .btn {
			width: 100%;
			max-width: none;
		}
	}

	@media (max-width: 576px) {
		.card-list--users,
		.card-list--anonymous {
			grid-template-columns: 1fr;
		}

		.entity-card__top {
			flex-direction: column;
		}

		.entity-card__actions {
			width: 100%;
			justify-content: flex-start;
		}

		.entity-card__actions .btn {
			width: 100%;
		}

		.entity-meta-block--roles {
			grid-column: auto;
		}

		.entity-meta-block--telegram {
			grid-column: auto;
		}

		.telegram-mapping-card__head {
			align-items: stretch;
		}

		.telegram-toggle {
			width: 100%;
			justify-content: space-between;
		}

		.admin-account-actions .btn,
		.admin-account-danger .btn {
			width: 100%;
		}

		.audit-log-card__top {
			flex-direction: column;
		}

		.audit-log-diff__row {
			grid-template-columns: 1fr;
			gap: 0.25rem;
		}
	}
</style>
