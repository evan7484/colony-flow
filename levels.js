"use strict";

// ============================================================
// Colony Flow — 레벨 데이터 + 순수 로직 (DOM 없음, 헤드리스 테스트 가능)
// ============================================================

const PALETTE = {
  R: { name: "레드",   hex: "#e5484d" },
  O: { name: "오렌지", hex: "#f0883d" },
  Y: { name: "옐로우", hex: "#f5c542" },
  G: { name: "그린",   hex: "#62b96a" },
  B: { name: "블루",   hex: "#4d79e5" },
  C: { name: "스카이", hex: "#5bc8e8" },
  P: { name: "핑크",   hex: "#e06bc0" },
  V: { name: "퍼플",   hex: "#9a6be0" },
  W: { name: "화이트", hex: "#f2ede2" },
  N: { name: "브라운", hex: "#a1713f" },
  K: { name: "다크",   hex: "#4b4237" },
};

// art: "." = 빈 칸, 그 외 문자는 PALETTE 색 타일
// maxBlock: 색별 블록 최대 크기(자동 분할). default 키로 기본값 지정
// links: 연결 블록 쌍 개수 (한 번의 탭으로 두 블록이 동시에 슬롯 점유)
const LEVELS = [
  {
    name: "별빛", links: 0,
    maxBlock: { O: 10, Y: 9, W: 6, default: 9 },
    art: [
      ".....O.....",
      "....OYO....",
      "...OYYYO...",
      "OOOOYYYOOOO",
      ".OYYYYYYYO.",
      "..OYWWWYO..",
      "..OYYWYYO..",
      ".OYYO.OYYO.",
      ".OO.....OO.",
    ],
  },
  {
    name: "하트", links: 0,
    maxBlock: { default: 10 },
    art: [
      "..RRR.RRR..",
      ".RPPPRPPPR.",
      "RPWWPPPPPPR",
      "RPWPPPPPPPR",
      "RPPPPPPPPPR",
      ".RPPPPPPPR.",
      "..RPPPPPR..",
      "...RPPPR...",
      "....RPR....",
      ".....R.....",
    ],
  },
  {
    name: "체리", links: 0,
    maxBlock: { default: 8 },
    art: [
      "....GG.....",
      "...G..G....",
      "..G....G...",
      ".RRRR.RRRR.",
      ".RWRR.RWRR.",
      ".RRRR.RRRR.",
      "..RR...RR..",
    ],
  },
  {
    name: "사과", links: 0,
    maxBlock: { R: 9, default: 8 },
    art: [
      "......G....",
      "....NGG....",
      "....N......",
      ".RRRNRRRR..",
      "RRWRRRRRRR.",
      "RWWRRRRRRRR",
      "RRRRRRRRRRR",
      "RRRRRRRRRRR",
      ".RRRRRRRRR.",
      "..RRR.RRR..",
    ],
  },
  {
    name: "버섯", links: 0,
    maxBlock: { default: 8 },
    art: [
      "...RRRRR...",
      "..RWRRRWR..",
      ".RRRWWRRRR.",
      "RRRRRRRRRRR",
      "...WWWWW...",
      "...WWWWW...",
      "....WWW....",
      "..NNNNNNN..",
    ],
  },
  {
    name: "물고기", links: 0,
    maxBlock: { default: 8 },
    art: [
      "...BBBB..O..",
      "..BBBBBB.OO.",
      ".BWKBBBBBOOO",
      ".BBBBBBBBOO.",
      ".BCCCBBBBOOO",
      "..CCCCBB.OO.",
      "...CCCC..O..",
    ],
  },
  {
    name: "병아리", links: 0,
    maxBlock: { default: 8 },
    art: [
      "...YYYYY...",
      "..YYYYYYY..",
      ".YYKYYYKYY.",
      ".YYYYYYYYY.",
      ".YYYOOYYYY.",
      ".YYYYYYYYY.",
      "..YYWWWYY..",
      "..YYWWWYY..",
      "...YYYYY...",
      "....O.O....",
    ],
  },
  {
    name: "꽃", links: 0,
    maxBlock: { default: 7 },
    art: [
      "...PP.PP...",
      "..PPPPPPP..",
      ".PPPYYYPPP.",
      ".PPYYWYYPP.",
      ".PPPYYYPPP.",
      "..PPPPPPP..",
      "...PP.PP...",
      ".....G.....",
      "...G.G.....",
      "....GG.....",
      ".....G.....",
    ],
  },
  {
    name: "나비", links: 1,
    maxBlock: { default: 7 },
    art: [
      ".VVV...VVV.",
      "VVPVV.VVPVV",
      "VPPPVKVPPPV",
      "VPOPVKVPOPV",
      "VVPVVKVVPVV",
      ".VVVVKVVVV.",
      "..VVPKPVV..",
      "...VVKVV...",
      "....V.V....",
    ],
  },
  {
    name: "로켓", links: 1,
    maxBlock: { default: 7 },
    art: [
      "....R....",
      "...RRR...",
      "...RWR...",
      "..WWWWW..",
      "..WBBBW..",
      "..WBBBW..",
      "..WWWWW..",
      ".RWWWWWR.",
      "RRWWWWWRR",
      "RR.OOO.RR",
      "...OCO...",
      "....O....",
    ],
  },
  {
    name: "꽃게", links: 2,
    maxBlock: { default: 7 },
    art: [
      "OOO......OOO",
      "O..........O",
      "O.RRRRRRRR.O",
      "OORWRRRRWROO",
      ".RRKRRRRKRR.",
      ".RRRRRRRRRR.",
      "..RR.RR.RR..",
      ".R...RR...R.",
    ],
  },
  {
    name: "수박", links: 2,
    maxBlock: { default: 8 },
    art: [
      "....RRRR....",
      "..RRRRRRRR..",
      ".RRKRRRRKRR.",
      "RRRKRRRRKRRR",
      "WWWWWWWWWWWW",
      "GGGGGGGGGGGG",
    ],
  },
  {
    name: "유령", links: 2,
    maxBlock: { W: 6, default: 6 },
    art: [
      "...WWWW...",
      "..WWWWWW..",
      ".WWWWWWWW.",
      ".WKKWWKKW.",
      ".WKKWWKKW.",
      ".WWWWWWWW.",
      ".WWWVVWWW.",
      ".WWWWWWWW.",
      ".WW.WW.WW.",
    ],
  },
  {
    name: "무지개", links: 3,
    maxBlock: { default: 7 },
    art: [
      "....RRRRRRR....",
      "..RRROOOOORRR..",
      ".RROOOYYYOOORR.",
      ".ROOYYGGGYYOOR.",
      "ROYYGGBBBGGYYOR",
      "ROYGGB...BGGYOR",
      "WWYGB.....BGYWW",
      "WWWWB.....BWWWW",
    ],
  },
  {
    name: "성", links: 3,
    maxBlock: { N: 8, default: 7 },
    art: [
      "..R.......R..",
      ".RRR.....RRR.",
      ".NYN.....NYN.",
      ".NNN.....NNN.",
      ".NNNNNNNNNNN.",
      ".NYNNYNNYNNN.",
      ".NNNNBBBNNNN.",
      ".NNNNBBBNNNN.",
      "GGGGGGGGGGGGG",
    ],
  },
];

