// 法則カード：ステージの合間に3枚（女王の部屋で4枚に増やせる）から1枚を選ぶ。効果はそのランの間だけ続く。
// 同じカードを何枚も取ると効果が重なる（stack: false のカードは1枚まで）。
// 組み合わせると強くなるように作っている（例：捕食 × 猛毒、産卵 × 女王の加護、群射 × 鋭牙、破城 × 長射程）。
// 作り直し（v2）の遊びに合わせたカード。武器のカードは、その武器を持っているときだけ出る（今日のコースは全員同じ候補）。
//
// mods（ランの間の補正）の初期値は defaultMods()。カードを取るたびに apply(mods) で書きかえる。

export function defaultMods() {
  return {
    fireRate: 1,       // 撃つ間かくの倍率（小さいほど弾が多い）
    dmgMul: 1,         // 弾の強さ
    rangeMul: 1,       // 弾が届く距離
    eggMul: 1,         // 卵から生まれる仲間の数
    startPlus: 0,      // ステージの始めの群れに足す数
    predation: 0,      // シロアリを倒した数のこの割合だけ群れが増える
    plusBonus: 0,      // ＋の道の1枚に足す数
    goldEvery: false,  // 金の×2ゲートが毎ステージ出る
    addMul: 1,         // ＋の道・＋の看板で増える数の倍率
    mutateGain: 0,     // 変異したとき、群れがこの割合だけ増える
    cocoonHp: 1,       // 繭の耐久の倍率
    cocoonDmg: 1,      // 繭を壊す速さ
    poisonSpread: 0,   // ヒアリの毒が広がる数に足す
    poisonMul: 1,      // ヒアリの毒が効く長さ
    pierce: 0,         // サシハリアリの毒針が貫く数に足す
    bombRadius: 1,     // 自爆アリの爆発範囲
    jawMul: 1,         // アギトアリの顎（届く距離・倒す数）
    dmgTaken: 1,       // 赤い円・ゴミムシ・−の看板で減る数の倍率
    clashLoss: 1,      // シロアリと相殺するとき、こちらが失う数の倍率
    nestDmg: 1,        // 巣への攻撃
    honeyMul: 1,       // もらえる蜜
  };
}

