//#region dsh-quick-fork — Client half (static bundle)
/**
 * dsh-quick-fork — 纯 Client 半:回合级编辑 → 官方 fork → 自动执行。
 *
 * 形式:window.__ModuleLoader__.load 的 CJS 工厂(与 dsh-fork-edit/client.js 同型),
 * exports.apply / exports.inject 即 Cordis 插件面。图标是官方
 * `ic_ds_edit_outline_16` 的两段 path,内联手搓 svg 节点:官方 primitives 包
 * 在 client 侧不是独立模块(client-modules 找不到它的 "./client"),require 它
 * 会让整个工厂抛错、插件静默消失,所以这里不引包。
 *
 * 与 dsh-fork-edit 的根本差别:没有 host 半,不注册 HTTP 路由,不写自定义事件。
 * 全部动作都落在官方 Client 服务上:
 *
 * - 按钮:在官方**用户消息操作行**里、复制键右侧注入 ✎(官方没有用户消息的
 *   action slot,只能 DOM 注入;行/回合/会话三个判据都取官方属性,见 startInjector)。
 * - 回合数据:`ctx.sessions.binding(id).eventSource` 已加载的事件窗口 ——
 *   官方 Conversation assembler 消费的同一个 SessionEventLikeEntry feed。
 * - 分叉:`ctx.sessions.fork({ sessionId, atSeq })`,即官方 turn 尾 branch 按钮
 *   调用的同一个 API(uatSeq 语义见下)。
 * - 执行:临时 retain 子会话 → `binding.session.prompt([text], "queue")`
 *   (官方 composer 首条消息的同一底层调用)。
 * - 切换:`ctx.uiWorkspace.openSession(childId)`。
 * - 弹窗:官方 `shell.overlay` slot(这一处不需要 DOM 注入)。
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

		/** 官方 ic_ds_edit_outline_16 的两段 path(primitives 包同款,内联避免运行期依赖)。 */
		const EDIT_BOX_PATH = "M8.85596 2.69971H4.19971C3.37141 2.69971 2.69992 3.37146 2.69971 4.19971V11.8003C2.69992 12.6285 3.37141 13.3003 4.19971 13.3003H11.8003C12.6283 13.2999 13.3001 12.6283 13.3003 11.8003V7.89893H14.3003V11.8003C14.3001 13.1806 13.1806 14.2999 11.8003 14.3003H4.19971C2.81913 14.3003 1.69992 13.1808 1.69971 11.8003V4.19971C1.69992 2.81918 2.81913 1.69971 4.19971 1.69971H8.85596V2.69971Z"
		const EDIT_PEN_PATH = "M7.7849 8.23878L13.888 2.13574"

		/** 注入按钮的类名:同时充当「这一行已处理过」的标记。 */
		const INJECTED_CLASS = "qf-iconBtn"

		const CSS = [
			// 注入在官方用户消息操作行里,外形照官方 action 按钮(28px / radius-sm / tertiary)。
			'.qf-iconBtn{display:inline-flex;align-items:center;justify-content:center;width:calc(28px + var(--dsh-content-font-delta,0px));height:calc(28px + var(--dsh-content-font-delta,0px));padding:6px;color:var(--dsw-alias-label-tertiary);background:transparent;border:none;border-radius:var(--dsw-radius-sm);cursor:pointer;flex:none}',
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
			'.qf-btnPrimary{color:var(--dsw-alias-label-primary-foreground);background:var(--dsw-alias-button-primary-fill);border-color:transparent}',
			'.qf-btnPrimary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}'
		].join("")

		/** 官方图标同款 svg(16px、1px 描边、currentColor)。 */
		function svgIcon() {
			const ns = "http://www.w3.org/2000/svg"
			const svg = document.createElementNS(ns, "svg")
			svg.setAttribute("width", "16")
			svg.setAttribute("height", "16")
			svg.setAttribute("viewBox", "0 0 16 16")
			svg.setAttribute("fill", "none")
			svg.setAttribute("stroke-width", "1")
			svg.setAttribute("aria-hidden", "true")
			const box = document.createElementNS(ns, "path")
			box.setAttribute("d", EDIT_BOX_PATH)
			box.setAttribute("fill", "currentColor")
			svg.appendChild(box)
			const pen = document.createElementNS(ns, "path")
			pen.setAttribute("d", EDIT_PEN_PATH)
			pen.setAttribute("stroke", "currentColor")
			svg.appendChild(pen)
			return svg
		}

		function messageOf(error) {
			if (error instanceof Error) return error.message
			if (typeof error?.message === "string") return error.message
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
			if (!Array.isArray(event?.data?.content)) return out
			for (const block of event.data.content) {
				if (block?.type !== "text" || typeof block.text !== "string") continue
				out += out === "" ? block.text : `\n${block.text}`
			}
			return out
		}

		/** 原消息里除文本外的块数(图片);分支只重放文本,提前告知。 */
		function nonTextBlocks(event) {
			return Array.isArray(event.data.content) ? event.data.content.filter((block) => block.type !== "text").length : 0
		}

		/**
		 * 分叉边界 = 目标回合输入注入之前的最后一个事件 seq。
		 *
		 * 输入注入(agent/inbox/spliced 带 inserted)落在 turn/start 之前,配对的领取
		 * (removedCount 的删除 splice)落在其后;边界必须停在注入之前,否则子会话会
		 * 把原输入当成待领取的队列项重放一遍。扫描止于上一回合的 turn/end,因此
		 * 回合之间的会话级事件(改名、权限切换)照常留在 seed 里。
		 * @param events - 已加载事件窗口(seq 升序)。
		 * @param startIndex - 目标回合 turn/start 在窗口中的下标。
		 * @returns 边界 seq;窗口从该回合的注入事件或更晚处开始时为 undefined
		 *   (边界无从确定,宁可不给按钮,也不猜一个会重放原输入的 seq)。
		 */
		function boundaryBefore(events, startIndex) {
			let boundary = startIndex - 1
			for (let cursor = startIndex - 1; cursor >= 0; cursor -= 1) {
				const event = events[cursor]
				if (event === null || typeof event !== "object" || event.type === "turn/end") break
				if (isInputInsertion(event)) boundary = cursor - 1
			}
			return boundary >= 0 ? events[boundary].seq : undefined
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
					current = { turn: event.data?.turn, startIndex: index, user: undefined }
					continue
				}
				if (current === undefined) continue
				const data = event.data
				if (event.type === "user/message" && current.user === undefined && data?.source?.kind === "user") {
					current.user = event
					continue
				}
				if (event.type !== "turn/end" || data?.turn !== current.turn) continue
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

		/** 计算结果的缓存:entries 数组即 window 快照的稳定标识,窗口一变即失效。 */
		const turnsCache = new WeakMap()

		/** Client Session binding → 已加载事件窗口(瞬时事件与小数 seq 剔除)。 */
		function turnsOf(binding) {
			const entries = binding?.eventSource?.getSnapshot?.().entries
			if (!Array.isArray(entries)) return new Map()
			const cached = turnsCache.get(entries)
			if (cached !== undefined) return cached
			const events = entries
				.filter((entry) => entry?.type !== "transient" && typeof entry.event?.type === "string" && Number.isSafeInteger(entry.event.seq))
				.map((entry) => entry.event)
			const turns = editableTurns(events)
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

		/** apply 里绑定的入口闭包(注入按钮与测试共用)。 */
		let openDialog

		/** 官方用户消息操作行:会话归属 + `data-clock="start"` + `data-chat-turn` 都是官方属性。 */
		const USER_ACTIONS = '[data-conversation-session] [data-chat-turn] [data-clock="start"]'

		/** 每会话最多主动补多少页历史(只为把最老那条消息的回合边界拉进窗口)。 */
		const MAX_PAGES = 2

		/**
		 * 沿 React fiber 上溯,取这条用户消息的原文:最近一个函数组件(MessageIconActions)
		 * 的 props.text —— 正是官方复制键复制的那段文本,比按 DOM 文本猜要准。
		 * @param node - 操作行元素。
		 * @returns 消息原文,读不到时为 undefined。
		 */
		function textAt(node) {
			const key = Object.keys(node).find((name) => name.startsWith("__reactFiber$"))
			let fiber = key === undefined ? undefined : node[key]
			for (let depth = 0; fiber !== undefined && fiber !== null && depth < 12; depth += 1, fiber = fiber.return) {
				const props = fiber.memoizedProps
				if (props !== undefined && props !== null && typeof props.text === "string") return props.text
			}
			return undefined
		}

		/**
		 * 这条用户消息所属的回合号:官方在每个 chat 节点的流式包裹元素上写了
		 * `data-chat-turn`(ChatView 自己的分页锚点同源),不需要按文本回配。
		 * @param node - 操作行元素。
		 * @returns 回合号,拿不到时为 undefined。
		 */
		function turnAt(node) {
			const raw = node.closest("[data-chat-turn]")?.dataset.chatTurn
			if (raw === undefined) return undefined
			const turn = Number(raw)
			return Number.isSafeInteger(turn) ? turn : undefined
		}

		/** 操作行所属会话(会话切换后旧按钮据此摘除)。 */
		function sessionAt(node) {
			return node.closest("[data-conversation-session]")?.dataset.conversationSession
		}

		/** byId 快照 → 主视图会话 id;快照对象不变即命中。 */
		const mainSessionCache = new WeakMap()

		/**
		 * 主视图正在显示的那个会话 id。
		 *
		 * 官方自己是这么认的(ui-workspace 内 `mainSessionId`):会话列表里
		 * `retainedBy.mainView > 0` 的那一行。DOM 里只有主视图的对话,所以注入按钮归属
		 * 它即可 —— 不必再从 fiber 里刨上下文。
		 * @returns 会话 id,拿不到时为 undefined。
		 */
		function mainSessionOf(ctx) {
			const byId = ctx.sessions.list?.getSnapshot?.().byId
			if (byId === undefined || byId === null) return undefined
			const cached = mainSessionCache.get(byId)
			if (cached !== undefined) return cached
			let found
			for (const id of Object.keys(byId)) {
				const row = byId[id]
				if (row !== null && typeof row === "object" && (row.retainedBy === undefined ? 0 : row.retainedBy.mainView ?? 0) > 0) {
					found = id
					break
				}
			}
			mainSessionCache.set(byId, found)
			return found
		}

		/**
		 * 在每条已落定用户消息的**复制键右侧**注入 ✎。
		 *
		 * 官方没有用户消息的 action slot(只有回合尾 turnTail),所以这里和 fork-edit 一样
		 * 走 DOM 注入,但两个判据都取官方自己的属性,不做文本回配:行 = 会话根
		 * `[data-conversation-session]` 内、节点包裹 `[data-chat-turn]` 上的、`data-clock="start"`
		 * 操作行;回合号 = 该包裹元素的 `data-chat-turn`(ChatView 的分页锚点同源);
		 * 文案 = fiber 上 MessageIconActions 的 `props.text`(官方复制键的那段原文)。
		 * 已落定与否由 editableTurns 决定:未闭合回合、窗口外的更早回合都不给按钮。
		 * @returns 卸载函数(断开观察者、移除已注入按钮)。
		 */
		function startInjector(ctx) {
			let frame
			let scheduled = false
			/** 已主动补页的会话 → 次数;每会话至多补 MAX_PAGES 页,不无限拉历史。 */
			const paged = new Map()
			function schedule() {
				if (scheduled) return
				scheduled = true
				frame = requestAnimationFrame(() => {
					scheduled = false
					sync()
				})
			}
			function sync() {
				const sessionId = mainSessionOf(ctx)
				if (sessionId === undefined) return
				const binding = ctx.sessions.binding(sessionId)
				if (binding === undefined || binding === null) return
				const turns = turnsOf(binding)
				/** 存在已落定用户消息,但它的回合不在已加载窗口里(需要补页)。 */
				let needsOlderPage = false
				for (const row of document.querySelectorAll(USER_ACTIONS)) {
					if (sessionAt(row) !== sessionId) {
						// 其它会话(或切换后的残留)的行:清掉自己注入过的按钮。
						row.querySelector(`.${INJECTED_CLASS}`)?.remove()
						continue
					}
					const turn = turnAt(row)
					const target = turn === undefined ? undefined : turns.get(turn)
					const copy = row.querySelector("button")
					if (target === undefined || copy === null) {
						row.querySelector(`.${INJECTED_CLASS}`)?.remove()
						// 回合号认得、却不在已加载窗口里:才说明历史没加载够(补页的判据)。
						if (copy !== null && turn !== undefined) needsOlderPage = true
						continue
					}
					if (row.querySelector(`.${INJECTED_CLASS}`) !== null) continue
					const text = textAt(row)
					if (text === undefined || text === "") continue
					const button = document.createElement("button")
					button.type = "button"
					button.className = INJECTED_CLASS
					button.title = "编辑这条消息(分叉新会话并执行)"
					button.setAttribute("aria-label", "编辑这条消息")
					button.appendChild(svgIcon())
					button.addEventListener("click", () => openDialog(sessionId, turn))
					copy.insertAdjacentElement("afterend", button)
				}
				pageOlder(binding, sessionId, needsOlderPage)
			}
			/**
			 * 认得出回合号、但该回合不在已加载窗口里时补一页历史。
			 *
			 * 已加载窗口从某个 turn/start 处开始时,该回合的输入注入事件不在窗口里,
			 * 边界就算不出来(宁可不给按钮,也不猜一个会重放原输入的 seq)。补一页后
			 * 边界落入窗口,按钮自然出现 —— 只补,不动滚动位置;每会话至多 MAX_PAGES 页。
			 */
			function pageOlder(binding, sessionId, needsOlderPage) {
				if (!needsOlderPage) return
				if (binding.eventSource?.getSnapshot?.().hasMore !== true) return
				const used = paged.get(sessionId) ?? 0
				if (used >= MAX_PAGES) return
				paged.set(sessionId, used + 1)
				Promise.resolve(binding.session.loadOlder()).catch(() => {}).then(schedule)
			}
			const observer = new MutationObserver(schedule)
			observer.observe(document.body, { childList: true, subtree: true })
			sync()
			return () => {
				observer.disconnect()
				if (frame !== undefined) cancelAnimationFrame(frame)
				for (const button of document.querySelectorAll(`.${INJECTED_CLASS}`)) button.remove()
			}
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
			openDialog = (sessionId, turn) => {
				const target = turnsOf(ctx.sessions.binding(sessionId)).get(turn)
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
			const disposeInjector = typeof document === "undefined" || typeof MutationObserver === "undefined" ? () => {} : startInjector(ctx)
			const disposeDialog = ctx.slots.inject("shell.overlay", () => ctx.slots.register(
				{ name: "shell.overlay", id: "quick-fork", order: 601, label: "Quick Fork" },
				ForkDialog))
			ctx.effect(() => () => {
				if (typeof disposeInjector === "function") disposeInjector()
				if (typeof disposeDialog === "function") disposeDialog()
				if (styleTag !== null) styleTag.remove()
				actions = undefined
				openDialog = undefined
				publish(CLOSED)
			}, "quick-fork: client UI")
		}

		exports.apply = apply
		exports.inject = inject
		exports.name = "quick-fork"
		// 纯逻辑单测入口(test/client.test.js / plugin.test.js);不在插件面上。
		exports.__test = {
			editableTurns, isInputInsertion, userText, turnsOf, textAt, mainSessionOf, turnAt, sessionAt,
			/** 打开编辑弹窗(测试里代替点击注入按钮)。 */
			open: (sessionId, turn) => openDialog?.(sessionId, turn)
		}
		return module.exports
	}
})
//#endregion
