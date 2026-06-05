export const TAU = Math.PI * 2;
export const EPSILON = 0.000001;

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function inverseLerp(a, b, value) {
  return clamp((value - a) / ((b - a) || EPSILON), 0, 1);
}

export function smoothstep(edge0, edge1, value) {
  const t = inverseLerp(edge0, edge1, value);
  return t * t * (3 - 2 * t);
}

export function distanceSq(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

export function lengthSq(x, y) {
  return x * x + y * y;
}

export function length(x, y) {
  return Math.hypot(x, y);
}

export function hashSeed(input) {
  const text = String(input || 'ecosystem');
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function createRng(seed = 'ecosystem') {
  let state = typeof seed === 'number' ? seed >>> 0 : hashSeed(seed);
  if (state === 0) state = 0x6d2b79f5;

  const rng = {
    next() {
      state += 0x6d2b79f5;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    float(min = 0, max = 1) {
      return min + (max - min) * rng.next();
    },
    int(min, max) {
      return Math.floor(rng.float(min, max + 1));
    },
    chance(probability) {
      return rng.next() < probability;
    },
    sign() {
      return rng.next() < 0.5 ? -1 : 1;
    },
    getState() {
      return state >>> 0;
    }
  };

  return rng;
}

export function pickWeighted(rng, list, weightOf) {
  let total = 0;
  for (let i = 0; i < list.length; i++) total += Math.max(0, weightOf(list[i]));
  if (total <= 0) return list[Math.floor(rng.next() * list.length)] || null;

  let roll = rng.float(0, total);
  for (let i = 0; i < list.length; i++) {
    roll -= Math.max(0, weightOf(list[i]));
    if (roll <= 0) return list[i];
  }
  return list[list.length - 1] || null;
}

export function formatTime(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

