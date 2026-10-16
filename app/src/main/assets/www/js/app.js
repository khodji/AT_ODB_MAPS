/**
 * Algérie Télécom - Distribution Boxes (PCP) Field Application
 * Main Application Logic & Leaflet Controller
 */

// App State
const state = {
  map: null,
  clusterGroup: null,
  activeLayerKey: 'streets',
  activeLayer: null,
  userLocation: null, // { lat, lng, accuracy }
  userLocationMarker: null,
  userAccuracyCircle: null,
  boxes: [],
  selectedBox: null,
  isDragModeActive: false,
  isMapPickingActive: false,
  mapPickMarker: null,
  tempFormImages: [], // array of base64 compressed dataUrls
  currentFilter: 'all',
  currentSort: 'nearest',
  currentScreen: 'screen-map'
};

// Initialize Application
document.addEventListener('DOMContentLoaded', async () => {
  try {
    initTheme();
    initServiceWorker();
    checkStoragePersistence();
    initMap();
    setupEventListeners();
    await loadInitialData();
    updateTileStorageBadge();
    initLocationTracker();
  } catch (err) {
    console.error('Initialization error:', err);
    showToast('حدث خطأ أثناء تحميل التطبيق');
  }
});

// 1. Service Worker & Storage Persistence
function initServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      console.log('ServiceWorker registered:', reg.scope);
    }).catch((err) => {
      console.warn('ServiceWorker registration failed:', err);
    });
  }
}

async function checkStoragePersistence() {
  const label = document.getElementById('persist-status-label');
  const btn = document.getElementById('btn-request-persist');
  if (navigator.storage && navigator.storage.persisted) {
    const isPersisted = await navigator.storage.persisted();
    if (isPersisted) {
      if (label) label.textContent = '✅ التخزين الدائم مفعل (بياناتك محمية من مسح المتصفح)';
      if (btn) btn.style.display = 'none';
    } else {
      if (label) label.textContent = '⚠️ التخزين عادي (اضغط تفعيل الحماية لضمان عدم مسح البيانات)';
      if (btn) btn.style.display = 'block';
    }
  } else {
    if (label) label.textContent = 'معلومات الحماية غير مدعومة في هذا المتصفح';
    if (btn) btn.style.display = 'none';
  }
}

// 2. Leaflet Map Initialization
function initMap() {
  // Center on Tolga (Province of Biskra)
  const defaultCenter = [34.7214, 5.3812];
  const defaultZoom = 15;

  state.map = L.map('map', {
    center: defaultCenter,
    zoom: defaultZoom,
    zoomControl: false, // will position custom or clean
    maxZoom: 19,
    minZoom: 9
  });

  // Re-position zoom control to top-left
  L.control.zoom({ position: 'topleft' }).addTo(state.map);

  // Set default tile layer using offline IndexedDB layer
  setMapLayer('streets');

  // Initialize Marker Cluster Group
  state.clusterGroup = L.markerClusterGroup({
    showCoverageOnHover: false,
    maxClusterRadius: 40,
    spiderfyOnMaxZoom: true,
    iconCreateFunction: function (cluster) {
      const count = cluster.getChildCount();
      return L.divIcon({
        html: `<div style="background: #0d47a1; color: #fff; width: 38px; height: 38px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 800; border: 3px solid #fff; box-shadow: 0 3px 8px rgba(0,0,0,0.35); font-size: 13px;">${count}</div>`,
        className: 'custom-cluster-marker',
        iconSize: L.point(38, 38)
      });
    }
  });

  state.map.addLayer(state.clusterGroup);

  // Map Click Listener (for picking coordinates)
  state.map.on('click', (e) => {
    if (state.isMapPickingActive) {
      handleMapCoordinatePick(e.latlng);
    }
  });
}

function setMapLayer(layerKey) {
  if (state.activeLayer) {
    state.map.removeLayer(state.activeLayer);
  }

  const config = TILE_SERVERS[layerKey] || TILE_SERVERS.streets;
  state.activeLayerKey = layerKey;

  // Use offline-prioritized layer
  state.activeLayer = L.tileLayer.offlineIndexedDB(config.url, {
    layerKey: layerKey,
    maxZoom: config.maxZoom,
    attribution: config.attribution,
    crossOrigin: true
  });

  state.activeLayer.addTo(state.map);

  const layerBtn = document.getElementById('btn-toggle-layer');
  if (layerBtn) {
    layerBtn.title = layerKey === 'streets' ? 'التحويل إلى صور الأقمار الصناعية' : 'التحويل إلى خريطة الشوارع';
  }
}

// 3. Load Data & Demo initialization
async function loadInitialData() {
  let boxes = await window.telecomDB.getAllBoxes();

  // If brand new, populate with initial demo boxes
  if (!boxes || boxes.length === 0) {
    await window.telecomDB.importBoxes(INITIAL_DEMO_BOXES);
    boxes = await window.telecomDB.getAllBoxes();
  }

  state.boxes = boxes;
  renderMarkersOnMap();
  renderBoxesList();
  updateTotalCounts();
}

// 4. Render Markers with Permanent Box Code Badges
function renderMarkersOnMap() {
  if (!state.clusterGroup) return;
  state.clusterGroup.clearLayers();

  state.boxes.forEach((box) => {
    const marker = createBoxMarker(box);
    state.clusterGroup.addLayer(marker);
  });
}

