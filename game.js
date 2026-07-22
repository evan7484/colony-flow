"use strict";

// ============================================================
// Colony Flow — 게임 런타임 (보드/개미/슬롯/부스터/화면 전환)
// 순수 로직(레벨 빌드, 노출 판정)은 levels.js가 같은 전역 스코프에
// 선언한 PALETTE / LEVELS / buildLevel / computeExposed를 그대로 사용
// ============================================================

const ANT_SPEED = 340;          // px/s (우회 경로를 걷기 때문에 약간 빠르게)
const MAX_ANTS_PER_BLOCK = 4;   // 블록당 동시 파견 개미 수
const SPAWN_INTERVAL = 0.22;    // 같은 블록의 개미 출발 간격(s)
const BASE_SLOTS = 5;
const SAVE_KEY = "colony-flow-cleared";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);

// ---------- 색 유틸 ----------
function hexRgb(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}
function shade(hex, f) {
  // f > 0: 흰색 쪽으로, f < 0: 검은색 쪽으로 혼합
  const [r, g, b] = hexRgb(hex);
  const t = f > 0 ? 255 : 0;
  const k = Math.abs(f);
  const m = (c) => Math.round(c + (t - c) * k);
  return `rgb(${m(r)},${m(g)},${m(b)})`;
}

// ---------- 상태 ----------
const S = {
  screen: "menu",            // menu | play
  status: "playing",         // playing | won | lost
  rescue: false,
  levelIndex: 0,
  level: null,               // buildLevel 결과
  alive: [],                 // 타일 생존 여부
  aliveCount: 0,
  exposed: new Set(),
  reserved: new Set(),       // 개미가 예약한 타일
  tray: [],                  // 트레이 블록
  slots: [],                 // { el, block|null }
  ants: [],
  particles: [],
  boosters: { slot: 1, shuffle: 1, pickup: 1, vacuum: 1 },
  mode: "none",              // none | pickup | vacuum
  paused: false,
  // 레이아웃 캐시
  cell: 24, bx: 0, by: 0, nest: { x: 0, y: 0 },
};

function loadCleared() {
  const n = parseInt(localStorage.getItem(SAVE_KEY) || "0", 10);
  return Number.isFinite(n) ? clamp(n, 0, LEVELS.length) : 0;
}
function saveCleared(n) {
  localStorage.setItem(SAVE_KEY, String(n));
}

// ---------- 화면 전환 ----------
function show(id, on) { $(id).classList.toggle("hidden", !on); }

function openMenu() {
  S.screen = "menu";
  S.level = null;
  S.ants = [];
  S.particles = [];
  show("menu-overlay", true);
  show("win-overlay", false);
  show("lose-overlay", false);
  show("app", false);
  show("rescue-banner", false);
  renderMenu();
}

function renderMenu() {
  const cleared = loadCleared();
  const grid = $("level-grid");
  grid.innerHTML = "";
  LEVELS.forEach((def, i) => {
    const btn = document.createElement("button");
    btn.className = "level-btn";
    const locked = i > cleared;
    if (locked) btn.classList.add("locked");
    if (i < cleared) btn.classList.add("cleared");
    btn.innerHTML = `<span class="lv-num">${locked ? "🔒" : i + 1}</span><span class="lv-name">${
      locked ? "잠김" : def.name}</span>${i < cleared ? '<span class="lv-check">✓</span>' : ""}`;
    btn.disabled = locked;
    btn.addEventListener("click", () => startLevel(i));
    grid.appendChild(btn);
  });
  $("menu-progress").textContent =
    cleared >= LEVELS.length ? "🏆 모든 레벨 완료!" : `진행도 ${cleared} / ${LEVELS.length}`;
}

