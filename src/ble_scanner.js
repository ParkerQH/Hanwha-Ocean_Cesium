import * as Cesium from 'cesium';

// 모듈 내부 상태 (외부로는 initBleScanner만 공개)
let _viewer = null;              // Cesium.Viewer 인스턴스
let sensorsVisible = false;      // 센서 표시 중 여부

// 센서 배치 및 크기
const SENSOR_DEFAULT_N = 3; // n: 센서 위치 = 기둥 높이 / n
const SENSOR_RADIUS = 0.3;  // 센서 구 반지름 (m)
const SENSOR_OFFSET = 0;  // 구의 중심점과 변 사이의 거리

// 캐시/인덱스
const pillarMetaByColumn = new Map(); // pillar_id(문자열) -> { ringLL:[{lon,lat}], height:Number, entity:Entity }
const sensorsByColumn = new Map();  // pillar_id(문자열) -> [{ ble_id:int, pillar_id:int, line:int }]
const sensorEntityIds = new Set();  // 생성된 센서 entity id 집합 (토글/삭제용)
const highlightedPillars = new Map(); // 강조된 기둥 -> 원래 material 백업

// 좌표/기하 유틸
// Cartesian3 -> (lon,lat) degree
function cartesianToLonLat(cart) {
  const c = Cesium.Ellipsoid.WGS84.cartesianToCartographic(cart);
  return {
    lon: Cesium.Math.toDegrees(c.longitude),
    lat: Cesium.Math.toDegrees(c.latitude),
  };
}

// Entity의 polygon.extrudedHeight 값을 number로
function getExtrudedHeight(entity) {
  try {
    const h = entity?.polygon?.extrudedHeight;
    if (typeof h?.getValue === 'function') {
      return Number(h.getValue(_viewer.clock.currentTime)) || 10;
    }
    return Number(h) || 10;
  } catch (_) {
    return 10;
  }
}

// 현재 viewer에 올라온 기둥 엔티티를 수집해서 캐시에 기록
function collectCurrentPillars() {
  pillarMetaByColumn.clear();
  if (!_viewer) return;

  _viewer.entities.values.forEach((e) => {
    // 기둥인지 확인
    if (e.layerTag !== 'columns') return;

    // 1) 기둥 ID 추출
    const props = e.rawData || {};
    const columnId = props.id ?? null;
    if (columnId == null) return;

    // 2) 외곽링 좌표 뽑기 (Cesium PolygonHierarchy -> positions)
    let positions = [];
    try {
      const hierarchy = e?.polygon?.hierarchy?.getValue?.(
        _viewer.clock.currentTime
      );
      if (hierarchy?.positions) positions = hierarchy.positions;
      else if (Array.isArray(hierarchy)) positions = hierarchy;
    } catch (_) {}

    if (!positions?.length) return;

    // 3) Cartesian3 -> 경위도, 외곽링 (lon,lat) 배열
    const ringLL = positions.map(cartesianToLonLat);

    // 4) 높이
    const height = getExtrudedHeight(e);

    // 5) 캐시에 저장
    pillarMetaByColumn.set(String(columnId), { ringLL, height, entity: e });
  });
}

// 다각형의 부호있는 면적(대략) -> CCW > 0 / CW < 0 로 가정
function signedArea2D(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    a += pts[i].lon * pts[j].lat - pts[j].lon * pts[i].lat;
  }
  return a / 2;
}

// 변(lineIndex)의 중점 (닫힘점 여부 무관하게 인덱스 모듈로 처리)
function midpointOfEdge(positionsLL, lineIndex) {
  const m = positionsLL.length;
  const i = ((lineIndex % m) + m) % m; // 음수 방지
  const j = (i + 1) % m;
  const p1 = positionsLL[i],
    p2 = positionsLL[j];
  return { lon: (p1.lon + p2.lon) / 2, lat: (p1.lat + p2.lat) / 2 };
}

