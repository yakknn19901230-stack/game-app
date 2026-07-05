"use strict";

/* =========================================================
 * スーパーフェイスラン
 * 自分の顔写真がキャラクターになるマリオ風アクションゲーム
 * ========================================================= */

// ---------- 基本設定 ----------
const TILE = 48;                 // タイル1マスのピクセル数
const GRAVITY = 0.6;
const MOVE_ACCEL = 0.55;
const MAX_SPEED = 4.8;
const FRICTION = 0.82;
const JUMP_POWER = -13.5;
const STOMP_BOUNCE = -8;
const TIME_LIMIT = 300;          // 制限時間(秒)
const START_LIVES = 3;

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

// ---------- レベルマップ ----------
// # : 地面(草)   = : 地面(土)   B : レンガ   ? : ハテナブロック(コイン)
// M : ハテナブロック(キノコ入り。見た目は?と同じ)
// P : 土管       o : コイン     g : 敵       F : ゴールの旗
// (空白は何もなし)
const MAP_SOURCE = [
"                                                                                                                                                                        ",
"                                                                                                                                                                        ",
"                                                                                                                                                                        ",
"                                                        o o o                                                                       ooo                                 ",
"                                                       BB?BB                                                    B?B?B                                                   ",
"                                                                                                                                 BBBB                                   ",
"                  ?                                                        oo             oo                                                            o               ",
"                                              o o                        BBBB    M      BBBB                            o o                            BBB           F  ",
"          o                                 B?BB?B                                                                    BBBBB          g                              BBB ",
"       BBMBB            PP        g              g        PP        g   g        PP            g   g      PP    o                PP       PP     g  g          o        ",
"                 g      PP      PP PP                     PP                     PP                       PP   BBB      g        PP  o    PP                            ",
"####################  ######  ###########################################  ############################################  ##############################################",
"####################  ######  ###########################################  ############################################  ##############################################",
"####################  ######  ###########################################  ############################################  ##############################################",
];

// 行の長さをそろえてタイル配列に変換する
const MAP_COLS = Math.max(...MAP_SOURCE.map(r => r.length));
const MAP_ROWS = MAP_SOURCE.length;
let tiles = [];

const WORLD_W = MAP_COLS * TILE;
const WORLD_H = MAP_ROWS * TILE;

const SOLID = new Set(["#", "=", "B", "?", "M", "U", "P"]);

// ---------- ゲーム状態 ----------
const STATE = { TITLE: 0, PLAYING: 1, DYING: 2, GAMEOVER: 3, CLEAR: 4 };
let gameState = STATE.TITLE;

let player, enemies, coins, particles, popups, items;
let flagCols = new Set(); // ゴールの旗がある列
let camera = { x: 0, y: 0 };
let score = 0, coinCount = 0, lives = START_LIVES, timeLeft = TIME_LIMIT;
let frameCount = 0;
let clearTimer = 0;

// ---------- 顔画像 ----------
let faceImage = null;   // アップロードされた顔 (Image)
const FACE_STORAGE_KEY = "super-face-run/face";

function loadSavedFace() {
  try {
    const data = localStorage.getItem(FACE_STORAGE_KEY);
    if (!data) return;
    const img = new Image();
    img.onload = () => { faceImage = img; drawFacePreview(); };
    img.src = data;
  } catch (e) { /* localStorageが使えない環境では無視 */ }
}

function setFaceFromFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      // 中央を正方形に切り抜き、256pxに縮小して保存する
      const size = 256;
      const c = document.createElement("canvas");
      c.width = c.height = size;
      const cctx = c.getContext("2d");
      const min = Math.min(img.width, img.height);
      const sx = (img.width - min) / 2;
      const sy = (img.height - min) / 2;
      cctx.drawImage(img, sx, sy, min, min, 0, 0, size, size);
      const dataUrl = c.toDataURL("image/jpeg", 0.85);

      const finalImg = new Image();
      finalImg.onload = () => {
        faceImage = finalImg;
        drawFacePreview();
        try { localStorage.setItem(FACE_STORAGE_KEY, dataUrl); } catch (e) {}
      };
      finalImg.src = dataUrl;
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

function resetFace() {
  faceImage = null;
  try { localStorage.removeItem(FACE_STORAGE_KEY); } catch (e) {}
  drawFacePreview();
}

