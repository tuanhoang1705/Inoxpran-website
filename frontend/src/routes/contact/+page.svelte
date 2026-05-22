<script>
	import { t } from '$lib/i18n/index.js';

	let { form } = $props();
</script>

<svelte:head>
	<title>{$t('contact.title')} | Inoxpran</title>
</svelte:head>

<section class="contact-shell">
	<div class="contact-hero">
		<div>
			<p class="contact-eyebrow">{$t('contact.eyebrow')}</p>
			<h1>{$t('contact.heading')}</h1>
			<p class="contact-lede">{$t('contact.lede')}</p>
		</div>
		<div class="contact-highlight">
			<div>
				<h3>{$t('contact.highlightTitle')}</h3>
				<p>{$t('contact.highlightDesc')}</p>
			</div>
			<div class="contact-highlight-stats">
				<div>
					<span>{$t('contact.stat1Label')}</span>
					<strong>{$t('contact.stat1Value')}</strong>
				</div>
				<div>
					<span>{$t('contact.stat2Label')}</span>
					<strong>{$t('contact.stat2Value')}</strong>
				</div>
			</div>
		</div>
	</div>

	<div class="contact-grid">
		<div class="contact-info">
			<div class="info-card">
				<h4>{$t('contact.info.hotlineTitle')}</h4>
				<p>{$t('contact.info.hotlineValue')}</p>
				<span>{$t('contact.info.hotlineNote')}</span>
			</div>
			<div class="info-card">
				<h4>{$t('contact.info.emailTitle')}</h4>
				<p>{$t('contact.info.emailValue')}</p>
				<span>{$t('contact.info.emailNote')}</span>
			</div>
			<div class="info-card">
				<h4>{$t('contact.info.showroomTitle')}</h4>
				<p>{$t('contact.info.showroomValue')}</p>
				<span>{$t('contact.info.showroomNote')}</span>
			</div>
			<div class="info-card">
				<h4>{$t('contact.info.hoursTitle')}</h4>
				<p>{$t('contact.info.hoursValue')}</p>
				<span>{$t('contact.info.hoursNote')}</span>
			</div>
		</div>

		<div class="contact-form-card">
			<h2>{$t('contact.form.title')}</h2>
			<p class="contact-form-desc">{$t('contact.form.desc')}</p>

			{#if form?.error}
				<div class="contact-alert error">{form.error}</div>
			{/if}
			{#if form?.success}
				<div class="contact-alert success">{form.message}</div>
			{/if}

			<form method="post" class="contact-form">
				<div class="field">
					<label for="contact-fullname">{$t('contact.form.fullName')}</label>
					<input
						class="form-control"
						id="contact-fullname"
						name="fullName"
						required
						placeholder={$t('contact.form.fullNamePlaceholder')}
					/>
				</div>

				<div class="field-row">
					<div class="field">
						<label for="contact-phone">{$t('contact.form.phone')}</label>
						<input
							class="form-control"
							id="contact-phone"
							name="phone"
							placeholder={$t('contact.form.phonePlaceholder')}
						/>
					</div>
					<div class="field">
						<label for="contact-email">{$t('contact.form.email')}</label>
						<input
							class="form-control"
							id="contact-email"
							name="email"
							type="email"
							placeholder={$t('contact.form.emailPlaceholder')}
						/>
					</div>
				</div>

				<div class="field-row">
					<div class="field">
						<label for="contact-company">{$t('contact.form.company')}</label>
						<input
							class="form-control"
							id="contact-company"
							name="company"
							placeholder={$t('contact.form.companyPlaceholder')}
						/>
					</div>
					<div class="field">
						<label for="contact-city">{$t('contact.form.city')}</label>
						<input
							class="form-control"
							id="contact-city"
							name="city"
							placeholder={$t('contact.form.cityPlaceholder')}
						/>
					</div>
				</div>

				<div class="field">
					<label for="contact-address">{$t('contact.form.address')}</label>
					<input
						class="form-control"
						id="contact-address"
						name="address"
						placeholder={$t('contact.form.addressPlaceholder')}
					/>
				</div>

				<div class="field-row">
					<div class="field">
						<label for="contact-interest">{$t('contact.form.productInterest')}</label>
						<input
							class="form-control"
							id="contact-interest"
							name="productInterest"
							placeholder={$t('contact.form.productInterestPlaceholder')}
						/>
					</div>
					<div class="field">
						<label for="contact-budget">{$t('contact.form.budgetRange')}</label>
						<input
							class="form-control"
							id="contact-budget"
							name="budgetRange"
							placeholder={$t('contact.form.budgetRangePlaceholder')}
						/>
					</div>
				</div>

				<div class="field">
					<label for="contact-timeline">{$t('contact.form.timeline')}</label>
					<input
						class="form-control"
						id="contact-timeline"
						name="timeline"
						placeholder={$t('contact.form.timelinePlaceholder')}
					/>
				</div>

				<div class="field-row">
					<div class="field">
						<label for="contact-method">{$t('contact.form.preferredContactMethod')}</label>
						<select class="form-select" id="contact-method" name="preferredContactMethod">
							<option value="">{$t('contact.form.preferredContactMethodPlaceholder')}</option>
							<option value="phone">{$t('contact.form.preferredContactMethodPhone')}</option>
							<option value="email">{$t('contact.form.preferredContactMethodEmail')}</option>
							<option value="zalo">{$t('contact.form.preferredContactMethodZalo')}</option>
							<option value="whatsapp">{$t('contact.form.preferredContactMethodWhatsapp')}</option>
							<option value="other">{$t('contact.form.preferredContactMethodOther')}</option>
						</select>
					</div>
					<div class="field">
						<label for="contact-time">{$t('contact.form.preferredContactTime')}</label>
						<select class="form-select" id="contact-time" name="preferredContactTime">
							<option value="">{$t('contact.form.preferredContactTimePlaceholder')}</option>
							<option value="morning">{$t('contact.form.preferredContactTimeMorning')}</option>
							<option value="afternoon">{$t('contact.form.preferredContactTimeAfternoon')}</option>
							<option value="evening">{$t('contact.form.preferredContactTimeEvening')}</option>
							<option value="anytime">{$t('contact.form.preferredContactTimeAnytime')}</option>
						</select>
					</div>
				</div>

				<div class="field">
					<label for="contact-message">{$t('contact.form.message')}</label>
					<textarea
						class="form-control"
						id="contact-message"
						name="message"
						rows="4"
						required
						placeholder={$t('contact.form.messagePlaceholder')}
					></textarea>
				</div>

				<button class="contact-submit" type="submit">
					{$t('contact.form.submit')}
				</button>
				<p class="contact-note">{$t('contact.form.note')}</p>
			</form>
		</div>
	</div>
</section>

<style>
	:global(body) {
		background: #f6f4ef;
	}

	.contact-shell {
		padding: 64px 0 80px;
		background:
			radial-gradient(circle at 10% 10%, rgba(255, 200, 130, 0.3), transparent 45%),
			radial-gradient(circle at 90% 20%, rgba(90, 120, 115, 0.2), transparent 45%),
			linear-gradient(180deg, #fdfbf7 0%, #f3efe7 100%);
	}

	.contact-hero {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
		gap: 32px;
		align-items: center;
		padding: 0 24px 40px;
		max-width: 1200px;
		margin: 0 auto;
	}

	.contact-eyebrow {
		text-transform: uppercase;
		letter-spacing: 0.2em;
		font-size: 0.75rem;
		font-weight: 700;
		color: #b86b24;
		margin-bottom: 12px;
	}

	.contact-hero h1 {
		font-size: clamp(2.2rem, 4vw, 3.2rem);
		font-weight: 700;
		color: #1f1b16;
		margin-bottom: 12px;
		font-family: 'Playfair Display', 'Cormorant Garamond', serif;
	}

	.contact-lede {
		font-size: 1.05rem;
		color: #4c433c;
		max-width: 520px;
	}

	.contact-highlight {
		background: #1f1b16;
		color: #fdf5ea;
		padding: 24px;
		border-radius: 20px;
		box-shadow: 0 20px 40px rgba(26, 24, 22, 0.2);
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.contact-highlight h3 {
		font-size: 1.4rem;
		margin-bottom: 6px;
	}

	.contact-highlight p {
		margin: 0;
		color: rgba(255, 245, 234, 0.8);
	}

	.contact-highlight-stats {
		display: flex;
		gap: 16px;
		flex-wrap: wrap;
	}

	.contact-highlight-stats div {
		flex: 1 1 120px;
		background: rgba(255, 255, 255, 0.08);
		border-radius: 16px;
		padding: 12px 16px;
	}

	.contact-highlight-stats span {
		display: block;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: rgba(255, 245, 234, 0.7);
	}

	.contact-highlight-stats strong {
		font-size: 1.2rem;
		color: #fff;
	}

	.contact-grid {
		max-width: 1200px;
		margin: 0 auto;
		padding: 0 24px;
		display: grid;
		grid-template-columns: minmax(240px, 0.9fr) minmax(300px, 1.4fr);
		gap: 32px;
		align-items: start;
	}

	.contact-info {
		display: grid;
		gap: 16px;
	}

	.info-card {
		background: #fff;
		border-radius: 18px;
		padding: 20px;
		box-shadow: 0 18px 36px rgba(34, 28, 23, 0.08);
		border: 1px solid #efe6d9;
	}

	.info-card h4 {
		font-size: 1rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		margin-bottom: 8px;
		color: #b86b24;
		font-weight: 700;
	}

	.info-card p {
		margin: 0 0 6px;
		font-size: 1.1rem;
		color: #2c261f;
		font-weight: 600;
	}

	.info-card span {
		color: #6a5d52;
		font-size: 0.9rem;
	}

	.contact-form-card {
		background: #fff;
		border-radius: 24px;
		padding: 32px;
		box-shadow: 0 24px 48px rgba(25, 20, 16, 0.1);
		border: 1px solid #f0e2d3;
	}

	.contact-form-card h2 {
		font-size: 1.8rem;
		margin-bottom: 8px;
		color: #1f1b16;
		font-family: 'Playfair Display', 'Cormorant Garamond', serif;
	}

	.contact-form-desc {
		color: #5b5148;
		margin-bottom: 24px;
	}

	.contact-alert {
		padding: 12px 16px;
		border-radius: 12px;
		margin-bottom: 16px;
		font-weight: 600;
	}

	.contact-alert.error {
		background: #ffe3e3;
		color: #a12a2a;
	}

	.contact-alert.success {
		background: #def4e5;
		color: #1c6b3a;
	}

	.contact-form {
		display: grid;
		gap: 16px;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.field label {
		font-weight: 600;
		color: #2f281f;
	}

	.field-row {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: 16px;
	}

	.form-control,
	.form-select,
	textarea {
		border-radius: 12px;
		border: 1px solid #e4d6c6;
		padding: 12px 14px;
		font-size: 0.95rem;
		background: #fffaf3;
	}

	.form-control:focus,
	.form-select:focus,
	textarea:focus {
		border-color: #b86b24;
		box-shadow: 0 0 0 3px rgba(184, 107, 36, 0.15);
	}

	.contact-submit {
		background: #1f1b16;
		color: #fff;
		border: none;
		padding: 14px 18px;
		border-radius: 14px;
		font-weight: 700;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		transition: transform 0.2s ease, box-shadow 0.2s ease;
	}

	.contact-submit:hover {
		transform: translateY(-1px);
		box-shadow: 0 14px 24px rgba(31, 27, 22, 0.2);
	}

	.contact-note {
		font-size: 0.85rem;
		color: #7a6a5f;
		margin: 0;
	}

	@media (max-width: 960px) {
		.contact-grid {
			grid-template-columns: 1fr;
		}
	}

	@media (max-width: 720px) {
		.contact-hero {
			padding: 0 16px 32px;
		}

		.contact-form-card {
			padding: 24px;
		}
	}
</style>
