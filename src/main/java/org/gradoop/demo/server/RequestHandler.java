/*
 * Copyright © 2014 - 2021 Leipzig University (Database Research Group)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
package org.gradoop.demo.server;

import org.apache.flink.api.common.functions.FlatMapFunction;
import org.apache.flink.api.common.functions.GroupReduceFunction;
import org.apache.flink.api.common.functions.MapFunction;
import org.apache.flink.api.common.functions.MapPartitionFunction;
import org.apache.flink.api.java.ExecutionEnvironment;
import org.apache.flink.api.java.io.LocalCollectionOutputFormat;
import org.apache.flink.api.java.tuple.Tuple;
import org.apache.flink.api.java.tuple.Tuple2;
import org.apache.flink.api.java.tuple.Tuple3;
import org.apache.flink.util.Collector;
import org.codehaus.jettison.json.JSONArray;
import org.codehaus.jettison.json.JSONException;
import org.codehaus.jettison.json.JSONObject;
import org.gradoop.common.model.impl.id.GradoopId;
import org.gradoop.demo.server.functions.*;
import org.gradoop.demo.server.pojo.*;
import org.gradoop.flink.model.api.functions.AggregateFunction;
import org.gradoop.flink.model.api.functions.KeyFunction;
import org.gradoop.flink.model.api.functions.KeyFunctionWithDefaultValue;
import org.gradoop.flink.model.impl.operators.aggregation.functions.average.AverageProperty;
import org.gradoop.flink.model.impl.operators.aggregation.functions.count.Count;
import org.gradoop.flink.model.impl.operators.aggregation.functions.max.MaxProperty;
import org.gradoop.flink.model.impl.operators.aggregation.functions.max.MaxVertexProperty;
import org.gradoop.flink.model.impl.operators.aggregation.functions.min.MinProperty;
import org.gradoop.flink.model.impl.operators.aggregation.functions.min.MinVertexProperty;
import org.gradoop.flink.model.impl.operators.aggregation.functions.sum.SumProperty;
import org.gradoop.flink.model.impl.operators.keyedgrouping.GroupingKeys;
import org.gradoop.flink.model.impl.operators.keyedgrouping.KeyedGrouping;
import org.gradoop.flink.model.impl.operators.keyedgrouping.labelspecific.LabelSpecificKeyFunction;
import org.gradoop.flink.model.impl.operators.sampling.functions.VertexDegree;
import org.gradoop.temporal.io.impl.csv.TemporalCSVDataSource;
import org.gradoop.temporal.model.api.TimeDimension;
import org.gradoop.temporal.model.api.functions.TemporalPredicate;
import org.gradoop.temporal.model.impl.TemporalGraph;
import org.gradoop.temporal.model.impl.functions.predicates.All;
import org.gradoop.temporal.model.impl.functions.predicates.AsOf;
import org.gradoop.temporal.model.impl.functions.predicates.Between;
import org.gradoop.temporal.model.impl.functions.predicates.FromTo;
import org.gradoop.temporal.model.impl.operators.aggregation.functions.AverageDuration;
import org.gradoop.temporal.model.impl.operators.aggregation.functions.MaxDuration;
import org.gradoop.temporal.model.impl.operators.aggregation.functions.MinDuration;
import org.gradoop.temporal.model.impl.operators.keyedgrouping.TemporalGroupingKeys;
import org.gradoop.temporal.model.impl.operators.metric.*;
import org.gradoop.temporal.model.impl.pojo.TemporalEdge;
import org.gradoop.temporal.model.impl.pojo.TemporalElement;
import org.gradoop.temporal.model.impl.pojo.TemporalGraphHead;
import org.gradoop.temporal.model.impl.pojo.TemporalVertex;
import org.gradoop.temporal.util.TemporalGradoopConfig;
import org.apache.flink.api.java.tuple.Tuple4;
import org.apache.flink.api.java.DataSet;

import javax.ws.rs.GET;
import javax.ws.rs.POST;
import javax.ws.rs.Path;
import javax.ws.rs.PathParam;
import javax.ws.rs.Produces;
import javax.ws.rs.core.MediaType;
import javax.ws.rs.core.Response;
import javax.ws.rs.core.StreamingOutput;
import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.text.DateFormat;
import java.text.SimpleDateFormat;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoField;
import java.time.temporal.ChronoUnit;
import java.time.temporal.TemporalField;
import java.time.temporal.TemporalUnit;
import java.util.*;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.stream.Collectors;
import java.util.stream.StreamSupport;

import static org.gradoop.flink.model.impl.operators.keyedgrouping.GroupingKeys.label;

/**
 * Handles REST requests to the server.
 */
@Path("")
public class RequestHandler {

    /**
     * Aggregate literals.
     */
    public static final String MIN_LAT = "min_lat";
    public static final String MAX_LAT = "max_lat";
    public static final String MIN_LONG = "min_long";
    public static final String MAX_LONG = "max_long";

    /**
     * The used formatter to format long timestamps.
     */
    private static final DateFormat FORMATTER = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss");

    static {
        FORMATTER.setTimeZone(TimeZone.getTimeZone("UTC"));
    }

    /**
     * The Flink execution environment.
     */
    private static final ExecutionEnvironment ENV = ExecutionEnvironment.createLocalEnvironment();

    /**
     * The gradoop config.
     */
    private final TemporalGradoopConfig temporalConfig = TemporalGradoopConfig.createConfig(ENV);

    /**
     * The filename of the metadata json.
     */
    private final String META_FILENAME = "metadata.json";

