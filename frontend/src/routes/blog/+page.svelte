<script>
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { env } from '$env/dynamic/public';
	import { SITE_CONTACT } from '$lib/config/siteContact.js';
	import { locale, t } from '$lib/i18n/index.js';
	import { localizeInternalHref } from '$lib/utils/localePath.js';
	let { data, form } = $props();
	let email = $state('');
	const blogs = $derived(Array.isArray(data?.blogs) ? data.blogs : []);
	const apiError = $derived(String(data?.apiError || ''));
	const newsletterError = $derived(String(form?.newsletterError || ''));
	const newsletterSuccess = $derived(Boolean(form?.newsletterSuccess));
	const newsletterMessage = $derived(String(form?.newsletterMessage || ''));
	const DEFAULT_SITE_URL = 'https://inoxpran.com';
	const normalizeSiteUrl = (value) => {
		const raw = String(value || '').trim();
		if (!raw) return DEFAULT_SITE_URL;
		return raw.replace(/\/+$/, '');
	};
	const siteUrl = $derived(normalizeSiteUrl(env.PUBLIC_SITE_URL));
	const toAbsoluteUrl = (value) => {
		const raw = String(value || '').trim();
		if (!raw) return '';
		if (/^https?:\/\//i.test(raw)) return raw;
		const normalizedPath = raw.startsWith('/') ? raw : `/${raw}`;
		return `${siteUrl}${normalizedPath}`;
	};
	const canonicalUrl = $derived(`${siteUrl}${$locale === 'en' ? '/en/blog' : '/blog'}`);
	const ogImageAlt = $derived(blogs[0]?.title || $t('blog.pageTitle'));
	const ogUrl = $derived(canonicalUrl);
	const escapeJsonLd = (value) =>
		String(value || '')
			.replace(/</g, '\u003c')
			.replace(/>/g, '\u003e')
			.replace(/&/g, '\u0026')
			.replace(/\u2028/g, '\u2028')
			.replace(/\u2029/g, '\u2029');
	const resolveBlogPostUrl = (post) => {
		const slug = String(post?.slug || post?.blog_slug || '').trim();
		if (!slug) return '';
		const localePrefix = $locale === 'en' ? '/en' : '';
		return `${siteUrl}${localePrefix}/blog/${encodeURIComponent(slug)}`;
	};
	const getBlogPostHref = (post, hash = '') => {
		const slug = String(post?.slug || post?.blog_slug || '').trim();
		const path = slug ? `/blog/${encodeURIComponent(slug)}` : '/blog';
		return `${localizeInternalHref(path, $locale)}${hash}`;
	};
	const blogBreadcrumbId = $derived(`${siteUrl}/#blog-breadcrumb`);
	const blogBreadcrumbJsonLd = $derived.by(() =>
		JSON.stringify({
			'@context': 'https://schema.org',
			'@type': 'BreadcrumbList',
			'@id': blogBreadcrumbId,
			itemListElement: [
				{
					'@type': 'ListItem',
					position: 1,
					name: $t('common.home'),
					item: siteUrl
				},
				{
					'@type': 'ListItem',
					position: 2,
					name: $t('common.blog'),
					item: ogUrl
				}
			]
		})
	);
	const blogCollectionJsonLd = $derived.by(() => {
		const itemListElement = blogs
			.slice(0, 12)
			.map((post, index) => {
				const url = resolveBlogPostUrl(post);
				if (!url) return null;
				return {
					'@type': 'ListItem',
					position: index + 1,
					url,
					name: String(post?.title || '').trim() || `Post ${index + 1}`
				};
			})
			.filter(Boolean);

		return JSON.stringify({
			'@context': 'https://schema.org',
			'@type': ['CollectionPage', 'Blog'],
			'@id': `${ogUrl}#collection`,
			url: ogUrl,
			name: $t('blog.pageTitle'),
			description: $t('blog.metaDescription'),
			inLanguage: $locale === 'en' ? 'en-US' : 'vi-VN',
			isPartOf: {
				'@type': 'WebSite',
				'@id': `${siteUrl}/#website`
			},
			breadcrumb: {
				'@id': blogBreadcrumbId
			},
			mainEntity: {
				'@type': 'ItemList',
				itemListOrder: 'https://schema.org/ItemListOrderDescending',
				numberOfItems: blogs.length,
				itemListElement
			}
		});
	});

	const categoryLabels = $derived.by(() => ({
		all: $t('blog.categoryAll'),
		guide: $t('blog.categoryGuide'),
		care: $t('blog.categoryCare'),
		knowledge: $t('blog.categoryKnowledge'),
		trend: $t('blog.categoryTrend'),
		product: $t('blog.categoryProduct'),
		design: $t('blog.categoryDesign')
	}));

	const categoryCountByKey = $derived.by(() => {
		const counts = {};
		for (const post of blogs) {
			const key = String(post?.categoryKey || '').trim();
			if (!key) continue;
			counts[key] = (counts[key] || 0) + 1;
		}
		return counts;
	});

	const categories = $derived.by(() => {
		const keys = ['guide', 'care', 'knowledge', 'trend', 'product', 'design'];
		return [
			{ name: categoryLabels.all, value: 'all', count: blogs.length },
			...keys.map((key) => ({
				name: categoryLabels[key] || key,
				value: key,
				count: categoryCountByKey[key] || 0
			}))
		];
	});

	const featuredPosts = $derived(blogs.slice(0, 3));

	const popularTags = $derived([
		$t('blog.tags.tag1'),
		$t('blog.tags.tag2'),
		$t('blog.tags.tag3'),
		$t('blog.tags.tag4'),
		$t('blog.tags.tag5'),
		$t('blog.tags.tag6'),
		$t('blog.tags.tag7'),
		$t('blog.tags.tag8')
	]);

	let selectedCategory = $state('all');
	const BLOG_LOAD_MORE_STEP = 12;
	let visibleCount = $state(BLOG_LOAD_MORE_STEP);
	let searchQuery = $state('');
	let lastQueryParam = $state('');

	const handleSearchSubmit = (event) => {
		event.preventDefault();
		const url = new URL($page.url);
		const query = String(searchQuery || '').trim();
		if (query) {
			url.searchParams.set('q', query);
		} else {
			url.searchParams.delete('q');
		}
		visibleCount = BLOG_LOAD_MORE_STEP;
		goto(`${url.pathname}${url.search}`);
	};

	const truncateWords = (value, limit) => {
		const text = String(value || '')
			.replace(/<[^>]*>/g, ' ')
			.replace(/\s+/g, ' ')
			.trim();
		if (!text) return '';
		const words = text.split(' ');
		if (words.length <= limit) return text;
		return `${words.slice(0, limit).join(' ')}...`;
	};

	const normalizeAssetIndex = (value, max, fallback = 1) => {
		const parsed = Number.parseInt(String(value || ''), 10);
		if (!Number.isFinite(parsed) || parsed < 1) return fallback;
		return ((parsed - 1) % max) + 1;
	};

	const normalizeBlogImage = (imageValue, fallbackIndex = 0) => {
		const fallback = `/images/post-item${(fallbackIndex % 4) + 1}.jpg`;
		const raw = String(imageValue || '').trim();
		if (!raw) return fallback;
		let decoded = raw;
		try {
			decoded = decodeURIComponent(raw);
		} catch {
			decoded = raw;
		}
		const match = decoded.match(/post-item(\d+)\.jpg/i);
		if (!match) return raw;
		const normalizedIndex = normalizeAssetIndex(match[1], 4, 1);
		return `/images/post-item${normalizedIndex}.jpg`;
	};

	const rawBlogListImage = $derived.by(() => normalizeBlogImage(blogs[0]?.image, 0));
	const ogImageUrl = $derived.by(() => toAbsoluteUrl(rawBlogListImage || '/og-image.png'));

	const filteredBlogs = $derived.by(() =>
		selectedCategory === 'all'
			? blogs
			: blogs.filter((post) => post.categoryKey === selectedCategory)
	);

	const currentBlogs = $derived(filteredBlogs.slice(0, visibleCount));
	const hasMoreBlogs = $derived(filteredBlogs.length > visibleCount);
	const blogLoadMoreButtonText = $derived(
		$locale === 'en'
			? `Show ${BLOG_LOAD_MORE_STEP} more articles`
			: `Xem thêm ${BLOG_LOAD_MORE_STEP} bài viết`
	);
	const blogLoadMoreHint = $derived(
		$locale === 'en'
			? `Showing ${currentBlogs.length} / ${filteredBlogs.length} articles`
			: `Đang hiển thị ${currentBlogs.length} / ${filteredBlogs.length} bài viết`
	);
	const blogLoadMoreDoneText = $derived(
		$locale === 'en' ? 'All matching articles are displayed.' : 'Đã hiển thị hết bài viết phù hợp.'
	);
	const lcpBlogListImage = $derived.by(() => normalizeBlogImage(currentBlogs[0]?.image, 0));

	const formatDate = (dateStr) => {
		const date = new Date(dateStr);
		const localeValue = $locale === 'en' ? 'en-US' : 'vi-VN';
		return new Intl.DateTimeFormat(localeValue, {
			day: 'numeric',
			month: 'long',
			year: 'numeric'
		}).format(date);
	};

	const handleCategoryChange = (category) => {
		selectedCategory = category;
		visibleCount = BLOG_LOAD_MORE_STEP;
	};

	const loadMoreBlogs = () => {
		visibleCount += BLOG_LOAD_MORE_STEP;
	};

	const isInteractiveTarget = (target) =>
		Boolean(target?.closest?.('a, button, input, textarea, select, summary, [role="button"]'));

	const openBlogCard = (post) => {
		const href = getBlogPostHref(post);
		if (!href) return;
		goto(href);
	};

	const handleBlogCardClick = (event, post) => {
		if (isInteractiveTarget(event.target)) return;
		openBlogCard(post);
	};

	const handleBlogCardKeydown = (event, post) => {
		if (event.key !== 'Enter' && event.key !== ' ') return;
		if (isInteractiveTarget(event.target)) return;
		event.preventDefault();
		openBlogCard(post);
	};

	$effect(() => {
		if (newsletterSuccess) {
			email = '';
		}
	});

	$effect(() => {
		const queryParam = String($page.url.searchParams.get('q') || '').trim();
		if (queryParam !== lastQueryParam) {
			lastQueryParam = queryParam;
			searchQuery = queryParam;
			visibleCount = BLOG_LOAD_MORE_STEP;
		}
	});
</script>

<svelte:head>
	<title>{$t('blog.pageTitle')}</title>
	<meta name="description" content={$t('blog.metaDescription')} />
	<meta property="og:type" content="website" />
	<meta property="og:url" content={ogUrl} />
	<meta property="og:title" content={$t('blog.pageTitle')} />
	<meta property="og:description" content={$t('blog.metaDescription')} />
	<meta property="og:image" content={ogImageUrl} />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta property="og:image:alt" content={ogImageAlt} />
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content={$t('blog.pageTitle')} />
	<meta name="twitter:description" content={$t('blog.metaDescription')} />
	<meta name="twitter:image" content={ogImageUrl} />
	<meta name="twitter:image:alt" content={ogImageAlt} />
	{@html '<script type="application/ld+json">' + escapeJsonLd(blogBreadcrumbJsonLd) + '</script>'}
	{@html '<script type="application/ld+json">' + escapeJsonLd(blogCollectionJsonLd) + '</script>'}
	{#if lcpBlogListImage}
		<link rel="preload" as="image" href={lcpBlogListImage} fetchpriority="high" />
	{/if}
</svelte:head>

<section class="blog-hero">
	<div class="container blog-hero-inner">
		<div class="blog-hero-grid">
			<div class="hero-copy">
				<h1 class="blog-hero-title">{$t('blog.heroTitle')}</h1>
				<p class="blog-hero-subtitle">{$t('blog.heroSubtitle')}</p>
			</div>

			<div class="hero-search-card">
				<div class="hero-search-label">{$t('common.search')}</div>
				<form class="blog-search" onsubmit={handleSearchSubmit}>
					<label class="visually-hidden" for="blog-search-input">{$t('common.search')}</label>
					<input
						id="blog-search-input"
						type="text"
						name="q"
						placeholder={$t('blog.searchPlaceholder')}
						class="blog-search-input"
						aria-label={$t('common.search')}
						bind:value={searchQuery}
					/>
					<button class="blog-search-btn" type="submit" aria-label={$t('common.search')}>
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<circle cx="11" cy="11" r="8"></circle>
							<path d="m21 21-4.35-4.35"></path>
						</svg>
					</button>
				</form>
				<p class="hero-search-hint">{$t('blog.searchPlaceholder')}</p>
			</div>
		</div>
	</div>
</section>

<section class="blog-section">
	<div class="container" style="max-width: 1200px; margin: 0 auto; padding: 0 1rem;">
		<div class="blog-grid">
			<div class="blog-posts">
				<div class="category-filter">
					<h3 class="filter-title">{$t('blog.filterTitle')}</h3>
					<div class="category-list">
						{#each categories as category}
							<button
								class="category-btn"
								class:active={selectedCategory === category.value}
								onclick={() => handleCategoryChange(category.value)}
							>
								<span>{category.name}</span>
								<span class="category-count">({category.count})</span>
							</button>
						{/each}
					</div>
				</div>

				<div class="posts-grid">
					{#if currentBlogs.length}
						{#each currentBlogs as post, index}
							<div
								class="blog-card"
								role="link"
								tabindex="0"
								aria-label={truncateWords(post.title, 18)}
								onclick={(event) => handleBlogCardClick(event, post)}
								onkeydown={(event) => handleBlogCardKeydown(event, post)}
							>
								<div class="blog-card-image">
									<img
										src={normalizeBlogImage(post.image, index)}
										alt={post.title}
										width="1280"
										height="720"
										loading={index === 0 ? 'eager' : 'lazy'}
										fetchpriority={index === 0 ? 'high' : 'low'}
										decoding="async"
									/>
									<div class="blog-badge">{categoryLabels[post.categoryKey]}</div>
								</div>

								<div class="blog-card-content">
									<h3 class="blog-card-title">
										<a href={getBlogPostHref(post)}>{truncateWords(post.title, 15)}</a>
									</h3>

									<p class="blog-card-excerpt">{truncateWords(post.excerpt, 100)}</p>

									<div class="blog-card-meta">
										<span class="meta-item">
											<svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
												<rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
												<line x1="16" y1="2" x2="16" y2="6"></line>
												<line x1="8" y1="2" x2="8" y2="6"></line>
												<line x1="3" y1="10" x2="21" y2="10"></line>
											</svg>
											{formatDate(post.date)}
										</span>
										<span class="meta-item">
											<svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
												<path
													d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"
												></path>
												<polyline points="12 6 12 12 16 14"></polyline>
											</svg>
											{$t('blog.readTime', { minutes: post.readTimeMinutes })}
										</span>
										<span class="meta-item">
											<svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
												<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
											</svg>
											{$t('blog.views', { count: post.views })}
										</span>
									</div>

									<div class="blog-card-footer">
										<div class="author-info">
											<div
												class="author-avatar"
												style="background: linear-gradient(135deg, #6EA6B9, #E88B9A); color: white;"
											>
												{post.author.charAt(0)}
											</div>
											<div class="author-details">
												<p class="author-name">{post.author}</p>
											</div>
										</div>
										<a href={getBlogPostHref(post, '#comments')} class="blog-comments-link">
											<svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
												<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
												></path>
											</svg>
											{post.comments}
										</a>
									</div>

									<a href={getBlogPostHref(post)} class="blog-read-more">{$t('blog.readMore')}</a>
								</div>
							</div>
						{/each}
					{:else}
						<div class="blog-empty">
							<p>{apiError || $t('blog.heroSubtitle')}</p>
						</div>
					{/if}
				</div>

				{#if filteredBlogs.length}
					<div class="blog-load-more" aria-live="polite">
						<p class="blog-load-more-hint">{blogLoadMoreHint}</p>
						{#if hasMoreBlogs}
							<button class="blog-load-more-btn" type="button" onclick={loadMoreBlogs}>
								{blogLoadMoreButtonText}
							</button>
						{:else}
							<p class="blog-load-more-done">{blogLoadMoreDoneText}</p>
						{/if}
					</div>
				{/if}
			</div>

			<aside class="blog-sidebar">
				<div class="sidebar-widget">
					<h3 class="widget-title">{$t('blog.featuredTitle')}</h3>
					<div class="featured-posts">
						{#each featuredPosts as post, index}
							<a href={getBlogPostHref(post)} class="featured-post">
								<div class="featured-image">
									<img
										src={normalizeBlogImage(post.image, index)}
										alt={post.title}
										width="80"
										height="80"
									/>
								</div>
								<div class="featured-content">
									<h4 class="featured-title">{post.title}</h4>
									<span class="featured-date">{formatDate(post.date)}</span>
								</div>
							</a>
						{/each}
					</div>
				</div>

				<div class="sidebar-widget newsletter-widget">
					<h3 class="widget-title">{$t('blog.newsletterTitle')}</h3>
					<p class="widget-desc">{$t('blog.newsletterDesc')}</p>

					{#if newsletterError}
						<div class="newsletter-alert error">{newsletterError}</div>
					{/if}
					{#if newsletterSuccess}
						<div class="newsletter-alert success">{newsletterMessage}</div>
					{/if}

					<form method="post" action="?/subscribe">
						<input
							type="email"
							name="email"
							bind:value={email}
							placeholder={$t('blog.newsletterPlaceholder')}
							required
							class="newsletter-input"
						/>
						<button type="submit" class="newsletter-btn">
							{$t('blog.newsletterButton')}
						</button>
					</form>
				</div>

				<div class="sidebar-widget">
					<h3 class="widget-title">{$t('blog.tagsTitle')}</h3>
					<div class="tags-list">
						{#each popularTags as tag}
							<span class="tag-btn">{tag}</span>
						{/each}
					</div>
				</div>

				<div class="sidebar-widget info-widget">
					<h3 class="widget-title">{$t('blog.infoTitle')}</h3>
					<div class="info-content">
						<p>
							<strong>{$t('blog.infoAddressLabel')}:</strong><br />
							{$t('footer.address')}
						</p>
						<p>
							<strong>{$t('blog.infoPhoneLabel')}:</strong><br />
							{SITE_CONTACT.phone}
						</p>
						<p>
							<strong>{$t('blog.infoEmailLabel')}:</strong><br />
							<a href={`mailto:${SITE_CONTACT.email}`}>{SITE_CONTACT.email}</a>
						</p>
						<button class="contact-btn">{$t('blog.infoButton')}</button>
					</div>
				</div>
			</aside>
		</div>
	</div>
</section>

<style>
	/* Blog Hero Section */
	.blog-hero {
		position: relative;
		overflow: hidden;
		background:
			radial-gradient(circle at 12% 18%, rgba(110, 166, 185, 0.25), transparent 45%),
			radial-gradient(circle at 85% 0%, rgba(232, 139, 154, 0.25), transparent 45%),
			linear-gradient(135deg, #f0f6f8 0%, #fdf5f7 100%);
		color: #1c2d33;
		padding: clamp(2rem, 4.5vw, 3.5rem) 1rem;
	}

	.blog-hero::before,
	.blog-hero::after {
		content: '';
		position: absolute;
		border-radius: 50%;
		opacity: 0.25;
		filter: blur(0);
	}

	.blog-hero::before {
		width: 220px;
		height: 220px;
		background: rgba(110, 166, 185, 0.35);
		top: -80px;
		left: -60px;
	}

	.blog-hero::after {
		width: 260px;
		height: 260px;
		background: rgba(232, 139, 154, 0.35);
		bottom: -120px;
		right: -80px;
	}

	.blog-hero-inner {
		position: relative;
		max-width: 1200px;
		margin: 0 auto;
		padding: 0 1rem;
		z-index: 1;
	}

	.blog-hero-grid {
		display: grid;
		grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr);
		gap: clamp(1rem, 3vw, 2.25rem);
		align-items: center;
	}

	.hero-copy {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		text-align: left;
	}

	.blog-hero-title {
		font-size: clamp(2.1rem, 3.8vw, 3.4rem);
		font-weight: 700;
		margin: 0;
		line-height: 1.15;
		color: #122228;
	}

	.blog-hero-subtitle {
		font-size: clamp(1rem, 1.6vw, 1.15rem);
		margin: 0;
		color: rgba(18, 34, 40, 0.7);
		max-width: 520px;
	}

	.hero-search-card {
		background: rgba(255, 255, 255, 0.92);
		border-radius: 20px;
		padding: clamp(0.9rem, 2vw, 1.35rem);
		border: 1px solid rgba(90, 143, 163, 0.2);
		box-shadow: 0 24px 48px rgba(17, 34, 40, 0.12);
		backdrop-filter: blur(6px);
	}

	.hero-search-label {
		font-size: 0.8rem;
		text-transform: uppercase;
		letter-spacing: 0.18em;
		font-weight: 700;
		color: rgba(90, 143, 163, 0.8);
		margin-bottom: 0.55rem;
	}

	.blog-search {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 0.5rem;
		background: #f4f7f9;
		border-radius: 14px;
		padding: 0.5rem;
		border: 1px solid rgba(110, 166, 185, 0.2);
	}

	.blog-search-input {
		flex: 1;
		padding: 0.6rem 0.85rem;
		border: none;
		border-radius: 10px;
		font-size: 0.95rem;
		font-family: inherit;
		background: transparent;
		color: #1c2d33;
	}

	.blog-search-input:focus {
		outline: none;
	}

	.blog-search-btn {
		padding: 0.6rem 0.95rem;
		background: linear-gradient(135deg, #6ea6b9 0%, #e88b9a 100%);
		color: white;
		border: none;
		border-radius: 12px;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition:
			transform 0.2s ease,
			box-shadow 0.2s ease;
		box-shadow: 0 12px 24px rgba(110, 166, 185, 0.25);
	}

	.blog-search-btn:hover {
		transform: translateY(-2px);
		box-shadow: 0 16px 30px rgba(110, 166, 185, 0.3);
	}

	.blog-search-btn svg {
		width: 18px;
		height: 18px;
	}

	.hero-search-hint {
		margin: 0.6rem 0 0;
		font-size: 0.9rem;
		color: rgba(18, 34, 40, 0.55);
	}

	/* Blog Section Layout */
	.blog-section {
		padding: 3rem 1rem;
		background: #f9f9f9;
	}

	.blog-grid {
		display: grid;
		grid-template-columns: 1fr 320px;
		gap: 2rem;
	}

	/* Category Filter */
	.category-filter {
		background: white;
		padding: 1rem;
		border-radius: 12px;
		margin-bottom: 1.25rem;
		border: 1px solid #eee;
	}

	.filter-title {
		font-size: 1rem;
		font-weight: 700;
		color: #333;
		margin-bottom: 0.6rem;
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}

	.category-list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.category-btn {
		padding: 0.4rem 0.8rem;
		border: 2px solid #ddd;
		background: white;
		color: #333;
		border-radius: 50px;
		cursor: pointer;
		transition: all 0.3s ease;
		font-weight: 500;
		font-size: 0.9rem;
		white-space: nowrap;
	}

	.category-btn:hover {
		border-color: #6ea6b9;
		color: #6ea6b9;
	}

	.category-btn.active {
		background: #6ea6b9;
		border-color: #6ea6b9;
		color: white;
	}

	.category-count {
		font-size: 0.85rem;
		opacity: 0.8;
	}

	/* Posts Grid */
	.posts-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(330px, 1fr));
		gap: 1.5rem;
		margin-bottom: 2rem;
	}

	.blog-empty {
		grid-column: 1 / -1;
		background: #fff;
		border: 1px solid #eee;
		border-radius: 12px;
		padding: 1.5rem;
		color: #666;
	}

	.blog-card {
		background: white;
		border-radius: 12px;
		overflow: hidden;
		border: 1px solid #eee;
		transition: all 0.3s ease;
		display: flex;
		flex-direction: column;
		cursor: pointer;
		min-height: 680px;
	}

	.blog-card:hover {
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.1);
		border-color: #6ea6b9;
		transform: translateY(-4px);
	}

	.blog-card:focus-visible {
		outline: 3px solid rgba(110, 166, 185, 0.65);
		outline-offset: 2px;
	}

	.blog-card-image {
		position: relative;
		width: 100%;
		aspect-ratio: 16 / 9;
		overflow: hidden;
		background: #f5f5f5;
	}

	.blog-card-image img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		transition: transform 0.3s ease;
	}

	.blog-card:hover .blog-card-image img {
		transform: scale(1.05);
	}

	.blog-badge {
		position: absolute;
		top: 1rem;
		right: 1rem;
		background: #e88b9a;
		color: white;
		padding: 0.4rem 0.8rem;
		border-radius: 50px;
		font-size: 0.8rem;
		font-weight: 600;
	}

	.blog-card-content {
		padding: 1.1rem 1.1rem 1.3rem;
		display: flex;
		flex-direction: column;
		flex: 1;
		overflow: hidden;
	}

	.blog-card-title {
		font-size: 1.1rem;
		font-weight: 700;
		color: #333;
		margin-bottom: 0.6rem;
		line-height: 1.4;
	}

	.blog-card-title a {
		color: #333;
		text-decoration: none;
		transition: color 0.3s ease;
	}

	.blog-card:focus-visible .blog-card-title a,
	.blog-card-title a:hover {
		color: #6ea6b9;
	}

	.blog-card-excerpt {
		color: #666;
		font-size: 0.95rem;
		line-height: 1.6;
		margin-bottom: 0.75rem;
		flex: 1;
	}

	.blog-card-meta {
		display: flex;
		gap: 1rem;
		flex-wrap: wrap;
		margin-bottom: 0.75rem;
		padding-bottom: 0.75rem;
		border-bottom: 1px solid #eee;
		font-size: 0.85rem;
		color: #999;
	}

	.meta-item {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.meta-item svg {
		width: 16px;
		height: 16px;
		opacity: 0.7;
	}

	.blog-card-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.8rem;
		margin-bottom: 0.75rem;
	}

	.author-info {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex: 1;
	}

	.author-avatar {
		width: 36px;
		height: 36px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-weight: 700;
		font-size: 0.9rem;
	}

	.author-name {
		font-size: 0.9rem;
		font-weight: 600;
		color: #333;
		margin: 0;
	}

	.blog-comments-link {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		color: #6ea6b9;
		text-decoration: none;
		font-weight: 600;
		font-size: 0.9rem;
		transition: all 0.3s ease;
		white-space: nowrap;
	}

	.blog-comments-link:hover {
		gap: 0.6rem;
	}

	.blog-comments-link svg {
		width: 16px;
		height: 16px;
	}

	.blog-read-more {
		color: #6ea6b9;
		text-decoration: none;
		font-weight: 600;
		transition: all 0.3s ease;
		display: inline-block;
		margin-top: 0.75rem;
	}

	@media (max-width: 480px) {
		.blog-card {
			min-height: 600px;
		}

		.blog-card-content {
			padding: 0.95rem 0.95rem 1.1rem;
		}

		.blog-card-title {
			font-size: 1rem;
			margin-bottom: 0.45rem;
		}

		.blog-card-excerpt {
			font-size: 0.92rem;
			line-height: 1.5;
		}

		.blog-card-meta {
			gap: 0.75rem;
		}
	}

	.blog-read-more:hover {
		color: #5a8fa3;
		margin-left: 0.5rem;
	}

	/* Load More */
	.blog-load-more {
		display: grid;
		justify-items: center;
		gap: 0.65rem;
		padding: 1rem 0 2rem;
	}

	.blog-load-more-hint,
	.blog-load-more-done {
		margin: 0;
		font-size: 0.9rem;
		color: #667;
		text-align: center;
	}

	.blog-load-more-done {
		font-weight: 600;
		color: #445;
	}

	.blog-load-more-btn {
		padding: 0.75rem 1.25rem;
		border: 1px solid rgba(110, 166, 185, 0.35);
		background: linear-gradient(135deg, #ffffff 0%, #eef8fb 100%);
		color: #356779;
		border-radius: 999px;
		cursor: pointer;
		font-weight: 700;
		transition:
			transform 0.2s ease,
			box-shadow 0.2s ease,
			border-color 0.2s ease;
		box-shadow: 0 10px 22px rgba(110, 166, 185, 0.14);
	}

	.blog-load-more-btn:hover {
		transform: translateY(-2px);
		border-color: rgba(110, 166, 185, 0.55);
		box-shadow: 0 14px 26px rgba(110, 166, 185, 0.2);
	}

	.blog-load-more-btn:active {
		transform: translateY(0);
	}

	/* Sidebar */
	.blog-sidebar {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	.sidebar-widget {
		background: white;
		padding: 1.5rem;
		border-radius: 12px;
		border: 1px solid #eee;
	}

	.widget-title {
		font-size: 1rem;
		font-weight: 700;
		color: #333;
		margin-bottom: 1rem;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		border-bottom: 2px solid #6ea6b9;
		padding-bottom: 0.75rem;
	}

	/* Featured Posts */
	.featured-posts {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.featured-post {
		display: flex;
		gap: 0.75rem;
		text-decoration: none;
		transition: all 0.3s ease;
	}

	.featured-post:hover {
		opacity: 0.8;
	}

	.featured-image {
		width: 80px;
		height: 80px;
		border-radius: 6px;
		overflow: hidden;
		flex-shrink: 0;
		background: #f5f5f5;
	}

	.featured-image img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.featured-content {
		display: flex;
		flex-direction: column;
		justify-content: center;
		flex: 1;
		min-width: 0;
	}

	.featured-title {
		font-size: 0.9rem;
		font-weight: 600;
		color: #333;
		margin: 0;
		line-height: 1.4;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.featured-date {
		font-size: 0.8rem;
		color: #999;
		margin-top: 0.3rem;
	}

	/* Newsletter Widget */
	.newsletter-widget {
		background: linear-gradient(135deg, #f0f8fb 0%, #fff5f7 100%);
		border-color: transparent;
	}

	.newsletter-alert {
		padding: 0.75rem;
		border-radius: 6px;
		margin-bottom: 0.75rem;
		font-weight: 600;
		font-size: 0.9rem;
	}

	.newsletter-alert.error {
		background: #ffe3e3;
		color: #a12a2a;
	}

	.newsletter-alert.success {
		background: #def4e5;
		color: #1c6b3a;
	}

	.widget-desc {
		font-size: 0.9rem;
		color: #666;
		margin-bottom: 1rem;
	}

	.newsletter-input {
		width: 100%;
		padding: 0.75rem;
		border: 1px solid #ddd;
		border-radius: 6px;
		margin-bottom: 0.75rem;
		font-family: inherit;
	}

	.newsletter-input:focus {
		outline: none;
		border-color: #6ea6b9;
	}

	.newsletter-btn {
		width: 100%;
		padding: 0.75rem;
		background: #6ea6b9;
		color: white;
		border: none;
		border-radius: 6px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.3s ease;
	}

	.newsletter-btn:hover {
		background: #5a8fa3;
		transform: translateY(-2px);
	}

	/* Tags */
	.tags-list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.tag-btn {
		padding: 0.5rem 0.875rem;
		background: #f5f5f5;
		color: #333;
		border-radius: 50px;
		text-decoration: none;
		font-size: 0.9rem;
		transition: all 0.3s ease;
		border: 1px solid #eee;
	}

	.tag-btn:hover {
		background: #6ea6b9;
		color: white;
		border-color: #6ea6b9;
	}

	/* Info Widget */
	.info-widget {
		background: linear-gradient(135deg, #f0f8fb 0%, #fff5f7 100%);
		border-color: transparent;
	}

	.info-content {
		font-size: 0.9rem;
		color: #555;
		line-height: 1.8;
	}

	.info-content p {
		margin-bottom: 1rem;
	}

	.info-content a {
		color: #6ea6b9;
		text-decoration: none;
	}

	.info-content a:hover {
		text-decoration: underline;
	}

	.contact-btn {
		width: 100%;
		padding: 0.75rem;
		background: #e88b9a;
		color: white;
		border: none;
		border-radius: 6px;
		font-weight: 600;
		cursor: pointer;
		margin-top: 1rem;
		transition: all 0.3s ease;
	}

	.contact-btn:hover {
		background: #d87885;
		transform: translateY(-2px);
	}

	/* Responsive Design */
	@media (max-width: 992px) {
		.blog-hero-grid {
			grid-template-columns: 1fr;
		}

		.hero-copy {
			text-align: center;
			align-items: center;
		}

		.blog-hero-subtitle {
			max-width: 600px;
		}

		.hero-search-card {
			width: 100%;
		}

		.blog-grid {
			grid-template-columns: 1fr;
		}

		.posts-grid {
			grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		}
	}

	@media (max-width: 768px) {
		.blog-hero {
			padding: 1.3rem 0.75rem;
		}

		.blog-hero-grid {
			gap: 0.75rem;
		}

		.hero-copy {
			gap: 0.35rem;
		}

		.blog-hero-title {
			font-size: clamp(1.45rem, 7vw, 1.95rem);
			line-height: 1.2;
		}

		.blog-hero-subtitle {
			font-size: 0.92rem;
			line-height: 1.45;
		}

		.hero-search-card {
			border-radius: 14px;
			padding: 0.7rem;
		}

		.hero-search-label {
			font-size: 0.66rem;
			margin-bottom: 0.35rem;
		}

		.blog-search {
			grid-template-columns: 1fr auto;
			padding: 0.4rem;
			gap: 0.4rem;
			border-radius: 12px;
		}

		.blog-search-input {
			font-size: 0.88rem;
			padding: 0.5rem 0.65rem;
		}

		.blog-search-btn {
			width: 38px;
			height: 38px;
			padding: 0;
			border-radius: 10px;
		}

		.blog-search-btn svg {
			width: 15px;
			height: 15px;
		}

		.hero-search-hint {
			margin-top: 0.35rem;
			font-size: 0.78rem;
		}

		.category-list {
			gap: 0.5rem;
		}

		.category-btn {
			padding: 0.4rem 0.8rem;
			font-size: 0.85rem;
		}

		.posts-grid {
			grid-template-columns: 1fr;
		}

		.blog-card-content {
			padding: 1rem;
		}

		.blog-load-more-btn {
			width: 100%;
		}
	}

	@media (max-width: 480px) {
		.blog-hero {
			padding: 1rem 0.65rem;
		}

		.blog-hero-grid {
			gap: 0.65rem;
		}

		.blog-hero-title {
			font-size: clamp(1.28rem, 6.5vw, 1.6rem);
		}

		.blog-hero-subtitle {
			font-size: 0.84rem;
		}

		.hero-search-card {
			padding: 0.55rem;
			border-radius: 12px;
		}

		.hero-search-label {
			font-size: 0.62rem;
			margin-bottom: 0.28rem;
		}

		.blog-search {
			padding: 0.34rem;
			gap: 0.32rem;
		}

		.blog-search-input {
			font-size: 0.82rem;
			padding: 0.45rem 0.58rem;
		}

		.blog-search-btn {
			width: 34px;
			height: 34px;
		}

		.blog-search-btn svg {
			width: 14px;
			height: 14px;
		}

		.hero-search-hint {
			font-size: 0.72rem;
			margin-top: 0.3rem;
		}
	}
</style>
