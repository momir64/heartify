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

            if (authToken && clientToken)
                browser.storage.local.set({ authToken, clientToken });
        }
    },
    { urls: ["https://api-partner.spotify.com/*"] },
    ["requestHeaders"]
);
