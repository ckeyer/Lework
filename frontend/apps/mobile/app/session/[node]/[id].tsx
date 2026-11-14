import type { ContentPart, Message, PendingPermission, Session } from "@lework/api";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
	ActivityIndicator,
	FlatList,
	Modal,
	type NativeScrollEvent,
	type NativeSyntheticEvent,
	Pressable,
	RefreshControl,
	StyleSheet,
	Text,
	TextInput,
	View,
} from "react-native";

import { sessionRoute } from "../../../src/config";
import { findProjectForSession } from "../../../src/projects/model";
import { MarkdownBody } from "../../../src/session/markdown";
import {
	messageText,
	rendersMarkdown,
	shouldRenderMessage,
	toolParts,
} from "../../../src/session/messages";
import { isNearBottom } from "../../../src/session/scroll";
import { runSend } from "../../../src/session/send-flow";
import { useSession } from "../../../src/session/use-session";
import { selectSiblingSessions } from "../../../src/sessions/select";
import { useNodeSessions } from "../../../src/sessions/use-node-sessions";
import { formatRelativeTime } from "../../../src/sidebar/model";
import { useAppShell, useScreenTitle } from "../../../src/ui/app-shell-context";
import { GlobalComposer } from "../../../src/ui/global-composer";
import { ScreenTopBar } from "../../../src/ui/top-bar";

