import { describe, expect, it } from "vitest";
import { DisplayList, FLOATS_PER_BEAM_SEGMENT } from "@vector-display/core";
import bunny from "../src/data/bunny.json";
import spot from "../src/data/spot.json";
import teapot from "../src/data/teapot.json";
import { MESHES, MeshesDemo, type MeshEntry } from "../src/MeshesDemo.js";
import { DepthBuffer } from "../src/render/DepthBuffer.js";
import { MeshRenderer, type MeshView } from "../src/render/MeshRenderer.js";
import { buildTopology, loadStored, normalise, parseObj, weld, type StoredMesh } from "../src/sim/mesh.js";
import { cube, gear, torusKnot } from "../src/sim/shapes.js";

const VIEW: MeshView = { yaw: 0.6, pitch: 0.35, centreX: 800, centreY: 500, scale: 300, creaseDegrees: 30, mode: "FEATURES", hiddenLines: true };

function drawCounts(topology: ReturnType<typeof buildTopology>, view: Partial<MeshView> = {}) {
  const displayList = new DisplayList();
  const counts = new MeshRenderer().draw(displayList, topology, { ...VIEW, ...view });
  return { counts, displayList };
}

// Total length of everything drawn.
function inkLength(displayList: DisplayList): number {
  const data = displayList.getSegmentData();
  let total = 0;
  for (let segment = 0; segment < displayList.segmentCount; segment++) {
    const offset = segment * FLOATS_PER_BEAM_SEGMENT;
    total += Math.hypot(data[offset + 2] - data[offset], data[offset + 3] - data[offset + 1]);
  }
  return total;
}

describe("parseObj", () => {
  it("reads vertices and triangles, splitting larger faces into fans", () => {
    const mesh = parseObj("# a square\nv 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nvn 0 0 1\nf 1/1/1 2/2/1 3/3/1 4/4/1\n");
    expect(Array.from(mesh.positions)).toEqual([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]);
    expect(Array.from(mesh.indices)).toEqual([0, 1, 2, 0, 2, 3]);
  });

  it("counts negative indices back from the latest vertex", () => {
    const mesh = parseObj("v 0 0 0\nv 1 0 0\nv 0 1 0\nf -3 -2 -1\n");
    expect(Array.from(mesh.indices)).toEqual([0, 1, 2]);
  });
});

describe("weld and normalise", () => {
  it("merges repeated vertices so neighbouring triangles share them", () => {
    const separate = parseObj("v 0 0 0\nv 1 0 0\nv 0 1 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3\nf 4 5 6\n");
    expect(buildTopology(separate).edgeCount).toBe(6);
    const welded = weld(separate);
    expect(welded.positions.length / 3).toBe(4);
    // Two triangles sharing an edge have five edges between them.
    expect(buildTopology(welded).edgeCount).toBe(5);
  });

  it("drops triangles that collapse when their corners merge", () => {
    const mesh = weld(parseObj("v 0 0 0\nv 0 0 0\nv 1 0 0\nf 1 2 3\n"));
    expect(mesh.indices.length).toBe(0);
  });

  it("centres a mesh and fits it to a unit sphere", () => {
    const mesh = normalise(parseObj("v 10 10 10\nv 14 10 10\nv 10 12 10\nf 1 2 3\n"));
    let farthest = 0;
    for (let offset = 0; offset < mesh.positions.length; offset += 3) farthest = Math.max(farthest, Math.hypot(mesh.positions[offset], mesh.positions[offset + 1], mesh.positions[offset + 2]));
    expect(farthest).toBeCloseTo(1, 5);
  });
});

