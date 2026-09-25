'use strict';
// Phone apps: custom-drawn pages of the PhoneGUI.

class PhoneApp {
    constructor(phone) {
        this.phone = phone;
    }

    get game() { return this.phone.game; }
    get W() { return this.phone.vw; }
    get H() { return this.phone.vh; }

    draw(dc, now, pageId) {}
    // Handle a press on one of this app's hit regions; return true if handled
    onPress(kind, key, idx) { return false; }
}

// Far Cry-style radar: heading-up, rotating compass ring, tracked objects and sound waves
class RadarApp extends PhoneApp {
    static DISC = { x: 135, y: 254, R: 92 };

    get cfg() { return this.game.scenario.radar; }

    point(wx, wz) {
        const p = this.game.player, D = RadarApp.DISC;
        const dx = wx - p.pos[0], dz = wz - p.pos[2];
        const dist = Math.hypot(dx, dz);
        const a = Math.atan2(dx, -dz) - p.yaw;
        const r = (dist / this.cfg.range) * D.R;
        return { x: D.x + Math.sin(a) * r, y: D.y - Math.cos(a) * r, r, dist, a, bearingDeg: bearingOf(dx, dz) };
    }

    // Scenario-listed objects, resolved to current positions
    tracked() {
        const { world, player } = this.game;
        return this.cfg.tracked.map((t) => {
            if (t.nearest) {
                const pick = world.ofType(ENTITY_TYPES[t.nearest])
                    .map((e) => ({ e, d: Math.hypot(e.position[0] - player.pos[0], e.position[2] - player.pos[2]) }))
                    .sort((a, b) => a.d - b.d)[0].e;
                return { ...t, name: `${t.prefix}${pick.label}`, x: pick.position[0], z: pick.position[2] };
            }
            const e = world.get(t.entity);
            return { ...t, x: e.position[0], z: e.position[2] };
        });
    }