function param(value: string | string[] | undefined): string {
	return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

interface ToolState {
	status?: string;
	title?: string;
	input?: unknown;
	output?: unknown;
	content?: unknown;
	error?: unknown;
}

function pretty(value: unknown): string {
	if (value === undefined || value === null) return "";
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

function clip(value: string, limit = 4000): string {
	return value.length > limit ? `${value.slice(0, limit)}\n… 已截断` : value;
}

/** ToolSection 是展开后的单段内容，输入/输出/错误共用同一套排版。 */
function ToolSection({ label, value, error }: { label: string; value: string; error?: boolean }) {
	return (
		<View style={styles.toolSection}>
			<Text style={styles.toolSectionLabel}>{label}</Text>
			<Text style={[styles.toolSectionBody, error && styles.toolSectionError]}>{clip(value)}</Text>
		</View>
	);
}

/**
 * ToolCall 是左侧执行过程卡片：默认只露工具名与状态，点一下展开细节。
 *
 * 没有输入输出的工具（例如纯状态变更）不展开，避免点开一片空白。
 */
function ToolCall({ part }: { part: ContentPart }) {
	const [expanded, setExpanded] = useState(false);
	const state = (part.state ?? {}) as ToolState;
	const status = state.status ?? "running";
	const input = pretty(state.input);
	const output = pretty(state.output ?? state.content);
	const error = pretty(state.error ?? state.title);
	const hasDetails = Boolean(input || output || error);
	const failed = status === "error" || Boolean(error);

	return (
		<View style={styles.toolCard}>
			<Pressable
				style={styles.toolHeader}
				disabled={!hasDetails}
				onPress={() => setExpanded((open) => !open)}
			>
				<Text style={styles.toolChevron}>{hasDetails ? (expanded ? "▾" : "▸") : "•"}</Text>
				<Text style={styles.toolName} numberOfLines={1}>
					{part.tool || "tool"}
				</Text>
				<Text style={[styles.toolStatus, failed && styles.toolStatusError]}>{status}</Text>
			</Pressable>
			{expanded && hasDetails ? (
				<View style={styles.toolBody}>
					{input ? <ToolSection label="输入" value={input} /> : null}
					{output ? <ToolSection label="输出" value={output} /> : null}
					{error ? <ToolSection label="错误" value={error} error /> : null}
				</View>
			) : null}
		</View>
	);
}

function MessageRow({ message }: { message: Message }) {
	// 失败的 idle 是唯一会进入列表的 idle 消息：只留一行错误，不显示状态词。
	if (message.role === "idle") {
		return (
			<View style={styles.noticeRow}>
				<Text style={styles.noticeError}>{message.error?.message ?? "本轮执行失败"}</Text>
			</View>
		);
	}

	const isUser = message.role === "user";
	const text = messageText(message);
	const tools = toolParts(message);
	// 助手回复可能是 Markdown；用户输入保持纯文本。
	const markdown = rendersMarkdown(message) && text !== "";

	return (
		<View style={[styles.turn, isUser ? styles.userTurn : styles.assistantTurn]}>
			{text ? (
				<View style={[styles.bubble, isUser ? styles.userBubble : styles.assistantBubble]}>
					{markdown ? (
						<MarkdownBody content={text} />
					) : (
						<Text style={[styles.messageText, isUser && styles.userMessageText]}>{text}</Text>
					)}
				</View>
			) : null}
			{!isUser && tools.length > 0 ? (
				<View style={styles.tools}>
					{tools.map((part, index) => (
						<ToolCall key={part.callID || `${part.tool || "tool"}-${index}`} part={part} />
					))}
				</View>
			) : null}
			{message.error ? <Text style={styles.turnError}>{message.error.message}</Text> : null}
		</View>
	);
}

function ApprovalCard({
	permission,
	onReply,
}: {
	permission: PendingPermission;
	onReply: (decision: "once" | "always" | "reject", message?: string) => Promise<void>;
}) {
	const [rejecting, setRejecting] = useState(false);
	const [reason, setReason] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const respond = async (decision: "once" | "always" | "reject") => {
		setBusy(true);
		setError(null);
		try {
			await onReply(decision, decision === "reject" ? reason.trim() || undefined : undefined);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "failed to reply");
		} finally {
			setBusy(false);
		}
	};

	return (
		<View style={styles.approval}>
			<Text style={styles.approvalTitle}>Approval required</Text>
			<Text style={styles.approvalAction}>{permission.action || permission.id}</Text>
			{permission.message ? <Text style={styles.approvalMessage}>{permission.message}</Text> : null}
			{permission.resources.length > 0 ? (
				<View style={styles.resources}>
					{permission.resources.slice(0, 6).map((resource) => (
						<Text key={resource} style={styles.resource} numberOfLines={2}>
							{resource}
						</Text>
					))}
				</View>
			) : null}

			{rejecting ? (
				<TextInput
					style={styles.input}
					value={reason}
					onChangeText={setReason}
					placeholder="Reason (optional)"
					editable={!busy}
				/>
			) : null}

			{error ? <Text style={styles.error}>{error}</Text> : null}

			<View style={styles.approvalButtons}>
				<Pressable
					style={[styles.primaryButton, busy && styles.disabled]}
					disabled={busy}
					onPress={() => void respond("once")}
				>
					<Text style={styles.primaryButtonText}>Allow once</Text>
				</Pressable>
				<Pressable
					style={[styles.secondaryButton, busy && styles.disabled]}
					disabled={busy}
					onPress={() => void respond("always")}
				>
					<Text style={styles.secondaryButtonText}>Always</Text>
				</Pressable>
				<Pressable
					style={[styles.rejectButton, busy && styles.disabled]}
					disabled={busy}
					onPress={() => {
						if (rejecting) {
							void respond("reject");
						} else {
							setRejecting(true);
						}
					}}
				>
					<Text style={styles.rejectButtonText}>{rejecting ? "Reject" : "Reject…"}</Text>
				</Pressable>
			</View>
		</View>
	);
}

function SessionSwitcher({
	sessions,
	currentID,
	loading,
	onPick,
	onClose,
}: {
	sessions: Session[];
	currentID: string;
	loading: boolean;
	onPick: (id: string) => void;
	onClose: () => void;
}) {
	return (
		<Pressable style={styles.backdrop} onPress={onClose}>
			<View style={styles.sheet}>
				<Text style={styles.sheetTitle}>切换会话</Text>
				<FlatList
					data={sessions}
					keyExtractor={(item) => item.id}
					renderItem={({ item }) => (
						<Pressable style={styles.sheetItem} onPress={() => onPick(item.id)}>
							<Text
								style={[styles.sheetLabel, item.id === currentID && styles.sheetLabelActive]}
								numberOfLines={1}
							>
								{item.title || item.id}
							</Text>
							<Text style={styles.sheetTime}>{formatRelativeTime(item.updatedAt)}</Text>
						</Pressable>
					)}
					ListEmptyComponent={
						loading ? (
							<ActivityIndicator style={styles.sheetLoading} />
						) : (
							<Text style={styles.hint}>这个项目下还没有会话</Text>
						)
					}
				/>
			</View>
		</Pressable>
	);
}

export default function SessionScreen() {
	const params = useLocalSearchParams<{ node: string; id: string }>();
	const nodeID = param(params.node);
	const sessionID = param(params.id);

	const { settings, settingsLoading, projects } = useAppShell();
	const {
		messages,
		permissions,
		loading,
		error,
		refresh,
		reply,
		send,
		interrupt,
		sending,
		notFound,
	} = useSession(settings, nodeID, sessionID);

	const nodeSessions = useNodeSessions(settings, nodeID);
	const current = useMemo(
		() => nodeSessions.sessions.find((session) => session.id === sessionID) ?? null,
		[nodeSessions.sessions, sessionID],
	);
	const project = useMemo(
		() => (current ? findProjectForSession(current, projects.projects) : null),
		[current, projects.projects],
	);
	const title = current?.title || "会话";
	useScreenTitle(title);

	const siblings = useMemo(() => {
		if (!current) return [];
		// 项目还没聚合出来时退回会话自身的 projectID 与目录，至少不跨项目。
		const key =
			project?.key ??
			(current.projectID === "global"
				? `global:${current.directory ?? ""}`
				: (current.projectID ?? ""));
		const canonical = project?.canonical ?? current.directory ?? "";
		if (!key && !canonical) return [current];
		return selectSiblingSessions(nodeSessions.sessions, key, canonical);
	}, [current, project, nodeSessions.sessions]);

	const [draft, setDraft] = useState("");
	const [actionError, setActionError] = useState<string | null>(null);
	const [switcherOpen, setSwitcherOpen] = useState(false);

	// idle 结束标记与只有 reasoning 的消息在这里就被拦掉，列表里只剩真正的对话。
	const visibleMessages = useMemo(() => messages.filter(shouldRenderMessage), [messages]);

	const listRef = useRef<FlatList<Message>>(null);
	// 用户手动翻过历史后，流式更新不能把它拽回底部。
	const userScrolled = useRef(false);
	const stickToBottom = useRef(true);

	// biome-ignore lint/correctness/useExhaustiveDependencies: 切换会话时要重置滚动状态，而不是等 ref 变化
	useEffect(() => {
		userScrolled.current = false;
		stickToBottom.current = true;
	}, [nodeID, sessionID]);

	const scrollToLatest = (animated: boolean) => {
		if (visibleMessages.length === 0) return;
		listRef.current?.scrollToEnd({ animated });
	};

	// 内容长高时保持贴底：首次加载直接落在最底部（再往下拉不动），之后只在
	// 用户本来就贴着底部时才跟随，向上翻历史时保持原位。
	const handleContentSizeChange = () => {
		if (visibleMessages.length === 0) return;
		if (userScrolled.current && !stickToBottom.current) return;
		// 首屏虚拟列表会分多次测量，无动画地多贴一次底，避免停在半路。
		scrollToLatest(userScrolled.current);
		if (!userScrolled.current) {
			requestAnimationFrame(() => scrollToLatest(false));
		}
	};

	const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
		const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
		stickToBottom.current = isNearBottom({
			offsetY: contentOffset.y,
			contentHeight: contentSize.height,
			viewportHeight: layoutMeasurement.height,
		});
	};

	useEffect(() => {
		if (switcherOpen) nodeSessions.refresh();
	}, [switcherOpen, nodeSessions.refresh]);

	const submit = async () => {
		const text = draft.trim();
		if (!text) return;
		setActionError(null);
		// 主动发言后回到最新一条，即使刚才正在往上翻历史。
		stickToBottom.current = true;
		try {
			await runSend(
				() => send(text),
				() => setDraft(""),
			);
		} catch (caught) {
			setActionError(caught instanceof Error ? caught.message : "failed to send");
		}
	};

	const stop = async () => {
		setActionError(null);
		try {
			await interrupt();
		} catch (caught) {
			setActionError(caught instanceof Error ? caught.message : "failed to interrupt");
		}
	};

	if (settingsLoading) {
		return (
			<View style={styles.center}>
				<ActivityIndicator />
			</View>
		);
	}

	if (!settings) {
		return (
			<View style={styles.center}>
				<Text style={styles.title}>Not connected</Text>
				<Text style={styles.hint}>Configure the control plane in Settings first.</Text>
				<Pressable style={styles.primaryButton} onPress={() => router.push("/settings")}>
					<Text style={styles.primaryButtonText}>Open settings</Text>
				</Pressable>
			</View>
		);
	}

	if (notFound) {
		return (
			<View style={styles.center}>
				<Text style={styles.title}>会话不存在</Text>
				<Text style={styles.hint}>它可能已被删除，或这条深链已经过期。</Text>
				<Pressable style={styles.primaryButton} onPress={() => router.replace("/pending")}>
					<Text style={styles.primaryButtonText}>去待审批</Text>
				</Pressable>
				<Pressable style={styles.secondaryButton} onPress={() => router.replace("/")}>
					<Text style={styles.secondaryButtonText}>回首页</Text>
				</Pressable>
			</View>
		);
	}

	return (
		<View style={styles.screen}>
			<ScreenTopBar
				title={title}
				onTitlePress={() => setSwitcherOpen(true)}
				extra={
					<Pressable style={styles.stopButton} onPress={() => void stop()}>
						<Text style={styles.stopText}>停止</Text>
					</Pressable>
				}
			/>

			{error ? <Text style={styles.error}>{error}</Text> : null}
			{actionError ? <Text style={styles.error}>{actionError}</Text> : null}

			<FlatList
				ref={listRef}
				style={styles.messages}
				contentContainerStyle={styles.messagesContent}
				data={visibleMessages}
				keyExtractor={(message) => message.id}
				renderItem={({ item }) => <MessageRow message={item} />}
				refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />}
				onContentSizeChange={handleContentSizeChange}
				onLayout={() => {
					if (!userScrolled.current) scrollToLatest(false);
				}}
				onScroll={handleScroll}
				onScrollBeginDrag={() => {
					userScrolled.current = true;
				}}
				scrollEventThrottle={16}
				ListHeaderComponent={
					permissions.length > 0 ? (
						<View style={styles.approvals}>
							{permissions.map((permission) => (
								<ApprovalCard
									key={permission.id}
									permission={permission}
									onReply={(decision, message) => reply(permission.id, decision, message)}
								/>
							))}
						</View>
					) : undefined
				}
				ListEmptyComponent={
					loading ? undefined : (
						<View style={styles.center}>
							<Text style={styles.hint}>No messages yet.</Text>
						</View>
					)
				}
			/>

			<GlobalComposer
				target={{
					projectKey: project?.key ?? `${nodeID}:${sessionID}`,
					projectName: title,
					nodeID,
					showNode: false,
				}}
				showChip={false}
				value={draft}
				onChangeText={setDraft}
				onSend={submit}
				sending={sending}
			/>

			<Modal
				transparent
				visible={switcherOpen}
				animationType="fade"
				onRequestClose={() => setSwitcherOpen(false)}
			>
				<SessionSwitcher
					sessions={siblings}
					currentID={sessionID}
					loading={nodeSessions.loading}
					onPick={(id) => {
						setSwitcherOpen(false);
						if (id !== sessionID) router.replace(sessionRoute(nodeID, id));
					}}
					onClose={() => setSwitcherOpen(false)}
				/>
			</Modal>
		</View>
	);
}

