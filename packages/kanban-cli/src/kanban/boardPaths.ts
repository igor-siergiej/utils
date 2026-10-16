import { readdirSync } from 'node:fs';
import { join } from 'node:path';

export interface BoardSelection {
    kanban?: string;
    allBoards?: string;
}

export function boardPaths(selection: BoardSelection, usage: string): string[] {
    if (selection.allBoards) {
        return readdirSync(selection.allBoards)
            .filter((name) => name.endsWith('.board.md'))
            .sort()
            .map((name) => join(selection.allBoards as string, name));
    }
    if (selection.kanban) return [selection.kanban];
    throw new Error(usage);
}