function createBoxMarker(box) {
  let typeClass = 'pcp';
  if (box.type.includes('MSAN')) typeClass = 'msan';
  else if (box.type.includes('DP') || box.type.includes('طرفية')) typeClass = 'dp';
  else if (box.type.includes('فرعية') || box.type.includes('SR')) typeClass = 'other';

  // Custom icon with permanent name badge on top
  const iconHtml = `
    <div class="custom-pcp-marker">
      <div class="marker-label-badge">${escapeHtml(box.code)}</div>
      <div class="marker-pin-icon ${typeClass}">
        <span class="marker-pin-inner">⚡</span>
      </div>
    </div>
  `;

  const customIcon = L.divIcon({
    html: iconHtml,
    className: 'box-leaflet-icon',
    iconSize: [36, 36],
    iconAnchor: [18, 36],
    popupAnchor: [0, -36]
  });

  const marker = L.marker([box.lat, box.lng], {
    icon: customIcon,
    draggable: state.isDragModeActive && state.selectedBox && state.selectedBox.id === box.id
  });

  marker.boxData = box;

  marker.on('click', () => {
    openBoxDetailModal(box);
  });

  marker.on('dragend', async (e) => {
    const newPos = e.target.getLatLng();
    box.lat = Number(newPos.lat.toFixed(6));
    box.lng = Number(newPos.lng.toFixed(6));
    await window.telecomDB.saveBox(box);
    showToast(`تم تعديل موقع العلبة ${box.code} بنجاح`);
    updateBoxDetailModal(box);
    renderBoxesList();
  });

  return marker;
}

// 5. GPS & Location Tracking
function initLocationTracker() {
  if (!navigator.geolocation) {
    showToast('خاصية تحديد الموقع (GPS) غير مدعومة في جهازك');
    return;
  }

  // Initial single quick fetch
  navigator.geolocation.getCurrentPosition(
    (pos) => updateLocationMarker(pos),
    (err) => console.log('Location initial check:', err.message),
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
  );

  // Continuous watch
  navigator.geolocation.watchPosition(
    (pos) => updateLocationMarker(pos),
    (err) => console.log('Location watch:', err.message),
    { enableHighAccuracy: true, maximumAge: 5000 }
  );
}

function updateLocationMarker(position) {
  const lat = position.coords.latitude;
  const lng = position.coords.longitude;
  const accuracy = position.coords.accuracy;

  state.userLocation = { lat, lng, accuracy };

  if (!state.userLocationMarker) {
    const pulseIcon = L.divIcon({
      html: `
        <div style="position: relative; width: 22px; height: 22px;">
          <div style="position: absolute; inset: -8px; border-radius: 50%; background: rgba(30, 136, 229, 0.35); animation: popIn 1.5s infinite alternate;"></div>
          <div style="width: 22px; height: 22px; border-radius: 50%; background: #0284c7; border: 3px solid #ffffff; box-shadow: 0 2px 6px rgba(0,0,0,0.4);"></div>
        </div>
      `,
      className: 'user-gps-marker',
      iconSize: [22, 22],
      iconAnchor: [11, 11]
    });

    state.userLocationMarker = L.marker([lat, lng], { icon: pulseIcon, zIndexOffset: 1000 }).addTo(state.map);
    state.userAccuracyCircle = L.circle([lat, lng], {
      radius: accuracy,
      color: '#0284c7',
      fillColor: '#38bdf8',
      fillOpacity: 0.15,
      weight: 1
    }).addTo(state.map);
  } else {
    state.userLocationMarker.setLatLng([lat, lng]);
    state.userAccuracyCircle.setLatLng([lat, lng]);
    state.userAccuracyCircle.setRadius(accuracy);
  }

  // Update distance labels in details if open
  if (state.selectedBox) {
    updateDistanceInDetailModal(state.selectedBox);
  }

  // Update list view distances
  if (state.currentScreen === 'screen-boxes-list' && state.currentSort === 'nearest') {
    renderBoxesList();
  }
}

function locateUser() {
  if (!navigator.geolocation) {
    showToast('خاصية GPS غير مدعومة');
    return;
  }

  showToast('جاري تحديد موقعك بأعلى دقة GPS...');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      updateLocationMarker(pos);
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      state.map.flyTo([lat, lng], 17, { duration: 1 });
      showToast(`دقة الموقع: ${Math.round(pos.coords.accuracy)} متر`);
    },
    (err) => {
      let msg = 'تعذر الحصول على إشارة GPS';
      if (err.code === 1) msg = 'يرجى السماح بإذن الوصول إلى الموقع في إعدادات الهاتف';
      else if (err.code === 2) msg = 'إشارة GPS غير متوفرة حالياً، تأكد من تشغيل الموقع';
      else if (err.code === 3) msg = 'انتهت مهلة البحث عن إشارة GPS';
      showToast(msg);
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
}

