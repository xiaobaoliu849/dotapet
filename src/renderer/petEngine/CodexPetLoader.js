/**
 * CodexPetLoader - Parser & Loader for Codex-Compatible Desktop Pet Packages
 * Conforms to OpenPet / Codex Pet.json specifications with DOTA 2 extensions.
 */

export class CodexPetLoader {
  constructor() {
    this.loadedPets = new Map();
    this.activePet = null;
    this.defaultPetList = [
      'aurora_wolf',
      'donkey_courier',
      'treant_sapling',
      'mischievous_greevil',
      'baby_roshan',
    ];
  }

  /**
   * Load pet definition from URL or relative path
   * @param {string} manifestPath - Path to pet.json
   */
  async loadPetManifest(manifestPath) {
    try {
      const response = await fetch(manifestPath);
      if (!response.ok) {
        throw new Error(`Failed to load pet manifest: HTTP ${response.status}`);
      }
      const manifest = await response.json();
      const basePath = manifestPath.substring(0, manifestPath.lastIndexOf('/'));
      
      const petPackage = this.normalizePetPackage(manifest, basePath);
      this.loadedPets.set(petPackage.name, petPackage);
      return petPackage;
    } catch (err) {
      console.error('[CodexPetLoader] Load manifest failed:', err);
      throw err;
    }
  }

  /**
   * Preload all default pets in the matrix
   */
  async loadAllPetPackages(baseAssetsUrl = 'assets/pets') {
    const results = [];
    for (const petName of this.defaultPetList) {
      try {
        const pkg = await this.loadPetManifest(`${baseAssetsUrl}/${petName}/pet.json`);
        results.push(pkg);
      } catch (err) {
        console.warn(`[CodexPetLoader] Optional pet ${petName} load error:`, err);
      }
    }
    return results;
  }

  /**
   * Normalize and validate pet package
   */
  normalizePetPackage(manifest, basePath) {
    const pkg = {
      name: manifest.name || 'custom_pet',
      displayName: manifest.displayName || manifest.name || 'Desktop Pet',
      version: manifest.version || '1.0.0',
      author: manifest.author || 'Community',
      description: manifest.description || '',
      themeColor: manifest.themeColor || '#38bdf8',
      secondaryColor: manifest.secondaryColor || '#bae6fd',
      heroCompanion: manifest.heroCompanion || null,
      specialSkill: manifest.specialSkill || {
        id: 'generic_special',
        name: '萌宠绝招',
        description: '触发萌宠专属互动特效',
        icon: '✨',
        duration: 3000,
      },
      basePath: basePath,
      states: {},
    };

    // Normalize states and resolve asset URLs
    if (manifest.states && typeof manifest.states === 'object') {
      for (const [stateName, stateDef] of Object.entries(manifest.states)) {
        pkg.states[stateName] = {
          name: stateName,
          label: stateDef.label || stateName,
          svg: stateDef.svg ? `${basePath}/${stateDef.svg}` : null,
          image: stateDef.image ? `${basePath}/${stateDef.image}` : null,
          frames: (stateDef.frames || []).map(f => (typeof f === 'string' && !f.startsWith('http') ? `${basePath}/${f}` : f)),
          duration: stateDef.duration || 300,
          loop: stateDef.loop !== undefined ? stateDef.loop : true,
          quote: stateDef.quote || '',
          particle: stateDef.particle || null,
        };
      }
    }

    return pkg;
  }

  /**
   * Get pet definition
   * @param {string} petName
   */
  getPet(petName) {
    return this.loadedPets.get(petName) || null;
  }

  /**
   * Get all loaded pet packages
   */
  getAllPets() {
    return Array.from(this.loadedPets.values());
  }

  /**
   * Get pet asset for a specific state
   * @param {string} petName
   * @param {string} stateName
   */
  getPetStateAsset(petName, stateName) {
    const pet = this.loadedPets.get(petName);
    if (!pet) return null;

    const state = pet.states[stateName] || pet.states['idle'];
    if (!state) return null;

    return {
      src: state.svg || state.image || (state.frames && state.frames[0]) || null,
      quote: state.quote,
      duration: state.duration,
      loop: state.loop,
      particle: state.particle,
      label: state.label,
    };
  }
}
