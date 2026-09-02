'use strict';
/* ============================================================
 *  深渊生存者 · Abyss Survivor
 *  类吸血鬼幸存者的自动攻击生存 Roguelike:
 *  - 移动躲避 / 武器全自动攻击 / 拾取魂晶升级三选一
 *  - 5 种武器 + 6 种被动 + 5 场 Boss 战, 10 分钟斩杀深渊君主
 *  - 全程序化矢量美术: 角色动画 / 粒子 / 光效 / 震屏
 * ============================================================ */

/* ---------------- 基础工具 ---------------- */
const TAU = Math.PI * 2;
const W = 1280, H = 720;
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const dist2 = (ax, ay, bx, by) => (ax - bx) ** 2 + (ay - by) ** 2;
const fmtTime = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/* 确定性随机(用于地纹块生成) */
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/* ---------------- 音效合成器 ---------------- */
let actx = null, muted = false;
function initAudio() {
  if (actx || typeof AudioContext === 'undefined') return;
  try { actx = new AudioContext(); } catch (e) { /* 忽略 */ }
}
function tone(f0, f1, dur, vol, type = 'sine', delay = 0) {
  if (!actx || muted) return;
  const t = actx.currentTime + delay;
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(actx.destination);
  o.start(t); o.stop(t + dur + 0.02);
}
const SFX = {
  shoot:  () => tone(680, 240, 0.07, 0.035, 'square'),
  fire:   () => tone(220, 80, 0.14, 0.045, 'sawtooth'),
  zap:    () => { tone(1400, 120, 0.16, 0.05, 'square'); tone(300, 60, 0.2, 0.04, 'sawtooth'); },
  hit:    () => tone(180, 70, 0.05, 0.05, 'triangle'),
  kill:   () => tone(320 * (1 + Math.min(game.combo, 40) * 0.007), 40, 0.16, 0.06, 'sawtooth'), // 连击越高音调越亮
  windup: () => tone(170, 340, 0.2, 0.04, 'square'),
  gem:    c => tone(620 + Math.min(c, 20) * 40, 940 + Math.min(c, 20) * 40, 0.06, 0.045, 'sine'),
  heal:   () => tone(420, 900, 0.22, 0.06, 'sine'),
  hurt:   () => { tone(130, 50, 0.28, 0.12, 'sawtooth'); tone(90, 40, 0.3, 0.08, 'square'); },
  levelup() { [523, 659, 784, 1047].forEach((f, i) => tone(f, f, 0.14, 0.07, 'sine', i * 0.09)); },
  choose: () => tone(500, 760, 0.1, 0.06, 'triangle'),
  crit:   () => { tone(880, 1320, 0.08, 0.045, 'square'); tone(1760, 880, 0.1, 0.028, 'sine', 0.02); },
  bossDie() { tone(180, 30, 0.9, 0.16, 'sawtooth'); [523, 659, 784, 1047].forEach((f, i) => tone(f, f, 0.2, 0.06, 'sine', 0.25 + i * 0.12)); },
  shock:  () => { tone(150, 60, 0.3, 0.08, 'sawtooth'); tone(700, 120, 0.25, 0.05, 'square', 0.02); },
  evo()   { [392, 523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, f, 0.22, 0.075, 'sine', i * 0.1)); tone(80, 200, 0.5, 0.09, 'sawtooth', 0.1); },
  heart:  () => { tone(75, 48, 0.09, 0.11, 'sine'); tone(58, 40, 0.12, 0.085, 'sine', 0.16); },
  nova:   () => { tone(340, 90, 0.26, 0.06, 'sine'); tone(1250, 420, 0.16, 0.028, 'triangle', 0.02); },
  coin:   () => tone(1080, 1620, 0.07, 0.042, 'triangle'),
  rage:   () => { tone(90, 200, 0.5, 0.14, 'sawtooth'); tone(220, 90, 0.4, 0.08, 'square', 0.12); },
  warn:   () => { tone(160, 120, 0.5, 0.1, 'sawtooth'); tone(160, 120, 0.5, 0.1, 'sawtooth', 0.65); },
  dash:   () => { tone(300, 720, 0.13, 0.05, 'sine'); },
  guard:  () => { tone(196, 392, 0.4, 0.09, 'sine'); tone(392, 784, 0.5, 0.07, 'sine', 0.1); tone(70, 150, 0.4, 0.11, 'sawtooth'); },
  chest:  () => { tone(523, 659, 0.12, 0.06, 'square'); tone(659, 988, 0.22, 0.06, 'square', 0.11); },
  block:  () => { tone(300, 90, 0.14, 0.09, 'square'); tone(920, 480, 0.1, 0.04, 'triangle', 0.02); }, // 魔盾格挡: 清脆碎裂音
  shieldUp: () => tone(360, 760, 0.18, 0.045, 'sine'),               // 魔盾重铸: 上扬微音
  boss:   () => { tone(70, 28, 0.9, 0.16, 'sawtooth'); tone(140, 55, 0.7, 0.1, 'square', 0.1); },
  win()   { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, f, 0.25, 0.08, 'sine', i * 0.13)); },
  dead:   () => tone(220, 30, 1.1, 0.13, 'sawtooth'),
  ult:    () => { tone(60, 24, 0.7, 0.18, 'sawtooth'); tone(200, 700, 0.45, 0.06, 'square', 0.08); tone(1200, 300, 0.3, 0.04, 'sine', 0.14); }, // 深渊爆发: 深渊轰鸣 + 紫电余韵
};

/* ---------------- SVG 图标 ---------------- */
const ICONS = {
  bolt:    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 20.5 14.5 10l-1.8-1.8L2.2 18.7z"/><path d="M15.5 2.5 17 5.9l3.5 1.4-3.5 1.5-1.5 3.4-1.5-3.4L10.5 7.3 14 5.9z"/><circle cx="18.5" cy="17.5" r="1.6"/><circle cx="13" cy="21" r="1.1"/></svg>',
  orbit:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="7.5" opacity=".55"/><circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none"/><circle cx="19.5" cy="12" r="2" fill="currentColor" stroke="none"/><circle cx="7" cy="5.7" r="1.6" fill="currentColor" stroke="none"/></svg>',
  aura:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="7" opacity=".7"/><circle cx="12" cy="12" r="10" opacity=".35"/></svg>',
  fire:    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2c3.2 4.2 6 7.2 6 11a6 6 0 0 1-12 0c0-3.8 2.8-6.8 6-11z"/><path d="M12 10c1.4 2 2.6 3.2 2.6 5a2.6 2.6 0 0 1-5.2 0c0-1.8 1.2-3 2.6-5z" fill="#0a0c12" opacity=".55"/></svg>',
  thunder: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13.5 2 4.5 13.5h5l-2.4 8.5 9.9-12h-5.4z"/></svg>',
  might:   '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.5 3.2 21 4.7l-9 9-1.5-1.5z"/><path d="M9.2 13.4l1.4 1.4-2.6 2.6 1.2 1.2-1.6 1.6-1.2-1.2-1.6 1.6L3 19l1.6-1.6-1.2-1.2 1.6-1.6 1.2 1.2z"/></svg>',
  haste:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5.2l3.4 2.2" stroke-linecap="round"/></svg>',
  swift:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M3 8h9.5a2.6 2.6 0 1 0-2.6-2.6M3 13h13.5a2.6 2.6 0 1 1-2.6 2.6M3 18h7"/></svg>',
  vitality:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21s-8.2-5.4-8.2-11.2A4.6 4.6 0 0 1 12 6.9a4.6 4.6 0 0 1 8.2 2.9C20.2 15.6 12 21 12 21z"/></svg>',
  magnet:  '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 3h5v9a2 2 0 0 0 4 0V3h5v9a7 7 0 0 1-14 0V3z"/><path d="M5 3h5v4H5zM14 3h5v4h-5z" fill="#0a0c12" opacity=".5"/></svg>',
  area:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 4H4v5M15 4h5v5M20 15v5h-5M4 15v5h5"/><rect x="9.5" y="9.5" width="5" height="5" rx="1" fill="currentColor" stroke="none"/></svg>',
  crit:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none"/><path d="M12 1.5v3.5M12 19v3.5M1.5 12H5M19 12h3.5"/></svg>',
  fury:    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13.5 2 4 13.5h5.5L8 22l10-12.5h-5.8z"/></svg>',
  greed:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4.5"/><path d="M12 3.2v9.6M9 6.8c1.8 1 5.2 1 6 0M9 10c1.8-1 5.2-1 6 0" stroke-linecap="round"/><path d="M7.5 12.5 5 21l7-3 7 3-2.5-8.5" stroke-linejoin="round"/></svg>',
  wisdom:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5c-2-1.6-5-1.6-8 0v14c3-1.6 6-1.6 8 0 2-1.6 5-1.6 8 0V5c-3-1.6-6-1.6-8 0z"/><path d="M12 5v14"/></svg>',
  thorns:  '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 22 4 8l4 1-1-5 5 3 0-6 0 6 5-3-1 5 4-1z"/></svg>',
  armor:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3 5 5.5v5c0 5 3 8.8 7 10.5 4-1.7 7-5.5 7-10.5v-5z"/><path d="M12 7v9M8.5 9.5l7 4M15.5 9.5l-7 4" stroke-linecap="round"/></svg>',
  frost:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2v20M4.2 7l15.6 10M19.8 7L4.2 17"/><path d="M12 5.5 9.8 3.6M12 5.5l2.2-1.9M12 18.5 9.8 20.4M12 18.5l2.2 1.9"/></svg>',
  vortex:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 12m-2 0a2 2 0 1 0 4 0 2 2 0 1 0 -4 0" fill="currentColor" stroke="none"/><path d="M12 4.5a7.5 7.5 0 0 1 7.5 7.5M12 19.5A7.5 7.5 0 0 1 4.5 12"/><path d="M12 8a4 4 0 0 1 4 4M12 16a4 4 0 0 1-4-4" opacity=".6"/></svg>',
  echo:   '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3.5 4.5c5 .5 9 2.8 11.8 7.2l-2.6 1.8C10.2 9.9 7.2 8.3 3.5 8z"/><path d="M4.5 3.5c.5 5 2.8 9 7.2 11.8l1.8-2.6C9.9 10.2 8.3 7.2 8 3.5z" opacity=".6"/><path d="M15 15l1.6 3.4L20 20l-3.4 1.6L15 25l-1.6-3.4L10 20l3.4-1.6z" opacity="0" transform="translate(0,-3)"/><path d="M16.5 12.5l1.2 2.6 2.6 1.2-2.6 1.2-1.2 2.6-1.2-2.6-2.6-1.2 2.6-1.2z"/></svg>',
  luck:    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 5 5.6.7-4.1 3.8 1.1 5.5-5-2.8-5 2.8 1.1-5.5L4 7.7 9.6 7z"/></svg>',
  regen:   '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/></svg>',
  spike:   '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 20l3-10 3 10zM10 20l2.5-16L15 20zM16.5 20l2.5-8 3 8z"/></svg>',
  bow:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 4c6 2.5 6 13.5 0 16"/><path d="M5 4l14 8-14 8" stroke-linejoin="round"/><path d="M5 12h14"/><path d="M19 12l-3-2.4M19 12l-3 2.4"/></svg>',
};

/* ---------------- 武器定义(每级完整数值) ---------------- */
const WEAPON_DEFS = {
  bolt: {
    name: '奥术飞弹', color: '#57e8ff', icon: 'bolt', max: 6,
    flavor: '自动追踪最近的敌人, 发射奥术光弹。',
    levels: [
      { cd: 1.05, dmg: 13, n: 1, speed: 440, pierce: 0 },
      { cd: 1.05, dmg: 18, n: 1, speed: 460, pierce: 0 },
      { cd: 0.95, dmg: 18, n: 2, speed: 460, pierce: 0 },
      { cd: 0.95, dmg: 25, n: 2, speed: 480, pierce: 1 },
      { cd: 0.85, dmg: 25, n: 3, speed: 480, pierce: 1 },
      { cd: 0.72, dmg: 34, n: 4, speed: 520, pierce: 1 },
    ],
  },
  orbit: {
    name: '守护环刃', color: '#c9d8ff', icon: 'orbit', max: 6,
    flavor: '灵刃环绕自身旋转, 撞击敌人并击碎敌方弹幕。',
    levels: [
      { n: 2, dmg: 12, r: 76, spd: 2.7 },
      { n: 3, dmg: 12, r: 80, spd: 2.7 },
      { n: 3, dmg: 18, r: 92, spd: 3.0 },
      { n: 4, dmg: 18, r: 100, spd: 3.3 },
      { n: 5, dmg: 24, r: 110, spd: 3.6 },
      { n: 6, dmg: 32, r: 122, spd: 4.0 },
    ],
  },
  aura: {
    name: '圣光领域', color: '#ffd76a', icon: 'aura', max: 6,
    flavor: '圣洁光环持续灼烧范围内的敌人。',
    levels: [
      { r: 86, dmg: 7, tick: 0.45, slow: 0 },
      { r: 98, dmg: 9, tick: 0.45, slow: 0 },
      { r: 98, dmg: 12, tick: 0.42, slow: 0.25 },
      { r: 114, dmg: 15, tick: 0.42, slow: 0.25 },
      { r: 114, dmg: 19, tick: 0.36, slow: 0.3 },
      { r: 134, dmg: 25, tick: 0.3, slow: 0.35 },
    ],
  },
  fire: {
    name: '烈焰喷涌', color: '#ff8f4d', icon: 'fire', max: 6,
    flavor: '朝最近的敌人扇形喷射火球, 可穿透。',
    levels: [
      { cd: 1.7, dmg: 18, n: 3, speed: 370, pierce: 1 },
      { cd: 1.7, dmg: 24, n: 4, speed: 370, pierce: 1 },
      { cd: 1.55, dmg: 24, n: 4, speed: 390, pierce: 2 },
      { cd: 1.55, dmg: 31, n: 5, speed: 390, pierce: 2 },
      { cd: 1.4, dmg: 31, n: 6, speed: 410, pierce: 2 },
      { cd: 1.25, dmg: 40, n: 8, speed: 430, pierce: 3 },
    ],
  },
  thunder: {
    name: '雷霆之怒', color: '#b8e8ff', icon: 'thunder', max: 6,
    flavor: '天雷随机轰击场上的敌人, 并波及周围。',
    levels: [
      { cd: 2.3, dmg: 30, n: 2, aoe: 66 },
      { cd: 2.3, dmg: 38, n: 3, aoe: 66 },
      { cd: 2.1, dmg: 38, n: 3, aoe: 80 },
      { cd: 2.1, dmg: 48, n: 4, aoe: 80 },
      { cd: 1.9, dmg: 48, n: 5, aoe: 94 },
      { cd: 1.65, dmg: 60, n: 7, aoe: 108 },
    ],
  },
  frost: {
    name: '霜寒新星', color: '#9ad8ff', icon: 'frost', max: 6,
    flavor: '寒霜在身周炸裂成新星, 冻缓范围内所有敌人。',
    levels: [
      { cd: 2.6,  dmg: 16, r: 96,  frz: 0.5 },
      { cd: 2.5,  dmg: 22, r: 108, frz: 0.55 },
      { cd: 2.4,  dmg: 28, r: 120, frz: 0.65 },
      { cd: 2.25, dmg: 36, r: 134, frz: 0.75 },
      { cd: 2.1,  dmg: 45, r: 148, frz: 0.85 },
      { cd: 1.9,  dmg: 56, r: 164, frz: 1.0 },
    ],
  },
  vortex: {
    name: '虚空漩涡', color: '#b06ef0', icon: 'vortex', max: 6,
    flavor: '撕开裂隙召唤虚空漩涡, 吸扯并绞碎其中的敌人。',
    levels: [
      { cd: 5.2,  dmg: 7,  r: 74,  dur: 2.6, pull: 60 },
      { cd: 5.0,  dmg: 9,  r: 82,  dur: 2.8, pull: 68 },
      { cd: 4.8,  dmg: 11, r: 90,  dur: 3.0, pull: 76 },
      { cd: 4.6,  dmg: 14, r: 98,  dur: 3.2, pull: 86 },
      { cd: 4.4,  dmg: 17, r: 106, dur: 3.5, pull: 96 },
      { cd: 4.0,  dmg: 21, r: 118, dur: 3.8, pull: 110 },
    ],
  },
  echo: {
    name: '回响刃', color: '#7ff2c8', icon: 'echo', max: 6,
    flavor: '掷出回旋刃, 飞出与归途皆斩敌。',
    levels: [
      { cd: 2.4,  dmg: 16, n: 1, range: 280, speed: 420 },
      { cd: 2.3,  dmg: 21, n: 1, range: 300, speed: 430 },
      { cd: 2.15, dmg: 26, n: 2, range: 320, speed: 445 },
      { cd: 2.0,  dmg: 32, n: 2, range: 340, speed: 460 },
      { cd: 1.85, dmg: 39, n: 3, range: 370, speed: 475 },
      { cd: 1.7,  dmg: 47, n: 3, range: 400, speed: 490 },
    ],
  },
  spikes: {
    name: '符文地刺', color: '#d8b06a', icon: 'spike', max: 6,
    flavor: '大地铭刻古老符文, 地刺自符阵中喷薄而出。',
    levels: [
      { cd: 3.6, dmg: 22, n: 1, r: 62,  tele: 0.55 },
      { cd: 3.4, dmg: 28, n: 1, r: 68,  tele: 0.55 },
      { cd: 3.2, dmg: 34, n: 2, r: 74,  tele: 0.5 },
      { cd: 3.0, dmg: 42, n: 2, r: 80,  tele: 0.5 },
      { cd: 2.8, dmg: 52, n: 3, r: 88,  tele: 0.45 },
      { cd: 2.6, dmg: 64, n: 3, r: 96,  tele: 0.45 },
    ],
  },
  bow: {
    name: '霜华之弓', color: '#8fd8ff', icon: 'bow', max: 6,
    flavor: '凝霜为矢, 贯穿敌阵; 飞行越远, 锋刃越凛冽。',
    levels: [
      { cd: 2.3,  dmg: 24, n: 1, speed: 620, pierce: 2, frz: 1.0 },
      { cd: 2.2,  dmg: 30, n: 1, speed: 640, pierce: 2, frz: 1.1 },
      { cd: 2.05, dmg: 37, n: 1, speed: 660, pierce: 3, frz: 1.2 },
      { cd: 1.9,  dmg: 45, n: 2, speed: 690, pierce: 3, frz: 1.3 },
      { cd: 1.75, dmg: 54, n: 2, speed: 720, pierce: 4, frz: 1.45 },
      { cd: 1.6,  dmg: 66, n: 2, speed: 760, pierce: 5, frz: 1.6 },
    ],
  },
};
/* hex 颜色 → "r,g,b" 串(rings 拼接 rgba() 用, 防无效颜色) */
const hexToRgbStr = h => {
  const n = parseInt(h.slice(1), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
};
/* 武器终极进化(Lv6 后可触发): 数值在满级基础上大幅强化 */
const WEAPON_EVOS = {
  bolt: {
    name: '湮灭星穹', color: '#c8f4ff', flavor: '奥术飞弹的终极形态——星穹弹幕湮灭一切。',
    st: { cd: 0.55, dmg: 55, n: 7, speed: 620, pierce: 3 },
  },
  orbit: {
    name: '永恒轮回', color: '#ffe9a0', flavor: '守护环刃的终极形态——轮回刃阵永不停歇。',
    st: { n: 9, dmg: 52, r: 158, spd: 5.2 },
  },
  aura: {
    name: '神圣新星', color: '#fff3b8', flavor: '圣光领域的终极形态——新星圣域净化邪祟。',
    st: { r: 176, dmg: 40, tick: 0.22, slow: 0.5 },
  },
  fire: {
    name: '地狱火海', color: '#ffb347', flavor: '烈焰喷涌的终极形态——焚尽八方的地狱业火。',
    st: { cd: 0.95, dmg: 64, n: 12, speed: 500, pierce: 5 },
  },
  thunder: {
    name: '天罚审判', color: '#e0f8ff', flavor: '雷霆之怒的终极形态——审判之雷无差别降世。',
    st: { cd: 1.2, dmg: 96, n: 11, aoe: 150 },
  },
  frost: {
    name: '绝对零度', color: '#e6f6ff', flavor: '霜寒新星的终极形态——万物凝滞的极寒领域。',
    st: { cd: 1.45, dmg: 90, r: 214, frz: 1.35 },
  },
  vortex: {
    name: '万物归墟', color: '#e3c8ff', flavor: '虚空漩涡的终极形态——吞噬万物的终末黑洞。',
    st: { cd: 3.4, dmg: 40, r: 150, dur: 4.5, pull: 170 },
  },
  echo: {
    name: '永劫回响', color: '#c8fff0', flavor: '回响刃的终极形态——出鞘与归鞘之间, 万劫不复。',
    st: { cd: 1.15, dmg: 78, n: 5, range: 520, speed: 560 },
  },
  spikes: {
    name: '大地之怒', color: '#ffe2a0', flavor: '符文地刺的终极形态——大地咆哮, 万刺穿心。',
    st: { cd: 2.0, dmg: 95, n: 4, r: 120, tele: 0.4 },
  },
  bow: {
    name: '极夜凝霜', color: '#e6f6ff', flavor: '霜华之弓的终极形态——极夜之矢绽开寒霜之花。',
    st: { cd: 1.05, dmg: 105, n: 3, speed: 880, pierce: 9, frz: 2.0 },
  },
};

/* 属性中文标签(用于升级差异展示) */
const STAT_LABEL = {
  cd: '施法间隔', dmg: '伤害', n: '数量', speed: '弹速', pierce: '穿透',
  r: '半径', spd: '转速', tick: '伤害间隔', slow: '减速', aoe: '波及范围', frz: '冰缓',
  dur: '持续', pull: '吸力', range: '射程', tele: '预警',
};
const fmtStat = (k, v) => k === 'cd' || k === 'tick' ? v.toFixed(2) + 's'
  : k === 'slow' ? Math.round(v * 100) + '%'
  : k === 'frz' ? v.toFixed(2) + 's' : String(v);

/* ---------------- 被动定义 ---------------- */
const PASSIVE_DEFS = {
  might:    { name: '力量圣印', color: '#ff8f8f', icon: 'might',    max: 5, per: '所有伤害 +15%' },
  haste:    { name: '时之沙',   color: '#8fd8ff', icon: 'haste',    max: 5, per: '冷却时间 -8%' },
  swift:    { name: '疾风之靴', color: '#a8ffa8', icon: 'swift',    max: 5, per: '移动速度 +10%' },
  vitality: { name: '生命祝福', color: '#ff9ab8', icon: 'vitality', max: 5, per: '生命上限 +25, 并治疗 30' },
  magnet:   { name: '磁石护符', color: '#c9a6ff', icon: 'magnet',   max: 5, per: '拾取范围 +45%' },
  area:     { name: '虚空之核', color: '#b06ef0', icon: 'area',     max: 5, per: '技能范围 +12%' },
  /* —— 稀有被动: 构筑流派核心 —— */
  crit:     { name: '锐锋之眼', color: '#ffd76a', icon: 'crit',    max: 5, per: '暴击率 +5%', rare: true },
  fury:     { name: '狂怒之血', color: '#ff6a4d', icon: 'fury',    max: 5, per: '暴击伤害 +30%', rare: true },
  greed:    { name: '掠夺之手', color: '#ffb84d', icon: 'greed',   max: 5, per: '金币获取 +20%', rare: true },
  wisdom:   { name: '智慧圣典', color: '#8fe0ff', icon: 'wisdom',  max: 5, per: '经验获取 +8%', rare: true },
  thorns:   { name: '荆棘之甲', color: '#9dd35f', icon: 'thorns',  max: 5, per: '受击反弹 12 点伤害', rare: true },
  armor:    { name: '石肤壁垒', color: '#b8c2d6', icon: 'armor',  max: 5, per: '受到伤害固定 -2', rare: true },
  ultflow:  { name: '终焉之息', color: '#e3c8ff', icon: 'vortex', max: 3, per: '深渊爆发充能 +18%', rare: true },
  react:    { name: '元素亲和', color: '#a8f0d8', icon: 'aura',   max: 3, per: '元素反应伤害 +20%', rare: true },
};

/* ---------------- 圣所: 局外永久强化 ---------------- */
const META_KEY = 'abyss_meta_v1';
/* localStorage 不可用时降级为内存存储(测试环境) */
const store = typeof localStorage !== 'undefined' ? localStorage : {
  _d: {},
  getItem(k) { return this._d[k] ?? null; },
  setItem(k, v) { this._d[k] = String(v); },
};
const META_MAX_LV = 5;
let meta = { gold: 0, up: { might: 0, hp: 0, speed: 0, magnet: 0, luck: 0, regen: 0 } };
try {
  const raw = store.getItem(META_KEY);
  if (raw) {
    const m = JSON.parse(raw);
    meta.gold = Math.max(0, +m.gold || 0);
    for (const k in meta.up) meta.up[k] = Math.min(META_MAX_LV, +m.up?.[k] || 0);
  }
} catch (e) { /* 损坏数据忽略 */ }
function saveMeta() {
  try { store.setItem(META_KEY, JSON.stringify(meta)); } catch (e) { /* 忽略 */ }
}
const META_DEFS = {
  might:  { name: '力量精华', per: '所有伤害 +4%',  max: 5, base: 25, icon: 'might' },
  hp:     { name: '生命精华', per: '生命上限 +12',  max: 5, base: 25, icon: 'vitality' },
  speed:  { name: '疾风精华', per: '移动速度 +3%',  max: 5, base: 20, icon: 'swift' },
  magnet: { name: '磁力精华', per: '拾取范围 +8%',  max: 5, base: 20, icon: 'magnet' },
  luck:   { name: '幸运精华', per: '金币掉落 +6%',  max: 5, base: 30, icon: 'luck' },
  regen:  { name: '再生精华', per: '每秒回复 +0.5', max: 5, base: 35, icon: 'regen' },
};
const metaCost = (id, lv) => Math.round(META_DEFS[id].base * Math.pow(1.7, lv));
function buyMeta(id) {
  const d = META_DEFS[id], cur = meta.up[id];
  if (!d || cur >= d.max) return false;
  const cost = metaCost(id, cur);
  if (meta.gold < cost) return false;
  meta.gold -= cost;
  meta.up[id] = cur + 1;
  saveMeta();
  renderShop();
  SFX.choose();
  return true;
}
function renderShop() {
  el['menu-gold'].textContent = meta.gold;
  let h = '';
  for (const id in META_DEFS) {
    const d = META_DEFS[id], lv = meta.up[id], maxed = lv >= d.max;
    const cost = metaCost(id, lv);
    let pips = '';
    for (let i = 0; i < d.max; i++) pips += `<span class="pip${i < lv ? ' on' : ''}"></span>`;
    h += `<button class="shop-item${maxed ? ' maxed' : ''}" data-meta="${id}" title="${d.name} · ${d.per}"${maxed || meta.gold < cost ? ' disabled' : ''}>
      <span class="si-ic">${ICONS[d.icon]}</span>
      <div class="si-info"><b>${d.name}</b><span>${d.per}</span><div class="pips">${pips}</div></div>
      <div class="si-cost">${maxed ? '已满级' : `<span class="coin-dot"></span>${cost}`}</div>
    </button>`;
  }
  el['shop-view'].innerHTML = h;
}
/* 结算: 本局金币存入圣所(幂等) */
function bankGold() {
  if (game.goldBanked) return;
  game.goldBanked = true;
  if (game.goldRun > 0) {
    meta.gold += game.goldRun;
    saveMeta();
  }
}

/* ---------------- 敌人定义 ---------------- */
const ENEMY_DEFS = {
  slime:   { hp: 10,  dmg: 8,  spd: 54,  r: 16, xp: 1 },
  bat:     { hp: 7,   dmg: 6,  spd: 104, r: 12, xp: 1 },
  charger: { hp: 20,  dmg: 10, spd: 62,  r: 15, xp: 2 }, // 冲锋甲虫: 蓄力锁定后直线突进
  skel:    { hp: 28,  dmg: 12, spd: 68,  r: 16, xp: 3 },
  demon:   { hp: 75,  dmg: 18, spd: 60,  r: 20, xp: 8 },
  wraith:  { hp: 46,  dmg: 14, spd: 42,  r: 18, xp: 6, ghost: true }, // 幽灵: 免疫击退
  bomber:  { hp: 16,  dmg: 22, spd: 92,  r: 14, xp: 2, bomber: true }, // 爆弹魔菇: 近身点燃引信自爆
  hexer:   { hp: 38,  dmg: 15, spd: 58,  r: 17, xp: 4, hexer: true },  // 疫病祭司: 保持中距离蓄力三连疫病弹
  shade:   { hp: 48,  dmg: 22, spd: 132, r: 15, xp: 5, shade: true }, // 影刃刺客: 隐身绕后瞬移背刺, 出手后露出破绽
  spore:   { hp: 62,  dmg: 13, spd: 40,  r: 19, xp: 4 }, // 腐沼孢母: 缓慢蠕行, 死亡分裂两枚孢芽
  goblin:  { hp: 55,  dmg: 0,  spd: 178, r: 14, xp: 0, goblin: true }, // 宝藏哥布林: 携宝逃窜, 击杀掉宝箱
};
/* 敌人动画相位速度(周期/秒), 用于精灵帧量化 */
const PH_SPD = { slime: 1.11, bat: 2.39, charger: 1.5, skel: 1.27, demon: 0.95, wraith: 0.85, bomber: 1.7, hexer: 1.05, goblin: 2.1, shade: 2.6, spore: 0.9 };

/* 精英词缀: 随机强化, 光环着色 + 战斗差异化 */
const ELITE_AFFIXES = {
  frenzy:   { name: '狂暴', rgb: '255,80,70',  spd: 1.35, dmg: 1.2 }, // 迅猛凶残
  armored:  { name: '坚甲', rgb: '255,214,90',  dr: 0.35 },           // 受伤减免 35%
  volatile: { name: '爆裂', rgb: '255,150,60',  boom: true },         // 亡语: 8 向弹幕
  chill:    { name: '冰缓', rgb: '120,200,255', chill: true },        // 命中使玩家减速 45%/2s
  regen:    { name: '再生', rgb: '110,240,150', regen: 0.025 },       // 每秒回复 2.5% 生命
  warded:  { name: '魔盾', rgb: '150,225,255', shield: true },       // 周期生成护盾, 完全格挡下一次攻击
  vamp:    { name: '嗜血', rgb: '255,105,140', vamp: 0.10 },         // 命中玩家时回复 10% 自身生命
};

/* Boss 时间表(秒) */
const BOSS_DEFS = [
  { t: 120, art: 'slime', name: '史莱姆之王', hp: 950,   r: 54, spd: 40, dmg: 20, color: '#58c15a' },
  { t: 240, art: 'skel',  name: '骸骨君王',   hp: 2300,  r: 52, spd: 50, dmg: 24, color: '#e8e4d8' },
  { t: 360, art: 'demon', name: '烈焰魔尊',   hp: 4600,  r: 56, spd: 46, dmg: 28, color: '#e05555' },
  { t: 480, art: 'demon', name: '暗影魔龙',   hp: 8200,  r: 60, spd: 54, dmg: 34, color: '#6a5acd' },
  { t: 600, art: 'demon', name: '深渊君主',   hp: 16000, r: 68, spd: 48, dmg: 42, color: '#1d1630', final: true },
];
/* 蝠群突袭事件时间表 */
const RING_TIMES = [75, 190, 310, 430, 540];
/* 精英潮事件时间表 */
const ELITE_TIMES = [150, 270, 390, 500];
/* 血月事件时间表(秒): 持续 32s, 敌潮狂化但收益翻倍 */
const BLOOD_MOON_TIMES = [230, 455];
const BLOOD_MOON_DUR = 32;
/* 雷暴天灾事件时间表(秒): 持续 26s, 天降落雷(中立: 敌我皆伤, 可引雷杀敌) */
const STORM_TIMES = [95, 320, 520];
const STORM_DUR = 26;
const STRIKE_R = 64;    // 落雷波及半径
const STRIKE_WARN = 1.0; // 预警时间(秒)
/* 流星雨天象时间表(秒): 持续 20s, 天降陨石(中立: 落点留燃屑地带持续灼烧) */
const METEOR_TIMES = [175, 410, 630];
const METEOR_DUR = 20;
const METEOR_R = 82;     // 陨石波及半径
const METEOR_WARN = 1.3; // 预警时间(秒, 比雷暴长: 流星更猛更慢)

/* ---------------- 全局状态 ---------------- */
const canvas = document.getElementById('game');
let ctx = canvas.getContext('2d'); // let: 敌人精灵缓存烘焙时需要临时切换目标上下文
const el = {};
['hud', 'xp-fill', 'lv-num', 'timer', 'kills', 'boss-wrap', 'boss-name', 'boss-fill',
  'hp-fill', 'hp-text', 'weapon-bar', 'announce', 'menu', 'start-btn', 'levelup', 'cards',
  'pause', 'resume-btn', 'restart-btn-p', 'gameover', 'go-stats', 'restart-btn',
  'victory', 'vic-stats', 'vic-restart', 'mute-btn', 'pause-btn', 'combo-wrap', 'combo-num', 'build-view',
  'gold-num', 'menu-gold', 'shop-view', 'go-menu-btn', 'vic-menu-btn',
  'dash-btn', 'dash-cd', 'guard-ind', 'hp-wrap', 'ult-wrap', 'ult-fill', 'ult-btn']
  .forEach(id => { el[id] = document.getElementById(id); });

let state = 'menu';                 // menu | playing | levelup | paused | gameover | victory
let player = null;
let enemies = [], bullets = [], ebullets = [], gems = [], potions = [], particles = [], dmgNums = [], bolts = [];
let arcs = []; // 元素链电弧(点对点锯齿闪电线)
let vortexes = []; // 虚空漩涡武器实体
let echoes = []; // 回响刃武器实体(飞出→归返)
let coins = []; // 金币(局外货币)
let chests = []; // Boss 宝箱
let shrines = []; // 神秘祭坛(可交互, 随机祝福)
let rings = []; // 冲击波光环(升级爆发等)
let decals = []; // 地面血迹
let relics = []; // 时之沙漏等圣物拾取物
let slashes = []; // 刺客刀光特效
let strikes = []; // 雷暴落雷(预警圈 + 雷击)
let meteors = []; // 流星雨陨石(预警 → 斜坠 → 爆炸)
let emberZones = []; // 弹坑燃屑地带(持续灼烧圈内敌人)
let souls = []; // 灵魂升腾实体(光核+光晕摇曳上升)
let spikes = []; // 符文地刺武器实体(符阵预警 → 地刺喷发)
const game = { time: 0, kills: 0, pendingLv: 0, combo: 0, comboT: 0, shake: 0, hurtFlash: 0, spawnT: 0, bossIdx: 0, ringIdx: 0, eliteIdx: 0, motes: [], hitStop: 0, whiteFlash: 0, heartT: 0, goldRun: 0, goldBanked: false, bossWarn: 0, bossWarned: false, hurtDir: 0, hurtDirT: 0, dmgStats: {},
  goblinT: 62, shrineT: 40, bloodMoonIdx: 0, bloodMoonT: 0, frenzyT: 0, feverOn: false, feverTier: 0, slipT: 0,
  perfectT: 0, perfectCd: 0, perfects: 0, overloads: 0,
  executes: 0, chains: 0, novas: 0, shatters: 0, chainDepth: 0,
  ultCharge: 0, ultWindup: 0, ults: 0, superconducts: 0, vaporizes: 0, dying: 0,
  fractures: 0, rageFlash: 0,
  stormIdx: 0, stormT: 0, stormSpawnT: 0, stormFlash: 0, stormKills: 0,
  meteorIdx: 0, meteorT: 0, meteorSpawnT: 0, meteorFlash: 0, meteorKills: 0, slowmo: 0,
  bossIntro: 0, introName: '', introFinal: false };
const cam = { x: 0, y: 0, lookX: 0, lookY: 0 };
const keys = {};
const joy = { active: false, id: -1, bx: 0, by: 0, dx: 0, dy: 0 };

/* ---------------- 输入 ---------------- */
window.addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
  keys[k] = true;
  initAudio();

  if (k === 'm') toggleMute();
  if ((k === 'p' || k === 'escape') && (state === 'playing' || state === 'paused')) togglePause();
  if ((k === 'r') && (state === 'gameover' || state === 'victory')) startGame();
  if (k === ' ' || k === 'shift') tryDash();
  if (k === 'e') tryUlt();
  if (state === 'levelup' && ['1', '2', '3'].includes(k)) chooseByIndex(+k - 1);
});
window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
window.addEventListener('blur', () => {
  for (const k in keys) keys[k] = false; // 仅清空按键, 防止松键事件丢失导致持续移动; 不自动暂停
});

/* 触屏虚拟摇杆 */
canvas.addEventListener('touchstart', e => {
  e.preventDefault(); initAudio();
  const t = e.changedTouches[0];
  joy.active = true; joy.id = t.identifier; joy.bx = t.clientX; joy.by = t.clientY; joy.dx = 0; joy.dy = 0;
}, { passive: false });
canvas.addEventListener('touchmove', e => {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.identifier !== joy.id) continue;
    const r = canvas.getBoundingClientRect();
    const scale = W / r.width;
    let dx = (t.clientX - joy.bx) * scale, dy = (t.clientY - joy.by) * scale;
    const len = Math.hypot(dx, dy), max = 64;
    if (len > max) { dx = dx / len * max; dy = dy / len * max; }
    joy.dx = dx / max; joy.dy = dy / max;
  }
}, { passive: false });
const joyEnd = e => {
  for (const t of e.changedTouches) {
    if (t.identifier === joy.id) { joy.active = false; joy.dx = joy.dy = 0; }
  }
};
canvas.addEventListener('touchend', joyEnd);
canvas.addEventListener('touchcancel', joyEnd);