    /**
     * Takes a database name via a POST request and returns the keys of all
     * vertex and edge properties, and a boolean value specifying if the property has a numerical
     * type. The return is a string in the JSON format, for easy usage in a JavaScript web page.
     *
     * @param databaseName name of the loaded database
     * @return A JSON containing the vertices and edges property keys
     */
    @POST
    @Path("/keys/{databaseName}")
    @Produces("application/json;charset=utf-8")
    public Response getKeysAndLabels(@PathParam("databaseName") String databaseName) {
        URL meta = RequestHandler.class.getResource(String.format("/data/%s/%s", databaseName, META_FILENAME));
        try {
            if (meta == null) {
                JSONObject result = computeKeysAndLabels(databaseName);
                if (result == null) {
                    return Response.serverError().build();
                }
                return Response.ok(result.toString()).build();
            } else {
                return Response.ok(readKeysAndLabels(databaseName).toString()).build();
            }
        } catch (Exception e) {
            e.printStackTrace();
            // if any exception is thrown, return an error to the client
            return Response.serverError().build();
        }
    }

    @GET
    @Path("/graphs")
    @Produces("application/json;charset=utf-8")
    public Response getGraphs() {
        final URL resource = RequestHandler.class.getResource("/data");
        JSONArray result = new JSONArray();

        String path = resource.getPath();

        for (File current : Objects.requireNonNull(new File(path).listFiles())) {
            if (current.isDirectory()) {
                result.put(current.getName());
            }
        }
        return Response.ok(result.toString()).build();
    }

    /**
     * Get the complete graph in eChars-conform form.
     *
     * @param databaseName name of the database
     * @return Response containing the graph as a JSON, in eCharts conform format.
     * @throws JSONException if JSON creation fails
     * @throws IOException   if reading fails
     */
    @POST
    @Path("/graph/{databaseName}")
    @Produces("application/json;charset=utf-8")
    public Response getGraph(@PathParam("databaseName") String databaseName) throws Exception {
        String path = RequestHandler.class.getResource("/data/" + databaseName).getPath();

        TemporalCSVDataSource source = new TemporalCSVDataSource(path, temporalConfig);
        TemporalGraph graph = source.getTemporalGraph();
        String json = EChartsJSONBuilder.getJSONString(
                graph.getGraphHead().collect(),
                graph.getVertices().collect(),
                graph.getEdges().collect());

        return Response.ok(json).build();
    }

    /**
     * Applies a key-based grouping.
     *
     * @param request the grouping configuration
     * @return Response containing the graph as a JSON, in eCharts conform format.
     */
    @POST
    @Path("/keyedgrouping")
    @Produces("application/json;charset=utf-8")
    public Response getData(KeyedGroupingRequest request) {
        String databaseName = request.getDbName();

        String path = RequestHandler.class.getResource("/data/" + databaseName).getPath();

        List<KeyFunction<TemporalVertex, ?>> vertexKeyFunctions = new ArrayList<>();
        List<KeyFunction<TemporalEdge, ?>> edgeKeyFunctions = new ArrayList<>();
        List<AggregateFunction> vertexAggregates = new ArrayList<>();
        List<AggregateFunction> edgeAggregates = new ArrayList<>();

        Map<String, List<KeyFunctionWithDefaultValue<TemporalVertex, ?>>> labelSpecVertexKeys = new HashMap<>();
        Map<String, List<KeyFunctionWithDefaultValue<TemporalEdge, ?>>> labelSpecEdgeKeys = new HashMap<>();

        for (KeyFunctionArguments keyFunction : request.getKeyFunctions()) {
            if (keyFunction.getLabelspec() != null && !keyFunction.getLabelspec().equals("no")) {
                if (keyFunction.getType().equals("vertex")) {
                    if (labelSpecVertexKeys.containsKey(keyFunction.getLabelspec())) {
                        labelSpecVertexKeys.get(keyFunction.getLabelspec()).add(getKeyFunction(keyFunction));
                    } else {
                        labelSpecVertexKeys.put(LabelSpecificKeyFunction.DEFAULT_GROUP_LABEL, Collections.singletonList(label()));
                        ArrayList<KeyFunctionWithDefaultValue<TemporalVertex, ?>> keyFunctionsForLabel = new ArrayList<>();
                        keyFunctionsForLabel.add(getKeyFunction(keyFunction));
                        labelSpecVertexKeys.put(keyFunction.getLabelspec(), keyFunctionsForLabel);
                    }
                } else if (keyFunction.getType().equals("edge")) {
                    if (labelSpecEdgeKeys.containsKey(keyFunction.getLabelspec())) {
                        labelSpecEdgeKeys.get(keyFunction.getLabelspec()).add(getKeyFunction(keyFunction));
                    } else {
                        labelSpecEdgeKeys.put(LabelSpecificKeyFunction.DEFAULT_GROUP_LABEL, Collections.singletonList(label()));
                        ArrayList<KeyFunctionWithDefaultValue<TemporalEdge, ?>> keyFunctionsForLabel = new ArrayList<>();
                        keyFunctionsForLabel.add(getKeyFunction(keyFunction));
                        labelSpecEdgeKeys.put(keyFunction.getLabelspec(), keyFunctionsForLabel);
                    }
                }
            }
        }

        // add the label specific keys to the grouping keys
        if (!labelSpecVertexKeys.isEmpty()) {
            vertexKeyFunctions.add(GroupingKeys.labelSpecific(labelSpecVertexKeys));
        }
        if (!labelSpecEdgeKeys.isEmpty()) {
            edgeKeyFunctions.add(GroupingKeys.labelSpecific(labelSpecEdgeKeys));
        }

        for (KeyFunctionArguments keyFunction : request.getKeyFunctions()) {
            if (keyFunction.getLabelspec() != null && !keyFunction.getLabelspec().equals("no")) {
                continue;
            }
            if (keyFunction.getType().equals("vertex")) {
                // We have a vertex key function
                vertexKeyFunctions.add(getKeyFunction(keyFunction));
            } else if (keyFunction.getType().equals("edge")) {
                // We have a edge key function
                edgeKeyFunctions.add(getKeyFunction(keyFunction));
            } else {
                return Response
                        .serverError()
                        .type(MediaType.TEXT_HTML_TYPE)
                        .entity("A key function found with a element type other than [vertex,edge].")
                        .build();
            }
        }

        for (AggFunctionArguments aggFunction : request.getAggFunctions()) {
            if (aggFunction.getType().equals("vertex")) {
                // We have a vertex agg function
                addAggFunctionToList(vertexAggregates, aggFunction);
            } else if (aggFunction.getType().equals("edge")) {
                // We have an edge agg function
                addAggFunctionToList(edgeAggregates, aggFunction);
            } else {
                return Response
                        .serverError()
                        .type(MediaType.TEXT_HTML_TYPE)
                        .entity("A aggregate function found with a element type other than [vertex,edge].")
                        .build();
            }
        }

        TemporalCSVDataSource source = new TemporalCSVDataSource(path, temporalConfig);

        TemporalGraph graph = source.getTemporalGraph();

        // If no edges are requested, remove them as early as possible.
        if (request.getFilterAllEdges()) {
            graph = graph.subgraph(new LabelFilter<>(request.getVertexFilters()),
                    new AcceptNoneFilter<>());
        } else {
            graph = graph.subgraph(new LabelFilter<>(request.getVertexFilters()),
                    new LabelFilter<>(request.getEdgeFilters()));
        }

        graph = graph.callForGraph(
                new KeyedGrouping<>(vertexKeyFunctions, vertexAggregates, edgeKeyFunctions, edgeAggregates));

        return createResponse(graph);
    }

