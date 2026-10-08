const guideAPI = window.welcomeAPI;
const get = id => document.getElementById(id);
let step = 0;
function showStep(next) {
  window.stopMicrophoneCheck?.();
  step = next;
  for (let i = 0; i < 3; i++) get(`step-${i}`).hidden = i !== step;
  for (const button of document.querySelectorAll('[data-step]')) {
    if (Number(button.dataset.step) === step) button.setAttribute('aria-current', 'step');
    else button.removeAttribute('aria-current');
  }
  get('guide-back').hidden = step === 0;
  get('guide-next').textContent = step === 2 ? '回到桌面，开始陪伴' : '下一步';
  get(['intro-title', 'sound-title', 'ready-title'][step]).focus();
}
async function guideAction(action) {
  if (action === 'finish') window.stopMicrophoneCheck?.();
  try {
    const response = await guideAPI.action(action);
    if (!response.ok) throw new Error(response.error);
    return response;
  } catch (error) { get('guide-feedback').textContent = error.message || '请重试。'; }
}
for (const button of document.querySelectorAll('[data-step]')) button.addEventListener('click', () => showStep(Number(button.dataset.step)));
get('guide-back').addEventListener('click', () => showStep(step - 1));
get('guide-next').addEventListener('click', () => step === 2 ? guideAction('finish') : showStep(step + 1));
get('guide-skip').addEventListener('click', () => guideAction('finish'));
get('guide-settings').addEventListener('click', () => { window.stopMicrophoneCheck?.(); guideAction('settings'); });
get('guide-customize').addEventListener('click', () => guideAction('customize'));
guideAction('info').then(response => { if (response) get('app-version').textContent = `· v${response.version}`; });
