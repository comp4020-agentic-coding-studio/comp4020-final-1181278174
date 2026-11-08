import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { HAND_MS } from "../lib/hall.ts";
import { type Hall, lastHall } from "./hand.ts";

// The hall, drawn with three.js: a figure for everyone who has the session
// open, and a red hand up for everyone who has pressed "I'm lost".
//
// The server never says whose hand is up, or where anyone sits: it sends how
// many people are here and how long each hand has been up. So each screen
// seats its own room. On a phone or a laptop, this person is the blue figure in
// the middle of the back row, and the camera looks over their shoulder: the
// whole room is in front of them, as it is when someone looks round a lecture
// hall to see who else has a hand up. The other hands go on figures this
// screen picks, so two screens never agree on where a hand is, and a hand
// can't be traced to a seat. The projector (data-view="front") shows the room
// from the front, so the room sees itself.
//
// Every figure is the same and has no face. The room is paper and ink; the only
// strong colour is a raised hand. src/scripts/hand.ts sends what to draw as a
// "hands-up:hall" event; the sentence under the hall says the same in words,
// and is all there is without script or WebGL.

/** Every colour and size the hall is drawn with, in one place, so the look can change without the code. */
const LOOK = {
  paper: "#fff9e8", // the background, and the fog the back of the hall fades into
  floor: "#f6e9c4", // the floor at the front
  step: "#ffe58a", // the top of each row
  stepSide: "#f2c94c", // the rise of each row
  chair: "#fff6d6",
  person: "#d8ccad", // everyone else: one colour, no faces
  you: "#2f5bff", // this person, on their own screen only
  hand: "#ff5a3c", // a raised hand: the only strong colour
  ink: "#121212", // outlines
  screen: "#121212", // the screen at the front
  screenTitle: "#ffd43b",
  screenText: "#ffffff",
  glow: 0.24, // how strong the light round a raised hand is
  outline: 0.035, // how much bigger the ink shell round each shape is, in metres
};

// The hall's shape, in metres: rows curve round the front through 2 × ARC
// radians, each one further back and higher up than the one in front. The
// front of the room, where the lecturer stands, is at the origin.
const ROWS = 9;
const seatsIn = (row: number): number => 9 + 2 * row;
const SEATS = Array.from({ length: ROWS }, (_, row) => seatsIn(row)).reduce((a, b) => a + b, 0);
const ARC = 0.78;
const FRONT = 3.4;
const ROW_GAP = 1.05;
const STEP = 0.42;
const radius = (row: number): number => FRONT + row * ROW_GAP;
const rise = (row: number): number => row * STEP;

/** A seat's row, and its place in that row from one end. */
function spot(seat: number): { row: number; col: number } {
  let row = 0;
  let first = 0;
  while (row < ROWS - 1 && seat >= first + seatsIn(row)) {
    first += seatsIn(row);
    row++;
  }
  return { row, col: seat - first };
}
const firstIn = (row: number): number => Array.from({ length: row }, (_, r) => seatsIn(r)).reduce((a, b) => a + b, 0);
const middleOf = (row: number): number => firstIn(row) + (seatsIn(row) - 1) / 2;

// Front rows first, and the middle of a row before its ends.
const cost = (seat: number): number => {
  const { row, col } = spot(seat);
  return row * 1.6 + Math.abs(col - (seatsIn(row) - 1) / 2) / 2;
};
const BEST: readonly number[] = Array.from({ length: SEATS }, (_, seat) => seat).sort((a, b) => cost(a) - cost(b) || a - b);

/** The rows a room of `people` sits in: the fewest that seat them with a little room to spare. */
function rowsFor(people: number): number {
  let rows = 2;
  while (rows < ROWS && firstIn(rows) < people + 3) rows++;
  return rows;
}

// An arm, in radians from hanging straight down: resting, and held up.
const REST = 0.12;
const UP = Math.PI - 0.22;
// in its last half minute a hand sinks, then comes down by itself
const DROOP_MS = 30_000;
const SHOULDER = new THREE.Vector3(0.2, 1.02, 0);
const ARM_LENGTH = 0.74;

const calm = window.matchMedia("(prefers-reduced-motion: reduce)");
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

type Spring = { x: number; v: number };
type Figure = { seat: number; here: boolean; up: boolean; since: number; pop: Spring; arm: Spring; you: boolean };