// 顔を丸く切り抜いて描く(画像がなければデフォルトのスマイル)
function drawFaceCircle(c, cx, cy, r) {
  c.save();
  c.beginPath();
  c.arc(cx, cy, r, 0, Math.PI * 2);
  c.clip();
  if (faceImage) {
    c.drawImage(faceImage, cx - r, cy - r, r * 2, r * 2);
  } else {
    // デフォルトの顔
    c.fillStyle = "#ffdbac";
    c.fillRect(cx - r, cy - r, r * 2, r * 2);
    c.fillStyle = "#333";
    c.beginPath();
    c.arc(cx - r * 0.35, cy - r * 0.15, r * 0.13, 0, Math.PI * 2);
    c.arc(cx + r * 0.35, cy - r * 0.15, r * 0.13, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = "#333";
    c.lineWidth = Math.max(2, r * 0.1);
    c.beginPath();
    c.arc(cx, cy + r * 0.15, r * 0.45, 0.15 * Math.PI, 0.85 * Math.PI);
    c.stroke();
  }
  c.restore();
  c.strokeStyle = "rgba(0,0,0,0.35)";
  c.lineWidth = 2;
  c.beginPath();
  c.arc(cx, cy, r, 0, Math.PI * 2);
  c.stroke();
}

function drawFacePreview() {
  const pc = document.getElementById("face-preview-canvas");
  const c = pc.getContext("2d");
  c.clearRect(0, 0, pc.width, pc.height);
  drawFaceCircle(c, pc.width / 2, pc.height / 2, pc.width / 2 - 2);
}

// ---------- サウンド (WebAudio) ----------
let audioCtx = null;

// iOS Safariは「ユーザー操作の中」でしか音を鳴らし始められないので、
// ボタンが押されたタイミングでAudioContextを作成・再開しておく
function unlockAudio() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
  } catch (e) {}
}
function beep(freq, duration, type = "square", volume = 0.15, slide = 0) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    if (slide) osc.frequency.linearRampToValueAtTime(freq + slide, audioCtx.currentTime + duration);
    gain.gain.setValueAtTime(volume, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
  } catch (e) { /* 音が出せない環境では無視 */ }
}
const sfx = {
  jump:  () => beep(320, 0.18, "square", 0.12, 260),
  coin:  () => { beep(988, 0.08, "square", 0.12); setTimeout(() => beep(1319, 0.25, "square", 0.12), 70); },
  stomp: () => beep(180, 0.15, "triangle", 0.2, -80),
  break: () => beep(120, 0.12, "sawtooth", 0.15, -40),
  die:   () => { beep(494, 0.12); setTimeout(() => beep(392, 0.12), 120); setTimeout(() => beep(262, 0.4), 240); },
  clear: () => { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => beep(f, 0.2, "square", 0.12), i * 130)); },
  bump:  () => beep(160, 0.08, "square", 0.1),
  sprout: () => beep(220, 0.3, "sine", 0.15, 440),
  power: () => { [392, 494, 587, 784].forEach((f, i) => setTimeout(() => beep(f, 0.12, "square", 0.12), i * 80)); },
  shrink: () => { [587, 440, 294].forEach((f, i) => setTimeout(() => beep(f, 0.12, "square", 0.12), i * 80)); },
};

// ---------- BGM (WebAudioで生成する8bit風ループ曲・オリジナル) ----------
// MIDIノート番号で書いた2小節ループ(C→Am→F→Gの明るい進行)。0は休符。
const BGM_STEP = 0.125; // 16分音符1つの長さ(秒) ≒ テンポ120
const BGM_MELODY = [
  76, 0, 79, 0, 81, 0, 79, 76, 74, 0, 76, 0, 72, 0, 74, 76,
  77, 0, 81, 0, 79, 0, 77, 74, 76, 0, 74, 0, 72, 0, 0, 0,
];
const BGM_BASS = [
  48, 0, 55, 0, 48, 0, 55, 0, 45, 0, 52, 0, 45, 0, 52, 0,
  41, 0, 48, 0, 41, 0, 48, 0, 43, 0, 50, 0, 43, 0, 50, 0,
];
const bgm = { playing: false, timer: null, step: 0, nextTime: 0 };

function midiToFreq(n) { return 440 * Math.pow(2, (n - 69) / 12); }

function bgmPlayNote(midi, time, dur, type, vol) {
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.value = midiToFreq(midi);
  gain.gain.setValueAtTime(vol, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(time);
  osc.stop(time + dur + 0.02);
}

// 少し先の音符まで予約しておく方式(setIntervalのブレの影響を受けない)
function bgmTick() {
  if (!bgm.playing || !audioCtx) return;
  while (bgm.nextTime < audioCtx.currentTime + 0.2) {
    const i = bgm.step % BGM_MELODY.length;
    if (BGM_MELODY[i]) bgmPlayNote(BGM_MELODY[i], bgm.nextTime, BGM_STEP * 0.95, "square", 0.04);
    if (BGM_BASS[i]) bgmPlayNote(BGM_BASS[i], bgm.nextTime, BGM_STEP * 1.8, "triangle", 0.07);
    bgm.step++;
    bgm.nextTime += BGM_STEP;
  }
}

function startBgm() {
  try {
    unlockAudio();
    if (!audioCtx || bgm.playing) return;
    bgm.playing = true;
    bgm.step = 0;
    bgm.nextTime = audioCtx.currentTime + 0.1;
    bgm.timer = setInterval(bgmTick, 60);
  } catch (e) {}
}

function stopBgm() {
  bgm.playing = false;
  if (bgm.timer) { clearInterval(bgm.timer); bgm.timer = null; }
}

// ---------- 入力 ----------
const keys = { left: false, right: false, jump: false };
let jumpPressed = false; // 押した瞬間だけtrue

window.addEventListener("keydown", (e) => {
  if (["ArrowLeft", "ArrowRight", "ArrowUp", "Space", "KeyA", "KeyD", "KeyW"].includes(e.code)) e.preventDefault();
  if (e.code === "ArrowLeft" || e.code === "KeyA") keys.left = true;
  if (e.code === "ArrowRight" || e.code === "KeyD") keys.right = true;
  if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW") {
    if (!keys.jump) jumpPressed = true;
    keys.jump = true;
  }
});
window.addEventListener("keyup", (e) => {
  if (e.code === "ArrowLeft" || e.code === "KeyA") keys.left = false;
  if (e.code === "ArrowRight" || e.code === "KeyD") keys.right = false;
  if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW") keys.jump = false;
});

