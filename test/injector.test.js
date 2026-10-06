import assert from "node:assert/strict"
import test from "node:test"

/**
 * 注入器测试:用手搓的最小 DOM 驱动 startInjector 的真实判据 ——
 * 行怎么选(`[data-conversation-session] [data-chat-turn] [data-clock="start"]`)、
 * 回合号怎么认(`data-chat-turn`)、文案怎么从 fiber 取、切换会话/未闭合回合怎么处理。
 * client.test.js 覆盖纯逻辑,plugin.test.js 覆盖分叉接线。
 */

let factory
globalThis.window = {
	__ModuleLoader__: {
		load: (mod) => {
			factory = mod.factory
		}
	}
}

/** 记录所有建出来的元素,测试末尾按类名找注入结果。 */
const created = []

function createElement(tag) {
	const node = {
		tag,
		dataset: {},
		textContent: "",
		children: [],
		listeners: {},
		className: "",
		parent: undefined,
		appendChild(child) {
			this.children.push(child)
			return child
		},
		setAttribute() {},
		addEventListener(name, listener) {
			this.listeners[name] = listener
		},
		insertAdjacentElement(position, element) {
			assert.equal(position, "afterend")
			const parent = this.parent
			if (parent === undefined) throw new Error("insertAdjacentElement on a detached node")
			element.parent = parent
			parent.children.splice(parent.children.indexOf(this) + 1, 0, element)
			return element
		},
		remove() {
			const parent = this.parent
			if (parent === undefined) return
			const index = parent.children.indexOf(this)
			if (index >= 0) parent.children.splice(index, 1)
		}
	}
	created.push(node)
	return node
}

globalThis.document = {
	createElement,
	/** svgIcon 用的是 createElementNS + setAttribute + appendChild。 */
	createElementNS: (namespace, tag) => createElement(`${tag}(ns)`),
	querySelector: () => null,
	head: { appendChild() {} },
	body: {},
	querySelectorAll: () => []
}
globalThis.requestAnimationFrame = (callback) => {
	callback()
	return 0
}
globalThis.cancelAnimationFrame = () => {}
let observers = []
globalThis.MutationObserver = class {
	constructor(callback) {
		this.callback = callback
		observers.push(this)
	}
	observe() {}
	disconnect() {}
}

await import("../client.js")

const react = {
	createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
	Fragment: {},
	useEffect: () => {},
	useState: () => [undefined, () => {}]
}
const plugin = factory((name) => {
	if (name === "react") return react
	if (name === "@deepseek-ai/dsh-client-ui-primitives") return { IconEditOutlineRegular: () => null }
	throw new Error(`unexpected require: ${name}`)
})

/** 与 client.test.js 同形的真实会话日志:输入注入在 turn/start 之前,领取其后。 */
const EVENTS = [
	{ seq: 0, type: "sandbox/mode", data: { mode: "workspace-write" } },
	{ seq: 1, type: "agent/inbox/spliced", data: { inserted: [{ content: [{ type: "text", text: "first" }] }] } },
	{ seq: 2, type: "turn/start", data: { turn: 1 } },
	{ seq: 3, type: "user/message", data: { content: [{ type: "text", text: "first" }], source: { kind: "user" } } },
	{ seq: 4, type: "turn/end", data: { turn: 1 } },
	{ seq: 5, type: "agent/inbox/spliced", data: { inserted: [{ content: [{ type: "text", text: "second" }] }] } },
	{ seq: 6, type: "turn/start", data: { turn: 2 } },
	{ seq: 7, type: "user/message", data: { content: [{ type: "text", text: "second" }], source: { kind: "user" } } },
	{ seq: 8, type: "turn/end", data: { turn: 2 } }
]

/**
 * 一条 chat 流式行:包裹元素带官方 `data-chat-turn`,内部是用户消息操作行。
 * @param turn - 该消息所属回合号(undefined = 未闭合回合,官方不写属性)。
 * @param session - 所属会话;undefined = 不在任何会话根内(残留行)。
 * @param text - 复制键那段原文(fiber 上 MessageIconActions 的 props.text)。
 */
function makeRow({ turn, session = "session-a", text = "first" }) {
	const copy = createElement("button")
	const row = createElement("div")
	copy.parent = row
	row.children.push(copy)
	/** 真实 DOM 的语义:按钮是自己插进这一行的兄弟节点,所以按整行找。 */
	row.querySelector = (selector) => selector === "button"
		? copy
		: selector.startsWith(".") ? row.children.find((child) => child.className === selector.slice(1)) ?? null : null
	const wrapper = { dataset: turn === undefined ? {} : { chatTurn: String(turn) } }
	const root = session === undefined ? null : { dataset: { conversationSession: session } }
	row.closest = (selector) => {
		if (selector === "[data-chat-turn]") return wrapper
		if (selector === "[data-conversation-session]") return root
		return null
	}
	row["__reactFiber$test"] = { memoizedProps: { text }, return: null }
	return { row, copy }
}

/** 注入的按钮是复制键的兄弟节点(插在同一行里),按插件类名数。 */
function injectedOf(row) {
	return row.children.filter((child) => child.className === "qf-iconBtn")
}