// 6. Camera Capture & Image Compression
async function handleImageFile(file) {
  if (!file) return;

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        // Compress image: max dimension 1280px, quality 0.7 JPEG
        const MAX_DIM = 1280;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_DIM) {
            height = Math.round((height * MAX_DIM) / width);
            width = MAX_DIM;
          }
        } else {
          if (height > MAX_DIM) {
            width = Math.round((width * MAX_DIM) / height);
            height = MAX_DIM;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.7);
        resolve(compressedDataUrl);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function renderFormPhotosPreview() {
  const container = document.getElementById('photos-preview-container');
  if (!container) return;
  container.innerHTML = '';

  state.tempFormImages.forEach((imgData, idx) => {
    const div = document.createElement('div');
    div.className = 'photo-preview-item';
    div.innerHTML = `
      <img src="${imgData}" alt="صورة العلبة">
      <button type="button" class="photo-delete-btn" data-img-idx="${idx}" title="حذف الصورة">✕</button>
    `;
    div.querySelector('.photo-delete-btn').addEventListener('click', () => {
      state.tempFormImages.splice(idx, 1);
      renderFormPhotosPreview();
    });
    container.appendChild(div);
  });
}

// 7. Add / Edit Box Modal Flow
function openAddBoxModal(existingBox = null) {
  const modal = document.getElementById('modal-box-form');
  const title = document.getElementById('modal-box-title');
  const form = document.getElementById('form-save-box');

  form.reset();
  state.tempFormImages = [];

  if (existingBox) {
    title.textContent = 'تعديل بيانات العلبة: ' + existingBox.code;
    document.getElementById('box-form-id').value = existingBox.id;
    document.getElementById('box-code').value = existingBox.code;
    document.getElementById('box-type').value = existingBox.type;
    document.getElementById('box-capacity').value = existingBox.capacity || '';
    document.getElementById('box-notes').value = existingBox.notes || '';
    document.getElementById('box-lat').value = existingBox.lat;
    document.getElementById('box-lng').value = existingBox.lng;

    state.tempFormImages = existingBox.images ? [...existingBox.images] : [];
    updateFormGpsDisplay(existingBox.accuracy || 3, existingBox.lat, existingBox.lng);
  } else {
    title.textContent = 'تسجيل علبة توزيع جديدة';
    document.getElementById('box-form-id').value = '';
    // Auto-fetch high accuracy GPS
    fetchGpsForForm();
  }

  renderFormPhotosPreview();
  modal.classList.add('active');
}

function fetchGpsForForm() {
  const accEl = document.getElementById('form-gps-accuracy');
  const coordsEl = document.getElementById('form-gps-coords');
  if (accEl) accEl.textContent = 'جاري التقاط إحداثيات GPS بدقة عالية...';

  if (!navigator.geolocation) {
    if (accEl) accEl.textContent = 'GPS غير مدعوم، يرجى إدخال الإحداثيات يدوياً';
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = Number(pos.coords.latitude.toFixed(6));
      const lng = Number(pos.coords.longitude.toFixed(6));
      const acc = Math.round(pos.coords.accuracy);

      document.getElementById('box-lat').value = lat;
      document.getElementById('box-lng').value = lng;
      updateFormGpsDisplay(acc, lat, lng);
    },
    (err) => {
      if (accEl) accEl.textContent = 'تعذر الحصول على GPS (يرجى إدخال الإحداثيات أو اختيارها من الخريطة)';
      console.warn('GPS form error:', err.message);
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
}

function updateFormGpsDisplay(acc, lat, lng) {
  const accEl = document.getElementById('form-gps-accuracy');
  const coordsEl = document.getElementById('form-gps-coords');
  let accClass = 'ممتازة';
  if (acc > 15) accClass = 'متوسطة';
  if (acc > 30) accClass = 'ضعيفة (يفضل إعادة المحاولة)';

  if (accEl) accEl.textContent = `دقة GPS: ${acc} متر (${accClass})`;
  if (coordsEl) coordsEl.textContent = `خط العرض: ${lat} | خط الطول: ${lng}`;
}

// 8. Box Details Modal & Quick Actions
function openBoxDetailModal(box) {
  state.selectedBox = box;
  const modal = document.getElementById('modal-box-detail');

  document.getElementById('detail-box-code').textContent = box.code;
  document.getElementById('detail-box-type').textContent = box.type;
  document.getElementById('detail-coords-text').textContent = `${box.lat}, ${box.lng}`;
  document.getElementById('detail-accuracy-text').textContent = box.accuracy ? `${box.accuracy} متر` : 'غير محددة';
  document.getElementById('detail-capacity-text').textContent = box.capacity ? `${box.capacity} منفذ / زوج` : 'غير محددة';

  const notesEl = document.getElementById('detail-notes-text');
  const notesRow = document.getElementById('detail-notes-row');
  if (box.notes && box.notes.trim()) {
    notesEl.textContent = box.notes;
    notesRow.style.display = 'block';
  } else {
    notesRow.style.display = 'none';
  }

  updateDistanceInDetailModal(box);
  renderDetailGallery(box.images || []);
  renderSubscribersList(box.subscribers || []);

  // Reset drag button state
  state.isDragModeActive = false;
  updateDragButtonState();

  modal.classList.add('active');
}

function updateBoxDetailModal(box) {
  if (state.selectedBox && state.selectedBox.id === box.id) {
    document.getElementById('detail-coords-text').textContent = `${box.lat}, ${box.lng}`;
    updateDistanceInDetailModal(box);
  }
}

function updateDistanceInDetailModal(box) {
  const distanceEl = document.getElementById('detail-distance-text');
  if (state.userLocation) {
    const dist = calculateDistance(state.userLocation.lat, state.userLocation.lng, box.lat, box.lng);
    distanceEl.textContent = formatDistance(dist);
  } else {
    distanceEl.textContent = 'غير معروف (GPS غير متاح)';
  }
}

function renderDetailGallery(images) {
  const gallery = document.getElementById('detail-gallery-row');
  gallery.innerHTML = '';

  if (!images || images.length === 0) {
    gallery.style.display = 'none';
    return;
  }

  gallery.style.display = 'flex';
  images.forEach((imgData) => {
    const img = document.createElement('img');
    img.src = imgData;
    img.className = 'detail-img-thumb';
    img.alt = 'صورة العلبة الميدانية';
    img.addEventListener('click', () => openLightbox(imgData));
    gallery.appendChild(img);
  });
}

function openLightbox(imgSrc) {
  const overlay = document.getElementById('lightbox-overlay');
  const img = document.getElementById('lightbox-img');
  img.src = imgSrc;
  overlay.classList.add('active');
}

function updateDragButtonState() {
  const btn = document.getElementById('btn-action-toggle-drag');
  const label = document.getElementById('drag-action-label');
  if (state.isDragModeActive) {
    btn.style.background = '#fef3c7';
    btn.style.borderColor = '#f59e0b';
    label.textContent = 'السحب مفعل';
  } else {
    btn.style.background = '';
    btn.style.borderColor = '';
    label.textContent = 'تعديل بالسحب';
  }

  // Refresh markers on map to enable/disable draggable
  renderMarkersOnMap();
}

// 9. Subscribers Management
function renderSubscribersList(subscribers) {
  const countEl = document.getElementById('detail-subs-count');
  const listEl = document.getElementById('detail-subscribers-list');
  countEl.textContent = subscribers.length;
  listEl.innerHTML = '';

  if (subscribers.length === 0) {
    listEl.innerHTML = `
      <div style="text-align: center; padding: 14px; color: var(--text-muted); font-size: 13px; background: var(--bg); border-radius: var(--radius-sm);">
        لا يوجد مشتركون مسجلون في هذه العلبة بعد.
      </div>
    `;
    return;
  }

  subscribers.forEach((sub, idx) => {
    const card = document.createElement('div');
    card.className = 'subscriber-row-card';
    card.innerHTML = `
      <div style="flex: 1; min-width: 0;">
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <a href="tel:${sub.phone.replace(/\\s+/g, '')}" class="sub-phone-link">
            📞 ${escapeHtml(sub.phone)}
          </a>
          ${sub.port ? `<span class="res-badge">${escapeHtml(sub.port)}</span>` : ''}
        </div>
        <div style="font-size: 14px; font-weight: 700; color: var(--text-primary); margin-top: 2px;">
          ${escapeHtml(sub.name)}
        </div>
        ${sub.address ? `<div style="font-size: 12px; color: var(--text-secondary); margin-top: 1px;">📍 ${escapeHtml(sub.address)}</div>` : ''}
      </div>
      <div style="display: flex; gap: 4px;">
        <button class="btn btn-secondary btn-del-sub" data-sub-idx="${idx}" style="padding: 6px; font-size: 12px; color: var(--accent-red);" title="حذف المشترك">
          ✕
        </button>
      </div>
    `;

    card.querySelector('.btn-del-sub').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm(`هل أنت متأكد من حذف المشترك "${sub.name}" من هذه العلبة؟`)) {
        state.selectedBox.subscribers.splice(idx, 1);
        await window.telecomDB.saveBox(state.selectedBox);
        renderSubscribersList(state.selectedBox.subscribers);
        renderBoxesList();
        showToast('تم حذف المشترك');
      }
    });

    listEl.appendChild(card);
  });
}

