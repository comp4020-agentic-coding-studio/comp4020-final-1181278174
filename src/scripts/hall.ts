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
  paper: "#f1f3eb", // the background, and the fog the back of the hall fades into
  floor: "#e5e9dc", // the floor at the front
  step: "#e7d78e", // the top of each row
  stepSide: "#c0af6d", // the rise of each row
  chair: "#f8f8ef",
  person: "#b5bead", // everyone else: one colour, no faces
  you: "#2554c7", // this person, on their own screen only
  hand: "#c34b2b", // a raised hand: the only strong colour
  ink: "#30392f", // outlines
  white: "#ffffff",
  tones: [150, 150, 150, 255, 210, 210, 210, 255, 255, 255, 255, 255],
  glow: 0.10, // how strong the light round a raised hand is
  shadow: 0.08,
  outline: 0.020, // how much bigger the ink shell round each shape is, in metres
  handOutline: 0.015, // fingers need a thinner edge to stay readable on a phone
};

// The hall's shape, in metres: rows curve round the front through 2 × ARC
// radians, each one further back and higher up than the one in front. The
// front of the room, where the lecturer stands, is at the origin.
const ROWS = 9;
const seatsIn = (row: number): number => 9 + 2 * row;
const SEATS = Array.from({ length: ROWS }, (_, row) => seatsIn(row)).reduce((a, b) => a + b, 0);
const ARC = 0.78;
const FRONT = 3.4;
const ROW_GAP = 1.25;
const STEP = 0.52;
const STEP_MARGIN = 0.06;
const FLOOR_DEPTH = 0.3;
const radius = (row: number): number => FRONT + row * ROW_GAP;
const rise = (row: number): number => row * STEP;

