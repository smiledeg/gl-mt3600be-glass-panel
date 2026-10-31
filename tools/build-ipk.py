#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Glass Panel ipk 打包（Windows 本地可跑，不需要 Linux 构建机）

设备 opkg 只认「外层 tar.gz」形式：tar.gz{ debian-binary, control.tar.gz, data.tar.gz }，
标准 ar 包会报 Malformed package file。包内所有路径 uid/gid=0、目录 755、文件 644、
脚本 755 —— 用 python tarfile 精确控制（不依赖 fakeroot）。

用法：
    python tools/build-ipk.py                # 版本取 ipk/src/control/control 里的 Version
    python tools/build-ipk.py --version 3.0.0-1
产物：ipk/gl-glass-panel_<version>_all.ipk
"""
import argparse
import gzip
import io
import os
import re
import sys
import tarfile
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IPK = os.path.join(ROOT, 'ipk')
DIST = os.path.join(ROOT, 'dist')
PKG = 'gl-glass-panel'


def read_version():
    path = os.path.join(IPK, 'src', 'control', 'control')
    with open(path, 'r', encoding='utf-8') as f:
        m = re.search(r'^Version:\s*(\S+)', f.read(), re.M)
    return m.group(1) if m else '0.0.0-1'


def norm(name):
    """包内路径必须是 ./xxx 形式（与既有包一致）"""
    name = name.replace('\\', '/').lstrip('./')
    return './' + name


def add_file(tar, arcname, data, mode=0o644):
    info = tarfile.TarInfo(norm(arcname))
    info.size = len(data)
    info.mode = mode
    info.uid = info.gid = 0
    info.uname = info.gname = 'root'
    info.mtime = int(time.time())
    tar.addfile(info, io.BytesIO(data))


def add_dir(tar, arcname):
    info = tarfile.TarInfo(norm(arcname).rstrip('/') + '/')
    info.type = tarfile.DIRTYPE
    info.mode = 0o755
    info.uid = info.gid = 0
    info.uname = info.gname = 'root'
    info.mtime = int(time.time())
    tar.addfile(info)


def make_targz(entries, dirs):
    """entries: [(arcname, bytes, mode)]，非压缩 tar → gzip"""
    raw = io.BytesIO()
    with tarfile.open(fileobj=raw, mode='w', format=tarfile.GNU_FORMAT) as tar:
        for d in dirs:
            add_dir(tar, d)
        for name, data, mode in entries:
            add_file(tar, name, data, mode)
    raw.seek(0)
    out = io.BytesIO()
    with gzip.GzipFile(fileobj=out, mode='wb', mtime=0) as gz:
        gz.write(raw.read())
    return out.getvalue()


def walk_files(base):
    """返回 [(相对路径, 绝对路径)]，跳过隐藏备份文件"""
    out = []
    for dirpath, dirnames, filenames in os.walk(base):
        dirnames[:] = [d for d in dirnames if not d.startswith('.')]
        for fn in filenames:
            if fn.startswith('.'):
                continue
            full = os.path.join(dirpath, fn)
            rel = os.path.relpath(full, base)
            out.append((rel, full))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--version', default=None)
    ap.add_argument('--out-dir', default=IPK)
    args = ap.parse_args()

    version = args.version or read_version()

    if not os.path.isdir(DIST) or not os.path.isfile(os.path.join(DIST, 'index.html')):
        sys.exit('!! 缺少 dist/，先跑 npm run build')

    # data 布局
    dist_files = walk_files(DIST)
    data_entries = []
    data_dirs = set()
    for rel, full in dist_files:
        arc = 'www/glass/' + rel.replace(os.sep, '/')
        mode = 0o644
        data_entries.append((arc, open(full, 'rb').read(), mode))
        parts = arc.split('/')[:-1]
        for i in range(1, len(parts) + 1):
            data_dirs.add('/'.join(parts[:i]))

    # 后端：glass rpc / nui rpc / nginx 片段 / nui 补丁模块
    backend = os.path.join(IPK, 'backend')
    for name, arc, mode in [
        ('glass', 'usr/lib/oui-httpd/rpc/glass', 0o644),
        ('nui', 'usr/lib/oui-httpd/rpc/nui', 0o644),
        ('zz-glass.conf', 'etc/nginx/gl-conf.d/zz-glass.conf', 0o644),
        ('zz-glass-root.conf', 'etc/nginx/gl-conf.d/zz-glass-root.conf', 0o644),
        ('glass-validator.lua', 'usr/share/gl-validator.d/glass.lua', 0o644),
        ('glass-rate', 'usr/bin/glass-rate', 0o755),
        ('glass-rate.init', 'etc/init.d/glass-rate', 0o755),
    ]:
        p = os.path.join(backend, name)
        if os.path.isfile(p):
            data_entries.append((arc, open(p, 'rb').read(), mode))
            for i in range(1, len(arc.split('/'))):
                data_dirs.add('/'.join(arc.split('/')[:i]))

    nui_dir = os.path.join(backend, 'nui')
    if os.path.isdir(nui_dir):
        for rel, full in walk_files(nui_dir):
            if not rel.endswith('.lua'):
                continue
            arc = 'usr/lib/lua/luci/nui/' + rel.replace(os.sep, '/')
            data_entries.append((arc, open(full, 'rb').read(), 0o644))
            data_dirs.update({'usr/lib/lua/luci/nui', 'usr/lib/lua/luci', 'usr/lib/lua', 'usr/lib', 'usr'})

    # ipk/backend 下的 Lua：
    #   nradio.lua        → /usr/lib/lua/luci/nradio.lua   （luci.nradio 兼容 shim）
    #   nui-validator.lua → /usr/share/gl-validator.d/nui.lua（放行 invoke 参数）
    #   nui-modules/*.lua → /usr/lib/lua/luci/nui/<name>.lua （覆盖 NUI 原模块的 GL 补丁）
    #   其它 *.lua        → /usr/lib/lua/luci/nui/<name>.lua
    def add_lua(fname, arc, dirs):
        data_entries.append((arc, open(os.path.join(backend, fname), 'rb').read(), 0o644))
        data_dirs.update(dirs)

    for fn in sorted(os.listdir(backend)):
        full = os.path.join(backend, fn)
        if not os.path.isfile(full) or not fn.endswith('.lua'):
            continue
        if fn == 'nradio.lua':
            add_lua(fn, 'usr/lib/lua/luci/nradio.lua', {'usr/lib/lua/luci', 'usr/lib/lua', 'usr/lib', 'usr'})
        elif fn == 'nui-validator.lua':
            add_lua(fn, 'usr/share/gl-validator.d/nui.lua', {'usr/share/gl-validator.d', 'usr/share', 'usr'})
        else:
            add_lua(fn, 'usr/lib/lua/luci/nui/' + fn, {'usr/lib/lua/luci/nui', 'usr/lib/lua/luci', 'usr/lib/lua', 'usr/lib', 'usr'})

    mod_dir = os.path.join(backend, 'nui-modules')
    if os.path.isdir(mod_dir):
        for fn in sorted(os.listdir(mod_dir)):
            full = os.path.join(mod_dir, fn)
            if not os.path.isfile(full) or not fn.endswith('.lua'):
                continue
            data_entries.append(('usr/lib/lua/luci/nui/' + fn, open(full, 'rb').read(), 0o644))
            data_dirs.update({'usr/lib/lua/luci/nui', 'usr/lib/lua/luci', 'usr/lib/lua', 'usr/lib', 'usr'})

    # NUI 后端运行时（从 luci-app-nradio-nui 拆出来的最小集合：Lua 模块 + 测速/诊断脚本 +
    # SPEED UI 静态资源）。插件的「前端页面 / 皮肤 / LuCI 页面」不入包，只保留本面板 nui 桥需要的后端。
    runtime = os.path.join(backend, 'nui-runtime')
    if os.path.isdir(runtime):
        for rel, full in walk_files(runtime):
            arc = rel.replace(os.sep, '/')
            mode = 0o755 if (arc.startswith('usr/libexec/') or arc.startswith('www/cgi-bin/')) else 0o644
            data_entries.append((arc, open(full, 'rb').read(), mode))
            parts = arc.split('/')[:-1]
            for i in range(1, len(parts) + 1):
                data_dirs.add('/'.join(parts[:i]))

    # 同名路径去重（后加的覆盖先加的：补丁模块覆盖原始模块）
    uniq = {}
    for arc, blob, mode in data_entries:
        uniq[arc] = (blob, mode)
    data_entries = [(arc, blob, mode) for arc, (blob, mode) in uniq.items()]

    add_ver = ('version=%s\nbuilt=%s\n' % (version, time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()))).encode()
    data_entries.append(('www/glass/build.txt', add_ver, 0o644))

    data_tgz = make_targz(data_entries, sorted(data_dirs))

    # control
    ctrl_dir = os.path.join(IPK, 'src', 'control')
    ctrl_entries = []
    control = open(os.path.join(ctrl_dir, 'control'), 'r', encoding='utf-8').read()
    size_kb = max(1, len(data_tgz) // 1024)
    control = re.sub(r'^Version:.*$', 'Version: %s' % version, control, flags=re.M)
    if re.search(r'^Installed-Size:', control, flags=re.M):
        control = re.sub(r'^Installed-Size:.*$', 'Installed-Size: %d' % size_kb, control, flags=re.M)
    else:
        control = control.replace('Architecture: all', 'Architecture: all\nInstalled-Size: %d' % size_kb)
    ctrl_entries.append(('control', control.encode(), 0o644))
    for name in ('postinst', 'prerm', 'postrm', 'preinst', 'conffiles'):
        p = os.path.join(ctrl_dir, name)
        if os.path.isfile(p):
            mode = 0o755 if name in ('postinst', 'prerm', 'postrm', 'preinst') else 0o644
            ctrl_entries.append((name, open(p, 'rb').read(), mode))
    ctrl_tgz = make_targz(ctrl_entries, [])

    debian = b'2.0\n'
    out_name = '%s_%s_all.ipk' % (PKG, version)
    out_path = os.path.join(args.out_dir, out_name)
    with open(out_path, 'wb') as f:
        raw = io.BytesIO()
        with tarfile.open(fileobj=raw, mode='w', format=tarfile.GNU_FORMAT) as tar:
            add_file(tar, 'debian-binary', debian, 0o644)
            add_file(tar, 'control.tar.gz', ctrl_tgz, 0o644)
            add_file(tar, 'data.tar.gz', data_tgz, 0o644)
        raw.seek(0)
        with gzip.GzipFile(fileobj=f, mode='wb', mtime=0) as gz:
            gz.write(raw.read())

    print('== built: %s (%.1f KB)' % (out_path, os.path.getsize(out_path) / 1024))
    print('   version:', version, ' files:', len(data_entries), ' data.tar.gz:', len(data_tgz), 'B')


if __name__ == '__main__':
    main()
