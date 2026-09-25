'use strict';
// Game: builds every system from the scenario and runs the frame.
//
// Frame order:
//   simulate (player, world, phone) -> route the cursor -> update + rebuild GUI models
//   -> decide which render targets are needed -> write instances -> encode passes:
//      paint canvases, CCTV, phone camera, player view, phone view model -> submit

class FrameStats {
    constructor() {
        this.fps = '--';
        this.acc = 0;
        this.frames = 0;
    }

    tick(dt) {
        this.acc += dt;
        this.frames++;
        if (this.acc > 0.5) {
            this.fps = String(Math.round(this.frames / this.acc));
            this.acc = 0;
            this.frames = 0;
        }
    }

    gui(g) {
        return `${g.model.quads} quads, ${g.model.surfaces.length} surf.`;
    }
}

class Game {
    constructor(scenario, canvas) {
        this.scenario = scenario;
        this.canvas = canvas;
        this.renderer = new Renderer(canvas);
        this.audio = new AudioSystem();
        this.input = new InputSystem(this, canvas);
        this.stats = new FrameStats();
        this.lastTime = performance.now();
    }

    async start() {
        const r = this.renderer;
        await r.init();
        await GuiAtlas.loadFonts();
        await r.createPipelines();
        r.setWorldMaterials(new MaterialTable(this.scenario.materials));

        this.atlas = new GuiAtlas();
        r.registerMaterial('atlas', 'gui', this.atlas.upload(r));
        this.dc = new DeviceContext(this.atlas);

        const s = this.scenario;
        this.world = new World(this, s);
        this.player = new PlayerController(this, s.player);
        this.cctv = new CctvSystem(this, s.cctv);
        this.camera = new PhoneCamera(this, s.media);
        this.iptv = new IptvPlayer(this, s.iptv);
        this.phone = new PhoneDevice(this, s.phone);
        this.interaction = new InteractionSystem(this);
        this.bindings = new Bindings(this);

        this.cctv.init(r);
        this.camera.init(r);
        this.iptv.init(r);
        this.world.init(r);
        this.phone.init(r);
        r.finalizeInstances();
        this.mainView = r.createView();

        this.input.attach();
        window.addEventListener('resize', () => r.resize());
        requestAnimationFrame((now) => this.frame(now));
    }

    get guis() {
        return [...this.world.guis, this.phone.gui];
    }

    frame(now) {
        const dt = Math.min(0.05, Math.max(0, (now - this.lastTime) / 1000));
        this.lastTime = now;
        const t = now / 1000;
        const { renderer: r, world, player, phone, interaction, dc } = this;

        // Simulation
        player.update(dt, this.input.keys);
        world.update(dt, t);
        phone.update(dt, t);

        // GUIs: cursor routing, logic, then rebuild their models
        interaction.hover();
        interaction.drag();
        this.canvas.style.cursor = this.input.cursorStyle;
        for (const g of this.guis) g.update(dt, now);
        for (const g of world.guis) g.build(dc, now);
        if (phone.visible) phone.gui.build(dc, now);

        // Views and render targets for this frame
        const frame = world.frameState(t);
        const view = player.viewMatrix();
        this.mainView.update(M4.multiply(M4.perspective(player.fovy, r.aspect, 0.02, 100), view), player.eye, frame);
        phone.prepare(frame, view);
        if (!phone.visible) this.iptv.fullscreen = false;
        this.iptv.update(phone.visible && (this.iptv.fullscreen || phone.gui.pagesVisible().includes('tv')));
        this.cctv.prepare(frame);
        this.camera.prepare(frame);

        world.writeInstances(r);
        phone.writeInstances(r);

        // Passes
        r.beginFrame();
        for (const easel of world.ofType(Easel)) easel.canvas.flush(r);
        this.cctv.render();
        this.camera.render(now);
        const pass = r.beginScenePass(r.swapView, r.depthView, this.mainView);
        world.render(pass, { showAvatar: false });
        pass.end();
        phone.render();
        r.endFrame();

        this.stats.tick(dt);
        requestAnimationFrame((n) => this.frame(n));
    }
}
