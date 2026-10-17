import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { App } from './App.tsx';

test('the example starts at login without requesting data or exposing an authenticated board', () => {
  const unexpected = async () => { throw new Error('Rendering must not call the API'); };
  const html = renderToStaticMarkup(<App api={{ login: unexpected, logout: unexpected, list: unexpected,
    listBoards: unexpected, createBoard: unexpected, create: unexpected, update: unexpected }} />);
  assert.match(html, /<h1>Message board<\/h1>/);
  assert.match(html, /id="login-panel"/);
  assert.match(html, /<label[^>]*for="login-user"/);
  assert.match(html, /value="alice" selected="">Alice/);
  assert.match(html, /value="bob">Bob/);
  assert.match(html, /type="submit">Log in/);
  assert.doesNotMatch(html, /id="board-panel"|id="session-controls"|type="password"/);
});
