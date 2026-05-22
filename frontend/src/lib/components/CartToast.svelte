<script>
	export let visible = false;
	export let message = '';
	export let type = 'success';
	export let placement = 'corner';
	export let overlay = false;
	export let onClose = () => {};
</script>

{#if overlay}
	<div
		class={`cart-toast-overlay ${visible ? 'is-show' : ''}`}
		aria-hidden="true"
		onclick={onClose}
	></div>
{/if}

<div
	class={`cart-toast ${visible ? 'is-show' : ''} is-${type} ${
		placement === 'center' ? 'is-center' : ''
	}`}
	role="status"
	aria-live="polite"
>
	<div class="cart-toast__icon" aria-hidden="true">
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
			{#if type === 'success'}
				<path d="M5 12.5l4 4 10-10" stroke-linecap="round" stroke-linejoin="round" />
			{:else if type === 'warning'}
				<path d="M12 6v7" stroke-linecap="round" />
				<path d="M12 17h.01" stroke-linecap="round" />
			{:else}
				<path d="M6 6l12 12" stroke-linecap="round" />
				<path d="M18 6l-12 12" stroke-linecap="round" />
			{/if}
		</svg>
	</div>
	<div class="cart-toast__text">{message}</div>
	<button class="cart-toast__close" type="button" onclick={onClose} aria-label="Close">
		x
	</button>
</div>

<style>
	.cart-toast {
		position: fixed;
		top: calc(var(--site-header-height, 0px) + 12px);
		right: 12px;
		z-index: 2147483647;
		box-sizing: border-box;
		width: min(360px, calc(100vw - 32px));
		max-width: calc(100vw - max(12px, env(safe-area-inset-left)) - max(12px, env(safe-area-inset-right)));
		display: grid;
		grid-template-columns: 36px minmax(0, 1fr) 36px;
		gap: 10px;
		align-items: center;
		padding: 14px;
		border-radius: 16px;
		border: 1px solid rgba(31, 26, 20, 0.14);
		background: rgba(255, 255, 255, 0.92);
		backdrop-filter: blur(10px);
		-webkit-backdrop-filter: blur(10px);
		box-shadow: 0 28px 60px rgba(31, 26, 20, 0.22);
		overflow: hidden;
		opacity: 0;
		pointer-events: none;
		transform: translateY(-12px) scale(0.98);
		transition:
			transform 0.18s ease,
			opacity 0.18s ease;
	}

	.cart-toast.is-center {
		top: 50%;
		left: 50%;
		right: auto;
		transform: translate(-50%, -50%) scale(0.98);
	}

	.cart-toast.is-show {
		opacity: 1;
		pointer-events: auto;
		transform: translateY(0) scale(1);
	}

	.cart-toast.is-center.is-show {
		transform: translate(-50%, -50%) scale(1);
	}

	.cart-toast-overlay {
		position: fixed;
		inset: 0;
		background: rgba(15, 20, 24, 0.45);
		backdrop-filter: blur(2px);
		-webkit-backdrop-filter: blur(2px);
		opacity: 0;
		pointer-events: none;
		transition: opacity 0.2s ease;
		z-index: 2147483646;
	}

	.cart-toast-overlay.is-show {
		opacity: 1;
		pointer-events: auto;
	}

	.cart-toast__icon {
		width: 30px;
		height: 30px;
		border-radius: 999px;
		display: grid;
		place-items: center;
		background: rgba(31, 26, 20, 0.06);
		color: #1f1a14;
	}

	.cart-toast__icon svg {
		width: 18px;
		height: 18px;
	}

	.cart-toast__text {
		min-width: 0;
		font-weight: 800;
		line-height: 1.35;
		color: #1f1a14;
		white-space: normal;
		overflow-wrap: anywhere;
		word-break: break-word;
	}

	.cart-toast__close {
		width: 32px;
		height: 32px;
		min-width: 32px;
		min-height: 32px;
		padding: 0;
		display: inline-grid;
		place-items: center;
		border: 1px solid rgba(31, 26, 20, 0.2);
		border-radius: 8px;
		background: #fff;
		color: #1f1a14;
		font-size: 18px;
		font-weight: 700;
		line-height: 1;
		opacity: 1;
		cursor: pointer;
		text-transform: none;
		transition:
			background-color 0.2s ease,
			border-color 0.2s ease,
			transform 0.2s ease;
	}

	.cart-toast__close:hover {
		background: rgba(31, 26, 20, 0.1);
		border-color: rgba(31, 26, 20, 0.36);
		transform: translateY(-1px);
	}

	.cart-toast__close:focus-visible {
		outline: 2px solid rgba(13, 202, 240, 0.55);
		outline-offset: 2px;
	}

	.cart-toast.is-success {
		border-color: rgba(11, 135, 153, 0.45);
	}

	.cart-toast.is-warning {
		border-color: rgba(255, 193, 7, 0.65);
	}

	.cart-toast.is-danger,
	.cart-toast.is-error {
		border-color: rgba(180, 35, 24, 0.55);
	}

	@media (max-width: 640px) {
		.cart-toast {
			top: calc(var(--site-header-height, 0px) + max(8px, env(safe-area-inset-top)));
			right: max(10px, env(safe-area-inset-right));
			left: max(10px, env(safe-area-inset-left));
			margin: 0;
			width: auto;
			max-width: none;
			gap: 8px;
			padding: 12px;
			grid-template-columns: 34px minmax(0, 1fr) 34px;
			align-items: start;
			border-radius: 14px;
		}

		.cart-toast.is-center {
			left: 50%;
			right: auto;
			width: min(
				360px,
				calc(
					100vw - max(10px, env(safe-area-inset-left)) - max(10px, env(safe-area-inset-right)) -
						20px
				)
			);
		}

		.cart-toast__icon {
			width: 28px;
			height: 28px;
			align-self: start;
		}

		.cart-toast__icon svg {
			width: 16px;
			height: 16px;
		}

		.cart-toast__text {
			font-size: 0.9rem;
			line-height: 1.32;
			max-height: calc(1.32em * 4);
			overflow-y: auto;
			overscroll-behavior: contain;
			-webkit-overflow-scrolling: touch;
			padding-right: 2px;
		}

		.cart-toast__close {
			align-self: start;
		}

		.cart-toast__close {
			width: 30px;
			height: 30px;
			min-width: 30px;
			min-height: 30px;
			font-size: 16px;
		}
	}
</style>