describe("buildTopology", () => {
  const topology = buildTopology(cube());

  it("finds the cube's edges and the triangles either side of each", () => {
    expect(topology.faceCount).toBe(12);
    // Twelve real edges and one diagonal across each of the six faces.
    expect(topology.edgeCount).toBe(18);
    for (let edge = 0; edge < topology.edgeCount; edge++) expect(topology.edgeFaces[edge * 2 + 1]).toBeGreaterThanOrEqual(0);
  });

  it("measures the real edges as right angles and the diagonals as flat", () => {
    const cosines = Array.from(topology.edgeCosine).map((value) => Math.round(value * 1000) / 1000);
    expect(cosines.filter((value) => value === 0)).toHaveLength(12);
    expect(cosines.filter((value) => value === 1)).toHaveLength(6);
  });

  it("points every normal outward", () => {
    const { positions, indices } = topology.mesh;
    for (let face = 0; face < topology.faceCount; face++) {
      const corner = indices[face * 3] * 3;
      const outward = topology.faceNormals[face * 3] * positions[corner] + topology.faceNormals[face * 3 + 1] * positions[corner + 1] + topology.faceNormals[face * 3 + 2] * positions[corner + 2];
      expect(outward).toBeGreaterThan(0);
    }
  });

  it("knows a closed surface from one with open borders", () => {
    expect(topology.isClosed).toBe(true);
    expect(buildTopology(weld(parseObj("v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4\n"))).isClosed).toBe(false);
  });

  it("marks the border of an open mesh", () => {
    const sheet = buildTopology(weld(parseObj("v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4\n")));
    const borders = Array.from({ length: sheet.edgeCount }, (_unused, edge) => sheet.edgeFaces[edge * 2 + 1]).filter((face) => face < 0);
    expect(borders).toHaveLength(4);
  });
});

describe("generated shapes", () => {
  it("makes a closed, smooth torus knot", () => {
    const topology = buildTopology(torusKnot());
    for (let edge = 0; edge < topology.edgeCount; edge++) expect(topology.edgeFaces[edge * 2 + 1]).toBeGreaterThanOrEqual(0);
    // No fold anywhere sharper than about 45 degrees.
    expect(Math.min(...topology.edgeCosine)).toBeGreaterThan(0.7);
  });

  it("makes a closed gear with plenty of sharp edges", () => {
    const topology = buildTopology(gear(12));
    for (let edge = 0; edge < topology.edgeCount; edge++) expect(topology.edgeFaces[edge * 2 + 1]).toBeGreaterThanOrEqual(0);
    const sharp = Array.from(topology.edgeCosine).filter((value) => value < 0.5).length;
    expect(sharp).toBeGreaterThan(100);
  });
});

describe.each([
  ["teapot", teapot],
  ["bunny", bunny],
  ["spot", spot],
] as const)("the bundled %s", (_name, data) => {
  const stored = data as unknown as StoredMesh;
  const topology = buildTopology(loadStored(stored));

  it("is a sensibly sized mesh inside the unit sphere, with a credit", () => {
    expect(stored.credit.length).toBeGreaterThan(5);
    expect(topology.faceCount).toBeGreaterThan(3000);
    expect(topology.faceCount).toBeLessThan(8000);
    let farthest = 0;
    const { positions } = topology.mesh;
    for (let offset = 0; offset < positions.length; offset += 3) farthest = Math.max(farthest, Math.hypot(positions[offset], positions[offset + 1], positions[offset + 2]));
    expect(farthest).toBeLessThanOrEqual(1.0001);
    expect(farthest).toBeGreaterThan(0.99);
  });

  it("draws far fewer feature edges than it has edges", () => {
    const { counts } = drawCounts(topology, { creaseDegrees: 45 });
    expect(counts.silhouette).toBeGreaterThan(50);
    expect(counts.silhouette + counts.crease).toBeLessThan(topology.edgeCount * 0.25);
  });
});

