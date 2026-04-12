# PR-Forge

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](LICENSE)

> **Note:** This is a personal experimental workspace. Pull requests and issues from outside are not accepted.
> （注：これは個人的な実験用ワークスペースです。外部からのPRやIssueは受け付けていません。）

## Overview
分散されたタスクの依存関係を整理し、継続的に統合していくための個人的なワークスペース。

巨大な文脈（コンテキスト）を一度に処理する際に生じる「歳差運動（目的軸のブレ）」を防ぐため、システムを状態遷移機械として定義し、最小単位に分割されたタスクを順次 Pull Request として鋳造（Forge）していくことを目的としています。

## Core Concept
- **Context Isolation (文脈の隔離):** タスクの依存関係を事前にグラフ化し、実行時は単一のファイル・単一の目的にのみ焦点を当てる。
- **Sequential Forging (逐次鋳造):** 1つのトリガーに対して1つの出力を返し、それを検証・統合するサイクルを回す。
- **State Management (状態管理):** 計画（Plan）、実行（Execute）、監査（Audit）のフェーズを明確に分離し、バケツリレー方式で処理を進行させる。

## Workflow
1. 要件から依存関係ツリー（Task List）を生成。
2. トリガー（`[EXECUTE: Task_ID]`）を発火。
3. 出力されたコードを対象パスへ配置し、PRを作成。
4. 差分（Diff）を監査し、問題がなければマージ。
5. 次のタスクへ状態を遷移。

---
*Forging the flow, one state at a time.*
