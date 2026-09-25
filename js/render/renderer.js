'use strict';
// WebGPU renderer: device, pipelines, instance data, GUI materials, views and render targets.

const UNIFORM_FLOATS = 72;       // viewProj 16 + camPos 4 + params 4 + 6 lights * 8
const MAX_LIGHTS = 6;
const INSTANCE_FLOATS = 20;      // model 16 + tint 4
const GUI_STRIDE = 8;            // x y u v r g b a
const DEPTH_FORMAT = 'depth24plus-stencil8';
const CLEAR_COLOR = { r: 0.004, g: 0.005, b: 0.007, a: 1 };

const WORLD_VERTEX_LAYOUT = {
    arrayStride: 9 * 4,
    attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' },
        { shaderLocation: 1, offset: 12, format: 'float32x3' },
        { shaderLocation: 2, offset: 24, format: 'float32x2' },
        { shaderLocation: 3, offset: 32, format: 'float32' }
    ]
};
const GUI_VERTEX_LAYOUT = {
    arrayStride: GUI_STRIDE * 4,
    attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x2' },
        { shaderLocation: 1, offset: 8, format: 'float32x2' },
        { shaderLocation: 2, offset: 16, format: 'float32x4' }
    ]
};
const ALPHA_BLEND = {
    color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }
};

async function checkShaderModule(module) {
    const info = await module.getCompilationInfo();
    const errors = info.messages.filter((m) => m.type === 'error');
    if (errors.length) {
        throw new Error('WGSL compile error:\n' + errors.map((m) => `L${m.lineNum}:${m.linePos} ${m.message}`).join('\n'));
    }
}

class Renderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.pipelines = {};
        this.materials = new Map();     // name -> { shading, view, version }
        this.instanceCount = 0;
        this.stencilRefs = 0;
        this.useStencil = true;         // false = GUI surfaces rely on the depth test alone (z-fights)
        this.onError = null;
    }

    async init() {
        if (!navigator.gpu) throw new Error('navigator.gpu is not supported in this browser.');
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) throw new Error('Failed to find a suitable GPU adapter.');
        this.device = await adapter.requestDevice();
        // Shader/pipeline validation errors are async and otherwise only logged to the console
        this.device.addEventListener('uncapturederror', (e) => {
            console.error('WebGPU Validation Error:', e.error.message);
            if (this.onError) this.onError(e.error.message);
        });
        this.context = this.canvas.getContext('webgpu');
        this.format = navigator.gpu.getPreferredCanvasFormat();
        this.context.configure({ device: this.device, format: this.format, alphaMode: 'opaque' });
        this.sampler = this.device.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear' });
        this.resize();
    }

    get aspect() {
        return this.canvas.width / this.canvas.height;
    }

    resize() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        this.canvas.width = Math.max(1, Math.floor(window.innerWidth * dpr));
        this.canvas.height = Math.max(1, Math.floor(window.innerHeight * dpr));
        if (!this.device) return;
        if (this.depthTexture) this.depthTexture.destroy();
        this.depthTexture = this.device.createTexture({
            size: [this.canvas.width, this.canvas.height],
            format: DEPTH_FORMAT,
            usage: GPUTextureUsage.RENDER_ATTACHMENT
        });
        this.depthView = this.depthTexture.createView();
    }

    // ---- resources ----
    createBuffer(size, usage) {
        return this.device.createBuffer({ size, usage });
    }

    createMesh(builder) {
        const data = builder.toFloat32();
        const buffer = this.device.createBuffer({
            size: data.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true
        });
        new Float32Array(buffer.getMappedRange()).set(data);
        buffer.unmap();
        return { buffer, count: data.length / 9 };
    }

    // Instances are allocated by entities / GUIs during setup; the buffer is created afterwards
    allocInstances(n = 1) {
        if (this.instanceData) throw new Error('allocInstances after finalizeInstances');
        const first = this.instanceCount;
        this.instanceCount += n;
        return first;
    }

    finalizeInstances() {
        this.instanceData = new Float32Array(this.instanceCount * INSTANCE_FLOATS);
        this.instanceBuffer = this.createBuffer(this.instanceData.byteLength, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    }

    setInstance(index, matrix, tint = null) {
        const o = index * INSTANCE_FLOATS;
        this.instanceData.set(matrix, o);
        this.instanceData.fill(0, o + 16, o + 20);
        if (tint) this.instanceData.set(tint, o + 16);
    }

    // Each GUI surface gets its own stencil value, so one GUI can never draw through another
    nextStencilRef() {
        if (this.stencilRefs >= 255) throw new Error('Out of stencil references');
        return ++this.stencilRefs;
    }

    // ---- pipelines ----
    async createPipelines() {
        const device = this.device;
        const module = device.createShaderModule({ code: SCENE_SHADER });
        const videoModule = device.createShaderModule({ code: VIDEO_SHADER });
        await checkShaderModule(module);
        await checkShaderModule(videoModule);

        const layoutEntries = (viewDimension) => [
            { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
            { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
            { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
            { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension } },
            { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } }
        ];
        this.groupLayouts = {
            '2d': device.createBindGroupLayout({ entries: layoutEntries('2d') }),
            '2d-array': device.createBindGroupLayout({ entries: layoutEntries('2d-array') })
        };
        const layout2d = device.createPipelineLayout({ bindGroupLayouts: [this.groupLayouts['2d']] });
        const layoutArray = device.createPipelineLayout({ bindGroupLayouts: [this.groupLayouts['2d-array']] });

        const make = ({ layout = layout2d, vs, fs, fsModule = module, buffers, depthStencil, blend }) => device.createRenderPipeline({
            layout,
            vertex: { module, entryPoint: vs, buffers: [buffers] },
            fragment: { module: fsModule, entryPoint: fs, targets: [blend ? { format: this.format, blend } : { format: this.format }] },
            primitive: { topology: 'triangle-list', cullMode: 'none' },
            depthStencil: { format: DEPTH_FORMAT, ...depthStencil }
        });

        const writeStencil = { compare: 'always', passOp: 'replace', failOp: 'keep', depthFailOp: 'keep' };
        const testStencil = { compare: 'equal', passOp: 'keep', failOp: 'keep', depthFailOp: 'keep' };
        const guiStencil = { depthWriteEnabled: false, depthCompare: 'always', stencilFront: testStencil, stencilBack: testStencil };
        const guiDepth = { depthWriteEnabled: false, depthCompare: 'less-equal' };

        this.pipelines.scene = make({ vs: 'vs_main', fs: 'fs_scene', buffers: WORLD_VERTEX_LAYOUT, depthStencil: { depthWriteEnabled: true, depthCompare: 'less' } });
        // GUI surface geometry ("anchor"): writes its stencil value wherever it survives the depth test
        this.pipelines.anchor = make({
            vs: 'vs_main', fs: 'fs_scene', buffers: WORLD_VERTEX_LAYOUT,
            depthStencil: { depthWriteEnabled: true, depthCompare: 'less', stencilFront: writeStencil, stencilBack: writeStencil }
        });

        // GUI model shading variants: stencil-masked (depth ALWAYS + stencil EQUAL) or plain depth-tested
        const variants = (opts) => ({
            stencil: make({ ...opts, vs: 'vs_gui', buffers: GUI_VERTEX_LAYOUT, depthStencil: guiStencil, blend: ALPHA_BLEND }),
            depth: make({ ...opts, vs: 'vs_gui', buffers: GUI_VERTEX_LAYOUT, depthStencil: guiDepth, blend: ALPHA_BLEND })
        });
        this.shadings = {
            gui: { layout: '2d', ...variants({ fs: 'fs_gui' }) },
            cctv: { layout: '2d', ...variants({ fs: 'fs_cctv' }) },
            video: { layout: '2d-array', ...variants({ layout: layoutArray, fs: 'fs_video', fsModule: videoModule }) }
        };
    }

    // ---- World materials: the scenario's material table, indexed by the mesh vertices' material id ----
    setWorldMaterials(table) {
        this.worldMaterials = table;
        this.worldMaterialBuffer = this.createBuffer(table.data.byteLength, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
        this.device.queue.writeBuffer(this.worldMaterialBuffer, 0, table.data);
    }

    // ---- GUI materials: a named texture + a shading ----
    registerMaterial(name, shading, textureView) {
        if (!this.shadings[shading]) throw new Error(`Unknown shading "${shading}"`);
        this.materials.set(name, { shading, view: textureView, version: 0 });
    }

    setMaterialTexture(name, textureView) {
        const m = this.materials.get(name);
        m.view = textureView;
        m.version++;
    }

    createView() {
        return new RenderView(this);
    }

    // Bind group for (view, material), cached per view until the material's texture changes
    groupFor(view, name) {
        if (view.exclude.has(name)) return null;
        const mat = this.materials.get(name);
        if (!mat) return null;
        const cached = view.groups.get(name);
        if (cached && cached.version === mat.version) return cached.group;
        const layout = this.groupLayouts[this.shadings[mat.shading].layout];
        const group = this.device.createBindGroup({
            layout,
            entries: [
                { binding: 0, resource: { buffer: view.buffer } },
                { binding: 1, resource: { buffer: this.instanceBuffer } },
                { binding: 2, resource: this.sampler },
                { binding: 3, resource: mat.view },
                { binding: 4, resource: { buffer: this.worldMaterialBuffer } }
            ]
        });
        view.groups.set(name, { version: mat.version, group });
        return group;
    }

    // ---- frames & passes ----
    beginFrame() {
        this.device.queue.writeBuffer(this.instanceBuffer, 0, this.instanceData);
        this.encoder = this.device.createCommandEncoder();
        this.swapView = this.context.getCurrentTexture().createView();
        return this.encoder;
    }

    endFrame() {
        this.device.queue.submit([this.encoder.finish()]);
        this.encoder = null;
    }

    depthAttachment(view) {
        return {
            view,
            depthClearValue: 1.0, depthLoadOp: 'clear', depthStoreOp: 'store',
            stencilClearValue: 0, stencilLoadOp: 'clear', stencilStoreOp: 'store'
        };
    }

    // A scene pass into `colorView`. `load` keeps what's already there (the phone draws over the world).
    beginScenePass(colorView, depthView, view, { load = false, forceStencil = false } = {}) {
        const pass = this.encoder.beginRenderPass({
            colorAttachments: [{ view: colorView, clearValue: CLEAR_COLOR, loadOp: load ? 'load' : 'clear', storeOp: 'store' }],
            depthStencilAttachment: this.depthAttachment(depthView)
        });
        return new ScenePass(this, pass, view, forceStencil);
    }
}

// Per-camera uniforms and the bind groups that use them
class RenderView {
    constructor(renderer) {
        this.renderer = renderer;
        this.buffer = renderer.createBuffer(UNIFORM_FLOATS * 4, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
        this.groups = new Map();
        this.exclude = new Set();       // materials this view can't sample (its own render target)
        this.data = new Float32Array(UNIFORM_FLOATS);
    }

    // frame: { time, lightsOn, alarmPulse, lights: up to 6 x [x, y, z, intensity, r, g, b, 0] }
    update(viewProj, eye, frame) {
        const u = this.data;
        u.fill(0);
        u.set(viewProj, 0);
        u.set([eye[0], eye[1], eye[2], 1], 16);
        u.set([frame.time, frame.lightsOn ? 1 : 0, frame.alarmPulse, 0], 20);
        frame.lights.slice(0, MAX_LIGHTS).forEach((l, i) => u.set(l, 24 + i * 8));
        this.renderer.device.queue.writeBuffer(this.buffer, 0, u);
    }

    group(material) {
        return this.renderer.groupFor(this, material);
    }
}

// Offscreen colour + depth/stencil target with its own view (camera)
class RenderTarget {
    constructor(renderer, width, height, { copySrc = false } = {}) {
        this.renderer = renderer;
        this.width = width;
        this.height = height;
        this.aspect = width / height;
        this.texture = renderer.device.createTexture({
            size: [width, height],
            format: renderer.format,
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | (copySrc ? GPUTextureUsage.COPY_SRC : 0)
        });
        this.colorView = this.texture.createView();
        this.depthView = renderer.device.createTexture({
            size: [width, height], format: DEPTH_FORMAT, usage: GPUTextureUsage.RENDER_ATTACHMENT
        }).createView();
        this.view = renderer.createView();
    }

    beginScene() {
        return this.renderer.beginScenePass(this.colorView, this.depthView, this.view);
    }
}

// Thin wrapper over a render pass that avoids redundant pipeline / bind-group switches
class ScenePass {
    constructor(renderer, pass, view, forceStencil) {
        this.renderer = renderer;
        this.pass = pass;
        this.view = view;
        this.forceStencil = forceStencil;
        this.pipeline = null;
        this.bindGroup = null;
    }

    use(pipeline, group) {
        if (pipeline !== this.pipeline) { this.pass.setPipeline(pipeline); this.pipeline = pipeline; }
        if (group !== this.bindGroup) { this.pass.setBindGroup(0, group); this.bindGroup = group; }
    }

    mesh(mesh, firstInstance, count = 1) {
        this.use(this.renderer.pipelines.scene, this.view.group('atlas'));
        this.pass.setVertexBuffer(0, mesh.buffer);
        this.pass.draw(mesh.count, count, 0, firstInstance);
    }

    // GUI surface geometry that marks its visible pixels with `stencilRef`
    anchor(mesh, instance, stencilRef) {
        this.use(this.renderer.pipelines.anchor, this.view.group('atlas'));
        this.pass.setStencilReference(stencilRef);
        this.pass.setVertexBuffer(0, mesh.buffer);
        this.pass.draw(mesh.count, 1, 0, instance);
    }

    // A GUI model's surfaces; each material picks its shading pipeline and texture
    gui(model, instance, stencilRef) {
        if (!model.count) return;
        const r = this.renderer;
        this.pass.setStencilReference(stencilRef);
        this.pass.setVertexBuffer(0, model.buffer);
        const stencil = r.useStencil || this.forceStencil;
        for (const surf of model.surfaces) {
            const group = this.view.group(surf.material);
            if (!group) continue;
            const shading = r.shadings[r.materials.get(surf.material).shading];
            this.use(stencil ? shading.stencil : shading.depth, group);
            this.pass.draw(surf.count, 1, surf.first, instance);
        }
    }

    end() {
        this.pass.end();
    }
}
