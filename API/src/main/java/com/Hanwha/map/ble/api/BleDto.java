package com.Hanwha.map.ble.api;

public class BleDto {
    public String ble_id;
    public int pillar_id;
    public int line;

    public BleDto(String ble_id, int pillar_id, int line) {
        this.ble_id = ble_id;
        this.pillar_id = pillar_id;
        this.line = line;
    }
}
