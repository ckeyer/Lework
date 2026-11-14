import { memo } from "react";
import Markdown from "react-native-markdown-display";

/**
 * markdownStyles 对齐会话气泡的排版。
 *
 * 默认样式是桌面尺寸（段落 10 边距、行内代码 padding 10），在手机上会让
 * 气泡变得很松散；这里收窄间距，并把代码块改成深色底 + 等宽字体，和工具
 * 卡片的执行过程区分开。
 */
const markdownStyles = {
	body: { color: "#0f172a", fontSize: 15, lineHeight: 21 },
	paragraph: { marginTop: 0, marginBottom: 6 },
	heading1: { color: "#0f172a", fontSize: 20, lineHeight: 26, marginTop: 6, marginBottom: 4 },
	heading2: { color: "#0f172a", fontSize: 18, lineHeight: 24, marginTop: 6, marginBottom: 4 },
	heading3: { color: "#0f172a", fontSize: 16, lineHeight: 22, marginTop: 4, marginBottom: 2 },
	heading4: { color: "#0f172a", fontSize: 15, lineHeight: 21, marginTop: 4, marginBottom: 2 },
	heading5: { color: "#0f172a", fontSize: 14, lineHeight: 20, marginTop: 2, marginBottom: 2 },
	heading6: { color: "#64748b", fontSize: 13, lineHeight: 19, marginTop: 2, marginBottom: 2 },
	strong: { fontWeight: "700" },
	em: { fontStyle: "italic" },
	link: { color: "#2563eb", textDecorationLine: "underline" },
	blockquote: {
		backgroundColor: "#f8fafc",
		borderLeftWidth: 3,
		borderColor: "#cbd5e1",
		borderRadius: 6,
		marginLeft: 0,
		paddingHorizontal: 10,
		paddingVertical: 6,
	},
	hr: { backgroundColor: "#e2e8f0", height: 1, marginVertical: 8 },
	code_inline: {
		fontFamily: "monospace",
		fontSize: 13,
		color: "#0f172a",
		backgroundColor: "#e2e8f0",
		borderWidth: 0,
		borderRadius: 4,
		paddingHorizontal: 4,
		paddingVertical: 1,
	},
	fence: {
		fontFamily: "monospace",
		fontSize: 12,
		lineHeight: 18,
		color: "#e2e8f0",
		backgroundColor: "#0f172a",
		borderWidth: 0,
		borderRadius: 8,
		padding: 10,
		marginVertical: 4,
	},
	code_block: {
		fontFamily: "monospace",
		fontSize: 12,
		lineHeight: 18,
		color: "#e2e8f0",
		backgroundColor: "#0f172a",
		borderWidth: 0,
		borderRadius: 8,
		padding: 10,
		marginVertical: 4,
	},
	bullet_list_icon: { marginLeft: 2, marginRight: 6, color: "#64748b" },
	ordered_list_icon: { marginLeft: 2, marginRight: 6, color: "#64748b" },
	list_item: { marginBottom: 2 },
	table: { borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 6 },
	th: { flex: 1, padding: 6, backgroundColor: "#f8fafc" },
	td: { flex: 1, padding: 6 },
	tr: { borderBottomWidth: 1, borderColor: "#e2e8f0", flexDirection: "row" },
};

/**
 * MarkdownBody 渲染助手回复的 Markdown。
 *
 * 用 memo 包一层：流式更新时只有内容变化的消息才重新解析，避免整屏消息
 * 每帧都跑一遍 markdown-it。
 */
export const MarkdownBody = memo(function MarkdownBody({ content }: { content: string }) {
	return <Markdown style={markdownStyles}>{content}</Markdown>;
});
