import assert from "node:assert/strict"
import test from "node:test"

/** 浏览器半是 window.__ModuleLoader__.load 的 CJS 工厂:用假 loader 捕获并执行它。 */
let factory
globalThis.window = {
	__ModuleLoader__: {
		load: (mod) => {
			assert.equal(mod.id, "dsh-quick-fork")
			factory = mod.factory
		}
	}
}
await import("../client.js")

const react = {
	createElement: () => null,
	Fragment: {},
	useEffect: () => {},
	useState: () => [undefined, () => {}]
}

const plugin = factory((name) => {
	if (name === "react") return react
	throw new Error(`unexpected require: ${name}`)
})

const { editableTurns, isInputInsertion, userText, turnAt, sessionAt, turnsOf } = plugin.__test

/** 真实会话日志形状:输入注入落在 turn/start 之前,配对的领取落在其后。 */
const LOG = [
	{ seq: 0, type: "permission/preset", data: { preset: "auto-prove" } },
	{ seq: 1, type: "sandbox/mode", data: { mode: "workspace-write" } },
	{ seq: 2, type: "agent/inbox/spliced", data: { target: "next-turn", inserted: [{ content: [{ type: "text", text: "first" }] }] } },
	{ seq: 3, type: "turn/start", data: { turn: 1 } },
	{ seq: 4, type: "agent/inbox/spliced", data: { target: "next-turn", removedCount: 1, inserted: [] } },
	{ seq: 5, type: "user/message", data: { content: [{ type: "text", text: "first" }], source: { kind: "user" } } },
	{ seq: 6, type: "assistant/message", data: { turn: 1 } },
	{ seq: 7, type: "turn/end", data: { turn: 1 } },
	{ seq: 8, type: "agent/inbox/spliced", data: { target: "next-turn", inserted: [{ content: [{ type: "text", text: "second" }] }] } },
	{ seq: 9, type: "turn/start", data: { turn: 2 } },
	{ seq: 10, type: "agent/inbox/spliced", data: { target: "next-turn", removedCount: 1, inserted: [] } },
	{
		seq: 11,
		type: "user/message",
		data: {
			content: [{ type: "text", text: "second" }, { type: "image", attachment: { id: "att-1" } }],
			source: { kind: "user" }
		}
	},
	{ seq: 12, type: "turn/end", data: { turn: 2 } },
	{ seq: 13, type: "agent/inbox/spliced", data: { target: "next-turn", inserted: [{ content: [{ type: "text", text: "third" }] }] } },
	{ seq: 14, type: "turn/start", data: { turn: 3 } }
]

test("插件面:apply/inject/name", () => {
	assert.equal(plugin.name, "quick-fork")
	assert.equal(typeof plugin.apply, "function")
	assert.deepEqual(plugin.inject, ["slots", "sessions", "uiWorkspace", "uiConversation"])
})

test("__test:只留被测试与注入器用到的判据,没有多余导出", () => {
	// sessionEvents 已被 turnsOf 吸收、turnsCache 是内部缓存,都不该再出现在测试面上。
	assert.deepEqual(Object.keys(plugin.__test).sort(), [
		"editableTurns", "isInputInsertion", "mainSessionOf", "open", "sessionAt", "textAt", "turnAt", "turnsOf", "userText"
	])
})

test("turnAt:回合号取官方 data-chat-turn,读不到或非整数时不给", () => {
	const row = { closest: (selector) => selector === "[data-chat-turn]" ? { dataset: { chatTurn: "2" } } : null }
	assert.equal(turnAt(row), 2)
	assert.equal(turnAt({ closest: () => ({ dataset: { chatTurn: "x" } }) }), undefined)
	assert.equal(turnAt({ closest: () => null }), undefined)
})

test("sessionAt:会话归属取官方 data-conversation-session", () => {
	const row = { closest: (selector) => selector === "[data-conversation-session]" ? { dataset: { conversationSession: "session-b" } } : null }
	assert.equal(sessionAt(row), "session-b")
	assert.equal(sessionAt({ closest: () => null }), undefined)
})

