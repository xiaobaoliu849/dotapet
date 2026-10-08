import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { normalizeProfile, validCharacterKey } from '../services/appearance.js';

export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const extensions = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg' };
const label = (value, fallback) => typeof value === 'string' && value.trim() ? value.trim().slice(0, 80) : fallback;

function animatedGif(bytes) {
  if (bytes.length < 13) return false;
  let offset = 13 + ((bytes[10] & 128) ? 3 * 2 ** ((bytes[10] & 7) + 1) : 0), frames = 0;
  const skipBlocks = () => {
    while (offset < bytes.length) { const length = bytes[offset++]; if (!length) break; offset += length; }
  };
  while (offset < bytes.length) {
    const marker = bytes[offset++];
    if (marker === 0x3b) break;
    if (marker === 0x21) { offset++; skipBlocks(); }
    else if (marker === 0x2c) {
      if (++frames > 1) return true;
      if (offset + 9 > bytes.length) return false;
      const packed = bytes[offset + 8]; offset += 9;
      if (packed & 128) offset += 3 * 2 ** ((packed & 7) + 1);
      offset++; skipBlocks();
    } else break;
  }
  return false;
}

export function decodeImage(dataUrl) {
  if (typeof dataUrl !== 'string' || dataUrl.length > MAX_IMAGE_BYTES * 1.4) throw new Error('图片不能超过 12 MB。');
  const match = /^data:(image\/(?:png|jpeg|gif|webp|svg\+xml));base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl);
  if (!match) throw new Error('请选择 PNG、JPEG、GIF、WebP 或 SVG 图片。');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error('图片为空或超过 12 MB。');
  const mime = match[1];
  const valid = mime === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : mime === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216
    : mime === 'image/gif' ? /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString())
    : mime === 'image/webp' ? bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP'
    : /<svg[\s>]/i.test(bytes.toString('utf8')) && !/<!DOCTYPE|<!ENTITY|<script[\s>]|<foreignObject[\s>]|\bon\w+\s*=|(?:href|src)\s*=\s*["']\s*(?:https?:|file:|javascript:)/i.test(bytes.toString('utf8'));
  if (!valid) throw new Error('图片格式无效，或 SVG 包含不支持的外部内容。');
  return { bytes, mime, extension: extensions[mime] };
}

export class CustomizationStore {
  constructor(directory, { validateImage } = {}) {
    this.directory = directory;
    this.assetsDirectory = path.join(directory, 'customization-assets');
    this.filePath = path.join(directory, 'customization.json');
    this.validateImage = validateImage;
    this.data = { version: 1, assets: [], profiles: {}, presets: [], migrated: [] };
    fs.mkdirSync(this.assetsDirectory, { recursive: true });
    if (fs.existsSync(this.filePath)) {
      // Preserve unreadable/newer settings instead of silently overwriting them.
      const saved = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (saved.version !== 1 || !Array.isArray(saved.assets) || !Array.isArray(saved.presets)) throw new Error('自定义配置版本不受支持。');
      this.data = { ...this.data, ...saved };
    }
  }