describe("DepthBuffer", () => {
  it("records the nearest surface over each cell a triangle covers", () => {
    const depth = new DepthBuffer(16);
    depth.fillTriangle(2, 2, 0.5, 12, 2, 0.5, 2, 12, 0.5);
    expect(depth.at(4, 4)).toBeCloseTo(0.5, 6);
    expect(depth.at(14, 14)).toBe(0);
    // A nearer triangle over part of it wins; a farther one does not.
    depth.fillTriangle(2, 2, 0.8, 6, 2, 0.8, 2, 6, 0.8);
    depth.fillTriangle(2, 2, 0.2, 12, 2, 0.2, 2, 12, 0.2);
    expect(depth.at(3, 3)).toBeCloseTo(0.8, 6);
    expect(depth.at(8, 3)).toBeCloseTo(0.5, 6);
  });

  it("fills the same cells whichever way round the corners are given", () => {
    const first = new DepthBuffer(16);
    const second = new DepthBuffer(16);
    first.fillTriangle(1, 1, 0.4, 13, 3, 0.4, 5, 14, 0.4);
    second.fillTriangle(5, 14, 0.4, 13, 3, 0.4, 1, 1, 0.4);
    for (let row = 0; row < 16; row++) for (let column = 0; column < 16; column++) expect(second.at(column, row)).toBe(first.at(column, row));
  });

  it("leaves no pinholes under a sliver thinner than a cell", () => {
    const depth = new DepthBuffer(32);
    depth.fillTriangle(2, 10.4, 0.5, 30, 10.6, 0.5, 30, 10.5, 0.5);
    for (let column = 4; column < 28; column++) expect(Math.max(depth.at(column, 9), depth.at(column, 10))).toBeGreaterThan(0);
  });

  it("slopes nearness across a tilted triangle", () => {
    const depth = new DepthBuffer(16);
    depth.fillTriangle(0, 0, 0.2, 16, 0, 0.6, 0, 16, 0.2);
    expect(depth.at(2, 2)).toBeLessThan(depth.at(10, 2));
    expect(depth.at(10, 2)).toBeCloseTo(0.2 + (10.5 / 16) * 0.4, 5);
  });

  it("hides the part of a line that passes behind a surface, and only that part", () => {
    const depth = new DepthBuffer(64);
    // A wall across the middle columns.
    depth.fillTriangle(20, 0, 0.5, 40, 0, 0.5, 40, 64, 0.5);
    depth.fillTriangle(20, 0, 0.5, 40, 64, 0.5, 20, 64, 0.5);
    const runs: number[][] = [];
    depth.traceVisible(2, 30, 0.3, 62, 30, 0.3, 0.01, (x0, y0, x1, y1) => runs.push([x0, y0, x1, y1]));
    expect(runs).toHaveLength(2);
    expect(runs[0][0]).toBeCloseTo(2, 5);
    expect(runs[0][2]).toBeGreaterThan(17);
    expect(runs[0][2]).toBeLessThan(22);
    expect(runs[1][0]).toBeGreaterThan(38);
    expect(runs[1][0]).toBeLessThan(43);
    expect(runs[1][2]).toBeCloseTo(62, 5);
  });

  it("shows a line in front of the surface, or lying on it, whole", () => {
    const depth = new DepthBuffer(64);
    depth.fillTriangle(0, 0, 0.5, 64, 0, 0.5, 0, 64, 0.5);
    for (const nearness of [0.7, 0.5]) {
      const runs: number[][] = [];
      depth.traceVisible(5, 5, nearness, 25, 20, nearness, 0.01, (x0, y0, x1, y1) => runs.push([x0, y0, x1, y1]));
      expect(runs).toHaveLength(1);
      expect(runs[0]).toEqual([5, 5, 25, 20]);
    }
  });
});

describe("MeshRenderer", () => {
  const box = buildTopology(cube());

  it("draws a cube's outline and folds but not the diagonals across its faces", () => {
    const { counts } = drawCounts(box);
    // From a corner view: six outline edges, and three folds meeting at the near corner.
    expect(counts.silhouette).toBe(6);
    expect(counts.crease).toBe(3);
    expect(counts.other).toBe(0);
  });

  it("adds the rest of the edges in all-edges mode", () => {
    const { counts } = drawCounts(box, { mode: "ALL EDGES" });
    expect(counts.silhouette).toBe(6);
    expect(counts.crease).toBe(3);
    // The diagonals of the three faces in view.
    expect(counts.other).toBe(3);
  });

  it("shows the far side's folds too when hidden lines are left in", () => {
    const { counts } = drawCounts(box, { hiddenLines: false });
    expect(counts.silhouette + counts.crease).toBe(12);
  });

  it("draws nothing as a crease when the angle is set above every fold", () => {
    const { counts } = drawCounts(box, { creaseDegrees: 95 });
    expect(counts.crease).toBe(0);
    expect(counts.silhouette).toBe(6);
  });

  it("cuts away what the mesh hides: less ink than with hidden lines shown", () => {
    const knot = buildTopology(torusKnot());
    const hidden = drawCounts(knot);
    const shown = drawCounts(knot, { hiddenLines: false });
    // A knot passes in front of itself, so some of its outline is covered.
    expect(inkLength(hidden.displayList)).toBeLessThan(inkLength(shown.displayList) * 0.9);
    expect(inkLength(hidden.displayList)).toBeGreaterThan(inkLength(shown.displayList) * 0.3);
  });

  it("keeps the whole outline of a shape that hides none of it", () => {
    // A cube's six outline edges and three near folds are all in plain view.
    const hidden = drawCounts(box);
    const shown = drawCounts(box, { hiddenLines: false });
    const expected = inkLength(shown.displayList) * (9 / 12);
    expect(inkLength(hidden.displayList)).toBeGreaterThan(expected * 0.8);
    expect(inkLength(hidden.displayList)).toBeLessThan(expected * 1.25);
  });

  it("puts the drawing where the view says, at the size it says", () => {
    const { displayList } = drawCounts(box, { centreX: 300, centreY: 200, scale: 100 });
    const data = displayList.getSegmentData();
    for (let segment = 0; segment < displayList.segmentCount; segment++) {
      const offset = segment * FLOATS_PER_BEAM_SEGMENT;
      expect(Math.abs(data[offset] - 300)).toBeLessThan(260);
      expect(Math.abs(data[offset + 1] - 200)).toBeLessThan(260);
    }
  });
});

