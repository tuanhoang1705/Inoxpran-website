// This module is intentionally imported dynamically by RichTextEditor. Keeping
// the complete editor runtime behind one boundary avoids loading ProseMirror on
// admin routes until an editor is actually mounted, while module caching still
// guarantees one runtime instance when a page renders more than one editor.
export const loadTiptapRuntime = async () => {
	const [
		{ Editor },
		{ default: Color },
		{ default: Image },
		{ default: Link },
		{ default: Placeholder },
		{ Table, TableCell, TableHeader, TableRow },
		{ TaskItem },
		{ TaskList },
		{ default: TextAlign },
		{ TextStyle },
		{ default: Underline },
		{ default: StarterKit },
		{ default: Figure }
	] = await Promise.all([
		import('@tiptap/core'),
		import('@tiptap/extension-color'),
		import('@tiptap/extension-image'),
		import('@tiptap/extension-link'),
		import('@tiptap/extension-placeholder'),
		import('@tiptap/extension-table'),
		import('@tiptap/extension-task-item'),
		import('@tiptap/extension-task-list'),
		import('@tiptap/extension-text-align'),
		import('@tiptap/extension-text-style'),
		import('@tiptap/extension-underline'),
		import('@tiptap/starter-kit'),
		import('$lib/editor/figureNode.js')
	]);

	return {
		Color,
		Editor,
		Figure,
		Image,
		Link,
		Placeholder,
		StarterKit,
		Table,
		TableCell,
		TableHeader,
		TableRow,
		TaskItem,
		TaskList,
		TextAlign,
		TextStyle,
		Underline
	};
};