// 센서 엔티티 생성/제거
function placeSensorsForColumn(columnId, sensors, n = SENSOR_DEFAULT_N) {
  const meta = pillarMetaByColumn.get(String(columnId));
  if (!meta || !sensors?.length) return;

  const { ringLL, height } = meta;
  const z = height / n;
  const areaSign = signedArea2D(ringLL); // CCW(+)인지, CW(-)인지

  for (const s of sensors) {
    // 1) 변 중점(경위도) + 고도(z)
    const mid = midpointOfEdge(ringLL, s.line);
    const midPos = Cesium.Cartesian3.fromDegrees(mid.lon, mid.lat, z);

    // 2) 지역 ENU 좌표축 (동/북/위쪽)
    const enu = Cesium.Transforms.eastNorthUpToFixedFrame(midPos);
    const east = Cesium.Matrix4.getColumn(enu, 0, new Cesium.Cartesian3());
    const north = Cesium.Matrix4.getColumn(enu, 1, new Cesium.Cartesian3());
    const upVec = Cesium.Matrix4.getColumn(enu, 2, new Cesium.Cartesian3());

    // 3) 변 방향 벡터 (edgeDir): i -> i+1
    const m = ringLL.length;
    const i = ((s.line % m) + m) % m;
    const j = (i + 1) % m;
    const p1 = Cesium.Cartesian3.fromDegrees(ringLL[i].lon, ringLL[i].lat, z);
    const p2 = Cesium.Cartesian3.fromDegrees(ringLL[j].lon, ringLL[j].lat, z);
    const edgeDir = Cesium.Cartesian3.normalize(
      Cesium.Cartesian3.subtract(p2, p1, new Cesium.Cartesian3()),
      new Cesium.Cartesian3()
    );

    // 4) 바깥쪽 법선 outward (CCW 기준 edgeDir × up = 바깥 / CW이면 뒤집음)
    let outward = Cesium.Cartesian3.cross(
      edgeDir,
      upVec,
      new Cesium.Cartesian3()
    );
    outward = Cesium.Cartesian3.normalize(outward, outward);
    if (areaSign < 0)
      Cesium.Cartesian3.multiplyByScalar(outward, -1, outward);

    // 5) 벽과 겹치는 정도
    const finalPos = Cesium.Cartesian3.add(
      midPos,
      Cesium.Cartesian3.multiplyByScalar(
        outward,
        SENSOR_OFFSET,
        new Cesium.Cartesian3()
      ),
      new Cesium.Cartesian3()
    );

    // 6) 센서가 바깥을 바라보게 heading 계산 (ENU 기준)
    const eV = Cesium.Cartesian3.dot(outward, east);
    const nV = Cesium.Cartesian3.dot(outward, north);
    const heading = Math.atan2(eV, nV);
    const orientation =
      Cesium.Transforms.headingPitchRollQuaternion(
        finalPos,
        new Cesium.HeadingPitchRoll(heading, 0, 0)
      );

    // 7) 중복 방지 ID = ble:${pillar_id}:${ble_id}
    const entId = `ble:${columnId}:${s.ble_id}`;
    if (!_viewer.entities.getById(entId)) {
      const ent = _viewer.entities.add({
        id: entId,
        position: finalPos,
        orientation,
        ellipsoid: {
          radii: new Cesium.Cartesian3(
            SENSOR_RADIUS,
            SENSOR_RADIUS,
            SENSOR_RADIUS
          ),
          material: Cesium.Color.WHITE,
        },
        layerTag: 'bleSensor',
        rawData: { ble_id: s.ble_id, pillar_id: columnId, line: s.line },
      });
      sensorEntityIds.add(entId);
    }
  }
}

// 모든 센서 엔티티 제거 + 기둥 강조 원복 
function removeAllSensors() {
  for (const id of Array.from(sensorEntityIds)) {
    const e = _viewer.entities.getById(id);
    if (e) _viewer.entities.remove(e);
    sensorEntityIds.delete(id);
  }
  sensorsVisible = false;

  // 기둥 강조 원상복구
  for (const [pillarId, mat] of highlightedPillars.entries()) {
    const meta = pillarMetaByColumn.get(String(pillarId));
    if (meta?.entity?.polygon) {
      meta.entity.polygon.material =
        mat || Cesium.Color.GRAY;
    }
  }
  highlightedPillars.clear();
}

