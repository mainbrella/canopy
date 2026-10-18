import * as React from 'react';
import type { Board } from './api.ts';

export function BoardLink({ board, className }: { board: Board; className?: string }) {
  return <a className={className} href={`/boards/${encodeURIComponent(board.slug)}`}>board/{board.slug}</a>;
}