/* ---------------- 地面块(程序化纹理, 带缓存) ---------------- */
const CHUNK = 240;
const chunkCache = new Map();
function getChunk(cx, cy) {
  const key = cx + ',' + cy;
  let c = chunkCache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = CHUNK;
  const g = c.getContext('2d');
  const rnd = mulberry32((cx * 73856093) ^ (cy * 19349663) ^ 0x9e3779b9);
  g.fillStyle = '#111420'; g.fillRect(0, 0, CHUNK, CHUNK);
  // 明暗格交错
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    if ((x + y) % 2) { g.fillStyle = 'rgba(255,255,255,0.012)'; g.fillRect(x * 60, y * 60, 60, 60); }
  }
  // 石板接缝: 大块石板轮廓 + 高光倒角, 营造地牢铺石感
  g.strokeStyle = 'rgba(0,0,0,0.22)';
  g.lineWidth = 1;
  for (let i = 0; i < 3; i++) {
    const sx = Math.floor(rnd() * 3) * 80 + 20, sy = Math.floor(rnd() * 3) * 80 + 20;
    const w = 60 + Math.floor(rnd() * 2) * 40, h = 60;
    g.strokeRect(sx, sy, w, h);
    g.strokeStyle = 'rgba(255,255,255,0.028)';
    g.beginPath(); g.moveTo(sx + 1.5, sy + h); g.lineTo(sx + 1.5, sy + 1.5); g.lineTo(sx + w, sy + 1.5); g.stroke();
    g.strokeStyle = 'rgba(0,0,0,0.22)';
  }
  // 青苔: 暗绿斑簇附着在接缝附近
  for (let i = 0; i < 5; i++) {
    const mx = rnd() * CHUNK, my = rnd() * CHUNK;
    g.fillStyle = `rgba(46,${72 + Math.floor(rnd() * 22)},52,${0.1 + rnd() * 0.1})`;
    for (let j = 0; j < 4; j++) {
      g.beginPath();
      g.ellipse(mx + rnd() * 16 - 8, my + rnd() * 12 - 6, 3 + rnd() * 5, 2 + rnd() * 3, rnd() * 3, 0, TAU);
      g.fill();
    }
  }
  // 噪点
  for (let i = 0; i < 90; i++) {
    g.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.16)';
    g.fillRect(rnd() * CHUNK, rnd() * CHUNK, 2, 2);
  }
  // 装饰: 草丛 / 碎石 / 裂纹 / 白骨 / 幽光蘑菇 / 暗斑
  const n = 22;
  for (let i = 0; i < n; i++) {
    const x = rnd() * CHUNK, y = rnd() * CHUNK, t = rnd();
    if (t < 0.3) {           // 草丛
      g.strokeStyle = '#1e3326'; g.lineWidth = 1.5;
      for (let j = -1; j <= 1; j++) {
        g.beginPath(); g.moveTo(x + j * 3, y);
        g.quadraticCurveTo(x + j * 4, y - 4, x + j * 5, y - 7 - rnd() * 3); g.stroke();
      }
    } else if (t < 0.55) {   // 碎石
      g.fillStyle = '#262b38';
      g.beginPath(); g.ellipse(x, y, 3 + rnd() * 3, 2 + rnd() * 2, rnd() * 3, 0, TAU); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.07)';
      g.beginPath(); g.ellipse(x - 1, y - 1, 1.5, 1, 0, 0, TAU); g.fill();
    } else if (t < 0.72) {   // 裂纹
      g.strokeStyle = 'rgba(0,0,0,0.4)'; g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(x, y);
      let px = x, py = y;
      for (let j = 0; j < 3; j++) { px += rnd() * 12 - 6; py += rnd() * 10; g.lineTo(px, py); }
      g.stroke();
    } else if (t < 0.82) {   // 白骨
      g.strokeStyle = '#4a4f3d'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + 7, y - 4); g.stroke();
      g.fillStyle = '#5a5f4a';
      g.beginPath(); g.arc(x, y, 1.6, 0, TAU); g.arc(x + 7, y - 4, 1.6, 0, TAU); g.fill();
    } else if (t < 0.88) {   // 幽光蘑菇
      const glow = g.createRadialGradient(x, y, 0, x, y, 10);
      glow.addColorStop(0, 'rgba(87,232,255,0.25)'); glow.addColorStop(1, 'rgba(87,232,255,0)');
      g.fillStyle = glow; g.fillRect(x - 10, y - 10, 20, 20);
      g.fillStyle = '#3aa8b8';
      g.beginPath(); g.arc(x, y, 1.8, 0, TAU); g.fill();
    } else {                 // 暗斑
      g.fillStyle = 'rgba(0,0,0,0.18)';
      g.beginPath(); g.ellipse(x, y, 14 + rnd() * 12, 9 + rnd() * 8, rnd() * 3, 0, TAU); g.fill();
    }
  }
  if (chunkCache.size > 120) chunkCache.clear(); // 防止内存无限增长
  chunkCache.set(key, c);
  return c;
}

/* 预渲染发光精灵 */
function makeGlow(color, r) {
  const c = document.createElement('canvas');
  c.width = c.height = r * 4;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(r * 2, r * 2, 0, r * 2, r * 2, r * 2);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.25, color);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, r * 4, r * 4);
  return c;
}
const SPRITE = {
  bolt: makeGlow('#57e8ff', 10),
  boltEvo: makeGlow('#c8f4ff', 13),
  fire: makeGlow('#ff9040', 11),
  fireEvo: makeGlow('#ffb347', 14),
  ebullet: makeGlow('#ff5040', 10),
  hexbullet: makeGlow('#c06ef0', 10),
  gem: makeGlow('#57e8ff', 8),
  coin: makeGlow('#ffd76a', 7),
};

/* 暗角 */
const vignette = (() => {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(W / 2, H / 2, H * 0.42, W / 2, H / 2, H * 0.85);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.55)');
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  return c;
})();

/* 视差远景雾层: 预渲染长条雾带, 相机慢速滚动营造纵深(两层不同视差率) */
const FOG_TILE = 1024;
function makeFogBand(alpha, tint, height) {
  const c = document.createElement('canvas');
  c.width = FOG_TILE; c.height = height;
  const g = c.getContext('2d');
  const rnd = mulberry32(0xC0FFEE ^ height);
  for (let i = 0; i < 26; i++) { // 椭圆雾团聚簇
    const x = rnd() * FOG_TILE, y = height * (0.3 + rnd() * 0.5);
    const rx = 90 + rnd() * 160, ry = height * (0.16 + rnd() * 0.2);
    const grad = g.createRadialGradient(x, y, 0, x, y, rx);
    grad.addColorStop(0, `rgba(${tint},${alpha})`);
    grad.addColorStop(1, `rgba(${tint},0)`);
    g.fillStyle = grad;
    g.save(); g.translate(x, y); g.scale(1, ry / rx); g.translate(-x, -y);
    g.beginPath(); g.arc(x, y, rx, 0, TAU); g.fill();
    g.restore();
  }
  return c;
}
const fogFar = makeFogBand(0.05, '110,140,190', 200);   // 远层: 冷蓝
const fogNear = makeFogBand(0.06, '150,170,210', 140);  // 近层: 稍亮
/* 视差雾绘制: 底部两层雾带, 随相机反向慢滚(无缝平铺) */
function drawParallax() {
  const draw = (band, par) => {
    const yBase = H - band.height - 30;
    let off = -(cam.y * par) % FOG_TILE;
    if (off > 0) off -= FOG_TILE;
    let xOff = -(cam.x * par * 0.6) % FOG_TILE;
    if (xOff > 0) xOff -= FOG_TILE;
    for (let x = xOff; x < W; x += FOG_TILE) {
      ctx.drawImage(band, Math.floor(x), Math.floor(yBase + cam.y * par * 0.4 % 40));
    }
  };
  draw(fogFar, 0.14);
  draw(fogNear, 0.26);
}

/* 主角光池: 暖色环境光缓存的径向光, 照亮主角周边地面(实体前绘制) */
const lightPool = (() => {
  const R = 170;
  const c = document.createElement('canvas');
  c.width = c.height = R * 2;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(R, R, 0, R, R, R);
  grad.addColorStop(0, 'rgba(255,225,170,0.13)');
  grad.addColorStop(0.55, 'rgba(255,215,150,0.06)');
  grad.addColorStop(1, 'rgba(255,210,140,0)');
  g.fillStyle = grad;
  g.beginPath(); g.arc(R, R, R, 0, TAU); g.fill();
  return c;
})();
function drawPlayerLight() {
  const x = player.x - cam.x, y = player.y - cam.y;
  const breathe = 1 + Math.sin(game.time * 2.2) * 0.04; // 呼吸微脉动
  ctx.globalCompositeOperation = 'lighter';
  ctx.drawImage(lightPool, x - 170 * breathe, y - 170 * breathe, 340 * breathe, 340 * breathe);
  ctx.globalCompositeOperation = 'source-over';
}

/* 前景摆草: 基于 chunk hash 固定位置, 深色剪影随风摆动(最上层, 半透明不遮 UI) */
function drawForeground() {
  const cx0 = Math.floor(cam.x / CHUNK), cx1 = Math.floor((cam.x + W) / CHUNK);
  const cy0 = Math.floor((cam.y + H * 0.45) / CHUNK), cy1 = Math.floor((cam.y + H) / CHUNK);
  const wind = game.time * 1.7;
  ctx.strokeStyle = 'rgba(14,24,18,0.5)';
  ctx.lineCap = 'round';
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const rnd = mulberry32((cx * 83492791) ^ (cy * 297121507) ^ 0x95127);
      const n = 2 + Math.floor(rnd() * 2); // 每 chunk 2-3 株
      for (let i = 0; i < n; i++) {
        const wx = cx * CHUNK + rnd() * CHUNK, wy = cy * CHUNK + rnd() * CHUNK;
        const x = wx - cam.x, y = wy - cam.y;
        if (x < -20 || x > W + 20 || y < -30 || y > H + 10) continue;
        const h = 26 + rnd() * 20, ph = rnd() * TAU;
        const sway = Math.sin(wind + ph) * 6 + Math.sin(wind * 0.37 + ph * 2) * 2.4;
        ctx.lineWidth = 2.2;
        for (let b = -1; b <= 1; b++) { // 三笔一簇
          ctx.beginPath();
          ctx.moveTo(x + b * 3, y);
          ctx.quadraticCurveTo(x + b * 4 + sway * 0.4, y - h * 0.55, x + b * 5 + sway, y - h * (0.85 + b * 0.08));
          ctx.stroke();
        }
      }
    }
  }
}

/* ---------------- 玩家 ---------------- */
function makePlayer() {
  return {
    x: 0, y: 0, face: 1, walk: 0, moving: false,
    hp: 100, inv: 0, xp: 0, xpNeed: 6, level: 1,
    weapons: { bolt: { lv: 1, t: 0.4, evoed: false } },
    passives: {},
    orbA: 0, auraT: 0, auraPulse: 0, dustT: 0, stepT: 0, chillT: 0,
    dashCd: 0, dashT: 0, dashDx: 1, dashDy: 0, lastDx: 1, lastDy: 0,
    guard: 1, guardFx: 0, // 濒死守护: 每局一次免死机会
    stats: {},
  };
}
function recomputeStats() {
  const p = player, lv = k => p.passives[k] || 0;
  const M = meta.up; // 圣所永久强化
  p.stats = {
    might: 1 + 0.15 * lv('might') + 0.04 * M.might,
    cdr: Math.max(0.55, 1 - 0.08 * lv('haste')),
    speed: 228 * (1 + 0.10 * lv('swift') + 0.03 * M.speed),
    magnet: 96 * (1 + 0.45 * lv('magnet') + 0.08 * M.magnet),
    area: 1 + 0.12 * lv('area'),
    maxHp: 100 + 25 * lv('vitality') + 12 * M.hp,
    regen: 0.5 * M.regen, // 圣所再生精华: 局外永久回血
    crit: 0.12 + 0.05 * lv('crit'),              // 暴击率(基础 12%)
    critMul: 1.75 + 0.30 * lv('fury'),           // 暴击伤害倍率(基础 175%)
    goldMul: 1 + 0.20 * lv('greed'),             // 金币获取
    xpMul: 1 + 0.08 * lv('wisdom'),              // 经验获取
    thorns: 12 * lv('thorns'),                   // 荆棘反伤
    armor: 2 * lv('armor'),                      // 固定减伤
    ultFlow: 1 + 0.18 * lv('ultflow'),           // 终焉之息: 终极技充能效率
    react: 1 + 0.2 * lv('react'),                // 元素亲和: 元素反应伤害
  };
}
const wStats = (id, lvv) => lvv > WEAPON_DEFS[id].max ? WEAPON_EVOS[id].st : WEAPON_DEFS[id].levels[lvv - 1];
/* 冷却倍率: 时之沙被动 + 祭坛"暴走祝福"(期间锐减 40%) */
const cdMul = () => player.stats.cdr * (game.frenzyT > 0 ? 0.6 : 1);

/* 闪避冲刺: 空格/Shift 触发, 向移动方向瞬发位移 + 短暂无敌 */
function tryDash() {
  const P = player;
  if (state !== 'playing' || game.dying > 0 || P.dashCd > 0 || P.dashT > 0) return;
  let dx = P.lastDx, dy = P.lastDy;
  if (!dx && !dy) { dx = P.face; dy = 0; }
  P.dashDx = dx; P.dashDy = dy;
  P.dashT = 0.16;
  P.dashCd = 2.6;
  P.inv = Math.max(P.inv, 0.34); // 冲刺期间无敌
  SFX.dash();
  burst(P.x, P.y, 8, '#9df0ff', 180);
  updateHUD(); // 立即刷新冲刺按钮冷却遮罩
}

/* ---------------- 主动技: 深渊爆发 ---------------- */
const ULT_WINDUP = 0.5; // 引导汇聚时长(秒)
const ultMaxCharge = () => 110 + minute() * 10; // 充能上限随时间成长(后期敌潮更密, 爆发更频繁)
function tryUlt() {
  const P = player;
  if (state !== 'playing' || game.dying > 0 || game.ultWindup > 0) return;
  if (game.ultCharge < ultMaxCharge() - 0.01) return;
  game.ultCharge = 0;
  game.ultWindup = ULT_WINDUP;
  P.inv = Math.max(P.inv, ULT_WINDUP + 0.35); // 引导+爆发全程免伤
  P.dashT = 0;
  SFX.warn();
  announce('深 渊 爆 发');
  updateHUD();
}
/* 爆发结算: 以自身为心的深渊冲击波(大伤害 + 感电/灼烧附着 + 击退 + 焦痕) */
function castUlt() {
  const P = player, m = minute();
  const R = 330 * (0.7 + 0.3 * P.stats.area);
  const dmg = (110 + 26 * m) * P.stats.might;
  game.ults++;
  game.shake = Math.min(24, game.shake + 16);
  game.whiteFlash = Math.max(game.whiteFlash, 0.32);
  game.hitStop = Math.max(game.hitStop, 0.09);
  rings.push({ x: P.x, y: P.y, age: 0, max: R, color: '176,110,240' });
  rings.push({ x: P.x, y: P.y, age: -0.08, max: R * 1.22, color: '255,255,255' });
  addDmgNum(P.x, P.y - 44, '渊', '#e3c8ff', true);
  SFX.ult();
  burst(P.x, P.y, 34, '#b06ef0', 400);
  if (decals.length < 64) decals.push({ x: P.x, y: P.y, r: R * 0.42, age: 0, life: 2.4, seed: Math.random() * 100, scorch: true });
  for (const e of enemies) {
    if (e.dead) continue;
    const d = Math.hypot(e.x - P.x, e.y - P.y);
    if (d > R + e.r) continue;
    const a = Math.atan2(e.y - P.y, e.x - P.x), f = 1 - d / (R + e.r);
    e.shockT = Math.max(e.shockT || 0, 0.6);  // 附着感电(可续链爆/超导)
    e.burn = Math.max(e.burn, 1.8);           // 附着灼烧(可续超载)
    e.burnDps = Math.max(e.burnDps || 0, 12 + m * 4); e.burnTick = 0.45;
    hitEnemy(e, dmg, '#e3c8ff', Math.cos(a) * 480 * f, Math.sin(a) * 480 * f, 'ult');
  }
  updateHUD();
}

/* ---------------- 敌人生成 ---------------- */
function minute() { return game.time / 60; }
/* 应用精英词缀数值与初始状态 */
function applyAffix(e, id) {
  const af = ELITE_AFFIXES[id];
  if (af.spd) e.spd *= af.spd;
  if (af.dmg) e.dmg *= af.dmg;
  if (af.shield) { e.shield = 1; e.shieldCd = 7; } // 魔盾: 初始一层护盾, 破碎后 7s 重铸
  return af;
}
function spawnEnemy(type, x, y, elite) {
  if (enemies.length > 260 && type !== 'goblin') return null; // 哥布林不受容量限制(事件优先)
  const d = ENEMY_DEFS[type], m = minute();
  const hpMul = 1 + m * 0.55, dmgMul = 1 + m * 0.11;
  const e = {
    type, x, y,
    hp: d.hp * hpMul, maxHp: d.hp * hpMul,
    dmg: d.dmg * dmgMul, spd: d.spd * (1 + Math.min(0.3, m * 0.02)),
    r: d.r, xp: d.xp,
    ph: rand(0, 1), phSpd: PH_SPD[type], flash: 0, hitCd: 0, ocd: 0, slowT: 0,
    burn: 0, burnDps: 0, burnTick: 0, scCd: 0, brittleT: 0,
    kx: 0, ky: 0, elite: !!elite, dead: false, boss: false,
    wob: rand(0, TAU), ghost: !!d.ghost,
  };
  if (type === 'demon') e.fireT = rand(2.2, 4.6); // 普通恶魔: 近距离也会施放火球
  if (type === 'charger') { e.chg = null; e.chgCd = rand(0.6, 1.6); e.chgT = 0; e.cdx = 0; e.cdy = 0; }
  if (type === 'bomber') { e.fuse = 0; e.fuseLit = false; } // 爆弹魔菇: 引信状态
  if (type === 'hexer') { e.cast = 0; e.castCd = rand(1.4, 2.6); } // 疫病祭司: 施法状态
  if (type === 'shade') { e.vst = 'stalk'; e.vT = 0; e.blinkA = 0; e.olCd = 0; } // 影刃刺客: 潜行状态机
  if (type === 'goblin') { e.life = 24; e.coinT = 0.5; e.dmg = 0; } // 哥布林: 逃亡倒计时 + 撒币轨迹
  if (elite) {
    e.hp = e.maxHp = e.hp * 4.2; e.dmg *= 1.45; e.r *= 1.42; e.xp *= 5; e.spd *= 0.88;
    // 随机词缀(35% 精英携带): 光环变色 + 特殊能力
    if (Math.random() < 0.35) {
      const ids = Object.keys(ELITE_AFFIXES);
      e.affix = ids[randInt(0, ids.length - 1)];
      applyAffix(e, e.affix);
      // 双词缀(后期威胁升级): 5 分钟后 50% 概率追加第二词缀, 掉落翻倍
      if (game.time > 300 && Math.random() < 0.5) {
        const rest = ids.filter(id => id !== e.affix);
        e.affix2 = rest[randInt(0, rest.length - 1)];
        applyAffix(e, e.affix2);
        e.r *= 1.1; // 双词缀: 体型再增大, 视觉区分威胁等级
      }
      // 惊变演出: 词缀冲击环 + 威胁宣告(双词缀追加变异宣告与第二道冲击环)
      const af = ELITE_AFFIXES[e.affix];
      rings.push({ x: e.x, y: e.y, age: 0, max: 150, color: af.rgb });
      addDmgNum(e.x, e.y - e.r - 18, '精英·' + af.name, `rgb(${af.rgb})`, true);
      if (e.affix2) {
        const af2 = ELITE_AFFIXES[e.affix2];
        rings.push({ x: e.x, y: e.y, age: -0.1, max: 190, color: af2.rgb });
        addDmgNum(e.x, e.y - e.r - 36, af2.name + '·变异!', `rgb(${af2.rgb})`, true);
      }
    }
  }
  enemies.push(e);
  return e;
}
function spawnBoss(i) {
  const d = BOSS_DEFS[i];
  const a = rand(0, TAU);
  const e = {
    type: d.art, x: player.x + Math.cos(a) * 560, y: player.y + Math.sin(a) * 560,
    hp: d.hp, maxHp: d.hp, dmg: d.dmg, spd: d.spd, r: d.r, xp: 0,
    ph: 0, phSpd: 0.5, flash: 0, hitCd: 0, ocd: 0, slowT: 0, kx: 0, ky: 0, scCd: 0, brittleT: 0,
    elite: false, dead: false, boss: true, final: !!d.final,
    name: d.name, color: d.color, fireT: 2.2, wob: 0, bossScale: d.final ? 3.2 : 2.5,
  };
  enemies.push(e);
  game.bossIdx = Math.max(game.bossIdx, i + 1);
  game.bossWarn = 0; // 预警结束, Boss 已现身
  announce(d.final ? '深 渊 君 主 · 降 临' : '强 敌 来 袭 · ' + d.name);
  SFX.boss();
  game.shake = Math.min(18, game.shake + 12);
  // 登场演出: 黑边收拢 + 名字横幅(2.6s)
  game.bossIntro = 2.6;
  game.introName = d.name;
  game.introFinal = !!d.final;
  return e;
}

/* 出怪导演 */
function updateDirector(dt) {
  // 常规刷怪
  game.spawnT -= dt;
  const m = minute();
  const bm = game.bloodMoonT > 0; // 血月: 刷怪加速
  if (game.spawnT <= 0) {
    game.spawnT = clamp(2.1 - m * 0.2, 0.34, 2.1) * (bm ? 0.55 : 1);
    const batch = Math.min(9, 1 + Math.floor(m * 0.9)) + (bm ? 2 : 0);
    for (let i = 0; i < batch; i++) {
      const a = rand(0, TAU), R = rand(740, 820);
      const x = player.x + Math.cos(a) * R, y = player.y + Math.sin(a) * R;
      let pool = [['slime', 5]];
      if (m > 0.7) pool.push(['bat', 3]);
      if (m > 1.2) pool.push(['bomber', m > 3 ? 2.5 : 1.5]); // 爆弹魔菇: 1.2 分钟起混入敌潮
      if (m > 2.5) pool.push(['charger', m > 4 ? 3 : 2]); // 冲锋甲虫: 2.5 分钟起参战
      if (m > 2.8) pool.push(['hexer', m > 5 ? 3 : 2]);   // 疫病祭司: 2.8 分钟起远程压制
      if (m > 4)   pool.push(['shade', m > 6 ? 3 : 1.6]); // 影刃刺客: 4 分钟起潜入战场
      if (m > 3.2) pool.push(['spore', m > 5 ? 2.5 : 1.6]); // 腐沼孢母: 3.2 分钟起混入敌潮
      if (m > 2)   pool.push(['skel', m > 3 ? 4 : 2]);
      if (m > 3.5) pool.push(['wraith', m > 5 ? 3 : 1.5]); // 幽灵: 3.5 分钟后渗透战场
      if (m > 4.5) pool.push(['demon', m > 6 ? 4 : 2]);
      let tot = 0; for (const [, w] of pool) tot += w;
      let r = Math.random() * tot, type = pool[0][0];
      for (const [k, w] of pool) { r -= w; if (r <= 0) { type = k; break; } }
      spawnEnemy(type, x, y, m > 3 && Math.random() < Math.min(0.02 + m * 0.012, 0.09));
    }
  }
  // 宝藏哥布林: 携宝逃窜的特殊敌人, 击杀掉宝箱 + 金币雨
  game.goblinT -= dt;
  if (game.goblinT <= 0) {
    game.goblinT = rand(80, 115);
    const a = rand(0, TAU);
    const g = spawnEnemy('goblin', player.x + Math.cos(a) * 480, player.y + Math.sin(a) * 480);
    if (g) {
      announce('宝 藏 哥 布 林 · 携 宝 逃 窜');
      SFX.coin();
      rings.push({ x: g.x, y: g.y, age: 0, max: 150, color: '255,215,106' });
    }
  }
  // 神秘祭坛: 定期现身, 走近触发随机祝福
  game.shrineT -= dt;
  if (game.shrineT <= 0) {
    game.shrineT = rand(70, 95);
    const a = rand(0, TAU), R = rand(420, 540);
    shrines.push({ x: player.x + Math.cos(a) * R, y: player.y + Math.sin(a) * R, life: 55, ph: rand(0, TAU) });
    announce('神 秘 祭 坛 现 身');
    SFX.levelup();
  }
  // 血月: 敌潮狂化 + 收益翻倍
  if (game.bloodMoonIdx < BLOOD_MOON_TIMES.length && game.time >= BLOOD_MOON_TIMES[game.bloodMoonIdx]) {
    game.bloodMoonIdx++;
    game.bloodMoonT = BLOOD_MOON_DUR;
    announce('血 月 降 临 · 猎 杀 时 刻');
    SFX.rage();
    game.shake = Math.min(16, game.shake + 10);
  }
  if (game.bloodMoonT > 0) game.bloodMoonT = Math.max(0, game.bloodMoonT - dt);
  // 蝠群环形突袭
  if (game.ringIdx < RING_TIMES.length && game.time >= RING_TIMES[game.ringIdx]) {
    game.ringIdx++;
    announce('蝠 群 突 袭');
    SFX.boss();
    for (let i = 0; i < 40; i++) {
      const a = i / 40 * TAU;
      spawnEnemy('bat', player.x + Math.cos(a) * 620, player.y + Math.sin(a) * 620);
    }
  }
  // 精英潮: 一波精英领衔的混编大军
  if (game.eliteIdx < ELITE_TIMES.length && game.time >= ELITE_TIMES[game.eliteIdx]) {
    game.eliteIdx++;
    announce('精 英 大 军 来 袭');
    SFX.boss();
    game.shake = Math.min(14, game.shake + 8);
    const m2 = minute();
    for (let i = 0; i < 6; i++) {
      const a = rand(0, TAU), R = rand(600, 720);
      const t = m2 > 4 ? ['skel', 'wraith', 'demon', 'charger', 'shade'][i % 5] : (m2 > 2.5 ? ['skel', 'bat', 'charger'][i % 3] : 'slime');
      spawnEnemy(t, player.x + Math.cos(a) * R, player.y + Math.sin(a) * R, true);
    }
    for (let i = 0; i < 14; i++) {
      const a = rand(0, TAU), R = rand(660, 800);
      const t = ['slime', 'bat', 'skel'][i % 3];
      spawnEnemy(t, player.x + Math.cos(a) * R, player.y + Math.sin(a) * R);
    }
  }
  /* 雷暴天灾: 期间天降中立落雷(敌我皆伤, 玩家可引雷杀敌/冲刺穿袭免伤) */
  if (game.stormIdx < STORM_TIMES.length && game.time >= STORM_TIMES[game.stormIdx]) {
    game.stormIdx++;
    game.stormT = STORM_DUR;
    game.stormSpawnT = 1.2;
    announce('雷 暴 天 灾 · 天 怒 降 临');
    SFX.warn();
  }
  if (game.stormT > 0) {
    game.stormT -= dt;
    game.stormSpawnT -= dt;
    if (game.stormSpawnT <= 0) { // 落点: 65% 追玩家(走位压力) / 35% 劈敌群(引雷收益)
      game.stormSpawnT = rand(1.6, 2.6);
      let sx, sy;
      if (Math.random() < 0.65) {
        sx = player.x + rand(-150, 150); sy = player.y + rand(-150, 150);
      } else {
        const cand = enemies.filter(e => !e.dead && !e.boss);
        if (cand.length) {
          const t = cand[Math.floor(Math.random() * cand.length)];
          sx = t.x + rand(-40, 40); sy = t.y + rand(-40, 40);
        } else { sx = player.x + rand(-200, 200); sy = player.y + rand(-200, 200); }
      }
      strikes.push({ x: sx, y: sy, t: STRIKE_WARN, r: STRIKE_R, age: -1, seed: Math.random() * 100 });
    }
    if (game.stormT <= 0 && game.stormKills >= 6) {
      announce('天 助 我 也 · 引 雷 斩 ' + game.stormKills + ' 敌');
    }
  }
  if (game.stormFlash > 0) game.stormFlash = Math.max(0, game.stormFlash - dt);
  /* 流星雨天象: 期间天降陨石(中立: 敌我皆伤, 弹坑留燃屑地带持续灼烧) */
  if (game.meteorIdx < METEOR_TIMES.length && game.time >= METEOR_TIMES[game.meteorIdx]) {
    game.meteorIdx++;
    game.meteorT = METEOR_DUR;
    game.meteorSpawnT = 1.0;
    announce('流 星 陨 落 · 天 火 焚 野');
    SFX.warn();
  }
  if (game.meteorT > 0) {
    game.meteorT -= dt;
    game.meteorSpawnT -= dt;
    if (game.meteorSpawnT <= 0) { // 落点: 60% 追玩家(走位压力) / 40% 砸敌群(引火清场)
      game.meteorSpawnT = rand(1.8, 2.8);
      let sx, sy;
      if (Math.random() < 0.6) {
        sx = player.x + rand(-170, 170); sy = player.y + rand(-170, 170);
      } else {
        const cand = enemies.filter(e => !e.dead && !e.boss);
        if (cand.length) {
          const t = cand[Math.floor(Math.random() * cand.length)];
          sx = t.x + rand(-50, 50); sy = t.y + rand(-50, 50);
        } else { sx = player.x + rand(-220, 220); sy = player.y + rand(-220, 220); }
      }
      meteors.push({ x: sx, y: sy, t: METEOR_WARN, phase: 0, fallT: 0, age: -1, r: METEOR_R, seed: Math.random() * 100 });
    }
    if (game.meteorT <= 0 && game.meteorKills >= 5) {
      announce('天 火 焚 敌 · 陨 石 碾 碎 ' + game.meteorKills + ' 敌');
    }
  }
  if (game.meteorFlash > 0) game.meteorFlash = Math.max(0, game.meteorFlash - dt);
  // 虚空漩涡推进: 吸扯敌人 → 周期绞割
  for (const v of vortexes) {
    v.life -= dt;
    v.tickT -= dt;
    const R2 = v.r * v.r;
    for (const e of enemies) {
      if (e.dead || e.boss || e.goblin) continue;
      const d2 = dist2(v.x, v.y, e.x, e.y);
      if (d2 < R2 * 2.6) { // 吸力范围略大于绞割圈
        const a = Math.atan2(v.y - e.y, v.x - e.x);
        const d = Math.sqrt(d2);
        const f = v.pull * (1 - Math.min(1, d / (v.r * 1.6))) * dt; // 越近吸力越强
        e.x += Math.cos(a) * f; e.y += Math.sin(a) * f;
      }
      if (d2 < R2 && v.tickT <= 0) {
        hitEnemy(e, v.dmg, v.evo ? '#e3c8ff' : '#c06ef0', 0, 0, 'vortex');
      }
    }
    if (v.tickT <= 0) v.tickT = 0.3;
    // 吸入粒子流(美术): 每帧 1-2 粒外圈卷入
    if (particles.length < 280 && Math.random() < 0.7) {
      const a = rand(0, TAU), R = v.r * rand(1.1, 1.5);
      particles.push({ x: v.x + Math.cos(a) * R, y: v.y + Math.sin(a) * R,
        vx: -Math.cos(a) * 90, vy: -Math.sin(a) * 90, life: 0.4, age: 0, r: rand(1, 2.4),
        color: v.evo ? '#e3c8ff' : '#b06ef0', grav: 0 });
    }
  }
  vortexes = vortexes.filter(v => v.life > 0);
  // 符文地刺推进: 符阵预警倒计时 → 地刺喷发(范围伤害 + 击飞)
  for (const s of spikes) {
    if (!s.hit) {
      s.t -= dt;
      if (s.t <= 0) {
        s.hit = true; s.burstT = 0.3; // 喷发表现期
        for (const e of enemies) {
          if (e.dead) continue;
          if (dist2(s.x, s.y, e.x, e.y) < (s.r + e.r) ** 2) {
            const a = Math.atan2(e.y - s.y, e.x - s.x);
            hitEnemy(e, s.dmg, s.evo ? '#ffe2a0' : '#d8b06a', Math.cos(a) * 260, Math.sin(a) * 260 - 140, 'spikes');
          }
        }
        rings.push({ x: s.x, y: s.y, age: 0, max: s.r, color: s.evo ? '255,226,160' : '216,176,106' });
        burst(s.x, s.y, s.evo ? 16 : 10, s.evo ? '#ffe2a0' : '#d8b06a', 240);
        game.shake = Math.min(10, game.shake + 3);
        SFX.hit();
      } else if (particles.length < 280 && Math.random() < 0.3) { // 符阵尘光上浮
        const a = rand(0, TAU), R = s.r * Math.random();
        particles.push({ x: s.x + Math.cos(a) * R, y: s.y + Math.sin(a) * R * 0.55, vx: 0, vy: -22,
          life: 0.4, age: 0, r: rand(1, 2), color: s.evo ? '#ffe2a0' : '#d8b06a', grav: 0 });
      }
    } else s.burstT -= dt;
  }
  spikes = spikes.filter(s => !s.hit || s.burstT > 0);
  // 回响刃推进: 飞出至射程 → 折返追主 → 触主回收(去程/归程各结算一次伤害)
  for (const b of echoes) {
    b.life -= dt;
    b.ang += b.spin * dt;
    if (b.phase === 0) { // 去程: 直线飞出
      b.x += b.vx * dt; b.y += b.vy * dt;
      b.dist += b.spd * dt;
      b.mvx = b.vx / b.spd; b.mvy = b.vy / b.spd;
      if (b.dist >= b.range || b.life <= 0) { b.phase = 1; b.hitSet.clear(); } // 折返: 伤害名单重置
    } else { // 归程: 追踪主人
      const a = Math.atan2(player.y - b.y, player.x - b.x);
      const sp = b.spd * 1.18;
      b.x += Math.cos(a) * sp * dt; b.y += Math.sin(a) * sp * dt;
      b.mvx = Math.cos(a); b.mvy = Math.sin(a);
      if (dist2(b.x, b.y, player.x, player.y) < 30 * 30) { b.done = true; continue; } // 收刃
    }
    if (b.life <= 0) { b.done = true; continue; }
    for (const e of enemies) {
      if (e.dead || b.hitSet.has(e)) continue;
      if (dist2(b.x, b.y, e.x, e.y) < (e.r + 13) ** 2) {
        b.hitSet.add(e);
        hitEnemy(e, b.dmg, b.evo ? '#c8fff0' : '#7ff2c8', b.mvx * 210, b.mvy * 210, 'echo');
        if (particles.length < 280) burst(b.x, b.y, 3, b.evo ? '#c8fff0' : '#7ff2c8', 120);
      }
    }
  }
  echoes = echoes.filter(b => !b.done);
  // 落雷推进: 预警倒计时 → 雷击判定
  for (const s of strikes) {
    if (s.t > 0) { s.t -= dt; continue; }
    if (s.age < 0) { // 触雷瞬间
      s.age = 0;
      const dmgE = 60 + game.time * 0.12; // 敌人伤害随时间成长
      for (const e of enemies) { // 波及敌人: 大伤害 + 击退
        if (e.dead || e.boss) continue;
        if (dist2(s.x, s.y, e.x, e.y) < (s.r + e.r) ** 2) {
          const a = Math.atan2(e.y - s.y, e.x - s.x);
          const wasDead = e.dead;
          hitEnemy(e, dmgE, '#cfeaff', Math.cos(a) * 260, Math.sin(a) * 260, 'storm');
          if (!wasDead && e.dead) game.stormKills++;
        }
      }
      if (dist2(s.x, s.y, player.x, player.y) < (s.r + 13) ** 2) damagePlayer(18, s.x, s.y); // 玩家: 固定轻伤(可冲刺闪避)
      decals.push({ x: s.x, y: s.y, r: s.r * 0.8, age: 0, life: 2.6, seed: s.seed, scorch: true }); // 地面焦痕
      rings.push({ x: s.x, y: s.y, age: 0, max: s.r + 40, color: '190,220,255' });
      burst(s.x, s.y, 14, '#cfeaff', 300);
      game.stormFlash = 0.14;
      game.shake = Math.min(13, game.shake + 6);
      SFX.zap(); SFX.nova();
    } else s.age += dt;
  }
  strikes = strikes.filter(s => s.t > 0 || s.age < 0.2);
  // 陨石推进: 预警倒计时 → 斜向坠落(0.45s) → 落地爆炸 + 燃屑地带
  for (const m of meteors) {
    if (m.phase === 0) { m.t -= dt; if (m.t <= 0) { m.phase = 1; m.fallT = 0; } continue; }
    if (m.phase === 1) { // 坠落: 从落点右上(360, -470)直线冲落
      m.fallT += dt / 0.45;
      if (m.fallT >= 1) {
        m.phase = 2; m.age = 0;
        const dmgE = 85 + game.time * 0.16;
        for (const e of enemies) { // 波及敌人: 大伤害 + 击退 + 天火点燃
          if (e.dead || e.boss) continue;
          if (dist2(m.x, m.y, e.x, e.y) < (m.r + e.r) ** 2) {
            const a = Math.atan2(e.y - m.y, e.x - m.x);
            const wasDead = e.dead;
            hitEnemy(e, dmgE, '#ffb066', Math.cos(a) * 300, Math.sin(a) * 300, 'meteor');
            if (!e.dead) { e.burn = Math.max(e.burn, 3); e.burnDps = Math.max(e.burnDps || 0, 12 + minute() * 4); e.burnTick = 0.45; }
            if (!wasDead && e.dead) game.meteorKills++;
          }
        }
        if (dist2(m.x, m.y, player.x, player.y) < (m.r * 0.8 + 13) ** 2) damagePlayer(26, m.x, m.y); // 内圈才伤玩家(可擦边走位)
        decals.push({ x: m.x, y: m.y, r: m.r * 0.85, age: 0, life: 3.4, seed: m.seed, scorch: true, meteor: true }); // 弹坑
        emberZones.push({ x: m.x, y: m.y, r: m.r * 0.75, life: 3, tickT: 0.4 });
        rings.push({ x: m.x, y: m.y, age: 0, max: m.r + 60, color: '255,150,60' });
        burst(m.x, m.y, 18, '#ffb066', 340);
        game.meteorFlash = 0.12;
        game.shake = Math.min(15, game.shake + 8);
        SFX.nova(); SFX.fire();
      } else if (particles.length < 280 && Math.random() < 0.8) { // 坠落火尾
        const px = m.x + 360 * (1 - m.fallT), py = m.y - 470 * (1 - m.fallT);
        particles.push({ x: px + rand(-4, 4), y: py + rand(-4, 4), vx: rand(-30, 30) + 90, vy: rand(-30, 30) - 60,
          life: rand(0.25, 0.5), age: 0, r: rand(2, 4), color: Math.random() < 0.5 ? '#ffd28a' : '#ff8a3d', grav: -30 });
      }
      continue;
    }
    m.age += dt;
  }
  meteors = meteors.filter(m => m.phase !== 2 || m.age < 0.3);
  // 燃屑地带推进: 持续点燃圈内敌人 + 冒火星
  for (const z of emberZones) {
    z.life -= dt; z.tickT -= dt;
    if (z.tickT <= 0) {
      z.tickT = 0.5;
      const dps = 8 + minute() * 3;
      for (const e of enemies) {
        if (e.dead || e.boss) continue;
        if (dist2(z.x, z.y, e.x, e.y) < (z.r + e.r) ** 2) {
          e.burn = Math.max(e.burn, 1.2);
          e.burnDps = Math.max(e.burnDps || 0, dps);
          e.burnTick = Math.min(e.burnTick || 0.45, 0.45);
        }
      }
    }
    if (particles.length < 280 && Math.random() < 0.35) { // 燃屑火星
      const a = rand(0, TAU), R = z.r * Math.sqrt(Math.random());
      particles.push({ x: z.x + Math.cos(a) * R, y: z.y + Math.sin(a) * R * 0.55,
        vx: rand(-12, 12), vy: rand(-55, -25), life: rand(0.4, 0.8), age: 0, r: rand(1.2, 2.6),
        color: Math.random() < 0.4 ? '#ffd28a' : '#ff7a3d', grav: -20 });
    }
  }
  emberZones = emberZones.filter(z => z.life > 0);
  // 灵魂升腾推进: 摇曳上升 + 微尾迹
  for (const s of souls) {
    s.life -= dt;
    s.sway += dt * 3;
    s.x += Math.cos(s.sway) * s.swayAmp * dt + s.vx * dt;
    s.y += s.vy * dt;
    s.vy = Math.max(s.vy - 30 * dt, -74); // 缓缓加速上升但封顶
    if (particles.length < 280 && Math.random() < 0.22) {
      particles.push({ x: s.x, y: s.y, vx: 0, vy: 10, life: 0.3, age: 0, r: s.r * 0.35, color: `rgba(${s.col},0.8)`, grav: 0 });
    }
  }
  souls = souls.filter(s => s.life > 0);
  // Boss 降临预警: 提前 4 秒公告 + 边缘红光脉动
  if (game.bossIdx < BOSS_DEFS.length && !game.bossWarned && game.time >= BOSS_DEFS[game.bossIdx].t - 4) {
    game.bossWarned = true;
    game.bossWarn = 4;
    announce('警 惕 · 强 敌 将 至');
    SFX.warn();
  }
  if (game.bossWarn > 0) game.bossWarn = Math.max(0, game.bossWarn - dt);
  // Boss 时间表
  if (game.bossIdx < BOSS_DEFS.length && game.time >= BOSS_DEFS[game.bossIdx].t) {
    spawnBoss(game.bossIdx);
  }
}

