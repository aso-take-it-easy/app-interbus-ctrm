const ROUTE_BOUNDS = L.latLngBounds([39.55, -4.64], [41.18, -2.72]);
const PLAZA_CASTILLA = [40.4666328, -3.6904891];
const MADRID_CENTER = [40.4168, -3.7038];
const INITIAL_ZOOM = 14;
const LOCATION_ZOOM = 12;
const LOCATION_COORDINATE_PRECISION = 2;
const ROUTE_MIN_ZOOM = 8;
const ZOOM_STEP = 0.2;
const REFRESH_INTERVAL = 15000;
const map = L.map("map", {
  zoomControl: false,
  scrollWheelZoom: true,
  zoomSnap: ZOOM_STEP,
  zoomDelta: ZOOM_STEP,
  minZoom: ROUTE_MIN_ZOOM,
  maxBounds: ROUTE_BOUNDS,
  maxBoundsViscosity: 1,
});

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  bounds: ROUTE_BOUNDS,
  maxZoom: 19,
  updateWhenIdle: true,
  updateWhenZooming: false,
  keepBuffer: 0,
  detectRetina: false,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);
map.setView(PLAZA_CASTILLA, INITIAL_ZOOM);
const centerMapButton = document.querySelector("#center-map");
const locateControl = L.control({ position: "bottomright" });
locateControl.onAdd = () => {
  const container = L.DomUtil.create("div", "leaflet-control leaflet-control-locate");
  container.append(centerMapButton);
  L.DomEvent.disableClickPropagation(container);
  L.DomEvent.disableScrollPropagation(container);
  return container;
};
locateControl.addTo(map);
L.control.zoom({ position: "bottomright" }).addTo(map);

const routeSearch = document.querySelector("#route-search");
const routeOptions = document.querySelector("#route-options");
const routePicker = document.querySelector(".route-picker");
const routeControls = document.querySelector("#route-controls");
const expertModeToggle = document.querySelector("#toggle-expert-mode");
const expertRouteFilter = document.querySelector("#expert-route-filter");
const expertFilterOptions = document.querySelector("#expert-filter-options");
const expertViewToggle = document.querySelector("#toggle-expert-view");
const serviceStatusDensityToggle = document.querySelector("#toggle-service-status-density");
const serviceBusDetailToggle = document.querySelector("#toggle-service-bus-detail");
const expertConfirmation = document.querySelector("#expert-confirmation");
const expertConfirmationForm = document.querySelector("#expert-confirmation-form");
const expertPassword = document.querySelector("#expert-password");
const expertPasswordError = document.querySelector("#expert-password-error");
const desktopViewport = window.matchMedia("(min-width: 761px)");
const favoriteStorageKey = "madrid-en-ruta-favorite-routes-v1";
const MAX_SELECTED_ROUTES = 3;
const routeColors = ["#116c52", "#4b6fb5", "#bd7430"];
const expertRouteColors = [
  "#116c52", "#4b6fb5", "#bd7430", "#7950a1", "#bd4966",
  "#35849a", "#718a2a", "#a45b33", "#4e6799", "#348060",
];
const selectedExpertGroups = new Set();
const expandedExpertBusRoutes = new Set();
const vehicleList = document.querySelector("#vehicle-list");
const vehicleCount = document.querySelector("#vehicle-count");
const statusDot = document.querySelector("#status-dot");
const statusLabel = document.querySelector("#status-label");
const updatedAt = document.querySelector("#updated-at");
const soundToggle = document.querySelector("#sound-toggle");
const notice = document.querySelector("#notice");
const routeSummary = document.querySelector("#route-summary");
const selectedRoutesContainer = document.querySelector("#selected-routes");
const sidebar = document.querySelector(".sidebar");
const sidebarToggle = document.querySelector("#toggle-sidebar");
const sidebarPositionToggle = document.querySelector("#toggle-sidebar-position");
const appShell = document.querySelector(".app-shell");
const mapPanel = document.querySelector(".map-panel");
const serviceStatusPanel = document.querySelector("#service-status-panel");
const serviceStatusSummary = document.querySelector("#service-status-summary");
const serviceStatusList = document.querySelector("#service-status-list");
const serviceStatusProgress = document.querySelector(".service-status-progress");
const serviceStatusProgressFill = document.querySelector(".service-status-progress-fill");
const routeLayer = L.layerGroup().addTo(map);
const stopLayer = L.layerGroup().addTo(map);
const vehicleLayer = L.layerGroup().addTo(map);
const vehicleMarkers = new Map();
const vehiclePositionHistory = new Map();
const vehicleMovementTimers = new Map();
const routesById = new Map();
let currentVehicles = [];
let favoriteRouteIds = new Set();
let activeRouteOption = -1;
let selectedRoutes = [];
let expertMode = false;
let expertInitialMapPositionSet = false;
let expertFilterInitialized = false;
let expertCompactStatus = false;
let expertBusDotDetail = false;
let expertRequestInProgress = false;
let expertRequestRouteIds = new Set();
let expertRouteStatuses = [];
let refreshTimer = null;
let refreshProgressTimer = null;
let refreshDeadline = null;
let refreshRequestId = 0;
let routeRequestId = 0;
let activeRefreshRequests = 0;
let pendingVehicleRefresh = false;
let audioContext = null;
let movementSoundEnabled = false;
const pollInterval = REFRESH_INTERVAL;
const expertPollInterval = 60000;
const EXPERT_ROUTE_CONCURRENCY = 4;
const VEHICLE_ANIMATION_DURATION = 1400;
const VEHICLE_ANIMATION_MAX_DISTANCE = 1000;

const busSvg = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 20V8a5 5 0 0 1 10 0v12H7Z" stroke="currentColor" stroke-width="1.8"/><path d="M8.5 8h7V7a3.5 3.5 0 0 0-7 0v1Zm0 4h1m5 0h1m-7 5h1m5 0h1m-7 3v1m8-1v1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="m10 4 2-2 2 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function setMobilePanelExpanded(expanded) {
  sidebar.classList.toggle("is-expanded", expanded);
  sidebarToggle.setAttribute("aria-expanded", String(expanded));
  sidebarToggle.setAttribute("aria-label", `${expanded ? "Ocultar" : "Mostrar"} panel de líneas`);
}

function showNotice(title, message) {
  if (expertMode) return;
  document.querySelector("#notice-title").textContent = title;
  document.querySelector("#notice-message").textContent = message;
  notice.hidden = false;
}

function setStatus(state, label) {
  statusDot.classList.remove("is-live", "is-error");
  if (state) statusDot.classList.add(`is-${state}`);
  statusLabel.textContent = label;
}

function getRouteHundredsGroup(route) {
  const lineNumber = Number.parseInt(route.id, 10);
  return Number.isFinite(lineNumber) ? Math.floor(lineNumber / 100) % 10 : 0;
}

function getHundredsGroupLabel(group) {
  return group === 0 ? "0–99" : `${group}00–${group}99`;
}

function getRouteColor(route) {
  if (expertMode) {
    return expertRouteColors[getRouteHundredsGroup(route)];
  }
  const routeIndex = selectedRoutes.findIndex((selected) => selected.id === route.id);
  return routeColors[routeIndex] || routeColors[0];
}

function getExpertSelectedRoutes() {
  return [...routesById.values()].filter((route) => selectedExpertGroups.has(getRouteHundredsGroup(route)));
}

function renderExpertRouteFilters() {
  const groupCounts = new Map();
  routesById.forEach((route) => {
    const group = getRouteHundredsGroup(route);
    groupCounts.set(group, (groupCounts.get(group) || 0) + 1);
  });
  expertFilterOptions.replaceChildren();
  [...groupCounts].sort(([left], [right]) => left - right).forEach(([group, count]) => {
    const label = document.createElement("label");
    label.className = "expert-filter-option";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = String(group);
    checkbox.checked = selectedExpertGroups.has(group);
    const color = document.createElement("i");
    color.className = "expert-filter-color";
    color.style.setProperty("--route-color", expertRouteColors[group]);
    const text = document.createElement("span");
    text.textContent = getHundredsGroupLabel(group);
    const total = document.createElement("small");
    total.textContent = String(count);
    label.append(checkbox, color, text, total);
    expertFilterOptions.append(label);
  });
  updateExpertFilterSummary();
}

function updateExpertFilterSummary() {
  const selectedRoutes = getExpertSelectedRoutes();
  const countLabel = document.querySelector("#expert-filter-count");
  if (countLabel) countLabel.textContent = `${selectedRoutes.length} líneas`;
  const groupCheckboxes = [...expertFilterOptions.querySelectorAll('input[type="checkbox"]')];
  const allSelected = groupCheckboxes.length > 0 && groupCheckboxes.every((checkbox) => checkbox.checked);
  const selectAllButton = document.querySelector("#select-all-expert-groups");
  selectAllButton.setAttribute("aria-pressed", String(allSelected));
  selectAllButton.setAttribute(
    "aria-label",
    allSelected ? "Quitar la selección de todas las centenas" : "Seleccionar todas las centenas",
  );
}

