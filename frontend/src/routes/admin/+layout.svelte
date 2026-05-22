<script>
	import '$lib/styles/admin.css';
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { page } from '$app/stores';
	import AdminToastHost from '$lib/components/AdminToastHost.svelte';
	import { pushToast } from '$lib/stores/adminToast.js';
	import { locale, setLocale, t } from '$lib/i18n/admin/index.js';

	let { children, data } = $props();
	let lastToastKey = '';
	let mobileSidebarOpen = $state(false);
	let isMobileViewport = $state(false);
	const adminRoles = $derived(Array.isArray(data?.admin?.roles) ? data.admin.roles : []);
	const hasAnyRole = (allowed = []) =>
		!allowed.length || allowed.some((role) => adminRoles.includes(role));

	const navItems = $derived(
		[
			{ href: '/admin', label: $t('admin.nav.dashboard') },
			{ href: '/admin/products', label: $t('admin.nav.products') },
			{ href: '/admin/reviews', label: $t('admin.nav.reviews') },
			{ href: '/admin/blogs', label: $t('admin.nav.blogs') },
			{ href: '/admin/best-selling', label: $t('admin.nav.bestSelling') },
			{
				href: '/admin/home-slides',
				label: $locale === 'en' ? 'Home slides' : 'Slide trang chủ'
			},
			{
				href: '/admin/agent-knowledge',
				label: $locale === 'en' ? 'AI knowledge' : 'Kho tri thức AI',
				roles: ['ADMIN', 'SUPER_ADMIN']
			},
			{
				href: '/admin/chat-rooms',
				label: $locale === 'en' ? 'Chat rooms' : 'Phòng chat',
				roles: ['CHAT_MANAGER', 'LEAD_MANAGER', 'ADMIN', 'SUPER_ADMIN']
			},
			{ href: '/admin/discounts', label: $t('admin.nav.discounts') },
			{ href: '/admin/contacts', label: $t('admin.nav.contacts') },
			{ href: '/admin/approvals', label: $t('admin.nav.approvals') },
			{ href: '/admin/users', label: $t('admin.nav.users') },
			{ href: '/admin/orders', label: $t('admin.nav.orders') },
			{ href: '/admin/profile', label: $t('admin.nav.profile') }
		].filter((item) => hasAnyRole(item.roles || []))
	);

	const isActive = (href) => {
		const path = $page.url.pathname;
		if (path === href) return true;
		if (href === '/admin') return false;
		return path.startsWith(`${href}/`);
	};

	const closeMobileSidebar = () => {
		mobileSidebarOpen = false;
	};

	const toggleMobileSidebar = () => {
		mobileSidebarOpen = !mobileSidebarOpen;
	};

	const handleLogoutClick = (event) => {
		if (!browser) return;
		event.preventDefault();
		closeMobileSidebar();
		window.location.href = resolve('/admin/logout');
	};

	$effect(() => {
		if (!browser) return;
		const toast = data?.toast;
		if (!toast?.message) return;
		const key = toast.id || `${toast.tone || 'info'}:${toast.message}`;
		if (key === lastToastKey) return;
		lastToastKey = key;
		pushToast(toast);
	});

	$effect(() => {
		$page.url.pathname;
		mobileSidebarOpen = false;
	});

	$effect(() => {
		if (!browser) return;
		document.body.classList.toggle(
			'admin-sidebar-lock',
			Boolean(data?.admin && isMobileViewport && mobileSidebarOpen)
		);

		return () => {
			document.body.classList.remove('admin-sidebar-lock');
		};
	});

	onMount(() => {
		if (!browser) return undefined;

		const syncViewportState = () => {
			isMobileViewport = window.innerWidth <= 1024;
			if (!isMobileViewport) mobileSidebarOpen = false;
		};

		const handleKeydown = (event) => {
			if (event.key === 'Escape') closeMobileSidebar();
		};

		syncViewportState();
		window.addEventListener('resize', syncViewportState, { passive: true });
		window.addEventListener('keydown', handleKeydown);

		return () => {
			window.removeEventListener('resize', syncViewportState);
			window.removeEventListener('keydown', handleKeydown);
			document.body.classList.remove('admin-sidebar-lock');
		};
	});
</script>

<div class="admin-shell">
	<AdminToastHost />
	{#if data?.admin}
		<header class="admin-mobile-header">
			<button
				type="button"
				class="admin-hamburger"
				aria-expanded={mobileSidebarOpen}
				aria-controls="admin-sidebar"
				aria-label={$locale === 'en' ? 'Toggle admin menu' : 'Mở menu quản trị'}
				onclick={toggleMobileSidebar}
			>
				<span></span>
				<span></span>
				<span></span>
			</button>
			<div class="admin-mobile-title">{$t('admin.layout.title')}</div>
			<div class="admin-mobile-spacer"></div>
		</header>

		{#if isMobileViewport && mobileSidebarOpen}
			<button
				type="button"
				class="admin-sidebar-backdrop"
				aria-label={$locale === 'en' ? 'Close admin menu' : 'Đóng menu quản trị'}
				onclick={closeMobileSidebar}
			></button>
		{/if}

		<div class="admin-layout">
			<aside
				id="admin-sidebar"
				class:mobile-open={mobileSidebarOpen}
				class="admin-sidebar"
				aria-hidden={isMobileViewport ? !mobileSidebarOpen : undefined}
			>
				<button
					type="button"
					class="admin-sidebar-close"
					aria-label={$locale === 'en' ? 'Close admin menu' : 'Đóng menu quản trị'}
					onclick={closeMobileSidebar}
				>
					×
				</button>
				<div class="admin-card admin-profile">
					<div class="admin-brand">Inoxpran</div>
					<div class="admin-user">
						<div class="admin-user-name">{data.admin.name || $t('admin.layout.title')}</div>
						<div class="admin-user-email">{data.admin.email}</div>
					</div>
					<div class="admin-lang">
						<div class="admin-lang-label">{$t('admin.layout.language')}</div>
						<div class="admin-lang-toggle" role="group" aria-label={$t('admin.layout.language')}>
							<button
								type="button"
								class="admin-lang-btn"
								class:active={$locale === 'vi'}
								onclick={() => setLocale('vi')}
								aria-label={$t('admin.layout.langVi')}
							>
								VI
							</button>
							<button
								type="button"
								class="admin-lang-btn"
								class:active={$locale === 'en'}
								onclick={() => setLocale('en')}
								aria-label={$t('admin.layout.langEn')}
							>
								EN
							</button>
						</div>
					</div>
				</div>

				<nav class="admin-nav" aria-label={$t('admin.layout.title')}>
					{#each navItems as item (item.href)}
						<a
							class="admin-nav-link"
							class:active={isActive(item.href)}
							href={resolve(item.href)}
							aria-current={isActive(item.href) ? 'page' : undefined}
							onclick={closeMobileSidebar}
						>
							<span>{item.label}</span>
						</a>
					{/each}
					<a class="admin-nav-link danger" href={resolve('/admin/logout')} onclick={handleLogoutClick}>
						<span>{$t('admin.layout.logout')}</span>
					</a>
				</nav>
			</aside>

			<section class="admin-content">
				{@render children()}
			</section>
		</div>
	{:else}
		<section class="admin-auth">
			{@render children()}
		</section>
	{/if}
</div>
