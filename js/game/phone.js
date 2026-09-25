'use strict';
// The handheld phone: a view model carrying the PhoneGUI. It's drawn in its own pass with fresh
// depth/stencil and a fixed field of view, so it never clips into walls and the FOV setting can't
// move it under the cursor (Doom 3's weaponDepthHack idea).

class PhoneDevice {
    constructor(game, cfg) {
        this.game = game;
        this.cfg = cfg;
        this.gui = new PhoneGUI(game, cfg);
        this.target = cfg.startShown;
        this.anim = 0;              // 0 hidden .. 1 in hand
        this.kick = 0;              // shutter recoil
        this.land = 0;              // 0 portrait .. 1 landscape (full-screen TV)
        this.model = M4.identity();
        this.fovy = rad(cfg.fovDeg);
    }

    init(renderer) {
        this.mesh = this.game.world.mesh(this.cfg.model);
        this.instance = renderer.allocInstances(1);
        this.view = renderer.createView();
        this.gui.attach(this.game);
    }

    get visible() { return this.anim > 0.001; }
    get interactive() { return this.target && this.anim > 0.9; }

    setShown(on) {
        if (this.target === on) return;
        this.target = on;
        this.gui.drag = null;
        if (!on) this.game.iptv.fullscreen = false;
        this.game.audio.tone(on ? 700 : 520, 0.07, 'sine', 0.03, on ? 1100 : 300);
    }

    update(dt, t) {
        this.anim = clamp(this.anim + ((this.target ? 1 : -1) * dt) / this.cfg.showSeconds, 0, 1);
        this.kick *= Math.exp(-dt * 14);
        this.land = clamp(this.land + ((this.game.iptv.fullscreen ? 1 : -1) * dt) / 0.35, 0, 1);
        this.model = this.pose(t);
        this.gui.setTransform(this.model);
    }

    // Pose relative to the eye: swings up from below with an overshoot when shown, sways while
    // walking, turns to landscape for full-screen TV
    pose(t) {
        const player = this.game.player, P = this.cfg.pose;
        const a = this.anim;
        const e = this.target ? easeOutBack(a) : smooth01(a);
        const bob = player.moving ? 1 : 0;
        const bx = Math.sin(player.stepPhase) * 0.0025 * bob;
        const by = Math.abs(Math.cos(player.stepPhase)) * 0.003 * bob + Math.sin(t * 1.3) * 0.0008;
        const L = smooth01(this.land);
        const off = [
            lerp(lerp(P.hidden.offset[0], P.shown.offset[0], e), P.landscape.offset[0], L) + bx,
            lerp(P.hidden.offset[1], P.shown.offset[1], e) + by * (1 - L),
            lerp(P.shown.offset[2], P.landscape.offset[2], L) + this.kick * 0.006
        ];
        return M4.chain(
            M4.facing(player.eye, player.basis().fwd),
            M4.translation(...off),
            M4.rotationY(lerp(lerp(P.hidden.yaw, P.shown.yaw, e), 0, L)),
            M4.rotationX(lerp(P.hidden.tilt, P.shown.tilt, e) + this.kick * 0.04),
            M4.rotationZ((L * Math.PI) / 2)
        );
    }

    prepare(frame, viewMatrix) {
        const r = this.game.renderer;
        this.view.update(M4.multiply(M4.perspective(this.fovy, r.aspect, 0.02, 100), viewMatrix), this.game.player.eye, frame);
    }

    writeInstances(renderer) {
        renderer.setInstance(this.instance, this.model);
        this.gui.writeInstances(renderer);
    }

    render() {
        if (!this.visible) return;
        const r = this.game.renderer;
        const pass = r.beginScenePass(r.swapView, r.depthView, this.view, { load: true, forceStencil: true });
        pass.mesh(this.mesh, this.instance);
        this.gui.render(pass);
        pass.end();
    }
}
