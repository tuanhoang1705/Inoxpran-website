<script>
	import { onMount } from 'svelte';
	import { afterNavigate, goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { clearClientAccountState } from '$lib/client/accountState.js';
	import { forceMobileZoomOut100 } from '$lib/client/mobileViewport.js';
	import { locale, setLocale, t } from '$lib/i18n/index.js';
	import { cartCount } from '$lib/stores/cartCount.js';
	let { introHidden = false } = $props();
	let mobileMenuOpen = $state(false);
	let mobileSearchOpen = $state(false);
	let logoutPending = $state(false);
	let headerEl;
	let cartIconEl;
	let cartIconMobileEl;
	let lastHeaderHeight = -1;
	let hasAfterNavigateRun = false;
	const searchValue = $derived(page.url.searchParams.get('q') || '');
	const user = $derived(logoutPending ? null : (page.data?.user ?? null));
	const profileAvatar = $derived(logoutPending ? '' : page.data?.profile?.avatar || '');
	const profileName = $derived(logoutPending ? '' : page.data?.profile?.name || '');
	const profileEmail = $derived(logoutPending ? '' : page.data?.profile?.email || '');
	const userAvatar = $derived(profileAvatar || user?.avatar || '');
	const userDisplayName = $derived(
		profileName || user?.name || profileEmail || user?.email || $t('common.customer')
	);
	const userInitials = $derived.by(() => {
		const raw = profileName || user?.name || profileEmail || user?.email || '';
		const base = raw.includes('@') ? raw.split('@')[0] : raw;
		const cleaned = base.trim();
		if (!cleaned) return 'U';
		const parts = cleaned.split(/\s+/).filter(Boolean);
		if (!parts.length) return cleaned.slice(0, 2).toUpperCase();
		const letters = parts
			.slice(0, 2)
			.map((part) => part[0])
			.join('');
		return letters ? letters.toUpperCase() : cleaned.slice(0, 2).toUpperCase();
	});

	const isActive = (path) => page.url.pathname === path;
	const openMobileMenu = () => {
		mobileMenuOpen = true;
		mobileSearchOpen = false;
	};

	const toggleMobileSearch = () => {
		const next = !mobileSearchOpen;
		mobileSearchOpen = next;
		if (next) {
			mobileMenuOpen = false;
		}
	};

	const closeMobileMenu = () => {
		mobileMenuOpen = false;
	};

	const closeMobileSearch = () => {
		mobileSearchOpen = false;
	};

	const resetMobileTransientUi = () => {
		mobileMenuOpen = false;
		mobileSearchOpen = false;
		if (typeof document !== 'undefined') {
			const active = document.activeElement;
			if (active instanceof HTMLElement) {
				active.blur();
			}
		}
	};

	const navigateToLogout = (event) => {
		event?.preventDefault?.();
		logoutPending = true;
		clearClientAccountState();
		if (typeof window === 'undefined') return;
		window.location.assign(localizeInternalHref('/logout'));
	};

	const handleLogoutClick = (event) => {
		navigateToLogout(event);
	};

	const handleMobileLogoutClick = (event) => {
		resetMobileTransientUi();
		navigateToLogout(event);
	};

	const navigateHomeAndReload = () => {
		if (typeof window === 'undefined') return;
		const localizedHomePath = localizeInternalHref('/');
		const isAlreadyHome =
			window.location.pathname === localizedHomePath &&
			!window.location.search &&
			!window.location.hash;
		if (isAlreadyHome) {
			window.location.reload();
			return;
		}
		window.location.assign(localizedHomePath);
	};

	const handleLogoClick = (event) => {
		event?.preventDefault?.();
		resetMobileTransientUi();
		navigateHomeAndReload();
	};

	const handleMobileZoomReset = () => {
		forceMobileZoomOut100();
	};

	const fallbackPromoText = $derived(
		$locale === 'en' ? 'Welcome gift for first-time customers -' : 'Quà chào mừng cho đơn đầu tiên -'
	);
	const fallbackPromoCta = $derived($locale === 'en' ? 'Get offer' : 'Nhận ưu đãi');
	const siteMarketingCampaign = $derived(page.data?.siteMarketingCampaign ?? null);
	const promoText = $derived.by(() => {
		if (siteMarketingCampaign?.enabled && siteMarketingCampaign?.headerEnabled) {
			const title =
				$locale === 'en'
					? siteMarketingCampaign.titleEn || siteMarketingCampaign.titleVi
					: siteMarketingCampaign.titleVi || siteMarketingCampaign.titleEn;
			if (title) return `${title} -`;
		}
		return fallbackPromoText;
	});
	const promoCta = $derived.by(() => {
		if (siteMarketingCampaign?.enabled && siteMarketingCampaign?.headerEnabled) {
			const cta =
				$locale === 'en'
					? siteMarketingCampaign.ctaEn || siteMarketingCampaign.ctaVi
					: siteMarketingCampaign.ctaVi || siteMarketingCampaign.ctaEn;
			if (cta) return cta;
		}
		return fallbackPromoCta;
	});

	const openLeadCapture = (event) => {
		event?.preventDefault?.();
		resetMobileTransientUi();
		if (typeof window === 'undefined') return;
		window.dispatchEvent(
			new CustomEvent('inoxpran:open-lead-capture', {
				detail: { campaign: siteMarketingCampaign }
			})
		);
	};

	const normalizePathname = (value) => {
		const pathname = String(value || '').trim() || '/';
		if (pathname === '/') return '/';
		return pathname.replace(/\/+$/, '');
	};

	const stripLocalePrefix = (pathname) =>
		normalizePathname(String(pathname || '').replace(/^\/en(?=\/|$)/, '') || '/');

	const buildLocalizedPathname = (pathname, targetLocale) => {
		const basePath = stripLocalePrefix(pathname);
		if (targetLocale === 'en') {
			return `/en${basePath === '/' ? '' : basePath}`;
		}
		return basePath;
	};

	const localizeInternalHref = (href, targetLocale) => {
		const raw = String(href || '').trim();
		if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return raw;
		if (raw.startsWith('/admin') || raw.startsWith('/api') || raw.startsWith('/_app')) return raw;
		try {
			const parsed = new URL(raw, 'https://inoxpran.local');
			const nextPathname = buildLocalizedPathname(parsed.pathname, targetLocale || $locale);
			return `${nextPathname}${parsed.search}${parsed.hash}`;
		} catch {
			return raw;
		}
	};

	const isModifiedNavigationEvent = (event) =>
		Boolean(
			event?.defaultPrevented ||
			event?.button !== 0 ||
			event?.metaKey ||
			event?.ctrlKey ||
			event?.shiftKey ||
			event?.altKey
		);

	const isInternalHref = (href) => {
		const raw = String(href || '').trim();
		return raw.startsWith('/') && !raw.startsWith('//');
	};

	const getBasePathFromHref = (href) => {
		try {
			const parsed = new URL(String(href || ''), 'https://inoxpran.local');
			return stripLocalePrefix(parsed.pathname);
		} catch {
			return '';
		}
	};

	const navigateInternalHref = (href) => {
		if (typeof window === 'undefined') return;

		const nextHref = String(href || '').trim();
		const basePath = getBasePathFromHref(nextHref);
		resetMobileTransientUi();

		if (basePath === '/shop') {
			void goto(nextHref);
			return;
		}

		window.location.assign(nextHref);
	};

	const handlePrimaryNavigationClick = (event, href) => {
		if (typeof window === 'undefined') return;
		if (isModifiedNavigationEvent(event)) return;
		if (!isInternalHref(href)) return;

		event.preventDefault();
		navigateInternalHref(href);
	};

	const handleLocaleSwitch = async (value) => {
		const targetLocale = value === 'en' ? 'en' : 'vi';
		setLocale(targetLocale);
		if (typeof window === 'undefined') return;
		const nextPathname = buildLocalizedPathname(window.location.pathname, targetLocale);
		const nextPath = `${nextPathname}${window.location.search}${window.location.hash}`;
		const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
		if (nextPath === currentPath) return;
		resetMobileTransientUi();
		await goto(nextPath);
	};

	const handleProductSearchSubmit = (event) => {
		if (typeof window === 'undefined') return;
		event.preventDefault();
		handleMobileZoomReset();

		const form = event.currentTarget;
		const formData = new FormData(form);
		const query = String(formData.get('q') || '').trim();
		const nextUrl = new URL(localizeInternalHref('/shop'), window.location.origin);
		if (query) {
			nextUrl.searchParams.set('q', query);
		}

		const nextPath = `${nextUrl.pathname}${nextUrl.search}`;
		const currentPath = `${window.location.pathname}${window.location.search}`;
		if (nextPath === currentPath) {
			void invalidateAll();
			return;
		}

		void goto(nextPath);
	};

	const navItems = $derived([
		{ label: $t('nav.home'), href: localizeInternalHref('/') },
		{ label: $t('nav.about'), href: localizeInternalHref('/about') },
		{ label: $t('nav.products'), href: localizeInternalHref('/shop') },
		{ label: $t('nav.blog'), href: localizeInternalHref('/blog') },
		{ label: 'Cảm Hứng Inoxpran', href: 'https://www.facebook.com/inoxpranvietnam' }
	]);

	const categories = $derived([
		{ label: $t('categories.pots'), href: localizeInternalHref('/shop?cat=chao-noi') },
		{ label: $t('categories.knives'), href: localizeInternalHref('/shop?cat=bo-dao') },
		{ label: $t('categories.tools'), href: localizeInternalHref('/shop?cat=dung-cu') },
		{ label: $t('categories.trays'), href: localizeInternalHref('/shop?cat=khay-nuac') }
	]);

	const languageOptions = $derived([
		{ code: 'vi', label: $t('language.vi') },
		{ code: 'en', label: $t('language.en') }
	]);

	const formatCartCountLabel = (value) => {
		const count = Number(value);
		if (!Number.isFinite(count) || count <= 0) return '';
		if (count > 99) return '99+';
		return String(count);
	};

	const cartCountLabel = $derived.by(() => formatCartCountLabel($cartCount));

	const updateHeaderOffset = () => {
		if (typeof document === 'undefined') return;
		if (!headerEl) return;
		const height = headerEl.offsetHeight || 0;
		if (height === lastHeaderHeight) return;
		lastHeaderHeight = height;
		document.documentElement.style.setProperty('--site-header-height', `${height}px`);
	};

	const exposeCartTarget = () => {
		if (typeof window === 'undefined') return;

		const el = cartIconEl || cartIconMobileEl;
		if (!el) return;

		window.__inoxpranCartDock = {
			getRect: () => el.getBoundingClientRect(),
			bump: () => {
				el.classList.remove('cart-bump');
				void el.offsetWidth;
				el.classList.add('cart-bump');
			}
		};
	};

	onMount(() => {
		exposeCartTarget();
		updateHeaderOffset();

		const handleResize = () => {
			exposeCartTarget();
			updateHeaderOffset();
		};
		const handleScroll = () => exposeCartTarget();
		window.addEventListener('resize', handleResize);
		window.addEventListener('scroll', handleScroll, true);

		return () => {
			window.removeEventListener('resize', handleResize);
			window.removeEventListener('scroll', handleScroll, true);
		};
	});

	afterNavigate(() => {
		if (hasAfterNavigateRun) {
			resetMobileTransientUi();
		} else {
			hasAfterNavigateRun = true;
		}
		requestAnimationFrame(() => {
			exposeCartTarget();
			updateHeaderOffset();
		});
	});

	$effect(() => {
		// chạm vào state để effect chạy lại khi UI đổi (menu/search open/close)
		void mobileMenuOpen;
		void mobileSearchOpen;

		// cập nhật dock sau khi DOM đã phản ánh state
		requestAnimationFrame(() => {
			exposeCartTarget();
			updateHeaderOffset();
		});

		// cleanup (nếu bạn có side effects riêng)
		return () => {};
	});
</script>

<header
	id="header"
	class="site-header"
	class:site-header--intro-hidden={introHidden}
	bind:this={headerEl}
>
	<div class="top-info border-bottom d-none d-xl-block">
		<div class="container">
			<div class="row g-0 align-items-center">
				<div class="col-md-3 top-info-col top-info-col-help">
					<p class="fs-6 my-2 text-center">
						{$t('header.topHelp')} <a href="tel:0867024186">0867 024 186</a>
					</p>
				</div>

				<div class="col-md-3 border-start top-info-col top-info-col-promo">
					<p class="fs-6 my-2 text-center">
						{promoText}{' '}
						<a
							class="text-decoration-underline"
							href={localizeInternalHref('/shop')}
							onclick={openLeadCapture}
							>{promoCta}</a
						>
					</p>
				</div>
				<div class="col-md-3 border-start top-info-col top-info-col-delivery">
					<p class="fs-6 my-2 text-center">{$t('header.delivery')}</p>
				</div>

				<div class="col-md-3 border-start top-info-col top-info-col-language">
					<div class="d-flex justify-content-center py-1">
						<div class="language-switch top" role="group" aria-label={$t('language.label')}>
							{#each languageOptions as option}
								<button
									type="button"
									class:active={$locale === option.code}
									onclick={() => void handleLocaleSwitch(option.code)}
								>
									{#if option.code === 'vi'}
										<svg
											class="lang-flag"
											viewBox="0 0 36 36"
											xmlns="http://www.w3.org/2000/svg"
											aria-hidden="true"
											focusable="false"
											role="img"
											preserveAspectRatio="xMidYMid meet"
										>
											<path
												fill="#DA251D"
												d="M32 5H4a4 4 0 0 0-4 4v18a4 4 0 0 0 4 4h28a4 4 0 0 0 4-4V9a4 4 0 0 0-4-4z"
											></path>
											<path
												fill="#FF0"
												d="M19.753 16.037L18 10.642l-1.753 5.395h-5.672l4.589 3.333l-1.753 5.395L18 21.431l4.589 3.334l-1.753-5.395l4.589-3.333z"
											></path>
										</svg>
									{:else if option.code === 'en'}
										<svg
											class="lang-flag"
											viewBox="0 0 36 36"
											xmlns="http://www.w3.org/2000/svg"
											aria-hidden="true"
											focusable="false"
											role="img"
											preserveAspectRatio="xMidYMid meet"
										>
											<path
												fill="#00247D"
												d="M0 9.059V13h5.628zM4.664 31H13v-5.837zM23 25.164V31h8.335zM0 23v3.941L5.63 23zM31.337 5H23v5.837zM36 26.942V23h-5.631zM36 13V9.059L30.371 13zM13 5H4.664L13 10.837z"
											></path>
											<path
												fill="#CF1B2B"
												d="M25.14 23l9.712 6.801a3.977 3.977 0 0 0 .99-1.749L28.627 23H25.14zM13 23h-2.141l-9.711 6.8c.521.53 1.189.909 1.938 1.085L13 23.943V23zm10-10h2.141l9.711-6.8a3.988 3.988 0 0 0-1.937-1.085L23 12.057V13zm-12.141 0L1.148 6.2a3.994 3.994 0 0 0-.991 1.749L7.372 13h3.487z"
											></path>
											<path
												fill="#EEE"
												d="M36 21H21v10h2v-5.836L31.335 31H32a3.99 3.99 0 0 0 2.852-1.199L25.14 23h3.487l7.215 5.052c.093-.337.158-.686.158-1.052v-.058L30.369 23H36v-2zM0 21v2h5.63L0 26.941V27c0 1.091.439 2.078 1.148 2.8l9.711-6.8H13v.943l-9.914 6.941c.294.07.598.116.914.116h.664L13 25.163V31h2V21H0zM36 9a3.983 3.983 0 0 0-1.148-2.8L25.141 13H23v-.943l9.915-6.942A4.001 4.001 0 0 0 32 5h-.663L23 10.837V5h-2v10h15v-2h-5.629L36 9.059V9zM13 5v5.837L4.664 5H4a3.985 3.985 0 0 0-2.852 1.2l9.711 6.8H7.372L.157 7.949A3.968 3.968 0 0 0 0 9v.059L5.628 13H0v2h15V5h-2z"
											></path>
											<path fill="#CF1B2B" d="M21 15V5h-6v10H0v6h15v10h6V21h15v-6z"></path>
										</svg>
									{/if}
									<span class="lang-label">{option.label}</span>
								</button>
							{/each}
						</div>
					</div>
				</div>
			</div>
		</div>
	</div>

	<!-- Desktop Navigation -->
	<nav id="header-nav" class="navbar navbar-expand-xl py-3 d-none d-xl-block">
		<div class="container">
			<a
				class="navbar-brand me-3 me-xl-4"
				href={localizeInternalHref('/')}
				aria-label={$t('header.logoLabel')}
				onclick={handleLogoClick}
			>
				<img
					src="/images/optimized/logo-inoxpran-250.png"
					srcset="/images/optimized/logo-inoxpran-250.png 1x, /images/optimized/logo-inoxpran-250.png 2x"
					width="250"
					height="50"
					class="logo"
					alt={$t('header.logoAlt')}
					decoding="async"
				/>
			</a>
			<div class="flex-grow-1 d-flex justify-content-center">
				<ul id="navbar" class="navbar-nav text-uppercase">
					{#each navItems as item}
						<li class="nav-item">
							<a
								class="nav-link {isActive(item.href) ? 'active' : ''}"
								href={item.href}
								onclick={(event) => handlePrimaryNavigationClick(event, item.href)}
							>
								{item.label}
							</a>
						</li>
					{/each}
				</ul>
			</div>

			<!-- Desktop Icons -->
			<div class="user-items d-flex align-items-center ms-2 ms-xl-3">
				<ul class="d-flex justify-content-end list-unstyled mb-0 align-items-center">
					<li class="pe-3 nav-search-item">
						<form
							class="nav-search-form"
							action={localizeInternalHref('/shop')}
							method="GET"
							role="search"
							onsubmit={handleProductSearchSubmit}
						>
							<input
								class="nav-search-input"
								type="search"
								name="q"
								value={searchValue}
								placeholder={$t('header.searchPlaceholder')}
								aria-label={$t('header.searchLabel')}
								onfocus={handleMobileZoomReset}
							/>
							<button class="nav-search-btn" type="submit" aria-label={$t('header.searchLabel')}>
								<svg class="search" aria-hidden="true">
									<use xlink:href="#search"></use>
								</svg>
							</button>
						</form>
					</li>
					{#if user}
						<li class="pe-3">
							<div class="account-menu">
								<a
									href={localizeInternalHref('/account')}
									class="account-pill"
									aria-label={$t('header.account')}
								>
									{#if userAvatar}
										<span class="account-avatar account-avatar-image" aria-hidden="true">
											<img src={userAvatar} alt="" width="40" height="40" loading="lazy" />
										</span>
									{:else}
										<span class="account-avatar" aria-hidden="true">{userInitials}</span>
									{/if}
									<span class="account-meta">
										<span class="account-name">
											{userDisplayName.length > 11
												? userDisplayName.split(' ').slice(0, 2).join(' ') + '...'
												: userDisplayName}
										</span>
										<span class="account-status">{$t('header.loggedIn')}</span>
									</span>
								</a>
								<div class="account-popover" role="menu" aria-label={$t('header.account')}>
									<a href={localizeInternalHref('/account')} role="menuitem">
										{$t('header.accountMine')}
									</a>
									<a href={localizeInternalHref('/account/purchase')} role="menuitem">
										{$t('header.purchase')}
									</a>
									<a
										href={localizeInternalHref('/logout')}
										role="menuitem"
										class="account-logout"
										onclick={handleLogoutClick}
									>
										{$t('header.logout')}
									</a>
								</div>
							</div>
						</li>
					{:else}
						<li class="pe-3">
							<a href={localizeInternalHref('/login')} aria-label={$t('auth.login')}>
								<svg class="user">
									<use xlink:href="#user"></use>
								</svg>
							</a>
						</li>
					{/if}
					<li class="cart-dropdown">
						<a
							href={localizeInternalHref('/cart')}
							class="cart-toggle"
							bind:this={cartIconEl}
							aria-label={$t('header.cart')}
						>
							<svg class="cart">
								<use xlink:href="#cart"></use>
							</svg>
							{#if cartCountLabel}
								<span class="cart-badge">{cartCountLabel}</span>
							{/if}
						</a>
					</li>
				</ul>
			</div>
		</div>
	</nav>

	<!-- Mobile Navigation -->
	<nav class="mobile-header d-xl-none">
		<!-- Mobile Top Bar -->
		<div class="mobile-top-bar">
			<div class="mobile-logo">
				<a
					href={localizeInternalHref('/')}
					aria-label={$t('header.logoLabel')}
					onclick={(event) => {
						closeMobileMenu();
						handleLogoClick(event);
					}}
				>
					<img
						src="/images/optimized/logo-inoxpran-250.png"
						srcset="/images/optimized/logo-inoxpran-250.png 1x, /images/optimized/logo-inoxpran-250.png 2x"
						width="250"
						height="50"
						alt={$t('header.logoAlt')}
						class="logo-mobile"
						decoding="async"
					/>
				</a>
			</div>

			<div class="mobile-actions">
				<button
					type="button"
					class="mobile-action-btn search-btn"
					onclick={toggleMobileSearch}
					aria-label={$t('header.searchLabel')}
				>
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<circle cx="11" cy="11" r="8"></circle>
						<path d="m21 21-4.35-4.35"></path>
					</svg>
				</button>

				<a
					href={localizeInternalHref('/cart')}
					class="mobile-action-btn cart-btn"
					bind:this={cartIconMobileEl}
					aria-label={$t('header.cart')}
				>
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<circle cx="9" cy="21" r="1"></circle>
						<circle cx="20" cy="21" r="1"></circle>
						<path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
					</svg>
					{#if cartCountLabel}
						<span class="cart-badge">{cartCountLabel}</span>
					{/if}
				</a>

				<button
					type="button"
					class="mobile-action-btn menu-btn"
					onclick={openMobileMenu}
					aria-label={$t('mobileMenu.menu')}
					aria-expanded={mobileMenuOpen}
					aria-controls="mobile-menu-drawer"
				>
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<line x1="3" y1="6" x2="21" y2="6"></line>
						<line x1="3" y1="12" x2="21" y2="12"></line>
						<line x1="3" y1="18" x2="21" y2="18"></line>
					</svg>
				</button>
			</div>
		</div>

		<!-- Mobile Search Bar -->
		{#if mobileSearchOpen}
			<div class="mobile-search-bar">
				<form
					action={localizeInternalHref('/shop')}
					method="GET"
					onsubmit={handleProductSearchSubmit}
				>
					<input
						type="search"
						name="q"
						value={searchValue}
						placeholder={$t('header.searchPlaceholder')}
						class="mobile-search-input"
						aria-label={$t('header.searchLabel')}
						onfocus={handleMobileZoomReset}
					/>
					<button type="submit" class="mobile-search-submit" aria-label={$t('header.searchLabel')}>
						<svg
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							aria-hidden="true"
						>
							<circle cx="11" cy="11" r="8"></circle>
							<path d="m21 21-4.35-4.35"></path>
						</svg>
					</button>
				</form>
			</div>
		{/if}

		<!-- Mobile Menu Drawer -->
		{#if mobileMenuOpen}
			<div
				class="mobile-menu-overlay"
				role="button"
				tabindex="0"
				aria-label={$t('common.close')}
				onclick={closeMobileMenu}
				onkeydown={(e) => e.key === 'Escape' && closeMobileMenu()}
			></div>
			<div class="mobile-menu-drawer" id="mobile-menu-drawer">
				<!-- Menu Header -->
				<div class="mobile-menu-header">
					<h3>{$t('mobileMenu.menu')}</h3>
					<button
						type="button"
						class="close-btn"
						onclick={closeMobileMenu}
						aria-label={$t('common.close')}
					>
						<svg
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							aria-hidden="true"
						>
							<line x1="18" y1="6" x2="6" y2="18"></line>
							<line x1="6" y1="6" x2="18" y2="18"></line>
						</svg>
					</button>
				</div>

				<!-- Main Navigation -->
				<div class="mobile-nav-section">
					<h4 class="mobile-section-title">{$t('mobileMenu.mainNav')}</h4>
					<ul class="mobile-nav-list">
						{#each navItems as item}
							<li>
								<a
									href={item.href}
									class={isActive(item.href) ? 'active' : ''}
									onclick={(event) => handlePrimaryNavigationClick(event, item.href)}
								>
									{item.label}
								</a>
							</li>
						{/each}
					</ul>
				</div>

				<!-- Quick Categories -->
				<div class="mobile-nav-section">
					<h4 class="mobile-section-title">{$t('mobileMenu.products')}</h4>
					<ul class="mobile-categories">
						{#each categories as cat}
							<li>
								<a
									href={cat.href}
									onclick={(event) => handlePrimaryNavigationClick(event, cat.href)}
								>
									{cat.label}
								</a>
							</li>
						{/each}
					</ul>
				</div>

				<!-- Quick Actions -->
				<div class="mobile-nav-section">
					<h4 class="mobile-section-title">{$t('mobileMenu.account')}</h4>
					<ul class="mobile-actions-list">
						{#if user}
							<li>
								<a
									href={localizeInternalHref('/account')}
									class="mobile-account-card"
									onclick={(event) =>
										handlePrimaryNavigationClick(event, localizeInternalHref('/account'))}
								>
									{#if userAvatar}
										<span class="account-avatar account-avatar-image" aria-hidden="true">
											<img src={userAvatar} alt="" width="40" height="40" loading="lazy" />
										</span>
									{:else}
										<span class="account-avatar" aria-hidden="true">{userInitials}</span>
									{/if}
									<span class="account-meta">
										<span class="account-name">
											{userDisplayName.length > 11
												? userDisplayName.split(' ').slice(0, 2).join(' ') + '...'
												: userDisplayName}
										</span>
										<span class="account-status">{$t('header.loggedIn')}</span>
									</span>
								</a>
							</li>
							<li>
								<a
									href={localizeInternalHref('/account/purchase')}
									onclick={(event) =>
										handlePrimaryNavigationClick(
											event,
											localizeInternalHref('/account/purchase')
										)}
								>
									<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
										<path d="M3 7h18"></path>
										<path d="M5 7l1.5 12h11L19 7"></path>
										<path d="M9 7V5a3 3 0 0 1 6 0v2"></path>
									</svg>
									{$t('header.purchase')}
								</a>
							</li>
						{:else}
							<li>
								<a
									href={localizeInternalHref('/login')}
									onclick={(event) =>
										handlePrimaryNavigationClick(event, localizeInternalHref('/login'))}
								>
									<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
										<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
										<circle cx="12" cy="7" r="4"></circle>
									</svg>
									{$t('auth.login')}
								</a>
							</li>
						{/if}
						{#if !user}
							<li>
								<a
									href={localizeInternalHref('/account/purchase')}
									onclick={(event) =>
										handlePrimaryNavigationClick(
											event,
											localizeInternalHref('/account/purchase')
										)}
								>
									<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
										<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"
										></path>
										<polyline points="12 6 12 12 16 14"></polyline>
									</svg>
									{$t('mobileMenu.orders')}
								</a>
							</li>
						{/if}
					</ul>
				</div>

				<!-- Contact Info -->
				<div class="mobile-nav-section">
					<h4 class="mobile-section-title">{$t('language.label')}</h4>
					<div class="language-switch mobile">
						{#each languageOptions as option}
							<button
								type="button"
								class:active={$locale === option.code}
								onclick={() => void handleLocaleSwitch(option.code)}
							>
								{#if option.code === 'vi'}
									<svg
										class="lang-flag"
										viewBox="0 0 36 36"
										xmlns="http://www.w3.org/2000/svg"
										aria-hidden="true"
										focusable="false"
										role="img"
										preserveAspectRatio="xMidYMid meet"
									>
										<path
											fill="#DA251D"
											d="M32 5H4a4 4 0 0 0-4 4v18a4 4 0 0 0 4 4h28a4 4 0 0 0 4-4V9a4 4 0 0 0-4-4z"
										></path>
										<path
											fill="#FF0"
											d="M19.753 16.037L18 10.642l-1.753 5.395h-5.672l4.589 3.333l-1.753 5.395L18 21.431l4.589 3.334l-1.753-5.395l4.589-3.333z"
										></path>
									</svg>
								{:else if option.code === 'en'}
									<svg
										class="lang-flag"
										viewBox="0 0 36 36"
										xmlns="http://www.w3.org/2000/svg"
										aria-hidden="true"
										focusable="false"
										role="img"
										preserveAspectRatio="xMidYMid meet"
									>
										<path
											fill="#00247D"
											d="M0 9.059V13h5.628zM4.664 31H13v-5.837zM23 25.164V31h8.335zM0 23v3.941L5.63 23zM31.337 5H23v5.837zM36 26.942V23h-5.631zM36 13V9.059L30.371 13zM13 5H4.664L13 10.837z"
										></path>
										<path
											fill="#CF1B2B"
											d="M25.14 23l9.712 6.801a3.977 3.977 0 0 0 .99-1.749L28.627 23H25.14zM13 23h-2.141l-9.711 6.8c.521.53 1.189.909 1.938 1.085L13 23.943V23zm10-10h2.141l9.711-6.8a3.988 3.988 0 0 0-1.937-1.085L23 12.057V13zm-12.141 0L1.148 6.2a3.994 3.994 0 0 0-.991 1.749L7.372 13h3.487z"
										></path>
										<path
											fill="#EEE"
											d="M36 21H21v10h2v-5.836L31.335 31H32a3.99 3.99 0 0 0 2.852-1.199L25.14 23h3.487l7.215 5.052c.093-.337.158-.686.158-1.052v-.058L30.369 23H36v-2zM0 21v2h5.63L0 26.941V27c0 1.091.439 2.078 1.148 2.8l9.711-6.8H13v.943l-9.914 6.941c.294.07.598.116.914.116h.664L13 25.163V31h2V21H0zM36 9a3.983 3.983 0 0 0-1.148-2.8L25.141 13H23v-.943l9.915-6.942A4.001 4.001 0 0 0 32 5h-.663L23 10.837V5h-2v10h15v-2h-5.629L36 9.059V9zM13 5v5.837L4.664 5H4a3.985 3.985 0 0 0-2.852 1.2l9.711 6.8H7.372L.157 7.949A3.968 3.968 0 0 0 0 9v.059L5.628 13H0v2h15V5h-2z"
										></path>
										<path fill="#CF1B2B" d="M21 15V5h-6v10H0v6h15v10h6V21h15v-6z"></path>
									</svg>
								{/if}
								<span class="lang-label">{option.label}</span>
							</button>
						{/each}
					</div>
				</div>

				<div class="mobile-nav-section">
					<h4 class="mobile-section-title">{$t('mobileMenu.contact')}</h4>
					<div class="mobile-contact-info">
						<p>
							<strong>{$t('footer.hotline')}:</strong> <a href="tel:0867024186">0867 024 186</a>
						</p>
						<p>
							<strong>{$t('footer.email')}:</strong>
							<a href="mailto:info%40inoxpran.com">
								{@html '<!--email_off-->'}info@inoxpran.com{@html '<!--/email_off-->'}
							</a>
						</p>
					</div>
				</div>

				<!-- Social Links -->
				<div class="mobile-nav-section">
					<h4 class="mobile-section-title">{$t('footer.followUs')}</h4>
					<div class="mobile-social-links">
						<a
							href="https://www.facebook.com/inoxpranvietnam"
							target="_blank"
							rel="noopener noreferrer"
							class="social-link">Facebook</a
						>
					</div>
				</div>
				{#if user}
					<div class="mobile-menu-footer">
						<a
							href={localizeInternalHref('/logout')}
							class="mobile-logout-btn"
							onclick={handleMobileLogoutClick}
						>
							{$t('header.logout')}
						</a>
					</div>
				{/if}
			</div>
		{/if}
	</nav>
</header>

<style>
	.site-header {
		z-index: 999999;
		transition:
			transform 0.42s cubic-bezier(0.22, 1, 0.36, 1),
			opacity 0.28s ease,
			background 0.3s ease-out,
			box-shadow 0.3s ease-out;
	}

	.site-header.site-header--intro-hidden {
		transform: translateY(calc(-100% - env(safe-area-inset-top)));
		opacity: 0;
		pointer-events: none;
	}

	.top-info-col {
		flex: 0 0 auto;
	}

	.top-info-col-help {
		width: 25%;
	}

	.top-info-col-promo {
		width: 30%;
	}

	.top-info-col-delivery,
	.top-info-col-language {
		width: 22.5%;
	}

	.account-menu {
		position: relative;
		display: inline-flex;
	}

	.account-pill {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		padding: 6px 14px 6px 6px;
		border-radius: 5px;
		border: 1px solid rgba(13, 202, 240, 0.25);
		box-shadow: 0 12px 24px rgba(15, 20, 24, 0.08);
		color: #1b1b1b;
		text-decoration: none;
		transition:
			transform 0.2s ease,
			box-shadow 0.2s ease;
	}

	.account-pill:focus-visible {
		outline: 2px solid rgba(13, 202, 240, 0.4);
		outline-offset: 2px;
	}

	.language-switch {
		display: inline-flex;
		gap: 6px;
		padding: 4px;
		border-radius: 999px;
		border: 1px solid rgba(15, 20, 24, 0.08);
	}

	.language-switch button {
		border: none;
		background: transparent;
		min-height: 40px;
		padding: 6px 12px;
		border-radius: 999px;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: #1b1b1b;
		cursor: pointer;
		touch-action: manipulation;
		-webkit-tap-highlight-color: transparent;
	}

	.lang-flag {
		width: 18px;
		height: 18px;
		flex: 0 0 18px;
		display: block;
		border-radius: 3px;
		overflow: hidden;
		line-height: 1;
	}

	.lang-label {
		line-height: 1;
	}

	.language-switch button.active {
		background: #1f1a14;
		color: #fff7e8;
	}

	.language-switch.mobile {
		display: flex;
		width: min(100%, 260px);
		justify-content: flex-start;
	}

	.language-switch.mobile button {
		flex: 1 1 0;
		justify-content: center;
		min-height: 48px;
	}

	.account-popover {
		position: absolute;
		top: calc(80% + 10px);
		right: 0;
		min-width: 190px;
		padding: 10px;
		border-radius: 14px;
		background: #ffffff;
		box-shadow: 0 18px 40px rgba(15, 20, 24, 0.12);
		border: 1px solid rgba(15, 20, 24, 0.08);
		opacity: 0;
		transform: translateY(-6px);
		pointer-events: none;
		transition:
			opacity 0.18s ease,
			transform 0.18s ease;
		z-index: 12;
	}

	.account-menu:focus-within .account-popover {
		opacity: 1;
		transform: translateY(0);
		pointer-events: auto;
	}

	.account-popover a {
		display: flex;
		align-items: center;
		padding: 10px 12px;
		border-radius: 10px;
		color: #1b1b1b;
		font-weight: 600;
		text-decoration: none;
		transition:
			background 0.2s ease,
			color 0.2s ease;
	}

	.account-logout {
		color: #b42318;
	}

	.account-avatar {
		width: 36px;
		height: 36px;
		border-radius: 12px;
		background: linear-gradient(135deg, #1f1a14, #3a2f24);
		color: #fff1da;
		overflow: hidden;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-weight: 700;
		font-size: 0.9rem;
	}

	.account-avatar img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		border-radius: inherit;
		display: block;
	}

	.account-avatar-image {
		background: #fff3e2;
	}

	.account-meta {
		display: flex;
		flex-direction: column;
		line-height: 1.1;
	}

	.account-name {
		font-weight: 700;
		font-size: 0.9rem;
		max-width: 140px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.account-status {
		display: inline-flex;
		padding-top: 3px;
		align-items: center;
		gap: 7px;
		font-size: 0.5rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #0b8799;
	}

	.account-status::before {
		content: '';
		width: 6px;
		height: 6px;
		border-radius: 999px;
		background: var(--primary-color);
		box-shadow: 0 0 0 4px rgba(13, 202, 240, 0.2);
	}

	.mobile-account-card {
		margin: 6px 0 12px;
		padding: 12px 14px;
		border-radius: 16px;
		border: 1px solid rgba(13, 202, 240, 0.25);
		border-bottom: none;
		box-shadow: 0 2px 18px rgba(15, 20, 24, 0.08);
		color: #1b1b1b;
		width: 200px;
	}

	.mobile-account-card .account-avatar {
		width: 40px;
		height: 40px;
		border-radius: 14px;
		font-size: 0.95rem;
	}

	.mobile-account-card .account-name {
		max-width: none;
	}

	.mobile-menu-footer {
		margin: 10px 0 20px;
		padding: 0 16px;
	}

	.mobile-logout-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		padding: 12px 16px;
		border-radius: 12px;
		background: #1f1a14;
		color: #fff7e8;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		text-decoration: none;
	}

	.mobile-account-card:active {
		padding-left: 14px;
		color: #1b1b1b;
		transform: translateY(-1px);
	}

	.mobile-logout-btn:active {
		color: #fff7e8;
		background: #2b231a;
	}

	@media (hover: hover) and (pointer: fine) {
		.account-pill:hover {
			transform: translateY(-1px);
			box-shadow: 0 5px 40px rgba(15, 20, 24, 0.12);
			color: #1b1b1b;
		}

		.account-menu:hover .account-popover {
			opacity: 1;
			transform: translateY(0);
			pointer-events: auto;
		}

		.account-popover a:hover {
			background: #f7f1e7;
			color: #1b1b1b;
		}

		.account-logout:hover {
			background: rgba(180, 35, 24, 0.1);
			color: #b42318;
		}

		.mobile-account-card:hover {
			padding-left: 14px;
			color: #1b1b1b;
			transform: translateY(-1px);
		}

		.mobile-logout-btn:hover {
			color: #fff7e8;
			background: #2b231a;
		}
	}
</style>