function openAddSubscriberModal() {
  const modal = document.getElementById('modal-subscriber-form');
  const form = document.getElementById('form-save-subscriber');
  form.reset();
  modal.classList.add('active');
}

// 10. Instant Global Search (Real-time Filtering)
function handleGlobalSearch(query) {
  const dropdown = document.getElementById('search-dropdown');
  const clearBtn = document.getElementById('btn-clear-search');

  if (!query || query.trim().length === 0) {
    dropdown.innerHTML = '';
    dropdown.classList.remove('visible');
    clearBtn.style.display = 'none';
    return;
  }

  clearBtn.style.display = 'block';
  const cleanQuery = normalizeSearchString(query);

  const matchedBoxes = [];
  const matchedSubscribers = [];

  state.boxes.forEach((box) => {
    const codeMatch = normalizeSearchString(box.code).includes(cleanQuery);
    const typeMatch = normalizeSearchString(box.type).includes(cleanQuery);
    const notesMatch = box.notes && normalizeSearchString(box.notes).includes(cleanQuery);

    if (codeMatch || typeMatch || notesMatch) {
      matchedBoxes.push(box);
    }

    // Check subscribers
    if (box.subscribers && box.subscribers.length > 0) {
      box.subscribers.forEach((sub) => {
        const phoneClean = normalizeSearchString(sub.phone).replace(/\\s+/g, '');
        const queryPhone = cleanQuery.replace(/\\s+/g, '');
        const phoneMatch = phoneClean.includes(queryPhone);
        const nameMatch = normalizeSearchString(sub.name).includes(cleanQuery);
        const addrMatch = sub.address && normalizeSearchString(sub.address).includes(cleanQuery);

        if (phoneMatch || nameMatch || addrMatch) {
          matchedSubscribers.push({ box, sub });
        }
      });
    }
  });

  const totalResults = matchedBoxes.length + matchedSubscribers.length;

  if (totalResults === 0) {
    dropdown.innerHTML = `
      <div style="padding: 16px; text-align: center; color: var(--text-muted); font-size: 13px;">
        لا توجد نتائج مطابقة لـ "${escapeHtml(query)}"
      </div>
    `;
    dropdown.classList.add('visible');
    return;
  }

  dropdown.innerHTML = '';

  // Render Box Results
  matchedBoxes.forEach((box) => {
    const item = document.createElement('div');
    item.className = 'search-result-item';
    item.innerHTML = `
      <div class="res-icon box">📦</div>
      <div class="res-info">
        <div class="res-title">${escapeHtml(box.code)}</div>
        <div class="res-subtitle">${escapeHtml(box.type)} ${box.notes ? '• ' + escapeHtml(box.notes) : ''}</div>
      </div>
      <span class="res-badge">${box.subscribers ? box.subscribers.length : 0} مشترك</span>
    `;

    item.addEventListener('click', () => {
      dropdown.classList.remove('visible');
      flyToBoxAndOpen(box);
    });

    dropdown.appendChild(item);
  });

  // Render Subscriber Results
  matchedSubscribers.forEach(({ box, sub }) => {
    const item = document.createElement('div');
    item.className = 'search-result-item';
    item.innerHTML = `
      <div class="res-icon subscriber">👤</div>
      <div class="res-info">
        <div class="res-title">${escapeHtml(sub.name)} • ${escapeHtml(sub.phone)}</div>
        <div class="res-subtitle">متصل بالعلبة: <strong style="color: var(--primary);">${escapeHtml(box.code)}</strong> ${sub.port ? '(' + escapeHtml(sub.port) + ')' : ''}</div>
      </div>
      <span class="res-badge">مشترك</span>
    `;

    item.addEventListener('click', () => {
      dropdown.classList.remove('visible');
      flyToBoxAndOpen(box);
    });

    dropdown.appendChild(item);
  });

  dropdown.classList.add('visible');
}

