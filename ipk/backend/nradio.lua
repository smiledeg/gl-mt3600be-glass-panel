-- luci.nradio —— GL 4.9 兼容层（NUI 插件补丁）
--
-- 部署到 /usr/lib/lua/luci/nradio.lua（原固件没有这个文件，不会覆盖任何官方模块）。
--
-- 背景：NUI 插件是给 原厂固件写的，代码里 22 个方法直接 require "luci.nradio"
-- （原厂固件的厂商公共库：平台探测、蜂窝 get_cellular_last、WAN 列表、IPv6 能力、
-- cpelock/cpecfg 写入动作、短信发送等）。GL 4.9 没有这个库，模块调用即抛
-- "module 'luci.nradio' not found"，前端拿到 500。
--
-- 本文件只实现“在 GL 4.9 上有真实意义”的部分：
--   * 平台/固件能力：get_platform / is_openwrt / get_wifi_vendor / has_nat / has_ptype
--   * IPv6 能力：GL 支持 IPv6（局端由官方 ipv6 对象管理，这里只用于 NUI 页签显示）
--   * WAN 列表：从 GL 自己的 uci network 反推（wan/secondwan/...），供联网检测/分流页面消费
--   * 蜂窝相关：本机无模组；且 GL 4.9 没有 厂商 的 infocd/cpesel/cpecfg，
--     所以 support_* 一律 false、get_cellular_last 给出安全默认，写动作（app_write_*）返回 false。
--     真正需要蜂窝数据的页面请前端改用官方 cellular.* / modem RPC（见 docs/nui-bridge.md）。
--   * 短信：GL 官方走 modem.get_sms_list/send_sms（rpc 对象 modem）；NUI 的 sms_send 返回 false。
--
-- 未知函数通过 __index 兜底返回 false 版本，避免因为版本差异直接崩。
local fs   = require "nixio.fs"
local util = require "luci.util"

local M = {}

local function cursor()
	return require("luci.model.uci").cursor()
end

local function board()
	local ok, b = pcall(util.ubus, "system", "board", {})
	return (ok and type(b) == "table") and b or {}
end

-- 模组是否真的插着（与补丁模块同一套判据：/dev 下有没有 USB/MHI/WWAN 设备节点）
local function modem_present()
	local prefixes = { "^ttyUSB", "^cdc%-wdm", "^mhi", "^wwan" }
	local it = fs.dir("/dev")
	if it then
		for name in it do
			for _, pat in ipairs(prefixes) do
				if name:match(pat) then return true end
			end
		end
	end
	return false
end

--- 平台：GL-MT3600BE 是 MediaTek mt7987（board target = mediatek/mt7987）
function M.get_platform()
	local b = board()
	local s = tostring(b.target or "") .. " " .. tostring(b.board or "") .. " " .. tostring(b.model or "")
	if s:find("mediatek", 1, true) or s:find("mt79", 1, true) or s:find("mtk", 1, true) then return "mtk" end
	if s:find("qualcomm", 1, true) or s:find("ipq", 1, true) then return "qualcomm" end
	return "generic"
end

function M.is_openwrt()
	return true
end

function M.get_wifi_vendor()
	local p = M.get_platform()
	if p == "mtk" then return "mtk" end
	if p == "qualcomm" then return "qualcomm" end
	return "generic"
end

-- GL 4.9 确实做 NAT，但 厂商 里 has_nat() 的语义是“带 wanchk/UPnP/VPN 子系统的 NAT 机型”：
-- GL 的联网检测是 srv_conn_check、端口/UPnP 走官方 firewall/port_forward，没有 厂商 那套。
-- 这里返回 false，让 adv.caps 的 wanchk/upnp/vpn 页签如实关闭（避免前端显示空页面）。
function M.has_nat()
	return false
end

function M.has_ptype(t)
	return t == "rt" or t == "router"
end

-- 厂商 的 cpe 抽象在 GL 上没有（GL 用 network.interface.modem* + cellular.*），如实返回 false
function M.has_cpe()
	return false
end

-- IPv6：GL 支持（设置页由官方 ipv6 对象管理；这里只决定 NUI 页签是否显示）
function M.support_ipv6() return true end
function M.support_wan_ipv6() return true end
-- 中继（relay）模式走 GL 官方 ipv6/odhcpd 配置，厂商 的 relay 流程不复用 → 如实返回 false
function M.support_ipv6_relay() return false end
function M.support_ipv6_nat() return true end
-- 厂商 的 ip6class 写动作在 GL 上没有对应实现（IPv6 由官方 ipv6 对象写）
function M.ip6class_set() return true end

-- WAN 线路列表：从 GL 的 uci network 反推；形状与原厂 get_wans_data 对齐
-- { wans = { {name, translate, type, disabled} }, net_kind, dividing, dividing_default }
-- adv.wanchk_get 只在 uci 里存在 wanchk.<name> 时才会输出行，GL 没有 wanchk 配置 → 返回空列表（如实）
function M.get_wans_data()
	local c = cursor()
	local wans = {}
	local function add(s)
		local name = s[".name"] or ""
		local proto = s.proto or ""
		if name == "lan" or name == "loopback" or name:match("^guest") or name:match("^iot") or name:match("^tether") then return end
		if name:match("6$") then return end -- IPv6 侧接口不单独算一条线路
		if proto ~= "dhcp" and proto ~= "static" and proto ~= "pppoe" and proto ~= "wwan" then return end
		wans[#wans + 1] = {
			name = name,
			translate = s.translate or name,
			type = proto,
			disabled = s.disabled,
		}
	end
	c:foreach("network", "interface", add)
	return {
		wans = wans,
		net_kind = c:get("network", "globals", "net_kind") or "",
		dividing = c:get("network", "globals", "dividing") or "",
		dividing_default = c:get("network", "globals", "dividing_default") or "",
	}
end

-- 网口角色（厂商 的 nrswitch 解码）：GL 用 board_special 描述，这里不提供 → 空表（调用方有 or {} 兜底）
function M.get_nrswitch_info()
	return {}
end

---------------------------------------------------------------------------
-- 蜂窝：GL 4.9 没有 厂商 的 cpesel/cpecfg/infocd 体系，锁频/网络模式/PIN 一律不可用
-- （m_cellcfg 已在补丁里提前给出中文错误，不会走到这里；这些返回值只是兜底，避免崩）
---------------------------------------------------------------------------
function M.get_cellular_last(iface)
	return "1", iface or "cpe"
end

function M.support_lock_freq() return false end
function M.support_nr() return false end
function M.support_cellular_mode() return false end
function M.support_cellular_nrrc() return false end
function M.support_cellular_roam() return false end
function M.support_cellular_ippass() return false end
function M.support_compatible_nr() return false end
function M.support_fallbackToR16() return false end
function M.support_fallbackToLTE() return false end
function M.support_vsim() return false end
function M.support_dualdnn() return false end

-- 原厂生效动作（同步模组/重拨）：GL 上没有对应实现，写路径一律不执行
function M.app_write_earfcn() return false end
function M.app_write_cpecfg() return false end
function M.set_n79_relate() return false end
function M.save_lan_ip() return true end
function M.apply_guest() return true end

-- 短信：NUI 的定向短信（告警通知）在 GL 上走官方 modem RPC；这里返回失败让调用方走降级
function M.sms_send() return false end
function M.get_cellular_prefix() return "cpe" end

-- 其它未列出的函数：返回 false，避免插件版本差异导致崩溃
setmetatable(M, {
	__index = function()
		return function() return false end
	end,
})

return M
