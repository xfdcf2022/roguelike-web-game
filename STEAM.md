# 深渊生存者 · Steam 上架指南

**AppID:** `5327410`
**Steamworks 后台:** https://partner.steamgames.com/apps/5327410

网页游戏不能直接上传 Steam —— Steam 只运行平台原生可执行文件。本项目已用
**Electron** 把网页游戏封装成桌面应用,打包产物即为可直接上传的 depot 内容。

---

## 一、当前状态

| 项目 | 状态 |
|---|---|
| Electron 外壳 | ✅ `main.js` |
| Windows x64 构建 | ✅ `dist/win-unpacked/`(241 MB) |
| macOS x64/arm64 构建 | ✅ `dist/mac/`、`dist/mac-arm64/` |
| 图标 (png/ico/icns) | ✅ `build/` |
| 自动化测试 | ✅ `npm test`(12 项冒烟 + 12 项玩法) |
| SteamPipe 上传脚本 | ✅ `steam/upload.sh` |
| **Depot ID** | ⬜ **需你填写** —— 见下 |

---

## 二、必做:填写 Depot ID

SteamPipe 按 **Depot** 分发,一个平台一个 Depot。**AppID 已知,但 Depot ID 只有你自己能看到。**

1. 打开 https://partner.steamgames.com/apps/5327410/edit/depots
2. 若还没有 Depot,点 **"添加新 Depot"**,平台分别选 **Windows / macOS / Linux**
3. 点进每个 Depot,网址末尾的数字就是 Depot ID
   （例:`.../depots/5327411` → `DepotID = 5327411`)
4. 编辑 `steam/depot_ids.env`:

```bash
APP_ID=5327410
DEPOT_WINDOWS=5327411    # ← 换成你实际的
DEPOT_MAC=5327412
DEPOT_LINUX=5327413
```

> 惯例上第一个 Depot 常常是 `AppID+1`,但**不要假设**,照后台抄。

### 可执行文件名(必须逐字一致)

在 Steamworks Depot 设置里的「可执行文件名」填:

| 平台 | 值 |
|---|---|
| Windows | `深渊生存者.exe` |
| macOS | `深渊生存者.app` |
| Linux | `Abyss Survivor` |

「启动选项」留空。**填错会导致 Steam 报"缺少可执行文件"。**

---

## 三、上传

```bash
# 1. 安装 steamcmd
brew install steamcmd

# 2. 填好 depot_ids.env 后,构建并收集产物
./steam/upload.sh win      # 或 mac / linux / all

# 3. 推送
$(brew --prefix)/opt/steamcmd/steamcmd.sh \
  +login <你的Steam账号> \
  +run_app_build ./steam_build/scripts/app_build.vdf \
  +quit
```

首次上传全量,之后只传差异,很快。

上传完成后:
- 后台确认新构建出现在 **default 分支**
- 用 Steam 客户端下载测试(构建编号应显示为 `1`)

---

## 四、商店页素材

| 素材 | 尺寸 |
|---|---|
| 主视觉胶囊 | 616 × 353 |
| 头图 | 460 × 215 |
| 小胶囊 | 231 × 174 |
| 竖版胶囊 | 374 × 448 |
| 库英雄图 | 3840 × 1240 |
| 库 Logo(透明 PNG) | 1280 × 720 |
| 截图 | ≥ 5 张,1920 × 1080 |
| 预告片 | YouTube,≥ 1280 × 720 |

还必须填写**内容问卷**(暴力/血腥等),影响年龄分级与商店标签。

---

## 五、⚠️ 已知限制:存档不上云

游戏用 `localStorage` 存金币与永久升级(`abyss_meta_v1`)。
**这不是 Steam Cloud** —— 玩家换电脑进度会丢。

要接 Steam 云需在 Electron 里接 Steamworks SDK 的 UFS API,把
`localStorage` 读写改成 `SteamUserStats` 文件读写。首发可以先不管,
后续版本再补。

---

## 六、开发

```bash
npm install
npm start            # 本地运行
npm test             # 自动化测试
npm run dist:win     # 打包 Windows
npm run dist:mac     # 打包 macOS
```

### 项目结构

```
main.js              Electron 主进程(窗口/全屏/导航锁定)
index.html           游戏入口
game.js              游戏逻辑
style.css            样式
build/               图标源文件
tools/
  icon.svg           图标矢量源
  smoke-test.js      加载/渲染/存档测试
  play-test.js       实际开局/输入/暂停/存档测试
steam/
  upload.sh          构建 + 生成 VDF + 推送
  depot_ids.env      ← 填你的 Depot ID
```

图标改 `tools/icon.svg` 后重新生成:

```bash
rsvg-convert -w 1024 -h 1024 tools/icon.svg -o build/icon.png
# .icns / .ico 生成见 README 备注
```