// 백엔드 API + WFS 래퍼
async function fetchSensorsByPillars(pillarIdsCsv) {
  const res = await fetch(
    `/api/ble/by_pillars?pillar_ids=${encodeURIComponent(pillarIdsCsv)}`
  );
  if (!res.ok) return [];
  return await res.json(); // [{ble_id, pillar_id, line}]
}

async function fetchSensorDetail(bleId) {
  const res = await fetch(
    `/api/ble/detail?ble_id=${encodeURIComponent(bleId)}`
  );
  if (!res.ok) return null;
  return await res.json(); // {ble_id, pillar_id, line}
}

// GeoServer WFS: pillar_id -> bldg_id 조회
async function wfsGet({ cql }) {
  const url =
    `/geoserver/HanWha_map/ows?service=WFS&version=1.0.0&request=GetFeature` +
    `&typeName=HanWha_map:polygon_data&outputFormat=application/json&srsName=EPSG:4326` +
    (cql ? `&CQL_FILTER=${encodeURIComponent(cql)}` : '');

  const res = await fetch(url);
  if (!res.ok) throw new Error('WFS fetch failed');

  const ct = (res.headers.get('content-type') || '').toLowerCase();
  if (!ct.includes('application/json')) {
    const text = await res.text();
    console.error('[WFS non-JSON]', { url, status: res.status, ct, text: text.slice(0, 500) });
    throw new Error('WFS returned non-JSON (see console)');
  }
  return res.json();
}


// WFS로 pillar_id에 해당하는 bldg_id 조회
async function fetchBldgIdByPillar(pillarId) {
  const json = await wfsGet({
    cql: `id=${Number(pillarId)}`
  });
  const f = (json.features || [])[0];
  if (!f) return null;
  const props = f.properties || {};
  return props.bldg_id ?? props.BLDG_ID ?? null;
}


// 토글/검색 동작
async function showSensorsForCurrentPillars(n = SENSOR_DEFAULT_N) {
  if (!_viewer) return;

  // 1) 화면의 기둥 메타 수집
  collectCurrentPillars();
  const pillarIds = Array.from(pillarMetaByColumn.keys()); // ["4","8",...]

  if (pillarIds.length === 0) return;

  // 2) API로 센서 일괄 조회
  let list = [];
  try {
    list = await fetchSensorsByPillars(pillarIds.join(','));
  } catch (e) {
    console.warn('[showSensorsForCurrentPillars] fetch error', e);
    alert('센서 정보를 불러오지 못했습니다.');
    return;
  }

  sensorsByColumn.clear();
  for (const s of list) {
    const key = String(s.pillar_id);
    const arr = sensorsByColumn.get(key) || [];
    arr.push(s);
    sensorsByColumn.set(key, arr);
  }

  // 3) 기존 센서 지우고 다시 배치
  removeAllSensors();

  for (const colId of pillarMetaByColumn.keys()) {
    const colSensors = sensorsByColumn.get(colId);
    if (colSensors && colSensors.length)
      placeSensorsForColumn(colId, colSensors, n);
  }

  sensorsVisible = true;
  if (_viewer.scene.requestRenderMode) _viewer.scene.requestRender();
}

//검색된 센서/기둥 강조: 모든 센서를 흰색으로 초기화 -> 검색 센서 노랑 / 기둥은 파랑으로 강조
function colorizeSearched(bleId, pillarId) {
  // 1) 모든 센서 흰색
  for (const id of sensorEntityIds) {
    const e = _viewer.entities.getById(id);
    if (e?.ellipsoid)
      e.ellipsoid.material = Cesium.Color.WHITE;
  }

  // 2) 해당 기둥 파란색 (원래 material 백업)
  const meta = pillarMetaByColumn.get(String(pillarId));
  if (meta?.entity?.polygon) {
    if (!highlightedPillars.has(String(pillarId))) {
      highlightedPillars.set(String(pillarId), meta.entity.polygon.material);
    }
    meta.entity.polygon.material = Cesium.Color.BLUE;
  }

  // 3) 목표 센서만 노란색
  const targetId = `ble:${pillarId}:${bleId}`;
  const sEnt = _viewer.entities.getById(targetId);
  if (sEnt?.ellipsoid) sEnt.ellipsoid.material = Cesium.Color.YELLOW;
}


