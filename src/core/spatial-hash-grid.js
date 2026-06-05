export class SpatialHashGrid {
  constructor(cellSize = 96) {
    this.cellSize = cellSize;
    this.cells = new Map();
    this._lastQueryCells = 0;
  }

  clear() {
    this.cells.clear();
    this._lastQueryCells = 0;
  }

  rebuild(items) {
    this.clear();
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.alive !== false) this.insert(item);
    }
  }

  insert(item) {
    const cx = Math.floor(item.x / this.cellSize);
    const cy = Math.floor(item.y / this.cellSize);
    const key = `${cx},${cy}`;
    let bucket = this.cells.get(key);
    if (!bucket) {
      bucket = [];
      this.cells.set(key, bucket);
    }
    bucket.push(item);
  }

  queryRadius(x, y, radius, out) {
    out.length = 0;
    const minX = Math.floor((x - radius) / this.cellSize);
    const maxX = Math.floor((x + radius) / this.cellSize);
    const minY = Math.floor((y - radius) / this.cellSize);
    const maxY = Math.floor((y + radius) / this.cellSize);
    let visited = 0;

    for (let cy = minY; cy <= maxY; cy++) {
      for (let cx = minX; cx <= maxX; cx++) {
        const bucket = this.cells.get(`${cx},${cy}`);
        visited++;
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) out.push(bucket[i]);
      }
    }

    this._lastQueryCells = visited;
    return out;
  }

  get cellCount() {
    return this.cells.size;
  }

  get lastQueryCells() {
    return this._lastQueryCells;
  }
}