test("turnsOf:同一个事件窗口快照只算一次,窗口换了才重算", () => {
	const entries = LOG.map((event) => ({ type: "durable", event }))
	const binding = { eventSource: { getSnapshot: () => ({ entries, hasMore: false }) } }
	const first = turnsOf(binding)
	assert.equal(first.get(1).boundary, 1)
	first.set(99, { text: "tampered", boundary: 0, extraBlocks: 0 }) // 篡改缓存值以证明确实复用了同一份
	assert.equal(turnsOf(binding).get(99).text, "tampered")
	const other = { eventSource: { getSnapshot: () => ({ entries: LOG.slice(8).map((event) => ({ type: "durable", event })), hasMore: false }) } }
	assert.equal(turnsOf(other).has(99), false)
	assert.equal(turnsOf({}).size, 0)
})

test("editableTurns:边界跳过本回合的输入注入事件", () => {
	const turns = editableTurns(LOG)
	// 第 1 回合:注入在 seq 2,边界落在其前的 sandbox/mode(seq 1)。
	assert.deepEqual(turns.get(1), { text: "first", boundary: 1, extraBlocks: 0 })
	// 第 2 回合:注入在 seq 8,边界落在上一回合的 turn/end(seq 7)。
	assert.deepEqual(turns.get(2), { text: "second", boundary: 7, extraBlocks: 1 })
	// 第 3 回合未闭合:不提供。
	assert.equal(turns.has(3), false)
})

test("editableTurns:注入与 turn/start 不相邻时同样被排除", () => {
	const log = [
		{ seq: 0, type: "turn/end", data: { turn: 1 } },
		{ seq: 1, type: "agent/inbox/spliced", data: { inserted: [{ content: [] }] } },
		{ seq: 2, type: "session/title", data: { title: "t" } },
		{ seq: 3, type: "agent/inbox/spliced", data: { inserted: [{ content: [] }] } },
		{ seq: 4, type: "turn/start", data: { turn: 2 } },
		{ seq: 5, type: "agent/inbox/spliced", data: { removedCount: 2, inserted: [] } },
		{ seq: 6, type: "user/message", data: { content: [{ type: "text", text: "second" }], source: { kind: "user" } } },
		{ seq: 7, type: "turn/end", data: { turn: 2 } }
	]
	// 两处注入都在边界之后:seed 只到 seq 0,回合间的会话级事件(seq 2)被一并排除。
	assert.equal(editableTurns(log).get(2).boundary, 0)
})

test("editableTurns:窗口起点决定边界能算到什么程度", () => {
	// 窗口恰好从第 2 回合的注入事件开始:注入之前的事件没加载,边界无从确定。
	assert.equal(editableTurns(LOG.slice(8)).has(2), false)
	// 窗口从 turn/start 处开始(注入事件没加载):算不出边界,必须缺席而不是猜。
	assert.equal(editableTurns(LOG.slice(9)).has(2), false)
	// 窗口包含上一回合的 turn/end 时边界落在它上面。
	assert.equal(editableTurns(LOG.slice(7)).get(2).boundary, 7)
})

test("editableTurns:非 user 来源的消息不构成可编辑回合", () => {
	const log = [
		{ seq: 0, type: "turn/start", data: { turn: 1 } },
		{ seq: 1, type: "user/message", data: { content: [{ type: "text", text: "injected" }], source: { kind: "context" } } },
		{ seq: 2, type: "turn/end", data: { turn: 1 } }
	]
	assert.equal(editableTurns(log).size, 0)
})

test("userText:多文本块换行拼接", () => {
	const event = { data: { content: [{ type: "text", text: "a" }, { type: "image", attachment: {} }, { type: "text", text: "b" }] } }
	assert.equal(userText(event), "a\nb")
	assert.equal(userText({ data: {} }), "")
})

test("isInputInsertion:只认带 inserted 内容的 splice", () => {
	assert.equal(isInputInsertion({ type: "agent/inbox/spliced", data: { inserted: [{ content: [] }] } }), true)
	assert.equal(isInputInsertion({ type: "agent/inbox/spliced", data: { removedCount: 1, inserted: [] } }), false)
	assert.equal(isInputInsertion({ type: "turn/start", data: { turn: 1 } }), false)
})
