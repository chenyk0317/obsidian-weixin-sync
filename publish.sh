#!/usr/bin/env bash
# Weixin Sync 全流程一键发布脚本
# 本脚本位于插件开发目录 weixin-sync-plugin/——它既用于开发，也直接作为发布源，
# 自身就是独立 git 仓库（remote 指向 GitHub 上的 chenyk0317/obsidian-weixin-sync）。
# 无需再克隆到临时目录或维护额外的发布副本目录。
#
# 用法：
#   bash publish.sh            # 版本号默认取 manifest.json
#   bash publish.sh 1.0.2      # 传入版本号：先改 manifest.json 的 version，再走全流程
#
# 全流程：构建(npm install + build) → 拷贝 main.js 到本目录 → git 提交 → 推送 GitHub → 打 Release
# 兼容首次发布（自动处理与远程历史分叉）与后续迭代（跳过已存在的 Release）。
# 远程仓库固定为 chenyk0317/obsidian-weixin-sync（GitHub 上的仓库名，与本地目录名不同是正常的）。
#
# 前置：本机已安装 Git、Node.js(npm)、python3、gh（已登录）。脚本会用 gh 自动创建带附件的 GitHub Release。
set -uo pipefail

# ---------- 路径 ----------
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"   # = weixin-sync-plugin
REPO="chenyk0317/obsidian-weixin-sync"

# ---------- 0. 前置检查 ----------
if ! command -v git >/dev/null 2>&1; then
  echo "❌ 未检测到 git，请先安装 Git"
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "❌ 未检测到 npm，请先安装 Node.js"
  exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "❌ 未检测到 python3（用于更新 versions.json），请先安装"
  exit 1
fi
if ! command -v gh >/dev/null 2>&1; then
  echo "❌ 未检测到 gh（用于自动创建带附件的 GitHub Release），请先执行：brew install gh && gh auth login"
  exit 1
fi
gh auth status >/dev/null 2>&1 || { echo "❌ 请先登录 GitHub：gh auth login"; exit 1; }

