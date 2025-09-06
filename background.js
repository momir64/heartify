let authToken = null;
let clientToken = null;

browser.webRequest.onBeforeSendHeaders.addListener(
    (details) => {
        if (details.url.includes("api-partner.spotify.com/pathfinder/v2/query")) {
            for (const header of details.requestHeaders) {
                if (header.name.toLowerCase() === "authorization" && header.value.startsWith("Bearer"))
                    authToken = header.value.replace("Bearer ", "");
                if (header.name.toLowerCase() === "client-token")
                    clientToken = header.value;
            }
            browser.storage.local.set({ authToken, clientToken });
        }
    },
    { urls: ["https://api-partner.spotify.com/*"] },
    ["requestHeaders"]
);


browser.webRequest.onBeforeRequest.addListener(
    async (details) => {
        if (details.method === "POST" && details.requestBody?.raw?.[0]?.bytes) {
            const decoder = new TextDecoder("utf-8");
            const bodyString = decoder.decode(details.requestBody.raw[0].bytes);
            try {
                const op = JSON.parse(bodyString).operationName;
                if (op && op !== "areEntitiesInLibrary")
                    browser.tabs.sendMessage(details.tabId, { type: "debounceProcess" });
            } catch (e) {
                console.error("Failed to parse request body", e);
            }
        }
    },
    { urls: ["https://api-partner.spotify.com/pathfinder/v2/query"] },
    ["requestBody"]
);