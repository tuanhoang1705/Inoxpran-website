<script>
	import { page } from '$app/stores';
	import { localizeInternalHref } from '$lib/utils/localePath.js';

	let { status, error } = $props();

	const isNotFound = status === 404;
	const currentLocale = $derived($page.data?.locale === 'en' ? 'en' : 'vi');
	const isEnglish = $derived(currentLocale === 'en');
	const copy = $derived(
		isEnglish
			? {
					title: isNotFound ? 'Page not found' : 'Something went wrong',
					eyebrow: isNotFound ? '404 - Page not found' : 'System error',
					lead: isNotFound
						? 'The page you are looking for is no longer available.'
						: 'There was a problem loading this content. Please try again later.',
					helper: isNotFound
						? 'Return to Inoxpran or browse the shop for kitchenware products.'
						: 'If the problem continues, please contact Inoxpran support.',
					description:
						'Inoxpran error page with quick navigation to the shop, blog and customer support.',
					detailLabel: 'Details',
					home: 'Inoxpran home',
					shop: 'Explore kitchenware',
					quickLinks: 'Quick links:',
					catalog: 'Catalog',
					blog: 'Kitchen tips',
					contact: 'Contact support'
				}
			: {
					title: isNotFound ? 'Không tìm thấy trang' : 'Có lỗi xảy ra',
					eyebrow: isNotFound ? '404 - Không tìm thấy trang' : 'Lỗi hệ thống',
					lead: isNotFound
						? 'Trang bạn cần không còn ở đây.'
						: 'Đã có sự cố khi tải nội dung. Vui lòng thử lại sau.',
					helper: isNotFound
						? 'Hãy quay về Inoxpran hoặc ghé khu mua sắm để khám phá sản phẩm gia dụng mới.'
						: 'Nếu lỗi tiếp diễn, hãy liên hệ đội hỗ trợ của Inoxpran.',
					description:
						'Trang lỗi của Inoxpran với gợi ý điều hướng nhanh đến danh mục gia dụng, mua sắm và hỗ trợ khách hàng.',
					detailLabel: 'Chi tiết',
					home: 'Về Inoxpran',
					shop: 'Khám phá gia dụng',
					quickLinks: 'Gợi ý nhanh:',
					catalog: 'Danh mục',
					blog: 'Mẹo nhà bếp',
					contact: 'Liên hệ hỗ trợ'
				}
	);
	const homeHref = $derived(localizeInternalHref('/', currentLocale));
	const shopHref = $derived(localizeInternalHref('/shop', currentLocale));
	const blogHref = $derived(localizeInternalHref('/blog', currentLocale));
	const contactHref = $derived(localizeInternalHref('/contact', currentLocale));
</script>

<svelte:head>
	<title>{copy.title} | Inoxpran</title>
	<meta name="description" content={copy.description} />
	<meta name="robots" content="noindex, nofollow, noarchive" />
</svelte:head>

