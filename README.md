# dsh-quick-fork

[dsh](https://github.com/deepseek-ai)(DeepSeek Harness)web 客户端的**纯 client** 回合编辑插件:每个已落定回合的操作行里有一个 ✎ 按钮,点开弹窗改写该回合的用户输入,然后**在该回合之前分叉出新会话并自动执行**。原会话原样保留,随时切回。

功能上等价于 dsh-fork-edit 的「编辑」入口,但**没有 host 半** —— 不注册 HTTP 路由、不写自定义事件,全部动作都调用官方 Client 服务。

## 为什么可以纯 client

dsh-fork-edit 把 fork 事务放在 host 侧(`agents.create` + `seed` + `followup`),再自建 `/fork-edit` 路由给浏览器调用。官方其实在 client 侧已经提供了同一条链路:

| 用途 | 官方 Client API |
|---|---|
| 分叉 | `ctx.sessions.fork({ sessionId, atSeq, increaseTitle? })` —— 官方 turn 尾 branch 按钮调用的同一 API |
| 回合数据 | `ctx.sessions.binding(id).eventSource` 的已加载事件窗口(官方 Conversation assembler 消费的同一份 `SessionEventLikeEntry` feed) |
| 按钮席位 | `conversation.chat.turnTail` list slot —— 官方 turn-tail 节点用 `renderSlot("conversation.chat.turnTail", { turn, seq })` 渲染的子槽位 |
| 发送首条消息 | 临时 `retain` 子会话 → `binding.session.prompt([text], "queue")`(官方 composer 首条消息的同一底层调用) |
| 切换会话 | `ctx.uiWorkspace.openSession(childId)` |

于是 host 侧只剩一个空实现(`index.mjs`)—— 存在的唯一理由是 client-modules 从 host Loader 条目里发现 `dsh.client` 声明来投递浏览器半。

## 边界怎么取(实现要点)

`atSeq` 是**包含式**切割点。官方 fork 支持任意存在的 seq,但直接在想要改的回合开切是错的:

```
seq 2  agent/inbox/spliced  { inserted: [原输入] }   ← 输入注入
seq 3  turn/start           { turn: 1 }
seq 4  agent/inbox/spliced  { removedCount: 1 }      ← 配对的领取
```

v3 事件语法里,回合输入先作为 splice 注入到 `turn/start` **之前**,配对的领取 splice 落在**其后**。若边界切在注入事件上(等价于 fork-edit host 侧的 `turn.startSeq - 1`),子会话会带着一个「待领取」的队列项醒来,先把**原输入重放一遍**,编辑后的文本只能排到第二个回合(fork-edit 用 host 侧 `child.agent.cancel({kind:"user"})` 清掉它)。

本插件的边界 = **该回合输入注入之前的最后一个事件 seq**:

- 扫描从 `turn/start` 往前,遇到本回合的注入事件就把边界继续前移,直到上一回合的 `turn/end` 或窗口起点;
- 因此 seed 里既不含未配对注入,也保留回合之间的会话级事件(改名、权限切换等);
- 边界必须落在已加载窗口内:窗口从注入事件处开始时,该回合**不显示按钮**,而不是猜一个 seq。

## 用法

- 按钮出现在**回合操作行**里(官方 copy / branch 图标的左侧),与官方一致按 hover 显隐(`data-actions-reveal` 为 `always` 时始终可见);
- 弹窗预填该回合的用户输入;**Enter 创建分支,Shift+Enter 换行**,输入法组合态不误触发;
- 提交后:`fork` → 子会话 `prompt` 编辑后的文本 → 自动打开子会话;原输入一字不改地提交即等于「重跑本回合」;
- 失败时弹窗保留并显示错误(分支已创建但发送失败时会说明),原会话不受影响。

> 按钮位置与 fork-edit 不同:fork-edit 把 ✎ 注入到**用户气泡**的行动作行(DOM 注入 + 文本前缀匹配)。官方没有用户消息的 action slot,所以本插件选官方 turn 尾 seat,坐在同一个操作行里,不碰 DOM。
> 弹窗不含 fork-edit 的会话 timeline 跳转;图片不参与,原消息里的图片块会在弹窗里提示「不会带进分支」。

## 安装

```
dsh plugin --profile <profile> add link:/path/to/dsh-quick-fork
# 或发布后:dsh plugin --profile <profile> add github:homily707/dsh-quick-fork
```

插件无配置项。装好后刷新页面即可(仅浏览器半,不需要 host 重启)。

## 局限与假设

- 依赖两处官方 client 契约:`binding.eventSource` 的事件窗口形状与 `conversation.chat.turnTail` 子槽位。官方若调整,失配表现为按钮消失或分叉报错,不会破坏历史会话(不写入任何自定义事件)。
- 只能编辑**已加载窗口内**的回合;更早的历史需要先向上翻页。
- 子会话模型由官方 fork 决定(取当前默认模型路由),不使用源会话的历史路由。
- 只重放文本:原消息里的图片块不带过去。

## 工程结构

```
dsh-quick-fork/
├── package.json      # dsh.bundle.patch / dsh.client 注入清单
├── cordis.patch.yml  # 唯一的 host 作用:让 Loader 收录本包
├── index.mjs         # host 半:空实现
├── client.js         # 浏览器半:seat 按钮 + 弹窗 + 分叉事务
├── test/             # node --test:纯逻辑(边界计算)与接线(fork/retain/prompt)
├── README.md
└── LICENSE
```

## License

[MIT](./LICENSE)