    draw(dc, now) {
        const t = now / 1000, G = [120, 255, 150];
        const { x: cx, y: cy, R } = RadarApp.DISC;
        const { player, world, cctv } = this.game;
        const range = this.cfg.range;
        const top = PHONE_NAV_H;

        dc.roundRect(12, top + 8, 246, 304, 14, col([8, 16, 10]));

        // Noise meter + heading readout
        dc.text('NOISE', 26, top + 28, 11, col(G), 'left', false, 'sansBold');
        dc.roundRect(70, top + 20, 100, 8, 4, col(G, 0.15));
        const n = clamp(player.noise, 0, 1);
        const nc = n < 0.4 ? G : n < 0.75 ? [255, 214, 10] : [255, 69, 58];
        if (n > 0.01) dc.roundRect(70, top + 20, 100 * n, 8, 4, col(nc));
        dc.text(`HDG ${pad3(player.heading)}°`, 246, top + 28, 12, col(G), 'right', false, 'sansBold');

        // Disc, range rings, crosshair
        dc.circle(cx, cy, R, col([12, 42, 20]), 48);
        for (const k of [1, 2]) dc.ring(cx, cy, (R * k) / 3, 1, col(G, 0.22));
        dc.ring(cx, cy, R, 1.5, col(G, 0.6));
        dc.fillRect(cx - R, cy - 0.5, R * 2, 1, col(G, 0.15));
        dc.fillRect(cx - 0.5, cy - R, 1, R * 2, col(G, 0.15));
        dc.text(`${range / 3}m`, cx + 3, cy - R / 3 - 3, 9, col(G, 0.5), 'left', false, 'sans');
        dc.text(`${(range * 2) / 3}m`, cx + 3, cy - (R * 2) / 3 - 3, 9, col(G, 0.5), 'left', false, 'sans');

        // Sweep
        const sw = t * 2.2;
        dc.polygon([[cx, cy], ...dc.arcPts(cx, cy, R - 1, sw - 0.6, sw, 10)], col(G, 0.08));
        dc.line(cx, cy, cx + Math.cos(sw) * (R - 1), cy + Math.sin(sw) * (R - 1), 1.2, col(G, 0.45));

        // Rotating compass ring
        for (let d = 0; d < 360; d += 15) {
            const a = rad(d) - player.yaw;
            const len = d % 90 === 0 ? 10 : d % 45 === 0 ? 7 : 4;
            const s = Math.sin(a), c = -Math.cos(a);
            dc.line(cx + s * (R + 3), cy + c * (R + 3), cx + s * (R + 3 + len), cy + c * (R + 3 + len), d % 90 === 0 ? 2 : 1, col(G, d % 45 === 0 ? 0.9 : 0.45));
        }
        for (const [d, label] of [[0, 'N'], [90, 'E'], [180, 'S'], [270, 'W']]) {
            const a = rad(d) - player.yaw;
            dc.text(label, cx + Math.sin(a) * (R + 22), cy - Math.cos(a) * (R + 22) + 4.5, 13, col(label === 'N' ? [255, 69, 58] : G), 'center', false, 'sansBold');
        }

        // Sound waves (world-anchored rings), clipped to the disc
        for (const w of world.waves.list) {
            const age = t - w.t0;
            if (age < 0 || age > w.life) continue;
            const c = this.point(w.x, w.z);
            const rr = ((w.speed * age) / range) * R;
            const alpha = w.alpha * (1 - age / w.life);
            const pts = dc.arcPts(c.x, c.y, rr, 0, Math.PI * 2, 40);
            for (let i = 0; i < pts.length - 1; i++) {
                const p0 = pts[i], p1 = pts[i + 1];
                if (Math.hypot(p0[0] - cx, p0[1] - cy) > R - 1 || Math.hypot(p1[0] - cx, p1[1] - cy) > R - 1) continue;
                dc.line(p0[0], p0[1], p1[0], p1[1], 1.6, col(w.color, alpha));
            }
        }

        // Cameras as small squares
        for (const cam of cctv.cameras) {
            const p = this.point(cam.position[0], cam.position[2]);
            if (p.r > R - 3) continue;
            dc.fillRect(p.x - 2.5, p.y - 2.5, 5, 5, col([255, 214, 10], cam.offline ? 0.35 : 0.85));
        }
        // Tracked objects (clamped to the rim when out of range)
        const tracked = this.tracked();
        for (const o of tracked) {
            if (o.shape === 'camera') continue;
            const p = this.point(o.x, o.z);
            const out = p.r > R - 6;
            const bx = out ? cx + Math.sin(p.a) * (R - 6) : p.x;
            const by = out ? cy - Math.cos(p.a) * (R - 6) : p.y;
            const alpha = out ? 0.5 : 1;
            if (o.shape === 'pulse') {
                const pulse = (t * 1.5) % 1;
                if (!out) dc.ring(bx, by, 5 + pulse * 10, 1.2, col(o.color, 0.8 * (1 - pulse)), 24);
                dc.circle(bx, by, 5, col(o.color, alpha), 16);
            } else if (o.shape === 'diamond') {
                dc.polygon([[bx, by - 6], [bx + 6, by], [bx, by + 6], [bx - 6, by]], col(o.color, alpha));
            } else {
                dc.fillRect(bx - 6, by - 3, 12, 6, col(o.color, alpha));
            }
        }

        // Player
        dc.polygon([[cx, cy - 10], [cx + 7, cy + 7], [cx, cy + 3], [cx - 7, cy + 7]], col([255, 255, 255]));

        // Tracking list
        dc.text('TRACKING', 28, top + 338, 11.5, col(IOS.sub), 'left', false, 'sans');
        const listTop = top + 346;
        dc.roundRect(12, listTop, 246, tracked.length * 32, 10, col(IOS.cell));
        tracked.forEach((o, i) => {
            const y = listTop + i * 32;
            const p = this.point(o.x, o.z);
            dc.circle(30, y + 16, 5, col(o.color), 14);
            dc.text(o.name, 44, y + 21, 13.5, col(IOS.text), 'left', false, 'sans');
            dc.text(`${p.dist.toFixed(1)} m  ${pad3(p.bearingDeg)}°`, 244, y + 21, 12, col(IOS.sub), 'right', false, 'sans');
            if (i < tracked.length - 1) dc.fillRect(44, y + 30.5, 214, 1.5, col(IOS.sep, 0.55));
        });
    }
}

