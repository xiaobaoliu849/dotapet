import fs from 'node:fs';
import path from 'node:path';
import { CustomizationStore } from './customizationStore.js';

// Exercises the real preload, renderer, IPC and desktop without user data/network.
export async function runCustomizationSmoke({ controller, mainWindow, dialog, outputDirectory }) {
  const errors = [];
  mainWindow.webContents.on('console-message', (_event, level, text) => { if (level >= 3) errors.push(text); });
  const waitScript = `const waitFor = async predicate => { for (let i=0;i<125;i++) { if (await predicate()) return; await new Promise(r=>setTimeout(r,40)); } throw new Error('Customization UI timed out: '+ (document.getElementById('feedback')?.textContent || '') + ' / ' + predicate.toString()); }; const get = id => document.getElementById(id);`;
  const fixture = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 140 140"><ellipse cx="70" cy="128" rx="36" ry="6" fill="#544233" opacity=".15"/><path d="M45 62Q22 3 49 17L65 55M83 55l11-38q30-14 10 49" fill="#f8dcad" stroke="#a18158" stroke-width="3"/><ellipse cx="73" cy="86" rx="45" ry="39" fill="#f8dcad" stroke="#a18158" stroke-width="3"/><circle cx="56" cy="78" r="4" fill="#544233"/><circle cx="90" cy="78" r="4" fill="#544233"/><path d="M69 87h8l-4 5z" fill="#c47c71"/><path d="M73 92q-7 10-14 1m14-1q7 10 14 1" fill="none" stroke="#544233" stroke-width="2"/><circle cx="44" cy="91" r="5" fill="#e6afa0"/><circle cx="102" cy="91" r="5" fill="#e6afa0"/></svg>').toString('base64')}`;
  await mainWindow.webContents.executeJavaScript(`(async()=>{ ${waitScript}
    await waitFor(async()=>Boolean((await window.electronAPI.getCustomization())?.ok));
    localStorage.setItem('voicespirit_custom_skins_invoker', JSON.stringify({custom_legacy:{name:'旧版小兔',sprites:{idle:${JSON.stringify(fixture)}}}}));
    localStorage.setItem('voicespirit_active_skin_invoker','custom_legacy');
  })()`);
  const loaded = new Promise(resolve => mainWindow.webContents.once('did-finish-load', resolve));
  mainWindow.webContents.reload(); await loaded;
  await mainWindow.webContents.executeJavaScript(`(async()=>{ ${waitScript}
    await waitFor(async()=>Boolean((await window.electronAPI.getCustomization())?.state?.profiles['hero:invoker']?.appearance.assetId));
    if (!localStorage.getItem('voicespirit_custom_skins_invoker')) throw new Error('Migration erased legacy settings');
  })()`);
  const editor = controller.open();
  editor.webContents.on('console-message', (_event, level, text) => { if (level >= 3) errors.push(text); });
  await new Promise(resolve => editor.webContents.once('did-finish-load', resolve));
  const assetId = await editor.webContents.executeJavaScript(`(async()=>{ ${waitScript}
    await waitFor(()=>!get('character').disabled);
    if (get('character').value !== 'hero:companion') throw new Error('Editor does not show active free-chat companion');
    if ('sendAudioChunk' in window.customizationAPI || 'getCustomization' in window.customizationAPI) throw new Error('Editor exposes desktop controls');
    let response = await window.customizationAPI.importImage({name:'小兔形象',dataUrl:${JSON.stringify(fixture)}});
    if (!response.ok || response.state.assets.length !== 1) throw new Error('Library did not deduplicate migrated image');
    const assetId = response.asset.id;
    get('character').value='pet:aurora_wolf'; get('character').dispatchEvent(new Event('change'));
    await waitFor(()=>Array.from(get('appearance-source').options).some(o=>o.value===assetId));
    get('appearance-source').value=assetId; get('appearance-source').dispatchEvent(new Event('change'));
    get('appearance-style').value='warm'; get('appearance-style').dispatchEvent(new Event('input'));
    get('appearance-scale').value='120'; get('appearance-scale').dispatchEvent(new Event('input'));
    get('appearance-x').value='35'; get('appearance-x').dispatchEvent(new Event('input'));
    get('background-mode').value='color'; get('background-mode').dispatchEvent(new Event('input'));
    get('background-color').value='#8ca99a'; get('background-color').dispatchEvent(new Event('input'));
    get('background-scope').value='scene'; get('background-scope').dispatchEvent(new Event('input'));
    if ((await window.customizationAPI.get()).state.profiles['pet:aurora_wolf']) throw new Error('Preview applied before Apply');
    get('apply').click();
    await waitFor(async()=>Boolean((await window.customizationAPI.get()).state.profiles['pet:aurora_wolf']?.appearance.assetId));
    await waitFor(()=>!get('apply').disabled);
    if (!get('draft-status').textContent.includes('已保存')) throw new Error('Draft did not become saved');
    get('activate').click();
    await waitFor(async()=>(await window.customizationAPI.get()).state.activeKey==='pet:aurora_wolf');
    const favorite=document.querySelector('.asset-actions button[aria-pressed]'); favorite.click();
    await waitFor(async()=>(await window.customizationAPI.get()).state.assets[0].favorite);
    get('preset-name').value='暖金小兔'; get('save-preset').click();
    await waitFor(()=>document.querySelectorAll('.preset-row').length===1);
    if (document.documentElement.scrollWidth>document.documentElement.clientWidth) throw new Error('Editor overflows');
    return assetId;
  })()`);
  await mainWindow.webContents.executeJavaScript(`(async()=>{ ${waitScript}
    await waitFor(()=>get('pet-avatar').src.includes('customization-assets'));
    if (get('companion-scene-background').hidden) throw new Error('Scene background not applied to desktop');
    if (getComputedStyle(get('pet-avatar')).scale!=='1.2') throw new Error('Size is not applied to desktop');
    if (!get('pet-avatar').style.filter.includes('sepia')) throw new Error('Style is not applied to desktop');
    document.querySelector('[data-pet="donkey_courier"]').click();
    await waitFor(()=>get('pet-avatar').src.includes('/donkey_courier/'));
    if (!get('companion-scene-background').hidden) throw new Error('Another pet inherited scene background');
    document.querySelector('[data-pet="aurora_wolf"]').click();
    await waitFor(()=>get('pet-avatar').src.includes('customization-assets'));
  })()`);
  const originalSave = dialog.showSaveDialog, originalOpen = dialog.showOpenDialog;
  const bundlePath = path.join(outputDirectory, 'customization-preset.json');
  try {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: bundlePath });
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [bundlePath] });
    await editor.webContents.executeJavaScript(`(async()=>{ ${waitScript}
      await waitFor(()=>!get('apply').disabled);
      document.querySelector('.preset-row button:nth-of-type(2)').click();
      await waitFor(()=>get('feedback').textContent.includes('导出'));
      get('import-preset').click(); await waitFor(()=>document.querySelectorAll('.preset-row').length===2);
    })()`);
  } finally { dialog.showSaveDialog = originalSave; dialog.showOpenDialog = originalOpen; }
  const capture = async filename => {
    await editor.webContents.capturePage();
    await editor.webContents.executeJavaScript('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    fs.writeFileSync(path.join(outputDirectory, filename), (await editor.webContents.capturePage()).toPNG());
  };
  await capture('customization.png');
  await editor.webContents.executeJavaScript("document.getElementById('library-section').scrollIntoView({block:'start'})");
  await capture('customization-library.png');
  editor.setSize(680, 750);
  await new Promise(resolve => setTimeout(resolve, 150));
  await editor.webContents.executeJavaScript(`if(document.documentElement.scrollWidth>document.documentElement.clientWidth) throw new Error('Narrow customization editor overflows'); window.scrollTo(0,0);`);
  await capture('customization-narrow.png');
  // Real File input and drop import path, including animated GIF and errors.
  const gif = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  await editor.webContents.executeJavaScript(`(async()=>{ ${waitScript}
    await waitFor(()=>!get('apply').disabled);
    const bytes=Uint8Array.from(atob(${JSON.stringify(gif.split(',')[1])}),c=>c.charCodeAt(0));
    const transfer=new DataTransfer(); transfer.items.add(new File([bytes],'tiny.gif',{type:'image/gif'}));
    get('import-role').value='background';
    const event=new Event('drop',{bubbles:true,cancelable:true}); Object.defineProperty(event,'dataTransfer',{value:transfer}); get('dropzone').dispatchEvent(event);
    await waitFor(()=>document.querySelectorAll('.asset-card').length===2);
    await waitFor(()=>get('background-mode').value==='image');
    if (get('preview-background').hidden) throw new Error('Imported background not previewed');
    get('apply').click(); await waitFor(()=>!get('apply').disabled);
    const invalid=new DataTransfer(); invalid.items.add(new File(['invalid'],'bad.png',{type:'image/png'}));
    get('image-file').files=invalid.files; get('image-file').dispatchEvent(new Event('change'));
    await waitFor(()=>get('feedback').dataset.error==='true');
    if (document.querySelectorAll('.asset-card').length!==2) throw new Error('Invalid image was imported');
    get('character').value='hero:invoker'; get('character').dispatchEvent(new Event('change'));
    if (!get('preview-image').src.includes('customization-assets')) throw new Error('Migrated hero appearance not shown');
    get('activate').click(); await waitFor(async()=>(await window.customizationAPI.get()).state.activeKey==='hero:invoker');
  })()`);
  await mainWindow.webContents.executeJavaScript(`(async()=>{ ${waitScript}
    await waitFor(()=>get('hero-name').textContent.startsWith('祈求者') && get('pet-avatar').src.includes('customization-assets'));
    const {state}=await window.electronAPI.getCustomization();
    if (!get('companion-scene-background').hidden) throw new Error('Hero inherited a pet background');
    if (!state.profiles['hero:invoker'].appearance.assetId) throw new Error('Migrated skin missing');
  })()`);
  // Restart the desktop renderer to exercise restore of hero and pet appearance.
  const reloaded = new Promise(resolve => mainWindow.webContents.once('did-finish-load', resolve));
  mainWindow.webContents.reload(); await reloaded;
  await mainWindow.webContents.executeJavaScript(`(async()=>{ ${waitScript}
    await waitFor(()=>get('pet-avatar').src.includes('customization-assets'));
    if(!get('hero-name').textContent.startsWith('祈求者')) throw new Error('Hero selection not restored');
  })()`);
  const restored = new CustomizationStore(controller.store.directory).snapshot();
  if (restored.assets.length !== 2 || restored.profiles['pet:aurora_wolf'].appearance.assetId !== assetId) throw new Error('Customization did not survive store reload');
  if (errors.length) throw new Error(`Renderer errors: ${errors.join('; ')}`);
  editor.close();
  return { assets: restored.assets.length, presets: restored.presets.length, migratedHero: true, heroAndPet: true };
}
