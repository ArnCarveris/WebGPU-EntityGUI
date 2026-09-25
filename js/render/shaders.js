'use strict';
// WGSL sources.

// Scene + GUI shader. Bind group 0: view uniforms, per-instance data, sampler, material texture.
const SCENE_SHADER = /* wgsl */`
    struct Light { pos : vec4f, color : vec4f };   // pos.w = intensity
    struct Globals {
        viewProj : mat4x4f,
        camPos   : vec4f,
        params   : vec4f,                           // x time, y lightsOn, z alarm pulse
        lights   : array<Light, 6>,
    };
    struct Instance { model : mat4x4f, tint : vec4f }; // tint.x: tally LED on (world) / CRT amount (GUI)

    @group(0) @binding(0) var<uniform> U : Globals;
    @group(0) @binding(1) var<storage, read> inst : array<Instance>;
    @group(0) @binding(2) var guiSampler : sampler;
    @group(0) @binding(3) var guiTex : texture_2d<f32>;

    fn hash(p : vec2f) -> f32 {
        return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
    }

    // ---------------- World ----------------
    struct VSIn {
        @location(0) pos : vec3f,
        @location(1) nrm : vec3f,
        @location(2) uv  : vec2f,
        @location(3) mat : f32,
        @builtin(instance_index) instanceIdx : u32,
    };
    struct VSOut {
        @builtin(position) pos : vec4f,
        @location(0) wpos : vec3f,
        @location(1) nrm  : vec3f,
        @location(2) uv   : vec2f,
        @location(3) @interpolate(flat) mat : f32,
        @location(4) @interpolate(flat) sel : f32,
    };

    @vertex
    fn vs_main(i : VSIn) -> VSOut {
        let model = inst[i.instanceIdx].model;
        let wp = model * vec4f(i.pos, 1.0);
        var o : VSOut;
        o.pos = U.viewProj * wp;
        o.wpos = wp.xyz;
        o.nrm = (model * vec4f(i.nrm, 0.0)).xyz;
        o.uv = i.uv;
        o.mat = i.mat;
        o.sel = inst[i.instanceIdx].tint.x;
        return o;
    }

    fn seam(x : f32, w : f32) -> f32 {
        let f = fract(x);
        return 1.0 - step(w, f) * step(f, 1.0 - w);
    }
    fn hazard(uv : vec2f) -> vec3f {
        let st = step(0.5, fract((uv.x + uv.y) * 2.5));
        return mix(vec3f(0.02), vec3f(0.75, 0.55, 0.04), st);
    }

    struct Mat { albedo : vec3f, spec : f32, shin : f32, emis : vec3f };

    // Material ids match MATERIALS in geometry.js
    fn material(id : u32, uv : vec2f, wp : vec3f, sel : f32) -> Mat {
        let t = U.params.x;
        var m : Mat;
        m.albedo = vec3f(0.3);
        m.spec = 0.3;
        m.shin = 32.0;
        m.emis = vec3f(0.0);
        switch id {
            case 0u: { // wall panels
                let cell = floor(vec2f(uv.x, uv.y * 0.5));
                var a = vec3f(0.16, 0.17, 0.18) * (0.75 + 0.5 * hash(cell));
                a = a * (1.0 - 0.75 * max(seam(uv.x, 0.01), seam(uv.y * 0.5, 0.005)));
                let rv = fract(vec2f(uv.x, uv.y * 0.5));
                let rd = min(min(length(rv - vec2f(0.05, 0.05)), length(rv - vec2f(0.95, 0.05))),
                             min(length(rv - vec2f(0.05, 0.95)), length(rv - vec2f(0.95, 0.95))));
                if (rd < 0.02) { a = a * 1.8; }
                if (wp.y < 1.0) { a = a * vec3f(0.7, 0.68, 0.64); }
                if (abs(wp.y - 1.0) < 0.035) { a = vec3f(0.55, 0.32, 0.08); }
                m.albedo = a; m.spec = 0.35; m.shin = 28.0;
            }
            case 1u: { // floor grating
                let g = fract(uv * 5.0);
                let hole = step(0.18, g.x) * step(0.18, g.y);
                var a = mix(vec3f(0.24, 0.23, 0.21), vec3f(0.015), hole);
                a = a * (1.0 - 0.6 * max(seam(uv.x * 0.5, 0.006), seam(uv.y * 0.5, 0.006)));
                m.albedo = a; m.spec = mix(0.7, 0.02, hole); m.shin = 40.0;
            }
            case 2u: { // copper pipes
                m.albedo = vec3f(0.40, 0.24, 0.12) * (0.75 + 0.35 * hash(floor(uv * vec2f(4.0, 2.0))));
                m.spec = 0.8; m.shin = 36.0;
            }
            case 3u: { // sliding door
                var a = vec3f(0.30, 0.32, 0.34) * (1.0 - 0.6 * seam(uv.y * 1.25 + 0.5, 0.012));
                if (uv.y < -0.95 || uv.y > 1.05) { a = hazard(uv); }
                m.albedo = a; m.spec = 0.5; m.shin = 32.0;
            }
            case 4u: { // lamp bulb: glows with the first light
                m.albedo = vec3f(0.0);
                m.emis = U.lights[0].color.rgb * (0.08 + U.lights[0].pos.w * 0.5);
            }
            case 5u: { // dark painted metal
                var a = vec3f(0.10, 0.11, 0.12) * (0.8 + 0.4 * hash(floor(uv * 2.0)));
                a = a * (1.0 - 0.6 * max(seam(uv.x * 2.0, 0.01), seam(uv.y * 2.0, 0.01)));
                m.albedo = a; m.spec = 0.45; m.shin = 30.0;
            }
            case 6u: { // glass
                m.albedo = vec3f(0.004, 0.012, 0.014); m.spec = 1.2; m.shin = 110.0;
            }
            case 7u: { // red glow panel
                m.albedo = vec3f(0.05);
                m.emis = vec3f(1.0, 0.07, 0.02) * (1.1 + 0.25 * sin(t * 2.3));
            }
            case 8u: { // ceiling
                m.albedo = vec3f(0.085, 0.09, 0.095) * (1.0 - 0.6 * max(seam(uv.x, 0.012), seam(uv.y, 0.012)));
                m.spec = 0.2; m.shin = 16.0;
            }
            case 9u: { // hazard trim
                m.albedo = hazard(uv); m.spec = 0.4; m.shin = 24.0;
            }
            case 10u: { // blinking status LEDs
                let blink = step(0.35, fract(t * 0.6 + uv.x * 3.7));
                m.albedo = vec3f(0.02);
                m.emis = vec3f(0.15, 1.0, 0.35) * (0.3 + 1.7 * blink);
            }
            case 11u: { // light metal
                m.albedo = vec3f(0.18, 0.2, 0.16); m.spec = 0.7; m.shin = 40.0;
            }
            case 12u: { // alarm beacon
                m.albedo = vec3f(0.08, 0.01, 0.01);
                m.emis = vec3f(1.0, 0.08, 0.03) * (0.12 + 3.0 * U.params.z);
            }
            case 13u: { // red tally LED: blinks when the instance is "selected"
                let blink = step(0.5, fract(t * 1.5));
                m.albedo = vec3f(0.05, 0.0, 0.0);
                m.emis = vec3f(1.0, 0.06, 0.03) * mix(0.35, 0.2 + 3.0 * blink, sel);
            }
            case 14u: { // armour
                m.albedo = vec3f(0.15, 0.19, 0.12) * (1.0 - 0.5 * seam(uv.y * 4.0, 0.03));
                m.spec = 0.5; m.shin = 30.0;
            }
            case 15u: { // phone body: graphite
                m.albedo = vec3f(0.035, 0.037, 0.042); m.spec = 0.9; m.shin = 70.0;
                m.emis = vec3f(0.012, 0.013, 0.015);
            }
            case 16u: { // wood
                let g = sin((uv.x + uv.y * 0.15) * 55.0 + sin(uv.y * 5.0) * 2.0) * 0.5 + 0.5;
                m.albedo = vec3f(0.36, 0.23, 0.12) * (0.75 + 0.3 * g) * (0.9 + 0.2 * hash(floor(uv * vec2f(3.0, 1.0))));
                m.spec = 0.25; m.shin = 20.0;
            }
            default: {}
        }
        return m;
    }

    @fragment
    fn fs_scene(i : VSOut) -> @location(0) vec4f {
        let mt = material(u32(i.mat + 0.5), i.uv, i.wpos, i.sel);
        let V = normalize(U.camPos.xyz - i.wpos);
        var N = normalize(i.nrm);
        if (dot(N, V) < 0.0) { N = -N; }

        var col = mt.albedo * 0.012 + mt.emis;
        for (var k = 0u; k < 6u; k = k + 1u) {
            let light = U.lights[k];
            let lv = light.pos.xyz - i.wpos;
            let d2 = max(dot(lv, lv), 1e-4);
            let l = lv * inverseSqrt(d2);
            let att = light.pos.w / (1.0 + d2);
            let ndl = max(dot(N, l), 0.0);
            let h = normalize(l + V);
            let sp = pow(max(dot(N, h), 0.0), mt.shin) * mt.spec;
            col += (mt.albedo + sp) * ndl * att * light.color.rgb;
        }

        let dist = length(U.camPos.xyz - i.wpos);
        col = mix(vec3f(0.004, 0.005, 0.007), col, exp(-dist * 0.05));
        col = col / (1.0 + col);
        col = pow(col, vec3f(1.0 / 2.2));
        col += (hash(i.pos.xy + fract(U.params.x) * 91.0) - 0.5) * 0.025;
        return vec4f(col, 1.0);
    }

    // ---------------- GUI models ----------------
    // Vertices are in the GUI's virtual screen space; inst[instanceIdx].model is its gui model matrix
    // (surface texture axes scaled by 1/width, 1/height, times the surface's model matrix).
    struct GuiIn {
        @location(0) pos   : vec2f,
        @location(1) uv    : vec2f,
        @location(2) color : vec4f,
        @builtin(instance_index) instanceIdx : u32,
    };
    struct GuiOut {
        @builtin(position) pos : vec4f,
        @location(0) uv    : vec2f,
        @location(1) color : vec4f,
        @location(2) gpos  : vec2f,
        @location(3) @interpolate(flat) fx : f32,
    };

    @vertex
    fn vs_gui(i : GuiIn) -> GuiOut {
        let t = U.params.x;
        let fx = inst[i.instanceIdx].tint.x;
        // Occasional horizontal tearing (CRT GUIs only)
        let glitch = step(0.97, hash(vec2f(floor(t * 8.0), 3.1))) * fx;
        let jit = (hash(vec2f(floor(i.pos.y / 12.0), floor(t * 30.0))) - 0.5) * 5.0 * glitch;
        var o : GuiOut;
        o.pos = U.viewProj * (inst[i.instanceIdx].model * vec4f(i.pos.x + jit, i.pos.y, 0.0, 1.0));
        o.uv = i.uv;
        o.color = i.color;
        o.gpos = i.pos;
        o.fx = fx;
        return o;
    }

    fn crt(rgb : vec3f, gpos : vec2f, a : f32) -> vec3f {
        let t = U.params.x;
        let g = gpos / vec2f(640.0, 480.0);
        let scan = 0.82 + 0.18 * sin(gpos.y * 2.0944);
        let roll = exp(-pow((fract(t * 0.12) * 1.3 - 0.15 - g.y) * 10.0, 2.0));
        let flick = 0.96 + 0.04 * sin(t * 71.0);
        let d = g - vec2f(0.5);
        let vig = clamp(1.0 - dot(d, d) * 1.1, 0.0, 1.0);
        return rgb * scan * flick * vig + vec3f(0.35, 0.8, 1.0) * roll * 0.05 * a;
    }

    @fragment
    fn fs_gui(i : GuiOut) -> @location(0) vec4f {
        let c = textureSample(guiTex, guiSampler, i.uv) * i.color;
        return vec4f(mix(c.rgb, crt(c.rgb, i.gpos, c.a), i.fx), c.a);
    }

    // Security-camera look. color.r = signal strength (0 = static).
    @fragment
    fn fs_cctv(i : GuiOut) -> @location(0) vec4f {
        let t = U.params.x;
        let uv = i.uv;
        let tear = (hash(vec2f(floor(uv.y * 120.0), floor(t * 24.0))) - 0.5) * 0.004;
        let s = textureSample(guiTex, guiSampler, vec2f(uv.x + tear, uv.y));
        let noise = hash(uv * vec2f(391.0, 283.0) + fract(t * 7.3) * vec2f(17.0, 29.0));
        var v = dot(s.rgb, vec3f(0.3, 0.59, 0.11)) * 1.35 + (noise - 0.5) * 0.1;
        v = v * (0.9 + 0.1 * sin(uv.y * 5.0 - t * 1.7)) * (0.85 + 0.15 * sin(uv.y * 384.0 * 3.14159));
        let d = uv - vec2f(0.5);
        v = v * (1.0 - dot(d, d) * 1.3);
        let feed = vec3f(v * 0.72, v, v * 0.8);
        let rgb = mix(vec3f(noise * 0.75), feed, clamp(i.color.r, 0.0, 1.0));
        return vec4f(crt(rgb, i.gpos, 1.0), 1.0);
    }
`;

