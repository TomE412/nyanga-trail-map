// The Harare practice map: a 30 km radius around Greendale/Highlands.
export const HUB = { lat: -17.805, lon: 31.105 };
export const RADIUS_KM = 30;
const dLat = RADIUS_KM / 110.574, dLon = RADIUS_KM / (111.320 * Math.cos(HUB.lat * Math.PI / 180));
export const BBOX = { south: +(HUB.lat - dLat).toFixed(4), north: +(HUB.lat + dLat).toFixed(4), west: +(HUB.lon - dLon).toFixed(4), east: +(HUB.lon + dLon).toFixed(4) };
