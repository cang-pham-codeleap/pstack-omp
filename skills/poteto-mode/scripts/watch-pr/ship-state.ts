import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type * as T from "./types.ts";
export interface ShipState {
  readonly startedAt: string;
  readonly reviewRounds: number;
  readonly ciFixes: Readonly<Record<string, number>>;
}
export function updateShipState(args: {
  readonly gitDir: string;
  readonly context: T.PrContext;
  readonly increments: readonly string[];
  readonly reset: boolean;
  readonly now: string;
}): ShipState {
  const dir = join(args.gitDir, "pstack-ship");
  const { owner, repo, number } = args.context;
  const file = join(dir, `${owner}-${repo}-${number}.json`);
  if (args.reset) rmSync(file, { force: true });
  const saved: ShipState = existsSync(file)
    ? JSON.parse(readFileSync(file, "utf8"))
    : { startedAt: args.now, reviewRounds: 0, ciFixes: {} };
  let reviewRounds = saved.reviewRounds;
  const ciFixes: Record<string, number> = { ...saved.ciFixes };
  for (const increment of args.increments)
    if (increment === "review") reviewRounds += 1;
    else {
      const check = increment.slice("ci:".length);
      ciFixes[check] = (ciFixes[check] ?? 0) + 1;
    }
  const next = { startedAt: saved.startedAt, reviewRounds, ciFixes };
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, `${JSON.stringify(next)}\n`);
  return next;
}
