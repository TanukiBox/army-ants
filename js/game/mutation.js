// 変異：武器枠は1つ（アギトアリ／ヒアリ／サシハリアリ／自爆アリ）、防具枠は1つ（甲殻装甲）。
// 同じ種類を取ると Lv+1（最大3）、別の種類を取ると持ち替えて Lv1 から。

export const MUT_COLOR = {
  mandible: 0xff8a24, fire: 0x5cff3a, bullet: 0xb85cff, bomb: 0xffd420, armor: 0x36dcff,
};
// 群れが光るときの色（ヒアリは腹の赤）
const SWARM_GLOW = { mandible: 0xff8a24, fire: 0xff3a2a, bullet: 0xb85cff, bomb: 0xffd420 };

/** 変異を取る。戻り値：{ kind, lv, switched } */
export function applyMutation(run, mut) {
  if (mut === 'armor') {
    run.armor = Math.min(3, run.armor + 1);
    return { kind: 'armor', lv: run.armor, switched: false };
  }
  if (run.weapon && run.weapon.type === mut) {
    run.weapon.lv = Math.min(3, run.weapon.lv + 1);
    return { kind: mut, lv: run.weapon.lv, switched: false };
  }
  const switched = !!run.weapon;
  run.weapon = { type: mut, lv: 1 };
  return { kind: mut, lv: 1, switched };
}

/** いまの変異の組み合わせ → アリの絵の名前（例：fire2_armor1） */
export function variantName(run) {
  const parts = [];
  if (run.weapon) parts.push(`${run.weapon.type}${run.weapon.lv}`);
  if (run.armor) parts.push(`armor${run.armor}`);
  return parts.join('_') || 'base';
}

/** 群れの光り方（色・脈打つか・強さ） */
export function swarmLook(run) {
  if (run.weapon) {
    return { glowColor: SWARM_GLOW[run.weapon.type], pulse: run.weapon.type === 'bomb' ? 'beat' : 'steady', glowScale: 1 };
  }
  if (run.armor) return { glowColor: 0x36dcff, pulse: 'steady', glowScale: 0.9 };
  return { glowColor: 0xff3a2a, pulse: 'steady', glowScale: 0.5 };
}
