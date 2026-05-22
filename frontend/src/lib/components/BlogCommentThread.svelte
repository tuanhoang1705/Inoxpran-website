<script>
	let {
		comments = [],
		depth = 0,
		onReply = null,
		formatDate = (value) => value,
		replyLabel = 'Trả lời'
	} = $props();

	const safeDepth = Math.min(Math.max(Number(depth) || 0, 0), 4);
</script>

{#if comments?.length}
	<div class="comment-thread" data-depth={safeDepth}>
		{#each comments as comment (comment.id)}
			{@const nextDepth = Math.min(safeDepth + 1, 4)}
			<article class="comment-item" style={`--comment-depth:${safeDepth};`}>
				<div class="comment-avatar">
					{comment.avatar || (comment.author ? comment.author.charAt(0).toUpperCase() : 'I')}
				</div>
				<div class="comment-content">
					<div class="comment-header">
						<h4 class="comment-author">{comment.author}</h4>
						<span class="comment-date">{formatDate(comment.date)}</span>
					</div>
					<p class="comment-text">{comment.content}</p>
					<button
						type="button"
						class="comment-reply-btn"
						onclick={() => onReply && onReply(comment)}
					>
						{replyLabel}
					</button>
				</div>
			</article>
			{#if comment.replies?.length}
				<div class="comment-children" style={`margin-left:${nextDepth * 18}px;`}>
					<svelte:self
						comments={comment.replies}
						depth={nextDepth}
						onReply={onReply}
						formatDate={formatDate}
						replyLabel={replyLabel}
					/>
				</div>
			{/if}
		{/each}
	</div>
{/if}
