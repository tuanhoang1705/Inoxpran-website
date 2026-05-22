<script>
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { enhance } from '$app/forms';
	import { page } from '$app/stores';
	import { env } from '$env/dynamic/public';
	import RichTextDisplay from '$lib/components/RichTextDisplay.svelte';
	import BlogCommentThread from '$lib/components/BlogCommentThread.svelte';
	import { locale, t } from '$lib/i18n/index.js';
	import { cartToast } from '$lib/stores/cartToast.js';
	import { localizeInternalHref } from '$lib/utils/localePath.js';
	let { data, form } = $props();
	const blogPost = $derived(data?.post ?? null);
	const apiError = $derived(String(data?.apiError || ''));
	const newsletterError = $derived(String(form?.newsletterError || ''));
	const newsletterSuccess = $derived(Boolean(form?.newsletterSuccess));
	const newsletterMessage = $derived(String(form?.newsletterMessage || ''));
	const comments = $derived(Array.isArray(data?.comments) ? data.comments : []);
	const commentsTotal = $derived(Number(data?.commentsTotal) || comments.length);
	const commentsError = $derived(String(data?.commentsError || ''));
	let email = $state('');
	let blogBreadcrumbEl = $state(null);
	const DEFAULT_SITE_URL = 'https://inoxpran.com';
	const normalizeSiteUrl = (value) => {
		const raw = String(value || '').trim();
		if (!raw) return DEFAULT_SITE_URL;
		return raw.replace(/\/+$/, '');
	};
	const siteUrl = $derived(normalizeSiteUrl(env.PUBLIC_SITE_URL));
	const homeHref = $derived(localizeInternalHref('/', $locale));
	const blogHref = $derived(localizeInternalHref('/blog', $locale));
	const getBlogPostHref = (post) => {
		const slug = String(post?.slug || post?.blog_slug || '').trim();
		return slug ? localizeInternalHref(`/blog/${encodeURIComponent(slug)}`, $locale) : blogHref;
	};
	const getTagHref = (tag) => `${blogHref}?tag=${encodeURIComponent(String(tag || '').trim())}`;
	const toAbsoluteUrl = (value) => {
		const raw = String(value || '').trim();
		if (!raw) return '';
		if (/^https?:\/\//i.test(raw)) return raw;
		const normalizedPath = raw.startsWith('/') ? raw : `/${raw}`;
		return `${siteUrl}${normalizedPath}`;
	};
	const escapeJsonLd = (value) =>
		String(value || '')
			.replace(/</g, '\u003c')
			.replace(/>/g, '\u003e')
			.replace(/&/g, '\u0026')
			.replace(/\u2028/g, '\u2028')
			.replace(/\u2029/g, '\u2029');

	const categoryLabels = $derived.by(() => ({
		all: $t('blog.categoryAll'),
		guide: $t('blog.categoryGuide'),
		care: $t('blog.categoryCare'),
		knowledge: $t('blog.categoryKnowledge'),
		trend: $t('blog.categoryTrend'),
		product: $t('blog.categoryProduct'),
		design: $t('blog.categoryDesign')
	}));

	const COMMENT_STORAGE_KEY = 'inoxpran_blog_commenter';
	let commentForm = $state({
		author: '',
		email: '',
		content: ''
	});
	let rememberInfo = $state(false);
	let replyTo = $state(null);
	let commentNotice = $state('');
	let commentError = $state('');
	let lastCommentToastKey = '';

	const formatDate = (dateStr) => {
		const date = new Date(dateStr);
		const localeValue = $locale === 'en' ? 'en-US' : 'vi-VN';
		return new Intl.DateTimeFormat(localeValue, {
			day: 'numeric',
			month: 'long',
			year: 'numeric'
		}).format(date);
	};

	const handleReply = (comment) => {
		replyTo = comment ? { id: comment.id, author: comment.author } : null;
		if (browser) {
			const formEl = document.getElementById('blog-comment-form');
			formEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
		}
	};

	const handleCommentEnhance = () => {
		return async ({ result }) => {
			if (result?.type === 'success') {
				const successMessage = $t('blogDetail.submitSuccess');
				const toastKey = `success:${successMessage}`;
				if (toastKey !== lastCommentToastKey) {
					lastCommentToastKey = toastKey;
					cartToast.show(successMessage, 'success', 2200);
				}
				commentNotice = '';
				commentError = '';
				if (rememberInfo && browser) {
					localStorage.setItem(
						COMMENT_STORAGE_KEY,
						JSON.stringify({
							author: commentForm.author,
							email: commentForm.email
						})
					);
				}
				if (!rememberInfo && browser) {
					localStorage.removeItem(COMMENT_STORAGE_KEY);
					commentForm.author = '';
					commentForm.email = '';
				}
				commentForm.content = '';
				replyTo = null;
				return;
			}

			if (result?.type === 'failure') {
				const failureMessage = result?.data?.commentError || $t('blogDetail.submitFailed');
				const toastKey = `error:${failureMessage}`;
				if (toastKey !== lastCommentToastKey) {
					lastCommentToastKey = toastKey;
					cartToast.show(failureMessage, 'danger', 2800);
				}
				commentError = failureMessage;
				commentNotice = '';
			}
		};
	};

	$effect(() => {
		if (newsletterSuccess) {
			email = '';
		}
	});

	$effect(() => {
		if (form?.commentError) {
			const message = String(form.commentError);
			const toastKey = `error:${message}`;
			if (toastKey !== lastCommentToastKey) {
				lastCommentToastKey = toastKey;
				cartToast.show(message, 'danger', 2800);
			}
			commentError = message;
			commentNotice = '';
		} else if (form?.commentSuccess) {
			const message = $t('blogDetail.submitSuccess');
			const toastKey = `success:${message}`;
			if (toastKey !== lastCommentToastKey) {
				lastCommentToastKey = toastKey;
				cartToast.show(message, 'success', 2200);
			}
			commentError = '';
			commentNotice = '';
		}
	});

	const getHeaderOffset = () => {
		if (!browser) return 0;
		const rootStyles = window.getComputedStyle(document.documentElement);
		const cssHeaderHeight = Number.parseFloat(rootStyles.getPropertyValue('--site-header-height'));
		if (Number.isFinite(cssHeaderHeight) && cssHeaderHeight > 0) {
			return cssHeaderHeight;
		}
		const headerElement = document.querySelector('.site-header');
		const headerHeight = headerElement ? headerElement.getBoundingClientRect().height : 0;
		return Number.isFinite(headerHeight) ? headerHeight : 0;
	};

	const scrollToBlogBreadcrumb = () => {
		if (!browser) return;
		const targetElement = blogBreadcrumbEl || document.querySelector('.blog-breadcrumb');
		if (!targetElement) {
			window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
			return;
		}
		const headerOffset = getHeaderOffset() + 12;
		const currentY = window.scrollY;
		const nextY = Math.max(0, currentY + targetElement.getBoundingClientRect().top - headerOffset);
		window.scrollTo({ top: nextY, left: 0, behavior: 'auto' });
	};

	onMount(() => {
		if (browser) {
			try {
				const saved = localStorage.getItem(COMMENT_STORAGE_KEY);
				if (saved) {
					const parsed = JSON.parse(saved);
					if (parsed?.author) commentForm.author = parsed.author;
					if (parsed?.email) commentForm.email = parsed.email;
					if (parsed?.author || parsed?.email) rememberInfo = true;
				}
			} catch {}
		}

		scrollToBlogBreadcrumb();
		requestAnimationFrame(() => {
			requestAnimationFrame(() => scrollToBlogBreadcrumb());
		});
		const initialScrollTimer = setTimeout(() => scrollToBlogBreadcrumb(), 140);
		return () => {
			clearTimeout(initialScrollTimer);
		};
	});

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

	const lcpBlogImage = $derived(normalizeBlogImage(blogPost?.image, 0));
	const seoTitle = $derived(
		blogPost?.title ? `${blogPost.title} | Inoxpran Blog` : 'Inoxpran Blog'
	);
	const seoDescription = $derived(blogPost?.excerpt || $t('blog.metaDescription'));
	const toIsoDate = (value) => {
		if (!value) return '';
		const parsed = new Date(value);
		if (Number.isNaN(parsed.getTime())) return '';
		return parsed.toISOString();
	};
	const ogImageUrl = $derived.by(() => {
		const image = lcpBlogImage || '/og-image.png';
		return toAbsoluteUrl(image);
	});
	const canonicalUrl = $derived.by(() => {
		const rawCanonical = String(data?.canonicalUrl || '').trim();
		if (rawCanonical) return rawCanonical;
		const pathname = $page.url?.pathname || '/blog';
		return `${siteUrl}${pathname}`;
	});
	const articleBreadcrumbId = $derived(`${canonicalUrl}#breadcrumb`);
	const articleBreadcrumbJsonLd = $derived.by(() =>
		JSON.stringify({
			'@context': 'https://schema.org',
			'@type': 'BreadcrumbList',
			'@id': articleBreadcrumbId,
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
					item: `${siteUrl}${blogHref}`
				},
				{
					'@type': 'ListItem',
					position: 3,
					name: blogPost?.title || 'Blog',
					item: canonicalUrl
				}
			]
		})
	);
	const articleJsonLd = $derived.by(() => {
		if (!blogPost?.title) return '';
		const publishedDate = toIsoDate(blogPost?.publishedAt || blogPost?.date);
		const modifiedDate = toIsoDate(blogPost?.updatedAt || blogPost?.modifiedAt || blogPost?.date);
		const categoryLabel = categoryLabels[blogPost.categoryKey] || blogPost.categoryKey || '';
		const articleData = {
			'@context': 'https://schema.org',
			'@type': ['Article', 'BlogPosting'],
			'@id': `${canonicalUrl}#article`,
			url: canonicalUrl,
			headline: blogPost.title,
			description: seoDescription,
			mainEntityOfPage: {
				'@type': 'WebPage',
				'@id': canonicalUrl
			},
			author: {
				'@type': 'Person',
				name: blogPost.author || 'Inoxpran'
			},
			publisher: {
				'@type': 'Organization',
				'@id': `${siteUrl}/#organization`,
				name: 'Inoxpran',
				logo: {
					'@type': 'ImageObject',
					url: `${siteUrl}/images/logo-inoxpran.png`
				}
			},
			image: ogImageUrl ? [ogImageUrl] : undefined,
			datePublished: publishedDate || undefined,
			dateModified: modifiedDate || undefined,
			articleSection: categoryLabel || undefined,
			breadcrumb: {
				'@id': articleBreadcrumbId
			},
			isPartOf: {
				'@type': 'WebSite',
				'@id': `${siteUrl}/#website`
			},
			inLanguage: $locale === 'en' ? 'en-US' : 'vi-VN'
		};

		if (!articleData.image) delete articleData.image;
		if (!articleData.datePublished) delete articleData.datePublished;
		if (!articleData.dateModified) delete articleData.dateModified;
		if (!articleData.articleSection) delete articleData.articleSection;

		return JSON.stringify(articleData);
	});

	const publishedIso = $derived(toIsoDate(blogPost?.publishedAt || blogPost?.date));
	const modifiedIso = $derived(
		toIsoDate(blogPost?.updatedAt || blogPost?.modifiedAt || blogPost?.date)
	);
	const articleSectionMeta = $derived(
		categoryLabels[blogPost?.categoryKey] || blogPost?.categoryKey || ''
	);
	const ogImageAlt = $derived(blogPost?.title || seoTitle);
	const shareTitle = $derived(blogPost?.title || $t('blog.pageTitle'));
	const shareText = $derived(blogPost?.excerpt || $t('blog.metaDescription'));
	const shareUrl = $derived(canonicalUrl);

	const openShareWindow = (url) => {
		if (!browser || !url) return;
		const width = 640;
		const height = 640;
		const left = window.screenX + Math.max(0, (window.outerWidth - width) / 2);
		const top = window.screenY + Math.max(0, (window.outerHeight - height) / 2);
		window.open(
			url,
			'share',
			`width=${width},height=${height},left=${left},top=${top},noopener,noreferrer`
		);
	};

	const shareWithNative = async () => {
		if (!browser) return;
		if (navigator?.share) {
			try {
				await navigator.share({
					title: shareTitle,
					text: shareText,
					url: shareUrl
				});
				return;
			} catch {
				return;
			}
		}
		openShareWindow(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`);
	};

	const shareOnFacebook = () =>
		openShareWindow(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`);
	const shareOnZalo = () =>
		openShareWindow(`https://zalo.me/share?url=${encodeURIComponent(shareUrl)}`);
</script>

<svelte:head>
	<title>{seoTitle}</title>
	<meta name="description" content={seoDescription} />
	<meta property="og:type" content="article" />
	<meta property="og:url" content={canonicalUrl} />
	<meta property="og:title" content={seoTitle} />
	<meta property="og:description" content={seoDescription} />
	<meta property="og:image" content={ogImageUrl} />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta property="og:image:alt" content={ogImageAlt} />
	{#if publishedIso}<meta property="article:published_time" content={publishedIso} />{/if}
	{#if modifiedIso}<meta property="article:modified_time" content={modifiedIso} />{/if}
	{#if blogPost?.author}<meta property="article:author" content={blogPost.author} />{/if}
	{#if articleSectionMeta}<meta property="article:section" content={articleSectionMeta} />{/if}
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content={seoTitle} />
	<meta name="twitter:description" content={seoDescription} />
	<meta name="twitter:image" content={ogImageUrl} />
	<meta name="twitter:image:alt" content={ogImageAlt} />
	{#if articleBreadcrumbJsonLd}
		{@html '<script type="application/ld+json">' +
			escapeJsonLd(articleBreadcrumbJsonLd) +
			'</script>'}
	{/if}
	{#if articleJsonLd}
		{@html '<script type="application/ld+json">' + escapeJsonLd(articleJsonLd) + '</script>'}
	{/if}
	{#if lcpBlogImage}
		<link rel="preload" as="image" href={lcpBlogImage} fetchpriority="high" />
	{/if}
</svelte:head>

{#if blogPost}
	<section class="blog-post-header">
		<div class="container" style="max-width: 1200px; margin: 0 auto; padding: 0rem 1rem;">
			<div class="blog-breadcrumb" bind:this={blogBreadcrumbEl}>
				<a href={homeHref}>{$t('common.home')}</a>
				<span>/</span>
				<a href={blogHref}>{$t('common.blog')}</a>
				<span>/</span>
				<span>{blogPost.title}</span>
			</div>

			<h1 class="blog-post-title">{blogPost.title}</h1>

			<div class="blog-post-meta">
				<div class="meta-left">
					<div class="meta-author-row">
						<div class="author-box">
							<div
								class="author-avatar"
								style="background: linear-gradient(135deg, #6EA6B9, #E88B9A); color: white;"
							>
								{blogPost.authorAvatar}
							</div>
							<div class="author-info">
								<p class="author-name">{blogPost.author}</p>
								<p class="author-role">{$t('blogDetail.authorRole')}</p>
							</div>
						</div>
					</div>

					<div class="meta-right">
						<div class="meta-items">
							<span class="meta-item">
								<svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
									<rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
									<line x1="16" y1="2" x2="16" y2="6"></line>
									<line x1="8" y1="2" x2="8" y2="6"></line>
									<line x1="3" y1="10" x2="21" y2="10"></line>
								</svg>
								{formatDate(blogPost.date)}
							</span>
							<span class="meta-item">
								<svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
									<path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"
									></path>
									<polyline points="12 6 12 12 16 14"></polyline>
								</svg>
								{$t('blog.readTime', { minutes: blogPost.readTimeMinutes })}
							</span>
							<span class="meta-item">
								<svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
									<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
									<circle cx="12" cy="12" r="3"></circle>
								</svg>
								{$t('blog.views', { count: blogPost.views })}
							</span>
						</div>

						<button
							type="button"
							class="share-btn"
							title={$t('blogDetail.shareTooltip')}
							aria-label={$t('blogDetail.shareTooltip')}
							onclick={shareWithNative}
						>
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
								<circle cx="18" cy="5" r="3"></circle>
								<circle cx="6" cy="12" r="3"></circle>
								<circle cx="18" cy="19" r="3"></circle>
								<line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
								<line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
							</svg>
						</button>
					</div>
				</div>
			</div>
		</div>
	</section>

	<section style="background: #f9f9f9;">
		<div class="container" style="max-width: 900px; margin: 0 auto; padding: 2rem 1rem;">
			<div class="featured-image-container">
				<img
					src={lcpBlogImage}
					alt={blogPost.title}
					width="1200"
					height="675"
					loading="eager"
					fetchpriority="high"
					decoding="async"
				/>
			</div>
		</div>
	</section>

	<section style="padding: 3rem 1rem; background: white;">
		<div class="blog-content-wrapper">
			<article class="blog-post-content">
				<div class="content-text">
					<RichTextDisplay content={blogPost.content} />
				</div>

				<div class="share-section">
					<span>{$t('blogDetail.shareLabel')}</span>
					<div class="share-buttons">
						<button
							type="button"
							class="share-social facebook"
							aria-label="Facebook"
							onclick={shareOnFacebook}
						>
							<svg viewBox="0 0 24 24" fill="currentColor">
								<path d="M18 2h-3a6 6 0 0 0-6 6v3H7v4h2v8h4v-8h3l1-4h-4V8a2 2 0 0 1 2-2h1z"></path>
							</svg>
						</button>
						<button type="button" class="share-social zalo" aria-label="Zalo" onclick={shareOnZalo}>
							<span class="share-social-label">Zalo</span>
						</button>
					</div>
				</div>

				<div class="post-tags">
					<span>{$t('blogDetail.tagsLabel')}</span>
					<div class="tag-list">
						{#each [$t('blogDetail.tags.tag1'), $t('blogDetail.tags.tag2'), $t('blogDetail.tags.tag3'), $t('blogDetail.tags.tag4')] as tag}
							<a href={getTagHref(tag)} class="post-tag">{tag}</a>
						{/each}
					</div>
				</div>
			</article>

			<aside class="post-sidebar">
				<div class="sidebar-widget">
					<h3 class="widget-title">{$t('blogDetail.aboutAuthorTitle')}</h3>
					<div class="author-card">
						<div
							class="author-avatar-large"
							style="background: linear-gradient(135deg, #6EA6B9, #E88B9A); color: white;"
						>
							{blogPost.authorAvatar}
						</div>
						<h4 class="author-name-large">{blogPost.author}</h4>
						<p class="author-bio">{$t('blogDetail.authorBio')}</p>
					</div>
				</div>

				<div class="sidebar-widget">
					<h3 class="widget-title">{$t('blogDetail.relatedTitle')}</h3>
					<div class="related-posts-list">
						{#each blogPost.relatedPosts || [] as post, index}
							<a href={getBlogPostHref(post)} class="related-post-item">
								<div class="related-image">
									<img
										src={normalizeBlogImage(post.image, index + 1)}
										alt={post.title}
										width="80"
										height="80"
										loading="lazy"
										fetchpriority="low"
										decoding="async"
									/>
								</div>
								<div class="related-content">
									<h4 class="related-title">{post.title}</h4>
									<span class="related-date">{formatDate(post.date)}</span>
								</div>
							</a>
						{/each}
					</div>
				</div>

				<div class="sidebar-widget newsletter-widget">
					<h3 class="widget-title">{$t('blogDetail.newsletterTitle')}</h3>
					<p class="widget-desc">{$t('blogDetail.newsletterDesc')}</p>
					{#if newsletterError}
						<div class="newsletter-alert error">{newsletterError}</div>
					{/if}
					{#if newsletterSuccess}
						<div class="newsletter-alert success">{newsletterMessage}</div>
					{/if}
					<form method="post" action="?/subscribe" use:enhance>
						<input
							type="email"
							name="email"
							bind:value={email}
							placeholder={$t('blogDetail.newsletterPlaceholder')}
							required
							class="newsletter-input"
						/>
						<button type="submit" class="newsletter-btn">{$t('blogDetail.newsletterButton')}</button
						>
					</form>
				</div>
			</aside>
		</div>
	</section>

	<section id="comments" style="padding: 3rem 1rem; background: #f9f9f9;">
		<div class="container" style="max-width: 900px; margin: 0 auto;">
			<div class="comments-section">
				<h2 class="comments-title">
					{$t('blogDetail.commentsTitle', { count: commentsTotal })}
				</h2>

				{#if commentsError}
					<div class="comment-alert error">{commentsError}</div>
				{/if}

				{#if comments.length}
					<div class="comments-list">
						<BlogCommentThread
							{comments}
							onReply={handleReply}
							{formatDate}
							replyLabel={$t('blogDetail.reply')}
						/>
					</div>
				{:else}
					<div class="comment-empty">{$t('blogDetail.commentEmpty')}</div>
				{/if}

				<div class="comment-form">
					<h3 class="form-title">{$t('blogDetail.replyTitle')}</h3>
					{#if commentError}
						<div class="comment-alert error">{commentError}</div>
					{/if}
					{#if replyTo}
						<div class="reply-pill">
							<span>{$t('blogDetail.replyingTo', { name: replyTo.author })}</span>
							<button
								type="button"
								onclick={() => (replyTo = null)}
								aria-label={$t('blogDetail.cancelReply')}
							>
								×
							</button>
						</div>
					{/if}
					<form
						id="blog-comment-form"
						method="post"
						action="?/comment"
						use:enhance={handleCommentEnhance}
						onsubmit={() => {
							commentNotice = '';
							commentError = '';
						}}
					>
						<input type="hidden" name="parentId" value={replyTo?.id || ''} />
						<div class="form-row">
							<input
								type="text"
								placeholder={$t('blogDetail.namePlaceholder')}
								required
								name="author"
								bind:value={commentForm.author}
								class="form-input"
							/>
							<input
								type="email"
								placeholder={$t('blogDetail.emailPlaceholder')}
								required
								name="email"
								bind:value={commentForm.email}
								class="form-input"
							/>
						</div>
						<textarea
							placeholder={$t('blogDetail.commentPlaceholder')}
							required
							rows="5"
							name="content"
							bind:value={commentForm.content}
							class="form-textarea"
						></textarea>
						<label class="checkbox-label">
							<input type="checkbox" bind:checked={rememberInfo} />
							<span>{$t('blogDetail.rememberInfo')}</span>
						</label>
						<button type="submit" class="submit-btn">{$t('blogDetail.submitComment')}</button>
					</form>
				</div>
			</div>
		</div>
	</section>

	<section style="padding: 3rem 1rem; background: white;">
		<div class="container" style="max-width: 1200px; margin: 0 auto;">
			<h2 class="section-title">{$t('blogDetail.otherPostsTitle')}</h2>
			<div class="posts-carousel">
				{#each blogPost.relatedPosts || [] as post, index}
					<a href={getBlogPostHref(post)} class="carousel-card">
						<div class="carousel-image">
							<img
								src={normalizeBlogImage(post.image, index + 1)}
								alt={post.title}
								width="1280"
								height="720"
								loading="lazy"
								fetchpriority="low"
								decoding="async"
							/>
						</div>
						<div class="carousel-content">
							<h3 class="carousel-title">{post.title}</h3>
							<span class="carousel-date">{formatDate(post.date)}</span>
						</div>
					</a>
				{/each}
			</div>
		</div>
	</section>
{:else}
	<section style="padding: 3rem 1rem; background: white;">
		<div class="container" style="max-width: 900px; margin: 0 auto; text-align: center;">
			<h1 class="blog-post-title">{$t('blog.pageTitle')}</h1>
			<p>{apiError || 'Blog not found.'}</p>
			<a href={blogHref}>{$t('common.blog')}</a>
		</div>
	</section>
{/if}

<style>
	/* Blog Post Header */
	.blog-post-header {
		background: white;
		border-bottom: 1px solid #eee;
		padding: 0.85rem 0.85rem;
	}

	.blog-breadcrumb {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.4rem;
		font-size: 0.9rem;
	}

	.blog-breadcrumb a {
		color: #6ea6b9;
		text-decoration: none;
		transition: color 0.3s ease;
	}

	.blog-breadcrumb a:hover {
		color: #5a8fa3;
	}

	.blog-breadcrumb span {
		color: #999;
	}

	.blog-post-title {
		font-size: 2rem;
		font-weight: 700;
		color: #333;
		line-height: 1.3;
		margin-bottom: 0.5rem;
	}

	.blog-post-meta {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 0.7rem;
		padding-top: 0.55rem;
		border-top: 1px solid #eee;
	}

	.meta-left {
		display: grid;
		grid-template-columns: auto 1fr;
		align-items: center;
		column-gap: 0.85rem;
		row-gap: 0.5rem;
		width: 100%;
	}

	.meta-author-row {
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.meta-right {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		justify-content: flex-end;
		flex-wrap: wrap;
		width: 100%;
	}

	.meta-items {
		display: grid;
		grid-auto-flow: column;
		grid-auto-columns: max-content;
		align-items: center;
		column-gap: 0.7rem;
		justify-content: start;
		justify-self: end;
		margin-left: 0;
		width: auto;
	}

	.author-box {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.author-avatar {
		width: 48px;
		height: 48px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-weight: 700;
	}

	.author-info p {
		margin: 0;
		line-height: 1.4;
	}

	.author-name {
		font-weight: 600;
		color: #333;
		font-size: 0.95rem;
	}

	.author-role {
		color: #999;
		font-size: 0.85rem;
	}

	.meta-item {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		color: #666;
		font-size: 0.9rem;
		white-space: nowrap;
	}

	.meta-item svg {
		width: 18px;
		height: 18px;
		color: #6ea6b9;
	}

	.share-btn {
		width: 44px;
		height: 44px;
		border: 2px solid #ddd;
		background: white;
		border-radius: 6px;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.3s ease;
	}

	.share-btn:hover {
		border-color: #6ea6b9;
		background: #f0f8fb;
	}

	.share-btn svg {
		width: 22px;
		height: 22px;
		color: #6ea6b9;
	}

	/* Featured Image */
	.featured-image-container {
		width: 100%;
		aspect-ratio: 16 / 9;
		border-radius: 12px;
		overflow: hidden;
		background: #f5f5f5;
	}

	.featured-image-container img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	/* Blog Content Layout */
	.blog-content-wrapper {
		display: grid;
		grid-template-columns: 1fr 320px;
		gap: 2rem;
		max-width: 1000px;
		margin: 0 auto;
	}

	.blog-post-content {
		background: white;
	}

	.content-text :global(h2) {
		font-size: 1.5rem;
		font-weight: 700;
		color: #333;
		margin: 2rem 0 1rem;
		line-height: 1.3;
	}

	.content-text :global(h3) {
		font-size: 1.2rem;
		font-weight: 600;
		color: #333;
		margin: 1.5rem 0 0.75rem;
	}

	.content-text :global(p) {
		color: #555;
		line-height: 1.8;
		margin-bottom: 1rem;
		font-size: 1rem;
	}

	.content-text :global(ul),
	.content-text :global(ol) {
		margin: 1rem 0 1rem 2rem;
		color: #555;
		line-height: 1.8;
	}

	.content-text :global(li) {
		margin-bottom: 0.5rem;
	}

	.content-text :global(strong) {
		color: #333;
		font-weight: 600;
	}

	/* Share Section */
	.share-section {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-top: 2rem;
		padding: 1.5rem 0;
		border-top: 1px solid #eee;
		border-bottom: 1px solid #eee;
	}

	.share-buttons {
		display: flex;
		gap: 0.75rem;
	}

	.share-social {
		width: 44px;
		height: 44px;
		border: 2px solid #ddd;
		background: white;
		border-radius: 6px;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.3s ease;
	}

	.share-social:hover {
		transform: translateY(-2px);
	}

	.share-social.facebook {
		border-color: #1877f2;
		color: #1877f2;
	}

	.share-social.facebook:hover {
		background: #1877f2;
		color: white;
	}

	.share-social.zalo {
		border-color: #0068ff;
		color: #0068ff;
	}

	.share-social.zalo:hover {
		background: #0068ff;
		color: white;
	}

	.share-social svg {
		width: 20px;
		height: 20px;
	}

	.share-social-label {
		font-size: 0.72rem;
		font-weight: 700;
		line-height: 1;
		letter-spacing: 0.02em;
	}

	/* Tags */
	.post-tags {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-top: 1.5rem;
		flex-wrap: wrap;
	}

	.tag-list {
		display: flex;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.post-tag {
		padding: 0.4rem 0.875rem;
		background: #f5f5f5;
		color: #333;
		border-radius: 50px;
		text-decoration: none;
		font-size: 0.9rem;
		transition: all 0.3s ease;
		border: 1px solid #eee;
	}

	.post-tag:hover {
		background: #6ea6b9;
		color: white;
		border-color: #6ea6b9;
	}

	/* Sidebar */
	.post-sidebar {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		height: fit-content;
		position: sticky;
		top: 2rem;
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

	/* Author Card */
	.author-card {
		text-align: center;
	}

	.author-avatar-large {
		width: 80px;
		height: 80px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-weight: 700;
		font-size: 1.5rem;
		margin: 0 auto 1rem;
	}

	.author-name-large {
		font-size: 1rem;
		font-weight: 600;
		color: #333;
		margin: 0.5rem 0;
	}

	.author-bio {
		font-size: 0.9rem;
		color: #666;
		line-height: 1.6;
		margin-bottom: 0px;
	}

	.follow-btn {
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

	.follow-btn:hover {
		background: #5a8fa3;
		transform: translateY(-2px);
	}

	/* Related Posts List */
	.related-posts-list {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.related-post-item {
		display: flex;
		gap: 0.75rem;
		text-decoration: none;
		transition: all 0.3s ease;
	}

	.related-post-item:hover {
		opacity: 0.8;
	}

	.related-image {
		width: 80px;
		height: 80px;
		border-radius: 6px;
		overflow: hidden;
		flex-shrink: 0;
		background: #f5f5f5;
	}

	.related-image img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.related-content {
		display: flex;
		flex-direction: column;
		justify-content: center;
		flex: 1;
		min-width: 0;
	}

	.related-title {
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

	.related-date {
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

	/* Comments Section */
	.comments-section {
		max-width: 900px;
		margin: 0 auto;
	}

	.comments-title {
		font-size: 1.5rem;
		font-weight: 700;
		color: #333;
		margin-bottom: 2rem;
	}

	.comments-list {
		margin-bottom: 2.5rem;
	}

	:global(.comment-item) {
		display: flex;
		gap: 1rem;
		padding: 1.25rem 1.5rem;
		background: white;
		border-radius: 8px;
		border: 1px solid #eee;
		box-shadow: 0 12px 24px rgba(0, 0, 0, 0.04);
	}

	:global(.comment-avatar) {
		width: 48px;
		height: 48px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-weight: 700;
		flex-shrink: 0;
		background: linear-gradient(135deg, #6ea6b9, #e88b9a);
		color: #fff;
	}

	:global(.comment-content) {
		flex: 1;
	}

	:global(.comment-header) {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-bottom: 0.75rem;
	}

	:global(.comment-author) {
		font-weight: 600;
		color: #333;
		margin: 0;
	}

	:global(.comment-date) {
		color: #999;
		font-size: 0.9rem;
	}

	:global(.comment-text) {
		color: #555;
		line-height: 1.6;
		margin-bottom: 1rem;
	}

	:global(.comment-reply-btn) {
		color: #6ea6b9;
		background: none;
		border: none;
		cursor: pointer;
		font-weight: 600;
		transition: all 0.3s ease;
	}

	:global(.comment-reply-btn:hover) {
		color: #5a8fa3;
	}

	:global(.comment-thread) {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	:global(.comment-children) {
		margin-top: 1rem;
		padding-left: 1rem;
		border-left: 2px solid #eef2f4;
	}

	.comment-empty {
		padding: 1.5rem;
		background: #fff;
		border: 1px dashed #e0e0e0;
		border-radius: 8px;
		color: #777;
		margin-bottom: 2rem;
	}

	/* Comment Form */
	.comment-form {
		background: white;
		padding: 2rem;
		border-radius: 12px;
	}

	.form-title {
		font-size: 1.25rem;
		font-weight: 700;
		color: #333;
		margin-bottom: 1.5rem;
	}

	.form-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
		margin-bottom: 1rem;
	}

	.form-input,
	.form-textarea {
		width: 100%;
		padding: 0.75rem;
		border: 1px solid #ddd;
		border-radius: 6px;
		font-family: inherit;
		font-size: 1rem;
	}

	.form-input:focus,
	.form-textarea:focus {
		outline: none;
		border-color: #6ea6b9;
		box-shadow: 0 0 0 3px rgba(110, 166, 185, 0.1);
	}

	.form-textarea {
		grid-column: 1 / -1;
		resize: vertical;
		margin-bottom: 1rem;
	}

	.checkbox-label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: #555;
		cursor: pointer;
		margin-bottom: 1.5rem;
		font-size: 0.9rem;
	}

	.submit-btn {
		padding: 0.75rem 2rem;
		background: #6ea6b9;
		color: white;
		border: none;
		border-radius: 6px;
		font-weight: 600;
		font-size: 1rem;
		cursor: pointer;
		transition: all 0.3s ease;
	}

	.submit-btn:hover {
		background: #5a8fa3;
		transform: translateY(-2px);
	}

	.comment-alert {
		padding: 0.75rem 1rem;
		border-radius: 6px;
		margin-bottom: 1rem;
		font-weight: 600;
		font-size: 0.9rem;
	}

	.comment-alert.success {
		background: #def4e5;
		color: #1c6b3a;
	}

	.comment-alert.error {
		background: #ffe3e3;
		color: #a12a2a;
	}

	.reply-pill {
		display: inline-flex;
		align-items: center;
		gap: 0.75rem;
		background: #f0f8fb;
		color: #2d5866;
		padding: 0.4rem 0.75rem;
		border-radius: 999px;
		font-size: 0.85rem;
		margin-bottom: 1rem;
		border: 1px solid rgba(110, 166, 185, 0.4);
	}

	.reply-pill button {
		background: none;
		border: none;
		cursor: pointer;
		font-size: 1rem;
		line-height: 1;
		color: inherit;
	}

	/* Related Posts Carousel */
	.section-title {
		font-size: 1.5rem;
		font-weight: 700;
		color: #333;
		margin-bottom: 2rem;
		text-align: center;
	}

	.posts-carousel {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 1rem;
	}

	.carousel-card {
		background: white;
		border-radius: 12px;
		overflow: hidden;
		border: 1px solid #eee;
		text-decoration: none;
		transition: all 0.3s ease;
		display: flex;
		flex-direction: column;
		height: 100%;
	}

	.carousel-card:hover {
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.1);
		border-color: #6ea6b9;
		transform: translateY(-4px);
	}

	.carousel-image {
		width: 100%;
		aspect-ratio: 16 / 9;
		overflow: hidden;
		background: #f5f5f5;
	}

	.carousel-image img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		transition: transform 0.3s ease;
	}

	.carousel-card:hover .carousel-image img {
		transform: scale(1.05);
	}

	.carousel-content {
		padding: 1rem 1.1rem 1.1rem;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		flex: 1;
	}

	.carousel-title {
		font-size: 0.95rem;
		font-weight: 700;
		color: #333;
		margin: 0 0 0.5rem;
		line-height: 1.4;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.carousel-date {
		font-size: 0.85rem;
		color: #999;
		margin-top: auto;
	}

	@media (min-width: 1024px) {
		.posts-carousel {
			grid-template-columns: repeat(4, minmax(0, 1fr));
			gap: 1.25rem;
		}
	}

	/* Responsive */
	@media (max-width: 992px) {
		.blog-post-title {
			font-size: 1.75rem;
		}

		.blog-content-wrapper {
			grid-template-columns: 1fr;
		}

		.post-sidebar {
			position: static;
		}

		.blog-post-meta {
			flex-direction: column;
			align-items: flex-start;
		}

		.meta-left {
			grid-template-columns: 1fr;
		}

		.meta-right {
			justify-content: flex-start;
		}

		.meta-items {
			grid-auto-flow: row;
			grid-auto-columns: unset;
			grid-template-columns: repeat(3, minmax(0, 1fr));
			justify-content: start;
			width: 100%;
		}
	}

	@media (max-width: 768px) {
		.blog-post-meta {
			flex-direction: column;
			gap: 1rem;
		}

		.author-box {
			width: 100%;
		}

		.meta-right {
			display: flex;
			flex-direction: column;
			align-items: flex-start;
			gap: 0.75rem;
		}

		.meta-items {
			gap: 0.6rem;
			width: 100%;
		}

		.form-row {
			grid-template-columns: 1fr;
		}

		.posts-carousel {
			grid-template-columns: repeat(2, minmax(0, 1fr));
			gap: 0.9rem;
		}

		.carousel-content {
			padding: 0.85rem 0.9rem 0.95rem;
		}

		.carousel-title {
			font-size: 0.9rem;
		}
	}

	@media (max-width: 480px) {
		.posts-carousel {
			gap: 0.75rem;
		}

		.carousel-image {
			aspect-ratio: 4 / 3;
		}
	}

	@media (max-width: 576px) {
		.meta-right {
			display: grid;
			grid-template-columns: minmax(0, 1fr) auto;
			align-items: end;
			column-gap: 0.8rem;
		}

		.meta-items {
			grid-template-columns: repeat(2, minmax(0, 1fr));
			column-gap: 1rem;
			row-gap: 0.6rem;
		}

		.meta-item:first-child {
			grid-column: 1 / -1;
		}

		.share-btn {
			align-self: end;
		}

		.meta-item {
			font-size: 0.85rem;
		}

		.meta-item svg {
			width: 16px;
			height: 16px;
		}
	}
</style>
