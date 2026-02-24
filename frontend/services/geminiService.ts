// AI 服务 - 通过后端 API 调用（Key 不会泄露）

const API_BASE = '/api';

export async function parseMaturityDates(text: string) {
  const res = await fetch(`${API_BASE}/ai/parse-maturity`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  });
  if (!res.ok) throw new Error('解析失败');
  return res.json();
}

export async function parseQuotations(text: string, defaultWeekday: string) {
  const res = await fetch(`${API_BASE}/ai/parse-quotation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, defaultWeekday })
  });
  if (!res.ok) throw new Error('解析失败');
  return res.json();
}
