importScripts("app.js");

self.addEventListener("message", ({ data }) => {
  try {
    const solutions = solve(data.hand, (completed, total) => self.postMessage({ type: "progress", id: data.id, completed, total }));
    self.postMessage({ type: "result", id: data.id, solutions });
  } catch (error) {
    self.postMessage({ type: "error", id: data.id, message: error.message });
  }
});
