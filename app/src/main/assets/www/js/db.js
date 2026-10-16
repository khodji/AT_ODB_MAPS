/**
 * IndexedDB Database Layer for Algérie Télécom Distribution Boxes App
 * 100% Offline Local Storage for Boxes, Subscribers, and Map Tiles
 */
const DB_NAME = 'pcp_algerie_telecom_db';
const DB_VERSION = 1;

class TelecomDB {
  constructor() {
    this.db = null;
    this.initPromise = this.init();
  }

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Store for Distribution Boxes (PCP / MSAN / DP)
        if (!db.objectStoreNames.contains('boxes')) {
          const boxStore = db.createObjectStore('boxes', { keyPath: 'id' });
          boxStore.createIndex('code', 'code', { unique: false });
          boxStore.createIndex('type', 'type', { unique: false });
          boxStore.createIndex('createdAt', 'createdAt', { unique: false });
        }

        // Store for Offline Map Tiles
        if (!db.objectStoreNames.contains('tiles')) {
          const tileStore = db.createObjectStore('tiles', { keyPath: 'key' });
          tileStore.createIndex('layer', 'layer', { unique: false });
        }

        // Store for settings / meta
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
      };

      request.onerror = (event) => {
        console.error('IndexedDB Error:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  async ready() {
    if (!this.db) {
      await this.initPromise;
    }
    return this.db;
  }

  // ---- BOXES CRUD ----

  async getAllBoxes() {
    await this.ready();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('boxes', 'readonly');
      const store = tx.objectStore('boxes');
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async getBox(id) {
    await this.ready();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('boxes', 'readonly');
      const store = tx.objectStore('boxes');
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async saveBox(box) {
    await this.ready();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('boxes', 'readwrite');
      const store = tx.objectStore('boxes');
      const now = new Date().toISOString();

      if (!box.id) {
        box.id = 'pcp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
      }
      if (!box.createdAt) {
        box.createdAt = now;
      }
      box.updatedAt = now;
      if (!box.subscribers) {
        box.subscribers = [];
      }
      if (!box.images) {
        box.images = [];
      }

      const request = store.put(box);
      request.onsuccess = () => resolve(box);
      request.onerror = () => reject(request.error);
    });
  }

  async deleteBox(id) {
    await this.ready();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('boxes', 'readwrite');
      const store = tx.objectStore('boxes');
      const request = store.delete(id);
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }

  async importBoxes(boxesList, overwrite = false) {
    await this.ready();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('boxes', 'readwrite');
      const store = tx.objectStore('boxes');

      if (overwrite) {
        store.clear();
      }

      let count = 0;
      for (const box of boxesList) {
        if (box && box.code && box.lat && box.lng) {
          store.put(box);
          count++;
        }
      }

      tx.oncomplete = () => resolve(count);
      tx.onerror = () => reject(tx.error);
    });
  }

  // ---- TILES CACHING (OFFLINE MAPS) ----

  async getTile(key) {
    await this.ready();
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction('tiles', 'readonly');
        const store = tx.objectStore('tiles');
        const request = store.get(key);
        request.onsuccess = () => {
          if (request.result && request.result.blob) {
            resolve(request.result.blob);
          } else {
            resolve(null);
          }
        };
        request.onerror = () => resolve(null);
      } catch (e) {
        resolve(null);
      }
    });
  }

  async saveTile(key, layer, blob) {
    await this.ready();
    return new Promise((resolve, reject) => {
      try {
        const tx = this.db.transaction('tiles', 'readwrite');
        const store = tx.objectStore('tiles');
        const record = {
          key: key,
          layer: layer,
          blob: blob,
          timestamp: Date.now()
        };
        const request = store.put(record);
        request.onsuccess = () => resolve(true);
        request.onerror = () => reject(request.error);
      } catch (e) {
        reject(e);
      }
    });
  }

  async getTilesCount(layer = null) {
    await this.ready();
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction('tiles', 'readonly');
        const store = tx.objectStore('tiles');
        let request;
        if (layer) {
          const index = store.index('layer');
          request = index.count(IDBKeyRange.only(layer));
        } else {
          request = store.count();
        }
        request.onsuccess = () => resolve(request.result || 0);
        request.onerror = () => resolve(0);
      } catch (e) {
        resolve(0);
      }
    });
  }

  async clearTiles(layer = null) {
    await this.ready();
    return new Promise((resolve, reject) => {
      try {
        const tx = this.db.transaction('tiles', 'readwrite');
        const store = tx.objectStore('tiles');
        if (!layer) {
          const req = store.clear();
          req.onsuccess = () => resolve(true);
          req.onerror = () => reject(req.error);
        } else {
          const index = store.index('layer');
          const range = IDBKeyRange.only(layer);
          const req = index.openKeyCursor(range);
          req.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
              store.delete(cursor.primaryKey);
              cursor.continue();
            } else {
              resolve(true);
            }
          };
          req.onerror = () => reject(req.error);
        }
      } catch (e) {
        reject(e);
      }
    });
  }

  // ---- SETTINGS / META ----

  async getSetting(key, defaultValue = null) {
    await this.ready();
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction('settings', 'readonly');
        const store = tx.objectStore('settings');
        const req = store.get(key);
        req.onsuccess = () => {
          if (req.result && req.result.value !== undefined) {
            resolve(req.result.value);
          } else {
            resolve(defaultValue);
          }
        };
        req.onerror = () => resolve(defaultValue);
      } catch (e) {
        resolve(defaultValue);
      }
    });
  }

  async saveSetting(key, value) {
    await this.ready();
    return new Promise((resolve, reject) => {
      try {
        const tx = this.db.transaction('settings', 'readwrite');
        const store = tx.objectStore('settings');
        const req = store.put({ key, value });
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
      } catch (e) {
        reject(e);
      }
    });
  }
}

