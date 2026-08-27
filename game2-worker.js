importScripts("game2.js");

self.addEventListener("message", ({ data }) => {
  try {
    const planned = game2PlanForCards(data.player, data.dealer, (states) => self.postMessage({ type: "progress", id: data.id, states }));
    self.postMessage({ type: "result", id: data.id, planned });
  } catch (error) {
    self.postMessage({ type: "error", id: data.id, message: error.message });
  }
});