// starter: true は最初から使えるカード。false は女王の部屋で蜜を払って解放する（cost）
// weapon: その武器を持っているときだけ候補に出る
export const CARDS = [
  // --- 射撃 ---
  { id: 'volley', cat: 'fire', starter: true, stack: true,
    ja: ['群射の法則', '撃つ弾+30%'], en: ['Law of the Volley', 'Fire 30% more bullets'],
    apply: (m) => { m.fireRate /= 1.3; } },
  { id: 'fang', cat: 'fire', starter: true, stack: true,
    ja: ['鋭牙の法則', '弾の強さ+30%'], en: ['Law of the Fang', 'Bullets deal +30% damage'],
    apply: (m) => { m.dmgMul *= 1.3; } },
  { id: 'reach', cat: 'fire', starter: true, stack: true,
    ja: ['長射程の法則', '弾が届く距離+25%'], en: ['Law of Reach', 'Bullets fly 25% farther'],
    apply: (m) => { m.rangeMul *= 1.25; } },
  // --- 群れ ---
  { id: 'brood', cat: 'swarm', starter: true, stack: true,
    ja: ['産卵の法則', '卵から生まれる仲間+50%'], en: ['Law of the Brood', 'Eggs hatch 50% more ants'],
    apply: (m) => { m.eggMul *= 1.5; } },
  { id: 'queen', cat: 'swarm', starter: true, stack: true,
    ja: ['女王の加護', 'ステージの始めの群れ+8'], en: ["Queen's Blessing", 'Start each stage with +8 ants'],
    apply: (m) => { m.startPlus += 8; } },
  { id: 'trail', cat: 'swarm', starter: true, stack: true,
    ja: ['行列の法則', '＋の道が1枚ごとに+1多い'], en: ['Law of the Trail', '+1 more from each + panel'],
    apply: (m) => { m.plusBonus += 1; } },
  { id: 'devour', cat: 'swarm', starter: false, cost: 50, stack: true,
    ja: ['捕食の法則', 'シロアリを10匹倒すごとに仲間+1'], en: ['Law of Devouring', '+1 ant for every 10 termites you kill'],
    apply: (m) => { m.predation += 0.1; } },
  { id: 'fortune', cat: 'swarm', starter: false, cost: 60, stack: false,
    ja: ['金運の法則', '金の×2ゲートが毎ステージ出る'], en: ['Law of Fortune', 'A gold ×2 gate appears every stage'],
    apply: (m) => { m.goldEvery = true; } },
  // --- 繭・変異 ---
  { id: 'ripen', cat: 'cocoon', starter: true, stack: true,
    ja: ['熟成の法則', '変異したとき、群れが20%増える'], en: ['Law of Ripening', 'Mutating grows the swarm by 20%'],
    apply: (m) => { m.mutateGain += 0.2; } },
  { id: 'brittle', cat: 'cocoon', starter: true, stack: true,
    ja: ['脆繭の法則', '繭の耐久−30%'], en: ['Law of Brittle Silk', 'Cocoons have 30% less strength'],
    apply: (m) => { m.cocoonHp *= 0.7; } },
  // --- 変異の武器（その武器を持っているときだけ出る） ---
  { id: 'venom', cat: 'weapon', weapon: 'fire', starter: true, stack: true,
    ja: ['猛毒の法則', 'ヒアリの毒が広がる数+1・効く時間+50%'], en: ['Law of Venom', 'Fire ant poison spreads to +1 more and lasts 50% longer'],
    apply: (m) => { m.poisonSpread += 1; m.poisonMul *= 1.5; } },
  { id: 'pierce', cat: 'weapon', weapon: 'bullet', starter: true, stack: true,
    ja: ['貫通の法則', 'サシハリアリの毒針が貫く数+4'], en: ['Law of Piercing', 'Bullet ant stingers pierce 4 more'],
    apply: (m) => { m.pierce += 4; } },
  { id: 'blast', cat: 'weapon', weapon: 'bomb', starter: true, stack: true,
    ja: ['爆裂の法則', '自爆アリの爆発範囲+40%'], en: ['Law of the Blast', 'Exploding ants: +40% blast radius'],
    apply: (m) => { m.bombRadius *= 1.4; } },
  { id: 'jaw', cat: 'weapon', weapon: 'mandible', starter: true, stack: true,
    ja: ['剛顎の法則', 'アギトアリの顎が届く距離と倒す数+40%'], en: ['Law of the Jaw', 'Trap-jaw reach and kills +40%'],
    apply: (m) => { m.jawMul *= 1.4; } },
  // --- 守り ---
  { id: 'trade', cat: 'guard', starter: true, stack: false,
    ja: ['相殺の法則', 'シロアリとぶつかったとき、失う数が半分'], en: ['Law of Trade', 'Lose only half as many in termite clashes'],
    apply: (m) => { m.clashLoss *= 0.5; } },
  { id: 'carapace', cat: 'guard', starter: false, cost: 35, stack: true,
    ja: ['甲殻の法則', '赤い円・ゴミムシ・−の看板で減る数−30%'], en: ['Law of the Carapace', '30% fewer losses from red circles, beetles and − signs'],
    apply: (m) => { m.dmgTaken *= 0.7; } },
  // --- 巣 ---
  { id: 'siege', cat: 'siege', starter: true, stack: true,
    ja: ['破城の法則', '巣への攻撃+50%'], en: ['Law of the Siege', '+50% damage to the nest'],
    apply: (m) => { m.nestDmg *= 1.5; } },
  // --- 蜜 ---
  { id: 'nectar', cat: 'meta', starter: false, cost: 30, stack: true,
    ja: ['蜜の法則', 'もらえる蜜+50%'], en: ['Law of Nectar', '+50% honey'],
    apply: (m) => { m.honeyMul *= 1.5; } },
];

export const CARD_BY_ID = Object.fromEntries(CARDS.map((c) => [c.id, c]));

/** 取ったカードの一覧（id の配列）から、ランの補正を作り直す */
export function buildMods(cardIds, base = defaultMods()) {
  const m = { ...base };
  for (const id of cardIds) CARD_BY_ID[id]?.apply(m);
  return m;
}

/**
 * 候補を選ぶ（rng は 0〜1 を返す関数。今日のコースは日付から決まる rng を渡す）
 * weapon：いま持っている武器（null なら武器のカードは出さない）。undefined なら武器で絞らない（今日のコース）
 */
export function drawCards(rng, pool, owned, n, weapon) {
  const can = pool.filter((id) => {
    const c = CARD_BY_ID[id];
    if (!c) return false;
    if (!c.stack && owned.includes(id)) return false;
    if (c.weapon && weapon !== undefined && c.weapon !== weapon) return false;
    return true;
  });
  const out = [];
  const bag = can.slice();
  while (out.length < n && bag.length) out.push(bag.splice(Math.floor(rng() * bag.length), 1)[0]);
  return out;
}

export function cardText(id, lang) {
  const c = CARD_BY_ID[id];
  if (!c) return { name: id, desc: '', cat: 'meta' };
  const [name, desc] = lang === 'ja' ? c.ja : c.en;
  return { name, desc, cat: c.cat };
}
