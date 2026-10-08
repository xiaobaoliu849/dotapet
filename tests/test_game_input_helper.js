import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { GameInputHelper } from '../src/main/gameInput.js';

function fixture() {
  const children = [];
  const helper = new GameInputHelper({ platform: 'win32', spawnFn: (_command, _args, options) => {
    assert.equal(options.windowsHide, true);
    const child = new EventEmitter();
    child.stdin = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.requests = []; child.stdin.write = text => child.requests.push(JSON.parse(text));
    child.kills = 0; child.kill = () => { child.kills++; };
    child.reply = value => child.stdout.emit('data', Buffer.from(JSON.stringify({ id: child.requests.at(-1).id, ok: true, value }) + '\n'));
    children.push(child); return child;
  } });
  return { helper, children };
}

test('late events from a retired helper cannot reject requests in its replacement', async t => {
  const { helper, children } = fixture(); t.after(() => helper.dispose());
  const first = helper.foregroundProcessName(); children[0].reply('chrome'); await first;
  helper.dispose();
  const second = helper.foregroundProcessName();
  const accepted = assert.doesNotReject(second);
  children[0].emit('exit', 1);
  children[0].stdin.emit('error', new Error('old EPIPE'));
  children[0].stdout.emit('data', Buffer.from('{bad old chunk'));
  children[1].reply('dota2'); await accepted;
  assert.equal(helper.child, children[1]); assert.equal(children[1].kills, 0);
});

test('a timed out helper is terminated and a later request can recover', async t => {
  const { helper, children } = fixture(); t.after(() => helper.dispose());
  await assert.rejects(helper.foregroundProcessName({ timeoutMs: 10 }), /超时/);
  assert.equal(children[0].kills, 1);
  const next = helper.foregroundProcessName();
  assert.equal(children.length, 2); children[1].reply('dota2');
  assert.equal(await next, 'dota2');
});

test('JSON responses split inside UTF-8 characters retain their original text', async t => {
  const { helper, children } = fixture(); t.after(() => helper.dispose());
  const result = helper.foregroundProcessName(); const child = children[0];
  const bytes = Buffer.from(JSON.stringify({ id: child.requests[0].id, ok: true, value: '中文进程' }) + '\n');
  const split = bytes.indexOf(Buffer.from('中')) + 1;
  child.stdout.emit('data', bytes.subarray(0, split)); child.stdout.emit('data', bytes.subarray(split));
  assert.equal(await result, '中文进程');
});
