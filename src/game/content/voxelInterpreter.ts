import type { VoxelCell } from '../voxelTypes';
import type { VoxelCommandJSON } from './schema';

function hexToInt(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

export function interpretVoxelCommands(
  commands: VoxelCommandJSON[],
  palette: Record<string, string>
): VoxelCell[] {
  const m = new Map<string, VoxelCell>();

  function put(gx: number, gy: number, gz: number, color: number, zone: VoxelCell['zone'], tags?: string[]) {
    m.set(`${gx},${gy},${gz}`, { gx, gy, gz, color, zone, tags });
  }

  for (const cmd of commands) {
    const colorHex = palette[cmd.color] ?? cmd.color;
    const color = hexToInt(colorHex);
    const { op, x0, y0, z0, x1, y1, z1, zone, tags } = cmd;

    if (op === 'solid') {
      for (let x = x0; x <= x1; x++)
        for (let y = y0; y <= y1; y++)
          for (let z = z0; z <= z1; z++)
            put(x, y, z, color, zone, tags);
    } else {
      for (let x = x0; x <= x1; x++)
        for (let y = y0; y <= y1; y++)
          for (let z = z0; z <= z1; z++)
            if (x === x0 || x === x1 || y === y0 || y === y1 || z === z0 || z === z1)
              put(x, y, z, color, zone, tags);
    }
  }

  return Array.from(m.values());
}
