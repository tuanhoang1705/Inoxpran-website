[33mcommit 7bcea535b7ca783d5a6780f7f8d9ec7eba7f2ccb[m[33m ([m[1;36mHEAD[m[33m -> [m[1;32mmaster[m[33m)[m
Author: hoangnt1705 <tuanhoang1705@gmail.com>
Date:   Mon Mar 23 17:26:33 2026 +0700

    Improve storefront SEO schemas and policy detail coverage

 frontend/package.json                              |   3 [32m+[m[31m-[m
 frontend/scripts/seo-schema-smoke.mjs              | 242 [32m+++++++++++++++[m
 frontend/src/lib/components/Footer.svelte          |   6 [32m+[m[31m-[m
 frontend/src/lib/components/ShopCatalogView.svelte |  51 [32m++++[m
 frontend/src/lib/content/policies.js               | 273 [32m+++++++++++++++++[m
 frontend/src/lib/i18n/messages.js                  |  20 [32m+[m[31m-[m
 frontend/src/lib/seo/meta.js                       |   8 [32m+[m[31m-[m
 frontend/src/lib/seo/schema.js                     |   4 [32m+[m[31m-[m
 frontend/src/routes/+layout.svelte                 |   8 [32m+[m[31m-[m
 frontend/src/routes/+page.js                       |   5 [32m+[m
 frontend/src/routes/+page.svelte                   |  62 [32m+++[m[31m-[m
 frontend/src/routes/about/+page.svelte             |  30 [32m+[m[31m-[m
 frontend/src/routes/blog/+page.svelte              | 112 [32m++++++[m[31m-[m
 frontend/src/routes/blog/[slug]/+page.svelte       | 100 [32m++++++[m[31m-[m
 frontend/src/routes/faq/+page.js                   |   1 [32m+[m
 frontend/src/routes/faq/+page.svelte               | 327 [32m++++++++++++++++++++[m[31m-[m
 frontend/src/routes/policies/+page.js              |   1 [32m+[m
 frontend/src/routes/policies/+page.svelte          |  94 [32m+++++[m[31m-[m
 .../src/routes/policies/[slug]/+page.server.js     |  46 [32m+++[m
 frontend/src/routes/policies/[slug]/+page.svelte   | 234 [32m+++++++++++++++[m
 frontend/src/routes/product/[slug]/+page.svelte    |  76 [32m+++[m[31m--[m
 frontend/src/routes/sitemap.xml/+server.js         |   5 [32m+[m[31m-[m
 22 files changed, 1628 insertions(+), 80 deletions(-)