// iOS Safariのピンチズーム・ダブルタップズームを防ぐ
document.addEventListener("gesturestart", (e) => e.preventDefault());
document.addEventListener("touchmove", (e) => {
  if (e.touches.length > 1) e.preventDefault();
}, { passive: false });
let lastTouchEnd = 0;
document.addEventListener("touchend", (e) => {
  const now = Date.now();
  if (now - lastTouchEnd < 350 && e.target.tagName !== "BUTTON" && e.target.tagName !== "LABEL") {
    e.preventDefault();
  }
  lastTouchEnd = now;
}, { passive: false });

// ---------- タッチ操作(マルチタッチ対応) ----------
// ボタンごとに個別のイベントで処理すると、iOSで「移動しながらジャンプ」の
// ような同時押しを取りこぼすことがある。そこで、画面に触れている全部の指の
// 位置を毎回ボタンの位置と照合して、押されているボタンを判定する。
const touchControlsEl = document.getElementById("touch-controls");
const touchButtons = ["left", "right", "jump"].map((key) => ({
  key,
  el: document.getElementById("touch-" + key),
}));
const TOUCH_MARGIN = 24; // 指が多少ズレても反応させる余白(px)

function handleTouches(e) {
  e.preventDefault();
  unlockAudio();
  const pressed = { left: false, right: false, jump: false };
  for (const t of e.touches) {
    for (const b of touchButtons) {
      const r = b.el.getBoundingClientRect();
      if (
        t.clientX >= r.left - TOUCH_MARGIN && t.clientX <= r.right + TOUCH_MARGIN &&
        t.clientY >= r.top - TOUCH_MARGIN && t.clientY <= r.bottom + TOUCH_MARGIN
      ) {
        pressed[b.key] = true;
      }
    }
  }
  if (pressed.jump && !keys.jump) jumpPressed = true;
  for (const b of touchButtons) {
    keys[b.key] = pressed[b.key];
    b.el.classList.toggle("pressed", pressed[b.key]);
  }
}
["touchstart", "touchmove", "touchend", "touchcancel"].forEach((type) => {
  touchControlsEl.addEventListener(type, handleTouches, { passive: false });
});

// ---------- レベル初期化 ----------
function initLevel() {
  tiles = MAP_SOURCE.map(row => row.padEnd(MAP_COLS, " ").split(""));
  enemies = [];
  coins = [];
  particles = [];
  popups = [];
  items = [];

  flagCols = new Set();
  for (let ty = 0; ty < MAP_ROWS; ty++) {
    for (let tx = 0; tx < MAP_COLS; tx++) {
      const ch = tiles[ty][tx];
      if (ch === "F") {
        flagCols.add(tx);
      } else if (ch === "g") {
        tiles[ty][tx] = " ";
        enemies.push({
          x: tx * TILE + 4, y: ty * TILE + TILE - 40,
          w: 40, h: 40, vx: -1.1, vy: 0,
          alive: true, squashTimer: 0,
        });
      } else if (ch === "o") {
        tiles[ty][tx] = " ";
        coins.push({ x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2, taken: false });
      }
    }
  }

  player = {
    x: TILE * 2, y: WORLD_H - TILE * 3 - 46,
    w: 36, h: 46, vx: 0, vy: 0,
    onGround: false, facing: 1, runFrame: 0,
    deadTimer: 0,
    jumpBuffer: 0, // 先行入力: 着地直前に押したジャンプを覚えておくフレーム数
    coyote: 0,     // コヨーテタイム: 足場を離れた直後でもジャンプできるフレーム数
    big: false,    // キノコで大きくなった状態(1回だけダメージに耐えられる)
    invuln: 0,     // ダメージ後の無敵時間(フレーム)
  };
  camera.x = 0;
  camera.y = Math.max(0, WORLD_H - canvas.height);
  timeLeft = TIME_LIMIT;
}

function resetRun() {
  score = 0;
  coinCount = 0;
  lives = START_LIVES;
  initLevel();
}

// ---------- タイルユーティリティ ----------
function tileAt(tx, ty) {
  if (tx < 0 || tx >= MAP_COLS) return "#"; // 端は壁扱い
  if (ty < 0 || ty >= MAP_ROWS) return " ";
  return tiles[ty][tx];
}
function isSolidAt(tx, ty) { return SOLID.has(tileAt(tx, ty)); }

