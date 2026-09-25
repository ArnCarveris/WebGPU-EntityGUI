'use strict';
// Phone camera and the media library it fills.
//
// Photos: the viewfinder render target is copied into a slot of a photo atlas ('photos' material).
// Videos: each recorded frame is downscaled into one layer of a texture-array frame pool ('video'
// material; the GUI vertex colour's red channel picks the layer). Everything stays on the GPU.

class MediaLibrary {
    constructor(cfg) {
        this.cfg = cfg;
        this.items = [];            // newest first: { id, kind: 'photo' | 'video', slot | frames, time, x, z, hdg, label }
        this.nextId = 1;
        const pool = cfg.video.pool;
        this.freeLayers = Array.from({ length: pool }, (_, i) => pool - 1 - i);
        const [pw, ph] = cfg.photo.size;
        const [vw, vh] = cfg.video.size;
        this.photoSquareInset = (ph - pw) / 2;
        this.frameSquareInset = (vh - vw) / 2 / vh;
    }

    init(renderer) {
        const { photo, video } = this.cfg;
        this.photoAtlas = renderer.device.createTexture({
            size: [photo.atlas, photo.atlas],
            format: renderer.format,
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
        });
        renderer.registerMaterial('photos', 'gui', this.photoAtlas.createView());

        const [vw, vh] = video.size;
        this.framePool = renderer.device.createTexture({
            size: [vw, vh, video.pool],
            format: renderer.format,
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
        });
        this.layerViews = Array.from({ length: video.pool }, (_, i) =>
            this.framePool.createView({ dimension: '2d', baseArrayLayer: i, arrayLayerCount: 1 }));
        renderer.registerMaterial('video', 'video', this.framePool.createView({ dimension: '2d-array' }));
    }

    get photoCols() {
        return Math.floor(this.cfg.photo.atlas / this.cfg.photo.size[0]);
    }

    slotOrigin(slot) {
        const [pw, ph] = this.cfg.photo.size;
        return [(slot % this.photoCols) * pw, Math.floor(slot / this.photoCols) * ph, 0];
    }

    photoUV(slot, square = false) {
        const [pw, ph] = this.cfg.photo.size;
        const A = this.cfg.photo.atlas;
        const [x, y] = this.slotOrigin(slot);
        const inset = square ? this.photoSquareInset : 0;   // centre crop for square thumbnails
        return [x / A, (y + inset) / A, (x + pw) / A, (y + ph - inset) / A];
    }

    // Draw an item's picture: photos with the 'photos' material, video frames with 'video'
    draw(dc, item, x, y, w, h, square, frame = 0) {
        if (item.kind === 'photo') {
            const [u0, v0, u1, v1] = this.photoUV(item.slot, square);
            dc.setMaterial('photos');
            dc.stretchPic(x, y, w, h, u0, v0, u1, v1, [1, 1, 1, 1]);
        } else {
            const inset = square ? this.frameSquareInset : 0;
            dc.setMaterial('video');
            dc.stretchPic(x, y, w, h, 0, inset, 1, 1 - inset, [item.frames[frame], 1, 1, 1]);
        }
        dc.setMaterial('atlas');
    }

    frameAt(item, now) {
        return Math.floor(((now / 1000) * this.cfg.video.fps) % item.frames.length);
    }

    duration(item) {
        return item.frames.length / this.cfg.video.fps;
    }

    counts() {
        const videos = this.items.filter((m) => m.kind === 'video').length;
        return { photos: this.items.length - videos, videos };
    }

    summary() {
        const c = this.counts();
        return `${c.photos} photo${c.photos === 1 ? '' : 's'}, ${c.videos} video${c.videos === 1 ? '' : 's'}`;
    }

    indexOf(id) {
        return this.items.findIndex((m) => m.id === id);
    }

    remove(idx) {
        const [item] = this.items.splice(idx, 1);
        if (item.kind === 'video') this.freeLayers.push(...item.frames);
        return item;
    }

    add(item) {
        item.id = this.nextId++;
        this.items.unshift(item);
        return item;
    }

    allocPhotoSlot() {
        const used = new Set(this.items.filter((m) => m.kind === 'photo').map((m) => m.slot));
        for (let i = 0; i < this.cfg.photo.capacity; i++) if (!used.has(i)) return i;
        for (let i = this.items.length - 1; i >= 0; i--) {                 // full: recycle the oldest photo
            if (this.items[i].kind === 'photo') return this.remove(i).slot;
        }
        return 0;
    }

    // A free frame-pool layer; when the pool is full the oldest finished video is dropped
    allocVideoLayer() {
        if (!this.freeLayers.length) {
            for (let i = this.items.length - 1; i >= 0; i--) {
                if (this.items[i].kind === 'video') { this.remove(i); break; }
            }
        }
        return this.freeLayers.length ? this.freeLayers.pop() : -1;
    }
}

class PhoneCamera {
    constructor(game, cfg) {
        this.game = game;
        this.cfg = cfg;
        this.library = new MediaLibrary(cfg);
        this.mode = 'photo';            // 'photo' | 'video'
        this.rec = null;                // active recording
        this.captureRequested = false;
        this.lastShot = -1e9;
        this.seeds = [...cfg.seedShots];
        this.shot = null;               // camera rendering this frame
    }

