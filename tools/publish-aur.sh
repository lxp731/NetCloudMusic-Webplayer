#!/usr/bin/env bash
# 发布到 AUR：把 aur/PKGBUILD 和 aur/.SRCINFO 的 pkgver / sha256sums 更新为本次
# 发版的版本和已构建 .pacman 的真实校验和，然后推送到 aur.archlinux.org。
#
# 用法（CI 内调用，SSH 私钥已由 workflow 配置到 ~/.ssh/id_aur）：
#   tools/publish-aur.sh <version> <pacman-file>
set -euo pipefail

VERSION="${1:?usage: publish-aur.sh <version> <pacman-file>}"
PACMAN_FILE="${2:?}"
AUR_REPO="ssh://aur@aur.archlinux.org/netcloud-music-bin.git"

cd "$(dirname "$0")/.."

SHA=$(sha256sum "$PACMAN_FILE" | awk '{print $1}')
echo ">> 版本 $VERSION  sha256 $SHA"

# 更新 PKGBUILD / .SRCINFO 的版本与校验和（.SRCINFO 里 source 的版本号一并替换）
python3 - "$VERSION" "$SHA" <<'PY'
import sys, re
version, sha = sys.argv[1], sys.argv[2]

p = 'aur/PKGBUILD'
s = open(p).read()
old = re.search(r'^pkgver=(.*)$', s, re.M).group(1).strip()
s = re.sub(r'^pkgver=.*$', f'pkgver={version}', s, flags=re.M)
s = re.sub(r"^sha256sums=\(.*\)$", f"sha256sums=('{sha}')", s, flags=re.M)
open(p, 'w').write(s)

p = 'aur/.SRCINFO'
s = open(p).read()
s = re.sub(r'^(\tpkgver = ).*$', rf'\g<1>{version}', s, flags=re.M)
s = re.sub(r'^(\tsha256sums = ).*$', rf'\g<1>{sha}', s, flags=re.M)
s = s.replace(old, version)
open(p, 'w').write(s)
print(f'>> bumped {old} -> {version}')
PY

# 只允许用 AUR 专用私钥认证，避免误用其它 key
export GIT_SSH_COMMAND="ssh -i $HOME/.ssh/id_aur -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo ">> clone $AUR_REPO"
if ! git clone --depth 1 "$AUR_REPO" "$TMP/aur" 2>/dev/null; then
  echo "::error::AUR 仓库不存在。首次发布需先在 https://aur.archlinux.org/packages/netcloud-music-bin 手动 Submit 一次（上传 aur/PKGBUILD），之后 CI 即可自动更新。"
  exit 1
fi

cp aur/PKGBUILD aur/.SRCINFO "$TMP/aur/"
cd "$TMP/aur"
git config user.name "netcloud-music CI"
git config user.email "liuxiaopeng731@gmail.com"
git add PKGBUILD .SRCINFO
if git commit -m "upgpkg: netcloud-music-bin ${VERSION}"; then
  git push
  echo ">> 已推送到 AUR"
else
  echo ">> 无变更，跳过推送"
fi
