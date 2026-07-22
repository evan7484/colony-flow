"use strict";

// ============================================================
// Colony Flow — 커스텀 레벨: 사진 → 픽셀 아트 스테이지 변환 + URL 공유
// 순수 변환/인코딩 함수는 DOM 없이도 동작 (헤드리스 테스트 가능)
// ============================================================

const CUSTOM_KEY = "colony-flow-custom";
const CUSTOM_SIZES = { s: 10, m: 13, l: 16 };
const CUSTOM_MAX_DIM = 20;
const CUSTOM_MIN_TILES = 10;

// 팔레트를 RGB로 전개
const PALETTE_RGB = Object.entries(PALETTE).map(([ch, p]) => ({
  ch,
  r: parseInt(p.hex.slice(1, 3), 16),
  g: parseInt(p.hex.slice(3, 5), 16),
  b: parseInt(p.hex.slice(5, 7), 16),
}));

// 가중 RGB 거리 (redmean)
function colorDist(r1, g1, b1, r2, g2, b2) {
  const rm = (r1 + r2) / 2;
  const dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
  return (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
}

function nearestOf(r, g, b, pool) {
  let best = pool[0], bestD = Infinity;
  for (const p of pool) {
    const d = colorDist(r, g, b, p.r, p.g, p.b);
    if (d < bestD) { bestD = d; best = p; }
  }
  return best.ch;
}

// RGBA 배열(w×h) → 아트 행 배열. 알파 < 128은 빈 칸, 색은 팔레트 상위 colorCount개로 제한
function quantizeArt(data, w, h, colorCount) {
  const chosen = new Array(w * h);
  const counts = {};
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    if (data[o + 3] < 128) { chosen[i] = "."; continue; }
    const ch = nearestOf(data[o], data[o + 1], data[o + 2], PALETTE_RGB);
    chosen[i] = ch;
    counts[ch] = (counts[ch] || 0) + 1;
  }
  // 빈도 상위 K색만 남기고 재매핑
  const top = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, colorCount)
    .map(([ch]) => ch);
  const topSet = new Set(top);
  const topPool = PALETTE_RGB.filter((p) => topSet.has(p.ch));
  if (topPool.length === 0) return null;
  for (let i = 0; i < w * h; i++) {
    if (chosen[i] === "." || topSet.has(chosen[i])) continue;
    const o = i * 4;
    chosen[i] = nearestOf(data[o], data[o + 1], data[o + 2], topPool);
  }
  // 행 문자열로 변환 후 완전히 빈 테두리 행/열 제거
  let rows = [];
  for (let y = 0; y < h; y++) rows.push(chosen.slice(y * w, (y + 1) * w).join(""));
  while (rows.length && !/[^.]/.test(rows[0])) rows.shift();
  while (rows.length && !/[^.]/.test(rows[rows.length - 1])) rows.pop();
  if (!rows.length) return null;
  let left = 0, right = rows[0].length;
  while (left < right && rows.every((r) => r[left] === ".")) left++;
  while (right > left && rows.every((r) => r[right - 1] === ".")) right--;
  rows = rows.map((r) => r.slice(left, right));
  return rows;
}

// 커스텀 레벨 def 생성 (블록 크기는 타일 수에 비례해 자동)
function customDef(art, name) {
  const tiles = art.join("").replace(/\./g, "").length;
  return {
    name: name || "커스텀",
    art,
    maxBlock: { default: Math.max(5, Math.min(10, Math.round(tiles / 12))) },
    links: 0,
  };
}

// ---------- URL 인코딩 ----------
function encodeCustom(art, name) {
  const s = `${art[0].length}x${art.length}:${art.join(",")}`;
  return `#c=${s}` + (name ? `&n=${encodeURIComponent(name)}` : "");
}

function decodeCustom(hash) {
  const m = /#c=(\d+)x(\d+):([A-Z.,]+)(?:&n=([^&]*))?/.exec(hash || "");
  if (!m) return null;
  const gw = parseInt(m[1], 10), gh = parseInt(m[2], 10);
  if (gw < 2 || gw > CUSTOM_MAX_DIM || gh < 2 || gh > CUSTOM_MAX_DIM) return null;
  const rows = m[3].split(",");
  if (rows.length !== gh || rows.some((r) => r.length !== gw)) return null;
  let tiles = 0;
  for (const r of rows) {
    for (const ch of r) {
      if (ch === ".") continue;
      if (!PALETTE[ch]) return null;
      tiles++;
    }
  }
  if (tiles < CUSTOM_MIN_TILES) return null;
  let name = "";
  try { name = m[4] ? decodeURIComponent(m[4]).slice(0, 20) : ""; } catch (e) { /* 무시 */ }
  return { art: rows, name };
}

