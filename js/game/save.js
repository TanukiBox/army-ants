// セーブ：ブラウザの中（localStorage）に自動で保存する。
// 使えない環境（プライベートブラウズなど）でも遊べるように、失敗しても止まらない。

const KEY = 'armyants.save.v1';

const DEFAULTS = () => ({
  settings: { lang: null, sound: true },
  records: { bestStage: -1, bestCount: 0 },
});

let data = DEFAULTS();

export function loadSave() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw);
      data = { ...DEFAULTS(), ...d, settings: { ...DEFAULTS().settings, ...d.settings },
               records: { ...DEFAULTS().records, ...d.records } };
    }
  } catch (e) {
    data = DEFAULTS();
  }
  return data;
}

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* 保存できなくても遊べる */ }
}

export function getSave() { return data; }

export function deleteSave() {
  try { localStorage.removeItem(KEY); } catch (e) { /* noop */ }
  data = DEFAULTS();
}

/** ランの記録を更新する（どこまで進んだか・最大の群れ） */
export function recordRun(stageIndex, maxCount) {
  const r = data.records;
  let changed = false;
  if (stageIndex > r.bestStage) { r.bestStage = stageIndex; changed = true; }
  if (maxCount > r.bestCount) { r.bestCount = Math.round(maxCount); changed = true; }
  if (changed) save();
}