// AABBとタイルの衝突解決(軸ごと)。ヒットしたブロック情報を返す
function moveAndCollide(body) {
  const hits = { top: null };

  // X方向
  body.x += body.vx;
  let x0 = Math.floor(body.x / TILE), x1 = Math.floor((body.x + body.w - 1) / TILE);
  let y0 = Math.floor(body.y / TILE), y1 = Math.floor((body.y + body.h - 1) / TILE);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (!isSolidAt(tx, ty)) continue;
      if (body.vx > 0) body.x = tx * TILE - body.w;
      else if (body.vx < 0) body.x = (tx + 1) * TILE;
      body.hitWall = true;
      body.vx = 0;
    }
  }

  // Y方向
  body.y += body.vy;
  body.onGround = false;
  x0 = Math.floor(body.x / TILE); x1 = Math.floor((body.x + body.w - 1) / TILE);
  y0 = Math.floor(body.y / TILE); y1 = Math.floor((body.y + body.h - 1) / TILE);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (!isSolidAt(tx, ty)) continue;
      if (body.vy > 0) {
        body.y = ty * TILE - body.h;
        body.vy = 0;
        body.onGround = true;
      } else if (body.vy < 0) {
        body.y = (ty + 1) * TILE;
        body.vy = 0;
        if (!hits.top) hits.top = { tx, ty };
      }
    }
  }
  return hits;
}

// ---------- ブロックを下から叩いたとき ----------
function bumpBlock(tx, ty) {
  const ch = tileAt(tx, ty);
  if (ch === "M") {
    // キノコ入りブロック: 叩くとキノコが飛び出して歩き出す
    tiles[ty][tx] = "U";
    score += 200;
    sfx.sprout();
    items.push({
      x: tx * TILE + 4, y: ty * TILE - 40,
      w: 40, h: 40, vx: 1.5, vy: 0, taken: false,
    });
  } else if (ch === "?") {
    tiles[ty][tx] = "U";
    coinCount++;
    score += 200;
    sfx.coin();
    popups.push({ x: tx * TILE + TILE / 2, y: ty * TILE, vy: -6, life: 30, type: "coin" });
  } else if (ch === "B") {
    tiles[ty][tx] = " ";
    score += 50;
    sfx.break();
    for (let i = 0; i < 8; i++) {
      particles.push({
        x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2,
        vx: (Math.random() - 0.5) * 8, vy: -Math.random() * 8 - 2,
        life: 40, color: "#b5651d", size: 7,
      });
    }
  } else if (SOLID.has(ch)) {
    sfx.bump();
  }
}

// ---------- プレイヤーのダメージ・死亡 ----------
// 大きいときは1回だけ耐えて小さくなる。小さいときはミス。
function damagePlayer() {
  if (player.invuln > 0) return;
  if (player.big) {
    player.big = false;
    player.invuln = 120;
    sfx.shrink();
  } else {
    killPlayer();
  }
}

function killPlayer() {
  if (gameState !== STATE.PLAYING) return;
  gameState = STATE.DYING;
  player.deadTimer = 0;
  player.vy = -11;
  stopBgm();
  sfx.die();
}

function afterDeath() {
  lives--;
  if (lives <= 0) {
    gameState = STATE.GAMEOVER;
    document.getElementById("gameover-score").textContent = `スコア: ${score}　コイン: ${coinCount}`;
    document.getElementById("gameover-screen").classList.remove("hidden");
  } else {
    initLevel();
    gameState = STATE.PLAYING;
    startBgm();
  }
}

