const OrigWebSocket = window.WebSocket;
window.WebSocket = function (...args) {
    const ws = new OrigWebSocket(...args);
    ws.addEventListener("message", (e) => {
        if (typeof e.data !== "string") return;
        try {
            const msg = JSON.parse(e.data);
            const uri = msg?.payloads?.[0]?.cluster?.player_state?.track?.uri;
            if (uri) window.postMessage({ source: "spotify-heart-ext", trackUri: uri }, "*");
        } catch (e) {}
    });
    return ws;
};
window.WebSocket.prototype = OrigWebSocket.prototype;