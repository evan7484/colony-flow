"use strict";

// ============================================================
// Colony Flow — Firestore REST 기반 글로벌 랭킹
// 닉네임 문서(players/{nick})에 최고 클리어 레벨을 기록한다.
// 보안 규칙이 "레벨은 증가만 가능"을 강제한다 (firestore.rules 참고)
// ============================================================

// firebase apps:sdkconfig 값으로 채워진다 (배포 설정 후)
const FIREBASE = {
  projectId: "colony-flow-rank-7484",
  apiKey: "AIzaSyCSUlaz6-pCq_ZrGzy9B1SiAjGFblFXR7Q",
};

const RANK_ENABLED = () => FIREBASE.projectId && FIREBASE.apiKey;

const fsBase = () =>
  `https://firestore.googleapis.com/v1/projects/${FIREBASE.projectId}/databases/(default)/documents`;

// 닉네임 중복 확인 (문서 존재 여부)
async function nickExists(nickname) {
  const res = await fetch(
    `${fsBase()}/players/${encodeURIComponent(nickname)}?key=${FIREBASE.apiKey}`
  );
  if (res.status === 404) return false;
  if (res.ok) return true;
  throw new Error(`lookup ${res.status}`);
}

// 상위 3명 조회 (bestLevel 내림차순, 예약만 하고 클리어 없는 레벨 0은 제외)
async function fetchTop3() {
  if (!RANK_ENABLED()) return null;
  const res = await fetch(`${fsBase()}:runQuery?key=${FIREBASE.apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "players" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "bestLevel" },
            op: "GREATER_THAN_OR_EQUAL",
            value: { integerValue: "1" },
          },
        },
        orderBy: [{ field: { fieldPath: "bestLevel" }, direction: "DESCENDING" }],
        limit: 3,
      },
    }),
  });
  if (!res.ok) throw new Error(`runQuery ${res.status}`);
  const rows = await res.json();
  return rows
    .filter((r) => r.document)
    .map((r) => ({
      nickname: r.document.fields.nickname.stringValue,
      bestLevel: parseInt(r.document.fields.bestLevel.integerValue, 10),
    }));
}

// 최고 기록 제출 (더 낮거나 같은 레벨이면 규칙이 거부 → 조용히 무시)
async function submitScore(nickname, bestLevel) {
  if (!RANK_ENABLED() || !nickname) return false;
  // 항상 전체 문서를 보내므로 updateMask는 쓰지 않는다
  // (updateMask를 붙이면 신규 생성 시 보안 규칙 평가가 깨지는 것을 확인함)
  const url = `${fsBase()}/players/${encodeURIComponent(nickname)}?key=${FIREBASE.apiKey}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fields: {
        nickname: { stringValue: nickname },
        bestLevel: { integerValue: String(bestLevel) },
        updatedAt: { integerValue: String(Date.now()) },
      },
    }),
  });
  return res.ok;
}

// 닉네임 규칙: 한글/영문/숫자/_- 2~12자
function validNickname(nick) {
  return /^[가-힣a-zA-Z0-9_-]{2,12}$/.test(nick);
}
