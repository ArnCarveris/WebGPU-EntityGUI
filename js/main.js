'use strict';
// Entry point.

function showFallback(msg) {
    document.getElementById('fallback').classList.add('show');
    document.getElementById('error-message').textContent = msg;
}

window.addEventListener('DOMContentLoaded', async () => {
    const game = new Game(SCENARIO, document.getElementById('view'));
    game.renderer.onError = showFallback;
    window.game = game;     // handy from the devtools console
    try {
        await game.start();
    } catch (err) {
        console.error('WebGPU Initialization Error:', err);
        showFallback(err.message || 'Failed to initialize WebGPU.');
    }
});
