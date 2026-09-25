'use strict';
// Sector 07: the whole demo as data. Geometry, models, entities, GUI surfaces, render targets and
// the phone's pages are all described here; the engine code only interprets it.
//
// Units are metres; +Y is up and the player starts looking down -Z ("north").
// Model parts: { box: [x0, y0, z0, x1, y1, z1], mat } | { cylinder: [cx, cy, cz], r, len, axis, mat, seg? }
// Materials: names from `materials` below (patterns / signals: see js/render/materials.js)

const SCENARIO = (() => {
const box = (x0, y0, z0, x1, y1, z1, mat) => ({ box: [x0, y0, z0, x1, y1, z1], mat });
const cyl = (c, r, len, axis, mat, seg) => ({ cylinder: c, r, len, axis, mat, seg });
const securityCamera = (id, label, name, loc, pos, target, sweep, speed, extra = {}) =>
    ({ type: 'securityCamera', id, label, name, loc, model: 'securityCamera', pos, target, sweep, speed, ...extra });

return {
    player: {
        start: { pos: [-0.75, 1.6, -1.35], yaw: 0.02, pitch: -0.03 },
        fovDeg: 60,
        walkSpeed: 2.6,
        runSpeed: 5,
        stride: { walk: 0.72, run: 0.95 },
        bounds: { x: [-3.7, 3.7], z: [-3.3, 5.6] },
        // Hatch B lets the player into corridor B once it's open
        doorway: { door: 'hatchB', x: [1.15, 2.45], enterZ: -3.35, minZ: -7.6 }
    },

    facility: {
        log: [
            'BOOT SEQUENCE COMPLETE',
            'LIFE SUPPORT: NOMINAL',
            'MAINT: HATCH B LOCKED - CODE ON FILE',
            'TIP: [TAB] TOGGLES YOUR HANDHELD'
        ]
    },

    // ---------------------------------------------------------------- materials
    // { pattern?, args?, albedo, spec?, shin?, emissive?: { color, signal?, base?, gain?, rate?, spread?, duty?, idle? } }
    // Emission = color * (base + gain * signal); `idle` = level used while the instance isn't selected.
    materials: {
        wall:       { pattern: 'panels', albedo: [0.16, 0.17, 0.18], spec: 0.35, shin: 28 },
        floorGrate: { pattern: 'grating', albedo: [0.24, 0.23, 0.21], spec: 0.7, shin: 40 },
        copper:     { pattern: 'mottled', albedo: [0.40, 0.24, 0.12], spec: 0.8, shin: 36 },
        door:       { pattern: 'door', albedo: [0.30, 0.32, 0.34], spec: 0.5, shin: 32 },
        // Glows with the first light (the lamp)
        bulb:       { albedo: [0, 0, 0], emissive: { color: [1, 1, 1], signal: 'light0', base: 0.08, gain: 0.5 } },
        darkMetal:  { pattern: 'plates', albedo: [0.10, 0.11, 0.12], spec: 0.45, shin: 30 },
        glass:      { albedo: [0.004, 0.012, 0.014], spec: 1.2, shin: 110 },
        redGlow:    { albedo: [0.05, 0.05, 0.05], emissive: { color: [1, 0.07, 0.02], signal: 'wave', base: 1.1, gain: 0.25, rate: 2.3 } },
        ceiling:    { pattern: 'tiles', albedo: [0.085, 0.09, 0.095], spec: 0.2, shin: 16 },
        hazard:     { pattern: 'hazard', albedo: [0.75, 0.55, 0.04], spec: 0.4, shin: 24 },
        led:        { albedo: [0.02, 0.02, 0.02], emissive: { color: [0.15, 1, 0.35], signal: 'blink', base: 0.3, gain: 1.7, rate: 0.6, spread: 3.7, duty: 0.35 } },
        lightMetal: { albedo: [0.18, 0.2, 0.16], spec: 0.7, shin: 40 },
        beacon:     { albedo: [0.08, 0.01, 0.01], emissive: { color: [1, 0.08, 0.03], signal: 'alarm', base: 0.12, gain: 3 } },
        // Red tally LED: blinks while its camera / drone is selected
        tally:      { albedo: [0.05, 0, 0], emissive: { color: [1, 0.06, 0.03], signal: 'blink', base: 0.2, gain: 3, rate: 1.5, duty: 0.5, idle: 0.35 } },
        armour:     { pattern: 'bands', albedo: [0.15, 0.19, 0.12], spec: 0.5, shin: 30 },
        phoneBody:  { albedo: [0.035, 0.037, 0.042], spec: 0.9, shin: 70, emissive: { color: [0.012, 0.013, 0.015] } },
        wood:       { pattern: 'wood', albedo: [0.36, 0.23, 0.12], spec: 0.25, shin: 20 }
    },

    // ---------------------------------------------------------------- models
    models: {
        level: [
            // Room shell
            box(-4, -0.1, -4.2, 4, 0, 6, 'floorGrate'),
            box(-4, 3.5, -4.2, 4, 3.6, 6, 'ceiling'),
            box(-4.2, 0, -4.2, -4, 3.5, 6, 'wall'),
            box(4, 0, -4.2, 4.2, 3.5, 6, 'wall'),
            box(-4.2, 0, 6, 4.2, 3.5, 6.2, 'wall'),
            // Back wall with the hatch B doorway (x 0.8..2.8, height 2.6)
            box(-4, 0, -4.2, 0.8, 3.5, -4.0, 'wall'),
            box(2.8, 0, -4.2, 4, 3.5, -4.0, 'wall'),
            box(0.8, 2.6, -4.2, 2.8, 3.5, -4.0, 'wall'),
            box(0.6, 0, -4.0, 0.8, 2.8, -3.88, 'hazard'),
            box(2.8, 0, -4.0, 3.0, 2.8, -3.88, 'hazard'),
            box(0.6, 2.6, -4.0, 3.0, 2.8, -3.88, 'hazard'),
            box(1.62, 2.86, -4.0, 1.98, 3.02, -3.82, 'beacon'),
            // Corridor B behind the hatch
            box(0.8, -0.1, -8, 2.8, 0, -4.2, 'floorGrate'),
            box(0.8, 2.6, -8, 2.8, 2.7, -4.2, 'ceiling'),
            box(0.6, 0, -8, 0.8, 2.6, -4.2, 'wall'),
            box(2.8, 0, -8, 3.0, 2.6, -4.2, 'wall'),
            box(0.8, 0, -8.2, 2.8, 2.6, -8, 'wall'),
            box(1.3, 0.7, -8.0, 2.3, 2.0, -7.95, 'redGlow'),
            // Structural ribs & ceiling beams
            ...[-2, 0, 2, 4].flatMap((z) => [
                box(-4, 0, z - 0.15, -3.8, 3.5, z + 0.15, 'darkMetal'),
                box(3.8, 0, z - 0.15, 4, 3.5, z + 0.15, 'darkMetal'),
                box(-4, 3.3, z - 0.15, 4, 3.5, z + 0.15, 'darkMetal')
            ]),
            // Pipes
            cyl([-3.6, 3.0, 1], 0.1, 10, 'z', 'copper'),
            cyl([-3.35, 3.08, 1], 0.06, 10, 'z', 'copper'),
            cyl([3.55, 2.9, 1], 0.13, 10, 'z', 'copper'),
            cyl([-2.6, 1.75, -3.88], 0.08, 3.5, 'y', 'copper'),
            // Crates
            box(2.6, 0, 1.0, 3.6, 1.0, 2.0, 'darkMetal'),
            box(2.9, 1.0, 1.3, 3.5, 1.6, 1.9, 'darkMetal'),
            box(-3.6, 0, 2.5, -2.8, 0.8, 3.3, 'darkMetal')
        ],

        // Local to the screen centre: housing, bezel around the recessed 4:3 screen, shelf, cabinet
        terminal: [
            box(-1.0, -0.8, -0.16, 1.0, 0.8, -0.01, 'darkMetal'),
            box(-1.0, 0.6, -0.01, 1.0, 0.8, 0.12, 'darkMetal'),
            box(-1.0, -0.8, -0.01, 1.0, -0.6, 0.12, 'darkMetal'),
            box(-1.0, -0.6, -0.01, -0.8, 0.6, 0.12, 'darkMetal'),
            box(0.8, -0.6, -0.01, 1.0, 0.6, 0.12, 'darkMetal'),
            box(-1.1, -0.88, -0.16, 1.1, -0.8, 0.29, 'hazard'),
            box(-0.9, -1.5, -0.16, 0.9, -0.88, 0.14, 'darkMetal'),
            ...[0, 1, 2, 3, 4, 5].map((i) => box(-0.85 + i * 0.1, -0.73, 0.119, -0.8 + i * 0.1, -0.68, 0.125, 'led')),
            cyl([0, 1.4, -0.09], 0.05, 1.2, 'y', 'darkMetal'),
            cyl([0.3, 1.4, -0.09], 0.035, 1.2, 'y', 'darkMetal')
        ],

        doorPanel: [box(-0.5, -1.3, -0.06, 0.5, 1.3, 0.06, 'door')],

        // Local to the pivot; swings around Z
        lamp: [
            box(-0.012, -1.6, -0.012, 0.012, 0, 0.012, 'darkMetal'),
            cyl([0, -1.58, 0], 0.07, 0.08, 'y', 'lightMetal', 12),
            cyl([0, -1.7, 0], 0.22, 0.2, 'y', 'lightMetal', 20),
            cyl([0, -1.82, 0], 0.07, 0.1, 'y', 'bulb', 12)
        ],

        // Local -Z = lens direction
        securityCamera: [
            box(-0.08, -0.07, -0.05, 0.08, 0.07, 0.28, 'lightMetal'),
            box(-0.1, 0.07, -0.13, 0.1, 0.09, 0.3, 'darkMetal'),
            cyl([0, 0, -0.1], 0.045, 0.1, 'z', 'glass', 12),
            box(0.045, 0.03, -0.056, 0.065, 0.05, -0.05, 'tally'),
            box(-0.02, 0.09, 0.18, 0.02, 0.32, 0.22, 'darkMetal')
        ],

        // Local -Z = eye direction
        drone: [
            box(-0.14, -0.06, -0.14, 0.14, 0.06, 0.14, 'darkMetal'),
            box(-0.08, 0.06, -0.08, 0.08, 0.1, 0.08, 'lightMetal'),
            box(-0.045, -0.025, -0.152, 0.045, 0.025, -0.14, 'tally'),
            box(-0.32, 0, -0.015, 0.32, 0.02, 0.015, 'lightMetal'),
            box(-0.015, 0, -0.32, 0.015, 0.02, 0.32, 'lightMetal'),
            ...[[-0.3, 0], [0.3, 0], [0, -0.3], [0, 0.3]].map(([x, z]) => cyl([x, 0.03, z], 0.09, 0.012, 'y', 'glass', 14))
        ],

        // Origin at the feet, -Z forward
        avatar: [
            box(-0.2, 0, -0.1, -0.03, 0.8, 0.1, 'armour'),
            box(0.03, 0, -0.1, 0.2, 0.8, 0.1, 'armour'),
            box(-0.25, 0.8, -0.15, 0.25, 1.45, 0.15, 'armour'),
            box(-0.36, 0.85, -0.1, -0.26, 1.4, 0.1, 'darkMetal'),
            box(0.26, 0.85, -0.1, 0.36, 1.4, 0.1, 'darkMetal'),
            box(-0.12, 1.48, -0.13, 0.12, 1.76, 0.13, 'armour'),
            box(-0.09, 1.58, -0.14, 0.09, 1.66, -0.13, 'glass')
        ],

        // Screen faces +Z
        phone: [
            box(-0.0385, -0.079, -0.0045, 0.0385, 0.079, 0.0045, 'phoneBody'),
            box(0.0385, 0.018, -0.002, 0.0395, 0.042, 0.002, 'lightMetal'),
            box(-0.0395, 0.03, -0.002, -0.0385, 0.04, 0.002, 'lightMetal'),
            box(-0.0395, 0.015, -0.002, -0.0385, 0.025, 0.002, 'lightMetal'),
            box(0.006, 0.048, -0.0068, 0.032, 0.074, -0.0045, 'darkMetal')
        ],

        // Board centre at the origin, board faces +Z, floor at y = -1.45
        easel: [
            box(-0.64, -0.49, -0.035, 0.64, 0.49, 0, 'wood'),
            box(-0.66, -0.58, -0.04, 0.66, -0.52, 0.13, 'wood'),
            box(-0.66, -0.52, 0.1, 0.66, -0.47, 0.13, 'wood'),
            box(-0.56, -1.45, -0.08, -0.5, 0.62, -0.035, 'wood'),
            box(0.5, -1.45, -0.08, 0.56, 0.62, -0.035, 'wood'),
            box(-0.03, -1.45, -0.72, 0.03, 0.55, -0.66, 'wood'),
            box(-0.03, 0.5, -0.68, 0.03, 0.56, -0.035, 'wood'),
            box(-0.5, -1.1, -0.08, 0.5, -1.05, -0.035, 'wood'),
            cyl([-0.46, -0.47, 0.04], 0.035, 0.1, 'y', 'copper', 12),
            cyl([-0.36, -0.48, 0.05], 0.03, 0.08, 'y', 'lightMetal', 12),
            box(0.2, -0.515, 0.02, 0.46, -0.5, 0.035, 'wood'),
            box(0.44, -0.52, 0.015, 0.5, -0.495, 0.04, 'darkMetal')
        ]
    },

    // ---------------------------------------------------------------- entities
    // Light order matters: the first light (the lamp) also drives the bulb material's glow.
    entities: [
        { type: 'static', id: 'level', model: 'level' },
        {
            type: 'lamp', id: 'lamp', model: 'lamp', pivot: [-0.8, 3.3, -2.0], bulbLength: 1.85,
            intensity: 3.2, color: [1.0, 0.82, 0.58], swing: { amp: 0.34, freq: 1.05, amp2: 0.05, freq2: 2.7 }
        },
        { type: 'light', id: 'screenGlow', pos: [-1.2, 1.5, -3.39], color: [0.3, 0.75, 1.0], alarmColor: [1.0, 0.25, 0.2], intensity: 1.5 },
        {
            type: 'alarmBeacon', id: 'beacon', pos: [1.8, 2.75, -3.6], color: [1.0, 0.1, 0.04], intensity: 4,
            wave: [1.8, -3.8], toneEvery: 0.45, waveEvery: 0.9, tones: [660, 520]
        },
        { type: 'light', id: 'corridorLight', pos: [1.8, 1.8, -7.3], color: [1.0, 0.12, 0.05], intensity: 2.5, door: { id: 'hatchB', min: 0.15 } },
        { type: 'light', id: 'fillLight', pos: [0.5, 3.1, 3.0], color: [0.55, 0.6, 0.72], intensity: 0.4, roomLights: true },
        {
            type: 'drone', id: 'drone', model: 'drone', center: [0.2, 2.0, 1.4], radius: [2.3, 2.6], speed: 0.3,
            bob: { amp: 0.12, freq: 1.7 }, pingEvery: 3, eyeLight: { ahead: 0.25, intensity: 0.35, color: [1.0, 0.12, 0.08] }
        },
        {
            type: 'door', id: 'hatchB', name: 'Hatch B', model: 'doorPanel', pos: [1.8, 1.3, -4.0], travel: 1.0, speed: 0.7,
            panels: [{ pos: [1.3, 1.3, -4.1], slide: [-1, 0, 0] }, { pos: [2.3, 1.3, -4.1], slide: [1, 0, 0] }]
        },
        { type: 'avatar', id: 'avatar', model: 'avatar' },

        securityCamera('cam01', 'CAM-01', 'AIRLOCK HATCH', 'SECTOR 07 / EAST CORNER', [3.3, 2.6, -3.75], [0.6, 1.0, -2.0], 0.3, 0.35),
        securityCamera('cam02', 'CAM-02', 'CORRIDOR B', 'BEHIND HATCH B', [2.5, 2.4, -7.7], [1.6, 1.0, -3.8], 0, 0),
        securityCamera('cam03', 'CAM-03', 'OPS TERMINAL', 'SECTOR 07 / WEST WALL', [-3.3, 2.6, -0.6], [-1.2, 1.3, -3.6], 0.12, 0.5),
        securityCamera('cam04', 'CAM-04', 'STORAGE BAY', 'SECTOR 07 / SOUTH-EAST', [3.3, 2.6, 5.7], [2.2, 0.5, 1.4], 0.4, 0.28),
        securityCamera('cam05', 'CAM-05', 'MAIN HALL', 'SECTOR 07 / SOUTH-WEST', [-3.3, 2.6, 5.7], [0.4, 0.8, -2.0], 0.45, 0.22),
        securityCamera('cam06', 'CAM-06', 'LAMP RIG', 'CEILING / OVERHEAD', [0.6, 3.25, -0.4], [-0.9, 0.2, -2.6], 0.2, 0.6),
        securityCamera('cam07', 'CAM-07', 'MAINT DUCT', 'SUBLEVEL 2 / DUCT 14', [-3.7, 0.4, 5.8], [-2.0, 0.2, 3.0], 0, 0, { offline: true }),

        {
            type: 'terminal', id: 'terminal', model: 'terminal', pos: [-1.2, 1.5, -3.84], yaw: 0,
            gui: { id: 'terminal', size: [1.6, 1.2], virtual: [640, 480], crt: true, range: 3.6, anchorMaterial: 'glass', maxVerts: 24000 },
            content: {
                door: 'hatchB',
                hatchCode: '396',
                titles: { main: 'SECTOR 07 // AIRLOCK CONTROL', cctv: 'SECTOR 07 // SECURITY', keypad: 'AUTHORIZATION REQUIRED' },
                scopeLabel: 'REACTOR FEED // CH-2',
                memo: ["PDA MEMO: 'hatch code is 3-9-6,", "  somebody change it already'", '                    - maint.']
            }
        },
        {
            type: 'easel', id: 'easel', model: 'easel', pos: [-2.95, 1.45, -2.3], yaw: 1.13, collider: 0.75,
            gui: { id: 'easel', size: [1.2, 0.9], virtual: [640, 480], zOffset: 0.004, range: 3.6, anchorMaterial: 'darkMetal', maxVerts: 12000 },
            paint: {
                resolution: [1016, 912],                         // paint render target (2x the GUI area)
                area: { x: 120, y: 12, w: 508, h: 456 },          // painting area in GUI space
                paper: [0.95, 0.93, 0.88],
                maxDabs: 4096,
                size: { min: 2, max: 60, initial: 14 },
                initialColor: 3,
                palette: [
                    [28, 28, 30], [245, 243, 238], [128, 128, 132], [220, 38, 38], [249, 115, 22], [250, 204, 21],
                    [34, 197, 94], [20, 184, 166], [37, 99, 235], [79, 70, 229], [168, 85, 247], [120, 72, 40]
                ],
                // type = dab shape in the stamp shader; flow = paint per dab; spacing = fraction of the radius
                brushes: [
                    { name: 'ROUND BRUSH', type: 0, sizeMul: 1.0, spacing: 0.15, flow: 0.35, preview: 'soft' },
                    { name: 'INK PEN', type: 1, sizeMul: 0.35, spacing: 0.12, flow: 1.0, preview: 'zigzag' },
                    { name: 'AIRBRUSH', type: 2, sizeMul: 2.2, spacing: 0.2, flow: 0.25, preview: 'spray', spray: true },
                    { name: 'MARKER', type: 3, sizeMul: 1.2, spacing: 0.08, flow: 0.1, angle: 0.6, preview: 'chisel' },
                    { name: 'CHARCOAL', type: 4, sizeMul: 0.9, spacing: 0.15, flow: 0.7, preview: 'grain' },
                    { name: 'ERASER', type: 5, sizeMul: 1.4, spacing: 0.12, flow: 1.0, preview: 'eraser', eraser: true }
                ]
            }
        }
    ],

    // ---------------------------------------------------------------- systems
    cctv: { resolution: [512, 384], fovY: 1.2, initial: 2 },

    media: {
        photo: { size: [384, 512], atlas: 2048, capacity: 20, fovY: 0.95 },
        video: { size: [192, 256], fps: 12, pool: 180, maxSeconds: 10 },
        seedShots: [
            { label: 'Main hall', pos: [1.5, 2.2, 5.3], target: [-1.0, 1.2, -3.0] },
            { label: 'Hatch B', pos: [0.9, 1.65, -1.2], target: [1.9, 1.3, -4.0] },
            { label: 'Ops terminal', pos: [-0.3, 1.6, -2.3], target: [-1.3, 1.5, -3.84] }
        ]
    },

    iptv: {
        hlsScript: 'https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js',
        cardTitle: 'SECTOR 07 · ENGINEERING',
        channels: [
            { name: 'Test Card', sub: 'Sector 07 engineering', kind: 'card', color: [142, 142, 147] },
            { name: 'Sector 07 CCTV', sub: 'Security feed · terminal camera', kind: 'cctv', color: [52, 199, 89] },
            { name: 'Big Buck Bunny', sub: 'Mux test stream · VOD', url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', color: [255, 149, 0] },
            { name: 'Live Test Feed', sub: 'Unified Streaming · live', url: 'https://demo.unified-streaming.com/k8s/live/stable/live.isml/.m3u8', live: true, color: [255, 59, 48] },
            { name: 'Tears of Steel', sub: 'Unified Streaming · VOD', url: 'https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8', color: [0, 122, 255] },
            { name: 'Angel One', sub: 'Shaka Player demo · VOD', url: 'https://storage.googleapis.com/shaka-demo-assets/angel-one-hls/hls.m3u8', color: [175, 82, 222] },
            { name: 'Bip-Bop', sub: 'Apple test stream · VOD', url: 'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8', color: [48, 176, 199] }
        ]
    },

    waves: {
        step: { speed: 5, life: 0.9, color: [120, 255, 150] },
        drone: { speed: 4, life: 1.4, color: [255, 70, 55] },
        alarm: { speed: 6, life: 1.3, color: [255, 154, 46] },
        door: { speed: 5, life: 1.2, color: [255, 200, 90] }
    },

    radar: {
        range: 9,
        tracked: [
            { name: 'Patrol drone', entity: 'drone', color: [255, 59, 48], shape: 'pulse' },
            { name: 'Ops terminal', entity: 'terminal', color: [90, 200, 250], shape: 'diamond' },
            { name: 'Hatch B', entity: 'hatchB', color: [255, 149, 0], shape: 'bar' },
            { nearest: 'securityCamera', prefix: 'Nearest ', color: [255, 214, 10], shape: 'camera' }
        ]
    },

    // Photo / video captions
    places: {
        zones: [{ name: 'Corridor B', zBelow: -4.1 }],
        spots: [
            { name: 'Ops terminal', at: [-1.2, -2.84] },
            { name: 'Hatch B', at: [1.8, -3.0] },
            { name: 'Storage bay', at: [3.0, 1.5] },
            { name: 'Main hall', at: [0, 3] }
        ]
    },

    // ---------------------------------------------------------------- phone
    phone: {
        model: 'phone',
        screen: [0.068, 0.1435],
        virtual: [270, 570],
        zOffset: 0.0047,
        fovDeg: 60,                 // view-model FOV, independent of the player's
        startShown: true,
        showSeconds: 0.38,
        pose: {
            hidden: { offset: [0.08, -0.2], yaw: -0.45, tilt: 0.95 },
            shown: { offset: [0.062, -0.012, -0.2], yaw: -0.14, tilt: 0.04 },
            landscape: { offset: [0, 0, -0.16] }
        },
        links: { door: 'hatchB', terminal: 'terminal', easel: 'easel' },

        // Debug-sheet pages. Cells: nav | switch | slider | label | action | picker | text.
        // `bind` / `*Bind` name a binding in js/game/bindings.js; `app` pages are drawn by a PhoneApp.
        pages: {
            root: {
                title: 'Debug Sheet',
                sections: [
                    {
                        header: 'TOOLS', cells: [
                            { type: 'nav', page: 'radar', title: 'Radar', sub: 'Compass, tracking, noise', icon: [[52, 199, 89], 'R'] },
                            { type: 'nav', page: 'camera', title: 'Camera', sub: 'Photos & video of the facility', icon: [[142, 142, 147], 'C'] },
                            { type: 'nav', page: 'tv', title: 'IPTV', subBind: 'iptv.summary', icon: [[255, 59, 48], 'TV'] },
                            { type: 'nav', page: 'photos', title: 'Photos', subBind: 'media.summary', icon: [[175, 82, 222], 'P'] },
                            { type: 'nav', page: 'airlock', title: 'Airlock', sub: 'Hatch & CCTV overrides', icon: [[255, 149, 0], 'A'] },
                            { type: 'nav', page: 'rendering', title: 'Rendering', sub: 'View & lighting', icon: [[0, 122, 255], 'V'] },
                            { type: 'nav', page: 'audio', title: 'Audio', sub: 'Sound & footsteps', icon: [[255, 45, 85], 'S'] }
                        ]
                    },
                    {
                        header: 'QUICK TOGGLES', cells: [
                            { type: 'switch', bind: 'lights', title: 'Room lights' },
                            { type: 'switch', bind: 'alarm', title: 'Alarm' },
                            { type: 'switch', bind: 'stencil', title: 'Stencil GUI mask' }
                        ]
                    },
                    {
                        header: 'PLAYER', cells: [
                            { type: 'label', title: 'Position', bind: 'player.position' },
                            { type: 'label', title: 'Heading', bind: 'player.heading' },
                            { type: 'label', title: 'Noise', bind: 'player.noise' },
                            { type: 'label', title: 'Frame rate', bind: 'stats.fps' }
                        ]
                    },
                    {
                        header: 'INFO', cells: [
                            { type: 'nav', page: 'controls', title: 'Controls', icon: [[99, 99, 102], 'K'] },
                            { type: 'nav', page: 'stats', title: 'Render stats', icon: [[48, 176, 199], '#'] },
                            { type: 'nav', page: 'about', title: 'About this demo', icon: [[0, 122, 255], 'i'] }
                        ]
                    }
                ]
            },
            airlock: {
                title: 'Airlock',
                sections: [
                    {
                        header: 'HATCH B', cells: [
                            { type: 'label', title: 'Status', bind: 'hatch.status' },
                            { type: 'action', action: 'toggleHatch', titleBind: 'hatch.action' },
                            { type: 'label', title: 'Access code', bind: 'hatch.code' }
                        ]
                    },
                    {
                        header: 'SECURITY', cells: [
                            { type: 'picker', bind: 'cctv', page: 'pick:cctv', title: 'CCTV camera' },
                            { type: 'action', action: 'showCctvOnTerminal', title: 'Show on terminal' }
                        ],
                        footer: 'Switches the wall terminal to its CCTV tab.'
                    }
                ]
            },
            rendering: {
                title: 'Rendering',
                sections: [
                    {
                        header: 'VIEW', cells: [
                            { type: 'slider', bind: 'fov', title: 'Field of view' },
                            { type: 'slider', bind: 'lamp', title: 'Lamp intensity' }
                        ]
                    },
                    { header: 'GUI SURFACES', cells: [{ type: 'switch', bind: 'stencil', title: 'Stencil GUI mask' }], footerBind: 'stencil.description' }
                ]
            },
            audio: {
                title: 'Audio',
                sections: [
                    {
                        header: 'OUTPUT', cells: [
                            { type: 'switch', bind: 'sound', title: 'Sound' },
                            { type: 'slider', bind: 'stepVolume', title: 'Footstep volume' }
                        ]
                    }
                ]
            },
            controls: {
                title: 'Controls',
                sections: [
                    {
                        header: 'MOVEMENT', cells: [
                            { type: 'label', title: 'Move', value: 'W A S D' },
                            { type: 'label', title: 'Run', value: 'Shift' },
                            { type: 'label', title: 'Look', value: 'Drag' },
                            { type: 'label', title: 'Step', value: 'Scroll wheel' }
                        ]
                    },
                    {
                        header: 'SCREENS', cells: [
                            { type: 'label', title: 'Use a screen', value: 'Aim + click' },
                            { type: 'label', title: 'Scroll a list', value: 'Scroll wheel' },
                            { type: 'label', title: 'Drag a slider', value: 'Click + drag' },
                            { type: 'label', title: 'Paint (easel)', value: 'Drag · wheel = size' },
                            { type: 'label', title: 'Phone', value: 'Tab / Esc' }
                        ],
                        footer: 'Wall screens only react within 3.6 m, like Doom 3. The phone always does.'
                    }
                ]
            },
            stats: {
                title: 'Render stats',
                sections: [
                    {
                        header: 'FRAME', cells: [
                            { type: 'label', title: 'Frame rate', bind: 'stats.fps' },
                            { type: 'label', title: 'Resolution', bind: 'stats.resolution' },
                            { type: 'label', title: 'GUI mask', bind: 'stats.guiMask' },
                            { type: 'label', title: 'GUI surfaces', bind: 'stats.guiSurfaces' }
                        ]
                    },
                    {
                        header: 'GUI MODELS', cells: [
                            { type: 'label', title: 'Terminal', bind: 'stats.terminal' },
                            { type: 'label', title: 'Easel', bind: 'stats.easel' },
                            { type: 'label', title: 'Phone', bind: 'stats.phone' }
                        ]
                    },
                    {
                        header: 'RENDER TARGETS', cells: [
                            { type: 'label', title: 'CCTV feed', bind: 'stats.cctv' },
                            { type: 'label', title: 'Phone camera', bind: 'stats.camera' },
                            { type: 'label', title: 'Photos stored', bind: 'stats.photos' },
                            { type: 'label', title: 'Video frames', bind: 'stats.videoFrames' },
                            { type: 'label', title: 'IPTV texture', bind: 'stats.iptv' }
                        ],
                        footer: 'Render targets only render while a screen is showing them.'
                    }
                ]
            },
            about: {
                title: 'About',
                sections: [
                    {
                        header: 'ENTITY GUI // WEBGPU', cells: [
                            { type: 'text', text: 'Every screen here is an EntityGUI: a Doom 3-style GUI surface that emits textured quads in its own virtual screen space and is placed on its entity through the surface\'s texture axes.' },
                            { type: 'text', text: 'Each surface writes its own stencil value, so a GUI never z-fights, stays hidden behind things in front of it and can\'t draw through another GUI.' },
                            { type: 'text', text: 'The whole facility, including these pages, is described by data in js/scenario.js.' }
                        ]
                    }
                ]
            },
            'pick:cctv': { title: 'CCTV camera', sections: [{ optionsBind: 'cctv' }] },
            radar: { title: 'Radar', app: 'radar' },
            camera: { title: 'Camera', app: 'camera' },
            photos: { title: 'Photos', app: 'photos' },
            tv: { title: 'IPTV', app: 'tv' }
        }
    }
};
})();
