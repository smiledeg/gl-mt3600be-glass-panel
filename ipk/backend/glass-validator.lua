-- gl-validator.d/glass.lua —— 部署到 /usr/share/gl-validator.d/glass.lua
--
-- oui.rpc 默认用 ^[%w%.%s%-_:#/]-$ 校验字符串参数；背景视频上传的 base64 里含 + / =，
-- 会被判成 Invalid params。这里只放行媒体上传相关方法，其余 glass 方法保持默认校验。
return {
	media_begin = true,
	media_chunk = true,
	media_finish = true,
	appearance_set = true,
	root_mode_set = true,
	pkg_upload_begin = true,
	pkg_upload_chunk = true,
	pkg_upload_finish = true,
	pkg_install = true,
}