// Camera: live viewfinder (the phone camera's render target), photo / video modes
class CameraApp extends PhoneApp {
    draw(dc, now, id) {
        const t = now / 1000, W = this.W, H = this.H, phone = this.phone;
        const cam = this.game.camera, lib = cam.library;
        phone.contentH[id] = 0;
        dc.fillRect(0, PHONE_NAV_H, W, H - PHONE_NAV_H, col([0, 0, 0]));
        const video = cam.mode === 'video';
        const rec = cam.rec;

        // Live viewfinder: a surface whose material is the phone camera's render target
        const V = { x: 0, y: PHONE_NAV_H + 6, w: W, h: 360 };
        dc.setMaterial('viewfinder');
        dc.stretchPic(V.x, V.y, V.w, V.h, 0, 0, 1, 1, [1, 1, 1, 1]);
        dc.setMaterial('atlas');
        for (const k of [1, 2]) {
            dc.fillRect(V.x + (V.w * k) / 3, V.y, 1, V.h, [1, 1, 1, 0.22]);
            dc.fillRect(V.x, V.y + (V.h * k) / 3, V.w, 1, [1, 1, 1, 0.22]);
        }
        const fs = 42 + Math.sin(t * 3) * 2;
        dc.rect(W / 2 - fs / 2, V.y + V.h / 2 - fs / 2, fs, fs, 1.5, col([255, 214, 10]));
        dc.roundRect(8, V.y + 8, 72, 20, 10, [0, 0, 0, 0.45]);
        dc.text(`HDG ${pad3(this.game.player.heading)}°`, 44, V.y + 22, 11, col([255, 255, 255]), 'center', false, 'sansBold');
        const right = video ? `${clipTime(cam.freeVideoSeconds)} free` : `${lib.counts().photos}/${cam.cfg.photo.capacity}`;
        dc.roundRect(W - 72, V.y + 8, 64, 20, 10, [0, 0, 0, 0.45]);
        dc.text(right, W - 40, V.y + 22, 11, col([255, 255, 255]), 'center', false, 'sansBold');
        if (rec) {
            // Recording timer + progress along the bottom of the viewfinder
            const secs = cam.recordingSeconds, max = cam.cfg.video.maxSeconds;
            dc.roundRect(W / 2 - 46, V.y + 8, 92, 20, 10, col(IOS.red, 0.92));
            if (Math.floor(t * 2) % 2) dc.circle(W / 2 - 33, V.y + 18, 3.5, [1, 1, 1, 1], 12);
            dc.text(`${clipTime(secs)} / ${clipTime(max)}`, W / 2 + 6, V.y + 22, 11, col([255, 255, 255]), 'center', false, 'sansBold');
            dc.fillRect(V.x, V.y + V.h - 3, V.w * Math.min(1, secs / max), 3, col(IOS.red));
        }
        const since = now - cam.lastShot;
        if (since < 280) dc.fillRect(V.x, V.y, V.w, V.h, [1, 1, 1, 1 - since / 280]);

        // Mode switch (locked while recording)
        const MY = V.y + V.h + 20;
        for (const [mode, x] of [['video', W / 2 - 38], ['photo', W / 2 + 38]]) {
            if (!rec) phone.hit(`mode:${mode}`, x - 32, MY - 14, 64, 24);
            const color = cam.mode === mode ? col([255, 214, 10]) : [1, 1, 1, rec ? 0.3 : phone.isHover(`mode:${mode}`) ? 1 : 0.7];
            dc.text(mode.toUpperCase(), x, MY + 4, 12, color, 'center', false, 'sansBold');
        }

        // Shutter: white for photos, red record / square stop for video
        const CY = H - 54;
        const hover = phone.isHover('shutter');
        const pressed = phone.isPressed('shutter', 180);
        phone.hit('shutter', W / 2 - 32, CY - 32, 64, 64);
        dc.ring(W / 2, CY, 30, 3, [1, 1, 1, 1], 40);
        if (!video) dc.circle(W / 2, CY, pressed ? 21 : 25, [1, 1, 1, hover ? 0.8 : 1], 36);
        else if (rec) dc.roundRect(W / 2 - 11, CY - 11, 22, 22, 5, col(IOS.red, hover ? 0.8 : 1));
        else dc.circle(W / 2, CY, pressed ? 21 : 24, col(IOS.red, hover ? 0.8 : 1), 36);

        // Newest item (opens the gallery)
        if (lib.items.length) {
            const item = lib.items[0];
            phone.hit('nav:photos', 18, CY - 22, 44, 44);
            lib.draw(dc, item, 18, CY - 22, 44, 44, true, item.kind === 'video' ? lib.frameAt(item, now) : 0);
            dc.rect(18, CY - 22, 44, 44, 1.5, [1, 1, 1, phone.isHover('nav:photos') ? 1 : 0.7]);
        } else {
            dc.roundRect(18, CY - 22, 44, 44, 6, [1, 1, 1, 0.12]);
        }
    }

