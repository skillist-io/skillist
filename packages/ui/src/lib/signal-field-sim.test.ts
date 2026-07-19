import { describe, expect, it } from "vitest";
import {
  type Field,
  MAX_PACKETS,
  NODE_FLASH_MS,
  PACKET_LIFE,
  PACKET_SPEED,
  type Random,
  randomDirection,
  spawnPacket,
  stepField,
} from "./signal-field-sim";

/** Cycles fixed values so a test can pin every random decision. */
function sequence(values: number[]): Random {
  let i = 0;
  return () => values[i++ % values.length] ?? 0;
}

const GRID = { cols: 10, rows: 6 };

function emptyField(): Field {
  return { packets: [], flashes: [] };
}

describe("stepField", () => {
  it("fills the field to capacity and keeps it there", () => {
    const field = stepField(emptyField(), { dtSeconds: 0, now: 0, ...GRID });
    expect(field.packets).toHaveLength(MAX_PACKETS);

    stepField(field, { dtSeconds: 0.016, now: 16, ...GRID });
    expect(field.packets).toHaveLength(MAX_PACKETS);
  });

  it("spawns packets inside the grid", () => {
    for (let i = 0; i < 50; i++) {
      const p = spawnPacket(GRID.cols, GRID.rows, Math.random);
      expect(p.gx).toBeGreaterThanOrEqual(0);
      expect(p.gx).toBeLessThanOrEqual(GRID.cols);
      expect(p.gy).toBeGreaterThanOrEqual(0);
      expect(p.gy).toBeLessThanOrEqual(GRID.rows);
      expect(p.nodesLeft).toBe(PACKET_LIFE);
    }
  });

  it("advances a packet one node at a time and flashes each node it reaches", () => {
    // random() = 0 never exceeds TURN_CHANCE... so force no turn with 0.99.
    const random = sequence([0.99]);
    const field: Field = {
      packets: [{ gx: 0, gy: 0, dir: [1, 0], t: 0, nodesLeft: PACKET_LIFE }],
      flashes: [],
    };
    // Exactly one node of travel.
    stepField(field, { dtSeconds: 1 / PACKET_SPEED, now: 100, ...GRID, random });

    const packet = field.packets[0];
    expect(packet?.gx).toBe(1);
    expect(packet?.gy).toBe(0);
    expect(packet?.nodesLeft).toBe(PACKET_LIFE - 1);
    expect(field.flashes[0]).toEqual({ gx: 1, gy: 0, at: 100 });
  });

  it("retires packets once their life is spent", () => {
    const random = sequence([0.99]);
    const field: Field = {
      packets: [{ gx: 5, gy: 3, dir: [1, 0], t: 0, nodesLeft: 1 }],
      flashes: [],
    };
    stepField(field, { dtSeconds: 1 / PACKET_SPEED, now: 0, ...GRID, random });

    // The spent packet is gone; the field refills, so none of the survivors is
    // the original at its post-step position.
    expect(field.packets).toHaveLength(MAX_PACKETS);
    expect(field.packets.some((p) => p.nodesLeft === 0)).toBe(false);
  });

  it("turns a packet that walks off the grid rather than letting it escape", () => {
    // 0.99 would normally mean "do not turn", so a turn here proves the
    // off-grid branch fired.
    const random = sequence([0.99]);
    const field: Field = {
      packets: [{ gx: GRID.cols, gy: 2, dir: [1, 0], t: 0, nodesLeft: PACKET_LIFE }],
      flashes: [],
    };
    stepField(field, { dtSeconds: 1 / PACKET_SPEED, now: 0, ...GRID, random });

    const packet = field.packets.find((p) => p.gx === GRID.cols + 1);
    expect(packet).toBeDefined();
    expect(packet?.dir).not.toEqual([1, 0]);
  });

  it("never reverses a packet into the node it just left", () => {
    for (const dir of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      for (let i = 0; i < 40; i++) {
        const next = randomDirection(Math.random, dir);
        expect(next).not.toEqual([-dir[0], -dir[1]]);
      }
    }
  });

  it("drops flashes once they have finished cooling", () => {
    const field: Field = {
      packets: [],
      flashes: [
        { gx: 1, gy: 1, at: 0 },
        { gx: 2, gy: 2, at: 900 },
      ],
    };
    stepField(field, { dtSeconds: 0, now: 1000, ...GRID });

    expect(field.flashes).toEqual([{ gx: 2, gy: 2, at: 900 }]);
    expect(1000 - 0).toBeGreaterThan(NODE_FLASH_MS);
  });

  it("does not run away when a large dt arrives", () => {
    const field = stepField(emptyField(), { dtSeconds: 0, now: 0, ...GRID });
    // The render loop clamps dt to 50ms; at that step a packet crosses well
    // under one node, so nothing can teleport across the grid in a frame.
    const before = field.packets.map((p) => ({ ...p }));
    stepField(field, { dtSeconds: 0.05, now: 50, ...GRID });

    for (const [i, packet] of field.packets.entries()) {
      const prev = before[i];
      if (!prev) continue;
      expect(Math.abs(packet.gx - prev.gx) + Math.abs(packet.gy - prev.gy)).toBeLessThanOrEqual(1);
    }
  });
});