  assetPath(asset) {
    if (!/^[a-f0-9]{64}\.(png|jpg|gif|webp|svg)$/.test(asset?.file || '')) throw new Error('图片记录无效。');
    return path.join(this.assetsDirectory, asset.file);
  }
  snapshot() {
    return {
      version: 1,
      assets: this.data.assets.map(asset => ({ ...asset, url: pathToFileURL(this.assetPath(asset)).href })),
      profiles: structuredClone(this.data.profiles), presets: structuredClone(this.data.presets),
    };
  }
  persist() {
    const temporary = `${this.filePath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(temporary, this.filePath);
  }
  transaction(operation) {
    const previous = structuredClone(this.data);
    try { const result = operation(); this.persist(); return result; }
    catch (error) {
      const existingFiles = new Set(previous.assets.map(asset => asset.file));
      for (const asset of this.data.assets) if (!existingFiles.has(asset.file)) {
        try { fs.unlinkSync(this.assetPath(asset)); } catch { /* preserve the original operation error */ }
      }
      this.data = previous;
      throw error;
    }
  }
  addImage(dataUrl, name) {
    const decoded = decodeImage(dataUrl);
    this.validateImage?.(decoded.bytes, decoded.mime);
    const hash = createHash('sha256').update(decoded.bytes).digest('hex');
    const existing = this.data.assets.find(asset => asset.hash === hash);
    if (existing) {
      if (!fs.existsSync(this.assetPath(existing))) fs.writeFileSync(this.assetPath(existing), decoded.bytes);
      return existing;
    }
    const asset = {
      id: `asset_${hash.slice(0, 24)}`, hash, file: `${hash}.${decoded.extension}`,
      name: label(name, '我的图片'), mime: decoded.mime,
      animated: decoded.mime === 'image/gif' ? animatedGif(decoded.bytes)
        : decoded.mime === 'image/webp' && decoded.bytes.subarray(12, 16).toString() === 'VP8X' && Boolean(decoded.bytes[20] & 2),
      favorite: false, createdAt: new Date().toISOString(),
    };
    fs.writeFileSync(this.assetPath(asset), decoded.bytes);
    this.data.assets.push(asset);
    return asset;
  }
  importImage(payload) { return this.transaction(() => this.addImage(payload?.dataUrl, payload?.name)); }
  checkProfile(value) {
    const profile = normalizeProfile(value);
    for (const key of ['appearance', 'background']) {
      if (profile[key].assetId && !this.data.assets.some(a => a.id === profile[key].assetId)) throw new Error('所选图片已不存在，请重新选择。');
    }
    return profile;
  }
  saveProfile(key, value) {
    if (!validCharacterKey(key)) throw new Error('角色无效。');
    return this.transaction(() => { this.data.profiles[key] = this.checkProfile(value); });
  }
  updateAsset(assetId, changes) {
    return this.transaction(() => {
      const asset = this.data.assets.find(item => item.id === assetId);
      if (!asset) throw new Error('图片不存在。');
      if (changes.name !== undefined) asset.name = label(changes.name, asset.name);
      if (changes.favorite !== undefined) asset.favorite = Boolean(changes.favorite);
    });
  }
  removeAsset(assetId) {
    const asset = this.data.assets.find(item => item.id === assetId);
    if (!asset) return;
    this.transaction(() => {
      // Deletion resets all references, including reusable presets.
      for (const profile of [...Object.values(this.data.profiles), ...this.data.presets.map(p => p.profile)]) {
        if (profile.appearance.assetId === assetId) profile.appearance.assetId = null;
        if (profile.background.assetId === assetId) { profile.background.assetId = null; profile.background.mode = 'transparent'; }
      }
      this.data.assets = this.data.assets.filter(item => item.id !== assetId);
    });
    // Metadata is committed before removing the file. Failed cleanup cannot lose settings.
    try { fs.unlinkSync(this.assetPath(asset)); } catch (error) { if (error.code !== 'ENOENT') console.warn('[Customize] Asset cleanup:', error.message); }
  }
  savePreset(name, profile) {
    return this.transaction(() => {
      const preset = { id: `preset_${randomUUID()}`, name: label(name, '我的预设'), profile: this.checkProfile(profile) };
      this.data.presets.push(preset);
      return preset;
    });
  }
  removePreset(id) { this.transaction(() => { this.data.presets = this.data.presets.filter(p => p.id !== id); }); }
  exportPreset(id) {
    const preset = this.data.presets.find(p => p.id === id);
    if (!preset) throw new Error('预设不存在。');
    const ids = new Set([preset.profile.appearance.assetId, preset.profile.background.assetId]);
    return {
      format: 'voicespirit-customization', version: 1, name: preset.name, profile: preset.profile,
      assets: this.data.assets.filter(asset => ids.has(asset.id)).map(asset => ({
        id: asset.id, name: asset.name, dataUrl: `data:${asset.mime};base64,${fs.readFileSync(this.assetPath(asset)).toString('base64')}`,
      })),
    };
  }
  importPreset(bundle) {
    if (bundle?.format !== 'voicespirit-customization' || bundle.version !== 1 || !Array.isArray(bundle.assets) || bundle.assets.length > 2) throw new Error('请选择有效的伙伴外观预设文件。');
    return this.transaction(() => {
      const mapping = new Map();
      for (const asset of bundle.assets) mapping.set(asset.id, this.addImage(asset.dataUrl, asset.name).id);
      const profile = normalizeProfile(bundle.profile);
      for (const key of ['appearance', 'background']) {
        if (profile[key].assetId) {
          if (!mapping.has(profile[key].assetId)) throw new Error('预设缺少所需图片。');
          profile[key].assetId = mapping.get(profile[key].assetId);
        }
      }
      const preset = { id: `preset_${randomUUID()}`, name: label(bundle.name, '导入预设'), profile };
      this.data.presets.push(preset);
      return preset;
    });
  }
  migrateLegacy(entries) {
    if (!Array.isArray(entries) || entries.length > 200) throw new Error('旧版外观配置无效。');
    const errors = [];
    this.transaction(() => {
      for (const entry of entries) {
        const key = `hero:${entry.heroId}`;
        if (!validCharacterKey(key)) continue;
        let selectedAsset = null;
        for (const [skinId, skin] of Object.entries(entry.skins || {})) {
          const marker = `${key}/${skinId}`;
          if (this.data.migrated.includes(marker)) continue;
          try {
            const asset = this.addImage(skin?.sprites?.idle, skin?.name || skin?.nameZh);
            this.data.migrated.push(marker);
            if (entry.activeSkinId === skinId) selectedAsset = asset.id;
          } catch (error) { errors.push(`${entry.heroId}: ${error.message}`); }
        }
        if (!this.data.profiles[key] && entry.activeSkinId) {
          // Already migrated assets may be reused after an interrupted first migration.
          if (!selectedAsset && entry.skins?.[entry.activeSkinId]) {
            try { selectedAsset = this.addImage(entry.skins[entry.activeSkinId].sprites.idle, entry.skins[entry.activeSkinId].name).id; } catch { /* preserve original legacy data */ }
          }
          if (selectedAsset || !entry.activeSkinId.startsWith('custom_')) {
            const builtinId = Object.hasOwn(entry, 'builtinId') ? entry.builtinId : entry.activeSkinId;
            this.data.profiles[key] = normalizeProfile({ appearance: { assetId: selectedAsset, builtinId: selectedAsset ? null : builtinId }, accent: entry.themeColor });
          }
        }
      }
    });
    return errors;
  }
}
