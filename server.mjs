import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)));
const port = Number(process.env.PORT || 3000);
const CRTM_QUERY_URL =
  "https://services5.arcgis.com/UxADft6QPcvFyDU1/arcgis/rest/services/M8_Red/FeatureServer/2/query";
const CITRAM_WIDGET_API = "https://www.crtm.es/widgets/api";
const CRTM_INTERURBAN_MODE = "8";
const ALL_VEHICLES_CONCURRENCY = 4;
const LOCATION_REQUEST_INTERVAL = 60;
const MAX_ROUTE_FAILURES = 5;
const lineCodeByPublicId = new Map();
const lineInfoCache = new Map();
const routeFailures = new Map();
const excludedRoutes = new Map();
const locationRequestQueue = [];
const allVehiclesRequests = new Map();
let routesCache = null;
let routesRequest = null;
let activeLocationRequests = 0;
let nextLocationRequestAt = 0;
let locationRequestTimer = null;

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function sendJson(response, status, data) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(data));
}

async function fetchJson(url) {
  const upstream = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(20000),
  });
  if (!upstream.ok) throw new Error(`El servicio del CRTM respondió con HTTP ${upstream.status}.`);
  const payload = await upstream.json();
  if (payload.error) {
    throw new Error(payload.error.message || "El servicio del CRTM devolvió un error.");
  }
  return payload;
}

function arcgisQuery(parameters) {
  const url = new URL(CRTM_QUERY_URL);
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, String(value));
  return url;
}

function asArray(value) {
  if (value === undefined || value === null || value === "") return [];
  return Array.isArray(value) ? value : [value];
}

function processLocationRequestQueue() {
  if (locationRequestTimer || activeLocationRequests >= ALL_VEHICLES_CONCURRENCY || !locationRequestQueue.length) return;
  const delay = Math.max(0, nextLocationRequestAt - Date.now());
  if (delay) {
    locationRequestTimer = setTimeout(() => {
      locationRequestTimer = null;
      processLocationRequestQueue();
    }, delay);
    return;
  }

  const { url, resolve, reject } = locationRequestQueue.shift();
  activeLocationRequests += 1;
  nextLocationRequestAt = Date.now() + LOCATION_REQUEST_INTERVAL;
  fetchJson(url).then(resolve, reject).finally(() => {
    activeLocationRequests -= 1;
    processLocationRequestQueue();
  });
  processLocationRequestQueue();
}

function fetchLocationJson(url) {
  return new Promise((resolve, reject) => {
    locationRequestQueue.push({ url, resolve, reject });
    processLocationRequestQueue();
  });
}

async function getCITRAMLineInfo(line) {
  const cached = lineInfoCache.get(line);
  if (cached) return cached;
  const codLine = lineCodeByPublicId.get(line);
  if (!codLine) {
    const error = new Error("No se encontró la línea solicitada.");
    error.status = 404;
    error.code = "LINE_NOT_FOUND";
    throw error;
  }
  const url = new URL(`${CITRAM_WIDGET_API}/GetLinesInformation.php`);
  url.searchParams.set("activeItinerary", "1");
  url.searchParams.set("codLine", codLine);
  const request = fetchJson(url).then((data) => {
    const lineInfo = data.lines?.LineInformation;
    if (!lineInfo) throw new Error(`El CRTM no devolvió información para la línea ${line}.`);
    return lineInfo;
  });
  lineInfoCache.set(line, request);
  try {
    return await request;
  } catch (error) {
    if (lineInfoCache.get(line) === request) lineInfoCache.delete(line);
    throw error;
  }
}

