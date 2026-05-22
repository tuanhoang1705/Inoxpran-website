<script>
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import PaymentMethods from '$lib/components/PaymentMethods.svelte';
	import { clearGuestCart, getGuestCartSummary, readGuestCart } from '$lib/client/guestCart.js';
	import { locale, t } from '$lib/i18n/index.js';

	let { data, form } = $props();

	const items = $derived(data?.items ?? []);
	const summary = $derived(data?.summary ?? { subtotal: 0 });
	const authRequired = $derived(data?.authRequired ?? false);
	const apiError = $derived(data?.apiError ?? '');
	const checkoutOrder = $derived(data?.checkoutOrder ?? null);
	const reviewError = $derived(data?.reviewError ?? '');
	const discountOptions = $derived(data?.discountOptions ?? []);
	let discountCodeInput = $state(data?.discountCode ?? '');
	let appliedDiscountCode = $state(data?.discountCode ?? '');
	let discountError = $state('');
	let discountPreview = $state(null);
	let isUpdatingDiscount = $state(false);
	let discountRequestId = $state(0);
	let showVoucherModal = $state(false);
	let pendingDiscount = $state(null);
	let voucherInput = $state('');
	const VIETNAM_ADDRESS_API = 'https://provinces.open-api.vn/api';
	let addressMode = $state('select');
	let provinceOptions = $state([]);
	let districtOptions = $state([]);
	let wardOptions = $state([]);
	let provinceCode = $state('');
	let districtCode = $state('');
	let wardCode = $state('');
	let provinceInput = $state('');
	let districtInput = $state('');
	let wardInput = $state('');
	let isLoadingProvince = $state(false);
	let isLoadingDistrict = $state(false);
	let isLoadingWard = $state(false);
	let addressLoadError = $state('');
	let nameInput = $state('');
	let phoneInput = $state('');
	let emailInput = $state('');
	let addressInput = $state('');
	let noteInput = $state('');
	let formSubmitted = $state(false);
	let fieldErrors = $state({
		name: false,
		phone: false,
		ward: false,
		district: false,
		province: false,
		address: false
	});
	let provinceRequestId = $state(0);
	let districtRequestId = $state(0);
	let wardRequestId = $state(0);
	let shippingFeeQuote = $state(null);
	let shippingFeeError = $state('');
	let isLoadingShippingFee = $state(false);
	let shippingFeeRequestId = $state(0);
	let shippingFeeTimer;
	let syncedCheckoutCartCount = $state(null);
	let guestItems = $state([]);
	let guestLeadSubmitting = $state(false);
	let guestLeadSuccess = $state('');
	let guestLeadError = $state('');
	const guestSummary = $derived.by(() => getGuestCartSummary(guestItems));
	const guestCartPayload = $derived.by(() =>
		JSON.stringify(
			guestItems.map((item) => ({
				productId: item.productId,
				quantity: item.quantity,
				price: item.price,
				weight: item.weight,
				shopId: item.shopId
			}))
		)
	);
	let clearedGuestOrderId = $state('');

	const normalizeCode = (value) => String(value || '').trim();
	const normalizedAppliedCode = $derived.by(() => normalizeCode(appliedDiscountCode));
	const appliedDiscount = $derived.by(() =>
		discountOptions.find(
			(option) =>
				normalizeCode(option?.discount_code).toLowerCase() ===
				normalizeCode(appliedDiscountCode).toLowerCase()
		)
	);
	const discountScope = $derived.by(() =>
		appliedDiscount?.discount_applies_to === 'specific' ? 'selected' : 'all'
	);
	const discountProductIds = $derived.by(() =>
		Array.isArray(appliedDiscount?.discount_product_ids)
			? appliedDiscount.discount_product_ids.map(String)
			: []
	);
	const selectedDiscountLabel = $derived.by(() => {
		if (appliedDiscount?.discount_code) {
			const name = appliedDiscount?.discount_name || 'Voucher giảm giá';
			return `${appliedDiscount.discount_code} - ${name}`;
		}
		if (normalizedAppliedCode) return normalizedAppliedCode;
		return 'Chưa chọn voucher';
	});
	const merchandiseTotals = $derived.by(() => {
		if (discountPreview) return discountPreview;
		if (checkoutOrder) {
			return {
				totalPrice: checkoutOrder?.totalPrice ?? summary.subtotal,
				totalDiscount: checkoutOrder?.totalDiscount ?? 0,
				totalCheckout: checkoutOrder?.totalCheckout ?? summary.subtotal
			};
		}
		return {
			totalPrice: summary.subtotal,
			totalDiscount: 0,
			totalCheckout: summary.subtotal
		};
	});
	const shippingFeeAmount = $derived.by(() => {
		const total = Number(shippingFeeQuote?.fee?.total_fee ?? 0);
		return Number.isFinite(total) ? Math.max(0, total) : 0;
	});
	const displayTotals = $derived.by(() => ({
		totalPrice: merchandiseTotals.totalPrice,
		totalDiscount: merchandiseTotals.totalDiscount,
		shippingFee: shippingFeeAmount,
		totalCheckout: merchandiseTotals.totalCheckout + shippingFeeAmount
	}));

	const formatPrice = (value) => {
		const numeric = Number(value);
		if (!Number.isFinite(numeric)) return '';
		const localeValue = $locale === 'en' ? 'en-US' : 'vi-VN';
		return `${new Intl.NumberFormat(localeValue).format(numeric)}${$t('common.currency')}`;
	};

	const buildDiscountProducts = () =>
		items
			.map((item) => ({
				productId: String(item.productId),
				quantity: Number(item.quantity) || 0,
				price: Number(item.price) || 0
			}))
			.filter((product) => product.quantity > 0);

	const resetDiscountPreview = () => {
		discountPreview = {
			totalPrice: summary.subtotal,
			totalDiscount: 0,
			totalCheckout: summary.subtotal
		};
	};

	const applyDiscount = async (code) => {
		const normalized = normalizeCode(code);
		discountError = '';
		const requestId = discountRequestId + 1;
		discountRequestId = requestId;
		if (!normalized) {
			isUpdatingDiscount = false;
			appliedDiscountCode = '';
			resetDiscountPreview();
			return;
		}
		isUpdatingDiscount = true;
		try {
			const response = await fetch('/checkout/discount', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					codeId: normalized,
					shopId: data?.discountShopId || undefined,
					products: buildDiscountProducts()
				})
			});
			const payload = await response.json().catch(() => null);
			if (requestId !== discountRequestId) return;
			if (!response.ok) {
				discountError = payload?.error || 'Voucher không hợp lệ.';
				appliedDiscountCode = '';
				resetDiscountPreview();
				return;
			}
			const discountAmount = Number(payload?.metadata?.discount ?? 0);
			const totalPrice = summary.subtotal;
			const totalCheckout = Math.max(0, totalPrice - discountAmount);
			discountPreview = {
				totalPrice,
				totalDiscount: discountAmount,
				totalCheckout
			};
			appliedDiscountCode = normalized;
		} catch {
			if (requestId !== discountRequestId) return;
			discountError = 'Không thể áp dụng voucher. Vui lòng thử lại.';
			appliedDiscountCode = '';
			resetDiscountPreview();
		} finally {
			if (requestId === discountRequestId) {
				isUpdatingDiscount = false;
			}
		}
	};

	const clearVoucher = () => {
		discountCodeInput = '';
		appliedDiscountCode = '';
		discountError = '';
		applyDiscount('');
	};

	const computeFieldErrors = () => ({
		name: !nameInput.trim(),
		phone: !phoneInput.trim(),
		ward: !wardInput.trim(),
		district: !districtInput.trim(),
		province: !provinceInput.trim(),
		address: !addressInput.trim()
	});

	const hasCompleteAddress = () =>
		Boolean(
			nameInput.trim() &&
			phoneInput.trim() &&
			addressInput.trim() &&
			wardInput.trim() &&
			districtInput.trim() &&
			provinceInput.trim()
		);

	const buildShippingFeePayload = () => {
		const totalWeight = items.reduce((sum, item) => {
			const weight = Number(item?.weight);
			const safeWeight = Number.isFinite(weight) && weight > 0 ? weight : 1000;
			const quantity = Number(item?.quantity) || 0;
			return sum + safeWeight * quantity;
		}, 0);
		return {
			receiver: {
				name: nameInput.trim(),
				phone: phoneInput.trim(),
				address: addressInput.trim(),
				ward: wardInput.trim(),
				district: districtInput.trim(),
				province: provinceInput.trim()
			},
			package: {
				weight: Math.max(1, Math.floor(totalWeight || 0))
			},
			value: Math.max(0, Math.floor(merchandiseTotals.totalCheckout || 0)),
			transport: 'road'
		};
	};

	const fetchShippingFee = async () => {
		if (!hasCompleteAddress() || !items.length) {
			shippingFeeQuote = null;
			shippingFeeError = '';
			isLoadingShippingFee = false;
			return;
		}

		const requestId = shippingFeeRequestId + 1;
		shippingFeeRequestId = requestId;
		isLoadingShippingFee = true;
		shippingFeeError = '';

		try {
			const response = await fetch('/checkout/shipping-fee', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(buildShippingFeePayload())
			});
			const payload = await response.json().catch(() => null);
			if (requestId !== shippingFeeRequestId) return;
			if (!response.ok) {
				shippingFeeQuote = null;
				shippingFeeError = payload?.error || $t('checkout.errors.shippingFeeFailed');
				return;
			}
			shippingFeeQuote = payload?.metadata ?? null;
			shippingFeeError = '';
			if (shippingFeeQuote?.fee?.delivery === false) {
				shippingFeeError = $t('checkout.errors.shippingFeeFailed');
			}
		} catch {
			if (requestId !== shippingFeeRequestId) return;
			shippingFeeQuote = null;
			shippingFeeError = $t('checkout.errors.shippingFeeFailed');
		} finally {
			if (requestId === shippingFeeRequestId) {
				isLoadingShippingFee = false;
			}
		}
	};

	const handleCheckoutSubmit = (event) => {
		formSubmitted = true;
		const nextErrors = computeFieldErrors();
		fieldErrors = nextErrors;
		if (Object.values(nextErrors).some(Boolean)) {
			event.preventDefault();
		}
	};

	const fetchLocationData = async (url) => {
		try {
			const response = await fetch(url);
			if (!response.ok) return null;
			return await response.json();
		} catch {
			return null;
		}
	};

	const loadProvinces = async () => {
		isLoadingProvince = true;
		addressLoadError = '';
		const requestId = provinceRequestId + 1;
		provinceRequestId = requestId;
		const data = await fetchLocationData(`${VIETNAM_ADDRESS_API}/p/`);
		if (requestId !== provinceRequestId) return;
		if (!Array.isArray(data) || data.length === 0) {
			addressMode = 'manual';
			addressLoadError = $t('checkout.errors.locationLoadFailed');
			isLoadingProvince = false;
			return;
		}
		provinceOptions = data
			.map((entry) => ({ code: String(entry.code), name: entry.name }))
			.filter((entry) => entry.code && entry.name);
		addressMode = 'select';
		isLoadingProvince = false;
	};

	const loadDistricts = async (code) => {
		if (!code) {
			districtOptions = [];
			return;
		}
		isLoadingDistrict = true;
		const requestId = districtRequestId + 1;
		districtRequestId = requestId;
		const data = await fetchLocationData(`${VIETNAM_ADDRESS_API}/p/${code}?depth=2`);
		if (requestId !== districtRequestId) return;
		if (!data || !Array.isArray(data?.districts)) {
			addressMode = 'manual';
			addressLoadError = $t('checkout.errors.locationLoadFailed');
			isLoadingDistrict = false;
			return;
		}
		const districts = data.districts;
		districtOptions = districts
			.map((entry) => ({ code: String(entry.code), name: entry.name }))
			.filter((entry) => entry.code && entry.name);
		isLoadingDistrict = false;
	};

	const loadWards = async (code) => {
		if (!code) {
			wardOptions = [];
			return;
		}
		isLoadingWard = true;
		const requestId = wardRequestId + 1;
		wardRequestId = requestId;
		const data = await fetchLocationData(`${VIETNAM_ADDRESS_API}/d/${code}?depth=2`);
		if (requestId !== wardRequestId) return;
		if (!data || !Array.isArray(data?.wards)) {
			addressMode = 'manual';
			addressLoadError = $t('checkout.errors.locationLoadFailed');
			isLoadingWard = false;
			return;
		}
		const wards = data.wards;
		wardOptions = wards
			.map((entry) => ({ code: String(entry.code), name: entry.name }))
			.filter((entry) => entry.code && entry.name);
		isLoadingWard = false;
	};

	const handleProvinceSelect = async (event) => {
		const code = String(event.currentTarget.value || '');
		provinceCode = code;
		const selected = provinceOptions.find((entry) => entry.code === code);
		provinceInput = selected?.name || '';
		districtCode = '';
		districtInput = '';
		wardCode = '';
		wardInput = '';
		wardOptions = [];
		await loadDistricts(code);
	};

	const handleDistrictSelect = async (event) => {
		const code = String(event.currentTarget.value || '');
		districtCode = code;
		const selected = districtOptions.find((entry) => entry.code === code);
		districtInput = selected?.name || '';
		wardCode = '';
		wardInput = '';
		await loadWards(code);
	};

	const handleWardSelect = (event) => {
		const code = String(event.currentTarget.value || '');
		wardCode = code;
		const selected = wardOptions.find((entry) => entry.code === code);
		wardInput = selected?.name || '';
	};

	const openVoucherModal = () => {
		pendingDiscount = appliedDiscount;
		voucherInput = appliedDiscount?.discount_code || appliedDiscountCode || discountCodeInput || '';
		showVoucherModal = true;
	};

	const closeVoucherModal = () => {
		showVoucherModal = false;
		pendingDiscount = null;
	};

	const selectPendingDiscount = (option) => {
		pendingDiscount = option;
		voucherInput = option?.discount_code || '';
	};

	const applyPendingVoucher = () => {
		const normalized = normalizeCode(voucherInput || pendingDiscount?.discount_code);
		if (!normalized) {
			clearVoucher();
			showVoucherModal = false;
			return;
		}
		discountCodeInput = normalized;
		applyDiscount(normalized);
		showVoucherModal = false;
	};

	onMount(() => {
		loadProvinces();
	});

	onMount(() => {
		guestItems = readGuestCart();
		const handleGuestCartChange = () => {
			guestItems = readGuestCart();
		};
		window.addEventListener('guest-cart:change', handleGuestCartChange);
		window.addEventListener('storage', handleGuestCartChange);
		return () => {
			window.removeEventListener('guest-cart:change', handleGuestCartChange);
			window.removeEventListener('storage', handleGuestCartChange);
		};
	});

	const submitGuestCheckout = async (event) => {
		event.preventDefault();
		guestLeadSuccess = '';
		guestLeadError = '';
		const name = nameInput.trim();
		const phone = phoneInput.trim();
		const email = emailInput.trim();
		const address = addressInput.trim();
		if (!name || !phone || !address || !guestItems.length) {
			guestLeadError =
				$locale === 'en'
					? 'Please enter name, phone, delivery address, and keep at least one item in cart.'
					: 'Vui lòng nhập tên, số điện thoại, địa chỉ giao hàng và giữ ít nhất một sản phẩm trong giỏ.';
			return;
		}
		guestLeadSubmitting = true;
		try {
			const itemLines = guestItems.map((item, index) => {
				const variant = [item.variantColor, item.variantSize].filter(Boolean).join(' / ');
				return `${index + 1}. ${item.name}${variant ? ` (${variant})` : ''} x${item.quantity} - ${formatPrice(item.price * item.quantity)}`;
			});
			const formData = new FormData();
			formData.set('name', name);
			formData.set('contact', [phone, email].filter(Boolean).join(' | '));
			formData.set(
				'message',
				[
					'[Guest COD checkout]',
					`Địa chỉ: ${address}`,
					noteInput.trim() ? `Ghi chú: ${noteInput.trim()}` : '',
					`Tạm tính: ${formatPrice(guestSummary.subtotal)}`,
					...itemLines
				]
					.filter(Boolean)
					.join('\n')
			);
			formData.set('returnTo', '/checkout?guest=1');
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
				throw new Error(payload?.message || 'guest checkout failed');
			}
			clearGuestCart();
			guestItems = [];
			guestLeadSuccess =
				$locale === 'en'
					? 'Your COD request has been sent. Inoxpran will confirm by phone or Zalo.'
					: 'Yêu cầu đặt COD đã được gửi. Inoxpran sẽ gọi hoặc nhắn Zalo để xác nhận.';
			nameInput = '';
			phoneInput = '';
			emailInput = '';
			addressInput = '';
			noteInput = '';
		} catch {
			guestLeadError =
				$locale === 'en'
					? 'Unable to send your order request right now. Please call 0867 024 186.'
					: 'Chưa gửi được yêu cầu đặt hàng. Vui lòng gọi 0867 024 186.';
		} finally {
			guestLeadSubmitting = false;
		}
	};

	$effect(() => {
		void nameInput;
		void phoneInput;
		void addressInput;
		void wardInput;
		void districtInput;
		void provinceInput;
		void items;
		void merchandiseTotals.totalCheckout;
		void isLoadingProvince;
		void isLoadingDistrict;
		void isLoadingWard;

		if (shippingFeeTimer) {
			clearTimeout(shippingFeeTimer);
			shippingFeeTimer = undefined;
		}

		if (
			!hasCompleteAddress() ||
			!items.length ||
			isLoadingProvince ||
			isLoadingDistrict ||
			isLoadingWard
		) {
			shippingFeeQuote = null;
			shippingFeeError = '';
			isLoadingShippingFee = false;
			return;
		}

		shippingFeeTimer = setTimeout(() => {
			fetchShippingFee();
		}, 400);

		return () => {
			if (shippingFeeTimer) {
				clearTimeout(shippingFeeTimer);
				shippingFeeTimer = undefined;
			}
		};
	});

	$effect(() => {
		if (!formSubmitted) return;
		fieldErrors = computeFieldErrors();
	});

	$effect(() => {
		if (typeof window === 'undefined') return;
		if (!form?.success) return;
		const cartCountValue = Number(form?.cartCount);
		if (!Number.isFinite(cartCountValue) || cartCountValue < 0) return;
		const safeCartCount = Math.floor(cartCountValue);
		if (syncedCheckoutCartCount === safeCartCount) return;
		syncedCheckoutCartCount = safeCartCount;
		window.dispatchEvent(
			new CustomEvent('cart:change', {
				detail: { count: safeCartCount }
			})
		);
	});

	$effect(() => {
		if (typeof window === 'undefined') return;
		if (!form?.success || !form?.guestOrder) return;
		const orderId = String(form?.order?._id || 'guest-order');
		if (clearedGuestOrderId === orderId) return;
		clearedGuestOrderId = orderId;
		clearGuestCart();
		guestItems = [];
	});
