<script>
	import { onMount } from 'svelte';
	import { locale } from '$lib/i18n/index.js';
	import {
		cookieConsent,
		initCookieConsent,
		acceptAllCookies,
		rejectOptionalCookies,
		saveCookiePreferences
	} from '$lib/stores/cookieConsent.js';

	let isExpanded = $state(false);
	let analyticsEnabled = $state(true);

	const shouldShow = $derived.by(
		() => Boolean($cookieConsent?.hydrated) && ($cookieConsent?.analytics == null)
	);

	const title = $derived(
		$locale === 'en' ? 'Cookie preferences' : 'Tùy chọn cookie'
	);
	const description = $derived(
		$locale === 'en'
			? 'We use essential cookies for login/cart and optional analytics cookies to understand behavior such as page views, clicks, scroll depth, and time on site.'
			: 'Chúng tôi dùng cookie thiết yếu cho đăng nhập/giỏ hàng và cookie phân tích (tùy chọn) để hiểu hành vi như lượt xem trang, click, độ sâu cuộn và thời gian trên website.'
	);
	const essentialLabel = $derived(
		$locale === 'en' ? 'Essential cookies (always on)' : 'Cookie thiết yếu (luôn bật)'
	);
	const analyticsLabel = $derived(
		$locale === 'en' ? 'Analytics & behavior tracking' : 'Phân tích & theo dõi hành vi'
	);
	const analyticsHint = $derived(
		$locale === 'en'
			? 'Helps us improve products and content. This controls telemetry tracking.'
			: 'Giúp chúng tôi cải thiện sản phẩm và nội dung. Tùy chọn này điều khiển telemetry tracking.'
	);
	const acceptText = $derived($locale === 'en' ? 'Accept all' : 'Đồng ý tất cả');
	const rejectText = $derived($locale === 'en' ? 'Only necessary' : 'Chỉ dùng thiết yếu');
	const customizeText = $derived($locale === 'en' ? 'Customize' : 'Tùy chỉnh');
	const saveText = $derived($locale === 'en' ? 'Save preferences' : 'Lưu lựa chọn');
	const policyText = $derived($locale === 'en' ? 'Privacy policy' : 'Chính sách bảo mật');

	$effect(() => {
		if (!$cookieConsent?.hydrated) return;
		if ($cookieConsent.analytics == null) {
			analyticsEnabled = true;
			return;
		}
		analyticsEnabled = Boolean($cookieConsent.analytics);
	});

	onMount(() => {
		initCookieConsent();
	});

	const handleSave = () => {
		saveCookiePreferences({ analytics: analyticsEnabled });
		isExpanded = false;
	};
</script>