// ---------- 레벨 시작 ----------
function startLevel(i) {
  S.levelIndex = i;
  S.level = buildLevel(LEVELS[i], i);
  S.alive = S.level.artGrid.map((c) => c !== ".");
  S.aliveCount = S.alive.filter(Boolean).length;
  S.reserved = new Set();
  S.exposed = computeExposed(S.alive, S.level.gw, S.level.gh);
  S.tray = S.level.blocks.map((b) => ({ ...b, antsOut: 0, cd: 0, inSlot: false, el: null }));
  S.ants = [];
  S.particles = [];
  S.boosters = { slot: 1, shuffle: 1, pickup: 1, vacuum: 1 };
  S.mode = "none";
  S.status = "playing";
  S.rescue = false;
  S.paused = false;
  S.screen = "play";

  $("level-title").textContent = `레벨 ${i + 1} · ${S.level.name}`;
  buildSlotsDOM(BASE_SLOTS);
  buildTrayDOM();
  updateBoosterDOM();
  document.body.classList.remove("mode-pickup", "mode-vacuum");
  show("menu-overlay", false);
  show("win-overlay", false);
  show("lose-overlay", false);
  show("rescue-banner", false);
  show("pause-badge", false);
  show("app", true);
}

// ---------- DOM 구성 ----------
function buildSlotsDOM(n) {
  const wrap = $("slots");
  wrap.innerHTML = "";
  S.slots = [];
  for (let k = 0; k < n; k++) addSlot();
}
function addSlot() {
  const el = document.createElement("div");
  el.className = "slot";
  $("slots").appendChild(el);
  S.slots.push({ el, block: null });
}

function makeBlockEl(block) {
  const el = document.createElement("button");
  el.className = "block";
  el.style.setProperty("--c", PALETTE[block.color].hex);
  el.style.setProperty("--c-dark", shade(PALETTE[block.color].hex, -0.35));
  el.innerHTML = `<span class="num">${block.remaining}</span>`;
  if (block.linkedTo) {
    const badge = document.createElement("span");
    badge.className = "link-badge";
    badge.textContent = "🔗";
    el.appendChild(badge);
  }
  el.addEventListener("click", () => onBlockTap(block));
  block.el = el;
  return el;
}

function buildTrayDOM() {
  const tray = $("tray");
  tray.innerHTML = "";
  for (const b of S.tray) tray.appendChild(makeBlockEl(b));
}

function updateBlockCount(block) {
  const num = block.el && block.el.querySelector(".num");
  if (num) num.textContent = block.remaining;
}

function updateBoosterDOM() {
  const map = { slot: "bst-slot", shuffle: "bst-shuffle", pickup: "bst-pickup", vacuum: "bst-vacuum" };
  for (const k of Object.keys(map)) {
    const btn = $(map[k]);
    btn.disabled = S.boosters[k] <= 0;
    btn.classList.toggle("active", S.mode === k);
  }
}

// ---------- 토스트 ----------
let toastTimer = null;
function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 1800);
}

// ---------- 블록 조작 ----------
function blockById(id) {
  const inTray = S.tray.find((b) => b.id === id);
  if (inTray) return inTray;
  for (const s of S.slots) if (s.block && s.block.id === id) return s.block;
  return null;
}

function onBlockTap(block) {
  if (S.screen !== "play" || S.status !== "playing" || S.paused) return;

  if (block.inSlot) {
    if (S.mode === "pickup") return doPickup(block);
    if (S.mode === "vacuum") return doVacuum(block);
    return;
  }
  if (S.mode !== "none") setMode("none");

  const group = [block];
  if (block.linkedTo) {
    const other = S.tray.find((b) => b.id === block.linkedTo);
    if (other) group.push(other);
  }
  const free = S.slots.filter((s) => !s.block).length;
  if (free < group.length) {
    toast(group.length > 1 ? "연결 블록은 빈 슬롯이 2칸 필요해요!" : "빈 슬롯이 없어요!");
    block.el.classList.add("shake");
    setTimeout(() => block.el && block.el.classList.remove("shake"), 350);
    return;
  }
  for (const b of group) placeInSlot(b);
}

