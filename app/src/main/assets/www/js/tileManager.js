/**
 * Offline Tile Manager for Leaflet
 * Algérie Télécom - Biskra & Tolga Offline Maps Engine
 * Stores XYZ tiles in IndexedDB and serves them seamlessly offline
 */

// Tile servers configuration
const TILE_SERVERS = {
  streets: {
    name: 'الخريطة العادية (شوارع)',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    maxZoom: 19,
    subdomains: ['a', 'b', 'c'],
    attribution: '© OpenStreetMap contributors'
  },
  satellite: {
    name: 'صور الأقمار الصناعية',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    maxZoom: 19,
    subdomains: [],
    attribution: '© Esri, Maxar, Earthstar Geographics'
  }
};

// Region presets
const PRESET_REGIONS = {
  tolgaFocus: {
    name: 'مدينة طولقة (دقة عالية 14-18)',
    minLat: 34.695,
    maxLat: 34.745,
    minLng: 5.345,
    maxLng: 5.415,
    minZoom: 14,
    maxZoom: 18
  },
  biskraWilaya: {
    name: 'ولاية بسكرة والمحيط (تقريب 10-14)',
    minLat: 34.60,
    maxLat: 34.95,
    minLng: 5.30,
    maxLng: 5.85,
    minZoom: 10,
    maxZoom: 14
  }
};

// Math helpers for Slippy Map tiles
function lon2tile(lon, zoom) {
  return Math.floor((lon + 180) / 360 * Math.pow(2, zoom));
}

function lat2tile(lat, zoom) {
  return Math.floor(
    (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom)
  );
}

// Generate an offline placeholder tile using HTML5 Canvas
function createOfflinePlaceholder(z, x, y) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#f1f5f9';
  ctx.fillRect(0, 0, 256, 256);

  // Border & Grid
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, 255, 255);

  // Subtle grid lines
  ctx.strokeStyle = '#e2e8f0';
  ctx.beginPath();
  ctx.moveTo(0, 128);
  ctx.lineTo(256, 128);
  ctx.moveTo(128, 0);
  ctx.lineTo(128, 256);
  ctx.stroke();

  // Offline text badge
  ctx.fillStyle = '#64748b';
  ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('أوفلاين (غير مخزنة)', 128, 115);

  ctx.font = '10px monospace';
  ctx.fillStyle = '#94a3b8';
  ctx.fillText(`Z:${z} X:${x} Y:${y}`, 128, 145);

  return canvas.toDataURL('image/png');
}

/**
 * Custom Leaflet TileLayer that prioritizes IndexedDB offline cache
 */
if (typeof L !== 'undefined') {
  L.TileLayer.OfflineIndexedDB = L.TileLayer.extend({
    initialize: function (url, options) {
      L.TileLayer.prototype.initialize.call(this, url, options);
      this.layerKey = options.layerKey || 'streets';
    },

    createTile: function (coords, done) {
      const tile = document.createElement('img');
      L.DomEvent.on(tile, 'load', L.Util.bind(this._tileOnLoad, this, done, tile));
      L.DomEvent.on(tile, 'error', L.Util.bind(this._tileOnError, this, done, tile));

      if (this.options.crossOrigin || this.options.crossOrigin === '') {
        tile.crossOrigin = this.options.crossOrigin === true ? '' : this.options.crossOrigin;
      }

      tile.alt = '';
      tile.setAttribute('role', 'presentation');

      const key = `${this.layerKey}/${coords.z}/${coords.x}/${coords.y}`;
      const url = this.getTileUrl(coords);

      // Check IndexedDB first
      window.telecomDB.getTile(key).then((blob) => {
        if (blob) {
          const objectUrl = URL.createObjectURL(blob);
          tile.src = objectUrl;
          tile._objectUrl = objectUrl;
        } else {
          // If not in IndexedDB, try network if online
          if (navigator.onLine) {
            fetch(url, { mode: 'cors', cache: 'default' })
              .then((res) => {
                if (res.ok) {
                  return res.blob();
                }
                throw new Error('Tile network error: ' + res.status);
              })
              .then((downloadedBlob) => {
                // Save to IndexedDB in background
                window.telecomDB.saveTile(key, this.layerKey, downloadedBlob).catch(() => {});
                const objectUrl = URL.createObjectURL(downloadedBlob);
                tile.src = objectUrl;
                tile._objectUrl = objectUrl;
              })
              .catch(() => {
                // Failed network fetch -> render offline tile
                tile.src = createOfflinePlaceholder(coords.z, coords.x, coords.y);
              });
          } else {
            // Completely offline and not cached
            tile.src = createOfflinePlaceholder(coords.z, coords.x, coords.y);
          }
        }
      }).catch(() => {
        tile.src = createOfflinePlaceholder(coords.z, coords.x, coords.y);
      });

      return tile;
    },

    _tileOnLoad: function (done, tile) {
      done(null, tile);
    },

    _tileOnError: function (done, tile, e) {
      // Fallback on error
      tile.src = createOfflinePlaceholder(0, 0, 0);
      done(e, tile);
    }
  });

  L.tileLayer.offlineIndexedDB = function (url, options) {
    return new L.TileLayer.OfflineIndexedDB(url, options);
  };
}