    /**
     * Applies the snapshot operator.
     *
     * @param request the configuration of the snapshot operator.
     * @return Response containing the graph as a JSON, in eCharts conform format.
     */
    @POST
    @Path("/snapshot")
    @Produces("application/json;charset=utf-8")
    public Response getData(SnapshotRequest request) {

        //load the database
        String databaseName = request.getDbName();

        String path = RequestHandler.class.getResource("/data/" + databaseName).getPath();

        TemporalCSVDataSource source = new TemporalCSVDataSource(path, temporalConfig);

        TemporalGraph graph = source.getTemporalGraph();

        DateTimeFormatter formatter = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

        LocalDateTime time1 = LocalDateTime.parse(request.getTimestamp1(), formatter);
        LocalDateTime time2 = LocalDateTime.parse(request.getTimestamp2(), formatter);

        TemporalPredicate predicate;

        switch (request.getPredicate()) {
            case "asOf":
                predicate = new AsOf(time1);
                break;
            case "fromTo":
                predicate = new FromTo(time1, time2);
                break;
            case "betweenAnd":
                predicate = new Between(time1, time2);
                break;
            case "all":
            default:
                predicate = new All();
                break;

        }

        TimeDimension timeDimension;

        switch (request.getDimension()) {
            case "tx":
                timeDimension = TimeDimension.TRANSACTION_TIME;
                break;
            case "val":
            default:
                timeDimension = TimeDimension.VALID_TIME;
        }

        graph = graph.snapshot(predicate, timeDimension);

        return createResponse(graph);
    }

    /**
     * Applies the difference operator.
     *
     * @param request the configuration of the difference operator.
     * @return Response containing the graph as a JSON, in eCharts conform format.
     */
    @POST
    @Path("/difference")
    @Produces("application/json;charset=utf-8")
    public Response getData(DifferenceRequest request) throws Exception {

        //load the database
        String databaseName = request.getDbName();

        String path = RequestHandler.class.getResource("/data/" + databaseName).getPath();

        TemporalCSVDataSource source = new TemporalCSVDataSource(path, temporalConfig);

        TemporalGraph graph = source.getTemporalGraph();

        DateTimeFormatter formatter = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

        LocalDateTime time11 = LocalDateTime.parse(request.getTimestamp11(), formatter);
        LocalDateTime time12 = LocalDateTime.parse(request.getTimestamp12(), formatter);

        LocalDateTime time21 = LocalDateTime.parse(request.getTimestamp21(), formatter);
        LocalDateTime time22 = LocalDateTime.parse(request.getTimestamp22(), formatter);

        TemporalPredicate firstPredicate;

        switch (request.getFirstPredicate()) {
            case "asOf":
                firstPredicate = new AsOf(time11);
                break;
            case "fromTo":
                firstPredicate = new FromTo(time11, time12);
                break;
            case "betweenAnd":
                firstPredicate = new Between(time11, time12);
                break;
            case "all":
            default:
                firstPredicate = new All();
                break;
        }

        TemporalPredicate secondPredicate;

        switch (request.getSecondPredicate()) {
            case "asOf":
                secondPredicate = new AsOf(time21);
                break;
            case "fromTo":
                secondPredicate = new FromTo(time21, time22);
                break;
            case "betweenAnd":
                secondPredicate = new Between(time21, time22);
                break;
            case "all":
            default:
                secondPredicate = new All();
                break;
        }

        TimeDimension timeDimension;

        switch (request.getDimension()) {
            case "tx":
                timeDimension = TimeDimension.TRANSACTION_TIME;
                break;
            case "val":
            default:
                timeDimension = TimeDimension.VALID_TIME;
        }

        graph = graph.diff(firstPredicate, secondPredicate, timeDimension);

        return createResponse(graph);
    }

