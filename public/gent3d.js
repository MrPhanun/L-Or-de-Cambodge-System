'use strict';

/* Small 3D man next to the greeting. Built from primitives with three.js.
   Loops: hold tie -> tighten -> arm down -> wave, and cycles outfits
   (suit & tie -> tuxedo & bow tie -> casual shirt) with a turn at each change. */
(function () {
  const canvas = document.getElementById('gent');
  if (!canvas || !window.THREE) return;

  const POSE_SECONDS = 9;
  const OUTFIT_SECONDS = 12;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(canvas.clientWidth || 104, canvas.clientHeight || 104, false);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
  camera.position.set(0, 1.5, 9.8);
  camera.lookAt(0, 1.5, 0);

  scene.add(new THREE.HemisphereLight(0xdde6ff, 0x1a2040, 1.0));
  const key = new THREE.DirectionalLight(0xffffff, 1.1);
  key.position.set(2.5, 4, 5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x6f94ff, 1.2);
  rim.position.set(-4, 2, -3);
  scene.add(rim);

  const mat = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05 });
  const skin = mat(0xe8b58f);
  const hairMat = mat(0x2a1c16);
  const jacket = mat(0x23305e);
  const trouser = mat(0x1a2246);
  const shirt = mat(0xf4f6fb);
  const tieMat = mat(0x4669be);
  const bowMat = mat(0xffffff);
  const shoeMat = mat(0x0b0d14);

  function mesh(geo, material, x, y, z, parent) {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x || 0, y || 0, z || 0);
    if (parent) parent.add(m);
    return m;
  }

  const root = new THREE.Group();
  scene.add(root);

  // legs and shoes
  [-0.22, 0.22].forEach((x) => {
    mesh(new THREE.CylinderGeometry(0.17, 0.15, 1.2, 16), trouser, x, 0.62, 0, root);
    mesh(new THREE.BoxGeometry(0.3, 0.14, 0.52), shoeMat, x, 0.07, 0.1, root);
  });

  // torso (jacket)
  const torso = mesh(new THREE.CylinderGeometry(0.62, 0.5, 1.3, 24), jacket, 0, 1.6, 0, root);
  torso.scale.z = 0.62;
  // shirt panel / chest
  const chest = mesh(new THREE.BoxGeometry(0.34, 0.9, 0.05), shirt, 0, 1.75, 0.37, root);

  const coatMat = jacket; // arms and sleeves share the suit colour

  // suit lapels, buttons and pocket square
  [-1, 1].forEach((s) => {
    const lapel = mesh(new THREE.BoxGeometry(0.1, 0.95, 0.04), jacket, s * 0.3, 1.75, 0.39, root);
    lapel.rotation.z = s * 0.28;
  });
  [1.35, 1.1].forEach((y) => mesh(new THREE.SphereGeometry(0.035, 8, 8), shoeMat, 0.0, y, 0.4, root));
  mesh(new THREE.BoxGeometry(0.14, 0.07, 0.04), shirt, -0.38, 1.95, 0.4, root);

  // neck + head
  mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.22, 16), skin, 0, 2.32, 0, root);
  const head = new THREE.Group();
  head.position.set(0, 2.72, 0);
  root.add(head);
  mesh(new THREE.SphereGeometry(0.34, 24, 20), skin, 0, 0, 0, head).scale.set(0.88, 1.05, 0.95);
  const hair = mesh(new THREE.SphereGeometry(0.355, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), hairMat, 0, 0.06, -0.02, head);
  hair.scale.set(0.9, 1.05, 0.98);
  [-0.12, 0.12].forEach((x) => mesh(new THREE.SphereGeometry(0.035, 8, 8), hairMat, x, 0.02, 0.3, head));
  // short beard along the jaw
  const beard = mesh(new THREE.SphereGeometry(0.352, 24, 12, 0, Math.PI * 2, Math.PI * 0.74, Math.PI * 0.2), hairMat, 0, -0.01, 0.02, head);
  beard.scale.set(0.9, 1.05, 0.98);
  // yellow sunglasses
  const lensMat = new THREE.MeshStandardMaterial({ color: 0xf2b21a, roughness: 0.2, metalness: 0.4, emissive: 0x6b4a00 });
  [-0.12, 0.12].forEach((x) => mesh(new THREE.BoxGeometry(0.19, 0.1, 0.04), lensMat, x, 0.03, 0.31, head));
  mesh(new THREE.BoxGeometry(0.1, 0.02, 0.04), shoeMat, 0, 0.05, 0.31, head);
  mesh(new THREE.BoxGeometry(0.62, 0.02, 0.03), shoeMat, 0, 0.06, 0.2, head);

  // tie and bow tie
  const tie = new THREE.Group();
  tie.position.set(0, 2.2, 0.39);
  root.add(tie);
  const tieKnot = mesh(new THREE.BoxGeometry(0.12, 0.12, 0.07), tieMat, 0, 0, 0, tie);
  const tieBlade = mesh(new THREE.CylinderGeometry(0.06, 0.1, 0.8, 4), tieMat, 0, -0.45, -0.005, tie);
  tieBlade.scale.z = 0.3;
  tieBlade.rotation.y = Math.PI / 4;

  const bow = new THREE.Group();
  bow.position.set(0, 2.2, 0.4);
  root.add(bow);
  [-1, 1].forEach((s) => {
    const wing = mesh(new THREE.ConeGeometry(0.12, 0.2, 4), bowMat, s * 0.1, 0, 0, bow);
    wing.rotation.z = s * Math.PI / 2;
    wing.scale.z = 0.4;
  });
  mesh(new THREE.SphereGeometry(0.05, 10, 10), bowMat, 0, 0, 0.01, bow);

  // shirt collar opening for the casual outfit
  const casualPatch = mesh(new THREE.SphereGeometry(0.17, 16, 12), skin, 0, 2.3, 0.3, root);
  casualPatch.scale.set(1, 0.8, 0.5);

  // gold-and-steel dive watch on the wrist
  const gold = new THREE.MeshStandardMaterial({ color: 0xd6a932, roughness: 0.25, metalness: 0.9 });
  const steel = new THREE.MeshStandardMaterial({ color: 0xc9ced8, roughness: 0.3, metalness: 0.85 });
  const dialMat = new THREE.MeshStandardMaterial({ color: 0x0b1a14, roughness: 0.3, metalness: 0.4 });
  function addWatch(elbow) {
    const y = -0.6;
    mesh(new THREE.CylinderGeometry(0.118, 0.118, 0.1, 20), steel, 0, y, 0, elbow); // band
    mesh(new THREE.CylinderGeometry(0.122, 0.122, 0.03, 20), gold, 0, y, 0, elbow); // gold link
    const head = new THREE.Group();
    head.position.set(0, y, 0.12);
    head.rotation.x = Math.PI / 2;
    elbow.add(head);
    mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.035, 24), gold, 0, 0, 0, head);   // case + bezel
    mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.04, 24), dialMat, 0, 0.004, 0, head); // dial
    mesh(new THREE.BoxGeometry(0.01, 0.042, 0.05), gold, 0, 0.006, -0.02, head);       // hands
    mesh(new THREE.BoxGeometry(0.01, 0.042, 0.035), gold, 0.015, 0.006, 0.005, head);
  }

  // arms: shoulder -> upper arm -> elbow -> forearm -> hand
  function makeArm(side) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.7, 2.18, 0);
    root.add(shoulder);
    mesh(new THREE.SphereGeometry(0.17, 14, 12), coatMat, 0, 0, 0, shoulder);
    mesh(new THREE.CylinderGeometry(0.14, 0.12, 0.72, 14), coatMat, 0, -0.38, 0, shoulder);
    const elbow = new THREE.Group();
    elbow.position.set(0, -0.76, 0);
    shoulder.add(elbow);
    mesh(new THREE.SphereGeometry(0.12, 12, 10), coatMat, 0, 0, 0, elbow);
    mesh(new THREE.CylinderGeometry(0.12, 0.1, 0.66, 14), coatMat, 0, -0.34, 0, elbow);
    mesh(new THREE.SphereGeometry(0.115, 14, 12), skin, 0, -0.74, 0, elbow);
    addWatch(elbow);
    return { shoulder, elbow };
  }
  const armL = makeArm(-1); // idle arm
  const armR = makeArm(1);  // working arm

  // ---- poses (radians): upper arm [x, y, z], elbow [x, y, z] ----
  const POSES = {
    tie:   { s: [-0.41, -0.27, -0.55], e: [-2.27, -0.42, -0.36] },
    tight: { s: [-0.35, -0.13, -0.67], e: [-2.14, 0.05, -0.37] },
    down:  { s: [0, 0, 0.12], e: [-0.05, 0, 0] },
    up:    { s: [0, 0, 2.7], e: [0, 0, -0.3] },
    waveA: { s: [0, 0, 2.55], e: [0, 0, -0.7] },
    waveB: { s: [0, 0, 2.85], e: [0, 0, 0.05] }
  };
  // [fraction of the 9s loop, pose]
  const TIMELINE = [
    [0.00, 'tie'], [0.12, 'tie'], [0.17, 'tight'], [0.22, 'tie'], [0.40, 'tie'],
    [0.48, 'down'], [0.56, 'up'], [0.62, 'waveA'], [0.67, 'waveB'], [0.72, 'waveA'],
    [0.77, 'waveB'], [0.82, 'waveA'], [0.88, 'up'], [0.95, 'down'], [1.00, 'tie']
  ];

  const ease = (x) => x * x * (3 - 2 * x);
  const lerp = (a, b, k) => a + (b - a) * k;
  function sample(phase) {
    for (let i = 0; i < TIMELINE.length - 1; i++) {
      const [t0, n0] = TIMELINE[i];
      const [t1, n1] = TIMELINE[i + 1];
      if (phase >= t0 && phase <= t1) {
        const k = t1 === t0 ? 1 : ease((phase - t0) / (t1 - t0));
        const a = POSES[n0], b = POSES[n1];
        return {
          s: a.s.map((v, j) => lerp(v, b.s[j], k)),
          e: a.e.map((v, j) => lerp(v, b.e[j], k))
        };
      }
    }
    return POSES.tie;
  }

  // ---- outfits ----
  const OUTFITS = [
    { jacket: 0x1d2a52, trouser: 0x1d2a52, tie: true,  bow: false, open: false },
    { jacket: 0x0e1018, trouser: 0x0e1018, tie: false, bow: true,  open: false },
    { jacket: 0x4a7a8c, trouser: 0x3a3f52, tie: false, bow: false, open: true  }
  ];
  const _c = new THREE.Color();
  let outfitIdx = -1;
  function applyOutfit(i) {
    const o = OUTFITS[i];
    jacket.color.setHex(o.jacket);
    trouser.color.setHex(o.trouser);
    tie.visible = o.tie;
    bow.visible = o.bow;
    casualPatch.visible = o.open;
    shirt.color.setHex(o.open ? 0x4a7a8c : (o.bow ? 0xf4f6fb : 0xaab3cc));
  }
  applyOutfit(0);

  // ---- loop ----
  let startTime = null;
  function frame(now) {
    requestAnimationFrame(frame);
    const ready = document.body.classList.contains('ready');
    if (!ready) { renderer.clear(); return; }
    if (startTime === null) startTime = now;
    const t = (now - startTime) / 1000;

    // entrance: scale up and spin in
    const enter = ease(Math.min(Math.max((t - 0.1) / 1.2, 0), 1));
    root.scale.setScalar(Math.max(enter, 0.0001));
    let yaw = (1 - enter) * -Math.PI * 1.5;

    if (!reduceMotion) {
      const oc = Math.floor(t / OUTFIT_SECONDS) % OUTFITS.length;
      const inCycle = (t % OUTFIT_SECONDS);
      // turn once at each outfit change (swap the outfit while facing away)
      const spinStart = OUTFIT_SECONDS - 1.2;
      if (t > OUTFIT_SECONDS - 1.2 && inCycle >= spinStart) {
        const k = ease((inCycle - spinStart) / 1.2);
        yaw += k * Math.PI * 2;
        const next = (oc + 1) % OUTFITS.length;
        if (k > 0.5 && outfitIdx !== next) { outfitIdx = next; applyOutfit(next); }
      } else if (outfitIdx !== oc && !(inCycle >= spinStart)) {
        outfitIdx = oc; applyOutfit(oc);
      }

      const phase = (t % POSE_SECONDS) / POSE_SECONDS;
      const p = sample(phase);
      armR.shoulder.rotation.set(p.s[0], p.s[1], p.s[2]);
      armR.elbow.rotation.set(p.e[0], p.e[1], p.e[2]);
      armL.shoulder.rotation.set(Math.sin(t * 1.2) * 0.04, 0, -0.1 - Math.sin(t * 1.2) * 0.03);
      armL.elbow.rotation.set(-0.1, 0, 0);

      root.position.y = Math.sin(t * 2.2) * 0.025;
      head.rotation.y = Math.sin(t * 0.9) * 0.22;
      head.rotation.z = Math.sin(t * 0.7) * 0.05;
      tie.rotation.x = Math.sin(t * 2.2) * 0.04;
    } else {
      armR.shoulder.rotation.set(POSES.tie.s[0], POSES.tie.s[1], POSES.tie.s[2]);
      armR.elbow.rotation.set(POSES.tie.e[0], POSES.tie.e[1], POSES.tie.e[2]);
      armL.shoulder.rotation.z = -0.1;
    }

    root.rotation.y = yaw + (reduceMotion ? 0 : Math.sin(t * 0.6) * 0.25);
    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);
})();