</script>

<svelte:head>
	<title>{$t('checkout.title')} | Inoxpran</title>
</svelte:head>

<section class="checkout-shell padding-large">
	<div class="container">
		<div class="checkout-header">
			<div>
				<!-- <p class="eyebrow">{$t('checkout.eyebrow')}</p> -->
				<h1 class="section-title">{$t('checkout.heading')}</h1>
				<p class="checkout-lede">{$t('checkout.lede')}</p>
			</div>
			<a class="btn btn-outline-dark" href={resolve('/cart')}>{$t('checkout.backToCart')}</a>
		</div>

		{#if form?.error}
			<div class="alert alert-danger" role="alert">{form.error}</div>
		{/if}
		{#if apiError}
			<div class="alert alert-danger" role="alert">{apiError}</div>
		{/if}
		{#if reviewError}
			<div class="alert alert-warning" role="alert">{reviewError}</div>
		{/if}
		{#if form?.success}
			<div class="alert alert-success" role="alert">
				<h4>{$t('checkout.orderSuccessTitle')}</h4>
				<p>{$t('checkout.orderSuccessDesc')}</p>
			</div>
		{/if}
		{#if guestLeadSuccess}
			<div class="alert alert-success" role="alert">{guestLeadSuccess}</div>
		{/if}
		{#if guestLeadError}
			<div class="alert alert-danger" role="alert">{guestLeadError}</div>
		{/if}

		{#if authRequired}
			{#if guestItems.length}
				<div class="checkout-grid guest-checkout-grid">
					<form
						id="guest-checkout-form"
						class="checkout-form card border-0 shadow-sm"
						method="POST"
						action="?/guestPlaceOrder"
					>
						<div class="card-body">
							<input type="hidden" name="guestCartPayload" value={guestCartPayload} />
							<input
								type="hidden"
								name="campaignCode"
								value={data?.siteMarketingCampaign?.offerCode || ''}
							/>
							<h2>{$locale === 'en' ? 'Quick COD checkout' : 'Đặt COD nhanh'}</h2>
							<p class="guest-checkout-note">
								{$locale === 'en'
									? 'No account required. Your request is sent to the admin contact inbox for confirmation.'
									: 'Không cần tài khoản. Yêu cầu sẽ vào trang quản trị liên hệ để đội bán hàng xác nhận.'}
							</p>
							<div class="form-section">
								<h3>{$t('checkout.contactTitle')}</h3>
								<div class="form-grid">
									<div>
										<label class="form-label" for="guest-name">
											{$t('checkout.name')}<span class="required-star">*</span>
										</label>
										<input
											class="form-control"
											id="guest-name"
											name="name"
											type="text"
											bind:value={nameInput}
											required
										/>
									</div>
									<div>
										<label class="form-label" for="guest-phone">
											{$t('checkout.phone')}<span class="required-star">*</span>
										</label>
										<input
											class="form-control"
											id="guest-phone"
											name="phone"
											type="tel"
											bind:value={phoneInput}
											required
										/>
									</div>
									<div class="span-2">
										<label class="form-label" for="guest-email">{$t('checkout.email')}</label>
										<input
											class="form-control"
											id="guest-email"
											name="email"
											type="email"
											bind:value={emailInput}
										/>
									</div>
									<div class="span-2">
										<label class="form-label" for="guest-address">
											{$t('checkout.address')}<span class="required-star">*</span>
										</label>
										<input
											class="form-control"
											id="guest-address"
											name="address"
											type="text"
											bind:value={addressInput}
											required
										/>
									</div>
									<div>
										<label class="form-label" for="guest-province">
											{$t('checkout.province')}<span class="required-star">*</span>
										</label>
										<input
											class="form-control"
											id="guest-province"
											name="province"
											type="text"
											bind:value={provinceInput}
											required
										/>
									</div>
									<div>
										<label class="form-label" for="guest-district">
											{$t('checkout.district')}<span class="required-star">*</span>
										</label>
										<input
											class="form-control"
											id="guest-district"
											name="district"
											type="text"
											bind:value={districtInput}
											required
										/>
									</div>
									<div class="span-2">
										<label class="form-label" for="guest-ward">
											{$t('checkout.ward')}<span class="required-star">*</span>
										</label>
										<input
											class="form-control"
											id="guest-ward"
											name="ward"
											type="text"
											bind:value={wardInput}
											required
										/>
									</div>
								</div>
							</div>
							<div class="form-section">
								<h3>{$t('checkout.paymentTitle')}</h3>
								<div class="payment-card">
									<input type="radio" checked name="guest-payment" id="guest-cod" />
									<label for="guest-cod">
										<span>{$t('checkout.paymentCod')}</span>
										<small>{$t('checkout.paymentCodHint')}</small>
									</label>
								</div>
								<PaymentMethods />
							</div>
							<div class="form-section">
								<h3>{$t('checkout.noteTitle')}</h3>
								<textarea
									class="form-control"
									id="guest-note"
									name="note"
									rows="3"
									placeholder={$t('checkout.notePlaceholder')}
									bind:value={noteInput}
								></textarea>
							</div>
						</div>
					</form>

					<aside class="checkout-summary card border-0 shadow-sm">
						<div class="card-body">
							<h3>{$t('checkout.summaryTitle')}</h3>
							<div class="summary-items">
								{#each guestItems as item (item.lineId)}
									{@const lineTotal = item.price * item.quantity}
									<div class="summary-item">
										<img src={item.image} alt={item.name} width="56" height="56" loading="lazy" />
										<div>
											<a href={resolve(item.href)}>{item.name}</a>
											<p>
												{$t('checkout.qty')}
												{item.quantity} · {formatPrice(lineTotal)}
											</p>
										</div>
									</div>
								{/each}
							</div>
							<div class="summary-row">
								<span>{$t('checkout.subtotal')}</span>
								<strong>{formatPrice(guestSummary.subtotal)}</strong>
							</div>
							<div class="summary-row">
								<span>{$t('checkout.shipping')}</span>
								<strong>{$t('checkout.shippingValue')}</strong>
							</div>
							<div class="summary-row total">
								<span>{$t('checkout.total')}</span>
								<strong>{formatPrice(guestSummary.total)}</strong>
							</div>
							<button type="submit" form="guest-checkout-form" class="btn btn-dark w-100 py-3 mt-3">
								{guestLeadSubmitting
									? $locale === 'en'
										? 'Sending...'
										: 'Đang gửi...'
									: $locale === 'en'
										? 'Place COD order'
										: 'Gửi yêu cầu COD'}
							</button>
							<div class="guest-summary-trust">
								<span>Italia 1954</span>
								<span>{$locale === 'en' ? '12-month warranty' : 'Bảo hành 12 tháng'}</span>
								<span>COD toàn quốc</span>
							</div>
						</div>
					</aside>
				</div>
			{:else}
				<div class="checkout-empty card border-0 shadow-sm">
					<div>
						<h3>{$t('checkout.emptyTitle')}</h3>
						<p>
							{$locale === 'en'
								? 'Add products to your guest cart or sign in to continue with saved cart items.'
								: 'Hãy thêm sản phẩm vào giỏ khách hoặc đăng nhập để tiếp tục với giỏ hàng đã lưu.'}
						</p>
					</div>
					<div class="checkout-empty-actions">
						<a class="btn btn-dark" href={resolve('/shop')}>{$t('checkout.emptyCta')}</a>
						<a class="btn btn-outline-dark" href={resolve('/login')}>{$t('checkout.loginCta')}</a>
					</div>
				</div>
			{/if}
		{:else if items.length === 0}
			<div class="checkout-empty card border-0 shadow-sm">
				<div>
					<h3>{$t('checkout.emptyTitle')}</h3>
					<p>{$t('checkout.emptyDesc')}</p>
				</div>
				<a class="btn btn-dark" href={resolve('/shop')}>{$t('checkout.emptyCta')}</a>
			</div>
		{:else}
			<div class="checkout-grid">
				<form
					id="checkout-order-form"
					class="checkout-form card border-0 shadow-sm"
					method="POST"
					action="?/placeOrder"
					novalidate
					onsubmit={handleCheckoutSubmit}
				>
					<div class="card-body">
						{#if data?.buyNowProductId}
							<input type="hidden" name="buyNowProductId" value={data.buyNowProductId} />
						{/if}
						{#if data?.buyNowQuantity}
							<input type="hidden" name="buyNowQuantity" value={data.buyNowQuantity} />
						{/if}
						{#if data?.buyNowPrice}
							<input type="hidden" name="buyNowPrice" value={data.buyNowPrice} />
						{/if}
						{#if data?.selectedProductIds?.length}
							<input
								type="hidden"
								name="selectedProductIds"
								value={data.selectedProductIds.join(',')}
							/>
						{/if}
						{#if normalizedAppliedCode}
							<input type="hidden" name="discount_code" value={normalizedAppliedCode} />
							<input type="hidden" name="discount_scope" value={discountScope} />
							<input
								type="hidden"
								name="discount_product_ids"
								value={discountProductIds.join(',')}
							/>
						{/if}
						<h2>{$t('checkout.formTitle')}</h2>
						<div class="form-section">
							<h3>{$t('checkout.contactTitle')}</h3>
							<div class="form-grid">
								<div>
									<label class="form-label" for="name">
										{$t('checkout.name')}<span class="required-star">*</span>
									</label>
									<input
										class="form-control"
										class:field-invalid={fieldErrors.name}
										id="name"
										name="name"
										type="text"
										bind:value={nameInput}
										required
									/>
									{#if fieldErrors.name}
										<p class="field-error">
											{$t('checkout.errors.requiredField', { field: $t('checkout.name') })}
										</p>
									{/if}
								</div>
								<div>
									<label class="form-label" for="phone">
										{$t('checkout.phone')}<span class="required-star">*</span>
									</label>
									<input
										class="form-control"
										class:field-invalid={fieldErrors.phone}
										id="phone"
										name="phone"
										type="tel"
										bind:value={phoneInput}
										required
									/>
									{#if fieldErrors.phone}
										<p class="field-error">
											{$t('checkout.errors.requiredField', { field: $t('checkout.phone') })}
										</p>
									{/if}
								</div>
								<div class="span-2">
									<label class="form-label" for="email">{$t('checkout.email')}</label>
									<input
										class="form-control"
										id="email"
										name="email"
										type="email"
										bind:value={emailInput}
									/>
								</div>
							</div>
						</div>
						<div class="form-section">
							<h3>{$t('checkout.deliveryTitle')}</h3>
							<div class="form-grid">
								{#if addressLoadError}
									<p class="field-hint span-2">{addressLoadError}</p>
								{/if}
								{#if addressMode === 'select'}
									<div class="span-2">
										<label class="form-label" for="province">
											{$t('checkout.province')}<span class="required-star">*</span>
										</label>
										<select
											class="form-select"
											class:field-invalid={fieldErrors.province}
											id="province"
											name="province_code"
											bind:value={provinceCode}
											onchange={handleProvinceSelect}
											disabled={isLoadingProvince}
											required
										>
											<option value="">{$t('checkout.selectProvince')}</option>
											{#each provinceOptions as option (option.code)}
												<option value={option.code}>{option.name}</option>
											{/each}
										</select>
										<input type="hidden" name="province" value={provinceInput} />
										{#if fieldErrors.province}
											<p class="field-error">
												{$t('checkout.errors.requiredField', { field: $t('checkout.province') })}
											</p>
										{/if}
									</div>
									<div>
										<label class="form-label" for="district">
											{$t('checkout.district')}<span class="required-star">*</span>
										</label>
										<select
											class="form-select"
											class:field-invalid={fieldErrors.district}
											id="district"
											name="district_code"
											bind:value={districtCode}
											onchange={handleDistrictSelect}
											disabled={!provinceCode || isLoadingDistrict}
											required
										>
											<option value="">{$t('checkout.selectDistrict')}</option>
											{#each districtOptions as option (option.code)}
												<option value={option.code}>{option.name}</option>
											{/each}
										</select>
										<input type="hidden" name="district" value={districtInput} />
										{#if fieldErrors.district}
											<p class="field-error">
												{$t('checkout.errors.requiredField', { field: $t('checkout.district') })}
											</p>
										{/if}
									</div>
									<div>
										<label class="form-label" for="ward">
											{$t('checkout.ward')}<span class="required-star">*</span>
										</label>
										<select
											class="form-select"
											class:field-invalid={fieldErrors.ward}
											id="ward"
											name="ward_code"
											bind:value={wardCode}
											onchange={handleWardSelect}
											disabled={!districtCode || isLoadingWard}
											required
										>
											<option value="">{$t('checkout.selectWard')}</option>
											{#each wardOptions as option (option.code)}
												<option value={option.code}>{option.name}</option>
											{/each}
										</select>
										<input type="hidden" name="ward" value={wardInput} />
										{#if fieldErrors.ward}
											<p class="field-error">
												{$t('checkout.errors.requiredField', { field: $t('checkout.ward') })}
											</p>
										{/if}
									</div>
								{:else}
									<div class="span-2">
										<label class="form-label" for="province">
											{$t('checkout.province')}<span class="required-star">*</span>
										</label>
										<input
											class="form-control"
											class:field-invalid={fieldErrors.province}
											id="province"
											name="province"
											type="text"
											bind:value={provinceInput}
											required
										/>
										{#if fieldErrors.province}
											<p class="field-error">
												{$t('checkout.errors.requiredField', { field: $t('checkout.province') })}
											</p>
										{/if}
									</div>
									<div>
										<label class="form-label" for="district">
											{$t('checkout.district')}<span class="required-star">*</span>
										</label>
										<input
											class="form-control"
											class:field-invalid={fieldErrors.district}
											id="district"
											name="district"
											type="text"
											bind:value={districtInput}
											required
										/>
										{#if fieldErrors.district}
											<p class="field-error">
												{$t('checkout.errors.requiredField', { field: $t('checkout.district') })}
											</p>
										{/if}
									</div>
									<div>
										<label class="form-label" for="ward">
											{$t('checkout.ward')}<span class="required-star">*</span>
										</label>
										<input
											class="form-control"
											class:field-invalid={fieldErrors.ward}
											id="ward"
											name="ward"
											type="text"
											bind:value={wardInput}
											required
										/>
										{#if fieldErrors.ward}
											<p class="field-error">
												{$t('checkout.errors.requiredField', { field: $t('checkout.ward') })}
											</p>
										{/if}
									</div>
								{/if}
								<div class="span-2">
									<label class="form-label" for="address">
										{$t('checkout.address')}<span class="required-star">*</span>
									</label>
									<input
										class="form-control"
										class:field-invalid={fieldErrors.address}
										id="address"
										name="address"
										type="text"
										bind:value={addressInput}
										required
									/>
									{#if fieldErrors.address}
										<p class="field-error">
											{$t('checkout.errors.requiredField', { field: $t('checkout.address') })}
										</p>
									{/if}
								</div>
							</div>
						</div>
						<div class="form-section">
							<h3>{$t('checkout.paymentTitle')}</h3>
							<div class="payment-card">
								<input type="radio" checked name="payment" id="cod" />
								<label for="cod">
									<span>{$t('checkout.paymentCod')}</span>
									<small>{$t('checkout.paymentCodHint')}</small>
								</label>
							</div>
							<PaymentMethods />
						</div>
						<div class="form-section">
							<h3>{$t('checkout.noteTitle')}</h3>
							<textarea
								class="form-control"
								name="note"
								id="note"
								rows="3"
								placeholder={$t('checkout.notePlaceholder')}
								bind:value={noteInput}
							></textarea>
						</div>
					</div>
				</form>

				<aside class="checkout-summary card border-0 shadow-sm">
					<div class="card-body">
						<h3>{$t('checkout.summaryTitle')}</h3>
						<div class="voucher-panel">
							<div class="voucher-row">
								<div>
									<p class="voucher-title">Mã giảm giá</p>
									<p class="voucher-sub">{selectedDiscountLabel}</p>
								</div>
								<button
									type="button"
									class="voucher-open"
									onclick={openVoucherModal}
									disabled={isUpdatingDiscount}
								>
									{discountOptions.length ? 'Chọn voucher' : 'Nhập mã'}
								</button>
							</div>
							{#if normalizedAppliedCode}
								<div class="voucher-selected">
									<span>
										Mã đang dùng:
										<strong>{normalizedAppliedCode}</strong>
									</span>
									<button
										type="button"
										class="voucher-clear"
										onclick={clearVoucher}
										disabled={isUpdatingDiscount}
									>
										Bỏ mã
									</button>
								</div>
							{/if}
							{#if discountError}
								<p class="voucher-error">{discountError}</p>
							{/if}
							{#if !discountOptions.length}
								<p class="voucher-empty">Chưa có voucher khả dụng.</p>
							{/if}
						</div>
						<div class="summary-items">
							{#each items as item (item.productId)}
								{@const lineTotal = item.price * item.quantity}
								<div class="summary-item">
									<img src={item.image} alt={item.name} width="56" height="56" loading="lazy" />
									<div>
										<a href={resolve(item.href)}>{item.name}</a>
										<p>
											{$t('checkout.qty')}
											{item.quantity} · {formatPrice(lineTotal)}
										</p>
									</div>
								</div>
							{/each}
						</div>
						<div class="summary-row">
							<span>{$t('checkout.subtotal')}</span>
							<strong>{formatPrice(displayTotals.totalPrice)}</strong>
						</div>
						<div class="summary-row">
							<span>{$t('checkout.discount')}</span>
							<strong>-{formatPrice(displayTotals.totalDiscount)}</strong>
						</div>
						<div class="summary-row">
							<span>{$t('checkout.shipping')}</span>
							<strong>
								{#if isLoadingShippingFee}
									{$t('checkout.shippingCalculating')}
								{:else if shippingFeeAmount > 0}
									{formatPrice(shippingFeeAmount)}
								{:else}
									{$t('checkout.shippingValue')}
								{/if}
							</strong>
						</div>
						{#if shippingFeeError}
							<p class="shipping-fee-error">{shippingFeeError}</p>
						{/if}
						<div class="summary-row total">
							<span>{$t('checkout.total')}</span>
							<strong>{formatPrice(displayTotals.totalCheckout)}</strong>
						</div>
						<button type="submit" form="checkout-order-form" class="btn btn-dark w-100 py-3 mt-3">
							{$t('checkout.placeOrder')}
						</button>
					</div>
				</aside>
			</div>
			{#if showVoucherModal}
				<div class="voucher-overlay" role="dialog" aria-modal="true">
					<div class="voucher-modal" role="document">
						<div class="voucher-modal-head">
							<h4>Chọn Voucher</h4>
							<button type="button" class="voucher-close" onclick={closeVoucherModal}> × </button>
						</div>
						<div class="voucher-input-row">
							<label class="voucher-input-label" for="checkout-voucher-input">Mã Voucher</label>
							<div class="voucher-input-group">
								<input
									id="checkout-voucher-input"
									type="text"
									placeholder="Mã giảm giá"
									bind:value={voucherInput}
								/>
								<button
									type="button"
									class="voucher-apply"
									onclick={applyPendingVoucher}
									disabled={!voucherInput.trim() || isUpdatingDiscount}
								>
									Áp dụng
								</button>
							</div>
						</div>
						<div class="voucher-list">
							{#if discountOptions.length}
								{#each discountOptions as option (option.discount_code)}
									<button
										type="button"
										class="voucher-card"
										class:selected={pendingDiscount?.discount_code === option.discount_code}
										onclick={() => selectPendingDiscount(option)}
									>
										<div class="voucher-badge">
											<span>VOUCHER</span>
										</div>
										<div class="voucher-info">
											<div class="voucher-code">{option.discount_code}</div>
											<div class="voucher-name">
												{option.discount_name || 'Voucher giảm giá'}
											</div>
											<div class="voucher-desc">
												{option.discount_applies_to === 'specific'
													? `Áp dụng cho ${option.discount_product_ids?.length || 0} sản phẩm`
													: 'Áp dụng cho toàn bộ sản phẩm'}
											</div>
											{#if option.discount_customer_applies_to === 'specific'}
												<div class="voucher-desc warning">Chỉ dành cho khách hàng được chọn</div>
											{/if}
										</div>
										<div class="voucher-select">
											<span
												class="voucher-radio"
												class:active={pendingDiscount?.discount_code === option.discount_code}
											></span>
										</div>
									</button>
								{/each}
							{:else}
								<p class="voucher-empty">Chưa có voucher khả dụng.</p>
							{/if}
						</div>
						<div class="voucher-modal-actions">
							<button type="button" class="voucher-cancel" onclick={closeVoucherModal}>
								Trở lại
							</button>
							<button
								type="button"
								class="voucher-confirm"
								onclick={applyPendingVoucher}
								disabled={(!voucherInput.trim() && !pendingDiscount) || isUpdatingDiscount}
							>
								Đồng ý
							</button>
						</div>
					</div>
					<button
						type="button"
						class="voucher-overlay-close"
						aria-label="Đóng"
						onclick={closeVoucherModal}
					></button>
				</div>
			{/if}
		{/if}
	</div>
</section>

<style>
	.checkout-shell {
		background: linear-gradient(135deg, rgba(255, 247, 232, 0.6), rgba(241, 247, 255, 0.6));
	}

	.checkout-shell,
	.checkout-shell p,
	.checkout-shell a,
	.checkout-shell label,
	.checkout-shell input,
	.checkout-shell select,
	.checkout-shell textarea {
		font-size: var(--ui-text-size);
	}

	.checkout-shell .btn,
	.checkout-shell .form-control,
	.checkout-shell .form-select {
		font-size: var(--ui-text-size);
		min-height: var(--ui-control-height);
	}

	.checkout-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-end;
		gap: 16px;
		margin-bottom: 22px;
	}

	.checkout-header .eyebrow {
		margin: 0 0 6px;
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.08em;
	}

	.checkout-header .section-title {
		margin: 0;
		font-size: clamp(1.45rem, 2.2vw, 2rem);
		line-height: 1.15;
	}

	.checkout-lede {
		max-width: 580px;
		color: #5b5b5b;
		margin: 8px 0 0;
		font-size: 0.95rem;
		line-height: 1.45;
	}

	.checkout-header .btn {
		padding: var(--ui-control-padding-y) calc(var(--ui-control-padding-x) * 1.35);
		font-size: var(--ui-btn-size);
	}

	.checkout-grid {
		display: grid;
		grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr);
		gap: 24px;
	}

	.guest-checkout-note {
		margin: 0 0 18px;
		color: #475569;
		line-height: 1.6;
	}

	.voucher-panel {
		background: linear-gradient(135deg, #fffaf2 0%, #fff 65%);
		border: 1px solid rgba(28, 20, 12, 0.1);
		border-radius: 18px;
		padding: 14px 16px;
		margin-bottom: 16px;
		box-shadow: 0 10px 22px rgba(0, 0, 0, 0.06);
	}

	.voucher-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}

	.voucher-title {
		margin: 0;
		text-transform: uppercase;
		font-size: 0.75rem;
		letter-spacing: 0.08em;
		color: rgba(89, 72, 55, 0.8);
	}

	.voucher-sub {
		margin: 4px 0 0;
		font-weight: 600;
		color: #1b1b1b;
		font-size: 0.95rem;
	}

	.voucher-open {
		background: #fff;
		color: #1b1b1b;
		border: 1px solid rgba(27, 27, 27, 0.15);
		border-radius: 999px;
		padding: 8px 14px;
		font-size: 0.85rem;
		font-weight: 700;
		cursor: pointer;
		box-shadow: 0 6px 14px rgba(0, 0, 0, 0.08);
		transition:
			transform 0.2s ease,
			box-shadow 0.2s ease,
			opacity 0.2s ease;
	}

	.voucher-open:hover {
		transform: translateY(-1px);
		box-shadow: 0 10px 18px rgba(0, 0, 0, 0.12);
	}

	.voucher-open:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.voucher-selected {
		margin-top: 10px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		font-size: 0.85rem;
		color: #6a5b4f;
	}

	.voucher-selected strong {
		color: #1b1b1b;
	}

	.voucher-clear {
		background: none;
		border: none;
		color: #c05850;
		font-weight: 700;
		cursor: pointer;
		padding: 0;
	}

	.voucher-clear:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	.voucher-error {
		margin: 8px 0 0;
		color: #c2672c;
		font-size: 0.85rem;
	}

	.voucher-empty {
		margin: 8px 0 0;
		color: rgba(22, 16, 10, 0.55);
		font-size: 0.9rem;
	}

	.voucher-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.55);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1200;
		padding: 16px;
	}

	.voucher-modal {
		width: min(720px, 92vw);
		max-height: min(680px, 90vh);
		background: #fff;
		border-radius: 16px;
		box-shadow: 0 30px 60px rgba(0, 0, 0, 0.25);
		display: flex;
		flex-direction: column;
		overflow: hidden;
		position: relative;
		z-index: 1;
	}

	.voucher-modal-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 18px 22px;
		border-bottom: 1px solid rgba(0, 0, 0, 0.08);
	}

	.voucher-modal-head h4 {
		margin: 0;
		font-size: 1.1rem;
	}

	.voucher-close {
		background: none;
		border: none;
		font-size: 1.6rem;
		line-height: 1;
		cursor: pointer;
		color: #666;
	}

	.voucher-input-row {
		padding: 18px 22px 12px;
		display: grid;
		gap: 10px;
		background: #fafafa;
	}

	.voucher-input-label {
		font-size: 0.9rem;
		font-weight: 600;
		color: #444;
	}

	.voucher-input-group {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 10px;
	}

	.voucher-input-group input {
		border: 1px solid #e0e0e0;
		border-radius: 10px;
		padding: 10px 12px;
		font-size: 0.95rem;
	}

	.voucher-apply {
		border: 1px solid #0b8799;
		background: #0b8799;
		color: #fff;
		border-radius: 10px;
		padding: 8px 16px;
		font-weight: 700;
		cursor: pointer;
	}

	.voucher-apply:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.voucher-list {
		padding: 18px 22px;
		display: grid;
		gap: 12px;
		overflow: auto;
	}

	.voucher-card {
		display: grid;
		grid-template-columns: 90px 1fr auto;
		gap: 12px;
		align-items: center;
		border: 1px solid #e6e6e6;
		border-radius: 12px;
		padding: 12px;
		background: #fff;
		text-align: left;
		cursor: pointer;
	}

	.voucher-card.selected {
		border-color: #0b8799;
		box-shadow: 0 12px 24px rgba(11, 135, 153, 0.18);
	}

	.voucher-badge {
		background: linear-gradient(140deg, #0b8799, #35b0c3);
		color: #fff;
		border-radius: 10px;
		padding: 10px;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.75rem;
		font-weight: 700;
		text-transform: uppercase;
		min-height: 70px;
	}

	.voucher-info {
		display: grid;
		gap: 4px;
	}

	.voucher-code {
		font-weight: 700;
		color: #0b8799;
		font-size: 0.95rem;
	}

	.voucher-name {
		font-weight: 600;
		color: #222;
	}

	.voucher-desc {
		font-size: 0.85rem;
		color: #666;
	}

	.voucher-desc.warning {
		color: #d56a2c;
		font-weight: 600;
	}

	.voucher-select {
		display: flex;
		align-items: center;
		justify-content: flex-end;
	}

	.voucher-radio {
		width: 18px;
		height: 18px;
		border-radius: 999px;
		border: 2px solid #ccc;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	.voucher-radio.active {
		border-color: #0b8799;
		background: #0b8799;
		box-shadow: 0 0 0 3px rgba(11, 135, 153, 0.2);
	}

	.voucher-modal-actions {
		display: flex;
		justify-content: flex-end;
		gap: 12px;
		padding: 16px 22px 20px;
		border-top: 1px solid rgba(0, 0, 0, 0.08);
		background: #fff;
	}

	.voucher-cancel,
	.voucher-confirm {
		border-radius: 10px;
		padding: 10px 18px;
		font-weight: 700;
		cursor: pointer;
		border: 1px solid transparent;
	}

	.voucher-cancel {
		background: #f3f4f6;
		color: #333;
	}

	.voucher-confirm {
		background: #e94d2f;
		border-color: #e94d2f;
		color: #fff;
	}

	.voucher-confirm:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.voucher-overlay-close {
		position: absolute;
		inset: 0;
		background: transparent;
		border: none;
		cursor: pointer;
		z-index: 0;
	}

	.checkout-form h2,
	.checkout-summary h3 {
		font-size: 1.4rem;
		margin-bottom: 20px;
	}

	.form-section {
		margin-bottom: 20px;
	}

	.form-section h3 {
		font-size: 1rem;
		margin-bottom: 12px;
		color: #1f1a14;
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}

	.form-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 14px;
	}

	.form-grid .span-2 {
		grid-column: span 2;
	}

	.required-star {
		color: #e05555;
		margin-left: 4px;
		font-weight: 700;
	}

	.field-error {
		margin: 6px 0 0;
		color: #d14b4b;
		font-size: 0.85rem;
	}

	.field-hint {
		margin: 0 0 4px;
		color: #7a6a5a;
		font-size: 0.85rem;
	}

	.field-invalid {
		border-color: rgba(219, 83, 83, 0.6) !important;
		box-shadow: 0 0 0 3px rgba(219, 83, 83, 0.12);
	}

	.payment-card {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 14px;
		border-radius: 12px;
		border: 1px solid rgba(0, 0, 0, 0.12);
		background: #fff;
	}

	.payment-card label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-weight: 600;
	}

	.payment-card small {
		color: #6a6a6a;
		font-weight: 500;
	}

	.checkout-summary {
		position: sticky;
		top: 120px;
		align-self: start;
	}

	.summary-items {
		display: grid;
		gap: 16px;
		margin-bottom: 20px;
	}

	.summary-item {
		display: grid;
		grid-template-columns: 56px minmax(0, 1fr);
		gap: 12px;
		align-items: center;
	}

	.summary-item img {
		width: 56px;
		height: 56px;
		border-radius: 12px;
		object-fit: cover;
		border: 1px solid rgba(0, 0, 0, 0.08);
	}

	.summary-item a {
		font-weight: 600;
		color: #1b1b1b;
		text-decoration: none;
	}

	.summary-item p {
		margin: 2px 0 0;
		color: #6a6a6a;
		font-size: 0.9rem;
	}

	.summary-row {
		display: flex;
		justify-content: space-between;
		margin-bottom: 12px;
		font-weight: 600;
	}

	.shipping-fee-error {
		margin: -6px 0 12px;
		color: #c2672c;
		font-size: 0.85rem;
		font-weight: 600;
	}

	.summary-row.total {
		padding-top: 12px;
		border-top: 1px dashed rgba(0, 0, 0, 0.15);
		font-size: 1.1rem;
	}

	.guest-summary-trust {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-top: 14px;
	}

	.guest-summary-trust span {
		border: 1px solid rgba(15, 23, 42, 0.1);
		border-radius: 999px;
		background: #ffffff;
		color: #111827;
		font-size: 0.74rem;
		font-weight: 800;
		padding: 6px 10px;
		text-transform: uppercase;
	}

	.checkout-empty {
		padding: 32px;
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 20px;
	}

	.checkout-empty-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
	}

	@media (max-width: 992px) {
		.checkout-grid {
			grid-template-columns: 1fr;
		}

		.checkout-summary {
			position: static;
		}

		.checkout-header {
			flex-direction: column;
			align-items: flex-start;
		}
	}

	@media (max-width: 768px) {
		.checkout-header {
			margin-bottom: 16px;
		}

		.checkout-header .eyebrow {
			font-size: 0.68rem;
		}

		.checkout-header .section-title {
			font-size: 1.35rem;
		}

		.checkout-header .checkout-lede {
			font-size: 0.9rem;
		}

		.checkout-summary {
			position: static;
		}

		.checkout-summary .card-body {
			max-height: none;
			overflow: visible;
		}
	}

	@media (max-width: 640px) {
		.checkout-header {
			gap: 10px;
		}

		.checkout-header .eyebrow {
			margin-bottom: 4px;
			font-size: 0.65rem;
		}

		.checkout-header .section-title {
			font-size: 1.2rem;
		}

		.checkout-header .checkout-lede {
			max-width: 100%;
			margin-top: 6px;
			font-size: 0.84rem;
		}

		.form-grid {
			grid-template-columns: 1fr;
		}

		.form-grid .span-2 {
			grid-column: span 1;
		}

		.voucher-row {
			flex-direction: column;
			align-items: flex-start;
		}

		.voucher-open {
			width: 100%;
		}

		.voucher-selected {
			flex-direction: column;
			align-items: flex-start;
			gap: 6px;
		}

		.checkout-empty {
			flex-direction: column;
			align-items: flex-start;
		}
	}
</style>
