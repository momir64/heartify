async function getTokens() {
    return await browser.storage.local.get(["authToken", "clientToken"]);
}

async function spotifyRequest(trackUris, authToken, clientToken, operationName) {
    if (!trackUris.length) return [];
    const sha256Hash = operationName === "areEntitiesInLibrary" ?
        "134337999233cc6fdd6b1e6dbf94841409f04a946c5c7b744b09ba0dfe5a85ed" :
        "a3c1ff58e6a36fec5fe1e3a193dc95d9071d96b9ba53c5ba9c1494fb1ee73915";
    const res = await fetch("https://api-partner.spotify.com/pathfinder/v2/query", {
        credentials: "include",
        headers: {
            "Content-Type": "application/json;charset=UTF-8",
            "app-platform": "WebPlayer",
            "authorization": `Bearer ${authToken}`,
            "client-token": clientToken
        },
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

function getTracks() {
    const section = document.querySelector("section[data-testid='playlist-page']");
    if (!section) return [];

    return Array.from(
        section.querySelectorAll("div > div > div > div > div > div > div[data-testid='tracklist-row']")
    ).map(row => {
        const link = row.querySelector("a[href^='/track/']");
        const addBtn = row.querySelector("button[aria-label='Add to playlist']");
        const uri = extractTrackUri(link);
        return { row, addBtn, uri };
    }).filter(track => track.addBtn && track.uri);
}

function updateTrackButton(track, saved, authToken, clientToken) {
    const { addBtn, row, uri } = track;
    addBtn.style.pointerEvents = "none";
    addBtn.style.opacity = "0";

    let existingBtn = row.querySelector(".heart-btn");
    if (!existingBtn) {
        const heart = document.createElement("img");
        heart.className = "heart-btn";
        heart.src = saved ? heartFilled : heartOutline;
        heart.style.position = "absolute";
        heart.style.right = "90px";
        heart.style.width = "19px";
        heart.style.height = "18px";
        heart.style.cursor = "pointer";

        if (!saved) heart.style.opacity = "0";
        addBtn.parentElement.parentElement.onmouseenter = () => { if (!saved) heart.style.opacity = "1"; };
        addBtn.parentElement.parentElement.onmouseleave = () => { if (!saved) heart.style.opacity = "0"; };

        heart.onclick = async () => {
            if (saved) {
                await removeFromSaved(uri, authToken, clientToken);
                heart.src = heartOutline;
            } else {
                await addToSaved(uri, authToken, clientToken);
                heart.src = heartFilled;
            }
            heart.style.opacity = "1";
            saved = !saved;
        };

        addBtn.parentElement.prepend(heart);
    } else {
        existingBtn.src = saved ? heartFilled : heartOutline;
    }
}

async function processTracks() {
    console.log("Processing tracks...");
    const { authToken, clientToken } = await getTokens();
    if (!authToken || !clientToken) return;

    const tracks = getTracks();
    if (!tracks.length) return;

    const savedStatus = await checkIfSavedBatch(tracks.map(t => t.uri), authToken, clientToken);
    tracks.forEach((track, i) => updateTrackButton(track, savedStatus[i], authToken, clientToken));
}


let processTimeout;
let currentSection = null;
const heartOutline = browser.runtime.getURL("heart.svg");
const heartFilled = browser.runtime.getURL("heart_filled.svg");
const playlistPageSelector = "section[data-testid='playlist-page']";

function debounceProcess() {
    clearTimeout(processTimeout);
    // processTimeout = setTimeout(() => { console.log("change"); }, 300);
    processTimeout = setTimeout(processTracks, 200);
}

function observeSection(section) {
    if (!section || section === currentSection) return;
    currentSection = section;

    const observer = new MutationObserver(mutations => {
        for (const mutation of mutations) {
            if (mutation.type === "childList") {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType !== 1) continue;
                    if (node.matches?.("a[data-testid='internal-track-link']") ||
                        node.querySelector?.("a[data-testid='internal-track-link']")) {
                        debounceProcess();
                        return;
                    }
                }
            }
            if (mutation.type === "attributes"
                && mutation.target.matches("a[data-testid='internal-track-link']")
                && mutation.attributeName === "href") {
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
            if (node.nodeType !== 1) continue;
            const section = node.matches?.(playlistPageSelector)
                ? node : node.querySelector?.(playlistPageSelector);
            if (section) observeSection(section);
        }
    }
});

bodyObserver.observe(document.body, { childList: true, subtree: true });
observeSection(document.querySelector(playlistPageSelector));