// Texture-array GUI material (video frames). Same vertex stage (vs_gui); color.r carries the layer.
const VIDEO_SHADER = /* wgsl */`
    struct GuiOut {
        @builtin(position) pos : vec4f,
        @location(0) uv    : vec2f,
        @location(1) color : vec4f,
        @location(2) gpos  : vec2f,
        @location(3) @interpolate(flat) fx : f32,
    };
    @group(0) @binding(2) var guiSampler : sampler;
    @group(0) @binding(3) var frames : texture_2d_array<f32>;

    @fragment
    fn fs_video(i : GuiOut) -> @location(0) vec4f {
        let c = textureSample(frames, guiSampler, i.uv, i32(i.color.r + 0.5));
        return vec4f(c.rgb, i.color.a);
    }
`;

// Full-screen triangle copying a texture into a (smaller) target
const BLIT_SHADER = /* wgsl */`
    @group(0) @binding(0) var blitSampler : sampler;
    @group(0) @binding(1) var src : texture_2d<f32>;
    struct O { @builtin(position) pos : vec4f, @location(0) uv : vec2f };

    @vertex
    fn vs(@builtin(vertex_index) vi : u32) -> O {
        var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
        var o : O;
        o.pos = vec4f(p[vi], 0.0, 1.0);
        o.uv = vec2f((p[vi].x + 1.0) * 0.5, (1.0 - p[vi].y) * 0.5);
        return o;
    }

    @fragment
    fn fs(i : O) -> @location(0) vec4f {
        return textureSample(src, blitSampler, i.uv);   // bilinear at 2x2 block centres = box filter
    }
`;

