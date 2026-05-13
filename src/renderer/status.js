const label = document.getElementById("label");
const message = document.getElementById("message");
const card = document.getElementById("card");
const accept = document.getElementById("accept");
const cancel = document.getElementById("cancel");

window.statusBridge.onUpdate((next) => {
  card.dataset.state = next.status;
  label.textContent = next.status;
  message.textContent = next.message;
});

accept.addEventListener("click", () => window.statusBridge.accept());
cancel.addEventListener("click", () => window.statusBridge.cancel());

window.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    window.statusBridge.accept();
  }

  if (event.key === "Escape") {
    window.statusBridge.cancel();
  }
});
