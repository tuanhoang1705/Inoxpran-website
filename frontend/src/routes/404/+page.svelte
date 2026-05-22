<script>
	import { page } from '$app/stores';

	const isEnglish = $derived($page.data?.locale === 'en');
</script>

<section class="container py-5">
	<h1 class="h4 mb-3">404</h1>
	<p class="text-muted">
		{isEnglish
			? 'This page is used to return a 404 response.'
			: 'Trang này dùng để trả về lỗi 404.'}
	</p>
</section>