function placeInSlot(block) {
  const slot = S.slots.find((s) => !s.block);
  if (!slot) return;
  S.tray.splice(S.tray.indexOf(block), 1);
  // 슬롯에 들어가면 연결 해제
  if (block.linkedTo) {
    const other = blockById(block.linkedTo);
    if (other) {
      other.linkedTo = null;
      const badge = other.el && other.el.querySelector(".link-badge");
      if (badge) badge.remove();
    }
    block.linkedTo = null;
    const badge = block.el.querySelector(".link-badge");
    if (badge) badge.remove();
  }
  slot.block = block;
  block.inSlot = true;
  block.cd = 0;
  slot.el.appendChild(block.el);
  block.el.classList.add("drop-in");
  setTimeout(() => block.el && block.el.classList.remove("drop-in"), 250);
}

function completeBlock(block) {
  const slot = S.slots.find((s) => s.block === block);
  if (slot) {
    slot.block = null;
    const r = slot.el.getBoundingClientRect();
    burst(r.left + r.width / 2, r.top + r.height / 2, PALETTE[block.color].hex, 10);
  }
  if (block.el) block.el.remove();
  block.el = null;
  checkWin();
}

// ---------- 개미 ----------
function tileCenter(i) {
  const { gw } = S.level;
  return {
    x: S.bx + ((i % gw) + 0.5) * S.cell,
    y: S.by + (((i / gw) | 0) + 0.5) * S.cell,
  };
}

// ---- 걷기 경로: 개미는 타일을 통과할 수 없고, 빈 칸으로만 이동한다 ----
// 아트 격자 주변에 MARGIN 칸의 여백 링을 붙인 확장 격자에서 BFS 탐색

const MARGIN = 2;

function extDims() {
  return { EW: S.level.gw + MARGIN * 2, EH: S.level.gh + MARGIN * 2 };
}
function extBlocked(ex, ey) {
  const ax = ex - MARGIN, ay = ey - MARGIN;
  const { gw, gh } = S.level;
  if (ax < 0 || ax >= gw || ay < 0 || ay >= gh) return false;
  return !!S.alive[ay * gw + ax];
}
function extCenter(ei) {
  const { EW } = extDims();
  return {
    x: S.bx + ((ei % EW) - MARGIN + 0.5) * S.cell,
    y: S.by + (((ei / EW) | 0) - MARGIN + 0.5) * S.cell,
  };
}
function entryCell() {
  const { EW, EH } = extDims();
  const ex = clamp(Math.round((S.nest.x - S.bx) / S.cell) + MARGIN, 0, EW - 1);
  return (EH - 1) * EW + ex;
}
function bfsFrom(start) {
  const { EW, EH } = extDims();
  const dist = new Int32Array(EW * EH).fill(-1);
  const parent = new Int32Array(EW * EH).fill(-1);
  const q = [start];
  dist[start] = 0;
  for (let h = 0; h < q.length; h++) {
    const i = q[h];
    const ex = i % EW, ey = (i / EW) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = ex + dx, ny = ey + dy;
      if (nx < 0 || nx >= EW || ny < 0 || ny >= EH) continue;
      const ni = ny * EW + nx;
      if (dist[ni] !== -1 || extBlocked(nx, ny)) continue;
      dist[ni] = dist[i] + 1;
      parent[ni] = i;
      q.push(ni);
    }
  }
  return { dist, parent };
}
function reconstructPath(parent, end) {
  const cells = [];
  for (let c = end; c !== -1; c = parent[c]) cells.push(c);
  return cells.reverse();
}

