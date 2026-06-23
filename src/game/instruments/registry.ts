import type { Instrument } from "./types";

const registry = new Map<string, Instrument>();

export function registerInstrument(instrument: Instrument): void {
  if (registry.has(instrument.id)) {
    console.warn(`[instruments] Overwriting instrument "${instrument.id}"`);
  }
  registry.set(instrument.id, instrument);
}

export function getInstrument(id: string): Instrument | undefined {
  return registry.get(id);
}

export function getAllInstruments(): Instrument[] {
  return Array.from(registry.values());
}