// ---------- 순수 로직 ----------

// 결정적 PRNG (레벨마다 같은 트레이 배치 재현)
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// total을 maxSize 이하 조각들로 균등 분할 (합 보존 보장)
function splitCount(total, maxSize) {
  const n = Math.ceil(total / maxSize);
  const base = Math.floor(total / n);
  const rem = total % n;
  const parts = [];
  for (let i = 0; i < n; i++) parts.push(base + (i < rem ? 1 : 0));
  return parts;
}

// 레벨 정의 → { gw, gh, artGrid(char[]), blocks[] }
// 블록 숫자 합 == 색별 타일 수가 구조적으로 보장된다
function buildLevel(def, index) {
  const gw = Math.max(...def.art.map((r) => r.length));
  const gh = def.art.length;
  const artGrid = new Array(gw * gh).fill(".");
  const counts = {};
  for (let y = 0; y < gh; y++) {
    const row = def.art[y];
    for (let x = 0; x < gw; x++) {
      const ch = row[x] || ".";
      if (ch === ".") continue;
      if (!PALETTE[ch]) throw new Error(`레벨 ${index + 1}: 알 수 없는 색 문자 '${ch}'`);
      artGrid[y * gw + x] = ch;
      counts[ch] = (counts[ch] || 0) + 1;
    }
  }

  const rng = mulberry32(1000 + index * 7919 + (def.traySeed || 0) * 104729);
  let blockId = 0;
  const blocks = [];
  for (const color of Object.keys(counts)) {
    const max = (def.maxBlock && (def.maxBlock[color] || def.maxBlock.default)) || 8;
    for (const size of splitCount(counts[color], max)) {
      blocks.push({ id: `b${index}_${blockId++}`, color, count: size, remaining: size, linkedTo: null });
    }
  }
  // 결정적 셔플
  for (let i = blocks.length - 1; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
  }
  // 연결 블록: 색이 다른 인접 쌍을 links개 지정
  let linked = 0;
  for (let i = 0; i + 1 < blocks.length && linked < (def.links || 0); i++) {
    const a = blocks[i], b = blocks[i + 1];
    if (a.linkedTo || b.linkedTo || a.color === b.color) continue;
    a.linkedTo = b.id;
    b.linkedTo = a.id;
    linked++;
    i++;
  }

  // 트레이 열 배치: 스택 구조 (맨 위 블록만 뺄 수 있음)
  // 연결 쌍은 같은 열에 연달아 배치해 앞 블록을 탭하면 함께 나가도록 한다
  const colCount = Math.max(3, Math.min(5, Math.ceil(blocks.length / 3)));
  const cols = Array.from({ length: colCount }, () => []);
  const placed = new Set();
  const shortest = () => cols.reduce((a, c) => (c.length < a.length ? c : a));
  for (const b of blocks) {
    if (placed.has(b.id)) continue;
    const col = shortest();
    col.push(b);
    placed.add(b.id);
    if (b.linkedTo && !placed.has(b.linkedTo)) {
      const p = blocks.find((x) => x.id === b.linkedTo);
      col.push(p);
      placed.add(p.id);
    }
  }
  return {
    name: def.name, gw, gh, artGrid, counts, blocks,
    trayCols: cols.map((c) => c.map((b) => b.id)),
  };
}