const DESK = { width: 1.4, height: 1.0, depth: 0.6, y: 0.2, z: 0.9, inkScale: [1.04, 1.04, 1.08] as const };
const CHAIR = { width: 0.5, depth: 0.4, thickness: 0.08, seatY: 0.4, seatZ: -0.02, backY: 0.62, backZ: -0.25 };
const BODY = { radius: 0.2, length: 0.3, y: 0.78 };
const HEAD = { radius: 0.17, y: 1.34 };
const ARM = { radius: 0.055, length: 0.56, y: -0.355, redAt: 1.0, handAt: 1.4, handOver: 0.8 };
const HAND = {
  palmWidth: 0.18, palmHeight: 0.18, depth: 0.07,
  fingerWidth: 0.045, fingers: [0.10, 0.14, 0.15, 0.11],
  thumbLength: 0.105, thumbAngle: 1.02, thumbX: -0.112, thumbY: -0.03,
};
const GLOW_RADIUS = 0.25;
const SHADOW = { radius: 0.3, y: 0.01, z: -0.1 };
// the "You" label sits just to the side of this person's head, at its height
const LABEL = { y: 1.34, gap: 0.3 };
const CAMERA = {
  fov: 40, near: 0.3, far: 80, fogNear: 14, fogFar: 30,
  frontHeight: 4.8, frontRise: 0.7, frontZ: -4.4,
  frontLookRise: 0.45, frontLookY: 0.7, frontLookRadius: 0.55,
  eyeHeight: 4.4, behind: 3.3, lookY: 0.7, lookZ: 1.3,
};
// An arm passes through horizontal on its way down, so the frame needs its full reach.
const FIT = { padding: 1.10, side: 1.0, bottom: 0.15, top: 2.15, frontArc: 0.8 };
const SUN = { x: -3, y: 9, z: -4, intensity: 1.4, ambient: 1.6 };
const SPRING = { stiffness: 170, damping: 24, epsilon: 0.001 };
const CAMERA_EPSILON = 0.002;
const HAND_TIME_SLOP = 3000;

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
  // 1.5 is sharp enough for flat shapes and ink lines, and a phone draws 44% fewer pixels than at 2
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  view.append(renderer.domElement);

  const color = (hex: string): THREE.Color => new THREE.Color(hex);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(color(LOOK.paper), CAMERA.fogNear, CAMERA.fogFar);
  const camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, CAMERA.near, CAMERA.far);

  // cel shading: three tones, lit from above the front
  const tones = new THREE.DataTexture(new Uint8Array(LOOK.tones), 3, 1);
  tones.minFilter = THREE.NearestFilter;
  tones.magFilter = THREE.NearestFilter;
  tones.needsUpdate = true;
  const toon = (hex = LOOK.white): THREE.MeshToonMaterial => new THREE.MeshToonMaterial({ color: color(hex), gradientMap: tones });
  scene.add(new THREE.HemisphereLight(color(LOOK.white), color(LOOK.floor), SUN.ambient));
  const sun = new THREE.DirectionalLight(color(LOOK.white), SUN.intensity);
  sun.position.set(SUN.x, SUN.y, SUN.z);
  scene.add(sun);

  const ink = new THREE.MeshBasicMaterial({ color: color(LOOK.ink), side: THREE.BackSide });

  // the floor at the front, and the steps the rows stand on
  const floor = new THREE.Mesh(new THREE.CircleGeometry(FRONT - ROW_GAP / 2, 64), toon(LOOK.floor));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -FLOOR_DEPTH;
  scene.add(floor);
  const steps = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: tones }));
  const edges = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: color(LOOK.ink) }));
  scene.add(steps, edges);
  let stepRows = 0;

  // the desk helps show which way the room faces
  const desk = new THREE.BoxGeometry(DESK.width, DESK.height, DESK.depth).translate(0, DESK.y, DESK.z);
  scene.add(new THREE.Mesh(desk, toon(LOOK.chair)));
  scene.add(new THREE.Mesh(desk.clone().scale(...DESK.inkScale), ink));

  // where each seat is, and which way it faces: towards the front
  const seatAt: THREE.Matrix4[] = Array.from({ length: SEATS }, (_, seat) => {
    const { row, col } = spot(seat);
    const angle = -ARC + ((col + 0.5) * 2 * ARC) / seatsIn(row);
    const r = radius(row);
    return new THREE.Matrix4()
      .makeTranslation(r * Math.sin(angle), rise(row), r * Math.cos(angle))
      .multiply(new THREE.Matrix4().makeRotationY(angle + Math.PI));
  });

  /** Every instanced mesh, so the number of seats sent to be drawn can be cut to those in use. */
  const instanced: THREE.InstancedMesh[] = [];

  /** A shape for every seat, and a slightly bigger ink shell behind it that draws its outline. */
  function shapes(make: (grow: number) => THREE.BufferGeometry, fill: THREE.Material, outline = LOOK.outline): THREE.InstancedMesh[] {
    const meshes = [new THREE.InstancedMesh(make(0), fill, SEATS)];
    instanced.push(meshes[0]);
    if (outline) meshes.push(new THREE.InstancedMesh(make(outline), ink, SEATS));
    if (outline) instanced.push(meshes[1]);
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
        new THREE.BoxGeometry(CHAIR.width + g, CHAIR.thickness + g, CHAIR.depth + g).translate(0, CHAIR.seatY, CHAIR.seatZ),
        new THREE.BoxGeometry(CHAIR.width + g, CHAIR.depth + g, CHAIR.thickness + g).translate(0, CHAIR.backY, CHAIR.backZ),
      ])!,
    toon(LOOK.chair),
  );
  const bodies = shapes((g) => new THREE.CapsuleGeometry(BODY.radius + g, BODY.length, 6, 16).translate(0, BODY.y, 0), toon());
  const heads = shapes((g) => new THREE.SphereGeometry(HEAD.radius + g, 16, 12).translate(0, HEAD.y, 0), toon());
  const arms = shapes((g) => new THREE.CapsuleGeometry(ARM.radius + g, ARM.length, 4, 10).translate(0, ARM.y, 0), toon());
  const palms = shapes(handGeometry, toon(LOOK.hand), LOOK.handOutline);
  // a soft light round each raised hand, turned to face the camera
  const glows = shapes(
    () => new THREE.CircleGeometry(GLOW_RADIUS, 32),
    new THREE.MeshBasicMaterial({ color: color(LOOK.hand), transparent: true, opacity: LOOK.glow, depthWrite: false }),
    0,
  );
  // a shadow on the step under everyone
  const shadows = shapes(
    () => new THREE.CircleGeometry(SHADOW.radius, 24).rotateX(-Math.PI / 2).translate(0, SHADOW.y, SHADOW.z),
    new THREE.MeshBasicMaterial({ color: color(LOOK.ink), transparent: true, opacity: LOOK.shadow, depthWrite: false }),
    0,
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
    while (others.length > count) {
      // someone left: a figure with no hand up goes first
      const free = [...others].reverse().find((s) => ![...handOn.values()].includes(s));
      const gone = free ?? others[others.length - 1];
      others = others.filter((s) => s !== gone);
      for (const [since, s] of handOn) if (s === gone) handOn.delete(since);
      leave(gone);
    }
    // the others fill the rows from the front; this person sits in the middle of the row behind them
    // a hand kept in a back row still needs its step after other people leave
    rows = Math.max(rowsFor(count), ...others.map((s) => spot(s).row + 1));
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
    const needed = Math.min(ROWS, rows + (front ? 0 : 1));
    if (needed !== stepRows) {
      const geometry = stepsGeometry(needed);
      steps.geometry.dispose();
      edges.geometry.dispose();
      steps.geometry = geometry;
      edges.geometry = new THREE.EdgesGeometry(geometry, 25);
      stepRows = needed;
    }
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
        if (Math.abs(was - since) < HAND_TIME_SLOP && others.includes(s)) {
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
      else if (!f.up || Math.abs(f.since - since) > HAND_TIME_SLOP) {
        f.up = now - since < HAND_MS;
        f.since = since;
      }
    }
  }

  let shown: Pick<Hall, "here" | "mine" | "others"> | undefined;
  function show(hall: Hall): void {
    // the count's clock sends a state every second; unchanged seats and hands need no drawing
    const otherHands = [...hall.others].sort((a, b) => a - b);
    if (shown?.here === hall.here && shown.mine === hall.mine &&
      shown.others.length === otherHands.length && shown.others.every((since, i) => since === otherHands[i])) return;
    shown = { here: hall.here, mine: hall.mine, others: otherHands };
    seat(Math.max(0, hall.here - (front ? 0 : 1)));
    hands(otherHands);
    if (!front && mySeat !== undefined) {
      const f = figures.get(mySeat)!;
      const up = hall.mine !== null;
      if (f.up !== up || (up && Math.abs(f.since - hall.mine!) > HAND_TIME_SLOP)) {
        f.up = up;
        f.since = hall.mine ?? 0;
      }
    }
    scheduleExpiry();
    kick();
  }

  let expiryId: number | undefined;
  function scheduleExpiry(): void {
    window.clearTimeout(expiryId);
    expiryId = undefined;
    let next = Infinity;
    for (const f of figures.values()) if (f.up) next = Math.min(next, f.since + HAND_MS);
    // a still raised hand only needs another frame when its three minutes run out
    if (Number.isFinite(next)) expiryId = window.setTimeout(kick, Math.max(0, Math.ceil(next - performance.now())));
  }

  // ---- drawing: only while something moves ----

  const scale = new THREE.Matrix4();
  const step = new THREE.Matrix4();
  const at = new THREE.Matrix4();
  const palm = new THREE.Vector3();
  const handAt = new THREE.Matrix4();
  const one = new THREE.Vector3();
  function pose(f: Figure): void {
    const s = Math.max(0, f.pop.x);
    at.copy(seatAt[f.seat]).multiply(scale.makeScale(s, s, s));
    put(bodies, f.seat, at);
    put(heads, f.seat, at);
    put(shadows, f.seat, at);
    at.multiply(step.makeTranslation(SHOULDER.x, SHOULDER.y, SHOULDER.z)).multiply(step.makeRotationZ(f.arm.x));
    put(arms, f.seat, at);
    // an arm on its way up turns red, whoever's it is
    paint(arms, f.seat, f.arm.x > ARM.redAt ? LOOK.hand : f.you ? LOOK.you : LOOK.person);
    // the red hand, and its light, once the arm is past level
    const h = clamp((f.arm.x - ARM.handAt) / ARM.handOver, 0, 1);
    if (h === 0) {
      put(palms, f.seat, ZERO);
      put(glows, f.seat, ZERO);
    } else {
      at.multiply(step.makeTranslation(0, -ARM_LENGTH, 0));
      palm.setFromMatrixPosition(at);
      // the small fingers and thumb keep their silhouette from either end of the hall
      handAt.compose(palm, camera.quaternion, one.setScalar(h * s));
      put(palms, f.seat, handAt);
      put(glows, f.seat, handAt);
    }
  }

  // short transitions make arrivals and arm changes visible without keeping the room moving
  function spring(s: Spring, target: number, dt: number): boolean {
    if (calm.matches) {
      s.x = target;
      s.v = 0;
      return false;
    }
    s.v += ((target - s.x) * SPRING.stiffness - s.v * SPRING.damping) * dt;
    s.x += s.v * dt;
    if (Math.abs(target - s.x) > SPRING.epsilon || Math.abs(s.v) > SPRING.epsilon) return true;
    s.x = target;
    s.v = 0;
    return false;
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
      eyeTo.set(0, CAMERA.frontHeight + rise(back) * CAMERA.frontRise, CAMERA.frontZ);
      lookTo.set(0, rise(back) * CAMERA.frontLookRise + CAMERA.frontLookY, radius(back) * CAMERA.frontLookRadius);
    } else {
      // from behind and above this person, looking down over the room to the front
      const mine = Math.min(rows, ROWS - 1);
      eyeTo.set(0, rise(mine) + CAMERA.eyeHeight, radius(mine) + CAMERA.behind);
      lookTo.set(0, CAMERA.lookY, CAMERA.lookZ);
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
    if (!frameId && document.visibilityState === "visible") frameId = requestAnimationFrame(tick);
  }
  const top = new THREE.Vector3();
  const side = new THREE.Vector3();
  function tick(time: number): void {
    frameId = 0;
    const dt = Math.min((time - last) / 1000, 1 / 30);
    last = time;
    const now = performance.now();
    let moving = false;
    if (!calm.matches && (eye.distanceTo(eyeTo) > CAMERA_EPSILON || look.distanceTo(lookTo) > CAMERA_EPSILON)) {
      const k = 1 - Math.exp(-dt * 4);
      eye.lerp(eyeTo, k);
      look.lerp(lookTo, k);
      moving = true;
    } else {
      eye.copy(eyeTo);
      look.copy(lookTo);
    }
    camera.position.copy(eye);
    camera.lookAt(look);
    fit();
    let expired = false;
    for (const f of figures.values()) {
      if (f.up && now - f.since >= HAND_MS) {
        f.up = false;
        expired = true;
      }
      moving = spring(f.pop, f.here ? 1 : 0, dt) || moving;
      moving = spring(f.arm, f.up ? UP : REST, dt) || moving;
      if (!f.here && f.pop.x === 0) {
        figures.delete(f.seat);
        for (const meshes of [bodies, heads, arms, palms, glows, shadows]) put(meshes, f.seat, ZERO);
        continue;
      }
      pose(f);
    }
    if (expired) scheduleExpiry();
    // only the seats up to the highest one in use are sent to be drawn: an empty seat still costs its vertices
    const used = Math.max(0, ...[...figures.keys()].map((seat) => seat + 1), ...(mySeat === undefined ? [] : [mySeat + 1]));
    for (const mesh of instanced) mesh.count = used;
    renderer.render(scene, camera);
    // keep the "You" label over this person's head
    const f = mySeat === undefined ? undefined : figures.get(mySeat);
    if (f && f.pop.x > 0.5) {
      // the head's right edge on screen: its centre, moved right by the head's radius and a gap
      top.set(0, LABEL.y * f.pop.x, 0).applyMatrix4(seatAt[f.seat]);
      top.addScaledVector(side.setFromMatrixColumn(camera.matrixWorld, 0), HEAD.radius + LABEL.gap).project(camera);
      label.hidden = false;
      label.style.left = `${((top.x + 1) / 2) * view.clientWidth}px`;
      label.style.top = `${((1 - top.y) / 2) * view.clientHeight}px`;
    } else {
      label.hidden = true;
    }
    if (moving) kick();
  }
  document.addEventListener("visibilitychange", kick);
  calm.addEventListener("change", kick);

  /** Leave room for the whole figure and its raised hand, including seats at the ends of a row. */
  const p = new THREE.Vector3();
  function fit(): void {
    const width = view.clientWidth;
    const height = view.clientHeight;
    if (width === 0 || height === 0) return;
    if (renderer.domElement.width !== Math.floor(width * renderer.getPixelRatio()) ||
      renderer.domElement.height !== Math.floor(height * renderer.getPixelRatio())) renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.clearViewOffset();
    camera.updateMatrixWorld();
    // the people, with room above each for a raised hand, and the front row's ends so a small room still looks like a hall
    const points: THREE.Vector3[] = [];
    const seatPoint = new THREE.Vector3();
    for (const f of figures.values()) {
      if (!f.here) continue;
      seatPoint.setFromMatrixPosition(seatAt[f.seat]);
      for (const x of [-FIT.side, FIT.side]) for (const y of [FIT.bottom, FIT.top]) {
        points.push(seatPoint.clone().add(new THREE.Vector3(x, y, 0)));
      }
    }
    const r0 = radius(0) - ROW_GAP / 2;
    for (const a of [-ARC * FIT.frontArc, ARC * FIT.frontArc]) points.push(new THREE.Vector3(r0 * Math.sin(a), 0, r0 * Math.cos(a)));
    // the rows in front are always in view, seated or not, so someone alone sees a hall rather than their own back
    for (let row = 0; row < Math.min(rows, ROWS); row++) {
      for (const a of [-ARC * FIT.frontArc, 0, ARC * FIT.frontArc]) {
        points.push(new THREE.Vector3(radius(row) * Math.sin(a), rise(row) + FIT.top, radius(row) * Math.cos(a)));
      }
    }
    let left = Infinity;
    let right = -Infinity;
    let low = Infinity;
    let high = -Infinity;
    for (const point of points) {
      p.copy(point).applyMatrix4(camera.matrixWorldInverse);
      if (p.z > -camera.near) continue;
      left = Math.min(left, p.x / -p.z);
      right = Math.max(right, p.x / -p.z);
      low = Math.min(low, p.y / -p.z);
      high = Math.max(high, p.y / -p.z);
    }
    if (!Number.isFinite(left)) return;
    const half = Math.max((high - low) / 2, (right - left) / 2 / camera.aspect) * FIT.padding;
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(half));
    const x = ((right + left) / 2 / (half * camera.aspect)) * (width / 2);
    const y = -((high + low) / 2 / half) * (height / 2);
    camera.setViewOffset(width, height, x, y, width, height);
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(kick).observe(view);

  aimCamera();
  if (lastHall) show(lastHall);
  document.addEventListener("hands-up:hall", (event) => show((event as CustomEvent<Hall>).detail));
  kick();
}

