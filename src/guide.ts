import {openEditorFromGuide} from './browser/guide-navigation';
import {lens, adaptiveShadows} from './panel/glass';
const button = document.getElementById('open-editor') as HTMLButtonElement;
const detail = document.getElementById('guide-detail')!;
button.addEventListener('click', async () => {
  button.disabled = true;
  try {
    await openEditorFromGuide(location.href);
    detail.textContent = 'Quando o editor carregar, clique novamente no ícone da extensão.';
  } catch (error) {
    detail.textContent = error instanceof Error ? error.message : 'Não foi possível abrir o editor. Tente novamente.';
    detail.classList.add('guide-error'); button.disabled = false;
  }
});
lens(document.getElementById('topbar')!, 'lens-top', {radius: 18, bezel: 14, shift: 6});
lens(document.getElementById('dock')!, 'lens-dock', {radius: 18, bezel: 14, shift: 6});
adaptiveShadows(document.getElementById('topbar')!, document.getElementById('dock')!);
document.body.dataset.guideReady = 'true';