// 노출 판정: 그림 바깥과 연결된 빈 칸에 4방향 인접한 살아있는 타일 = 먹을 수 있음
// aliveMask[i]가 truthy면 타일 존재. 반환: 노출 타일 인덱스 Set
function computeExposed(aliveMask, gw, gh) {
  const outside = new Uint8Array(gw * gh);
  const stack = [];
  for (let x = 0; x < gw; x++) {
    for (const y of [0, gh - 1]) {
      const i = y * gw + x;
      if (!aliveMask[i] && !outside[i]) { outside[i] = 1; stack.push(i); }
    }
  }
  for (let y = 0; y < gh; y++) {
    for (const x of [0, gw - 1]) {
      const i = y * gw + x;
      if (!aliveMask[i] && !outside[i]) { outside[i] = 1; stack.push(i); }
    }
  }
  while (stack.length) {
    const i = stack.pop();
    const x = i % gw, y = (i / gw) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= gw || ny < 0 || ny >= gh) continue;
      const ni = ny * gw + nx;
      if (!aliveMask[ni] && !outside[ni]) { outside[ni] = 1; stack.push(ni); }
    }
  }
  const exposed = new Set();
  for (let i = 0; i < gw * gh; i++) {
    if (!aliveMask[i]) continue;
    const x = i % gw, y = (i / gw) | 0;
    if (x === 0 || x === gw - 1 || y === 0 || y === gh - 1) { exposed.add(i); continue; }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (outside[(y + dy) * gw + (x + dx)]) { exposed.add(i); break; }
    }
  }
  return exposed;
}

const CF = { PALETTE, LEVELS, mulberry32, splitCount, buildLevel, computeExposed };
if (typeof globalThis !== "undefined") globalThis.CF = CF;
if (typeof module !== "undefined" && module.exports) module.exports = CF;
