# useradmin 部署与测试工具

- `create-fn.js` — 首次创建云函数（直调 SCF CreateFunction，zip base64）
- `deploy.js` — 更新函数代码（直调 SCF UpdateFunctionCode）
- `e2e-lifecycle.js` — 全生命周期实测（建号→登录→改密→停用→解绑→恢复）

用法：`node tools/deploy.js`（凭据来自 `~/.config/.cloudbase/auth.json`，即 tcb CLI 登录态）

背景：tcb CLI `fn deploy` 在本机的云端构建环节报 `ZipCodeFmt / entryfile` 错（构建镜像缺 mjs），
直调 SCF API 绕开该环节一次成功；静态托管（`tcb hosting deploy dist`）不受影响。