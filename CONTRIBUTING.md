# コントリビューション

IssueやPull Requestを歓迎します。大きな仕様変更は、実装前にIssueで相談してください。

## 開発環境

- Node.js LTS
- Rust stable
- Windowsビルド時はVisual Studio 2022 C++ Build Tools

```powershell
npm ci
npm test
cargo test --locked --manifest-path src-tauri/Cargo.toml
npm run tauri -- build --no-bundle
```

## Pull Request

- 変更理由と確認手順を記載してください。
- 表示や操作を変える場合は、必要に応じてスクリーンショットを添付してください。
- 利用者の`state.json`、ログ、秘密情報、個人情報をコミットしないでください。
- AION2やNCSOFTの公式画像、ロゴ、音声など、再配布権限が不明な素材を追加しないでください。
- 新しい外部通信や依存パッケージを追加する場合は、目的と送信データを明記してください。

提出された変更は、このリポジトリのMIT Licenseで公開されることに同意したものとして扱います。
