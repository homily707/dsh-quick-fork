//#region dsh-quick-fork — Client half (static bundle)
/**
 * dsh-quick-fork — 纯 Client 半:回合级编辑 → 官方 fork → 自动执行。
 *
 * 形式:window.__ModuleLoader__.load 的 CJS 工厂(与 dsh-fork-edit/client.js 同型),
 * exports.apply / exports.inject 即 Cordis 插件面。
 *
 * 与 dsh-fork-edit 的根本差别:没有 host 半,不注册 HTTP 路由,不写自定义事件。
 * 全部动作都落在官方 Client 服务上:
 *
 * - 按钮席位:`conversation.chat.turnTail` 是官方 turn-tail 节点的子 list slot
 *   (`renderSlot("conversation.chat.turnTail", { turn, seq })`),每回合一个 seat,
 *   inject 回传该会话的 sessionId。seat 渲染 ✎ 按钮,排在官方 copy/branch 图标
 *   左侧,并照抄官方的 hover 显隐(data-actions-reveal)。
 * - 回合数据:`ctx.sessions.binding(id).eventSource` 已加载的事件窗口 ——
 *   官方 Conversation assembler 消费的同一个 SessionEventLikeEntry feed。
 * - 分叉:`ctx.sessions.fork({ sessionId, atSeq })`,即官方 turn 尾 branch 按钮
 *   调用的同一个 API(uatSeq 语义见下)。
 * - 执行:临时 retain 子会话 → `binding.session.prompt([text], "queue")`
 *   (官方 composer 首条消息的同一底层调用)。
 * - 切换:`ctx.uiWorkspace.openSession(childId)`。
 *
 * atSeq 语义:目标回合 `turn/start` 之前、跳过该回合输入注入事件
 * (`agent/inbox/spliced` 带 inserted)后的最后一个事件 seq。等价于 fork-edit host
 * 侧的 `turn.startSeq - 1`,但先跳过注入事件 —— v3 事件语法里输入注入落在
 * turn/start 之前、配对的领取(纯删除 splice)落在 turn/start 之后,若边界切在
 * 注入事件上,子会话会把原输入当成待领取的队列项重放一遍(fork-edit 用 host 侧
 * `child.agent.cancel({kind:"user"})` 清掉它;这里靠边界不含注入事件回避)。
 */