/**
 * Tile Manager for downloading offline packs for Biskra & Tolga
 */
class TileDownloader {
  constructor() {
    this.isDownloading = false;
    this.cancelRequested = false;
  }

  // Calculate list of tile keys for a given geographic box
  calculateTilesForBox(minLat, maxLat, minLng, maxLng, minZoom, maxZoom) {
    const tiles = [];
    for (let z = minZoom; z <= maxZoom; z++) {
      const minX = Math.min(lon2tile(minLng, z), lon2tile(maxLng, z));
      const maxX = Math.max(lon2tile(minLng, z), lon2tile(maxLng, z));
      const minY = Math.min(lat2tile(maxLat, z), lat2tile(minLat, z));
      const maxY = Math.max(lat2tile(maxLat, z), lat2tile(minLat, z));

      for (let x = minX; x <= maxX; x++) {
        for (let y = minY; y <= maxY; y++) {
          tiles.push({ z, x, y });
        }
      }
    }
    return tiles;
  }

  // Estimate total tile count
  getPresetPacksInfo() {
    const tolgaTiles = this.calculateTilesForBox(
      PRESET_REGIONS.tolgaFocus.minLat,
      PRESET_REGIONS.tolgaFocus.maxLat,
      PRESET_REGIONS.tolgaFocus.minLng,
      PRESET_REGIONS.tolgaFocus.maxLng,
      PRESET_REGIONS.tolgaFocus.minZoom,
      PRESET_REGIONS.tolgaFocus.maxZoom
    );

    const biskraTiles = this.calculateTilesForBox(
      PRESET_REGIONS.biskraWilaya.minLat,
      PRESET_REGIONS.biskraWilaya.maxLat,
      PRESET_REGIONS.biskraWilaya.minLng,
      PRESET_REGIONS.biskraWilaya.maxLng,
      PRESET_REGIONS.biskraWilaya.minZoom,
      PRESET_REGIONS.biskraWilaya.maxZoom
    );

    return {
      tolga: {
        count: tolgaTiles.length,
        estSizeMB: (tolgaTiles.length * 0.025).toFixed(1) // avg 25KB per tile
      },
      biskra: {
        count: biskraTiles.length,
        estSizeMB: (biskraTiles.length * 0.020).toFixed(1)
      }
    };
  }

