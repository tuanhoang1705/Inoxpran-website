<script>
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { locale } from '$lib/i18n/index.js';

	let open = $state(false);
	let name = $state('');
	let contact = $state('');
	let note = $state('');
	let submitting = $state(false);
	let success = $state('');
	let error = $state('');
	let activeCampaign = $state(null);

	const copy = $derived(
		$locale === 'en'
			? {
					kicker: 'Welcome gift',
					title: 'Unlock your first-order Inoxpran offer',
					desc: 'Leave an email or Zalo number. Our team will send the current welcome gift, warranty details, and COD confirmation.',
					name: 'Name',
					contact: 'Email or Zalo phone',
					note: 'Product you are interested in',
					submit: 'Get offer',
					success: 'Your request has been received. Inoxpran will contact you soon.',
					error: 'Unable to send right now. Please try again or call 0867 024 186.'
				}
			: {
					kicker: 'Quà chào mừng',
					title: 'Nhận ưu đãi đơn đầu tiên từ Inoxpran',
					desc: 'Để lại email hoặc Zalo. Đội ngũ Inoxpran sẽ gửi ưu đãi hiện tại, thông tin bảo hành và xác nhận COD.',
					name: 'Tên của bạn',
					contact: 'Email hoặc số Zalo',
					note: 'Sản phẩm đang quan tâm',
					submit: 'Nhận ưu đãi',
					success: 'Inoxpran đã nhận thông tin. Đội ngũ tư vấn sẽ liên hệ sớm.',
					error: 'Chưa gửi được thông tin. Vui lòng thử lại hoặc gọi 0867 024 186.'
			}
	);
	const campaign = $derived(activeCampaign || page.data?.siteMarketingCampaign || null);
	const modalCopy = $derived.by(() => {
		if (!campaign?.enabled || !campaign?.popupEnabled) return copy;
		const localized = $locale === 'en';
		return {
			...copy,
			kicker: localized
				? campaign.kickerEn || campaign.kickerVi || copy.kicker
				: campaign.kickerVi || campaign.kickerEn || copy.kicker,
			title: localized
				? campaign.titleEn || campaign.titleVi || copy.title
				: campaign.titleVi || campaign.titleEn || copy.title,
			desc: localized
				? campaign.descriptionEn || campaign.descriptionVi || copy.desc
				: campaign.descriptionVi || campaign.descriptionEn || copy.desc,
			submit: localized
				? campaign.ctaEn || campaign.ctaVi || copy.submit
				: campaign.ctaVi || campaign.ctaEn || copy.submit,
			success: localized
				? campaign.successEn || campaign.successVi || copy.success
				: campaign.successVi || campaign.successEn || copy.success
		};
	});

	const close = () => {
		open = false;
		error = '';
	};

	const submitLead = async (event) => {
		event.preventDefault();
		error = '';
		success = '';
		if (!contact.trim()) {
			error = modalCopy.error;
			return;
		}
		submitting = true;
		try {
			const formData = new FormData();
			formData.set('name', name.trim() || 'Khách nhận ưu đãi Inoxpran');
			formData.set('contact', contact.trim());
			formData.set(
				'message',
				[
					'[Marketing lead] Nhận quà chào mừng đơn đầu tiên',
					campaign?.offerCode ? `Campaign: ${campaign.offerCode}` : '',
					campaign?.minOrderValue ? `Min order: ${campaign.minOrderValue}` : '',
					note.trim() ? `Quan tâm: ${note.trim()}` : '',
					typeof window !== 'undefined' ? `Trang gửi: ${window.location.href}` : ''
				]
					.filter(Boolean)
					.join('\n')
			);
			formData.set('returnTo', typeof window !== 'undefined' ? window.location.pathname : '/');
			const response = await fetch('/contact/submit', {
				method: 'POST',
				headers: {
					accept: 'application/json',
					'x-inoxpran-ajax': '1'
				},
				body: formData
			});
			const payload = await response.json().catch(() => null);
			if (!response.ok || payload?.success === false) {
				throw new Error(payload?.message || 'lead failed');
			}
			success = modalCopy.success;
			name = '';
			contact = '';
			note = '';
		} catch {
			error = modalCopy.error;
		} finally {
			submitting = false;
		}
	};

	onMount(() => {
		const handleOpen = (event) => {
			activeCampaign = event?.detail?.campaign || page.data?.siteMarketingCampaign || null;
			open = true;
			success = '';
			error = '';
		};
		window.addEventListener('inoxpran:open-lead-capture', handleOpen);
		return () => window.removeEventListener('inoxpran:open-lead-capture', handleOpen);
	});
