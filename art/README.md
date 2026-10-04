# ARMY ANTS — 絵の仕組み（Blender → ドット絵）

Oh!Edo Taco Tuesday!! の「Blender の3Dモデルを自動でドット絵にする仕組み」を、アリ用に作り直したものです。
3Dモデルは Python で組み立て、Blender は画面を開かずに裏で動かします。画像生成AIは使っていません。

## 使い方

### 0. 準備（最初の1回だけ）

1. この `art` フォルダをエクスプローラーで開きます。
2. 上のアドレスバーをクリックし、`powershell` と入力して Enter を押します。
3. 必要なライブラリを入れて、環境チェックをします。

   ```
   python -m pip install -r requirements.txt
   python check_env.py
   ```

   `すべてOKです。` と出れば準備完了です。

### 1. 全部の絵を作り直す

```
python build.py
```

1分ほどで、ゲームの素材フォルダ `assets/sprites/` の絵と、Blender の見本 `art/blend/*.blend` が新しくなります。

- アリだけ：`python build.py --only ants`　地面だけ：`python build.py --only ground`
- ドット化だけやり直す（Blender を動かさない）：`python build.py --skip-render`

## できるもの

| ファイル | 内容 |
|---|---|
| `assets/sprites/ants/<種類>.png` | アリのスプライトシート。横 = 歩行8コマ、縦 = 向き8方向（上・右上・右・右下・下・左下・左・左上）。1コマ 44×44 ドット |
| `assets/sprites/ants/<種類>_glow.png` | 同じ並びの「発光用」の画像（目・毒・模様だけ）。ゲームが加算で重ねて光らせる |
| `assets/sprites/ground/soil.png` | 土のタイル（256×256。上下左右にすき間なく並べられる） |
| `assets/sprites/ground/decor.png` | 落ち葉・小石・小枝（64×64 のマス） |
| `assets/sprites/sprites.json` | 上の一覧（ゲームはこれを読む） |
| `art/blend/ant_<種類>.blend` | Blender で開ける見本。Lv1〜3 が並び、再生ボタンで歩く |

`<種類>`：`base`（通常）、`mandible1〜3`（アギトアリ）、`fire1〜3`（ヒアリ）、`bullet1〜3`（サシハリアリ）、
`bomb1〜3`（自爆アリ）、`armor1〜3`（甲殻装甲）

## しくみ

```
python build.py
  ├─ Blender（画面なし）→ blender/render_ants.py
  │    ├─ blender/ant.py     … アリの体（頭・胸・腹・脚・触角）と、変異の部品（顎・毒針・装甲…）
  │    │                       脚は3本ずつ交互に動く8コマの歩行、触角もゆれる
  │    └─ blender/common.py  … 見下ろしカメラ（58度）、塗り分けマテリアル、メッシュの道具
  │    → 8コマ×8方向のアリを1枚にまとめて描く（8倍の大きさ）
  ├─ Blender → blender/render_ground.py（blender/ground.py：土・落ち葉・小石・小枝）
  └─ pipeline/pixelate.py … ドット絵変換
       ├─ 減色：パレット（pipeline/palette.py）の一番近い色へ（OKLab 色空間）
       ├─ 縮小：8×8 点を1ドットに。一番多い色を選ぶ（にじまない）。細い脚も残るよう「何割塗られているか」で判定
       ├─ 輪郭：アリのまわりに 1px の暗い線（群れで重なっても1匹ずつ見分けられる）
       └─ 発光用：光る色のドットだけを別の画像に。色の画像のほうは「消えているときの暗い色」にする
```

- **塗り方**：光の向きで「影・地・明」、奥からの光で「縁」、反射で「つや」の段に塗り分けます（`common.toon_material`）。
  色はパレットの色そのままなので、毎回同じ色になります。
- **明るい色は光る部分だけ**：パレットの `GLOWS`（赤・橙・緑・紫・黄・水色）だけが明るい色です。
- **毎回同じ結果**：乱数は名前から作った固定の種を使います。`assets/sprites/checksums.txt` に全画像の指紋があり、
  作り直して変化がなければ同じ画像です。
- `art/build/` は途中のファイルなので Git には入れていません。

## 困ったとき

- **「Blender が見つかりません」**：Blender を `C:\Program Files\Blender Foundation\` 以外に入れた場合は、
  PowerShell で `$env:BLENDER = "D:\Apps\Blender\blender.exe"` のように場所を教えてから実行してください。
- うまくいかないときは、PowerShell に出た赤い英語のメッセージ（`Error` の行）をそのまま相談してください。
