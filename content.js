async function getTokens() {
    return await browser.storage.local.get(["authToken", "clientToken"]);
}

async function spotifyRequest(trackUris, authToken, clientToken, operationName) {
    if (!trackUris.length) return [];
    const sha256Hash = operationName === "areEntitiesInLibrary" ?
        "134337999233cc6fdd6b1e6dbf94841409f04a946c5c7b744b09ba0dfe5a85ed" :
        "a3c1ff58e6a36fec5fe1e3a193dc95d9071d96b9ba53c5ba9c1494fb1ee73915";
    const headers = {
        "Content-Type": "application/json;charset=UTF-8",
        "app-platform": "WebPlayer"
    };
    if (authToken) headers["authorization"] = `Bearer ${authToken}`;
    if (clientToken) headers["client-token"] = clientToken;
    const res = await fetch("https://api-partner.spotify.com/pathfinder/v2/query", {
        credentials: "include",
        headers,
        body: JSON.stringify({
            variables: { uris: trackUris },
            operationName,
            extensions: {
                persistedQuery: {
                    version: 1,
                    sha256Hash
                }
            }
        }),
        method: "POST",
        mode: "cors"
    });
    return res.json();
}

const cache = new Map();

async function checkIfSavedBatch(trackUris, authToken, clientToken) {
    const json = await spotifyRequest(trackUris, authToken, clientToken, "areEntitiesInLibrary");
    const statuses = json?.data?.lookup?.map(item => item?.data?.saved ?? false) ?? [];
    trackUris.forEach((uri, i) => cache.set(uri, statuses[i]));
    return statuses;
}

async function addToSaved(trackUri, authToken, clientToken) {
    await spotifyRequest([trackUri], authToken, clientToken, "addToLibrary");
}

async function removeFromSaved(trackUri, authToken, clientToken) {
    await spotifyRequest([trackUri], authToken, clientToken, "removeFromLibrary");
}

function extractTrackUri(linkElement) {
    const href = linkElement?.getAttribute("href");
    if (href?.startsWith("/track/"))
        return `spotify:track:${href.split("/track/")[1].split("?")[0]}`;
    const match = href?.match(/uri=([^&]+)/);
    return match ? decodeURIComponent(match[1]) : null;
}

const heartBtnClass = "heart-btn";
const heartOutline = browser.runtime.getURL("/assets/heart_unfilled.svg");
const heartFilled = browser.runtime.getURL("/assets/heart_filled.svg");
const playingTrackLinkSelector = "a[data-testid='context-link']";
const playingTrackWidgetSelector = "div[data-testid='now-playing-widget']";
const trackRowSelector = "div[data-testid='tracklist-row']";
const trackLinkSelector = "a[data-testid='internal-track-link']";
const playlistPageSelector = "section[data-testid='playlist-page']";
const albumPageSelector = "section[data-testid='album-page']";
const artistPageSelector = "section[data-testid='artist-page']";
const supportedSections = [playlistPageSelector, albumPageSelector, artistPageSelector];
const addToPlaylistBtnSelector = "button[aria-label='Add to playlist']";
const addToLikedSongsBtnSelector = "button[aria-label='Add to Liked Songs']";
const addBtnSelector = `${addToPlaylistBtnSelector}, ${addToLikedSongsBtnSelector}`;

function getTracks() {
    const section = supportedSections.map(selector => document.querySelector(selector)).find(Boolean);
    if (!section) return [];

    return Array.from(
        section.querySelectorAll("div > ".repeat(6) + trackRowSelector)
    ).map(row => {
        const link = row.querySelector(trackLinkSelector);
        const addBtn = row.querySelector(addBtnSelector);
        const uri = extractTrackUri(link);
        return { row, addBtn, uri };
    }).filter(track => track.addBtn && track.uri);
}

function setHoverBehavior(row, button, saved) {
    row.onmouseenter = () => { if (!saved) button.style.opacity = ""; };
    row.onmouseleave = () => { if (!saved) button.style.opacity = "0"; };
}

function setClickBehavior(row, button, saved, uri, authToken, clientToken) {
    button.onclick = async () => {
        saved = !saved;
        if (row) setHoverBehavior(row, button, saved);
        if (!saved) {
            await removeFromSaved(uri, authToken, clientToken);
            if (row) button.style.opacity = row.matches(':hover') ? "" : "0";
            button.src = heartOutline;
        } else {
            await addToSaved(uri, authToken, clientToken);
            button.style.opacity = "";
            button.src = heartFilled;
        }
    };
}

function setHeartAttributes(heart, saved, visible = false) {
    heart.src = saved ? heartFilled : heartOutline;
    heart.className = heartBtnClass;
    heart.style.pointerEvents = "";
    heart.style.cursor = "pointer";
    heart.style.height = "18px";
    heart.style.width = "19px";
    heart.style.opacity = visible || saved ? "" : "0";
}