{#if shouldShow}
	<section class="cookie-banner" aria-live="polite">
		<div class="cookie-banner__inner" role="dialog" aria-label={title} aria-modal="false">
			<div class="cookie-banner__content">
				<p class="cookie-banner__eyebrow">INOXPRAN</p>
				<h2 class="cookie-banner__title">{title}</h2>
				<p class="cookie-banner__desc">{description}</p>
				<a class="cookie-banner__policy" href="/policies">{policyText}</a>
			</div>

			<div class="cookie-banner__actions">
				<div class="cookie-banner__buttons">
					<button type="button" class="cookie-btn cookie-btn--ghost" onclick={rejectOptionalCookies}>
						{rejectText}
					</button>
					<button type="button" class="cookie-btn cookie-btn--primary" onclick={acceptAllCookies}>
						{acceptText}
					</button>
					<button
						type="button"
						class="cookie-btn cookie-btn--text"
						aria-expanded={isExpanded ? 'true' : 'false'}
						onclick={() => (isExpanded = !isExpanded)}
					>
						{customizeText}
					</button>
				</div>

				{#if isExpanded}
					<div class="cookie-banner__prefs">
						<div class="cookie-pref cookie-pref--locked">
							<div>
								<p class="cookie-pref__label">{essentialLabel}</p>
							</div>
							<span class="cookie-pref__chip">ON</span>
						</div>

						<label class="cookie-pref" for="cookie-analytics-consent">
							<div>
								<p class="cookie-pref__label">{analyticsLabel}</p>
								<p class="cookie-pref__hint">{analyticsHint}</p>
							</div>
							<input
								id="cookie-analytics-consent"
								type="checkbox"
								bind:checked={analyticsEnabled}
							/>
						</label>

						<div class="cookie-banner__prefs-actions">
							<button type="button" class="cookie-btn cookie-btn--primary" onclick={handleSave}>
								{saveText}
							</button>
						</div>
					</div>
				{/if}
			</div>
		</div>
	</section>
{/if}

<style>
	.cookie-banner {
		position: fixed;
		left: 16px;
		right: 16px;
		bottom: 16px;
		z-index: 12050;
		pointer-events: none;
	}

	.cookie-banner__inner {
		pointer-events: auto;
		margin: 0 auto;
		max-width: 1120px;
		display: grid;
		grid-template-columns: 1.2fr 1fr;
		gap: 18px;
		padding: 18px;
		border-radius: 20px;
		border: 1px solid rgba(18, 34, 44, 0.12);
		background:
			radial-gradient(circle at 15% 20%, rgba(29, 78, 99, 0.12), transparent 55%),
			linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(248, 251, 252, 0.98));
		box-shadow:
			0 28px 60px rgba(11, 24, 33, 0.16),
			0 8px 24px rgba(11, 24, 33, 0.08);
		backdrop-filter: blur(10px);
		-webkit-backdrop-filter: blur(10px);
	}

	.cookie-banner__eyebrow {
		margin: 0 0 4px;
		font-size: 0.72rem;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: #1d4e63;
		font-weight: 800;
	}

	.cookie-banner__title {
		margin: 0;
		font-size: 1.15rem;
		line-height: 1.2;
		color: #102530;
	}

	.cookie-banner__desc {
		margin: 8px 0 10px;
		color: #425865;
		font-size: 0.94rem;
		line-height: 1.45;
	}

	.cookie-banner__policy {
		color: #1d4e63;
		font-weight: 700;
		text-decoration: none;
		border-bottom: 1px solid rgba(29, 78, 99, 0.3);
	}

	.cookie-banner__policy:hover,
	.cookie-banner__policy:focus-visible {
		border-bottom-color: rgba(29, 78, 99, 0.8);
	}

	.cookie-banner__actions {
		display: grid;
		gap: 10px;
		align-content: start;
	}

	.cookie-banner__buttons {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		justify-content: flex-end;
		align-items: center;
	}

	.cookie-btn {
		border-radius: 999px;
		padding: 10px 14px;
		font-weight: 700;
		font-size: 0.92rem;
		cursor: pointer;
		border: 1px solid transparent;
		transition:
			transform 0.16s ease,
			box-shadow 0.16s ease,
			background-color 0.16s ease,
			color 0.16s ease,
			border-color 0.16s ease;
	}

	.cookie-btn:hover,
	.cookie-btn:focus-visible {
		transform: translateY(-1px);
	}

	.cookie-btn--primary {
		background: #173f52;
		color: #fff;
		box-shadow: 0 10px 22px rgba(23, 63, 82, 0.18);
	}

	.cookie-btn--primary:hover,
	.cookie-btn--primary:focus-visible {
		background: #123244;
	}

	.cookie-btn--ghost {
		background: #fff;
		color: #173f52;
		border-color: rgba(23, 63, 82, 0.18);
	}

	.cookie-btn--ghost:hover,
	.cookie-btn--ghost:focus-visible {
		border-color: rgba(23, 63, 82, 0.42);
	}

	.cookie-btn--text {
		background: transparent;
		color: #173f52;
		padding-inline: 8px;
	}

	.cookie-banner__prefs {
		border: 1px solid rgba(18, 34, 44, 0.1);
		border-radius: 16px;
		padding: 12px;
		background: rgba(255, 255, 255, 0.84);
		display: grid;
		gap: 10px;
	}

	.cookie-pref {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		align-items: center;
		padding: 10px 12px;
		border-radius: 12px;
		background: #fff;
		border: 1px solid rgba(18, 34, 44, 0.07);
	}

	.cookie-pref--locked {
		opacity: 0.94;
	}

	.cookie-pref__label {
		margin: 0;
		font-weight: 700;
		color: #102530;
	}

	.cookie-pref__hint {
		margin: 4px 0 0;
		font-size: 0.85rem;
		color: #5a707c;
	}

	.cookie-pref__chip {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 42px;
		padding: 4px 10px;
		border-radius: 999px;
		background: rgba(23, 63, 82, 0.08);
		color: #173f52;
		font-weight: 800;
		font-size: 0.78rem;
	}

	.cookie-pref input[type='checkbox'] {
		width: 18px;
		height: 18px;
		accent-color: #173f52;
		flex: 0 0 auto;
	}

	.cookie-banner__prefs-actions {
		display: flex;
		justify-content: flex-end;
	}

	@media (max-width: 960px) {
		.cookie-banner__inner {
			grid-template-columns: 1fr;
			gap: 14px;
			padding: 14px;
			border-radius: 16px;
		}

		.cookie-banner__buttons {
			justify-content: flex-start;
		}
	}

	@media (max-width: 640px) {
		.cookie-banner {
			left: 10px;
			right: 10px;
			top: max(58px, calc(env(safe-area-inset-top) + 58px));
			bottom: auto;
		}

		.cookie-banner__inner {
			max-height: min(44vh, 300px);
			overflow-y: auto;
			-webkit-overflow-scrolling: touch;
		}

		.cookie-banner__desc {
			display: -webkit-box;
			-webkit-box-orient: vertical;
			-webkit-line-clamp: 3;
			overflow: hidden;
		}

		.cookie-banner__buttons {
			display: grid;
			grid-template-columns: repeat(2, minmax(0, 1fr));
			width: 100%;
		}

		.cookie-btn {
			width: 100%;
			justify-content: center;
			padding-inline: 10px;
			font-size: 0.86rem;
		}

		.cookie-btn--text {
			grid-column: 1 / -1;
			padding-inline: 14px;
			border: 1px dashed rgba(23, 63, 82, 0.18);
			border-radius: 12px;
		}
	}

	@media (max-width: 360px) {
		.cookie-banner__buttons {
			grid-template-columns: 1fr;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.cookie-btn {
			transition: none;
		}
	}
</style>