read_version() { grep -oE '"version"[[:space:]]*:[[:space:]]*"[0-9]+\.[0-9]+\.[0-9]+"' "$1" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+'; }

# ---------- 1. 确定版本号 ----------
if [ -n "${1:-}" ]; then
  VERSION="$1"
  if ! echo "${VERSION}" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
    echo "❌ 版本号格式错误：应为 X.Y.Z（如 1.0.2）"
    exit 1
  fi
  echo "📦 传入版本：${VERSION} —— 先更新 manifest.json / package.json 与 versions.json"
  for pf in "$SCRIPT_DIR/manifest.json" "$SCRIPT_DIR/package.json"; do
    sed -i.bak -E "s/(\"version\"[[:space:]]*:[[:space:]]*\")[0-9]+\.[0-9]+\.[0-9]+(\")/\1${VERSION}\2/" "$pf"
    rm -f "$pf.bak"
  done
  for vf in "$SCRIPT_DIR/versions.json"; do
    python3 - "$vf" "${VERSION}" <<'PY'
import json, sys
f, ver = sys.argv[1], sys.argv[2]
d = json.load(open(f, encoding="utf-8"))
if ver not in d:
    last_key = sorted(d)[-1]
    d[ver] = d[last_key]
    json.dump(d, open(f, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"✅ {f} 追加版本 {ver} -> minAppVersion {d[ver]}")
else:
    print(f"ℹ️  {f} 已有版本 {ver}，跳过")
PY
  done
else
  VERSION="$(read_version "$SCRIPT_DIR/manifest.json")"
  if [ -z "${VERSION:-}" ]; then
    echo "❌ 无法从 manifest.json 读取版本号，请传入版本号参数，或检查 manifest.json"
    exit 1
  fi
  echo "📦 版本号取自 manifest.json：${VERSION}"
fi

# ---------- 2. 生产构建 ----------
echo "🔨 构建插件（npm install + npm run build）..."
( cd "$SCRIPT_DIR" && npm install >/dev/null 2>&1; npm run build ) || { echo "❌ 构建失败，已中止"; exit 1; }
echo "✅ 构建完成"

# ---------- 3. 拷贝 main.js 到发布根目录 ----------
# esbuild 默认把 main.js 输出到本地测试 vault 的插件目录；发布需要它在仓库根目录。
MAIN_JS_SRC="$SCRIPT_DIR/weixin-sync-test-vault/.obsidian/plugins/weixin-sync/main.js"
[ -f "$MAIN_JS_SRC" ] || { echo "❌ 未找到构建产物 main.js：$MAIN_JS_SRC（请确认 npm run build 已生成）"; exit 1; }
cp "$MAIN_JS_SRC" "$SCRIPT_DIR/main.js"
echo "✅ 已更新根目录 main.js（版本：$(read_version "$SCRIPT_DIR/manifest.json")）"

# ---------- 4. 确保本目录是独立 git 仓库并关联远程 ----------
if [ ! -d "$SCRIPT_DIR/.git" ]; then
  echo "🔧 初始化本地 git 仓库..."
  git init -q "$SCRIPT_DIR"
fi
if ! git -C "$SCRIPT_DIR" remote get-url origin >/dev/null 2>&1; then
  git -C "$SCRIPT_DIR" remote add origin "https://github.com/${REPO}.git"
  echo "🔗 已关联远程：${REPO}"
fi

# ---------- 5. Git 提交（在发布目录内）----------
cd "$SCRIPT_DIR" || exit 1
git add -A
if git diff --cached --quiet; then
  echo "ℹ️  无待提交变更"
else
  git commit -q -m "Release v${VERSION}: Weixin Sync"
  echo "✅ 已提交 v${VERSION}"
fi

# ---------- 6. 推送（兼容首次/历史分叉，失败自动重试）----------
CUR_BRANCH="$(git branch --show-current 2>/dev/null || echo master)"
push_branch() {
  local b="$1"
  if git push -u origin "$b" 2>/dev/null; then
    echo "✅ 已推送 $b"; return 0
  fi
  echo "⚠️  普通推送被拒（本地落后于远程），尝试 git pull --rebase 后重试..."
  if git pull --rebase origin "$b" 2>/dev/null && git push -u origin "$b" 2>/dev/null; then
    echo "✅ 已 rebase 并重推成功"; return 0
  fi
  echo "⚠️  本地与远程历史分叉（可能首次从不同源发布），改用 --force-with-lease 覆盖你自己的仓库..."
  if git push -u origin "$b" --force-with-lease 2>/dev/null; then
    echo "✅ 已强制更新 $b（仅影响你自己的 fork/仓库，不影响他人）"; return 0
  fi
  echo "❌ push 仍失败，请手动处理"; return 1
}
push_branch "$CUR_BRANCH"

# ---------- 7. 打 Tag + 创建带附件的 Release（已存在则跳过）----------
TAG="v${VERSION}"
# 先确保 git tag 存在（纯 git 兜底；若 gh 失败也可仅凭 tag 重建 Release）
if git rev-parse "${TAG}" >/dev/null 2>&1; then
  echo "ℹ️  Tag ${TAG} 已存在，跳过（如需覆盖请先删除本地与远程 tag 后重跑）"
else
  git tag -a "${TAG}" -m "Release v${VERSION}: Weixin Sync"
  git push origin --tags
  echo "✅ 已创建并推送 Tag ${TAG}"
fi
# 用 gh 创建带附件的 GitHub Release（Obsidian 社区目录正是从这些附件读取插件文件）
if gh release view "${TAG}" >/dev/null 2>&1; then
  echo "ℹ️  Release ${TAG} 已存在，跳过（如需覆盖请先执行：gh release delete ${TAG}）"
else
  gh release create "${TAG}" --title "v${VERSION}" --notes "Weixin Sync v${VERSION}" \
    manifest.json main.js styles.css versions.json \
    && echo "✅ 已创建 Release ${TAG}（含 4 个发布附件）"
fi

# ---------- 8. 社区后台提交指引 ----------
SUBMIT_URL="https://community.obsidian.md"
echo ""
echo "🚀 GitHub 仓库、Tag 与 Release ${TAG} 已就绪（含 4 个附件：manifest.json / main.js / styles.css / versions.json）。"
echo "   （Obsidian 社区目录正是从这些 Release 附件读取插件文件）"
echo ""
echo "   如需在网页端核对或重建 Release：打开 https://github.com/${REPO}/releases/new?tag=${TAG} ，"
echo "   标题填 v${VERSION}，把上面四个文件作为附件上传，点 Publish release。"
echo ""
echo "   随后到 Obsidian 社区目录提交/更新插件："
echo "   1) 打开 ${SUBMIT_URL} 并用你的 Obsidian 账号登录"
echo "   2) 在个人资料里绑定 GitHub 账号：chenyk0317"
echo "   3) 开发者后台 → 你的插件下会出现新版本 ${VERSION}，点击 Review / 重新审核"
echo ""
echo "   插件 ID：weixin-sync"
echo "   仓库：${REPO}（GitHub 仓库名，对应本地开发目录 weixin-sync-plugin）"
echo "   版本：${VERSION}"
echo "   注意：manifest 的 description 不能包含 'Obsidian' 字样（官方自动审核规则）"
echo ""
if command -v open >/dev/null 2>&1; then
  open "${SUBMIT_URL}" >/dev/null 2>&1 && echo "ℹ️  已尝试打开社区目录"
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "${SUBMIT_URL}" >/dev/null 2>&1 && echo "ℹ️  已尝试打开社区目录"
fi
echo "🎉 脚本执行完毕"