/* ---------------- 掉落 ---------------- */
function dropGems(x, y, v) {
  while (v > 0) {
    const take = v > 40 ? randInt(12, 25) : v;
    v -= take;
    gems.push({
      x: x + rand(-14, 14), y: y + rand(-14, 14),
      v: take, vx: rand(-70, 70), vy: rand(-90, -20), bob: rand(0, TAU), pull: 0,
    });
  }
  if (gems.length > 170) { // 合并最旧的宝石防卡顿
    const a = gems.shift(), b = gems.shift();
    if (b) { b.v += a.v; gems.push(b); }
  }
}
function dropPotion(x, y) {
  potions.push({ x: x + rand(-10, 10), y: y + rand(-10, 10), bob: rand(0, TAU) });
}
function dropRelic(x, y) { // 时之沙漏: 拾取后全场(敌人与弹幕)迟滞 5.5s
  relics.push({ x: x + rand(-12, 12), y: y + rand(-12, 12), bob: rand(0, TAU) });
}
function dropCoins(x, y, n) {
  for (let i = 0; i < n && coins.length < 90; i++) {
    coins.push({
      x: x + rand(-14, 14), y: y + rand(-14, 14),
      vx: rand(-80, 80), vy: rand(-100, -20), bob: rand(0, TAU), pull: 0, v: 1,
    });
  }
}

/* ---------------- 伤害与击杀 ---------------- */
function hitEnemy(e, dmg, color, kx = 0, ky = 0, src) {
  if (e.dead) return;
  // 魔盾词缀: 护盾完全格挡下一次攻击(伤害归零, 护盾破碎)
  if (e.shield > 0) {
    e.shield = 0;
    e.shieldCd = 7;
    rings.push({ x: e.x, y: e.y, age: 0, max: e.r * 2.4, color: '150,225,255' });
    burst(e.x, e.y, 12, '#96e1ff', 230);
    addDmgNum(e.x, e.y - e.r - 6, '格挡', '#96e1ff', true);
    SFX.block();
    return;
  }
  let d = dmg;
  const crit = Math.random() < (player ? player.stats.crit : 0.12); // 暴击: 可由"锐锋之眼/狂怒之血"成长
  if (crit) d *= player.stats.critMul;
  if (crit && e.slowT > 0 && (e.fracCd || 0) <= 0 && game.chainDepth < 3) triggerFracture(e); // 碎冰: 暴击击碎冰缓之壳
  if (game.feverTier) d *= 1 + game.feverTier * 0.1; // 连击狂热: 按档位全伤害 +10%/+20%/+30%
  if (game.perfectT > 0) d *= 1.45;  // 完美闪避奖励窗口: 全伤害 +45%
  if (e.vst === 'rest') d *= 1.3;    // 刺客出手后硬直: 破绽暴露, 受伤 +30%
  if (e.affix === 'armored' || e.affix2 === 'armored') d *= 1 - ELITE_AFFIXES.armored.dr; // 坚甲: 受伤减免
  if (e.brittleT > 0) d *= 1.25; // 超导脆化: 冰晶碎壳使敌人易伤 +25%
  // 处决: 濒血敌人(非Boss/哥布林)受伤 +60%, 击杀触发斩首演出
  const exec = !e.boss && e.type !== 'goblin' && e.hp > 0 && e.hp < e.maxHp * 0.15;
  if (exec) d *= 1.6;
  e.hp -= d;
  if (exec && e.hp <= 0) e.executed = true;
  e.flash = 0.12;
  e.squashT = 0.14; // 受击挤压: 底部锚定压扁(打击感)
  e.kx += kx; e.ky += ky;
  if (src) game.dmgStats[src] = (game.dmgStats[src] || 0) + d; // 武器伤害统计
  addDmgNum(e.x, e.y - e.r, Math.round(d), crit ? '#ffd76a' : color, crit);
  if (crit) SFX.crit();
  if (e.hp <= 0) killEnemy(e);
}
/* —— 元素死亡协同 —— */
/* 感电链爆: 感电敌人死亡 → 闪电链跳至多 3 个邻近敌人(伤害逐跳衰减, 传递感电) */
function deathChainLightning(src) {
  let from = src, dmg = (18 + minute() * 8) * player.stats.might, jumped = 0;
  const hitSet = new Set([src]);
  for (let jump = 0; jump < 3; jump++) {
    let tgt = null, bd = 240 * 240;
    for (const e of enemies) {
      if (e.dead || hitSet.has(e)) continue;
      const d = dist2(from.x, from.y, e.x, e.y);
      if (d < bd) { bd = d; tgt = e; }
    }
    if (!tgt) break;
    arcs.push({ x1: from.x, y1: from.y, x2: tgt.x, y2: tgt.y, age: 0, seed: Math.random() * 99 });
    tgt.shockT = Math.max(tgt.shockT || 0, 0.5); // 传递感电(可再触发链爆)
    hitSet.add(tgt);
    game.chains++; jumped++;
    hitEnemy(tgt, dmg, '#b8e8ff', 0, 0, 'thunder');
    dmg *= 0.65;
    from = tgt;
  }
  if (jumped > 0 && game.chainDepth <= 1) SFX.crit(); // 链爆音效只在源头层播一次
}
/* 灼燃新星: 灼烧敌人死亡 → 引燃半径 110 内至多 4 个敌人 */
function deathFireNova(src) {
  const dps = 10 + minute() * 4, R2 = 110 * 110;
  let n = 0;
  for (const e of enemies) {
    if (e.dead || n >= 4) continue;
    if (dist2(src.x, src.y, e.x, e.y) < R2) {
      e.burn = Math.max(e.burn, 2.5);
      e.burnDps = Math.max(e.burnDps || 0, dps);
      e.burnTick = Math.min(e.burnTick || 0.45, 0.45);
      n++;
    }
  }
  if (n > 0) {
    game.novas++;
    rings.push({ x: src.x, y: src.y, age: 0, max: 110, color: '255,140,60' });
    burst(src.x, src.y, 12, '#ff9040', 200);
    if (game.chainDepth <= 1) SFX.fire();
  }
}
/* 冰晶碎裂: 冰缓敌人死亡 → 6 枚冰晶弹片飞散(命中伤害 + 减速) */
function deathFrostShatter(src) {
  const dmg = (12 + minute() * 5) * player.stats.might;
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * TAU + rand(-0.2, 0.2);
    bullets.push({ x: src.x, y: src.y, vx: Math.cos(a) * 340, vy: Math.sin(a) * 340,
      dmg, pierce: 1, kind: 'shard', life: 0.5, hitSet: new Set(), r: 5 });
  }
  game.shatters++;
  rings.push({ x: src.x, y: src.y, age: 0, max: 70, color: '160,220,255' });
  burst(src.x, src.y, 8, '#bfe6ff', 170);
}
function killEnemy(e) {
  e.dead = true;
  game.kills++;
  SFX.kill();
  // 深渊爆发充能: 击杀驱动(被动「终焉之息」加速)
  game.ultCharge = Math.min(ultMaxCharge(), game.ultCharge + player.stats.ultFlow);
  // 元素死亡协同: 元素压制下的敌人死亡触发连锁反应(深度保护防无限递归; 哥布林掉宝特判不参与)
  if (game.chainDepth < 4 && e.type !== 'goblin') {
    game.chainDepth++;
    try {
      if (e.shockT > 0) deathChainLightning(e);
      else if (e.burn > 0) deathFireNova(e);
      else if (e.slowT > 0) deathFrostShatter(e);
    } finally { game.chainDepth--; }
  }
  // 处决击杀: 濒血斩首演出(时间微凝 + 金芒 + "斩"字)
  if (e.executed) {
    game.executes++;
    game.hitStop = Math.max(game.hitStop, 0.06);
    addDmgNum(e.x, e.y - e.r - 14, '斩', '#ffd76a', true);
    burst(e.x, e.y - 4, 12, '#ffe9a0', 260);
    SFX.crit();
  }
  // 击杀里程碑: 公告 + 小奖励
  checkKillMilestone();
  burst(e.x, e.y, e.boss ? 46 : (e.elite ? 22 : 10), e.boss ? '#ff9a5e' : '#c9d8ff', e.boss ? 320 : 190);
  // 碎裂死亡: 按敌人类型喷溅旋转碎片(骨片/肉块/晶屑), 带重力抛物线
  {
    const DEBRIS = { slime: '#58c15a', bat: '#8a6fb8', charger: '#a8823f', skel: '#e8e4d8', wraith: '#8fa8d8', demon: '#e05555', bomber: '#ff7a4d', hexer: '#c06ef0', shade: '#5a4a78', goblin: '#7fc85a', spore: '#6cc452' };
    const col = DEBRIS[e.type] || '#c9d8ff';
    const n = e.boss ? 16 : (e.elite ? 10 : 6);
    for (let i = 0; i < n && particles.length < 300; i++) {
      const a = rand(0, TAU), sp = rand(70, e.boss ? 300 : 210);
      particles.push({
        x: e.x, y: e.y - e.r * 0.3, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - rand(30, 110),
        life: rand(0.45, 0.75), age: 0, r: rand(2.5, 5), color: col, grav: 340,
        shard: true, rot: rand(0, TAU), vrot: rand(-9, 9),
      });
    }
  }
  // 地面血迹留痕(渐隐)
  if (decals.length < 64) {
    decals.push({
      x: e.x, y: e.y, r: e.r * rand(0.9, 1.3), age: 0,
      life: e.boss ? 3.2 : (e.elite ? 1.8 : 1.1),
      seed: Math.random() * 100, elite: e.elite,
    });
  }
  // 腐沼孢母亡语: 分裂两枚孢芽(仅一代分裂; 孢芽更小更快, 弹射分离)
  if (e.type === 'spore' && !e.gen) {
    for (let i = 0; i < 2; i++) {
      const a = rand(0, TAU) + i * Math.PI;
      const sp = spawnEnemy('spore', e.x + Math.cos(a) * 16, e.y + Math.sin(a) * 16, false);
      if (sp) {
        sp.gen = 1;
        sp.r = Math.max(8, e.r * 0.62);
        sp.hp = sp.maxHp = Math.max(1, e.maxHp * 0.22);
        sp.dmg = e.dmg * 0.6;
        sp.spd = e.spd * 1.75;
        sp.xp = 1;
        sp.phSpd = 1.7;
        sp.kx = Math.cos(a) * 190; sp.ky = Math.sin(a) * 190;
      }
    }
    rings.push({ x: e.x, y: e.y, age: 0, max: 96, color: '138,222,110' });
    burst(e.x, e.y, 10, '#8ade6e', 220);
    SFX.shock();
  }
  // 灵魂升腾: 光华灵魂摇曳上升(小怪幽蓝 / 精英鎏金 / Boss 三重巨魂)
  {
    const col = e.boss ? '255,224,150' : (e.elite ? '255,214,120' : '157,240,255');
    const n = e.boss ? 3 : 1;
    for (let i = 0; i < n; i++) {
      souls.push({
        x: e.x + (i - (n - 1) / 2) * 20 + rand(-6, 6), y: e.y - 4 + rand(-4, 4),
        vx: rand(-6, 6), vy: e.boss ? -26 : rand(-48, -34),
        life: e.boss ? 2.2 : (e.elite ? 1.7 : 1.25),
        r: e.boss ? 7 : (e.elite ? 5 : 3.2),
        col, sway: rand(0, TAU), swayAmp: e.boss ? 26 : 18,
      });
    }
  }
  if (e.boss) {
    game.hitStop = 0.3;      // Boss 陨落: 慢动作定格
    game.slowmo = 1.5;       // 定格后接专属慢镜头: 时间流速 0.3 缓复
    game.whiteFlash = 0.55;  // 白闪冲击
    game.shake = Math.min(26, game.shake + 18);
    SFX.bossDie();
    // 三重延迟冲击环(层层扩散的陨落余波)
    rings.push({ x: e.x, y: e.y, age: 0, max: 260, color: '255,190,110' });
    rings.push({ x: e.x, y: e.y, age: -0.18, max: 340, color: '255,160,80' });
    rings.push({ x: e.x, y: e.y, age: -0.4, max: 430, color: '255,220,160' });
    // 残躯溶解余烬: Boss 配色光尘缓缓升腾
    for (let i = 0; i < 14 && particles.length < 300; i++) {
      particles.push({ x: e.x + rand(-e.r * 0.6, e.r * 0.6), y: e.y + rand(-e.r * 0.5, e.r * 0.5),
        vx: rand(-40, 40), vy: rand(-70, -20), life: rand(1.0, 1.8), age: 0, r: rand(2, 4.5),
        color: e.color, grav: -26 });
    }
    // Boss 击杀奖励: 全屏回血 25%
    const heal = Math.round(player.stats.maxHp * 0.25);
    player.hp = Math.min(player.stats.maxHp, player.hp + heal);
    addDmgNum(player.x, player.y - 30, '+' + heal, '#6fe07a', true);
    SFX.heal();
    dropGems(e.x, e.y, e.final ? 320 : 160);
    dropPotion(e.x, e.y); if (!e.final) dropPotion(e.x, e.y);
    dropCoins(e.x, e.y, Math.round((e.final ? 20 : 10) * (1 + 0.06 * meta.up.luck)));
    if (e.final) { victory(); return; }
    chests.push({ x: e.x, y: e.y, bob: rand(0, TAU) }); // 陨落掉落宝箱
    announce(e.name + ' · 陨落');
  } else {
    if (e.elite) game.hitStop = 0.05; // 精英: 轻微顿帧
    if (e.type === 'goblin') { // 哥布林: 豪华掉落(宝箱 + 金币雨)
      game.hitStop = 0.1;
      dropCoins(e.x, e.y, randInt(14, 18));
      chests.push({ x: e.x, y: e.y, bob: rand(0, TAU) });
      dropGems(e.x, e.y, 45);
      announce('宝 藏 到 手 !');
      SFX.chest();
      rings.push({ x: e.x, y: e.y, age: 0, max: 220, color: '255,215,106' });
    } else {
      // 双词缀精英: 经验掉落翻倍(与血月叠加)
      dropGems(e.x, e.y, e.xp * (game.bloodMoonT > 0 ? 2 : 1) * (e.affix2 ? 2 : 1));
      if (e.elite) {
        if (Math.random() < 0.3) dropPotion(e.x, e.y);
        if (e.affix2) { if (Math.random() < 0.5) dropRelic(e.x, e.y); if (Math.random() < 0.5) dropPotion(e.x, e.y); } // 双词缀: 额外掉落
        else if (e.affix && Math.random() < 0.22) dropRelic(e.x, e.y); // 词缀精英: 掉落时之沙漏
      } else if (e.type === 'demon' && Math.random() < 0.08) dropPotion(e.x, e.y);
      else if (e.type === 'charger' && Math.random() < 0.05) dropPotion(e.x, e.y);
      // 金币掉落: 精英保底 2-3 枚(双词缀 5-6 枚), 小怪 2.2% 概率(受幸运加成; 血月翻倍)
      if (e.elite) dropCoins(e.x, e.y, e.affix2 ? randInt(5, 6) : randInt(2, 3));
      else if (Math.random() < 0.022 * (1 + 0.06 * meta.up.luck) * (game.bloodMoonT > 0 ? 2 : 1)) dropCoins(e.x, e.y, 1);
    }
    // 爆裂词缀: 亡语 8 向弹幕(双词缀精英 12 向, 弹速更高)
    if (e.affix === 'volatile' || e.affix2 === 'volatile') {
      const n = e.affix2 ? 12 : 8, spd2 = e.affix2 ? 245 : 210;
      for (let i = 0; i < n; i++) {
        const a = i / n * TAU;
        ebullets.push({ x: e.x, y: e.y, vx: Math.cos(a) * spd2, vy: Math.sin(a) * spd2, life: 2.6, r: 8 });
      }
      rings.push({ x: e.x, y: e.y, age: 0, max: 130, color: '255,150,60' });
      SFX.fire();
    }
  }
}
/* Boss 宝箱: 随机豪华奖励 */
function openChest(c) {
  const roll = Math.random();
  let name, fn;
  if (roll < 0.30) { // 生命涌泉
    name = '生命涌泉';
    const heal = Math.round(player.stats.maxHp * 0.4);
    player.hp = Math.min(player.stats.maxHp, player.hp + heal);
    addDmgNum(player.x, player.y - 30, '+' + heal, '#6fe07a', true);
    fn = () => burst(c.x, c.y, 22, '#6fe07a', 240);
  } else if (roll < 0.55) { // 黄金雨
    name = '黄金雨';
    fn = () => dropCoins(c.x, c.y, 25);
  } else if (roll < 0.80) { // 经验洪流
    name = '经验洪流';
    fn = () => dropGems(c.x, c.y, 90);
  } else { // 武器精进: 随机已持有武器 +1 级
    const ids = Object.keys(player.weapons).filter(id => {
      const w = player.weapons[id];
      return !w.evoed && w.lv < WEAPON_DEFS[id].max;
    });
    if (ids.length) {
      name = '武器精进';
      const id = ids[randInt(0, ids.length - 1)];
      fn = () => { player.weapons[id].lv++; renderWeaponBar(); };
    } else { // 全满级 → 回退治疗
      name = '生命涌泉';
      const heal = Math.round(player.stats.maxHp * 0.4);
      player.hp = Math.min(player.stats.maxHp, player.hp + heal);
      addDmgNum(player.x, player.y - 30, '+' + heal, '#6fe07a', true);
      fn = () => burst(c.x, c.y, 22, '#6fe07a', 240);
    }
  }
  announce('宝 箱 开 启 · ' + name);
  SFX.chest();
  game.hitStop = 0.12;
  rings.push({ x: c.x, y: c.y, age: 0, max: 200, color: '255,215,106' });
  burst(c.x, c.y, 26, '#ffd76a', 300);
  fn();
}
/* 爆弹魔菇自爆: 波及玩家与敌群, 可触发连锁殉爆 */
function explodeBomber(e) {
  e.dead = true;
  const R = 118;
  burst(e.x, e.y, 24, '#ff7a4d', 320);
  rings.push({ x: e.x, y: e.y, age: 0, max: R + 26, color: '255,122,77' });
  game.shake = Math.min(14, game.shake + 7);
  SFX.nova();
  if (dist2(e.x, e.y, player.x, player.y) < (R + 13) ** 2) damagePlayer(e.dmg, e.x, e.y);
  for (const o of enemies) { // 友伤: 引爆同类与近敌, 连锁殉爆
    if (o.dead || o === e) continue;
    if (dist2(e.x, e.y, o.x, o.y) < (R + o.r) ** 2) {
      const a = Math.atan2(o.y - e.y, o.x - e.x);
      hitEnemy(o, e.dmg * 0.9, '#ff7a4d', Math.cos(a) * 220, Math.sin(a) * 220);
    }
  }
}
/* 完美闪避: 冲刺无敌帧内穿过攻击判定 → 慢动作定格 + 1s 全伤害 +45% + 冷却返还 */
function triggerPerfectDodge() {
  const P = player;
  game.perfectT = 1.0;
  game.perfectCd = 0.4;
  game.perfects++;
  game.hitStop = 0.16;                    // 子弹时间定格
  P.dashCd *= 0.4;                        // 冷却返还: 鼓励连续进攻
  addDmgNum(P.x, P.y - 34, '完美闪避!', '#ffffff', true);
  rings.push({ x: P.x, y: P.y, age: 0, max: 190, color: '255,255,255' });
  burst(P.x, P.y, 16, '#ffffff', 260);
  SFX.guard();
}
/* 元素超载: 灼烧与感电共存于同一敌人 → 紫电爆震(单体爆发 + 范围溅射) */
function triggerOverload(e) {
  const base = (e.burnDps * 3.2 + 18) * player.stats.react;
  const R = 110;
  e.burn = 0; e.shockT = 0; e.olCd = 1.8; // 引爆后元素耗尽, 短暂免疫再爆
  game.overloads++;
  rings.push({ x: e.x, y: e.y, age: 0, max: R + 30, color: '210,155,255' });
  bolts.push({ x: e.x, y: e.y, age: 0, seed: Math.random() * 100, evo: true }); // 电弧表现
  burst(e.x, e.y, 18, '#d29bff', 300);
  burst(e.x, e.y, 10, '#ff8a3d', 220); // 灼焰余烬
  game.shake = Math.min(12, game.shake + 4);
  SFX.zap(); SFX.nova();
  addDmgNum(e.x, e.y - e.r - 10, '超载', '#d29bff', true);
  hitEnemy(e, base, '#d29bff', 0, 0, 'overload');
  for (const o of enemies) { // 溅射: 波及近敌并击退
    if (o.dead || o === e) continue;
    if (dist2(e.x, e.y, o.x, o.y) < (R + o.r) ** 2) {
      const a = Math.atan2(o.y - e.y, o.x - e.x);
      hitEnemy(o, base * 0.55, '#d29bff', Math.cos(a) * 200, Math.sin(a) * 200, 'overload');
    }
  }
}
/* 元素超导: 冰缓与感电共存于同一敌人 → 冰电爆裂(单体爆发 + 周遭「脆化」易伤) */
function triggerSuperconduct(e) {
  const m = minute();
  const base = (16 + 6 * m) * player.stats.might * player.stats.react;
  const R = 130;
  e.shockT = 0; e.slowT = 0; e.scCd = 2.6; // 引爆后双元素耗尽, 短暂免疫再爆
  game.superconducts++;
  arcs.push({ x1: e.x, y1: e.y - 8, x2: e.x + rand(-34, 34), y2: e.y - rand(22, 46), age: 0, seed: Math.random() * 99 });
  arcs.push({ x1: e.x, y1: e.y + 4, x2: e.x + rand(-44, 44), y2: e.y + rand(-12, 26), age: 0, seed: Math.random() * 99 });
  rings.push({ x: e.x, y: e.y, age: 0, max: R, color: '140,220,255' });
  burst(e.x, e.y, 12, '#9fe8ff', 250);
  burst(e.x, e.y, 6, '#e8f8ff', 180); // 冰晶碎屑
  game.shake = Math.min(12, game.shake + 3);
  SFX.shock();
  addDmgNum(e.x, e.y - e.r - 10, '超导', '#9fe8ff', true);
  hitEnemy(e, base, '#9fe8ff', 0, 0, 'superconduct'); // 先结算爆发(脆化只增益后续伤害, 不自肥)
  e.brittleT = Math.max(e.brittleT || 0, 4);
  for (const o of enemies) { // 波及近敌: 附着脆化(受伤 +25%, 4s)
    if (o.dead || o === e) continue;
    if (dist2(e.x, e.y, o.x, o.y) < R * R) o.brittleT = Math.max(o.brittleT || 0, 4);
  }
}
/* 元素蒸爆: 灼烧与冰缓共存于同一敌人 → 白汽爆裂(范围伤害 + 元素扩散) */
function triggerVaporize(e) {
  const m = minute();
  const base = (e.burnDps * 2.6 + 14 + 5 * m) * player.stats.might * player.stats.react;
  const R = 150;
  e.burn = 0; e.slowT = 0; e.vpCd = 2.2; // 引爆后双元素耗尽, 短暂免疫再爆
  game.vaporizes++;
  rings.push({ x: e.x, y: e.y, age: 0, max: R, color: '232,244,255' });
  burst(e.x, e.y, 14, '#e8f4ff', 260);
  burst(e.x, e.y, 8, '#bcd8e8', 200); // 蒸汽凝珠
  game.shake = Math.min(10, game.shake + 3);
  SFX.nova();
  addDmgNum(e.x, e.y - e.r - 10, '蒸爆', '#e8f4ff', true);
  hitEnemy(e, base, '#e8f4ff', 0, 0, 'vaporize');
  for (const o of enemies) { // 蒸汽扩散: 波及近敌(半伤 + 附着微弱双元素, 可续引超载/超导)
    if (o.dead || o === e) continue;
    if (dist2(e.x, e.y, o.x, o.y) < R * R) {
      o.slowT = Math.max(o.slowT || 0, 0.8);
      o.burn = Math.max(o.burn, 1.2);
      o.burnDps = Math.max(o.burnDps || 0, 8 + m * 3); o.burnTick = Math.min(o.burnTick || 0.45, 0.45);
      o.vpCd = Math.max(o.vpCd || 0, 0.9); // 扩散元素短暂封爆, 防连锁蒸爆滚雪球
      hitEnemy(o, base * 0.5, '#e8f4ff', 0, 0, 'vaporize');
    }
  }
}
/* 碎冰反应: 暴击命中冰缓敌人 → 冰壳崩裂(自身受创 + 邻敌溅射冰伤) */
function triggerFracture(e) {
  const m = minute();
  const dmg = (12 + 7 * m) * player.stats.might * player.stats.react;
  const R = 78;
  e.fracCd = 1.6; // 冰壳碎后需重新凝结, 防连爆
  game.fractures++;
  rings.push({ x: e.x, y: e.y, age: 0, max: R, color: '190,235,255' });
  burst(e.x, e.y, 12, '#dff2ff', 240); // 冰晶碎屑
  burst(e.x, e.y, 5, '#ffffff', 180);  // 霜白闪尘
  game.shake = Math.min(9, game.shake + 2);
  SFX.block(); // 清脆碎裂音
  addDmgNum(e.x, e.y - e.r - 10, '碎冰', '#bfe6ff', true);
  hitEnemy(e, dmg, '#bfe6ff', 0, 0, 'fracture');
  if (game.chainDepth < 2) { // 溅射深度保护: 防碎冰链式滚雪球
    game.chainDepth++;
    try {
      for (const o of enemies) {
        if (o.dead || o === e) continue;
        if (dist2(e.x, e.y, o.x, o.y) < R * R) {
          hitEnemy(o, dmg * 0.5, '#bfe6ff', 0, 0, 'fracture');
          o.slowT = Math.max(o.slowT || 0, 0.8); // 先伤后缓: 溅射当帧不再续爆
        }
      }
    } finally { game.chainDepth--; }
  }
}
/* 祭坛祝福: 随机触发(暴走/黄金雨/生命之泉/经验涌流) */
function activateShrine(s) {
  const roll = Math.random();
  let name;
  if (roll < 0.35) { // 暴走祝福: 12s 冷却锐减 + 移速提升
    name = '暴 走 祝 福';
    game.frenzyT = 12;
    SFX.rage();
  } else if (roll < 0.60) { // 黄金雨
    name = '黄 金 雨';
    dropCoins(s.x, s.y, randInt(16, 22));
    SFX.chest();
  } else if (roll < 0.82) { // 生命之泉
    name = '生 命 之 泉';
    const heal = Math.round(player.stats.maxHp * 0.35);
    player.hp = Math.min(player.stats.maxHp, player.hp + heal);
    addDmgNum(player.x, player.y - 30, '+' + heal, '#6fe07a', true);
    SFX.heal();
  } else { // 经验涌流
    name = '经 验 涌 流';
    dropGems(s.x, s.y, 70);
    SFX.levelup();
  }
  announce('祭 坛 · ' + name);
  game.hitStop = 0.1;
  rings.push({ x: s.x, y: s.y, age: 0, max: 240, color: '154,232,255' });
  burst(s.x, s.y, 26, '#9df0ff', 300);
}
/* 击杀里程碑: 阶段性公告 + 补给奖励 */
const KILL_MILESTONES = [50, 150, 300, 600];
function checkKillMilestone() {
  const next = KILL_MILESTONES.find(m => m === game.kills);
  if (next === undefined) return;
  announce(`斩杀 ${next} · 战 意 昂 扬`);
  SFX.levelup();
  // 奖励: 回血 12% + 金币雨(300 斩杀额外掉落时之沙漏)
  const heal = Math.round(player.stats.maxHp * 0.12);
  player.hp = Math.min(player.stats.maxHp, player.hp + heal);
  addDmgNum(player.x, player.y - 30, '+' + heal, '#6fe07a', true);
  dropCoins(player.x + rand(-60, 60), player.y + rand(-60, 60), Math.round(next / 25));
  if (next >= 300) dropRelic(player.x + rand(-50, 50), player.y + rand(-50, 50));
  rings.push({ x: player.x, y: player.y, age: 0, max: 220, color: '255,215,106' });
}
function damagePlayer(d, sx, sy) {
  if (player.inv > 0) {
    // 完美闪避: 冲刺无敌帧内被命中判定 → 触发慢动作 + 短暂增伤奖励
    if (player.dashT > 0 && game.perfectCd <= 0) triggerPerfectDodge();
    return;
  }
  if (player.stats.armor > 0) d = Math.max(1, d - player.stats.armor); // 石肤壁垒: 固定减伤
  player.hp -= d;
  // —— 濒死守护: 致命伤害时每局一次免死, 回复 35% 生命并震退敌群 ——
  if (player.hp <= 0 && player.guard > 0) {
    player.guard--;
    player.hp = Math.round(player.stats.maxHp * 0.35);
    player.inv = 2.4;
    player.guardFx = 2.4;
    game.whiteFlash = 0.7;
    game.hitStop = 0.22;
    game.shake = Math.min(22, game.shake + 14);
    game.hurtFlash = 0;
    announce('濒 死 守 护 · 不 屈 意 志');
    SFX.guard();
    rings.push({ x: player.x, y: player.y, age: 0, max: 320, color: '255,215,106' });
    burst(player.x, player.y, 30, '#ffd76a', 340);
    for (const e of enemies) {
      if (e.dead) continue;
      const dd = Math.hypot(e.x - player.x, e.y - player.y);
      if (dd < 320) {
        const a = Math.atan2(e.y - player.y, e.x - player.x), f = 1 - dd / 320;
        e.kx += Math.cos(a) * 640 * f;
        e.ky += Math.sin(a) * 640 * f;
        e.slowT = Math.max(e.slowT, 1.2);
      }
    }
    updateHUD(); // 立即刷新守护指示
    return;
  }
  player.inv = 0.6;
  game.hurtFlash = 0.4;
  // 受击方向指示: 记录伤害来源方位(世界坐标), 渲染层画弧光提示
  if (sx !== undefined) {
    game.hurtDir = Math.atan2(sy - player.y, sx - player.x);
    game.hurtDirT = 1.1;
  }
  game.shake = Math.min(16, game.shake + 7);
  SFX.hurt();
  addDmgNum(player.x, player.y - 26, Math.round(d), '#ff5b6e');
  if (player.hp <= 0) { player.hp = 0; beginDeathCinematic(); }
}
/* 死亡慢镜头: 时间凝滞 + 灵魂升腾 + 暗角收拢 + 「殁」字, 而后进入结算 */
function beginDeathCinematic() {
  if (game.dying > 0) return; // 已在演出中
  game.dying = 1.7;
  player.inv = 999;
  player.dashT = 0;
  game.ultWindup = 0;
  game.hitStop = Math.max(game.hitStop, 0.3);
  game.shake = Math.min(24, game.shake + 14);
  game.hurtFlash = 0;
  SFX.dead();
  burst(player.x, player.y, 36, '#ff5b6e', 300);
  souls.push({ x: player.x, y: player.y - 8, vy: -46, vx: 0, sway: rand(0, TAU), swayAmp: 14, r: 7, col: '220,235,255', life: 2.2 });
}

/* ---------------- 粒子 / 飘字 ---------------- */
function burst(x, y, n, color, spd) {
  for (let i = 0; i < n && particles.length < 280; i++) {
    const a = rand(0, TAU), s = rand(spd * 0.3, spd);
    particles.push({
      x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 40,
      life: rand(0.35, 0.75), age: 0, r: rand(1.5, 3.5), color, grav: 260,
    });
  }
}
function addDmgNum(x, y, v, color, big) {
  if (dmgNums.length > 48) dmgNums.shift();
  dmgNums.push({ x: x + rand(-8, 8), y, v, color, age: 0, s: big ? 2 : v >= 80 ? 1 : 0 });
}

