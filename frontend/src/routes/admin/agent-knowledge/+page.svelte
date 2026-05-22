<script>
	import { locale } from '$lib/i18n/admin/index.js';

	let { data, form } = $props();

	const documents = $derived(
		Array.isArray(data?.agentKnowledgeSettings?.documents) ? data.agentKnowledgeSettings.documents : []
	);
	const categoryOptions = $derived(
		Array.isArray(data?.knowledgeCategoryOptions) ? data.knowledgeCategoryOptions : []
	);
	const previewById = $derived(data?.previewById || {});
	const updatedAt = $derived(data?.agentKnowledgeSettings?.updatedAt || null);
	const isEn = $derived($locale === 'en');

	const formatDateTime = (value) => {
		if (!value) return '--';
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return '--';
		return new Intl.DateTimeFormat($locale === 'en' ? 'en-US' : 'vi-VN', {
			dateStyle: 'medium',
			timeStyle: 'short'
		}).format(date);
	};

	const getCategoryLabel = (value) =>
		categoryOptions.find((option) => option.value === value)?.label || value || '--';
</script>

<svelte:head>
	<title>{isEn ? 'AI knowledge base' : 'Kho tri thức AI'} | Inoxpran</title>
</svelte:head>

<section class="agent-knowledge-page">
	<header class="agent-knowledge-page__header border rounded-4 bg-white p-4">
		<div>
			<p class="agent-knowledge-page__eyebrow">{isEn ? 'AI knowledge base' : 'Kho tri thức AI'}</p>
			<h1 class="h3 mb-2">{isEn ? 'AI knowledge base' : 'Kho tri thức AI'}</h1>
			<p class="text-secondary mb-0">
				{isEn
					? 'Upload product sheets, manuals, warranty policies, or paste structured notes. The system normalizes every file into clean plain text before saving it for ChatGPT support.'
					: 'Tải lên tài liệu sản phẩm, hướng dẫn sử dụng, chính sách bảo hành hoặc dán nội dung có cấu trúc. Hệ thống sẽ chuẩn hóa về plain text trước khi lưu để ChatGPT dùng khi hỗ trợ khách.'}
			</p>
		</div>
		<div class="agent-knowledge-page__stats">
			<div class="agent-knowledge-page__stat">
				<span>{isEn ? 'Documents' : 'Tài liệu'}</span>
				<strong>{data?.knowledgeDocumentCount || 0}</strong>
			</div>
			<div class="agent-knowledge-page__stat">
				<span>{isEn ? 'Last updated' : 'Cập nhật lần cuối'}</span>
				<strong>{formatDateTime(updatedAt)}</strong>
			</div>
		</div>
	</header>

	<div class="agent-knowledge-page__layout">
		<section class="agent-knowledge-page__panel border rounded-4 bg-white p-4">
			<div class="d-flex flex-column gap-2 mb-3">
				<h2 class="h5 mb-0">{isEn ? 'Add knowledge document' : 'Thêm tài liệu tri thức'}</h2>
				<p class="text-secondary mb-0">
					{isEn
						? 'Supported files: .txt, .md, .csv, .docx, .xlsx. Word and Excel files will be flattened into structured text automatically.'
						: 'Hỗ trợ file .txt, .md, .csv, .docx, .xlsx. File Word và Excel sẽ được chuyển thành text có cấu trúc trước khi lưu.'}
				</p>
			</div>

			<form method="POST" action="?/saveDocument" enctype="multipart/form-data" class="row g-3">
				<div class="col-lg-5">
					<label class="form-label" for="knowledgeTitle">{isEn ? 'Document title' : 'Tên tài liệu'}</label>
					<input
						id="knowledgeTitle"
						name="knowledgeTitle"
						class="form-control"
						placeholder={isEn ? 'Example: INP-6206 user manual' : 'Ví dụ: Hướng dẫn INP-6206'}
					/>
				</div>
				<div class="col-lg-4">
					<label class="form-label" for="knowledgeCategory">{isEn ? 'Category' : 'Nhóm tài liệu'}</label>
					<select id="knowledgeCategory" name="knowledgeCategory" class="form-select">
						{#each categoryOptions as option}
							<option value={option.value}>{option.label}</option>
						{/each}
					</select>
				</div>
				<div class="col-lg-3">
					<label class="form-label" for="knowledgeFile">{isEn ? 'Upload file' : 'Tải file'}</label>
					<input
						id="knowledgeFile"
						name="knowledgeFile"
						type="file"
						class="form-control"
						accept=".txt,.md,.csv,.docx,.xlsx,text/plain,text/markdown,text/csv,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
					/>
				</div>
				<div class="col-12">
					<label class="form-label" for="knowledgeContent">{isEn ? 'Or paste normalized content' : 'Hoặc dán nội dung đã chuẩn hóa'}</label>
					<textarea
						id="knowledgeContent"
						name="knowledgeContent"
						rows="12"
						class="form-control"
						placeholder={isEn ? 'Paste plain text, markdown notes, FAQ content, or structured policy details here.' : 'Dán plain text, ghi chú markdown, FAQ, thông tin sản phẩm hoặc chính sách đã chuẩn hóa ở đây.'}
					></textarea>
					<div class="form-text">
						{isEn
							? 'Recommendation: keep one topic per document. For spreadsheets, put one schema per sheet so the importer can keep the structure readable.'
							: 'Khuyến nghị: mỗi tài liệu chỉ nên tập trung một chủ đề. Với file Excel, nên để một schema rõ ràng trên từng sheet để importer giữ được cấu trúc dễ đọc.'}
					</div>
				</div>
				<div class="col-12 d-flex flex-wrap gap-2 align-items-center">
					<button class="btn btn-dark" type="submit">{isEn ? 'Save knowledge document' : 'Lưu tài liệu tri thức'}</button>
					<span class="small text-secondary">
						{isEn ? 'Max upload size: 5MB. The stored text will be clipped safely if it exceeds the runtime limit.' : 'Giới hạn file 5MB. Nội dung sau khi chuẩn hóa sẽ được cắt an toàn nếu vượt giới hạn knowledge store.'}
					</span>
				</div>
			</form>

			{#if form?.error}
				<div class="alert alert-danger mt-3 mb-0">{form.error}</div>
			{/if}
		</section>

		<section class="agent-knowledge-page__panel border rounded-4 bg-white p-4">
			<div class="d-flex flex-wrap justify-content-between align-items-start gap-3 mb-3">
				<div>
					<h2 class="h5 mb-1">{isEn ? 'Current knowledge documents' : 'Danh sách tài liệu hiện tại'}</h2>
					<p class="text-secondary mb-0">
						{isEn ? 'These documents are injected into the ChatGPT support prompt as runtime knowledge.' : 'Các tài liệu này được đưa vào prompt hỗ trợ ChatGPT như runtime knowledge.'}
					</p>
				</div>
				<span class="badge text-bg-light border">{documents.length}</span>
			</div>

			{#if documents.length}
				<div class="agent-knowledge-page__documents">
					{#each documents as document}
						<article class="agent-knowledge-doc border rounded-4 p-3">
							<div class="agent-knowledge-doc__header">
								<div>
									<h3 class="h6 mb-1 text-break">{document.title}</h3>
									<div class="agent-knowledge-doc__meta">
										<span class="badge rounded-pill text-bg-light border">{getCategoryLabel(document.category)}</span>
										{#if document.sourceName}
											<span>{document.sourceName}</span>
										{/if}
										<span>{formatDateTime(document.updatedAt)}</span>
									</div>
								</div>
								<form method="POST" action="?/deleteDocument">
									<input type="hidden" name="documentId" value={document.id} />
									<button class="btn btn-sm btn-outline-danger" type="submit">{isEn ? 'Delete' : 'Xóa'}</button>
								</form>
							</div>

							<p class="agent-knowledge-doc__preview">{previewById[document.id] || ''}</p>

							<details class="agent-knowledge-doc__details">
								<summary>{isEn ? 'View normalized content' : 'Xem nội dung đã chuẩn hóa'}</summary>
								<pre>{document.content}</pre>
							</details>
						</article>
					{/each}
				</div>
			{:else}
				<div class="agent-knowledge-page__empty border rounded-4 p-4 text-secondary">
					{isEn ? 'No knowledge documents yet.' : 'Chưa có tài liệu tri thức nào.'}
				</div>
			{/if}
		</section>
	</div>
</section>

<style>
	.agent-knowledge-page {
		display: grid;
		gap: 1.5rem;
	}

	.agent-knowledge-page__header {
		display: flex;
		justify-content: space-between;
		gap: 1.5rem;
		align-items: start;
	}

	.agent-knowledge-page__eyebrow {
		margin: 0 0 0.5rem;
		font-size: 0.78rem;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: #0f766e;
		font-weight: 700;
	}

	.agent-knowledge-page__stats {
		display: grid;
		grid-template-columns: repeat(2, minmax(140px, 1fr));
		gap: 0.75rem;
		min-width: min(100%, 360px);
	}

	.agent-knowledge-page__stat {
		padding: 1rem;
		border-radius: 1rem;
		background: linear-gradient(180deg, #f7fafc, #eef6ff);
		border: 1px solid rgba(15, 23, 42, 0.08);
		display: grid;
		gap: 0.25rem;
	}

	.agent-knowledge-page__stat span {
		font-size: 0.82rem;
		color: #64748b;
	}

	.agent-knowledge-page__stat strong {
		font-size: 1rem;
		color: #0f172a;
	}

	.agent-knowledge-page__layout {
		display: grid;
		gap: 1.5rem;
		grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr);
	}

	.agent-knowledge-page__panel {
		min-width: 0;
	}

	.agent-knowledge-page__documents {
		display: grid;
		gap: 1rem;
	}

	.agent-knowledge-doc {
		display: grid;
		gap: 0.9rem;
		background: #f8fafc;
	}

	.agent-knowledge-doc__header {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		align-items: start;
	}

	.agent-knowledge-doc__meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.55rem;
		font-size: 0.83rem;
		color: #64748b;
	}

	.agent-knowledge-doc__preview {
		margin: 0;
		color: #334155;
		line-height: 1.65;
	}

	.agent-knowledge-doc__details summary {
		cursor: pointer;
		font-weight: 600;
		color: #0f172a;
	}

	.agent-knowledge-doc__details pre {
		margin: 0.85rem 0 0;
		padding: 1rem;
		border-radius: 1rem;
		background: #fff;
		border: 1px solid rgba(15, 23, 42, 0.08);
		white-space: pre-wrap;
		word-break: break-word;
		font-size: 0.92rem;
		line-height: 1.65;
		color: #0f172a;
	}

	.agent-knowledge-page__empty {
		background: #f8fafc;
	}

	@media (max-width: 991.98px) {
		.agent-knowledge-page__header,
		.agent-knowledge-page__layout {
			grid-template-columns: 1fr;
		}

		.agent-knowledge-page__header {
			flex-direction: column;
		}

		.agent-knowledge-page__stats {
			width: 100%;
			min-width: 0;
		}
	}
</style>