</script>

{#if open}
	<div class="lead-overlay" role="dialog" aria-modal="true" aria-labelledby="lead-capture-title">
		<button type="button" class="lead-backdrop" aria-label="Close" onclick={close}></button>
		<form class="lead-modal" onsubmit={submitLead}>
			<div class="lead-head">
				<p>{modalCopy.kicker}</p>
				<button type="button" aria-label="Close" onclick={close}>×</button>
			</div>
			<h2 id="lead-capture-title">{modalCopy.title}</h2>
			<p class="lead-desc">{modalCopy.desc}</p>
			<div class="lead-fields">
				<input type="text" placeholder={modalCopy.name} bind:value={name} autocomplete="name" />
				<input
					type="text"
					placeholder={modalCopy.contact}
					bind:value={contact}
					autocomplete="email"
					required
				/>
				<input type="text" placeholder={modalCopy.note} bind:value={note} />
			</div>
			{#if success}
				<p class="lead-notice success">{success}</p>
			{/if}
			{#if error}
				<p class="lead-notice error">{error}</p>
			{/if}
			<button type="submit" class="lead-submit" disabled={submitting}>
				{submitting ? `${modalCopy.submit}...` : modalCopy.submit}
			</button>
			<div class="lead-trust">
				<span>Italia 1954</span>
				<span>COD</span>
				<span>12 tháng bảo hành</span>
			</div>
		</form>
	</div>
{/if}

<style>
	.lead-overlay {
		position: fixed;
		inset: 0;
		z-index: 1000000;
		display: grid;
		place-items: center;
		padding: 20px;
	}

	.lead-backdrop {
		position: absolute;
		inset: 0;
		border: 0;
		background: rgba(8, 15, 24, 0.58);
		cursor: pointer;
	}

	.lead-modal {
		position: relative;
		width: min(520px, 100%);
		border-radius: 18px;
		border: 1px solid rgba(255, 255, 255, 0.18);
		background: #fffdf8;
		box-shadow: 0 24px 80px rgba(0, 0, 0, 0.25);
		padding: 28px;
		color: #111827;
	}

	.lead-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 16px;
		margin-bottom: 12px;
	}

	.lead-head p {
		margin: 0;
		color: #0b8799;
		font-size: 0.78rem;
		font-weight: 800;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	.lead-head button {
		width: 36px;
		height: 36px;
		border: 1px solid rgba(15, 23, 42, 0.12);
		border-radius: 50%;
		background: #ffffff;
		color: #111827;
		font-size: 1.4rem;
		line-height: 1;
	}

	.lead-modal h2 {
		font-size: clamp(1.8rem, 3vw, 2.4rem);
		line-height: 1.08;
		margin: 0;
		letter-spacing: 0;
	}

	.lead-desc {
		margin: 12px 0 20px;
		color: #475569;
		line-height: 1.6;
	}

	.lead-fields {
		display: grid;
		gap: 10px;
	}

	.lead-fields input {
		min-height: 48px;
		border-radius: 12px;
		border: 1px solid rgba(15, 23, 42, 0.14);
		background: #ffffff;
		padding: 0 14px;
		color: #111827;
		font-size: 0.95rem;
	}

	.lead-fields input:focus {
		outline: 2px solid rgba(11, 135, 153, 0.28);
		border-color: #0b8799;
	}

	.lead-submit {
		width: 100%;
		min-height: 50px;
		margin-top: 16px;
		border: 0;
		border-radius: 999px;
		background: #111827;
		color: #ffffff;
		font-weight: 800;
	}

	.lead-submit:disabled {
		opacity: 0.65;
	}

	.lead-notice {
		margin: 12px 0 0;
		padding: 10px 12px;
		border-radius: 12px;
		font-weight: 700;
		font-size: 0.88rem;
	}

	.lead-notice.success {
		background: #e7f8ef;
		color: #11613b;
	}

	.lead-notice.error {
		background: #fff0ed;
		color: #9f1239;
	}

	.lead-trust {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-top: 14px;
		color: #475569;
		font-size: 0.78rem;
		font-weight: 800;
		text-transform: uppercase;
	}

	.lead-trust span {
		border: 1px solid rgba(15, 23, 42, 0.1);
		border-radius: 999px;
		background: #ffffff;
		padding: 5px 10px;
	}

	@media (max-width: 576px) {
		.lead-modal {
			padding: 22px;
			border-radius: 16px;
		}
	}
</style>
