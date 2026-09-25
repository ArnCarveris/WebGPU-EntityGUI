'use strict';
// Mouse / keyboard. Presses go to the GUI under the cursor first; otherwise dragging looks around.

class InputSystem {
    constructor(game, canvas) {
        this.game = game;
        this.canvas = canvas;
        this.mouse = { x: 0, y: 0, inside: false };
        this.keys = new Set();
        this.looking = false;       // dragging to look around
    }

    attach() {
        const { canvas, game } = this;
        const track = (e) => {
            this.mouse.x = e.clientX;
            this.mouse.y = e.clientY;
            this.mouse.inside = true;
        };
        canvas.addEventListener('pointermove', (e) => {
            track(e);
            if (this.looking) game.player.look(e.movementX, e.movementY);
        });
        canvas.addEventListener('pointerleave', () => { this.mouse.inside = false; });
        canvas.addEventListener('pointerdown', (e) => {
            track(e);
            const taken = game.interaction.pointerDown();
            if (!taken) this.looking = true;
            if (taken !== 'gui') canvas.setPointerCapture(e.pointerId);
        });
        const release = () => {
            this.looking = false;
            game.interaction.pointerUp();
        };
        canvas.addEventListener('pointerup', release);
        canvas.addEventListener('pointercancel', release);
        window.addEventListener('pointerup', release);
        canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            // Wheel over a GUI (lists, brush size...) goes to it; otherwise it steps the player
            if (!game.interaction.wheel(e.deltaY)) game.player.stepForward(-e.deltaY * 0.003);
        }, { passive: false });

        window.addEventListener('keydown', (e) => {
            if (e.code === 'Tab') {
                e.preventDefault();
                if (!e.repeat) game.phone.setShown(!game.phone.target);
                return;
            }
            if (e.code === 'Escape') game.phone.setShown(false);
            this.keys.add(e.code);
            if (e.code.startsWith('Arrow')) e.preventDefault();
        });
        window.addEventListener('keyup', (e) => this.keys.delete(e.code));
        window.addEventListener('blur', () => this.keys.clear());
    }

    get cursorStyle() {
        if (this.game.interaction.focus) return 'none';    // the GUI draws its own cursor
        return this.looking ? 'grabbing' : 'crosshair';
    }
}
