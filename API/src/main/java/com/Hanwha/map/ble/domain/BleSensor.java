package com.Hanwha.map.ble.domain;

import jakarta.persistence.*;;

@Entity
@Table(name = "ble")
public class BleSensor {

    @Id
    @Column(name = "ble_id", nullable = false)
    private String bleId;

    @Column(name = "pillar_id", nullable = false)
    private Integer pillarId;

    @Column(name = "line", nullable = false)
    private Integer line;

    public String getBleId() {
        return bleId;
    }

    public Integer getPillarId() {
        return pillarId;
    }

    public Integer getLine() {
        return line;
    }

    public void setBleId(String bleId) {
        this.bleId = bleId;
    }

    public void setPillarId(Integer pillarId) {
        this.pillarId = pillarId;
    }

    public void setLine(Integer line) {
        this.line = line;
    }

}
