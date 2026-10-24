// Display helpers shared by server and client ledger components (no server-only imports).

export const CATEGORY_LIST = [
  "외식", "배달", "카페·간식", "장보기", "생필품", "쇼핑", "교통",
  "여행", "통신비", "구독·AI", "업무", "의료", "경조사·선물", "기타",
] as const;

const CATEGORY_COLORS: Record<string, string> = {
  "외식": "#F2A93B", "배달": "#F07B5A", "카페·간식": "#D9A066", "장보기": "#3FB98A",
  "생필품": "#5CC8B0", "쇼핑": "#4C7BF3", "교통": "#38BDF8", "여행": "#2DD4BF",
  "통신비": "#818CF8", "구독·AI": "#A78BFA", "업무": "#94A3B8", "의료": "#F472B6",
  "경조사·선물": "#FB7185", "기타": "#4A5578", "미분류": "#3A4466",
};

export function categoryColor(category: string | null): string {
  return CATEGORY_COLORS[category ?? "미분류"] ?? "#4A5578";
}

export function won(amount: number): string {
  return `${amount.toLocaleString("ko-KR")}원`;
}

/** Signed display amount: spending as "-3,700원", cancellations as "+3,700원". */
export function txAmount(tx: { amount: number | null; originalAmount: string | null; currency: string; status: string }): string {
  if (tx.amount == null) return tx.originalAmount ? `${tx.originalAmount} ${tx.currency}` : "금액 미상";
  const sign = tx.status === "cancelled" ? "+" : "-";
  return `${sign}${Math.abs(tx.amount).toLocaleString("ko-KR")}원`;
}

/** Month bar labels in whole 만원 units, e.g. 1,420,000 → "142만". */
export function manwon(amount: number): string {
  return `${Math.floor(amount / 10_000).toLocaleString("ko-KR")}만`;
}

const KST_MS = 9 * 60 * 60 * 1000;

function kst(iso: string): Date {
  return new Date(new Date(iso).getTime() + KST_MS);
}

export function kstDate(iso: string): string {
  return kst(iso).toISOString().slice(0, 10);
}

export function kstTime(iso: string): string {
  return kst(iso).toISOString().slice(11, 16);
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/** "오늘 10/24 (금)", "어제 10/23 (목)", "10/20 (월)" */
export function dayLabel(date: string, today: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const md = `${d.getUTCMonth() + 1}/${d.getUTCDate()} (${WEEKDAYS[d.getUTCDay()]})`;
  const diff = Math.round((new Date(`${today}T00:00:00Z`).getTime() - d.getTime()) / 86_400_000);
  return diff === 0 ? `오늘 ${md}` : diff === 1 ? `어제 ${md}` : md;
}

export function relativeTime(iso: string | null, now: number): string {
  if (!iso) return "기록 없음";
  const minutes = Math.floor((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "방금";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.floor(hours / 24)}일 전`;
}

export function monthLabel(month: string): string {
  const [y, m] = month.split("-");
  return `${y}년 ${Number(m)}월`;
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function cardOf(tx: { cardName: string | null; cardOrg: string }): string {
  return tx.cardName || tx.cardOrg;
}