    onPress(kind, key) {
        const cam = this.game.camera;
        if (kind === 'shutter') cam.shutter();
        else if (kind === 'mode') cam.mode = key;
        else return false;
        return true;
    }
}

// Photo / video grid
class GalleryApp extends PhoneApp {
    draw(dc, now, id) {
        const phone = this.phone, W = this.W, lib = this.game.camera.library, items = lib.items;
        const scroll = phone.scroll[id] || 0;
        const gap = 2, cs = (W - gap * 2) / 3;
        let y = PHONE_NAV_H + 6 - scroll;
        dc.setClip(0, PHONE_NAV_H, W, this.H - PHONE_NAV_H);
        dc.text(lib.summary(), 14, y + 16, 12, col(IOS.sub), 'left', false, 'sans');
        y += 26;
        if (!items.length) {
            dc.text('No photos or videos yet', W / 2, PHONE_NAV_H + 200, 17, col(IOS.text), 'center', false, 'sansBold');
            dc.text('Use the Camera page.', W / 2, PHONE_NAV_H + 222, 12, col(IOS.sub), 'center', false, 'sans');
        }
        const cell = (i) => [(i % 3) * (cs + gap), y + Math.floor(i / 3) * (cs + gap)];
        // Thumbnails grouped per material (photos, then videos) to keep the surface count low
        dc.setMaterial('photos');
        items.forEach((m, i) => {
            if (m.kind !== 'photo') return;
            const [x, ty] = cell(i);
            const [u0, v0, u1, v1] = lib.photoUV(m.slot, true);
            dc.stretchPic(x, ty, cs, cs, u0, v0, u1, v1, [1, 1, 1, 1]);
        });
        dc.setMaterial('video');
        items.forEach((m, i) => {
            if (m.kind !== 'video') return;
            const [x, ty] = cell(i);
            const inset = lib.frameSquareInset;
            dc.stretchPic(x, ty, cs, cs, 0, inset, 1, 1 - inset, [m.frames[lib.frameAt(m, now)], 1, 1, 1]);   // thumbnails play along
        });
        dc.setMaterial('atlas');
        items.forEach((m, i) => {
            const [x, ty] = cell(i);
            const hid = `nav:photo:${m.id}`;
            phone.hit(hid, x, ty, cs, cs);
            if (m.kind === 'video') {
                dc.fillRect(x, ty + cs - 20, cs, 20, [0, 0, 0, 0.35]);
                dc.playIcon(x + 11, ty + cs - 10, 8, [1, 1, 1, 0.95]);
                dc.text(clipTime(lib.duration(m)), x + cs - 6, ty + cs - 5.5, 11, col([255, 255, 255]), 'right', false, 'sansBold');
            }
            const pressed = phone.isPressed(hid, 220);
            if (phone.isHover(hid) || pressed) dc.fillRect(x, ty, cs, cs, [1, 1, 1, pressed ? 0.4 : 0.2]);
        });
        dc.clearClip();
        phone.contentH[id] = 32 + Math.ceil(items.length / 3) * (cs + gap) + 16;
    }
}

// Full photo / looping video with newer / older / delete
class ViewerApp extends PhoneApp {
    constructor(phone) {
        super(phone);
        this.player = null;         // video playback { id, start, paused, pos }
    }

    get library() { return this.game.camera.library; }

    index(pageId) {
        return this.library.indexOf(Number(pageId.slice(6)));
    }

    title(pageId) {
        const idx = this.index(pageId);
        return idx < 0 ? 'Photo' : `${idx + 1} of ${this.library.items.length}`;
    }