    /**
     * Get Vertices with their labels from given temporal graph dataset.
     *
     * @param database the dataset from which the vertices are determined
     * @return stream of vertices with their labels
     */
    @GET
    @Path("/vertices/{database}")
    @Produces("application/json;charset=utf-8")
    public Response getVertices(@PathParam("database") String database) throws Exception {
        String path = Objects.requireNonNull(RequestHandler.class.getResource("/data/" + database)).getPath();

        TemporalCSVDataSource source = new TemporalCSVDataSource(path, temporalConfig);
        TemporalGraph graph = source.getTemporalGraph();

        ConcurrentLinkedQueue<String> labelsAndVertices = new ConcurrentLinkedQueue<>();
        final int threshold = 1000;

        graph.getVertices()
                .groupBy(TemporalVertex::getLabel)
                .reduceGroup(new GroupReduceFunction<TemporalVertex, String>() {
                    @Override
                    public void reduce(Iterable<TemporalVertex> verticesWithSameLabel, Collector<String> out) throws Exception {
                        String label = "";
                        List<String> verticesByLabel = new ArrayList<>();
                        String temp2;
                        for (TemporalVertex vertex : verticesWithSameLabel) {
                            label = vertex.getLabel();

                            try {
                                temp2 = "{";
                                temp2 += "\"label\":\"" + (vertex.getPropertyValue("name") != null ?
                                        vertex.getPropertyValue("name").toString() : vertex.getId().toString()) + "\"";
                                temp2 += ",\"value\":\"" + vertex.getId() + "\"";
                                temp2 += "}";
                            } catch (Exception e) {
                                throw new RuntimeException(e);
                            }

                            verticesByLabel.add(temp2);
                        }
                        String labelAndVertices2;
                        if (verticesByLabel.size() > threshold) {
                            int batchCount = (int) Math.ceil((double) verticesByLabel.size() / threshold);

                            for (int i = 0; i < batchCount; i++) {
                                int fromIndex = i * threshold;
                                int toIndex = Math.min(fromIndex + threshold, verticesByLabel.size());
                                List<String> batch = verticesByLabel.subList(fromIndex, toIndex);

                                labelAndVertices2 = "{\"label\":\"" + label + "\"";
                                labelAndVertices2 += ",\"options\":" + batch + "}";

                                out.collect(labelAndVertices2);
                            }
                        } else {
                            labelAndVertices2 = "{\"label\":\"" + label + "\"";
                            labelAndVertices2 += ",\"options\":" + verticesByLabel + "}";

                            out.collect(labelAndVertices2);
                        }
                    }
                })
                .output(new LocalCollectionOutputFormat<>(labelsAndVertices)); // Sammle alle Gruppen in ein JSONArray


        StreamingOutput stream = out -> {
            try {
                String result = "[";
                boolean firstEntry = true;

                while (!labelsAndVertices.isEmpty()) {
                    if (!firstEntry) {
                        result += ",";
                    }

                    result += labelsAndVertices.poll();
                    firstEntry = false;


                    if (result.length() > 10000) {
                        if (labelsAndVertices.isEmpty())
                            result += "]";

                        out.write(result.getBytes(StandardCharsets.UTF_8));
                        result = "";
                    }
                }
                if (result.length() > 0) {

                    result += "]";
                    out.write(result.getBytes(StandardCharsets.UTF_8));
                }
            } catch (Exception e) {
                e.printStackTrace();
            }
        };

        try {
            ENV.execute();

            return Response.ok(stream).build();

        } catch (Exception e) {

            e.printStackTrace();
            return Response.serverError().build();
        }

    }

    /**
     * Get the metric evolution by a given configuration.
     *
     * @param request the configuration
     * @return metric evolution with meta information in JSON
     */
    @POST
    @Path("/metric")
    @Produces("application/json;charset=utf-8")
    public Response getMetric(MetricRequest request) throws Exception {

        String metric = request.getMetric();
        Response response;

        //get temporal graph
        String path = Objects.requireNonNull(RequestHandler.class.getResource("/data/" + request.getDbName())).getPath();
        TemporalCSVDataSource source = new TemporalCSVDataSource(path, temporalConfig);


        TemporalGraph temporalGraph;

        //reduce graph by edges of filtered nodes
        if (request.getFilters().length > 0) {
            temporalGraph = source.getTemporalGraph().edgeInducedSubgraph(new EdgeFilter<>(request.getFilters()));

        } else {
            temporalGraph = source.getTemporalGraph();
        }


        TemporalGraph filteredGraph;

        switch (request.getPredicate()) {
            case "asOf":
                filteredGraph = temporalGraph.asOf(request.getTimestamp1());
                break;
            case "fromTo":
                filteredGraph = temporalGraph.fromTo(request.getTimestamp1(), request.getTimestamp2());
                break;
            case "betweenAnd":
                filteredGraph = temporalGraph.between(request.getTimestamp1(), request.getTimestamp2());
                break;
            default:
                filteredGraph = temporalGraph;
        }


        if (metric.contains("degree")) {
            response = metricDegree(filteredGraph, request);
        } else {
            response = null;
        }

        return response;
    }

    /**
     * Get the degree metric on vertices of a temporal graph.
     *
     * @param filteredGraph the configured graph to calculate the metric on
     * @param request       the requested configuration
     * @return degree evolution with meta information in JSON
     */
    private Response metricDegree(TemporalGraph filteredGraph, MetricRequest request) throws Exception {

        String TIME_DIMENSION = "VALID_TIME";
        TimeDimension timeDimension = TimeDimension.valueOf(TIME_DIMENSION);


        String DEGREE_TYPE;
        String metric = request.getMetric();

        switch (metric) {
            case "OUT degree":
                DEGREE_TYPE = "OUT";
                break;
            case "BOTH degree":
                DEGREE_TYPE = "BOTH";
                break;
            default:
                DEGREE_TYPE = "IN";
        }

        VertexDegree degreeType = VertexDegree.valueOf(DEGREE_TYPE);


        //apply degree operator
        TemporalVertexDegree operator = new TemporalVertexDegree(degreeType, timeDimension);
        DataSet<Tuple4<GradoopId, Long, Long, Integer>> degreeMetrics = filteredGraph.callForValue(operator);


        //get all GradoopIDs
        DataSet<TemporalVertex> filteredVertices;

        if (request.getFilters().length > 0) {
            List<String> requestFilters = Arrays.asList(request.getFilters());
            filteredVertices = filteredGraph.getVertices().filter(vertex -> requestFilters.contains(vertex.getId().toString()));

        } else {
            filteredVertices = filteredGraph.getVertices();

        }


        return calcMetricDegree(degreeMetrics, filteredVertices, filteredGraph, degreeType, timeDimension, request);

    }

