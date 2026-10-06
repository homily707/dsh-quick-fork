import assert from "node:assert/strict"
import test from "node:test"

/**
 * 接线测试:用假 ctx 跑一遍 apply → seat → 弹窗 → submit,
 * 断言官方 Client 服务的调用形状(fork / retain / prompt / openSession)。
 * 纯逻辑另有 test/client.test.js。
 */

let factory
globalThis.window = {
	__ModuleLoader__: {
		load: (mod) => {
			factory = mod.factory
		}
	}
}
/** svgIcon / 样式注入用到的 DOM 最小面。 */
globalThis.document = {
	createElementNS: () => ({ setAttribute() {}, appendChild() {} }),
	createElement: () => ({ dataset: {}, textContent: "", remove() {} }),
	querySelector: () => null,
	head: { appendChild() {} }
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
	throw new Error(`unexpected require: ${name}`)
})

const EVENTS = [
	{ seq: 0, type: "sandbox/mode", data: { mode: "workspace-write" } },
	{ seq: 1, type: "agent/inbox/spliced", data: { inserted: [{ content: [{ type: "text", text: "first" }] }] } },
	{ seq: 2, type: "turn/start", data: { turn: 1 } },
	{ seq: 3, type: "user/message", data: { content: [{ type: "text", text: "first" }], source: { kind: "user" } } },
	{ seq: 4, type: "turn/end", data: { turn: 1 } },
	{ seq: 5, type: "turn/start", data: { turn: 2 } }
]

function createRuntime() {
	const calls = { fork: [], retain: [], prompt: [], open: [], released: 0 }
	const registrations = new Map()
	const disposers = []
	const bindings = {
		"session-a": {
			sessionId: "session-a",
			eventSource: { getSnapshot: () => ({ entries: EVENTS.map((event) => ({ type: "durable", event })), hasMore: false }) }
		}
	}
	const childBinding = {
		sessionId: "session-child",
		session: {
			prompt: async (content, mode) => {
				calls.prompt.push({ content, mode })
				return { ok: true }
			}
		}
	}
	const ctx = {
		slots: {
			inject: (name, callback) => {
				const dispose = callback()
				disposers.push(dispose)
				return dispose
			},
			register: (options, Component) => {
				registrations.set(options.name, { options, Component })
				return () => registrations.delete(options.name)
			}
		},
		sessions: {
			binding: (id) => bindings[id],
			fork: async (options) => {
				calls.fork.push(options)
				return "session-child"
			},
			retain: (id, options) => {
				calls.retain.push({ id, options })
				return {
					ready: Promise.resolve(),
					binding: childBinding,
					release: () => {
						calls.released += 1
					}
				}
			}
		},
		uiWorkspace: {
			openSession: (id) => calls.open.push(id)
		},
		effect: (fn) => {
			disposers.push(fn())
		}
	}
	return { ctx, calls, registrations }
}

/** 在渲染树里找第一个匹配的元素。 */
function find(node, predicate) {
	if (node === null || typeof node !== "object") return undefined
	if (Array.isArray(node)) {
		for (const child of node) {
			const hit = find(child, predicate)
			if (hit !== undefined) return hit
		}
		return undefined
	}
	if (predicate(node)) return node
	return find(node.children, predicate)
}

test("apply:注册 turn-tail seat 与 shell.overlay 弹窗", () => {
	const { ctx, registrations } = createRuntime()
	plugin.apply(ctx)
	assert.deepEqual([...registrations.keys()].sort(), ["conversation.chat.turnTail", "shell.overlay"])
	assert.equal(registrations.get("conversation.chat.turnTail").options.id, "quick-fork")
})

test("seat:已闭合回合有按钮,未闭合回合没有", () => {
	const { ctx, registrations } = createRuntime()
	plugin.apply(ctx)
	const seat = registrations.get("conversation.chat.turnTail")
	const props = seat.options.inject("session-a")
	assert.deepEqual(props.target(1), { text: "first", boundary: 0, extraBlocks: 0 })
	assert.equal(props.target(2), undefined)
	const button = find(seat.Component({ turn: 1, ...props }), (node) => node.type === "button")
	assert.equal(button.props.className, "qf-iconBtn")
	assert.equal(seat.Component({ turn: 2, ...props }), null)
})

test("submit:官方 fork → retain → prompt → openSession,并释放临时引用", async () => {
	const { ctx, calls, registrations } = createRuntime()
	plugin.apply(ctx)
	const seat = registrations.get("conversation.chat.turnTail").options.inject("session-a")
	seat.begin(1)

	const dialog = registrations.get("shell.overlay").Component({})
	const submit = find(dialog, (node) => node.type === "button" && String(node.props.className).includes("qf-btnPrimary"))
	assert.equal(submit.props.disabled, false)
	await submit.props.onClick()

	assert.deepEqual(calls.fork, [{ sessionId: "session-a", atSeq: 0 }])
	assert.deepEqual(calls.retain, [{ id: "session-child", options: { source: "quick-fork" } }])
	assert.deepEqual(calls.prompt, [{ content: [{ type: "text", text: "first" }], mode: "queue" }])
	assert.deepEqual(calls.open, ["session-child"])
	assert.equal(calls.released, 1)
	// 事务结束:弹窗关闭。
	assert.equal(registrations.get("shell.overlay").Component({}), null)
})

test("submit:发送失败时保留弹窗并显示错误", async () => {
	const { ctx, calls, registrations } = createRuntime()
	calls.fail = true
	const originalPrompt = ctx.sessions.retain
	ctx.sessions.retain = (id, options) => {
		const reference = originalPrompt(id, options)
		reference.binding.session.prompt = async () => ({ ok: false, error: { code: "session/capacity" } })
		return reference
	}
	plugin.apply(ctx)
	const seat = registrations.get("conversation.chat.turnTail").options.inject("session-a")
	seat.begin(1)
	const overlay = registrations.get("shell.overlay")
	const submit = find(overlay.Component({}), (node) => node.type === "button" && String(node.props.className).includes("qf-btnPrimary"))
	await submit.props.onClick()
	const dialog = overlay.Component({})
	const error = find(dialog, (node) => node.props.className === "qf-error")
	assert.deepEqual(error.children, ["分支已创建,但首条消息发送失败(session/capacity)。"])
	assert.deepEqual(calls.open, [])
	assert.equal(calls.released, 1)
})