// Brush stamping: every dab is an instanced quad drawn into the paint render target. The brush type
// picks the dab's shape; flow is how much paint one dab lays down.
const stampShader = (width, height) => /* wgsl */`
    struct Dab {
        @location(0) a : vec4f,     // x, y (paint px), radius (px), brush type
        @location(1) col : vec4f,
        @location(2) b : vec4f,     // seed, angle, flow, -
    };
    struct O {
        @builtin(position) pos : vec4f,
        @location(0) local : vec2f,
        @location(1) px : vec2f,
        @location(2) col : vec4f,
        @location(3) @interpolate(flat) info : vec4f,   // type, seed, angle, flow
    };
    const SIZE = vec2f(${width}.0, ${height}.0);

    fn hash(p : vec2f) -> f32 {
        return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
    }

    @vertex
    fn vs_stamp(@builtin(vertex_index) vi : u32, d : Dab) -> O {
        var corners = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
                                      vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));
        let c = corners[vi];
        let px = d.a.xy + c * d.a.z;
        var o : O;
        o.pos = vec4f(px.x / SIZE.x * 2.0 - 1.0, 1.0 - px.y / SIZE.y * 2.0, 0.0, 1.0);
        o.local = c;
        o.px = px;
        o.col = d.col;
        o.info = vec4f(d.a.w, d.b.x, d.b.y, d.b.z);
        return o;
    }

    @fragment
    fn fs_stamp(i : O) -> @location(0) vec4f {
        let dist = length(i.local);
        let flow = i.info.w;
        var a = 0.0;
        switch u32(i.info.x + 0.5) {
            case 0u: { a = (1.0 - smoothstep(0.3, 1.0, dist)) * flow; }             // round brush: soft edge
            case 1u: { a = 1.0 - smoothstep(0.8, 1.0, dist); }                       // ink pen: hard, opaque
            case 2u: {                                                               // airbrush: speckled spray
                let n = hash(floor(i.px) + i.info.y);
                a = pow(max(1.0 - dist, 0.0), 2.0) * flow * step(0.55, n);
            }
            case 3u: {                                                               // marker: fixed chisel tip
                let cs = cos(i.info.z);
                let sn = sin(i.info.z);
                let q = vec2f(cs * i.local.x + sn * i.local.y, -sn * i.local.x + cs * i.local.y);
                a = step(abs(q.x), 1.0) * step(abs(q.y), 0.32) * flow;
            }
            case 4u: {                                                               // charcoal: grain fixed to the paper
                let n = hash(floor(i.px * 0.8));
                a = (1.0 - smoothstep(0.55, 1.0, dist)) * step(0.3 + 0.45 * dist, n) * flow;
            }
            default: { a = 1.0 - smoothstep(0.8, 1.0, dist); }                       // eraser (paper colour)
        }
        if (a <= 0.002) { discard; }
        return vec4f(i.col.rgb, a * i.col.a);
    }
`;
