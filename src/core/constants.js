// 공용 상수/레이어/기본값
export const LAYERS = {
    COLUMN: "columns",
    HIGHLIGHT: "problemHighlight",
    SENSOR: "bleSensor",
    HALO: "sensorHalo",
    RAIL: "rail"
};

export const DEFAULTS = {
    EXTRUDED_HEIGHT: 10,    // 기둥 높이
    HIGHLIGHT_HEIGHT: 10,   // 강조 기둥 높이
    SENSOR_RADIUS: 0.3,     // 센서 반지름
    SENSOR_N: 3,            // 기둥 높이 기둥 / N
    SENSOR_OFFSET: 0,       // 기둥 면으로 부터 중심 좌표 거리
    RAIL_BASE_HEIGHT: 10,   // 레일 위치 Z좌표
    RAIL_WIDTH_M: 1.0,      // 레일 폭
    RAIL_THICKNESS: 0.5,    // 레일 두께(높이)
    // GLB 배치
    CRANE_HEIGHT: 10.5,     // 오리진 높이(고정)
    CRANE_BASE_SCALE: 1,    // 원본 전체 배율
    CRANE_NATIVE_SPAN_M: 30.0,   // glTF 모델의 원본 길이
};

// 크레인 모델 경로 상수
export const MODELS = {
    OVERHEAD_CRANE_URI: new URL("../service/Overhead_Crane01.glb", import.meta.url).href,
};

export const WFS = {
    BASE: "/geoserver/HanWha_map/ows",
    TYPENAME: "HanWha_map:polygon_data",
    SRS: "EPSG:4326",
};

export const WFS_TYPES = {
    COLUMNS: "HanWha_map:polygon_data",
    RAIL_LINE: "HanWha_map:rail_line",
};

export const API = {
    SENSORS_BY_PILLARS: (csv) => `/api/ble/by_pillars?pillar_ids=${encodeURIComponent(csv)}`,
    SENSOR_DETAIL: (id) => `/api/ble/detail?ble_id=${encodeURIComponent(id)}`,
    WORKER_INFO: (bldg) => `/api/worker/${bldg}`,
    CHECK_LOG_CREATE: `/api/check_log`,
};