/* ---------------- 武器发射 ---------------- */
function nearestEnemy(maxR) {
  let best = null, bd = maxR * maxR;
  for (const e of enemies) {
    if (e.dead) continue;
    const d = dist2(player.x, player.y, e.x, e.y);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}
function fireBullet(x, y, ang, st, evo) {
  bullets.push({
    x, y, vx: Math.cos(ang) * st.speed, vy: Math.sin(ang) * st.speed,
    dmg: st.dmg * player.stats.might, pierce: st.pierce, kind: 'bolt',
    life: 1.8, hitSet: new Set(), r: evo ? 11 : 9, evo: !!evo,
  });
}
function fireFireball(x, y, ang, st, evo) {
  bullets.push({
    x, y, vx: Math.cos(ang) * st.speed, vy: Math.sin(ang) * st.speed,
    dmg: st.dmg * player.stats.might, pierce: st.pierce, kind: 'fire',
    life: 1.6, hitSet: new Set(), r: evo ? 13 : 11, emT: 0, evo: !!evo,
  });
}
function fireArrow(x, y, ang, st, evo) {
  bullets.push({
    x, y, vx: Math.cos(ang) * st.speed, vy: Math.sin(ang) * st.speed,
    dmg: st.dmg * player.stats.might, pierce: st.pierce, kind: 'arrow',
    life: 1.7, hitSet: new Set(), r: evo ? 12 : 10, evo: !!evo,
    travel: 0, slow: st.frz, emT: 0, // 累计飞行里程(越远越痛) + 附着冰缓时长
  });
}

function updateWeapons(dt) {
  const P = player;
  // —— 奥术飞弹 ——
  if (P.weapons.bolt) {
    const w = P.weapons.bolt, st = wStats('bolt', w.lv);
    w.t -= dt;
    if (w.t <= 0) {
      const tgt = nearestEnemy(720);
      if (tgt) {
        w.t = st.cd * cdMul();
        const base = Math.atan2(tgt.y - P.y, tgt.x - P.x);
        for (let i = 0; i < st.n; i++) {
          const off = (i - (st.n - 1) / 2) * 0.16;
          fireBullet(P.x, P.y, base + off, st, w.evoed);
        }
        SFX.shoot();
      } else w.t = 0.12;
    }
  }
  // —— 烈焰喷涌 ——
  if (P.weapons.fire) {
    const w = P.weapons.fire, st = wStats('fire', w.lv);
    w.t -= dt;
    if (w.t <= 0) {
      const tgt = nearestEnemy(640);
      if (tgt) {
        w.t = st.cd * cdMul();
        const base = Math.atan2(tgt.y - P.y, tgt.x - P.x);
        const spread = 0.22;
        for (let i = 0; i < st.n; i++) {
          const off = (i - (st.n - 1) / 2) * spread;
          fireFireball(P.x, P.y, base + off, st, w.evoed);
        }
        SFX.fire();
      } else w.t = 0.12;
    }
  }
  // —— 霜华之弓 ——
  if (P.weapons.bow) {
    const w = P.weapons.bow, st = wStats('bow', w.lv);
    w.t -= dt;
    if (w.t <= 0) {
      const tgt = nearestEnemy(900);
      if (tgt) {
        w.t = st.cd * cdMul();
        const base = Math.atan2(tgt.y - P.y, tgt.x - P.x);
        for (let i = 0; i < st.n; i++) {
          const off = (i - (st.n - 1) / 2) * 0.3;
          fireArrow(P.x, P.y, base + off, st, w.evoed);
        }
        SFX.shoot();
      } else w.t = 0.15;
    }
  }
  // —— 守护环刃 ——
  if (P.weapons.orbit) {
    const w = P.weapons.orbit, st = wStats('orbit', w.lv);
    P.orbA += st.spd * dt;
    const R = st.r * P.stats.area;
    for (let i = 0; i < st.n; i++) {
      const a = P.orbA + i / st.n * TAU;
      const bx = P.x + Math.cos(a) * R, by = P.y + Math.sin(a) * R;
      for (const e of enemies) {
        if (e.dead || e.ocd > 0) continue;
        if (dist2(bx, by, e.x, e.y) < (e.r + 14) ** 2) {
          const ang = Math.atan2(e.y - P.y, e.x - P.x);
          hitEnemy(e, st.dmg * P.stats.might, '#c9d8ff', Math.cos(ang) * 130, Math.sin(ang) * 130, 'orbit');
          e.ocd = 0.4;
        }
      }
      // 环刃拦截: 击碎触碰的敌方弹幕(反制疫病弹/Boss火球/爆裂词缀弹幕)
      for (let j = ebullets.length - 1; j >= 0; j--) {
        const b = ebullets[j];
        if (dist2(bx, by, b.x, b.y) < (b.r + 16) ** 2) {
          ebullets.splice(j, 1);
          burst(b.x, b.y, 5, b.hex ? '#c06ef0' : '#ff8f7a', 150);
        }
      }
    }
  }
  // —— 圣光领域 ——
  if (P.weapons.aura) {
    const w = P.weapons.aura, st = wStats('aura', w.lv);
    P.auraT -= dt;
    if (P.auraT <= 0) {
      P.auraT = st.tick * cdMul();
      const R = st.r * P.stats.area;
      let hitAny = false;
      for (const e of enemies) {
        if (e.dead) continue;
        if (dist2(P.x, P.y, e.x, e.y) < (R + e.r * 0.5) ** 2) {
          hitEnemy(e, st.dmg * P.stats.might, '#ffd76a', 0, 0, 'aura');
          if (st.slow) e.slowT = 0.35;
          hitAny = true;
        }
      }
      if (hitAny) P.auraPulse = 1;
    }
    if (st.slow) {
      const R = st.r * P.stats.area;
      for (const e of enemies) {
        if (!e.dead && dist2(P.x, P.y, e.x, e.y) < R * R) e.slowT = Math.max(e.slowT, 0.1);
      }
    }
  }
  // —— 霜寒新星 ——
  if (P.weapons.frost) {
    const w = P.weapons.frost, st = wStats('frost', w.lv);
    w.t -= dt;
    if (w.t <= 0) {
      const R = st.r * P.stats.area;
      // 有敌人在范围内才引爆
      const near = enemies.some(e => !e.dead && dist2(P.x, P.y, e.x, e.y) < (R + e.r) ** 2);
      if (near) {
        w.t = st.cd * cdMul();
        let hitAny = false;
        for (const e of enemies) {
          if (e.dead) continue;
          if (dist2(P.x, P.y, e.x, e.y) < (R + e.r * 0.6) ** 2) {
            const ang = Math.atan2(e.y - P.y, e.x - P.x);
            hitEnemy(e, st.dmg * P.stats.might, '#9ad8ff', Math.cos(ang) * 90, Math.sin(ang) * 90, 'frost');
            e.slowT = Math.max(e.slowT, st.frz);
            hitAny = true;
          }
        }
        if (hitAny) {
          SFX.nova();
          rings.push({ x: P.x, y: P.y, age: 0, max: R, color: w.evoed ? '230,246,255' : '154,216,255' });
          if (w.evoed) rings.push({ x: P.x, y: P.y, age: 0, max: R * 0.7, color: '154,216,255' });
          // 冰晶飞溅
          for (let i = 0; i < 14 && particles.length < 280; i++) {
            const a = rand(0, TAU);
            particles.push({ x: P.x + Math.cos(a) * R * 0.3, y: P.y + Math.sin(a) * R * 0.3, vx: Math.cos(a) * rand(60, 200), vy: Math.sin(a) * rand(60, 200), life: rand(0.25, 0.5), age: 0, r: rand(1.5, 3), color: w.evoed ? '#e6f6ff' : '#bfe8ff', grav: -20 });
          }
        }
      } else w.t = 0.15;
    }
  }
  // —— 雷霆之怒 ——
  if (P.weapons.thunder) {
    const w = P.weapons.thunder, st = wStats('thunder', w.lv);
    w.t -= dt;
    if (w.t <= 0) {
      const cands = enemies.filter(e => !e.dead && Math.abs(e.x - P.x) < W / 2 + 60 && Math.abs(e.y - P.y) < H / 2 + 60);
      if (cands.length) {
        w.t = st.cd * cdMul();
        const R = st.aoe * P.stats.area;
        for (let i = 0; i < st.n && cands.length; i++) {
          const e = cands.splice(randInt(0, cands.length - 1), 1)[0];
          bolts.push({ x: e.x, y: e.y, age: 0, seed: Math.random() * 100, evo: w.evoed });
          for (const e2 of enemies) {
            if (!e2.dead && dist2(e.x, e.y, e2.x, e2.y) < R * R) {
              hitEnemy(e2, st.dmg * P.stats.might, '#b8e8ff', 0, 0, 'thunder');
              e2.shockT = Math.max(e2.shockT || 0, 0.45); // 感电: 短暂麻痹
            }
          }
        }
        SFX.zap();
        game.shake = Math.min(12, game.shake + 3);
      } else w.t = 0.15;
    }
  }
  // —— 虚空漩涡 ——
  if (P.weapons.vortex) {
    const w = P.weapons.vortex, st = wStats('vortex', w.lv);
    w.t -= dt;
    if (w.t <= 0) {
      // 优先在敌人最密集处撕开裂隙(屏内), 否则不释放
      let best = null, bestN = 0;
      for (const e of enemies) {
        if (e.dead || Math.abs(e.x - P.x) > W / 2 || Math.abs(e.y - P.y) > H / 2) continue;
        let n = 0;
        for (const e2 of enemies) if (!e2.dead && dist2(e.x, e.y, e2.x, e2.y) < 130 * 130) n++;
        if (n > bestN) { bestN = n; best = e; }
      }
      if (best && bestN >= 2) {
        w.t = st.cd * cdMul();
        vortexes.push({ x: best.x, y: best.y, r: st.r * P.stats.area, life: st.dur, max: st.dur,
          pull: st.pull, dmg: st.dmg * P.stats.might, tickT: 0, evo: w.evoed, seed: Math.random() * 99 });
        SFX.warn();
        rings.push({ x: best.x, y: best.y, age: 0, max: st.r * P.stats.area, color: w.evoed ? '227,200,255' : '176,110,240' });
      } else w.t = 0.2;
    }
  }
  // —— 回响刃 ——
  if (P.weapons.echo) {
    const w = P.weapons.echo, st = wStats('echo', w.lv);
    w.t -= dt;
    if (w.t <= 0) {
      w.t = st.cd * cdMul();
      // 朝最近敌人掷出; 无敌人则朝随机方向试探
      let tgt = null, bd = Infinity;
      for (const e of enemies) {
        if (e.dead) continue;
        const d = dist2(P.x, P.y, e.x, e.y);
        if (d < bd) { bd = d; tgt = e; }
      }
      const baseA = tgt ? Math.atan2(tgt.y - P.y, tgt.x - P.x) : rand(0, TAU);
      for (let i = 0; i < st.n; i++) {
        const a = baseA + (i - (st.n - 1) / 2) * 0.55;
        echoes.push({
          x: P.x, y: P.y,
          vx: Math.cos(a) * st.speed, vy: Math.sin(a) * st.speed,
          spd: st.speed, dmg: st.dmg * P.stats.might, range: st.range * (0.9 + Math.random() * 0.2),
          dist: 0, phase: 0, ang: rand(0, TAU), spin: 13 + Math.random() * 3,
          mvx: Math.cos(a), mvy: Math.sin(a), hitSet: new Set(),
          evo: w.evoed, life: 6, done: false,
        });
      }
      SFX.shoot();
    }
  }
  // —— 符文地刺 ——
  if (P.weapons.spikes) {
    const w = P.weapons.spikes, st = wStats('spikes', w.lv);
    w.t -= dt;
    if (w.t <= 0) {
      // 在屏内敌人脚下铭刻符阵(独立预警后喷发)
      const pool = [];
      for (const e of enemies) {
        if (e.dead || e.goblin) continue;
        if (Math.abs(e.x - P.x) > W / 2 || Math.abs(e.y - P.y) > H / 2) continue;
        pool.push(e);
      }
      if (pool.length) {
        w.t = st.cd * cdMul();
        for (let i = 0; i < st.n && pool.length; i++) { // 依次抽取不重复目标
          const e = pool.splice(randInt(0, pool.length - 1), 1)[0];
          spikes.push({ x: e.x, y: e.y, r: st.r * P.stats.area, tele: st.tele, t: st.tele,
            dmg: st.dmg * P.stats.might, evo: w.evoed, seed: Math.random() * 99, hit: false, burstT: 0 });
        }
        SFX.windup(); // 铭刻低鸣
      } else w.t = 0.3;
    }
  }
}

/* ---------------- 更新逻辑 ---------------- */
function update(dt) {
  // 死亡慢镜头: 时间凝滞收束, 演出结束后进入结算
  if (game.dying > 0) {
    game.dying -= dt;
    dt *= 0.35;
    if (game.dying <= 0) { game.dying = 0; gameOver(); }
  }
  // 击杀顿帧: 短暂慢动作强调击杀瞬间(精英/Boss 陨落)
  if (game.hitStop > 0) { game.hitStop -= dt; dt *= 0.12; }
  else if (game.slowmo > 0) { game.slowmo -= dt; dt *= 0.3; } // Boss 陨落专属慢镜头: 定格后时间舒缓流淌
  game.time += dt;
  const P = player;

  // 输入轴
  let ax = (keys.d || keys.arrowright ? 1 : 0) - (keys.a || keys.arrowleft ? 1 : 0);
  let ay = (keys.s || keys.arrowdown ? 1 : 0) - (keys.w || keys.arrowup ? 1 : 0);
  if (joy.active && (joy.dx || joy.dy)) { ax = joy.dx; ay = joy.dy; }
  if (game.dying > 0) { ax = 0; ay = 0; } // 死亡演出: 锁定操作
  const len = Math.hypot(ax, ay);
  if (len > 1) { ax /= len; ay /= len; }
  P.moving = len > 0.15;
  if (len > 0.15) { const nl = Math.hypot(ax, ay) || 1; P.lastDx = ax / nl; P.lastDy = ay / nl; } // 记录移动方向供冲刺用
  if (Math.abs(ax) > 0.2) P.face = ax > 0 ? 1 : -1;
  if (P.moving) P.walk += dt;
  // 移动扬尘
  P.dustT -= dt;
  if (P.moving && P.dustT <= 0 && particles.length < 280) {
    P.dustT = 0.11;
    particles.push({ x: P.x - ax * 10 + rand(-4, 4), y: P.y + 15, vx: -ax * 26 + rand(-8, 8), vy: rand(-16, -4), life: rand(0.3, 0.55), age: 0, r: rand(1.8, 3.2), color: '#6a6552', grav: -12 });
  }
  const pSpd = P.stats.speed * (game.frenzyT > 0 ? 1.18 : 1) * (P.chillT > 0 ? 0.55 : 1); // 暴走移速↑ / 冰缓词缀: 移速 -45%
  P.x += ax * pSpd * dt;
  P.y += ay * pSpd * dt;
  // 冰缓状态: 霜屑环绕 + 倒计时
  if (P.chillT > 0) {
    P.chillT = Math.max(0, P.chillT - dt);
    if (Math.random() < 0.5 && particles.length < 280) {
      particles.push({ x: P.x + rand(-12, 12), y: P.y + rand(-8, 12), vx: rand(-12, 12), vy: rand(-24, -6), life: 0.3, age: 0, r: rand(1.2, 2.2), color: '#bfe6ff', grav: -10 });
    }
  }
  // 移动尘土足迹: 脚后淡色尘痕(与扬尘互补, 更细腻)
  P.stepT -= dt;
  if (P.moving && P.stepT <= 0 && particles.length < 290) {
    P.stepT = 0.16;
    particles.push({ x: P.x - P.lastDx * 14 + rand(-3, 3), y: P.y + 14 + rand(-2, 2), vx: rand(-6, 6), vy: rand(-8, -2), life: 0.4, age: 0, r: rand(1, 2), color: '#4a4438', grav: -6, fade: true });
  }
  // 暴走祝福: 金色气浪拖尾
  if (game.frenzyT > 0) {
    game.frenzyT = Math.max(0, game.frenzyT - dt);
    if (P.moving && Math.random() < 0.55 && particles.length < 280) {
      particles.push({ x: P.x + rand(-6, 6), y: P.y + rand(-2, 10), vx: -ax * 70 + rand(-20, 20), vy: rand(-34, -8), life: 0.3, age: 0, r: rand(1.6, 3), color: '#ffd76a', grav: -20 });
    }
  }
  if (P.inv > 0) P.inv -= dt;
  // —— 深渊爆发: 被动充能 + 引导汇聚演出 ——
  if (game.dying <= 0) {
    if (game.ultCharge < ultMaxCharge()) game.ultCharge = Math.min(ultMaxCharge(), game.ultCharge + dt * 1.8 * P.stats.ultFlow);
    if (game.ultWindup > 0) {
      game.ultWindup -= dt;
      if (Math.random() < 0.85 && particles.length < 280) { // 暗紫粒子向主角收缩
        const a = rand(0, TAU), d = rand(120, 240);
        const px = P.x + Math.cos(a) * d, py = P.y + Math.sin(a) * d;
        particles.push({ x: px, y: py, vx: (P.x - px) * 3.4, vy: (P.y - py) * 3.4, life: 0.3, age: 0, r: rand(1.6, 3), color: Math.random() < 0.5 ? '#b06ef0' : '#e3c8ff', grav: 0 });
      }
      if (game.ultWindup <= 0) { game.ultWindup = 0; castUlt(); }
    }
  }
  P.guardFx = Math.max(0, P.guardFx - dt);
  P.auraPulse = Math.max(0, P.auraPulse - dt * 3);
  // —— 闪避冲刺 ——
  P.dashCd = Math.max(0, P.dashCd - dt);
  if (P.dashT > 0) {
    P.dashT -= dt;
    P.x += P.dashDx * P.stats.speed * 3.4 * dt;
    P.y += P.dashDy * P.stats.speed * 3.4 * dt;
    // 冲刺残影
    if (particles.length < 280) {
      particles.push({ x: P.x + rand(-3, 3), y: P.y + rand(-3, 3), vx: 0, vy: 0, life: 0.22, age: 0, r: 11, color: '#9df0ff', grav: 0, ghost: true });
    }
  }

  updateWeapons(dt);
  updateDirector(dt);

  // —— 敌人 ——
  for (const e of enemies) {
    if (e.dead) continue;
    e.ph = (e.ph + dt * e.phSpd) % 1;
    e.flash = Math.max(0, e.flash - dt); if (e.flash < 0.004) e.flash = 0; // 吸附归零: 防浮点残渣生成科学计数法 alpha
    e.squashT = Math.max(0, (e.squashT || 0) - dt);
    e.hitCd = Math.max(0, e.hitCd - dt);
    e.ocd = Math.max(0, e.ocd - dt);
    e.slowT = Math.max(0, e.slowT - dt);
    e.shockT = Math.max(0, (e.shockT || 0) - dt);
    // 再生词缀: 每秒回复 2.5% 最大生命(惩罚放任不管, 奖励集火)
    if ((e.affix === 'regen' || e.affix2 === 'regen') && e.hp < e.maxHp) {
      e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.025 * dt);
      if (Math.random() < 0.16 && particles.length < 280) {
        particles.push({ x: e.x + rand(-e.r * 0.7, e.r * 0.7), y: e.y + rand(-4, e.r * 0.5), vx: rand(-6, 6), vy: rand(-26, -12), life: 0.5, age: 0, r: rand(1.4, 2.6), color: '#6ef09a', grav: -14 });
      }
    }
    // 腐沼孢母: 毒泡拖尾(美术提示)
    if (e.type === 'spore') {
      e.trailT = (e.trailT || 0) - dt;
      if (e.trailT <= 0) {
        e.trailT = 0.26;
        if (particles.length < 280) {
          particles.push({ x: e.x + rand(-e.r * 0.5, e.r * 0.5), y: e.y + rand(-4, e.r * 0.4),
            vx: rand(-8, 8), vy: rand(-22, -8), life: rand(0.5, 0.9), age: 0, r: rand(1.6, 3),
            color: Math.random() < 0.5 ? '#8ade6e' : '#5fbf4c', grav: -12 });
        }
      }
    }
    // 魔盾词缀: 护盾破碎后 7s 重铸(重铸瞬间青光汇聚)
    if (e.affix === 'warded' || e.affix2 === 'warded') {
      if (e.shield <= 0) {
        e.shieldCd -= dt;
        if (e.shieldCd <= 0) {
          e.shield = 1;
          e.shieldCd = 7;
          burst(e.x, e.y, 8, '#96e1ff', 150);
          rings.push({ x: e.x, y: e.y, age: 0, max: e.r * 1.8, color: '150,225,255' });
          SFX.shieldUp();
        } else if (Math.random() < 0.1 && particles.length < 280) {
          // 重铸蓄能: 微光向内汇聚
          const a = rand(0, TAU);
          particles.push({ x: e.x + Math.cos(a) * e.r * 1.6, y: e.y + Math.sin(a) * e.r * 1.6, vx: -Math.cos(a) * 60, vy: -Math.sin(a) * 60, life: 0.35, age: 0, r: 1.6, color: '#96e1ff', grav: 0 });
        }
      }
    }
    // 灼烧 DoT: 每 0.45s 结算一次
    if (e.burn > 0) {
      e.burn -= dt;
      e.burnTick -= dt;
      if (e.burnTick <= 0 && !e.dead) {
        e.burnTick = 0.45;
        const d = e.burnDps * 0.45;
        e.hp -= d;
        game.dmgStats.fire = (game.dmgStats.fire || 0) + d; // 灼烧归入火系
        addDmgNum(e.x + rand(-6, 6), e.y - e.r, Math.round(d), '#ff9a4d');
        if (e.hp <= 0) { killEnemy(e); continue; }
      }
      // 燃烧火星
      if (Math.random() < 0.3 && particles.length < 280) {
        particles.push({ x: e.x + rand(-e.r * 0.6, e.r * 0.6), y: e.y - rand(0, e.r * 0.6), vx: rand(-10, 10), vy: rand(-42, -20), life: 0.3, age: 0, r: rand(1.5, 3), color: '#ff8a3d', grav: -30 });
      }
    }
    // 感电: 麻痹定身(仍受击退与灼烧)
    const shocked = e.shockT > 0;
    if (shocked) {
      // 电击抖动 + 电弧粒子
      if (Math.random() < 0.4 && particles.length < 280) {
        particles.push({ x: e.x + rand(-e.r, e.r), y: e.y + rand(-e.r * 0.8, e.r * 0.4), vx: rand(-20, 20), vy: rand(-30, -6), life: 0.18, age: 0, r: rand(1, 2.4), color: '#b8e8ff', grav: 0 });
      }
    }
    // 元素超载: 灼烧与感电共存 → 紫电爆震(单体爆发 + 溅射)
    if (e.olCd > 0) e.olCd -= dt;
    else if (e.burn > 0 && e.shockT > 0) {
      triggerOverload(e);
      if (e.dead) continue;
    }
    // 元素超导: 冰缓与感电共存 → 冰电爆裂(脆化波及)
    if (e.scCd > 0) e.scCd -= dt;
    else if (e.shockT > 0 && e.slowT > 0) {
      triggerSuperconduct(e);
      if (e.dead) continue;
    }
    // 元素蒸爆: 灼烧与冰缓共存 → 白汽爆裂(范围伤害 + 元素扩散)
    if (e.vpCd > 0) e.vpCd -= dt;
    else if (e.burn > 0 && e.slowT > 0) {
      triggerVaporize(e);
      if (e.dead) continue;
    }
    if (e.brittleT > 0) e.brittleT = Math.max(0, e.brittleT - dt); // 脆化易伤计时
    if (e.fracCd > 0) e.fracCd -= dt; // 碎冰冷却: 冰壳重凝
    // —— 宝藏哥布林: 背向玩家逃窜, 沿途撒币, 倒计时结束遁地逃脱 ——
    if (e.type === 'goblin') {
      e.life -= dt;
      if (e.life <= 0) {
        e.dead = true;
        burst(e.x, e.y, 16, '#8a7a5a', 160);
        addDmgNum(e.x, e.y - e.r, '遁地!', '#8a7a5a');
        continue;
      }
      let fx = e.x - P.x, fy = e.y - P.y;
      const fd = Math.hypot(fx, fy) || 1;
      fx /= fd; fy /= fd;
      const side = Math.sin(game.time * 3.2 + e.wob) * 0.5; // 侧向摆动, 路径飘忽
      const nx = fx - fy * side, ny = fy + fx * side;
      const nl = Math.hypot(nx, ny) || 1;
      const gspd = shocked ? 0 : e.spd * (e.slowT > 0 ? 0.72 : 1) * (game.slipT > 0 ? 0.45 : 1); // 时之沙漏: 哥布林同步迟滞(追猎窗口)
      e.x += (nx / nl) * gspd * dt + e.kx * dt;
      e.y += (ny / nl) * gspd * dt + e.ky * dt;
      e.kx *= Math.max(0, 1 - 7 * dt);
      e.ky *= Math.max(0, 1 - 7 * dt);
      // 撒币轨迹 + 金光尾迹
      e.coinT -= dt;
      if (e.coinT <= 0) { e.coinT = rand(0.7, 1.1); dropCoins(e.x, e.y, 1); }
      if (Math.random() < 0.5 && particles.length < 280) {
        particles.push({ x: e.x + rand(-6, 6), y: e.y - rand(0, 10), vx: rand(-14, 14), vy: rand(-30, -10), life: 0.4, age: 0, r: rand(1.4, 2.6), color: '#ffd76a', grav: -10 });
      }
      continue; // 无接触伤害, 跳过常规追击逻辑
    }
    // 朝玩家移动(蝙蝠带正弦摆动)
    let dx = P.x - e.x, dy = P.y - e.y;
    const d = Math.hypot(dx, dy) || 1;
    dx /= d; dy /= d;
    let spd = shocked ? 0 : e.spd * (e.slowT > 0 ? 0.72 : 1) * (game.bloodMoonT > 0 ? 1.18 : 1); // 血月: 敌潮提速
    if (e.type === 'bat') { // 侧向正弦摆动, 模拟飘忽飞行
      const side = Math.sin(game.time * 5 + e.wob) * 0.45;
      const nx = dx - dy * side, ny = dy + dx * side;
      const nl = Math.hypot(nx, ny) || 1;
      dx = nx / nl; dy = ny / nl;
    }
    if (e.ghost) { // 幽灵: 垂直正弦漂浮
      e.wob += dt * 2.2;
      spd *= 0.9 + Math.sin(e.wob) * 0.14;
      e.kx *= Math.max(0, 1 - 14 * dt); // 击退免疫: 极速衰减
      e.ky *= Math.max(0, 1 - 14 * dt);
    }
    // 普通恶魔: 中距离停下施法
    let hold = false;
    if (e.type === 'demon' && !e.boss) {
      e.fireT -= dt;
      if (d < 300 && e.fireT <= 0) {
        e.fireT = rand(2.8, 4.2);
        const a = Math.atan2(P.y - e.y, P.x - e.x);
        ebullets.push({ x: e.x, y: e.y, vx: Math.cos(a) * 210, vy: Math.sin(a) * 210, life: 4, r: 8 });
        SFX.fire();
        burst(e.x, e.y, 5, '#ff9040', 110);
      }
      if (d < 240) hold = e.fireT < 1.1 && e.fireT > 0; // 施法前摇停步
    }
    // 冲锋甲虫: 锁定→蓄力(定身预警)→直线突进→疲软 四段循环
    if (e.type === 'charger' && !shocked) {
      if (!e.chg) {
        e.chgCd -= dt;
        if (d < 430 && e.chgCd <= 0) { // 锁定目标方向并蓄力
          e.chg = 'wind'; e.chgT = 0.62;
          e.cdx = dx; e.cdy = dy;
          SFX.windup();
        }
      } else if (e.chg === 'wind') {
        spd = 0; e.chgT -= dt;
        if (e.chgT <= 0) { e.chg = 'dash'; e.chgT = 0.55; }
      } else if (e.chg === 'dash') {
        spd = e.spd * 5.2; dx = e.cdx; dy = e.cdy;
        e.chgT -= dt;
        if (Math.random() < 0.6 && particles.length < 280) { // 突进扬尘
          particles.push({ x: e.x - e.cdx * 12 + rand(-4, 4), y: e.y + rand(2, 10), vx: -e.cdx * 60 + rand(-14, 14), vy: rand(-24, -6), life: 0.34, age: 0, r: rand(1.6, 3), color: '#8a7a5a', grav: -20 });
        }
        if (e.chgT <= 0) { e.chg = 'rest'; e.chgT = 0.85; }
      } else { // rest: 突进后疲软减速
        spd = e.spd * 0.22; e.chgT -= dt;
        if (e.chgT <= 0) { e.chg = null; e.chgCd = rand(2.2, 3.4); }
      }
    }
    // 爆弹魔菇: 逼近→点燃引信(定身膨胀)→自爆
    if (e.type === 'bomber' && !shocked) {
      if (!e.fuseLit) {
        if (d < 150) { e.fuseLit = true; e.fuse = 1.25; SFX.windup(); }
      } else {
        spd *= 0.12; // 点燃后近乎定身, 膨胀待爆
        e.fuse -= dt;
        if (Math.random() < 0.5 && particles.length < 280) { // 引信火花
          particles.push({ x: e.x + rand(-4, 4), y: e.y - e.r * 1.1, vx: rand(-24, 24), vy: rand(-50, -16), life: 0.22, age: 0, r: rand(1, 2.2), color: '#ffb84d', grav: -20 });
        }
        if (e.fuse <= 0) { explodeBomber(e); continue; }
      }
    }
    // 疫病祭司: 拉开中距离游走, 蓄力后三连疫病弹(可被环刃拦截/冲刺无敌规避)
    if (e.type === 'hexer' && !shocked) {
      if (e.cast > 0) {
        spd = 0; // 蓄力定身
        e.cast -= dt;
        if (Math.random() < 0.45 && particles.length < 280) { // 法杖汇聚疫瘴
          particles.push({ x: e.x + rand(-9, 9), y: e.y - e.r * rand(0.5, 1.3), vx: rand(-10, 10), vy: rand(-14, -2), life: 0.24, age: 0, r: rand(1.4, 2.8), color: '#c06ef0', grav: 0 });
        }
        if (e.cast <= 0) { // 三连扇形疫病弹
          const base = Math.atan2(P.y - e.y, P.x - e.x);
          for (let i = -1; i <= 1; i++) {
            const a = base + i * 0.2;
            ebullets.push({ x: e.x, y: e.y - e.r * 0.5, vx: Math.cos(a) * 232, vy: Math.sin(a) * 232, life: 4, r: 8, hex: true });
          }
          SFX.fire();
          burst(e.x, e.y - e.r * 0.5, 7, '#c06ef0', 150);
          e.castCd = rand(2.4, 3.6);
        }
      } else {
        e.castCd -= dt;
        if (d < 360 && e.castCd <= 0) { e.cast = 0.8; SFX.windup(); }
        if (d < 200) { dx = -dx; dy = -dy; } // 太近: 后撤拉开距离
        else if (d < 300) {                   // 适距: 侧向游走保持压制位
          const side = Math.sin(game.time * 1.6 + e.wob) >= 0 ? 1 : -1;
          const nx = -dy * side, ny = dx * side;
          dx = nx; dy = ny;
          spd *= 0.55;
        }
      }
    }
    // 影刃刺客: 潜行追击→隐身(渐淡)→瞬移背后→蓄力预警→扇形背刺→硬直破绽 五段循环
    if (e.type === 'shade' && !shocked) {
      e.vT -= dt;
      if (e.vst === 'stalk') { // 潜行接近: 高速逼近
        spd *= 1.1;
        if (d < 340 && e.vT <= 0) { e.vst = 'veil'; e.vT = 0.5; SFX.windup(); }
      } else if (e.vst === 'veil') { // 隐身: 渐淡游走, 紫雾缠绕
        spd *= 0.4;
        if (Math.random() < 0.5 && particles.length < 280) {
          particles.push({ x: e.x + rand(-8, 8), y: e.y + rand(-8, 8), vx: rand(-16, 16), vy: rand(-24, -4), life: 0.3, age: 0, r: rand(1.4, 2.8), color: '#8a5ad0', grav: 0 });
        }
        if (e.vT <= 0) { // 瞬移至玩家侧背后
          const back = Math.atan2(-P.lastDy, -P.lastDx) + rand(-0.7, 0.7);
          const R = rand(58, 78);
          burst(e.x, e.y, 8, '#8a5ad0', 200);
          e.x = P.x + Math.cos(back) * R;
          e.y = P.y + Math.sin(back) * R;
          e.blinkA = 0.3; // 现身残影
          burst(e.x, e.y, 8, '#c06ef0', 200);
          e.vst = 'wind'; e.vT = 0.42;
          SFX.dash();
        }
      } else if (e.vst === 'wind') { // 出手预警: 定身蓄力
        spd = 0;
        if (e.vT <= 0) { // 背刺斩击: 扇形判定, 冲刺无敌帧可反制
          const ang = Math.atan2(P.y - e.y, P.x - e.x);
          slashes.push({ x: e.x, y: e.y, ang, age: 0, elite: e.elite });
          SFX.hit();
          const sd = Math.hypot(P.x - e.x, P.y - e.y);
          if (sd < 96) damagePlayer(e.dmg, e.x, e.y);
          game.shake = Math.min(10, game.shake + 3);
          e.vst = 'rest'; e.vT = 0.9;
        }
      } else { // rest: 出手后硬直, 破绽暴露(受伤 +30%, 见 hitEnemy)
        spd *= 0.25;
        if (e.vT <= 0) { e.vst = 'stalk'; e.vT = rand(1.8, 2.8); }
      }
      if (e.blinkA > 0) e.blinkA -= dt;
    }
    const slip = game.slipT > 0 ? 0.45 : 1; // 时之沙漏: 万物迟滞(玩家不受影响)
    e.x += (hold ? 0 : dx * spd * slip * dt) + e.kx * dt;
    e.y += (hold ? 0 : dy * spd * slip * dt) + e.ky * dt;
    e.kx *= Math.max(0, 1 - 7 * dt);
    e.ky *= Math.max(0, 1 - 7 * dt);
    // Boss: 狂暴二阶段 + 远程火球
    if (e.boss) {
      // 半血狂暴: 提速、加快施法、解锁环形弹幕
      if (!e.raged && e.hp < e.maxHp * 0.5) {
        e.raged = true;
        e.spd *= 1.32;
        e.novaT = 2.6;
        announce(e.name + ' · 狂 暴');
        SFX.rage();
        game.shake = Math.min(22, game.shake + 14);
        game.slowmo = Math.max(game.slowmo, 0.5); // 变身凝滞: 时间短暂放缓
        game.rageFlash = 0.6;                     // 血红闪屏
        rings.push({ x: e.x, y: e.y, age: 0, max: 320, color: '255,70,55' });
        rings.push({ x: e.x, y: e.y, age: 0, max: 200, color: '180,40,40' }); // 双重冲击环
        burst(e.x, e.y, 30, '#ff5040', 300);
        burst(e.x, e.y, 14, '#8a1020', 220); // 暗红血雾升腾
      }
      // 狂暴余烬: 周身持续飘散血色火星
      if (e.raged && particles.length < 260 && Math.random() < dt * 9) {
        particles.push({ x: e.x + rand(-e.r, e.r) * 0.8, y: e.y + rand(-6, 6), vx: rand(-14, 14), vy: rand(-75, -40), life: 0.7, age: 0, r: rand(1.5, 3), color: '#ff5540', grav: -18 });
      }
      e.fireT -= dt;
      if (e.fireT <= 0) {
        e.fireT = e.raged ? (e.final ? 1.5 : 2.0) : (e.final ? 2.1 : 2.9);
        const base = Math.atan2(P.y - e.y, P.x - e.x);
        const n = e.final ? 5 : 3;
        for (let i = 0; i < n; i++) {
          const a = base + (i - (n - 1) / 2) * 0.3;
          ebullets.push({
            x: e.x, y: e.y, vx: Math.cos(a) * (e.final ? 300 : 240), vy: Math.sin(a) * (e.final ? 300 : 240),
            life: 4, r: 10,
          });
        }
        SFX.fire();
      }
      // 狂暴环形弹幕
      if (e.raged) {
        e.novaT -= dt;
        if (e.novaT <= 0) {
          e.novaT = e.final ? 4.2 : 5.2;
          const n = e.final ? 14 : 10;
          for (let i = 0; i < n; i++) {
            const a = i / n * TAU + game.time;
            ebullets.push({ x: e.x, y: e.y, vx: Math.cos(a) * 185, vy: Math.sin(a) * 185, life: 4.5, r: 9 });
          }
          SFX.fire();
          rings.push({ x: e.x, y: e.y, age: 0, max: 190, color: '255,90,60' });
        }
      }
    }
    // 接触伤害(刺客隐身/蓄力阶段无接触判定, 威胁集中于背刺斩击)
    if (d < e.r + 15 && e.hitCd <= 0 && !(e.type === 'shade' && (e.vst === 'veil' || e.vst === 'wind'))) {
      const beforeInv = player.inv;
      damagePlayer(e.dmg, e.x, e.y);
      // 冰缓词缀: 命中玩家(非无敌抵消)附加减速
      if ((e.affix === 'chill' || e.affix2 === 'chill') && beforeInv <= 0) {
        player.chillT = Math.max(player.chillT, 2);
        burst(player.x, player.y - 8, 8, '#bfe6ff', 130);
        addDmgNum(player.x, player.y - 34, '冰 缓 !', '#9ad8ff', true);
      }
      // 嗜血词缀: 命中玩家(非无敌抵消)回复 10% 自身生命, 玫红粒子自玩家流向精英
      if ((e.affix === 'vamp' || e.affix2 === 'vamp') && beforeInv <= 0) {
        const heal = e.maxHp * ELITE_AFFIXES.vamp.vamp;
        e.hp = Math.min(e.maxHp, e.hp + heal);
        addDmgNum(e.x, e.y - e.r - 8, '+' + Math.round(heal), '#ff6a8c');
        for (let i = 0; i < 6 && particles.length < 300; i++) {
          const a = rand(0, TAU);
          particles.push({ x: player.x + Math.cos(a) * 14, y: player.y + Math.sin(a) * 14 - 10,
            vx: (e.x - player.x) * 2.1, vy: (e.y - player.y) * 2.1, life: 0.46, age: 0, r: rand(1.6, 3), color: '#ff6a8c', grav: 0 });
        }
      }
      e.hitCd = 1;
      // 轻微击退敌人自己, 避免持续贴脸
      e.x -= dx * 8; e.y -= dy * 8;
    }
  }
  enemies = enemies.filter(e => !e.dead);

  // —— 我方子弹 ——
  for (const b of bullets) {
    b.life -= dt;
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (b.kind === 'fire') {
      b.emT -= dt;
      if (b.emT <= 0 && particles.length < 280) {
        b.emT = 0.03;
        particles.push({ x: b.x + rand(-3, 3), y: b.y + rand(-3, 3), vx: rand(-20, 20), vy: rand(-30, 10), life: 0.3, age: 0, r: rand(2, 4), color: '#ff9040', grav: -60 });
      }
    }
    if (b.kind === 'arrow') { // 冰矢: 累计里程 + 寒霜尾迹
      b.travel += Math.hypot(b.vx, b.vy) * dt;
      b.emT -= dt;
      if (b.emT <= 0 && particles.length < 280) {
        b.emT = 0.04;
        particles.push({ x: b.x + rand(-3, 3), y: b.y + rand(-3, 3), vx: rand(-16, 16), vy: rand(-16, 16), life: 0.32, age: 0, r: rand(1.5, 3.2), color: b.evo ? '#dff4ff' : '#9ad8ff', grav: 0 });
      }
    }
    for (const e of enemies) {
      if (e.dead || b.life <= 0 || b.hitSet.has(e)) continue;
      if (dist2(b.x, b.y, e.x, e.y) < (e.r + b.r) ** 2) {
        b.hitSet.add(e);
        const bl = Math.hypot(b.vx, b.vy) || 1;
        if (b.kind === 'arrow') { // 距离增伤: 飞行越远, 锋刃越凛冽(最多 +80%)
          const mul = 1 + Math.min(0.8, b.travel / 700 * 0.8);
          hitEnemy(e, b.dmg * mul, '#9ad8ff', b.vx / bl * 160, b.vy / bl * 160, 'bow');
          e.slowT = Math.max(e.slowT || 0, b.slow); // 附着冰缓
          if (b.evo) { // 极夜凝霜: 寒霜之花绽放(范围冰缓 + 溅射)
            const R = 84;
            rings.push({ x: b.x, y: b.y, age: 0, max: R, color: '190,235,255' });
            burst(b.x, b.y, 10, '#dff4ff', 210);
            for (const o of enemies) {
              if (o.dead || o === e) continue;
              if (dist2(b.x, b.y, o.x, o.y) < R * R) {
                hitEnemy(o, b.dmg * 0.55, '#dff4ff', 0, 0, 'bow');
                o.slowT = Math.max(o.slowT || 0, 1);
              }
            }
          }
        } else {
          hitEnemy(e, b.dmg, b.kind === 'fire' ? '#ff8f4d' : b.kind === 'shard' ? '#bfe6ff' : '#57e8ff', b.vx / bl * 140, b.vy / bl * 140, b.kind === 'fire' ? 'fire' : b.kind === 'shard' ? 'frost' : 'bolt');
        }
        if (b.kind === 'fire') { // 灼烧: 持续火焰伤害
          e.burn = 2.6;
          e.burnDps = Math.max(e.burnDps || 0, b.dmg * 0.22);
        }
        if (b.kind === 'shard') e.slowT = Math.max(e.slowT || 0, 1); // 冰晶: 命中减速
        burst(b.x, b.y, 4, b.kind === 'fire' ? '#ff9040' : b.kind === 'shard' ? '#bfe6ff' : b.kind === 'arrow' ? '#9ad8ff' : '#57e8ff', 120);
        if (b.pierce > 0) b.pierce--;
        else { b.life = 0; break; }
      }
    }
  }
  bullets = bullets.filter(b => b.life > 0 && Math.abs(b.x - P.x) < 1100 && Math.abs(b.y - P.y) < 800);

  // —— 敌方火球 ——
  const slipB = game.slipT > 0 ? 0.45 : 1; // 时之沙漏: 弹幕同步迟滞
  for (const b of ebullets) {
    b.life -= dt;
    b.x += b.vx * slipB * dt; b.y += b.vy * slipB * dt;
    if (dist2(b.x, b.y, P.x, P.y) < (b.r + 13) ** 2) {
      damagePlayer(16 + minute() * 2, b.x, b.y);
      b.life = 0;
      burst(b.x, b.y, 8, b.hex ? '#c06ef0' : '#ff5040', 160);
    }
  }
  ebullets = ebullets.filter(b => b.life > 0);

  // —— 魂晶 ——
  game.comboT -= dt;
  if (game.comboT <= 0) game.combo = 0;
  // 连击狂热三档: 10(+10%) / 25(+20%) / 50(+30%) 全伤害递进
  const prevTier = game.feverTier;
  game.feverTier = game.combo >= 50 ? 3 : game.combo >= 25 ? 2 : game.combo >= 10 ? 1 : 0;
  game.feverOn = game.feverTier > 0;
  if (game.feverTier > prevTier && game.feverTier >= 2) {
    announce(game.feverTier === 3 ? '狂 热 巅 峰 !!' : '狂 热 升 温 !');
    SFX.rage();
    rings.push({ x: P.x, y: P.y, age: 0, max: 150 + game.feverTier * 40, color: '255,120,60' });
  }
  if (game.slipT > 0) game.slipT = Math.max(0, game.slipT - dt); // 时之沙漏倒计时
  if (game.perfectT > 0) game.perfectT = Math.max(0, game.perfectT - dt); // 完美闪避增伤窗口
  if (game.perfectCd > 0) game.perfectCd = Math.max(0, game.perfectCd - dt); // 完美闪避内部冷却
  if (game.bossIntro > 0) game.bossIntro = Math.max(0, game.bossIntro - dt); // Boss 登场演出计时
  for (const g of gems) {
    g.bob += dt * 3;
    // 弹跳散开
    g.x += g.vx * dt; g.y += g.vy * dt;
    g.vx *= Math.max(0, 1 - 4 * dt); g.vy *= Math.max(0, 1 - 4 * dt);
    const d2 = dist2(g.x, g.y, P.x, P.y);
    if (d2 < P.stats.magnet ** 2) {
      g.pull = Math.min(760, g.pull + 2400 * dt);
      const d = Math.sqrt(d2) || 1;
      g.x += (P.x - g.x) / d * g.pull * dt;
      g.y += (P.y - g.y) / d * g.pull * dt;
      // 磁吸拖尾光
      if (g.pull > 90) {
        g.trailT = (g.trailT || 0) - dt;
        if (g.trailT <= 0 && particles.length < 280) {
          g.trailT = 0.05;
          particles.push({ x: g.x, y: g.y, vx: 0, vy: 0, life: 0.22, age: 0, r: 2.4, color: '#57e8ff', grav: 0 });
        }
      }
    } else g.pull = 0;
    if (d2 < 24 * 24) {
      g.dead = true;
      // 连击加成: 每点连击 +3% 经验(最高 +42%)
      gainXP(Math.round(g.v * (1 + Math.min(game.combo, 14) * 0.03)));
      const prevCombo = game.combo;
      game.combo++;
      game.comboT = 0.9;
      // 连击狂热 I 档: 达到 10 连击触发(II/III 档在 update 主循环公告)
      if (prevCombo < 10 && game.combo >= 10) {
        announce('连 击 狂 热 !');
        SFX.rage();
        rings.push({ x: P.x, y: P.y, age: 0, max: 130, color: '255,215,106' });
      }
      SFX.gem(game.combo);
      burst(g.x, g.y, 3, '#57e8ff', 90);
    }
  }
  gems = gems.filter(g => !g.dead);

  // —— 金币 ——
  for (const c of coins) {
    c.bob += dt * 3;
    c.x += c.vx * dt; c.y += c.vy * dt;
    c.vx *= Math.max(0, 1 - 4 * dt); c.vy *= Math.max(0, 1 - 4 * dt);
    const d2 = dist2(c.x, c.y, P.x, P.y);
    if (d2 < P.stats.magnet ** 2) {
      c.pull = Math.min(760, c.pull + 2400 * dt);
      const d = Math.sqrt(d2) || 1;
      c.x += (P.x - c.x) / d * c.pull * dt;
      c.y += (P.y - c.y) / d * c.pull * dt;
      // 磁吸拖尾: 金色微光
      if (c.pull > 200 && particles.length < 280 && Math.random() < 0.5) {
        particles.push({ x: c.x, y: c.y, vx: rand(-12, 12), vy: rand(-12, 12), life: 0.28, age: 0, r: rand(1, 2.2), color: '#ffd76a', grav: 0 });
      }
    } else c.pull = 0;
    if (d2 < 24 * 24) {
      c.dead = true;
      game.goldRun += c.v;
      SFX.coin();
      burst(c.x, c.y, 3, '#ffd76a', 90);
    }
  }
  coins = coins.filter(c => !c.dead);

  // —— 药剂 ——
  for (const p of potions) {
    p.bob += dt * 3;
    if (dist2(p.x, p.y, P.x, P.y) < 26 * 26) {
      p.dead = true;
      const heal = Math.round(P.stats.maxHp * 0.3); // 按比例回血, 后期依旧有效
      P.hp = Math.min(P.stats.maxHp, P.hp + heal);
      SFX.heal();
      addDmgNum(P.x, P.y - 26, '+' + heal, '#6fe07a');
      burst(p.x, p.y, 12, '#ff7a9a', 150);
    }
  }
  potions = potions.filter(p => !p.dead);

  // —— Boss 宝箱 ——
  for (const c of chests) {
    c.bob += dt * 2.2;
    if (dist2(c.x, c.y, P.x, P.y) < 42 * 42) { c.dead = true; openChest(c); }
  }
  chests = chests.filter(c => !c.dead);

  // —— 神秘祭坛 ——
  for (const s of shrines) {
    s.life -= dt;
    s.ph += dt;
    if (dist2(s.x, s.y, P.x, P.y) < 38 * 38) { s.dead = true; activateShrine(s); }
  }
  shrines = shrines.filter(s => !s.dead && s.life > 0);

  // —— 时之沙漏(圣物): 拾取后全场敌人与弹幕迟滞 ——
  for (const r of relics) {
    r.bob += dt * 2.4;
    if (dist2(r.x, r.y, P.x, P.y) < 34 * 34) {
      r.dead = true;
      game.slipT = 5.5;
      announce('时 之 沙 漏 · 万 物 迟 滞');
      SFX.levelup();
      game.hitStop = 0.1;
      rings.push({ x: r.x, y: r.y, age: 0, max: 460, color: '87,232,255' });
      burst(r.x, r.y, 22, '#9df0ff', 300);
    }
  }
  relics = relics.filter(r => !r.dead);

  // —— 特效 ——
  for (const p of particles) { p.age += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += p.grav * dt; if (p.shard) p.rot += p.vrot * dt; }
  particles = particles.filter(p => p.age < p.life);
  for (const d of dmgNums) { d.age += dt; d.y -= 55 * dt; }
  dmgNums = dmgNums.filter(d => d.age < 0.8);
  for (const b of bolts) b.age += dt;
  bolts = bolts.filter(b => b.age < 0.28);
  for (const a of arcs) a.age += dt;
  arcs = arcs.filter(a => a.age < 0.22);
  for (const s of slashes) s.age += dt;
  slashes = slashes.filter(s => s.age < 0.2); // 刺客刀光
  for (const dc of decals) dc.age += dt;
  decals = decals.filter(dc => dc.age < dc.life);
  // 低血量心跳
  if (P.hp / P.stats.maxHp < 0.3 && P.hp > 0) {
    game.heartT -= dt;
    if (game.heartT <= 0) { game.heartT = 0.9; SFX.heart(); }
  } else game.heartT = 0;
  // 圣所再生: 持续回血
  if (P.stats.regen > 0 && P.hp > 0 && P.hp < P.stats.maxHp) {
    P.hp = Math.min(P.stats.maxHp, P.hp + P.stats.regen * dt);
  }
  // 受击方向指示衰减
  if (game.hurtDirT > 0) game.hurtDirT = Math.max(0, game.hurtDirT - dt);

  // 相机(视口左上角): 以玩家为中心, 朝移动方向少量前探
  // 前探量平滑趋近目标, 避免按键/松开瞬间相机瞬移导致人物跳动
  const lookK = Math.min(1, dt * 5.2);
  cam.lookX += (ax * 26 - cam.lookX) * lookK;
  cam.lookY += (ay * 26 - cam.lookY) * lookK;
  cam.x = P.x - W / 2 + cam.lookX;
  cam.y = P.y - H / 2 + cam.lookY;
  game.shake = Math.max(0, game.shake - dt * 26);
  game.hurtFlash = Math.max(0, game.hurtFlash - dt);
  game.whiteFlash = Math.max(0, game.whiteFlash - dt * 1.6);
  game.rageFlash = Math.max(0, game.rageFlash - dt * 1.2);
  // 冲击波光环推进
  for (const r of rings) r.age += dt;
  rings = rings.filter(r => r.age < 0.45);

  // 排队中的升级
  maybeOpenLevelUp();
  updateHUD();
}