// 걸어서 도달 가능한 가장 가까운 매칭 타일과 그 옆 칸까지의 경로
function findRoute(color) {
  const L = S.level;
  const { EW } = extDims();
  const { dist: d, parent } = bfsFrom(entryCell());
  let bestTile = -1, bestCell = -1, bestD = Infinity;
  for (const i of S.exposed) {
    if (L.artGrid[i] !== color || !S.alive[i] || S.reserved.has(i)) continue;
    const ex = (i % L.gw) + MARGIN, ey = ((i / L.gw) | 0) + MARGIN;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = (ey + dy) * EW + (ex + dx);
      if (d[ni] >= 0 && d[ni] < bestD) { bestD = d[ni]; bestTile = i; bestCell = ni; }
    }
  }
  if (bestTile < 0) return null;
  return { tile: bestTile, cells: reconstructPath(parent, bestCell) };
}

function makeWalkPath(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + dist(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y));
  }
  return { pts, cum, len: Math.max(20, cum[cum.length - 1]) };
}
function pathPos(p, t) {
  const total = p.cum[p.cum.length - 1];
  const d = clamp(t, 0, 1) * total;
  let i = 1;
  while (i < p.cum.length - 1 && p.cum[i] < d) i++;
  const seg = p.cum[i] - p.cum[i - 1] || 1;
  const k = (d - p.cum[i - 1]) / seg;
  return {
    x: p.pts[i - 1].x + (p.pts[i].x - p.pts[i - 1].x) * k,
    y: p.pts[i - 1].y + (p.pts[i].y - p.pts[i - 1].y) * k,
  };
}

const jitter = () => (Math.random() - 0.5) * S.cell * 0.3;

function spawnAnt(block, route) {
  S.reserved.add(route.tile);
  block.antsOut++;
  const pts = [{ x: S.nest.x, y: S.nest.y }];
  for (const c of route.cells) {
    const p = extCenter(c);
    pts.push({ x: p.x + jitter(), y: p.y + jitter() });
  }
  // 마지막: 옆 칸에서 타일 면에 닿는 지점까지
  const tc = tileCenter(route.tile);
  const last = extCenter(route.cells[route.cells.length - 1]);
  pts.push({ x: (last.x + tc.x) / 2, y: (last.y + tc.y) / 2 });
  S.ants.push({
    block, tile: route.tile, phase: "go", t: 0,
    path: makeWalkPath(pts),
    lastCell: route.cells[route.cells.length - 1],
    wig: Math.random() * Math.PI * 2,
  });
}

function removeTile(i) {
  S.alive[i] = false;
  S.aliveCount--;
  S.reserved.delete(i);
  S.exposed = computeExposed(S.alive, S.level.gw, S.level.gh);
}

// block의 개미를 전부 회수: 이동 중이면 예약 해제, 운반 중이면 즉시 배달 처리
// (보드 타일 수 == 남은 블록 숫자 합 불변식 유지를 위해 운반분은 카운트에 반영)
function recallAnts(block) {
  for (let i = S.ants.length - 1; i >= 0; i--) {
    const a = S.ants[i];
    if (a.block !== block) continue;
    if (a.phase === "go") S.reserved.delete(a.tile);
    else block.remaining--;
    S.ants.splice(i, 1);
  }
  block.antsOut = 0;
  updateBlockCount(block);
}

// ---------- 부스터 ----------
function setMode(m) {
  S.mode = m;
  document.body.classList.toggle("mode-pickup", m === "pickup");
  document.body.classList.toggle("mode-vacuum", m === "vacuum");
  updateBoosterDOM();
}

function useBooster(kind) {
  if (S.screen !== "play" || S.status !== "playing" || S.boosters[kind] <= 0) return;
  if (kind === "slot") {
    if (S.slots.length >= 6) return;
    S.boosters.slot = 0;
    addSlot();
    toast("슬롯이 6칸으로 늘었어요!");
  } else if (kind === "shuffle") {
    S.boosters.shuffle = 0;
    for (let i = S.tray.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [S.tray[i], S.tray[j]] = [S.tray[j], S.tray[i]];
    }
    const tray = $("tray");
    for (const b of S.tray) tray.appendChild(b.el);
    toast("트레이를 섞었어요!");
  } else if (kind === "pickup" || kind === "vacuum") {
    if (!S.slots.some((s) => s.block)) { toast("슬롯에 블록이 없어요!"); return; }
    setMode(S.mode === kind ? "none" : kind);
    if (S.mode === kind) {
      toast(kind === "pickup" ? "회수할 슬롯 블록을 탭하세요" : "진공청소할 슬롯 블록을 탭하세요");
    }
    return;
  }
  updateBoosterDOM();
}

