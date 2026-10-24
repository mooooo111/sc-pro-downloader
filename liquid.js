/**
 * Liquid Glass kit — animation engine.
 * Configure via window.LIQUID = { ... } before loading this script.
 * Does not touch app logic — only adds classes and visual effects.
 */
(function () {
    'use strict';
    const C = Object.assign({
        mesh: false, particles: false, glow: true,
        glass: '', spec: '', chips: '', liquid: '', ripple: '', tilt: '', reveal: '',
        logo: '', split: '', wave: '', brandWave: '', ping: null,
    }, window.LIQUID || {});
    const html = document.documentElement;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const touch = matchMedia('(hover: none)').matches;
    const lerp = (a, b, t) => a + (b - a) * t;
    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

    function ready(fn) { document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', fn) : fn(); }

    ready(() => {
        const body = document.body;

        // SVG filter for liquid refraction
        if (!document.getElementById('lq-liquid')) {
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('width', '0'); svg.setAttribute('height', '0');
            svg.style.position = 'absolute';
            svg.innerHTML = '<filter id="lq-liquid" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB">' +
                '<feTurbulence type="fractalNoise" baseFrequency="0.008 0.012" numOctaves="2" seed="7" result="n"/>' +
                '<feGaussianBlur in="n" stdDeviation="2" result="s"/>' +
                '<feDisplacementMap in="SourceGraphic" in2="s" scale="34" xChannelSelector="R" yChannelSelector="G"/></filter>';
            body.prepend(svg);
        }

        // light/dark theme detected from the real background colour
        function syncTheme() {
            const bg = getComputedStyle(body).backgroundColor.match(/\d+(\.\d+)?/g) || [0, 0, 0];
            const lum = (0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2]) / 255;
            html.classList.toggle('lq-light', lum > 0.55 && (bg[3] === undefined || +bg[3] > 0.2));
        }
        syncTheme();
        new MutationObserver(() => setTimeout(syncTheme, 60)).observe(html, { attributes: true, attributeFilter: ['data-theme', 'class'] });
        new MutationObserver(() => setTimeout(syncTheme, 60)).observe(body, { attributes: true, attributeFilter: ['data-theme', 'class'] });

        // background
        if (C.mesh) {
            const m = document.createElement('div');
            m.className = 'lq-mesh'; m.setAttribute('aria-hidden', 'true');
            m.innerHTML = '<i></i><i></i><i></i><i></i><b></b>';
            body.prepend(m);
        }
        let glowEl = null, mx = -9999, my = -9999;
        if (C.glow && !touch) {
            glowEl = document.createElement('div');
            glowEl.className = 'lq-glow';
            body.prepend(glowEl);
        }
        let gx = innerWidth / 2, gy = innerHeight / 3, gRaf = null;
        addEventListener('pointermove', (e) => {
            mx = e.clientX; my = e.clientY;
            if (!glowEl) return;
            glowEl.classList.add('on');
            if (!gRaf) gRaf = requestAnimationFrame(function tick() {
                gx = lerp(gx, mx, 0.09); gy = lerp(gy, my, 0.09);
                glowEl.style.transform = `translate3d(${gx}px,${gy}px,0)`;
                gRaf = Math.abs(gx - mx) + Math.abs(gy - my) > 0.8 ? requestAnimationFrame(tick) : null;
            });
        }, { passive: true });

        // particles with constellation lines
        if (C.particles && !reduce) {
            const cv = document.createElement('canvas');
            cv.className = 'lq-particles';
            body.prepend(cv);
            const ctx = cv.getContext('2d');
            let W, H, P = [];
            const size = () => {
                const d = Math.min(devicePixelRatio || 1, 2);
                W = innerWidth; H = innerHeight; cv.width = W * d; cv.height = H * d; ctx.setTransform(d, 0, 0, d, 0, 0);
                const n = Math.round(clamp(W * H / 26000, 16, 60));
                while (P.length < n) P.push({ x: Math.random() * W, y: Math.random() * H, s: Math.random() * 1.8 + .5,
                    vx: (Math.random() - .5) * .25, vy: (Math.random() - .5) * .25, a: Math.random() * .4 + .15, p: Math.random() * 6.28, t: Math.random() < .45 });
                P.length = n;
            };
            size(); addEventListener('resize', size);
            let raf;
            const tick = () => {
                ctx.clearRect(0, 0, W, H);
                const light = html.classList.contains('lq-light');
                const base = light ? '0,0,0' : '255,255,255', mult = light ? .35 : .55;
                for (const q of P) {
                    q.x += q.vx; q.y += q.vy; q.p += .012;
                    const dx = q.x - mx, dy = q.y - my, d2 = dx * dx + dy * dy;
                    if (d2 < 22500 && d2 > .01) { const d = Math.sqrt(d2), f = (150 - d) / 150 * .6; q.x += dx / d * f; q.y += dy / d * f; }
                    if (q.x < -10) q.x = W + 10; else if (q.x > W + 10) q.x = -10;
                    if (q.y < -10) q.y = H + 10; else if (q.y > H + 10) q.y = -10;
                }
                ctx.lineWidth = .6;
                for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
                    const a = P[i], b = P[j], d2 = (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
                    if (d2 < 12000) { ctx.strokeStyle = `rgba(255,45,85,${(1 - d2 / 12000) * .12 * mult})`; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
                }
                for (const q of P) {
                    const pulse = Math.sin(q.p) * .5 + .5;
                    ctx.beginPath(); ctx.arc(q.x, q.y, q.s * (.8 + pulse * .4), 0, 6.283);
                    ctx.fillStyle = `rgba(${q.t ? '255,45,85' : base},${q.a * (.5 + pulse * .5) * mult})`; ctx.fill();
                }
                raf = requestAnimationFrame(tick);
            };
            tick();
            document.addEventListener('visibilitychange', () => { if (document.hidden) cancelAnimationFrame(raf); else tick(); });
        }

        // apply classes to existing and future elements
        function apply(root) {
            const each = (sel, fn) => { if (!sel) return; (root.matches && root.matches(sel) ? [root] : []).concat([...root.querySelectorAll(sel)]).forEach(fn); };
            each(C.glass, (el) => { el.classList.add('lq-glass'); addSpec(el); });
            each(C.spec, addSpec);
            each(C.chips, (el) => el.classList.add('lq-chip'));
            each(C.liquid, (el) => el.classList.add('lq-liquid'));
            each(C.tilt, (el) => el.classList.add('lq-tilt'));
            each(C.reveal, (el) => { if (!el.classList.contains('lq-sr') && !el.dataset.lqSeen) { el.dataset.lqSeen = 1; el.classList.add('lq-sr'); io && io.observe(el); if (!io) el.classList.add('in'); } });
        }
        function addSpec(el) {
            if (el.querySelector(':scope > .lq-spec')) return;
            const cs = getComputedStyle(el);
            if (cs.position === 'static') el.style.position = 'relative';
            const s = document.createElement('span');
            s.className = 'lq-spec';
            el.classList.add('lq-has-spec');
            el.append(s);
        }
        const io = ('IntersectionObserver' in window && !reduce) ? new IntersectionObserver((ents) => ents.forEach((en) => {
            if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
        }), { threshold: 0.08, rootMargin: '0px 0px -30px 0px' }) : null;
        apply(document);
        let pending = false;
        new MutationObserver((muts) => {
            if (pending) return;
            pending = true;
            requestAnimationFrame(() => {
                pending = false;
                for (const m of muts) {
                    m.addedNodes.forEach((n) => { if (n.nodeType === 1 && !n.classList.contains('lq-spec') && !n.classList.contains('lq-ripple')) apply(n); });
                    const t = m.target;   // container re-rendered via innerHTML — restore its highlight
                    if (t.nodeType === 1 && t.classList.contains('lq-has-spec') && !t.querySelector(':scope > .lq-spec')) {
                        t.classList.remove('lq-has-spec'); addSpec(t);
                    }
                }
            });
        }).observe(body, { childList: true, subtree: true });

        // specular highlight follows the cursor
        addEventListener('pointermove', (e) => {
            const g = e.target.closest && e.target.closest('.lq-has-spec');
            if (!g) return;
            const r = g.getBoundingClientRect();
            g.style.setProperty('--gx', (e.clientX - r.left) + 'px');
            g.style.setProperty('--gy', (e.clientY - r.top) + 'px');
        }, { passive: true });

        // card tilt
        if (C.tilt && !touch && !reduce) {
            addEventListener('pointermove', (e) => {
                const t = e.target.closest && e.target.closest('.lq-tilt');
                if (!t) return;
                const r = t.getBoundingClientRect();
                const x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
                t.style.transform = `perspective(800px) rotateX(${-y * 6}deg) rotateY(${x * 6}deg) translateY(-3px)`;
                t.dataset.lqTilted = 1;
            }, { passive: true });
            document.addEventListener('pointerout', (e) => {
                const t = e.target.closest && e.target.closest('.lq-tilt');
                if (t && !t.contains(e.relatedTarget) && t.dataset.lqTilted) { t.style.transform = ''; delete t.dataset.lqTilted; }
            });
        }

        // ripple
        if (C.ripple) document.addEventListener('pointerdown', (e) => {
            const t = e.target.closest && e.target.closest(C.ripple);
            if (!t || t.disabled) return;
            const r = t.getBoundingClientRect(), s = Math.max(r.width, r.height) * 2.2;
            const cs = getComputedStyle(t);
            if (cs.position === 'static') t.style.position = 'relative';
            if (cs.overflow === 'visible') t.style.overflow = 'hidden';
            const rp = document.createElement('span');
            rp.className = 'lq-ripple';
            rp.style.cssText = `width:${s}px;height:${s}px;left:${e.clientX - r.left - s / 2}px;top:${e.clientY - r.top - s / 2}px`;
            t.append(rp); setTimeout(() => rp.remove(), 750);
        });

        // title: letters fly in, accent word shimmers
        let ci = 0;
        function split(node, start) {
            if (!node || node.dataset.lqSplit) return;
            node.dataset.lqSplit = 1;
            const walk = (n) => {
                [...n.childNodes].forEach((ch) => {
                    if (ch.nodeType === 3) {
                        const frag = document.createDocumentFragment();
                        [...ch.textContent].forEach((c) => {
                            if (c === '\n') return;
                            const s = document.createElement('span');
                            s.className = 'lq-char' + (c === ' ' ? ' sp' : '');
                            s.textContent = c === ' ' ? ' ' : c;
                            s.style.setProperty('--cd', start + ci * 32);
                            s.style.setProperty('--ci', ci++);
                            frag.append(s);
                        });
                        ch.replaceWith(frag);
                    } else if (ch.nodeType === 1 && !/^(SVG|IMG|BR)$/i.test(ch.tagName)) {
                        walk(ch);
                    }
                });
            };
            walk(node);
        }
        if (!reduce) {
            document.querySelectorAll(C.wave || '#__none').forEach((w) => w.classList.add('lq-wave'));
            document.querySelectorAll(C.split || '#__none').forEach((n) => { n.classList.add('lq-split'); split(n, 100); });
            document.querySelectorAll(C.brandWave || '#__none').forEach((n) => n.classList.add('lq-brand-wave'));
        }

        // logo: springy hover, soft settle on leave
        document.querySelectorAll(C.logo || '#__none').forEach((logo) => {
            const wrap = document.createElement('span');
            wrap.className = 'lq-logo-wrap';
            logo.parentNode.insertBefore(wrap, logo);
            wrap.append(logo);
            logo.classList.add('lq-logo');
            if (getComputedStyle(logo).position === 'static') logo.style.position = 'relative';
            const auto = document.createElement('span'); auto.className = 'lq-sheen auto'; logo.append(auto);
            const sheen = document.createElement('span'); sheen.className = 'lq-sheen'; logo.append(sheen);
            const host = logo.closest('a, button, .brand, [class*="brand"], [class*="logo"]') || wrap;
            let cur = null;
            const play = (f, o) => { if (reduce) return; if (cur) cur.cancel(); cur = logo.animate(f, o); };
            host.addEventListener('pointerenter', () => {
                play([{ transform: 'scale(1)' }, { transform: 'scale(1.2,.86) rotate(-7deg)', offset: .22 }, { transform: 'scale(.92,1.12) rotate(5deg)', offset: .45 },
                    { transform: 'scale(1.1,.98) rotate(-3deg)', offset: .66 }, { transform: 'scale(1.12) rotate(-8deg)' }],
                    { duration: 850, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'forwards' });
                if (!reduce) sheen.animate([{ transform: 'translateX(-120%)' }, { transform: 'translateX(120%)' }], { duration: 900, easing: 'cubic-bezier(.65,0,.35,1)' });
            });
            host.addEventListener('pointerleave', () => {
                const now = cur ? getComputedStyle(logo).transform : 'none';
                play([{ transform: now === 'none' ? 'scale(1.12) rotate(-8deg)' : now }, { transform: 'scale(.94) rotate(4deg)', offset: .4 },
                    { transform: 'scale(1.03) rotate(-1.5deg)', offset: .7 }, { transform: 'scale(1) rotate(0)' }],
                    { duration: 750, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'forwards' });
            });
        });

        // app mode: tell the local server the window is open / closed
        if (C.ping) {
            const ping = () => fetch(C.ping, { cache: 'no-store' }).catch(() => {});
            ping(); setInterval(ping, 5000);
            addEventListener('pagehide', () => { try { navigator.sendBeacon(C.ping.replace(/ping$/, 'bye'), new Blob(['{}'], { type: 'application/json' })); } catch (e) {} });
        }
    });
})();