function refreshExpertGroupSelection() {
  if (!expertMode) return;
  clearRefreshTimers();
  refreshRequestId += 1;

  const selectedRouteIds = new Set(getExpertSelectedRoutes().map((route) => route.id));
  currentVehicles = currentVehicles.filter(({ route }) => selectedRouteIds.has(route.id));
  vehicleMarkers.forEach((record, key) => {
    if (selectedRouteIds.has(record.route.id)) return;
    if (record.animationFrame !== null) cancelAnimationFrame(record.animationFrame);
    if (record.movementTimeout !== null) clearTimeout(record.movementTimeout);
    vehicleLayer.removeLayer(record.marker);
    vehicleMarkers.delete(key);
  });
  renderVehicles(currentVehicles);
  renderServiceStatus(currentVehicles, expertRouteStatuses);
  renderExpertRoutes();

  if (!selectedRouteIds.size) {
    setStatus("", "Selecciona al menos una centena");
    updatedAt.textContent = "";
    return;
  }

  setStatus("", "Consultando posiciones de las líneas seleccionadas");
  refreshVehicles();
  setRefreshTimer();
}

function loadFavoriteRoutes() {
  try {
    const saved = JSON.parse(localStorage.getItem(favoriteStorageKey) || "[]");
    if (!Array.isArray(saved) || !saved.every((id) => typeof id === "string")) {
      throw new Error("El formato guardado no es válido.");
    }
    return new Set(saved);
  } catch (error) {
    showNotice("No se pudieron recuperar los favoritos", `El almacenamiento local no está disponible: ${error.message}`);
    return new Set();
  }
}

function persistFavoriteRoutes() {
  try {
    localStorage.setItem(favoriteStorageKey, JSON.stringify([...favoriteRouteIds]));
    return true;
  } catch (error) {
    showNotice("No se pudo guardar el favorito", `El almacenamiento local no está disponible: ${error.message}`);
    return false;
  }
}

function normalizeSearchText(value) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");
}

function renderSelectedRoutes() {
  selectedRoutesContainer.replaceChildren();
  routeSummary.hidden = !selectedRoutes.length;

  selectedRoutes.forEach((route, index) => {
    const chip = document.createElement("div");
    chip.className = "selected-route";
    chip.style.setProperty("--route-color", routeColors[index]);
    const number = document.createElement("span");
    number.className = "route-number";
    number.textContent = route.id;
    const info = document.createElement("span");
    info.className = "selected-route-info";
    const name = document.createElement("strong");
    name.textContent = route.name;
    const endpoints = document.createElement("span");
    endpoints.textContent = [route.origin, route.destination].filter(Boolean).join(" → ") || "Recorrido CRTM";
    info.append(name, endpoints);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-route";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Quitar línea ${route.id}`);
    remove.addEventListener("click", () => toggleRouteSelection(route));
    chip.append(number, info, remove);
    selectedRoutesContainer.append(chip);
  });

  routeSearch.placeholder = selectedRoutes.length >= MAX_SELECTED_ROUTES
    ? `Máximo de ${MAX_SELECTED_ROUTES} líneas seleccionadas`
    : "Buscar una línea…";
}

function toggleFavorite(route) {
  const nextFavorites = new Set(favoriteRouteIds);
  if (nextFavorites.has(route.id)) nextFavorites.delete(route.id);
  else nextFavorites.add(route.id);

  const previousFavorites = favoriteRouteIds;
  favoriteRouteIds = nextFavorites;
  if (!persistFavoriteRoutes()) {
    favoriteRouteIds = previousFavorites;
    return;
  }
  if (!routeOptions.hidden) renderRouteOptions();
}

function setRouteOptionsExpanded(expanded) {
  routeOptions.hidden = !expanded;
  routeSearch.setAttribute("aria-expanded", String(expanded));
  document.querySelector("#toggle-route-options").setAttribute("aria-expanded", String(expanded));
  if (!expanded) {
    activeRouteOption = -1;
    routeSearch.removeAttribute("aria-activedescendant");
  }
}

function renderRouteOptions() {
  const query = normalizeSearchText(routeSearch.value.trim());
  const matchingRoutes = [...routesById.values()].filter((route) =>
    normalizeSearchText(`${route.id} ${route.name}`).includes(query),
  );
  const favorites = matchingRoutes
    .filter((route) => favoriteRouteIds.has(route.id))
    .sort((a, b) => a.id.localeCompare(b.id, "es", { numeric: true }));
  const otherRoutes = matchingRoutes
    .filter((route) => !favoriteRouteIds.has(route.id))
    .sort((a, b) => a.id.localeCompare(b.id, "es", { numeric: true }));
  const visibleRoutes = [...favorites, ...otherRoutes];
  activeRouteOption = Math.min(activeRouteOption, visibleRoutes.length - 1);
  routeOptions.replaceChildren();

  function appendGroup(title, routes, firstIndex) {
    if (!routes.length) return;
    const group = document.createElement("div");
    group.className = "route-option-group";
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", title);
    const heading = document.createElement("div");
    heading.className = "route-option-heading";
    heading.textContent = title;
    group.append(heading);

    routes.forEach((route, index) => {
      const optionIndex = firstIndex + index;
      const row = document.createElement("div");
      row.className = "route-option-row";
      const option = document.createElement("button");
      option.type = "button";
      option.className = "route-option";
      option.id = `route-option-${optionIndex}`;
      option.setAttribute("role", "option");
      const isSelected = selectedRoutes.some((selected) => selected.id === route.id);
      const atLimit = selectedRoutes.length >= MAX_SELECTED_ROUTES;
      option.setAttribute("aria-selected", String(isSelected));
      option.setAttribute("aria-disabled", String(atLimit && !isSelected));
      option.textContent = `${isSelected ? "✓  " : ""}${route.id} · ${route.name}`;
      if (optionIndex === activeRouteOption) option.classList.add("is-active");
      option.addEventListener("click", () => toggleRouteSelection(route));

      const favorite = document.createElement("button");
      const isFavorite = favoriteRouteIds.has(route.id);
      favorite.type = "button";
      favorite.className = `favorite-button${isFavorite ? " is-favorite" : ""}`;
      favorite.textContent = isFavorite ? "★" : "☆";
      favorite.setAttribute("aria-pressed", String(isFavorite));
      favorite.setAttribute(
        "aria-label",
        isFavorite ? `Quitar línea ${route.id} de favoritas` : `Añadir línea ${route.id} a favoritas`,
      );
      favorite.title = favorite.getAttribute("aria-label");
      favorite.addEventListener("click", () => toggleFavorite(route));
      row.append(option, favorite);
      group.append(row);
    });
    routeOptions.append(group);
  }

  if (!visibleRoutes.length) {
    const empty = document.createElement("div");
    empty.className = "route-option-empty";
    empty.textContent = query ? "No hay líneas que coincidan con la búsqueda." : "No hay líneas disponibles.";
    routeOptions.append(empty);
    routeSearch.removeAttribute("aria-activedescendant");
    return;
  }

  appendGroup("Favoritas", favorites, 0);
  appendGroup(favorites.length ? "Todas las líneas" : "Líneas", otherRoutes, favorites.length);
  const activeOption = routeOptions.querySelector(`#route-option-${activeRouteOption}`);
  if (activeOption) {
    routeSearch.setAttribute("aria-activedescendant", activeOption.id);
    activeOption.scrollIntoView({ block: "nearest" });
  } else {
    routeSearch.removeAttribute("aria-activedescendant");
  }
}

function moveActiveRouteOption(direction) {
  const optionCount = routeOptions.querySelectorAll('[role="option"]').length;
  if (!optionCount) return;
  if (activeRouteOption < 0) activeRouteOption = direction > 0 ? 0 : optionCount - 1;
  else activeRouteOption = (activeRouteOption + direction + optionCount) % optionCount;
  renderRouteOptions();
}

async function getJson(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload.error || `Error HTTP ${response.status}`);
    error.code = payload.code;
    throw error;
  }
  return payload;
}

function normalizeRoutes(payload) {
  const routes = Array.isArray(payload) ? payload : payload.routes;
  if (!Array.isArray(routes)) throw new Error("La respuesta de líneas debe incluir un array «routes».");
  return routes.map((route) => {
    if (route.id === undefined || route.id === null || !route.name) {
      throw new Error("Cada línea debe incluir «id» y «name».");
    }
    return {
      id: String(route.id),
      name: String(route.name),
      origin: route.origin ? String(route.origin) : "",
      destination: route.destination ? String(route.destination) : "",
      geometry: null,
    };
  });
}

