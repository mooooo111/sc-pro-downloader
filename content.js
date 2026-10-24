/**
 * SoundCloud Pro Downloader — Content Script
 */

(function () {
    'use strict';

    console.log('[SoundCloud Pro Downloader] Content script active');

    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request.action === 'GET_CURRENT_TRACK') {
                const track = getCurrentPlayingTrack();
                sendResponse({ track });
            }
            return true;
        });
    }

    function getCurrentPlayingTrack() {
        const badge = document.querySelector('.playbackSoundBadge');
        if (!badge) return null;

        const titleEl = badge.querySelector('.playbackSoundBadge__titleLink');
        const artistEl = badge.querySelector('.playbackSoundBadge__lightLink');
        const artEl = badge.querySelector('.image__lightOutline') || badge.querySelector('.image__full');

        let title = titleEl ? titleEl.getAttribute('title') || titleEl.textContent.trim() : 'Unknown';
        let artist = artistEl ? artistEl.getAttribute('title') || artistEl.textContent.trim() : 'Unknown';
        let permalink = titleEl ? titleEl.href : window.location.href;

        let artworkUrl = null;
        if (artEl) {
            const style = artEl.style.backgroundImage || '';
            const m = style.match(/url\(["']?([^"']+)["']?\)/);
            if (m) artworkUrl = m[1];
        }

        if (artworkUrl && artworkUrl.includes('-large.')) {
            artworkUrl = artworkUrl.replace('-large.', '-t500x500.');
        }

        return {
            title,
            artist,
            permalinkUrl: permalink,
            artworkUrl
        };
    }

    function setupObserver() {
        const observer = new MutationObserver(() => {
            injectPlayerButton();
            injectActionButtons();
        });

        observer.observe(document.body, { childList: true, subtree: true });
        injectPlayerButton();
        injectActionButtons();
    }

    function injectPlayerButton() {
        if (document.querySelector('.sc-pro-player-btn')) return;

        const controls = document.querySelector('.playControls__elements');
        if (!controls) return;

        const btn = document.createElement('button');
        btn.className = 'sc-pro-player-btn';
        btn.title = 'SoundCloud Pro: Download track with HD cover art';
        btn.innerHTML = `
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
        `;

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const track = getCurrentPlayingTrack();
            if (track && track.permalinkUrl) {
                downloadTrackDirectly(track.permalinkUrl);
            } else {
                showHud({ title: 'Nothing is playing', artist: 'Start a track first' }, 0, 'Waiting for playback');
                setTimeout(() => { const h = document.querySelector('.sc-pro-hud'); if (h) h.remove(); }, 2500);
            }
        });

        const volume = controls.querySelector('.playControls__volume');
        if (volume) {
            controls.insertBefore(btn, volume);
        } else {
            controls.appendChild(btn);
        }
    }

    function injectActionButtons() {
        const actionGroups = document.querySelectorAll('.soundActions .sc-button-group:not(.sc-pro-handled)');
        actionGroups.forEach(group => {
            group.classList.add('sc-pro-handled');
            if (group.querySelector('.sc-pro-action-btn')) return;

            const btn = document.createElement('button');
            btn.className = 'sc-pro-action-btn sc-button sc-button-small';
            btn.innerHTML = `
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="margin-right:3px">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="7 10 12 15 17 10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                <span>Download</span>
            `;

            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const soundItem = group.closest('.sound') || group.closest('.trackItem') || document;
                const linkEl = soundItem.querySelector('.soundTitle__title') || 
                               soundItem.querySelector('.trackItem__trackTitle') || 
                               soundItem.querySelector('a[href*="/"]');
                const trackUrl = linkEl ? linkEl.href : window.location.href;
                downloadTrackDirectly(trackUrl);
            });

            group.appendChild(btn);
        });
    }

    async function downloadTrackDirectly(trackUrl) {
        let hud = showHud({ title: 'Finding track…', artist: 'SoundCloud' }, 5, 'Fetching track info...');
        
        try {
            const track = await SCApi.resolveTrack(trackUrl);
            updateHud(hud, track, 15, 'Connecting to stream...');

            const artworkPromise = track.artworkUrl ? SCApi.fetchArtwork(track.artworkUrl) : Promise.resolve(null);
            
            const audioResult = await SCApi.downloadAudio(track, (pct, statusText) => {
                updateHud(hud, track, pct, statusText);
            });

            updateHud(hud, track, 94, 'Embedding cover art & tags...');
            const artworkData = await artworkPromise;

            const result = SCTagger.finalizeAudio(audioResult, {
                title: track.title,
                artist: track.artist,
                album: 'SoundCloud',
                genre: track.genre,
                year: track.year,
                url: track.permalinkUrl
            }, artworkData && artworkData.buffer, artworkData && artworkData.mime);
            const finalBlob = new Blob([result.bytes], { type: result.mime });
            const ext = result.ext;

            const filename = `${sanitize(track.artist)} - ${sanitize(track.title)}.${ext}`;
            updateHud(hud, track, 100, 'Done! Saving...');

            const blobUrl = URL.createObjectURL(finalBlob);
            if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
                chrome.runtime.sendMessage({ action: 'TRIGGER_DOWNLOAD', blobUrl, filename });
            } else {
                const a = document.createElement('a');
                a.href = blobUrl;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            }

            setTimeout(() => {
                if (hud) hud.remove();
            }, 3000);

        } catch (err) {
            console.error(err);
            if (hud) {
                updateHud(hud, { title: 'Download failed', artist: err.message }, 0, 'Could not download');
                setTimeout(() => hud.remove(), 4000);
            }
        }
    }

    function sanitize(s) {
        return (s || 'track').replace(/[\\/:*?"<>|]/g, '_').trim();
    }

    function showHud(track, pct, status) {
        let existing = document.querySelector('.sc-pro-hud');
        if (existing) existing.remove();

        const hud = document.createElement('div');
        hud.className = 'sc-pro-hud';
        hud.innerHTML = `
            <div class="sc-pro-hud-header">
                <img class="sc-pro-hud-art" src="${track.artworkUrl || 'https://a-v2.sndcdn.com/assets/images/default/avatar-placeholder-large.png'}" alt="Cover">
                <div class="sc-pro-hud-meta">
                    <div class="sc-pro-hud-title">${escapeHtml(track.title)}</div>
                    <div class="sc-pro-hud-artist">${escapeHtml(track.artist)}</div>
                </div>
            </div>
            <div class="sc-pro-hud-bar">
                <div class="sc-pro-hud-fill" style="width: ${pct}%"></div>
            </div>
            <div class="sc-pro-hud-status">
                <span class="sc-pro-hud-text">${escapeHtml(status)}</span>
                <span class="sc-pro-hud-pct">${pct}%</span>
            </div>
        `;

        document.body.appendChild(hud);
        return hud;
    }

    function updateHud(hud, track, pct, status) {
        if (!hud) return;
        const fill = hud.querySelector('.sc-pro-hud-fill');
        const text = hud.querySelector('.sc-pro-hud-text');
        const pctEl = hud.querySelector('.sc-pro-hud-pct');
        const titleEl = hud.querySelector('.sc-pro-hud-title');
        const artistEl = hud.querySelector('.sc-pro-hud-artist');
        const artEl = hud.querySelector('.sc-pro-hud-art');

        if (fill) fill.style.width = pct + '%';
        if (text) text.textContent = status;
        if (pctEl) pctEl.textContent = pct + '%';
        if (titleEl && track.title) titleEl.textContent = track.title;
        if (artistEl && track.artist) artistEl.textContent = track.artist;
        if (artEl && track.artworkUrl) artEl.src = track.artworkUrl;
    }

    function escapeHtml(s) {
        const div = document.createElement('div');
        div.textContent = s || '';
        return div.innerHTML;
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupObserver);
    } else {
        setupObserver();
    }

})();