function flyToBoxAndOpen(box) {
  switchScreen('screen-map');
  state.map.flyTo([box.lat, box.lng], 18, { duration: 1 });
  setTimeout(() => {
    openBoxDetailModal(box);
  }, 1100);
}

// 11. Screen 2: Boxes List View
function renderBoxesList() {
  const container = document.getElementById('boxes-cards-list');
  const countBadge = document.getElementById('boxes-total-count');
  if (!container) return;

  // Filter
  let filtered = state.boxes.filter((box) => {
    if (state.currentFilter === 'all') return true;
    if (state.currentFilter === 'other') {
      return !box.type.includes('PCP') && !box.type.includes('MSAN') && !box.type.includes('DP');
    }
    return box.type.includes(state.currentFilter);
  });

  // Sort
  if (state.currentSort === 'nearest' && state.userLocation) {
    filtered.sort((a, b) => {
      const distA = calculateDistance(state.userLocation.lat, state.userLocation.lng, a.lat, a.lng);
      const distB = calculateDistance(state.userLocation.lat, state.userLocation.lng, b.lat, b.lng);
      return distA - distB;
    });
  } else if (state.currentSort === 'newest') {
    filtered.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  } else if (state.currentSort === 'name') {
    filtered.sort((a, b) => a.code.localeCompare(b.code, 'ar'));
  }

  if (countBadge) countBadge.textContent = `${filtered.length} علبة`;
  container.innerHTML = '';

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 40px 20px; color: var(--text-muted);">
        <div style="font-size: 38px; margin-bottom: 8px;">📦</div>
        <div style="font-size: 15px; font-weight: 700;">لا توجد علب مطابقة في هذه الفئة</div>
      </div>
    `;
    return;
  }

  filtered.forEach((box) => {
    let thumbHtml = '📦';
    if (box.images && box.images.length > 0) {
      thumbHtml = `<img src="${box.images[0]}" alt="صورة ${escapeHtml(box.code)}">`;
    }

    let distanceText = '';
    if (state.userLocation) {
      const d = calculateDistance(state.userLocation.lat, state.userLocation.lng, box.lat, box.lng);
      distanceText = `<span class="distance-tag">📍 ${formatDistance(d)}</span>`;
    }

    const card = document.createElement('div');
    card.className = 'box-card';
    card.innerHTML = `
      <div class="box-thumb">${thumbHtml}</div>
      <div class="box-card-content">
        <div>
          <div class="box-card-title-row">
            <span class="box-code">${escapeHtml(box.code)}</span>
            <span class="box-type-badge">${escapeHtml(box.type)}</span>
          </div>
          <div class="box-notes">${escapeHtml(box.notes || 'لا توجد ملاحظات مسجلة')}</div>
        </div>
        <div class="box-meta-row">
          <span>👥 ${box.subscribers ? box.subscribers.length : 0} مشترك</span>
          ${distanceText}
        </div>
      </div>
    `;

    card.addEventListener('click', () => {
      flyToBoxAndOpen(box);
    });

    container.appendChild(card);
  });
}

// 12. Backup, Restore, CSV & KML
function exportFullJson() {
  const exportData = {
    appName: 'PCP Algérie Télécom - Biskra',
    version: '1.0',
    exportDate: new Date().toISOString(),
    boxesCount: state.boxes.length,
    boxes: state.boxes
  };

  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const filename = `pcp_biskra_backup_${formatDateForFilename(new Date())}.json`;
  downloadBlob(blob, filename);
  showToast('تم تصدير النسخة الاحتياطية بنجاح');
}

async function handleImportJson(file) {
  if (!file) return;

  try {
    const text = await file.text();
    const data = JSON.parse(text);

    let boxesToImport = [];
    if (Array.isArray(data)) {
      boxesToImport = data;
    } else if (data.boxes && Array.isArray(data.boxes)) {
      boxesToImport = data.boxes;
    } else {
      showToast('صيغة الملف غير صالحة');
      return;
    }

    const confirmed = confirm(`تم العثور على ${boxesToImport.length} علبة في الملف. هل تريد استيرادها ودمجها مع بياناتك الحالية؟`);
    if (!confirmed) return;

    const count = await window.telecomDB.importBoxes(boxesToImport, false);
    state.boxes = await window.telecomDB.getAllBoxes();
    renderMarkersOnMap();
    renderBoxesList();
    updateTotalCounts();
    showToast(`تم استيراد ${count} علبة بنجاح!`);
  } catch (err) {
    console.error('Import error:', err);
    showToast('حدث خطأ أثناء قراءة ملف النسخة الاحتياطية');
  }
}

function exportCsv() {
  let csv = '\\uFEFF'; // UTF-8 BOM for Excel Arabic support
  csv += 'رمز العلبة,نوع العلبة,خط العرض,خط الطول,دقة الإحداثيات (متر),السعة,عدد المشتركين,الملاحظات,تاريخ التسجيل\\n';

  state.boxes.forEach((b) => {
    const row = [
      `"${(b.code || '').replace(/"/g, '""')}"`,
      `"${(b.type || '').replace(/"/g, '""')}"`,
      b.lat,
      b.lng,
      b.accuracy || '',
      b.capacity || '',
      b.subscribers ? b.subscribers.length : 0,
      `"${(b.notes || '').replace(/"/g, '""')}"`,
      `"${b.createdAt || ''}"`
    ];
    csv += row.join(',') + '\\n';
  });

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const filename = `pcp_boxes_biskra_${formatDateForFilename(new Date())}.csv`;
  downloadBlob(blob, filename);
  showToast('تم تصدير ملف CSV بنجاح');
}

