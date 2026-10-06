# dsh-quick-fork

[dsh](https://github.com/deepseek-ai)(DeepSeek Harness)web 客户端的**纯 client** 回合编辑插件:每条已落定用户消息的**复制键右侧**有一个 ✎ 按钮,点开弹窗改写那条输入,然后**在该回合之前分叉出新会话并自动执行**。原会话原样保留,随时切回。

功能上等价于 dsh-fork-edit 的「编辑」入口,但**没有 host 半** —— 不注册 HTTP 路由、不写自定义事件,全部动作都调用官方 Client 服务。

## 为什么可以纯 client

dsh-fork-edit 把 fork 事务放在 host 侧(`agents.create` + `seed` + `followup`),再自建 `/fork-edit` 路由给浏览器调用。官方其实在 client 侧已经提供了同一条链路:

| 用途 | 官方 Client API |
|---|---|
| 分叉 | `ctx.sessions.fork({ sessionId, atSeq, increaseTitle? })` —— 官方 turn 尾 branch 按钮调用的同一 API |
| 回合数据 | `ctx.sessions.binding(id).eventSource` 的已加载事件窗口(官方 Conversation assembler 消费的同一份 `SessionEventLikeEntry` feed) |
| 按钮 | 官方用户消息操作行里、复制键右侧 DOM 注入(官方没有用户消息的 action slot);行/回合/会话三个判据全取官方属性,图标是内联的官方式 SVG |
| 弹窗 | 官方 `shell.overlay` slot |
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
- 边界必须落在已加载窗口内:窗口从 `turn/start` 处开始时,该回合的注入事件不在窗口里,边界算不出来。此时**先补一页历史**(`binding.session.loadOlder()`,每会话至多两页,不动滚动位置)把边界拉进窗口,仍不行就不给按钮 —— 不猜一个会重放原输入的 seq。
- 「当前正在进行的回合」和「还没落定成本回合的消息(排队/steering 回显)」本来就没有 `turn/end`/回合编号,不注入按钮。

按钮与回合的对应关系不靠文本回配:官方在每个 chat 节点的流式包裹元素上标了 `data-chat-turn`(ChatView 自己的分页锚点同源),行本身由 `[data-conversation-session] [data-chat-turn] [data-clock="start"]` 选出,所以同一段开头 24 字的消息不会互相抢配对;消息文案仍从 fiber 上 `MessageIconActions` 的 `props.text` 取(官方复制键的那段原文)。

## 用法

- ✎ 出现在**你发出的每条已落定消息**的时间戳/复制键右侧 8px 处,随官方 hover 显隐一起出现(和复制键同一条显隐规则),外形与官方 action 按钮一致;
- 弹窗预填那条消息的原文;**Enter 创建分支,Shift+Enter 换行**,输入法组合态不误触发;
- 提交后:`fork` → 子会话 `prompt` 编辑后的文本 → 自动打开子会话;原输入一字不改地提交即等于「重跑本回合」;
- 失败时弹窗保留并显示错误(分支已创建但发送失败时会说明),原会话不受影响。

> 位置与 fork-edit 一致(用户消息行 DOM 注入),但数据不走向 host 的 HTTP 路由:回合表直接读 `binding.eventSource` 的已加载窗口。
> 弹窗不含 fork-edit 的会话 timeline 跳转;图片不参与,原消息里的图片块会在弹窗里提示「不会带进分支」。

## 安装

```
dsh plugin --profile <profile> add link:/path/to/dsh-quick-fork
# 或发布后:dsh plugin --profile <profile> add github:homily707/dsh-quick-fork
```

插件无配置项。装好后刷新页面即可(仅浏览器半,不需要 host 重启)。

## 局限与假设

- 依赖四处官方契约:`binding.eventSource` 的事件窗口形状,用户消息操作行所在的 `[data-clock="start"]` / `[data-chat-turn]` / `[data-conversation-session]` 三个 DOM 属性,以及 React fiber 上的 `props.text`(复制键那段原文)。官方若调整,失配表现为按钮消失或分叉报错,不会破坏历史会话(不写入任何自定义事件)。
- 图标不引官方 `@deepseek-ai/dsh-client-ui-primitives`:该包在 client 侧没有独立模块(client-modules 找不到它的 `./client`),`require` 它会让整个浏览器半抛错、插件静默消失。所以这里把官方 `ic_ds_edit_outline_16` 的两段 path 内联进 `client.js`。
- 只能编辑**已加载窗口内**的回合;最老那条已加载消息靠自动补页(每会话两页)兜底,更早的历史需要手动向上翻页。
- 子会话模型由官方 fork 决定(取当前默认模型路由),不使用源会话的历史路由。
- 只重放文本:原消息里的图片块不带过去。

## 工程结构

```
dsh-quick-fork/
├── package.json      # dsh.bundle.patch / dsh.client 清单(无运行期依赖)
├── cordis.patch.yml  # 唯一的 host 作用:让 Loader 收录本包
├── index.mjs         # host 半:空实现
├── client.js         # 浏览器半:用户消息行注入 ✎ + 弹窗 + 分叉事务
├── test/             # node --test:纯逻辑(边界计算)、注入器(假 DOM)与接线(fork/retain/prompt)
├── README.md
└── LICENSE
```

## License

[MIT](./LICENSE)
