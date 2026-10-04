# ARMY ANTS（アーミーアンツ、仮題）

アリの群れを左右に動かして数字のゲートで仲間を増やし、実在のアリの能力で「変異」しながら
敵の虫と巣を倒す、スマホ向けのブラウザゲーム（Tanuki Box・開発中）。

- 指示書：[docs/instructions.md](docs/instructions.md)
- いまの段階：**フェーズ1「見た目の試作」**（ゲームのルールはまだ無い）
- 試作ページ：https://tanukibox.github.io/army-ants/prototype/

## フォルダの中身

| 場所 | 中身 |
|---|---|
| `prototype/` | フェーズ1の試作ページ（変異の種類・Lv・匹数・拡大を切り替えて見比べる） |
| `js/core/` | 画面・群れ・地面・エフェクト・操作の部品（フェーズ2のゲーム本体でも使う） |
| `assets/sprites/` | ゲームで使うドット絵（`art/build.py` が自動で作る。手で描きかえない） |
| `art/` | Blender の3Dモデル → ドット絵の仕組み。作り方は [art/README.md](art/README.md) |
| `art/blend/` | Blender で開ける見本ファイル（アリ6種・地面） |
| `vendor/` | 描画ライブラリ PixiJS 8.22.0（MIT ライセンス、`PIXI-LICENSE.txt`） |

## PC で試作を動かす

WebGL で画像を読むため、ファイルをダブルクリックでは開けません。このフォルダで次を実行し、
ブラウザで http://localhost:8123/prototype/ を開きます（止めるときは Ctrl+C）。

```
python -m http.server 8123
```

操作：画面をドラッグ（どこを触ってもよい）、またはキーボードの ← → で群れが左右に動きます。
