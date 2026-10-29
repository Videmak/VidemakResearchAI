/**
 * Spec-compliant fallbacks for built-ins the editor stack calls on hot paths.
 *
 * - Tiptap 3 calls Array.prototype.findLast() on every transaction
 *   (Chrome < 97, Safari < 15.4 throw on every keystroke).
 * - BlockNote's HTML serializer (copy, cut, drag, export) calls
 *   Array.prototype.toReversed() (Chrome < 110, Safari < 16 / iOS 15);
 *   analytics recorded "t.marks.toReversed is not a function" on /ai-editor.
 * - The editor and its realtime provider create ids with crypto.randomUUID()
 *   (Safari < 15.4), including once per local CRDT update.
 *
 * Each fallback is installed only when the browser lacks it, as a
 * non-enumerable property, so modern browsers are unaffected.
 */

function defineMissing(target: object, name: string, value: unknown) {
  if (name in target) {
    return;
  }

  Object.defineProperty(target, name, {
    value,
    writable: true,
    configurable: true,
    enumerable: false,
  });
}

function lengthOf(list: { length?: unknown }): number {
  const length = Math.trunc(Number(list.length));
  if (!Number.isFinite(length) || length <= 0) {
    return 0;
  }
  return Math.min(length, Number.MAX_SAFE_INTEGER);
}

function assertCallable(value: unknown, method: string) {
  if (typeof value !== 'function') {
    throw new TypeError(`Array.prototype.${method} callback must be a function`);
  }
}

type Predicate = (value: unknown, index: number, list: unknown) => unknown;

defineMissing(Array.prototype, 'findLast', function findLast(this: unknown, predicate: Predicate, thisArg?: unknown) {
  assertCallable(predicate, 'findLast');
  const list = Object(this) as ArrayLike<unknown>;
  for (let index = lengthOf(list) - 1; index >= 0; index -= 1) {
    const value = list[index];
    if (predicate.call(thisArg, value, index, list)) {
      return value;
    }
  }
  return undefined;
});

defineMissing(
  Array.prototype,
  'findLastIndex',
  function findLastIndex(this: unknown, predicate: Predicate, thisArg?: unknown) {
    assertCallable(predicate, 'findLastIndex');
    const list = Object(this) as ArrayLike<unknown>;
    for (let index = lengthOf(list) - 1; index >= 0; index -= 1) {
      if (predicate.call(thisArg, list[index], index, list)) {
        return index;
      }
    }
    return -1;
  },
);

defineMissing(Array.prototype, 'toReversed', function toReversed(this: unknown) {
  const list = Object(this) as ArrayLike<unknown>;
  const length = lengthOf(list);
  const result = new Array(length);
  for (let index = 0; index < length; index += 1) {
    result[index] = list[length - 1 - index];
  }
  return result;
});

if (
  typeof globalThis.crypto !== 'undefined' &&
  typeof globalThis.crypto.getRandomValues === 'function'
) {
  defineMissing(globalThis.crypto, 'randomUUID', function randomUUID() {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    // RFC 4122 version 4 / variant 1 bits.
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  });
}

export {};