    /**
     * Calculate the degree metric on vertices of a temporal graph.
     *
     * @param resultVertexMetrics the metric evolution as flink dataset
     * @param vertices            the vertices of the temporal graph
     * @param graph               the temporal graph
     * @param degreeType          the degree type
     * @param timeDimension       the time dimension
     * @param request             the requested configuration
     * @return degree evolution with meta information in JSON
     */
    private Response calcMetricDegree(DataSet<Tuple4<GradoopId, Long, Long, Integer>> resultVertexMetrics,
                                      DataSet<TemporalVertex> vertices,
                                      TemporalGraph graph,
                                      VertexDegree degreeType,
                                      TimeDimension timeDimension,
                                      MetricRequest request) throws Exception {

        long numOfSamples = 1000L; //number of timestamps 

        List<TemporalVertex> requestedVertices = vertices.collect();
        List<GradoopId> requestedVerticesId = requestedVertices.stream().map(TemporalVertex::getId).collect(Collectors.toList());


        List<Metric> metrics = resultVertexMetrics
                .filter(metric -> requestedVerticesId.contains(metric.f0))
                .map(metricTuple -> {
                    Metric metric;
                    if (metricTuple != null) {
                        metric = new Metric(metricTuple.f0, metricTuple.f1, metricTuple.f2, metricTuple.f3);

                    } else {
                        metric = null;
                    }
                    return metric;
                })
                .filter(Objects::nonNull)
                .collect()
                .stream()
                .sorted(Comparator.comparing(Metric::getFrom))
                .collect(Collectors.toList());


        List<GradoopId> metricVertexIds = metrics.stream().map(Metric::getId).distinct().collect(Collectors.toList());
        List<TemporalVertex> filteredVertices = requestedVertices.stream().filter(vertex -> !metricVertexIds.isEmpty() && metricVertexIds.contains(vertex.getId())).collect(Collectors.toList());


        long firstTime = getFirstTimestamp(filteredVertices, metrics) - 1;
        long lastTime = getLastTimestamp(filteredVertices, metrics) + 1;

        JSONObject centricDegreeValues = centricDegree(graph, degreeType, timeDimension, filteredVertices, firstTime, lastTime);
        JSONArray metricData = getMetricEvolution(metrics, firstTime, lastTime, getGranularity(firstTime, lastTime, 1000));


        try {
            // build the response JSON from the collections
            String json = EChartsJSONBuilder.getMetricJSON(metricData, filteredVertices, centricDegreeValues, request);
            return Response.ok(json).build();

        } catch (Exception e) {
            e.printStackTrace();
            // if any exception is thrown, return an error to the client
            return Response.serverError().build();
        }

    }

    /**
     * Get first change of a given metric interval.
     *
     * @param vertices list of temporal vertices to be considered
     * @param metrics  metric evolution
     * @return first change in UNIX Epoch milliseconds
     */
    private long getFirstTimestamp(List<TemporalVertex> vertices, List<Metric> metrics) {
        long minTime = Long.MAX_VALUE;
        boolean found;

        for (TemporalVertex vertex : vertices) {
            found = false;

            for (int j = 0; j < metrics.size() && !found; j++) {

                if (vertex.getId().equals(metrics.get(j).getId())) {

                    if (metrics.get(j).getTo() < minTime) {
                        minTime = metrics.get(j).getTo();

                    }

                    found = true;

                }

            }

        }

        return minTime;
    }

    /**
     * Get last change of a given metric interval.
     *
     * @param vertices list of temporal vertices to be considered
     * @param metrics  metric evolution
     * @return last change in UNIX Epoch milliseconds
     */
    private long getLastTimestamp(List<TemporalVertex> vertices, List<Metric> metrics) {
        long maxTime = 0L;
        boolean found;


        for (TemporalVertex vertex : vertices) {
            found = false;

            for (int j = metrics.size() - 1; j >= 0 && !found; j--) {

                if (vertex.getId().equals(metrics.get(j).getId())) {

                    if (metrics.get(j).getFrom() > maxTime) {
                        maxTime = metrics.get(j).getFrom();

                    }
                    found = true;

                }

            }

        }


        return maxTime;
    }

    /**
     * Get step size of given interval for num timestamps.
     *
     * @param from first timestamp of interval
     * @param to   last timestamp of interval
     * @param num number of samples
     * @return dimension of a time step
     */
    private long getGranularity(long from, long to, long num) {
        long interval = to - from;
        return interval / num;
    }


    /**
     * Get the metric evolution as JSON.
     *
     * @param metrics the metric evolution
     * @param from    first timestamp of evolution
     * @param to      last timestamp of evolution
     * @param step    step size for virtual points
     * @return the metric evolution as JSON
     */
    private JSONArray getMetricEvolution(List<Metric> metrics, Long from, Long to, long step) throws JSONException {

    /* server side virtual data point calculation

    List<Metric> sampleList = new ArrayList<>();


    int length =  metrics.size();

    int counter = 0;
    int counter2 = 0;

    List<Metric> tempMetrics = new ArrayList<>();

    for(long i = from; i <= to; i += step){
      if(metrics.isEmpty())
        break;

      int j = 0;

      while(j < metrics.size()){
        Metric currentMetric = metrics.get(j);

        if(currentMetric.getFrom() > (i + step)){

          break;
        }

        if(!tempMetrics.contains(currentMetric)){
          tempMetrics.add(currentMetric);


          int l = 0;
          while (l < tempMetrics.size()) {

            if (metrics.get(l).getTo() > currentMetric.getFrom()) {
              long timestampFrom = tempMetrics.get(tempMetrics.size() - 1).getFrom() < from ? from : tempMetrics.get(tempMetrics.size() - 1).getFrom();
              sampleList.add(new Metric(tempMetrics.get(l).getId(), timestampFrom,
                      tempMetrics.get(l).getTo(), tempMetrics.get(l).getValue() ));
              counter++;
            } else {
              tempMetrics.remove(metrics.get(l));
              metrics.remove(metrics.get(l));

                l--;
                j--;


            }
            l++;
          }

        }

        if(currentMetric.getFrom() < i && currentMetric.getTo() > i){

          sampleList.add(new Metric(currentMetric.getId(), i, currentMetric.getTo(), currentMetric.getValue()));
          counter2++;


        }
        j++;
      }
      }


    */

        //change metrics stream to sampleList stream to enable server side virtual point calculation
        return new JSONArray(metrics.stream().map(vertex -> {
            JSONObject temp = new JSONObject();
            try {
                temp.put("vertex", vertex.getId());
                temp.put("from", vertex.getFrom());
                temp.put("to", vertex.getTo());
                temp.put("value", vertex.getValue());
            } catch (JSONException e) {
                throw new RuntimeException(e);
            }
            return temp;

        }).collect(Collectors.toList()));
    }


