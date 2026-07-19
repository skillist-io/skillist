/**
 * The packet simulation behind <SignalField>, kept separate from the rendering
 * so it can be reasoned about — and tested — without a canvas or a browser.
 *
 * Packets walk a grid of nodes. Each holds the node it last left, a direction,
 * and progress toward the next one; when progress passes a node it snaps there,
 * records a flash, spends a life, and may turn. Everything is in grid
 * coordinates; the renderer multiplies by the cell size.
 */

export const MAX_PACKETS = 3;
/** Grid nodes traversed per second. */
export const PACKET_SPEED = 3.2;
/** Nodes a packet crosses before it fades out. */
export const PACKET_LIFE = 14;
/** Odds a packet turns rather than continuing straight through a node. */
export const TURN_CHANCE = 0.28;
export const NODE_FLASH_MS = 700;

export type Direction = readonly [number, number];
const EAST: Direction = [1, 0];
export const DIRECTIONS: readonly Direction[] = [EAST, [-1, 0], [0, 1], [0, -1]];

export type Packet = {
  /** Node the packet is leaving, in grid coordinates. */
  gx: number;
  gy: number;
  dir: Direction;
  /** Progress toward the next node, 0..1. */
  t: number;
  nodesLeft: number;
};

export type Flash = { gx: number; gy: number; at: number };

export type Field = { packets: Packet[]; flashes: Flash[] };

/** Injectable so tests can drive the simulation deterministically. */
export type Random = () => number;

export function randomDirection(random: Random, exclude?: Direction): Direction {
  const options = exclude
    ? // Never reverse into the node just left — a packet that doubles back
      // reads as a glitch rather than as propagation.
      DIRECTIONS.filter((d) => !(d[0] === -exclude[0] && d[1] === -exclude[1]))
    : DIRECTIONS;
  return options[Math.floor(random() * options.length)] ?? EAST;
}

export function spawnPacket(cols: number, rows: number, random: Random): Packet {
  return {
    gx: Math.floor(random() * (cols + 1)),
    gy: Math.floor(random() * (rows + 1)),
    dir: randomDirection(random),
    t: 0,
    nodesLeft: PACKET_LIFE,
  };
}

/**
 * Advances every packet by `dtSeconds`, retires the spent ones, refills the
 * field, and drops flashes that have finished cooling. Mutates and returns the
 * field so the render loop allocates nothing per frame.
 */
export function stepField(
  field: Field,
  {
    dtSeconds,
    now,
    cols,
    rows,
    random = Math.random,
  }: {
    dtSeconds: number;
    now: number;
    cols: number;
    rows: number;
    random?: Random;
  },
): Field {
  for (const packet of field.packets) {
    packet.t += dtSeconds * PACKET_SPEED;
    while (packet.t >= 1) {
      packet.t -= 1;
      packet.gx += packet.dir[0];
      packet.gy += packet.dir[1];
      packet.nodesLeft -= 1;
      field.flashes.push({ gx: packet.gx, gy: packet.gy, at: now });
      const offGrid = packet.gx < 0 || packet.gy < 0 || packet.gx > cols || packet.gy > rows;
      // Turning at the edge is what keeps packets on screen without a hard
      // wall; they read as being routed onward rather than bouncing.
      if (offGrid || random() < TURN_CHANCE) {
        packet.dir = randomDirection(random, packet.dir);
      }
    }
  }

  field.packets = field.packets.filter(
    (p) => p.nodesLeft > 0 && p.gx >= -2 && p.gy >= -2 && p.gx <= cols + 2 && p.gy <= rows + 2,
  );
  while (field.packets.length < MAX_PACKETS) {
    field.packets.push(spawnPacket(cols, rows, random));
  }
  field.flashes = field.flashes.filter((f) => now - f.at < NODE_FLASH_MS);
  return field;
}