async function fetchRoutes() {
  const url = new URL(`${CITRAM_WIDGET_API}/GetLines.php`);
  url.searchParams.set("mode", CRTM_INTERURBAN_MODE);
  const data = await fetchJson(url);
  const lines = asArray(data.lines?.Line);
  if (!lines.length) throw new Error("El CRTM no devolvió la lista de líneas interurbanas esperada.");

  lineCodeByPublicId.clear();
  const routes = lines
    .filter((line) => line.codMode === CRTM_INTERURBAN_MODE && line.active !== false && line.codLine && line.shortDescription)
    .map((line) => {
      lineCodeByPublicId.set(String(line.shortDescription), String(line.codLine));
      return {
        id: String(line.shortDescription),
        name: String(line.description || `Línea ${line.shortDescription}`),
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id, "es", { numeric: true }));
  if (!routes.length) throw new Error("El CRTM no devolvió ninguna línea interurbana activa.");
  return routes;
}

function getHundredsGroup(routeId) {
  const lineNumber = Number.parseInt(routeId, 10);
  return Number.isFinite(lineNumber) ? Math.floor(lineNumber / 100) % 10 : 0;
}

async function getRoutes() {
  if (routesCache) return routesCache;
  if (!routesRequest) {
    routesRequest = fetchRoutes().then((routes) => {
      routesCache = routes;
      return routes;
    });
  }
  const request = routesRequest;
  try {
    return await request;
  } finally {
    if (!routesCache && routesRequest === request) routesRequest = null;
  }
}

async function getRouteGeometry(line, includeStops = true) {
  const lineInfo = await getCITRAMLineInfo(line);
  const publicLine = lineInfo.shortDescription;

  const features = [];
  const pageSize = 2000;
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const data = await fetchJson(arcgisQuery({
      where: `NUMEROLINEAUSUARIO='${publicLine}' AND MODOLINEA=8 AND FECHAFIN IS NULL`,
      outFields: "NUMEROLINEAUSUARIO,CODIGOITINERARIO,SENTIDO,NUMEROORDEN,DENOMINACION_SAE",
      returnGeometry: "true",
      outSR: "4326",
      resultOffset: offset,
      resultRecordCount: pageSize,
      f: "geojson",
    }));
    if (!Array.isArray(data.features)) throw new Error("El CRTM no devolvió la geometría esperada para esta línea.");
    features.push(...data.features);
    hasMore = Boolean(data.properties?.exceededTransferLimit);
    offset += data.features.length;
    if (hasMore && data.features.length === 0) {
      throw new Error("El servicio del CRTM no pudo completar la geometría de esta línea.");
    }
  }

  if (includeStops) {
    const stopsById = new Map();
    for (const itinerary of asArray(lineInfo.itinerary?.Itinerary)) {
      const direction = Number(itinerary.direction);
      for (const stop of asArray(itinerary.stops?.StopInformation)) {
        const latitude = Number(stop.coordinates?.latitude);
        const longitude = Number(stop.coordinates?.longitude);
        if (
          !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
          latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180
        ) continue;

        const id = String(stop.codStop || `${latitude},${longitude}`);
        const existing = stopsById.get(id);
        if (existing) {
          if (Number.isFinite(direction) && !existing.properties.directions.includes(direction)) {
            existing.properties.directions.push(direction);
          }
          continue;
        }

        stopsById.set(id, {
          type: "Feature",
          properties: {
            featureType: "stop",
            stopId: id,
            name: String(stop.name || stop.address || "Parada de autobús"),
            directions: Number.isFinite(direction) ? [direction] : [],
          },
          geometry: { type: "Point", coordinates: [longitude, latitude] },
        });
      }
    }
    features.push(...stopsById.values());
  }

  return { type: "FeatureCollection", features };
}