    /**
     * Calculate min/max/avg centric degree of a temporal graph for a given time interval.
     *
     * @param graph            temporal graph to calculate the metric on
     * @param degreeType       the degree type
     * @param timeDimension    the time dimension
     * @param temporalVertices vertices to be considered at calculation
     * @param from             first timestamp of interval
     * @param to               last timestamp of interval
     * @return min/max/avg centric degree as JSONObject
     */
    private JSONObject centricDegree(TemporalGraph graph, VertexDegree degreeType, TimeDimension timeDimension, List<TemporalVertex> temporalVertices, Long from, Long to) throws Exception {

        List<HashMap<String, Double>> vertexCentricDegrees = new ArrayList<>();

        for (TemporalVertex vertex : temporalVertices) {

            Long timestamp1 = vertex.getValidFrom() > from ? vertex.getValidFrom() : from;
            Long timestamp2 = vertex.getValidTo() < to ? vertex.getValidTo() : to;


            HashMap<String, Double> centricDegreeValue = vertexCentricDegree(graph, degreeType, timeDimension, vertex.getId(), timestamp1, timestamp2);

            if (!centricDegreeValue.isEmpty()) {

                vertexCentricDegrees.add(centricDegreeValue);
            }

        }

        JSONObject centricDegree = new JSONObject();

        if (vertexCentricDegrees.size() > 0) {
            Double min = vertexCentricDegrees.get(0).get("min");
            Double max = vertexCentricDegrees.get(0).get("max");
            Double avgSum = vertexCentricDegrees.get(0).get("avg");

            for (int i = 1; i < vertexCentricDegrees.size(); i++) {
                if (min > vertexCentricDegrees.get(i).get("min"))
                    min = vertexCentricDegrees.get(i).get("min");

                if (max < vertexCentricDegrees.get(i).get("max"))
                    max = vertexCentricDegrees.get(i).get("max");

                avgSum += vertexCentricDegrees.get(i).get("avg");

            }

            double avg = avgSum / (double) vertexCentricDegrees.size();

            centricDegree.put("min", min);
            centricDegree.put("max", max);
            centricDegree.put("avg", Math.round(avg * 100.0) / 100.0);
        }

        return centricDegree;
    }

    /**
     * Calculate min/max/avg centric degree of a temporal vertex for a given time interval.
     *
     * @param graph         temporal graph of the vertex
     * @param degreeType    the degree type
     * @param timeDimension the time dimension
     * @param gradoopId     Gradoop ID of the vertex
     * @param from          first timestamp of interval
     * @param to            last timestamp of interval
     * @return min/max/avg centric degree as HashMap
     */
    private HashMap<String, Double> vertexCentricDegree(TemporalGraph graph, VertexDegree degreeType, TimeDimension timeDimension, GradoopId gradoopId, Long from, Long to) throws Exception {
        HashMap<String, Double> vertexCentricDegreeValues = new HashMap<>();

        try {

            VertexCentricMinDegreeEvolution minOperator = new VertexCentricMinDegreeEvolution(degreeType,
                    timeDimension, gradoopId, from, to);
            vertexCentricDegreeValues.put("min", graph.callForValue(minOperator).collect().get(0).f0);

            VertexCentricMaxDegreeEvolution maxOperator = new VertexCentricMaxDegreeEvolution(degreeType,
                    timeDimension, gradoopId, from, to);
            vertexCentricDegreeValues.put("max", graph.callForValue(maxOperator).collect().get(0).f0);

            VertexCentricAverageDegreeEvolution avgOperator = new VertexCentricAverageDegreeEvolution(degreeType,
                    timeDimension, gradoopId, from, to);
            vertexCentricDegreeValues.put("avg", graph.callForValue(avgOperator).collect().get(0).f0);


        } catch (Exception e) {
            System.out.println("no data for vertex: " + gradoopId);
        }

        return vertexCentricDegreeValues;
    }

    /**
     * Creates the eCharts representation of the temporal graph used as response to the frontend.
     *
     * @param graph the graph to submit to the frontend
     * @return a Response as eCharts representation of the temporal graph
     */
    private Response createResponse(TemporalGraph graph) {
        List<TemporalGraphHead> resultHead = new ArrayList<>();
        List<TemporalVertex> resultVertices = new ArrayList<>();
        List<TemporalEdge> resultEdges = new ArrayList<>();

        graph.getGraphHead().output(new LocalCollectionOutputFormat<>(resultHead));
        graph.getVertices().output(new LocalCollectionOutputFormat<>(resultVertices));
        graph.getEdges().output(new LocalCollectionOutputFormat<>(resultEdges));

        try {
            ENV.execute();
            // build the response JSON from the collections
            String json = EChartsJSONBuilder.getJSONString(resultHead, resultVertices, resultEdges);
            return Response.ok(json).build();

        } catch (Exception e) {
            e.printStackTrace();
            // if any exception is thrown, return an error to the client
            return Response.serverError().build();
        }
    }

