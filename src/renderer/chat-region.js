// The frozen screenshot is shown full size; the chosen box is sent back relative to it.
const api = window.chatRegion;
const box = document.getElementById('box');
let start = null;

function place(region) {
  Object.assign(box.style, { left: `${region.x * innerWidth}px`, top: `${region.y * innerHeight}px`,
    width: `${region.width * innerWidth}px`, height: `${region.height * innerHeight}px` });
  box.hidden = false;
  document.body.classList.add('selecting');
}
function between(event) {
  const x1 = Math.min(start.x, event.clientX), y1 = Math.min(start.y, event.clientY);
  return { x: x1 / innerWidth, y: y1 / innerHeight,
    width: Math.abs(event.clientX - start.x) / innerWidth, height: Math.abs(event.clientY - start.y) / innerHeight };
}

api.load().then(({ image, region }) => {
  document.getElementById('screen').src = image;
  if (region) place(region);
});
addEventListener('mousedown', event => { if (event.button === 0) start = { x: event.clientX, y: event.clientY }; });
addEventListener('mousemove', event => { if (start) place(between(event)); });
addEventListener('mouseup', event => {
  if (!start || event.button !== 0) return;
  const region = between(event);
  start = null;
  // A click without a drag is not a choice.
  if (region.width * innerWidth < 20 || region.height * innerHeight < 20) return;
  api.finish(region);
});
addEventListener('keydown', event => { if (event.key === 'Escape') api.finish(null); });
