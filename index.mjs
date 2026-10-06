//#region dsh-quick-fork — Host half (empty)
/**
 * dsh-quick-fork — Host 半:空实现。
 *
 * 本插件的全部行为都在浏览器半(package.json 的 exports["./client"]):
 * 回合编辑按钮、弹窗、分叉都走官方 Client 服务
 * (ctx.sessions.fork / binding.session.prompt / ctx.uiWorkspace.openSession),
 * host 侧不需要路由、服务或事件监听。
 *
 * 这个模块存在的唯一理由:client-modules 是从 host Loader 的条目里发现
 * `dsh.client` 声明、并把浏览器半投递给页面的,所以每个 bundle 条目都需要一个
 * 可导入的 host 模块。这里的 apply 不做任何事。
 */

/** Stable Cordis plugin name (host row id is `quick-fork`). */
const name = "quick-fork"

/** No host-side contribution. */
function apply() {}

export { apply, name }
//#endregion
