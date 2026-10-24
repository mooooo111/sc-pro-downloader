/**
 * SoundCloud API & Stream Downloader Helper
 */

const SCApi = (function () {
    'use strict';

    const FALLBACK_CLIENT_IDS = [
        'bQmaW4vAHmJIUxisgjRG4MAWAiDgsk9D',
        '2t9loNfh0ekOfioHGakjl3aKaNuDaMGY',
        'YUKXAQy1xGwzyocOaErjJ5gYp29mX67K'
    ];

    async function getClientId() {
        return new Promise((resolve) => {
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                chrome.storage.local.get(['sc_client_id'], async (res) => {
                    if (res && res.sc_client_id) {
                        resolve(res.sc_client_id);
                        return;
                    }
                    const freshId = await fetchFreshClientId();
                    if (chrome.storage && chrome.storage.local) {
                        chrome.storage.local.set({ sc_client_id: freshId });
                    }
                    resolve(freshId);
                });
            } else {
                fetchFreshClientId().then(resolve);
            }
        });
    }

    async function fetchFreshClientId() {
        try {
            const resp = await fetch('https://soundcloud.com', { cache: 'no-cache' });
            const html = await resp.text();
            const scriptMatches = [...html.matchAll(/<script\s+crossorigin\s+src="([^"]+)"/g)];
            
            for (let i = scriptMatches.length - 1; i >= 0; i--) {
                const scriptUrl = scriptMatches[i][1];
                try {
                    const sResp = await fetch(scriptUrl);
                    const sText = await sResp.text();
                    const m = sText.match(/client_id[:=]"([a-zA-Z0-9]{32})"/i) || 
                              sText.match(/client_id=([a-zA-Z0-9]{32})/);
                    if (m && m[1]) {
                        return m[1];
                    }
                } catch (e) {}
            }
        } catch (err) {
            console.warn('Could not fetch fresh client_id, using fallback', err);
        }
        return FALLBACK_CLIENT_IDS[0];
    }

    async function resolveTrack(trackUrl) {
        let clientId = await getClientId();
        const apiUrl = `https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(trackUrl)}&client_id=${clientId}`;
        
        let resp = await fetch(apiUrl);
        if (resp.status === 401 || resp.status === 403) {
            clientId = await fetchFreshClientId();
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                chrome.storage.local.set({ sc_client_id: clientId });
            }
            resp = await fetch(`https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(trackUrl)}&client_id=${clientId}`);
        }

        if (!resp.ok) {
            throw new Error(`Track not found (${resp.status}). Please check the link.`);
        }

        const data = await resp.json();
        if (data.kind !== 'track') {
            throw new Error('This link points to a playlist or profile, not a single track.');
        }

        const artwork = SCTagger.getHDArtworkUrl(data.artwork_url, data.user && data.user.avatar_url);
        const originalArtwork = SCTagger.getOriginalArtworkUrl(data.artwork_url, data.user && data.user.avatar_url);

        return {
            id: data.id,
            title: data.title || 'Untitled',
            artist: (data.user && data.user.username) || 'Unknown Artist',
            album: 'SoundCloud',
            genre: data.genre || '',
            year: (data.release_date || data.created_at || '').substring(0, 4) || new Date().getFullYear().toString(),
            duration: data.duration || 0,
            durationStr: formatDuration(data.duration || 0),
            artworkUrl: artwork,
            originalArtworkUrl: originalArtwork,
            permalinkUrl: data.permalink_url,
            track_authorization: data.track_authorization || '',
            policy: data.policy || '',
            transcodings: (data.media && data.media.transcodings) || []
        };
    }

    function formatDuration(ms) {
        const totalSec = Math.floor(ms / 1000);
        const min = Math.floor(totalSec / 60);
        const sec = totalSec % 60;
        return `${min}:${sec < 10 ? '0' : ''}${sec}`;
    }

    /**
     * Fallback via soundclouddownloader.io
     */
    async function downloadViaFallback(trackUrl, onProgress) {
        try {
            if (onProgress) onProgress(20, 'Looking for a backup stream...');
            const resolveResp = await fetch('https://en.soundclouddownloader.io/api/resolve', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: trackUrl })
            });

            if (!resolveResp.ok) return null;
            const res = await resolveResp.json();
            if (res.status !== 'ok' || !res.download_url) return null;

            if (onProgress) onProgress(40, 'Downloading MP3 via backup source...');
            const reversedB64 = btoa(res.download_url).split('').reverse().join('');
            const dlUrl = `https://en.soundclouddownloader.io/api/download?l=${encodeURIComponent(reversedB64)}&filename=track.mp3`;

            const audioResp = await fetch(dlUrl);
            if (!audioResp.ok) return null;

            const buffer = await audioResp.arrayBuffer();
            if (onProgress) onProgress(90, 'Audio stream downloaded');
            return { format: 'mp3', buffer };
        } catch (err) {
            console.warn('Fallback downloader failed:', err);
            return null;
        }
    }

    /**
     * Downloads audio stream data with progress reporting
     */
    async function downloadAudio(trackData, onProgress) {
        let clientId = await getClientId();

        // If trackData lacks transcodings (e.g. from active tab badge), resolve it first
        if (!trackData.transcodings || trackData.transcodings.length === 0) {
            if (trackData.permalinkUrl) {
                if (onProgress) onProgress(5, 'Fetching stream info...');
                const full = await resolveTrack(trackData.permalinkUrl);
                trackData.transcodings = full.transcodings;
                trackData.track_authorization = full.track_authorization;
            }
        }

        const transcodings = trackData.transcodings || [];

        // 1. Prefer progressive MP3 stream if available (direct full file)
        const progTrans = transcodings.find(t => 
            t.format && t.format.protocol === 'progressive' && t.format.mime_type && t.format.mime_type.includes('mpeg')
        );

        if (progTrans) {
            if (onProgress) onProgress(10, 'Connecting to MP3 stream...');
            let streamMetaResp = await fetch(`${progTrans.url}?client_id=${clientId}`);
            if (!streamMetaResp.ok && trackData.track_authorization) {
                streamMetaResp = await fetch(`${progTrans.url}?client_id=${clientId}&track_authorization=${encodeURIComponent(trackData.track_authorization)}`);
            }
            if (streamMetaResp.ok) {
                const streamMeta = await streamMetaResp.json();
                if (onProgress) onProgress(25, 'Downloading MP3...');
                const audioResp = await fetch(streamMeta.url);
                if (audioResp.ok) {
                    const buffer = await audioResp.arrayBuffer();
                    if (onProgress) onProgress(90, 'Audio downloaded');
                    return { format: 'mp3', buffer };
                }
            }
        }

        // 2. Standard unencrypted HLS (AAC in MP4 or MP3)
        const hlsTrans = transcodings.find(t => 
            t.format && t.format.protocol === 'hls' && t.format.mime_type && t.format.mime_type.includes('mp4')
        ) || transcodings.find(t => t.format && t.format.protocol === 'hls');

        if (hlsTrans) {
            try {
                if (onProgress) onProgress(10, 'Requesting HLS playlist...');
                let streamReqUrl = `${hlsTrans.url}?client_id=${clientId}`;
                if (trackData.track_authorization) {
                    streamReqUrl += `&track_authorization=${encodeURIComponent(trackData.track_authorization)}`;
                }

                let streamMetaResp = await fetch(streamReqUrl);
                if (!streamMetaResp.ok) {
                    // Try refreshing clientId once
                    clientId = await fetchFreshClientId();
                    streamReqUrl = `${hlsTrans.url}?client_id=${clientId}`;
                    if (trackData.track_authorization) streamReqUrl += `&track_authorization=${encodeURIComponent(trackData.track_authorization)}`;
                    streamMetaResp = await fetch(streamReqUrl);
                }

                if (streamMetaResp.ok) {
                    const streamMeta = await streamMetaResp.json();
                    const m3u8Resp = await fetch(streamMeta.url);
                    if (m3u8Resp.ok) {
                        const m3u8Text = await m3u8Resp.text();
                        const lines = m3u8Text.split('\n').map(l => l.trim());
                        
                        // Check if this playlist requires DRM keys
                        const isEncrypted = lines.some(l => l.startsWith('#EXT-X-KEY:METHOD=SAMPLE-AES'));
                        if (!isEncrypted) {
                            const initLine = lines.find(l => l.startsWith('#EXT-X-MAP:URI="'));
                            let initBuffer = null;
                            if (initLine) {
                                const initUrl = initLine.split('"')[1];
                                const initResp = await fetch(initUrl);
                                if (initResp.ok) initBuffer = await initResp.arrayBuffer();
                            }

                            const segmentUrls = lines.filter(l => l.startsWith('http://') || l.startsWith('https://'));
                            if (segmentUrls.length > 0) {
                                const total = segmentUrls.length;
                                let completed = 0;
                                const segmentBuffers = new Array(total);

                                async function downloadSegment(url, index) {
                                    const resp = await fetch(url);
                                    if (!resp.ok) throw new Error(`Segment ${index} failed (${resp.status})`);
                                    segmentBuffers[index] = await resp.arrayBuffer();
                                    completed++;
                                    if (onProgress) {
                                        const pct = 20 + Math.floor((completed / total) * 70);
                                        onProgress(pct, `Downloading parts ${completed}/${total}...`);
                                    }
                                }

                                const concurrency = 4;
                                for (let i = 0; i < total; i += concurrency) {
                                    const batch = [];
                                    for (let j = i; j < Math.min(i + concurrency, total); j++) {
                                        batch.push(downloadSegment(segmentUrls[j], j));
                                    }
                                    await Promise.all(batch);
                                }

                                if (onProgress) onProgress(90, 'Assembling audio file...');

                                if (initBuffer) {
                                    const assembled = SCTagger.assembleFMP4(initBuffer, segmentBuffers);
                                    return { format: 'm4a', buffer: assembled.buffer, init: initBuffer, segments: segmentBuffers };
                                } else {
                                    let totalLen = 0;
                                    for (const b of segmentBuffers) totalLen += b.byteLength;
                                    const full = new Uint8Array(totalLen);
                                    let off = 0;
                                    for (const b of segmentBuffers) {
                                        full.set(new Uint8Array(b), off);
                                        off += b.byteLength;
                                    }
                                    return { format: 'mp3', buffer: full.buffer };
                                }
                            }
                        }
                    }
                }
            } catch (hlsErr) {
                console.warn('Native HLS download failed, trying fallback...', hlsErr);
            }
        }

        // 3. Try Fallback downloader
        if (trackData.permalinkUrl) {
            const fallbackResult = await downloadViaFallback(trackData.permalinkUrl, onProgress);
            if (fallbackResult) return fallbackResult;
        }

        // 4. Identify exact reason for failure
        const hasDrmEncrypted = transcodings.some(t => 
            t.format && (t.format.protocol === 'cbc-encrypted-hls' || t.format.protocol === 'ctr-encrypted-hls')
        );

        if (hasDrmEncrypted) {
            throw new Error('This track is DRM-protected (Widevine) by the rights holder, so it can\'t be downloaded.');
        }

        throw new Error('No downloadable audio streams are available for this track.');
    }

    async function fetchArtwork(artworkUrl) {
        if (!artworkUrl) return null;
        try {
            const resp = await fetch(artworkUrl);
            if (!resp.ok) return null;
            const buffer = await resp.arrayBuffer();
            const mime = resp.headers.get('Content-Type') || 'image/jpeg';
            return { buffer, mime };
        } catch (e) {
            console.warn('Failed to fetch artwork', e);
            return null;
        }
    }

    return {
        getClientId,
        resolveTrack,
        downloadAudio,
        fetchArtwork,
        formatDuration
    };
})();

if (typeof module !== 'undefined') module.exports = SCApi;