for (const view of document.querySelectorAll<HTMLElement>("[data-hall]")) {
  try {
    draw(view);
  } catch (error) {
    // no WebGL: the sentence under the hall says it in words
    view.hidden = true;
    console.warn("the hall could not be drawn", error);
  }
}

function draw(view: HTMLElement): void {
  const front = view.dataset.view === "front";
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  view.append(renderer.domElement);

  const color = (hex: string): THREE.Color => new THREE.Color(hex);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(color(LOOK.paper), 14, 30);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.3, 80);

  // cel shading: three tones, lit from above the front
  const tones = new THREE.DataTexture(new Uint8Array([150, 150, 150, 255, 210, 210, 210, 255, 255, 255, 255, 255]), 3, 1);
  tones.minFilter = THREE.NearestFilter;
  tones.magFilter = THREE.NearestFilter;
  tones.needsUpdate = true;
  const toon = (hex = "#ffffff"): THREE.MeshToonMaterial => new THREE.MeshToonMaterial({ color: color(hex), gradientMap: tones });
  scene.add(new THREE.HemisphereLight(0xffffff, color(LOOK.floor), 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(-3, 9, -4);
  scene.add(sun);

  const ink = new THREE.MeshBasicMaterial({ color: color(LOOK.ink), side: THREE.BackSide });

  // the floor at the front, and the steps the rows stand on
  const floor = new THREE.Mesh(new THREE.CircleGeometry(FRONT - ROW_GAP / 2, 64), toon(LOOK.floor));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.3;
  scene.add(floor);
  const steps = stepsGeometry();
  scene.add(new THREE.Mesh(steps, new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: tones })));
  scene.add(new THREE.LineSegments(new THREE.EdgesGeometry(steps, 25), new THREE.LineBasicMaterial({ color: color(LOOK.ink) })));

  // the lecturer's desk, and the screen behind it, which shows the question the room wants answered most
  const desk = new THREE.BoxGeometry(1.4, 1.0, 0.6).translate(0, 0.2, 0.9);
  scene.add(new THREE.Mesh(desk, toon(LOOK.chair)));
  scene.add(new THREE.Mesh(desk.clone().scale(1.04, 1.04, 1.08), ink));
  const board = document.createElement("canvas");
  board.width = 1024;
  board.height = 400;
  const words = new THREE.CanvasTexture(board);
  words.colorSpace = THREE.SRGBColorSpace;
  words.anisotropy = 4;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 2.03), new THREE.MeshBasicMaterial({ map: words }));
  screen.position.set(0, 2.55, -1.6);
  scene.add(screen);
  const frame = new THREE.Mesh(new THREE.PlaneGeometry(5.36, 2.19), new THREE.MeshBasicMaterial({ color: color(LOOK.ink) }));
  frame.position.set(0, 2.55, -1.62);
  scene.add(frame);

  // where each seat is, and which way it faces: towards the front
  const seatAt: THREE.Matrix4[] = Array.from({ length: SEATS }, (_, seat) => {
    const { row, col } = spot(seat);
    const angle = -ARC + ((col + 0.5) * 2 * ARC) / seatsIn(row);
    const r = radius(row);
    return new THREE.Matrix4()
      .makeTranslation(r * Math.sin(angle), rise(row), r * Math.cos(angle))
      .multiply(new THREE.Matrix4().makeRotationY(angle + Math.PI));
  });

  /** A shape for every seat, and a slightly bigger ink shell behind it that draws its outline. */
  function shapes(make: (grow: number) => THREE.BufferGeometry, fill: THREE.Material, outline = true): THREE.InstancedMesh[] {
    const meshes = [new THREE.InstancedMesh(make(0), fill, SEATS)];
    if (outline) meshes.push(new THREE.InstancedMesh(make(LOOK.outline), ink, SEATS));
    for (const mesh of meshes) {
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(mesh);
    }
    return meshes;
  }

  const chairs = shapes(
    (g) =>
      mergeGeometries([
        new THREE.BoxGeometry(0.5 + g, 0.08 + g, 0.4 + g).translate(0, 0.4, -0.02),
        new THREE.BoxGeometry(0.5 + g, 0.4 + g, 0.08 + g).translate(0, 0.62, -0.25),
      ])!,
    toon(LOOK.chair),
  );
  const bodies = shapes((g) => new THREE.CapsuleGeometry(0.2 + g, 0.3, 6, 16).translate(0, 0.78, 0), toon());
  const heads = shapes((g) => new THREE.SphereGeometry(0.17 + g, 24, 16).translate(0, 1.34, 0), toon());
  const arms = shapes((g) => new THREE.CapsuleGeometry(0.075 + g, 0.56, 4, 10).translate(0, -0.355, 0), toon());
  const palms = shapes((g) => new THREE.SphereGeometry(0.17 + g, 20, 14), toon(LOOK.hand));
  // a soft light round each raised hand, turned to face the camera
  const glows = shapes(
    () => new THREE.CircleGeometry(0.36, 32),
    new THREE.MeshBasicMaterial({ color: color(LOOK.hand), transparent: true, opacity: LOOK.glow, depthWrite: false }),
    false,
  );
  // a shadow on the step under everyone
  const shadows = shapes(
    () => new THREE.CircleGeometry(0.34, 24).rotateX(-Math.PI / 2).translate(0, 0.01, 0.02),
    new THREE.MeshBasicMaterial({ color: color(LOOK.ink), transparent: true, opacity: 0.12, depthWrite: false }),
    false,
  );

  const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
  const put = (meshes: THREE.InstancedMesh[], seat: number, matrix: THREE.Matrix4): void => {
    for (const mesh of meshes) {
      mesh.setMatrixAt(seat, matrix);
      mesh.instanceMatrix.needsUpdate = true;
    }
  };
  const paint = (meshes: THREE.InstancedMesh[], seat: number, hex: string): void => {
    meshes[0].setColorAt(seat, color(hex));
    if (meshes[0].instanceColor) meshes[0].instanceColor.needsUpdate = true;
  };
  for (let seat = 0; seat < SEATS; seat++) {
    put(chairs, seat, seatAt[seat]);
    for (const meshes of [bodies, heads, arms, palms, glows, shadows]) put(meshes, seat, ZERO);
    for (const meshes of [bodies, heads, arms]) paint(meshes, seat, LOOK.person);
  }

  // a label over this person's own figure
  const label = document.createElement("span");
  label.className = "hall-you";
  label.textContent = "You";
  label.hidden = true;
  if (!front) view.append(label);

  const figures = new Map<number, Figure>();
  /** The seats of the other people's figures, oldest first. */
  let others: number[] = [];
  let mySeat: number | undefined;
  /** Which figure each of the other hands is on, by when the hand went up. */
  const handOn = new Map<number, number>();
  let rows = 2;

  const figure = (seat: number, you = false): Figure => {
    let f = figures.get(seat);
    if (!f) {
      f = { seat, here: true, up: false, since: 0, pop: { x: 0, v: 0 }, arm: { x: REST, v: 0 }, you };
      figures.set(seat, f);
    }
    f.here = true;
    f.you = you;
    for (const meshes of [bodies, heads, arms]) paint(meshes, seat, you ? LOOK.you : LOOK.person);
    return f;
  };
  const leave = (seat: number): void => {
    const f = figures.get(seat);
    if (f) {
      f.here = false;
      f.up = false;
    }
  };

  /** Seat this many other people, keeping everyone who is already seated where they are. */
  function seat(count: number): void {
    // the others fill the rows from the front; this person sits in the middle of the row behind them
    rows = rowsFor(count);
    if (!front) {
      const mine = middleOf(Math.min(rows, ROWS - 1));
      if (mine !== mySeat) {
        const was = mySeat === undefined ? undefined : figures.get(mySeat);
        if (mySeat !== undefined) leave(mySeat);
        const f = figure(mine, true);
        if (was) {
          f.up = was.up;
          f.since = was.since;
        }
        mySeat = mine;
        others = others.filter((s) => s !== mine);
      }
    }
    while (others.length > count) {
      // someone left: a figure with no hand up goes first
      const free = [...others].reverse().find((s) => ![...handOn.values()].includes(s));
      const gone = free ?? others[others.length - 1];
      others = others.filter((s) => s !== gone);
      for (const [since, s] of handOn) if (s === gone) handOn.delete(since);
      leave(gone);
    }
    const taken = new Set([...others, ...(mySeat === undefined ? [] : [mySeat])]);
    const open = BEST.filter((s) => !taken.has(s) && spot(s).row < rows && !figures.get(s)?.here);
    if (open.length === 0) open.push(...BEST.filter((s) => !taken.has(s) && !figures.get(s)?.here));
    while (others.length < count && open.length > 0) {
      // a newcomer takes one of the best few seats left, so screens don't all look alike
      const pick = open.splice(Math.floor(Math.random() * Math.min(4, open.length)), 1)[0];
      others.push(pick);
      figure(pick);
    }
    // a chair only where someone sits, so the room looks as full as it is
    for (let s = 0; s < SEATS; s++) put(chairs, s, figures.get(s)?.here ? seatAt[s] : ZERO);
    aimCamera();
  }

  /** Put the other hands on figures: a hand already shown stays where it is; a new one goes on a figure picked at random. */
  function hands(sinces: number[]): void {
    const now = performance.now();
    const kept = new Map<number, number>();
    const pool = new Map(handOn);
    for (const since of sinces) {
      let found: number | undefined;
      for (const [was, s] of pool) {
        if (Math.abs(was - since) < 3000 && others.includes(s)) {
          found = s;
          pool.delete(was);
          break;
        }
      }
      if (found !== undefined) kept.set(since, found);
    }
    for (const since of sinces) {
      if (kept.has(since)) continue;
      const busy = new Set(kept.values());
      const free = others.filter((s) => !busy.has(s));
      if (free.length === 0) break;
      kept.set(since, free[Math.floor(Math.random() * free.length)]);
    }
    handOn.clear();
    for (const [since, s] of kept) handOn.set(since, s);
    const up = new Map([...kept].map(([since, s]) => [s, since]));
    for (const s of others) {
      const f = figures.get(s);
      if (!f) continue;
      const since = up.get(s);
      if (since === undefined) f.up = false;
      else if (!f.up || Math.abs(f.since - since) > 3000) {
        f.up = now - since < HAND_MS;
        f.since = since;
      }
    }
  }

  function show(hall: Hall): void {
    seat(Math.max(0, hall.here - (front ? 0 : 1)));
    hands(hall.others);
    if (!front && mySeat !== undefined) {
      const f = figures.get(mySeat)!;
      const up = hall.mine !== null;
      if (f.up !== up || (up && Math.abs(f.since - hall.mine!) > 3000)) {
        f.up = up;
        f.since = hall.mine ?? 0;
      }
    }
    kick();
  }

  // ---- drawing: only while something moves ----

  const scale = new THREE.Matrix4();
  const step = new THREE.Matrix4();
  const at = new THREE.Matrix4();
  const palm = new THREE.Vector3();
  const glowAt = new THREE.Matrix4();
  const one = new THREE.Vector3();
  function pose(f: Figure, time: number): void {
    const s = Math.max(0, f.pop.x);
    // a figure breathes a little, so a room of them is never quite still
    const breath = calm.matches ? 1 : 1 + Math.sin(time / 900 + f.seat * 1.7) * 0.012;
    at.copy(seatAt[f.seat]).multiply(scale.makeScale(s, s * breath, s));
    put(bodies, f.seat, at);
    put(heads, f.seat, at);
    put(shadows, f.seat, at);
    at.multiply(step.makeTranslation(SHOULDER.x, SHOULDER.y, SHOULDER.z)).multiply(step.makeRotationZ(f.arm.x));
    put(arms, f.seat, at);
    // an arm on its way up turns red, whoever's it is
    paint(arms, f.seat, f.arm.x > 1.0 ? LOOK.hand : f.you ? LOOK.you : LOOK.person);
    // the red hand, and its light, once the arm is past level
    const h = clamp((f.arm.x - 1.4) / 0.8, 0, 1);
    if (h === 0) {
      put(palms, f.seat, ZERO);
      put(glows, f.seat, ZERO);
    } else {
      at.multiply(step.makeTranslation(0, -ARM_LENGTH, 0));
      palm.setFromMatrixPosition(at);
      put(palms, f.seat, at.multiply(scale.makeScale(h, h, h)));
      const pulse = calm.matches ? 1 : 1 + Math.sin(time / 260 + f.seat) * 0.08;
      glowAt.compose(palm, camera.quaternion, one.setScalar(h * s * pulse));
      put(glows, f.seat, glowAt);
    }
  }

  /** Where the arm is heading: up, sinking in its last half minute, waving a little. */
  function aim(f: Figure, now: number): number {
    if (!f.up) return REST;
    const left = HAND_MS - (now - f.since);
    const droop = clamp(1 - left / DROOP_MS, 0, 1);
    const wave = calm.matches ? 0 : Math.sin(now / 190 + f.seat) * 0.1 * (1 - droop);
    return UP - droop * 1.1 + wave;
  }

  // a spring that overshoots a little, so a figure pops in and a hand shoots up
  function spring(s: Spring, target: number, dt: number): boolean {
    if (calm.matches) {
      s.x = target;
      s.v = 0;
      return false;
    }
    s.v += ((target - s.x) * 170 - s.v * 15) * dt;
    s.x += s.v * dt;
    return Math.abs(target - s.x) > 0.001 || Math.abs(s.v) > 0.001;
  }

  // the camera glides to where it should be when the room grows or shrinks
  const eye = new THREE.Vector3();
  const look = new THREE.Vector3();
  const eyeTo = new THREE.Vector3();
  const lookTo = new THREE.Vector3();
  let placed = false;
  function aimCamera(): void {
    if (front) {
      // from above the lecturer's desk, looking up the rows
      const back = rows - 1;
      eyeTo.set(0, 4.2 + rise(back) * 0.6, -4.6);
      lookTo.set(0, rise(back) * 0.45 + 0.7, radius(back) * 0.55);
    } else {
      // from behind and above this person, looking down over the room to the front
      const mine = Math.min(rows, ROWS - 1);
      eyeTo.set(0, rise(mine) + 2.9, radius(mine) + 2.9);
      lookTo.set(0, 1.0, 1.1);
    }
    if (!placed || calm.matches) {
      eye.copy(eyeTo);
      look.copy(lookTo);
      placed = true;
    }
  }

  let frameId = 0;
  let last = 0;
  function kick(): void {
    if (!frameId) frameId = requestAnimationFrame(tick);
  }
  const top = new THREE.Vector3();
  function tick(time: number): void {
    frameId = 0;
    const dt = Math.min((time - last) / 1000, 1 / 30);
    last = time;
    let moving = false;
    if (eye.distanceTo(eyeTo) > 0.002 || look.distanceTo(lookTo) > 0.002) {
      const k = 1 - Math.exp(-dt * 4);
      eye.lerp(eyeTo, k);
      look.lerp(lookTo, k);
      moving = true;
    }
    camera.position.copy(eye);
    camera.lookAt(look);
    fit();
    for (const f of figures.values()) {
      if (f.up && time - f.since >= HAND_MS) f.up = false;
      moving = spring(f.pop, f.here ? 1 : 0, dt) || moving;
      moving = spring(f.arm, aim(f, time), dt) || moving;
      // a waving hand needs drawing; breathing alone does not keep the page drawing
      if (!calm.matches && f.up) moving = true;
      if (!f.here && f.pop.x <= 0.001) {
        f.pop.x = 0;
        pose(f, time);
        figures.delete(f.seat);
        for (const meshes of [bodies, heads, arms, palms, glows, shadows]) put(meshes, f.seat, ZERO);
        continue;
      }
      pose(f, time);
    }
    renderer.render(scene, camera);
    // keep the "You" label over this person's head
    const f = mySeat === undefined ? undefined : figures.get(mySeat);
    if (f && f.pop.x > 0.5) {
      top.set(-0.05, 1.85 * f.pop.x, 0).applyMatrix4(seatAt[f.seat]).project(camera);
      label.hidden = false;
      label.style.left = `${((top.x + 1) / 2) * view.clientWidth}px`;
      label.style.top = `${((1 - top.y) / 2) * view.clientHeight}px`;
    } else {
      label.hidden = true;
    }
    // a still room is drawn once; a waving hand keeps it drawing while the page is in view
    if (moving && document.visibilityState === "visible") kick();
  }
  document.addEventListener("visibilitychange", kick);

  /** Fit the camera's view round the occupied rows and the screen, with a little room for raised hands. */
  const p = new THREE.Vector3();
  function fit(): void {
    const width = view.clientWidth;
    const height = view.clientHeight;
    if (width === 0 || height === 0) return;
    if (renderer.domElement.width !== Math.round(width * renderer.getPixelRatio())) renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.clearViewOffset();
    camera.updateMatrixWorld();
    // the people, with room above each for a raised hand, and the front row's ends so a small room still looks like a hall
    const points: THREE.Vector3[] = [];
    const seatPoint = new THREE.Vector3();
    for (const f of figures.values()) {
      if (!f.here) continue;
      seatPoint.setFromMatrixPosition(seatAt[f.seat]);
      for (const y of [0.15, 2.15]) points.push(seatPoint.clone().setY(seatPoint.y + y));
    }
    const r0 = radius(0) - ROW_GAP / 2;
    for (const a of [-ARC * 0.8, ARC * 0.8]) points.push(new THREE.Vector3(r0 * Math.sin(a), 0, r0 * Math.cos(a)));
    if (!front) for (const x of [-2.7, 2.7]) for (const y of [1.45, 3.65]) points.push(new THREE.Vector3(x, y, -1.6));
    let left = Infinity;
    let right = -Infinity;
    let low = Infinity;
    let high = -Infinity;
    for (const point of points) {
      p.copy(point).applyMatrix4(camera.matrixWorldInverse);
      if (p.z > -0.2) continue;
      left = Math.min(left, p.x / -p.z);
      right = Math.max(right, p.x / -p.z);
      low = Math.min(low, p.y / -p.z);
      high = Math.max(high, p.y / -p.z);
    }
    if (!Number.isFinite(left)) return;
    const half = Math.max((high - low) / 2, (right - left) / 2 / camera.aspect) * 1.04;
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(half));
    const x = ((right + left) / 2 / (half * camera.aspect)) * (width / 2);
    const y = -((high + low) / 2 / half) * (height / 2);
    camera.setViewOffset(width, height, x, y, width, height);
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(kick).observe(view);

  /** The screen at the front: the open question with the most "Me too", or how to ask one. */
  function write(): void {
    const top = document.querySelector('[aria-label="Most wanted"] > li .body, [aria-label="Top questions"] > li .body');
    const text = top?.textContent?.trim() || "No questions yet. Ask one under Questions.";
    const g = board.getContext("2d");
    if (!g) return;
    g.fillStyle = LOOK.screen;
    g.fillRect(0, 0, board.width, board.height);
    const face = getComputedStyle(document.body).getPropertyValue("--display").trim() || "sans-serif";
    g.fillStyle = LOOK.screenTitle;
    g.font = `800 42px ${face}`;
    g.fillText(top ? "MOST WANTED" : "HANDS UP", 56, 84);
    g.fillStyle = LOOK.screenText;
    let size = 66;
    let lines: string[] = [];
    for (; size >= 36; size -= 6) {
      g.font = `700 ${size}px ${face}`;
      lines = wrap(g, text, board.width - 112);
      if (lines.length * size * 1.15 <= board.height - 140) break;
    }
    lines.forEach((line, i) => g.fillText(line, 56, 150 + size * 0.85 + i * size * 1.15));
    words.needsUpdate = true;
    kick();
  }
  const list = document.querySelector("[data-board]");
  if (list) new MutationObserver(write).observe(list, { childList: true, subtree: true, characterData: true });
  void document.fonts?.ready.then(write);
  write();

  aimCamera();
  if (lastHall) show(lastHall);
  document.addEventListener("hands-up:hall", (event) => show((event as CustomEvent<Hall>).detail));
  kick();
}

