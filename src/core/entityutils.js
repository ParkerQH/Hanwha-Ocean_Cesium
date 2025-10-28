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

    return Cesium.Cartesian3.fromDegrees(lon, lat, height + 3);
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

// 센서 Cartographic와 라인(경위도 배열 [[lon,lat],...]) 사이 최단투영점 -> Cartographic
export function closestPointOnLineLL(sensorCarto, lineLL) {
  // (1) 센서를 ENU 로컬 좌표계의 원점으로 둔다.
  const origin = Cesium.Cartesian3.fromRadians(sensorCarto.longitude, sensorCarto.latitude, 0);
  const enu = Cesium.Transforms.eastNorthUpToFixedFrame(origin);
  const inv = Cesium.Matrix4.inverse(enu, new Cesium.Matrix4());

  // 경위도(도)를 로컬 ENU 좌표로
  const toLocal = (lonDeg, latDeg) => {
    const w = Cesium.Cartesian3.fromDegrees(lonDeg, latDeg, 0);                // 월드(ECEF)
    return Cesium.Matrix4.multiplyByPoint(inv, w, new Cesium.Cartesian3());    // 로컬(ENU)
  };

  // 로컬 ENU 좌표를 다시 지리 좌표(Cartographic, rad)로
  const toWgs = (vec) => {
    const w = Cesium.Matrix4.multiplyByPoint(enu, vec, new Cesium.Cartesian3());// 로컬 -> 월드(ECEF)
    return Cesium.Cartographic.fromCartesian(w);                                // ECEF -> Cartographic(rad)
  };

  // (2) 원점 O = (0,0,0)에서 각 세그먼트 [A,B]로의 수선 발 P를 탐색
  let best = null, bestD2 = Number.POSITIVE_INFINITY;
  const zero = new Cesium.Cartesian3(0, 0, 0);                                  // O: 센서 로컬 원점

  for (let i = 0; i < lineLL.length - 1; i++) {
    const [lon1, lat1] = lineLL[i];
    const [lon2, lat2] = lineLL[i + 1];

    // 세그먼트 양 끝점을 로컬로 변환
    const a = toLocal(lon1, lat1);
    const b = toLocal(lon2, lat2);

    // ab 벡터와 그 제곱 노름
    const ab  = Cesium.Cartesian3.subtract(b, a, new Cesium.Cartesian3());
    const ab2 = Cesium.Cartesian3.dot(ab, ab);

    // t: O에서 ab 직선으로의 투영 비율 (무차원). ab2==0(퇴화 세그먼트)면 0으로 처리.
    const oa = Cesium.Cartesian3.subtract(zero, a, new Cesium.Cartesian3());
    const t  = ab2 > 0 ? Cesium.Cartesian3.dot(oa, ab) / ab2 : 0;

    // 세그먼트 안쪽으로 clamp
    const tt = Math.max(0, Math.min(1, t));

    // 투영점 P = A + tt * ab
    const proj = Cesium.Cartesian3.add(
      a,
      Cesium.Cartesian3.multiplyByScalar(ab, tt, new Cesium.Cartesian3()),
      new Cesium.Cartesian3()
    );

    // O와 P 사이의 거리 제곱(비교만 하므로 sqrt 불필요)
    const d2 = Cesium.Cartesian3.distanceSquared(zero, proj);

    if (d2 < bestD2) { bestD2 = d2; best = proj; }
  }

  // (3) 최적 투영점을 Cartographic(rad)로 반환. 없으면 센서 자체를 반환(에지 케이스).
  return best ? toWgs(best) : sensorCarto;
}

// 두 점 수평거리(m)
export function planarDistanceMeters(a, b) {
  const p1 = Cesium.Cartesian3.fromRadians(a.longitude, a.latitude, 0);
  const p2 = Cesium.Cartesian3.fromRadians(b.longitude, b.latitude, 0);
  return Cesium.Cartesian3.distance(p1, p2);
}

// a->b 방위각(라디안) — ENU 기준 atan2(y, x)
export function headingBetweenCarto(a, b) {
  const p1 = Cesium.Cartesian3.fromRadians(a.longitude, a.latitude, 0);
  const p2 = Cesium.Cartesian3.fromRadians(b.longitude, b.latitude, 0);

  const enu = Cesium.Transforms.eastNorthUpToFixedFrame(p1);
  const inv = Cesium.Matrix4.inverse(enu, new Cesium.Matrix4());

  const local = Cesium.Matrix4.multiplyByPoint(inv, p2, new Cesium.Cartesian3());
  return Math.atan2(local.y, local.x);
}

// Cartographic + heading + (sx,sy,sz) -> 모델행렬
export function modelMatrixFromCartoHeadingScale(carto, heading, sx, sy, sz) {
  // (1) 위치 + HPR -> 로컬 -> 월드 프레임
  const pos = Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, carto.height || 0);
  const hpr = new Cesium.HeadingPitchRoll(heading, 0, 0);
  const frame = Cesium.Transforms.headingPitchRollToFixedFrame(pos, hpr);

  // (2) 로컬 스케일 (sy, sx, sz) 순서 보정은 모델 축 정의에 따른 현장 보정.
  const S = Cesium.Matrix4.fromScale(new Cesium.Cartesian3(sx, sy, sz));
  // 최종 모델 행렬: frame * S (로컬에서 스케일 후 월드로 보냄)
  return Cesium.Matrix4.multiply(frame, S, new Cesium.Matrix4());
}