// ---------- 更新処理 ----------
function update() {
  frameCount++;

  if (gameState === STATE.DYING) {
    // 死亡演出: その場でぴょんと跳ねて落下
    player.deadTimer++;
    player.vy += GRAVITY;
    player.y += player.vy;
    if (player.deadTimer > 110) afterDeath();
    return;
  }

  if (gameState !== STATE.PLAYING) return;

  if (player.invuln > 0) player.invuln--;

  // タイマー
  if (frameCount % 60 === 0) {
    timeLeft--;
    if (timeLeft <= 0) { killPlayer(); return; }
  }

  // --- プレイヤー操作 ---
  if (keys.left)  { player.vx -= MOVE_ACCEL; player.facing = -1; }
  if (keys.right) { player.vx += MOVE_ACCEL; player.facing = 1; }
  if (!keys.left && !keys.right) player.vx *= FRICTION;
  player.vx = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, player.vx));
  if (Math.abs(player.vx) < 0.05) player.vx = 0;

  // ジャンプ: 押した瞬間に反応させるため、先行入力とコヨーテタイムを持たせる。
  // 着地の少し前に押してもすぐ跳べて、足場から落ちた直後でも跳べる。
  if (jumpPressed) {
    player.jumpBuffer = 8;
    jumpPressed = false;
  }
  if (player.onGround) player.coyote = 7;
  else if (player.coyote > 0) player.coyote--;

  if (player.jumpBuffer > 0) {
    player.jumpBuffer--;
    if (player.coyote > 0) {
      player.vy = JUMP_POWER;
      player.coyote = 0;
      player.jumpBuffer = 0;
      player.onGround = false;
      sfx.jump();
    }
  }
  // ジャンプボタンを離すと上昇が弱まる(可変ジャンプ)
  if (!keys.jump && player.vy < -4) player.vy = -4;

  player.vy += GRAVITY;
  if (player.vy > 16) player.vy = 16;

  const hits = moveAndCollide(player);
  if (hits.top) bumpBlock(hits.top.tx, hits.top.ty);

  if (Math.abs(player.vx) > 0.3 && player.onGround) player.runFrame += Math.abs(player.vx) * 0.06;

  // 穴に落ちた
  if (player.y > WORLD_H + 100) { killPlayer(); return; }

  // --- コイン取得 ---
  for (const c of coins) {
    if (c.taken) continue;
    if (Math.abs(player.x + player.w / 2 - c.x) < 34 && Math.abs(player.y + player.h / 2 - c.y) < 38) {
      c.taken = true;
      coinCount++;
      score += 100;
      sfx.coin();
      popups.push({ x: c.x, y: c.y, vy: -3, life: 25, type: "score", text: "100" });
    }
  }

  // --- 敵の更新 ---
  for (const e of enemies) {
    if (!e.alive) {
      if (e.squashTimer > 0) e.squashTimer--;
      continue;
    }
    // 画面からかなり遠い敵は動かさない
    if (Math.abs(e.x - player.x) > canvas.width * 1.2) continue;

    e.hitWall = false;
    const prevVx = e.vx; // moveAndCollideが壁でvxを0にするため、反転用に覚えておく
    e.vy += GRAVITY;
    if (e.vy > 16) e.vy = 16;
    moveAndCollide(e);
    if (e.hitWall) e.vx = -prevVx;

    // プレイヤーとの当たり判定
    if (rectsOverlap(player, e)) {
      const playerBottom = player.y + player.h;
      if (player.vy > 0 && playerBottom - e.y < 24) {
        // 踏みつけ
        e.alive = false;
        e.squashTimer = 30;
        player.vy = STOMP_BOUNCE;
        score += 300;
        sfx.stomp();
        popups.push({ x: e.x + e.w / 2, y: e.y, vy: -3, life: 25, type: "score", text: "300" });
      } else {
        damagePlayer();
        if (gameState !== STATE.PLAYING) return;
      }
    }
  }

  // --- キノコの更新と取得 ---
  for (const it of items) {
    if (it.taken) continue;
    it.hitWall = false;
    const prevVx = it.vx;
    it.vy += GRAVITY;
    if (it.vy > 16) it.vy = 16;
    moveAndCollide(it);
    if (it.hitWall) it.vx = -prevVx;
    if (it.y > WORLD_H + 100) { it.taken = true; continue; }

    if (rectsOverlap(player, it)) {
      it.taken = true;
      score += 500;
      sfx.power();
      popups.push({ x: it.x + it.w / 2, y: it.y, vy: -3, life: 35, type: "score", text: "パワーアップ!" });
      player.big = true;
    }
  }

  // --- ゴール判定(旗の列に到達したらクリア) ---
  const ptx = Math.floor((player.x + player.w / 2) / TILE);
  if (flagCols.has(ptx)) {
    gameState = STATE.CLEAR;
    score += timeLeft * 10;
    stopBgm();
    sfx.clear();
    clearTimer = 0;
    setTimeout(() => {
      document.getElementById("clear-score").textContent =
        `スコア: ${score}　コイン: ${coinCount}　残りタイム: ${timeLeft}`;
      document.getElementById("clear-screen").classList.remove("hidden");
    }, 1200);
  }

  // --- パーティクル・ポップアップ ---
  for (const p of particles) {
    p.vy += GRAVITY * 0.6;
    p.x += p.vx;
    p.y += p.vy;
    p.life--;
  }
  particles = particles.filter(p => p.life > 0);

  for (const p of popups) {
    p.y += p.vy;
    p.vy *= 0.92;
    p.life--;
  }
  popups = popups.filter(p => p.life > 0);

  // --- カメラ ---
  const targetX = player.x + player.w / 2 - canvas.width / 2;
  camera.x += (targetX - camera.x) * 0.12;
  camera.x = Math.max(0, Math.min(WORLD_W - canvas.width, camera.x));
  camera.y = Math.max(0, WORLD_H - canvas.height);
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