/** Overlapping parts keep the small hand solid, with a notch above the sideways thumb. */
function handGeometry(grow: number): THREE.BufferGeometry {
  const fingerRadius = HAND.fingerWidth / 2;
  const parts: THREE.BufferGeometry[] = [new THREE.SphereGeometry(1, 12, 8).scale(
    HAND.palmWidth / 2 + grow, HAND.palmHeight / 2 + grow, HAND.depth / 2 + grow,
  )];
  for (const [i, length] of HAND.fingers.entries()) {
    parts.push(new THREE.CapsuleGeometry(fingerRadius + grow, length, 3, 6).translate(
      (i - (HAND.fingers.length - 1) / 2) * HAND.fingerWidth,
      HAND.palmHeight / 2 + length / 2 - fingerRadius, 0,
    ));
  }
  parts.push(new THREE.CapsuleGeometry(fingerRadius + grow, HAND.thumbLength, 3, 6)
    .rotateZ(HAND.thumbAngle).translate(HAND.thumbX, HAND.thumbY, 0));
  const hand = mergeGeometries(parts)!;
  for (const part of parts) part.dispose();
  return hand;
}

/** The steps the rows stand on: sunflower on top, darker where they rise. */
function stepsGeometry(count: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const from = Math.PI / 2 - ARC - STEP_MARGIN;
  const to = Math.PI / 2 + ARC + STEP_MARGIN;
  for (let row = 0; row < count; row++) {
    const shape = new THREE.Shape();
    shape.absarc(0, 0, radius(row) + ROW_GAP / 2, from, to, false);
    shape.absarc(0, 0, radius(row) - ROW_GAP / 2, to, from, true);
    const block = new THREE.ExtrudeGeometry(shape, { depth: rise(row) + FLOOR_DEPTH, bevelEnabled: false, curveSegments: 48 });
    // the shape lies flat, and the block hangs down from the row's floor
    block.rotateX(Math.PI / 2).translate(0, rise(row), 0);
    parts.push(block);
  }
  const steps = mergeGeometries(parts)!;
  for (const part of parts) part.dispose();
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