function exportKml() {
  let kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>علب اتصالات الجزائر - ولاية بسكرة وطولقة</name>
    <description>تصدير علب التوزيع الميداني PCP</description>
`;

  state.boxes.forEach((b) => {
    let subsHtml = '';
    if (b.subscribers && b.subscribers.length > 0) {
      subsHtml = '<b>المشتركون:</b><br/>' + b.subscribers.map(s => `${s.name} (${s.phone})`).join('<br/>');
    }

    kml += `
    <Placemark>
      <name>${escapeXml(b.code)}</name>
      <description><![CDATA[
        <b>النوع:</b> ${escapeXml(b.type)}<br/>
        <b>السعة:</b> ${b.capacity || '--'}<br/>
        <b>الملاحظات:</b> ${escapeXml(b.notes || 'لا يوجد')}<br/>
        ${subsHtml}
      ]]></description>
      <Point>
        <coordinates>${b.lng},${b.lat},0</coordinates>
      </Point>
    </Placemark>
`;
  });

  kml += `  </Document>
</kml>`;

  const blob = new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' });
  const filename = `pcp_boxes_biskra_${formatDateForFilename(new Date())}.kml`;
  downloadBlob(blob, filename);
  showToast('تم تصدير ملف KML (Google Earth) بنجاح');
}

// 13. Offline Tile Download Management
async function updateTileStorageBadge() {
  const stats = await window.tileDownloader.getStorageStats();
  const badge = document.getElementById('tiles-badge');
  const modalCount = document.getElementById('modal-tiles-count');
  const modalSize = document.getElementById('modal-tiles-size');
  const settingsSize = document.getElementById('settings-tiles-size');

  const textCount = `${stats.totalCount} بلاطة`;
  const textSize = `${stats.approxMB} ميغابايت`;

  if (badge) badge.textContent = `(${stats.totalCount} بلاطة)`;
  if (modalCount) modalCount.textContent = textCount;
  if (modalSize) modalSize.textContent = textSize;
  if (settingsSize) settingsSize.textContent = textSize;
}

function startOfflineTileDownload() {
  const selectedRegion = document.querySelector('input[name="tile-region-pack"]:checked').value;
  const selectedLayer = document.getElementById('select-tile-layer-type').value;

  const progressBox = document.getElementById('tile-download-progress-box');
  const fill = document.getElementById('tile-progress-fill');
  const percentText = document.getElementById('tile-progress-percent');
  const countsText = document.getElementById('tile-progress-counts');
  const errorsText = document.getElementById('tile-progress-errors');
  const startBtn = document.getElementById('btn-start-tile-download');
  const cancelBtn = document.getElementById('btn-cancel-tile-download');

  progressBox.style.display = 'block';
  startBtn.style.display = 'none';
  cancelBtn.style.display = 'block';

  window.tileDownloader.startDownload(
    selectedLayer,
    selectedRegion,
    // onProgress
    (p) => {
      fill.style.width = `${p.percent}%`;
      percentText.textContent = `${p.percent}%`;
      countsText.textContent = `${p.downloaded} / ${p.total} بلاطة (تم التخطي: ${p.skipped})`;
      if (p.errors > 0) {
        errorsText.textContent = `أخطاء شبكة: ${p.errors}`;
      }
    },
    // onComplete
    (res) => {
      startBtn.style.display = 'block';
      cancelBtn.style.display = 'none';
      updateTileStorageBadge();

      if (res.cancelled) {
        showToast('تم إيقاف التحميل');
      } else {
        fill.style.width = '100%';
        percentText.textContent = '100%';
        showToast('اكتمل تحميل الخريطة الأوفلاين بنجاح!');
      }
    },
    // onError
    (err) => {
      startBtn.style.display = 'block';
      cancelBtn.style.display = 'none';
      showToast('خطأ أثناء تحميل الخريطة: ' + err.message);
    }
  );
}

// 14. Event Listeners & Modal Controls
function setupEventListeners() {
  // Navigation Tabs
  document.querySelectorAll('.nav-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const targetId = tab.getAttribute('data-target');
      switchScreen(targetId);
    });
  });

  // Filter Chips in List Screen
  document.querySelectorAll('.chip-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.chip-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.currentFilter = btn.getAttribute('data-filter');
      renderBoxesList();
    });
  });

  // Sort Select in List Screen
  const sortSelect = document.getElementById('boxes-sort-select');
  if (sortSelect) {
    sortSelect.addEventListener('change', (e) => {
      state.currentSort = e.target.value;
      renderBoxesList();
    });
  }

  // Global Search Input
  const searchInput = document.getElementById('global-search-input');
  searchInput.addEventListener('input', (e) => {
    handleGlobalSearch(e.target.value);
  });

  document.getElementById('btn-clear-search').addEventListener('click', () => {
    searchInput.value = '';
    handleGlobalSearch('');
  });

  // Map Controls
  document.getElementById('btn-toggle-layer').addEventListener('click', () => {
    const nextLayer = state.activeLayerKey === 'streets' ? 'satellite' : 'streets';
    setMapLayer(nextLayer);
    showToast(nextLayer === 'streets' ? 'تم التبديل إلى خريطة الشوارع' : 'تم التبديل إلى صور الأقمار الصناعية');
  });

  document.getElementById('btn-locate-me').addEventListener('click', () => {
    locateUser();
  });

  document.getElementById('btn-main-add-box').addEventListener('click', () => {
    openAddBoxModal();
  });

  document.getElementById('network-status-pill').addEventListener('click', () => {
    openModal('modal-offline-manager');
  });

  document.getElementById('btn-open-offline-manager').addEventListener('click', () => {
    openModal('modal-offline-manager');
  });

  document.getElementById('btn-open-tile-modal').addEventListener('click', () => {
    openModal('modal-offline-manager');
  });

  document.getElementById('btn-open-pwa-guide').addEventListener('click', () => {
    openModal('modal-pwa-guide');
  });

  // Form: Camera & Gallery Files
  const cameraInput = document.getElementById('input-camera-file');
  cameraInput.addEventListener('change', async (e) => {
    if (e.target.files && e.target.files[0]) {
      const compressed = await handleImageFile(e.target.files[0]);
      if (compressed) {
        state.tempFormImages.push(compressed);
        renderFormPhotosPreview();
      }
    }
  });

  const galleryInput = document.getElementById('input-gallery-file');
  galleryInput.addEventListener('change', async (e) => {
    if (e.target.files) {
      for (let i = 0; i < e.target.files.length; i++) {
        const compressed = await handleImageFile(e.target.files[i]);
        if (compressed) state.tempFormImages.push(compressed);
      }
      renderFormPhotosPreview();
    }
  });

  document.getElementById('btn-refresh-form-gps').addEventListener('click', () => {
    fetchGpsForForm();
  });

  document.getElementById('btn-pick-from-map').addEventListener('click', () => {
    closeModal('modal-box-form');
    showToast('انقر على أي نقطة في الخريطة لتحديد موقع العلبة');
    state.isMapPickingActive = true;
  });

  // Box Form Submit
  document.getElementById('form-save-box').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('box-form-id').value;
    const code = document.getElementById('box-code').value.trim();
    const type = document.getElementById('box-type').value;
    const capacity = parseInt(document.getElementById('box-capacity').value, 10) || null;
    const notes = document.getElementById('box-notes').value.trim();
    const lat = parseFloat(document.getElementById('box-lat').value);
    const lng = parseFloat(document.getElementById('box-lng').value);

    if (!code) {
      showToast('يرجى إدخال اسم أو رمز العلبة');
      return;
    }

    if (isNaN(lat) || isNaN(lng)) {
      showToast('الإحداثيات غير صحيحة، يرجى التحديد أو جلب GPS');
      return;
    }

    let boxObj = id ? state.boxes.find(b => b.id === id) : null;
    if (!boxObj) {
      boxObj = {
        id: 'pcp_' + Date.now(),
        subscribers: [],
        createdAt: new Date().toISOString()
      };
    }

    boxObj.code = code;
    boxObj.type = type;
    boxObj.capacity = capacity;
    boxObj.notes = notes;
    boxObj.lat = Number(lat.toFixed(6));
    boxObj.lng = Number(lng.toFixed(6));
    boxObj.accuracy = state.userLocation ? Math.round(state.userLocation.accuracy) : 3;
    boxObj.images = [...state.tempFormImages];

    await window.telecomDB.saveBox(boxObj);
    state.boxes = await window.telecomDB.getAllBoxes();

    closeModal('modal-box-form');
    renderMarkersOnMap();
    renderBoxesList();
    updateTotalCounts();
    showToast(`تم حفظ العلبة "${code}" بنجاح!`);

    flyToBoxAndOpen(boxObj);
  });

  // Box Details Quick Actions
  document.getElementById('btn-action-navigate').addEventListener('click', () => {
    if (!state.selectedBox) return;
    const url = `https://www.google.com/maps/dir/?api=1&destination=${state.selectedBox.lat},${state.selectedBox.lng}`;
    window.open(url, '_blank');
  });

  document.getElementById('btn-action-copy-coords').addEventListener('click', () => {
    if (!state.selectedBox) return;
    const coords = `${state.selectedBox.lat}, ${state.selectedBox.lng}`;
    navigator.clipboard.writeText(coords).then(() => {
      showToast('تم نسخ الإحداثيات إلى الحافظة: ' + coords);
    }).catch(() => {
      prompt('الإحداثيات:', coords);
    });
  });

  document.getElementById('btn-action-share').addEventListener('click', () => {
    if (!state.selectedBox) return;
    const b = state.selectedBox;
    const shareText = `علبة اتصالات الجزائر: ${b.code}\\nالنوع: ${b.type}\\nالموقع: https://maps.google.com/?q=${b.lat},${b.lng}\\nالمشتركون: ${b.subscribers ? b.subscribers.length : 0}`;

    if (navigator.share) {
      navigator.share({
        title: `علبة ${b.code}`,
        text: shareText
      }).catch(() => {});
    } else {
      navigator.clipboard.writeText(shareText);
      showToast('تم نسخ معلومات العلبة لمشاركتها');
    }
  });

  document.getElementById('btn-action-toggle-drag').addEventListener('click', () => {
    state.isDragModeActive = !state.isDragModeActive;
    updateDragButtonState();
    if (state.isDragModeActive) {
      showToast('يمكنك الآن سحب العلامة على الخريطة لتصحيح موقعها بدقة');
      closeModal('modal-box-detail');
    }
  });

  document.getElementById('btn-edit-box-trigger').addEventListener('click', () => {
    if (!state.selectedBox) return;
    closeModal('modal-box-detail');
    openAddBoxModal(state.selectedBox);
  });

  document.getElementById('btn-delete-box-trigger').addEventListener('click', async () => {
    if (!state.selectedBox) return;
    if (confirm(`هل أنت متأكد من حذف العلبة "${state.selectedBox.code}" وجميع مشتركيها نهائياً؟`)) {
      await window.telecomDB.deleteBox(state.selectedBox.id);
      state.boxes = await window.telecomDB.getAllBoxes();
      closeModal('modal-box-detail');
      renderMarkersOnMap();
      renderBoxesList();
      updateTotalCounts();
      showToast('تم حذف العلبة');
    }
  });

  // Subscribers
  document.getElementById('btn-open-add-subscriber').addEventListener('click', () => {
    openAddSubscriberModal();
  });

  document.getElementById('form-save-subscriber').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.selectedBox) return;

    const phone = document.getElementById('sub-phone').value.trim();
    const name = document.getElementById('sub-name').value.trim();
    const address = document.getElementById('sub-address').value.trim();
    const port = document.getElementById('sub-port').value.trim();

    if (!phone || !name) {
      showToast('يرجى إدخال الهاتف والاسم');
      return;
    }

    const newSub = {
      id: 'sub_' + Date.now(),
      phone,
      name,
      address,
      port,
      status: 'نشط'
    };

    if (!state.selectedBox.subscribers) state.selectedBox.subscribers = [];
    state.selectedBox.subscribers.push(newSub);

    await window.telecomDB.saveBox(state.selectedBox);
    state.boxes = await window.telecomDB.getAllBoxes();

    closeModal('modal-subscriber-form');
    renderSubscribersList(state.selectedBox.subscribers);
    renderBoxesList();
    showToast(`تمت إضافة المشترك "${name}" للعلبة`);
  });

  // Storage Persistence Request
  document.getElementById('btn-request-persist').addEventListener('click', async () => {
    if (navigator.storage && navigator.storage.persist) {
      const granted = await navigator.storage.persist();
      if (granted) {
        showToast('تم تفعيل حماية البيانات الدائمة بنجاح!');
      } else {
        showToast('تعذر تفعيل الحماية الدائمة (يعتمد على إعدادات المتصفح)');
      }
      checkStoragePersistence();
    }
  });

  // Backup & Restore
  document.getElementById('btn-export-json').addEventListener('click', () => exportFullJson());
  document.getElementById('btn-export-csv').addEventListener('click', () => exportCsv());
  document.getElementById('btn-export-kml').addEventListener('click', () => exportKml());

  document.getElementById('btn-import-json-trigger').addEventListener('click', () => {
    document.getElementById('file-import-json').click();
  });

  document.getElementById('file-import-json').addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      handleImportJson(e.target.files[0]);
    }
  });

  // Offline Tiles
  document.getElementById('btn-start-tile-download').addEventListener('click', () => {
    startOfflineTileDownload();
  });

  document.getElementById('btn-cancel-tile-download').addEventListener('click', () => {
    window.tileDownloader.cancelDownload();
  });

  document.getElementById('btn-clear-tile-cache').addEventListener('click', async () => {
    if (confirm('هل أنت متأكد من مسح جميع بلاطات الخرائط المحفوظة في الهاتف؟')) {
      await window.telecomDB.clearTiles();
      updateTileStorageBadge();
      showToast('تم مسح الخريطة المحفوظة بنجاح');
    }
  });

  // Close modals
  document.querySelectorAll('[data-close]').forEach((el) => {
    el.addEventListener('click', () => {
      const modalId = el.getAttribute('data-close');
      closeModal(modalId);
    });
  });

  document.getElementById('btn-close-lightbox').addEventListener('click', () => {
    document.getElementById('lightbox-overlay').classList.remove('active');
  });

  // Dark Mode Toggle
  document.getElementById('btn-toggle-dark-mode').addEventListener('click', () => {
    toggleTheme();
  });
}