async function getVehicles(line) {
  const codLine = lineCodeByPublicId.get(line);
  if (!codLine) {
    const error = new Error("No se encontró la línea solicitada.");
    error.status = 404;
    error.code = "LINE_NOT_FOUND";
    throw error;
  }

  const lineInfo = await getCITRAMLineInfo(line);
  const itineraries = asArray(lineInfo.itinerary?.Itinerary);
  const requests = itineraries.flatMap((itinerary) => {
    const stop = asArray(itinerary.stops?.StopInformation)[0];
    if (!itinerary.codItinerary || !stop?.codStop) return [];
    const url = new URL(`${CITRAM_WIDGET_API}/GetLineLocation.php`);
    url.searchParams.set("mode", CRTM_INTERURBAN_MODE);
    url.searchParams.set("codItinerary", itinerary.codItinerary);
    url.searchParams.set("codLine", codLine);
    url.searchParams.set("codStop", stop.codStop);
    url.searchParams.set("direction", String(itinerary.direction));
    return [fetchLocationJson(url)];
  });
  if (!requests.length) {
    throw new Error(`El CRTM no devolvió itinerarios con paradas de referencia para la línea ${line}.`);
  }
  const locationResponses = await Promise.all(requests);
  const vehicleLocations = new Map();
  const updatedAt = new Date().toISOString();

  for (const response of locationResponses) {
    for (const vehicle of asArray(response.vehiclesLocation?.VehicleLocation)) {
      const latitude = Number(vehicle.coordinates?.latitude);
      const longitude = Number(vehicle.coordinates?.longitude);
      if (
        !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
        latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180
      ) continue;
      const id = String(vehicle.codVehicle || `${latitude},${longitude}`);
      if (vehicleLocations.has(id)) continue;
      vehicleLocations.set(id, {
        id,
        lat: latitude,
        lng: longitude,
        updatedAt,
        direction: Number(vehicle.direction) || 0,
        service: String(vehicle.service || ""),
      });
    }
  }
  return [...vehicleLocations.values()];
}

async function getAllVehicles(routes) {
  const availableRoutes = routes.filter((route) => !excludedRoutes.has(route.id));
  const results = new Array(availableRoutes.length);
  let nextIndex = 0;
  const workerCount = Math.min(ALL_VEHICLES_CONCURRENCY, availableRoutes.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < availableRoutes.length) {
      const index = nextIndex;
      nextIndex += 1;
      const route = availableRoutes[index];
      try {
        const vehicles = await getVehicles(route.id);
        routeFailures.delete(route.id);
        results[index] = {
          vehicles: vehicles.map((vehicle) => ({ ...vehicle, routeId: route.id })),
        };
      } catch (error) {
        const failures = (routeFailures.get(route.id) || 0) + 1;
        routeFailures.set(route.id, failures);
        if (failures >= MAX_ROUTE_FAILURES) {
          excludedRoutes.set(route.id, error.message);
          console.warn(`Se excluye la línea ${route.id} tras ${failures} errores consecutivos.`);
        }
        results[index] = { error: error.message, failures };
      }
    }
  }));

  const vehicles = [];
  const failedRoutes = [];
  const routeStatuses = [];
  results.forEach((result, index) => {
    const route = availableRoutes[index];
    if (result.error) {
      failedRoutes.push({ line: route.id, error: result.error, failures: result.failures });
      routeStatuses.push({
        line: route.id,
        name: route.name,
        status: "error",
        vehicleCount: 0,
        error: result.error,
        failures: result.failures,
      });
    } else {
      vehicles.push(...result.vehicles);
      routeStatuses.push({
        line: route.id,
        name: route.name,
        status: "online",
        vehicleCount: result.vehicles.length,
      });
    }
  });
  const excludedRouteStatuses = [];
  for (const route of routes) {
    const error = excludedRoutes.get(route.id);
    if (!error) continue;
    routeStatuses.push({
      line: route.id,
      name: route.name,
      status: "excluded",
      vehicleCount: 0,
      error,
      failures: routeFailures.get(route.id) || MAX_ROUTE_FAILURES,
    });
    excludedRouteStatuses.push({ line: route.id, error });
  }
  const routeOrder = new Map(routes.map((route, index) => [route.id, index]));
  routeStatuses.sort((a, b) => routeOrder.get(a.line) - routeOrder.get(b.line));
  if (failedRoutes.length) {
    console.error(`No se pudieron consultar ${failedRoutes.length} de ${availableRoutes.length} líneas.`);
  }
  return {
    vehicles,
    routeStatuses,
    failedRouteCount: failedRoutes.length,
    failedRoutes: failedRoutes.slice(0, 20),
    excludedRouteCount: excludedRouteStatuses.length,
    excludedRoutes: excludedRouteStatuses.slice(0, 20),
    totalRoutes: routes.length,
  };
}

