/**
 * SoundCloud Pro Downloader — Audio & Tag Assembler
 * ID3v2.3 tags for MP3, fMP4 → M4A remuxing with iTunes tags & cover art
 */

const SCTagger = (function () {
    'use strict';

    function decodeSynchsafe(view, offset) {
        return (view.getUint8(offset) << 21) | (view.getUint8(offset+1) << 14) | (view.getUint8(offset+2) << 7) | view.getUint8(offset+3);
    }

    function stripID3(buffer) {
        const view = new DataView(buffer);
        let audioStart = 0;
        if (view.byteLength >= 10 && view.getUint8(0) === 0x49 && view.getUint8(1) === 0x44 && view.getUint8(2) === 0x33) {
            audioStart = 10 + decodeSynchsafe(view, 6);
        }
        let audioEnd = buffer.byteLength;
        if (audioEnd >= 128) {
            const v1 = new Uint8Array(buffer, audioEnd - 128, 3);
            if (v1[0] === 0x54 && v1[1] === 0x41 && v1[2] === 0x47) {
                audioEnd -= 128;
            }
        }
        return buffer.slice(audioStart, audioEnd);
    }

    /**
     * Builds ID3v2.3 tag buffer
     * ID3v2.3 is universally supported by Windows Explorer, Apple Music, VLC, Android, and car players.
     */
    function buildID3v2_3(tags, artworkBytes, artworkMime) {
        const frames = [];

        function addTextFrame(id, text) {
            if (!text) return;
            const clean = String(text).replace(/\0+/g, '').trim();
            if (!clean) return;

            // ID3v2.3 uses UTF-16 with BOM (encoding byte 1) for Unicode
            const utf8Enc = new TextEncoder().encode(clean);
            // Let's use UTF-16LE with BOM (0xFF, 0xFE)
            const codePoints = [];
            for (let i = 0; i < clean.length; i++) {
                codePoints.push(clean.charCodeAt(i));
            }
            const utf16Bytes = new Uint8Array(3 + codePoints.length * 2);
            utf16Bytes[0] = 1; // Encoding byte 1 = UTF-16 with BOM
            utf16Bytes[1] = 0xFF; // BOM LE
            utf16Bytes[2] = 0xFE;
            let p = 3;
            for (let i = 0; i < codePoints.length; i++) {
                utf16Bytes[p++] = codePoints[i] & 0xFF;
                utf16Bytes[p++] = (codePoints[i] >> 8) & 0xFF;
            }
            frames.push({ id, data: utf16Bytes });
        }

        addTextFrame('TIT2', tags.title);
        addTextFrame('TPE1', tags.artist);
        addTextFrame('TALB', tags.album || 'SoundCloud');
        addTextFrame('TCON', tags.genre || 'SoundCloud');
        addTextFrame('TYER', tags.year);
        
        if (tags.comment || tags.url) {
            const comment = [tags.comment, tags.url].filter(Boolean).join(' | ');
            const clean = comment.trim();
            if (clean) {
                const codePoints = [];
                for (let i = 0; i < clean.length; i++) codePoints.push(clean.charCodeAt(i));
                // COMM frame format: [enc(1)][lang(3)][short desc nulls][full text]
                const data = new Uint8Array(1 + 3 + 4 + 2 + codePoints.length * 2);
                let p = 0;
                data[p++] = 1; // UTF-16 with BOM
                data[p++] = 0x65; data[p++] = 0x6E; data[p++] = 0x67; // "eng"
                data[p++] = 0xFF; data[p++] = 0xFE; data[p++] = 0x00; data[p++] = 0x00; // empty description (BOM + terminator)
                data[p++] = 0xFF; data[p++] = 0xFE; // BOM for the comment text
                for (let i = 0; i < codePoints.length; i++) {
                    data[p++] = codePoints[i] & 0xFF;
                    data[p++] = (codePoints[i] >> 8) & 0xFF;
                }
                frames.push({ id: 'COMM', data });
            }
        }

        // Attached Picture (APIC)
        if (artworkBytes && artworkBytes.byteLength > 0) {
            const mime = (artworkMime || 'image/jpeg');
            const mimeBytes = new TextEncoder().encode(mime);
            const imgArr = new Uint8Array(artworkBytes);
            // APIC: [enc(1)][mime string null-terminated][picType(1 = 3 cover front)][desc null][img data]
            const apicData = new Uint8Array(1 + mimeBytes.length + 1 + 1 + 1 + imgArr.length);
            let p = 0;
            apicData[p++] = 0; // Latin-1 for MIME and description
            apicData.set(mimeBytes, p);
            p += mimeBytes.length;
            apicData[p++] = 0; // Null terminator for mime
            apicData[p++] = 3; // 3 = Cover (front)
            apicData[p++] = 0; // Empty description (null terminator)
            apicData.set(imgArr, p);

            frames.push({ id: 'APIC', data: apicData });
        }

        let totalFrameBytes = 0;
        frames.forEach(f => {
            totalFrameBytes += 10 + f.data.length; // 4 ID + 4 Size + 2 Flags + Data
        });

        const padding = 2048;
        const tagSize = totalFrameBytes + padding;
        const header = new Uint8Array(10 + tagSize);

        // ID3 header: 'ID3', version 2.3.0, flags 0
        header[0] = 0x49; header[1] = 0x44; header[2] = 0x33;
        header[3] = 3; header[4] = 0; header[5] = 0;

        // Size as synchsafe 4-byte integer
        header[6] = (tagSize >> 21) & 0x7F;
        header[7] = (tagSize >> 14) & 0x7F;
        header[8] = (tagSize >> 7) & 0x7F;
        header[9] = tagSize & 0x7F;

        let pos = 10;
        frames.forEach(f => {
            for (let i = 0; i < 4; i++) header[pos + i] = f.id.charCodeAt(i);
            const s = f.data.length;
            // ID3v2.3 frame size is normal 32-bit big-endian uint32
            header[pos + 4] = (s >> 24) & 0xFF;
            header[pos + 5] = (s >> 16) & 0xFF;
            header[pos + 6] = (s >> 8) & 0xFF;
            header[pos + 7] = s & 0xFF;
            header[pos + 8] = 0; // Flags
            header[pos + 9] = 0;
            pos += 10;
            header.set(f.data, pos);
            pos += f.data.length;
        });

        return header;
    }

    /**
     * Tags MP3 ArrayBuffer with ID3v2.3 and artwork
     */
    function tagMP3Buffer(audioBuffer, tags, artworkBytes, artworkMime) {
        const cleanAudio = stripID3(audioBuffer);
        const tagHeader = buildID3v2_3(tags, artworkBytes, artworkMime);
        const out = new Uint8Array(tagHeader.length + cleanAudio.byteLength);
        out.set(tagHeader, 0);
        out.set(new Uint8Array(cleanAudio), tagHeader.length);
        return out;
    }

    /**
     * Concatenates fMP4 init chunk and media segments (raw, untagged fallback)
     */
    function assembleFMP4(initBuffer, segmentsBuffers) {
        let totalSize = initBuffer.byteLength;
        for (const seg of segmentsBuffers) totalSize += seg.byteLength;
        const out = new Uint8Array(totalSize);
        out.set(new Uint8Array(initBuffer), 0);
        let offset = initBuffer.byteLength;
        for (const seg of segmentsBuffers) {
            out.set(new Uint8Array(seg), offset);
            offset += seg.byteLength;
        }
        return out;
    }

    /* ───────────────────────── MP4 / M4A helpers ───────────────────────── */

    function u32(n) { return new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]); }
    function ascii(str) { const a = new Uint8Array(str.length); for (let i = 0; i < str.length; i++) a[i] = str.charCodeAt(i) & 255; return a; }
    function concat(parts) {
        let len = 0; for (const p of parts) len += p.length;
        const out = new Uint8Array(len); let o = 0;
        for (const p of parts) { out.set(p, o); o += p.length; }
        return out;
    }
    function box(type, ...payload) {
        const body = concat(payload);
        return concat([u32(8 + body.length), ascii(type), body]);
    }
    function fullBox(type, version, flags, ...payload) {
        return box(type, new Uint8Array([version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255]), ...payload);
    }

    function readBoxes(u8, start, end) {
        const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
        const list = [];
        let p = start;
        while (p + 8 <= end) {
            let size = dv.getUint32(p);
            const type = String.fromCharCode(u8[p + 4], u8[p + 5], u8[p + 6], u8[p + 7]);
            let hdr = 8;
            if (size === 1) { size = Number(dv.getBigUint64(p + 8)); hdr = 16; }
            else if (size === 0) { size = end - p; }
            if (size < hdr || p + size > end) break;
            list.push({ type, start: p, size, hdr, body: p + hdr, end: p + size });
            p += size;
        }
        return list;
    }
    function child(u8, parent, type) {
        return readBoxes(u8, parent.body, parent.end).find(b => b.type === type) || null;
    }
    function raw(u8, b) { return u8.slice(b.start, b.end); }

    // version-aware patch of the duration field in mvhd / mdhd / tkhd
    function withDuration(u8, b, duration) {
        const out = raw(u8, b);
        const dv = new DataView(out.buffer);
        const h = b.hdr, v = out[h];
        const off = b.type === 'tkhd' ? (v === 1 ? h + 28 : h + 20) : (v === 1 ? h + 24 : h + 16);
        if (v === 1) dv.setBigUint64(off, BigInt(Math.round(duration)));
        else dv.setUint32(off, Math.min(0xFFFFFFFF, Math.round(duration)));
        return out;
    }
    function timescaleOf(u8, b) {
        const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
        return dv.getUint32(b.body + (u8[b.body] === 1 ? 20 : 12));
    }

    /**
     * Turns fragmented MP4 (HLS init + .m4s segments) into a regular,
     * universally playable M4A with iTunes-style tags and embedded cover art.
     */
    function buildM4A(initBuffer, segmentBuffers, tags, artworkBytes, artworkMime) {
        const init = new Uint8Array(initBuffer);
        const top = readBoxes(init, 0, init.length);
        const moov = top.find(b => b.type === 'moov');
        if (!moov) throw new Error('No moov box in init segment');
        const mvhd = child(init, moov, 'mvhd');
        const trak = child(init, moov, 'trak');
        const tkhd = child(init, trak, 'tkhd');
        const mdia = child(init, trak, 'mdia');
        const mdhd = child(init, mdia, 'mdhd');
        const hdlr = child(init, mdia, 'hdlr');
        const minf = child(init, mdia, 'minf');
        const stbl = child(init, minf, 'stbl');
        const stsd = child(init, stbl, 'stsd');
        if (!mvhd || !tkhd || !mdhd || !hdlr || !stsd) throw new Error('Incomplete init segment');

        // defaults from mvex/trex
        let trexDur = 0, trexSize = 0;
        const mvex = child(init, moov, 'mvex');
        const trex = mvex && child(init, mvex, 'trex');
        if (trex) {
            const dv = new DataView(init.buffer, init.byteOffset, init.byteLength);
            trexDur = dv.getUint32(trex.body + 12);
            trexSize = dv.getUint32(trex.body + 16);
        }

        const sizes = [], durations = [], chunks = [];
        for (const segBuf of segmentBuffers) {
            const seg = new Uint8Array(segBuf);
            const dv = new DataView(seg.buffer, seg.byteOffset, seg.byteLength);
            const boxes = readBoxes(seg, 0, seg.length);
            for (let i = 0; i < boxes.length; i++) {
                const moof = boxes[i];
                if (moof.type !== 'moof') continue;
                const mdat = boxes.slice(i + 1).find(b => b.type === 'mdat');
                for (const traf of readBoxes(seg, moof.body, moof.end).filter(b => b.type === 'traf')) {
                    const tfhd = child(seg, traf, 'tfhd');
                    if (!tfhd) continue;
                    const tf = (seg[tfhd.body + 1] << 16) | (seg[tfhd.body + 2] << 8) | seg[tfhd.body + 3];
                    let q = tfhd.body + 8; // version/flags + track_ID
                    let base = moof.start, defDur = trexDur, defSize = trexSize;
                    if (tf & 0x1) { base = Number(dv.getBigUint64(q)); q += 8; }
                    if (tf & 0x2) q += 4;
                    if (tf & 0x8) { defDur = dv.getUint32(q); q += 4; }
                    if (tf & 0x10) { defSize = dv.getUint32(q); q += 4; }
                    let cursor = null;
                    for (const trun of readBoxes(seg, traf.body, traf.end).filter(b => b.type === 'trun')) {
                        const rf = (seg[trun.body + 1] << 16) | (seg[trun.body + 2] << 8) | seg[trun.body + 3];
                        const count = dv.getUint32(trun.body + 4);
                        let r = trun.body + 8;
                        let dataPos;
                        if (rf & 0x1) { dataPos = base + dv.getInt32(r); r += 4; }
                        else dataPos = cursor !== null ? cursor : (mdat ? mdat.body : base);
                        if (rf & 0x4) r += 4;
                        let chunkLen = 0;
                        for (let k = 0; k < count; k++) {
                            let d = defDur, sz = defSize;
                            if (rf & 0x100) { d = dv.getUint32(r); r += 4; }
                            if (rf & 0x200) { sz = dv.getUint32(r); r += 4; }
                            if (rf & 0x400) r += 4;
                            if (rf & 0x800) r += 4;
                            durations.push(d); sizes.push(sz); chunkLen += sz;
                        }
                        if (dataPos + chunkLen > seg.length) throw new Error('Sample data out of range');
                        chunks.push(seg.subarray(dataPos, dataPos + chunkLen));
                        cursor = dataPos + chunkLen;
                    }
                }
            }
        }
        if (!sizes.length) throw new Error('No audio samples found');

        // sample tables
        const sttsRuns = [];
        for (const d of durations) {
            const last = sttsRuns[sttsRuns.length - 1];
            if (last && last[1] === d) last[0]++; else sttsRuns.push([1, d]);
        }
        const stts = fullBox('stts', 0, 0, u32(sttsRuns.length), ...sttsRuns.map(([c, d]) => concat([u32(c), u32(d)])));
        const stsc = fullBox('stsc', 0, 0, u32(1), u32(1), u32(sizes.length), u32(1));
        const stszBody = new Uint8Array(8 + sizes.length * 4);
        const sdv = new DataView(stszBody.buffer);
        sdv.setUint32(4, sizes.length);
        sizes.forEach((s, i) => sdv.setUint32(8 + i * 4, s));
        const stsz = fullBox('stsz', 0, 0, stszBody);

        const mediaDur = durations.reduce((a, b) => a + b, 0);
        const movieDur = mediaDur * timescaleOf(init, mvhd) / (timescaleOf(init, mdhd) || 1);

        const minfKids = readBoxes(init, minf.body, minf.end).filter(b => b.type !== 'stbl').map(b => raw(init, b));
        const udta = buildIlstUdta(tags, artworkBytes, artworkMime);
        const ftyp = box('ftyp', ascii('M4A '), u32(512), ascii('M4A '), ascii('isom'), ascii('iso2'), ascii('mp41'));

        const makeMoov = (offset) => box('moov',
            withDuration(init, mvhd, movieDur),
            box('trak',
                withDuration(init, tkhd, movieDur),
                box('mdia',
                    withDuration(init, mdhd, mediaDur),
                    raw(init, hdlr),
                    box('minf', ...minfKids,
                        box('stbl', raw(init, stsd), stts, stsc, stsz, fullBox('stco', 0, 0, u32(1), u32(offset)))))),
            udta);

        const moovLen = makeMoov(0).length;
        const moovFinal = makeMoov(ftyp.length + moovLen + 8);
        let dataLen = 0; for (const c of chunks) dataLen += c.length;

        const out = new Uint8Array(ftyp.length + moovFinal.length + 8 + dataLen);
        let o = 0;
        out.set(ftyp, o); o += ftyp.length;
        out.set(moovFinal, o); o += moovFinal.length;
        out.set(u32(8 + dataLen), o); out.set(ascii('mdat'), o + 4); o += 8;
        for (const c of chunks) { out.set(c, o); o += c.length; }
        return out;
    }

    function buildIlstUdta(tags, artworkBytes, artworkMime) {
        const enc = new TextEncoder();
        const items = [];
        const text = (name, value) => {
            const v = value == null ? '' : String(value).replace(/\0+/g, '').trim();
            if (v) items.push(box(name, box('data', u32(1), u32(0), enc.encode(v))));
        };
        text('©nam', tags.title);
        text('©ART', tags.artist);
        text('aART', tags.artist);
        text('©alb', tags.album || 'SoundCloud');
        text('©gen', tags.genre);
        text('©day', tags.year);
        text('©cmt', tags.url);
        text('©too', 'SoundCloud Pro Downloader');
        if (artworkBytes && artworkBytes.byteLength > 0) {
            const isPng = /png/i.test(artworkMime || '');
            items.push(box('covr', box('data', u32(isPng ? 14 : 13), u32(0), new Uint8Array(artworkBytes))));
        }
        const hdlr = fullBox('hdlr', 0, 0, u32(0), ascii('mdir'), ascii('appl'), u32(0), u32(0), new Uint8Array([0]));
        return box('udta', fullBox('meta', 0, 0, hdlr, box('ilst', ...items)));
    }

    /**
     * Resolves the best available artwork URL (500x500 or original)
     */
    function getHDArtworkUrl(artworkUrl, avatarUrl) {
        const raw = artworkUrl || avatarUrl;
        if (!raw) return null;
        if (raw.includes('-large.')) {
            return raw.replace('-large.', '-t500x500.');
        }
        return raw;
    }

    function getOriginalArtworkUrl(artworkUrl, avatarUrl) {
        const raw = artworkUrl || avatarUrl;
        if (!raw) return null;
        if (raw.includes('-large.')) {
            return raw.replace('-large.', '-original.');
        }
        return raw;
    }

    /**
     * Produces the final tagged file from a downloadAudio() result.
     * MP3 → ID3v2.3 + APIC, HLS AAC → regular M4A + iTunes tags + covr.
     */
    function finalizeAudio(result, tags, artworkBytes, artworkMime) {
        if (result.format === 'mp3') {
            return { bytes: tagMP3Buffer(result.buffer, tags, artworkBytes, artworkMime), ext: 'mp3', mime: 'audio/mpeg' };
        }
        if (result.init && result.segments) {
            try {
                return { bytes: buildM4A(result.init, result.segments, tags, artworkBytes, artworkMime), ext: 'm4a', mime: 'audio/mp4' };
            } catch (e) {
                console.warn('M4A remux failed, saving untagged stream', e);
            }
        }
        return { bytes: new Uint8Array(result.buffer), ext: 'm4a', mime: 'audio/mp4' };
    }

    return {
        finalizeAudio,
        buildID3v2_3,
        stripID3,
        tagMP3Buffer,
        assembleFMP4,
        buildM4A,
        getHDArtworkUrl,
        getOriginalArtworkUrl
    };
})();

if (typeof module !== 'undefined') module.exports = SCTagger;