<section class="error-hero">
	<div class="container error-grid">
		<div class="error-copy">
			<p class="error-eyebrow">{copy.eyebrow}</p>
			<h1>{copy.title}</h1>
			<p class="error-lead">{copy.lead}</p>
			<p class="error-helper">{copy.helper}</p>
			{#if error?.message && !isNotFound}
				<p class="error-detail">{copy.detailLabel}: {error.message}</p>
			{/if}

			<div class="error-actions">
				<a class="btn btn-dark" href={homeHref}>{copy.home}</a>
				<a class="btn btn-outline-dark" href={shopHref}>{copy.shop}</a>
			</div>

			<div class="error-links">
				<span>{copy.quickLinks}</span>
				<a href={shopHref}>{copy.catalog}</a>
				<a href={blogHref}>{copy.blog}</a>
				<a href={contactHref}>{copy.contact}</a>
			</div>
		</div>

		<div class="error-visual" aria-hidden="true">
			<div class="appliance-stage">
				<div class="appliance-main">
					<div class="appliance-top">
						<span class="appliance-dot"></span>
						<span class="appliance-dot"></span>
						<span class="appliance-dot"></span>
					</div>
					<div class="appliance-screen">
						<span>404</span>
						<small>smart cooker</small>
					</div>
					<div class="appliance-controls">
						<span class="control"></span>
						<span class="control"></span>
						<span class="control control-wide"></span>
					</div>
				</div>

				<div class="appliance-side appliance-side--kettle">
					<span class="steam"></span>
					<span class="steam"></span>
					<span class="steam"></span>
				</div>
				<div class="appliance-side appliance-side--toaster">
					<span class="toast"></span>
					<span class="toast"></span>
				</div>
				<div class="appliance-shadow"></div>
			</div>
		</div>
	</div>
</section>

<style>
	.error-hero {
		position: relative;
		overflow: hidden;
		padding: clamp(48px, 8vw, 110px) 0;
		background: linear-gradient(135deg, #f6fbff 0%, #ffffff 38%, #fdf3e6 100%);
	}

	.error-hero::before,
	.error-hero::after {
		content: '';
		position: absolute;
		inset: auto;
		border-radius: 50%;
		filter: blur(0);
		opacity: 0.45;
	}

	.error-hero::before {
		width: 380px;
		height: 380px;
		top: -120px;
		right: -80px;
		background: radial-gradient(circle, rgba(13, 202, 240, 0.28), transparent 70%);
	}

	.error-hero::after {
		width: 320px;
		height: 320px;
		bottom: -140px;
		left: -80px;
		background: radial-gradient(circle, rgba(248, 109, 114, 0.24), transparent 70%);
	}

	.error-grid {
		display: grid;
		gap: clamp(28px, 4vw, 64px);
		align-items: center;
		grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
		position: relative;
		z-index: 1;
	}

	.error-copy h1 {
		font-size: clamp(32px, 5vw, 52px);
		font-weight: 700;
		color: #1f2a37;
		margin: 8px 0 12px;
	}

	.error-eyebrow {
		font-size: 12px;
		letter-spacing: 0.2em;
		text-transform: uppercase;
		color: #1d4e63;
		font-weight: 700;
		margin-bottom: 8px;
	}

	.error-lead {
		font-size: 18px;
		color: #344256;
		margin-bottom: 8px;
	}

	.error-helper {
		font-size: 16px;
		color: #4b5a6b;
		margin-bottom: 20px;
	}

	.error-detail {
		font-size: 14px;
		color: #6b7280;
		margin-bottom: 20px;
	}

	.error-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 12px;
		margin-bottom: 18px;
	}

	.error-actions .btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 10px 18px;
		border-radius: 999px;
		font-weight: 600;
	}

	.error-links {
		display: flex;
		flex-wrap: wrap;
		gap: 12px;
		align-items: center;
		font-size: 14px;
		color: #607086;
	}

	.error-links span {
		font-weight: 600;
		color: #1f2a37;
	}

	.error-links a {
		color: #1d4e63;
		border-bottom: 1px dashed rgba(29, 78, 99, 0.4);
		padding-bottom: 2px;
	}

	.error-links a:hover {
		color: #0dcaf0;
		border-bottom-color: rgba(13, 202, 240, 0.6);
	}

	.error-visual {
		display: flex;
		justify-content: center;
	}

	.appliance-stage {
		position: relative;
		width: min(420px, 100%);
		min-height: 360px;
		display: grid;
		place-items: center;
	}

	.appliance-main {
		width: 280px;
		height: 230px;
		background: linear-gradient(160deg, #ffffff 0%, #f2f4f7 100%);
		border-radius: 32px;
		border: 1px solid rgba(31, 41, 55, 0.08);
		box-shadow:
			0 20px 40px rgba(15, 23, 42, 0.12),
			inset 0 1px 0 rgba(255, 255, 255, 0.8);
		display: flex;
		flex-direction: column;
		padding: 18px 20px;
		gap: 16px;
		position: relative;
		z-index: 2;
		animation: float 6s ease-in-out infinite;
	}

	.appliance-top {
		display: flex;
		gap: 6px;
	}

	.appliance-dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: #d9e5f0;
	}

	.appliance-screen {
		flex: 1;
		border-radius: 18px;
		background: linear-gradient(135deg, #1d4e63 0%, #0dcaf0 100%);
		color: #fff;
		display: grid;
		place-items: center;
		text-align: center;
		box-shadow: inset 0 0 20px rgba(0, 0, 0, 0.15);
	}

	.appliance-screen span {
		font-size: 44px;
		font-weight: 700;
		display: block;
		line-height: 1;
	}

	.appliance-screen small {
		font-size: 12px;
		letter-spacing: 0.2em;
		text-transform: uppercase;
		opacity: 0.8;
	}

	.appliance-controls {
		display: flex;
		gap: 10px;
	}

	.control {
		height: 10px;
		flex: 1;
		border-radius: 999px;
		background: #dbe4ee;
	}

	.control-wide {
		flex: 2;
		background: #f8d7da;
	}

	.appliance-side {
		position: absolute;
		width: 120px;
		height: 160px;
		background: #fff7ee;
		border: 1px solid rgba(31, 41, 55, 0.08);
		border-radius: 28px;
		box-shadow: 0 16px 30px rgba(15, 23, 42, 0.1);
	}

	.appliance-side--kettle {
		left: 0;
		bottom: 30px;
		transform: rotate(-4deg);
		display: grid;
		place-items: center;
		gap: 6px;
		padding-top: 30px;
	}

	.appliance-side--kettle::before {
		content: '';
		position: absolute;
		top: 16px;
		left: 50%;
		transform: translateX(-50%);
		width: 60px;
		height: 60px;
		border-radius: 24px 24px 20px 20px;
		background: #f5b97c;
		box-shadow: inset 0 -6px 0 rgba(0, 0, 0, 0.08);
	}

	.appliance-side--kettle::after {
		content: '';
		position: absolute;
		right: -14px;
		top: 32px;
		width: 40px;
		height: 60px;
		border: 6px solid #f5b97c;
		border-left: none;
		border-radius: 0 24px 24px 0;
	}

	.steam {
		width: 10px;
		height: 30px;
		border-radius: 999px;
		background: linear-gradient(180deg, rgba(255, 255, 255, 0.9), transparent);
		opacity: 0.8;
		animation: steam 3s ease-in-out infinite;
	}

	.steam:nth-child(2) {
		animation-delay: 0.6s;
		height: 24px;
	}

	.steam:nth-child(3) {
		animation-delay: 1.2s;
		height: 20px;
	}

	.appliance-side--toaster {
		right: 0;
		top: 40px;
		background: #f1f5f9;
		display: grid;
		place-items: center;
		gap: 12px;
		padding-top: 24px;
	}

	.appliance-side--toaster::before {
		content: '';
		position: absolute;
		bottom: 16px;
		left: 50%;
		transform: translateX(-50%);
		width: 70px;
		height: 14px;
		border-radius: 999px;
		background: #cbd5e1;
	}

	.toast {
		width: 54px;
		height: 22px;
		border-radius: 12px 12px 8px 8px;
		background: #ffd9b2;
		box-shadow: inset 0 -4px 0 rgba(0, 0, 0, 0.08);
	}

	.appliance-shadow {
		position: absolute;
		bottom: 30px;
		left: 50%;
		transform: translateX(-50%);
		width: 320px;
		height: 30px;
		background: radial-gradient(ellipse at center, rgba(15, 23, 42, 0.18), transparent 70%);
		filter: blur(6px);
		z-index: 1;
	}

	@keyframes float {
		0%,
		100% {
			transform: translateY(0);
		}
		50% {
			transform: translateY(-10px);
		}
	}

	@keyframes steam {
		0%,
		100% {
			transform: translateY(0);
			opacity: 0.6;
		}
		50% {
			transform: translateY(-8px);
			opacity: 1;
		}
	}

	@media (max-width: 768px) {
		.error-hero {
			padding: 44px 0 72px;
		}

		.error-actions {
			flex-direction: row;
			flex-wrap: nowrap;
			gap: 8px;
		}

		.error-actions .btn {
			flex: 1 1 0;
			min-width: 0;
			white-space: normal;
			padding: 9px 10px;
			font-size: 14px;
			line-height: 1.2;
		}

		.appliance-stage {
			min-height: 300px;
		}

		.appliance-main {
			width: 240px;
			height: 210px;
		}
	}

	@media (max-width: 420px) {
		.error-actions .btn {
			font-size: 13px;
			padding: 8px 8px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.appliance-main,
		.steam {
			animation: none;
		}
	}
</style>
