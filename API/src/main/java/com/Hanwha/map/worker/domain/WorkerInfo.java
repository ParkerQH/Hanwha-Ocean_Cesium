package com.Hanwha.map.worker.domain;

public class WorkerInfo {
    private String bldg_id;
    private String name;
    private String driver;
    private String driverId;
    private String driverPhone;
    private String manager;
    private String managerId;
    private String managerPhone;

    public String getBldg_id() {
        return bldg_id;
    }

    public String getName() {
        return name;
    }

    public String getDriver() {
        return driver;
    }

    public String getDriverId() {
        return driverId;
    }

    public String getDriverPhone() {
        return driverPhone;
    }

    public String getManager() {
        return manager;
    }

    public String getManagerId() {
        return managerId;

    }

    public String getManagerPhone() {
        return managerPhone;
    }

    public void setBldg_id(String bldg_id) {
        this.bldg_id = bldg_id;
    }

    public void setName(String name) {
        this.name = name;
    }

    public void setDriver(String driver) {
        this.driver = driver;
    }

    public void setDriverId(String driverId) {
        this.driverId = driverId;
    }

    public void setDriverPhone(String driverPhone) {
        this.driverPhone = driverPhone;
    }

    public void setManager(String manager) {
        this.manager = manager;
    }

    public void setManagerId(String managerId) {
        this.managerId = managerId;
    }

    public void setManagerPhone(String managerPhone) {
        this.managerPhone = managerPhone;
    }
}
