// Fleet layout: the geometry behind Live > Fleet (renderer/fleet.js), with no
// DOM, no clock and no I/O so it can be tested on its own. Pods are columns of
// seat cards, left to right; every wire between two seats is one orthogonal
// polyline (only horizontal and vertical segments) that runs through the
// gutters between the columns, and over or under them by a rail when it skips a
// column. Every wire in a gutter or on a rail has a lane of its own, so no two
// wires ever run along the same line. The same input always gives the same
// picture. Also here: the camera maths, keyboard neighbours and a tidy tree.
(function () {
  "use strict";

  const SIZE = Object.freeze({
    seatW: 176, seatH: 60, gapY: 14,
    podPad: 12, podHead: 30,
    margin: 24, gutterMin: 52, gutterPad: 18, lane: 10,
    railPad: 20,
    // The tidy tree.
    treeCol: 190, treeRow: 34, treeNode: 8,
  });
  // The strongest reason two seats are wired, first: it colours the wire.
  const KIND_RANK = ["escalate", "rework", "handoff", "delegation", "verify", "desk", "report", "dispatch", "mail"];

  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
  const seatKey = (from, to) => `${from}>${to}`;

  // Lowest lane whose last interval ended before this one starts; intervals
  // are [start, end] and `gap` keeps neighbours apart.
  function assignLanes(items, gap) {
    const lanes = [];
    const laneOf = new Map();
    for (const item of [...items].sort((a, b) => a.start - b.start || a.end - b.end || a.key.localeCompare(b.key))) {
      let lane = lanes.findIndex((end) => end + gap < item.start);
      if (lane < 0) { lane = lanes.length; lanes.push(item.end); } else lanes[lane] = item.end;
      laneOf.set(item.key, lane);
    }
    return { laneOf, count: lanes.length };
  }

  // Straight runs lose their middle points; repeated points collapse.
  function simplify(points) {
    const out = [];
    for (const point of points) {
      const last = out.at(-1);
      if (last && last[0] === point[0] && last[1] === point[1]) continue;
      out.push(point);
    }
    for (let index = out.length - 2; index > 0; index -= 1) {
      const [a, b, c] = [out[index - 1], out[index], out[index + 1]];
      if ((a[0] === b[0] && b[0] === c[0]) || (a[1] === b[1] && b[1] === c[1])) out.splice(index, 1);
    }
    return out;
  }

  // Where a label goes: the middle of the longest segment.
  function labelPoint(points) {
    let best = { length: -1, x: points[0]?.[0] ?? 0, y: points[0]?.[1] ?? 0 };
    for (let index = 1; index < points.length; index += 1) {
      const [a, b] = [points[index - 1], points[index]];
      const length = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
      if (length > best.length) best = { length, x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2 };
    }
    return { x: best.x, y: best.y };
  }

  // view: { pods: [{ id, label, seats: [{ id }] }], edges: [{ from, to, kind, count, lastAt }] }
  function layoutPods(view, options = {}) {
    const S = { ...SIZE, ...options };
    const columns = (view?.pods ?? []).filter((pod) => pod?.seats?.length).map((pod) => ({ id: pod.id, label: pod.label ?? pod.id, seats: pod.seats.map((seat) => seat.id) }));
    const edgesIn = (view?.edges ?? []).filter((edge) => edge && edge.from && edge.to && edge.from !== edge.to);
    if (edgesIn.some((edge) => edge.from === "you" || edge.to === "you")) columns.push({ id: "you", label: "You", seats: ["you"] });
    const podOf = new Map();
    columns.forEach((column, index) => column.seats.forEach((id) => podOf.set(id, index)));

    // One wire per ordered pair, carrying every reason the pair is wired.
    const merged = new Map();
    for (const edge of edgesIn) {
      if (!podOf.has(edge.from) || !podOf.has(edge.to)) continue;
      const key = seatKey(edge.from, edge.to);
      const wire = merged.get(key) ?? { key, from: edge.from, to: edge.to, kinds: [], count: 0, lastAt: 0 };
      if (edge.kind && !wire.kinds.includes(edge.kind)) wire.kinds.push(edge.kind);
      wire.count += Math.max(1, Number(edge.count) || 1);
      wire.lastAt = Math.max(wire.lastAt, Number(edge.lastAt) || 0);
      merged.set(key, wire);
    }
    const wires = [...merged.values()].map((wire) => ({ ...wire, kinds: [...wire.kinds].sort((a, b) => KIND_RANK.indexOf(a) - KIND_RANK.indexOf(b)) }));
    for (const wire of wires) wire.kind = wire.kinds[0] ?? "mail";

    // Rows first: heights do not depend on the gutters.
    const podH = (column) => S.podHead + S.podPad + column.seats.length * S.seatH + Math.max(0, column.seats.length - 1) * S.gapY + S.podPad;
    const rowsY = new Map();
    columns.forEach((column) => column.seats.forEach((id, row) => rowsY.set(id, S.podHead + S.podPad + row * (S.seatH + S.gapY))));
    const centerY = (id) => rowsY.get(id) + S.seatH / 2;

    // Route each wire through channels: the gutter to the right of a pod
    // (index = the pod), plus a top rail (forward) or bottom rail (backward)
    // when it skips a column.
    const use = new Map(); // gutter index -> [{ key, start, end }]
    const rails = { top: [], bottom: [] };
    const addUse = (gutter, key, start, end) => { if (!use.has(gutter)) use.set(gutter, []); use.get(gutter).push({ key, start: Math.min(start, end), end: Math.max(start, end) }); };
    for (const wire of wires) {
      const i = podOf.get(wire.from);
      const j = podOf.get(wire.to);
      const yA = centerY(wire.from);
      const yB = centerY(wire.to);
      if (i === j) wire.route = { type: "same", g: i };
      else if (j === i + 1) wire.route = { type: "forward", g: i };
      else if (j === i - 1) wire.route = { type: "back", g: j };
      else if (j > i) wire.route = { type: "forward-skip", a: i, b: j - 1 };
      else wire.route = { type: "back-skip", a: i - 1, b: j };
      const r = wire.route;
      if (r.g !== undefined) addUse(r.g, wire.key, yA, yB);
      else if (r.type === "forward-skip") { addUse(r.a, `${wire.key}#a`, -1e9, yA); addUse(r.b, `${wire.key}#b`, -1e9, yB); rails.top.push({ key: wire.key, start: r.a, end: r.b }); }
      else { addUse(r.a, `${wire.key}#a`, yA, 1e9); addUse(r.b, `${wire.key}#b`, yB, 1e9); rails.bottom.push({ key: wire.key, start: r.b, end: r.a }); }
    }
    const lanes = columns.map((_, gutter) => assignLanes(use.get(gutter) ?? [], 4));
    const topLanes = assignLanes(rails.top, -1);
    const bottomLanes = assignLanes(rails.bottom, -1);

    // Widths and heights now that the lanes are known.
    const gutterW = columns.map((_, gutter) => {
      const count = lanes[gutter].count;
      return gutter === columns.length - 1 && !count ? S.margin : Math.max(S.gutterMin, 2 * S.gutterPad + Math.max(0, count - 1) * S.lane);
    });
    const topH = topLanes.count ? 2 * S.railPad + (topLanes.count - 1) * S.lane : 0;
    const originY = S.margin + topH;
    const pods = [];
    let x = S.margin;
    columns.forEach((column, index) => {
      const w = S.seatW + 2 * S.podPad;
      pods.push({ id: column.id, label: column.label, x, y: originY, w, h: podH(column), seats: column.seats });
      x += w + gutterW[index];
    });
    const maxBottom = Math.max(originY, ...pods.map((pod) => pod.y + pod.h));
    const laneX = (gutter, lane) => pods[gutter].x + pods[gutter].w + S.gutterPad + lane * S.lane;
    const seats = [];
    for (const pod of pods) pod.seats.forEach((id) => seats.push({ id, pod: pod.id, x: pod.x + S.podPad, y: pod.y + rowsY.get(id), w: S.seatW, h: S.seatH }));
    const seat = new Map(seats.map((item) => [item.id, item]));

    for (const wire of wires) {
      const A = seat.get(wire.from);
      const B = seat.get(wire.to);
      const yA = A.y + S.seatH / 2;
      const yB = B.y + S.seatH / 2;
      const r = wire.route;
      let points;
      if (r.type === "same") {
        const gx = laneX(r.g, lanes[r.g].laneOf.get(wire.key));
        points = [[A.x + S.seatW, yA], [gx, yA], [gx, yB], [B.x + S.seatW, yB]];
      } else if (r.type === "forward") {
        const gx = laneX(r.g, lanes[r.g].laneOf.get(wire.key));
        points = [[A.x + S.seatW, yA], [gx, yA], [gx, yB], [B.x, yB]];
      } else if (r.type === "back") {
        const gx = laneX(r.g, lanes[r.g].laneOf.get(wire.key));
        points = [[A.x, yA], [gx, yA], [gx, yB], [B.x + S.seatW, yB]];
      } else if (r.type === "forward-skip") {
        const ga = laneX(r.a, lanes[r.a].laneOf.get(`${wire.key}#a`));
        const gb = laneX(r.b, lanes[r.b].laneOf.get(`${wire.key}#b`));
        const ry = S.margin + S.railPad + topLanes.laneOf.get(wire.key) * S.lane;
        points = [[A.x + S.seatW, yA], [ga, yA], [ga, ry], [gb, ry], [gb, yB], [B.x, yB]];
      } else {
        const ga = laneX(r.a, lanes[r.a].laneOf.get(`${wire.key}#a`));
        const gb = laneX(r.b, lanes[r.b].laneOf.get(`${wire.key}#b`));
        const ry = maxBottom + S.railPad + bottomLanes.laneOf.get(wire.key) * S.lane;
        points = [[A.x, yA], [ga, yA], [ga, ry], [gb, ry], [gb, yB], [B.x + S.seatW, yB]];
      }
      wire.points = simplify(points);
      wire.label = labelPoint(wire.points);
      wire.id = wire.key;
      delete wire.route;
      delete wire.key;
    }
    const bottomH = bottomLanes.count ? 2 * S.railPad + (bottomLanes.count - 1) * S.lane : 0;
    const last = pods.at(-1);
    const bounds = { w: last ? last.x + last.w + gutterW.at(-1) : 2 * S.margin, h: maxBottom + bottomH + S.margin };
    return { pods, seats, wires, bounds, size: { seatW: S.seatW, seatH: S.seatH } };
  }

  // The seat a keyboard arrow reaches: up and down stay in the pod, left and
  // right go to the nearest pod on that side and pick the seat at the closest height.
  function neighbor(layout, id, direction) {
    const from = layout?.seats?.find((item) => item.id === id);
    if (!from) return null;
    if (direction === "up" || direction === "down") {
      const column = layout.seats.filter((item) => item.pod === from.pod).sort((a, b) => a.y - b.y);
      return column[column.indexOf(from) + (direction === "down" ? 1 : -1)]?.id ?? null;
    }
    const at = layout.pods.findIndex((pod) => pod.id === from.pod);
    const step = direction === "right" ? 1 : -1;
    for (let index = at + step; index >= 0 && index < layout.pods.length; index += step) {
      const candidates = layout.seats.filter((item) => item.pod === layout.pods[index].id);
      if (!candidates.length) continue;
      candidates.sort((a, b) => Math.abs(a.y - from.y) - Math.abs(b.y - from.y) || a.y - b.y);
      return candidates[0].id;
    }
    return null;
  }

  // ---- the camera ---------------------------------------------------------------------
  // { k, x, y }: the stage is scaled by k, then moved by (x, y), from its top left.
  const ZOOM = Object.freeze({ min: 0.3, max: 2 });
  function fit(bounds, viewport, { pad = 16, min = 0.3, max = 1.25 } = {}) {
    const w = Math.max(1, bounds?.w || 1);
    const h = Math.max(1, bounds?.h || 1);
    const k = clamp(Math.min((viewport.w - 2 * pad) / w, (viewport.h - 2 * pad) / h), min, max);
    return { k, x: Math.round((viewport.w - w * k) / 2), y: Math.max(pad, Math.round((viewport.h - h * k) / 2)) };
  }
  // Zoom about a point of the viewport, keeping what is under it where it is.
  function zoomAt(camera, factor, px, py) {
    const k = clamp(camera.k * factor, ZOOM.min, ZOOM.max);
    const ratio = k / camera.k;
    return { k, x: px - (px - camera.x) * ratio, y: py - (py - camera.y) * ratio };
  }
  // Keep some of the stage in view: it may not be dragged fully out of the viewport.
  function constrain(camera, bounds, viewport, keep = 80) {
    const w = bounds.w * camera.k;
    const h = bounds.h * camera.k;
    return { k: camera.k, x: clamp(camera.x, keep - w, viewport.w - keep), y: clamp(camera.y, keep - h, viewport.h - keep) };
  }

  // ---- the tidy tree ------------------------------------------------------------------
  // node: { id, label, kind, status, children: [] }. Leaves stack in rows;
  // every parent is centred on its children; depth sets the column.
  function tidyTree(root, options = {}) {
    const S = { ...SIZE, ...options };
    const nodes = [];
    const links = [];
    let row = 0;
    const place = (node, depth, parent) => {
      const children = (node.children ?? []).map((child) => place(child, depth + 1, node));
      const y = children.length ? (children[0].y + children.at(-1).y) / 2 : row++ * S.treeRow;
      const placed = { id: node.id, label: node.label ?? node.id, kind: node.kind ?? "seat", status: node.status ?? null, depth, x: depth * S.treeCol, y, parent: parent?.id ?? null, leaf: !children.length, hint: node.hint ?? null };
      nodes.push(placed);
      if (parent) links.push({ from: parent.id, to: node.id });
      return placed;
    };
    if (root) place(root, 0, null);
    const maxDepth = Math.max(0, ...nodes.map((node) => node.depth));
    return { nodes: nodes.sort((a, b) => a.depth - b.depth || a.y - b.y), links, bounds: { w: maxDepth * S.treeCol + S.treeCol, h: Math.max(row, 1) * S.treeRow } };
  }

  window.MefiFleetLayout = { SIZE, KIND_RANK, ZOOM, layoutPods, neighbor, fit, zoomAt, constrain, tidyTree, assignLanes, simplify };
})();
