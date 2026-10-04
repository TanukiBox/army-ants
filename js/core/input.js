// 操作：指を置いた位置からの相対ドラッグで、群れを左右に動かす（画面のどこを触ってもよい）。
// PC ではマウスのドラッグと、キーボードの左右キー（A / D も可）。
// 指を離しても群れは止まらず、その位置のまま前進を続ける。

export class DragInput {
  /**
   * @param el      触る対象の要素（キャンバスの入れ物）
   * @param getX    いまの目標位置（ドット）を返す関数
   * @param setX    目標位置（ドット）を決める関数
   * @param dotsPerCss  画面の CSS 1px が何ドットか（拡大率で変わる）を返す関数
   */
  constructor(el, { getX, setX, dotsPerCss, keySpeed = 170 }) {
    this.getX = getX;
    this.setX = setX;
    this.dotsPerCss = dotsPerCss;
    this.keySpeed = keySpeed;
    this.pointer = null;
    this.keys = new Set();
    el.style.touchAction = 'none';
    this.onPoint = null;   // 攻城：指の位置そのものを使う (clientX, clientY)
    el.addEventListener('pointerdown', (e) => {
      this.onPoint?.(e.clientX, e.clientY);
      if (this.pointer !== null) return;
      this.pointer = e.pointerId;
      this.startX = e.clientX;
      this.startTarget = this.getX();
      el.setPointerCapture?.(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.pointer) return;
      this.onPoint?.(e.clientX, e.clientY);
      this.setX(this.startTarget + (e.clientX - this.startX) * this.dotsPerCss() * 1.1);
    });
    const end = (e) => { if (e.pointerId === this.pointer) this.pointer = null; };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    window.addEventListener('keydown', (e) => {
      if (['ArrowLeft', 'ArrowRight', 'a', 'd', 'A', 'D'].includes(e.key)) { this.keys.add(e.key.toLowerCase()); e.preventDefault(); }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  }

  /** 左右キーの向き（-1, 0, 1） */
  keyDir() {
    let dir = 0;
    if (this.keys.has('arrowleft') || this.keys.has('a')) dir -= 1;
    if (this.keys.has('arrowright') || this.keys.has('d')) dir += 1;
    return dir;
  }

  update(dt) {
    if (this.onPoint) return;
    let dir = 0;
    if (this.keys.has('arrowleft') || this.keys.has('a')) dir -= 1;
    if (this.keys.has('arrowright') || this.keys.has('d')) dir += 1;
    if (dir) this.setX(this.getX() + dir * this.keySpeed * dt);
  }
}