// ---------- 描画処理 ----------
function draw() {
  const W = canvas.width, H = canvas.height;

  // 空
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, "#63a4ff");
  sky.addColorStop(1, "#a8d8ff");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // 遠景の雲と山(パララックス)
  drawBackground();

  ctx.save();
  ctx.translate(-Math.round(camera.x), -Math.round(camera.y));

  drawTiles();
  drawCoins();
  drawItems();
  drawEnemies();
  if (gameState !== STATE.TITLE) drawPlayer();
  drawParticles();

  ctx.restore();

  drawHUD();

  if (gameState === STATE.CLEAR) {
    clearTimer++;
    ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(0.25, clearTimer / 200)})`;
    ctx.fillRect(0, 0, W, H);
  }
}

function drawBackground() {
  const W = canvas.width, H = canvas.height;
  // 山(2層のパララックス)
  const mOff = -(camera.x * 0.15) % 700;
  ctx.fillStyle = "#b5e0b5";
  for (let i = -1; i < W / 700 + 2; i++) {
    const bx = mOff + i * 700 + 260;
    ctx.beginPath();
    ctx.moveTo(bx, H);
    ctx.quadraticCurveTo(bx + 210, H - 640, bx + 420, H);
    ctx.fill();
  }
  ctx.fillStyle = "#8fd08f";
  const mOff2 = -(camera.x * 0.25) % 700;
  for (let i = -1; i < W / 700 + 2; i++) {
    const bx = mOff2 + i * 700;
    ctx.beginPath();
    ctx.moveTo(bx, H);
    ctx.quadraticCurveTo(bx + 175, H - 560, bx + 350, H);
    ctx.fill();
  }
  // 雲
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  const cOff = -(camera.x * 0.4) % 500;
  for (let i = -1; i < W / 500 + 2; i++) {
    const bx = cOff + i * 500;
    drawCloud(bx + 80, 80, 1);
    drawCloud(bx + 320, 150, 0.7);
  }
}

function drawCloud(x, y, s) {
  ctx.beginPath();
  ctx.arc(x, y, 28 * s, 0, Math.PI * 2);
  ctx.arc(x + 30 * s, y - 12 * s, 24 * s, 0, Math.PI * 2);
  ctx.arc(x + 60 * s, y, 26 * s, 0, Math.PI * 2);
  ctx.fill();
}

function drawTiles() {
  const startX = Math.max(0, Math.floor(camera.x / TILE) - 1);
  const endX = Math.min(MAP_COLS - 1, Math.ceil((camera.x + canvas.width) / TILE) + 1);

  for (let ty = 0; ty < MAP_ROWS; ty++) {
    for (let tx = startX; tx <= endX; tx++) {
      const ch = tiles[ty][tx];
      if (ch === " ") continue;
      const x = tx * TILE, y = ty * TILE;

      switch (ch) {
        case "#": {
          const isTop = tileAt(tx, ty - 1) !== "#";
          ctx.fillStyle = "#9c5a3c";
          ctx.fillRect(x, y, TILE, TILE);
          ctx.fillStyle = "rgba(0,0,0,0.12)";
          ctx.fillRect(x + 4, y + 10, 14, 10);
          ctx.fillRect(x + 26, y + 28, 14, 10);
          if (isTop) {
            ctx.fillStyle = "#3fbf4f";
            ctx.fillRect(x, y, TILE, 14);
            ctx.fillStyle = "#68d977";
            ctx.fillRect(x, y, TILE, 6);
          }
          break;
        }
        case "B": {
          ctx.fillStyle = "#c8642e";
          ctx.fillRect(x, y, TILE, TILE);
          ctx.strokeStyle = "#7d3714";
          ctx.lineWidth = 3;
          ctx.strokeRect(x + 1.5, y + 1.5, TILE - 3, TILE - 3);
          ctx.beginPath();
          ctx.moveTo(x, y + TILE / 2); ctx.lineTo(x + TILE, y + TILE / 2);
          ctx.moveTo(x + TILE / 2, y); ctx.lineTo(x + TILE / 2, y + TILE / 2);
          ctx.moveTo(x + TILE / 4, y + TILE / 2); ctx.lineTo(x + TILE / 4, y + TILE);
          ctx.moveTo(x + TILE * 3 / 4, y + TILE / 2); ctx.lineTo(x + TILE * 3 / 4, y + TILE);
          ctx.stroke();
          break;
        }
        case "?": {
          const bounce = Math.sin(frameCount * 0.1) * 2;
          ctx.fillStyle = "#f6a623";
          ctx.fillRect(x, y, TILE, TILE);
          ctx.strokeStyle = "#a86b00";
          ctx.lineWidth = 3;
          ctx.strokeRect(x + 1.5, y + 1.5, TILE - 3, TILE - 3);
          ctx.fillStyle = "#fff";
          ctx.font = "bold 28px sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("?", x + TILE / 2, y + TILE / 2 + bounce);
          break;
        }
        case "U": {
          ctx.fillStyle = "#9c7b52";
          ctx.fillRect(x, y, TILE, TILE);
          ctx.strokeStyle = "#6b5236";
          ctx.lineWidth = 3;
          ctx.strokeRect(x + 1.5, y + 1.5, TILE - 3, TILE - 3);
          break;
        }
        case "P": {
          const isTop = tileAt(tx, ty - 1) !== "P";
          const isLeft = tileAt(tx - 1, ty) !== "P";
          ctx.fillStyle = "#2ea44f";
          if (isTop) {
            // 土管の口(ふち)
            ctx.fillRect(x - (isLeft ? 4 : 0), y, TILE + 4, TILE);
            ctx.fillStyle = "rgba(255,255,255,0.25)";
            ctx.fillRect(x - (isLeft ? 4 : 0) + 4, y + 4, 10, TILE - 8);
            ctx.strokeStyle = "#1a7a35";
            ctx.lineWidth = 3;
            ctx.strokeRect(x - (isLeft ? 4 : 0) + 1.5, y + 1.5, TILE + 1, TILE - 3);
          } else {
            ctx.fillRect(x, y, TILE, TILE);
            ctx.fillStyle = "rgba(255,255,255,0.2)";
            ctx.fillRect(x + 6, y, 8, TILE);
            ctx.strokeStyle = "#1a7a35";
            ctx.lineWidth = 3;
            if (isLeft) { ctx.beginPath(); ctx.moveTo(x + 1.5, y); ctx.lineTo(x + 1.5, y + TILE); ctx.stroke(); }
            else { ctx.beginPath(); ctx.moveTo(x + TILE - 1.5, y); ctx.lineTo(x + TILE - 1.5, y + TILE); ctx.stroke(); }
          }
          break;
        }
        case "F": {
          // 旗ざお
          ctx.fillStyle = "#3fbf4f";
          ctx.fillRect(x + TILE / 2 - 3, y, 6, TILE * (MAP_ROWS - 3 - ty));
          ctx.beginPath();
          ctx.arc(x + TILE / 2, y, 10, 0, Math.PI * 2);
          ctx.fillStyle = "#ffd166";
          ctx.fill();
          // 旗
          const wave = Math.sin(frameCount * 0.08) * 4;
          ctx.fillStyle = "#e63946";
          ctx.beginPath();
          ctx.moveTo(x + TILE / 2 + 3, y + 14);
          ctx.lineTo(x + TILE / 2 + 46 + wave, y + 34);
          ctx.lineTo(x + TILE / 2 + 3, y + 54);
          ctx.closePath();
          ctx.fill();
          break;
        }
      }
    }
  }
}

function drawCoins() {
  for (const c of coins) {
    if (c.taken) continue;
    const squish = Math.abs(Math.sin(frameCount * 0.08 + c.x));
    ctx.save();
    ctx.translate(c.x, c.y + Math.sin(frameCount * 0.05 + c.x) * 3);
    ctx.scale(Math.max(0.15, squish), 1);
    ctx.fillStyle = "#ffd700";
    ctx.beginPath();
    ctx.arc(0, 0, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#b8860b";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();
  }
}

function drawItems() {
  for (const it of items) {
    if (it.taken) continue;
    const cx = it.x + it.w / 2;
    // 軸(顔の部分)
    ctx.fillStyle = "#ffe8c9";
    ctx.beginPath();
    ctx.roundRect(it.x + 7, it.y + it.h * 0.45, it.w - 14, it.h * 0.5, 6);
    ctx.fill();
    // 目
    ctx.fillStyle = "#333";
    ctx.beginPath();
    ctx.arc(cx - 6, it.y + it.h * 0.68, 2.5, 0, Math.PI * 2);
    ctx.arc(cx + 6, it.y + it.h * 0.68, 2.5, 0, Math.PI * 2);
    ctx.fill();
    // カサ
    ctx.fillStyle = "#e63946";
    ctx.beginPath();
    ctx.arc(cx, it.y + it.h * 0.5, it.w / 2, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    // カサの白い模様
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(cx, it.y + it.h * 0.16, 5, 0, Math.PI * 2);
    ctx.arc(cx - 12, it.y + it.h * 0.38, 4, 0, Math.PI * 2);
    ctx.arc(cx + 12, it.y + it.h * 0.38, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawEnemies() {
  for (const e of enemies) {
    if (!e.alive && e.squashTimer <= 0) continue;
    const squash = e.alive ? 1 : 0.3;
    const h = e.h * squash;
    const y = e.y + e.h - h;
    const wobble = e.alive ? Math.sin(frameCount * 0.2) * 2 : 0;

    // 体
    ctx.fillStyle = "#a0522d";
    ctx.beginPath();
    ctx.ellipse(e.x + e.w / 2, y + h * 0.45, e.w / 2 + wobble * 0.3, h * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
    // 足
    ctx.fillStyle = "#5c3317";
    ctx.beginPath();
    ctx.ellipse(e.x + e.w * 0.28 + wobble, y + h - 5, 9, 6, 0, 0, Math.PI * 2);
    ctx.ellipse(e.x + e.w * 0.72 - wobble, y + h - 5, 9, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    if (e.alive) {
      // 目
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.ellipse(e.x + e.w * 0.35, y + h * 0.35, 6, 8, 0, 0, Math.PI * 2);
      ctx.ellipse(e.x + e.w * 0.65, y + h * 0.35, 6, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#000";
      const look = e.vx > 0 ? 2 : -2;
      ctx.beginPath();
      ctx.arc(e.x + e.w * 0.35 + look, y + h * 0.38, 3, 0, Math.PI * 2);
      ctx.arc(e.x + e.w * 0.65 + look, y + h * 0.38, 3, 0, Math.PI * 2);
      ctx.fill();
      // 眉
      ctx.strokeStyle = "#3a2010";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(e.x + e.w * 0.25, y + h * 0.18);
      ctx.lineTo(e.x + e.w * 0.44, y + h * 0.26);
      ctx.moveTo(e.x + e.w * 0.75, y + h * 0.18);
      ctx.lineTo(e.x + e.w * 0.56, y + h * 0.26);
      ctx.stroke();
    }
  }
}

function drawPlayer() {
  const p = player;
  const cx = p.x + p.w / 2;
  const feetY = p.y + p.h;
  const dying = gameState === STATE.DYING;
  const blink = dying && Math.floor(p.deadTimer / 4) % 2 === 0;
  if (blink) return;
  // ダメージ後の無敵時間中は点滅させる
  if (p.invuln > 0 && Math.floor(frameCount / 4) % 2 === 0) return;

  // 当たり判定はそのままに、見た目だけ足元を基準に拡大して描く
  // キノコを取って大きいときはさらに大きく
  const S = p.big ? 1.8 : 1.35;

  ctx.save();
  ctx.translate(cx, feetY);
  ctx.scale(S, S);
  ctx.translate(0, -p.h);
  if (p.facing < 0) ctx.scale(-1, 1);

  const legSwing = p.onGround && Math.abs(p.vx) > 0.3 ? Math.sin(p.runFrame * 2) * 7 : 0;
  const jumping = !p.onGround;

  // 足
  ctx.strokeStyle = "#2b50a1";
  ctx.lineWidth = 8;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-6, p.h - 18);
  ctx.lineTo(-6 + (jumping ? -4 : legSwing), p.h - 4);
  ctx.moveTo(6, p.h - 18);
  ctx.lineTo(6 + (jumping ? 4 : -legSwing), p.h - 4);
  ctx.stroke();

  // 体(オーバーオール)
  ctx.fillStyle = "#3563c4";
  ctx.beginPath();
  ctx.roundRect(-11, p.h - 30, 22, 16, 5);
  ctx.fill();
  // シャツ
  ctx.fillStyle = "#e63946";
  ctx.beginPath();
  ctx.roundRect(-12, p.h - 36, 24, 10, 4);
  ctx.fill();

  // 腕
  ctx.strokeStyle = "#e63946";
  ctx.lineWidth = 6;
  ctx.beginPath();
  if (jumping) {
    ctx.moveTo(-11, p.h - 33); ctx.lineTo(-18, p.h - 42);
    ctx.moveTo(11, p.h - 33); ctx.lineTo(18, p.h - 42);
  } else {
    ctx.moveTo(-11, p.h - 33); ctx.lineTo(-15 - legSwing * 0.5, p.h - 24);
    ctx.moveTo(11, p.h - 33); ctx.lineTo(15 + legSwing * 0.5, p.h - 24);
  }
  ctx.stroke();

  ctx.restore();

  // 頭(顔) - 反転させずに描く(顔写真が裏返ると変なので)
  // 顔がゲームの主役なので大きめに。11 = 拡大前の頭中心の足元からの高さ(p.h - (15 - 4))
  const headR = 15 * S;
  const headY = feetY - (p.h - 11) * S;
  drawFaceCircle(ctx, cx, headY, headR);

  // 帽子: 顔が隠れないよう、頭のてっぺんに乗る細いキャップにする
  ctx.save();
  ctx.translate(cx, headY);
  if (p.facing < 0) ctx.scale(-1, 1);
  ctx.fillStyle = "#e63946";
  ctx.beginPath();
  ctx.arc(0, 0, headR + 2, Math.PI + 0.45, -0.45);
  ctx.closePath();
  ctx.fill();
  // つば
  ctx.beginPath();
  ctx.roundRect(headR * 0.45, -headR * 0.85, headR * 1.05, headR * 0.3, 4);
  ctx.fill();
  ctx.restore();
}

function drawParticles() {
  for (const p of particles) {
    ctx.globalAlpha = Math.min(1, p.life / 20);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;

  for (const p of popups) {
    ctx.globalAlpha = Math.min(1, p.life / 15);
    if (p.type === "coin") {
      ctx.fillStyle = "#ffd700";
      ctx.beginPath();
      ctx.arc(p.x, p.y, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#b8860b";
      ctx.lineWidth = 3;
      ctx.stroke();
    } else {
      ctx.fillStyle = "#fff";
      ctx.font = "bold 20px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(p.text, p.x, p.y);
    }
  }
  ctx.globalAlpha = 1;
}

function drawHUD() {
  if (gameState === STATE.TITLE) return;
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  ctx.roundRect(14, 12, 420, 46, 12);
  ctx.fill();

  ctx.fillStyle = "#fff";
  ctx.font = "bold 22px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";

  // 残機(顔アイコン)
  drawFaceCircle(ctx, 44, 35, 16);
  ctx.fillStyle = "#fff";
  ctx.fillText(`×${lives}`, 66, 36);

  // コイン
  ctx.fillStyle = "#ffd700";
  ctx.beginPath();
  ctx.arc(140, 35, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.fillText(`×${coinCount}`, 158, 36);

  // スコアとタイム
  ctx.fillText(`SCORE ${score}`, 230, 36);
  ctx.fillStyle = timeLeft <= 30 ? "#ff8080" : "#fff";
  ctx.fillText(`⏱ ${timeLeft}`, 380, 36);
  ctx.restore();
}

// ---------- メインループ ----------
function loop() {
  update();
  draw();
  requestAnimationFrame(loop);
}

// ---------- UIイベント ----------
const titleScreen = document.getElementById("title-screen");

document.getElementById("face-input").addEventListener("change", (e) => {
  if (e.target.files && e.target.files[0]) setFaceFromFile(e.target.files[0]);
});
document.getElementById("face-reset").addEventListener("click", resetFace);

document.getElementById("start-btn").addEventListener("click", () => {
  titleScreen.classList.add("hidden");
  resetRun();
  gameState = STATE.PLAYING;
  startBgm();
});

document.getElementById("retry-btn").addEventListener("click", () => {
  document.getElementById("gameover-screen").classList.add("hidden");
  resetRun();
  gameState = STATE.PLAYING;
  startBgm();
});
document.getElementById("to-title-btn").addEventListener("click", () => {
  document.getElementById("gameover-screen").classList.add("hidden");
  titleScreen.classList.remove("hidden");
  gameState = STATE.TITLE;
});
document.getElementById("clear-retry-btn").addEventListener("click", () => {
  document.getElementById("clear-screen").classList.add("hidden");
  resetRun();
  gameState = STATE.PLAYING;
  startBgm();
});
document.getElementById("clear-title-btn").addEventListener("click", () => {
  document.getElementById("clear-screen").classList.add("hidden");
  titleScreen.classList.remove("hidden");
  gameState = STATE.TITLE;
});

// ---------- 起動 ----------
loadSavedFace();
drawFacePreview();
initLevel();
loop();