    draw(dc, now, id) {
        const phone = this.phone, W = this.W, lib = this.library;
        phone.contentH[id] = 0;
        const idx = this.index(id);
        const item = lib.items[idx];
        dc.fillRect(0, PHONE_NAV_H, W, this.H - PHONE_NAV_H, col([0, 0, 0]));
        if (!item) {
            dc.text('Deleted', W / 2, 300, 14, col(IOS.sub), 'center', false, 'sans');
            return;
        }
        const IY = PHONE_NAV_H + 8, IH = 360;
        let extra = '';
        if (item.kind === 'photo') {
            lib.draw(dc, item, 0, IY, W, IH, false);
        } else {
            // Playback loops; tap the picture to pause / resume
            const dur = lib.duration(item);
            if (!this.player || this.player.id !== item.id) this.player = { id: item.id, start: now, paused: false, pos: 0 };
            const pl = this.player;
            if (!pl.paused) pl.pos = ((now - pl.start) / 1000) % dur;
            lib.draw(dc, item, 0, IY, W, IH, false, Math.min(item.frames.length - 1, Math.floor(pl.pos * lib.cfg.video.fps)));
            phone.hit('pv:toggle', 0, IY, W, IH);
            if (pl.paused) {
                dc.circle(W / 2, IY + IH / 2, 30, [0, 0, 0, 0.5], 32);
                dc.playIcon(W / 2 + 3, IY + IH / 2, 24, [1, 1, 1, 0.95]);
            }
            dc.fillRect(0, IY + IH - 3, W, 3, [1, 1, 1, 0.25]);
            dc.fillRect(0, IY + IH - 3, W * (pl.pos / dur), 3, [1, 1, 1, 0.95]);
            dc.roundRect(8, IY + IH - 28, 80, 18, 9, [0, 0, 0, 0.5]);
            dc.text(`${clipTime(pl.pos)} / ${clipTime(dur)}`, 48, IY + IH - 15, 10.5, col([255, 255, 255]), 'center', false, 'sansBold');
            extra = `  ·  Video ${clipTime(dur)}`;
        }
        const Y = IY + IH;
        dc.text(item.label, 16, Y + 24, 15, col([255, 255, 255]), 'left', false, 'sansBold');
        dc.text(`Today ${timeText(item.time)}${extra}`, 16, Y + 42, 11.5, col(IOS.sub), 'left', false, 'sans');
        dc.text(`HDG ${pad3(item.hdg)}°`, W - 16, Y + 42, 11.5, col(IOS.sub), 'right', false, 'sans');

        const TY = this.H - 40;
        const tool = (hid, x, label, color, enabled) => {
            if (enabled) phone.hit(hid, x - 38, TY - 22, 76, 40);
            dc.text(label, x, TY + 5, 15, col(color, enabled ? (phone.isHover(hid) ? 0.55 : 1) : 0.3), 'center', false, 'sans');
        };
        tool('pv:prev', 48, '‹ Newer', IOS.blue, idx > 0);
        tool('pv:delete', W / 2, 'Delete', IOS.red, true);
        tool('pv:next', W - 48, 'Older ›', IOS.blue, idx < lib.items.length - 1);
    }

    onPress(kind, key) {
        if (kind !== 'pv') return false;
        const phone = this.phone, lib = this.library;
        const idx = this.index(phone.currentPage);
        if (idx < 0) return true;
        if (key === 'toggle') {
            const pl = this.player;
            if (pl) {
                if (pl.paused) pl.start = performance.now() - pl.pos * 1000;
                pl.paused = !pl.paused;
            }
        } else if (key === 'delete') {
            lib.remove(idx);
            this.game.audio.tone(300, 0.12, 'sine', 0.03, 120);
            if (!lib.items.length) phone.back();
            else phone.replaceTop(`photo:${lib.items[Math.min(idx, lib.items.length - 1)].id}`);
        } else {
            const ni = idx + (key === 'next' ? 1 : -1);
            if (ni >= 0 && ni < lib.items.length) phone.replaceTop(`photo:${lib.items[ni].id}`, key === 'next' ? 1 : -1);
        }
        return true;
    }
}

// IPTV: player, transport controls and the channel list
class TvApp extends PhoneApp {
    static PLAYER_H = 152;