window.__ModuleLoader__.load({
	id: "dsh-quick-fork",
	factory: (require) => {
		var module = { exports: {} }
		var exports = module.exports
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" })
		const react = require("react")
		const h = react.createElement
		const useEffect = react.useEffect
		const useState = react.useState

		/** 官方 ic_ds_edit_outline_16(dsh-client-ui-primitives),内联避免引入包。 */
		const EDIT_PATH = "M9.94076 1.34942C10.7047 0.90231 11.6503 0.902415 12.4143 1.34942C12.7061 1.52015 12.9688 1.79118 13.3104 2.13284C13.6521 2.47448 13.9231 2.73721 14.0939 3.02894C14.5408 3.79294 14.5409 4.73856 14.0939 5.50251C13.9231 5.79415 13.652 6.05704 13.3104 6.39861L6.65932 13.0497C6.28068 13.4284 6.00695 13.7108 5.66543 13.9097C5.32391 14.1085 4.94315 14.2074 4.42705 14.3498L3.24394 14.6761C2.77527 14.8054 2.34538 14.9262 2.00131 14.9684C1.65196 15.0112 1.17964 15.0013 0.810764 14.6325C0.441921 14.2637 0.432107 13.7913 0.47486 13.442C0.517035 13.0979 0.6379 12.668 0.767181 12.1993L1.09352 11.0162C1.23588 10.5001 1.33481 10.1193 1.5336 9.77784C1.7325 9.43632 2.0149 9.1626 2.39355 8.78395L9.04466 2.13284C9.38625 1.79126 9.64911 1.52016 9.94076 1.34942ZM15.5427 14.8398H7.55223L8.96707 13.425H15.5427V14.8398ZM3.39382 9.78422C2.965 10.213 2.84244 10.3436 2.75709 10.49C2.67183 10.6366 2.61862 10.8079 2.45733 11.3925L2.13099 12.5756C2.00183 13.0439 1.92194 13.3419 1.88863 13.5536C2.10041 13.5204 2.39872 13.4416 2.86764 13.3123L4.05075 12.9859C4.63544 12.8246 4.80669 12.7715 4.95323 12.6862C5.09968 12.6008 5.23022 12.4783 5.65905 12.0494L10.721 6.98644L8.45577 4.72121L3.39382 9.78422ZM11.7 2.57079C11.3774 2.38198 10.9777 2.38198 10.6551 2.57079C10.5602 2.62647 10.4487 2.72931 10.0449 3.13311L9.45604 3.72094L11.7213 5.98617L12.3102 5.39833C12.7139 4.99457 12.8168 4.88307 12.8725 4.78818C13.0613 4.46561 13.0612 4.06585 12.8725 3.74326C12.8169 3.64827 12.7146 3.53752 12.3102 3.13311C11.9057 2.72863 11.7958 2.6264 11.7 2.57079Z"

		const CSS = [
			// 与官方 action 行同排:继承官方的 hover 显隐语义(data-actions-reveal 在同级根节点上)。
			'.qf-seat{display:inline-flex;align-items:center;opacity:0;transition:opacity .12s ease}',
			'[data-turn-tail]:hover .qf-seat,[data-turn-tail]:focus-within .qf-seat,[data-actions-reveal="always"] .qf-seat{opacity:1}',
			'.qf-iconBtn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;color:var(--dsw-alias-label-tertiary);background:transparent;border:none;border-radius:999px;cursor:pointer;padding:0;flex:none}',
			'.qf-iconBtn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}',
			'.qf-overlay{position:fixed;inset:0;background:var(--dsw-alias-bg-mask-1);display:flex;align-items:center;justify-content:center;z-index:60}',
			'.qf-modal{background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;box-shadow:var(--dsw-shadow-lv3);width:560px;max-width:calc(100vw - 32px);max-height:70vh;display:flex;flex-direction:column;padding:16px;gap:10px}',
			'.qf-title{margin:0;font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary)}',
			'.qf-textarea{width:100%;box-sizing:border-box;min-height:120px;resize:vertical;font:inherit;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);background:transparent;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:10px}',
			'.qf-textarea:focus{outline:none;border-color:var(--dsw-alias-border-inverted)}',
			'.qf-note{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}',
			'.qf-error{font-size:11px;line-height:16px;color:var(--dsw-alias-state-error-primary)}',
			'.qf-footer{display:flex;justify-content:flex-end;gap:8px;align-items:center}',
			'.qf-btn{flex:none;font:inherit;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary);background:transparent;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:6px 18px;cursor:pointer}',
			'.qf-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
			'.qf-btn:disabled{opacity:.45;cursor:default}',
			'.qf-btnPrimary{color:var(--dsw-alias-label-inverted);background:var(--dsw-alias-label-primary);border-color:transparent}',
			'.qf-btnPrimary:hover:not(:disabled){background:var(--dsw-alias-label-primary);opacity:.9}'
		].join("")

		function svgIcon(path) {
			const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
			svg.setAttribute("width", "16")
			svg.setAttribute("height", "16")
			svg.setAttribute("viewBox", "0 0 16 16")
			svg.setAttribute("fill", "none")
			const p = document.createElementNS("http://www.w3.org/2000/svg", "path")
			p.setAttribute("d", path)
			p.setAttribute("fill", "currentColor")
			svg.appendChild(p)
			return svg
		}

		function messageOf(error) {
			if (error instanceof Error) return error.message
			if (error !== null && typeof error === "object" && typeof error.message === "string") return error.message
			return String(error)
		}

		//#region 可编辑回合:已加载事件窗口 → Map<turn, { text, boundary, extraBlocks }>
		/** 该回合的输入注入事件(agent/inbox/spliced 且带 inserted 内容)。 */
		function isInputInsertion(event) {
			if (event === null || typeof event !== "object" || event.type !== "agent/inbox/spliced") return false
			const inserted = event.data === undefined ? undefined : event.data.inserted
			return Array.isArray(inserted) && inserted.length > 0
		}

		/** 用户消息的纯文本(与 host 侧 userText 同规则)。 */
		function userText(event) {
			let out = ""
			const content = event === null || typeof event !== "object" || event.data === undefined ? undefined : event.data.content
			if (!Array.isArray(content)) return out
			for (const block of content) {
				if (block === null || typeof block !== "object" || block.type !== "text" || typeof block.text !== "string") continue
				out += out === "" ? block.text : `\n${block.text}`
			}
			return out
		}

		/** 原消息里除文本外的块数(图片);分支只重放文本,提前告知。 */
		function nonTextBlocks(event) {
			const content = event === null || typeof event !== "object" || event.data === undefined ? undefined : event.data.content
			if (!Array.isArray(content)) return 0
			let count = 0
			for (const block of content) {
				if (block !== null && typeof block === "object" && block.type !== "text") count += 1
			}
			return count
		}

		/**
		 * 目标回合的分叉边界 = 该回合输入注入之前的最后一个事件 seq。
		 *
		 * 输入注入(agent/inbox/spliced 带 inserted)落在 turn/start 之前,配对的领取
		 * (removedCount 的删除 splice)落在其后;边界必须停在注入之前,否则子会话会
		 * 把原输入当成待领取的队列项重放一遍。扫描止于上一回合的 turn/end,因此
		 * 回合之间的会话级事件(改名、权限切换)照常留在 seed 里。
		 * @returns 边界 seq;窗口从该回合的注入事件处开始(或更晚)时为 undefined。
		 */
		function boundaryBefore(events, startIndex) {
			let cursor = startIndex - 1
			while (cursor >= 0) {
				const event = events[cursor]
				if (event === null || typeof event !== "object" || event.type === "turn/end") break
				if (isInputInsertion(event)) startIndex = cursor
				cursor -= 1
			}
			return startIndex - 1 >= 0 ? events[startIndex - 1].seq : undefined
		}

		/**
		 * 折叠已闭合回合,并算出每个回合可安全分叉的边界 seq。
		 * @param events - 已持久化事件(seq 升序连续)。
		 * @returns Map<turn, { text, boundary, extraBlocks }>,只含能确定边界的回合。
		 */
		function editableTurns(events) {
			const result = new Map()
			let current
			for (let index = 0; index < events.length; index += 1) {
				const event = events[index]
				if (event === null || typeof event !== "object") continue
				if (event.type === "turn/start") {
					current = { turn: event.data === undefined ? undefined : event.data.turn, startIndex: index, user: undefined }
					continue
				}
				if (current === undefined) continue
				const data = event.data === undefined ? undefined : event.data
				if (event.type === "user/message" && current.user === undefined && data !== undefined && data.source !== undefined && data.source.kind === "user") {
					current.user = event
					continue
				}
				if (event.type !== "turn/end" || data === undefined || data.turn !== current.turn) continue
				const boundary = boundaryBefore(events, current.startIndex)
				if (boundary !== undefined && current.user !== undefined && Number.isSafeInteger(current.turn)) {
					result.set(current.turn, {
						text: userText(current.user),
						boundary,
						extraBlocks: nonTextBlocks(current.user)
					})
				}
				current = undefined
			}
			return result
		}

		/** Client Session binding → 已加载事件窗口(瞬时事件与小数 seq 剔除)。 */
		function sessionEvents(binding) {
			const source = binding === undefined ? undefined : binding.eventSource
			if (source === undefined || typeof source.getSnapshot !== "function") return undefined
			const snapshot = source.getSnapshot()
			if (snapshot === null || typeof snapshot !== "object" || !Array.isArray(snapshot.entries)) return undefined
			const events = []
			for (const entry of snapshot.entries) {
				if (entry === null || typeof entry !== "object" || entry.type === "transient") continue
				const event = entry.event
				if (event === null || typeof event !== "object" || typeof event.type !== "string" || !Number.isSafeInteger(event.seq)) continue
				events.push(event)
			}
			return events
		}

		/** 计算结果的缓存:entries 数组即 window 快照的稳定标识,窗口一变即失效。 */
		const turnsCache = new WeakMap()

		function turnsOf(binding) {
			const source = binding === undefined ? undefined : binding.eventSource
			if (source === undefined || typeof source.getSnapshot !== "function") return new Map()
			const snapshot = source.getSnapshot()
			const entries = snapshot === null || typeof snapshot !== "object" ? undefined : snapshot.entries
			if (!Array.isArray(entries)) return new Map()
			const cached = turnsCache.get(entries)
			if (cached !== undefined) return cached
			const events = sessionEvents(binding)
			const turns = events === undefined ? new Map() : editableTurns(events)
			turnsCache.set(entries, turns)
			return turns
		}
		//#endregion

		//#region 弹窗状态机(模块级,与 fork-edit 同型)
		const CLOSED = { phase: "closed" }
		let dialog = CLOSED
		const dialogListeners = new Set()

		function publish(next) {
			dialog = next
			for (const listener of [...dialogListeners]) listener()
		}

		function useDialog() {
			const setTick = useState(0)[1]
			useEffect(() => {
				const listener = () => setTick((tick) => tick + 1)
				dialogListeners.add(listener)
				return () => {
					dialogListeners.delete(listener)
				}
			}, [])
			return dialog
		}
		//#endregion

		/** 分叉事务:官方 fork → 临时 retain 子会话 → prompt 编辑后的文本 → 打开子会话。 */
		async function runFork(ctx, sessionId, turn, text) {
			const target = turnsOf(ctx.sessions.binding(sessionId)).get(turn)
			if (target === undefined) throw new Error("该回合不在已加载的历史窗口内,无法分叉。")
			const childId = await ctx.sessions.fork({ sessionId, atSeq: target.boundary })
			const reference = ctx.sessions.retain(childId, { source: "quick-fork" })
			try {
				await reference.ready
				const result = await reference.binding.session.prompt([{ type: "text", text }], "queue")
				if (result === null || typeof result !== "object" || result.ok !== true) {
					const code = result !== null && typeof result === "object" && result.error !== undefined && typeof result.error.code === "string"
						? result.error.code
						: "unknown"
					throw new Error(`分支已创建,但首条消息发送失败(${code})。`)
				}
				ctx.uiWorkspace.openSession(childId)
			} finally {
				// openSession 已由 mainView 持有引用,这里释放临时引用。
				reference.release()
			}
			return childId
		}

		/** apply 里绑定动作闭包。 */
		let actions

		/** turn-tail seat:✎ 按钮(每回合一个;无可确定边界的回合不渲染)。 */
		function ForkSeat(props) {
			const target = props.target(props.turn)
			if (target === undefined) return null
			return h("span", { className: "qf-seat" },
				h("button", {
					type: "button",
					className: "qf-iconBtn",
					title: "编辑本回合输入(分叉新会话并执行)",
					"aria-label": `编辑第 ${String(props.turn)} 回合的用户输入`,
					onClick: () => props.begin(props.turn)
				}, svgIcon(EDIT_PATH)))
		}

		/** shell.overlay seat:编辑弹窗。 */
		function ForkDialog() {
			const state = useDialog()
			if (state === null || typeof state !== "object" || state.phase === "closed") return null
			const editing = state.phase === "editing"
			const draft = typeof state.draft === "string" ? state.draft : ""
			const hasText = draft.trim() !== ""
			const body = [
				h("h3", { className: "qf-title", key: "title" },
					editing || state.phase === "working"
						? `编辑用户输入 · 第 ${String(state.turn)} 回合`
						: "分叉失败"),
				editing || state.phase === "working"
					? h("div", { className: "qf-note", key: "note" },
						"在该回合之前分叉出新会话,并把编辑后的输入作为新会话的首条消息执行;原会话不受影响。")
					: null,
				state.extraBlocks > 0
					? h("div", { className: "qf-note", key: "blocks" }, `原消息还包含 ${String(state.extraBlocks)} 个非文本块(图片),不会带进分支。`)
					: null,
				editing || state.phase === "working"
					? h("textarea", {
						key: "draft",
						className: "qf-textarea",
						value: draft,
						readOnly: !editing,
						placeholder: "编辑后的输入;Enter 创建分支,Shift+Enter 换行",
						onChange: (event) => actions.setDraft(event.target.value),
						onKeyDown: (event) => {
							if (event.key !== "Enter" || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return
							if (event.nativeEvent !== undefined && event.nativeEvent.isComposing) return
							event.preventDefault()
							if (editing && hasText) actions.submit()
						}
					})
					: null,
				state.error != null ? h("div", { className: "qf-error", key: "error" }, state.error) : null,
				h("div", { className: "qf-footer", key: "footer" },
					h("button", { type: "button", className: "qf-btn", disabled: state.phase === "working", onClick: actions.close }, "取消"),
					editing || state.phase === "working"
						? h("button", {
							type: "button",
							className: "qf-btn qf-btnPrimary",
							disabled: !editing || !hasText,
							onClick: actions.submit
						}, state.phase === "working" ? "创建中…" : "创建分支并执行")
						: null)
			]
			return h("div", {
				className: "qf-overlay",
				onClick: (event) => {
					if (event.target === event.currentTarget && editing) actions.close()
				}
			}, h("div", { className: "qf-modal" }, body))
		}

		const inject = [
			"slots",
			"sessions",
			// 会话导航归 view owner(0.1.7 起 ctx.sessions 不再有 open)。
			"uiWorkspace",
			// 事件窗口读取走 uiConversation 的同一份 Session binding feed。
			"uiConversation"
		]

		function apply(ctx) {
			const tagId = "dsh-quick-fork/client.css"
			let styleTag = null
			if (typeof document !== "undefined" && document.querySelector(`style[data-plugin-css=${JSON.stringify(tagId)}]`) === null) {
				styleTag = document.createElement("style")
				styleTag.dataset.plugin = "dsh-quick-fork"
				styleTag.dataset.pluginCss = tagId
				styleTag.textContent = CSS
				document.head.appendChild(styleTag)
			}
			actions = {
				close: () => publish(CLOSED),
				setDraft: (draft) => {
					if (dialog.phase !== "editing") return
					publish({ ...dialog, draft, error: null })
				},
				submit: async () => {
					const current = dialog
					if (current.phase !== "editing") return
					const text = typeof current.draft === "string" ? current.draft : ""
					if (text.trim() === "") return
					publish({ ...current, phase: "working", error: null })
					try {
						await runFork(ctx, current.sessionId, current.turn, text)
						publish(CLOSED)
					} catch (error) {
						publish({ ...current, phase: "editing", error: messageOf(error) })
					}
				}
			}
			const disposeSeat = ctx.slots.inject("conversation.chat.turnTail", () => ctx.slots.register({
				name: "conversation.chat.turnTail",
				id: "quick-fork",
				order: 600,
				inject: (sessionId) => {
					const read = () => turnsOf(ctx.sessions.binding(sessionId))
					return {
						target: (turn) => read().get(turn),
						begin: (turn) => {
							const target = read().get(turn)
							if (target === undefined) return
							publish({
								phase: "editing",
								sessionId,
								turn,
								draft: target.text,
								extraBlocks: target.extraBlocks,
								error: null
							})
						}
					}
				}
			}, ForkSeat))
			const disposeDialog = ctx.slots.inject("shell.overlay", () => ctx.slots.register(
				{ name: "shell.overlay", id: "quick-fork", order: 601, label: "Quick Fork" },
				ForkDialog))
			ctx.effect(() => () => {
				if (typeof disposeSeat === "function") disposeSeat()
				if (typeof disposeDialog === "function") disposeDialog()
				if (styleTag !== null) styleTag.remove()
				actions = undefined
				publish(CLOSED)
			}, "quick-fork: client UI")
		}

		exports.apply = apply
		exports.inject = inject
		exports.name = "quick-fork"
		// 纯逻辑单测入口(test/client.test.js);不在插件面上。
		exports.__test = { editableTurns, isInputInsertion, userText, sessionEvents, turnsOf }
		return module.exports
	}
})
//#endregion