    init(renderer) {
        this.library.init(renderer);
        const [w, h] = this.cfg.photo.size;
        this.target = new RenderTarget(renderer, w, h, { copySrc: true });
        this.target.view.exclude.add('viewfinder');
        renderer.registerMaterial('viewfinder', 'gui', this.target.colorView);

        const module = renderer.device.createShaderModule({ code: BLIT_SHADER });
        this.blitPipeline = renderer.device.createRenderPipeline({
            layout: 'auto',
            vertex: { module, entryPoint: 'vs' },
            fragment: { module, entryPoint: 'fs', targets: [{ format: renderer.format }] },
            primitive: { topology: 'triangle-list' }
        });
        this.blitGroup = renderer.device.createBindGroup({
            layout: this.blitPipeline.getBindGroupLayout(0),
            entries: [{ binding: 0, resource: renderer.sampler }, { binding: 1, resource: this.target.colorView }]
        });
    }

    get recordingSeconds() {
        return this.rec ? this.rec.frames.length / this.cfg.video.fps : 0;
    }

    get freeVideoSeconds() {
        return this.library.freeLayers.length / this.cfg.video.fps;
    }

    // ---- actions ----
    shutter() {
        if (this.mode === 'photo') this.takePhoto();
        else if (this.rec) this.stopRecording();
        else this.startRecording();
    }

    takePhoto() {
        this.captureRequested = true;
        this.lastShot = performance.now();
        this.game.phone.kick = 1;
        this.game.audio.shutter();
    }

    startRecording() {
        const p = this.game.player;
        this.rec = { frames: [], t0: performance.now(), time: new Date(), x: p.pos[0], z: p.pos[2], hdg: p.heading, label: this.game.world.placeLabel(p.pos[0], p.pos[2]) };
        this.game.audio.chime(true);
    }

    stopRecording() {
        const rec = this.rec;
        if (!rec) return;
        this.rec = null;
        this.game.audio.chime(false);
        if (!rec.frames.length) return;
        this.library.add({ kind: 'video', frames: rec.frames, time: rec.time, x: rec.x, z: rec.z, hdg: rec.hdg, label: rec.label });
    }

    // ---- per frame ----
    // The viewfinder renders while the phone shows the Camera page; otherwise pending startup shots
    prepare(frame) {
        const phone = this.game.phone;
        this.shot = null;
        if (phone.visible && phone.gui.pagesVisible().includes('camera')) {
            const m = phone.model;
            const dir = [-m[8], -m[9], -m[10]];                 // the phone's back faces away from its screen
            this.shot = { pos: V3.add([m[12], m[13], m[14]], V3.scale(dir, 0.012)), dir, up: [m[4], m[5], m[6]], showAvatar: false };
        } else if (this.seeds.length) {
            const s = this.seeds.shift();
            this.shot = { pos: s.pos, dir: V3.normalize(V3.sub(s.target, s.pos)), up: [0, 1, 0], showAvatar: true, label: s.label };
        } else {
            this.captureRequested = false;
        }
        if (this.rec && !(this.shot && !this.shot.label)) this.stopRecording();   // viewfinder closed
        if (this.shot) {
            const s = this.shot;
            this.target.view.update(M4.viewProjection(s.pos, s.dir, s.up, this.cfg.photo.fovY, this.target.aspect, 0.03, 60), s.pos, frame);
        }
    }

    render(now) {
        const s = this.shot;
        if (!s) return;
        const r = this.game.renderer;
        const pass = this.target.beginScene();
        this.game.world.render(pass, { showAvatar: s.showAvatar });
        pass.end();

        const lib = this.library;
        if (s.label || this.captureRequested) {
            const slot = lib.allocPhotoSlot();
            r.encoder.copyTextureToTexture({ texture: this.target.texture }, { texture: lib.photoAtlas, origin: lib.slotOrigin(slot) }, [...this.cfg.photo.size, 1]);
            lib.add({
                kind: 'photo', slot, time: new Date(), x: s.pos[0], z: s.pos[2],
                hdg: bearingOf(s.dir[0], s.dir[2]), label: s.label || this.game.world.placeLabel(s.pos[0], s.pos[2])
            });
            this.captureRequested = false;
        }

        // Video: downscale the viewfinder into the next frame-pool layer at the recording frame rate
        const rec = this.rec, v = this.cfg.video;
        if (rec && !s.label && rec.frames.length < Math.floor(((now - rec.t0) / 1000) * v.fps) + 1) {
            const layer = rec.frames.length < v.maxSeconds * v.fps ? lib.allocVideoLayer() : -1;
            if (layer < 0) {
                this.stopRecording();
            } else {
                const bp = r.encoder.beginRenderPass({
                    colorAttachments: [{ view: lib.layerViews[layer], clearValue: CLEAR_COLOR, loadOp: 'clear', storeOp: 'store' }]
                });
                bp.setPipeline(this.blitPipeline);
                bp.setBindGroup(0, this.blitGroup);
                bp.draw(3);
                bp.end();
                rec.frames.push(layer);
            }
        }
    }
}
