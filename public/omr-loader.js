const earlyMessages = [];
const queueEarlyMessage = (event) => {
  earlyMessages.push(event);
};
self.onmessage = queueEarlyMessage;

try {
  // Kept as a same-origin module so browsers with a strict worker policy do
  // not have to execute code from a temporary blob URL.
  await import("./omr-worker-core.js");
  if (self.onmessage !== queueEarlyMessage && typeof self.onmessage === "function") {
    for (const event of earlyMessages.splice(0)) {
      self.onmessage(event);
    }
  }
} catch (error) {
  self.postMessage({ type: "error", msg: `무료 악보 인식기를 불러오지 못했습니다: ${error?.message || error}` });
}
