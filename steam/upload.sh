#!/usr/bin/env bash
# ============================================================
# 深渊生存者 · Steam 上传脚本
# 用法:  ./steam/upload.sh [win|mac|linux|all]
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$SCRIPT_DIR/depot_ids.env"
STEAM_BUILD="$ROOT/steam_build"

die() { echo "❌ $*" >&2; exit 1; }
info() { echo "→ $*"; }

# ---------- 1. 读取配置 ----------
[ -f "$ENV_FILE" ] || die "缺少 $ENV_FILE,请复制 depot_ids.env 并填写"
# shellcheck disable=SC1090
source "$ENV_FILE"

: "${APP_ID:?APP_ID 未设置}"
case "$APP_ID" in
  ''|*[!0-9]*) die "APP_ID 必须是数字,当前: '$APP_ID'" ;;
esac

TARGET="${1:-all}"
case "$TARGET" in
  win|mac|linux|all) ;;
  *) die "用法: $0 [win|mac|linux|all]" ;;
esac

# ---------- 2. 分发可执行文件名 ----------
# 这些必须与 Steamworks 后台 Depot 里填的"可执行文件名"逐字一致,
# 也必须与打包产物里的实际文件名一致。
EXE_WIN="深渊生存者.exe"
EXE_MAC="深渊生存者.app"
EXE_LINUX="Abyss Survivor"

deps_for() {
  case "$1" in
    win)   echo "DEPOT_WINDOWS" ;;
    mac)   echo "DEPOT_MAC" ;;
    linux) echo "DEPOT_LINUX" ;;
  esac
}

# ---------- 3. 构建 ----------
build_target() {
  local plat="$1"
  info "构建 $plat ..."
  ( cd "$ROOT" && npx electron-builder --"$plat" )
}

# ---------- 4. 收集产物到 steam_build/content/<plat> ----------
# 关键:depot 根目录下必须直接就是可执行文件,不能多套一层目录,
# 否则 Steam 报"缺少可执行文件"。
stage() {
  local plat="$1"
  local src dest
  dest="$STEAM_BUILD/content/$plat"
  rm -rf "$dest"; mkdir -p "$dest"

  case "$plat" in
    win)
      src="$ROOT/dist/win-unpacked"
      [ -d "$src" ] || die "找不到 $src,请先构建"
      cp -R "$src/." "$dest/"
      ;;
    mac)
      src="$ROOT/dist/mac"
      [ -d "$src" ] || die "找不到 $src,请先构建"
      # 拷贝 .app 本体及其内容
      cp -R "$src/$EXE_MAC" "$dest/"
      ;;
    linux)
      src="$ROOT/dist/linux-unpacked"
      [ -d "$src" ] || die "找不到 $src,请先构建"
      cp -R "$src/." "$dest/"
      ;;
  esac

  # 清理不该进 depot 的文件
  find "$dest" -name '.DS_Store'   -delete 2>/dev/null || true
  find "$dest" -name '__MACOSX'   -type d -prune -exec rm -rf {} + 2>/dev/null || true
  find "$dest" -name '*.pdb'      -delete 2>/dev/null || true
  find "$dest" -name '*.map'      -delete 2>/dev/null || true
  find "$dest" -name '*.log'      -delete 2>/dev/null || true

  # 校验可执行文件真的在 depot 根目录
  local exe
  case "$plat" in
    mac)   exe="$dest/$EXE_MAC" ;;
    linux) exe="$dest/$EXE_LINUX" ;;
    *)     exe="$dest/$EXE_WIN" ;;
  esac
  [ -e "$exe" ] || die "校验失败: depot 根目录缺少 $exe"
  info "已就绪: $exe"
}

# ---------- 5. 生成 VDF ----------
gen_vdf() {
  local plat="$1"
  local var depot_id
  var="$(deps_for "$plat")"
  depot_id="${!var:-}"

  if [ -z "$depot_id" ]; then
    echo "⚠️  跳过 $plat:$var 未填写 (在 $ENV_FILE 里补上后再跑)" >&2
    return 1
  fi
  case "$depot_id" in
    ''|*[!0-9]*) die "$var 必须是数字,当前: '$depot_id'" ;;
  esac

  local scripts="$STEAM_BUILD/scripts"
  mkdir -p "$scripts"
  cat > "$scripts/depot_$plat.vdf" <<EOF
"DepotBuildConfig"
{
	"DepotID" "$depot_id"
	"ContentRoot" "$STEAM_BUILD/content/$plat"
	"FileMapping" "LocalPath" "*" "DepotPath" "."
	"FileExclusion" "*.pdb" "*" "*.map" "*" "*.DS_Store" "*" "*.log"
}
EOF
  info "生成 depot_$plat.vdf (DepotID $depot_id)"
}

gen_app_build() {
  local scripts="$STEAM_BUILD/scripts"
  mkdir -p "$scripts" "$STEAM_BUILD/output"

  {
    echo '"appbuild"'
    echo '{'
    echo "	\"appid\" \"$APP_ID\""
    echo "	\"desc\" \"深渊生存者 v$(node -p "require('$ROOT/package.json').version")\""
    echo "	\"buildoutput\" \"$STEAM_BUILD/output\""
    echo "	\"contentroot\" \"$STEAM_BUILD/content\""
    echo '	"setlive" ""'
    echo '	"preview" "1"'
    echo '	"depots"'
    echo '	{'
    local first=1 v
    for v in DEPOT_WINDOWS DEPOT_MAC DEPOT_LINUX; do
      local d="${!v:-}"
      local plat
      case "$v" in
        DEPOT_WINDOWS) plat=win ;;
        DEPOT_MAC)     plat=mac ;;
        DEPOT_LINUX)   plat=linux ;;
      esac
      [ -n "$d" ] || continue
      [ "$first" -eq 1 ] || echo '		,'
      first=0
      printf '\t\t"%s" "%s/depot_%s.vdf"' "$d" "$scripts" "$plat"
    done
    echo ''
    echo '	}'
    echo '}'
  } > "$scripts/app_build.vdf"

  info "生成 app_build.vdf"
}

# ---------- 6. 主流程 ----------
PLATS=()
case "$TARGET" in
  all) PLATS=(win linux) ;;   # macOS 构建需在 mac 上跑
  *)   PLATS=("$TARGET") ;;
esac

for p in "${PLATS[@]}"; do
  build_target "$p"
  stage "$p"
  gen_vdf "$p" || true
done

gen_app_build

echo
info "Steam 构建脚本已生成于 $STEAM_BUILD/scripts"
echo
cat <<'EOF'
下一步 —— 推送内容到 Steam:

  1. 安装 steamcmd
     macOS:  brew install steamcmd
     然后:   $(brew --prefix)/opt/steamcmd/steamcmd.sh

  2. 登录 (会提示输账号密码;开了 Steam Guard 需输入验证码)
     steamcmd +login <你的Steam账号>

  3. 上传
     steamcmd +login <你的Steam账号> \
       +run_app_build ./steam_build/scripts/app_build.vdf \
       +quit

  4. 上传完成后去后台设置"启动选项"为空,并把构建设为 default 分支

EOF
