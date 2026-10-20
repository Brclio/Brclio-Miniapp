# 账号与私有数据边界

当前 `0.1.0` 是摄影、放松与访客中心，不实现注册登录。「我的」中的登录筹备说明不是登录按钮，不获取头像、手机号或微信身份，不创建云端用户档案。原生挑战偏好与最近 20 场对局仅保存在微信本机缓存；独立网页使用浏览器本地存储。

## 已指定的数据仓库

未来需要服务端持久化时，使用用户指定的私有仓库 `BrclioData/Brclio-Miniapp-Data`。仓库名可以记录在服务端配置与文档中；GitHub token 仅保存在服务端 Secret，不能写入 `miniprogram/`、`web/`、`dist/`、项目配置、日志、二维码或 Git 提交。

本次没有访问上述用户数据私库，也没有使用本轮聊天中提供的 token。当前生产 Pages 的旧记录 API 继续返回 503，不会因为配置凭据就自动开通云同步。归档 Worker 是匿名设备能力的历史方案，不能充当微信账号认证。

## 后续接入顺序

1. 明确账号用途、数据字段、保留时间、删除机制和隐私说明，再实现真实登录。
2. 原生端通过 `wx.login` 获取一次性 code，服务端调用微信 `code2Session`。AppSecret、session_key、GitHub token 不下发客户端；服务端签发自定义会话，不能信任客户端提交的用户 ID。
3. 原生会话与 H5 会话分别设计与校验。现有归档 Worker 的两个 H5 Origin 白名单不能直接用于原生请求；不能放宽成任意 Origin 来接入。
4. 私库读写采用固定目录、固定 JSON schema、服务端身份隔离、SHA 并发冲突保护和速率限制，不提供任意路径代理。用户敏感身份数据不进入公开摄影素材或 CDN。
5. 接入前完成微信备案、对应类目与隐私声明；验证登录、失效、退出、跨账号隔离与删除流程后，才开启对外能力。

微信域名统一使用已备案的 `pocket.bornforthis.cn`。未备案的 `brclio.com` 可以承载公开网页，但不能据此承诺微信生产域名可用。

参考：[微信登录流程](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/login.html)、[小程序网络说明](https://developers.weixin.qq.com/miniprogram/dev/framework/ability/network.html)。
