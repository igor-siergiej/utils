import { readFileSync, writeFileSync } from 'node:fs';
import { parseKanbanFile } from './parser';
import { serializeKanbanBoard } from './serializer';
import type { KanbanBoard } from './types';

export function readKanbanBoard(path: string): KanbanBoard {
    return parseKanbanFile(readFileSync(path, 'utf8'));
}

export function writeKanbanBoard(path: string, board: KanbanBoard): void {
    writeFileSync(path, serializeKanbanBoard(board));
}
