'use strict';
// Routes the mouse to EntityGUIs, like Doom 3 tracing the view against gui surfaces.
// The view-model GUI (the phone) is in front of everything; otherwise the nearest world GUI under the
// cursor gets it, as long as the player is within its use range.

class InteractionSystem {
    constructor(game) {
        this.game = game;
        this.focus = null;      // GUI under the cursor
        this.capture = null;    // GUI holding the pointer during a drag
    }

    get guis() {
        return [this.game.phone.gui, ...this.game.world.guis];
    }

    hover() {
        const { input, player, phone, world } = this.game;
        for (const g of this.guis) {
            g.active = false;
            g.outOfRange = false;
        }
        this.focus = null;
        if (!input.mouse.inside || input.looking) return;

        if (phone.interactive) {
            const pt = phone.gui.trace(player.eye, player.viewRay(input.mouse, phone.fovy));
            if (pt) return this.setFocus(phone.gui, pt);
        }

        const dir = player.viewRay(input.mouse, player.fovy);
        let best = null;
        for (const g of world.guis) {
            const pt = g.trace(player.eye, dir);
            if (pt && (!best || pt.t < best.pt.t)) best = { gui: g, pt };
        }
        if (!best) return;
        if (!best.gui.inRange(player.eye)) {
            best.gui.outOfRange = true;
            return;
        }
        this.setFocus(best.gui, best.pt);
    }

    setFocus(gui, pt) {
        gui.active = true;
        gui.cursor.x = pt.x;
        gui.cursor.y = pt.y;
        this.focus = gui;
    }

    // Called every frame after hover
    drag() {
        if (this.capture) this.capture.pointerDrag();
    }

    // Returns 'capture' (a GUI took the press and wants drags), 'gui' (a GUI took it) or null
    pointerDown() {
        this.hover();
        if (!this.focus) return null;
        if (this.focus.pointerDown()) {
            this.capture = this.focus;
            return 'capture';
        }
        return 'gui';
    }

    pointerUp() {
        if (this.capture) this.capture.pointerUp();
        this.capture = null;
    }

    wheel(dy) {
        return !!(this.focus && this.focus.wheel(dy));
    }
}
