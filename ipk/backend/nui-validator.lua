-- gl-validator.d/nui.lua —— 部署到 /usr/share/gl-validator.d/nui.lua
--
-- oui.rpc 默认会用 ^[%w%.%s%-_:#/]-$ 校验所有字符串参数，而 NUI 桥的 args 里会出现
-- AT 命令（AT+CSQ）、URL、JSON 串等含 + ? & = 的值，会被判成 Invalid params。
-- 返回 { invoke = true } 即对 nui.invoke / nui.call 跳过参数校验（方法名/对象名仍由
-- oui-rpc.lua 的正则校验）；鉴权仍由 /rpc 会话负责，不放开任何权限。
return {
	invoke = true,
	call = true,
}
