"use strict";

class Mutex {
  constructor() {
    this._p = Promise.resolve();
    this.locked = false;
  }

  async run(fn) {
    let release;
    const next = new Promise((resolve) => { release = resolve; });
    const prev = this._p;
    this._p = next;
    await prev;
    this.locked = true;
    try {
      return await fn();
    } finally {
      this.locked = false;
      release();
    }
  }

  tryRun(fn) {
    if (this.locked) return Promise.resolve({ skipped: true });
    return this.run(fn);
  }
}

const writeMutex = new Mutex();
const importMutex = new Mutex();

module.exports = { Mutex, writeMutex, importMutex };