function normalizeVehicles(payload) {
  const vehicles = Array.isArray(payload) ? payload : payload.vehicles;
  if (!Array.isArray(vehicles)) throw new Error("La respuesta de posiciones debe incluir un array «vehicles».");
  return vehicles.map((vehicle) => {
    const lat = Number(vehicle.lat);
    const lng = Number(vehicle.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      throw new Error("Cada autobús debe incluir coordenadas válidas en «lat» y «lng».");
    }
    return {
      id: String(vehicle.id ?? `${lat},${lng}`),
      routeId: vehicle.routeId === undefined ? "" : String(vehicle.routeId),
      lat,
      lng,
      heading: vehicle.heading !== null && vehicle.heading !== undefined && vehicle.heading !== ""
        && Number.isFinite(Number(vehicle.heading)) ? Number(vehicle.heading) : null,
      direction: vehicle.direction !== null && vehicle.direction !== undefined
        && Number.isFinite(Number(vehicle.direction)) ? Number(vehicle.direction) : null,
      updatedAt: vehicle.updatedAt ? String(vehicle.updatedAt) : "",
    };
  });
}

function getVehicleHeading(vehicle, route) {
  if (Number.isFinite(vehicle.heading)) return vehicle.heading;
  const features = route.geometry?.features;
  if (!Number.isFinite(vehicle.direction) || !Array.isArray(features)) return null;

  let nearest = null;
  for (const feature of features) {
    if (Number(feature.properties?.SENTIDO) !== vehicle.direction) continue;
    const geometry = feature.geometry;
    const lines = geometry?.type === "LineString"
      ? [geometry.coordinates]
      : geometry?.type === "MultiLineString" ? geometry.coordinates : [];

    for (const line of lines) {
      for (let index = 1; index < line.length; index += 1) {
        const [startLng, startLat] = line[index - 1];
        const [endLng, endLat] = line[index];
        const latitudeRadians = ((startLat + endLat) / 2) * Math.PI / 180;
        const longitudeScale = Math.cos(latitudeRadians);
        const dx = (endLng - startLng) * longitudeScale;
        const dy = endLat - startLat;
        const lengthSquared = dx * dx + dy * dy;
        if (!lengthSquared) continue;

        const relativeX = (vehicle.lng - startLng) * longitudeScale;
        const relativeY = vehicle.lat - startLat;
        const fraction = Math.max(0, Math.min(1, (relativeX * dx + relativeY * dy) / lengthSquared));
        const distance = Math.hypot(relativeX - fraction * dx, relativeY - fraction * dy) * 111320;
        if (!nearest || distance < nearest.distance) {
          nearest = {
            distance,
            heading: (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360,
          };
        }
      }
    }
  }

  return nearest && nearest.distance <= 250 ? nearest.heading : null;
}

function renderRoutes() {
  routeLayer.clearLayers();
  stopLayer.clearLayers();
  const routeBounds = [];

  selectedRoutes.forEach((route, index) => {
    if (!route.geometry) return;
    const layer = L.geoJSON(route.geometry, {
      filter: (feature) => ["LineString", "MultiLineString"].includes(feature.geometry?.type),
      color: routeColors[index],
      weight: 5,
      opacity: 0.82,
      lineCap: "round",
      lineJoin: "round",
    }).addTo(routeLayer);
    if (layer.getLayers().length) {
      routeBounds.push(layer.getBounds());
    } else {
      showNotice("Recorrido no disponible", `El CRTM no ha devuelto un trazado GeoJSON para la línea ${route.id}.`);
    }

    L.geoJSON(route.geometry, {
      filter: (feature) => feature.properties?.featureType === "stop" && feature.geometry?.type === "Point",
      pointToLayer: (feature, latlng) => {
        const icon = L.divIcon({
          className: "stop-div-icon",
          html: `<span class="stop-marker" style="--route-color:${routeColors[index]}" aria-hidden="true"></span>`,
          iconSize: [12, 12],
          iconAnchor: [6, 6],
        });
        const marker = L.marker(latlng, { icon });
        const popup = document.createElement("div");
        const name = document.createElement("strong");
        name.className = "popup-title";
        name.textContent = feature.properties.name || "Parada de autobús";
        popup.append(name);
        const directions = feature.properties.directions;
        if (Array.isArray(directions) && directions.length) {
          const subtitle = document.createElement("div");
          subtitle.className = "popup-subtitle";
          subtitle.textContent = `Sentido${directions.length > 1 ? "s" : ""} ${directions.join(" y ")}`;
          popup.append(subtitle);
        }
        marker.bindPopup(popup);
        return marker;
      },
    }).addTo(stopLayer);
  });

  if (routeBounds.length) {
    const bounds = routeBounds.slice(1).reduce((combined, next) => combined.extend(next), routeBounds[0]);
    map.fitBounds(bounds, { padding: [55, 55], maxZoom: 14 });
  } else {
    map.setView(PLAZA_CASTILLA, INITIAL_ZOOM);
  }
}

function renderExpertRoutes() {
  routeLayer.clearLayers();
  const bounds = [];
  getExpertSelectedRoutes().forEach((route) => {
    if (!route.geometry) return;
    const layer = L.geoJSON(route.geometry, {
      filter: (feature) => ["LineString", "MultiLineString"].includes(feature.geometry?.type),
      style: {
        color: getRouteColor(route),
        weight: 1.2,
        opacity: 0.45,
        lineCap: "round",
        lineJoin: "round",
      },
    }).addTo(routeLayer);
    if (layer.getLayers().length) bounds.push(layer.getBounds());
  });

  if (bounds.length && !expertInitialMapPositionSet) {
    const allBounds = bounds.slice(1).reduce((combined, next) => combined.extend(next), bounds[0]);
    map.fitBounds(allBounds, { padding: [35, 35], maxZoom: 10 });
  }
}

async function loadExpertRouteGeometries(requestId) {
  const routes = [...routesById.values()].filter((route) => !route.geometry);
  let nextIndex = 0;
  let completed = 0;
  const failedRoutes = [];
  const workerCount = Math.min(EXPERT_ROUTE_CONCURRENCY, routes.length);

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < routes.length) {
      if (requestId !== routeRequestId || !expertMode) return;
      const index = nextIndex;
      nextIndex += 1;
      const route = routes[index];
      try {
        route.geometry = await getJson(`/api/routes/${encodeURIComponent(route.id)}?stops=false`);
      } catch (error) {
        failedRoutes.push(`${route.id}: ${error.message}`);
      } finally {
        completed += 1;
        if (requestId === routeRequestId && expertMode) {
          setStatus("", `Cargando recorridos ${completed}/${routes.length}`);
        }
      }
    }
  }));

  if (requestId !== routeRequestId || !expertMode) return [];
  renderExpertRoutes();
  return failedRoutes;
}

function relativeTime(value) {
  if (!value) return "Posición actualizada";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Posición actualizada";
  const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
  return minutes < 1 ? "Actualizado ahora" : `Actualizado hace ${minutes} min`;
}

function getCoordinateChangeTime(key) {
  const previous = vehiclePositionHistory.get(key);
  return previous?.changedAt || Date.now();
}

function updateVehiclePositionHistory(vehicles) {
  vehicles.forEach(({ vehicle, route }) => {
    const key = `${route.id}:${vehicle.id}`;
    const previous = vehiclePositionHistory.get(key);
    if (previous && previous.lat === vehicle.lat && previous.lng === vehicle.lng) return;

    const changedAt = Date.now();
    const moved = Boolean(previous);
    const movementUntil = moved ? changedAt + 10000 : 0;
    vehiclePositionHistory.set(key, { lat: vehicle.lat, lng: vehicle.lng, changedAt, movementUntil });
    if (!movementUntil) return;

    const existingTimer = vehicleMovementTimers.get(key);
    if (existingTimer) clearTimeout(existingTimer);
    vehicleMovementTimers.set(key, setTimeout(() => {
      vehicleMovementTimers.delete(key);
      const marker = vehicleMarkers.get(key)?.marker;
      marker?.getElement()?.querySelector(".bus-marker")?.classList.remove("is-coordinate-updated");
      if (expertMode && expertCompactStatus) renderServiceStatus(currentVehicles, expertRouteStatuses);
    }, movementUntil - Date.now()));
  });
}

