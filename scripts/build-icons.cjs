// Render the checked-in SVG with Chromium; keep PNG/ICO in sync without dependencies.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const assets = path.resolve(__dirname, '../src/renderer/assets');
  const svg = fs.readFileSync(path.join(assets, 'app-icon.svg')).toString('base64');
  const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false } });
  await win.loadURL('data:text/html,<html><body></body></html>');
  const sizes = [16, 32, 48, 64, 128, 256];
  const pngs = [];
  for (const size of sizes) {
    const data = await win.webContents.executeJavaScript(`(async()=>{
      const image=new Image(); image.src='data:image/svg+xml;base64,${svg}'; await image.decode();
      const canvas=document.createElement('canvas'); canvas.width=canvas.height=${size};
      canvas.getContext('2d').drawImage(image,0,0,${size},${size}); return canvas.toDataURL('image/png').split(',')[1];
    })()`);
    pngs.push(Buffer.from(data, 'base64'));
  }
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((size, index) => {
    const start = 6 + index * 16;
    header[start] = header[start + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, start + 4); header.writeUInt16LE(32, start + 6);
    header.writeUInt32LE(pngs[index].length, start + 8); header.writeUInt32LE(offset, start + 12);
    offset += pngs[index].length;
  });
  fs.writeFileSync(path.join(assets, 'app-icon.png'), pngs.at(-1));
  fs.writeFileSync(path.join(assets, 'app-icon.ico'), Buffer.concat([header, ...pngs]));
  console.log('Generated app-icon.png and six-resolution app-icon.ico');
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