  // Start downloading a batch of tiles
  async startDownload(layerKey, regionType, onProgress, onComplete, onError) {
    if (this.isDownloading) {
      if (onError) onError(new Error('هناك عملية تحميل قيد التشغيل بالفعل'));
      return;
    }

    this.isDownloading = true;
    this.cancelRequested = false;

    try {
      let tilesToDownload = [];
      if (regionType === 'tolga') {
        tilesToDownload = this.calculateTilesForBox(
          PRESET_REGIONS.tolgaFocus.minLat,
          PRESET_REGIONS.tolgaFocus.maxLat,
          PRESET_REGIONS.tolgaFocus.minLng,
          PRESET_REGIONS.tolgaFocus.maxLng,
          PRESET_REGIONS.tolgaFocus.minZoom,
          PRESET_REGIONS.tolgaFocus.maxZoom
        );
      } else if (regionType === 'biskra') {
        tilesToDownload = this.calculateTilesForBox(
          PRESET_REGIONS.biskraWilaya.minLat,
          PRESET_REGIONS.biskraWilaya.maxLat,
          PRESET_REGIONS.biskraWilaya.minLng,
          PRESET_REGIONS.biskraWilaya.maxLng,
          PRESET_REGIONS.biskraWilaya.minZoom,
          PRESET_REGIONS.biskraWilaya.maxZoom
        );
      } else if (regionType === 'full') {
        // Combined: Biskra Wilaya (zoom 10-14) + Tolga City Deep (zoom 14-18)
        const biskra = this.calculateTilesForBox(
          PRESET_REGIONS.biskraWilaya.minLat,
          PRESET_REGIONS.biskraWilaya.maxLat,
          PRESET_REGIONS.biskraWilaya.minLng,
          PRESET_REGIONS.biskraWilaya.maxLng,
          10,
          14
        );
        const tolga = this.calculateTilesForBox(
          PRESET_REGIONS.tolgaFocus.minLat,
          PRESET_REGIONS.tolgaFocus.maxLat,
          PRESET_REGIONS.tolgaFocus.minLng,
          PRESET_REGIONS.tolgaFocus.maxLng,
          14,
          18
        );
        // Deduplicate
        const map = new Map();
        biskra.concat(tolga).forEach(t => map.set(`${t.z}/${t.x}/${t.y}`, t));
        tilesToDownload = Array.from(map.values());
      }

      const total = tilesToDownload.length;
      let downloaded = 0;
      let skipped = 0;
      let errors = 0;

      const serverConfig = TILE_SERVERS[layerKey] || TILE_SERVERS.streets;

      // Concurrency limit to avoid 429 rate limiting
      const CONCURRENCY = 4;
      let index = 0;

      const worker = async () => {
        while (index < tilesToDownload.length && !this.cancelRequested) {
          const current = tilesToDownload[index++];
          const key = `${layerKey}/${current.z}/${current.x}/${current.y}`;

          // Check if already in IndexedDB
          const existing = await window.telecomDB.getTile(key);
          if (existing) {
            skipped++;
            downloaded++;
            if (onProgress) {
              onProgress({
                downloaded,
                total,
                percent: Math.round((downloaded / total) * 100),
                skipped,
                errors
              });
            }
            continue;
          }

          // Build URL
          let tileUrl = serverConfig.url
            .replace('{z}', current.z)
            .replace('{x}', current.x)
            .replace('{y}', current.y);

          if (serverConfig.subdomains && serverConfig.subdomains.length) {
            const sub = serverConfig.subdomains[(current.x + current.y) % serverConfig.subdomains.length];
            tileUrl = tileUrl.replace('{s}', sub);
          }

          try {
            const response = await fetch(tileUrl, { mode: 'cors' });
            if (response.ok) {
              const blob = await response.blob();
              await window.telecomDB.saveTile(key, layerKey, blob);
            } else {
              errors++;
            }
          } catch (e) {
            errors++;
          }

          downloaded++;
          if (onProgress) {
            onProgress({
              downloaded,
              total,
              percent: Math.round((downloaded / total) * 100),
              skipped,
              errors
            });
          }

          // Polite throttle delay: 15ms
          await new Promise(r => setTimeout(r, 15));
        }
      };

      const workers = [];
      for (let w = 0; w < CONCURRENCY; w++) {
        workers.push(worker());
      }

      await Promise.all(workers);

      this.isDownloading = false;
      if (this.cancelRequested) {
        if (onComplete) onComplete({ cancelled: true, downloaded, total });
      } else {
        if (onComplete) onComplete({ completed: true, downloaded, total, skipped, errors });
      }
    } catch (err) {
      this.isDownloading = false;
      if (onError) onError(err);
    }
  }

  cancelDownload() {
    if (this.isDownloading) {
      this.cancelRequested = true;
    }
  }

  async getStorageStats() {
    const totalCount = await window.telecomDB.getTilesCount();
    const streetsCount = await window.telecomDB.getTilesCount('streets');
    const satelliteCount = await window.telecomDB.getTilesCount('satellite');
    // Approximate size in MB (average 22KB per tile)
    const approxMB = (totalCount * 0.022).toFixed(2);
    return {
      totalCount,
      streetsCount,
      satelliteCount,
      approxMB
    };
  }
}

window.tileDownloader = new TileDownloader();
