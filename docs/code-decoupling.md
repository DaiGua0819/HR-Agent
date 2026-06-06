# 招聘智能体解耦说明

## 当前阶段

当前是兼容优先的第二阶段拆分，目标是降低超大文件读取成本，同时保持现有功能、接口、端口、账号配置和运行方式不变。

## 入口保持不变

- `python agent_web_server.py`
- `node patchwork-recruit-gpt/server.js`
- `patchwork-recruit-gpt/index.html`

## Python 后端

- `agent_web_server.py` 只负责调用 `agent_core/legacy_loader.py`。
- 原业务代码按顺序保存在 `agent_core/legacy_parts/agent_web_server.part*.py`。
- 加载器会按文件名排序拼接并在入口全局命名空间执行，所以原来的全局变量、类、函数名和 `SERVICE` 初始化保持不变。

## Node 前端服务

- `patchwork-recruit-gpt/server.js` 只负责调用 `server/runtime/legacyServerLoader.js`。
- 原业务代码按顺序保存在 `patchwork-recruit-gpt/server/legacy-parts/server.part*.js`。
- 加载器继续使用入口文件的 `require`、`module`、`exports` 和 `__dirname`，所以原来的相对路径、API 路由和监听逻辑保持不变。
- `server/services/automationProxy.js` 已抽出 agent summary 读取、agent JSON 请求和平台代理响应逻辑；legacy 中保留同名函数作为委托包装，避免接口和调用点变化。
- `/api/automation-browser/start` 已改为后台 job 模式，前端通过 `/api/automation-browser/jobs/:jobId` 轮询六个 CloakBrowser 启动状态。

## 浏览器前端

`index.html` 仍按普通 script 顺序加载，不使用 ES module。加载顺序不能随意调整：

1. `src/config/frontend-config.js`
2. `src/client/core/state.js`
3. `src/client/core/helpers.js`
4. `src/client/automation/overview.js`
5. `src/client/resumes/library.js`
6. `src/client/scoring/rules.js`
7. `src/client/batch/imports.js`
8. `src/client/core/init.js`
9. `script.js`

这些文件依旧共享经典浏览器脚本作用域，后续如果要继续语义化，需要按函数依赖逐步迁移，不能直接改成 `type="module"`。

## CSS

`styles.css` 是兼容入口，只做 `@import`。拆分后的样式必须保持当前 import 顺序，避免覆盖关系变化。

## 后续安全拆分顺序

1. 先从 Node 的只读 API 和纯工具函数开始抽 `services`。
2. 再抽前端无副作用的格式化、筛选、渲染小函数。
3. 最后再动 Python 平台自动化方法，优先按 BOSS、51、智联拆 mixin。
4. 每抽一块都跑语法检查和只读 smoke test，再进入下一块。