    /**
     * Compute property keys, labels and spatial bounds, if possible.
     *
     * @return JSONObject containing property keys and labels
     */
    private JSONObject computeKeysAndLabels(String databaseName) {
        String path = RequestHandler.class.getResource("/data/" + databaseName).getPath();

        TemporalCSVDataSource source = new TemporalCSVDataSource(path, temporalConfig);

        TemporalGraph graph = source.getTemporalGraph();

        JSONObject jsonObject = new JSONObject();

        try {
            jsonObject.put("vertexKeys", getVertexKeys(graph));
            jsonObject.put("edgeKeys", getEdgeKeys(graph));
            jsonObject.put("vertexLabels", getVertexLabels(graph));
            jsonObject.put("edgeLabels", getEdgeLabels(graph));
            jsonObject.put("spatialData", getSpatialData(graph));
            //String dataPath = RequestHandler.class.getResource(String.format("/data/%s/%s", databaseName, META_FILENAME))
            //.getFile();

            String testPath = "." + File.separator + "src" + File.separator + "main" + File.separator + "resources" + File.separator + "data" + File.separator + databaseName + File.separator + META_FILENAME;

            FileWriter writer = new FileWriter(testPath);
            jsonObject.write(writer);
            writer.flush();
            writer.close();

            return jsonObject;
        } catch (Exception e) {
            e.printStackTrace();
            // if any exception is thrown, return an error to the client
            return null;
        }
    }

    /**
     * Read the property keys and labels from the buffered JSON.
     *
     * @param databaseName name of the database
     * @return JSONObject containing the property keys and labels
     * @throws IOException        if reading fails
     * @throws JSONException      if JSON creation fails
     * @throws URISyntaxException if resource path is wrong
     */
    private JSONObject readKeysAndLabels(String databaseName) throws IOException, JSONException,
            URISyntaxException {
        URI dataPath = RequestHandler.class.getResource(String.format("/data/%s/%s", databaseName, META_FILENAME))
                .toURI();
        String content = new String(Files.readAllBytes(Paths.get(dataPath)), StandardCharsets.UTF_8);

        return new JSONObject(content);
    }

    /**
     * Takes any given graph and creates a JSONArray containing the vertex property keys and a boolean,
     * specifying it the property has a numerical type.
     *
     * @param graph input graph
     * @return JSON array with property keys and boolean, that is true if the property type is numerical
     * @throws Exception if the collecting of the distributed data fails
     */
    private JSONArray getVertexKeys(TemporalGraph graph) throws Exception {

        List<Tuple3<Set<String>, String, Boolean>> vertexKeys = graph.getVertices()
                .flatMap(new PropertyKeyMapper<>())
                .groupBy(1)
                .reduceGroup(new LabelGroupReducer())
                .collect();

        return buildArrayFromKeys(vertexKeys);
    }

    /**
     * Takes any given graph and creates a JSONArray containing the edge property keys and a boolean,
     * specifying it the property has a numerical type.
     *
     * @param graph input graph
     * @return JSON array with property keys and boolean, that is true if the property type is
     * numercial
     * @throws Exception if the collecting of the distributed data fails
     */
    private JSONArray getEdgeKeys(TemporalGraph graph) throws Exception {

        List<Tuple3<Set<String>, String, Boolean>> edgeKeys = graph.getEdges()
                .flatMap(new PropertyKeyMapper<>())
                .groupBy(1)
                .reduceGroup(new LabelGroupReducer())
                .collect();

        return buildArrayFromKeys(edgeKeys);
    }

    /**
     * Convenience method.
     * Takes a set of tuples of property keys and booleans, specifying if the property is numerical,
     * and creates a JSON array containing the same data.
     *
     * @param keys set of tuples of property keys and booleans, that are true if the property type
     *             is numerical
     * @return JSONArray containing the same data as the input
     * @throws JSONException if the construction of the JSON fails
     */
    private JSONArray buildArrayFromKeys(List<Tuple3<Set<String>, String, Boolean>> keys)
            throws JSONException {
        JSONArray keyArray = new JSONArray();
        for (Tuple3<Set<String>, String, Boolean> key : keys) {
            JSONObject keyObject = new JSONObject();
            JSONArray labels = new JSONArray();
            key.f0.forEach(labels::put);
            keyObject.put("labels", labels);
            keyObject.put("name", key.f1);
            keyObject.put("numerical", key.f2);
            keyArray.put(keyObject);
        }
        return keyArray;
    }

    /**
     * Compute the labels of the vertices.
     *
     * @param graph logical graph
     * @return JSONArray containing the vertex labels
     * @throws Exception if the computation fails
     */
    private JSONArray getVertexLabels(TemporalGraph graph) throws Exception {
        List<Set<String>> vertexLabels = graph.getVertices()
                .map(new LabelMapper<>())
                .reduce(new LabelReducer())
                .collect();

        if (vertexLabels.size() > 0) {
            return buildArrayFromLabels(vertexLabels.get(0));
        } else {
            return new JSONArray();
        }
    }

    /**
     * Compute the labels of the edges.
     *
     * @param graph logical graph
     * @return JSONArray containing the edge labels
     * @throws Exception if the computation fails
     */
    private JSONArray getEdgeLabels(TemporalGraph graph) throws Exception {
        List<Set<String>> edgeLabels = graph.getEdges()
                .map(new LabelMapper<>())
                .reduce(new LabelReducer())
                .collect();

        if (edgeLabels.size() > 0) {
            return buildArrayFromLabels(edgeLabels.get(0));
        } else {
            return new JSONArray();
        }
    }

    /**
     * Compute the spatial bounds of the graph.
     *
     * @param graph the graph used to aggregate the values
     * @return JSONObject containing the aggregated spatial data
     * @throws Exception if the computation fails
     */
    private JSONObject getSpatialData(TemporalGraph graph) throws Exception {
        graph = graph.aggregate(
                new MinVertexProperty("lat", MIN_LAT),
                new MaxVertexProperty("lat", MAX_LAT),
                new MinVertexProperty("long", MIN_LONG),
                new MaxVertexProperty("long", MAX_LONG));

        List<Tuple2<String, Double>> spatialData = graph.getGraphHead()
                .flatMap(new PropertyKeyValueMapper())
                .collect();

        JSONObject spatialDataObject = new JSONObject();

        spatialData.forEach(t -> {
            try {
                spatialDataObject.put(t.f0, t.f1);
            } catch (JSONException e) {
                e.printStackTrace();
            }
        });

        return spatialDataObject;
    }

