<script>
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { syncCartCountFromActionResult } from '$lib/client/cartCountSync.js';
	import PaymentMethods from '$lib/components/PaymentMethods.svelte';
	import {
		getGuestCartSummary,
		readGuestCart,
		removeGuestCartItem,
		updateGuestCartItem
	} from '$lib/client/guestCart.js';
	import { locale, t } from '$lib/i18n/index.js';

	let { data, form } = $props();

	const items = $derived(data?.items ?? []);
	const summary = $derived(data?.summary ?? { subtotal: 0, itemCount: 0, total: 0 });
	const authRequired = $derived(data?.authRequired ?? false);
	const apiError = $derived(data?.apiError ?? '');
	let guestItems = $state([]);
	const guestSummary = $derived.by(() => getGuestCartSummary(guestItems));
	const displayItems = $derived(authRequired ? guestItems : items);
	const displaySummary = $derived(authRequired ? guestSummary : summary);
	const itemCount = $derived(Number(displaySummary.itemCount ?? 0));
	let selectedIds = $state(new Set());
	let selectionInitialized = $state(false);

	const getCartLineId = (item) => String(item?.lineId || item?.productId || '');
	const selectedItems = $derived.by(() =>
		displayItems.filter((item) => selectedIds.has(getCartLineId(item)))
	);
	const selectedSummary = $derived.by(() => {
		const subtotal = selectedItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
		const count = selectedItems.reduce((sum, item) => sum + item.quantity, 0);
		return { subtotal, count, total: subtotal };
	});
	const selectedIdsValue = $derived.by(() =>
		Array.from(selectedIds)
			.map(String)
			.join(',')
	);
	const allSelected = $derived.by(
		() => displayItems.length > 0 && selectedItems.length === displayItems.length
	);
	const discountOptions = $derived(data?.discountOptions ?? []);
	let showVoucherModal = $state(false);
	let discountCodeInput = $state('');
	let selectedDiscount = $state(null);
	let pendingDiscount = $state(null);
	let voucherInput = $state('');
	let pendingMutationProductIds = $state(new Set());
	let queuedMutationFormsByProductId = $state(new Map());

	const setProductMutationPending = (productId, pending) => {
		if (!productId) return;
		const next = new Set(pendingMutationProductIds);
		if (pending) {
			next.add(productId);
		} else {
			next.delete(productId);
		}
		pendingMutationProductIds = next;
	};

	const queueProductMutationForm = (productId, formElement) => {
		if (!productId || !formElement) return;
		const next = new Map(queuedMutationFormsByProductId);
		next.set(productId, formElement);
		queuedMutationFormsByProductId = next;
	};

	const consumeQueuedMutationForm = (productId) => {
		if (!productId) return null;
		const next = new Map(queuedMutationFormsByProductId);
		const queuedForm = next.get(productId) ?? null;
		next.delete(productId);
		queuedMutationFormsByProductId = next;
		return queuedForm;
	};

	const toggleSelectAll = (event) => {
		const checked = event.currentTarget.checked;
		if (checked) {
			selectedIds = new Set(displayItems.map((item) => getCartLineId(item)));
		} else {
			selectedIds = new Set();
		}
	};

	const toggleSelectItem = (productId, checked) => {
		const next = new Set(selectedIds);
		if (checked) {
			next.add(String(productId));
		} else {
			next.delete(String(productId));
		}
		selectedIds = next;
	};

	$effect(() => {
		const ids = displayItems.map((item) => getCartLineId(item));
		const next = new Set(selectedIds);
		let changed = false;
		for (const id of Array.from(next)) {
			if (!ids.includes(id)) {
				next.delete(id);
				changed = true;
			}
		}
		if (!selectionInitialized && ids.length) {
			ids.forEach((id) => next.add(String(id)));
			selectionInitialized = true;
			changed = true;
		}
		if (changed) {
			selectedIds = next;
		}
	});

	const formatPrice = (value) => {
		const numeric = Number(value);
		if (!Number.isFinite(numeric)) return '';
		const localeValue = $locale === 'en' ? 'en-US' : 'vi-VN';
		return `${new Intl.NumberFormat(localeValue).format(numeric)}${$t('common.currency')}`;
	};

	const normalizeCode = (value) => String(value || '').trim();
	const findDiscountOption = (code) => {
		const normalized = normalizeCode(code).toLowerCase();
		if (!normalized) return null;
		return discountOptions.find(
			(option) => normalizeCode(option?.discount_code).toLowerCase() === normalized
		);
	};

	const normalizedDiscountCode = $derived.by(() => normalizeCode(discountCodeInput));
	const discountScope = $derived.by(() =>
		selectedDiscount?.discount_applies_to === 'specific' ? 'selected' : 'all'
	);
	const eligibleSelectedIds = $derived.by(() => {
		if (!selectedDiscount || selectedDiscount?.discount_applies_to !== 'specific') return [];
		const eligible = Array.isArray(selectedDiscount?.discount_product_ids)
			? selectedDiscount.discount_product_ids.map(String)
			: [];
		return eligible.filter((id) => selectedIds.has(String(id)));
	});
	const discountProductIds = $derived.by(() =>
		discountScope === 'selected' ? eligibleSelectedIds : []
	);
	const discountSelectionMismatch = $derived.by(
		() =>
			selectedDiscount?.discount_applies_to === 'specific' &&
			Array.isArray(selectedDiscount?.discount_product_ids) &&
			selectedDiscount.discount_product_ids.length > 0 &&
			eligibleSelectedIds.length === 0
	);
	const selectedDiscountLabel = $derived.by(() => {
		if (selectedDiscount?.discount_code) {
			const name = selectedDiscount?.discount_name || 'Voucher giảm giá';
			return `${selectedDiscount.discount_code} - ${name}`;
		}
		if (normalizedDiscountCode) return normalizedDiscountCode;
		return 'Chưa chọn voucher';
	});

	const openVoucherModal = () => {
		pendingDiscount = selectedDiscount;
		voucherInput = selectedDiscount?.discount_code || discountCodeInput || '';
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
			selectedDiscount = null;
			discountCodeInput = '';
			showVoucherModal = false;
			return;
		}
		const match = findDiscountOption(normalized);
		selectedDiscount =
			match || pendingDiscount || { discount_code: normalized, discount_applies_to: 'all' };
		discountCodeInput = normalized;
		showVoucherModal = false;
	};

	const clearDiscount = () => {
		selectedDiscount = null;
		discountCodeInput = '';
	};

	const normalizeQuantityValue = (value) => {
		const parsed = Number(value);
		if (!Number.isFinite(parsed) || parsed <= 0) return 1;
		return Math.floor(parsed);
	};

	const submitQueuedMutation = (productId) => {
		const queuedForm = consumeQueuedMutationForm(productId);
		if (!queuedForm || !queuedForm.isConnected) return;
		const quantityInput = queuedForm.querySelector('input[name="quantity"]');
		if (quantityInput) {
			quantityInput.value = String(normalizeQuantityValue(quantityInput.value));
		}
		requestAnimationFrame(() => {
			queuedForm.requestSubmit?.();
		});
	};

	const adjustQuantity = (event, delta) => {
		const control = event.currentTarget?.closest('.qty-control');
		const input = control?.querySelector('input');
		if (!input) return;
		const minValue = Number(input.min || 1);
		const currentValue = normalizeQuantityValue(input.value);
		const nextValue = Math.max(Number.isFinite(minValue) ? minValue : 1, currentValue + delta);
		if (nextValue === currentValue) return;
		input.value = String(nextValue);
		input.dispatchEvent(new Event('input', { bubbles: true }));
		input.form?.requestSubmit?.();
	};

	const handleManualQuantityChange = (event) => {
		const input = event.currentTarget;
		const normalized = normalizeQuantityValue(input.value);
		const normalizedText = String(normalized);
		if (input.value !== normalizedText) {
			input.value = normalizedText;
		}
		input.form?.requestSubmit?.();
	};

	const syncGuestCart = () => {
		guestItems = readGuestCart();
		selectionInitialized = false;
	};

	const adjustGuestQuantity = (event, lineId, delta) => {
		const control = event.currentTarget?.closest('.qty-control');
		const input = control?.querySelector('input');
		const currentValue = normalizeQuantityValue(input?.value);
		const nextValue = Math.max(1, currentValue + delta);
		guestItems = updateGuestCartItem(lineId, nextValue);
	};

	const handleGuestManualQuantityChange = (event, lineId) => {
		const normalized = normalizeQuantityValue(event.currentTarget?.value);
		guestItems = updateGuestCartItem(lineId, normalized);
	};

	const removeGuestItem = (lineId) => {
		guestItems = removeGuestCartItem(lineId);
	};

	const handleAutoUpdate = ({ formData, formElement, cancel }) => {
		const productId = String(formData?.get?.('productId') || '').trim();
		if (productId && pendingMutationProductIds.has(productId)) {
			queueProductMutationForm(productId, formElement);
			cancel();
			return;
		}
		if (productId) {
			setProductMutationPending(productId, true);
		}
		return async ({ result }) => {
			if (productId) {
				setProductMutationPending(productId, false);
			}
			if (result?.type === 'success') {
				await syncCartCountFromActionResult(result);
			}
			if (productId) {
				submitQueuedMutation(productId);
			}
			if (result?.type !== 'redirect') {
				await invalidateAll();
			}
		};
	};

	$effect(() => {
		if (typeof window === 'undefined') return;
		if (!Number.isFinite(itemCount)) return;
		window.dispatchEvent(
			new CustomEvent('cart:change', { detail: { count: Math.max(0, itemCount) } })
		);
	});

	onMount(() => {
		syncGuestCart();
		const handleGuestCartChange = () => syncGuestCart();
		window.addEventListener('guest-cart:change', handleGuestCartChange);
		window.addEventListener('storage', handleGuestCartChange);
		return () => {
			window.removeEventListener('guest-cart:change', handleGuestCartChange);
			window.removeEventListener('storage', handleGuestCartChange);
		};
	});
