import { json } from '@sveltejs/kit';
import { API_BASE } from '$lib/server/api.js';
import { buildUserHeaders, getUserSession } from '$lib/server/userAuth.js';
import { buildFallbackShippingQuote } from '$lib/server/shippingFeeFallback.js';

const readJson = async (response) => {
	try {
		return await response.json();
	} catch {
		return null;
	}
};

export const POST = async ({ request, fetch, cookies }) => {
	let body = null;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid request payload.' }, { status: 400 });
	}

	const receiver = body?.receiver && typeof body.receiver === 'object' ? body.receiver : {};
	const requiredFields = ['address', 'district', 'province', 'ward', 'name', 'phone'];
	const missingFields = requiredFields.filter((field) => !String(receiver?.[field] || '').trim());
	if (missingFields.length) {
		return json({ error: 'Shipping address is incomplete.' }, { status: 400 });
	}

	const packageInfo = body?.package && typeof body.package === 'object' ? body.package : {};
	const weight = Number(packageInfo?.weight || 0);
	if (!Number.isFinite(weight) || weight <= 0) {
		return json({ error: 'Package weight is required.' }, { status: 400 });
	}

	const session = getUserSession(cookies);
	if (!session) {
		return json({ error: 'Authentication required.' }, { status: 401 });
	}

	const normalizedWeight = Math.floor(weight);
	const requestPayload = {
		provider: 'GHTK',
		receiver,
		package: {
			weight: normalizedWeight
		},
		value: Number(body?.value || 0),
		transport: body?.transport || 'road',
		tags: Array.isArray(body?.tags) ? body.tags : undefined
	};
	const buildFallbackMetadata = (reason) =>
		buildFallbackShippingQuote({
			weight: normalizedWeight,
			reason,
			request: requestPayload
		});

	try {
		const response = await fetch(`${API_BASE}/shipping/fee`, {
			method: 'POST',
			headers: {
				...buildUserHeaders(session),
				'content-type': 'application/json'
			},
			body: JSON.stringify(requestPayload)
		});

		const payload = await readJson(response);
		if (!response.ok) {
			if ([401, 403].includes(response.status)) {
				return json(
					{ error: payload?.message || payload?.error || 'Authentication required.' },
					{ status: response.status }
				);
			}
			return json({
				metadata: payload?.metadata ?? buildFallbackMetadata('backend_shipping_fee_failed')
			});
		}

		return json({
			metadata: payload?.metadata ?? buildFallbackMetadata('backend_shipping_fee_empty')
		});
	} catch {
		return json({
			metadata: buildFallbackMetadata('backend_shipping_fee_unreachable')
		});
	}
};
