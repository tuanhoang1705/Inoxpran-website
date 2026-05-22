<script>
	import { onMount } from 'svelte';
	import { pushToast } from '$lib/stores/adminToast.js';
	import { t } from '$lib/i18n/admin/index.js';
	let { data, form } = $props();

	const discounts = form?.discounts || data?.discounts || [];
	const loadError = data?.apiError;
	let appliesTo = $state('all');
	let customerAppliesTo = $state('all');

	const confirmDelete = (event) => {
		if (!confirm($t('admin.discounts.confirmDelete'))) {
			event.preventDefault();
		}
	};

	onMount(() => {
		if (form?.toast) {
			pushToast(form.toast);
		}
	});
</script>

<svelte:head>
	<title>{$t('admin.discounts.title')} | Admin</title>
</svelte:head>

<section>
	<div class="d-flex justify-content-between align-items-center mb-3">
		<h2 class="mb-0">{$t('admin.discounts.title')}</h2>
	</div>

	{#if loadError}
		<div class="alert alert-danger">{loadError}</div>
	{/if}

	<div class="row g-3">
		<div class="col-12 col-lg-5">
			<div class="border rounded-3 p-4 bg-white">
				<h5 class="mb-3">{$t('admin.discounts.createTitle')}</h5>
				<form method="post" action="?/create" class="row g-3">
					<div class="col-12">
						<label class="form-label" for="discount-code">{$t('admin.discounts.code')}</label>
						<input class="form-control" id="discount-code" name="discount_code" required />
					</div>
					<div class="col-12">
						<label class="form-label" for="discount-name">{$t('admin.discounts.name')}</label>
						<input class="form-control" id="discount-name" name="discount_name" required />
					</div>
					<div class="col-12">
						<label class="form-label" for="discount-description">
							{$t('admin.discounts.description')}
						</label>
						<textarea
							class="form-control"
							id="discount-description"
							name="discount_description"
							rows="3"
						></textarea>
					</div>
					<div class="col-md-6">
						<label class="form-label" for="discount-type">{$t('admin.discounts.type')}</label>
						<select class="form-select" id="discount-type" name="discount_type" required>
							<option value="fixed_amount">{$t('admin.discounts.typeFixed')}</option>
							<option value="percentage">{$t('admin.discounts.typePercent')}</option>
							<option value="free_shipping">{$t('admin.discounts.typeFreeShip')}</option>
						</select>
					</div>
					<div class="col-md-6">
						<label class="form-label" for="discount-value">{$t('admin.discounts.value')}</label>
						<input
							class="form-control"
							id="discount-value"
							name="discount_value"
							type="number"
							min="0"
							required
						/>
					</div>
					<div class="col-md-6">
						<label class="form-label" for="discount-max-value">
							{$t('admin.discounts.maxValue')}
						</label>
						<input
							class="form-control"
							id="discount-max-value"
							name="discount_max_value"
							type="number"
							min="0"
							required
						/>
					</div>
					<div class="col-md-6">
						<label class="form-label" for="discount-min-order">
							{$t('admin.discounts.minOrder')}
						</label>
						<input
							class="form-control"
							id="discount-min-order"
							name="discount_min_order_value"
							type="number"
							min="0"
							required
						/>
					</div>
					<div class="col-md-6">
						<label class="form-label" for="discount-start-date">
							{$t('admin.discounts.startDate')}
						</label>
						<input
							class="form-control"
							id="discount-start-date"
							name="discount_start_date"
							type="date"
							required
						/>
					</div>
					<div class="col-md-6">
						<label class="form-label" for="discount-end-date">
							{$t('admin.discounts.endDate')}
						</label>
						<input
							class="form-control"
							id="discount-end-date"
							name="discount_end_date"
							type="date"
							required
						/>
					</div>
					<div class="col-md-6">
						<label class="form-label" for="discount-max-uses">
							{$t('admin.discounts.maxUses')}
						</label>
						<input
							class="form-control"
							id="discount-max-uses"
							name="discount_max_uses"
							type="number"
							min="0"
							value="1"
							required
						/>
					</div>
					<div class="col-md-6">
						<label class="form-label" for="discount-max-uses-per-user">
							{$t('admin.discounts.maxUsesPerUser')}
						</label>
						<input
							class="form-control"
							id="discount-max-uses-per-user"
							name="discount_max_uses_per_user"
							type="number"
							min="0"
							value="1"
							required
						/>
					</div>
					<div class="col-12">
						<label class="form-label" for="discount-applies-to">
							{$t('admin.discounts.appliesTo')}
						</label>
						<select
							class="form-select"
							id="discount-applies-to"
							name="discount_applies_to"
							bind:value={appliesTo}
						>
							<option value="all">{$t('admin.discounts.appliesAll')}</option>
							<option value="specific">{$t('admin.discounts.appliesSpecific')}</option>
						</select>
					</div>
					{#if appliesTo === 'specific'}
						<div class="col-12">
							<label class="form-label" for="discount-product-ids">
								{$t('admin.discounts.productIds')}
							</label>
							<textarea
								class="form-control"
								id="discount-product-ids"
								name="discount_product_ids"
								rows="3"
								placeholder={$t('admin.discounts.productIdsPlaceholder')}
							></textarea>
						</div>
					{/if}
					<div class="col-12">
						<label class="form-label" for="discount-customer-applies-to">
							{$t('admin.discounts.customerAppliesTo')}
						</label>
						<select
							class="form-select"
							id="discount-customer-applies-to"
							name="discount_customer_applies_to"
							bind:value={customerAppliesTo}
						>
							<option value="all">{$t('admin.discounts.customerAll')}</option>
							<option value="specific">{$t('admin.discounts.customerSpecific')}</option>
						</select>
					</div>
					{#if customerAppliesTo === 'specific'}
						<div class="col-12">
							<label class="form-label" for="discount-customer-ids">
								{$t('admin.discounts.customerIds')}
							</label>
							<textarea
								class="form-control"
								id="discount-customer-ids"
								name="discount_customer_ids"
								rows="3"
								placeholder={$t('admin.discounts.customerIdsPlaceholder')}
							></textarea>
						</div>
					{/if}
					<div class="col-12">
						<div class="form-check">
							<input
								class="form-check-input"
								type="checkbox"
								name="discount_is_active"
								id="discount_active"
								checked
							/>
							<label class="form-check-label" for="discount_active"
								>{$t('admin.discounts.active')}</label
							>
						</div>
					</div>
					<div class="col-12">
						<button class="btn btn-dark" type="submit">{$t('admin.discounts.createButton')}</button>
					</div>
				</form>
			</div>
		</div>
		<div class="col-12 col-lg-7">
			<div class="border rounded-3 bg-white">
				<div class="table-responsive">
					<table class="table mb-0 align-middle">
						<thead>
							<tr>
								<th>{$t('admin.discounts.name')}</th>
								<th>{$t('admin.discounts.code')}</th>
								<th>{$t('admin.discounts.status')}</th>
								<th class="text-end"></th>
							</tr>
						</thead>
						<tbody>
							{#if discounts.length}
								{#each discounts as discount}
									<tr>
										<td>{discount.discount_name || '--'}</td>
										<td>
											<span class="badge bg-light text-dark">
												{discount.discount_code || '--'}
											</span>
										</td>
										<td>
											<span class="badge bg-success">{$t('admin.discounts.active')}</span>
										</td>
										<td class="text-end">
											<form method="post" action="?/delete" onsubmit={confirmDelete}>
												<input
													type="hidden"
													name="discount_id"
													value={discount._id || discount.discount_code}
												/>
												<button class="btn btn-sm btn-outline-danger" type="submit">
													{$t('admin.discounts.delete')}
												</button>
											</form>
										</td>
									</tr>
								{/each}
							{:else}
								<tr>
									<td colspan="4" class="text-center text-black-50 py-4">
										{$t('admin.discounts.empty')}
									</td>
								</tr>
							{/if}
						</tbody>
					</table>
				</div>
			</div>
		</div>
	</div>
</section>
