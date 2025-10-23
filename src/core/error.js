let _lastUserMsgAt = 0;

export function handleError(err, { where = "", userMessage = "문제가 발생했습니다." } = {}) {
  try {
    const info = (err && err.message) ? err.message : String(err);
    console.error(`[ERROR] ${where} :: ${info}`, err);
  } catch (_) { }

  // 과도한 alert 방지
  const now = Date.now();
  if (now - _lastUserMsgAt > 1200) {
    _lastUserMsgAt = now;
    try { alert(userMessage); } catch (_) {}
  }
}

export const ensureNumber = (v, def = 0) =>
  (typeof v === "number" && Number.isFinite(v)) ? v : def;

export function normalizeBay(v) {
  return (typeof v === "string") ? v.trim().toUpperCase() : v;
}