// Sample Data for Biskra & Tolga for field demonstration
const INITIAL_DEMO_BOXES = [
  {
    id: 'pcp_tolga_01',
    code: 'PCP-01-TOLGA',
    type: 'علبة توزيع رئيسية (PCP)',
    lat: 34.7214,
    lng: 5.3812,
    accuracy: 3.5,
    capacity: 100,
    notes: 'علبة التوزيع المركزية قرب مقر البلدية بمدينة طولقة. حالة جيدة مع قفل جديد.',
    createdAt: '2026-09-15T08:30:00.000Z',
    updatedAt: '2026-09-15T08:30:00.000Z',
    images: [],
    subscribers: [
      { id: 'sub_1', phone: '033 68 12 34', name: 'عمر بوزيدي', address: 'شارع أول نوفمبر، مقابل البريد', port: 'زوج 01', status: 'نشط' },
      { id: 'sub_2', phone: '033 68 45 90', name: 'بلقاسم حواش', address: 'حي الزهور، مسكن رقم 14', port: 'زوج 02', status: 'نشط' },
      { id: 'sub_3', phone: '033 68 77 11', name: 'صيدلية النخيل', address: 'طريق بسكرة، محاذاة البلدية', port: 'زوج 05', status: 'نشط' }
    ]
  },
  {
    id: 'pcp_tolga_02',
    code: 'MSAN-03-PALMIERS',
    type: 'كابينة ألياف بصرية (MSAN)',
    lat: 34.7245,
    lng: 5.3768,
    accuracy: 2.8,
    capacity: 250,
    notes: 'كابينة MSAN جديدة لتوزيع الألياف البصرية بحي النخيل بطولقة. تغذي أكثر من 180 مشترك.',
    createdAt: '2026-09-20T10:15:00.000Z',
    updatedAt: '2026-09-20T10:15:00.000Z',
    images: [],
    subscribers: [
      { id: 'sub_4', phone: '033 68 88 22', name: 'عمار سلطاني', address: 'حي النخيل عمارة ب رقم 06', port: 'منفذ VDSL 12', status: 'نشط' },
      { id: 'sub_5', phone: '033 68 33 44', name: 'ثانوية الشهداء طولقة', address: 'طريق الزيبان', port: 'خط فايبر مخصص', status: 'نشط' }
    ]
  },
  {
    id: 'pcp_tolga_03',
    code: 'DP-08-MARCHE',
    type: 'علبة طرفية (DP)',
    lat: 34.7182,
    lng: 5.3855,
    accuracy: 4.1,
    capacity: 20,
    notes: 'علبة جدارية مثبتة على عمود هاتف قرب السوق الأسبوعي طولقة. تحتاج فحص عزل الكوابل.',
    createdAt: '2026-09-25T14:40:00.000Z',
    updatedAt: '2026-09-25T14:40:00.000Z',
    images: [],
    subscribers: [
      { id: 'sub_6', phone: '033 68 90 01', name: 'محل تجاري الإخوة سعدي', address: 'السوق المركزي طولقة', port: 'زوج 04', status: 'نشط' }
    ]
  },
  {
    id: 'pcp_biskra_01',
    code: 'PCP-04-BISKRA-CTR',
    type: 'علبة توزيع رئيسية (PCP)',
    lat: 34.8512,
    lng: 5.7288,
    accuracy: 3.0,
    capacity: 150,
    notes: 'وسط مدينة بسكرة قرب ساحة الحرية ومحطة القطار. علبة معدنية كبيرة.',
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
    images: [],
    subscribers: [
      { id: 'sub_7', phone: '033 74 10 20', name: 'مكتب دراسات الواحات', address: 'شارع الزعاطشة بسكرة', port: 'زوج 08', status: 'نشط' },
      { id: 'sub_8', phone: '033 74 55 66', name: 'فندق الزيبان', address: 'وسط المدينة بسكرة', port: 'زوج 15', status: 'نشط' }
    ]
  }
];

window.telecomDB = new TelecomDB();