function boot(rows, { mainView = { current: { "session-a": { retainedBy: { mainView: 1 } } } }, bindings = { "session-a": { eventSource: { getSnapshot: () => ({ entries: EVENTS.map((event) => ({ type: "durable", event })), hasMore: false }) }, session: { loadOlder: async () => {} } } } } = {}) {
	observers = []
	created.length = 0
	globalThis.document.querySelectorAll = (selector) => {
		assert.equal(selector, '[data-conversation-session] [data-chat-turn] [data-clock="start"]')
		return rows.map((entry) => entry.row)
	}
	const calls = { loadOlder: 0 }
	const ctx = {
		slots: { inject: () => () => {}, register: () => () => {} },
		effect: () => {},
		sessions: {
			list: { getSnapshot: () => ({ byId: mainView.current }) },
			binding: (id) => bindings[id]
		},
		uiWorkspace: { openSession() {} }
	}
	plugin.apply(ctx)
	assert.equal(observers.length, 1)
	const sync = () => observers[0].callback()
	return { sync, calls }
}

test("注入:按 data-chat-turn 认回合号,不用文本回配", () => {
	const first = makeRow({ turn: 1 })
	const second = makeRow({ turn: 2, text: "second" })
	const { sync } = boot([first, second])
	sync()
	for (const entry of [first, second]) {
		const buttons = injectedOf(entry.row)
		assert.equal(buttons.length, 1)
		assert.equal(buttons[0].title, "编辑这条消息(分叉新会话并执行)")
		assert.equal(buttons[0].listeners.click instanceof Function, true)
	}
	// 再次同步不叠加(已注入的行被 .qf-iconBtn 认出来跳过)。
	sync()
	assert.equal(injectedOf(first.row).length, 1)
	assert.equal(injectedOf(second.row).length, 1)
})

test("注入:两段开头 24 字相同的消息各自认自己的回合(旧前缀匹配会错配)", () => {
	const long = "同样的开头" + "x".repeat(30)
	const events = [
		{ seq: 0, type: "sandbox/mode", data: { mode: "workspace-write" } },
		{ seq: 1, type: "agent/inbox/spliced", data: { inserted: [{ content: [{ type: "text", text: long }] }] } },
		{ seq: 2, type: "turn/start", data: { turn: 1 } },
		{ seq: 3, type: "user/message", data: { content: [{ type: "text", text: long + "-A" }], source: { kind: "user" } } },
		{ seq: 4, type: "turn/end", data: { turn: 1 } },
		{ seq: 5, type: "agent/inbox/spliced", data: { inserted: [{ content: [{ type: "text", text: long }] }] } },
		{ seq: 6, type: "turn/start", data: { turn: 2 } },
		{ seq: 7, type: "user/message", data: { content: [{ type: "text", text: long + "-B" }], source: { kind: "user" } } },
		{ seq: 8, type: "turn/end", data: { turn: 2 } }
	]
	const rowA = makeRow({ turn: 1, text: long + "-A" })
	const rowB = makeRow({ turn: 2, text: long + "-B" })
	const { sync } = boot([rowA, rowB], {
		bindings: {
			"session-a": {
				eventSource: { getSnapshot: () => ({ entries: events.map((event) => ({ type: "durable", event })), hasMore: false }) },
				session: { loadOlder: async () => {} }
			}
		}
	})
	sync()
	assert.equal(injectedOf(rowA.row).length, 1)
	assert.equal(injectedOf(rowB.row).length, 1)
})

test("注入:其它会话的行不注入,且清掉已注入的按钮", () => {
	const previous = makeRow({ turn: 1 })
	const other = makeRow({ turn: 1, session: "session-b" })
	const mainView = { current: { "session-a": { retainedBy: { mainView: 1 } } } }
	const bindings = {
		"session-a": {
			eventSource: { getSnapshot: () => ({ entries: EVENTS.map((event) => ({ type: "durable", event })), hasMore: false }) },
			session: { loadOlder: async () => {} }
		},
		"session-b": {
			eventSource: { getSnapshot: () => ({ entries: EVENTS.map((event) => ({ type: "durable", event })), hasMore: false }) },
			session: { loadOlder: async () => {} }
		}
	}
	const { sync } = boot([previous, other], { mainView, bindings })
	sync()
	assert.equal(injectedOf(previous.row).length, 1)

	// 切到 session-b:上一会话的行失去按钮,当前会话的行拿到按钮。
	mainView.current = { "session-b": { retainedBy: { mainView: 1 } } }
	sync()
	assert.equal(injectedOf(previous.row).length, 0)
	assert.equal(injectedOf(other.row).length, 1)
})

test("注入:未闭合回合(无 data-chat-turn)不注入", () => {
	const pending = makeRow({ turn: undefined })
	const { sync } = boot([pending])
	sync()
	assert.equal(injectedOf(pending.row).length, 0)
})

test("注入:回合边界还没进窗口时补一页历史,窗口没有更早历史则不补", async () => {
	const events = [{ seq: 0, type: "turn/start", data: { turn: 2 } }, { seq: 1, type: "user/message", data: { content: [{ type: "text", text: "second" }], source: { kind: "user" } } }, { seq: 2, type: "turn/end", data: { turn: 2 } }]
	let loadOlder = 0
	let hasMore = true
	const row = makeRow({ turn: 2, text: "second" })
	const { sync } = boot([row], {
		bindings: {
			"session-a": {
				eventSource: { getSnapshot: () => ({ entries: events.map((event) => ({ type: "durable", event })), hasMore }) },
				session: { loadOlder: async () => { loadOlder += 1 } }
			}
		}
	})
	sync()
	await Promise.resolve()
	sync()
	await Promise.resolve()
	sync()
	// 每会话至多 MAX_PAGES(2) 页。
	assert.equal(loadOlder, 2)
	assert.equal(injectedOf(row.row).length, 0)
	// 没有更早历史时不再补。
	hasMore = false
	sync()
	await Promise.resolve()
	assert.equal(loadOlder, 2)
})