function doPickup(block) {
  S.boosters.pickup = 0;
  setMode("none");
  recallAnts(block);
  const slot = S.slots.find((s) => s.block === block);
  if (slot) slot.block = null;
  block.inSlot = false;
  if (block.remaining <= 0) {
    completeBlock(block);
  } else {
    S.tray.push(block);
    $("tray").appendChild(block.el);
    toast("블록을 트레이로 회수했어요");
  }
  updateBoosterDOM();
}

function doVacuum(block) {
  S.boosters.vacuum = 0;
  setMode("none");
  recallAnts(block);
  let need = block.remaining;
  if (need > 0) {
    // 노출 타일 우선, 부족하면 갇힌 타일도 흡수 (개미굴에서 가까운 순)
    const candidates = [];
    for (let i = 0; i < S.alive.length; i++) {
      if (!S.alive[i] || S.level.artGrid[i] !== block.color || S.reserved.has(i)) continue;
      const c = tileCenter(i);
      candidates.push({ i, exposed: S.exposed.has(i), d: dist(c.x, c.y, S.nest.x, S.nest.y) });
    }
    candidates.sort((a, b) => (b.exposed - a.exposed) || (a.d - b.d));
    for (const cand of candidates) {
      if (need <= 0) break;
      const c = tileCenter(cand.i);
      burst(c.x, c.y, PALETTE[block.color].hex, 4);
      S.alive[cand.i] = false;
      S.aliveCount--;
      need--;
    }
    if (need > 0) console.warn("vacuum: 타일 부족", need);
    S.exposed = computeExposed(S.alive, S.level.gw, S.level.gh);
  }
  block.remaining = 0;
  toast("🌪 진공청소 완료!");
  completeBlock(block);
  updateBoosterDOM();
}

// ---------- 승패 ----------
function checkWin() {
  if (S.status !== "playing") return;
  if (S.aliveCount === 0 && S.ants.length === 0) {
    S.status = "won";
    const cleared = loadCleared();
    if (S.levelIndex + 1 > cleared) saveCleared(S.levelIndex + 1);
    for (let k = 0; k < 40; k++) {
      burst(S.bx + Math.random() * S.cell * S.level.gw, S.by + Math.random() * S.cell * S.level.gh,
        ["#f4c96b", "#e06bc0", "#5bc8e8", "#62b96a"][k % 4], 1);
    }
    setTimeout(showWin, 700);
  }
}

function showWin() {
  drawArtPreview($("win-art"), S.level);
  $("win-title").textContent = `레벨 ${S.levelIndex + 1} 클리어!`;
  $("win-sub").textContent = `「${S.level.name}」 픽셀 아트를 발견했어요`;
  $("btn-next").style.display = S.levelIndex + 1 < LEVELS.length ? "" : "none";
  show("win-overlay", true);
}

function lose() {
  if (S.status !== "playing") return;
  S.status = "lost";
  show("rescue-banner", false);
  setTimeout(() => show("lose-overlay", true), 500);
}

function drawArtPreview(cv, level) {
  const px = 14;
  cv.width = level.gw * px;
  cv.height = level.gh * px;
  const c2 = cv.getContext("2d");
  for (let i = 0; i < level.artGrid.length; i++) {
    const ch = level.artGrid[i];
    if (ch === ".") continue;
    c2.fillStyle = PALETTE[ch].hex;
    const x = (i % level.gw) * px, y = ((i / level.gw) | 0) * px;
    c2.beginPath();
    c2.roundRect(x + 1, y + 1, px - 2, px - 2, 3);
    c2.fill();
  }
}