// 센서 검색 플로우
async function searchBleAndShow(bleId, n = SENSOR_DEFAULT_N) {
  // 1) API: ble_id -> {pillar_id, line}
  let detail;
  try {
    detail = await fetchSensorDetail(bleId);
  } catch (e) {
    console.warn('[searchBleAndShow] fetch detail error', e);
    alert('센서 조회 중 오류가 발생했습니다.');
    return;
  }

  if (!detail) {
    alert('해당 BLE 센서를 찾을 수 없습니다.');
    return;
  }
  const { pillar_id } = detail;

  // 2) WFS: pillar_id -> bldg_id
  let bldg_id = null;
  try {
    bldg_id = await fetchBldgIdByPillar(detail.pillar_id);
  } catch (e) {
    console.warn('[searchBleAndShow] WFS error', e);
  }

  if (!bldg_id) {
    alert('해당 센서가 속한 공장을 찾을 수 없습니다.');
    return;
  }

  // 3) 공장 기둥 로딩 (기존 polygon.js의 전역 함수 활용)
  if (typeof window.reloadColumns === 'function') {
    await window.reloadColumns([String(bldg_id)], []);
  }

  // 4) 센서 표시
  await showSensorsForCurrentPillars(n);

  // 5) 색상 강조
  colorizeSearched(bleId, pillar_id);

  // UI 동기화
  const btn = document.getElementById('btnToggleSensors');
  if (btn) btn.textContent = '센서 숨김';
}


// 초기화 (app.js에서 viewer 생성 직후 호출)
export function initBleScanner(viewerInstance) {
  _viewer = viewerInstance;

  const btnToggle = document.getElementById('btnToggleSensors');
  const btnSearch = document.getElementById('btnSearchBle');
  const inpBle = document.getElementById('inpBleId');

  // 토글: 현재 화면 기둥 기준으로 센서 표시/제거
  if (btnToggle) {
    btnToggle.addEventListener('click', async () => {
      if (!sensorsVisible) {
        await showSensorsForCurrentPillars(SENSOR_DEFAULT_N);
        btnToggle.textContent = '센서 숨김';
      } else {
        removeAllSensors();
        btnToggle.textContent = '센서 보기';
      }
    });
  }

  // 검색: ble_id > (API) pillar_id > (WFS) bldg_id > 기둥 로드 > 센서 표시 + 강조
  if (btnSearch && inpBle) {
    btnSearch.addEventListener('click', async () => {
      const v = inpBle.value.trim();
      if (!v) return;
      const bleId = Number(v);
      if (Number.isNaN(bleId)) {
        alert('BLE ID 형식이 아닙니다.');
        return;
      }
      try {
        await searchBleAndShow(bleId, SENSOR_DEFAULT_N);
      } catch (e) {
        console.warn('[btnSearchBle] unhandled', e);
        alert('검색 처리 중 오류가 발생했습니다.');
      }
      if (btnToggle) btnToggle.textContent = '센서 숨김';
    });
  }
}

async function lookupByBle(bleId) {
  const detail = await fetchSensorDetail(bleId);
  if (!detail) return null;
  const pillar_id = detail.pillar_id;

  const bldg_id = await fetchBldgIdByPillar(pillar_id);
  if (!bldg_id) return null;

  return { pillar_id, bldg_id };
}

window.__bleScanner = {
  ...(window.__bleScanner || {}),
  showSensorsForCurrentPillars,
  removeAllSensors,
  searchBleAndShow,
  lookupByBle,
};