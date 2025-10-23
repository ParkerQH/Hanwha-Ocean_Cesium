// 엔티티 관련 공통 유틸
import * as Cesium from "cesium";

// GeoJSON Feature -> 외곽 링 배열(Polygon/MultiPolygon만 지원)
export function ringsFromFeature(f) {
    const g = f?.geometry; if (!g) return [];
    if (g.type === "Polygon") return [g.coordinates?.[0] || []];
    if (g.type === "MultiPolygon") return (g.coordinates || []).map(c => c?.[0] || []);
    return [];
}

// Cartesian3 -> 경도/위도 변환
export function cartToLonLat(cart) {
    const c = Cesium.Ellipsoid.WGS84.cartesianToCartographic(cart);
    return { lon: Cesium.Math.toDegrees(c.longitude), lat: Cesium.Math.toDegrees(c.latitude) };
}

// 폴리곤 엔티티의 화면 말풍선 표시용 중심점
export function centroidOfPolygonEntity(entity, viewer) {
    const now = viewer.clock.currentTime;
    let h = entity?.polygon?.hierarchy;
    if (!h) return null;
    if (typeof h.getValue === "function") h = h.getValue(now);
    const positions = h?.positions || h || [];
    if (!positions.length) return null;

    // 단순 평균 중심
    let lon = 0, lat = 0;
    positions.forEach(p => { const v = cartToLonLat(p); lon += v.lon; lat += v.lat; });
    lon /= positions.length; lat /= positions.length;

    // 높이(Extruded Height) + 0.5m
    let extr = entity?.polygon?.extrudedHeight, height = 0;
    if (typeof extr?.getValue === "function") height = Number(extr.getValue(now)) || 0;
    else if (typeof extr === "number") height = extr;

    return Cesium.Cartesian3.fromDegrees(lon, lat, height + 0.5);
}

// 외곽 방향 판정
export function signedAreaLL(pts) {
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
        const j = (i + 1) % pts.length;
        a += pts[i].lon * pts[j].lat - pts[j].lon * pts[i].lat;
    }
    return a / 2;
}

// 센서 배치 기준 좌표값 리턴
export function edgeMidpointLL(ringLL, lineIndex) {
    const m = ringLL.length;
    const i = ((lineIndex % m) + m) % m;
    const j = (i + 1) % m;
    const p1 = ringLL[i], p2 = ringLL[j];
    return { lon: (p1.lon + p2.lon) / 2, lat: (p1.lat + p2.lat) / 2 };
}

// 즉시 제거 유틸
export function removeEntity(viewer, entity) {
  if (!entity) return;
  try { viewer.entities.remove(entity); } catch {}
  try { if (viewer?.scene?.requestRenderMode) viewer.scene.requestRender(); } catch {}
}

export function removeEntities(viewer, entities) {
  const arr = Array.isArray(entities) ? entities : [entities];
  for (const e of arr) removeEntity(viewer, e);
}