</script>

<svelte:head>
	<title>{$t('cart.title')} | Inoxpran</title>
</svelte:head>

<section class="cart-shell padding-large">
	<div class="container">
		
		{#if form?.error}
			<div class="alert alert-danger" role="alert">{form.error}</div>
		{/if}
		{#if apiError}
			<div class="alert alert-danger" role="alert">{apiError}</div>
		{/if}

		{#if authRequired && displayItems.length === 0}
			<div class="cart-empty card border-0 shadow-sm">
				<div>
					<h3>{$t('cart.emptyTitle')}</h3>
					<p>
						{$locale === 'en'
							? 'You can add products to a guest cart first, then sign in later if you want to track orders.'
							: 'Bạn có thể thêm sản phẩm vào giỏ khách trước, đăng nhập sau nếu muốn theo dõi đơn hàng.'}
					</p>
				</div>
				<div class="cart-empty-actions">
					<a class="btn btn-dark" href="/shop">{$t('cart.emptyCta')}</a>
					<a class="btn btn-outline-dark" href="/login">{$t('cart.loginCta')}</a>
				</div>
			</div>
		{:else if !authRequired && items.length === 0}
			<div class="cart-empty card border-0 shadow-sm">
				<div>
					<h3>{$t('cart.emptyTitle')}</h3>
					<p>{$t('cart.emptyDesc')}</p>
				</div>
				<a class="btn btn-dark" href="/shop">{$t('cart.emptyCta')}</a>
			</div>
		{:else}
			<div class="cart-grid">
				<section class="cart-items card border-0 shadow">
					<div class="card-header">
						<h2>{$t('cart.itemsTitle')}</h2>
						<p>{$t('cart.itemLead')}</p>
					</div>
					<div class="cart-select-row">
						<label class="select-all">
							<input type="checkbox" checked={allSelected} onchange={toggleSelectAll} />
							<span>{$t('cart.selectAll')}</span>
						</label>
					</div>
					<div class="cart-list">
						{#each displayItems as item}
							{@const lineTotal = item.price * item.quantity}
							{@const lineId = getCartLineId(item)}
							{@const isItemMutating = pendingMutationProductIds.has(String(item.productId))}
							<article class="cart-item card-body">
								<label class="cart-select">
									<input
										type="checkbox"
										checked={selectedIds.has(lineId)}
										onchange={(event) => toggleSelectItem(lineId, event.currentTarget.checked)}
									/>
									<span>{$t('cart.selectItem')}</span>
								</label>
								<a class="cart-thumb" href={item.href} aria-label={item.name}>
									<img src={item.image} alt={item.name} width="120" height="120" loading="lazy" />
									<span>{$t('cart.viewItem')}</span>
								</a>
								<div class="cart-details">
									<div class="cart-title-row">
										<a href={item.href}>{item.name}</a>
										<span class="cart-line-total">{formatPrice(lineTotal)}</span>
									</div>
									<div class="cart-price-row">
										<span class="cart-price">{formatPrice(item.price)}</span>
										{#if item.originalPrice && item.originalPrice > item.price}
											<span class="cart-original">{formatPrice(item.originalPrice)}</span>
										{/if}
									</div>
									<div class="cart-actions">
										{#if authRequired}
											<div class="qty-form">
												<label class="qty-label">
													<span>{$t('cart.quantityLabel')}</span>
													<div class="qty-control">
														<button
															type="button"
															class="qty-btn"
															aria-label={$t('product.decreaseQuantity')}
															onclick={(event) => adjustGuestQuantity(event, lineId, -1)}
															disabled={isItemMutating}
														>
															-
														</button>
														<input
															type="number"
															name="quantity"
															min="1"
															step="1"
															inputmode="numeric"
															value={item.quantity}
															class="form-control qty-input"
															disabled={isItemMutating}
															onchange={(event) => handleGuestManualQuantityChange(event, lineId)}
														/>
														<button
															type="button"
															class="qty-btn"
															aria-label={$t('product.increaseQuantity')}
															onclick={(event) => adjustGuestQuantity(event, lineId, 1)}
															disabled={isItemMutating}
														>
															+
														</button>
													</div>
												</label>
											</div>
											<button
												type="button"
												class="btn btn-link cart-remove"
												onclick={() => removeGuestItem(lineId)}
											>
												{$t('cart.remove')}
											</button>
										{:else}
											<form
												method="POST"
												action="?/updateItem"
												class="qty-form"
												use:enhance={handleAutoUpdate}
											>
												<input type="hidden" name="productId" value={item.productId} />
													<input type="hidden" name="shopId" value={item.shopId} />
													<label class="qty-label">
														<span>{$t('cart.quantityLabel')}</span>
														<div class="qty-control">
															<button
																type="button"
																class="qty-btn"
																aria-label={$t('product.decreaseQuantity')}
																onclick={(event) => adjustQuantity(event, -1)}
																disabled={isItemMutating}
															>
																-
															</button>
															<input
																type="number"
																name="quantity"
																min="1"
																step="1"
																inputmode="numeric"
																value={item.quantity}
																class="form-control qty-input"
																disabled={isItemMutating}
																onchange={handleManualQuantityChange}
															/>
															<button
																type="button"
																class="qty-btn"
																aria-label={$t('product.increaseQuantity')}
																onclick={(event) => adjustQuantity(event, 1)}
																disabled={isItemMutating}
															>
																+
															</button>
														</div>
													</label>
												</form>
											<form method="POST" action="?/removeItem" use:enhance={handleAutoUpdate}>
												<input type="hidden" name="productId" value={item.productId} />
												<button
													type="submit"
													class="btn btn-link cart-remove"
													disabled={isItemMutating}
												>
													{$t('cart.remove')}
												</button>
											</form>
										{/if}
									</div>
								</div>
							</article>
						{/each}
					</div>
				</section>

				<aside class="cart-summary card border-0 shadow">
					<div class="summary-top">
						<h3>{$t('cart.summaryTitle')}</h3>
						<p>{$t('cart.summaryLead')}</p>
					</div>
					<div class="card-body summary-body">
						<div class="voucher-panel">
							<div class="voucher-row">
								<div>
									<p class="voucher-title">Mã giảm giá</p>
									<p class="voucher-sub">{selectedDiscountLabel}</p>
								</div>
								<button type="button" class="voucher-open" onclick={openVoucherModal}>
									{discountOptions.length ? 'Chọn voucher' : 'Nhập mã'}
								</button>
							</div>
							{#if normalizedDiscountCode}
								<div class="voucher-selected">
									<span>
										Mã đang dùng:
										<strong>{normalizedDiscountCode}</strong>
									</span>
									<button type="button" class="voucher-clear" onclick={clearDiscount}>
										Bỏ mã
									</button>
								</div>
							{/if}
							{#if discountSelectionMismatch}
								<p class="voucher-warning">
									Voucher chỉ áp dụng cho một số sản phẩm. Hãy chọn đúng sản phẩm để dùng mã.
								</p>
							{/if}
						</div>
						<div class="summary-row">
							<span>{$t('cart.subtotal')}</span>
							<strong>{formatPrice(selectedSummary.subtotal)}</strong>
						</div>
						<div class="summary-row">
							<span>{$t('cart.shipping')}</span>
							<strong>{$t('cart.shippingValue')}</strong>
						</div>
						<p class="summary-note">{$t('cart.shippingNote')}</p>
						<div class="summary-row total">
							<span>{$t('cart.total')}</span>
							<strong>{formatPrice(selectedSummary.subtotal)}</strong>
						</div>
						<div class="summary-actions">
							{#if authRequired}
								<a
									class="btn btn-dark w-100"
									class:disabled={!selectedItems.length}
									href="/checkout?guest=1"
									aria-disabled={!selectedItems.length}
								>
									{$locale === 'en' ? 'Request COD checkout' : 'Đặt COD nhanh'}
								</a>
							{:else}
								<form method="GET" action="/checkout">
									<input type="hidden" name="selectedProductIds" value={selectedIdsValue} />
									{#if normalizedDiscountCode}
										<input type="hidden" name="discount_code" value={normalizedDiscountCode} />
										<input type="hidden" name="discount_scope" value={discountScope} />
										<input
											type="hidden"
											name="discount_product_ids"
											value={discountProductIds.join(',')}
										/>
									{/if}
									<button type="submit" class="btn btn-dark w-100" disabled={!selectedItems.length}>
										{$t('cart.checkoutSelected')}
									</button>
								</form>
							{/if}
							<a class="btn btn-outline-dark w-100" href="/shop">
								{$t('cart.continueShopping')}
							</a>
						</div>
						<PaymentMethods compact />
						<div class="summary-notes">
							<p>{$t('cart.secureBadge')}</p>
							<p>{$t('cart.supportLine')}</p>
						</div>
					</div>
				</aside>
			</div>
			{#if showVoucherModal}
				<div class="voucher-overlay" role="dialog" aria-modal="true">
					<div class="voucher-modal" role="document">
						<div class="voucher-modal-head">
							<h4>Chọn Voucher</h4>
							<button type="button" class="voucher-close" onclick={closeVoucherModal}>
								×
							</button>
						</div>
						<div class="voucher-input-row">
							<label class="voucher-input-label" for="cart-voucher-input">Mã Voucher</label>
							<div class="voucher-input-group">
								<input
									id="cart-voucher-input"
									type="text"
									placeholder="Mã giảm giá"
									bind:value={voucherInput}
								/>
								<button
									type="button"
									class="voucher-apply"
									onclick={applyPendingVoucher}
									disabled={!voucherInput.trim()}
								>
									Áp dụng
								</button>
							</div>
						</div>
						<div class="voucher-list">
							{#if discountOptions.length}
								{#each discountOptions as option}
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
												<div class="voucher-desc warning">
													Chỉ dành cho khách hàng được chọn
												</div>
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
								disabled={!voucherInput.trim() && !pendingDiscount}
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
	.cart-shell {
		background:
			radial-gradient(circle at top left, rgba(13, 202, 240, 0.1), transparent 55%),
			radial-gradient(circle at top right, rgba(11, 135, 153, 0.12), transparent 40%), #fffdf8;
		min-height: 100vh;
	}

	.cart-shell,
	.cart-shell p,
	.cart-shell a,
	.cart-shell label,
	.cart-shell input,
	.cart-shell select,
	.cart-shell textarea {
		font-size: var(--ui-text-size);
	}

	.cart-shell .btn,
	.cart-shell .form-control,
	.cart-shell .form-select {
		font-size: var(--ui-text-size);
		min-height: var(--ui-control-height);
	}

	.cart-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-end;
		gap: 12px;
		margin-bottom: 16px;
	}

	.cart-header-sub {
		display: flex;
		gap: 8px;
		margin-bottom: 20px;
		flex-wrap: wrap;
	}

	.cart-pill {
		padding: 6px 12px;
		border-radius: 999px;
		border: 1px solid rgba(25, 25, 25, 0.1);
		background: rgba(20, 20, 20, 0.05);
		font-size: 0.8rem;
		font-weight: 600;
		color: #1b1b1b;
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}

	.cart-lede {
		max-width: 580px;
		color: #5b5b5b;
		margin-top: 4px;
	}

	.cart-meta {
		text-align: right;
		display: flex;
		flex-direction: column;
		gap: 8px;
		font-weight: 600;
	}

	.cart-empty-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
	}

	.cart-grid {
		display: grid;
		grid-template-columns: minmax(0, 1.2fr) minmax(0, 0.8fr);
		gap: 24px;
		align-items: start;
	}

	.cart-items {
		border-radius: 24px;
		background: #ffffff;
		border: 1px solid rgba(15, 23, 42, 0.08);
		box-shadow: 0 18px 42px rgba(15, 23, 42, 0.08);
		overflow: hidden;
	}

	.cart-items .card-header {
		padding: 24px 26px;
		border-bottom: 1px solid rgba(15, 23, 42, 0.08);
		background: linear-gradient(180deg, #ffffff 0%, #f7f8fb 100%);
	}

	.cart-select-row {
		padding: 12px 26px 4px;
		display: flex;
		justify-content: flex-start;
		position: relative;
		z-index: 2;
		background: #ffffff;
	}

	.select-all {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-weight: 600;
		color: #1f1a14;
	}

	.select-all input,
	.cart-select input {
		width: 18px;
		height: 18px;
		accent-color: #0b8799;
		cursor: pointer;
	}

	.cart-items .card-header h2 {
		font-size: 1.5rem;
		margin-bottom: 6px;
	}

	.cart-items .card-header p {
		color: #6a6a6a;
	}

	.cart-list {
		display: flex;
		flex-direction: column;
		gap: 14px;
		padding: 12px 26px 26px;
	}

	.cart-item {
		display: grid;
		grid-template-columns: 32px 120px minmax(0, 1fr);
		gap: 50px;
		padding: 16px;
		border-radius: 18px;
		border: 1px solid rgba(15, 23, 42, 0.08);
		background: #fbfcfe;
		box-shadow: 0 12px 28px rgba(15, 23, 42, 0.06);
		align-items: center;
		transition:
			border-color 0.2s ease,
			box-shadow 0.2s ease,
			transform 0.2s ease;
	}

	.cart-item:hover {
		border-color: rgba(11, 135, 153, 0.35);
		box-shadow: 0 16px 34px rgba(11, 135, 153, 0.16);
		transform: translateY(-1px);
	}

	.cart-select {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-weight: 600;
		color: #1f1a14;
		align-self: flex-start;
		margin-top: 4px;
	}

	.cart-thumb {
		position: relative;
		background: #f3f6f9;
		border-radius: 16px;
		overflow: hidden;
		min-height: 140px;
		border: 1px solid rgba(15, 23, 42, 0.08);
		display: flex;
		align-items: center;
		justify-content: center;
		flex-direction: column;
		text-align: center;
		padding: 8px;
	}

	.cart-thumb img {
		width: 120px;
		height: 120px;
		object-fit: cover;
		border-radius: 12px;
		display: block;
		margin-bottom: 6px;
	}

	.cart-thumb span {
		font-size: 0.7rem;
		color: #1d4e63;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}

	.cart-details {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.cart-title-row {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		font-weight: 700;
		font-size: 1.05rem;
		align-items: baseline;
	}

	.cart-title-row a {
		color: #1b1b1b;
		text-decoration: none;
	}

	.cart-line-total {
		color: #0f172a;
		white-space: nowrap;
		background: #eef2f7;
		border-radius: 999px;
		padding: 4px 10px;
		font-size: 0.9rem;
	}

	.cart-price-row {
		display: flex;
		gap: 10px;
		align-items: center;
		margin-top: 0;
		color: #0b8799;
		font-weight: 600;
		font-size: 0.95rem;
	}

	.cart-original {
		color: #999;
		text-decoration: line-through;
		font-weight: 500;
		font-size: 0.9rem;
	}

	.cart-actions {
		display: flex;
		align-items: center;
		gap: 12px;
		flex-wrap: wrap;
		justify-content: space-between;
	}

	.qty-form {
		display: flex;
		align-items: center;
		gap: 8px;
		background: #f1f5f9;
		padding: 8px 12px;
		border: 1px solid rgba(15, 23, 42, 0.08);
		border-radius: 999px;
	}

	.qty-label {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
		font-size: 0.9rem;
		font-weight: 600;
		color: #6a6a6a;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	.qty-control {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 4px 6px;
		border-radius: 999px;
		background: #fff;
		border: 1px solid rgba(15, 23, 42, 0.12);
	}

	.qty-btn {
		width: 28px;
		height: 28px;
		border-radius: 999px;
		border: 1px solid rgba(15, 23, 42, 0.12);
		background: #ffffff;
		color: #1f1a14;
		font-weight: 700;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		transition:
			transform 0.2s ease,
			box-shadow 0.2s ease,
			border-color 0.2s ease,
			background-color 0.2s ease,
			color 0.2s ease;
	}

	.qty-btn:hover {
		border-color: rgba(11, 135, 153, 0.5);
		background: #0b8799;
		color: #fff;
		box-shadow: 0 8px 16px rgba(11, 135, 153, 0.18);
		transform: translateY(-1px);
	}

	.qty-btn:active {
		transform: translateY(0);
		box-shadow: none;
	}

	.qty-input {
		width: 54px;
		text-align: center;
		border: none;
		background: transparent;
		padding: 4px 0;
		font-weight: 600;
	}

	.qty-input:focus {
		outline: none;
	}

	.qty-input::-webkit-outer-spin-button,
	.qty-input::-webkit-inner-spin-button {
		-webkit-appearance: none;
		margin: 0;
	}

	.qty-input {
		appearance: textfield;
		-moz-appearance: textfield;
	}

	.cart-remove {
		color: #b91c1c;
		font-weight: 600;
		text-decoration: none;
		background: rgba(185, 28, 28, 0.1);
		border: 1px solid rgba(185, 28, 28, 0.2);
		padding: 6px 12px;
		border-radius: 999px;
		transition:
			background-color 0.2s ease,
			color 0.2s ease,
			border-color 0.2s ease,
			transform 0.2s ease;
	}

	.cart-remove:hover {
		background: #b91c1c;
		border-color: #b91c1c;
		color: #fff;
		transform: translateY(-1px);
	}

	.cart-summary {
		position: sticky;
		top: 110px;
		border-radius: 28px;
		background: #1a1a1a;
		color: #fff;
		border: none;
		box-shadow: 0 20px 60px rgba(15, 20, 24, 0.15);
	}

	.cart-summary .summary-top {
		padding: 28px;
		border-bottom: 1px solid rgba(255, 255, 255, 0.08);
	}

	.cart-summary .summary-top h3 {
		margin: 0;
		font-size: 1.5rem;
	}

	.cart-summary .summary-top p {
		color: rgba(255, 255, 255, 0.7);
		margin-top: 4px;
		font-size: 0.95rem;
	}

	.cart-summary .summary-body {
		padding: 28px;
		background: linear-gradient(180deg, #1f1f1f 0%, #121212 100%);
	}


	.summary-row {
		display: flex;
		justify-content: space-between;
		margin-bottom: 8px;
		font-weight: 600;
		text-transform: uppercase;
		font-size: 0.9rem;
	}

	.summary-row.total {
		padding-top: 12px;
		border-top: 1px dashed rgba(255, 255, 255, 0.3);
		font-size: 1.1rem;
	}

	.summary-note {
		font-size: 0.9rem;
		color: rgba(255, 255, 255, 0.7);
		margin-bottom: 16px;
	}

	.summary-actions {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin-bottom: 16px;
	}

	.summary-actions .btn-dark,
	.summary-actions .btn-outline-dark {
		border-radius: 12px;
		padding: 12px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}

	.summary-actions .btn-dark {
		background: #0dcaf0;
		border: 1px solid #0dcaf0;
		color: #fff;
		transition:
			transform 0.2s ease,
			box-shadow 0.2s ease,
			background-color 0.2s ease,
			border-color 0.2s ease;
	}

	.summary-actions .btn-dark:hover,
	.summary-actions .btn-dark:focus-visible {
		background: #0aaed0;
		border-color: #0aaed0;
		transform: translateY(-1px);
	}

	.summary-actions .btn-dark:disabled,
	.summary-actions .btn-dark[disabled],
	.summary-actions .btn.disabled {
		opacity: 0.6;
		cursor: not-allowed;
		box-shadow: none;
		transform: none;
		pointer-events: none;
	}

	.summary-actions .btn-outline-dark {
		background: #e8f3ff;
		border: 1px solid #c6ddff;
		color: #1d4e63;
		box-shadow: none;
		transition:
			transform 0.2s ease,
			box-shadow 0.2s ease,
			background-color 0.2s ease,
			border-color 0.2s ease;
	}

	.summary-actions .btn-outline-dark:hover,
	.summary-actions .btn-outline-dark:focus-visible {
		background: #d8ebff;
		border-color: #aacaff;
		color: #123a4a;
		transform: translateY(-1px);
		box-shadow: 0 10px 20px rgba(29, 78, 99, 0.16);
	}

	.summary-notes > p {
		font-size: 0.85rem;
		color: #ffffff8e !important;
	}

	.voucher-panel {
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-radius: 16px;
		padding: 14px 16px;
		margin-bottom: 16px;
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
		color: rgba(255, 255, 255, 0.7);
	}

	.voucher-sub {
		margin: 4px 0 0;
		font-weight: 600;
		color: #fff;
		font-size: 0.95rem;
	}

	.voucher-open {
		background: #fff;
		color: #111;
		border: none;
		border-radius: 999px;
		padding: 8px 14px;
		font-size: 0.85rem;
		font-weight: 700;
		cursor: pointer;
	}

	.voucher-selected {
		margin-top: 10px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		font-size: 0.85rem;
		color: rgba(255, 255, 255, 0.75);
	}

	.voucher-selected strong {
		color: #fff;
	}

	.voucher-clear {
		background: none;
		border: none;
		color: #ffb3b3;
		font-weight: 700;
		cursor: pointer;
	}

	.voucher-warning {
		margin-top: 8px;
		font-size: 0.8rem;
		color: #ffb168;
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

	.voucher-empty {
		color: #666;
		font-size: 0.9rem;
		text-align: center;
		padding: 20px 0;
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



	.cart-empty {
		padding: 32px;
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 20px;
		background: #fff;
		border-radius: 20px;
	}

	@media (max-width: 992px) {
		.cart-grid {
			grid-template-columns: 1fr;
		}

		.cart-summary {
			position: static;
		}

		.cart-header {
			flex-direction: column;
			align-items: flex-start;
		}

		.cart-meta {
			text-align: left;
		}
	}

	@media (max-width: 768px) {
		.cart-shell {
			padding-bottom: 28px;
		}

		.cart-summary {
			position: static;
			margin-top: 12px;
			border-radius: 20px;
			box-shadow: 0 10px 20px rgba(15, 20, 24, 0.12);
			max-height: none;
			display: block;
			overflow: visible;
		}

		.cart-summary .summary-top {
			padding: 16px 18px;
			display: grid;
			grid-template-columns: 1fr;
			gap: 6px;
		}

		.cart-summary .summary-top p {
			display: block;
			margin: 0;
			color: rgba(255, 255, 255, 0.7);
		}

		.cart-summary .summary-body {
			padding: 16px 18px 18px;
			padding-bottom: 18px;
			flex: unset;
			min-height: unset;
			overflow-y: visible;
		}

		.summary-row {
			font-size: 0.82rem;
		}

		.summary-row.total {
			font-size: 0.98rem;
		}

		.summary-note,
		.summary-notes {
			display: none;
		}

		.voucher-panel {
			padding: 10px 12px;
			margin-bottom: 12px;
		}

		.voucher-row {
			flex-direction: column;
			align-items: flex-start;
			gap: 8px;
		}

		.voucher-open {
			width: 100%;
			text-align: center;
		}
	}

	@media (max-width: 640px) {
		.cart-item {
			gap: 16px;
			grid-template-columns: 1fr;
		}

		.cart-thumb {
			max-width: 180px;
		}

		.cart-actions {
			/* flex-direction: column;
			align-items: flex-start; */
		}

		.cart-empty {
			flex-direction: column;
			align-items: flex-start;
		}
		.cart-actions .btn,
		.summary-actions .btn {
			font-size: 0.75rem;
			padding: 11px 14px;
		}
		.cart-thumb img {
			width: 110px;
			height: 110px;
		}
		.qty-input {
			width: 48px;
		}

		.voucher-overlay {
			padding: 12px;
		}

		.voucher-modal {
			width: min(520px, 94vw);
			max-height: 85vh;
			border-radius: 14px;
		}

		.voucher-modal-head {
			padding: 12px 14px;
		}

		.voucher-modal-head h4 {
			font-size: 1rem;
		}

		.voucher-close {
			font-size: 1.3rem;
		}

		.voucher-input-row {
			padding: 12px 14px 10px;
			gap: 8px;
		}

		.voucher-input-label {
			font-size: 0.8rem;
		}

		.voucher-input-group {
			gap: 8px;
		}

		.voucher-input-group input {
			padding: 8px 10px;
			font-size: 0.85rem;
		}

		.voucher-apply {
			padding: 6px 12px;
			font-size: 0.8rem;
			border-radius: 8px;
		}

		.voucher-list {
			padding: 12px 14px;
			gap: 10px;
		}

		.voucher-card {
			grid-template-columns: 70px 1fr auto;
			gap: 10px;
			padding: 10px;
			border-radius: 10px;
		}

		.voucher-badge {
			min-height: 56px;
			padding: 8px;
			border-radius: 8px;
			font-size: 0.65rem;
		}

		.voucher-code {
			font-size: 0.85rem;
		}

		.voucher-name {
			font-size: 0.85rem;
		}

		.voucher-desc {
			font-size: 0.75rem;
		}

		.voucher-radio {
			width: 16px;
			height: 16px;
		}

		.voucher-modal-actions {
			padding: 12px 14px 14px;
			gap: 8px;
		}

		.voucher-cancel,
		.voucher-confirm {
			padding: 8px 12px;
			font-size: 0.85rem;
			border-radius: 8px;
		}
	}
</style>