function updateHeartButton(track, saved, authToken, clientToken) {
    const { addBtn, row, uri } = track;

    let existingBtn = row.querySelector(`.${heartBtnClass}`);
    if (!existingBtn) {
        const heart = document.createElement("img");
        setHeartAttributes(heart, saved);
        setHoverBehavior(row, heart, saved);
        setClickBehavior(row, heart, saved, uri, authToken, clientToken);
        addBtn.parentElement.prepend(heart);
    } else {
        existingBtn.style.opacity = saved || row.matches(":hover") ? "" : "0";
        existingBtn.src = saved ? heartFilled : heartOutline;
        setHoverBehavior(row, existingBtn, saved);
        setClickBehavior(row, existingBtn, saved, uri, authToken, clientToken);
    }
}

function updateWidgetHeartButton(widget, uri, saved, authToken, clientToken) {
    let heart = widget.querySelector(`.${heartBtnClass}`);
    if (!heart) {
        heart = document.createElement("img");
        widget.lastElementChild.prepend(heart);
    }

    setClickBehavior(null, heart, saved, uri, authToken, clientToken);
    setHeartAttributes(heart, saved, true); // always visible in widget
}

async function processTracks() {
    console.log("Processing tracks...");
    let tracks = getTracks();
    if (!tracks.length) return;

    const { authToken, clientToken } = await getTokens();
    tracks.filter(t => cache.has(t.uri)).forEach(t => updateHeartButton(t, cache.get(t.uri), authToken, clientToken));

    const savedStatus = await checkIfSavedBatch(tracks.map(t => t.uri), authToken, clientToken);
    tracks.forEach((track, i) => updateHeartButton(track, savedStatus[i], authToken, clientToken));
}

let processTimeout;
function debounceProcess() {
    clearTimeout(processTimeout);
    processTimeout = setTimeout(processTracks, 50);
}

let currentSection = null;
function observeSection(node) {
    const section = supportedSections.map(selector => node.matches?.(selector) ? node : node.querySelector?.(selector)).find(Boolean);
    if (section && section !== currentSection) {
        currentSection = section;
        const observer = new MutationObserver(mutations => {
            for (const { type, addedNodes, target, attributeName } of mutations) {
                if (type === "childList") {
                    for (const node of addedNodes) {
                        if (node.nodeType === Node.ELEMENT_NODE && (node.matches?.(trackLinkSelector) || node.querySelector?.(trackLinkSelector))) {
                            debounceProcess();
                            return;
                        }
                    }
                } else if (type === "attributes" && target.matches(trackLinkSelector) && attributeName === "href") {
                    debounceProcess();
                    return;
                }
            }
        });
        observer.observe(section, { attributes: true, childList: true, subtree: true, attributeFilter: ["href"] });
    }
}

function hideCollectionButtons(node) {
    [node, ...node.querySelectorAll?.(addBtnSelector) || []].forEach(btn => {
        if (btn.matches?.(addBtnSelector)) {
            btn.style.pointerEvents = "none";
            btn.style.position = "absolute";
            btn.style.opacity = "0";
        }
    });
}

// Right side panel with currently playing track has to be opened to be able to determine current track uri
function processCurrentTrack(useCache = true) {
    const playingTrackLink = document.querySelector(playingTrackLinkSelector);
    const widget = document.querySelector(playingTrackWidgetSelector);
    const trackUri = extractTrackUri(playingTrackLink);
    if (playingTrackLink && widget && trackUri) {
        getTokens().then(({ authToken, clientToken }) => {
            if (useCache && cache.has(trackUri)) updateWidgetHeartButton(widget, trackUri, cache.get(trackUri), authToken, clientToken);
            if (!useCache) checkIfSavedBatch([trackUri], authToken, clientToken).then(statuses => {
                updateWidgetHeartButton(widget, trackUri, statuses[0], authToken, clientToken);
            });
        });
    } else if (!playingTrackLink && widget) {
        let heart = widget.querySelector(`.${heartBtnClass}`);
        if (heart) {
            heart.style.pointerEvents = "none";
            heart.style.opacity = "0";
        }
    }
}

const bodyObserver = new MutationObserver(mutations => {
    for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
            if (node.nodeType !== Node.ELEMENT_NODE) continue;
            observeSection(node);
            hideCollectionButtons(node);
            processCurrentTrack();
        }
    }
});

bodyObserver.observe(document.body, { childList: true, subtree: true });

browser.runtime.onMessage.addListener((msg) => {
    if (msg.type === "refreshNeeded") {
        cache.clear();
        debounceProcess();
        processCurrentTrack(false);
    }
});