// ---------- 파티클 ----------
function burst(x, y, color, n) {
  for (let k = 0; k < n; k++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 40 + Math.random() * 120;
    S.particles.push({
      x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40,
      life: 0.5 + Math.random() * 0.4, t: 0, color,
    });
  }
}

// ---------- 업데이트 ----------
function hasExposedTileFor(color) {
  for (const i of S.exposed) {
    if (S.level.artGrid[i] === color && S.alive[i] && !S.reserved.has(i)) return true;
  }
  return false;
}

function update(dt) {
  if (S.screen !== "play" || S.status !== "playing" || S.paused) return;

  // 슬롯 블록마다 개미 파견
  for (const slot of S.slots) {
    const b = slot.block;
    if (!b) continue;
    b.cd -= dt;
    if (b.cd <= 0 && b.antsOut < MAX_ANTS_PER_BLOCK && b.antsOut < b.remaining) {
      const route = findRoute(b.color);
      if (route) {
        spawnAnt(b, route);
        b.cd = SPAWN_INTERVAL;
      }
    }
  }

  // 개미 이동
  for (let i = S.ants.length - 1; i >= 0; i--) {
    const a = S.ants[i];
    a.wig += dt * 10;
    a.t += (dt * ANT_SPEED) / a.path.len;
    if (a.t < 1) continue;

    if (a.phase === "go") {
      // 타일에 닿는 순간: 큐브가 팝 되며 보드에서 제거 → 노출 갱신
      const c = tileCenter(a.tile);
      burst(c.x, c.y, PALETTE[S.level.artGrid[a.tile]].hex, 5);
      removeTile(a.tile);
      a.phase = "return";
      const touch = pathPos(a.path, 1);
      a.t = 0;
      let tx = S.nest.x, ty = S.nest.y + 20;
      if (a.block.el) {
        const r = a.block.el.getBoundingClientRect();
        tx = r.left + r.width / 2;
        ty = r.top + r.height / 2;
      }
      // 귀환도 걸어서: 빈 칸을 따라 보드 아래로 나간 뒤 슬롯으로
      const { EW, EH } = extDims();
      const { dist: d2, parent: p2 } = bfsFrom(a.lastCell);
      let exit = -1, bestCost = Infinity;
      for (let ex = 0; ex < EW; ex++) {
        const i = (EH - 1) * EW + ex;
        if (d2[i] < 0) continue;
        const p = extCenter(i);
        const cost = d2[i] * S.cell + Math.abs(p.x - tx) * 0.6;
        if (cost < bestCost) { bestCost = cost; exit = i; }
      }
      const pts = [{ x: touch.x, y: touch.y }];
      if (exit >= 0) {
        for (const cell of reconstructPath(p2, exit)) {
          const p = extCenter(cell);
          pts.push({ x: p.x + jitter(), y: p.y + jitter() });
        }
      }
      pts.push({ x: tx, y: ty });
      a.path = makeWalkPath(pts);
    } else {
      // 슬롯 도착: 배달 완료
      const b = a.block;
      S.ants.splice(i, 1);
      b.antsOut--;
      b.remaining--;
      updateBlockCount(b);
      if (b.el) {
        b.el.classList.add("bump");
        setTimeout(() => b.el && b.el.classList.remove("bump"), 150);
      }
      if (b.remaining <= 0 && b.antsOut === 0) completeBlock(b);
      else checkWin();
    }
  }

  // 파티클
  for (let i = S.particles.length - 1; i >= 0; i--) {
    const p = S.particles[i];
    p.t += dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 260 * dt;
    if (p.t > p.life) S.particles.splice(i, 1);
  }

  // 데드락 판정: 슬롯 만석 + 개미 없음 + 모든 슬롯 색이 막힘
  if (S.status === "playing" && S.aliveCount > 0) {
    const full = S.slots.every((s) => s.block);
    if (full && S.ants.length === 0) {
      const anyMove = S.slots.some((s) => hasExposedTileFor(s.block.color));
      if (!anyMove) {
        const rescuable = S.boosters.slot > 0 || S.boosters.pickup > 0 || S.boosters.vacuum > 0;
        if (rescuable) {
          if (!S.rescue) { S.rescue = true; show("rescue-banner", true); }
        } else {
          lose();
        }
        return;
      }
    }
    if (S.rescue) { S.rescue = false; show("rescue-banner", false); }
  }
}