function coordinateAge(changedAt) {
  const seconds = Math.max(0, Math.floor((Date.now() - changedAt) / 1000));
  if (seconds < 5) return "ahora";
  if (seconds < 60) return `hace ${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `hace ${hours} h`;
}

function createReceivingStatus(className) {
  const status = document.createElement("span");
  status.className = className;
  status.setAttribute("aria-label", "Recibiendo datos");
  const dot = document.createElement("i");
  dot.setAttribute("aria-hidden", "true");
  status.append(dot, document.createTextNode("Recibiendo"));
  return status;
}

function getVehicleDirectionLabel(vehicle, route) {
  if (!Number.isFinite(vehicle.direction)) return "Sentido no disponible";
  const features = route.geometry?.features;
  const terminal = Array.isArray(features)
    ? features
      .filter((feature) => Number(feature.properties?.SENTIDO) === vehicle.direction
        && feature.properties?.DENOMINACION_SAE
        && Number.isFinite(Number(feature.properties?.NUMEROORDEN)))
      .reduce((last, feature) => (
        !last || Number(feature.properties.NUMEROORDEN) > Number(last.properties.NUMEROORDEN)
          ? feature
          : last
      ), null)
    : null;
  const destination = terminal?.properties?.DENOMINACION_SAE;
  return destination
    ? `Sentido ${vehicle.direction} · ${destination}`
    : `Sentido ${vehicle.direction}`;
}

function animateVehicleMarker(record, target) {
  if (record.animationFrame !== null) cancelAnimationFrame(record.animationFrame);
  if (record.movementTimeout !== null) clearTimeout(record.movementTimeout);

  const marker = record.marker;
  const start = marker.getLatLng();
  const distance = map.distance(start, target);
  if (distance > VEHICLE_ANIMATION_MAX_DISTANCE) {
    marker.setLatLng(target);
  } else {
    const startedAt = performance.now();
    const animate = (now) => {
      const progress = Math.min((now - startedAt) / VEHICLE_ANIMATION_DURATION, 1);
      const easedProgress = 1 - (1 - progress) ** 3;
      marker.setLatLng([
        start.lat + (target.lat - start.lat) * easedProgress,
        start.lng + (target.lng - start.lng) * easedProgress,
      ]);
      if (progress < 1) record.animationFrame = requestAnimationFrame(animate);
      else record.animationFrame = null;
    };
    record.animationFrame = requestAnimationFrame(animate);
  }

  record.movementTimeout = setTimeout(() => {
    marker.getElement()?.querySelector(".bus-marker")?.classList.remove("is-moving");
    record.movementTimeout = null;
  }, VEHICLE_ANIMATION_DURATION);
}

function playMovementSound() {
  if (!movementSoundEnabled || !audioContext) return;
  try {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const now = audioContext.currentTime;
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(660, now);
    oscillator.frequency.exponentialRampToValueAtTime(880, now + 0.12);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.07, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.17);
  } catch (error) {
    movementSoundEnabled = false;
    soundToggle.setAttribute("aria-pressed", "false");
    soundToggle.textContent = "Activar sonido";
    showNotice("No se pudo reproducir el sonido", error.message);
  }
}

function renderVehicles(vehicles) {
  vehicleList.replaceChildren();
  vehicleList.setAttribute("aria-busy", "false");
  vehicleCount.textContent = String(vehicles.length);

  if (!vehicles.length) {
    vehicleMarkers.forEach(({ marker, animationFrame, movementTimeout }) => {
      if (animationFrame !== null) cancelAnimationFrame(animationFrame);
      if (movementTimeout !== null) clearTimeout(movementTimeout);
      vehicleLayer.removeLayer(marker);
    });
    vehicleMarkers.clear();
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = '<span class="empty-icon" aria-hidden="true">✓</span><p>No hay autobuses disponibles en las líneas seleccionadas ahora mismo.</p>';
    vehicleList.append(empty);
    return;
  }

  const visibleMarkerKeys = new Set();
  let movedVehicleCount = 0;
  vehicles.forEach(({ vehicle, route }) => {
    const heading = getVehicleHeading(vehicle, route);
    const routeColor = getRouteColor(route);
    const markerKey = `${route.id}:${vehicle.id}`;
    visibleMarkerKeys.add(markerKey);
    const coordinatesChangedAt = getCoordinateChangeTime(markerKey);
    let markerRecord = vehicleMarkers.get(markerKey);
    const positionChanged = markerRecord
      && (markerRecord.vehicle.lat !== vehicle.lat || markerRecord.vehicle.lng !== vehicle.lng);
    if (positionChanged) movedVehicleCount += 1;
    const vehicleColor = routeColor;
    const markerIconKey = `${vehicleColor}|line`;
    const coordinatesRecentlyUpdated = vehiclePositionHistory.get(markerKey)?.movementUntil > Date.now();
    const markerContent = document.createElement("span");
    markerContent.className = `bus-marker has-line-number${positionChanged ? " is-moving" : ""}${coordinatesRecentlyUpdated ? " is-coordinate-updated" : ""}`;
    markerContent.style.setProperty("--route-color", vehicleColor);
    markerContent.textContent = route.id;
    const markerIcon = L.divIcon({
      className: "bus-div-icon",
      html: markerContent,
      iconSize: [33, 33],
      iconAnchor: [16, 16],
    });
    if (markerRecord) {
      if (positionChanged || markerRecord.iconKey !== markerIconKey) {
        markerRecord.marker.setIcon(markerIcon);
        markerRecord.iconKey = markerIconKey;
      }
      markerRecord.vehicle = vehicle;
      markerRecord.route = route;
      if (positionChanged) animateVehicleMarker(markerRecord, L.latLng(vehicle.lat, vehicle.lng));
    } else {
      const marker = L.marker([vehicle.lat, vehicle.lng], { icon: markerIcon }).addTo(vehicleLayer);
      markerRecord = {
        marker,
        vehicle,
        route,
        iconKey: markerIconKey,
        animationFrame: null,
        movementTimeout: null,
      };
      vehicleMarkers.set(markerKey, markerRecord);
      marker.on("click", () => {
        setMobilePanelExpanded(false);
        map.flyTo(
          [markerRecord.vehicle.lat, markerRecord.vehicle.lng],
          Math.max(map.getZoom(), 15),
          { duration: 0.6 },
        );
      });
    }
    const { marker } = markerRecord;
    const popup = document.createElement("div");
    const popupTitle = document.createElement("div");
    popupTitle.className = "popup-title";
    popupTitle.textContent = `Línea ${route.id}`;
    const popupDetails = [route.name, getVehicleDirectionLabel(vehicle, route)];
    popup.append(popupTitle);
    for (const detail of popupDetails) {
      const subtitle = document.createElement("div");
      subtitle.className = "popup-subtitle";
      subtitle.textContent = detail;
      popup.append(subtitle);
    }
    popup.append(createReceivingStatus("service-bus-received"));
    const coordinateAgeLabel = document.createElement("div");
    coordinateAgeLabel.className = "popup-subtitle vehicle-coordinate-age";
    coordinateAgeLabel.textContent = `Actualizado hace: ${coordinateAge(coordinatesChangedAt)}`;
    popup.append(coordinateAgeLabel);
    marker.bindPopup(popup);

    const item = document.createElement("button");
    item.type = "button";
    item.className = "vehicle-card";
    item.setAttribute("aria-label", `Centrar mapa en la línea ${route.id}, ${getVehicleDirectionLabel(vehicle, route)}`);
    const icon = document.createElement("span");
    icon.className = "bus-icon";
    icon.style.setProperty("--route-color", vehicleColor);
    if (expertMode) {
      icon.classList.add("has-line-number");
      icon.textContent = route.id;
    } else {
      icon.innerHTML = busSvg;
      if (heading !== null) icon.style.setProperty("--bus-heading", `${heading}deg`);
    }
    const info = document.createElement("span");
    info.className = "vehicle-info";
    const name = document.createElement("strong");
    name.textContent = `Línea ${route.id} · ${route.name}`;
    const age = document.createElement("span");
    age.className = "vehicle-direction";
    age.textContent = getVehicleDirectionLabel(vehicle, route);
    const updated = document.createElement("span");
    updated.className = "vehicle-updated";
    updated.textContent = relativeTime(vehicle.updatedAt);
    info.append(name, age, updated);
    const arrow = document.createElement("span");
    arrow.className = "vehicle-age";
    arrow.textContent = "›";
    item.append(icon, info, arrow);
    item.addEventListener("click", () => {
      setMobilePanelExpanded(false);
      map.flyTo([vehicle.lat, vehicle.lng], Math.max(map.getZoom(), 15), { duration: 0.6 });
      marker.openPopup();
    });
    vehicleList.append(item);
  });

  vehicleMarkers.forEach((record, key) => {
    if (visibleMarkerKeys.has(key)) return;
    if (record.animationFrame !== null) cancelAnimationFrame(record.animationFrame);
    if (record.movementTimeout !== null) clearTimeout(record.movementTimeout);
    vehicleLayer.removeLayer(record.marker);
    vehicleMarkers.delete(key);
  });
  return movedVehicleCount;
}

function showVehiclesUnavailable(message) {
  vehicleLayer.clearLayers();
  vehicleMarkers.forEach(({ marker, animationFrame, movementTimeout }) => {
    if (animationFrame !== null) cancelAnimationFrame(animationFrame);
    if (movementTimeout !== null) clearTimeout(movementTimeout);
  });
  vehicleMarkers.clear();
  vehicleList.setAttribute("aria-busy", "false");
  vehicleCount.textContent = "—";
  const empty = document.createElement("div");
  empty.className = "empty-state";
  const icon = document.createElement("span");
  icon.className = "empty-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = "i";
  const text = document.createElement("p");
  text.textContent = message;
  empty.append(icon, text);
  vehicleList.replaceChildren(empty);
}

function summarizeFailures(failures) {
  const visibleFailures = failures.slice(0, 4);
  const remainingCount = failures.length - visibleFailures.length;
  if (remainingCount) visibleFailures.push(`${remainingCount} errores más.`);
  return visibleFailures.join(" · ");
}

function renderServiceStatus(vehicles, routeStatuses, unavailable = false) {
  const statusByRoute = new Map(routeStatuses.map((status) => [String(status.line), status]));
  const vehiclesByRoute = new Map();
  vehicles.forEach(({ vehicle, route }) => {
    const routeVehicles = vehiclesByRoute.get(route.id) || [];
    routeVehicles.push(vehicle);
    vehiclesByRoute.set(route.id, routeVehicles);
  });

  const statuses = (expertMode ? getExpertSelectedRoutes() : [...routesById.values()]).map((route) => ({
    route,
    status: statusByRoute.get(route.id),
    vehicles: vehiclesByRoute.get(route.id) || [],
  }));
  const onlineCount = statuses.filter(({ status }) => status?.status === "online").length;
  const errorCount = statuses.filter(({ status }) => status?.status === "error" || status?.status === "excluded").length;
  const pendingCount = statuses.length - onlineCount - errorCount;
  const summaryParts = [];
  if (onlineCount) summaryParts.push(`${onlineCount} operativas`);
  if (errorCount) summaryParts.push(`${errorCount} con incidencias`);
  if (pendingCount) summaryParts.push(`${pendingCount} pendientes`);
  serviceStatusSummary.textContent = unavailable
    ? "No se pudo consultar el estado de la red."
    : summaryParts.join(" · ") || "Esperando la primera consulta…";
  serviceStatusList.replaceChildren();
  serviceStatusList.classList.toggle("is-compact", expertMode && expertCompactStatus);

  if (expertMode && expertCompactStatus) {
    renderExpertDotStatus(statusByRoute, vehiclesByRoute);
    return;
  }

  statuses.forEach(({ route, status, vehicles: routeVehicles }) => {
    const state = status?.status || (unavailable ? "error" : "pending");
    const card = document.createElement("article");
    card.className = `service-line-card is-${state}`;

    const header = document.createElement("div");
    header.className = "service-line-header";
    const lineNumber = document.createElement("span");
    lineNumber.className = "service-line-number";
    lineNumber.style.setProperty("--route-color", getRouteColor(route));
    lineNumber.textContent = route.id;
    const routeInfo = document.createElement("div");
    routeInfo.className = "service-line-info";
    const title = document.createElement("h3");
    title.textContent = `Línea ${route.id}`;
    const name = document.createElement("p");
    name.textContent = route.name;
    routeInfo.append(title, name);
    const indicator = document.createElement("span");
    indicator.className = `service-status-indicator is-${state}`;
    const stateText = state === "online"
      ? (routeVehicles.length ? "Recibiendo datos" : "Servicio disponible · sin buses")
      : state === "error"
        ? "Error al recibir datos"
        : state === "excluded"
          ? "Pausada tras errores"
          : "Pendiente de consulta";
    indicator.setAttribute("aria-label", stateText);
    const indicatorDot = document.createElement("i");
    indicatorDot.setAttribute("aria-hidden", "true");
    const indicatorLabel = document.createElement("span");
    indicatorLabel.textContent = stateText;
    indicator.append(indicatorDot, indicatorLabel);
    header.append(lineNumber, routeInfo, indicator);
    card.append(header);

    if (state === "error" || state === "excluded") {
      const error = document.createElement("p");
      error.className = "service-line-error";
      const failures = status?.failures ? ` (${status.failures}/5 errores consecutivos)` : "";
      error.textContent = `${status?.error || "No se recibió respuesta del servicio."}${failures}`;
      card.append(error);
    }

    if (routeVehicles.length) {
      const busList = document.createElement("ul");
      busList.className = "service-bus-list";
      routeVehicles.forEach((vehicle) => {
        const bus = document.createElement("li");
        bus.className = "service-bus-row";
        const busNumber = document.createElement("span");
        busNumber.className = "service-bus-number";
        busNumber.style.setProperty("--route-color", getRouteColor(route));
        busNumber.textContent = route.id;
        const details = document.createElement("div");
        details.className = "service-bus-info";
        const direction = document.createElement("strong");
        direction.textContent = getVehicleDirectionLabel(vehicle, route);
        const coordinates = document.createElement("span");
        coordinates.textContent = `${vehicle.lat.toFixed(5)}, ${vehicle.lng.toFixed(5)}`;
        const coordinateAgeLabel = document.createElement("span");
        coordinateAgeLabel.className = "service-bus-coordinate-age";
        coordinateAgeLabel.textContent = `Actualizado hace: ${coordinateAge(
          getCoordinateChangeTime(`${route.id}:${vehicle.id}`),
        )}`;
        details.append(direction, coordinates, coordinateAgeLabel);
        const received = createReceivingStatus("service-bus-received");
        bus.append(busNumber, details, received);
        busList.append(bus);
      });
      card.append(busList);
    }
    serviceStatusList.append(card);
  });
}

function renderExpertDotStatus(statusByRoute, vehiclesByRoute) {
  const groups = new Map();
  [...routesById.values()].forEach((route) => {
    const group = getRouteHundredsGroup(route);
    const routes = groups.get(group) || [];
    routes.push(route);
    groups.set(group, routes);
  });

  [...groups].sort(([left], [right]) => left - right).forEach(([group, routes]) => {
    const groupSection = document.createElement("section");
    groupSection.className = "expert-dot-group";
    const heading = document.createElement("h3");
    heading.textContent = `${getHundredsGroupLabel(group)} · ${routes.length}`;
    const routeList = document.createElement("div");
    routeList.className = `expert-dot-route-list${expertBusDotDetail ? " is-bus-detail" : ""}`;
    routes.forEach((route) => {
      const selected = selectedExpertGroups.has(group);
      const status = statusByRoute.get(route.id);
      const routeVehicles = vehiclesByRoute.get(route.id) || [];
      const pending = selected && expertRequestInProgress && expertRequestRouteIds.has(route.id);
      const state = !selected
        ? "no-info"
        : status?.status === "excluded" || status?.status === "error"
          ? "error"
          : pending
            ? "loading"
            : status?.status === "online"
              ? "online"
              : "no-info";
      const dots = document.createElement("div");
      dots.className = "expert-dot-grid";
      const appendDot = (dotState, label, moving = false) => {
        const dot = document.createElement("span");
        dot.className = `expert-status-dot is-${dotState}${moving ? " is-moving" : ""}`;
        dot.title = label;
        dot.setAttribute("role", "img");
        dot.setAttribute("aria-label", label);
        dots.append(dot);
      };
      const stateLabel = state === "online"
        ? "OK"
        : state === "loading"
          ? "Petición en curso"
          : state === "error"
            ? `KO${status?.error ? `: ${status.error}` : ""}`
            : "Sin información";

      if (expertBusDotDetail && routeVehicles.length && state === "online") {
        routeVehicles.forEach((vehicle) => {
          const vehicleKey = `${route.id}:${vehicle.id}`;
          const history = vehiclePositionHistory.get(vehicleKey);
          const moving = Boolean(history?.movementUntil && history.movementUntil > Date.now());
          appendDot(
            "online",
            `Línea ${route.id} · Autobús ${vehicle.id} · ${moving ? "Coordenadas recién actualizadas" : "OK"}`,
            moving,
          );
        });
      } else if (expertBusDotDetail && routeVehicles.length && pending) {
        routeVehicles.forEach((vehicle) => {
          appendDot("loading", `Línea ${route.id} · Autobús ${vehicle.id} · Petición en curso`);
        });
      } else {
        const moving = state === "online" && routeVehicles.some((vehicle) => {
          const history = vehiclePositionHistory.get(`${route.id}:${vehicle.id}`);
          return history?.movementUntil > Date.now();
        });
        appendDot(state, `Línea ${route.id} · ${stateLabel}`, moving);
      }
      if (expertBusDotDetail) {
        const routeRow = document.createElement("div");
        routeRow.className = `expert-dot-route-row${expandedExpertBusRoutes.has(route.id) ? " is-open" : ""}`;
        const routeLabel = document.createElement("button");
        routeLabel.className = "expert-dot-route-label";
        routeLabel.type = "button";
        routeLabel.dataset.routeBuses = route.id;
        routeLabel.setAttribute("aria-expanded", String(expandedExpertBusRoutes.has(route.id)));
        routeLabel.setAttribute("aria-label", `Autobuses de la línea ${route.id}`);
        routeLabel.textContent = route.id;
        const busPopup = document.createElement("div");
        busPopup.className = "expert-dot-bus-popup";
        busPopup.setAttribute("role", "group");
        busPopup.setAttribute("aria-label", `Autobuses de la línea ${route.id}`);
        if (routeVehicles.length) {
          routeVehicles.forEach((vehicle) => {
            const bus = document.createElement("div");
            bus.className = "expert-dot-bus-popup-row";
            const history = vehiclePositionHistory.get(`${route.id}:${vehicle.id}`);
            const moving = Boolean(history?.movementUntil && history.movementUntil > Date.now());
            const busState = state === "loading"
              ? "Actualizando"
              : state === "error"
                ? status?.status === "excluded" ? "Consulta pausada" : "Error al consultar"
                : moving ? "Coordenadas actualizadas" : "Recibiendo datos";
            const statusDot = document.createElement("span");
            const statusClass = state === "loading" ? "is-loading" : state === "error" ? "is-error" : "";
            statusDot.className = `expert-dot-bus-popup-status${statusClass}`;
            statusDot.setAttribute("aria-hidden", "true");
            const details = document.createElement("span");
            details.className = "expert-dot-bus-popup-info";
            const registration = document.createElement("strong");
            registration.textContent = vehicle.id;
            const busDescription = document.createElement("span");
            busDescription.textContent = `${busState} · ${getVehicleDirectionLabel(vehicle, route)}`;
            details.append(registration, busDescription);
            bus.append(statusDot, details);
            busPopup.append(bus);
          });
        } else {
          const emptyMessage = document.createElement("p");
          emptyMessage.textContent = state === "loading"
            ? "Consultando autobuses…"
            : state === "error"
              ? status?.error || "No se pudo consultar esta línea."
              : "No hay autobuses disponibles.";
          busPopup.append(emptyMessage);
        }
        routeRow.append(routeLabel, dots, busPopup);
        routeList.append(routeRow);
      } else {
        routeList.append(dots);
      }
    });
    groupSection.append(heading, routeList);
    serviceStatusList.append(groupSection);
  });
}

function setExpertStatusView(showStatus) {
  const show = expertMode && showStatus;
  serviceStatusPanel.hidden = !show;
  mapPanel.hidden = show;
  serviceStatusDensityToggle.hidden = !show;
  serviceBusDetailToggle.hidden = !show || !expertCompactStatus;
  expertViewToggle.hidden = !expertMode;
  expertViewToggle.setAttribute("aria-pressed", String(show));
  expertViewToggle.textContent = show ? "Volver al mapa" : "Ver estado de las líneas";
  if (!show) requestAnimationFrame(() => map.invalidateSize());
}

function clearRefreshTimers() {
  if (refreshTimer) clearInterval(refreshTimer);
  if (refreshProgressTimer) clearInterval(refreshProgressTimer);
  refreshTimer = null;
  refreshProgressTimer = null;
  refreshDeadline = null;
}

function updateExpertRefreshProgress() {
  if (!refreshDeadline) return;
  const remainingMs = Math.max(0, refreshDeadline - Date.now());
  const progress = 1 - remainingMs / expertPollInterval;
  serviceStatusProgressFill.style.transform = `scaleX(${progress})`;
  serviceStatusProgress.setAttribute("aria-valuenow", String(Math.floor(progress * expertPollInterval / 1000)));
}

async function refreshVehicles() {
  if (activeRefreshRequests) {
    pendingVehicleRefresh = true;
    return;
  }
  const refreshIsExpert = expertMode;
  const routes = refreshIsExpert ? getExpertSelectedRoutes() : [...selectedRoutes];
  if (!routes.length) {
    if (refreshIsExpert) {
      expertRequestInProgress = false;
      expertRequestRouteIds.clear();
      currentVehicles = [];
      renderVehicles([]);
      renderServiceStatus([], expertRouteStatuses);
      setStatus("", "Selecciona al menos una centena");
      updatedAt.textContent = "";
    }
    return;
  }
  const requestId = ++refreshRequestId;
  if (!currentVehicles.length) {
    const loading = document.createElement("div");
    loading.className = "vehicle-loading";
    loading.setAttribute("role", "status");
    const spinner = document.createElement("span");
    spinner.className = "loading-spinner";
    spinner.setAttribute("aria-hidden", "true");
    const message = document.createElement("span");
    message.textContent = "Cargando autobuses disponibles…";
    loading.append(spinner, message);
    vehicleList.replaceChildren(loading);
    vehicleList.setAttribute("aria-busy", "true");
    vehicleCount.textContent = "…";
  }
  activeRefreshRequests += 1;
  statusDot.classList.add("is-refreshing");
  if (refreshIsExpert) {
    expertRequestInProgress = true;
    expertRequestRouteIds = new Set(routes.map((route) => route.id));
    renderServiceStatus(currentVehicles, expertRouteStatuses);
  }
  try {
    const vehicles = [];
    const failures = [];
    let fetchedExpertRouteStatuses = [];
    if (refreshIsExpert) {
      try {
        const groups = [...selectedExpertGroups].sort((left, right) => left - right);
        const payload = await getJson(`/api/vehicles?all=true&groups=${groups.join(",")}`);
        if (!Array.isArray(payload.routeStatuses)) {
          throw new Error("La respuesta de estado no incluye el estado de cada línea.");
        }
        fetchedExpertRouteStatuses = payload.routeStatuses;
        const selectedRouteIds = new Set(routes.map((route) => route.id));
        for (const vehicle of normalizeVehicles(payload)) {
          if (!selectedRouteIds.has(vehicle.routeId)) continue;
          const route = routesById.get(vehicle.routeId);
          if (!route) {
            failures.push(`Línea ${vehicle.routeId || "desconocida"}: la respuesta contiene una línea no cargada.`);
            continue;
          }
          vehicles.push({ vehicle, route });
        }
        if (payload.failedRouteCount) {
          failures.push(`${payload.failedRouteCount} de ${payload.totalRoutes} líneas no devolvieron datos.`);
          failures.push(...payload.failedRoutes.slice(0, 3).map(({ line, error, failures: attempts }) => (
            `Línea ${line} (${attempts}/5 errores): ${error}`
          )));
        }
        if (payload.excludedRouteCount) {
          failures.push(`${payload.excludedRouteCount} líneas excluidas tras 5 errores consecutivos.`);
          failures.push(...payload.excludedRoutes.slice(0, 3).map(({ line, error }) => (
            `Línea ${line} excluida: ${error}`
          )));
        }
      } catch (error) {
        if (requestId !== refreshRequestId || !expertMode) return;
        expertRouteStatuses = routes.map((route) => ({ line: route.id, status: "error", error: error.message }));
        expertRequestInProgress = false;
        expertRequestRouteIds.clear();
        setStatus("error", "Sin conexión con los datos");
        renderServiceStatus(
          [],
          expertRouteStatuses,
          true,
        );
        showVehiclesUnavailable("No se pudieron cargar las posiciones de las líneas interurbanas.");
        showNotice("No se han podido actualizar los autobuses", error.message);
        return;
      }
    } else {
      const results = await Promise.allSettled(routes.map(async (route) => {
        const payload = await getJson(`/api/vehicles?line=${encodeURIComponent(route.id)}`);
        return { route, vehicles: normalizeVehicles(payload) };
      }));
      results.forEach((result, index) => {
        if (result.status === "fulfilled") {
          result.value.vehicles.forEach((vehicle) => vehicles.push({ vehicle, route: result.value.route }));
        } else {
          failures.push(`${routes[index].id}: ${result.reason.message}`);
        }
      });
    }
    if (
      requestId !== refreshRequestId
      || refreshIsExpert !== expertMode
      || (!refreshIsExpert && routes.some((route) => !selectedRoutes.includes(route)))
    ) return;

    currentVehicles = vehicles;
    if (refreshIsExpert) {
      expertRouteStatuses = fetchedExpertRouteStatuses;
      expertRequestInProgress = false;
      expertRequestRouteIds.clear();
      if (!expertInitialMapPositionSet) {
        expertInitialMapPositionSet = true;
        map.flyTo(MADRID_CENTER, 10, { duration: 0.8 });
      }
    }
    updateVehiclePositionHistory(vehicles);
    if (failures.length && !vehicles.length) {
      setStatus("error", "Sin conexión con los datos");
      showVehiclesUnavailable("No se pudieron cargar las posiciones de las líneas solicitadas.");
      showNotice("No se han podido actualizar los autobuses", summarizeFailures(failures));
    } else {
      const movedVehicleCount = renderVehicles(vehicles);
      if (movedVehicleCount) playMovementSound();
      if (failures.length) {
        setStatus("error", "Algunas posiciones no están disponibles");
        showNotice("No se han podido actualizar todas las líneas", summarizeFailures(failures));
      } else {
        setStatus("live", "Posiciones actualizadas");
      }
    }
    if (refreshIsExpert) renderServiceStatus(vehicles, expertRouteStatuses);
    const timestamp = new Date();
    const time = timestamp.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    updatedAt.textContent = refreshIsExpert
      ? `Modo avanzado · última actualización ${time}`
      : `Última actualización · ${time}`;
  } finally {
    if (refreshIsExpert) {
      expertRequestInProgress = false;
      expertRequestRouteIds.clear();
      if (expertMode && expertCompactStatus) renderServiceStatus(currentVehicles, expertRouteStatuses);
    }
    activeRefreshRequests -= 1;
    if (!activeRefreshRequests) statusDot.classList.remove("is-refreshing");
    if (!activeRefreshRequests && pendingVehicleRefresh) {
      pendingVehicleRefresh = false;
      refreshVehicles();
    }
  }
}

function setRefreshTimer() {
  clearRefreshTimers();
  const interval = expertMode ? expertPollInterval : pollInterval;
  if (expertMode) {
    refreshDeadline = Date.now() + interval;
    updateExpertRefreshProgress();
    refreshProgressTimer = setInterval(updateExpertRefreshProgress, 250);
  }
  refreshTimer = setInterval(() => {
    if (expertMode) {
      refreshDeadline = Date.now() + interval;
      updateExpertRefreshProgress();
    }
    refreshVehicles();
  }, interval);
}

function updateExpertModeAvailability() {
  expertModeToggle.disabled = !desktopViewport.matches || !routesById.size;
  if (!desktopViewport.matches) {
    if (expertConfirmation.open) expertConfirmation.close();
    if (expertMode) setExpertMode(false);
  }
}

function setExpertMode(enabled) {
  if (enabled && !desktopViewport.matches) return;
  clearRefreshTimers();
  refreshRequestId += 1;
  routeRequestId += 1;
  expertMode = enabled;
  if (!expertMode) expandedExpertBusRoutes.clear();
  expertInitialMapPositionSet = false;
  map.options.zoomSnap = ZOOM_STEP;
  map.options.zoomDelta = ZOOM_STEP;
  if (!enabled) {
    vehicleMovementTimers.forEach((timer) => clearTimeout(timer));
    vehicleMovementTimers.clear();
  }
  expertCompactStatus = false;
  expertBusDotDetail = false;
  expertRequestInProgress = false;
  expertRequestRouteIds.clear();
  expertRouteStatuses = [];
  if (expertMode) notice.hidden = true;
  sidebar.classList.toggle("is-expert", expertMode);
  routeControls.setAttribute("aria-hidden", String(expertMode));
  routeSearch.disabled = expertMode || !routesById.size;
  expertModeToggle.setAttribute("aria-pressed", String(expertMode));
  expertModeToggle.textContent = expertMode
    ? "Salir del modo avanzado"
    : "Mostrar todos los autobuses · modo avanzado";
  expertRouteFilter.hidden = !expertMode;
  if (expertMode) renderExpertRouteFilters();
  expertViewToggle.hidden = !expertMode;
  serviceStatusDensityToggle.hidden = true;
  serviceStatusDensityToggle.setAttribute("aria-pressed", "false");
  serviceStatusDensityToggle.textContent = "Vista de puntos";
  serviceBusDetailToggle.hidden = true;
  serviceBusDetailToggle.setAttribute("aria-pressed", "false");
  expertViewToggle.setAttribute("aria-pressed", "false");
  expertViewToggle.textContent = "Ver estado de las líneas";
  serviceStatusPanel.hidden = true;
  mapPanel.hidden = false;
  routeLayer.clearLayers();
  stopLayer.clearLayers();
  currentVehicles = [];
  vehicleList.replaceChildren();
  vehicleCount.textContent = "—";
  updatedAt.textContent = "";

  if (expertMode) {
    setRouteOptionsExpanded(false);
    routeSearch.value = "";
    renderServiceStatus([], []);
    const currentRouteRequest = routeRequestId;
    const routeCount = getExpertSelectedRoutes().length;
    setStatus("", routeCount ? "Cargando recorridos de las líneas" : "Selecciona al menos una centena");
    loadExpertRouteGeometries(currentRouteRequest).then((failedRoutes) => {
      if (currentRouteRequest !== routeRequestId || !expertMode) return;
      if (failedRoutes.length) setStatus("error", `${failedRoutes.length} recorridos no disponibles`);
      renderExpertRoutes();
    });
    refreshVehicles();
    setRefreshTimer();
    return;
  }

  if (!selectedRoutes.length) {
    vehicleMarkers.forEach(({ marker, animationFrame, movementTimeout }) => {
      if (animationFrame !== null) cancelAnimationFrame(animationFrame);
      if (movementTimeout !== null) clearTimeout(movementTimeout);
      vehicleLayer.removeLayer(marker);
    });
    vehicleMarkers.clear();
    vehicleCount.textContent = "—";
    setStatus("", "Red CRTM disponible");
    map.setView(PLAZA_CASTILLA, INITIAL_ZOOM);
    return;
  }
  loadSelectedRouteGeometry();
  setStatus("", "Consultando posiciones en el CRTM");
  refreshVehicles();
  setRefreshTimer();
}

function loadSelectedRouteGeometry() {
  const currentRouteRequest = ++routeRequestId;
  const routesToLoad = [...selectedRoutes];
  Promise.allSettled(routesToLoad.map(async (selected) => ({
    route: selected,
    geometry: await getJson(`/api/routes/${encodeURIComponent(selected.id)}`),
  }))).then((results) => {
    if (routeRequestId !== currentRouteRequest || expertMode) return;
    const failedRoutes = [];
    results.forEach((result, index) => {
      if (result.status === "fulfilled") result.value.route.geometry = result.value.geometry;
      else failedRoutes.push(`${routesToLoad[index].id}: ${result.reason.message}`);
    });
    renderRoutes();
    if (currentVehicles.length) renderVehicles(currentVehicles);
    if (failedRoutes.length) showNotice("No se pudo cargar algún recorrido", failedRoutes.join(" · "));
  });
}

function toggleRouteSelection(route) {
  const isSelected = selectedRoutes.some((selected) => selected.id === route.id);
  if (!isSelected && selectedRoutes.length >= MAX_SELECTED_ROUTES) {
    showNotice("Máximo de líneas alcanzado", "Quita una de las líneas seleccionadas antes de elegir otra.");
    return;
  }
  const nextRoutes = isSelected
    ? selectedRoutes.filter((selected) => selected.id !== route.id)
    : [...selectedRoutes, route];

  clearRefreshTimers();
  refreshRequestId += 1;
  selectedRoutes = nextRoutes;
  renderSelectedRoutes();
  renderRouteOptions();
  routeSearch.value = "";
  setRouteOptionsExpanded(false);
  updatedAt.textContent = "";
  routeLayer.clearLayers();
  stopLayer.clearLayers();
  vehicleMarkers.forEach(({ marker, animationFrame, movementTimeout }) => {
    if (animationFrame !== null) cancelAnimationFrame(animationFrame);
    if (movementTimeout !== null) clearTimeout(movementTimeout);
    vehicleLayer.removeLayer(marker);
  });
  vehicleMarkers.clear();
  currentVehicles = [];
  vehicleList.replaceChildren();
  vehicleCount.textContent = "—";

  if (!selectedRoutes.length) {
    routeRequestId += 1;
    setStatus("", "Red CRTM disponible");
    map.setView(PLAZA_CASTILLA, INITIAL_ZOOM);
    return;
  }
  loadSelectedRouteGeometry();
  setStatus("", "Consultando posiciones en el CRTM");
  refreshVehicles();
  setRefreshTimer();
}

function openRouteOptions() {
  if (routeSearch.disabled) return;
  if (routeOptions.hidden) routeSearch.value = "";
  setRouteOptionsExpanded(true);
  renderRouteOptions();
}

routeSearch.addEventListener("focus", openRouteOptions);
routeSearch.addEventListener("input", () => {
  setRouteOptionsExpanded(true);
  activeRouteOption = -1;
  renderRouteOptions();
});
routeSearch.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    if (routeOptions.hidden) openRouteOptions();
    moveActiveRouteOption(event.key === "ArrowDown" ? 1 : -1);
  } else if (event.key === "Enter" && !routeOptions.hidden) {
    event.preventDefault();
    const option = routeOptions.querySelector(`#route-option-${activeRouteOption}`);
    if (option) option.click();
    else if (routeOptions.querySelectorAll('[role="option"]').length === 1) {
      routeOptions.querySelector('[role="option"]').click();
    }
  } else if (event.key === "Escape") {
    setRouteOptionsExpanded(false);
    routeSearch.value = "";
  }
});
document.querySelector("#toggle-route-options").addEventListener("click", () => {
  if (routeOptions.hidden) {
    openRouteOptions();
    routeSearch.focus();
  } else {
    setRouteOptionsExpanded(false);
  }
});
document.addEventListener("pointerdown", (event) => {
  if (!routePicker.contains(event.target)) setRouteOptionsExpanded(false);
});
routePicker.addEventListener("focusout", (event) => {
  if (!routePicker.contains(event.relatedTarget)) setRouteOptionsExpanded(false);
});
window.addEventListener("storage", (event) => {
  if (event.key !== favoriteStorageKey && event.key !== null) return;
  favoriteRouteIds = loadFavoriteRoutes();
  if (!routeOptions.hidden) renderRouteOptions();
});

