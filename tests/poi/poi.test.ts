// tests/poi/poi.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { loadPois, savePois, addPoi, removePoi } from '../../src/poi/poi.js';

describe('POI CRUD', () => {
  let tmpDir: string;
  let configDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'klook-cli-test-'));
    configDir = path.join(tmpDir, '.klook-cli');
    fs.mkdirSync(configDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loadPois returns empty array when file does not exist', () => {
    const pois = loadPois(configDir);
    expect(pois).toEqual([]);
  });

  it('addPoi creates a new POI and persists it', () => {
    addPoi(configDir, {
      name: 'Mt Fuji day tour',
      keywords: ['Mt Fuji day tour', '富士山一日遊'],
      platforms: ['klook', 'trip', 'getyourguide', 'kkday'],
    });
    const pois = loadPois(configDir);
    expect(pois).toHaveLength(1);
    expect(pois[0].name).toBe('Mt Fuji day tour');
    expect(pois[0].keywords).toEqual(['Mt Fuji day tour', '富士山一日遊']);
    expect(pois[0].platforms).toEqual(['klook', 'trip', 'getyourguide', 'kkday']);
  });

  it('addPoi rejects duplicate name', () => {
    addPoi(configDir, { name: 'USJ', keywords: ['USJ'], platforms: ['klook'] });
    expect(() => {
      addPoi(configDir, { name: 'USJ', keywords: ['USJ 2'], platforms: ['trip'] });
    }).toThrow('already exists');
  });

  it('removePoi removes by name', () => {
    addPoi(configDir, { name: 'A', keywords: ['a'], platforms: ['klook'] });
    addPoi(configDir, { name: 'B', keywords: ['b'], platforms: ['klook'] });
    removePoi(configDir, 'A');
    const pois = loadPois(configDir);
    expect(pois).toHaveLength(1);
    expect(pois[0].name).toBe('B');
  });

  it('removePoi throws for nonexistent name', () => {
    expect(() => removePoi(configDir, 'nope')).toThrow('not found');
  });

  it('savePois and loadPois roundtrip', () => {
    const data = [
      { name: 'X', keywords: ['x1', 'x2'], platforms: ['klook', 'trip'] },
    ];
    savePois(configDir, data);
    const loaded = loadPois(configDir);
    expect(loaded).toEqual(data);
  });
});