const styles = StyleSheet.create({
	screen: { flex: 1 },
	center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 8 },
	title: { fontSize: 18, fontWeight: "600" },
	hint: { color: "#666", textAlign: "center" },
	error: { color: "#b91c1c", paddingHorizontal: 16, paddingTop: 8 },
	stopButton: { paddingHorizontal: 6, paddingVertical: 6 },
	stopText: { fontSize: 13, color: "#475569" },
	messages: { flex: 1 },
	messagesContent: { flexGrow: 1, justifyContent: "flex-end", padding: 16, gap: 12 },
	approvals: { gap: 10, marginBottom: 12 },
	approval: {
		borderWidth: 1,
		borderColor: "#f59e0b",
		backgroundColor: "#fffbeb",
		borderRadius: 12,
		padding: 12,
		gap: 8,
	},
	approvalTitle: { fontSize: 14, fontWeight: "700", color: "#92400e" },
	approvalAction: { fontSize: 15, fontWeight: "600" },
	approvalMessage: { fontSize: 13, color: "#475569" },
	resources: { gap: 4 },
	resource: {
		fontFamily: "monospace",
		fontSize: 12,
		color: "#334155",
		backgroundColor: "#f1f5f9",
		borderRadius: 6,
		paddingHorizontal: 8,
		paddingVertical: 6,
	},
	approvalButtons: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
	turn: { gap: 6 },
	userTurn: { alignItems: "flex-end" },
	assistantTurn: { alignItems: "flex-start" },
	bubble: { maxWidth: "82%", borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
	userBubble: { backgroundColor: "#2563eb", borderBottomRightRadius: 4 },
	assistantBubble: { backgroundColor: "#f1f5f9", borderTopLeftRadius: 4 },
	messageText: { fontSize: 15, lineHeight: 21, color: "#0f172a" },
	userMessageText: { color: "#ffffff" },
	tools: { width: "100%", gap: 6 },
	toolCard: {
		alignSelf: "flex-start",
		maxWidth: "88%",
		borderWidth: 1,
		borderColor: "#e2e8f0",
		backgroundColor: "#ffffff",
		borderRadius: 12,
		overflow: "hidden",
	},
	toolHeader: {
		flexDirection: "row",
		alignItems: "center",
		gap: 6,
		paddingHorizontal: 10,
		paddingVertical: 8,
	},
	toolChevron: { width: 12, fontSize: 12, color: "#94a3b8" },
	toolName: {
		flexShrink: 1,
		fontFamily: "monospace",
		fontSize: 13,
		fontWeight: "600",
		color: "#0f172a",
	},
	toolStatus: { marginLeft: "auto", fontSize: 11, color: "#64748b" },
	toolStatusError: { color: "#b91c1c" },
	toolBody: { borderTopWidth: 1, borderTopColor: "#f1f5f9", padding: 10, gap: 8 },
	toolSection: { gap: 4 },
	toolSectionLabel: {
		fontSize: 10,
		fontWeight: "700",
		color: "#94a3b8",
		textTransform: "uppercase",
	},
	toolSectionBody: {
		fontFamily: "monospace",
		fontSize: 12,
		lineHeight: 18,
		color: "#334155",
		backgroundColor: "#f8fafc",
		borderRadius: 8,
		padding: 8,
	},
	toolSectionError: { color: "#b91c1c", backgroundColor: "#fef2f2" },
	noticeRow: { alignItems: "flex-start", paddingHorizontal: 4 },
	noticeError: { fontSize: 12, color: "#b91c1c" },
	turnError: { maxWidth: "88%", paddingHorizontal: 4, fontSize: 12, color: "#b91c1c" },
	input: {
		borderWidth: 1,
		borderColor: "#cbd5e1",
		borderRadius: 8,
		paddingHorizontal: 10,
		paddingVertical: 8,
		fontSize: 14,
		backgroundColor: "#fff",
	},
	primaryButton: {
		backgroundColor: "#0f172a",
		borderRadius: 8,
		paddingHorizontal: 14,
		paddingVertical: 10,
		alignItems: "center",
		justifyContent: "center",
	},
	primaryButtonText: { color: "#fff", fontWeight: "600" },
	secondaryButton: {
		borderWidth: 1,
		borderColor: "#cbd5e1",
		borderRadius: 8,
		paddingHorizontal: 12,
		paddingVertical: 8,
		alignItems: "center",
	},
	secondaryButtonText: { color: "#0f172a", fontWeight: "600" },
	rejectButton: {
		borderWidth: 1,
		borderColor: "#ef4444",
		borderRadius: 8,
		paddingHorizontal: 12,
		paddingVertical: 8,
		alignItems: "center",
	},
	rejectButtonText: { color: "#b91c1c", fontWeight: "600" },
	disabled: { opacity: 0.5 },
	backdrop: { flex: 1, backgroundColor: "rgba(15, 23, 42, 0.28)", justifyContent: "flex-end" },
	sheet: {
		backgroundColor: "#fff",
		borderTopLeftRadius: 16,
		borderTopRightRadius: 16,
		padding: 16,
		gap: 8,
		maxHeight: "65%",
	},
	sheetTitle: { fontSize: 16, fontWeight: "600", marginBottom: 4 },
	sheetItem: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		gap: 12,
		paddingVertical: 12,
		borderBottomWidth: 1,
		borderBottomColor: "#f1f5f9",
	},
	sheetLabel: { flex: 1, fontSize: 15, color: "#0f172a" },
	sheetLabelActive: { fontWeight: "700", color: "#2563eb" },
	sheetTime: { fontSize: 11, color: "#94a3b8" },
	sheetLoading: { paddingVertical: 24 },
});