    get iptv() { return this.game.iptv; }
    get listTop() { return PHONE_NAV_H + TvApp.PLAYER_H + 50; }

    drawTestCard(dc, R) {
        const bars = [[192, 192, 192], [192, 192, 0], [0, 192, 192], [0, 192, 0], [192, 0, 192], [192, 0, 0], [0, 0, 192]];
        const rev = [[0, 0, 192], [19, 19, 19], [192, 0, 192], [19, 19, 19], [0, 192, 192], [19, 19, 19], [192, 192, 192]];
        const bw = R.w / 7, h1 = R.h * 0.67, h2 = R.h * 0.08;
        bars.forEach((c, i) => dc.fillRect(R.x + i * bw, R.y, bw + 0.5, h1, col(c)));
        rev.forEach((c, i) => dc.fillRect(R.x + i * bw, R.y + h1, bw + 0.5, h2, col(c)));
        const y3 = R.y + h1 + h2, h3 = R.h - h1 - h2;
        [[0, 33, 76], [255, 255, 255], [50, 0, 106]].forEach((c, i) => dc.fillRect(R.x + i * bw * 1.25, y3, bw * 1.25 + 0.5, h3, col(c)));
        dc.fillRect(R.x + bw * 3.75, y3, R.w - bw * 3.75, h3, col([19, 19, 19]));
        const cx = R.x + R.w / 2, cy = R.y + R.h * 0.42;
        dc.ring(cx, cy, R.h * 0.3, 1.5, [1, 1, 1, 0.8], 48);
        dc.roundRect(cx - 48, cy - 12, 96, 24, 4, [0, 0, 0, 0.8]);
        dc.text(timeText(new Date()), cx, cy + 5, 13, col([255, 255, 255]), 'center', false, 'sansBold');
        dc.text(this.iptv.cfg.cardTitle, cx, R.y + 16, 9.5, [1, 1, 1, 0.9], 'center', false, 'sansBold');
    }

    // The current channel's picture in rect R (letterboxed)
    drawPicture(dc, R, now) {
        const tv = this.iptv, ch = tv.current, cctv = this.game.cctv;
        dc.fillRect(R.x, R.y, R.w, R.h, col([0, 0, 0]));
        if (ch.kind === 'card') {
            this.drawTestCard(dc, R);
        } else if (ch.kind === 'cctv') {
            const cam = cctv.current;
            const r = fitRect(R, cctv.aspect);
            dc.setMaterial('cctv');
            dc.stretchPic(r.x, r.y, r.w, r.h, 0, 0, 1, 1, [cctv.signal(now, tv.switchTime), 1, 1, 1]);
            dc.setMaterial('atlas');
            dc.text(`${cam.label} ${cam.name}`, r.x + 8, r.y + r.h - 8, 9.5, [1, 1, 1, 0.9], 'left', false, 'sansBold');
        } else {
            if (tv.hasFrame) {
                const r = fitRect(R, tv.aspect);
                dc.setMaterial('tv');
                dc.stretchPic(r.x, r.y, r.w, r.h, 0, 0, 1, 1, [1, 1, 1, 1]);
                dc.setMaterial('atlas');
            }
            const cx = R.x + R.w / 2, cy = R.y + R.h / 2;
            if (tv.status === 'error') {
                dc.fillRect(R.x, R.y, R.w, R.h, [0, 0, 0, 0.7]);
                dc.text('Stream unavailable', cx, cy - 2, 14, col([255, 255, 255]), 'center', false, 'sansBold');
                dc.text(`${tv.error} · tap to retry`, cx, cy + 16, 10.5, col(IOS.sub), 'center', false, 'sans');
            } else if (tv.status === 'loading' || tv.status === 'buffering' || !tv.hasFrame) {
                dc.spinner(cx, cy, 13, now / 1000);
            } else if (!tv.playing) {
                dc.circle(cx, cy, 22, [0, 0, 0, 0.5], 28);
                dc.playIcon(cx + 2, cy, 18, [1, 1, 1, 0.95]);
            }
        }
    }

