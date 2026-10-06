import assert from "node:assert/strict";
import test from "node:test";
import { exactFinishPath, fieldByNumber, fields, fieldGridPosition, movementConnections } from "../lib/game-data.ts";

test("the board contains one independent configuration for every field", () => {
  assert.equal(fields.length, 100);
  assert.deepEqual(fields.map((field) => field.fieldNumber), Array.from({ length: 100 }, (_, index) => index + 1));
});

test("the serpentine grid changes direction on every row", () => {
  assert.deepEqual(fieldGridPosition(1), { column: 0, rowFromTop: 9 });
  assert.deepEqual(fieldGridPosition(10), { column: 9, rowFromTop: 9 });
  assert.deepEqual(fieldGridPosition(11), { column: 9, rowFromTop: 8 });
  assert.deepEqual(fieldGridPosition(20), { column: 0, rowFromTop: 8 });
  assert.deepEqual(fieldGridPosition(91), { column: 9, rowFromTop: 0 });
  assert.deepEqual(fieldGridPosition(100), { column: 0, rowFromTop: 0 });
});

test("all movement fields from the original instructions are configured", () => {
  const expected = new Map([[3,1],[5,24],[7,8],[11,6],[15,16],[20,21],[22,38],[29,31],[47,67],[49,18],[51,69],[58,44],[60,81],[77,46],[84,97],[87,86],[93,79]]);
  assert.equal(movementConnections.length, expected.size);
  for (const [from, to] of expected) assert.equal(fieldByNumber[from].targetField, to);
});

test("special mechanics and the exact goal rule are represented", () => {
  assert.equal(fieldByNumber[25].skipTurns, 1);
  assert.equal(fieldByNumber[34].extraRoll, true);
  assert.equal(fieldByNumber[65].actionType, "leaderBack");
  assert.equal(fieldByNumber[89].nextRollMultiplier, 2);
  assert.equal(fieldByNumber[99].actionType, "swapNearest");
  assert.equal(fieldByNumber[100].actionType, "goal");
  assert.deepEqual(exactFinishPath(97, 2), [98, 99]);
  assert.deepEqual(exactFinishPath(97, 3), [98, 99, 100]);
  assert.deepEqual(exactFinishPath(97, 5), [98, 99, 100, 99, 98]);
});