// ---------- 렌더링 ----------
function layout() {
  const bs = $("board-space").getBoundingClientRect();
  const L = S.level;
  const pad = 16;
  const availW = Math.max(60, bs.width - pad * 2);
  const availH = Math.max(60, bs.height - pad * 2);
  S.cell = clamp(Math.floor(Math.min(availW / L.gw, availH / L.gh)), 10, 40);
  S.bx = bs.left + (bs.width - S.cell * L.gw) / 2;
  S.by = bs.top + (bs.height - S.cell * L.gh) / 2;
  const ng = $("nest-gap").getBoundingClientRect();
  S.nest = { x: ng.left + ng.width / 2, y: ng.top + ng.height / 2 };
}

function drawCube(x, y, size, hex, dim) {
  const r = size * 0.18;
  const inset = size * 0.06;
  const s = size - inset * 2;
  ctx.fillStyle = shade(hex, -0.45);
  ctx.beginPath();
  ctx.roundRect(x + inset, y + inset + s * 0.10, s, s * 0.92, r);
  ctx.fill();
  const g = ctx.createLinearGradient(0, y, 0, y + s);
  g.addColorStop(0, shade(hex, dim ? 0.05 : 0.25));
  g.addColorStop(1, shade(hex, dim ? -0.25 : -0.05));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.roundRect(x + inset, y + inset, s, s * 0.9, r);
  ctx.fill();
  if (dim) {
    ctx.fillStyle = "rgba(20,14,8,0.34)";
    ctx.beginPath();
    ctx.roundRect(x + inset, y + inset, s, s, r);
    ctx.fill();
  }
}

function drawBoard() {
  const L = S.level;
  const { cell, bx, by } = S;
  // 파낸 흙 패널
  const m = cell * 0.6;
  ctx.fillStyle = "#241b12";
  ctx.beginPath();
  ctx.roundRect(bx - m, by - m, cell * L.gw + m * 2, cell * L.gh + m * 2, 14);
  ctx.fill();
  ctx.strokeStyle = "rgba(232,221,200,0.08)";
  ctx.lineWidth = 2;
  ctx.stroke();

  for (let i = 0; i < L.artGrid.length; i++) {
    const chColor = L.artGrid[i];
    if (chColor === ".") continue;
    const x = bx + (i % L.gw) * cell;
    const y = by + ((i / L.gw) | 0) * cell;
    if (!S.alive[i]) {
      // 발견된 픽셀 아트 (밝고 평평하게)
      ctx.fillStyle = shade(PALETTE[chColor].hex, 0.18);
      ctx.beginPath();
      ctx.roundRect(x + 1, y + 1, cell - 2, cell - 2, 3);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.10)";
      ctx.fillRect(x + 1, y + 1, cell - 2, (cell - 2) * 0.35);
    } else {
      drawCube(x, y, cell, PALETTE[chColor].hex, !S.exposed.has(i));
    }
  }
}