    iconButton(dc, id, cx, cy, enabled, draw) {
        const phone = this.phone;
        if (enabled) phone.hit(id, cx - 22, cy - 20, 44, 40);
        const pressed = phone.isPressed(id, 180);
        if (phone.isHover(id) || pressed) dc.circle(cx, cy, 18, col(IOS.text, pressed ? 0.12 : 0.06), 24);
        draw(col(IOS.text, enabled ? 1 : 0.25));
    }

    draw(dc, now, id) {
        const t = now / 1000, phone = this.phone, W = this.W, tv = this.iptv, ch = tv.current, v = tv.video;
        const P = { x: 0, y: PHONE_NAV_H, w: W, h: TvApp.PLAYER_H };
        const listTop = this.listTop;

        // ---- Channel list (scrolls under the player) ----
        const scroll = phone.scroll[id] || 0;
        const rowH = 52;
        let y = listTop - scroll;
        dc.setClip(0, listTop, W, this.H - listTop);
        dc.text('CHANNELS', 28, y + 20, 11.5, col(IOS.sub), 'left', false, 'sans');
        y += 28;
        dc.roundRect(12, y, 246, tv.channels.length * rowH, 10, col(IOS.cell));
        tv.channels.forEach((c, i) => {
            const ry = y + i * rowH;
            const hid = `tv:ch:${i}`;
            phone.hit(hid, 12, ry, 246, rowH, listTop);
            const pressed = phone.isPressed(hid, 220);
            if (phone.isHover(hid) || pressed) dc.roundRect(14, ry + 2, 242, rowH - 4, 8, col(pressed ? IOS.press : IOS.bg));
            dc.roundRect(24, ry + 12, 28, 28, 7, col(c.color));
            dc.text(String(i + 1), 38, ry + 31, 14, col(IOS.cell), 'center', false, 'sansBold');
            const cur = i === tv.channel;
            dc.text(c.name, 62, ry + 23, 14.5, col(cur ? IOS.blue : IOS.text), 'left', false, cur ? 'sansBold' : 'sans');
            dc.text(c.sub, 62, ry + 39, 11, col(IOS.sub), 'left', false, 'sans');
            if (cur && tv.status !== 'error') {
                for (let k = 0; k < 3; k++) {
                    const bh = tv.playing ? 4 + 10 * Math.abs(Math.sin(t * 6 + k * 1.3)) : 4;
                    dc.fillRect(228 + k * 6, ry + 33 - bh, 4, bh, col(IOS.blue));
                }
            } else if (tv.failed[i]) {
                dc.text('Offline', 244, ry + 30, 11.5, col(IOS.red), 'right', false, 'sans');
            }
            if (i < tv.channels.length - 1) dc.fillRect(62, ry + rowH - 1.5, 196, 1.5, col(IOS.sep, 0.55));
        });
        dc.clearClip();
        // The phone clamps scroll to contentH - (H - NAV_H); only the list below the player scrolls
        phone.contentH[id] = 28 + tv.channels.length * rowH + 16 + (listTop - PHONE_NAV_H);

        // ---- Player (drawn over the list's top edge) ----
        dc.fillRect(0, PHONE_NAV_H, W, listTop - PHONE_NAV_H, col(IOS.bg));
        this.drawPicture(dc, P, now);
        phone.hit('tv:toggle', P.x, P.y, P.w, P.h);
        dc.roundRect(8, P.y + 8, 22 + dc.textWidth(ch.name, 10.5, 'sansBold'), 18, 9, [0, 0, 0, 0.55]);
        dc.text(`${tv.channel + 1}`, 15, P.y + 21, 10.5, col([255, 214, 10]), 'left', false, 'sansBold');
        dc.text(ch.name, 26, P.y + 21, 10.5, col([255, 255, 255]), 'left', false, 'sansBold');
        const vod = ch.url && !ch.live && v && Number.isFinite(v.duration) && v.duration > 0;
        if (!vod) {
            dc.roundRect(W - 44, P.y + 8, 36, 18, 4, col(IOS.red));
            dc.text('LIVE', W - 26, P.y + 21, 10, col([255, 255, 255]), 'center', false, 'sansBold');
        } else {
            dc.fillRect(0, P.y + P.h - 3, W, 3, [1, 1, 1, 0.25]);
            dc.fillRect(0, P.y + P.h - 3, W * (v.currentTime / v.duration), 3, col(IOS.red));
            dc.roundRect(W - 84, P.y + 8, 76, 18, 9, [0, 0, 0, 0.55]);
            dc.text(`${clipTime(v.currentTime)} / ${clipTime(v.duration)}`, W - 46, P.y + 21, 10, col([255, 255, 255]), 'center', false, 'sansBold');
        }

        // ---- Transport controls ----
        const CY = P.y + P.h + 24;
        this.iconButton(dc, 'tv:prev', 36, CY, true, (c) => dc.text('‹', 36, CY + 9, 28, c, 'center', false, 'sans'));
        this.iconButton(dc, 'tv:toggle', 90, CY, !!ch.url, (c) => {
            if (tv.playing && ch.url) {
                dc.fillRect(83, CY - 8, 5, 16, c);
                dc.fillRect(92, CY - 8, 5, 16, c);
            } else dc.playIcon(92, CY, 14, c);
        });
        this.iconButton(dc, 'tv:next', 144, CY, true, (c) => dc.text('›', 144, CY + 9, 28, c, 'center', false, 'sans'));
        this.iconButton(dc, 'tv:mute', 196, CY, !!ch.url, (c) => {
            dc.fillRect(186, CY - 4, 5, 8, c);
            dc.polygon([[190, CY - 4], [196, CY - 9], [196, CY + 9], [190, CY + 4]], c);
            if (tv.muted || !this.game.audio.enabled) {
                dc.line(200, CY - 5, 209, CY + 5, 2, c);
                dc.line(209, CY - 5, 200, CY + 5, 2, c);
            } else {
                dc.polyline(dc.arcPts(197, CY, 6, -0.9, 0.9, 6), 1.8, c);
                dc.polyline(dc.arcPts(197, CY, 11, -0.9, 0.9, 8), 1.8, c);
            }
        });
        this.iconButton(dc, 'tv:full', 244, CY, tv.canFullscreen, (c) => {
            for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
                const x = 244 + sx * 8, yy = CY + sy * 7;
                dc.line(x, yy, x - sx * 5, yy, 2, c);
                dc.line(x, yy, x, yy - sy * 5, 2, c);
            }
        });
    }

    // Full screen: the phone turns to landscape and the picture is drawn rotated 90 degrees in the
    // (portrait) GUI space, so it appears upright to the viewer
    drawFullscreen(dc, now) {
        const tv = this.iptv, ch = tv.current, W = this.W, H = this.H;
        dc.fillRect(0, 0, W, H, col([0, 0, 0]));
        const aspect = tv.aspect;
        // In landscape, GUI y runs left -> right (H long) and GUI x runs bottom -> top (W tall)
        let dw = H, dh = H / aspect;
        if (dh > W) { dh = W; dw = W * aspect; }
        const x0 = (W - dh) / 2, x1 = x0 + dh, y0 = (H - dw) / 2, y1 = y0 + dw;
        const pts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
        const uvs = [[0, 1], [0, 0], [1, 0], [1, 1]];
        if (ch.kind === 'cctv') {
            dc.setMaterial('cctv');
            dc.quad(pts, uvs, [this.game.cctv.current.offline ? 0 : 1, 1, 1, 1]);
        } else if (tv.hasFrame) {
            dc.setMaterial('tv');
            dc.quad(pts, uvs, [1, 1, 1, 1]);
        }
        dc.setMaterial('atlas');
        if (ch.url && (tv.status === 'buffering' || tv.status === 'loading')) dc.spinner(W / 2, H / 2, 16, now / 1000);
        this.phone.hit('tv:full', 0, 0, W, H, 0);   // tap anywhere to leave full screen
    }

    onPress(kind, key, idx) {
        if (kind !== 'tv') return false;
        const tv = this.iptv;
        if (key === 'ch') tv.tune(Number(idx));
        else if (key === 'prev') tv.tune(tv.channel - 1);
        else if (key === 'next') tv.tune(tv.channel + 1);
        else if (key === 'mute') tv.muted = !tv.muted;
        else if (key === 'toggle') tv.togglePlay();
        else if (key === 'full' && tv.canFullscreen) tv.fullscreen = !tv.fullscreen;
        return true;
    }
}
