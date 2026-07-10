// speed-mapping-test.ts
// Standalone verification of the speed -> pixels-per-frame mapping used
// by road-dashboard-visual.html. Run with ts-node; no browser needed.
//
// Design targets:
//   ~28 km/h (free flow)  -> car crosses one 360px segment in ~4s @60fps
//   ~8  km/h (real congested value captured from Seoul API) -> visible crawl
//   never negative, never zero (cars shouldn't freeze or reverse), never infinite

export function speedToPixelsPerFrame(speedKmh: number): number {
  const SEGMENT_PX = 360;        // one segment's width in px
  const FREE_FLOW_KMH = 28;      // typical uncongested speed in our data
  const FREE_FLOW_CROSS_SEC = 4; // desired crossing time at free flow
  const FPS = 60;

  const pxPerFrameAtFreeFlow = SEGMENT_PX / (FREE_FLOW_CROSS_SEC * FPS); // = 1.5
  const scaled = (speedKmh / FREE_FLOW_KMH) * pxPerFrameAtFreeFlow;

  // clamp: never below 0.05 (visible crawl, not frozen), never above 4 (sanity)
  return Math.min(4, Math.max(0.05, scaled));
}

// ── verification ────────────────────────────────────────────────

const sequence = [28, 28, 12, 12, 18, 27]; // incident then recovery
console.log('speed(km/h) -> px/frame -> seconds to cross one 360px segment @60fps');

let prevSpeed: number | null = null;
let prevPx: number | null = null;
let monotonicOk = true;

for (const s of sequence) {
  const px = speedToPixelsPerFrame(s);
  const crossSec = 360 / (px * 60);
  console.log(`  ${String(s).padStart(4)}       -> ${px.toFixed(3)}      -> ${crossSec.toFixed(1)}s`);
  if (prevSpeed !== null && prevPx !== null) {
    if (s > prevSpeed && px <= prevPx) monotonicOk = false;
    if (s < prevSpeed && px >= prevPx) monotonicOk = false;
  }
  prevSpeed = s; prevPx = px;
}

// edge cases
const edge = [0, 0.5, 6, 100, -5];
console.log('\nedge cases:');
for (const s of edge) {
  const px = speedToPixelsPerFrame(s);
  console.log(`  speed=${s} -> ${px.toFixed(3)} px/frame`);
  if (px <= 0 || !Number.isFinite(px)) monotonicOk = false;
}

console.log(monotonicOk
  ? '\n✅ monotonic with speed, always positive & finite'
  : '\n❌ FAILED monotonicity/positivity check');