// ---------- 모달 UI ----------
const cust = { img: null, size: "m", colors: 5, art: null, name: "" };

function renderCustomPreview(art) {
  const cv = document.getElementById("custom-preview");
  const px = 12;
  cv.width = art[0].length * px;
  cv.height = art.length * px;
  const c2 = cv.getContext("2d");
  c2.clearRect(0, 0, cv.width, cv.height);
  for (let y = 0; y < art.length; y++) {
    for (let x = 0; x < art[0].length; x++) {
      const ch = art[y][x];
      if (ch === ".") continue;
      c2.fillStyle = PALETTE[ch].hex;
      c2.fillRect(x * px, y * px, px - 1, px - 1);
    }
  }
  cv.classList.remove("hidden");
}

function recomputeCustom() {
  if (!cust.img) return;
  const maxDim = CUSTOM_SIZES[cust.size];
  const iw = cust.img.naturalWidth || cust.img.width;
  const ih = cust.img.naturalHeight || cust.img.height;
  let gw, gh;
  if (iw >= ih) { gw = maxDim; gh = Math.max(6, Math.round((maxDim * ih) / iw)); }
  else { gh = maxDim; gw = Math.max(6, Math.round((maxDim * iw) / ih)); }
  const cv = document.createElement("canvas");
  cv.width = gw;
  cv.height = gh;
  const c2 = cv.getContext("2d");
  c2.drawImage(cust.img, 0, 0, gw, gh);
  const data = c2.getImageData(0, 0, gw, gh).data;
  const art = quantizeArt(data, gw, gh, cust.colors);
  if (!art) { toast("이미지를 변환할 수 없어요"); return; }
  cust.art = art;
  renderCustomPreview(art);
  updateCustomStats();
}

function updateCustomStats() {
  const el = document.getElementById("custom-stats");
  if (!cust.art) { el.textContent = ""; return; }
  const level = buildLevel(customDef(cust.art, cust.name), 999);
  const tiles = Object.values(level.counts).reduce((a, b) => a + b, 0);
  el.textContent = `타일 ${tiles}개 · 색 ${Object.keys(level.counts).length}종 · 블록 ${level.blocks.length}개`;
  document.getElementById("btn-custom-play").disabled = tiles < CUSTOM_MIN_TILES;
  document.getElementById("btn-custom-share").disabled = tiles < CUSTOM_MIN_TILES;
}

function customShareUrl() {
  return location.origin + location.pathname + encodeCustom(cust.art, cust.name);
}

function bindCustomUI() {
  const overlay = document.getElementById("custom-overlay");
  document.getElementById("btn-custom").addEventListener("click", () => {
    overlay.classList.remove("hidden");
    // 이전에 만든 레벨이 있으면 복원
    if (!cust.art) {
      try {
        const saved = JSON.parse(localStorage.getItem(CUSTOM_KEY) || "null");
        if (saved && decodeCustom(encodeCustom(saved.art, ""))) {
          cust.art = saved.art;
          cust.name = saved.name || "";
          renderCustomPreview(cust.art);
          updateCustomStats();
        }
      } catch (e) { /* 무시 */ }
    }
  });
  document.getElementById("btn-custom-close").addEventListener("click", () => {
    overlay.classList.add("hidden");
  });

  document.getElementById("custom-file").addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    cust.name = file.name.replace(/\.[^.]*$/, "").slice(0, 20);
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      cust.img = img;
      recomputeCustom();
      URL.revokeObjectURL(url);
    };
    img.onerror = () => toast("이미지를 불러올 수 없어요");
    img.src = url;
  });

  const bindSeg = (groupId, key, parse) => {
    const group = document.getElementById(groupId);
    group.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        cust[key] = parse(btn.dataset.v);
        group.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === btn));
        recomputeCustom();
      });
    });
  };
  bindSeg("custom-size", "size", (v) => v);
  bindSeg("custom-colors", "colors", (v) => parseInt(v, 10));

  document.getElementById("btn-custom-play").addEventListener("click", () => {
    if (!cust.art) return;
    localStorage.setItem(CUSTOM_KEY, JSON.stringify({ art: cust.art, name: cust.name }));
    overlay.classList.add("hidden");
    startCustomLevel(cust.art, cust.name);
  });

  document.getElementById("btn-custom-share").addEventListener("click", async () => {
    if (!cust.art) return;
    try {
      await navigator.clipboard.writeText(customShareUrl());
      toast("🔗 링크를 복사했어요 — 친구에게 보내보세요!");
    } catch (e) {
      toast("복사 실패 — 주소창의 링크를 직접 복사해주세요");
      location.hash = encodeCustom(cust.art, cust.name).slice(1);
    }
  });
}
