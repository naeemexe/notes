import { useSyncExternalStore } from 'react';

export type InkTool = 'pen' | 'highlighter' | 'eraser' | 'lasso';
export type Tool = 'type' | InkTool;

export type ToolState = {
  tool: Tool;
  /** what Apple Pencil uses while Type is selected (never the lasso) */
  lastInk: Exclude<InkTool, 'lasso'>;
  penColor: string;
  penSize: number;
  hlColor: string;
  hlSize: number;
  /** let a finger draw too (off by default: finger scrolls) */
  fingerDraw: boolean;
};

export const PEN_COLORS = ['#1f1f1f', '#2563eb', '#dc2626', '#16a34a', '#9333ea', '#ea580c'];
export const HL_COLORS = ['#fde047', '#86efac', '#93c5fd', '#f9a8d4', '#fdba74'];
export const PEN_SIZES = [2.5, 4, 7];
export const HL_SIZES = [14, 22, 32];

const KEY = 'notes.tools';
const defaults: ToolState = {
  tool: 'type',
  lastInk: 'pen',
  penColor: PEN_COLORS[0],
  penSize: PEN_SIZES[0],
  hlColor: HL_COLORS[0],
  hlSize: HL_SIZES[1],
  fingerDraw: false,
};

let state: ToolState = defaults;
try {
  state = { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
} catch { /* ignore */ }

const listeners = new Set<() => void>();

export function getTools() {
  return state;
}

export function setTools(patch: Partial<ToolState>) {
  state = { ...state, ...patch };
  if (patch.tool && patch.tool !== 'type' && patch.tool !== 'lasso') state.lastInk = patch.tool;
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ }
  listeners.forEach((l) => l());
}

export function useTools() {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    getTools,
  );
}

/** Which ink tool (if any) a pointer of this type should use right now. */
export function inkToolFor(pointerType: string): InkTool | null {
  const s = state;
  if (pointerType === 'pen') return s.tool === 'type' ? s.lastInk : s.tool; // Apple Pencil always inks
  if (s.tool === 'type') return null;
  if (pointerType === 'mouse') return s.tool;
  if (pointerType === 'touch') return s.fingerDraw ? s.tool : null; // finger scrolls by default
  return null;
}
