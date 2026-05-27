import { redirect } from '@sveltejs/kit';

export const load = ({ params }) => {
	throw redirect(308, `/admin/products/${params.productId}`);
};
