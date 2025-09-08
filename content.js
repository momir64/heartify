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

async function checkIfSavedBatch(trackUris, authToken, clientToken) {
    const json = await spotifyRequest(trackUris, authToken, clientToken, "areEntitiesInLibrary");
    return json?.data?.lookup?.map(item => item?.data?.saved ?? false) ?? [];
}

async function addToSaved(trackUri, authToken, clientToken) {
    await spotifyRequest([trackUri], authToken, clientToken, "addToLibrary");
}

async function removeFromSaved(trackUri, authToken, clientToken) {
    await spotifyRequest([trackUri], authToken, clientToken, "removeFromLibrary");
}

function extractTrackUri(linkElement) {
    const href = linkElement?.getAttribute("href");
    if (!href?.startsWith("/track/")) return null;
    return `spotify:track:${href.split("/track/")[1].split("?")[0]}`;
}

const heartBtnClass = "heart-btn";
const heartOutline = browser.runtime.getURL("/assets/heart_unfilled.svg");
const heartFilled = browser.runtime.getURL("/assets/heart_filled.svg");
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

function updateHeartButton(track, saved, authToken, clientToken) {
    const { addBtn, row, uri } = track;

    let existingBtn = row.querySelector(`.${heartBtnClass}`);
    if (!existingBtn) {
        const heart = document.createElement("img");
        heart.className = heartBtnClass;
        heart.src = saved ? heartFilled : heartOutline;
        heart.style.position = "absolute";
        heart.style.right = "90px";
        heart.style.width = "19px";
        heart.style.height = "18px";
        heart.style.cursor = "pointer";

        if (!saved) heart.style.opacity = "0";
        setHoverBehavior(row, heart, saved);

        heart.onclick = async () => {
            saved = !saved;
            setHoverBehavior(row, heart, saved);
            if (!saved) {
                await removeFromSaved(uri, authToken, clientToken);
                heart.style.opacity = row.matches(':hover') ? "" : "0";
                heart.src = heartOutline;
            } else {
                await addToSaved(uri, authToken, clientToken);
                heart.style.opacity = "";
                heart.src = heartFilled;
            }
        };

        addBtn.parentElement.prepend(heart);
    } else {
        existingBtn.style.opacity = saved || row.matches(":hover") ? "" : "0";
        existingBtn.src = saved ? heartFilled : heartOutline;
        setHoverBehavior(row, existingBtn, saved);
    }
}

async function processTracks() {
    console.log("Processing tracks...");
    const tracks = getTracks();
    if (!tracks.length) return;

    const { authToken, clientToken } = await getTokens();
    const savedStatus = await checkIfSavedBatch(tracks.map(t => t.uri), authToken, clientToken);
    tracks.forEach((track, i) => updateHeartButton(track, savedStatus[i], authToken, clientToken));
}


let processTimeout;
let currentSection = null;

function debounceProcess() {
    clearTimeout(processTimeout);
    processTimeout = setTimeout(processTracks, 200);
}

function observeSection(section) {
    if (!section || section === currentSection) return;
    currentSection = section;

    const observer = new MutationObserver(mutations => {
        for (const mutation of mutations) {
            if (mutation.type === "childList") {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === 1 && (node.matches?.(trackLinkSelector) || node.querySelector?.(trackLinkSelector))) {
                        debounceProcess();
                        return;
                    }
                }
            }
            if (mutation.type === "attributes" && mutation.target.matches(trackLinkSelector) && mutation.attributeName === "href") {
                debounceProcess();
                return;
            }
        }
    });

    observer.observe(section, { attributes: true, childList: true, subtree: true, attributeFilter: ["href"] });
}

const bodyObserver = new MutationObserver(mutations => {
    for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
            if (node.nodeType !== Node.ELEMENT_NODE) continue;
            let section = null;
            for (const selector of supportedSections) {
                section = node.matches?.(selector) ? node : node.querySelector?.(selector);
                if (section) break;
            }
            if (section) observeSection(section);
        }
    }
});

bodyObserver.observe(document.body, { childList: true, subtree: true });
for (const selector of supportedSections) {
    const section = document.querySelector(selector);
    if (section) observeSection(section);
}

browser.runtime.onMessage.addListener((msg) => {
    if (msg.type === "refreshNeeded")
        debounceProcess();
});

const collectionBtnObserver = new MutationObserver(mutations => {
    mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
            if (node.nodeType === Node.ELEMENT_NODE) {
                [node, ...node.querySelectorAll?.(addBtnSelector) || []].forEach(btn => {
                    if (btn.matches?.(addBtnSelector)) {
                        btn.style.pointerEvents = "none";
                        btn.style.opacity = "0";
                    }
                });
            }
        });
    });
});

collectionBtnObserver.observe(document.body, { childList: true, subtree: true });