describe("MeshesDemo", () => {
  const FRAME = { width: 1778, height: 1000, seconds: 0 };
  const SMALL: readonly MeshEntry[] = [
    { name: "CUBE", credit: "TEST", creaseDegrees: 30, load: async () => cube() },
    { name: "KNOT", credit: "TEST", creaseDegrees: 50, load: async () => torusKnot(2, 3, 60, 6) },
  ];

  function segments(demo: MeshesDemo): number {
    const displayList = new DisplayList();
    demo.draw(displayList, FRAME);
    return displayList.segmentCount;
  }

  it("draws nothing until the mesh has loaded, then fades it in", async () => {
    const demo = new MeshesDemo({ meshIndex: 0, meshes: SMALL });
    expect(demo.topology).toBeNull();
    expect(segments(demo)).toBe(0);
    await demo.whenLoaded();
    expect(demo.topology).not.toBeNull();
    for (let frame = 0; frame < 30; frame++) demo.update(1 / 60);
    expect(segments(demo)).toBeGreaterThan(0);
    expect(demo.edgeCounts.silhouette).toBeGreaterThan(0);
  });

  it("switches mesh after a fade, taking on that mesh's crease angle", async () => {
    const demo = new MeshesDemo({ meshIndex: 0, meshes: SMALL });
    demo.autoCycle = false;
    await demo.whenLoaded();
    for (let frame = 0; frame < 30; frame++) demo.update(1 / 60);
    expect(demo.creaseDegrees).toBe(30);
    demo.changeMesh(1);
    expect(demo.index).toBe(1);
    expect(demo.current.name).toBe("CUBE");
    await demo.whenLoaded();
    for (let frame = 0; frame < 60; frame++) demo.update(1 / 60);
    expect(demo.current.name).toBe("KNOT");
    expect(demo.creaseDegrees).toBe(50);
    demo.changeMesh(1);
    expect(demo.index).toBe(0);
  });

  it("reports a mesh that fails to load and lets it be tried again", async () => {
    let attempts = 0;
    const flaky: MeshEntry[] = [
      {
        name: "FLAKY",
        credit: "TEST",
        creaseDegrees: 30,
        load: async () => {
          attempts++;
          if (attempts === 1) throw new Error("offline");
          return cube();
        },
      },
    ];
    const original = console.error;
    console.error = () => {};
    try {
      const demo = new MeshesDemo({ meshIndex: 0, meshes: flaky });
      await demo.whenLoaded();
      expect(demo.topology).toBeNull();
      await demo.whenLoaded();
      expect(demo.topology).not.toBeNull();
    } finally {
      console.error = original;
    }
  });

  it("turns by hand and keeps the crease angle within its limits", () => {
    const demo = new MeshesDemo({ meshIndex: 0, meshes: SMALL });
    const before = demo.yaw;
    demo.rotateBy(0.4, 0);
    expect(demo.yaw).toBeCloseTo(before + 0.4, 6);
    expect(demo.autoCamera).toBe(false);
    for (let step = 0; step < 40; step++) demo.changeCrease(5);
    expect(demo.creaseDegrees).toBe(85);
    for (let step = 0; step < 40; step++) demo.changeCrease(-5);
    expect(demo.creaseDegrees).toBe(10);
  });

  it("lists the bundled meshes with credits", () => {
    expect(MESHES.map((entry) => entry.name)).toEqual(["UTAH TEAPOT", "STANFORD BUNNY", "GEAR", "SPOT", "TORUS KNOT"]);
    for (const entry of MESHES) expect(entry.credit.length).toBeGreaterThan(0);
  });
});
