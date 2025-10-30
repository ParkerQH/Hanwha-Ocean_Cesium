package com.Hanwha.map.worker.service;

import com.Hanwha.map.worker.domain.WorkerInfo;
import com.Hanwha.map.worker.repo.WorkerInfoRepository;
import org.springframework.stereotype.Service;

import java.util.*;

@Service
public class WorkerInfoService {
    private final WorkerInfoRepository repo;

    public WorkerInfoService(WorkerInfoRepository repo) {
        this.repo = repo;
    }

    public Optional<WorkerInfo> getOne(String bldgId) {
        return repo.findByBldgId(bldgId);
    }
}
