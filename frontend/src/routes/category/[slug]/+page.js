export const load = async ({ data }) => {
	return {
		...data,
		seo: { disableDefaults: true }
	};
};