// 15. Map Coordinate Pick Handler
function handleMapCoordinatePick(latlng) {
  state.isMapPickingActive = false;
  openAddBoxModal();
  document.getElementById('box-lat').value = Number(latlng.lat.toFixed(6));
  document.getElementById('box-lng').value = Number(latlng.lng.toFixed(6));
  updateFormGpsDisplay(3, latlng.lat.toFixed(6), latlng.lng.toFixed(6));
  showToast('تم تعيين إحداثيات الموقع المختار');
}

// 16. Screen Switching
function switchScreen(screenId) {
  state.currentScreen = screenId;

  // Tabs UI
  document.querySelectorAll('.nav-tab').forEach((tab) => {
    if (tab.getAttribute('data-target') === screenId) {
      tab.classList.add('active');
    } else {
      tab.classList.remove('active');
    }
  });

  // Screens UI
  document.querySelectorAll('.sub-screen').forEach((scr) => {
    scr.classList.remove('active');
  });

  if (screenId === 'screen-map') {
    // Re-invalidate map size
    setTimeout(() => {
      if (state.map) state.map.invalidateSize();
    }, 100);
  } else {
    const scr = document.getElementById(screenId);
    if (scr) scr.classList.add('active');
    if (screenId === 'screen-boxes-list') {
      renderBoxesList();
    }
  }
}

