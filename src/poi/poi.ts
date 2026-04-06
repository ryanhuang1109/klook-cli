// src/poi/poi.ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { POI } from '../shared/types.js';

const POIS_FILENAME = 'pois.json';

function defaultConfigDir(): string {
  return path.join(os.homedir(), '.klook-cli');
}

export function loadPois(configDir: string = defaultConfigDir()): POI[] {
  const filePath = path.join(configDir, POIS_FILENAME);
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export function savePois(configDir: string = defaultConfigDir(), pois: POI[]): void {
  fs.mkdirSync(configDir, { recursive: true });
  const filePath = path.join(configDir, POIS_FILENAME);
  fs.writeFileSync(filePath, JSON.stringify(pois, null, 2) + '\n', 'utf-8');
}

export function addPoi(configDir: string = defaultConfigDir(), poi: POI): void {
  const pois = loadPois(configDir);
  if (pois.some((p) => p.name === poi.name)) {
    throw new Error(`POI "${poi.name}" already exists`);
  }
  pois.push(poi);
  savePois(configDir, pois);
}

export function removePoi(configDir: string = defaultConfigDir(), name: string): void {
  const pois = loadPois(configDir);
  const idx = pois.findIndex((p) => p.name === name);
  if (idx === -1) {
    throw new Error(`POI "${name}" not found`);
  }
  pois.splice(idx, 1);
  savePois(configDir, pois);
}
