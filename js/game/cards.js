// 法則カード：ステージの合間に3枚（女王の部屋で4枚に増やせる）から1枚を選ぶ。効果はそのランの間だけ続く。
// 同じカードを何枚も取ると効果が重なる（stack: false のカードは1枚まで）。
// 組み合わせると強くなるように作っている（例：捕食 × 猛毒、増幅 × 成長、群射 × 鋭牙、相殺 × 甲殻）。
//
// mods（ランの間の補正）の初期値は defaultMods()。カードを取るたびに apply(mods) で書きかえる。

export function defaultMods() {
  return {
    mulPlus: 0,        // ×ゲートの倍率に足す
    gateGrow: 1,       // ゲートが育つ速さ（命中1発あたりの力）
    shields: 0,        // −ゲート・÷ゲートを無効にできる回数
    addMul: 1,         // ＋ゲートの値の倍率
    grazeBonus: 0,     // かすり取りしたとき、＋ゲートの値をこの割合だけ追加
    volleyPer10: 0,    // 10匹ごとに弾+1（最大 +8）
    dmgMul: 1,         // 弾の威力
    fireRate: 1,       // 射撃の間かくの倍率（小さいほど速い）
    cocoonHp: 1,       // 繭の耐久の倍率
    cocoonDmg: 1,      // 繭への弾の威力の倍率
    mutateGain: 0,     // 変異したとき群れがこの割合だけ増える
    bombRadius: 1,     // 自爆アリの爆発範囲
    poisonMul: 1,      // ヒアリの毒
    jawMul: 1,         // アギトアリの顎（届く距離・倒す数）
    pierce: 0,         // サシハリアリの毒針が貫く数
    dmgTaken: 1,       // 攻撃を受けたときに減る数の倍率
    clashLoss: 1,      // シロアリと相殺するとき、こちらが失う数の倍率
    predation: 0,      // 敵を倒したとき、倒した数 × この割合だけ群れが増える
    siegeDmg: 1,       // 攻城で巣に与える力
    siegeMulPlus: 0,   // 攻城の動く×ゲートの倍率に足す
    honeyMul: 1,       // もらえる蜜
    rowGain: 0,        // ゲートの並びを通るたびに群れがこの割合だけ増える
    gateCapMul: 1,     // ゲートの上限の倍率
    gateCapSteps: 0,   // ×÷ゲートの上限を何段上げるか
  };
}

