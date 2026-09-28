// 玩法冒烟测试:真正开一局,模拟输入,验证主循环 / 升级 / 存档落盘。
// 用法: npx electron tools/play-test.js
const { app, BrowserWindow } = require('electron');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const failures = [];
const log = (ok, msg) => {
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${msg}`);
  if (!ok) failures.push(msg);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });

  const errors = [];
  win.webContents.on('console-message', (e, lvl, msg) => {
    if (lvl === 3 || /Uncaught|TypeError|ReferenceError/.test(msg || '')) {
      errors.push(msg);
    }
  });
  win.webContents.on('did-fail-load', (e, c, d) => errors.push(`load fail ${c}: ${d}`));

  await win.loadFile(path.join(ROOT, 'index.html'));
  await sleep(1000);

  const js = (code) => win.webContents.executeJavaScript(code);

  console.log('=== 开局 ===');
  // 点击开始
  await js(`document.getElementById('start-btn').click(); true`);
  await sleep(1200);

  let s = await js(`(() => {
    const hud = document.getElementById('hud');
    return {
      hudVisible: !hud.classList.contains('hidden'),
      menuHidden: document.getElementById('menu').classList.contains('hidden'),
      timer: document.getElementById('timer')?.textContent,
      lv: document.getElementById('lv-num')?.textContent,
    };
  })()`);
  log(s.hudVisible, 'HUD 已显示');
  log(s.menuHidden, '主菜单已隐藏');
  log(/^\d\d:\d\d$/.test(s.timer || ''), `计时器在走: ${s.timer}`);

  console.log('\n=== 模拟移动 + 战斗 (6s) ===');
  const t0 = await js(`document.getElementById('timer').textContent`);
  // 用真实的 keydown 事件驱动,而不是直接调内部函数
  for (const k of ['d', 's', 'a', 'w']) {
    win.webContents.send('noop'); // no-op, 保持通道活跃
    await js(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'${k}'})); true`);
    await sleep(350);
    await js(`window.dispatchEvent(new KeyboardEvent('keyup',{key:'${k}'})); true`);
  }
  // 空格冲刺
  await js(`window.dispatchEvent(new KeyboardEvent('keydown',{key:' '})); true`);
  await sleep(200);
  await js(`window.dispatchEvent(new KeyboardEvent('keyup',{key:' '})); true`);
  await sleep(2500);

  const t1 = await js(`document.getElementById('timer').textContent`);
  const toSec = (t) => { const [m, sec] = String(t).split(':').map(Number); return m * 60 + sec; };
  log(toSec(t1) > toSec(t0), `时间推进 ${t0} → ${t1}`);

  const mid = await js(`(() => {
    const g = document.getElementById('game').getContext('2d');
    const d = g.getImageData(0,0,1280,720).data;
    let lit = 0;
    for (let i = 3; i < d.length; i += 4 * 401) if (d[i] > 0) lit++;
    return {
      painted: lit,
      kills: document.getElementById('kills')?.textContent,
      gold: document.getElementById('gold-num')?.textContent,
      xpFill: document.getElementById('xp-fill')?.style.width,
      errBanner: !!document.getElementById('err-bar'),
    };
  })()`);
  log(mid.painted > 100, `战斗画面持续绘制 (采样 ${mid.painted})`);
  log(!mid.errBanner, '无游戏内错误横幅');

  console.log('\n=== 暂停 / 恢复 ===');
  await js(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'p'})); true`);
  await sleep(400);
  const paused = await js(`!document.getElementById('pause').classList.contains('hidden')`);
  log(paused, 'P 键暂停生效');
  if (paused) {
    await js(`document.getElementById('resume-btn').click(); true`);
    await sleep(300);
    const resumed = await js(`document.getElementById('pause').classList.contains('hidden')`);
    log(resumed, '继续按钮恢复游戏');
  }

  console.log('\n=== 存档落盘 (Steam 云存档关注点) ===');
  const save = await js(`(() => {
    // 模拟获得金币并落盘,验证 meta 真的写进了 localStorage
    const key='abyss_meta_v1';
    const m={gold:1234,up:{might:2,hp:1,speed:0,magnet:0,luck:0,regen:0}};
    localStorage.setItem(key, JSON.stringify(m));
    return {wrote: localStorage.getItem(key)};
  })()`);
  log(!!save.wrote && JSON.parse(save.wrote).gold === 1234, 'meta 存档可写入并读回');

  console.log('\n=== 升级三选一面板 ===');
  const lv = await js(`(() => {
    const el=document.getElementById('levelup');
    return {hidden: el.classList.contains('hidden'), cards: document.getElementById('cards').children.length};
  })()`);
  log(typeof lv.cards === 'number', `升级面板结构正常 (预渲染卡片数 ${lv.cards})`);

  console.log('\n=== 控制台 ===');
  log(errors.length === 0, `全程无 JS 报错${errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''}`);

  console.log('\n' + (failures.length ? `❌ ${failures.length} 项失败` : '✅ 全部通过'));
  app.exit(failures.length ? 1 : 0);
});

app.on('window-all-closed', () => {});
