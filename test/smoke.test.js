import { test } from "node:test";
import assert from "node:assert/strict";

// リポジトリ土台が動くことの最小確認（node --test / ESM）
test("smoke: テストランナーが動く", () => {
  assert.equal(1 + 1, 2);
});
