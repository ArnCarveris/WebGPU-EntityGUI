'use strict';
// EntityGUI: a Doom 3-style GUI surface.
//
// A rectangle on an entity (the "surface") plus a GUI that draws textured quads into its own virtual
// screen space. Each frame the GUI is rebuilt into a GuiModel; the model is placed on the surface with
// a matrix derived from the surface's texture axes (R_RenderGuiSurf), and the cursor is found by
// tracing the view ray against the surface (GuiTrace).
//
// Rendering: the surface geometry (the "anchor") writes this GUI's own stencil value wherever it is
// visible, then the GUI quads draw with depth ALWAYS + stencil EQUAL. No z-fighting, correct occlusion,
// and GUIs can never draw through each other.
//
// Subclasses implement draw(dc, now) and react to input via onPress / pointerDrag / pointerUp / wheel.

class EntityGUI {
    // def: { id, size: [w, h] metres, virtual: [vw, vh], zOffset, crt, range, anchorMaterial, maxVerts }
    constructor(def) {
        this.def = def;
        this.id = def.id;
        [this.width, this.height] = def.size;
        [this.vw, this.vh] = def.virtual;
        this.crt = !!def.crt;
        this.range = def.range ?? Infinity;
        this.tri = GuiSurface.tri(this.width, this.height, def.zOffset || 0);
        this.model = new GuiModel(def.maxVerts || 16000);
        this.surfaceMatrix = M4.identity();

        this.cursor = { x: this.vw / 2, y: this.vh / 2 };
        this.active = false;        // the cursor is on this GUI and it can be used
        this.outOfRange = false;    // the cursor is on this GUI but it's too far away to use
        this.buttons = [];          // hit regions, rebuilt every frame while drawing
        this.hoverId = null;
        this.pressId = null;
        this.pressTime = 0;
        this.game = null;
    }

    attach(game) {
        const r = game.renderer;
        this.game = game;
        this.stencilRef = r.nextStencilRef();
        this.anchorInstance = r.allocInstances(1);
        this.guiInstance = r.allocInstances(1);
        this.anchorMesh = r.createMesh(new MeshBuilder(r.worldMaterials).surface(this.tri, this.def.anchorMaterial || 'glass'));
        this.model.createBuffer(r);
    }

    get audio() {
        return this.game.audio;
    }

    // ---- placement & picking ----
    setTransform(matrix) {
        this.surfaceMatrix = matrix;
    }

    center() {
        return M4.transformPoint(this.surfaceMatrix, [0, 0, 0]);
    }

    trace(origin, dir) {
        return GuiSurface.trace(this.tri, this.surfaceMatrix, this.vw, this.vh, origin, dir);
    }

    inRange(eye) {
        return V3.length(V3.sub(eye, this.center())) <= this.range;
    }

    // ---- hit regions ----
    addButton(id, x, y, w, h) {
        this.buttons.push({ id, x, y, w, h });
    }

    isHover(id) {
        return this.active && this.hoverId === id;
    }

    isPressed(id, ms = 160) {
        return this.pressId === id && performance.now() - this.pressTime < ms;
    }

    hitButton() {
        return hitIn(this.buttons, this.cursor);
    }

    canHover() {
        return this.active;
    }

    // ---- per frame ----
    update(dt, now) {}

    // Rebuild the GUI model. Hover resolves against last frame's hit regions.
    build(dc, now) {
        const hit = this.canHover() ? this.hitButton() : null;
        const hoverId = hit ? hit.id : null;
        if (hoverId !== this.hoverId) {
            this.hoverId = hoverId;
            if (hoverId) this.onHover(hoverId);
        }
        this.buttons = [];
        dc.begin(this.model);
        this.draw(dc, now);
        if (this.outOfRange) this.drawRangeHint(dc, now);
        if (this.active) this.drawCursor(dc, now);
        dc.end();
        this.model.upload(this.game.renderer);
    }

    draw(dc, now) {}
    drawRangeHint(dc, now) {}
    drawCursor(dc) {
        dc.image('cursor', this.cursor.x, this.cursor.y, 24, 24, [1, 1, 1, 1]);
    }

    // ---- input (routed by InteractionSystem) ----
    // Returns true to capture the pointer until it's released (drags)
    pointerDown() {
        const b = this.hitButton();
        if (b) {
            this.pressId = b.id;
            this.pressTime = performance.now();
        }
        return this.onPress(b) === true;
    }

    onPress(button) {}
    onHover(id) {}
    pointerDrag() {}        // every frame while captured
    pointerUp() {}
    wheel(dy) { return false; }

    // ---- rendering ----
    writeInstances(renderer) {
        renderer.setInstance(this.anchorInstance, this.surfaceMatrix);
        renderer.setInstance(this.guiInstance, GuiSurface.modelMatrix(this.tri, this.surfaceMatrix, this.vw, this.vh), [this.crt ? 1 : 0, 0, 0, 0]);
    }

    render(pass) {
        pass.anchor(this.anchorMesh, this.anchorInstance, this.stencilRef);
        pass.gui(this.model, this.guiInstance, this.stencilRef);
    }
}
