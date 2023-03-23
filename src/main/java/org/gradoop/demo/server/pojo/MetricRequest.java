package org.gradoop.demo.server.pojo;

import org.codehaus.jackson.annotate.JsonIgnore;
import org.gradoop.temporal.model.impl.pojo.TemporalVertex;

import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;

/**
 * The representation of the metric configuration.
 */
public class MetricRequest {

    private String dbName;

    private String metric;

    private String predicate;

    private String timestamp1;

    private String timestamp2;

    private String[] filters;
    @JsonIgnore
    private ArrayList<TemporalVertex> vertices;

    @JsonIgnore
    private DateTimeFormatter formatter = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    public String getDbName() {
        return dbName;
    }

    public void setDbName(String dbName) {
        this.dbName = dbName;
    }

    public String getMetric() {
        return metric;
    }

    public void setMetric(String metric) {
        this.metric = metric;
    }

    public String getPredicate() {
        return predicate;
    }

    public void setPredicate(String predicate) {
        this.predicate = predicate;
    }

    public long getTimestamp1() {
        long timestamp1;
        long minTime = Long.MIN_VALUE;

        switch (this.predicate) {
            case "asOf":
            case "fromTo":
            case "betweenAnd":
                timestamp1 = getUnixEpoch(this.timestamp1);
                break;
            case "all":
            default:
                timestamp1 = minTime;
                break;

        }

        return timestamp1;
    }

    public long getTimestamp2() {
        long timestamp2;
        long maxTime = Long.MAX_VALUE;

        switch (this.predicate) {
            case "fromTo":
            case "betweenAnd":
                timestamp2 = getUnixEpoch(this.timestamp2);
                break;
            case "asOf":
            case "all":
            default:
                timestamp2 = maxTime;
                break;

        }

        return timestamp2;
    }

    public void setTimestamp1(String timestamp1) {
        this.timestamp1 = timestamp1;
    }


    public void setTimestamp2(String timestamp2) {
        this.timestamp2 = timestamp2;
    }

    public String[] getFilters() {

        return this.filters;
    }

    public ArrayList<TemporalVertex> getVertices() {

        return this.vertices;
    }

    public void setFilters(String[] filters) {
        this.filters = filters;
    }

    public void setVertices(ArrayList vertices) {
        this.vertices = vertices;
    }

    private long getUnixEpoch(String timestamp) {
        LocalDateTime time1 = LocalDateTime.parse(timestamp, formatter);

        return time1.toInstant(ZoneOffset.UTC).toEpochMilli();
    }

    public boolean allVertices() {
        boolean allVertices = true;

        if (this.filters.length > 0) {
            allVertices = false;
        }

        return allVertices;
    }
}


