#!/usr/bin/env bash
# ============================================================
#  Glass Panel v2 ipk 构建（Vue 3 产物，无编译依赖，Architecture: all）
#  产物: gl-glass-panel_<version>_all.ipk
#  格式: tar.gz{ debian-binary, control.tar.gz, data.tar.gz }
#        —— 这台设备的 opkg 只认这种形式，标准 ar 包会报 Malformed
# ============================================================
set -euo pipefail
cd "$(dirname "$0")"

PKG=gl-glass-panel
VERSION="${VERSION:-2.0.0-1}"
OUT="${PKG}_${VERSION}_all.ipk"
STAGE=stage
ROOT="$(cd .. && pwd)"

# --- 0. 前置检查：dist 必须存在且资源路径是 /glass/ ---
[ -f "$ROOT/dist/index.html" ] || { echo "!! 缺少 dist/，先跑 npm run build"; exit 1; }
grep -q '/glass/assets/' "$ROOT/dist/index.html" || {
    echo "!! dist 的资源路径不是 /glass/，请用普通 npm run build（别加 --base=/）"; exit 1
}

# --- 1. 清理 ---
rm -rf "$STAGE" "$OUT"
mkdir -p "$STAGE/control" "$STAGE/data"

# --- 2. data 布局 ---
mkdir -p "$STAGE/data/www/glass" \
         "$STAGE/data/usr/lib/oui-httpd/rpc" \
         "$STAGE/data/etc/nginx/gl-conf.d"

cp -r "$ROOT"/dist/. "$STAGE/data/www/glass/"
cp    backend/glass            "$STAGE/data/usr/lib/oui-httpd/rpc/glass"
cp    backend/zz-glass.conf    "$STAGE/data/etc/nginx/gl-conf.d/zz-glass.conf"

# 构建标记（排查线上到底是哪一版）
{
    echo "version=${VERSION}"
    echo "built=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "entry=$(basename "$(ls "$STAGE"/data/www/glass/assets/index-*.js | head -1)")"
} > "$STAGE/data/www/glass/build.txt"

# --- 3. 权限：目录 755 / 文件 644 ---
find "$STAGE/data" -type d -exec chmod 755 {} +
find "$STAGE/data" -type f -exec chmod 644 {} +

# --- 4. control ---
cp src/control/control src/control/postinst src/control/prerm src/control/postrm "$STAGE/control/"
chmod 755 "$STAGE/control/postinst" "$STAGE/control/prerm" "$STAGE/control/postrm"
chmod 644 "$STAGE/control/control"

SIZE=$(du -sk "$STAGE/data" | cut -f1)
# 幂等：重复执行不会叠加多行
sed -i "s/^Version: .*/Version: ${VERSION}/" "$STAGE/control/control"
grep -q '^Installed-Size:' "$STAGE/control/control" \
    && sed -i "s/^Installed-Size: .*/Installed-Size: ${SIZE}/" "$STAGE/control/control" \
    || sed -i "/^Architecture: all$/a Installed-Size: ${SIZE}" "$STAGE/control/control"

# --- 5. 打包 ---
( cd "$STAGE/control" && tar czf ../control.tar.gz ./control ./postinst ./prerm ./postrm --owner=0 --group=0 --numeric-owner )
( cd "$STAGE/data"    && tar czf ../data.tar.gz . --owner=0 --group=0 --numeric-owner )
echo "2.0" > "$STAGE/debian-binary"
( cd "$STAGE" && tar czf "../$OUT" debian-binary control.tar.gz data.tar.gz --owner=0 --group=0 --numeric-owner )

# --- 6. 校验 ---
echo "== built: $OUT =="
ls -lh "$OUT"
echo "-- 外层成员:"; tar tzf "$OUT"
echo "-- control:"; tar xzOf "$STAGE/control.tar.gz" ./control | sed -n '1,12p'
echo "-- data 统计:"; tar tzf "$STAGE/data.tar.gz" | wc -l
echo "-- 关键文件:"; tar tzf "$STAGE/data.tar.gz" | grep -E './www/glass/(index.html|build.txt)|./www/glass/assets/index-.*\.js|rpc/glass|zz-glass.conf'
echo "-- sha256:"; sha256sum "$OUT" 2>/dev/null || certutil -hashfile "$OUT" SHA256 | sed -n 2p