// starter: true は最初から使えるカード。false は女王の部屋で蜜を払って解放する（cost）
export const CARDS = [
  // --- ゲート ---
  { id: 'amplify', cat: 'gate', starter: true, stack: true,
    ja: ['増幅の法則', '×ゲートの倍率+1（×2が×3に。数字が金色になる）'], en: ['Law of Amplify', '× gates multiply by +1 more (×2 → ×3, shown in gold)'],
    apply: (m) => { m.mulPlus += 1; } },
  { id: 'growth', cat: 'gate', starter: true, stack: true,
    ja: ['成長の法則', 'ゲートの育ちが2倍速'], en: ['Law of Growth', 'Gates grow twice as fast when shot'],
    apply: (m) => { m.gateGrow *= 2; } },
  { id: 'shield', cat: 'gate', starter: true, stack: true,
    ja: ['盾の法則', '−ゲート・÷ゲートを1回だけ無効にする'], en: ['Law of Shield', 'Cancel one − or ÷ gate'],
    apply: (m) => { m.shields += 1; } },
  { id: 'limit', cat: 'gate', starter: false, cost: 45, stack: true,
    ja: ['限界突破の法則', '撃って育てられる上限+50%（×÷ゲートは+1段）'], en: ['Law of No Limits', 'Shot gates can grow 50% higher (× ÷ +1 step)'],
    apply: (m) => { m.gateCapMul += 0.5; m.gateCapSteps += 1; } },
  { id: 'graze', cat: 'gate', starter: false, cost: 40, stack: true,
    ja: ['かすりの法則', 'かすり取りしたとき、＋ゲートの値が+50%'], en: ['Law of the Graze', 'Grazing adds +50% to the + gate'],
    apply: (m) => { m.grazeBonus += 0.5; } },
  { id: 'vanguard', cat: 'gate', starter: false, cost: 35, stack: true,
    ja: ['先駆けの法則', '＋ゲートの値+30%'], en: ['Law of the Vanguard', '+ gates give +30%'],
    apply: (m) => { m.addMul *= 1.3; } },
  // --- 射撃 ---
  { id: 'volley', cat: 'fire', starter: true, stack: true,
    ja: ['群射の法則', '10匹ごとに弾+1（最大+8）'], en: ['Law of the Volley', '+1 bullet per 10 ants (up to +8)'],
    apply: (m) => { m.volleyPer10 += 1; } },
  { id: 'fang', cat: 'fire', starter: true, stack: true,
    ja: ['鋭牙の法則', '弾の威力+40%'], en: ['Law of the Fang', 'Bullets deal +40% damage'],
    apply: (m) => { m.dmgMul *= 1.4; } },
  { id: 'rapid', cat: 'fire', starter: false, cost: 45, stack: true,
    ja: ['速射の法則', '撃つ間かく−25%'], en: ['Law of Rapid Fire', 'Fire 25% faster'],
    apply: (m) => { m.fireRate *= 0.75; } },
  // --- 繭・変異 ---
  { id: 'brittle', cat: 'cocoon', starter: true, stack: true,
    ja: ['脆繭の法則', '繭の耐久−30%'], en: ['Law of Brittle Silk', 'Cocoons have 30% less strength'],
    apply: (m) => { m.cocoonHp *= 0.7; } },
  { id: 'ripen', cat: 'cocoon', starter: false, cost: 40, stack: true,
    ja: ['熟成の法則', '変異したとき、群れが10%増える'], en: ['Law of Ripening', 'Mutating grows the swarm by 10%'],
    apply: (m) => { m.mutateGain += 0.1; } },
  // --- 変異の武器 ---
  { id: 'blast', cat: 'weapon', starter: true, stack: true,
    ja: ['爆裂の法則', '自爆アリの爆発範囲+50%'], en: ['Law of the Blast', 'Exploding ants: +50% blast radius'],
    apply: (m) => { m.bombRadius *= 1.5; } },
  { id: 'venom', cat: 'weapon', starter: true, stack: true,
    ja: ['猛毒の法則', 'ヒアリの毒が2倍'], en: ['Law of Venom', 'Fire ant poison ×2'],
    apply: (m) => { m.poisonMul *= 2; } },
  { id: 'jaw', cat: 'weapon', starter: true, stack: true,
    ja: ['剛顎の法則', 'アギトアリの顎が届く距離と倒す数+50%'], en: ['Law of the Jaw', 'Trap-jaw reach and kills +50%'],
    apply: (m) => { m.jawMul *= 1.5; } },
  { id: 'pierce', cat: 'weapon', starter: false, cost: 50, stack: true,
    ja: ['貫通の法則', 'サシハリアリの毒針が敵を2つ貫く'], en: ['Law of Piercing', 'Bullet ant stingers pierce 2 enemies'],
    apply: (m) => { m.pierce += 2; } },
  // --- 守り・敵 ---
  { id: 'carapace', cat: 'guard', starter: true, stack: true,
    ja: ['甲殻の法則', '攻撃を受けたときに減る数−20%'], en: ['Law of the Carapace', 'Take 20% fewer losses from attacks'],
    apply: (m) => { m.dmgTaken *= 0.8; } },
  { id: 'trade', cat: 'guard', starter: true, stack: false,
    ja: ['相殺の法則', 'シロアリとぶつかったとき、失う数が半分'], en: ['Law of Trade', 'Lose only half as many in termite clashes'],
    apply: (m) => { m.clashLoss *= 0.5; } },
  { id: 'devour', cat: 'guard', starter: false, cost: 60, stack: true,
    ja: ['捕食の法則', '敵を倒すと、倒した数の20%だけ群れが増える'], en: ['Law of Devouring', 'Gain 20% of the enemies you kill'],
    apply: (m) => { m.predation += 0.2; } },
  // --- 攻城 ---
  { id: 'storm', cat: 'siege', starter: true, stack: true,
    ja: ['突撃の法則', '攻城で巣に与える力+30%'], en: ['Law of Storming', 'Siege: +30% damage to the nest'],
    apply: (m) => { m.siegeDmg *= 1.3; } },
  { id: 'reinforce', cat: 'siege', starter: false, cost: 45, stack: true,
    ja: ['増援の法則', '攻城の動く×ゲートの倍率+1（数字が金色になる）'], en: ['Law of Reinforcement', 'Siege: moving × gates +1 (shown in gold)'],
    apply: (m) => { m.siegeMulPlus += 1; } },
  // --- 蜜 ---
  { id: 'nectar', cat: 'meta', starter: false, cost: 30, stack: true,
    ja: ['蜜の法則', 'もらえる蜜+50%'], en: ['Law of Nectar', '+50% honey'],
    apply: (m) => { m.honeyMul *= 1.5; } },
  { id: 'swarmlaw', cat: 'gate', starter: false, cost: 55, stack: false,
    ja: ['群れの法則', 'ゲートを通るたびに群れが3%増える'], en: ['Law of the Swarm', 'Every gate row grows the swarm by 3%'],
    apply: (m) => { m.rowGain += 0.03; } },
];

export const CARD_BY_ID = Object.fromEntries(CARDS.map((c) => [c.id, c]));

/** 取ったカードの一覧（id の配列）から、ランの補正を作り直す */
export function buildMods(cardIds, base = defaultMods()) {
  const m = { ...base };
  for (const id of cardIds) CARD_BY_ID[id]?.apply(m);
  return m;
}

/** 候補を選ぶ（rng は 0〜1 を返す関数。今日のコースは日付から決まる rng を渡す） */
export function drawCards(rng, pool, owned, n) {
  const can = pool.filter((id) => CARD_BY_ID[id].stack || !owned.includes(id));
  const out = [];
  const bag = can.slice();
  while (out.length < n && bag.length) out.push(bag.splice(Math.floor(rng() * bag.length), 1)[0]);
  return out;
}

export function cardText(id, lang) {
  const c = CARD_BY_ID[id];
  const [name, desc] = lang === 'ja' ? c.ja : c.en;
  return { name, desc, cat: c.cat };
}