async function loadRoutes() {
try {
    const payload = await getJson("/api/routes");
    const routes = normalizeRoutes(payload);
    routesById.clear();
    routes.forEach((route) => routesById.set(route.id, route));
    if (!expertFilterInitialized) {
      routes.forEach((route) => selectedExpertGroups.add(getRouteHundredsGroup(route)));
      expertFilterInitialized = true;
    }
    renderExpertRouteFilters();
    routeSearch.disabled = false;
    updateExpertModeAvailability();

    if (!routes.length) showNotice("No hay líneas disponibles", "La API respondió correctamente, pero no devolvió ninguna línea.");
    setStatus("live", "Red CRTM conectada");
  } catch (error) {
    routeSearch.disabled = true;
    routeSearch.placeholder = "No se pudieron cargar las líneas";
    setStatus("error", "Servicio no disponible");
    showNotice("No se pudieron cargar las líneas", error.message);
  }
}

sidebarToggle.addEventListener("click", () => {
  setMobilePanelExpanded(!sidebar.classList.contains("is-expanded"));
});
sidebarPositionToggle.addEventListener("click", () => {
  const right = appShell.classList.toggle("is-sidebar-right");
  const label = `Mover el panel a la ${right ? "izquierda" : "derecha"}`;
  sidebarPositionToggle.setAttribute("aria-label", label);
  sidebarPositionToggle.title = label;
});
setMobilePanelExpanded(window.matchMedia("(max-width: 760px)").matches);
desktopViewport.addEventListener("change", updateExpertModeAvailability);
centerMapButton.addEventListener("click", () => {
  if (!navigator.geolocation) {
    showNotice("Ubicación no disponible", "Este navegador no permite consultar la ubicación del dispositivo.");
    return;
  }

  centerMapButton.disabled = true;
  centerMapButton.setAttribute("aria-busy", "true");
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      centerMapButton.disabled = false;
      centerMapButton.removeAttribute("aria-busy");

      const approximateLocation = [
        Number(coords.latitude.toFixed(LOCATION_COORDINATE_PRECISION)),
        Number(coords.longitude.toFixed(LOCATION_COORDINATE_PRECISION)),
      ];
      if (!ROUTE_BOUNDS.contains(approximateLocation)) {
        showNotice("Ubicación fuera de cobertura", "El mapa solo muestra la Comunidad de Madrid.");
        return;
      }

      notice.hidden = true;
      map.flyTo(approximateLocation, LOCATION_ZOOM, { duration: 0.7 });
    },
    (error) => {
      centerMapButton.disabled = false;
      centerMapButton.removeAttribute("aria-busy");
      const message = error.code === 1
        ? "No se concedió permiso para consultar la ubicación."
        : error.code === 2
          ? "El dispositivo no ha podido determinar una ubicación."
          : error.code === 3
            ? "La consulta de ubicación ha tardado demasiado. Inténtalo de nuevo."
            : "No se ha podido consultar la ubicación del dispositivo.";
      showNotice("No se pudo obtener la ubicación", message);
    },
    { enableHighAccuracy: false, maximumAge: 60000, timeout: 10000 },
  );
});
document.querySelector("#dismiss-notice").addEventListener("click", () => { notice.hidden = true; });
expertModeToggle.addEventListener("click", () => {
  if (!desktopViewport.matches) return;
  if (expertMode) {
    setExpertMode(false);
    return;
  }
  expertPassword.value = "";
  expertPasswordError.hidden = true;
  expertConfirmation.showModal();
  expertPassword.focus();
});
expertViewToggle.addEventListener("click", () => {
  if (!expertMode) return;
  setExpertStatusView(expertViewToggle.getAttribute("aria-pressed") !== "true");
});
serviceStatusDensityToggle.addEventListener("click", () => {
  if (!expertMode) return;
  expertCompactStatus = !expertCompactStatus;
  if (!expertCompactStatus) {
    expertBusDotDetail = false;
    expandedExpertBusRoutes.clear();
  }
  serviceStatusDensityToggle.setAttribute("aria-pressed", String(expertCompactStatus));
  serviceStatusDensityToggle.textContent = expertCompactStatus ? "Vista detallada" : "Vista de puntos";
  serviceBusDetailToggle.hidden = !expertCompactStatus || serviceStatusPanel.hidden;
  serviceBusDetailToggle.setAttribute("aria-pressed", String(expertBusDotDetail));
  renderServiceStatus(currentVehicles, expertRouteStatuses);
});
serviceBusDetailToggle.addEventListener("click", () => {
  if (!expertMode || !expertCompactStatus) return;
  expertBusDotDetail = !expertBusDotDetail;
  if (!expertBusDotDetail) expandedExpertBusRoutes.clear();
  serviceBusDetailToggle.setAttribute("aria-pressed", String(expertBusDotDetail));
  renderServiceStatus(currentVehicles, expertRouteStatuses);
});
serviceStatusList.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) return;
  const button = event.target.closest("button[data-route-buses]");
  if (!(button instanceof HTMLButtonElement)) return;
  const routeId = button.dataset.routeBuses;
  if (!routeId) return;
  const expanded = !expandedExpertBusRoutes.has(routeId);
  expandedExpertBusRoutes.clear();
  serviceStatusList.querySelectorAll(".expert-dot-route-row.is-open").forEach((row) => {
    row.classList.remove("is-open");
    row.querySelector("button[data-route-buses]")?.setAttribute("aria-expanded", "false");
  });
  if (expanded) expandedExpertBusRoutes.add(routeId);
  else expandedExpertBusRoutes.delete(routeId);
  button.closest(".expert-dot-route-row")?.classList.toggle("is-open", expanded);
  button.setAttribute("aria-expanded", String(expanded));
});
serviceStatusList.addEventListener("pointerover", (event) => {
  if (!(event.target instanceof Element)) return;
  const row = event.target.closest(".expert-dot-route-row");
  if (!row) return;
  const routeId = row.querySelector("button[data-route-buses]")?.dataset.routeBuses;
  if (!routeId) return;
  const focusedButton = document.activeElement instanceof HTMLButtonElement
    ? document.activeElement.closest("button[data-route-buses]")
    : null;
  if (focusedButton && !row.contains(focusedButton)) focusedButton.blur();
  if (expandedExpertBusRoutes.has(routeId)) return;
  expandedExpertBusRoutes.clear();
  serviceStatusList.querySelectorAll(".expert-dot-route-row.is-open").forEach((openRow) => {
    openRow.classList.remove("is-open");
    openRow.querySelector("button[data-route-buses]")?.setAttribute("aria-expanded", "false");
  });
});
document.addEventListener("click", (event) => {
  if (!(event.target instanceof Element) || event.target.closest(".expert-dot-route-row")) return;
  if (!expandedExpertBusRoutes.size) return;
  expandedExpertBusRoutes.clear();
  serviceStatusList.querySelectorAll(".expert-dot-route-row.is-open").forEach((row) => {
    row.classList.remove("is-open");
    row.querySelector("button[data-route-buses]")?.setAttribute("aria-expanded", "false");
  });
  if (document.activeElement instanceof HTMLButtonElement && document.activeElement.matches("button[data-route-buses]")) {
    document.activeElement.blur();
  }
});
expertFilterOptions.addEventListener("change", (event) => {
  if (!(event.target instanceof HTMLInputElement)) return;
  const group = Number(event.target.value);
  if (!Number.isInteger(group) || group < 0 || group > 9) return;
  if (event.target.checked) selectedExpertGroups.add(group);
  else selectedExpertGroups.delete(group);
  updateExpertFilterSummary();
  refreshExpertGroupSelection();
});
document.querySelector("#select-all-expert-groups").addEventListener("click", () => {
  const checkboxes = [...expertFilterOptions.querySelectorAll('input[type="checkbox"]')];
  const selectAll = !checkboxes.length || !checkboxes.every((checkbox) => checkbox.checked);
  if (selectAll) {
    checkboxes.forEach((checkbox) => selectedExpertGroups.add(Number(checkbox.value)));
  } else {
    selectedExpertGroups.clear();
  }
  checkboxes.forEach((checkbox) => {
    checkbox.checked = selectAll;
  });
  updateExpertFilterSummary();
  refreshExpertGroupSelection();
});
expertConfirmationForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (expertPassword.value !== "modoExperto") {
    expertPasswordError.hidden = false;
    expertPassword.focus();
    return;
  }
  expertConfirmation.close();
  setExpertMode(true);
});
document.querySelector("#cancel-expert-mode").addEventListener("click", () => expertConfirmation.close());
expertConfirmation.addEventListener("close", () => {
  expertPassword.value = "";
  expertPasswordError.hidden = true;
});
soundToggle.addEventListener("click", async () => {
  if (movementSoundEnabled) {
    movementSoundEnabled = false;
    soundToggle.setAttribute("aria-pressed", "false");
    soundToggle.textContent = "Activar sonido";
    return;
  }
  const AudioContextConstructor = window.AudioContext;
  if (!AudioContextConstructor) {
    showNotice("Sonido no disponible", "Este navegador no permite reproducir el aviso de movimiento.");
    return;
  }
  try {
    audioContext ??= new AudioContextConstructor();
    await audioContext.resume();
    movementSoundEnabled = true;
    soundToggle.setAttribute("aria-pressed", "true");
    soundToggle.textContent = "Desactivar sonido";
  } catch (error) {
    showNotice("No se pudo activar el sonido", error.message);
  }
});

async function initialize() {
  favoriteRouteIds = loadFavoriteRoutes();
  await loadRoutes();
}

initialize();
