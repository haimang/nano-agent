/**
 * Fake in-memory storage for simulating DO / KV / R2 backends in E2E tests.
 */

export class FakeStorage {
  constructor() {
    this.data = new Map();
  }

  async get(key) {
    return this.data.has(key) ? this.data.get(key) : null;
  }

  async put(key, value) {
    this.data.set(key, value);
  }

  async list(prefix) {
    const keys = [];
    for (const k of this.data.keys()) {
      if (k.startsWith(prefix)) keys.push(k);
    }
    return keys.sort();
  }

  async delete(key) {
    return this.data.delete(key);
  }

  clear() {
    this.data.clear();
  }
}

export class FakeTraceStorage extends FakeStorage {
  async appendJsonl(key, record) {
    const existing = (await this.get(key)) ?? "";
    await this.put(key, existing + JSON.stringify(record) + "\n");
  }

  async readJsonl(key) {
    const raw = await this.get(key);
    if (!raw) return [];
    return raw.trim().split("\n").map((line) => JSON.parse(line));
  }
}