// 17. Utilities
function openModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.add('active');
}

function closeModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.remove('active');
}

function updateTotalCounts() {
  const countBadge = document.getElementById('boxes-total-count');
  if (countBadge) countBadge.textContent = `${state.boxes.length} علبة`;
}

function showToast(message) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 2600);
}

// Haversine Distance in meters
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // metres
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
            Math.cos(phi1) * Math.cos(phi2) *
            Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

function formatDistance(meters) {
  if (meters < 1000) {
    return `${Math.round(meters)} متر`;
  }
  return `${(meters / 1000).toFixed(1)} كم`;
}

function normalizeSearchString(str) {
  if (!str) return '';
  return str
    .toString()
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[\\u064B-\\u065F]/g, '') // remove arabic tashkeel
    .trim();
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function formatDateForFilename(d) {
  return d.toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeXml(str) {
  return escapeHtml(str);
}

function initTheme() {
  const saved = localStorage.getItem('pcp_theme');
  if (saved === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
    const btn = document.getElementById('btn-toggle-dark-mode');
    if (btn) btn.textContent = 'تفعيل الوضع النهاري';
  }
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const btn = document.getElementById('btn-toggle-dark-mode');
  if (current === 'dark') {
    document.documentElement.removeAttribute('data-theme');
    localStorage.setItem('pcp_theme', 'light');
    if (btn) btn.textContent = 'تفعيل الوضع الداكن';
  } else {
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.setItem('pcp_theme', 'dark');
    if (btn) btn.textContent = 'تفعيل الوضع النهاري';
  }
}