/* ---------------- 经验 / 升级 ---------------- */
function gainXP(v) {
  player.xp += v;
  while (player.xp >= player.xpNeed) {
    player.xp -= player.xpNeed;
    player.level++;
    player.xpNeed = Math.floor(player.xpNeed * 1.24 + 5);
    game.pendingLv++;
  }
}
function maybeOpenLevelUp() {
  if (game.pendingLv > 0 && state === 'playing') openLevelUp();
}
function buildOptions() {
  const P = player, opts = [];
  for (const id in WEAPON_DEFS) {
    const w = P.weapons[id];
    if (w) {
      // 已有武器升级权重加倍, 构建 Build 更连贯
      if (w.lv < WEAPON_DEFS[id].max) opts.push({ type: 'w', id, lv: w.lv + 1, _wt: 2 });
      else if (!w.evoed) opts.push({ type: 'evo', id, _wt: 2 }); // 满级 → 终极进化选项
    }
    else opts.push({ type: 'w', id, lv: 1, isNew: true, _wt: 1 });
  }
  for (const id in PASSIVE_DEFS) {
    const cur = P.passives[id] || 0;
    if (cur < PASSIVE_DEFS[id].max) opts.push({ type: 'p', id, lv: cur + 1, _wt: 1 });
  }
  // 加权洗牌取 3(同一选项不重复出现)
  const bag = [];
  for (const o of opts) for (let i = 0; i < o._wt; i++) bag.push(o);
  for (let i = bag.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  const picked = [], seen = new Set();
  for (const o of bag) {
    const key = o.type + ':' + o.id;
    if (seen.has(key)) continue;
    seen.add(key); picked.push(o);
    if (picked.length === 3) break;
  }
  if (!picked.length) picked.push({ type: 'heal' });
  return picked;
}
function openLevelUp() {
  state = 'levelup';
  SFX.levelup();
  game.shake = Math.min(10, game.shake + 5);
  burst(player.x, player.y, 26, '#b06ef0', 260);
  renderCards(buildOptions());
  el.levelup.classList.remove('hidden');
}
function renderCards(opts) {
  el.cards.innerHTML = opts.map((o, i) => cardHTML(o, i)).join('');
  el.cards._opts = opts;
  // 多级连升时提示剩余次数
  const sub = el.cards.parentElement.querySelector('.sub');
  if (sub) sub.innerHTML = game.pendingLv > 1
    ? `选择一项祝福 &nbsp;( 还剩 ${game.pendingLv} 次 · 按 1 / 2 / 3 )`
    : '选择一项祝福 &nbsp;( 按 1 / 2 / 3 )';
}
function cardHTML(o, i) {
  let icon, name, color, badge, desc;
  if (o.type === 'w') {
    const d = WEAPON_DEFS[o.id];
    icon = d.icon; name = d.name; color = d.color;
    if (o.isNew) { badge = '<span class="c-badge new">新武器</span>'; desc = d.flavor; }
    else {
      badge = `<span class="c-badge">Lv ${o.lv - 1} → ${o.lv}</span>`;
      const cur = wStats(o.id, o.lv - 1), nxt = wStats(o.id, o.lv);
      desc = Object.keys(nxt)
        .filter(k => nxt[k] !== cur[k])
        .map(k => `${STAT_LABEL[k]} <b>${fmtStat(k, cur[k])} → ${fmtStat(k, nxt[k])}</b>`)
        .join('<br>') || d.flavor;
    }
  } else if (o.type === 'evo') {
    const d = WEAPON_DEFS[o.id], ev = WEAPON_EVOS[o.id];
    icon = d.icon; name = ev.name; color = ev.color;
    badge = '<span class="c-badge evo">终 极 进 化</span>';
    const cur = wStats(o.id, d.max);
    desc = ev.flavor + '<br>' + Object.keys(ev.st)
      .filter(k => ev.st[k] !== cur[k])
      .map(k => `${STAT_LABEL[k]} <b>${fmtStat(k, cur[k])} → ${fmtStat(k, ev.st[k])}</b>`)
      .join('<br>');
  } else if (o.type === 'p') {
    const d = PASSIVE_DEFS[o.id];
    icon = d.icon; name = d.name; color = d.color;
    badge = `<span class="c-badge">Lv ${o.lv} / ${d.max}</span>`;
    desc = `${d.per}<br>当前: <b>Lv ${o.lv - 1}</b> → <b>Lv ${o.lv}</b>`;
  } else {
    icon = 'vitality'; name = '生命之泉'; color = '#6fe07a';
    badge = '<span class="c-badge new">恢复</span>';
    desc = '立即恢复 <b>50</b> 点生命值。';
  }
  return `<div class="card" data-i="${i}" style="--c:${color}">
    <div class="c-icon">${ICONS[icon]}</div>
    <div class="c-name">${name}</div>
    ${badge}
    <div class="c-desc">${desc}</div>
    <div class="c-key">${i + 1}</div>
  </div>`;
}
function chooseByIndex(i) {
  const opts = el.cards._opts;
  if (!opts || !opts[i]) return;
  applyOption(opts[i]);
  SFX.choose();
  game.pendingLv--;
  if (game.pendingLv > 0) renderCards(buildOptions());
  else {
    el.levelup.classList.add('hidden');
    state = 'playing';
    player.inv = Math.max(player.inv, 0.8); // 选牌后短暂无敌
    // 升级冲击波: 击退周身敌人, 给喘息空间
    rings.push({ x: player.x, y: player.y, age: 0, max: 360, color: '176,110,240' });
    SFX.shock();
    for (const e of enemies) {
      if (e.dead) continue;
      const dx = e.x - player.x, dy = e.y - player.y, d = Math.hypot(dx, dy) || 1;
      if (d < 360) { const f = 1 - d / 360; e.kx += dx / d * 520 * f; e.ky += dy / d * 520 * f; }
    }
  }
}
function applyOption(o) {
  const P = player;
  if (o.type === 'w') {
    if (o.isNew) P.weapons[o.id] = { lv: 1, t: 0.3, evoed: false };
    else P.weapons[o.id].lv++;
  } else if (o.type === 'evo') {
    // 终极进化: 满级武器觉醒为终极形态
    P.weapons[o.id].lv = WEAPON_DEFS[o.id].max + 1;
    P.weapons[o.id].evoed = true;
    SFX.evo();
    // 觉醒全屏演出: 时间凝滞 + 白闪 + 重震 + 三重金环
    game.hitStop = 0.3;
    game.whiteFlash = 0.5;
    game.shake = Math.min(18, game.shake + 14);
    rings.push({ x: P.x, y: P.y, age: 0, max: 200, color: '255,215,106' });
    rings.push({ x: P.x, y: P.y, age: -0.12, max: 340, color: '255,235,180' });
    rings.push({ x: P.x, y: P.y, age: -0.24, max: 480, color: hexToRgbStr(WEAPON_EVOS[o.id].color) });
    burst(P.x, P.y, 46, WEAPON_EVOS[o.id].color, 380);
    announce(WEAPON_EVOS[o.id].name + ' · 觉 醒');
  } else if (o.type === 'p') {
    P.passives[o.id] = (P.passives[o.id] || 0) + 1;
    recomputeStats();
    if (o.id === 'vitality') P.hp = Math.min(P.stats.maxHp, P.hp + 30);
  } else if (o.type === 'heal') {
    P.hp = Math.min(P.stats.maxHp, P.hp + 50);
  }
  renderWeaponBar();
  updateHUD();
}

/* ---------------- HUD ---------------- */
let lastHUD = {};
function updateHUD() {
  const P = player;
  const set = (k, v) => { if (lastHUD[k] !== v) { lastHUD[k] = v; return v; } return null; };
  const v = set('xp', Math.round(100 * P.xp / P.xpNeed));
  if (v !== null) el['xp-fill'].style.width = v + '%';
  const lv = set('lv', P.level); if (lv !== null) el['lv-num'].textContent = lv;
  const t = set('t', fmtTime(game.time)); if (t !== null) el.timer.textContent = t;
  const k = set('k', game.kills); if (k !== null) el.kills.textContent = k;
  const gd = set('gd', game.goldRun);
  if (gd !== null) {
    el['gold-num'].textContent = gd;
    el['gold-num'].classList.remove('pop');
    void el['gold-num'].offsetWidth; // 重置动画
    el['gold-num'].classList.add('pop');
  }
  const hp = set('hp', Math.ceil(P.hp) + '/' + P.stats.maxHp);
  if (hp !== null) {
    el['hp-text'].textContent = hp;
    el['hp-fill'].style.width = (100 * P.hp / P.stats.maxHp) + '%';
  }
  // 低血量心跳: 血条 UI 脉动警示(≤30%)
  const low = P.hp / P.stats.maxHp <= 0.3;
  if (lastHUD.lowHp !== low) {
    lastHUD.lowHp = low;
    el['hp-wrap'] && el['hp-wrap'].classList.toggle('lowhp', low);
  }
  // Boss 血条
  const boss = enemies.find(e => e.boss && !e.dead);
  const bw = set('boss', boss ? boss.name + (boss.raged ? ' · 狂暴' : '') : '');
  if (bw !== null) {
    if (boss) {
      el['boss-wrap'].classList.remove('hidden');
      el['boss-name'].textContent = bw;
    } else el['boss-wrap'].classList.add('hidden');
  }
  if (boss) el['boss-fill'].style.width = Math.max(0, 100 * boss.hp / boss.maxHp) + '%';
  // 连击显示(≥5 触发; ≥10 狂热金焰)
  if (lastHUD.combo !== game.combo) {
    lastHUD.combo = game.combo;
    if (game.combo >= 5) {
      el['combo-wrap'].classList.add('show');
      el['combo-num'].textContent = 'x' + game.combo;
      el['combo-num'].classList.remove('pop');
      void el['combo-num'].offsetWidth; // 重置动画
      el['combo-num'].classList.add('pop');
    } else el['combo-wrap'].classList.remove('show');
  }
  const fever = game.feverTier;
  if (lastHUD.fever !== fever) {
    lastHUD.fever = fever;
    el['combo-wrap'].classList.toggle('fever', fever > 0);
    el['combo-wrap'].dataset.tier = String(fever); // 连击狂热档位(I/II/III 视觉递进)
  }
  // 濒死守护充能指示
  if (lastHUD.guard !== P.guard) {
    lastHUD.guard = P.guard;
    el['guard-ind'].classList.toggle('used', P.guard <= 0);
  }
  // 移动端冲刺按钮冷却遮罩(自下而上消退)
  const dcd = P.dashCd > 0 ? P.dashCd / 2.6 : 0;
  el['dash-cd'].style.height = (dcd * 100) + '%';
  el['dash-btn'].classList.toggle('ready', dcd <= 0);
  // 深渊爆发充能条(满时脉动提示)
  const ucd = Math.min(1, game.ultCharge / ultMaxCharge());
  el['ult-fill'].style.width = (ucd * 100) + '%';
  const uReady = ucd >= 0.999 && state === 'playing' && game.dying <= 0;
  if (lastHUD.ultReady !== uReady) {
    lastHUD.ultReady = uReady;
    el['ult-wrap'] && el['ult-wrap'].classList.toggle('ready', uReady);
    el['ult-btn'] && el['ult-btn'].classList.toggle('ready', uReady);
  }
}
function renderWeaponBar() {
  let html = '';
  for (const id in player.weapons) {
    const d = WEAPON_DEFS[id], w = player.weapons[id];
    const c = w.evoed ? WEAPON_EVOS[id].color : d.color;
    let pips = '';
    for (let i = 0; i < d.max; i++) pips += `<span class="pip${i < w.lv ? ' on' : ''}"></span>`;
    html += `<div class="wslot${w.evoed ? ' evo' : ''}" style="--c:${c}">${ICONS[d.icon]}<div class="pips">${pips}</div></div>`;
  }
  for (const id in player.passives) {
    const d = PASSIVE_DEFS[id], lv = player.passives[id];
    let pips = '';
    for (let i = 0; i < d.max; i++) pips += `<span class="pip${i < lv ? ' on' : ''}"></span>`;
    html += `<div class="wslot" style="--c:${d.color}">${ICONS[d.icon]}<div class="pips">${pips}</div></div>`;
  }
  el['weapon-bar'].innerHTML = html;
}
function announce(text) {
  el.announce.textContent = text;
  el.announce.classList.remove('show');
  void el.announce.offsetWidth; // 重置动画
  el.announce.classList.add('show');
}

/* ---------------- 绘制: 角色 ---------------- */
function drawPlayerRing() {
  // 主角脚下的脉冲定位环: 怪群中一眼锁定主角位置
  const P = player;
  const x = P.x - cam.x + shakeX(), y = P.y - cam.y + shakeY();
  const t = (game.time * 1.4) % 1;
  // 向外扩散的涟漪
  ctx.strokeStyle = `rgba(87,232,255,${0.45 * (1 - t)})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(x, y + 12, 15 + t * 24, (15 + t * 24) * 0.42, 0, 0, TAU);
  ctx.stroke();
  // 冲刺冷却环: 转满即可再冲刺
  if (P.dashCd > 0 && state === 'playing') {
    const p = 1 - P.dashCd / 2.6;
    ctx.strokeStyle = 'rgba(157,240,255,0.75)';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.ellipse(x, y + 12, 11, 11 * 0.42, 0, -Math.PI / 2, -Math.PI / 2 + p * TAU);
    ctx.stroke();
  }
  // 常亮内环
  ctx.strokeStyle = 'rgba(140,240,255,0.5)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(x, y + 12, 13, 5.5, 0, 0, TAU);
  ctx.stroke();
  // 濒死守护: 金色六棱护盾 + 旋转符文环
  if (P.guardFx > 0) {
    const gp = P.guardFx / 2.4, alpha = Math.min(1, gp * 1.6);
    ctx.save();
    ctx.translate(x, y - 2);
    ctx.rotate(game.time * 0.8);
    ctx.strokeStyle = `rgba(255,215,106,${0.75 * alpha})`;
    ctx.lineWidth = 2.5;
    ctx.shadowColor = '#ffd76a'; ctx.shadowBlur = 14;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * TAU;
      const px = Math.cos(a) * 34, py = Math.sin(a) * 34;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath(); ctx.stroke();
    // 内层逆向符文点
    ctx.rotate(-game.time * 2.1);
    ctx.fillStyle = `rgba(255,236,170,${0.9 * alpha})`;
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * TAU;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * 24, Math.sin(a) * 24, 2, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }
  // 连击狂热: 金色炽焰环(≥10 连击, 全伤害 +10%)
  if (game.combo >= 10 && state === 'playing') {
    const fa = 0.5 + 0.3 * Math.sin(game.time * 8);
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = `rgba(255,190,70,${0.55 * fa})`;
    ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.ellipse(x, y + 8, 27 + fa * 3, 11, 0, 0, TAU); ctx.stroke();
    ctx.strokeStyle = `rgba(255,230,140,${0.35 * fa})`;
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.ellipse(x, y + 8, 33 + fa * 4, 13, 0, 0, TAU); ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  }
  // 暴走祝福: 环身旋转的金色符文点
  if (game.frenzyT > 0 && state === 'playing') {
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 5; i++) {
      const a = game.time * 3.2 + i / 5 * TAU;
      ctx.fillStyle = 'rgba(255,215,106,0.85)';
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * 30, y + Math.sin(a) * 12, 2, 0, TAU);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }
}
function drawPlayer() {
  const P = player;
  if (P.inv > 0 && game.dying <= 0 && game.ultWindup <= 0 && Math.floor(P.inv * 14) % 2 === 0) return; // 受击闪烁(死亡/引导演出期间保持可见)
  const x = P.x - cam.x + shakeX(), y = P.y - cam.y + shakeY();
  const bob = P.moving ? Math.sin(P.walk * 11) * 2.4 : Math.sin(game.time * 2.2) * 1.2;
  const f = P.face;

  // 阴影
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath(); ctx.ellipse(x, y + 17, 14, 5, 0, 0, TAU); ctx.fill();

  ctx.save();
  ctx.translate(x, y + bob * 0.4);
  if (game.dying > 0) ctx.globalAlpha = Math.max(0.15, game.dying / 1.7); // 死亡演出: 肉身渐隐

  // 披风
  const capeSway = Math.sin(game.time * 3.2) * 3 + (P.moving ? -f * 3 : 0);
  ctx.fillStyle = '#2a3568';
  ctx.beginPath();
  ctx.moveTo(-4 * f, -13);
  ctx.quadraticCurveTo(-14 * f + capeSway * 0.5, -4, -10 * f + capeSway, 14);
  ctx.quadraticCurveTo(-4 * f, 10, -2 * f, 2);
  ctx.closePath(); ctx.fill();

  // 腿(行走摆动)
  const step = P.moving ? Math.sin(P.walk * 11) * 4 : 0;
  ctx.fillStyle = '#2b2f42';
  ctx.fillRect(-6 + step * 0.5, 8, 5, 9);
  ctx.fillRect(2 - step * 0.5, 8, 5, 9);

  // 长袍
  const grad = ctx.createLinearGradient(0, -14, 0, 16);
  grad.addColorStop(0, '#5162e8'); grad.addColorStop(1, '#3341b0');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(-8, -10); ctx.lineTo(8, -10);
  ctx.quadraticCurveTo(11, 4, 10, 15);
  ctx.lineTo(-10, 15);
  ctx.quadraticCurveTo(-11, 4, -8, -10);
  ctx.closePath(); ctx.fill();
  // 腰带
  ctx.fillStyle = '#d9a54a';
  ctx.fillRect(-9, 0, 18, 3);

  // 头
  ctx.fillStyle = '#f2c99a';
  ctx.beginPath(); ctx.arc(0, -16, 7.5, 0, TAU); ctx.fill();
  // 眼睛
  ctx.fillStyle = '#222';
  ctx.fillRect(f * 1.5 - 1, -17, 2, 3);
  ctx.fillRect(f * 4.5 - 1, -17, 2, 3);
  // 法师帽
  ctx.fillStyle = '#3b47c8';
  ctx.beginPath();
  ctx.moveTo(-11, -20); ctx.lineTo(11, -20); ctx.lineTo(2, -38);
  ctx.quadraticCurveTo(-4, -30, -11, -20);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#d9a54a';
  ctx.fillRect(-11, -22, 22, 3);
  // 帽尖弯钩
  ctx.fillStyle = '#3b47c8';
  ctx.beginPath(); ctx.arc(2, -38, 3, 0, TAU); ctx.fill();

  // 法杖 + 宝珠
  const sox = 13 * f, soy = -4;
  ctx.strokeStyle = '#7a5a34'; ctx.lineWidth = 3; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(sox - 3 * f, 10); ctx.lineTo(sox + 3 * f, -22); ctx.stroke();
  const pulse = 0.75 + Math.sin(game.time * 5) * 0.25;
  const og = ctx.createRadialGradient(sox + 3 * f, -26, 0, sox + 3 * f, -26, 9);
  og.addColorStop(0, '#ffffff'); og.addColorStop(0.35, '#57e8ff');
  og.addColorStop(1, 'rgba(87,232,255,0)');
  ctx.fillStyle = og;
  ctx.beginPath(); ctx.arc(sox + 3 * f, -26, 9 * pulse, 0, TAU); ctx.fill();

  ctx.restore();

  // 完美闪避: 白色气焰环绕(1s 增伤窗口提示)
  if (game.perfectT > 0) {
    const t = game.perfectT;
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(x, y - 8, 0, x, y - 8, 32);
    g.addColorStop(0, `rgba(255,255,255,${0.38 * t})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y - 8, 32, 0, TAU); ctx.fill();
    ctx.strokeStyle = `rgba(255,255,255,${(0.4 + 0.35 * Math.sin(game.time * 18)) * t})`;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y - 8, 25 + (1 - t) * 10, 0, TAU); ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  }
  // 深渊爆发引导: 暗紫能量向内收束(辉光核 + 收缩环)
  if (game.ultWindup > 0) {
    const p = 1 - game.ultWindup / ULT_WINDUP; // 0→1 收束进度
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(x, y - 6, 0, x, y - 6, 60);
    g.addColorStop(0, `rgba(227,200,255,${0.3 + 0.4 * p})`);
    g.addColorStop(1, 'rgba(176,110,240,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y - 6, 60, 0, TAU); ctx.fill();
    ctx.strokeStyle = `rgba(176,110,240,${0.5 + 0.4 * p})`;
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(x, y - 6, 150 * (1 - p) + 26, 0, TAU); ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  }
}

