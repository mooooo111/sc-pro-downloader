/**
 * SoundCloud Pro Downloader — Background Service Worker (Manifest V3)
 */

chrome.runtime.onInstalled.addListener(() => {
    console.log('SoundCloud Pro Downloader installed successfully!');
});

// Message listener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'TRIGGER_DOWNLOAD') {
        const { blobUrl, filename } = request;
        chrome.downloads.download({
            url: blobUrl,
            filename: filename,
            saveAs: false
        }, (downloadId) => {
            if (chrome.runtime.lastError) {
                sendResponse({ success: false, error: chrome.runtime.lastError.message });
            } else {
                sendResponse({ success: true, downloadId });
            }
        });
        return true; // Keep message channel open for async response
    }
});