    /**
     * Create a JSON array from the sets of labels.
     *
     * @param labels set of labels
     * @return JSON array of labels
     */
    private JSONArray buildArrayFromLabels(Set<String> labels) {
        JSONArray labelArray = new JSONArray();
        labels.forEach(labelArray::put);
        return labelArray;
    }

    /**
     * Add the aggregate function represented by the {@link AggFunctionArguments} parameter to the list of
     * aggregate functions.
     *
     * @param aggregateFunctionList      the list which will be extended
     * @param aggregateFunctionArguments the aggregate function configuration
     */
    private void addAggFunctionToList(List<AggregateFunction> aggregateFunctionList,
                                      AggFunctionArguments aggregateFunctionArguments) {
        switch (aggregateFunctionArguments.getAgg()) {
            case "count":
                aggregateFunctionList.add(new Count());
                break;
            case "minProp":
                aggregateFunctionList.add(new MinProperty(aggregateFunctionArguments.getProp()));
                break;
            case "maxProp":
                aggregateFunctionList.add(new MaxProperty(aggregateFunctionArguments.getProp()));
                break;
            case "avgProp":
                aggregateFunctionList.add(new AverageProperty(aggregateFunctionArguments.getProp()));
                break;
            case "sumProp":
                aggregateFunctionList.add(new SumProperty(aggregateFunctionArguments.getProp()));
                break;
            case "minTime":
                TimeDimension dimension = getTimeDimension(aggregateFunctionArguments.getDimension());
                TimeDimension.Field field = getPeriodBound(aggregateFunctionArguments.getPeriodBound());
                aggregateFunctionList
                        .add(new FormattedMinTime("minTime_" + dimension + "_" + field, dimension, field, FORMATTER));
                break;
            case "maxTime":
                dimension = getTimeDimension(aggregateFunctionArguments.getDimension());
                field = getPeriodBound(aggregateFunctionArguments.getPeriodBound());
                aggregateFunctionList
                        .add(new FormattedMaxTime("maxTime_" + dimension + "_" + field, dimension, field, FORMATTER));
                break;
            case "minDuration":
                dimension = getTimeDimension(aggregateFunctionArguments.getDimension());
                TemporalUnit unit = getTemporalUnit(aggregateFunctionArguments.getUnit());
                aggregateFunctionList.add(new MinDuration(dimension, unit));
                break;
            case "maxDuration":
                dimension = getTimeDimension(aggregateFunctionArguments.getDimension());
                unit = getTemporalUnit(aggregateFunctionArguments.getUnit());
                aggregateFunctionList.add(new MaxDuration(dimension, unit));
                break;
            case "avgDuration":
                dimension = getTimeDimension(aggregateFunctionArguments.getDimension());
                unit = getTemporalUnit(aggregateFunctionArguments.getUnit());
                aggregateFunctionList.add(new AverageDuration(dimension, unit));
                break;
        }
    }

    /**
     * Add the key function represented by the {@link KeyFunctionArguments} parameter to the list of key
     * functions.
     *
     * @param keyFunction the key function configuration
     * @param <T>         the type of the temporal element
     */
    private <T extends TemporalElement> KeyFunctionWithDefaultValue<T, ?> getKeyFunction(KeyFunctionArguments keyFunction) {
        switch (keyFunction.getKey()) {
            case "label":
                return GroupingKeys.label();
            case "property":
                return GroupingKeys.property(keyFunction.getProp());
            case "timestamp":
                if (keyFunction.getField().equals("no")) {
                    return
                            TemporalGroupingKeys.timeStamp(
                                    getTimeDimension(keyFunction.getDimension()),
                                    getPeriodBound(keyFunction.getPeriodBound()));
                } else {
                    return
                            TemporalGroupingKeys.timeStamp(
                                    getTimeDimension(keyFunction.getDimension()),
                                    getPeriodBound(keyFunction.getPeriodBound()),
                                    getTemporalField(keyFunction.getField()));
                }
            case "interval":
                return
                        TemporalGroupingKeys.timeInterval(
                                getTimeDimension(keyFunction.getDimension()));
            case "duration":
                return
                        TemporalGroupingKeys.duration(
                                getTimeDimension(keyFunction.getDimension()),
                                getTemporalUnit(keyFunction.getUnit())
                        );
            default:
                throw new IllegalArgumentException("The provided key function is unknown.");
        }
    }

    private TimeDimension getTimeDimension(String name) {
        return TimeDimension.valueOf(name);
    }

    private TimeDimension.Field getPeriodBound(String name) {
        return TimeDimension.Field.valueOf(name);
    }

    private TemporalField getTemporalField(String name) {
        switch (name) {
            case "year":
                return ChronoField.YEAR;
            case "month":
                return ChronoField.MONTH_OF_YEAR;
            case "weekOfYear":
                return ChronoField.ALIGNED_WEEK_OF_YEAR;
            case "weekOfMonth":
                return ChronoField.ALIGNED_WEEK_OF_MONTH;
            case "dayOfMonth":
                return ChronoField.DAY_OF_MONTH;
            case "dayOfYear":
                return ChronoField.DAY_OF_YEAR;
            case "hour":
                return ChronoField.HOUR_OF_DAY;
            case "minute":
                return ChronoField.MINUTE_OF_HOUR;
            case "second":
                return ChronoField.SECOND_OF_MINUTE;
            default:
                throw new IllegalArgumentException("Unknown time field: " + name);
        }
    }

    private TemporalUnit getTemporalUnit(String name) {
        return ChronoUnit.valueOf(name);
    }
}