/* ---------------- 绘制: 敌人 ---------------- */
function drawShadow(x, y, r) {
  ctx.fillStyle = 'rgba(0,0,0,0.38)';
  ctx.beginPath(); ctx.ellipse(x, y + r * 0.95, r * 0.85, r * 0.3, 0, 0, TAU); ctx.fill();
}
/* 恶魔身体渐变缓存(按颜色键) */
const _dgradCache = new Map();
function demonGrad(color) {
  let g = _dgradCache.get(color);
  if (!g) {
    g = ctx.createLinearGradient(0, -16, 0, 14);
    g.addColorStop(0, color);
    g.addColorStop(1, '#701d1d');
    _dgradCache.set(color, g);
  }
  return g;
}
function drawCrown(x, y, s, color = '#ffd76a') {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x - 7 * s, y);
  ctx.lineTo(x - 7 * s, y - 5 * s);
  ctx.lineTo(x - 3.5 * s, y - 2.5 * s);
  ctx.lineTo(x, y - 7 * s);
  ctx.lineTo(x + 3.5 * s, y - 2.5 * s);
  ctx.lineTo(x + 7 * s, y - 5 * s);
  ctx.lineTo(x + 7 * s, y);
  ctx.closePath(); ctx.fill();
}
/* 幽灵: 半透明漂浮裹布 + 空洞眼 + 底部波浪裙摆 */
function drawWraith(e, x, y) {
  const s = e.r / 18;
  const bob = Math.sin(TAU * e.ph) * 3;
  const body = e.elite ? '#7a4fd0' : '#5a6fa8';
  const light = e.elite ? '#a58ae8' : '#8fa8d8';
  // 淡影(幽灵几乎没有影子)
  ctx.fillStyle = 'rgba(0,0,0,0.14)';
  ctx.beginPath(); ctx.ellipse(x, y + e.r * 0.95, e.r * 0.55, e.r * 0.18, 0, 0, TAU); ctx.fill();
  ctx.save();
  ctx.translate(x, y + bob);
  ctx.scale(s, s);
  ctx.globalAlpha = 0.78;
  // 裙摆波浪
  const wav = Math.sin(TAU * e.ph * 2) * 3;
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(-13, -2);
  ctx.quadraticCurveTo(-15, -16, 0, -19);
  ctx.quadraticCurveTo(15, -16, 13, -2);
  // 底部三个波谷
  ctx.quadraticCurveTo(10 + wav, 8, 6, 5);
  ctx.quadraticCurveTo(2 - wav, 11, 0, 6);
  ctx.quadraticCurveTo(-2 + wav, 11, -6, 5);
  ctx.quadraticCurveTo(-10 + wav, 8, -13, -2);
  ctx.closePath(); ctx.fill();
  // 内层浅色
  ctx.fillStyle = light;
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  ctx.moveTo(-7, -4);
  ctx.quadraticCurveTo(-8, -13, 0, -15);
  ctx.quadraticCurveTo(8, -13, 7, -4);
  ctx.quadraticCurveTo(3, 2, -7, -4);
  ctx.closePath(); ctx.fill();
  // 空洞双眼(幽光)
  ctx.globalAlpha = 0.95;
  ctx.fillStyle = '#bfffee';
  ctx.shadowColor = '#7dffe0';
  ctx.shadowBlur = 6;
  ctx.beginPath(); ctx.arc(-4.5, -9, 2.1, 0, TAU); ctx.arc(4.5, -9, 2.1, 0, TAU); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.restore();
  ctx.globalAlpha = 1;
  if (e.elite) drawCrown(x, y - e.r - 5 + bob, s);
}
function drawSlime(e, x, y) {
  const s = e.r / 16;
  const squash = 1 + Math.sin(TAU * e.ph) * 0.14;
  const body = e.elite ? '#a15ad0' : (e.color || '#58c15a');
  const light = e.elite ? '#c98af0' : '#7fdb7f';
  drawShadow(x, y, e.r);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s * (2 - squash), s * squash);
  // 身体
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(-15, 10);
  ctx.quadraticCurveTo(-17, -10, 0, -13);
  ctx.quadraticCurveTo(17, -10, 15, 10);
  ctx.closePath(); ctx.fill();
  // 高光
  ctx.fillStyle = light;
  ctx.globalAlpha = 0.55;
  ctx.beginPath(); ctx.ellipse(-5, -7, 6, 4, -0.5, 0, TAU); ctx.fill();
  ctx.globalAlpha = 1;
  // 眼睛 + 嘴
  ctx.fillStyle = '#101418';
  ctx.beginPath(); ctx.arc(-5, -2, 2.2, 0, TAU); ctx.arc(5, -2, 2.2, 0, TAU); ctx.fill();
  ctx.strokeStyle = '#101418'; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.arc(0, 4, 3.4, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
  ctx.restore();
  if (e.elite) drawCrown(x, y - e.r - 4, s);
}
/* 腐沼孢母: 呼吸鼓胀的毒囊母体, 内部孢子泡上浮, 顶部产孢囊脉冲 */
function drawSpore(e, x, y) {
  const s = e.r / 19;
  const wob = Math.sin(TAU * e.ph);
  const body = e.elite ? '#9a5ad0' : '#5fbf4c';
  const dark = e.elite ? '#6d3a9e' : '#3f7a34';
  const bub = e.elite ? '#c99af0' : '#a9e88a';
  drawShadow(x, y, e.r);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  // 外膜(呼吸鼓胀)
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.ellipse(0, 0, 14 + wob * 1.2, 13 - wob * 0.8, 0, 0, TAU);
  ctx.fill();
  // 主体
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.ellipse(0, 1, 11.5, 10.5, 0, 0, TAU);
  ctx.fill();
  // 内部孢子泡(缓缓上浮循环)
  ctx.fillStyle = bub;
  for (let i = 0; i < 3; i++) {
    const bp = (e.ph + i / 3) % 1;
    const bx = Math.sin(i * 2.4 + e.ph * TAU) * 5;
    const by = 7 - bp * 13;
    ctx.globalAlpha = 0.75 * (1 - Math.abs(bp - 0.5) * 0.7);
    ctx.beginPath(); ctx.arc(bx, by, 1.6 + (i % 2), 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;
  // 顶部产孢囊(脉冲鼓起)
  ctx.fillStyle = dark;
  ctx.beginPath(); ctx.arc(0, -12 - wob * 1.6, 3.4, 0, TAU); ctx.fill();
  ctx.fillStyle = bub;
  ctx.beginPath(); ctx.arc(0, -12 - wob * 1.6, 2, 0, TAU); ctx.fill();
  // 眼睛
  ctx.fillStyle = '#101418';
  ctx.beginPath(); ctx.arc(-4, -1, 2, 0, TAU); ctx.arc(4, -1, 2, 0, TAU); ctx.fill();
  ctx.restore();
  if (e.elite) drawCrown(x, y - e.r - 4, s);
}
/* 冲锋甲虫: 铜甲鞘翅 + 六足交替 + 前冲犄角 */
function drawCharger(e, x, y) {
  const s = e.r / 15;
  drawShadow(x, y + 10 * s, e.r * 0.95);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  // 六足(三对, 交替摆动)
  ctx.strokeStyle = '#3a2c1a'; ctx.lineWidth = 2; ctx.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    const lx = -8 + i * 8, sw = Math.sin(TAU * e.ph + i * 2.1) * 2.6;
    ctx.beginPath(); ctx.moveTo(lx, 4); ctx.lineTo(lx - 3.5, 11 + sw); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(lx, 4); ctx.lineTo(lx + 3.5, 11 - sw); ctx.stroke();
  }
  ctx.lineCap = 'butt';
  // 前冲犄角
  ctx.fillStyle = '#e8d9a8';
  ctx.beginPath(); ctx.moveTo(-2.6, -9); ctx.lineTo(0, -16); ctx.lineTo(2.6, -9); ctx.closePath(); ctx.fill();
  // 头
  ctx.fillStyle = e.elite ? '#b06ad8' : '#c98a4d';
  ctx.beginPath(); ctx.ellipse(0, -7, 6.5, 5.5, 0, 0, TAU); ctx.fill();
  // 鞘翅
  ctx.fillStyle = e.elite ? '#9a4fc8' : '#a06a3a';
  ctx.beginPath(); ctx.ellipse(0, 2, 12, 10, 0, 0, TAU); ctx.fill();
  // 鞘翅中缝 + 甲纹
  ctx.strokeStyle = e.elite ? '#7a3aa5' : '#7a4e28'; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(0, -7.5); ctx.lineTo(0, 11.5); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-11, 2); ctx.lineTo(11, 2); ctx.stroke();
  // 高光
  ctx.fillStyle = 'rgba(255,235,200,0.3)';
  ctx.beginPath(); ctx.ellipse(-4.5, -2.5, 4.5, 2.6, -0.4, 0, TAU); ctx.fill();
  // 复眼
  ctx.fillStyle = '#ffde66';
  ctx.beginPath(); ctx.arc(-2.6, -7.6, 1.3, 0, TAU); ctx.arc(2.6, -7.6, 1.3, 0, TAU); ctx.fill();
  ctx.restore();
  if (e.elite) drawCrown(x, y - e.r - 4, s);
}
function drawBat(e, x, y) {
  const s = e.r / 12;
  const flap = Math.sin(TAU * e.ph);
  const body = e.elite ? '#8a5adf' : '#5a5170';
  drawShadow(x, y + 8 * s, e.r * 0.8);
  ctx.save();
  ctx.translate(x, y + Math.sin(TAU * e.ph) * 2);
  ctx.scale(s, s);
  // 翅膀
  ctx.fillStyle = body;
  for (const dir of [-1, 1]) {
    ctx.save();
    ctx.scale(dir, 1);
    ctx.rotate(flap * 0.55);
    ctx.beginPath();
    ctx.moveTo(3, -2);
    ctx.quadraticCurveTo(14, -12, 22, -6);
    ctx.quadraticCurveTo(17, -3, 16, 2);
    ctx.quadraticCurveTo(12, 0, 10, 5);
    ctx.quadraticCurveTo(7, 2, 3, 4);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  // 身体
  ctx.fillStyle = e.elite ? '#a15ad0' : '#6b6284';
  ctx.beginPath(); ctx.ellipse(0, 0, 7, 8, 0, 0, TAU); ctx.fill();
  // 耳朵
  ctx.fillStyle = body;
  ctx.beginPath(); ctx.moveTo(-5, -5); ctx.lineTo(-3, -12); ctx.lineTo(-1, -6); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(5, -5); ctx.lineTo(3, -12); ctx.lineTo(1, -6); ctx.closePath(); ctx.fill();
  // 红眼
  ctx.fillStyle = '#ff5b5b';
  ctx.beginPath(); ctx.arc(-2.5, -1, 1.4, 0, TAU); ctx.arc(2.5, -1, 1.4, 0, TAU); ctx.fill();
  // 獠牙
  ctx.fillStyle = '#fff';
  ctx.fillRect(-2, 4, 1.2, 2.5); ctx.fillRect(1, 4, 1.2, 2.5);
  ctx.restore();
}
/* 宝藏哥布林: 绿皮小怪背负宝袋, 疾奔姿态 */
function drawGoblin(e, x, y) {
  const s = e.r / 14;
  const step = Math.sin(TAU * e.ph);
  drawShadow(x, y + 6 * s, e.r * 0.9);
  ctx.save();
  ctx.translate(x, y - Math.abs(step) * 1.6);
  ctx.scale(s, s);
  // 疾奔双腿(交替大幅摆动)
  ctx.strokeStyle = '#3f6b35'; ctx.lineWidth = 3; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-3, 8); ctx.lineTo(-5 - step * 4.5, 14); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(3, 8); ctx.lineTo(5 + step * 4.5, 14); ctx.stroke();
  // 身体(前倾)
  ctx.fillStyle = '#5f9e4c';
  ctx.beginPath(); ctx.ellipse(0, 2, 8, 9, 0, 0, TAU); ctx.fill();
  // 背负宝袋(棕色麻袋 + 金绳口)
  ctx.fillStyle = '#a9743a';
  ctx.beginPath(); ctx.ellipse(-2, -6, 7.5, 8, -0.2, 0, TAU); ctx.fill();
  ctx.fillStyle = '#8a5c2c';
  ctx.beginPath(); ctx.ellipse(-2.5, -8, 5, 4, -0.2, 0, TAU); ctx.fill();
  ctx.strokeStyle = '#ffd76a'; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(-5, -12); ctx.lineTo(1.5, -12.5); ctx.stroke();
  // 袋口探出的金币
  ctx.fillStyle = '#ffd76a';
  ctx.beginPath(); ctx.arc(-1.5, -13.5, 2.2, 0, TAU); ctx.fill();
  // 头(侧向警惕回望)
  ctx.fillStyle = '#6fb458';
  ctx.beginPath(); ctx.arc(6, -4, 6, 0, TAU); ctx.fill();
  // 尖耳
  ctx.beginPath(); ctx.moveTo(2, -7); ctx.lineTo(-1.5, -13); ctx.lineTo(5, -8); ctx.closePath(); ctx.fill();
  // 慌张的眼睛
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(8, -5, 2.6, 0, TAU); ctx.fill();
  ctx.fillStyle = '#1a1d26';
  ctx.beginPath(); ctx.arc(8.8, -5, 1.3, 0, TAU); ctx.fill();
  // 惊恐张嘴
  ctx.fillStyle = '#2c3a26';
  ctx.beginPath(); ctx.ellipse(9, -0.5, 2, 1.5, 0, 0, TAU); ctx.fill();
  ctx.restore();
}
/* 爆弹魔菇: 紫黑蘑菇怪, 自爆前膨胀泛红(膨胀/泛红在 drawEnemy 层处理) */
function drawBomber(e, x, y) {
  const s = e.r / 14;
  const wob = Math.sin(TAU * e.ph);
  drawShadow(x, y + 5 * s, e.r * 0.85);
  ctx.save();
  ctx.translate(x, y + wob * 1.5);
  ctx.scale(s, s);
  // 菌伞(紫黑半球 + 斑点)
  ctx.fillStyle = '#4a2f5e';
  ctx.beginPath(); ctx.ellipse(0, -6, 11, 8.5, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#6d4a8c';
  ctx.beginPath(); ctx.arc(-4.5, -8, 2.2, 0, TAU); ctx.arc(3, -10, 1.8, 0, TAU); ctx.arc(6.5, -5, 1.5, 0, TAU); ctx.fill();
  // 菌柄(浅紫)
  ctx.fillStyle = '#c9b8d8';
  ctx.beginPath(); ctx.ellipse(0, 3, 5.5, 7, 0, 0, TAU); ctx.fill();
  // 邪恶眯眼
  ctx.strokeStyle = '#2a1a38'; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-4, 2); ctx.lineTo(-1.5, 3.2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(4, 2); ctx.lineTo(1.5, 3.2); ctx.stroke();
  ctx.restore();
}
/* 疫病祭司: 深紫斗篷施法者, 兜帽阴影中发光双眼 + 蛇形法杖(蓄力光效在 drawEnemy 层处理) */
function drawHexer(e, x, y) {
  const s = e.r / 17;
  const float = Math.sin(TAU * e.ph);
  drawShadow(x, y + 8 * s, e.r * 0.8);
  ctx.save();
  ctx.translate(x, y - 2 - float * 1.8);
  ctx.scale(s, s);
  // 下摆(曳地斗篷, 随悬浮摆动)
  ctx.fillStyle = '#3d2454';
  ctx.beginPath();
  ctx.moveTo(-8, 2);
  ctx.quadraticCurveTo(-10 + float * 1.5, 12, -6, 16);
  ctx.lineTo(6, 16);
  ctx.quadraticCurveTo(10 + float * 1.5, 12, 8, 2);
  ctx.closePath(); ctx.fill();
  // 斗篷躯干(深紫)
  ctx.fillStyle = '#5a3a7a';
  ctx.beginPath();
  ctx.moveTo(-8, 3); ctx.quadraticCurveTo(-9, -8, 0, -9);
  ctx.quadraticCurveTo(9, -8, 8, 3); ctx.closePath(); ctx.fill();
  // 肩部镶边
  ctx.strokeStyle = '#8a5cb8'; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(-8, 2); ctx.quadraticCurveTo(0, 5, 8, 2); ctx.stroke();
  // 兜帽
  ctx.fillStyle = '#4a2c66';
  ctx.beginPath();
  ctx.moveTo(-6.5, -8); ctx.quadraticCurveTo(-7, -18, 0, -19);
  ctx.quadraticCurveTo(7, -18, 6.5, -8); ctx.closePath(); ctx.fill();
  // 兜帽开口阴影
  ctx.fillStyle = '#160d22';
  ctx.beginPath(); ctx.ellipse(0, -11, 4.6, 5.2, 0, 0, TAU); ctx.fill();
  // 阴影中的发光双眼
  ctx.fillStyle = e.elite ? '#ff7de8' : '#c06ef0';
  ctx.beginPath(); ctx.arc(-1.9, -11.5, 1.5, 0, TAU); ctx.arc(1.9, -11.5, 1.5, 0, TAU); ctx.fill();
  // 蛇形法杖(右手)
  ctx.strokeStyle = '#6d4a8c'; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(8, 2); ctx.quadraticCurveTo(12, -4, 10.5, -12); ctx.stroke();
  // 杖头疫病宝珠
  ctx.fillStyle = '#b06ef0';
  ctx.beginPath(); ctx.arc(10.5, -13.5, 2.6, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(220,160,255,0.5)';
  ctx.beginPath(); ctx.arc(9.8, -14.2, 1, 0, TAU); ctx.fill();
  ctx.restore();
}
function drawShade(e, x, y) {
  const s = e.r / 15;
  const step = Math.sin(TAU * e.ph);
  drawShadow(x, y, e.r * 0.85);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  // 飘动围巾(暗红, 刺客信物)
  const scarf = step * 2.5;
  ctx.fillStyle = e.elite ? '#c94dff' : '#a8324a';
  ctx.beginPath();
  ctx.moveTo(-3, -10);
  ctx.quadraticCurveTo(-12 - scarf, -8, -14 - scarf, -2);
  ctx.quadraticCurveTo(-9 - scarf * 0.5, -5, -3.5, -7);
  ctx.closePath(); ctx.fill();
  // 紧身斗篷躯干(近黑深紫)
  const cloak = e.elite ? '#4a2a66' : '#241a38';
  ctx.fillStyle = cloak;
  ctx.beginPath();
  ctx.moveTo(-7, -8); ctx.quadraticCurveTo(-9, 2, -6, 12);
  ctx.lineTo(6, 12);
  ctx.quadraticCurveTo(9, 2, 7, -8);
  ctx.closePath(); ctx.fill();
  // 胸前束带
  ctx.strokeStyle = '#5a4a78'; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(-6, -4); ctx.lineTo(6, 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-6, 2); ctx.lineTo(6, -4); ctx.stroke();
  // 兜帽(低垂锐利)
  ctx.fillStyle = e.elite ? '#5a3578' : '#31224a';
  ctx.beginPath();
  ctx.moveTo(-6, -8); ctx.quadraticCurveTo(-7.5, -18, 0, -19.5);
  ctx.quadraticCurveTo(7.5, -18, 6, -8); ctx.closePath(); ctx.fill();
  ctx.beginPath(); // 帽尖
  ctx.moveTo(0, -19.5); ctx.lineTo(2.4, -24); ctx.lineTo(3.4, -18.5);
  ctx.closePath(); ctx.fill();
  // 兜帽开口
  ctx.fillStyle = '#0d0818';
  ctx.beginPath(); ctx.ellipse(0, -12, 4.2, 4.8, 0, 0, TAU); ctx.fill();
  // 猩红双眼(窄缝凶光)
  ctx.fillStyle = '#ff3b52';
  ctx.shadowColor = '#ff3b52'; ctx.shadowBlur = 5;
  ctx.beginPath();
  ctx.moveTo(-3.2, -12.5); ctx.lineTo(-0.8, -12); ctx.lineTo(-3, -11.2); ctx.closePath();
  ctx.moveTo(0.8, -12); ctx.lineTo(3.2, -12.5); ctx.lineTo(3, -11.2); ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
  // 双匕首(反手握持, 随步伐起伏)
  const dy1 = step * 1.2;
  ctx.strokeStyle = '#9aa4c4'; ctx.lineWidth = 1.8; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-8.5, -2 + dy1); ctx.lineTo(-11.5, -8 + dy1); ctx.stroke(); // 左匕
  ctx.beginPath(); ctx.moveTo(8.5, -2 - dy1); ctx.lineTo(11.5, -8 - dy1); ctx.stroke();  // 右匕
  ctx.fillStyle = '#e8ecff'; // 匕首寒光
  ctx.beginPath(); ctx.arc(-11.5, -8 + dy1, 1.2, 0, TAU); ctx.arc(11.5, -8 - dy1, 1.2, 0, TAU); ctx.fill();
  ctx.restore();
  if (e.elite) drawCrown(x, y - e.r - 6, s);
}
function drawSkel(e, x, y) {
  const s = e.r / 16;
  const step = Math.sin(TAU * e.ph);
  drawShadow(x, y, e.r);
  ctx.save();
  ctx.translate(x, y + step * 1.2);
  ctx.scale(s, s);
  const bone = e.elite ? '#c9b8ea' : '#e8e4d8';
  // 腿
  ctx.strokeStyle = bone; ctx.lineWidth = 3; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-3, 6); ctx.lineTo(-4 - step * 3, 15); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(3, 6); ctx.lineTo(4 + step * 3, 15); ctx.stroke();
  // 脊柱 + 肋骨
  ctx.strokeStyle = bone; ctx.lineWidth = 3.4;
  ctx.beginPath(); ctx.moveTo(0, -4); ctx.lineTo(0, 7); ctx.stroke();
  ctx.lineWidth = 2;
  for (let i = 0; i < 3; i++) {
    const yy = -2 + i * 3.4;
    ctx.beginPath(); ctx.moveTo(-6, yy); ctx.quadraticCurveTo(0, yy + 2, 6, yy); ctx.stroke();
  }
  // 手臂(挥舞)
  ctx.lineWidth = 2.6;
  ctx.beginPath(); ctx.moveTo(-4, -3); ctx.lineTo(-9 - step * 2, 2 + step * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(4, -3); ctx.lineTo(9 + step * 2, 2 - step * 2); ctx.stroke();
  // 颅骨
  ctx.fillStyle = bone;
  ctx.beginPath(); ctx.arc(0, -11, 7, 0, TAU); ctx.fill();
  ctx.fillRect(-4, -9, 8, 4);
  // 眼窝
  ctx.fillStyle = e.elite ? '#c94dff' : '#15181f';
  ctx.beginPath(); ctx.arc(-2.8, -11.5, 1.9, 0, TAU); ctx.arc(2.8, -11.5, 1.9, 0, TAU); ctx.fill();
  if (e.elite) { // 精英眼发光
    ctx.fillStyle = 'rgba(200,80,255,0.35)';
    ctx.beginPath(); ctx.arc(-2.8, -11.5, 3.4, 0, TAU); ctx.arc(2.8, -11.5, 3.4, 0, TAU); ctx.fill();
  }
  ctx.restore();
  if (e.elite) drawCrown(x, y - 22 * s, s);
}
function drawDemon(e, x, y) {
  const s = e.r / 20;
  const step = Math.sin(TAU * e.ph);
  const dark = e.color || '#d04848';
  const isBoss = e.boss, sc = e.bossScale || 2.5;
  drawShadow(x, y, e.r);
  ctx.save();
  ctx.translate(x, y + Math.abs(step) * 1.5);
  ctx.scale(s * sc * 0.62, s * sc * 0.62);
  // Boss 翅膀
  if (isBoss) {
    const flap = Math.sin(TAU * e.ph);
    ctx.fillStyle = 'rgba(20,16,30,0.9)';
    for (const dir of [-1, 1]) {
      ctx.save();
      ctx.scale(dir, 1);
      ctx.rotate(-0.3 + flap * 0.25);
      ctx.beginPath();
      ctx.moveTo(6, -8);
      ctx.quadraticCurveTo(30, -34, 46, -20);
      ctx.quadraticCurveTo(34, -14, 30, -2);
      ctx.quadraticCurveTo(22, -8, 6, -4);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }
  // 身体(渐变按颜色缓存, 避免每敌每帧创建)
  ctx.fillStyle = demonGrad(dark);
  ctx.beginPath();
  ctx.moveTo(-13, -8);
  ctx.quadraticCurveTo(-15, 8, -9, 13);
  ctx.lineTo(9, 13);
  ctx.quadraticCurveTo(15, 8, 13, -8);
  ctx.quadraticCurveTo(0, -16, -13, -8);
  ctx.closePath(); ctx.fill();
  // 角
  ctx.fillStyle = '#f0e2c8';
  ctx.beginPath(); ctx.moveTo(-9, -12); ctx.quadraticCurveTo(-16, -20, -12, -26); ctx.quadraticCurveTo(-10, -19, -6, -14); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(9, -12); ctx.quadraticCurveTo(16, -20, 12, -26); ctx.quadraticCurveTo(10, -19, 6, -14); ctx.closePath(); ctx.fill();
  // 眼睛
  const eyeC = e.final ? '#57e8ff' : '#ffe45c';
  ctx.fillStyle = eyeC;
  ctx.beginPath(); ctx.ellipse(-5, -6, 2.6, 3.2, 0.2, 0, TAU); ctx.ellipse(5, -6, 2.6, 3.2, -0.2, 0, TAU); ctx.fill();
  if (isBoss || e.elite) {
    ctx.fillStyle = e.final ? 'rgba(87,232,255,0.3)' : 'rgba(255,220,90,0.3)';
    ctx.beginPath(); ctx.arc(-5, -6, 5, 0, TAU); ctx.arc(5, -6, 5, 0, TAU); ctx.fill();
  }
  // 嘴 + 牙
  ctx.fillStyle = '#2a0d0d';
  ctx.beginPath(); ctx.moveTo(-6, 2); ctx.quadraticCurveTo(0, 7, 6, 2); ctx.quadraticCurveTo(0, 5, -6, 2); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#fff';
  for (let i = -2; i <= 2; i++) ctx.fillRect(i * 2.6 - 0.8, 2 + Math.abs(i) * 0.4, 1.6, 2);
  // 爪子
  ctx.strokeStyle = dark; ctx.lineWidth = 3.6; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-12, -2); ctx.lineTo(-18, 4 + step * 3); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(12, -2); ctx.lineTo(18, 4 - step * 3); ctx.stroke();
  ctx.restore();
  if (isBoss) drawCrown(x, y - e.r - 10, s * sc * 0.62, '#ffd76a');
  else if (e.elite) drawCrown(x, y - e.r - 4, s);
}
/* ---------------- 敌人精灵帧缓存 ----------------
 * 普通敌人(含精英)预烘焙为 12 相位帧, 运行时 drawImage 贴图而非每帧矢量重绘:
 * 高压场景(250+ 怪)下渲染开销从"矢量路径填充"降为"位图拷贝"。
 * Boss 仍实时矢量绘制(同屏至多 1 只)。 */
const SPRITE_FRAMES = 12;
const _sprMeta = { // 帧规格(按该类型基准 r 渲染): w/h 帧尺寸, ax/ay 锚点(帧内身体中心)
  slime:   { w: 44, h: 52, ax: 22, ay: 29 },
  bat:     { w: 50, h: 44, ax: 25, ay: 20 },
  charger: { w: 46, h: 44, ax: 23, ay: 26 },
  skel:    { w: 30, h: 54, ax: 15, ay: 31 },
  demon:   { w: 62, h: 70, ax: 31, ay: 42 },
  wraith:  { w: 48, h: 58, ax: 24, ay: 32 },
  bomber:  { w: 40, h: 40, ax: 20, ay: 24 },
  hexer:   { w: 46, h: 62, ax: 23, ay: 34 },
  shade:  { w: 48, h: 54, ax: 24, ay: 30 },
  spore:  { w: 40, h: 42, ax: 20, ay: 17 },
  goblin:  { w: 44, h: 50, ax: 20, ay: 30 },
};
const _sprCache = new Map(); // key: `${type}|${elite}|${q}`
function getSprite(type, elite, q) {
  const key = `${type}|${elite ? 1 : 0}|${q}`;
  let f = _sprCache.get(key);
  if (f) return f;
  const m = _sprMeta[type];
  const cv = document.createElement('canvas');
  cv.width = m.w; cv.height = m.h;
  const prev = ctx;
  ctx = cv.getContext('2d');
  try {
    const e = { // 伪敌人: 以基准半径驱动既有矢量绘制
      type, elite, boss: false, final: false,
      r: ENEMY_DEFS[type].r, ph: q / SPRITE_FRAMES,
    };
    if (type === 'slime') drawSlime(e, m.ax, m.ay);
    else if (type === 'bat') drawBat(e, m.ax, m.ay);
    else if (type === 'charger') drawCharger(e, m.ax, m.ay);
    else if (type === 'skel') drawSkel(e, m.ax, m.ay);
    else if (type === 'wraith') drawWraith(e, m.ax, m.ay);
    else if (type === 'goblin') drawGoblin(e, m.ax, m.ay);
    else if (type === 'bomber') drawBomber(e, m.ax, m.ay);
    else if (type === 'hexer') drawHexer(e, m.ax, m.ay);
    else if (type === 'shade') drawShade(e, m.ax, m.ay);
    else if (type === 'spore') drawSpore(e, m.ax, m.ay);
    else drawDemon(e, m.ax, m.ay);
  } finally { ctx = prev; }
  f = { cv, ax: m.ax, ay: m.ay };
  _sprCache.set(key, f);
  return f;
}
function bakeAllSprites() {
  for (const t of Object.keys(ENEMY_DEFS))
    for (let el = 0; el < 2; el++)
      for (let q = 0; q < SPRITE_FRAMES; q++) getSprite(t, !!el, q);
}
function drawEnemy(e) {
  let x = e.x - cam.x + shakeX(), y = e.y - cam.y + shakeY();
  if (e.shockT > 0) { x += rand(-1.6, 1.6); y += rand(-1.6, 1.6); } // 感电抖动
  if (x < -150 || x > W + 150 || y < -150 || y > H + 150) return; // 留出爆弹预警圈半径
  if (e.boss) { // Boss 实时矢量
    if (e.type === 'slime') drawSlime(e, x, y);
    else if (e.type === 'bat') drawBat(e, x, y);
    else if (e.type === 'skel') drawSkel(e, x, y);
    else drawDemon(e, x, y);
  } else { // 普通怪/精英: 预烘焙精灵帧(幽灵含半透明, 直接位图拷贝保留 alpha)
    const q = Math.min(SPRITE_FRAMES - 1, (e.ph * SPRITE_FRAMES) | 0);
    const f = getSprite(e.type, e.elite, q);
    const sc = e.r / ENEMY_DEFS[e.type].r;
    if (e.type === 'bomber' && e.fuseLit) { // 引信点燃: 膨胀 + 颤动 + 泛红
      const t = 1 - e.fuse / 1.25;
      const dsc = sc * (1 + t * 0.55);
      const jx2 = rand(-1.4, 1.4) * t, jy2 = rand(-1.4, 1.4) * t;
      ctx.drawImage(f.cv, x + jx2 - f.ax * dsc, y + jy2 - f.ay * dsc, f.cv.width * dsc, f.cv.height * dsc);
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(255,60,40,${0.2 + 0.3 * t * Math.abs(Math.sin(t * Math.PI * 9))})`;
      ctx.beginPath(); ctx.arc(x, y - e.r * 0.2, e.r * (1.05 + t * 0.5), 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    } else {
      // 影刃刺客隐身: 仅残影淡显(仍可被范围武器命中)
      if (e.type === 'shade' && e.vst === 'veil') ctx.globalAlpha = 0.2;
      const sq = (e.squashT || 0) / 0.14; // 受击挤压: 底部锚定压扁+横向鼓胀(卡通挤压拉伸)
      if (sq > 0) {
        const hs = 1 - 0.22 * sq, ws = 1 + 0.13 * sq;
        const by = y - f.ay * sc + f.cv.height * sc; // 帧底边(屏幕坐标, 脚底锚点)
        ctx.save();
        ctx.translate(x, by);
        ctx.scale(ws, hs);
        ctx.drawImage(f.cv, -f.ax * sc, -f.cv.height * sc, f.cv.width * sc, f.cv.height * sc);
        ctx.restore();
      } else {
        ctx.drawImage(f.cv, x - f.ax * sc, y - f.ay * sc, f.cv.width * sc, f.cv.height * sc);
      }
      ctx.globalAlpha = 1;
    }
  }
  // 爆弹魔菇: 自爆预警圈(收缩虚线圈 + 淡红填充)
  if (e.type === 'bomber' && e.fuseLit) {
    const t = 1 - e.fuse / 1.25, R = 118;
    ctx.strokeStyle = `rgba(255,90,60,${0.35 + 0.45 * t})`;
    ctx.lineWidth = 2.5;
    ctx.setLineDash([6, 5]);
    ctx.beginPath(); ctx.arc(x, y, R * (0.3 + 0.7 * t), 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = `rgba(255,70,45,${0.06 + 0.1 * t * Math.abs(Math.sin(t * Math.PI * 8))})`;
    ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.fill();
  }
  // 宝藏哥布林: 金色底光 + 逃脱倒计时
  if (e.type === 'goblin') {
    const g = ctx.createRadialGradient(x, y, 0, x, y, e.r * 1.8);
    g.addColorStop(0, 'rgba(255,215,106,0.16)');
    g.addColorStop(1, 'rgba(255,215,106,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, e.r * 1.8, 0, TAU); ctx.fill();
    if (e.life < 6) { // 即将遁地: 倒计时提示
      ctx.font = 'bold 11px "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 2.5;
      ctx.strokeText(Math.ceil(e.life) + 's', x, y - e.r - 12);
      ctx.fillStyle = '#ffd76a';
      ctx.fillText(Math.ceil(e.life) + 's', x, y - e.r - 12);
    }
  }
  // 冲锋甲虫: 蓄力预警(红色虚线瞄准线 + 身体急促闪烁)
  if (e.type === 'charger' && e.chg === 'wind') {
    const t = 1 - e.chgT / 0.62;
    ctx.strokeStyle = `rgba(255,90,70,${0.3 + 0.45 * t})`;
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 6]);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + e.cdx * 270, y + e.cdy * 270);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `rgba(255,80,60,${0.12 + 0.22 * Math.abs(Math.sin(t * Math.PI * 7))})`;
    ctx.beginPath(); ctx.arc(x, y - e.r * 0.2, e.r * 1.05, 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }
  // 疫病祭司: 蓄力预警(法杖顶端疫瘴宝球膨胀 + 蓄力弧)
  if (e.type === 'hexer' && e.cast > 0) {
    const t = 1 - e.cast / 0.8;
    const ox = x + 10.5 * (e.r / 17), oy = y - 13.5 * (e.r / 17) - e.r * 0.1;
    ctx.globalCompositeOperation = 'lighter';
    const gr = 3 + t * 7;
    const g = ctx.createRadialGradient(ox, oy, 0, ox, oy, gr * 2.4);
    g.addColorStop(0, `rgba(220,140,255,${0.5 + 0.4 * t})`);
    g.addColorStop(1, 'rgba(192,110,240,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(ox, oy, gr * 2.4, 0, TAU); ctx.fill();
    ctx.fillStyle = `rgba(232,192,255,${0.55 + 0.45 * Math.abs(Math.sin(t * Math.PI * 6))})`;
    ctx.beginPath(); ctx.arc(ox, oy, gr, 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    // 蓄力进度弧
    ctx.strokeStyle = `rgba(192,110,240,${0.4 + 0.5 * t})`;
    ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.arc(x, y - e.r * 0.4, e.r + 7, -Math.PI / 2, -Math.PI / 2 + t * TAU); ctx.stroke();
  }
  // 影刃刺客: 出手预警(头顶红色感叹号 + 收缩蓄力环) / 硬直破绽(黄色弱点脉冲)
  if (e.type === 'shade') {
    if (e.vst === 'wind') {
      const t = 1 - e.vT / 0.42;
      ctx.strokeStyle = `rgba(255,60,80,${0.35 + 0.55 * t})`;
      ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.arc(x, y - e.r * 0.2, e.r + 8 + (1 - t) * 14, 0, TAU); ctx.stroke();
      ctx.font = `900 ${Math.round(15 + t * 4)}px "Segoe UI", sans-serif`;
      ctx.textAlign = 'center';
      const by = y - e.r - 16 - t * 4;
      ctx.fillStyle = '#ff3b52';
      ctx.shadowColor = '#ff3b52'; ctx.shadowBlur = 8;
      ctx.fillText('!', x, by);
      ctx.shadowBlur = 0;
    } else if (e.vst === 'rest') { // 破绽暴露: 金色弱点标记, 提示集火
      const pulse = 0.6 + 0.4 * Math.sin(game.time * 12);
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = `rgba(255,215,106,${0.35 + 0.4 * pulse})`;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.arc(x, y - e.r * 0.2, e.r + 10, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = `rgba(255,215,106,${0.55 + 0.35 * pulse})`;
      ctx.font = 'bold 10px "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('破绽', x, y - e.r - 14);
      ctx.globalCompositeOperation = 'source-over';
    }
  }
  // 受击白闪
  if (e.flash > 0) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `rgba(255,255,255,${e.flash * 3.2})`;
    ctx.beginPath(); ctx.arc(x, y - e.r * 0.2, e.r * 1.05, 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }
  // 超导脆化: 旋转冰晶覆壳(易伤提示)
  if (e.brittleT > 0) {
    const ba = Math.min(1, e.brittleT / 4) * 0.45 + 0.12;
    ctx.strokeStyle = `rgba(159,232,255,${ba})`;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    const rot = game.time * 1.5;
    ctx.beginPath(); ctx.arc(x, y - e.r * 0.2, e.r * 1.18, rot, rot + TAU); ctx.stroke();
    ctx.setLineDash([]);
  }
  // 灼烧橙焰覆盖
  if (e.burn > 0) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `rgba(255,110,40,${0.13 + 0.08 * Math.sin(game.time * 12)})`;
    ctx.beginPath(); ctx.arc(x, y - e.r * 0.2, e.r * 1.04, 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }
  // 感电青弧覆盖 + 抖动偏移
  let jx = 0, jy = 0;
  if (e.shockT > 0) {
    jx = rand(-1.6, 1.6); jy = rand(-1.6, 1.6);
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = `rgba(184,232,255,${0.55 + 0.3 * Math.sin(game.time * 30)})`;
    ctx.lineWidth = 1.6;
    for (let i = 0; i < 2; i++) { // 两道随机折线电弧
      ctx.beginPath();
      let ax = x - e.r * 0.8, ay = y - e.r * 0.3;
      ctx.moveTo(ax, ay);
      for (let s = 0; s < 3; s++) {
        ax += e.r * 0.55; ay = y - e.r * 0.3 + rand(-e.r * 0.5, e.r * 0.5);
        ctx.lineTo(ax, ay);
      }
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  // 精英/Boss 底光(狂暴态转为血红, 词缀精英用词缀色, 双词缀双色叠加)
  if (e.boss || e.elite) {
    if (e.affix && e.affix2 && !e.raged) {
      // 双词缀: 内圈词缀一 + 外圈词缀二, 双色光晕泾渭分明
      const c1 = ELITE_AFFIXES[e.affix].rgb, c2 = ELITE_AFFIXES[e.affix2].rgb;
      const g1 = ctx.createRadialGradient(x, y, 0, x, y, e.r * 1.5);
      g1.addColorStop(0, `rgba(${c1},0.15)`); g1.addColorStop(1, `rgba(${c1},0)`);
      ctx.fillStyle = g1;
      ctx.beginPath(); ctx.arc(x, y, e.r * 1.5, 0, TAU); ctx.fill();
      const g2 = ctx.createRadialGradient(x, y, e.r * 1.1, x, y, e.r * 1.95);
      g2.addColorStop(0, `rgba(${c2},0)`); g2.addColorStop(0.7, `rgba(${c2},0.12)`); g2.addColorStop(1, `rgba(${c2},0)`);
      ctx.fillStyle = g2;
      ctx.beginPath(); ctx.arc(x, y, e.r * 1.95, 0, TAU); ctx.fill();
    } else {
      // 狂暴态: 血雾脉动光环(双圈呼吸 + 心跳节律)
      let pulse = 0.5, pulse2 = 0.5;
      if (e.raged) {
        pulse = 0.5 + 0.5 * Math.sin(game.time * 6.5);
        pulse2 = 0.5 + 0.5 * Math.sin(game.time * 6.5 + 1.2);
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 2; i++) {
          const rr = e.r * (1.45 + i * 0.5) * (1 + (i === 0 ? pulse : pulse2) * 0.12);
          ctx.strokeStyle = `rgba(255,60,45,${(i === 0 ? 0.32 : 0.16) * (0.6 + 0.4 * (i === 0 ? pulse : pulse2))})`;
          ctx.lineWidth = 2.5 - i * 0.8;
          ctx.beginPath(); ctx.arc(x, y, rr, 0, TAU); ctx.stroke();
        }
        ctx.globalCompositeOperation = 'source-over';
      }
      const g = ctx.createRadialGradient(x, y, 0, x, y, e.r * (e.raged ? 1.9 : 1.6));
      const c = e.raged ? '255,70,55' : e.final ? '87,232,255'
        : e.affix ? ELITE_AFFIXES[e.affix].rgb : '200,80,255';
      g.addColorStop(0, `rgba(${c},${e.raged ? 0.14 + 0.08 * pulse : 0.14})`); g.addColorStop(1, `rgba(${c},0)`);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, e.r * 1.6, 0, TAU); ctx.fill();
    }
  }
  // 魔盾词缀: 能量护盾罩(三段旋转弧 + 呼吸脉动 + 内侧淡光)
  if (e.shield > 0) {
    const t = game.time;
    const pulse = Math.sin(t * 3) * 2;
    const rr = e.r * 1.32 + pulse;
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(x, y - e.r * 0.2, e.r * 0.5, x, y - e.r * 0.2, rr);
    g.addColorStop(0, 'rgba(150,225,255,0)');
    g.addColorStop(1, 'rgba(150,225,255,0.12)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y - e.r * 0.2, rr, 0, TAU); ctx.fill();
    ctx.strokeStyle = `rgba(170,235,255,${0.55 + 0.25 * Math.sin(t * 3)})`;
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) { // 三段旋转弧, 护盾充能感
      const a0 = t * 1.9 + i / 3 * TAU;
      ctx.beginPath(); ctx.arc(x, y - e.r * 0.2, rr, a0, a0 + TAU / 4.2); ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  // 小怪血条(受损时): 词缀精英用词缀色
  if (!e.boss && e.hp < e.maxHp) {
    const w = e.r * 1.7;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(x - w / 2, y - e.r - 9, w, 3.5);
    const af = e.affix ? ELITE_AFFIXES[e.affix] : null;
    ctx.fillStyle = af ? `rgb(${af.rgb})` : e.elite ? '#c94dff' : '#ff5b6e';
    ctx.fillRect(x - w / 2, y - e.r - 9, w * Math.max(0, e.hp / e.maxHp), 3.5);
  }
  // 处决标记: 濒血敌人头顶浮现绯红断剑标记(呼吸浮动, 提示可处决)
  if (!e.boss && e.type !== 'goblin' && !e.dead && e.hp > 0 && e.hp < e.maxHp * 0.15) {
    const bob = Math.sin(game.time * 6 + e.wob) * 2.5;
    const my = y - e.r - 20 + bob;
    ctx.save(); ctx.translate(x, my);
    ctx.globalAlpha = 0.75 + 0.25 * Math.sin(game.time * 8);
    // 绯红断剑: 剑身 + 折断缺口
    ctx.strokeStyle = '#ff4d5e'; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(0, 3); ctx.stroke(); // 剑身
    ctx.beginPath(); ctx.moveTo(-3, -2); ctx.lineTo(3, -2); ctx.stroke(); // 护手
    ctx.fillStyle = '#ff4d5e';
    ctx.beginPath(); ctx.moveTo(0, 6); ctx.lineTo(2.4, 3); ctx.lineTo(-2.4, 3); ctx.closePath(); ctx.fill(); // 剑柄
    ctx.strokeStyle = 'rgba(255,77,94,0.35)'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(0, 3); ctx.stroke(); // 辉光
    ctx.globalAlpha = 1;
    ctx.restore();
  }
  // 精英词缀名牌: 血条上方悬浮词缀名(双词缀分色并排), 玩家可辨识威胁类型
  if (e.elite && e.affix) {
    const af = ELITE_AFFIXES[e.affix];
    const af2 = e.affix2 ? ELITE_AFFIXES[e.affix2] : null;
    ctx.font = 'bold 9px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    if (af2) {
      const txt1 = af.name + '·', txt2 = af2.name;
      const w1 = ctx.measureText(txt1).width, w2 = ctx.measureText(txt2).width;
      const x0 = x - (w1 + w2) / 2;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillText(txt1 + txt2, x + 1, y - e.r - 14 + 1);
      ctx.textAlign = 'left';
      ctx.fillStyle = `rgb(${af.rgb})`;
      ctx.fillText(txt1, x0, y - e.r - 14);
      ctx.fillStyle = `rgb(${af2.rgb})`;
      ctx.fillText(txt2, x0 + w1, y - e.r - 14);
    } else {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillText(af.name, x + 1, y - e.r - 14 + 1);
      ctx.fillStyle = `rgb(${af.rgb})`;
      ctx.fillText(af.name, x, y - e.r - 14);
    }
  }
}

/* ---------------- 绘制: 特效层 ---------------- */
function drawAura() {
  const P = player;
  if (!P.weapons.aura) return;
  const st = wStats('aura', P.weapons.aura.lv);
  const evo = P.weapons.aura.evoed;
  const R = st.r * P.stats.area;
  const x = P.x - cam.x + shakeX(), y = P.y - cam.y + shakeY();
  const pulse = 1 + P.auraPulse * 0.08;
  const g = ctx.createRadialGradient(x, y, R * 0.2, x, y, R * pulse);
  if (evo) { // 神圣新星: 更白亮的圣辉
    g.addColorStop(0, 'rgba(255,250,225,0.14)');
    g.addColorStop(0.75, 'rgba(255,243,184,0.2)');
    g.addColorStop(1, 'rgba(255,215,120,0)');
  } else {
    g.addColorStop(0, 'rgba(255,215,106,0.10)');
    g.addColorStop(0.75, 'rgba(255,215,106,0.16)');
    g.addColorStop(1, 'rgba(255,180,80,0)');
  }
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, R * pulse, 0, TAU); ctx.fill();
  // 边环(进化: 双层圣环)
  ctx.strokeStyle = `rgba(255,${evo ? 248 : 215},${evo ? 200 : 106},${0.35 + P.auraPulse * 0.4})`;
  ctx.lineWidth = evo ? 2.6 : 2;
  ctx.beginPath(); ctx.arc(x, y, R * pulse, 0, TAU); ctx.stroke();
  if (evo) {
    ctx.strokeStyle = `rgba(255,255,240,${0.16 + P.auraPulse * 0.22})`;
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(x, y, R * 0.82, 0, TAU); ctx.stroke();
  }
  // 旋转符文
  ctx.fillStyle = evo ? 'rgba(255,252,220,0.65)' : 'rgba(255,230,150,0.5)';
  const RN = evo ? 10 : 6;
  for (let i = 0; i < RN; i++) {
    const a = game.time * 0.8 + i / RN * TAU;
    const rx = x + Math.cos(a) * R * 0.92, ry = y + Math.sin(a) * R * 0.92;
    ctx.save(); ctx.translate(rx, ry); ctx.rotate(a + Math.PI / 4);
    ctx.fillRect(-2.6, -2.6, 5.2, 5.2);
    ctx.restore();
  }
}
function drawOrbitBlades() {
  const P = player;
  if (!P.weapons.orbit) return;
  const st = wStats('orbit', P.weapons.orbit.lv);
  const evo = P.weapons.orbit.evoed;
  const R = st.r * P.stats.area;
  const bs = evo ? 1.28 : 1; // 进化刃体放大
  for (let i = 0; i < st.n; i++) {
    const a = P.orbA + i / st.n * TAU;
    const x = P.x + Math.cos(a) * R - cam.x + shakeX();
    const y = P.y + Math.sin(a) * R - cam.y + shakeY();
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a * 3);
    ctx.scale(bs, bs);
    // 光晕(进化: 金色)
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 16);
    if (evo) { g.addColorStop(0, 'rgba(255,233,160,0.4)'); g.addColorStop(1, 'rgba(255,233,160,0)'); }
    else { g.addColorStop(0, 'rgba(200,220,255,0.35)'); g.addColorStop(1, 'rgba(200,220,255,0)'); }
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, 16, 0, TAU); ctx.fill();
    // 刃体(三叶)
    ctx.fillStyle = evo ? '#fff6d8' : '#e8eefb';
    ctx.beginPath();
    for (let k = 0; k < 3; k++) {
      const ba = k / 3 * TAU;
      ctx.moveTo(Math.cos(ba) * 4, Math.sin(ba) * 4);
      ctx.lineTo(Math.cos(ba + 0.5) * 13, Math.sin(ba + 0.5) * 13);
      ctx.lineTo(Math.cos(ba + 1.05) * 4, Math.sin(ba + 1.05) * 4);
    }
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = evo ? '#ffb347' : '#8fb0ff';
    ctx.beginPath(); ctx.arc(0, 0, 3, 0, TAU); ctx.fill();
    ctx.restore();
  }
}
function drawBullets() {
  ctx.lineCap = 'round';
  for (const b of bullets) {
    const x = b.x - cam.x + shakeX(), y = b.y - cam.y + shakeY();
    if (b.kind === 'shard') { // 冰晶弹片: 旋转菱形晶体 + 淡蓝拖尾
      const ang = Math.atan2(b.vy, b.vx) + game.time * 14;
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = '#bfe6ff'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x - b.vx / 340 * 12, y - b.vy / 340 * 12); ctx.lineTo(x, y); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
      ctx.fillStyle = '#dff2ff';
      ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(3.5, 0); ctx.lineTo(0, 6); ctx.lineTo(-3.5, 0); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(140,210,255,0.9)'; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.restore();
      continue;
    }
    if (b.kind === 'arrow') { // 霜华冰矢: 箭杆 + 菱形晶簇 + 尾羽, 飞行越远辉光越盛
      const ang = Math.atan2(b.vy, b.vx);
      const len = b.evo ? 26 : 20;
      const charge = Math.min(1, b.travel / 700); // 凝霜充能 0→1
      ctx.save();
      ctx.translate(x, y); ctx.rotate(ang);
      // 寒霜尾迹(随里程增强)
      ctx.globalAlpha = 0.22 + 0.35 * charge;
      ctx.strokeStyle = b.evo ? '#dff4ff' : '#9ad8ff';
      ctx.lineWidth = b.r * 0.5;
      ctx.beginPath(); ctx.moveTo(-len * 1.7, 0); ctx.lineTo(-len * 0.3, 0); ctx.stroke();
      ctx.globalAlpha = 1;
      // 箭杆
      ctx.strokeStyle = b.evo ? '#eaf8ff' : '#cfeaff';
      ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.moveTo(-len, 0); ctx.lineTo(len * 0.35, 0); ctx.stroke();
      // 箭簇(菱形晶锋)
      ctx.fillStyle = b.evo ? '#ffffff' : '#dff2ff';
      ctx.beginPath();
      ctx.moveTo(len * 0.85, 0); ctx.lineTo(len * 0.2, -5.5); ctx.lineTo(len * 0.35, 0); ctx.lineTo(len * 0.2, 5.5);
      ctx.closePath(); ctx.fill();
      // 尾羽
      ctx.strokeStyle = b.evo ? '#bfe8ff' : '#a8d8f0';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(-len, 0); ctx.lineTo(-len * 0.72, -4.5);
      ctx.moveTo(-len, 0); ctx.lineTo(-len * 0.72, 4.5);
      ctx.moveTo(-len * 0.85, 0); ctx.lineTo(-len * 0.6, -3.5);
      ctx.moveTo(-len * 0.85, 0); ctx.lineTo(-len * 0.6, 3.5);
      ctx.stroke();
      // 满蓄/进化: 环形寒辉脉动
      if (charge > 0.99 || b.evo) {
        ctx.strokeStyle = `rgba(190,235,255,${0.35 + 0.3 * Math.sin(game.time * 18)})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(0, 0, 8.5 + Math.sin(game.time * 20) * 1.5, 0, TAU); ctx.stroke();
      }
      ctx.restore();
      continue;
    }
    const isFire = b.kind === 'fire';
    const sp = isFire ? (b.evo ? SPRITE.fireEvo : SPRITE.fire) : (b.evo ? SPRITE.boltEvo : SPRITE.bolt);
    // 拖尾(纯色半透明, 避免每弹每帧创建渐变对象)
    const len = Math.hypot(b.vx, b.vy) || 1;
    const tl = b.evo ? 22 : 16;
    const tx = x - b.vx / len * tl, ty = y - b.vy / len * tl;
    ctx.globalAlpha = b.evo ? 0.55 : 0.42;
    ctx.strokeStyle = isFire ? (b.evo ? '#ffb347' : '#ff9040') : (b.evo ? '#c8f4ff' : '#57e8ff');
    ctx.lineWidth = b.r * 1.1;
    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(x, y); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.drawImage(sp, x - sp.width / 2, y - sp.height / 2);
  }
}
function drawEBullets() {
  for (const b of ebullets) {
    const x = b.x - cam.x + shakeX(), y = b.y - cam.y + shakeY();
    if (b.hex) { // 疫病弹: 紫焰核心
      ctx.drawImage(SPRITE.hexbullet, x - 20, y - 20);
      ctx.fillStyle = '#e8c0ff';
      ctx.beginPath(); ctx.arc(x, y, 3.2, 0, TAU); ctx.fill();
    } else {
      ctx.drawImage(SPRITE.ebullet, x - 20, y - 20);
      // 核心更实
      ctx.fillStyle = '#ffd0a0';
      ctx.beginPath(); ctx.arc(x, y, 3.5, 0, TAU); ctx.fill();
    }
  }
}
function drawBolts() {
  for (const b of bolts) {
    const x = b.x - cam.x + shakeX(), y = b.y - cam.y + shakeY();
    const a = 1 - b.age / 0.28;
    const evo = !!b.evo; // 天罚审判: 金白色粗雷
    // 闪电路径
    ctx.globalAlpha = a;
    const rnd = mulberry32(Math.floor(b.seed));
    ctx.strokeStyle = evo ? '#fff8dc' : '#dff4ff'; ctx.lineWidth = evo ? 4.5 : 3; ctx.lineJoin = 'round';
    ctx.beginPath();
    let px = x + (rnd() - 0.5) * 30, py = -10;
    ctx.moveTo(px, py);
    const segs = 7;
    for (let i = 1; i <= segs; i++) {
      const t = i / segs;
      px = x + (rnd() - 0.5) * 44 * (1 - t * 0.6);
      py = -10 + (y + 10) * t;
      ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.strokeStyle = evo ? 'rgba(255,215,120,0.55)' : 'rgba(120,200,255,0.5)'; ctx.lineWidth = evo ? 13 : 9;
    ctx.stroke();
    // 落点冲击圈
    const rr = (1 - a) * (evo ? 62 : 46) + 8;
    ctx.strokeStyle = evo ? `rgba(255,235,180,${a * 0.85})` : `rgba(180,230,255,${a * 0.8})`;
    ctx.lineWidth = evo ? 3.2 : 2.5;
    ctx.beginPath(); ctx.arc(x, y, rr, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 1;
  }
}
/* 元素链电弧: 感电链爆的点对点锯齿闪电线(双通道辉光+亮芯, 每 25ms 变形) */
function drawArcs() {
  for (const a of arcs) {
    const al = 1 - a.age / 0.22;
    const x1 = a.x1 - cam.x + shakeX(), y1 = a.y1 - cam.y + shakeY();
    const x2 = a.x2 - cam.x + shakeX(), y2 = a.y2 - cam.y + shakeY();
    const rnd = mulberry32(Math.floor(a.seed) + Math.floor(game.time * 40) * 7);
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineJoin = 'round';
    for (let pass = 0; pass < 2; pass++) { // 双通道: 宽辉光 + 细亮芯
      const core = pass === 1;
      ctx.strokeStyle = core ? `rgba(240,250,255,${al})` : `rgba(150,200,255,${al * 0.5})`;
      ctx.lineWidth = core ? 2 : 6.5;
      ctx.beginPath(); ctx.moveTo(x1, y1);
      const segs = 5;
      for (let i = 1; i < segs; i++) {
        const t = i / segs;
        ctx.lineTo(x1 + (x2 - x1) * t + (rnd() - 0.5) * 20, y1 + (y2 - y1) * t + (rnd() - 0.5) * 20);
      }
      ctx.lineTo(x2, y2); ctx.stroke();
    }
    // 端点电花
    ctx.fillStyle = `rgba(220,240,255,${al * 0.8})`;
    ctx.beginPath(); ctx.arc(x2, y2, 3, 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }
}
/* 虚空漩涡: 旋转螺旋臂 + 暗核 + 边缘扭曲光晕(进化态金色核心) */
function drawVortexes() {
  for (const v of vortexes) {
    const x = v.x - cam.x + shakeX(), y = v.y - cam.y + shakeY();
    const grow = Math.min(1, (v.max - v.life) / 0.3);       // 生成期快速展开
    const fade = Math.min(1, v.life / 0.4);                  // 消散期收缩淡出
    const R = v.r * grow * (0.85 + 0.15 * fade);
    const spin = game.time * (v.evo ? 3.2 : 2.4);
    ctx.globalCompositeOperation = 'lighter';
    // 外圈辉光
    const g = ctx.createRadialGradient(x, y, R * 0.2, x, y, R * 1.25);
    g.addColorStop(0, v.evo ? 'rgba(227,200,255,0.34)' : 'rgba(176,110,240,0.30)');
    g.addColorStop(1, 'rgba(90,40,150,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, R * 1.25, 0, TAU); ctx.fill();
    // 三条螺旋臂(相位差 120°, 逐渐内旋)
    ctx.lineCap = 'round';
    for (let arm = 0; arm < 3; arm++) {
      ctx.strokeStyle = v.evo ? `rgba(227,200,255,${0.5 * fade})` : `rgba(176,110,240,${0.45 * fade})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let t = 0; t <= 1.001; t += 0.06) {
        const a = spin + arm / 3 * TAU + t * 3.4;
        const rr = R * (0.15 + t * 0.9);
        const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
        t === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    // 暗核(吞噬之眼)
    const cg = ctx.createRadialGradient(x, y, 0, x, y, R * 0.32);
    cg.addColorStop(0, 'rgba(8,4,16,0.95)');
    cg.addColorStop(0.7, v.evo ? 'rgba(120,70,190,0.55)' : 'rgba(80,40,140,0.5)');
    cg.addColorStop(1, 'rgba(176,110,240,0)');
    ctx.fillStyle = cg;
    ctx.beginPath(); ctx.arc(x, y, R * 0.32, 0, TAU); ctx.fill();
    // 核心亮瞳
    ctx.fillStyle = v.evo ? `rgba(255,240,220,${0.85 * fade})` : `rgba(230,200,255,${0.7 * fade})`;
    ctx.beginPath(); ctx.arc(x, y, R * 0.07, 0, TAU); ctx.fill();
  }
}
/* 符文地刺: 符阵预警(旋转符文环 + 倒计时内环) → 石棘喷发(中心主刺 + 环布小刺) */
function drawSpikes() {
  const spikeTri = (px, py, w, h, fill, edge) => { // 单根石棘(三角锥)
    ctx.beginPath();
    ctx.moveTo(px - w, py);
    ctx.lineTo(px + w, py);
    ctx.lineTo(px, py - h);
    ctx.closePath();
    ctx.fillStyle = fill; ctx.fill();
    ctx.strokeStyle = edge; ctx.lineWidth = 1.2; ctx.stroke();
  };
  for (const s of spikes) {
    const x = s.x - cam.x + shakeX(), y = s.y - cam.y + shakeY();
    if (!s.hit) {
      // —— 符阵预警: 越接近喷发越亮越急 ——
      const prog = 1 - s.t / s.tele;                                  // 0→1
      const pulse = 0.3 + 0.5 * prog + 0.2 * Math.sin(game.time * (5 + 16 * prog));
      ctx.save();
      ctx.translate(x, y);
      // 旋转外环 + 八方符文刻痕
      ctx.save();
      ctx.rotate(game.time * 1.6);
      ctx.strokeStyle = `rgba(216,176,106,${pulse})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, s.r, 0, TAU); ctx.stroke();
      for (let i = 0; i < 8; i++) {
        const a = i / 8 * TAU;
        ctx.beginPath(); ctx.arc(0, 0, s.r * 0.78, a - 0.17, a + 0.17); ctx.stroke();
      }
      ctx.restore();
      // 倒计时收缩内环
      ctx.strokeStyle = `rgba(255,226,160,${0.45 + 0.45 * prog})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(0, 0, Math.max(4, s.r * (1 - prog * 0.9)), 0, TAU); ctx.stroke();
      // 中心符印(旋转菱形 + 十字)
      ctx.save();
      ctx.rotate(-game.time * 2.2);
      ctx.strokeStyle = `rgba(255,226,160,${pulse})`;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(-s.r * 0.16, -s.r * 0.16, s.r * 0.32, s.r * 0.32);
      ctx.beginPath();
      ctx.moveTo(0, -s.r * 0.28); ctx.lineTo(0, s.r * 0.28);
      ctx.moveTo(-s.r * 0.28, 0); ctx.lineTo(s.r * 0.28, 0);
      ctx.stroke();
      ctx.restore();
      ctx.restore();
    } else {
      // —— 喷发: 石棘弹出后消散 ——
      const life = Math.max(0, s.burstT / 0.3);                       // 1→0
      const pop = Math.min(1, (0.3 - s.burstT) / 0.07);               // 快速弹出
      const H0 = s.r * 0.95 * pop * (0.65 + 0.35 * life);             // 刺高随寿命回落
      const alpha = Math.min(1, life * 2.2);
      ctx.save();
      ctx.translate(x, y);
      ctx.globalAlpha = alpha;
      // 进化态: 金辉地面光晕
      if (s.evo) {
        ctx.globalCompositeOperation = 'lighter';
        const gg = ctx.createRadialGradient(0, 0, 0, 0, 0, s.r);
        gg.addColorStop(0, 'rgba(255,226,160,0.35)');
        gg.addColorStop(1, 'rgba(255,200,100,0)');
        ctx.fillStyle = gg;
        ctx.beginPath(); ctx.arc(0, 0, s.r, 0, TAU); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      }
      // 落点尘土阴影(椭圆)
      ctx.fillStyle = s.evo ? 'rgba(120,90,40,0.4)' : 'rgba(60,45,25,0.45)';
      ctx.beginPath(); ctx.ellipse(0, 0, s.r * 0.9 * pop, s.r * 0.5 * pop, 0, 0, TAU); ctx.fill();
      const fill = s.evo ? '#8a6d3a' : '#5c4830';
      const edge = s.evo ? '#ffe2a0' : '#c9a86a';
      // 环布小刺(内 5 根 + 外 4 根, 椭圆压扁贴地)
      for (let ring = 0; ring < 2; ring++) {
        const cnt = ring === 0 ? 5 : 4;
        const rr = s.r * (ring === 0 ? 0.55 : 0.85);
        const h = H0 * (ring === 0 ? 0.68 : 0.5);
        const w = Math.max(2.5, s.r * (ring === 0 ? 0.09 : 0.07));
        for (let i = 0; i < cnt; i++) {
          const a = i / cnt * TAU + ring * 0.7 + s.seed;
          spikeTri(Math.cos(a) * rr, Math.sin(a) * rr * 0.55, w, h, fill, edge);
        }
      }
      // 中心主刺(最粗最高)
      spikeTri(0, 0, Math.max(4, s.r * 0.13), H0, fill, edge);
      ctx.restore();
      ctx.globalAlpha = 1;
    }
  }
}
/* 刺客刀光: 扇形斩击弧光, 快速展开消散 */
function drawSlashes() {
  for (const s of slashes) {
    const x = s.x - cam.x + shakeX(), y = s.y - cam.y + shakeY();
    const t = s.age / 0.2;
    const R = 96 * (0.55 + 0.45 * t); // 快速外扩
    const a = 1 - t;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(s.ang);
    ctx.globalAlpha = a;
    // 双重弧形刀光(主刃 + 残影)
    ctx.strokeStyle = s.elite ? '#e8b8ff' : '#f0f4ff';
    ctx.lineWidth = 5 * (1 - t * 0.5);
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(0, 0, R, -0.85, 0.85); ctx.stroke();
    ctx.strokeStyle = 'rgba(192,110,240,0.6)';
    ctx.lineWidth = 9 * (1 - t);
    ctx.beginPath(); ctx.arc(0, 0, R * 0.86, -0.7, 0.7); ctx.stroke();
    ctx.restore();
    ctx.globalAlpha = 1;
  }
}
/* 回响刃: 旋转双翼回旋镖 + 运动反向残影 + 归途轨迹微光 */
function drawEchoes() {
  ctx.globalCompositeOperation = 'lighter';
  for (const b of echoes) {
    const x = b.x - cam.x + shakeX(), y = b.y - cam.y + shakeY();
    if (x < -80 || x > W + 80 || y < -80 || y > H + 80) continue;
    const col = b.evo ? '200,255,240' : '127,242,200';
    // 残影(沿运动反向渐隐, 旋转滞后)
    for (let k = 1; k <= 3; k++) {
      const tx = x - b.mvx * 13 * k, ty = y - b.mvy * 13 * k;
      ctx.save();
      ctx.translate(tx, ty);
      ctx.rotate(b.ang - k * 0.55);
      ctx.globalAlpha = 0.34 - k * 0.09;
      ctx.fillStyle = `rgb(${col})`;
      for (let arm = 0; arm < 2; arm++) {
        ctx.save();
        ctx.rotate(arm * Math.PI);
        ctx.beginPath();
        ctx.moveTo(0, -2.6);
        ctx.quadraticCurveTo(7, -9, 14.5, -5);
        ctx.quadraticCurveTo(7, -2, 0, 2.6);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      ctx.restore();
    }
    // 主体(双翼弯刃 + 亮核)
    ctx.globalAlpha = 1;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(b.ang);
    ctx.fillStyle = `rgb(${col})`;
    for (let arm = 0; arm < 2; arm++) {
      ctx.save();
      ctx.rotate(arm * Math.PI);
      ctx.beginPath();
      ctx.moveTo(0, -2.6);
      ctx.quadraticCurveTo(7, -9, 14.5, -5);
      ctx.quadraticCurveTo(7, -2, 0, 2.6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = b.evo ? '#ffffff' : '#eafff6';
    ctx.beginPath(); ctx.arc(0, 0, 2.6, 0, TAU); ctx.fill();
    ctx.restore();
  }
  ctx.globalCompositeOperation = 'source-over';
}
/* 雷暴落雷: 预警圈(红圈收缩+电花) → 锯齿闪电束劈落(双通道+辉光) */
function drawStrikes() {
  for (const s of strikes) {
    const x = s.x - cam.x + shakeX(), y = s.y - cam.y + shakeY();
    if (s.t > 0) { // 预警: 危险圈收缩 + 电光闪烁预兆
      const p = 1 - s.t / STRIKE_WARN;
      const flick = p > 0.6 ? (Math.sin(game.time * 30 + s.seed) > 0 ? 1 : 0.4) : 1;
      ctx.strokeStyle = `rgba(255,70,90,${(0.4 + 0.5 * p) * flick})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(x, y, s.r * (1.5 - p * 0.5), 0, TAU); ctx.stroke();
      // 内圈填充微红
      ctx.fillStyle = `rgba(255,60,80,${0.06 + 0.08 * p})`;
      ctx.beginPath(); ctx.arc(x, y, s.r, 0, TAU); ctx.fill();
      // 中心电花(雷光将落)
      if (p > 0.4 && Math.random() < 0.4) {
        ctx.strokeStyle = 'rgba(190,220,255,0.85)';
        ctx.lineWidth = 1.4;
        const rnd = mulberry32(Math.floor(game.time * 60 + s.seed));
        ctx.beginPath();
        let px = x, py = y - 40 - rnd() * 30;
        ctx.moveTo(px, py);
        for (let j = 0; j < 4; j++) { px += (rnd() - 0.5) * 22; py += 14 + rnd() * 10; ctx.lineTo(px, py); }
        ctx.stroke();
      }
      continue;
    }
    if (s.age >= 0 && s.age < 0.2) { // 闪电束: 从屏幕顶劈落
      const a = 1 - s.age / 0.2;
      const rnd = mulberry32(Math.floor(s.seed * 9973) + Math.floor(game.time * 40) * 7); // 每 25ms 变形, 闪电更生动
      ctx.globalCompositeOperation = 'lighter';
      for (let pass = 0; pass < 2; pass++) { // 双通道: 宽辉光 + 细亮芯
        const isCore = pass === 1;
        ctx.strokeStyle = isCore ? `rgba(255,255,255,${a})` : `rgba(170,200,255,${a * 0.5})`;
        ctx.lineWidth = isCore ? 2.6 : 7;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        let px = x + (rnd() - 0.5) * 60, py = -20;
        ctx.moveTo(px, py);
        const segs = 7;
        for (let j = 1; j <= segs; j++) {
          const tt = j / segs;
          const ty = -20 + (y + 20) * tt;
          const jitter = (1 - Math.abs(tt - 0.65) * 1.2) * 34; // 中段抖动最大
          px = x + (rnd() - 0.5) * jitter * 2;
          ctx.lineTo(px, ty);
        }
        ctx.lineTo(x, y);
        ctx.stroke();
      }
      // 落点爆闪
      const g = ctx.createRadialGradient(x, y, 0, x, y, s.r);
      g.addColorStop(0, `rgba(230,240,255,${a * 0.85})`);
      g.addColorStop(1, 'rgba(170,200,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, s.r, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
  }
}
/* 流星雨陨石: 预警圈(橙圈收缩+星形预兆+来向轨迹虚影) → 斜坠火流星(亮核+渐变火尾) → 落地爆闪 + 燃屑地带余烬 */
function drawMeteors() {
  for (const m of meteors) {
    const x = m.x - cam.x + shakeX(), y = m.y - cam.y + shakeY();
    if (m.phase === 0) { // 预警: 椭圆橙圈收缩(透视感) + 中心星形 + 来向虚影
      const p = 1 - m.t / METEOR_WARN;
      const flick = p > 0.55 ? (Math.sin(game.time * 26 + m.seed) > 0 ? 1 : 0.45) : 1;
      ctx.strokeStyle = `rgba(255,150,50,${(0.45 + 0.5 * p) * flick})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.ellipse(x, y, m.r * (1.55 - p * 0.55), m.r * 0.62 * (1.55 - p * 0.55), 0, 0, TAU); ctx.stroke();
      ctx.fillStyle = `rgba(255,120,40,${0.07 + 0.09 * p})`;
      ctx.beginPath(); ctx.ellipse(x, y, m.r, m.r * 0.62, 0, 0, TAU); ctx.fill();
      // 来向轨迹虚影(右上 → 落点)
      ctx.setLineDash([7, 9]);
      ctx.strokeStyle = `rgba(255,170,80,${0.18 + 0.3 * p})`;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(x + 360 * (1 - p * 0.35), y - 470 * (1 - p * 0.35));
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.setLineDash([]);
      // 中心星形预兆(旋转十字, 将落未落)
      if (p > 0.4) {
        const sa = game.time * 3 + m.seed;
        ctx.strokeStyle = `rgba(255,210,120,${(p - 0.4) * 1.6 * flick})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < 4; i++) {
          const a = sa + i * Math.PI / 2;
          ctx.moveTo(x - Math.cos(a) * 10, y - Math.sin(a) * 10);
          ctx.lineTo(x + Math.cos(a) * 10, y + Math.sin(a) * 10);
        }
        ctx.stroke();
      }
      continue;
    }
    if (m.phase === 1) { // 坠落: 白亮核流星 + 三层渐变火尾
      const px = x + 360 * (1 - m.fallT), py = y - 470 * (1 - m.fallT);
      const L = Math.hypot(360, 470), ux = 360 / L, uy = -470 / L; // 尾迹方向(背离落点)
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      const t1 = ctx.createLinearGradient(px, py, px - ux * 110, py - uy * 110);
      t1.addColorStop(0, 'rgba(255,200,110,0.55)');
      t1.addColorStop(1, 'rgba(255,110,40,0)');
      ctx.strokeStyle = t1; ctx.lineWidth = 11;
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px - ux * 110, py - uy * 110); ctx.stroke();
      const t2 = ctx.createLinearGradient(px, py, px - ux * 55, py - uy * 55);
      t2.addColorStop(0, 'rgba(255,240,200,0.85)');
      t2.addColorStop(1, 'rgba(255,170,80,0)');
      ctx.strokeStyle = t2; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px - ux * 55, py - uy * 55); ctx.stroke();
      ctx.fillStyle = '#fff8ec';
      ctx.beginPath(); ctx.arc(px, py, 5.5, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      continue;
    }
    if (m.age < 0.3) { // 落地爆闪: 橙白辉光扩散
      const a = 1 - m.age / 0.3;
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(x, y, 0, x, y, m.r * 1.2);
      g.addColorStop(0, `rgba(255,250,230,${a * 0.9})`);
      g.addColorStop(0.5, `rgba(255,170,80,${a * 0.55})`);
      g.addColorStop(1, 'rgba(255,90,30,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, m.r * 1.2, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
  }
  // 燃屑地带: 地面余烬微光(暗橙脉动, 随生命衰减)
  for (const z of emberZones) {
    const x = z.x - cam.x + shakeX(), y = z.y - cam.y + shakeY();
    if (x < -120 || x > W + 120 || y < -120 || y > H + 120) continue;
    const a = Math.min(1, z.life / 0.6) * (0.16 + 0.07 * Math.sin(game.time * 7 + z.x));
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(x, y, 0, x, y, z.r);
    g.addColorStop(0, `rgba(255,140,50,${a})`);
    g.addColorStop(1, 'rgba(200,60,20,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(x, y, z.r, z.r * 0.62, 0, 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }
}
/* 灵魂升腾: 光核 + 呼吸光晕 + 摇曳上升(小怪幽蓝 / 精英鎏金 / Boss 巨魂) */
function drawSouls() {
  ctx.globalCompositeOperation = 'lighter';
  for (const s of souls) {
    const x = s.x - cam.x + shakeX(), y = s.y - cam.y + shakeY();
    if (x < -60 || x > W + 60 || y < -60 || y > H + 60) continue;
    const a = Math.min(1, s.life / 0.5); // 末段渐隐
    const pulse = 0.85 + 0.15 * Math.sin(s.sway * 2); // 呼吸脉动
    const R = s.r * 3.4 * pulse;
    const g = ctx.createRadialGradient(x, y, 0, x, y, R);
    g.addColorStop(0, `rgba(${s.col},${0.75 * a})`);
    g.addColorStop(0.45, `rgba(${s.col},${0.28 * a})`);
    g.addColorStop(1, `rgba(${s.col},0)`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.fill();
    ctx.fillStyle = `rgba(255,255,255,${0.9 * a})`;
    ctx.beginPath(); ctx.arc(x, y, s.r * 0.42, 0, TAU); ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}
/* 发光体地面反光: 悬浮物下方的压扁光斑(双层椭圆, 无渐变对象, 极低开销) */
function groundGlow(x, y, w, color) {
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.1;
  ctx.beginPath(); ctx.ellipse(x, y, w, w * 0.34, 0, 0, TAU); ctx.fill();
  ctx.globalAlpha = 0.16;
  ctx.beginPath(); ctx.ellipse(x, y, w * 0.55, w * 0.19, 0, 0, TAU); ctx.fill();
  ctx.globalAlpha = 1;
}
function drawGems() {
  for (const g of gems) {
    const x = g.x - cam.x + shakeX(), y = g.y - cam.y + shakeY() + Math.sin(g.bob) * 2.5;
    if (x < -30 || x > W + 30 || y < -30 || y > H + 30) continue;
    const big = g.v >= 15, mid = g.v >= 5;
    const r = big ? 9 : mid ? 7.5 : 6;
    const c1 = big ? '#ffe9a0' : mid ? '#d0a0ff' : '#9df0ff';
    const c2 = big ? '#d9a020' : mid ? '#8a4fd0' : '#2a9ec8';
    groundGlow(x, y + r + 4, r + 5, big ? '#d9a020' : mid ? '#a070e8' : '#57c8e8'); // 地面反光
    // 光晕
    ctx.drawImage(SPRITE.gem, x - 16, y - 16, 32, 32);
    ctx.globalAlpha = 0.9;
    // 菱形晶体
    ctx.fillStyle = c2;
    ctx.beginPath();
    ctx.moveTo(x, y - r); ctx.lineTo(x + r * 0.75, y);
    ctx.lineTo(x, y + r); ctx.lineTo(x - r * 0.75, y);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = c1;
    ctx.beginPath();
    ctx.moveTo(x, y - r); ctx.lineTo(x + r * 0.35, y - r * 0.15);
    ctx.lineTo(x, y + r * 0.3); ctx.lineTo(x - r * 0.35, y - r * 0.15);
    ctx.closePath(); ctx.fill();
    // 闪光点
    if (Math.sin(g.bob * 2 + x) > 0.94) {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(x - 4, y - 5); ctx.lineTo(x + 4, y - 5); ctx.moveTo(x, y - 9); ctx.lineTo(x, y - 1); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}
function drawCoins() {
  for (const c of coins) {
    const x = c.x - cam.x + shakeX(), y = c.y - cam.y + shakeY() + Math.sin(c.bob) * 2.5;
    if (x < -30 || x > W + 30 || y < -30 || y > H + 30) continue;
    groundGlow(x, y + 9, 10, '#ffd76a'); // 地面反光
    ctx.drawImage(SPRITE.coin, x - 14, y - 14, 28, 28);
    ctx.fillStyle = '#ffd76a';
    ctx.beginPath(); ctx.arc(x, y, 5, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#b8860b'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(x, y, 5, 0, TAU); ctx.stroke();
    ctx.fillStyle = '#fff3c0';
    ctx.beginPath(); ctx.arc(x - 1.5, y - 1.5, 1.6, 0, TAU); ctx.fill();
  }
}
/* 神秘祭坛: 石台 + 浮空符文水晶 + 青色光柱信标 */
function drawShrines() {
  for (const s of shrines) {
    const x = s.x - cam.x + shakeX(), y = s.y - cam.y + shakeY();
    if (x < -60 || x > W + 60 || y < -140 || y > H + 60) continue;
    const pulse = 0.65 + 0.35 * Math.sin(s.ph * 3);
    const fade = s.life < 8 ? (Math.sin(s.life * 9) > 0 ? 1 : 0.3) : 1; // 即将消散时闪烁
    ctx.globalAlpha = fade;
    // 地面光晕
    const g = ctx.createRadialGradient(x, y, 0, x, y, 40);
    g.addColorStop(0, `rgba(87,232,255,${0.22 * pulse})`);
    g.addColorStop(1, 'rgba(87,232,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, 40, 0, TAU); ctx.fill();
    // 上指光柱
    const lg = ctx.createLinearGradient(x, y - 130, x, y);
    lg.addColorStop(0, 'rgba(87,232,255,0)');
    lg.addColorStop(1, `rgba(87,232,255,${0.14 * pulse})`);
    ctx.fillStyle = lg;
    ctx.fillRect(x - 9, y - 130, 18, 130);
    // 石台(梯形基座)
    ctx.fillStyle = '#232839';
    ctx.beginPath();
    ctx.moveTo(x - 17, y + 10); ctx.lineTo(x - 13, y - 4);
    ctx.lineTo(x + 13, y - 4); ctx.lineTo(x + 17, y + 10);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#313852';
    ctx.fillRect(x - 14, y + 2, 28, 5);
    // 浮空符文水晶(菱形, 呼吸悬浮)
    const cy = y - 24 - Math.sin(s.ph * 2) * 6;
    ctx.save();
    ctx.translate(x, cy);
    ctx.rotate(Math.sin(s.ph) * 0.15);
    ctx.fillStyle = `rgba(87,232,255,${0.75 + 0.25 * pulse})`;
    ctx.beginPath();
    ctx.moveTo(0, -13); ctx.lineTo(8, 0); ctx.lineTo(0, 13); ctx.lineTo(-8, 0);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(230,250,255,0.9)';
    ctx.beginPath();
    ctx.moveTo(0, -6); ctx.lineTo(3.5, 0); ctx.lineTo(0, 6); ctx.lineTo(-3.5, 0);
    ctx.closePath(); ctx.fill();
    ctx.restore();
    // 环绕符文微光
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 3; i++) {
      const a = s.ph * 1.8 + i / 3 * TAU;
      ctx.fillStyle = `rgba(154,232,255,${0.35 + 0.3 * pulse})`;
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * 22, cy + Math.sin(a) * 9, 1.8, 0, TAU);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }
}
/* Boss 宝箱: 金色箱体 + 上指光柱 + 浮动 */
function drawChests() {
  for (const c of chests) {
    const x = c.x - cam.x + shakeX(), y = c.y - cam.y + shakeY() + Math.sin(c.bob) * 3;
    if (x < -60 || x > W + 60 || y < -80 || y > H + 60) continue;
    const pulse = 0.65 + 0.35 * Math.sin(game.time * 4);
    // 光晕
    const g = ctx.createRadialGradient(x, y, 0, x, y, 34);
    g.addColorStop(0, `rgba(255,215,106,${0.3 * pulse})`);
    g.addColorStop(1, 'rgba(255,215,106,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, 34, 0, TAU); ctx.fill();
    // 上指光柱
    const lg = ctx.createLinearGradient(x, y - 90, x, y);
    lg.addColorStop(0, 'rgba(255,215,106,0)');
    lg.addColorStop(1, `rgba(255,215,106,${0.16 * pulse})`);
    ctx.fillStyle = lg;
    ctx.fillRect(x - 7, y - 90, 14, 90);
    // 阴影
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath(); ctx.ellipse(x, y + 13, 15, 5, 0, 0, TAU); ctx.fill();
    // 箱体
    ctx.fillStyle = '#8a5a1e';
    ctx.fillRect(x - 13, y - 8, 26, 18);
    ctx.fillStyle = '#c9962f';
    ctx.fillRect(x - 12, y - 7, 24, 16);
    // 箱盖(圆弧顶)
    ctx.fillStyle = '#e8b84a';
    ctx.beginPath();
    ctx.moveTo(x - 13, y - 8);
    ctx.quadraticCurveTo(x, y - 20, x + 13, y - 8);
    ctx.closePath(); ctx.fill();
    // 金属包边
    ctx.fillStyle = '#ffd76a';
    ctx.fillRect(x - 13, y - 9, 26, 3);
    ctx.fillRect(x - 2, y - 9, 4, 17);
    // 锁芯闪光
    const spark = Math.sin(game.time * 6 + c.bob) > 0.6;
    ctx.fillStyle = spark ? '#ffffff' : '#ffe9a0';
    ctx.beginPath(); ctx.arc(x, y + 1, 2.4, 0, TAU); ctx.fill();
  }
}
function drawPotions() {
  for (const p of potions) {
    const x = p.x - cam.x + shakeX(), y = p.y - cam.y + shakeY() + Math.sin(p.bob) * 3;
    // 光晕
    const g = ctx.createRadialGradient(x, y, 0, x, y, 20);
    g.addColorStop(0, 'rgba(255,90,140,0.35)'); g.addColorStop(1, 'rgba(255,90,140,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, 20, 0, TAU); ctx.fill();
    // 瓶身
    ctx.fillStyle = '#3a2430';
    ctx.fillRect(x - 6, y - 3, 12, 12);
    ctx.fillStyle = '#ff5b8e';
    ctx.fillRect(x - 5, y - 2, 10, 10);
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillRect(x - 4, y - 1, 2.5, 7);
    // 瓶口
    ctx.fillStyle = '#8a6a4a';
    ctx.fillRect(x - 2.5, y - 8, 5, 5);
    // 十字标
    ctx.fillStyle = '#fff';
    ctx.fillRect(x - 1, y + 1, 2, 6); ctx.fillRect(x - 3, y + 3, 6, 2);
  }
}
/* 时之沙漏: 青金圣物, 玻璃腔内流沙缓缓下落 */
function drawRelics() {
  for (const r of relics) {
    const x = r.x - cam.x + shakeX(), y = r.y - cam.y + shakeY() + Math.sin(r.bob) * 3.5;
    if (x < -60 || x > W + 60 || y < -80 || y > H + 60) continue;
    const pulse = 0.65 + 0.35 * Math.sin(game.time * 3.2 + r.bob);
    // 光晕
    const g = ctx.createRadialGradient(x, y, 0, x, y, 30);
    g.addColorStop(0, `rgba(87,232,255,${0.3 * pulse})`);
    g.addColorStop(1, 'rgba(87,232,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, 30, 0, TAU); ctx.fill();
    // 阴影
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(x, y + 14, 10, 3.5, 0, 0, TAU); ctx.fill();
    // 砂漏主体(旋转微倾)
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.sin(r.bob * 0.5) * 0.12);
    // 上下木盖
    ctx.fillStyle = '#3d5a6e';
    ctx.fillRect(-8, -13, 16, 4);
    ctx.fillRect(-8, 9, 16, 4);
    // 玻璃腔(双三角)
    ctx.fillStyle = 'rgba(154,240,255,0.28)';
    ctx.beginPath();
    ctx.moveTo(-7, -9); ctx.lineTo(7, -9); ctx.lineTo(0, 0); ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-7, 9); ctx.lineTo(7, 9); ctx.lineTo(0, 0); ctx.closePath(); ctx.fill();
    // 流沙(上半腔堆积 + 细流 + 下半腔成堆)
    ctx.fillStyle = `rgba(135,220,255,${0.85})`;
    ctx.beginPath();
    ctx.moveTo(-4.5, -9); ctx.lineTo(4.5, -9); ctx.lineTo(0, -2.4); ctx.closePath(); ctx.fill();
    ctx.fillRect(-0.7, -3, 1.4, 7); // 中流细沙
    ctx.beginPath();
    ctx.moveTo(-4.5, 9); ctx.lineTo(4.5, 9); ctx.lineTo(0, 4); ctx.closePath(); ctx.fill();
    ctx.restore();
    // 环绕时之微尘
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 2; i++) {
      const a = game.time * 2 + r.bob + i * Math.PI;
      ctx.fillStyle = `rgba(154,240,255,${0.4 * pulse})`;
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * 18, y + Math.sin(a) * 7, 1.6, 0, TAU);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }
}
/* 屏幕外药剂/宝箱方向指示: 边缘箭头提示稀缺品方位 */
function drawOffscreenIndicators() {
  if (state !== 'playing') return;
  const mg = 34; // 屏幕边缘留白
  const items = [
    ...potions.map(p => ({ x: p.x, y: p.y, color: '#ff5b8e', rgb: '255,91,142' })),
    ...chests.map(c => ({ x: c.x, y: c.y, color: '#ffd76a', rgb: '255,215,106', big: true })),
    ...shrines.map(s => ({ x: s.x, y: s.y, color: '#57e8ff', rgb: '87,232,255', big: true })),
    ...relics.map(r => ({ x: r.x, y: r.y, color: '#9df0ff', rgb: '154,240,255', big: true })),
    ...enemies.filter(e => e.type === 'goblin' && !e.dead).map(e => ({ x: e.x, y: e.y, color: '#ffd76a', rgb: '255,215,106', big: true })),
    ...enemies.filter(e => e.elite && !e.dead && !e.boss).map(e => {
      const af = e.affix ? ELITE_AFFIXES[e.affix] : null;
      return { x: e.x, y: e.y, color: af ? `rgb(${af.rgb})` : '#c94dff', rgb: af ? af.rgb : '201,77,255', big: true };
    }),
  ];
  for (const p of items) {
    const x = p.x - cam.x, y = p.y - cam.y;
    if (x > -24 && x < W + 24 && y > -24 && y < H + 24) continue; // 屏内不提示
    const cx = W / 2, cy = H / 2, dx = x - cx, dy = y - cy;
    // 射线与屏幕边框交点(留边距), 取比例较小的一轴
    const sx = Math.abs(dx) > 1e-6 ? (W / 2 - mg) / Math.abs(dx) : Infinity;
    const sy = Math.abs(dy) > 1e-6 ? (H / 2 - mg) / Math.abs(dy) : Infinity;
    const s = Math.min(sx, sy);
    const ix = cx + dx * s, iy = cy + dy * s;
    const pulse = 0.7 + 0.3 * Math.sin(game.time * (p.big ? 4 : 6));
    const sz = p.big ? 1.3 : 1; // 宝箱指示更大
    // 光晕
    ctx.fillStyle = `rgba(${p.rgb},${0.3 * pulse})`;
    ctx.beginPath(); ctx.arc(ix, iy, 15 * sz, 0, TAU); ctx.fill();
    // 指向箭头
    ctx.save();
    ctx.translate(ix, iy);
    ctx.rotate(Math.atan2(dy, dx));
    ctx.globalAlpha = 0.9 * pulse;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.moveTo(13 * sz, 0); ctx.lineTo(-7 * sz, -8 * sz); ctx.lineTo(-7 * sz, 8 * sz);
    ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;
  }
}
/* 受击方向指示弧光: 玩家身周红色弧段指向伤害来源 */
function drawHurtDir() {
  if (game.hurtDirT <= 0 || state !== 'playing') return;
  const t = game.hurtDirT / 1.1;
  const px = player.x - cam.x + shakeX(), py = player.y - cam.y + shakeY();
  const R = 38 + (1 - t) * 26; // 随时间向外扩散
  ctx.strokeStyle = `rgba(255,60,70,${0.8 * t})`;
  ctx.lineWidth = 3 + 3 * t;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(px, py, R, game.hurtDir - 0.7, game.hurtDir + 0.7);
  ctx.stroke();
  ctx.lineCap = 'butt';
}
/* 冲击波光环 */
function drawRings() {
  for (const r of rings) {
    if (r.age < 0) continue; // 延迟启动环(进化/惊变错峰演出): 未到时间不绘制, 防负半径 arc 抛异常卡死主循环
    const t = r.age / 0.45, a = 1 - t;
    const x = r.x - cam.x + shakeX(), y = r.y - cam.y + shakeY();
    const col = r.color[0] === '#' ? hexToRgbStr(r.color) : r.color; // 兜底: hex 转 rgb 串, 防拼出无效 rgba()
    ctx.strokeStyle = `rgba(${col},${a * 0.8})`;
    ctx.lineWidth = 3 + 5 * a;
    ctx.beginPath(); ctx.arc(x, y, 30 + t * r.max, 0, TAU); ctx.stroke();
    ctx.strokeStyle = `rgba(${col},${a * 0.35})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, y, 12 + t * r.max * 0.8, 0, TAU); ctx.stroke();
  }
}
function drawParticles() {
  ctx.globalCompositeOperation = 'lighter';
  for (const p of particles) {
    const a = 1 - p.age / p.life;
    ctx.globalAlpha = a * 0.85;
    ctx.fillStyle = p.color;
    if (p.shard) { // 碎片: 旋转矩形, 抛物线坠落
      const x = p.x - cam.x + shakeX(), y = p.y - cam.y + shakeY();
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(p.rot);
      ctx.fillRect(-p.r * 0.7, -p.r * 0.45, p.r * 1.4, p.r * 0.9);
      ctx.restore();
    } else {
      ctx.beginPath();
      ctx.arc(p.x - cam.x + shakeX(), p.y - cam.y + shakeY(), p.r * (0.5 + a * 0.5), 0, TAU);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}
function drawDmgNums() {
  ctx.textAlign = 'center';
  const F2 = 'bold 22px "Segoe UI", sans-serif', F1 = 'bold 17px "Segoe UI", sans-serif', F0 = 'bold 14px "Segoe UI", sans-serif';
  for (const d of dmgNums) {
    const a = 1 - d.age / 0.8;
    const scale = d.age < 0.12 ? 1.35 - d.age * 3 : 1;
    ctx.font = d.s === 2 ? F2 : d.s === 1 ? F1 : F0;
    ctx.save();
    ctx.translate(d.x - cam.x + shakeX(), d.y - cam.y + shakeY());
    ctx.scale(scale, scale);
    ctx.globalAlpha = Math.min(1, a * 1.6);
    ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 3;
    ctx.strokeText(d.v, 0, 0);
    ctx.fillStyle = d.color;
    ctx.fillText(d.v, 0, 0);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}
/* 地面血迹(击杀留痕) */
function drawDecals() {
  for (const d of decals) {
    const x = d.x - cam.x + shakeX(), y = d.y - cam.y + shakeY();
    if (x < -50 || x > W + 50 || y < -50 || y > H + 50) continue;
    if (d.scorch) { // 雷击焦痕/陨石弹坑: 深色放射纹 + 余烬微光
      const a = (1 - d.age / d.life) * 0.5;
      const rnd = mulberry32(Math.floor(d.seed * 7919));
      ctx.fillStyle = `rgba(18,14,30,${a})`;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const aa = rnd() * TAU, rr = d.r * (0.25 + rnd() * 0.75);
        ctx.moveTo(x + Math.cos(aa) * rr, y + Math.sin(aa) * rr * 0.6);
        ctx.arc(x + Math.cos(aa) * rr, y + Math.sin(aa) * rr * 0.6, d.r * (0.12 + rnd() * 0.2), 0, TAU);
      }
      ctx.fill();
      if (d.meteor) { // 陨石弹坑: 中心深坑洞 + 岩屑环
        ctx.fillStyle = `rgba(8,5,3,${a * 1.3})`;
        ctx.beginPath(); ctx.ellipse(x, y, d.r * 0.48, d.r * 0.26, 0, 0, TAU); ctx.fill();
        ctx.strokeStyle = `rgba(40,24,14,${a * 0.9})`;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.ellipse(x, y, d.r * 0.62, d.r * 0.34, 0, 0, TAU); ctx.stroke();
      }
      const emT = d.meteor ? 1.4 : 0.5;
      if (d.age < emT) { // 余烬(弹坑橙色更持久)
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = `rgba(${d.meteor ? '255,140,60' : '160,190,255'},${(1 - d.age / emT) * 0.22})`;
        ctx.beginPath(); ctx.ellipse(x, y, d.r * 0.7, d.r * 0.32, 0, 0, TAU); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      }
      continue;
    }
    const a = (1 - d.age / d.life) * (d.elite ? 0.4 : 0.3);
    if (a < 0.01) continue; // 完全褪隐的血渍跳过绘制(省开销, 亦杜绝 alpha 浮点残渣)
    const rnd = mulberry32(Math.floor(d.seed));
    ctx.fillStyle = `rgba(96,14,26,${a})`;
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const aa = rnd() * TAU, rr = d.r * (0.3 + rnd() * 0.7);
      const ox = Math.cos(aa) * rr * 0.6, oy = Math.sin(aa) * rr * 0.35;
      ctx.moveTo(x + ox, y + oy);
      ctx.arc(x + ox, y + oy, d.r * (0.18 + rnd() * 0.3), 0, TAU);
    }
    ctx.fill();
  }
}
/* Boss 屏幕外方向指示器 */
function drawBossIndicator() {
  const boss = enemies.find(e => e.boss && !e.dead);
  if (!boss) return;
  const x = boss.x - cam.x, y = boss.y - cam.y;
  const m = 70; // 屏幕外才算
  if (x > -m && x < W + m && y > -m && y < H + m) return;
  // 指示位置: 限制在屏幕边缘内框上
  const cx = W / 2, cy = H / 2;
  const ang = Math.atan2(y - cy, x - cx);
  const ex = clamp(cx + Math.cos(ang) * 1e5, 90, W - 90);
  const ey = clamp(cy + Math.sin(ang) * 1e5, 80, H - 80);
  const pulse = 0.7 + Math.sin(game.time * 5) * 0.3;
  ctx.save();
  ctx.translate(ex, ey);
  ctx.rotate(ang);
  // 箭头
  ctx.fillStyle = `rgba(255,80,70,${0.55 + pulse * 0.35})`;
  ctx.beginPath();
  ctx.moveTo(22, 0); ctx.lineTo(-10, -14); ctx.lineTo(-4, 0); ctx.lineTo(-10, 14);
  ctx.closePath(); ctx.fill();
  ctx.restore();
  // "BOSS" 小标
  ctx.font = 'bold 10px "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = `rgba(255,120,110,${0.5 + pulse * 0.4})`;
  ctx.fillText('BOSS', ex, ey + 30);
}

function drawMotes(dt) {
  // 环境浮尘
  if (game.motes.length < 40 && Math.random() < 0.4) {
    game.motes.push({ x: cam.x + rand(0, W), y: cam.y - 10, vy: rand(12, 30), r: rand(0.8, 2), a: rand(0.15, 0.4), ph: rand(0, TAU) });
  }
  ctx.fillStyle = '#aee6ff';
  for (const m of game.motes) {
    m.y += m.vy * dt; m.ph += dt;
    const x = m.x - cam.x + Math.sin(m.ph) * 14;
    const y = m.y - cam.y;
    if (y > H + 20) { m.y = cam.y - 10; m.x = cam.x + rand(0, W); }
    ctx.globalAlpha = m.a;
    ctx.beginPath(); ctx.arc(x, y, m.r, 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;
  // 萤火虫: 暖色光点缓慢游走 + 呼吸闪烁(与冷色浮尘形成冷暖对比); 夜间更活跃
  if (!game.fireflies) game.fireflies = [];
  const isNight = game.time > 330;
  const ffCap = isNight ? 14 : 9, ffProb = isNight ? 0.12 : 0.05;
  if (game.fireflies.length < ffCap && Math.random() < ffProb) {
    game.fireflies.push({
      x: cam.x + rand(-60, W + 60), y: cam.y + rand(H * 0.3, H + 40),
      vx: rand(-8, 8), vy: rand(-6, 4), ph: rand(0, TAU), spd: rand(0.5, 1.1),
    });
  }
  ctx.globalCompositeOperation = 'lighter';
  for (const f of game.fireflies) {
    f.ph += dt * f.spd;
    f.x += (f.vx + Math.sin(f.ph * 1.3) * 9) * dt;
    f.y += (f.vy + Math.cos(f.ph * 0.9) * 7) * dt;
    // 漂出视口则回收重生
    const sx = f.x - cam.x, sy = f.y - cam.y;
    if (sx < -80 || sx > W + 80 || sy < -80 || sy > H + 80) {
      f.x = cam.x + rand(-40, W + 40); f.y = cam.y + rand(0, H);
      continue;
    }
    const glow = 0.35 + 0.65 * Math.max(0, Math.sin(f.ph * 2.2)); // 呼吸
    ctx.fillStyle = `rgba(255,214,120,${glow * 0.7})`;
    ctx.beginPath(); ctx.arc(sx, sy, 1.6, 0, TAU); ctx.fill();
    ctx.fillStyle = `rgba(255,190,90,${glow * 0.14})`; // 光晕
    ctx.beginPath(); ctx.arc(sx, sy, 5.5, 0, TAU); ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}

/* ---------------- 主渲染 ---------------- */
/* 昼夜流光: 一局 10 分钟走完 晨曦→白昼→黄昏→深夜 氛围弧线(终局 Boss 之战在深夜) */
function dayTint(t) {
  if (t < 90) return { r: 255, g: 198, b: 132, a: 0.10 * (1 - t / 90) + 0.02 };  // 晨曦渐褪
  if (t < 240) return null;                                                        // 白昼无染
  if (t < 330) { const p = (t - 240) / 90; return { r: 205 - 55 * p, g: 118 - 18 * p, b: 108 + 54 * p, a: 0.04 + 0.08 * p }; } // 黄昏
  if (t < 420) { const p = (t - 330) / 90; return { r: 150 - 92 * p, g: 100 - 44 * p, b: 162 - 66 * p, a: 0.12 + 0.04 * p }; } // 入夜
  return { r: 58, g: 56, b: 96, a: 0.15 };                                          // 深夜
}
let _shX = 0, _shY = 0;
const shakeX = () => _shX;
const shakeY = () => _shY;
function render(dt) {
  // 震屏偏移
  if (game.shake > 0.2) {
    _shX = rand(-game.shake, game.shake) * 0.6;
    _shY = rand(-game.shake, game.shake) * 0.6;
  } else { _shX = _shY = 0; }

  // 地面(cam 为视口左上角, 可视范围 [cam, cam+W/H])
  const x0 = Math.floor(cam.x / CHUNK), x1 = Math.floor((cam.x + W) / CHUNK);
  const y0 = Math.floor(cam.y / CHUNK), y1 = Math.floor((cam.y + H) / CHUNK);
  ctx.fillStyle = '#0d0f18';
  ctx.fillRect(0, 0, W, H);
  for (let cy = y0; cy <= y1; cy++)
    for (let cx = x0; cx <= x1; cx++)
      ctx.drawImage(getChunk(cx, cy), cx * CHUNK - cam.x, cy * CHUNK - cam.y);

  drawParallax(); // 视差远景雾层

  if (state === 'menu') {
    // 菜单: 游荡的魔物 + 亮相的主角 + 浮尘
    updateDemo(dt);
    drawDemo();
    drawPlayer();
    drawPlayerLight();
    drawMotes(dt);
    ctx.drawImage(vignette, 0, 0);
    return;
  }

  drawMotes(dt);
  drawDecals();
  drawPlayerLight();
  drawShrines();
  drawAura();
  drawGems();
  drawCoins();
  drawChests();
  drawPotions();
  drawRelics();

  // 敌人按 y 排序(深度感); 主角最后绘制并带定位光环, 保证在怪群中清晰可见
  const list = enemies.slice().sort((a, b) => a.y - b.y);
  for (const e of list) drawEnemy(e);
  drawPlayerRing();
  drawPlayer();

  drawOrbitBlades();
  drawBullets();
  drawEBullets();
  drawBolts();
  drawArcs();
  drawVortexes();
  drawSpikes();
  drawEchoes();
  drawSlashes();
  drawStrikes();
  drawMeteors();
  drawSouls();
  drawRings();
  drawParticles();
  drawDmgNums();
  drawForeground(); // 前景摆草(实体之上, UI 之下)
  drawBossIndicator();
  drawOffscreenIndicators();
  drawHurtDir();

  // 昼夜流光: 全程氛围弧线(晨→昼→昏→夜), 轻染不遮敌
  {
    const tint = dayTint(game.time);
    if (tint && state === 'playing') {
      ctx.fillStyle = `rgba(${tint.r},${tint.g},${tint.b},${tint.a})`;
      ctx.fillRect(0, 0, W, H);
    }
  }
  // 血月: 血红氛围笼罩全场
  if (game.bloodMoonT > 0 && state === 'playing') {
    const a = 0.18 + 0.08 * Math.sin(game.time * 3);
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.24, W / 2, H / 2, H * 0.8);
    g.addColorStop(0, 'rgba(170,10,30,0)');
    g.addColorStop(1, `rgba(170,10,30,${Math.max(0, a)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  // 时之沙漏: 青蓝时滞氛围(边缘青晕 + 缓慢脉动)
  if (game.slipT > 0 && state === 'playing') {
    const fade = Math.min(1, game.slipT / 1.2); // 消退前渐隐
    const a = (0.16 + 0.06 * Math.sin(game.time * 2.4)) * fade;
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.85);
    g.addColorStop(0, 'rgba(80,200,255,0)');
    g.addColorStop(1, `rgba(80,200,255,${Math.max(0, a)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  // Boss 降临预警: 边缘红光脉动
  if (game.bossWarn > 0 && state === 'playing') {
    const a = 0.2 + 0.16 * Math.sin(game.time * 9);
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.34, W / 2, H / 2, H * 0.8);
    g.addColorStop(0, 'rgba(255,40,60,0)');
    g.addColorStop(1, `rgba(255,40,60,${Math.max(0, a)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  // 低血量警示
  if (player.hp / player.stats.maxHp < 0.3 && state === 'playing') {
    const a = 0.14 + Math.sin(game.time * 6) * 0.08;
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.75);
    g.addColorStop(0, 'rgba(255,30,50,0)');
    g.addColorStop(1, `rgba(255,30,50,${Math.max(0, a)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  // 死亡慢镜头: 暗角收拢 + 「殁」字书就
  if (game.dying > 0) {
    const p = 1 - game.dying / 1.7;
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.16 * (1 - p * 0.55), W / 2, H / 2, H * 0.85);
    g.addColorStop(0, 'rgba(6,4,10,0)');
    g.addColorStop(1, `rgba(6,4,10,${Math.min(0.92, 0.45 + 0.5 * p)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    const fa = Math.min(1, p * 1.9);
    if (fa > 0.02) {
      ctx.save();
      ctx.globalAlpha = fa;
      ctx.font = '900 148px "Noto Serif SC", "STKaiti", serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(255,70,90,0.85)'; ctx.shadowBlur = 36;
      ctx.fillStyle = '#ffd9de';
      ctx.fillText('殁', W / 2, H / 2 - 10);
      ctx.restore();
    }
  }
  // 受击红闪
  if (game.hurtFlash > 0) {
    ctx.fillStyle = `rgba(255,40,60,${game.hurtFlash * 0.28})`;
    ctx.fillRect(0, 0, W, H);
  }
  // Boss 狂暴血红闪屏(渐隐 + 边缘加深)
  if (game.rageFlash > 0) {
    const a = game.rageFlash * 0.35;
    ctx.fillStyle = `rgba(200,30,40,${a})`;
    ctx.fillRect(0, 0, W, H);
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.85);
    g.addColorStop(0, 'rgba(150,10,20,0)');
    g.addColorStop(1, `rgba(150,10,20,${a * 1.6})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  // 冰缓状态: 屏幕边缘霜蓝渐染(渐入渐出)
  if (player.chillT > 0 && state === 'playing') {
    const ca = Math.min(1, player.chillT / 0.5) * 0.5;
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.34, W / 2, H / 2, H * 0.78);
    g.addColorStop(0, 'rgba(140,200,255,0)');
    g.addColorStop(1, `rgba(140,200,255,${ca * 0.3})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  // Boss 陨落白闪
  if (game.whiteFlash > 0) {
    ctx.fillStyle = `rgba(255,250,235,${Math.min(0.85, game.whiteFlash)})`;
    ctx.fillRect(0, 0, W, H);
  }
  // 雷暴天灾: 深蓝暗调 + 随机远雷微闪
  if (game.stormT > 0 && state === 'playing') {
    ctx.fillStyle = 'rgba(20,26,54,0.14)';
    ctx.fillRect(0, 0, W, H);
    if (Math.random() < 0.012) game.stormFlash = Math.max(game.stormFlash, 0.07); // 远雷
  }
  if (game.stormFlash > 0) { // 雷光白闪
    ctx.fillStyle = `rgba(215,230,255,${game.stormFlash * 2.2})`;
    ctx.fillRect(0, 0, W, H);
  }
  // 流星雨天象: 暖橙暗调 + 天际远景流星划痕
  if (game.meteorT > 0 && state === 'playing') {
    ctx.fillStyle = 'rgba(66,28,10,0.13)';
    ctx.fillRect(0, 0, W, H);
    if (Math.random() < 0.02) { // 远景流星: 一帧即逝的天际划痕
      const fx = rand(W * 0.15, W * 0.95), fy = rand(20, H * 0.3);
      ctx.strokeStyle = 'rgba(255,210,150,0.35)';
      ctx.lineWidth = 1.4; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(fx - 46, fy + 34); ctx.stroke();
    }
  }
  if (game.meteorFlash > 0) { // 陨落橙闪
    ctx.fillStyle = `rgba(255,190,120,${game.meteorFlash * 2.0})`;
    ctx.fillRect(0, 0, W, H);
  }
  // Boss 陨落慢镜头: 暗角聚焦 + 时间凝滞感
  if (game.slowmo > 0 && state === 'playing') {
    const a = Math.min(0.5, game.slowmo * 0.4);
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.85);
    g.addColorStop(0, 'rgba(10,6,20,0)');
    g.addColorStop(1, `rgba(10,6,20,${a})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  // Boss 登场演出: 黑边收拢 + 名字横幅
  if (game.bossIntro > 0 && state === 'playing') {
    const T = 2.6, t = game.bossIntro;
    const inP = Math.min(1, (T - t) / 0.5);          // 进入(0~0.5s)
    const outP = Math.min(1, t / 0.5);                // 退出(最后0.5s)
    const bar = 74 * Math.min(inP, outP);             // 黑边高度
    ctx.fillStyle = 'rgba(5,6,12,0.88)';
    ctx.fillRect(0, 0, W, bar);
    ctx.fillRect(0, H - bar, W, bar);
    if (inP >= 1 && outP >= 1) { // 名字横幅(避入出场)
      const mid = 1 - Math.abs(t - T / 2) / (T / 2); // 中段最亮
      const a = Math.min(1, mid * 2.4);
      ctx.textAlign = 'center';
      ctx.font = `900 ${game.introFinal ? 44 : 34}px "Noto Serif SC", serif`;
      const nameY = H / 2 - 14;
      // 装饰线
      ctx.strokeStyle = `rgba(255,80,80,${a * 0.7})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(W / 2 - 190, nameY + 14); ctx.lineTo(W / 2 - 54, nameY + 14);
      ctx.moveTo(W / 2 + 54, nameY + 14); ctx.lineTo(W / 2 + 190, nameY + 14);
      ctx.stroke();
      // Boss 名(描边 + 辉光)
      ctx.shadowColor = game.introFinal ? 'rgba(180,60,255,0.9)' : 'rgba(255,60,70,0.85)';
      ctx.shadowBlur = 22;
      ctx.strokeStyle = `rgba(0,0,0,${a * 0.85})`;
      ctx.lineWidth = 5;
      ctx.strokeText(game.introName, W / 2, nameY);
      ctx.fillStyle = game.introFinal ? `rgba(235,200,255,${a})` : `rgba(255,220,210,${a})`;
      ctx.fillText(game.introName, W / 2, nameY);
      ctx.shadowBlur = 0;
      ctx.font = 'bold 13px "Consolas", monospace';
      ctx.fillStyle = `rgba(255,120,110,${a * 0.85})`;
      ctx.fillText(game.introFinal ? '— THE ABYSS LORD —' : '— BOSS —', W / 2, nameY + 38);
    }
  }
  ctx.drawImage(vignette, 0, 0);

  // 虚拟摇杆
  if (joy.active) {
    const r = canvas.getBoundingClientRect();
    const bx = (joy.bx - r.left) * (W / r.width), by = (joy.by - r.top) * (H / r.height);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(bx, by, 52, 0, TAU); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.beginPath(); ctx.arc(bx + joy.dx * 44, by + joy.dy * 44, 20, 0, TAU); ctx.fill();
  }
}

/* ---------------- 流程控制 ---------------- */
function startGame() {
  bakeAllSprites(); // 预烘焙敌人精灵帧(幂等, 仅首次有开销)
  player = makePlayer();
  recomputeStats();
  enemies = []; bullets = []; ebullets = []; gems = []; potions = []; particles = []; dmgNums = []; bolts = []; arcs = []; vortexes = []; echoes = []; spikes = [];
  rings = []; decals = []; coins = []; chests = []; shrines = []; relics = []; slashes = []; strikes = []; meteors = []; emberZones = []; souls = [];
  Object.assign(game, { time: 0, kills: 0, pendingLv: 0, combo: 0, comboT: 0, shake: 0, hurtFlash: 0, spawnT: 2.2, bossIdx: 0, ringIdx: 0, eliteIdx: 0, hitStop: 0, whiteFlash: 0, heartT: 0, goldRun: 0, goldBanked: false, bossWarn: 0, bossWarned: false, hurtDir: 0, hurtDirT: 0, dmgStats: {},
    goblinT: 62, shrineT: 40, bloodMoonIdx: 0, bloodMoonT: 0, frenzyT: 0, feverOn: false, feverTier: 0, slipT: 0,
    perfectT: 0, perfectCd: 0, perfects: 0, overloads: 0,
    executes: 0, chains: 0, novas: 0, shatters: 0, chainDepth: 0,
    ultCharge: 0, ultWindup: 0, ults: 0, superconducts: 0, vaporizes: 0, dying: 0,
    fractures: 0, rageFlash: 0,
    stormIdx: 0, stormT: 0, stormSpawnT: 0, stormFlash: 0, stormKills: 0,
    meteorIdx: 0, meteorT: 0, meteorSpawnT: 0, meteorFlash: 0, meteorKills: 0, slowmo: 0,
    bossIntro: 0, introName: '', introFinal: false });
  player.inv = 3; // 开局 3 秒无敌缓冲, 熟悉操作
  cam.x = player.x - W / 2;
  cam.y = player.y - H / 2;
  cam.lookX = 0; cam.lookY = 0;
  lastHUD = {};
  state = 'playing';
  el.menu.classList.add('hidden');
  el.gameover.classList.add('hidden');
  el.victory.classList.add('hidden');
  el.pause.classList.add('hidden');
  el.levelup.classList.add('hidden');
  el.hud.classList.remove('hidden');
  renderWeaponBar();
  updateHUD();
  announce('准 备 …');
  // 3 秒后 GO 公告
  setTimeout(() => { if (state === 'playing') announce('G O !'); }, 2600);
}
function gameOver() {
  state = 'gameover';
  SFX.dead();
  game.shake = 20;
  burst(player.x, player.y, 40, '#ff5b6e', 320);
  bankGold();
  el['go-stats'].innerHTML = statHTML();
  el.gameover.classList.remove('hidden');
  rollGold();
}
function victory() {
  state = 'victory';
  game.dying = 0; // 死亡演出中断(同帧斩杀深渊君主的极限反杀)
  SFX.win();
  game.shake = 24;
  burst(player.x, player.y, 60, '#ffd76a', 420);
  bankGold();
  el['vic-stats'].innerHTML = statHTML();
  el.victory.classList.remove('hidden');
  rollGold();
}
function statHTML() {
  const totalDmg = Object.values(game.dmgStats).reduce((a, b) => a + b, 0);
  return `
    <div class="stat"><div class="v">${fmtTime(game.time)}</div><div class="k">生存时间</div></div>
    <div class="stat"><div class="v">${player.level}</div><div class="k">最终等级</div></div>
    <div class="stat"><div class="v">${game.kills}</div><div class="k">击杀数</div></div>
    <div class="stat"><div class="v">${game.executes}</div><div class="k">处决斩杀</div></div>
    <div class="stat"><div class="v">${game.chains + game.novas + game.shatters + game.overloads + game.superconducts + game.vaporizes}</div><div class="k">元素连锁</div></div>
    <div class="stat"><div class="v">${game.ults}</div><div class="k">深渊爆发</div></div>
    <div class="stat"><div class="v">${Math.round(totalDmg).toLocaleString()}</div><div class="k">总伤害输出</div></div>
    <div class="stat gold"><div class="v" id="gold-roll"><span class="coin-dot"></span>+${game.goldRun}</div><div class="k">金币已存入圣所</div></div>
    ${dmgBreakdownHTML(totalDmg)}`;
}
/* 伤害输出统计: 按武器占比排序的水平条形图 */
const OVERLOAD_DEF = { name: '元素超载', color: '#d29bff', icon: 'thunder' }; // 反应伤害(灼烧×感电)
const SUPERCONDUCT_DEF = { name: '元素超导', color: '#9fe8ff', icon: 'frost' }; // 反应伤害(冰缓×感电)
const VAPORIZE_DEF = { name: '元素蒸爆', color: '#e8f4ff', icon: 'aura' }; // 反应伤害(灼烧×冰缓)
const ULT_DEF = { name: '深渊爆发', color: '#e3c8ff', icon: 'vortex' }; // 主动技伤害
function dmgBreakdownHTML(total) {
  if (!total || total < 1) return '';
  const rows = Object.entries(game.dmgStats)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([id, v]) => {
      const d = WEAPON_DEFS[id] || ({ overload: OVERLOAD_DEF, superconduct: SUPERCONDUCT_DEF, vaporize: VAPORIZE_DEF, ult: ULT_DEF })[id] || null;
      if (!d) return '';
      const pct = Math.max(1, Math.round(100 * v / total));
      const evoed = player.weapons[id] && player.weapons[id].evoed;
      const name = evoed ? WEAPON_EVOS[id].name : d.name;
      const color = evoed ? WEAPON_EVOS[id].color : d.color;
      return `<div class="dmg-row">
        <span class="dr-ic" style="--c:${color}">${ICONS[d.icon]}</span>
        <span class="dr-name">${name}</span>
        <span class="dr-bar"><i style="width:${pct}%;background:${color};color:${color}"></i></span>
        <b class="dr-val">${Math.round(v).toLocaleString()}</b>
        <span class="dr-pct">${pct}%</span>
      </div>`;
    }).join('');
  if (!rows) return '';
  return `<div class="dmg-panel"><div class="dmg-title">伤 害 输 出 统 计</div>${rows}</div>`;
}
/* 结算金币滚动动画: 数字从 0 滚到本局收益 */
function rollGold() {
  const elv = document.getElementById('gold-roll');
  if (!elv || game.goldRun <= 0) return;
  const target = game.goldRun, dur = 750, t0 = Date.now();
  const tick = () => {
    const p = Math.min(1, (Date.now() - t0) / dur);
    const e = 1 - Math.pow(1 - p, 3); // ease-out cubic
    elv.innerHTML = '<span class="coin-dot"></span>+' + Math.round(target * e);
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
/* 返回主菜单(圣所) */
function backToMenu() {
  bankGold();
  state = 'menu';
  el.gameover.classList.add('hidden');
  el.victory.classList.add('hidden');
  el.pause.classList.add('hidden');
  el.levelup.classList.add('hidden');
  el.hud.classList.add('hidden');
  el.menu.classList.remove('hidden');
  initMenuScene();
  renderShop();
}
function togglePause() {
  if (state === 'playing') {
    state = 'paused';
    renderBuildView();
    el.pause.classList.remove('hidden');
  }
  else if (state === 'paused') { state = 'playing'; el.pause.classList.add('hidden'); }
}
/* 暂停界面: 当前 Build 一览 */
function renderBuildView() {
  const P = player;
  const slot = (d, lv, evoed, ev) => {
    const name = evoed ? ev.name : d.name;
    const color = evoed ? ev.color : d.color;
    const tag = evoed ? '<span style="color:#ffd76a">已 进 化</span>' : `Lv ${Math.min(lv, d.max)}/${d.max}`;
    return `<div class="bslot" style="--c:${color}">${ICONS[d.icon]}<div class="bi"><b>${name}</b><span>${tag}</span></div></div>`;
  };
  let h = '<div class="build-sec">武 器</div><div class="build-grid">';
  h += Object.keys(P.weapons).map(id => {
    const w = P.weapons[id];
    return slot(WEAPON_DEFS[id], w.lv, w.evoed, WEAPON_EVOS[id]);
  }).join('');
  h += '</div><div class="build-sec">被 动</div><div class="build-grid">';
  const pIds = Object.keys(P.passives);
  h += pIds.length ? pIds.map(id => slot(PASSIVE_DEFS[id], P.passives[id], false, null)).join('') : '<div class="build-none">尚 未 获 得</div>';
  h += '</div>';
  // 核心属性面板: 实时数值一览
  const s = P.stats;
  const rows = [
    ['伤害倍率', Math.round(s.might * 100) + '%'],
    ['冷却缩减', Math.round((1 - s.cdr) * 100) + '%'],
    ['移动速度', Math.round(s.speed)],
    ['技能范围', Math.round(s.area * 100) + '%'],
    ['拾取范围', Math.round(s.magnet)],
    ['生命上限', s.maxHp],
  ];
  if (s.regen > 0) rows.push(['每秒回复', s.regen.toFixed(1)]);
  h += '<div class="build-sec">属 性</div><div class="stat-rows">'
    + rows.map(([k, v]) => `<div class="srow"><span>${k}</span><b>${v}</b></div>`).join('')
    + '</div>';
  el['build-view'].innerHTML = h;
}

/* ---------------- 主菜单动态场景 ---------------- */
let demo = [];
function initMenuScene() {
  player = makePlayer(); recomputeStats();
  cam.x = -W / 2; cam.y = -H / 2;
  demo = [];
  const types = ['slime', 'bat', 'charger', 'skel', 'wraith', 'demon', 'bomber', 'goblin', 'shade'];
  for (let i = 0; i < 10; i++) {
    const t = types[i % types.length];
    demo.push({
      type: t, x: rand(-560, 560), y: rand(-300, 300),
      r: ENEMY_DEFS[t].r * (i === 0 ? 1.42 : 1), elite: i === 0,
      ph: rand(0, 1), phSpd: PH_SPD[t], tx: rand(-560, 560), ty: rand(-300, 300), retarget: rand(1, 4),
    });
  }
}
function updateDemo(dt) {
  for (const d of demo) {
    d.ph = (d.ph + dt * d.phSpd) % 1;
    d.retarget -= dt;
    if (d.retarget <= 0) { d.retarget = rand(2, 5); d.tx = rand(-560, 560); d.ty = rand(-300, 300); }
    const dx = d.tx - d.x, dy = d.ty - d.y, len = Math.hypot(dx, dy) || 1;
    if (len > 6) { d.x += dx / len * 34 * dt; d.y += dy / len * 34 * dt; }
  }
}
function drawDemo() {
  const list = demo.slice().sort((a, b) => a.y - b.y);
  for (const d of list) {
    const q = Math.min(SPRITE_FRAMES - 1, (d.ph * SPRITE_FRAMES) | 0);
    const f = getSprite(d.type, d.elite, q);
    const sc = d.r / ENEMY_DEFS[d.type].r;
    const x = d.x - cam.x, y = d.y - cam.y;
    if (x > -70 && x < W + 70 && y > -70 && y < H + 70)
      ctx.drawImage(f.cv, x - f.ax * sc, y - f.ay * sc, f.cv.width * sc, f.cv.height * sc);
  }
}
function toggleMute() {
  muted = !muted;
  el['mute-btn'].classList.toggle('muted', muted);
}

/* ---------------- 事件绑定 ---------------- */
el['start-btn'].addEventListener('click', () => { initAudio(); startGame(); });
el['restart-btn'].addEventListener('click', startGame);
el['vic-restart'].addEventListener('click', startGame);
el['restart-btn-p'].addEventListener('click', startGame);
el['go-menu-btn'].addEventListener('click', backToMenu);
el['vic-menu-btn'].addEventListener('click', backToMenu);
el['resume-btn'].addEventListener('click', togglePause);
el['mute-btn'].addEventListener('click', toggleMute);
/* 移动端冲刺按钮 */
el['dash-btn'].addEventListener('pointerdown', e => {
  e.preventDefault(); initAudio();
  tryDash();
}, { passive: false });
/* 移动端深渊爆发按钮 */
el['ult-btn'].addEventListener('pointerdown', e => {
  e.preventDefault(); initAudio();
  tryUlt();
}, { passive: false });
el['pause-btn'].addEventListener('click', () => { if (state === 'playing' || state === 'paused') togglePause(); });
el.cards.addEventListener('click', e => {
  const card = e.target.closest('.card');
  if (card) chooseByIndex(+card.dataset.i);
});
/* 圣所商店购买(事件委托) */
el['shop-view'].addEventListener('click', e => {
  const btn = e.target.closest('[data-meta]');
  if (btn && !btn.disabled) buyMeta(btn.dataset.meta);
});

/* ---------------- 主循环 ---------------- */
let lastT = 0, fpsNow = 60;
let frameErrLogged = false; // 仅记录首个异常, 防刷屏; 单帧异常不终止循环(防整局卡死)
function frame(t) {
  const dt = Math.min(0.05, (t - lastT) / 1000 || 0.016);
  lastT = t;
  fpsNow = fpsNow * 0.95 + (1 / Math.max(1e-4, dt)) * 0.05;
  try {
    if (state === 'playing') update(dt);
    render(dt);
  } catch (err) {
    if (!frameErrLogged) { frameErrLogged = true; console.error('[主循环异常已拦截]', err); }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/* 全局错误可视化: 未捕获异常在画面顶部红条显示原因(便于反馈定位, 而非无信息卡死) */
window.addEventListener('error', ev => {
  try {
    let bar = document.getElementById('err-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'err-bar';
      const host = document.getElementById('stage') || document.body;
      host.appendChild(bar);
    }
    bar.textContent = '运行异常(已自动恢复): ' + String(ev.message || '未知错误').slice(0, 140);
  } catch (_) { /* 错误上报自身不抛错 */ }
});

/* 初始化主菜单动态场景与圣所商店 */
initMenuScene();
renderShop();

/* 调试接口(供自动化验收读取运行时状态) */
window.__game = () => ({
  state, time: +game.time.toFixed(1), enemies: enemies.length,
  sprites: _sprCache.size, kills: game.kills, fps: +fpsNow.toFixed(1),
  combo: game.combo, hitStop: +game.hitStop.toFixed(3), whiteFlash: +game.whiteFlash.toFixed(3),
  rings: rings.length, demo: demo.length, gems: gems.length, coins: coins.length,
  decals: decals.length, eliteIdx: game.eliteIdx, ebullets: ebullets.length,
  hp: Math.round(player.hp), maxHp: player.stats.maxHp, level: player.level, xp: player.xp,
  evos: Object.keys(player.weapons).filter(id => player.weapons[id].evoed),
  goldRun: game.goldRun, goldBanked: game.goldBanked,
  bossWarn: +game.bossWarn.toFixed(2), bossWarned: game.bossWarned,
  hurtDir: +game.hurtDir.toFixed(3), hurtDirT: +game.hurtDirT.toFixed(3),
  dashCd: +player.dashCd.toFixed(2), dashT: +player.dashT.toFixed(2),
  chests: chests.length, potions: potions.length,
  shrines: shrines.length, goblinT: +game.goblinT.toFixed(1), shrineT: +game.shrineT.toFixed(1),
  bloodMoonT: +game.bloodMoonT.toFixed(1), bloodMoonIdx: game.bloodMoonIdx,
  frenzyT: +game.frenzyT.toFixed(1), fever: !!game.feverOn,
  feverTier: game.feverTier, slipT: +game.slipT.toFixed(2), relics: relics.length,
  hexers: enemies.filter(e => e.type === 'hexer' && !e.dead).length,
  goblins: enemies.filter(e => e.type === 'goblin' && !e.dead).length,
  bombers: enemies.filter(e => e.type === 'bomber' && !e.dead).length,
  shades: enemies.filter(e => e.type === 'shade' && !e.dead).length,
  perfectT: +game.perfectT.toFixed(2), perfectCd: +game.perfectCd.toFixed(2),
  perfects: game.perfects, overloads: game.overloads, slashes: slashes.length,
  executes: game.executes, chains: game.chains, novas: game.novas, shatters: game.shatters,
  chainDepth: game.chainDepth, arcs: arcs.length, shardBullets: bullets.filter(b => b.kind === 'shard').length,
  vortexes: vortexes.map(v => ({ x: +v.x.toFixed(0), y: +v.y.toFixed(0), r: +v.r.toFixed(0), life: +v.life.toFixed(2) })),
  fireflies: (game.fireflies || []).length, chunks: chunkCache.size, fogReady: !!(fogFar && fogNear),
  stormT: +game.stormT.toFixed(2), stormIdx: game.stormIdx, stormKills: game.stormKills,
  meteorT: +game.meteorT.toFixed(2), meteorIdx: game.meteorIdx, meteorKills: game.meteorKills,
  meteors: meteors.map(m => ({ x: +m.x.toFixed(0), y: +m.y.toFixed(0), phase: m.phase, fallT: +m.fallT.toFixed(2) })),
  emberZones: emberZones.length, souls: souls.length, slowmo: +game.slowmo.toFixed(2),
  strikes: strikes.length, bossIntro: +game.bossIntro.toFixed(2), introName: game.introName,
  chillT: +player.chillT.toFixed(2), affixKeys: Object.keys(ELITE_AFFIXES).join(','),
  meta: { gold: meta.gold, up: { ...meta.up } },
  player, enemiesRef: enemies, coinsRef: coins, gemsRef: gems, ebulletsRef: ebullets, dmgNumsRef: dmgNums, particlesRef: particles, bulletsRef: bullets,
  metaRef: meta, gameRef: game, shrinesRef: shrines,
  meteorsRef: meteors, emberZonesRef: emberZones, soulsRef: souls, ringsRef: rings, decalsRef: decals, strikesRef: strikes, vortexesRef: vortexes, spikesRef: spikes,
  echoes: echoes.length, echoesRef: echoes, spores: enemies.filter(e => e.type === 'spore' && !e.dead).length,
  ultCharge: +game.ultCharge.toFixed(1), ultMax: Math.round(ultMaxCharge()),
  ultWindup: +game.ultWindup.toFixed(2), ults: game.ults, superconducts: game.superconducts,
  vaporizes: game.vaporizes, react: player.stats.react, fractures: game.fractures,
  arrowBullets: bullets.filter(b => b.kind === 'arrow').length, rageFlash: +game.rageFlash.toFixed(2),
  spikes: spikes.map(s => ({ x: +s.x.toFixed(0), y: +s.y.toFixed(0), r: +s.r.toFixed(0), t: +s.t.toFixed(2), hit: s.hit })),
  dying: +game.dying.toFixed(2), ultFlow: player.stats.ultFlow, ultInv: +player.inv.toFixed(2),
  dayPhase: game.time < 90 ? 'dawn' : game.time < 240 ? 'day' : game.time < 330 ? 'dusk' : game.time < 420 ? 'night' : 'deep',
  dayTint: dayTint(game.time), firefliesN: (game.fireflies || []).length,
});
