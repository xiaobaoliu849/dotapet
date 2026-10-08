import fs from 'fs';
import path from 'path';

const GSI_CFG_FILENAME = 'gamestate_integration_voicespirit.cfg';
const DEFAULT_PORT = 3008;

export function generateGsiConfigContent(port = DEFAULT_PORT) {
  return `"Dota 2 VoiceSpirit Companion Integration"
{
    "uri"           "http://127.0.0.1:${port}/"
    "timeout"       "1.5"
    "buffer"        "0.1"
    "throttle"      "0.1"
    "heartbeat"     "30.0"
    "data"
    {
        "buildings"     "0"
        "provider"      "1"
        "map"           "1"
        "player"        "1"
        "hero"          "1"
        "abilities"     "0"
        "items"         "0"
        "draft"         "0"
        "wearables"     "0"
    }
}
`;
}

/**
 * Searches common disk drives and Steam library locations for DOTA 2 GSI cfg directory
 */
export function findDota2GsiDirectories() {
  const candidates = [];
  const drives = ['C', 'D', 'E', 'F', 'G'];
  const commonRelativePaths = [
    'Program Files (x86)/Steam/steamapps/common/dota 2 beta/game/dota/cfg/gamestate_integration',
    'Program Files/Steam/steamapps/common/dota 2 beta/game/dota/cfg/gamestate_integration',
    'Steam/steamapps/common/dota 2 beta/game/dota/cfg/gamestate_integration',
    'SteamLibrary/steamapps/common/dota 2 beta/game/dota/cfg/gamestate_integration',
    'Games/Steam/steamapps/common/dota 2 beta/game/dota/cfg/gamestate_integration',
    'Games/SteamLibrary/steamapps/common/dota 2 beta/game/dota/cfg/gamestate_integration',
    'dota 2 beta/game/dota/cfg/gamestate_integration',
  ];

  for (const drive of drives) {
    for (const rel of commonRelativePaths) {
      const fullPath = path.resolve(`${drive}:/`, rel);
      if (fs.existsSync(fullPath)) {
        candidates.push(fullPath);
      } else {
        // Check if parent cfg directory exists (in case gamestate_integration subfolder needs creation)
        const parentCfg = path.dirname(fullPath);
        if (fs.existsSync(parentCfg)) {
          candidates.push(fullPath);
        }
      }
    }
  }

  // Also check if Steam's libraryfolders.vdf can give us more library paths
  const steamRoots = [
    'C:/Program Files (x86)/Steam',
    'C:/Program Files/Steam',
    'D:/Steam',
    'E:/Steam',
  ];
  for (const sRoot of steamRoots) {
    const vdfPath = path.join(sRoot, 'steamapps/libraryfolders.vdf');
    if (fs.existsSync(vdfPath)) {
      try {
        const vdfContent = fs.readFileSync(vdfPath, 'utf8');
        const pathMatches = vdfContent.match(/"path"\s+"([^"]+)"/g);
        if (pathMatches) {
          for (const match of pathMatches) {
            const libPath = match.replace(/"path"\s+"/, '').replace(/"$/, '').replace(/\\\\/g, '/');
            const candidate = path.join(libPath, 'steamapps/common/dota 2 beta/game/dota/cfg/gamestate_integration');
            const parent = path.dirname(candidate);
            if (fs.existsSync(parent) && !candidates.includes(candidate)) {
              candidates.push(candidate);
            }
          }
        }
      } catch (e) {
        console.warn('[GSIInstaller] Failed to parse libraryfolders.vdf:', e.message);
      }
    }
  }

  return Array.from(new Set(candidates));
}

/**
 * Checks if the GSI config is already installed
 */
export function checkGsiInstalled(customDir = null, port = DEFAULT_PORT) {
  const dirs = customDir ? [customDir] : findDota2GsiDirectories();
  for (const dir of dirs) {
    const cfgPath = path.join(dir, GSI_CFG_FILENAME);
    if (fs.existsSync(cfgPath)) {
      try {
        const content = fs.readFileSync(cfgPath, 'utf8');
        if (content.includes(`127.0.0.1:${port}`) || content.includes('VoiceSpirit')) {
          return { installed: true, path: cfgPath, directory: dir };
        }
      } catch (e) {}
    }
  }
  return { installed: false, detectedDirs: dirs };
}

/**
 * Writes gamestate_integration_voicespirit.cfg into the detected or specified Dota 2 directory
 */
export function installGsiConfig(targetDir = null, port = DEFAULT_PORT) {
  let target = targetDir;
  if (!target) {
    const detected = findDota2GsiDirectories();
    if (detected.length > 0) {
      target = detected[0];
    }
  }

  if (!target) {
    return {
      success: false,
      error: '未能自动检测到 DOTA 2 安装路径，请手动选择游戏目录下的 game/dota/cfg 文件夹。',
    };
  }

  try {
    if (!fs.existsSync(target)) {
      fs.mkdirSync(target, { recursive: true });
    }

    const cfgPath = path.join(target, GSI_CFG_FILENAME);
    const content = generateGsiConfigContent(port);
    fs.writeFileSync(cfgPath, content, 'utf8');
    console.log(`[GSIInstaller] Successfully installed GSI config to: ${cfgPath}`);

    return {
      success: true,
      path: cfgPath,
      directory: target,
      message: 'GSI 配置文件安装成功！启动或重启 DOTA 2 即可生效。',
    };
  } catch (err) {
    console.error('[GSIInstaller] Failed to write GSI cfg:', err);
    return {
      success: false,
      error: `写入配置文件失败: ${err.message}`,
    };
  }
}
