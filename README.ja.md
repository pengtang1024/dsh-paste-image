# dsh-paste-image

[![CI](https://github.com/pengtang1024/dsh-paste-image/actions/workflows/ci.yml/badge.svg)](https://github.com/pengtang1024/dsh-paste-image/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/dsh-paste-image.svg)](https://www.npmjs.com/package/dsh-paste-image)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](package.json)

[简体中文](README.md) · [English](README.en.md) · [日本語](README.ja.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Русский](README.ru.md) · [Português](README.pt.md)

DeepSeek Harness には、ほぼどんな画像でも貼り付けたりドロップしたりできます。クリップボードが `image/xpm` と言っていても、MIME タイプを偽っていても構いません。

## なぜこれが必要か

DSH デスクトップクライアント（Electron/Chromium）が受け付ける添付タイプは、`image/png`、`image/jpeg`、`image/webp`、`image/gif` の 4 つだけです。それ以外はすべて、PNG、JPG、WebP、GIF だけを列挙した赤いエラーで拒否されます。

このホワイトリストによって、Linux で日常的に起こる 2 つのケースが壊れます。

- **XPM と宣言されたスクリーンショット。** Ubuntu/Wayland など一部のスクリーンショットツールは、画像を `image/xpm` というタイプでクリップボードに置きます。ピクセルデータ自体は正常ですが、ラベルがホワイトリストにないため貼り付けが拒否されます。
- **PNG のラベルをかぶった BMP のバイト列。** 一部のアプリケーションは `image/png` と宣言しながら、実際には BMP（または TIFF）のペイロードを渡します。宣言されたタイプはホワイトリスト検査を通りますが、その後のデコーダーで失敗し、同じ赤いエラーになります。

`dsh-paste-image` はこうした 2 つのケースをレンダラー内で処理します。実際のバイト列を調べ、クリップボードに本当に入っているものをデコードし、PNG として再エンコードして、通常の添付チャネルに戻します。

## 仕組み

1. **キャプチャ。** `install()` は `document` に `paste` と `drop` のリスナーをキャプチャフェーズで登録するため、プラグインはコンポーザーより先にイベントを捕捉します。
2. **判定（スニッフ）。** `handle()` は `clipboardData` または `dataTransfer` から `File` オブジェクトを読み取り、`sniff()` が宣言された MIME タイプではなくマジックバイトから実際の形式を特定します。
3. **再エンコード。** `normalize()` はネイティブ形式のファイルをそのまま通します。それ以外はすべてデコードし（XPM、BMP/DIB、SVG は専用の経路、残りはブラウザ自身のコーデック）、長辺 4096 px に制限した canvas に描画して、`.png` というファイル名で `image/png` として書き出します。
4. **再ルーティング。** `handle()` は新しい `File` を載せた合成 `drop` イベントを `[data-composer-card]` に対してディスパッチします。これは実際のドラッグ＆ドロップと同じ経路です。`__dshPasteImageRerouted` マーカーにより、プラグインが自分自身のイベントを横取りするのを防ぎます。

これらはすべてクライアント側で完結します。ホストプロセスも、クリップボードのポーリングも、ネットワークリクエストもありません。

## 対応フォーマット

この表は簡易版です。[フォーマット対応リファレンス](docs/en/formats.md) では、判定パイプライン、BMP バリアントの全一覧、意図的に対象外としている範囲を説明しています。

| 形式                            | 宣言される代表的なタイプ | 動作                                                                                                                                         |
| ------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| PNG                             | `image/png`              | そのまま通過                                                                                                                                 |
| JPEG / JFIF                     | `image/jpeg`             | そのまま通過                                                                                                                                 |
| WebP                            | `image/webp`             | そのまま通過                                                                                                                                 |
| GIF                             | `image/gif`              | そのまま通過                                                                                                                                 |
| XPM（XPM3 テキスト）            | `image/xpm`              | `decodeXpm()` でデコードし、PNG として再エンコード                                                                                           |
| BMP / DIB                       | `image/bmp`              | まずブラウザでデコードし、失敗時は `decodeBmp()` にフォールバック: 1/4/8/16/24/32-bit、RLE4/RLE8、BITFIELDS、OS/2 ヘッダー、ヘッダーなし DIB |
| SVG                             | `image/svg+xml`          | `<img>` 要素経由でラスタライズし、PNG として再エンコード                                                                                     |
| ICO / CUR                       | `image/x-icon`           | まずブラウザでデコードし、失敗時は最大の PNG 圧縮エントリにフォールバック                                                                    |
| TIFF                            | `image/tiff`             | マジックバイトで検出。ブラウザが TIFF コーデックを搭載している場合のみデコードし（Chromium にはない）、それ以外は元ファイルをそのまま通す    |
| AVIF                            | `image/avif`             | Chromium がデコードし、PNG として再エンコード                                                                                                |
| HEIC / HEIF、その他の `image/*` | `image/...`              | マジックバイトで検出。ブラウザがコーデックを持つ場合のみデコードし（Chromium は HEIC をデコードしない）、それ以外はそのまま通す              |

そのまま通過するのは、マジックバイトが 4 つのネイティブタイプのいずれかと一致し、**かつ**宣言されたタイプも一致している場合だけです。バイト列は JPEG なのに `image/png` と名乗るファイルは本物の PNG として再エンコードされるため、宣言されたタイプが嘘をつくことはもうできません。宣言タイプがまったくないネイティブファイルは再エンコードせず、判定したタイプでラップし直します。また、一般的な別名表記（`image/jpg`、`image/x-png`、`image/x-bmp`、`image/x-xpixmap`、`image/svg+xml`、…）も一致とみなします。

ファイルが処理対象になるのは、MIME タイプが `image/` で始まるか、ファイル名が `.png`、`.jpg`、`.jpeg`、`.jfif`、`.gif`、`.webp`、`.bmp`、`.dib`、`.tif`、`.tiff`、`.xpm`、`.avif`、`.ico`、`.cur`、`.svg`、`.heic`、`.heif` のいずれかで終わる場合です。同じ貼り付けに含まれる画像以外のファイルは、そのまま転送されます。

## インストール

```bash
dsh plugin --profile <profile> add dsh-paste-image
```

パッケージはビルド済みで配布されます（レンダラーバンドル、ホストエントリ、ローダーパッチ、表示メタデータ、ドキュメント）。そのためインストールは npm レジストリから直接取得します。

```bash
dsh plugin --profile <profile> add github:pengtang1024/dsh-paste-image
```

ローカル開発では、プロファイルを自分のチェックアウト先に向けます。

```bash
dsh plugin --profile <profile> add file:/absolute/path/to/dsh-paste-image
```

`<profile>` はアプリが実行しているプロファイルに置き換えてください。**インストール後はページを再読み込みしてください**（`Ctrl+R`、macOS では `Cmd+R`）。クライアントモジュールはレンダラーの読み込み時にしか注入されないため、インストール直後のプラグインは再読み込みするまで何も横取りしません。

## 動作確認

リポジトリのチェックを実行します。

```bash
cd dsh-paste-image
npm test
npm run check
```

`npm test` は Node のテストスイートを実行します。マジックバイトの判定、候補の検出、すべての BMP バリアント、BMP を PNG と偽ったケースの変換、ヘッダーなし DIB、ネイティブ形式のそのまま通過、各言語向けに同梱された表示メタデータを検証します。`npm run check` は `client.js` と `lib/index.js` の構文をチェックします。

次に実際のフローを確認します。

1. DSH のウィンドウを再読み込みします。
2. いつも使っているツールでスクリーンショットを撮り、コンポーザーに貼り付けるか、画像ファイルをドロップします。
3. 添付が表示されます。DevTools（`Ctrl+Shift+I`）→ Console を開き、レベルを **Verbose** に切り替えて、次のような行を探します。

```text
[dsh-paste-image] image/xpm -> image/png 1440x900
```

変換に失敗した場合、プラグインは元のファイルを保持し、代わりに `keep original (...)` をログに出します。

## 制限事項

- **XPM:** XPM3 テキスト形式のみ。パーサーは `c` カラーキーを読み、`m`、`g`、`s` などの他のキーは無視します。色はブラウザの CSS パーサーで解決されるため、`light gray` のような複数語の名前など、有効な CSS 色でないパレット名は不透明な黒にフォールバックします。
- **BMP:** 1/4/8/16/24/32-bit、`BI_RGB`、`BI_RLE8`、`BI_RLE4`、`BI_BITFIELDS`、`BI_ALPHABITFIELDS` に対応し、core、extended、V4/V5、OS/2 の各ヘッダーに加えてヘッダーなし DIB も扱います。2-bit と 64-bit-per-pixel のバリアントには対応していません。アルファマスクが宣言されていない 32-bit ファイルでは、アルファチャネルがすべて 0 の場合、完全に透明な PNG を生成するのではなく不透明として扱います。
- **その他のコーデック:** SVG は自前でラスタライズし、ICO/CUR は PNG 圧縮エントリにフォールバックし、AVIF はブラウザのデコーダーに依存します。TIFF と HEIC は検出しますが、Chromium にはコーデックがないため元ファイルをそのまま通し、ホスト側で従来どおり拒否されます。サードパーティ製デコーダーは同梱していません。
- **サイズ:** 変換後の画像は長辺 4096 px 以下に縮小されます。そのまま通すネイティブファイルはリサイズされません。
- **ファイル数:** 1 回の貼り付けまたはドロップに含められるのは最大 8 ファイルです。それを超えるバッチは完全にネイティブ経路に任されます。
- **フラット化:** 変換された画像は 1 枚の PNG フレームになります。アニメーション、EXIF メタデータ、埋め込みカラープロファイルは保持されません。
- **対象範囲:** `paste` と `drop` の経路のみを対象とします。ファイルピッカーやその他の挿入経路はネイティブの挙動のままです。

## セキュリティとプライバシー

- すべてレンダラー内で動作します。プラグインはネットワークリクエストを送らず、何もアップロードせず、何も保存しません。
- バックグラウンドプロセスも、クリップボードのポーリングも、DSH のホストコードへの変更もありません。
- 画像のバイト列は貼り付けまたはドロップのイベントからのみ読み取り、ローカルでデコードして、同じウィンドウに戻します。
- デコーダーは小規模ですが、信頼できない入力を処理します。クラッシュやパースのバグを見つけた場合は [SECURITY.md](SECURITY.en.md) を参照してください。

## 言語

プラグインは、DSH インターフェースが対応するすべての言語（英語、簡体字中国語、日本語、スペイン語、フランス語、ドイツ語、ロシア語、ポルトガル語）の表示メタデータを同梱しています。各 `locale/<language>.json` はローカライズされたタイトルと説明を持ち、詳細ページをこのリポジトリの対応する README に向けているため、Plugin Manager とその詳細ページもアプリと同じ言語で表示されます。

翻訳は生成されたテキストではなく、コードの隣にあるソースファイルです。テストスイートは、告知しているすべての言語について、ロケールファイル、詳細ドキュメント、他の README へのリンクが揃っているかを検証します。翻訳の修正や追加については [コントリビューション](CONTRIBUTING.en.md#translations) を参照してください。

## ドキュメント

- [仕組み](docs/en/how-it-works.md) — イベントフロー、デコーダーの内部、関数ごとのコードマップ。
- [フォーマット対応](docs/en/formats.md) — 判定パイプライン、フォーマットマトリクス、BMP バリアント、フォーマット追加時のチェックリスト。
- [トラブルシューティング](docs/en/troubleshooting.md) — よくある失敗とログの読み方。
- [リリース](docs/en/releasing.md) — バージョンポリシーとメンテナー向けリリースチェックリスト。

## コミュニティ

- [コントリビューション](CONTRIBUTING.en.md) — セットアップ、テスト、スタイル、翻訳、フォーマット貢献に必要なもの。
- [行動規範](CODE_OF_CONDUCT.md) — Contributor Covenant 2.1。
- [セキュリティポリシー](SECURITY.en.md) — 非公開での報告、対象範囲、サポート対象バージョン。
- [変更履歴](CHANGELOG.en.md) と [リリース](https://github.com/pengtang1024/dsh-paste-image/releases) — 何が変わったのか、その理由。
- [Issues](https://github.com/pengtang1024/dsh-paste-image/issues) — バグ報告とフォーマットのリクエスト。

## ライセンス

MIT © 2026 pengtang1024。[LICENSE](LICENSE) を参照してください。
