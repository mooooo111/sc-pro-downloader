/**
 * SoundCloud Pro Downloader — Popup Controller
 */

(function () {
    'use strict';

    // DOM Elements
    const trackCard = document.getElementById('trackCard');
    const emptyState = document.getElementById('emptyState');
    const trackArtwork = document.getElementById('trackArtwork');
    const trackTitle = document.getElementById('trackTitle');
    const trackArtist = document.getElementById('trackArtist');
    const trackDuration = document.getElementById('trackDuration');
    const trackGenre = document.getElementById('trackGenre');
    
    const progressContainer = document.getElementById('progressContainer');
    const progressFill = document.getElementById('progressFill');
    const progressStatus = document.getElementById('progressStatus');
    const progressPct = document.getElementById('progressPct');

    const downloadAudioBtn = document.getElementById('downloadAudioBtn');
    const downloadArtBtn = document.getElementById('downloadArtBtn');
    
    const manualUrlInput = document.getElementById('manualUrlInput');
    const pasteBtn = document.getElementById('pasteBtn');
    const fetchTrackBtn = document.getElementById('fetchTrackBtn');

    const toast = document.getElementById('toast');
    const toastIcon = document.getElementById('toastIcon');
    const toastMsg = document.getElementById('toastMsg');

    let currentTrack = null;
    let toastTimer = null;

    // Initialize
    document.addEventListener('DOMContentLoaded', init);

    async function init() {
        // 1. Check if user is currently on a SoundCloud page
        if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
            chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
                if (!tabs || tabs.length === 0) return;
                const activeTab = tabs[0];
                const url = activeTab.url || '';

                if (url.includes('soundcloud.com')) {
                    try {
                        chrome.tabs.sendMessage(activeTab.id, { action: 'GET_CURRENT_TRACK' }, (response) => {
                            if (chrome.runtime.lastError) {
                                if (isSoundCloudTrackUrl(url)) fetchAndLoadTrack(url);
                                return;
                            }
                            if (response && response.track && response.track.title !== 'Unknown') {
                                loadTrack(response.track);
                                // Background pre-fetch full transcodings & details
                                if (response.track.permalinkUrl) {
                                    SCApi.resolveTrack(response.track.permalinkUrl).then(full => {
                                        loadTrack(full);
                                    }).catch(() => {});
                                }
                            } else if (isSoundCloudTrackUrl(url)) {
                                fetchAndLoadTrack(url);
                            }
                        });
                    } catch (e) {
                        if (isSoundCloudTrackUrl(url)) {
                            fetchAndLoadTrack(url);
                        }
                    }
                }
            });
        }

        // 2. Setup Listeners
        pasteBtn.addEventListener('click', async () => {
            try {
                const text = await navigator.clipboard.readText();
                if (text) {
                    manualUrlInput.value = text.trim();
                    fetchAndLoadTrack(text.trim());
                }
            } catch (err) {
                manualUrlInput.focus();
            }
        });

        fetchTrackBtn.addEventListener('click', () => {
            const url = manualUrlInput.value.trim();
            if (url) {
                fetchAndLoadTrack(url);
            } else {
                showToast('error', 'Paste a track link first');
            }
        });

        manualUrlInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const url = manualUrlInput.value.trim();
                if (url) fetchAndLoadTrack(url);
            }
        });

        downloadAudioBtn.addEventListener('click', downloadCurrentTrackAudio);
        downloadArtBtn.addEventListener('click', downloadCurrentTrackArtwork);

        // 3. Optional footer links (configured in config.js)
        const cfg = window.APP_CONFIG || {};
        const footer = document.getElementById('appFooter');
        if (cfg.donateUrl) document.getElementById('supportLink').href = cfg.donateUrl;
        else document.getElementById('supportLink').hidden = true;
        if (cfg.repoUrl) {
            const repo = document.getElementById('repoLink');
            repo.href = cfg.repoUrl;
            repo.hidden = false;
        }
        if (cfg.donateUrl || cfg.repoUrl) footer.hidden = false;
    }

    function isSoundCloudTrackUrl(url) {
        if (!url.includes('soundcloud.com/')) return false;
        const parts = url.split('soundcloud.com/')[1].split('?')[0].split('/');
        return parts.length >= 2 && !['discover', 'stream', 'upload', 'you', 'search'].includes(parts[0]);
    }

    async function fetchAndLoadTrack(trackUrl) {
        setFetchingState(true);
        try {
            const track = await SCApi.resolveTrack(trackUrl);
            loadTrack(track);
            showToast('success', 'Track found!');
        } catch (err) {
            console.error(err);
            showToast('error', err.message || 'Could not load the track');
        } finally {
            setFetchingState(false);
        }
    }

    function loadTrack(track) {
        currentTrack = track;
        trackTitle.textContent = track.title;
        trackTitle.title = track.title;
        trackArtist.textContent = track.artist;
        trackDuration.textContent = track.durationStr || '0:00';

        if (track.genre) {
            trackGenre.textContent = track.genre;
            trackGenre.style.display = 'inline-block';
        } else {
            trackGenre.style.display = 'none';
        }

        if (track.artworkUrl) {
            trackArtwork.src = track.artworkUrl;
        } else {
            trackArtwork.src = 'icons/icon-128.png';
        }

        emptyState.style.display = 'none';
        trackCard.style.display = 'flex';
        downloadAudioBtn.disabled = false;
        downloadArtBtn.disabled = false;
        progressContainer.style.display = 'none';
    }

    function setFetchingState(isFetching) {
        fetchTrackBtn.disabled = isFetching;
        fetchTrackBtn.textContent = isFetching ? 'Searching…' : 'Find';
    }

    async function downloadCurrentTrackAudio() {
        if (!currentTrack) return;

        downloadAudioBtn.disabled = true;
        downloadArtBtn.disabled = true;
        progressContainer.style.display = 'flex';
        updateProgress(5, 'Preparing download...');

        try {
            // If transcodings missing, resolve first
            if (!currentTrack.transcodings || currentTrack.transcodings.length === 0) {
                updateProgress(10, 'Fetching audio streams...');
                currentTrack = await SCApi.resolveTrack(currentTrack.permalinkUrl);
                loadTrack(currentTrack);
            }

            const artworkPromise = currentTrack.artworkUrl ? SCApi.fetchArtwork(currentTrack.artworkUrl) : Promise.resolve(null);
            
            const audioResult = await SCApi.downloadAudio(currentTrack, (pct, msg) => {
                updateProgress(pct, msg);
            });

            updateProgress(92, 'Embedding cover art & tags...');
            const artworkData = await artworkPromise;

            const result = SCTagger.finalizeAudio(audioResult, {
                title: currentTrack.title,
                artist: currentTrack.artist,
                album: currentTrack.album || 'SoundCloud',
                genre: currentTrack.genre,
                year: currentTrack.year,
                url: currentTrack.permalinkUrl
            }, artworkData && artworkData.buffer, artworkData && artworkData.mime);
            const finalBlob = new Blob([result.bytes], { type: result.mime });
            const ext = result.ext;

            updateProgress(98, 'Saving file...');

            const safeArtist = sanitizeFilename(currentTrack.artist);
            const safeTitle = sanitizeFilename(currentTrack.title);
            const filename = `${safeArtist} - ${safeTitle}.${ext}`;

            saveBlob(finalBlob, filename);
            updateProgress(100, 'Done!');

            showToast('success', `Saved: "${filename}"`);
            setTimeout(() => {
                progressContainer.style.display = 'none';
                downloadAudioBtn.disabled = false;
                downloadArtBtn.disabled = false;
            }, 2500);

        } catch (err) {
            console.error('Download error:', err);
            showToast('error', err.message || 'Download failed');
            progressContainer.style.display = 'none';
            downloadAudioBtn.disabled = false;
            downloadArtBtn.disabled = false;
        }
    }

    async function downloadCurrentTrackArtwork() {
        if (!currentTrack || !currentTrack.artworkUrl) {
            showToast('error', 'This track has no artwork');
            return;
        }

        try {
            const targetUrl = currentTrack.originalArtworkUrl || currentTrack.artworkUrl;
            const artData = await SCApi.fetchArtwork(targetUrl);
            if (!artData || !artData.buffer) throw new Error('Could not fetch artwork');

            const ext = (artData.mime || 'image/jpeg').includes('png') ? 'png' : 'jpg';
            const safeArtist = sanitizeFilename(currentTrack.artist);
            const safeTitle = sanitizeFilename(currentTrack.title);
            const filename = `${safeArtist} - ${safeTitle} - Cover.${ext}`;

            const blob = new Blob([artData.buffer], { type: artData.mime });
            saveBlob(blob, filename);
            showToast('success', 'HD artwork downloaded!');
        } catch (err) {
            showToast('error', 'Could not save artwork');
        }
    }

    function saveBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
            chrome.runtime.sendMessage({
                action: 'TRIGGER_DOWNLOAD',
                blobUrl: url,
                filename: filename
            }, () => {
                setTimeout(() => URL.revokeObjectURL(url), 15000);
            });
        } else {
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 5000);
        }
    }

    function sanitizeFilename(str) {
        if (!str) return 'track';
        return str
            .replace(/[\\/:*?"<>|]/g, '_')
            .replace(/\s+/g, ' ')
            .replace(/\0+/g, '')
            .trim();
    }

    function updateProgress(pct, statusText) {
        progressFill.style.width = pct + '%';
        progressPct.textContent = pct + '%';
        if (statusText) progressStatus.textContent = statusText;
    }

    function showToast(type, text) {
        clearTimeout(toastTimer);
        toast.className = 'toast ' + type;
        toastIcon.textContent = type === 'success' ? '✅' : '⚠️';
        toastMsg.textContent = text;
        toast.style.display = 'flex';

        toastTimer = setTimeout(() => {
            toast.style.display = 'none';
        }, 4500);
    }

})();
