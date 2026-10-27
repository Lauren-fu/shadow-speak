import test from "node:test";
import assert from "node:assert/strict";
import { practiceShortcut } from "../panel-ui.mjs";

const state = { count: 4, selected: 1, recordingIndex: 3, hasTake: index => index === 1 };
test("Space uses the current phrase and always stops the existing recording; H only plays an available take", () => {
  assert.deepEqual(practiceShortcut({ key: " " }, state), { type: "record", index: 1 });
  assert.deepEqual(practiceShortcut({ key: " " }, { ...state, busy: true }), { type: "record", index: 3 });
  assert.deepEqual(practiceShortcut({ key: "H" }, state), { type: "hear", index: 1 });
  assert.equal(practiceShortcut({ key: "h" }, { ...state, selected: 0 }), null);
  assert.equal(practiceShortcut({ key: "h" }, { ...state, busy: true }), null);
});
test("arrows use the existing phrase play action and respect list edges", () => {
  assert.deepEqual(practiceShortcut({ key: "ArrowDown" }, state), { type: "play", index: 2 });
  assert.deepEqual(practiceShortcut({ key: "ArrowUp" }, state), { type: "play", index: 0 });
  assert.equal(practiceShortcut({ key: "ArrowUp" }, { ...state, selected: 0 }), null);
  assert.equal(practiceShortcut({ key: "ArrowDown" }, { ...state, selected: 3 }), null);
});
test("typing, native button interaction, editing, busy work and modified/repeating keys retain their native behavior", () => {
  for (const field of ["input", "textarea", "select", "button", "a", "summary", "contenteditable"]) {
    assert.equal(practiceShortcut({ key: " ", target: { closest: selector => selector.includes(field) } }, state), null);
  }
  for (const flag of ["altKey", "ctrlKey", "metaKey", "shiftKey", "repeat", "defaultPrevented"]) {
    assert.equal(practiceShortcut({ key: " ", [flag]: true }, state), null);
  }
  for (const flag of ["editing", "changing", "loading"]) assert.equal(practiceShortcut({ key: " " }, { ...state, [flag]: true }), null);
  assert.equal(practiceShortcut({ key: " " }, { ...state, count: 0 }), null);
});