async function getAllVehiclesSnapshot(groups = null) {
  const requestKey = groups ? [...groups].sort((a, b) => a - b).join(",") : "all";
  if (!allVehiclesRequests.has(requestKey)) {
    const request = (async () => {
      const routes = await getRoutes();
      const selectedRoutes = groups
        ? routes.filter((route) => groups.has(getHundredsGroup(route.id)))
        : routes;
      return getAllVehicles(selectedRoutes);
    })();
    allVehiclesRequests.set(requestKey, request);
  }
  const request = allVehiclesRequests.get(requestKey);
  try {
    return await request;
  } finally {
    if (allVehiclesRequests.get(requestKey) === request) allVehiclesRequests.delete(requestKey);
  }
}

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url || "/", `http://${request.headers.host}`);

  if (request.method !== "GET") {
    sendJson(response, 405, { error: "Método no permitido.", code: "METHOD_NOT_ALLOWED" });
    return;
  }

  try {
    if (requestUrl.pathname === "/api/status") {
      sendJson(response, 200, { realtimeConfigured: true, provider: "CITRAM" });
      return;
    }

    if (requestUrl.pathname === "/api/routes") {
      const routes = await getRoutes();
      sendJson(response, 200, { routes });
      return;
    }

    const routeMatch = requestUrl.pathname.match(/^\/api\/routes\/([^/]+)$/);
    if (routeMatch) {
      const geometry = await getRouteGeometry(
        decodeURIComponent(routeMatch[1]),
        requestUrl.searchParams.get("stops") !== "false",
      );
      sendJson(response, 200, geometry);
      return;
    }

    if (requestUrl.pathname === "/api/vehicles") {
      if (requestUrl.searchParams.get("all") === "true") {
        const groupsParameter = requestUrl.searchParams.get("groups");
        let groups = null;
        if (groupsParameter !== null) {
          if (!/^[0-9](,[0-9])*$/.test(groupsParameter)) {
            sendJson(response, 400, { error: "El filtro de centenas no es válido.", code: "INVALID_ROUTE_GROUPS" });
            return;
          }
          const parsedGroups = groupsParameter.split(",").map(Number);
          if (!parsedGroups.length || parsedGroups.some((group) => !Number.isInteger(group) || group < 0 || group > 9)) {
            sendJson(response, 400, { error: "El filtro de centenas no es válido.", code: "INVALID_ROUTE_GROUPS" });
            return;
          }
          groups = new Set(parsedGroups);
        }
        sendJson(response, 200, await getAllVehiclesSnapshot(groups));
        return;
      }
      const line = requestUrl.searchParams.get("line");
      if (!line) {
        sendJson(response, 400, { error: "Debes indicar una línea.", code: "LINE_REQUIRED" });
        return;
      }
      const vehicles = await getVehicles(line);
      sendJson(response, 200, { vehicles });
      return;
    }
  } catch (error) {
    const status = error.status || 502;
    if (status >= 500) console.error("Error al consultar los datos del CRTM:", error.message);
    sendJson(response, status, {
      error: error.message || "No se pudieron consultar los datos del CRTM.",
      code: error.code || "CRTM_UPSTREAM_ERROR",
    });
    return;
  }

  const requestedPath = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
  if (!["/index.html", "/styles.css", "/app.js"].includes(requestedPath)) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  const filePath = resolve(root, `.${requestedPath}`);
  if (!filePath.startsWith(`${root}${sep}`)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const content = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    response.end(content);
  } catch (error) {
    if (error.code === "ENOENT") {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    console.error("Error al servir el archivo:", error.message);
    response.writeHead(500);
    response.end("Internal server error");
  }
});

server.listen(port, () => {
  console.log(`Mapa de autobuses disponible en http://localhost:${port}`);
});
