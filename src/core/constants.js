// 공용 상수/레이어/기본값
export const LAYERS = {
    COLUMN: "columns",
    HIGHLIGHT: "problemHighlight",
    SENSOR: "bleSensor",
    HALO: "sensorHalo",
};

export const DEFAULTS = {
    EXTRUDED_HEIGHT: 10,  // 기둥 높이
    HIGHLIGHT_HEIGHT: 15, // 강조 기둥 높이
    SENSOR_RADIUS: 0.3,   // 센서 반지름
    SENSOR_N: 3,          // 기둥 높이 기둥 / N
    SENSOR_OFFSET: 0,     // 기둥 면으로 부터 중심 좌표 거리
};

export const WFS = {
    BASE: "/geoserver/HanWha_map/ows",
    TYPENAME: "HanWha_map:polygon_data",
    SRS: "EPSG:4326",
};

export const API = {
    SENSORS_BY_PILLARS: (csv) => `/api/ble/by_pillars?pillar_ids=${encodeURIComponent(csv)}`,
    SENSOR_DETAIL: (id) => `/api/ble/detail?ble_id=${encodeURIComponent(id)}`,
};