/** Break text into lines that fit `width` on this canvas. */
function wrap(g: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  // words, or characters for text with no spaces, such as Chinese
  const parts = text.includes(" ") ? text.split(/(\s+)/) : [...text];
  for (const part of parts) {
    const next = line + part;
    if (line && g.measureText(next).width > width) {
      lines.push(line.trimEnd());
      line = part.trimStart();
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  if (lines.length > 3) return [...lines.slice(0, 2), `${lines[2].replace(/.$/, "")}…`];
  return lines;
}

/** The steps the rows stand on: sunflower on top, darker where they rise. */
function stepsGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const from = Math.PI / 2 - ARC - 0.06;
  const to = Math.PI / 2 + ARC + 0.06;
  for (let row = 0; row < ROWS; row++) {
    const shape = new THREE.Shape();
    shape.absarc(0, 0, radius(row) + ROW_GAP / 2, from, to, false);
    shape.absarc(0, 0, radius(row) - ROW_GAP / 2, to, from, true);
    const block = new THREE.ExtrudeGeometry(shape, { depth: rise(row) + 0.3, bevelEnabled: false, curveSegments: 48 });
    // the shape lies flat, and the block hangs down from the row's floor
    block.rotateX(Math.PI / 2).translate(0, rise(row), 0);
    parts.push(block);
  }
  const steps = mergeGeometries(parts)!;
  const normals = steps.getAttribute("normal");
  const colors = new Float32Array(normals.count * 3);
  const topColor = new THREE.Color(LOOK.step);
  const sideColor = new THREE.Color(LOOK.stepSide);
  for (let i = 0; i < normals.count; i++) {
    (normals.getY(i) > 0.5 ? topColor : sideColor).toArray(colors, i * 3);
  }
  steps.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return steps;
}
