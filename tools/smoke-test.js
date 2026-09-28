// 冒烟测试:在 Electron 里加载游戏,捕获报错并验证核心状态可用。
// 用法: npx electron tools/smoke-test.js
const { app, BrowserWindow } = require('electron');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
let failures = [];
const log = (ok, msg) => {
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${msg}`);
  if (!ok) failures.push(msg);
};

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });

  const consoleErrors = [];
  win.webContents.on('console-message', (e) => {
    const lvl = e.level;
    const msg = e.message || '';
    if (lvl === 'error' || lvl === 3) consoleErrors.push(msg);
    // 把游戏内自己的错误横幅也抓出来
    if (/Uncaught|TypeError|ReferenceError|is not a function/.test(msg)) {
      consoleErrors.push(msg);
    }
  });
  win.webContents.on('did-fail-load', (e, code, desc) => {
    consoleErrors.push(`did-fail-load ${code}: ${desc}`);
  });

  await win.loadFile(path.join(ROOT, 'index.html'));
  // 给游戏一点初始化时间
  await new Promise((r) => setTimeout(r, 1500));

  const result = await win.webContents.executeJavaScript(`
    (() => {
      const out = {};
      const c = document.getElementById('game');
      out.hasCanvas = !!c;
      out.canvasW = c ? c.width : 0;
      out.canvasH = c ? c.height : 0;
      out.canvasInDOM = !!(c && document.body.contains(c));

      // canvas 真的有被绘制过(不是全黑) -> 证明主循环在跑
      if (c) {
        try {
          const g = c.getContext('2d');
          const d = g.getImageData(0, 0, c.width, c.height).data;
          let nonEmpty = 0;
          for (let i = 3; i < d.length; i += 4 * 997) if (d[i] > 0) nonEmpty++;
          out.paintedSamples = nonEmpty;
        } catch (e) { out.paintErr = String(e); }
      }

      // 主菜单可见
      const menu = document.getElementById('menu');
      out.menuVisible = !!(menu && !menu.classList.contains('hidden'));
      out.title = document.querySelector('.title')?.textContent || '';

      // 启动按钮存在
      out.hasStartBtn = !!document.getElementById('start-btn');

      // localStorage 可用 (Steam 云存档问题的基础)
      try {
        localStorage.setItem('__smoke__', '1');
        out.localStorageOK = localStorage.getItem('__smoke__') === '1';
        localStorage.removeItem('__smoke__');
      } catch (e) { out.localStorageOK = false; }

      // 游戏的 meta 存储接口存在
      out.metaSaveKeyPresent = !!localStorage.getItem('abyss_meta_v1');

      // 错误横幅
      out.errBanner = !!document.getElementById('err-bar');

      return out;
    })()
  `);

  console.log('\n=== 加载与渲染 ===');
  log(result.hasCanvas, 'canvas 元素存在');
  log(result.canvasW === 1280 && result.canvasH === 720, `canvas 尺寸 1280x720 (实际 ${result.canvasW}x${result.canvasH})`);
  log(result.canvasInDOM, 'canvas 在 DOM 中');
  log(!result.paintErr, '可读取像素 (未开启跨域污染)');
  log(result.paintedSamples > 0, `主循环已绘制 (采样命中 ${result.paintedSamples} 处)`);

  console.log('\n=== 界面 ===');
  log(result.menuVisible, '主菜单可见');
  log(result.title.includes('深渊'), `标题正确: "${result.title}"`);
  log(result.hasStartBtn, '开始按钮存在');

  console.log('\n=== 存档 ===');
  log(result.localStorageOK, 'localStorage 可读写');

  console.log('\n=== 控制台 ===');
  log(consoleErrors.length === 0, `无 JS 报错${consoleErrors.length ? ': ' + consoleErrors.slice(0, 5).join(' | ') : ''}`);
  log(!result.errBanner, '游戏内无运行错误横幅');

  console.log('\n' + (failures.length ? `❌ ${failures.length} 项失败` : '✅ 全部通过'));
  app.exit(failures.length ? 1 : 0);
});

app.on('window-all-closed', () => {});