function drawNest() {
  const { x, y } = S.nest;
  ctx.fillStyle = "#3a2c1c";
  ctx.beginPath();
  ctx.ellipse(x, y, 34, 15, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#120c07";
  ctx.beginPath();
  ctx.ellipse(x, y, 24, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(232,221,200,0.15)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(x, y, 30, 12.5, 0, 0, Math.PI * 2);
  ctx.stroke();
}

const ANT_SCALE = 1.9;

function drawAnt(a) {
  const p = pathPos(a.path, clamp(a.t, 0, 1));
  const p2 = pathPos(a.path, clamp(a.t + 0.02, 0, 1));
  const ang = Math.atan2(p2.y - p.y, p2.x - p.x);
  const sway = Math.sin(a.wig) * 1.2;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(ang);
  ctx.translate(0, sway);
  ctx.scale(ANT_SCALE, ANT_SCALE);
  // 다리
  ctx.strokeStyle = "#2e2318";
  ctx.lineWidth = 0.7;
  const legK = Math.sin(a.wig * 2) * 1.1;
  for (const lx of [-2.6, 0, 2.4]) {
    ctx.beginPath();
    ctx.moveTo(lx, 0); ctx.lineTo(lx - 1.2 + legK, 3.2);
    ctx.moveTo(lx, 0); ctx.lineTo(lx - 1.2 - legK, -3.2);
    ctx.stroke();
  }
  // 몸통 (머리-가슴-배)
  ctx.fillStyle = "#2e2318";
  ctx.beginPath(); ctx.ellipse(3.4, 0, 2.0, 1.6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(0, 0, 1.9, 1.6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(-3.6, 0, 2.8, 2.0, 0, 0, Math.PI * 2); ctx.fill();
  if (a.phase === "return") {
    const hex = PALETTE[a.block.color].hex;
    ctx.fillStyle = shade(hex, 0.1);
    ctx.beginPath();
    ctx.roundRect(-4, -9.5, 9, 7, 2);
    ctx.fill();
    ctx.fillStyle = shade(hex, 0.35);
    ctx.beginPath();
    ctx.roundRect(-4, -9.5, 9, 2.6, 2);
    ctx.fill();
  }
  ctx.restore();
}

function draw() {
  const W = window.innerWidth, H = window.innerHeight;
  ctx.clearRect(0, 0, W, H);
  if (S.screen !== "play" || !S.level) return;

  layout();
  drawBoard();
  drawNest();
  for (const a of S.ants) drawAnt(a);
  for (const p of S.particles) {
    const k = 1 - p.t / p.life;
    ctx.globalAlpha = k;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2 + k * 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

// ---------- 캔버스 크기 ----------
function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
  canvas.style.width = window.innerWidth + "px";
  canvas.style.height = window.innerHeight + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

// ---------- 입력 바인딩 ----------
$("btn-back").addEventListener("click", openMenu);
$("btn-retry").addEventListener("click", () => startLevel(S.levelIndex));
$("btn-retry2").addEventListener("click", () => startLevel(S.levelIndex));
$("btn-next").addEventListener("click", () => startLevel(Math.min(S.levelIndex + 1, LEVELS.length - 1)));
$("btn-menu2").addEventListener("click", openMenu);
$("btn-menu3").addEventListener("click", openMenu);
$("btn-giveup").addEventListener("click", () => { S.rescue = false; lose(); });
$("bst-slot").addEventListener("click", () => useBooster("slot"));
$("bst-shuffle").addEventListener("click", () => useBooster("shuffle"));
$("bst-pickup").addEventListener("click", () => useBooster("pickup"));
$("bst-vacuum").addEventListener("click", () => useBooster("vacuum"));

window.addEventListener("keydown", (e) => {
  if (e.code === "Space" && S.screen === "play" && S.status === "playing") {
    e.preventDefault();
    S.paused = !S.paused;
    show("pause-badge", S.paused);
  }
  if (e.code === "Escape" && S.mode !== "none") setMode("none");
});

// ---------- 메인 루프 ----------
let lastT = 0;
function loop(t) {
  const dt = Math.min(0.05, (t - lastT) / 1000 || 0.016);
  lastT = t;
  update(dt);
  draw();
  requestAnimationFrame(loop);
}

openMenu();
requestAnimationFrame(loop);
